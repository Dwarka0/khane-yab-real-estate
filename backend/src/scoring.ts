import type { ListingInput, Preferences } from "./types";

/**
 * Stable reason codes. Clients localize these codes; the Persian labels below
 * are a server-side convenience so a client that has no label map still shows
 * a readable explanation.
 */
export const REASON_CODES = [
  "TRANSACTION_MATCH",
  "LOCATION_MATCH",
  "NEIGHBORHOOD_MATCH",
  "PROPERTY_TYPE_MATCH",
  "WITHIN_BUDGET",
  "ROOMS_MATCH",
  "AREA_MATCH",
  "FEATURES_MATCH",
  "PREFERENCE_MATCH",
  "MISSING_KEY_FIELDS",
  "STALE_LISTING",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABELS: Record<ReasonCode, string> = {
  TRANSACTION_MATCH: "نوع معامله مطابق ترجیح شماست",
  LOCATION_MATCH: "شهر موردنظر شماست",
  NEIGHBORHOOD_MATCH: "محله در فهرست ترجیحی شماست",
  PROPERTY_TYPE_MATCH: "نوع ملک مطابق ترجیح شماست",
  WITHIN_BUDGET: "قیمت در بازهٔ بودجهٔ شماست",
  ROOMS_MATCH: "تعداد اتاق‌خواب کافی است",
  AREA_MATCH: "متراژ موردنیاز را دارد",
  FEATURES_MATCH: "امکانات ضروری را دارد",
  PREFERENCE_MATCH: "ویژگی نامطلوبی در آگهی پیدا نشد",
  MISSING_KEY_FIELDS: "بعضی اطلاعات این آگهی نامشخص است",
  STALE_LISTING: "این آگهی قدیمی است و موجودی آن تأیید نشده",
};

export interface ScoredListing<T extends ListingInput> {
  listing: T;
  score: number;
  reasons: ReasonCode[];
  reasonLabels: string[];
}

const normalized = (value: string) => value.trim().toLocaleLowerCase();

/** Hard eligibility constraints are applied before scoring so incompatible listings can never be recommended. */
export function isEligibleListing<T extends ListingInput>(listing: T, prefs: Preferences): boolean {
  if (normalized(listing.transactionType) !== normalized(prefs.transactionType)) return false;
  if (prefs.city && normalized(listing.city) !== normalized(prefs.city)) return false;
  if (prefs.budgetMin !== undefined && listing.price < prefs.budgetMin) return false;
  if (prefs.budgetMax !== undefined && listing.price > prefs.budgetMax) return false;
  if (prefs.propertyTypes.length && !prefs.propertyTypes.some(type => normalized(type) === normalized(listing.propertyType))) return false;
  if (prefs.minBedrooms !== undefined && (listing.bedrooms === undefined || listing.bedrooms < prefs.minBedrooms)) return false;
  if (prefs.minAreaM2 !== undefined && (listing.areaM2 === undefined || listing.areaM2 < prefs.minAreaM2)) return false;
  if (prefs.neighborhoods.length && (!listing.neighborhood || !prefs.neighborhoods.some(n => normalized(n) === normalized(listing.neighborhood!)))) return false;
  if (prefs.mustHave.length && !prefs.mustHave.every(required => listing.features.some(feature => normalized(feature) === normalized(required)))) return false;
  if (prefs.avoid.length) {
    const searchableText = normalized(`${listing.title} ${listing.description ?? ""} ${listing.features.join(" ")}`);
    if (prefs.avoid.some(term => searchableText.includes(normalized(term)))) return false;
  }
  return true;
}

/** Fields a seeker usually needs that the listing does not state. */
export function missingKeyFields(listing: ListingInput): string[] {
  const missing: string[] = [];
  if (listing.price === undefined) missing.push("price");
  if (listing.areaM2 === undefined) missing.push("area");
  if (listing.bedrooms === undefined) missing.push("bedrooms");
  if (!listing.neighborhood) missing.push("neighborhood");
  return missing;
}

export function scoreListing<T extends ListingInput>(listing: T, prefs: Preferences): ScoredListing<T> {
  let earned = 0;
  let possible = 0;
  const reasons: ReasonCode[] = [];
  const add = (weight: number, matches: boolean, reason: ReasonCode) => {
    possible += weight;
    if (matches) { earned += weight; reasons.push(reason); }
  };

  add(24, listing.transactionType === prefs.transactionType, "TRANSACTION_MATCH");
  if (prefs.city) add(18, listing.city.toLocaleLowerCase() === prefs.city.toLocaleLowerCase(), "LOCATION_MATCH");
  if (prefs.neighborhoods.length) add(12, !!listing.neighborhood && prefs.neighborhoods.some(n => n.toLocaleLowerCase() === listing.neighborhood!.toLocaleLowerCase()), "NEIGHBORHOOD_MATCH");
  if (prefs.propertyTypes.length) add(10, prefs.propertyTypes.some(t => t.toLocaleLowerCase() === listing.propertyType.toLocaleLowerCase()), "PROPERTY_TYPE_MATCH");
  if (prefs.budgetMax !== undefined) add(16, listing.price <= prefs.budgetMax && (prefs.budgetMin === undefined || listing.price >= prefs.budgetMin), "WITHIN_BUDGET");
  if (prefs.minBedrooms !== undefined) add(8, (listing.bedrooms ?? -1) >= prefs.minBedrooms, "ROOMS_MATCH");
  if (prefs.minAreaM2 !== undefined) add(6, (listing.areaM2 ?? -1) >= prefs.minAreaM2, "AREA_MATCH");
  if (prefs.mustHave.length) add(6, prefs.mustHave.every(f => listing.features.some(x => x.toLowerCase() === f.toLowerCase())), "FEATURES_MATCH");
  if (prefs.avoid.length) add(20, !prefs.avoid.some(f => `${listing.title} ${listing.description ?? ""} ${listing.features.join(" ")}`.toLowerCase().includes(f.toLowerCase())), "PREFERENCE_MATCH");

  // A missing field is not a match: it is reported so the seeker knows the
  // listing could not be compared on that dimension.
  if (missingKeyFields(listing).length > 0) reasons.push("MISSING_KEY_FIELDS");

  return {
    listing,
    score: possible ? Math.round(earned / possible * 100) : 0,
    reasons,
    reasonLabels: reasons.map((reason) => REASON_LABELS[reason]),
  };
}
