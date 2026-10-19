import type { ContentfulStatusCode } from "hono/utils/http-status";
import { listingSchema } from "./validation";
import { hashListing, normalizeListing } from "./listings";
import { extractListingFromHtml, type ExtractedPage } from "./pageExtract";
import { checkSourcePermission, hostAllowlist, isHostAllowed, SOURCE_USER_LINK, type SourceRecord } from "./sources";
import type { Env, Listing, ListingInput } from "./types";

/** Largest page body the worker will read from a source. */
export const MAX_SOURCE_BYTES = 512 * 1024;
export const SOURCE_FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

export interface LinkImportSuccess {
  ok: true;
  listing: Listing;
  created: boolean;
  runId: string;
  source: SourceRecord;
  extracted: ExtractedPage;
}

export interface LinkImportFailure {
  ok: false;
  status: ContentfulStatusCode;
  code: string;
  message: string;
}

export type LinkImportResult = LinkImportSuccess | LinkImportFailure;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface ValidatedUrl {
  href: string;
  host: string;
}

/**
 * Accepts only HTTPS listing URLs. Credentials, non-standard ports, and
 * literal IP addresses are rejected before any request is made.
 */
export function validateSourceUrl(raw: string, allowlist: string[]): ValidatedUrl | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "نشانی واردشده معتبر نیست" };
  }
  if (url.protocol !== "https:") return { error: "فقط نشانی https پذیرفته می‌شود" };
  if (url.username || url.password) return { error: "نشانی نباید شامل اطلاعات ورود باشد" };
  if (url.port && url.port !== "443") return { error: "پورت غیر استاندارد پذیرفته نمی‌شود" };
  const host = url.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return { error: "نشانی میزبان پذیرفته نمی‌شود" };
  if (allowlist.length > 0 && !isHostAllowed(host, allowlist)) {
    return { error: "این میزبان در فهرست منابع مجاز نیست" };
  }
  return { href: url.toString(), host };
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return await response.text();
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Source response exceeded the allowed size");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Fetches a listing page while keeping every redirect inside the allowlist. */
export async function fetchSourcePage(
  startUrl: string,
  allowlist: string[],
  fetchImpl: FetchLike,
  maxBytes: number = MAX_SOURCE_BYTES,
): Promise<{ html: string; finalUrl: string } | { error: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        headers: {
          "User-Agent": "KhaneYabBot/1.0 (+https://khane-yab-web.pages.dev)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "fa-IR,fa;q=0.9",
        },
        signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
      });
    } catch {
      return { error: "دریافت صفحهٔ منبع ممکن نشد" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { error: "پاسخ نامعتبر از منبع دریافت شد" };
      let target: URL;
      try {
        target = new URL(location, current);
      } catch {
        return { error: "نشانی هدایت‌شده معتبر نیست" };
      }
      if (target.protocol !== "https:" || (allowlist.length > 0 && !isHostAllowed(target.hostname.toLowerCase(), allowlist))) {
        return { error: "هدایت به میزبان غیرمجاز مسدود شد" };
      }
      current = target.toString();
      continue;
    }

    if (!response.ok) return { error: `منبع پاسخ ${response.status} برگرداند` };
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return { error: "نوع محتوای منبع پشتیبانی نمی‌شود" };
    }
    let html: string;
    try {
      html = await readBounded(response, maxBytes);
    } catch {
      return { error: "حجم صفحهٔ منبع بیش از حد مجاز است" };
    }
    return { html, finalUrl: current };
  }
  return { error: "تعداد هدایت‌های منبع بیش از حد مجاز است" };
}

/**
 * Imports one listing page that a user submitted.
 *
 * The user supplies the URL, so the platform never crawls a source: it reads a
 * single page the user pointed at, stores the minimum fields required for
 * matching, and always links the user back to the original listing.
 */
