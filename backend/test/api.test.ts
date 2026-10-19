import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { FakeDatabase, fakeEnv } from "./fakeD1";

const SALE_PAGE = `<!doctype html><html><head>
<meta property="og:title" content="فروش آپارتمان" />
<meta property="og:description" content="آپارتمان خوش ساخت" />
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Offer",
  url: "https://www.sheypoor.com/v/test-468409496.html", name: "فروش آپارتمان",
  description: "آپارتمان خوش ساخت", price: 8000000000, priceCurrency: "toman", category: "forSale",
  itemOffered: {
    "@type": "Apartment", floorSize: { "@type": "QuantitativeValue", value: 93, unitCode: "MTK" }, numberOfRooms: "2",
    address: { "@type": "PostalAddress", addressCountry: "IR", addressRegion: "قائم شهر", addressLocality: "خیابان ساری" },
    amenityFeature: [{ "@type": "LocationFeatureSpecification", name: "Parking", value: true }],
  },
})}</script></head><body></body></html>`;

const USER_LINK_SOURCE = {
  id: "src-user-link", name: "لینک ارسالی کاربر", kind: "user_link", base_url: null,
  allowed_host: "divar.ir,sheypoor.com", enabled: 1, permission_status: "approved",
  permission_reviewed_at: "2026-01-01 00:00:00", permission_notes: "test",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal("fetch", async (input: string) => handler(String(input)));
}

function htmlResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

