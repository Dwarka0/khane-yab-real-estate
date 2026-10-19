import { listingSchema } from "./validation";
import { hashListing, normalizeListing } from "./listings";
import { checkSourcePermission, SOURCE_DEMO, SOURCE_MANUAL } from "./sources";
import type { Env, ListingInput } from "./types";

export class IngestionPermissionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Only caller-supplied, authorized records are accepted. No crawling or access-control bypass is performed. */
export async function importListings(
  env: Env,
  adapter: "manual" | "demo",
  rawItems: unknown[],
  options: { sourceId?: string } = {},
) {
  const sourceId = options.sourceId ?? (adapter === "demo" ? SOURCE_DEMO : SOURCE_MANUAL);
  const permission = await checkSourcePermission(env, sourceId);
  if (!permission.allowed) throw new IngestionPermissionError(permission.code, permission.message);
  if (rawItems.length > 100) throw new Error("At most 100 listings may be imported per request");
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO ingestion_runs(id, adapter, received_count) VALUES(?, ?, ?)").bind(runId, adapter, rawItems.length).run();
  let inserted = 0, updated = 0, skipped = 0;
  const diagnostics: { rowNumber: number; errorCode: string; safeMessage: string }[] = [];
  try {
    const writes: D1PreparedStatement[] = [];
    const seenSourceIds = new Set<string>();
    const seenContentHashes = new Set<string>();
    for (const raw of rawItems) {
      const parsed = listingSchema.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        // Row-level diagnostics stay bounded: the invalid field names are
        // recorded, never the full row payload.
        const fields = parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean).slice(0, 5).join(",");
        diagnostics.push({
          rowNumber: rawItems.indexOf(raw) + 1,
          errorCode: "VALIDATION_ERROR",
          safeMessage: fields ? `فیلدهای نامعتبر: ${fields}` : "دادهٔ ردیف با قالب سازگار نبود",
        });
        continue;
      }
      const item: ListingInput = normalizeListing(parsed.data);
      const id = crypto.randomUUID();
      const contentHash = await hashListing(item);
      const sourceKey = item.sourceListingId ? `${item.source}\u0000${item.sourceListingId}` : undefined;
      // Rows in this same import are not visible to the database dedupe queries
      // until the final transactional batch executes. Reject repeats here so a
      // duplicate cannot violate UNIQUE(source, source_listing_id) and roll back
      // otherwise valid rows from the whole import.
      if ((sourceKey && seenSourceIds.has(sourceKey)) || seenContentHashes.has(contentHash)) {
        skipped++;
        diagnostics.push({
          rowNumber: rawItems.indexOf(raw) + 1,
          errorCode: "DUPLICATE_IN_BATCH",
          safeMessage: "ردیف تکراری در همین درخواست نادیده گرفته شد",
        });
        continue;
      }
      if (sourceKey) seenSourceIds.add(sourceKey);
      seenContentHashes.add(contentHash);
      const existingBySource = item.sourceListingId
        ? await env.DB.prepare("SELECT id FROM listings WHERE source = ? AND source_listing_id = ?").bind(item.source, item.sourceListingId).first<{id:string}>()
        : null;
      const existing = existingBySource ?? await env.DB.prepare("SELECT id FROM listings WHERE content_hash = ? AND status = 'active' LIMIT 1").bind(contentHash).first<{id:string}>();
      const listingId = existing?.id ?? id;
      if (existing) {
        writes.push(env.DB.prepare(`UPDATE listings SET source_url=?, title=?, description=?, city=?, neighborhood=?, address=?, property_type=?, transaction_type=?, price=?, sale_price=?, monthly_rent=?, deposit=?, area_m2=?, bedrooms=?, bathrooms=?, latitude=?, longitude=?, features=?, published_at=?, last_seen_at=CURRENT_TIMESTAMP, content_hash=?, status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(item.sourceUrl ?? null,item.title,item.description ?? "",item.city,item.neighborhood ?? null,item.address ?? null,item.propertyType,item.transactionType,item.price,item.salePrice ?? null,item.monthlyRent ?? null,item.deposit ?? null,item.areaM2 ?? null,item.bedrooms ?? null,item.bathrooms ?? null,item.latitude ?? null,item.longitude ?? null,JSON.stringify(item.features),item.publishedAt ?? null,contentHash,existing.id));
        updated++;
      } else {
        writes.push(env.DB.prepare(`INSERT INTO listings(id,source,source_listing_id,source_url,title,description,city,neighborhood,address,property_type,transaction_type,price,sale_price,monthly_rent,deposit,area_m2,bedrooms,bathrooms,latitude,longitude,features,published_at,content_hash)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,item.source,item.sourceListingId ?? null,item.sourceUrl ?? null,item.title,item.description ?? "",item.city,item.neighborhood ?? null,item.address ?? null,item.propertyType,item.transactionType,item.price,item.salePrice ?? null,item.monthlyRent ?? null,item.deposit ?? null,item.areaM2 ?? null,item.bedrooms ?? null,item.bathrooms ?? null,item.latitude ?? null,item.longitude ?? null,JSON.stringify(item.features),item.publishedAt ?? null,contentHash));
        inserted++;
      }
      // Each sighting of a listing is recorded so provenance survives updates.
      writes.push(env.DB.prepare(`INSERT INTO listing_observations(id, listing_id, source_id, source_record_id, source_url, content_hash)
        VALUES(?,?,?,?,?,?) ON CONFLICT(source_id, source_record_id) DO UPDATE SET observed_at=CURRENT_TIMESTAMP, source_url=excluded.source_url, content_hash=excluded.content_hash`)
        .bind(crypto.randomUUID(), listingId, sourceId, item.sourceListingId ?? null, item.sourceUrl ?? null, contentHash));
    }
    for (const diagnostic of diagnostics) {
      writes.push(env.DB.prepare("INSERT INTO import_errors(id, run_id, row_number, error_code, safe_message) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(), runId, diagnostic.rowNumber, diagnostic.errorCode, diagnostic.safeMessage));
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
  return { runId, received: rawItems.length, inserted, updated, skipped, errors: diagnostics.length };
}

export const demoListings: ListingInput[] = [
  { source:"demo", sourceListingId:"demo-001", title:"آپارتمان دوخوابه نورگیر", description:"نزدیک حمل‌ونقل عمومی و فروشگاه‌ها", city:"تهران", neighborhood:"صادقیه", propertyType:"apartment", transactionType:"buy", price:6500000000, areaM2:92, bedrooms:2, bathrooms:1, features:["elevator","parking","storage"] },
  { source:"demo", sourceListingId:"demo-002", title:"واحد یک‌خوابه نزدیک پارک", description:"ساختمان کم‌واحد با نور مناسب", city:"تهران", neighborhood:"پونک", propertyType:"apartment", transactionType:"rent", price:180000000, monthlyRent:180000000, deposit:400000000, areaM2:68, bedrooms:1, bathrooms:1, features:["elevator","balcony"] },
];
