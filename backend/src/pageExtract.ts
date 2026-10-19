/**
 * Extracts listing facts from a public listing page.
 *
 * The extractor is intentionally defensive: it reads structured data first
 * (schema.org JSON-LD `Offer`/`Product`), then OpenGraph metadata, then plain
 * text heuristics. Every field it cannot establish stays unknown — unknown is
 * never silently converted to zero, and the original URL is always preserved so
 * the user can open the source page.
 */

export interface ExtractedPage {
  title?: string;
  description?: string;
  price?: number;
  monthlyRent?: number;
  deposit?: number;
  transactionType?: "buy" | "rent";
  propertyType?: string;
  areaM2?: number;
  bedrooms?: number;
  city?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  features: string[];
  imageUrl?: string;
  sourceListingId?: string;
  publishedAt?: string;
}

const OFFER_TYPES = new Set([
  "offer",
  "product",
  "realestatelisting",
  "residence",
  "apartment",
  "house",
  "singlefamilyresidence",
  "accommodation",
  "place",
]);

const PROPERTY_TYPE_MAP: Record<string, string> = {
  apartment: "apartment",
  house: "house",
  singlefamilyresidence: "house",
  villa: "villa",
  land: "land",
  plot: "land",
  office: "office",
  shop: "shop",
  store: "shop",
  building: "building",
  industrial: "industrial",
};

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Converts Persian/Arabic digits and separators to ASCII digits. */
export function toAsciiDigits(value: string): string {
  let out = "";
  for (const char of value) {
    const persianIndex = PERSIAN_DIGITS.indexOf(char);
    if (persianIndex >= 0) { out += String(persianIndex); continue; }
    const arabicIndex = ARABIC_DIGITS.indexOf(char);
    if (arabicIndex >= 0) { out += String(arabicIndex); continue; }
    if (char === "٫" || char === "،") { out += "."; continue; }
    if (char === "٬" || char === "،") { out += ","; continue; }
    out += char;
  }
  return out;
}

