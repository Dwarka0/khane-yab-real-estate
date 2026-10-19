import { listingSchema } from "./validation";
import { hashListing, normalizeListing } from "./listings";
import type { Env, ListingInput } from "./types";

/** Only caller-supplied, authorized records are accepted. No crawling or access-control bypass is performed. */
export async function importListings(env: Env, adapter: "manual" | "demo", rawItems: unknown[]) {
  if (rawItems.length > 100) throw new Error("At most 100 listings may be imported per request");
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO ingestion_runs(id, adapter, received_count) VALUES(?, ?, ?)").bind(runId, adapter, rawItems.length).run();
  let inserted = 0, updated = 0, skipped = 0;
  try {
    const writes: D1PreparedStatement[] = [];
    for (const raw of rawItems) {
      const parsed = listingSchema.safeParse(raw);
      if (!parsed.success) { skipped++; continue; }
      const item: ListingInput = normalizeListing(parsed.data);
      const id = crypto.randomUUID();
      const contentHash = await hashListing(item);
      const existingBySource = item.sourceListingId
        ? await env.DB.prepare("SELECT id FROM listings WHERE source = ? AND source_listing_id = ?").bind(item.source, item.sourceListingId).first<{id:string}>()
        : null;
      const existing = existingBySource ?? await env.DB.prepare("SELECT id FROM listings WHERE content_hash = ? AND status = 'active' LIMIT 1").bind(contentHash).first<{id:string}>();
      if (existing) {
        writes.push(env.DB.prepare(`UPDATE listings SET source_url=?, title=?, description=?, city=?, neighborhood=?, address=?, property_type=?, transaction_type=?, price=?, area_m2=?, bedrooms=?, bathrooms=?, latitude=?, longitude=?, features=?, published_at=?, last_seen_at=CURRENT_TIMESTAMP, content_hash=?, status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(item.sourceUrl ?? null,item.title,item.description ?? "",item.city,item.neighborhood ?? null,item.address ?? null,item.propertyType,item.transactionType,item.price,item.areaM2 ?? null,item.bedrooms ?? null,item.bathrooms ?? null,item.latitude ?? null,item.longitude ?? null,JSON.stringify(item.features),item.publishedAt ?? null,contentHash,existing.id));
        updated++;
      } else {
        writes.push(env.DB.prepare(`INSERT INTO listings(id,source,source_listing_id,source_url,title,description,city,neighborhood,address,property_type,transaction_type,price,area_m2,bedrooms,bathrooms,latitude,longitude,features,published_at,content_hash)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,item.source,item.sourceListingId ?? null,item.sourceUrl ?? null,item.title,item.description ?? "",item.city,item.neighborhood ?? null,item.address ?? null,item.propertyType,item.transactionType,item.price,item.areaM2 ?? null,item.bedrooms ?? null,item.bathrooms ?? null,item.latitude ?? null,item.longitude ?? null,JSON.stringify(item.features),item.publishedAt ?? null,contentHash));
        inserted++;
      }
    }
    writes.push(env.DB.prepare("UPDATE ingestion_runs SET finished_at=CURRENT_TIMESTAMP, inserted_count=?, updated_count=?, skipped_count=?, status='completed', message=NULL WHERE id=?")
      .bind(inserted,updated,skipped,runId));
    // D1 batch is transactional: listing writes and the completed status commit together.
    await env.DB.batch(writes);
  } catch {
    try {
      await env.DB.prepare("UPDATE ingestion_runs SET finished_at=CURRENT_TIMESTAMP, status='failed', message='Import failed; listing changes were rolled back' WHERE id=? AND status='running'").bind(runId).run();
    } catch {
      // If D1 itself is unavailable, recording the failure may also be impossible.
    }
    throw new Error("Import failed; listing changes were rolled back");
  }
  return { runId, received: rawItems.length, inserted, updated, skipped };
}

export const demoListings: ListingInput[] = [
  { source:"demo", sourceListingId:"demo-001", title:"آپارتمان دوخوابه نورگیر", description:"نزدیک حمل‌ونقل عمومی و فروشگاه‌ها", city:"تهران", neighborhood:"صادقیه", propertyType:"apartment", transactionType:"buy", price:6500000000, areaM2:92, bedrooms:2, bathrooms:1, features:["elevator","parking","storage"] },
  { source:"demo", sourceListingId:"demo-002", title:"واحد یک‌خوابه نزدیک پارک", description:"ساختمان کم‌واحد با نور مناسب", city:"تهران", neighborhood:"پونک", propertyType:"apartment", transactionType:"rent", price:180000000, areaM2:68, bedrooms:1, bathrooms:1, features:["elevator","balcony"] },
];
