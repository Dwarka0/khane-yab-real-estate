import { extractCollectedItems, type CollectedItem } from "./collector";
import { extractListingFromHtml } from "./pageExtract";
import { fetchSourcePage, type FetchLike } from "./linkImport";
import { upsertListing } from "./listingStore";
import { listingSchema } from "./validation";
import { checkSourcePermission, hostAllowlist, SOURCE_USER_LINK } from "./sources";
import { listSourcePages, toListingInput, SOURCE_COLLECTOR, type SourcePageRow } from "./liveSearch";
import type { Env } from "./types";

export { SOURCE_COLLECTOR } from "./liveSearch";

/** A category page carries many listings, so it needs a larger body budget than a single item page. */
export const COLLECTOR_MAX_BYTES = 2 * 1024 * 1024;

/** Pause between the requests the collector makes, so a source is never flooded. */
export const DETAIL_DELAY_MS = 4000;

/** Pause between two listing pages of the same run. */
export const PAGE_DELAY_MS = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PageResult {
  pageId: string;
  url: string;
  label: string | null;
  status: "ok" | "empty" | "error";
  found: number;
  inserted: number;
  updated: number;
  skipped: number;
  details: number;
  detailsEnriched: number;
  message?: string;
}

export interface CollectRunResult {
  runId: string;
  sourceId: string;
  pages: PageResult[];
  inserted: number;
  updated: number;
  skipped: number;
}

/** Keeps only the categories the page is configured for. */
export function matchesCategoryFilter(category: string | undefined, filter: string | null): boolean {
  if (!filter) return true;
  const wanted = filter.split(",").map((part) => part.trim()).filter(Boolean);
  if (wanted.length === 0) return true;
  if (!category) return false;
  return wanted.some((needle) => category.includes(needle));
}

/**
 * Reads the configured listing pages once and stores what they publish.
 *
 * The run is deliberately small: one request per page, no crawling, no item
 * page fetches, and every page is only read on the configured schedule.
 */
