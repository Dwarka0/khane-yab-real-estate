/**
 * Extracts listings from a public category page.
 *
 * Two shapes are supported, both of which the sources render server-side:
 *  - a JSON-LD array of `Product` objects (used by Divar), each with a
 *    `web_info` block that names the city, district, and category;
 *  - a React Server Component payload that carries a dehydrated query result
 *    with `attributes` and `fullAttributes` per item (used by Sheypoor).
 *
 * The extractor never guesses: a field it cannot read stays unknown.
 */

export interface CollectedItem {
  sourceListingId: string;
  title: string;
  url: string;
  price?: number;
  monthlyRent?: number;
  deposit?: number;
  areaM2?: number;
  bedrooms?: number;
  propertyType?: string;
  city?: string;
  neighborhood?: string;
  features: string[];
  category?: string;
  imageUrl?: string;
  transactionType: "buy" | "rent";
}

const FEATURE_KEYS: Record<string, string> = {
  "پارکینگ": "parking",
  "انباری": "storage",
  "آسانسور": "elevator",
  "بالکن": "balcony",
  "ساختمان": "building",
};

const AREA_KEYS = ["متراژ", "متراژمربع", "مساحت"];
const ROOM_KEYS = ["تعداد اتاق", "تعدادخواب"];
const DEPOSIT_KEYS = ["ودیعه", " مبلغ ودیعه"];
const TYPE_KEYS = ["نوع ملک", "نوع"];

/** Converts a Persian digit string to a number, ignoring separators. */
export function parseAmount(raw: string): number | undefined {
  const digits = raw.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const cleaned = digits.replace(/[,،\s]/g, "").replace(/[^\d.]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Finds the index of the '}' that closes the object that starts at `start`. */
export function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Reads the React Server Component payload out of an HTML document. */
export function extractFlightPayload(html: string): string {
  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) continue;
    try { chunks.push(JSON.parse(`"${raw}"`) as string); } catch { /* a malformed chunk is skipped */ }
  }
  return chunks.join("");
}

function attributeValue(attributes: { key?: string; value?: string }[], keys: string[]): string | undefined {
  for (const key of keys) {
    const found = attributes.find((attribute) => (attribute.key ?? "").trim() === key);
    const value = text(found?.value);
    if (value) return value;
  }
  return undefined;
}

function normalizeType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("آپارتمان") || normalized.includes("apartment")) return "apartment";
  if (normalized.includes("ویلا") || normalized.includes("villa")) return "villa";
  if (normalized.includes("خانه") || normalized.includes("house")) return "house";
  if (normalized.includes("زمین") || normalized.includes("land")) return "land";
  if (normalized.includes("مغازه") || normalized.includes("shop")) return "shop";
  if (normalized.includes("اداری") || normalized.includes("office")) return "office";
  if (normalized.includes("کلنگی") || normalized.includes("مسکونی")) return "residential";
  return undefined;
}

function idFromUrl(url: string): string | undefined {
  const match = /(\d{6,})/.exec(url);
  return match?.[1];
}

function splitLocation(location: string | undefined): { city?: string; neighborhood?: string } {
  if (!location) return {};
  const parts = location.split(/[,،]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { city: parts[0] };
  return { city: parts[0], neighborhood: parts.slice(1).join("، ") };
}

/** Reads the JSON-LD `Product` list used by Divar. */
export function extractJsonLdProducts(html: string): CollectedItem[] {
  const items: CollectedItem[] = [];
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const block of blocks) {
    let parsed: unknown;
    try { parsed = JSON.parse(block[1]!.trim()); } catch { continue; }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
      if (!types.includes("Product")) continue;
      const webInfo = (record.web_info ?? {}) as Record<string, unknown>;
      const offers = (record.offers ?? {}) as Record<string, unknown>;
      const url = text(record.url);
      const title = text(record.name) ?? text(webInfo.title);
      if (!url || !title) continue;
      const price = typeof offers.price === "string" ? parseAmount(offers.price) : undefined;
      const location = splitLocation(text(webInfo.city_persian));
      const district = text(webInfo.district_persian);
      items.push({
        sourceListingId: idFromUrl(url) ?? url,
        title,
        url,
        price,
        city: location.city,
        neighborhood: district,
        propertyType: normalizeType(text(webInfo.category_slug_persian)),
        category: text(webInfo.category_slug_persian),
        imageUrl: text(record.image),
        features: [],
        transactionType: "buy",
      });
    }
  }
  return items;
}

/** Reads the dehydrated query result used by Sheypoor. */
export function extractFlightItems(html: string): CollectedItem[] {
  const payload = extractFlightPayload(html);
  if (!payload) return [];
  const items: CollectedItem[] = [];
  for (const match of payload.matchAll(/\{"type":"/g)) {
    const start = match.index;
    const end = matchBrace(payload, start);
    if (end < 0) continue;
    const chunk = payload.slice(start, end + 1);
    if (!chunk.includes('"attributes"')) continue;
    let record: Record<string, unknown>;
    try { record = JSON.parse(chunk) as Record<string, unknown>; } catch { continue; }
    const attributes = (record.attributes ?? {}) as Record<string, unknown>;
    const fullAttributes = Array.isArray(record.fullAttributes) ? record.fullAttributes as { key?: string; value?: string }[] : [];
    const url = text(attributes.url);
    const title = text(attributes.title);
    if (!url || !title) continue;
    const priceList = Array.isArray(attributes.price) ? attributes.price as { amount?: string; label?: string; currency?: string }[] : [];
    const price = priceList.length ? parseAmount(priceList[0]?.amount ?? "") : undefined;
    const depositText = attributeValue(fullAttributes, DEPOSIT_KEYS);
    const areaText = attributeValue(fullAttributes, AREA_KEYS);
    const roomsText = attributeValue(fullAttributes, ROOM_KEYS);
    const typeText = attributeValue(fullAttributes, TYPE_KEYS);
    const location = splitLocation(text(attributes.location));
    const features = fullAttributes
      .map((attribute) => FEATURE_KEYS[(attribute.key ?? "").trim()])
      .filter((feature): feature is string => Boolean(feature));
    const isRent = Boolean(depositText) || /رهن|اجاره/.test(text(attributes.category) ?? "") || Boolean(priceList[0]?.label?.includes("اجاره"));
    items.push({
      sourceListingId: idFromUrl(url) ?? url,
      title,
      url,
      price: isRent ? undefined : price,
      monthlyRent: isRent ? price : undefined,
      deposit: depositText ? parseAmount(depositText) : undefined,
      areaM2: areaText ? parseAmount(areaText) : undefined,
      bedrooms: roomsText ? parseAmount(roomsText) : undefined,
      propertyType: normalizeType(typeText),
      category: typeText,
      city: location.city,
      neighborhood: location.neighborhood,
      features: [...new Set(features)],
      transactionType: isRent ? "rent" : "buy",
    });
  }
  return items;
}

/** Reads every listing a category page exposes, from either supported shape. */
export function extractCollectedItems(html: string): CollectedItem[] {
  const items = [...extractJsonLdProducts(html), ...extractFlightItems(html)];
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.sourceListingId)) return false;
    seen.add(item.sourceListingId);
    return true;
  });
}
