import { hashListing, normalizeListing } from "./listings";
import type { Env, ListingInput } from "./types";

export interface UpsertResult {
  listingId: string;
  created: boolean;
  contentHash: string;
}

/**
 * Stores one normalized listing and records the sighting.
 *
 * The listing is matched by `(source, source_listing_id)` when the source
 * provides an identifier, and by its content hash otherwise, so the same
 * listing is never stored twice. Every sighting is written to
 * `listing_observations` so the provenance of the record survives updates.
 */
export async function upsertListing(env: Env, raw: ListingInput, sourceId: string): Promise<UpsertResult> {
  const item = normalizeListing(raw);
  const contentHash = await hashListing(item);

  const existing = item.sourceListingId
    ? await env.DB.prepare("SELECT id FROM listings WHERE source = ? AND source_listing_id = ?").bind(item.source, item.sourceListingId).first<{ id: string }>()
    : await env.DB.prepare("SELECT id FROM listings WHERE source_url = ?").bind(item.sourceUrl!).first<{ id: string }>();

  const listingId = existing?.id ?? crypto.randomUUID();
  const created = !existing;

  if (existing) {
    await env.DB.prepare(
      `UPDATE listings SET source_url=?, title=?, description=?, city=?, neighborhood=?, address=?, property_type=?, transaction_type=?, price=?, sale_price=?, monthly_rent=?, deposit=?, area_m2=?, bedrooms=?, bathrooms=?, latitude=?, longitude=?, features=?, published_at=?, last_seen_at=CURRENT_TIMESTAMP, content_hash=?, status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).bind(
      item.sourceUrl ?? null, item.title, item.description ?? "", item.city, item.neighborhood ?? null, item.address ?? null,
      item.propertyType, item.transactionType, item.price, item.salePrice ?? null, item.monthlyRent ?? null, item.deposit ?? null,
      item.areaM2 ?? null, item.bedrooms ?? null, item.bathrooms ?? null, item.latitude ?? null, item.longitude ?? null,
      JSON.stringify(item.features), item.publishedAt ?? null, contentHash, listingId,
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO listings(id, source, source_listing_id, source_url, title, description, city, neighborhood, address, property_type, transaction_type, price, sale_price, monthly_rent, deposit, area_m2, bedrooms, bathrooms, latitude, longitude, features, published_at, content_hash)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      listingId, item.source, item.sourceListingId ?? null, item.sourceUrl ?? null, item.title, item.description ?? "",
      item.city, item.neighborhood ?? null, item.address ?? null, item.propertyType, item.transactionType, item.price,
      item.salePrice ?? null, item.monthlyRent ?? null, item.deposit ?? null, item.areaM2 ?? null, item.bedrooms ?? null,
      item.bathrooms ?? null, item.latitude ?? null, item.longitude ?? null, JSON.stringify(item.features),
      item.publishedAt ?? null, contentHash,
    ).run();
  }

  await env.DB.prepare(
    `INSERT INTO listing_observations(id, listing_id, source_id, source_record_id, source_url, content_hash)
     VALUES(?,?,?,?,?,?) ON CONFLICT(source_id, source_record_id) DO UPDATE SET observed_at=CURRENT_TIMESTAMP, source_url=excluded.source_url, content_hash=excluded.content_hash`,
  ).bind(crypto.randomUUID(), listingId, sourceId, item.sourceListingId ?? null, item.sourceUrl ?? null, contentHash).run();

  return { listingId, created, contentHash };
}