export async function runCollection(
  env: Env,
  options: { sourceId?: string; fetchImpl?: FetchLike; maxPages?: number; expiresAt?: string } = {},
): Promise<CollectRunResult> {
  const sourceId = options.sourceId ?? SOURCE_COLLECTOR;
  const permission = await checkSourcePermission(env, sourceId);
  if (!permission.allowed) throw new Error(`${permission.code}: ${permission.message}`);
  const allowlist = hostAllowlist(permission.source);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  const pages = await listSourcePages(env, sourceId);
  const limited = options.maxPages ? pages.slice(0, options.maxPages) : pages;
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO ingestion_runs(id, adapter, received_count) VALUES(?, ?, ?)").bind(runId, "collector", 0).run();

  const results: PageResult[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let received = 0;

  for (const [index, page] of limited.entries()) {
    const result: PageResult = {
      pageId: page.id, url: page.url, label: page.label, status: "ok", found: 0, inserted: 0, updated: 0, skipped: 0, details: 0, detailsEnriched: 0,
    };
    if (index > 0) await sleep(PAGE_DELAY_MS);
    const fetched = await fetchSourcePage(page.url, allowlist, fetchImpl, COLLECTOR_MAX_BYTES);
    if ("error" in fetched) {
      result.status = "error";
      result.message = fetched.error;
      results.push(result);
      await env.DB.prepare("UPDATE source_pages SET last_status=?, last_collected_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(`error: ${fetched.error.slice(0, 120)}`, page.id).run();
      // A source that asks us to slow down is not asked again in this run,
      // but the other sources still get their turn.
      if (fetched.error.includes("429")) {
        const aborted: PageResult = { pageId: "remaining", url: "", label: null, status: "error", found: 0, inserted: 0, updated: 0, skipped: 0, details: 0, detailsEnriched: 0, message: "منبع درخواست کاهش نرخ داد؛ بقیهٔ صفحات همین منبع در این اجرا رد شد" };
        results.push(aborted);
        const host = new URL(page.url).hostname.replace(/^www\./, "");
        const remaining = limited.slice(index + 1).filter((next) => new URL(next.url).hostname.replace(/^www\./, "") !== host);
        const skippedHost = limited.slice(index + 1).filter((next) => new URL(next.url).hostname.replace(/^www\./, "") === host);
        for (const next of skippedHost) {
          await env.DB.prepare("UPDATE source_pages SET last_status=?, last_collected_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind("skipped: the source asked for a slower rate", next.id).run();
        }
        limited.splice(limited.indexOf(page) + 1, limited.length, ...remaining);
        continue;
      }
      continue;
    }

    const items = extractCollectedItems(fetched.html).filter((item) => {
      const category = item.category;
      return matchesCategoryFilter(category, page.category_filter) || page.category_filter === null;
    });
    result.found = items.length;
    received += items.length;

    // Some category pages publish only a short summary. When a page is
    // configured to follow up, the item page is read as well, slowly and
    // within a strict budget, to obtain the full facts.
    if (page.follow_detail && items.length > 0) {
      const limit = Math.max(0, Math.min(20, page.detail_limit));
      // Listings that already carry a price are skipped, so the budget moves
      // on to the next ones over the following runs instead of repeating the
      // same pages.
      const alreadyPriced = new Set<string>();
      try {
        const rows = await env.DB.prepare("SELECT source_listing_id FROM listings WHERE source = ? AND price > 0")
          .bind(new URL(page.url).hostname.replace(/^www\./, "")).all<{ source_listing_id: string | null }>();
        for (const row of rows.results) if (row.source_listing_id) alreadyPriced.add(String(row.source_listing_id));
      } catch {
        // The lookup is an optimisation; the run continues without it.
      }
      const needsDetail = items
        .filter((item) => !alreadyPriced.has(item.sourceListingId))
        .sort((a, b) => Number(Boolean(a.price)) - Number(Boolean(b.price)));
      for (const item of needsDetail.slice(0, limit)) {
        await sleep(DETAIL_DELAY_MS);
        result.details++;
        const detail = await fetchSourcePage(item.url, allowlist, fetchImpl, COLLECTOR_MAX_BYTES);
        if ("error" in detail) continue;
        const extracted = extractListingFromHtml(detail.html, detail.finalUrl);
        if (!extracted) continue;
        item.price = extracted.price ?? item.price;
        item.monthlyRent = extracted.monthlyRent ?? item.monthlyRent;
        item.deposit = extracted.deposit ?? item.deposit;
        item.areaM2 = extracted.areaM2 ?? item.areaM2;
        item.bedrooms = extracted.bedrooms ?? item.bedrooms;
        item.propertyType = extracted.propertyType ?? item.propertyType;
        item.city = extracted.city ?? item.city;
        item.neighborhood = extracted.neighborhood ?? item.neighborhood;
        item.description = extracted.description;
        item.features = extracted.features.length ? extracted.features : item.features;
        result.detailsEnriched++;
      }
    }

    for (const item of items) {
      const input = toListingInput(item, page);
      const parsed = listingSchema.safeParse(input);
      if (!parsed.success) { result.skipped++; skipped++; continue; }
      const stored = await upsertListing(env, parsed.data, sourceId, options.expiresAt ?? undefined, page.id);
      if (stored.created) { result.inserted++; inserted++; } else { result.updated++; updated++; }
    }

    result.status = items.length ? "ok" : "empty";
    results.push(result);
    await env.DB.prepare("UPDATE source_pages SET last_status=?, last_item_count=?, last_collected_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(result.status, result.found, page.id).run();
  }

  await env.DB.prepare("UPDATE ingestion_runs SET finished_at=CURRENT_TIMESTAMP, received_count=?, inserted_count=?, updated_count=?, skipped_count=?, status='completed' WHERE id=?")
    .bind(received, inserted, updated, skipped, runId).run();

  return { runId, sourceId, pages: results, inserted, updated, skipped };
}

/** The collector may also be pointed at a single page for a one-off run. */
export async function collectFromSource(env: Env, sourceId = SOURCE_USER_LINK) {
  return runCollection(env, { sourceId });
}