describe("preference capability and recommendations", () => {
  it("creates a preference, then returns ranked recommendations for it", async () => {
    const db = new FakeDatabase({
      listings: [{
        id: "demo-001", source: "demo", source_listing_id: "demo-001", source_url: null,
        title: "آپارتمان دوخوابه نورگیر", description: "", city: "تهران", neighborhood: "صادقیه",
        property_type: "apartment", transaction_type: "buy", price: 6500000000, sale_price: 6500000000,
        monthly_rent: null, deposit: null, area_m2: 92, bedrooms: 2, bathrooms: 1, latitude: null, longitude: null,
        features: '["elevator","parking"]', published_at: null, first_seen_at: "2026-10-19 10:00:00",
        last_seen_at: "2026-10-19 10:00:00", content_hash: "hash-1", status: "active",
      }],
    });
    const env = fakeEnv(db);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const created = await app.request(`/api/preferences/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionType: "buy", city: "تهران", budgetMax: 9000000000, minAreaM2: 80, minBedrooms: 2, propertyTypes: ["apartment"], neighborhoods: [], mustHave: [], avoid: [] }),
    }, env);
    expect(created.status).toBe(200);

    const recommendations = await app.request(`/api/recommendations/${id}`, { method: "POST" }, env);
    expect(recommendations.status).toBe(200);
    const payload = await recommendations.json() as { items: { listing: { id: string }; score: number; reasons: string[] }[]; total: number; hasMore: boolean };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.listing.id).toBe("demo-001");
    expect(payload.items[0]!.score).toBeGreaterThan(0);
    expect(payload.items[0]!.reasons.length).toBeGreaterThan(0);
    expect(payload.total).toBe(1);
    expect(payload.hasMore).toBe(false);
  });

  it("rejects a non-UUIDv4 capability, refuses to overwrite a used one, and exposes no read route", async () => {
    const db = new FakeDatabase();
    const env = fakeEnv(db);
    expect((await app.request("/api/preferences/predictable-id", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" }, env)).status).toBe(400);

    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const create = () => app.request(`/api/preferences/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" }, env);
    expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(409);
    expect((await app.request(`/api/preferences/${id}`, {}, env)).status).toBe(404);
  });
});

describe("user-submitted listing link", () => {
  it("imports a listing page, stores the extracted facts, and keeps the source link", async () => {
    const db = new FakeDatabase({ sources: [USER_LINK_SOURCE] });
    const env = fakeEnv(db);
    stubFetch(() => htmlResponse(SALE_PAGE));

    const response = await app.request("/api/listings/import-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.sheypoor.com/v/test-468409496.html" }),
    }, env);

    expect(response.status).toBe(201);
    const payload = await response.json() as { listing: { id: string; price: number; salePrice?: number; areaM2?: number; bedrooms?: number; city: string; sourceUrl?: string; source: string }; created: boolean };
    expect(payload.created).toBe(true);
    expect(payload.listing.price).toBe(8000000000);
    expect(payload.listing.areaM2).toBe(93);
    expect(payload.listing.bedrooms).toBe(2);
    expect(payload.listing.city).toBe("قائم شهر");
    expect(payload.listing.sourceUrl).toBe("https://www.sheypoor.com/v/test-468409496.html");
    expect(db.listings).toHaveLength(1);
    expect(db.listingObservations).toHaveLength(1);
    expect(db.ingestionRuns[0]!.status).toBe("completed");
  });

  it("updates the same listing instead of creating a duplicate", async () => {
    const db = new FakeDatabase({ sources: [USER_LINK_SOURCE] });
    const env = fakeEnv(db);
    stubFetch(() => htmlResponse(SALE_PAGE));

    const first = await app.request("/api/listings/import-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.sheypoor.com/v/test-468409496.html" }),
    }, env);
    expect(first.status).toBe(201);

    const second = await app.request("/api/listings/import-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.sheypoor.com/v/test-468409496.html" }),
    }, env);
    expect(second.status).toBe(200);
    expect(db.listings).toHaveLength(1);
    expect(db.listingObservations).toHaveLength(1);
  });

  it("rejects hosts outside the allowlist and non-https schemes", async () => {
    const db = new FakeDatabase({ sources: [USER_LINK_SOURCE] });
    const env = fakeEnv(db);
    stubFetch(() => htmlResponse(SALE_PAGE));

    const foreign = await app.request("/api/listings/import-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/listing" }),
    }, env);
    expect(foreign.status).toBe(400);

    const insecure = await app.request("/api/listings/import-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://www.sheypoor.com/v/test.html" }),
    }, env);
    expect(insecure.status).toBe(400);
    expect(db.listings).toHaveLength(0);
  });

  it("blocks a redirect that leaves the allowed hosts", async () => {
    const db = new FakeDatabase({ sources: [USER_LINK_SOURCE] });
    const env = fakeEnv(db);
    stubFetch(() => new Response(null, { status: 302, headers: { location: "https://example.com/listing" } }));

    const response = await app.request("/api/listings/import-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.sheypoor.com/v/test-468409496.html" }),
    }, env);
    expect(response.status).toBe(502);
    expect(db.listings).toHaveLength(0);
  });

  it("fails closed when the source permission is missing", async () => {
    const db = new FakeDatabase({ sources: [{ ...USER_LINK_SOURCE, permission_status: "unreviewed" }] });
    const env = fakeEnv(db);
    stubFetch(() => htmlResponse(SALE_PAGE));

    const response = await app.request("/api/listings/import-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.sheypoor.com/v/test-468409496.html" }),
    }, env);
    expect(response.status).toBe(403);
    expect(db.listings).toHaveLength(0);
  });
});