export async function importListingFromUrl(
  env: Env,
  rawUrl: string,
  options: { sourceId?: string; fetchImpl?: FetchLike } = {},
): Promise<LinkImportResult> {
  const sourceId = options.sourceId ?? SOURCE_USER_LINK;
  const permission = await checkSourcePermission(env, sourceId);
  if (!permission.allowed) {
    return { ok: false, status: 403, code: permission.code, message: permission.message };
  }
  const source = permission.source;
  const allowlist = hostAllowlist(source);

  const validated = validateSourceUrl(rawUrl, allowlist);
  if ("error" in validated) {
    return { ok: false, status: 400, code: "INVALID_SOURCE_URL", message: validated.error };
  }

  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const fetched = await fetchSourcePage(validated.href, allowlist, fetchImpl);
  if ("error" in fetched) {
    return { ok: false, status: 502, code: "SOURCE_FETCH_FAILED", message: fetched.error };
  }

  const extracted = extractListingFromHtml(fetched.html, fetched.finalUrl);
  if (!extracted) {
    return { ok: false, status: 422, code: "LISTING_EXTRACT_FAILED", message: "اطلاعات آگهی از این صفحه قابل خواندن نبود" };
  }

  const sourceLabel = validated.host.replace(/^www\./, "");
  const input: ListingInput = {
    source: sourceLabel,
    sourceListingId: extracted.sourceListingId,
    sourceUrl: fetched.finalUrl,
    title: (extracted.title ?? "آگهی بدون عنوان").slice(0, 240),
    description: extracted.description ?? "",
    city: (extracted.city ?? "نامشخص").slice(0, 120),
    neighborhood: extracted.neighborhood?.slice(0, 120),
    propertyType: (extracted.propertyType ?? "unknown").slice(0, 80),
    transactionType: extracted.transactionType ?? "buy",
    price: extracted.transactionType === "rent" ? (extracted.monthlyRent ?? 0) : (extracted.price ?? 0),
    salePrice: extracted.transactionType === "rent" ? undefined : extracted.price,
    monthlyRent: extracted.transactionType === "rent" ? extracted.monthlyRent : undefined,
    deposit: extracted.transactionType === "rent" ? extracted.deposit : undefined,
    areaM2: extracted.areaM2,
    bedrooms: extracted.bedrooms,
    latitude: extracted.latitude,
    longitude: extracted.longitude,
    features: extracted.features.slice(0, 30),
    publishedAt: extracted.publishedAt,
  };

  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, status: 422, code: "LISTING_EXTRACT_FAILED", message: "اطلاعات استخراج‌شده با قالب آگهی سازگار نبود" };
  }
  const item = normalizeListing(parsed.data);
  const contentHash = await hashListing(item);

  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO ingestion_runs(id, adapter, received_count) VALUES(?, ?, ?)").bind(runId, source.kind, 1).run();

  const existing = item.sourceListingId
    ? await env.DB.prepare("SELECT id FROM listings WHERE source = ? AND source_listing_id = ?").bind(item.source, item.sourceListingId).first<{ id: string }>()
    : await env.DB.prepare("SELECT id FROM listings WHERE source_url = ?").bind(item.sourceUrl!).first<{ id: string }>();

  let listingId: string;
  let created: boolean;
  if (existing) {
    listingId = existing.id;
    created = false;
    await env.DB.prepare(
      `UPDATE listings SET source_url=?, title=?, description=?, city=?, neighborhood=?, property_type=?, transaction_type=?, price=?, sale_price=?, monthly_rent=?, deposit=?, area_m2=?, bedrooms=?, latitude=?, longitude=?, features=?, published_at=?, last_seen_at=CURRENT_TIMESTAMP, content_hash=?, status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).bind(
      item.sourceUrl ?? null, item.title, item.description ?? "", item.city, item.neighborhood ?? null, item.propertyType,
      item.transactionType, item.price, item.salePrice ?? null, item.monthlyRent ?? null, item.deposit ?? null,
      item.areaM2 ?? null, item.bedrooms ?? null, item.latitude ?? null, item.longitude ?? null,
      JSON.stringify(item.features), item.publishedAt ?? null, contentHash, listingId,
    ).run();
  } else {
    listingId = crypto.randomUUID();
    created = true;
    await env.DB.prepare(
      `INSERT INTO listings(id, source, source_listing_id, source_url, title, description, city, neighborhood, property_type, transaction_type, price, sale_price, monthly_rent, deposit, area_m2, bedrooms, latitude, longitude, features, published_at, content_hash)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      listingId, item.source, item.sourceListingId ?? null, item.sourceUrl ?? null, item.title, item.description ?? "",
      item.city, item.neighborhood ?? null, item.propertyType, item.transactionType, item.price, item.salePrice ?? null,
      item.monthlyRent ?? null, item.deposit ?? null, item.areaM2 ?? null, item.bedrooms ?? null, item.latitude ?? null,
      item.longitude ?? null, JSON.stringify(item.features), item.publishedAt ?? null, contentHash,
    ).run();
  }

  // Every sighting of the listing is kept so the source stays traceable.
  const observationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO listing_observations(id, listing_id, source_id, source_record_id, source_url, content_hash)
     VALUES(?,?,?,?,?,?) ON CONFLICT(source_id, source_record_id) DO UPDATE SET observed_at=CURRENT_TIMESTAMP, source_url=excluded.source_url, content_hash=excluded.content_hash`,
  ).bind(observationId, listingId, source.id, item.sourceListingId ?? null, item.sourceUrl ?? null, contentHash).run();

  await env.DB.prepare(
    "UPDATE ingestion_runs SET finished_at=CURRENT_TIMESTAMP, inserted_count=?, updated_count=?, skipped_count=0, status='completed', message=NULL WHERE id=?",
  ).bind(created ? 1 : 0, created ? 0 : 1, runId).run();

  const listingRow = await env.DB.prepare("SELECT * FROM listings WHERE id=?").bind(listingId).first<Record<string, unknown>>();
  const listing: Listing = {
    id: String(listingRow!.id),
    source: String(listingRow!.source),
    sourceListingId: listingRow!.source_listing_id == null ? undefined : String(listingRow!.source_listing_id),
    sourceUrl: listingRow!.source_url == null ? undefined : String(listingRow!.source_url),
    title: String(listingRow!.title),
    description: String(listingRow!.description),
    city: String(listingRow!.city),
    neighborhood: listingRow!.neighborhood == null ? undefined : String(listingRow!.neighborhood),
    propertyType: String(listingRow!.property_type),
    transactionType: String(listingRow!.transaction_type) as "buy" | "rent",
    price: Number(listingRow!.price),
    salePrice: listingRow!.sale_price == null ? undefined : Number(listingRow!.sale_price),
    monthlyRent: listingRow!.monthly_rent == null ? undefined : Number(listingRow!.monthly_rent),
    deposit: listingRow!.deposit == null ? undefined : Number(listingRow!.deposit),
    areaM2: listingRow!.area_m2 == null ? undefined : Number(listingRow!.area_m2),
    bedrooms: listingRow!.bedrooms == null ? undefined : Number(listingRow!.bedrooms),
    latitude: listingRow!.latitude == null ? undefined : Number(listingRow!.latitude),
    longitude: listingRow!.longitude == null ? undefined : Number(listingRow!.longitude),
    features: JSON.parse(String(listingRow!.features)) as string[],
    publishedAt: listingRow!.published_at == null ? undefined : String(listingRow!.published_at),
    firstSeenAt: String(listingRow!.first_seen_at),
    lastSeenAt: String(listingRow!.last_seen_at),
    contentHash: String(listingRow!.content_hash),
    status: String(listingRow!.status) as Listing["status"],
  };

  return { ok: true, listing, created, runId, source, extracted };
}
