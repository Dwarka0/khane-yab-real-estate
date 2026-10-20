import { freshnessScore, isFresh } from "./listings";
import type { ListingInput } from "./types";

export type PublicListing = {
  id: string; source: string; sourceUrl?: string; title: string; description: string; city: string;
  neighborhood?: string; propertyType: string; transactionType: "buy" | "rent";
  price: number; salePrice?: number; monthlyRent?: number; deposit?: number;
  areaM2?: number; bedrooms?: number; bathrooms?: number;
  features: string[]; publishedAt?: string; last_seen_at: string; freshnessScore?: number; stale: boolean;
};

/** Maps a listing that was just extracted to the shape the clients receive. */
export function toPublicListingFromInput(input: ListingInput, lastSeenAt: string, maxAgeDays: number): PublicListing {
  const stale = !isFresh(lastSeenAt, maxAgeDays);
  return {
    id: input.sourceListingId ?? input.sourceUrl ?? input.title,
    source: input.source,
    sourceUrl: input.sourceUrl,
    title: input.title,
    description: input.description ?? "",
    city: input.city,
    neighborhood: input.neighborhood,
    propertyType: input.propertyType,
    transactionType: input.transactionType,
    price: input.price,
    salePrice: input.salePrice,
    monthlyRent: input.monthlyRent,
    deposit: input.deposit,
    areaM2: input.areaM2,
    bedrooms: input.bedrooms,
    features: input.features,
    publishedAt: input.publishedAt,
    last_seen_at: lastSeenAt,
    freshnessScore: freshnessScore(lastSeenAt),
    stale,
  };
}

/** Maps a listing row to the shape the clients receive. */
export function toPublicListing(row: Record<string, unknown>, maxAgeDays: number): PublicListing {
  const lastSeen = String(row.last_seen_at);
  const stale = !isFresh(lastSeen, maxAgeDays);
  return {
    id: String(row.id), source: String(row.source), sourceUrl: row.source_url == null ? undefined : String(row.source_url),
    title: String(row.title), description: String(row.description), city: String(row.city),
    neighborhood: row.neighborhood == null ? undefined : String(row.neighborhood), propertyType: String(row.property_type),
    transactionType: String(row.transaction_type) as "buy" | "rent", price: Number(row.price),
    salePrice: row.sale_price == null ? undefined : Number(row.sale_price),
    monthlyRent: row.monthly_rent == null ? undefined : Number(row.monthly_rent),
    deposit: row.deposit == null ? undefined : Number(row.deposit),
    areaM2: row.area_m2 == null ? undefined : Number(row.area_m2),
    bedrooms: row.bedrooms == null ? undefined : Number(row.bedrooms),
    bathrooms: row.bathrooms == null ? undefined : Number(row.bathrooms),
    features: JSON.parse(String(row.features)) as string[],
    publishedAt: row.published_at == null ? undefined : String(row.published_at),
    last_seen_at: lastSeen,
    freshnessScore: freshnessScore(lastSeen),
    stale,
  };
}
