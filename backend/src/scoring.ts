import type { ListingInput, Preferences } from "./types";

export interface ScoredListing<T extends ListingInput> { listing: T; score: number; reasons: string[] }

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

export function scoreListing<T extends ListingInput>(listing: T, prefs: Preferences): ScoredListing<T> {
  let earned = 0;
  let possible = 0;
  const reasons: string[] = [];
  const add = (weight: number, matches: boolean, reason: string) => {
    possible += weight;
    if (matches) { earned += weight; reasons.push(reason); }
  };

  add(24, listing.transactionType === prefs.transactionType, "نوع معامله مطابق ترجیح شماست");
  if (prefs.city) add(18, listing.city.toLocaleLowerCase() === prefs.city.toLocaleLowerCase(), "شهر موردنظر شماست");
  if (prefs.neighborhoods.length) add(12, !!listing.neighborhood && prefs.neighborhoods.some(n => n.toLocaleLowerCase() === listing.neighborhood!.toLocaleLowerCase()), "محله در فهرست ترجیحی شماست");
  if (prefs.propertyTypes.length) add(10, prefs.propertyTypes.some(t => t.toLocaleLowerCase() === listing.propertyType.toLocaleLowerCase()), "نوع ملک مطابق ترجیح شماست");
  if (prefs.budgetMax !== undefined) add(16, listing.price <= prefs.budgetMax && (prefs.budgetMin === undefined || listing.price >= prefs.budgetMin), "قیمت در بازه بودجه شماست");
  if (prefs.minBedrooms !== undefined) add(8, (listing.bedrooms ?? -1) >= prefs.minBedrooms, "تعداد اتاق‌خواب کافی است");
  if (prefs.minAreaM2 !== undefined) add(6, (listing.areaM2 ?? -1) >= prefs.minAreaM2, "متراژ موردنیاز را دارد");
  if (prefs.mustHave.length) add(6, prefs.mustHave.every(f => listing.features.some(x => x.toLocaleLowerCase() === f.toLocaleLowerCase())), "امکانات ضروری را دارد");
  if (prefs.avoid.length) add(20, !prefs.avoid.some(f => `${listing.title} ${listing.description ?? ""} ${listing.features.join(" ")}`.toLocaleLowerCase().includes(f.toLocaleLowerCase())), "ویژگی نامطلوبی در آگهی پیدا نشد");

  return { listing, score: possible ? Math.round(earned / possible * 100) : 0, reasons };
}
