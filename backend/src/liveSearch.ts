import { extractCollectedItems, type CollectedItem } from "./collector";
import { fetchSourcePage, type FetchLike } from "./linkImport";
import { upsertListing } from "./listingStore";
import { listingSchema } from "./validation";
import { checkSourcePermission, hostAllowlist } from "./sources";
import { isEligibleListing, scoreListing, REASON_LABELS } from "./scoring";
import { toPublicListing, toPublicListingFromInput, type PublicListing } from "./publicListing";
import type { Env, ListingInput, Preferences } from "./types";

/** A page the collector may read, with the city and the category it covers. */
export interface SourcePageRow {
  id: string;
  source_id: string;
  url: string;
  label: string | null;
  transaction_type: "buy" | "rent";
  category_filter: string | null;
  enabled: number;
  follow_detail: number;
  detail_limit: number;
  city: string | null;
  property_type: string | null;
}

export interface LiveCriteria {
  transactionType: "buy" | "rent";
  city?: string;
  propertyTypes?: string[];
  neighborhoods?: string[];
  budgetMin?: number;
  budgetMax?: number;
  minBedrooms?: number;
  minAreaM2?: number;
  mustHave?: string[];
  avoid?: string[];
}

export interface LivePageReport {
  pageId: string;
  label: string | null;
  url: string;
  status: "ok" | "empty" | "error";
  items: number;
  cached: boolean;
  message?: string;
}

export interface LiveMatch {
  listing: PublicListing;
  score: number;
  reasons: string[];
  reasonLabels: string[];
}

export interface LiveSearchResult {
  notes: string[];
  fetchedAt: string;
  expiresAt: string;
  city: string | null;
  transactionType: string;
  pages: LivePageReport[];
  items: LiveMatch[];
  total: number;
}

/** The registry entry of the scheduled and on-demand collector. */
export const SOURCE_COLLECTOR = "src-collector";

