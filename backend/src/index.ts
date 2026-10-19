import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { preferencesSchema, searchSchema } from "./validation";
import { rateLimit } from "./rateLimit";
import { demoListings, importListings } from "./ingestion";
import { isEligibleListing, scoreListing } from "./scoring";
import { freshnessScore, isFresh } from "./listings";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors({
  origin: (origin, c) => {
    const allowed = (c.env.ALLOWED_ORIGINS ?? "").split(",").map((value: string) => value.trim()).filter(Boolean);
    return allowed.includes(origin) ? origin : "";
  },
  allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));
app.use("/api/*", rateLimit);
app.use("/api/preferences/*", bodyLimit({ maxSize: 16 * 1024 }));
app.use("/api/ingest/manual", bodyLimit({ maxSize: 1_048_576 }));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    const tooLarge = error.status === 413;
    return c.json({ error: { code: tooLarge ? "PAYLOAD_TOO_LARGE" : "HTTP_ERROR", message: tooLarge ? "حجم درخواست بیشتر از حد مجاز است" : "درخواست قابل پردازش نیست" } }, error.status);
  }
  console.error("api_error", { path: c.req.path, message: error.message });
  return c.json({ error: { code: "INTERNAL_ERROR", message: "درخواست با خطا مواجه شد" } }, 500);
});

app.get("/health", c => c.json({ status: "ok", service: "real-estate-platform-api" }));

app.put("/api/preferences/:id", async c => {
  const id = c.req.param("id").trim();
  // Preference IDs are short-lived, anonymous bearer capabilities generated with
  // crypto.randomUUID() by the clients. Requiring UUIDv4 prevents caller-chosen
  // predictable identifiers; insert-only semantics prevent replacement by ID.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return c.json({ error: { code:"INVALID_ID", message:"شناسه نامعتبر است" } }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code:"VALIDATION_ERROR", message:"اطلاعات ترجیحات معتبر نیست", details:parsed.error.flatten() } }, 400);
  const p = parsed.data;
  const saved = await c.env.DB.prepare(`INSERT INTO user_preferences(id,budget_min,budget_max,property_types,transaction_type,city,neighborhoods,min_bedrooms,min_area_m2,max_commute_minutes,must_have,avoid,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING`)
    .bind(id,p.budgetMin ?? null,p.budgetMax ?? null,JSON.stringify(p.propertyTypes),p.transactionType,p.city ?? null,JSON.stringify(p.neighborhoods),p.minBedrooms ?? null,p.minAreaM2 ?? null,p.maxCommuteMinutes ?? null,JSON.stringify(p.mustHave),JSON.stringify(p.avoid)).run();
  if (saved.meta.changes === 0) return c.json({ error: { code:"PREFERENCE_ID_ALREADY_USED", message:"این شناسه قبلاً استفاده شده است؛ جست‌وجوی تازه‌ای آغاز کنید" } }, 409);
  return c.json({ id, preferences:p });
});

app.get("/api/listings", async c => {
  const parsed = searchSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error:{code:"VALIDATION_ERROR",message:"فیلترهای جست‌وجو معتبر نیست",details:parsed.error.flatten()} },400);
  const p = parsed.data;
  const where = ["status='active'"], values: (string|number)[] = [];
  if (p.city) { where.push("city = ? COLLATE NOCASE"); values.push(p.city); }
  if (p.transactionType) { where.push("transaction_type = ?"); values.push(p.transactionType); }
  if (p.propertyType) { where.push("property_type = ? COLLATE NOCASE"); values.push(p.propertyType); }
  if (p.minPrice !== undefined) { where.push("price >= ?"); values.push(p.minPrice); }
  if (p.maxPrice !== undefined) { where.push("price <= ?"); values.push(p.maxPrice); }
  if (p.minAreaM2 !== undefined) { where.push("area_m2 >= ?"); values.push(p.minAreaM2); }
  if (p.minBedrooms !== undefined) { where.push("bedrooms >= ?"); values.push(p.minBedrooms); }
  if (p.q) { where.push("(title LIKE ? ESCAPE char(92) OR description LIKE ? ESCAPE char(92) OR neighborhood LIKE ? ESCAPE char(92))"); const q = `%${p.q.replace(/[\\%_]/g, "\\$&")}%`; values.push(q,q,q); }
  const result = await c.env.DB.prepare(`SELECT * FROM listings WHERE ${where.join(" AND ")} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`).bind(...values,p.limit,p.offset).all<Record<string,unknown>>();
  const maxAge = Math.max(1, Number(c.env.MAX_LISTING_AGE_DAYS) || 90);
  const listings = result.results.filter(r => isFresh(String(r.last_seen_at),maxAge)).map(r => ({
    id:String(r.id), source:String(r.source), sourceUrl:r.source_url == null ? undefined : String(r.source_url),
    title:String(r.title), description:String(r.description), city:String(r.city),
    neighborhood:r.neighborhood == null ? undefined : String(r.neighborhood), propertyType:String(r.property_type),
    transactionType:String(r.transaction_type), price:Number(r.price), areaM2:r.area_m2 == null ? undefined : Number(r.area_m2),
    bedrooms:r.bedrooms == null ? undefined : Number(r.bedrooms), bathrooms:r.bathrooms == null ? undefined : Number(r.bathrooms),
    features:JSON.parse(String(r.features)) as string[], publishedAt:r.published_at == null ? undefined : String(r.published_at),
    last_seen_at:String(r.last_seen_at), freshnessScore:freshnessScore(String(r.last_seen_at)),
  }));
  return c.json({ items:listings, limit:p.limit, offset:p.offset, count:listings.length });
});