describe("stale records, request ids, and listing removal", () => {
  const staleListing = {
    id: "stale-001", source: "demo", source_listing_id: "stale-001", source_url: null,
    title: "آپارتمان قدیمی", description: "", city: "تهران", neighborhood: "نارمک",
    property_type: "apartment", transaction_type: "buy", price: 5000000000, sale_price: 5000000000,
    monthly_rent: null, deposit: null, area_m2: 80, bedrooms: 2, bathrooms: 1, latitude: null, longitude: null,
    features: "[]", published_at: null, first_seen_at: "2020-01-01 00:00:00",
    last_seen_at: "2020-01-01 00:00:00", content_hash: "hash-stale", status: "active",
  };

  it("returns a stale listing but marks it, and explains it in the reasons", async () => {
    const db = new FakeDatabase({ listings: [staleListing] });
    const env = fakeEnv(db, { MAX_LISTING_AGE_DAYS: "90" });
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await app.request(`/api/preferences/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionType: "buy", city: "تهران", budgetMax: 9000000000, minAreaM2: 60, minBedrooms: 1, propertyTypes: ["apartment"], neighborhoods: [], mustHave: [], avoid: [] }),
    }, env);

    const recommendations = await app.request(`/api/recommendations/${id}`, { method: "POST" }, env);
    const payload = await recommendations.json() as { items: { reasons: string[]; reasonLabels: string[]; listing: { stale: boolean } }[] };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.listing.stale).toBe(true);
    expect(payload.items[0]!.reasons).toContain("STALE_LISTING");
    expect(payload.items[0]!.reasonLabels.length).toBe(payload.items[0]!.reasons.length);
  });

  it("reports the stale count in the listing response", async () => {
    const db = new FakeDatabase({ listings: [staleListing] });
    const env = fakeEnv(db);
    const response = await app.request("/api/listings", {}, env);
    const payload = await response.json() as { items: { stale: boolean }[]; staleCount: number };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.stale).toBe(true);
    expect(payload.staleCount).toBe(1);
  });

  it("returns stable reason codes with a readable label for each", async () => {
    const db = new FakeDatabase({ listings: [{
      id: "fresh-001", source: "demo", source_listing_id: "fresh-001", source_url: null,
      title: "آپارتمان", description: "", city: "تهران", neighborhood: "صادقیه",
      property_type: "apartment", transaction_type: "buy", price: 5000000000, sale_price: 5000000000,
      monthly_rent: null, deposit: null, area_m2: 90, bedrooms: 2, bathrooms: 1, latitude: null, longitude: null,
      features: '["parking"]', published_at: null, first_seen_at: "2099-01-01 00:00:00",
      last_seen_at: "2099-01-01 00:00:00", content_hash: "hash-fresh", status: "active",
    }] });
    const env = fakeEnv(db);
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await app.request(`/api/preferences/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionType: "buy", city: "تهران", budgetMax: 9000000000, minAreaM2: 60, minBedrooms: 1, propertyTypes: ["apartment"], neighborhoods: [], mustHave: ["parking"], avoid: [] }),
    }, env);

    const response = await app.request(`/api/recommendations/${id}`, { method: "POST" }, env);
    const payload = await response.json() as { items: { reasons: string[]; reasonLabels: string[] }[] };
    const reasons = payload.items[0]!.reasons;
    expect(reasons).toContain("TRANSACTION_MATCH");
    expect(reasons).toContain("LOCATION_MATCH");
    expect(reasons).toContain("WITHIN_BUDGET");
    expect(reasons).toContain("AREA_MATCH");
    expect(reasons).toContain("ROOMS_MATCH");
    expect(reasons).toContain("FEATURES_MATCH");
    expect(reasons).not.toContain("MISSING_KEY_FIELDS");
    expect(payload.items[0]!.reasonLabels.every((label) => label.length > 0)).toBe(true);
  });

  it("adds a request id to every response and to the error envelope", async () => {
    const db = new FakeDatabase();
    const env = fakeEnv(db);
    const response = await app.request("/api/listings?limit=9999", {}, env);
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    const payload = await response.json() as { error: { code: string; requestId: string } };
    expect(payload.error.requestId).toBeTruthy();
    expect(payload.error.requestId).toBe(response.headers.get("X-Request-Id"));
  });

  it("withdraws a listing by default and purges it on request", async () => {
    const db = new FakeDatabase({ listings: [{
      id: "l-1", source: "demo", source_listing_id: "l-1", source_url: null, title: "آگهی", description: "",
      city: "تهران", neighborhood: null, property_type: "apartment", transaction_type: "buy", price: 1, sale_price: 1,
      monthly_rent: null, deposit: null, area_m2: null, bedrooms: null, bathrooms: null, latitude: null, longitude: null,
      features: "[]", published_at: null, first_seen_at: "2026-10-19 00:00:00", last_seen_at: "2026-10-19 00:00:00",
      content_hash: "hash-1", status: "active",
    }] });
    const env = fakeEnv(db, { ADMIN_INGEST_TOKEN: "secret-token" });

    expect((await app.request("/api/listings/l-1", { method: "DELETE" }, env)).status).toBe(401);

    const withdraw = await app.request("/api/listings/l-1", {
      method: "DELETE", headers: { "Content-Type": "application/json", Authorization: "Bearer secret-token" },
      body: JSON.stringify({ reason: "owner withdrew the listing" }),
    }, env);
    expect(withdraw.status).toBe(200);
    expect(db.listings[0]!.status).toBe("removed");

    const purge = await app.request("/api/listings/l-1?purge=true", {
      method: "DELETE", headers: { "Content-Type": "application/json", Authorization: "Bearer secret-token" },
      body: JSON.stringify({ reason: "retention policy" }),
    }, env);
    expect(purge.status).toBe(200);
    expect(db.listings).toHaveLength(0);
  });
});