/** Parses a numeric token that may use Persian digits, commas, or spaces. */
export function parseNumber(raw: string): number | undefined {
  const normalized = toAsciiDigits(raw).replace(/[,\s٬]/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

const BLOCK_SCRIPTS = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const META_TAG = /<meta\b[^>]*>/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;

function metaContent(html: string, key: string): string | undefined {
  const matcher = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  for (const tag of html.match(META_TAG) ?? []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!name || !matcher.test(name[1]!)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (content?.[1]) return decodeEntities(content[1].trim());
  }
  return undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(BLOCK_SCRIPTS)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try { blocks.push(JSON.parse(raw)); } catch { /* a malformed block must not break extraction */ }
  }
  return blocks;
}

function typeNames(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const type = (node as { "@type"?: unknown })["@type"];
  if (typeof type === "string") return [type.toLowerCase()];
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
  return [];
}

/** Depth-first search for the first structured offer-like object. */
function findOffer(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOffer(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  if (typeNames(record).some((name) => OFFER_TYPES.has(name))) return record;
  for (const value of Object.values(record)) {
    const found = findOffer(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numericField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseNumber(value);
  return undefined;
}

function additionalPropertyValue(offer: Record<string, unknown>, name: string): string | undefined {
  const properties = offer.additionalProperty;
  const list = Array.isArray(properties) ? properties : [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (!record) continue;
    const key = typeof record.name === "string" ? record.name : "";
    if (key.toLowerCase().includes(name.toLowerCase()) && typeof record.value === "string") return record.value;
  }
  return undefined;
}

function applyOffer(offer: Record<string, unknown>, out: ExtractedPage): void {
  if (typeof offer.name === "string" && offer.name.trim()) out.title = offer.name.trim();
  if (typeof offer.description === "string" && offer.description.trim()) out.description = offer.description.trim().slice(0, 2000);

  const category = typeof offer.category === "string" ? offer.category.toLowerCase() : "";
  if (category.includes("rent")) out.transactionType = "rent";
  else if (category.includes("sale")) out.transactionType = "buy";

  const price = numericField(offer.price);
  if (price !== undefined && price >= 0) {
    if (out.transactionType === "rent") out.monthlyRent = price;
    else out.price = price;
  }

  // Rentals publish the monthly rent and the refundable deposit separately.
  const specification = asRecord(offer.priceSpecification);
  const components = specification && Array.isArray(specification.priceComponent) ? specification.priceComponent : [];
  for (const component of components) {
    const record = asRecord(component);
    if (!record) continue;
    const kind = typeof record.priceType === "string" ? record.priceType.toLowerCase() : "";
    const value = numericField(record.price);
    if (value === undefined || value < 0) continue;
    if (kind.includes("deposit")) out.deposit = value;
    else if (kind.includes("rent")) { out.monthlyRent = value; out.transactionType = "rent"; }
  }

  const item = asRecord(offer.itemOffered);
  if (item) {
    const itemType = typeNames(item)[0];
    if (itemType && !out.propertyType) out.propertyType = PROPERTY_TYPE_MAP[itemType] ?? itemType;

    const floorSize = asRecord(item.floorSize);
    const area = floorSize ? numericField(floorSize.value) : numericField(item.floorSize);
    if (area !== undefined && area > 0) out.areaM2 = area;

    const rooms = numericField(item.numberOfRooms);
    if (rooms !== undefined && rooms >= 0) out.bedrooms = Math.round(rooms);

    const address = asRecord(item.address);
    if (address) {
      if (typeof address.addressRegion === "string" && address.addressRegion.trim()) out.city = address.addressRegion.trim();
      if (typeof address.addressLocality === "string" && address.addressLocality.trim()) out.neighborhood = address.addressLocality.trim();
      if (typeof address.addressCountry === "string" && address.addressCountry.trim() && !out.city) out.city = address.addressCountry.trim();
    }

    const geo = asRecord(item.geo);
    if (geo) {
      const latitude = numericField(geo.latitude);
      const longitude = numericField(geo.longitude);
      if (latitude !== undefined && latitude >= -90 && latitude <= 90) out.latitude = latitude;
      if (longitude !== undefined && longitude >= -180 && longitude <= 180) out.longitude = longitude;
    }

    const amenities = Array.isArray(item.amenityFeature) ? item.amenityFeature : [];
    for (const amenity of amenities) {
      const record = asRecord(amenity);
      const name = record && typeof record.name === "string" ? record.name : "";
      if (name.trim()) out.features.push(name.trim().toLowerCase());
    }
  }

  const faType = additionalPropertyValue(offer, "Property type");
  if (faType) {
    if (!out.propertyType) out.propertyType = faType.trim();
    else out.propertyType = out.propertyType;
  }

  if (typeof offer.datePosted === "string" && offer.datePosted.trim()) out.publishedAt = offer.datePosted.trim();
}

const PRICE_MILLIARD = /([0-9۰-۹٠-٩][0-9۰-۹٠-٩.,٬\s]*)\s*میلیارد\s*تومان/;
const PRICE_MILLION = /([0-9۰-۹٠-٩][0-9۰-۹٠-٩.,٬\s]*)\s*میلیون\s*تومان/;
const PRICE_PLAIN = /([0-9۰-۹٠-٩][0-9۰-۹٠-٩.,٬\s]*)\s*تومان/;
const AREA = /([0-9۰-۹٠-٩][0-9۰-۹٠-٩.,٬]*)\s*متر/;
const ROOMS = /([0-9۰-۹٠-٩][0-9۰-۹٠-٩]*)\s*خواب/;

/** Reads a price out of free text, understanding the common Persian notations. */
export function parsePriceFromText(text: string): number | undefined {
  const milliard = PRICE_MILLIARD.exec(text);
  if (milliard) {
    const value = parseNumber(milliard[1]!);
    if (value !== undefined) return Math.round(value * 1_000_000_000);
  }
  const million = PRICE_MILLION.exec(text);
  if (million) {
    const value = parseNumber(million[1]!);
    if (value !== undefined) return Math.round(value * 1_000_000);
  }
  const plain = PRICE_PLAIN.exec(text);
  if (plain) {
    const value = parseNumber(plain[1]!);
    if (value !== undefined) return Math.round(value);
  }
  return undefined;
}

export function parseAreaFromText(text: string): number | undefined {
  const match = AREA.exec(text);
  if (!match) return undefined;
  const value = parseNumber(match[1]!);
  return value !== undefined && value > 0 ? value : undefined;
}

export function parseRoomsFromText(text: string): number | undefined {
  const match = ROOMS.exec(text);
  if (!match) return undefined;
  const value = parseNumber(match[1]!);
  return value !== undefined && value >= 0 ? value : undefined;
}

/** Extracts the source's own identifier for the listing (for example the post id). */
export function extractSourceListingId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return undefined;
    const digits = /(\d{4,})/.exec(last) ?? /(\d{4,})/.exec(parsed.search);
    return digits?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Extracts listing facts from a listing page.
 * Returns null only when no usable title could be established.
 */
export function extractListingFromHtml(html: string, url: string): ExtractedPage | null {
  const out: ExtractedPage = { features: [] };

  for (const block of jsonLdBlocks(html)) {
    const offer = findOffer(block);
    if (!offer) continue;
    applyOffer(offer, out);
    break;
  }

  if (!out.title) {
    const ogTitle = metaContent(html, "og:title");
    if (ogTitle) out.title = ogTitle;
  }
  if (!out.title) {
    const title = TITLE_TAG.exec(html);
    if (title?.[1]) out.title = decodeEntities(title[1].trim()).split(/[-–|]/)[0]?.trim();
  }
  if (!out.description) {
    const ogDescription = metaContent(html, "og:description");
    const description = ogDescription ?? metaContent(html, "description");
    if (description) out.description = description.slice(0, 2000);
  }
  if (!out.imageUrl) {
    const image = metaContent(html, "og:image");
    if (image && /^https:\/\//i.test(image)) out.imageUrl = image;
  }

  const text = `${stripTags(html)} ${out.description ?? ""}`;
  if (out.price === undefined && out.monthlyRent === undefined) {
    const price = parsePriceFromText(text);
    if (price !== undefined) {
      if (out.transactionType === "rent") out.monthlyRent = price;
      else out.price = price;
    }
  }
  if (out.areaM2 === undefined) {
    const area = parseAreaFromText(text);
    if (area !== undefined) out.areaM2 = area;
  }
  if (out.bedrooms === undefined) {
    const rooms = parseRoomsFromText(text);
    if (rooms !== undefined) out.bedrooms = rooms;
  }

  out.sourceListingId = extractSourceListingId(url);
  out.features = [...new Set(out.features.map((feature) => feature.toLowerCase()))].sort();
  if (!out.title) return null;
  return out;
}