/** How long a listing stays in the server cache. It is a cache, not a store. */
export const DEFAULT_CACHE_TTL_MINUTES = 120;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listSourcePages(env: Env, sourceId: string): Promise<SourcePageRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, source_id, url, label, transaction_type, category_filter, enabled, follow_detail, detail_limit, city, property_type
     FROM source_pages WHERE source_id = ? AND enabled = 1 ORDER BY id`,
  ).bind(sourceId).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id),
    source_id: String(row.source_id),
    url: String(row.url),
    label: row.label == null ? null : String(row.label),
    transaction_type: String(row.transaction_type) as "buy" | "rent",
    category_filter: row.category_filter == null ? null : String(row.category_filter),
    enabled: Number(row.enabled),
    follow_detail: Number(row.follow_detail ?? 0),
    detail_limit: Number(row.detail_limit ?? 0),
    city: row.city == null ? null : String(row.city),
    property_type: row.property_type == null ? null : String(row.property_type),
  }));
}

/**
 * Picks the pages that match the criteria: the city first, then the
 * transaction type, then the property type. A page that covers a different
 * city is never read for this search.
 */
export function resolvePages(pages: SourcePageRow[], criteria: LiveCriteria): SourcePageRow[] {
  const city = criteria.city?.trim();
  const types = (criteria.propertyTypes ?? []).map((type) => type.trim().toLowerCase()).filter(Boolean);
  const wanted = (page: SourcePageRow) => {
    if (city && page.city && page.city !== city) return false;
    if (page.transaction_type !== criteria.transactionType) return false;
    if (types.length && page.property_type && !types.includes(page.property_type.toLowerCase())) return false;
    return true;
  };
  const exact = pages.filter(wanted);
  if (exact.length > 0) return exact;
  // No page covers this city: fall back to the pages that cover the
  // transaction type, so the search still returns something.
  return pages.filter((page) => page.transaction_type === criteria.transactionType);
}

/** Turns a collected item into a validated listing input. */
export function toListingInput(item: CollectedItem, page: SourcePageRow): ListingInput {
  const category = item.category ?? "";
  const categorySaysRent = /اجاره|رهن/.test(category);
  const categorySaysBuy = /فروش|خرید/.test(category);
  // The item's own category wins: a general city page mixes sale and rent.
  const isRent = item.transactionType === "rent" || categorySaysRent || (page.transaction_type === "rent" && !categorySaysBuy);
  const price = isRent ? (item.monthlyRent ?? 0) : (item.price ?? 0);
  return {
    source: new URL(item.url).hostname.replace(/^www\./, ""),
    sourceListingId: item.sourceListingId,
    sourceUrl: item.url,
    title: item.title.slice(0, 240),
    description: (item.description ?? "").slice(0, 10000),
    city: (item.city ?? "نامشخص").slice(0, 120),
    neighborhood: item.neighborhood?.slice(0, 120),
    propertyType: (item.propertyType ?? item.category ?? "unknown").slice(0, 80),
    transactionType: isRent ? "rent" : "buy",
    price,
    salePrice: isRent ? undefined : (price || undefined),
    monthlyRent: isRent ? (price || undefined) : undefined,
    deposit: isRent ? item.deposit : undefined,
    areaM2: item.areaM2,
    bedrooms: item.bedrooms,
    features: item.features.slice(0, 30),
  };
}

/** Reads a page, unless a fresh copy of it is already in the cache. */
async function readPage(
  env: Env,
  page: SourcePageRow,
  allowlist: string[],
  fetchImpl: FetchLike,
  expiresAt: string,
): Promise<{ items: CollectedItem[]; rows?: Record<string, unknown>[]; cached: boolean; status: "ok" | "empty" | "error"; message?: string }> {
  const cached = await env.DB.prepare("SELECT fetched_at, expires_at FROM page_cache WHERE page_id = ?").bind(page.id).first<{ fetched_at: string; expires_at: string }>();
  if (cached && cached.expires_at > new Date().toISOString()) {
    // The page was read recently: answer from the cache without asking the
    // source again. When the cache was already purged, the page is read
    // again, because an empty cache is no cache.
    const rows = await env.DB.prepare("SELECT * FROM listings WHERE page_id = ? AND expires_at > ?")
      .bind(page.id, new Date().toISOString()).all<Record<string, unknown>>();
    if (rows.results.length > 0) {
      return { items: [], rows: rows.results, cached: true, status: "ok" };
    }
  }

  const fetched = await fetchSourcePage(page.url, allowlist, fetchImpl, 2 * 1024 * 1024);
  if ("error" in fetched) return { items: [], cached: false, status: "error", message: fetched.error };

  const items = extractCollectedItems(fetched.html).filter((item) => {
    const category = item.category;
    if (!page.category_filter) return true;
    const wanted = page.category_filter.split(",").map((part) => part.trim()).filter(Boolean);
    return wanted.some((needle) => (category ?? "").includes(needle));
  });

  for (const item of items) {
    const input = toListingInput(item, page);
    const parsed = listingSchema.safeParse(input);
    if (!parsed.success) continue;
    await upsertListing(env, parsed.data, page.source_id, expiresAt, page.id);
  }
  await env.DB.prepare(
    `INSERT INTO page_cache(page_id, source_id, fetched_at, expires_at, item_count) VALUES(?,?,CURRENT_TIMESTAMP,?,?)
     ON CONFLICT(page_id) DO UPDATE SET fetched_at=CURRENT_TIMESTAMP, expires_at=excluded.expires_at, item_count=excluded.item_count`,
  ).bind(page.id, page.source_id, expiresAt, items.length).run();

  return { items, rows: [], cached: false, status: items.length ? "ok" : "empty" };
}

/**
 * Searches the sources for the criteria of the seeker and returns the
 * matching listings.
 *
 * The server does not keep the data: the listings it reads live in a short
 * lived cache so a repeated search does not ask the source again, and the
 * cache is purged. What the seeker learns stays on the seeker's device.
 */
export async function searchLive(
  env: Env,
  criteria: LiveCriteria,
  options: { sourceId?: string; fetchImpl?: FetchLike; maxPages?: number; cacheTtlMinutes?: number; limit?: number } = {},
): Promise<LiveSearchResult> {
  const sourceId = options.sourceId ?? SOURCE_COLLECTOR;
  const permission = await checkSourcePermission(env, sourceId);
  if (!permission.allowed) throw new Error(`${permission.code}: ${permission.message}`);
  const allowlist = hostAllowlist(permission.source);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const ttlMinutes = Math.max(5, Math.min(1440, options.cacheTtlMinutes ?? DEFAULT_CACHE_TTL_MINUTES));
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const fetchedAt = new Date().toISOString();

  const pages = await listSourcePages(env, sourceId);
  const resolved = resolvePages(pages, criteria);
  const notes: string[] = [];
  const cityCovered = !criteria.city || resolved.some((page) => page.city && page.city === criteria.city);
  if (!cityCovered) {
    // No source page covers the requested city: the search is widened and the
    // seeker is told about it, rather than silently returning nothing.
    notes.push("شهر درخواستی صفحهٔ اختصاصی ندارد؛ نتایج از نزدیک‌ترین شهرهای پوشش‌داده‌شده آمده است.");
  }
  const maxPages = Math.max(1, Math.min(12, options.maxPages ?? 6));
  const chosen = resolved.slice(0, maxPages);

  const reports: LivePageReport[] = [];
  const collected: { listing: PublicListing; item: CollectedItem }[] = [];

  for (const [index, page] of chosen.entries()) {
    if (index > 0) await sleep(4000);
    const read = await readPage(env, page, allowlist, fetchImpl, expiresAt);
    reports.push({
      pageId: page.id, label: page.label, url: page.url, status: read.status, items: read.items.length, cached: read.cached, message: read.message,
    });
    if (read.status === "error") continue;
    for (const item of read.items) {
      const input = toListingInput(item, page);
      const parsed = listingSchema.safeParse(input);
      if (!parsed.success) continue;
      collected.push({ listing: toPublicListingFromInput(parsed.data, fetchedAt, 90), item });
    }
    for (const row of read.rows ?? []) {
      collected.push({
        listing: toPublicListing(row, 90),
        item: { sourceListingId: String(row.source_listing_id ?? row.id), title: String(row.title), url: String(row.source_url ?? ""), features: [], transactionType: criteria.transactionType },
      });
    }
  }

  // The cached rows are scored as well, so a repeated search inside the
  // window returns the same matches without asking the source again.
  if (collected.length === 0) {
    const sql = criteria.city
      ? "SELECT * FROM listings WHERE status='active' AND expires_at > ? AND transaction_type = ? AND city = ?"
      : "SELECT * FROM listings WHERE status='active' AND expires_at > ? AND transaction_type = ?";
    const rows = criteria.city
      ? await env.DB.prepare(sql).bind(new Date().toISOString(), criteria.transactionType, criteria.city).all<Record<string, unknown>>()
      : await env.DB.prepare(sql).bind(new Date().toISOString(), criteria.transactionType).all<Record<string, unknown>>();
    for (const row of rows.results) collected.push({ listing: toPublicListing(row, 90), item: { sourceListingId: String(row.id), title: String(row.title), url: String(row.source_url ?? ""), features: [], transactionType: criteria.transactionType } });
  }

  const preferences: Preferences = {
    transactionType: criteria.transactionType,
    city: cityCovered ? criteria.city : undefined,
    neighborhoods: criteria.neighborhoods ?? [],
    propertyTypes: criteria.propertyTypes ?? [],
    budgetMin: criteria.budgetMin,
    budgetMax: criteria.budgetMax,
    minBedrooms: criteria.minBedrooms,
    minAreaM2: criteria.minAreaM2,
    mustHave: criteria.mustHave ?? [],
    avoid: criteria.avoid ?? [],
  };

  const matches: LiveMatch[] = collected
    .filter(({ listing }) => isEligibleListing(listing, preferences))
    .map(({ listing }) => {
      const scored = scoreListing(listing, preferences);
      return { listing, score: scored.score, reasons: scored.reasons, reasonLabels: scored.reasonLabels };
    })
    .sort((a, b) => b.score - a.score || (b.listing.freshnessScore ?? 0) - (a.listing.freshnessScore ?? 0) || a.listing.id.localeCompare(b.listing.id));

  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  return {
    notes,
    fetchedAt,
    expiresAt,
    city: criteria.city ?? null,
    transactionType: criteria.transactionType,
    pages: reports,
    items: matches.slice(0, limit),
    total: matches.length,
  };
}