describe("operator run review and maintenance", () => {  it("protects the run review routes and shows row-level diagnostics", async () => {
    const db = new FakeDatabase({ sources: [USER_LINK_SOURCE, {
      id: "src-manual", name: "ورود دستی اپراتور", kind: "manual", base_url: null, allowed_host: null,
      enabled: 1, permission_status: "approved", permission_reviewed_at: "2026-01-01 00:00:00", permission_notes: "test",
    }] });
    const env = fakeEnv(db, { ADMIN_INGEST_TOKEN: "secret-token" });

    expect((await app.request("/api/ingest/runs", {}, env)).status).toBe(401);

    const importResponse = await app.request("/api/ingest/manual", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer secret-token" },
      body: JSON.stringify({ listings: [
        { source: "manual", title: "Valid", city: "Tehran", propertyType: "apartment", transactionType: "buy", price: 100, features: [] },
        { source: "manual", title: "Broken", city: "Tehran", propertyType: "apartment", transactionType: "buy", price: -1, features: [] },
      ] }),
    }, env);
    expect(importResponse.status).toBe(200);
    const imported = await importResponse.json() as { runId: string; inserted: number; skipped: number; errors: number };
    expect(imported.inserted).toBe(1);
    expect(imported.skipped).toBe(1);

    const runs = await app.request("/api/ingest/runs", { headers: { Authorization: "Bearer secret-token" } }, env);
    expect(runs.status).toBe(200);
    const runsPayload = await runs.json() as { items: { id: string; status: string; skipped: number }[] };
    expect(runsPayload.items[0]!.id).toBe(imported.runId);
    expect(runsPayload.items[0]!.skipped).toBe(1);

    const detail = await app.request(`/api/ingest/runs/${imported.runId}`, { headers: { Authorization: "Bearer secret-token" } }, env);
    expect(detail.status).toBe(200);
    const detailPayload = await detail.json() as { errors: { rowNumber: number; code: string; message: string }[] };
    expect(detailPayload.errors).toHaveLength(1);
    expect(detailPayload.errors[0]!.rowNumber).toBe(2);
    expect(detailPayload.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("removes expired anonymous preferences", async () => {
    const db = new FakeDatabase({ sources: [USER_LINK_SOURCE], userPreferences: [
      { id: "old", expires_at: "2020-01-01T00:00:00.000Z" },
      { id: "fresh", expires_at: "2999-01-01T00:00:00.000Z" },
    ] });
    const env = fakeEnv(db, { ADMIN_INGEST_TOKEN: "secret-token" });

    const response = await app.request("/api/maintenance/cleanup", { method: "POST", headers: { Authorization: "Bearer secret-token" } }, env);
    expect(response.status).toBe(200);
    const payload = await response.json() as { deletedPreferences: number };
    expect(payload.deletedPreferences).toBe(1);
    expect(db.userPreferences.map((row) => row.id)).toEqual(["fresh"]);
  });

  it("lists only the approved and enabled sources", async () => {
    const db = new FakeDatabase({ sources: [
      USER_LINK_SOURCE,
      { id: "src-off", name: "خاموش", kind: "manual", enabled: 0, permission_status: "approved" },
      { id: "src-review", name: "بازبینی‌نشده", kind: "manual", enabled: 1, permission_status: "unreviewed" },
    ] });
    const env = fakeEnv(db);
    const response = await app.request("/api/sources", {}, env);
    expect(response.status).toBe(200);
    const payload = await response.json() as { items: { id: string }[] };
    expect(payload.items.map((item) => item.id)).toEqual(["src-user-link"]);
  });
});
