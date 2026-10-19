import type { ListingInput } from "./types";

const normalizeText = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function normalizeListing(input: ListingInput): ListingInput {
  const price = input.transactionType === "buy" ? (input.salePrice ?? input.price) : (input.monthlyRent ?? input.price);
  return {
    ...input,
    price,
    salePrice: input.transactionType === "buy" ? (input.salePrice ?? input.price) : undefined,
    monthlyRent: input.transactionType === "rent" ? (input.monthlyRent ?? input.price) : undefined,
    source: normalizeText(input.source),
    title: input.title.normalize("NFKC").trim().replace(/\s+/g, " "),
    description: (input.description ?? "").normalize("NFKC").trim(),
    city: input.city.normalize("NFKC").trim().replace(/\s+/g, " "),
    neighborhood: input.neighborhood?.normalize("NFKC").trim(),
    propertyType: normalizeText(input.propertyType),
    features: [...new Set(input.features.map(normalizeText))].sort(),
    sourceUrl: input.sourceUrl?.startsWith("https://") ? input.sourceUrl : undefined,
  };
}

export async function hashListing(input: ListingInput): Promise<string> {
  const canonical = [input.transactionType, normalizeText(input.city), normalizeText(input.neighborhood ?? ""),
    normalizeText(input.propertyType), Math.round(input.transactionType === "buy" ? (input.salePrice ?? input.price) : (input.monthlyRent ?? input.price)),
    input.transactionType === "rent" ? (input.deposit ?? "") : "", input.areaM2 ?? "", input.bedrooms ?? "",
    normalizeText(input.title)].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function isFresh(lastSeenAt: string, maxAgeDays: number, now = Date.now()): boolean {
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && now - seen <= maxAgeDays * 86_400_000 && now >= seen - 300_000;
}

export function freshnessScore(lastSeenAt: string, now = Date.now()): number {
  const ageDays = Math.max(0, (now - Date.parse(lastSeenAt)) / 86_400_000);
  if (!Number.isFinite(ageDays)) return 0;
  return Math.max(0, 1 - ageDays / 90);
}