app.post("/api/recommendations/:preferenceId", async c => {
  const row = await c.env.DB.prepare("SELECT * FROM user_preferences WHERE id=?").bind(c.req.param("preferenceId")).first<Record<string,unknown>>();
  if (!row) return c.json({ error:{code:"PREFERENCES_NOT_FOUND",message:"ابتدا ترجیحات را ثبت کنید"} },404);
  const prefs = { budgetMin: row.budget_min == null ? undefined : Number(row.budget_min), budgetMax: row.budget_max == null ? undefined : Number(row.budget_max), propertyTypes:JSON.parse(String(row.property_types)) as string[], transactionType:row.transaction_type as "buy"|"rent", city:row.city == null ? undefined : String(row.city), neighborhoods:JSON.parse(String(row.neighborhoods)) as string[], minBedrooms:row.min_bedrooms == null ? undefined : Number(row.min_bedrooms), minAreaM2:row.min_area_m2 == null ? undefined : Number(row.min_area_m2), maxCommuteMinutes:row.max_commute_minutes == null ? undefined : Number(row.max_commute_minutes), mustHave:JSON.parse(String(row.must_have)) as string[], avoid:JSON.parse(String(row.avoid)) as string[] };
  const result = await c.env.DB.prepare("SELECT * FROM listings WHERE status='active' AND transaction_type=? ORDER BY last_seen_at DESC LIMIT 500").bind(prefs.transactionType).all<Record<string,unknown>>();
  const maxAge = Math.max(1, Number(c.env.MAX_LISTING_AGE_DAYS) || 90);
  const items = result.results.filter(r => isFresh(String(r.last_seen_at),maxAge)).map(r => ({
    row: r,
    listing: { id:String(r.id), source:String(r.source), sourceUrl:r.source_url == null ? undefined : String(r.source_url), title:String(r.title), description:String(r.description), city:String(r.city), neighborhood:r.neighborhood == null ? undefined : String(r.neighborhood), propertyType:String(r.property_type), transactionType:String(r.transaction_type) as "buy"|"rent", price:Number(r.price), areaM2:r.area_m2 == null ? undefined : Number(r.area_m2), bedrooms:r.bedrooms == null ? undefined : Number(r.bedrooms), bathrooms:r.bathrooms == null ? undefined : Number(r.bathrooms), features:JSON.parse(String(r.features)) as string[], publishedAt:r.published_at == null ? undefined : String(r.published_at), last_seen_at:String(r.last_seen_at) },
  })).filter(({ listing }) => isEligibleListing(listing,prefs)).map(({ row, listing }) => ({
    ...scoreListing(listing,prefs), freshness:freshnessScore(String(row.last_seen_at)),
  })).sort((a,b) => b.score - a.score || b.freshness - a.freshness).slice(0,50);
  return c.json({ preferenceId:c.req.param("preferenceId"), scoring:{ version:1, weights:"Configured by available preferences; score normalized to 0-100" }, items });
});

app.post("/api/ingest/manual", async c => {
  if (!c.env.ADMIN_INGEST_TOKEN || c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_INGEST_TOKEN}`) return c.json({error:{code:"UNAUTHORIZED",message:"اجازه دسترسی ندارید"}},401);
  const contentLength = Number(c.req.header("Content-Length") ?? 0);
  if (contentLength > 1_048_576) return c.json({error:{code:"PAYLOAD_TOO_LARGE",message:"حجم درخواست بیشتر از حد مجاز است"}},413);
  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) return c.json({error:{code:"PAYLOAD_TOO_LARGE",message:"حجم درخواست بیشتر از حد مجاز است"}},413);
  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* handled by validation response below */ }
  if (!body || typeof body !== "object" || !("listings" in body) || !Array.isArray(body.listings)) return c.json({error:{code:"VALIDATION_ERROR",message:"فیلد listings باید آرایه باشد"}},400);
  if (body.listings.length > 100) return c.json({error:{code:"VALIDATION_ERROR",message:"حداکثر ۱۰۰ آگهی در هر درخواست مجاز است"}},400);
  try { return c.json(await importListings(c.env,"manual",body.listings)); }
  catch { return c.json({error:{code:"INGEST_FAILED",message:"ورود آگهی‌ها انجام نشد؛ وضعیت پایگاه داده را بررسی کنید"}},500); }
});

app.post("/api/ingest/demo", async c => {
  if (!c.env.ADMIN_INGEST_TOKEN || c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_INGEST_TOKEN}`) return c.json({error:{code:"UNAUTHORIZED",message:"اجازه دسترسی ندارید"}},401);
  return c.json(await importListings(c.env,"demo",demoListings));
});

export default app;
