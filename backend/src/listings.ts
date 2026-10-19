import type { ListingInput } from "./types";

const normalizeText = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function normalizeListing(input: ListingInput): ListingInput {
  return {
    ...input,
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
    normalizeText(input.propertyType), Math.round(input.price), input.areaM2 ?? "", input.bedrooms ?? "",
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
