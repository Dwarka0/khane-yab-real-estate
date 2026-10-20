import { extractListingFromHtml } from "./pageExtract";
import { fetchSourcePage, type FetchLike } from "./linkImport";
import type { CollectedItem } from "./collector";
import type { ExtractedPage } from "./pageExtract";
import type { Env } from "./types";

/** Pause between two listing pages, so a source is never flooded. */
export const DETAIL_DELAY_MS = 4500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DetailEnrichment {
  attempted: number;
  enriched: number;
  /** The reason the last listing page could not be read, if it failed. */
  error?: string;
  /** The title of the first listing page that was read, for diagnostics. */
  sample?: string;
  /** The number of listing pages that stated a price. */
  withPrice: number;
}

/**
 * Reads the listing pages of the items that do not have a price yet.
 *
 * A category page of a source publishes the title, the link, the area, the
 * rooms, and the location, but the price is only on the listing page itself.
 * The budget is small and the requests are paused, and the items that
 * already carry a price are skipped, so the following runs move on to the
 * next ones.
 */
export async function enrichWithDetailPages(
  env: Env,
  items: CollectedItem[],
  options: {
    pageId: string;
    sourceHost: string;
    allowlist: string[];
    fetchImpl: FetchLike;
    limit: number;
    delayMs?: number;
    /** Ranks the items; the ones that fit the search are read first. */
    rank?: (item: CollectedItem) => number;
    /**
     * Called as soon as one item is completed, so a caller that runs in the
     * background keeps the prices it already paid for even when the runtime
     * stops the job before the whole batch is done.
     */
    onEnriched?: (item: CollectedItem) => Promise<void> | void;
  },
): Promise<DetailEnrichment> {
  const result: DetailEnrichment = { attempted: 0, enriched: 0, withPrice: 0 };
  if (items.length === 0 || options.limit <= 0) return result;

  // The items that already carry a price are not read again.
  const alreadyPriced = new Set<string>();
  try {
    const rows = await env.DB.prepare("SELECT source_listing_id FROM listings WHERE source = ? AND price > 0")
      .bind(options.sourceHost).all<{ source_listing_id: string | null }>();
    for (const row of rows.results) if (row.source_listing_id) alreadyPriced.add(String(row.source_listing_id));
  } catch {
    // The lookup is an optimisation; the run continues without it.
  }

  const pending = items
    .filter((item) => !alreadyPriced.has(item.sourceListingId))
    .sort((a, b) => {
      // An item that already has a price is read last.
      const priceKnown = Number(Boolean(a.price)) - Number(Boolean(b.price));
      if (priceKnown !== 0) return priceKnown;
      if (!options.rank) return 0;
      return options.rank(b) - options.rank(a);
    })
    .slice(0, Math.max(0, options.limit));

  for (const item of pending) {
    await sleep(options.delayMs ?? DETAIL_DELAY_MS);
    result.attempted++;
    // A source may answer a burst with a throttled or a shortened page. The
    // listing is read once more after a longer pause before it is given up
    // on, because a listing without a price is of little use to the seeker.
    let facts: ExtractedPage | null = null;
    for (let attempt = 0; attempt < 2 && !facts; attempt++) {
      if (attempt > 0) await sleep((options.delayMs ?? DETAIL_DELAY_MS) * 3);
      const detail = await fetchSourcePage(item.url, options.allowlist, options.fetchImpl, 2 * 1024 * 1024);
      if ("error" in detail) { result.error = detail.error; continue; }
      const extracted = extractListingFromHtml(detail.html, detail.finalUrl);
      if (!extracted) { result.error = "the listing page carried no usable facts"; continue; }
      if (!extracted.price) { result.error = "the listing page did not state a price"; continue; }
      facts = extracted;
    }
    if (!facts) {
      // The source asked for a slower rate: the rest of the listing pages of
      // this run are left for a later search.
      if ((result.error ?? "").includes("429")) break;
      continue;
    }
    const extracted = facts;
    item.price = extracted.price ?? item.price;
    item.monthlyRent = extracted.monthlyRent ?? item.monthlyRent;
    item.deposit = extracted.deposit ?? item.deposit;
    item.areaM2 = extracted.areaM2 ?? item.areaM2;
    item.bedrooms = extracted.bedrooms ?? item.bedrooms;
    item.propertyType = extracted.propertyType ?? item.propertyType;
    item.city = extracted.city ?? item.city;
    item.neighborhood = extracted.neighborhood ?? item.neighborhood;
    item.description = extracted.description ?? item.description;
    item.features = extracted.features.length ? extracted.features : item.features;
    result.enriched++;
    if (item.price && item.price > 0) result.withPrice++;
    if (!result.sample) result.sample = extracted.title;
    if (options.onEnriched) await options.onEnriched(item);
  }
  return result;
}
