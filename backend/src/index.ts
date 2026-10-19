import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { preferencesSchema, searchSchema } from "./validation";
import { rateLimit } from "./rateLimit";
import { demoListings, importListings } from "./ingestion";
import { isEligibleListing, scoreListing } from "./scoring";
import { freshnessScore, isFresh } from "./listings";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors({
  origin: (origin, c) => {
    const allowed = (c.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4173").split(",").map((value: string) => value.trim()).filter(Boolean);
    return allowed.includes(origin) ? origin : "";
  },
  allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));
app.use("/api/*", rateLimit);

app.onError((error, c) => {
  console.error("api_error", { path: c.req.path, message: error.message });
  return c.json({ error: { code: "INTERNAL_ERROR", message: "درخواست با خطا مواجه شد" } }, 500);
});

app.get("/health", c => c.json({ status: "ok", service: "real-estate-platform-api" }));

app.put("/api/preferences/:id", async c => {
  const id = c.req.param("id").trim();
  if (!/^[\w-]{1,80}$/.test(id)) return c.json({ error: { code:"INVALID_ID", message:"شناسه نامعتبر است" } }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code:"VALIDATION_ERROR", message:"اطلاعات ترجیحات معتبر نیست", details:parsed.error.flatten() } }, 400);
  const p = parsed.data;
  await c.env.DB.prepare(`INSERT INTO user_preferences(id,budget_min,budget_max,property_types,transaction_type,city,neighborhoods,min_bedrooms,min_area_m2,max_commute_minutes,must_have,avoid,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET budget_min=excluded.budget_min,budget_max=excluded.budget_max,property_types=excluded.property_types,transaction_type=excluded.transaction_type,city=excluded.city,neighborhoods=excluded.neighborhoods,min_bedrooms=excluded.min_bedrooms,min_area_m2=excluded.min_area_m2,max_commute_minutes=excluded.max_commute_minutes,must_have=excluded.must_have,avoid=excluded.avoid,updated_at=CURRENT_TIMESTAMP`)
    .bind(id,p.budgetMin ?? null,p.budgetMax ?? null,JSON.stringify(p.propertyTypes),p.transactionType,p.city ?? null,JSON.stringify(p.neighborhoods),p.minBedrooms ?? null,p.minAreaM2 ?? null,p.maxCommuteMinutes ?? null,JSON.stringify(p.mustHave),JSON.stringify(p.avoid)).run();
  return c.json({ id, preferences:p });
});

app.get("/api/preferences/:id", async c => {
  const row = await c.env.DB.prepare("SELECT * FROM user_preferences WHERE id=?").bind(c.req.param("id")).first<Record<string, unknown>>();
  if (!row) return c.json({ error:{code:"NOT_FOUND",message:"ترجیحات پیدا نشد"} },404);
  return c.json({ id:row.id, budgetMin:row.budget_min, budgetMax:row.budget_max, propertyTypes:JSON.parse(String(row.property_types)), transactionType:row.transaction_type, city:row.city, neighborhoods:JSON.parse(String(row.neighborhoods)), minBedrooms:row.min_bedrooms, minAreaM2:row.min_area_m2, maxCommuteMinutes:row.max_commute_minutes, mustHave:JSON.parse(String(row.must_have)), avoid:JSON.parse(String(row.avoid)) });
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
  if (p.q) { where.push("(title LIKE ? OR description LIKE ? OR neighborhood LIKE ?)"); const q = `%${p.q.replace(/[\\%_]/g, "\\$&")}%`; values.push(q,q,q); }
  const result = await c.env.DB.prepare(`SELECT * FROM listings WHERE ${where.join(" AND ")} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`).bind(...values,p.limit,p.offset).all<Record<string,unknown>>();
  const maxAge = Math.max(1, Number(c.env.MAX_LISTING_AGE_DAYS) || 90);
  const listings = result.results.filter(r => isFresh(String(r.last_seen_at),maxAge)).map(r => ({ ...r, features:JSON.parse(String(r.features)), freshnessScore:freshnessScore(String(r.last_seen_at)) }));
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
    listing: { ...r, source:String(r.source), sourceListingId:r.source_listing_id == null ? undefined : String(r.source_listing_id), sourceUrl:r.source_url == null ? undefined : String(r.source_url), title:String(r.title), description:String(r.description), city:String(r.city), neighborhood:r.neighborhood == null ? undefined : String(r.neighborhood), propertyType:String(r.property_type), transactionType:String(r.transaction_type) as "buy"|"rent", price:Number(r.price), areaM2:r.area_m2 == null ? undefined : Number(r.area_m2), bedrooms:r.bedrooms == null ? undefined : Number(r.bedrooms), features:JSON.parse(String(r.features)) as string[] },
  })).filter(({ listing }) => isEligibleListing(listing,prefs)).map(({ row, listing }) => ({
    ...scoreListing(listing,prefs), freshness:freshnessScore(String(row.last_seen_at)),
  })).sort((a,b) => b.score - a.score || b.freshness - a.freshness).slice(0,50);
  return c.json({ preferenceId:c.req.param("preferenceId"), scoring:{ version:1, weights:"Configured by available preferences; score normalized to 0-100" }, items });
});

app.post("/api/ingest/manual", async c => {
  if (!c.env.ADMIN_INGEST_TOKEN || c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_INGEST_TOKEN}`) return c.json({error:{code:"UNAUTHORIZED",message:"اجازه دسترسی ندارید"}},401);
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.listings)) return c.json({error:{code:"VALIDATION_ERROR",message:"فیلد listings باید آرایه باشد"}},400);
  try { return c.json(await importListings(c.env,"manual",body.listings)); }
  catch (error) { return c.json({error:{code:"INGEST_FAILED",message:error instanceof Error ? error.message : "Import failed"}},400); }
});

app.post("/api/ingest/demo", async c => {
  if (!c.env.ADMIN_INGEST_TOKEN || c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_INGEST_TOKEN}`) return c.json({error:{code:"UNAUTHORIZED",message:"اجازه دسترسی ندارید"}},401);
  return c.json(await importListings(c.env,"demo",demoListings));
});

export default app;
