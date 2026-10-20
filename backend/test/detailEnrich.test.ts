import { describe, expect, it } from "vitest";
import { enrichPagesInBackground } from "../src/liveSearch";
import { FakeDatabase, fakeEnv } from "./fakeD1";

const SOURCE = { id: "src-collector", name: "collector", kind: "authorized_adapter", base_url: null, allowed_host: "divar.ir,sheypoor.com", enabled: 1, permission_status: "approved", permission_reviewed_at: null, permission_notes: null };

const DETAIL_WITH_PRICE = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
  "@type": "Product",
  web_info: { title: "آپارتمان ۱۰۰ متری", city_persian: "تهران", district_persian: "سعادت‌آباد" },
  offers: { price: "29000000000", priceCurrency: "IRR" },
  description: "آپارتمان ۱۰۰ متری با ۲ اتاق",
})}</script></head><body>آپارتمان ۱۰۰ متری</body></html>`;

const DETAIL_WITHOUT_PRICE = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
  "@type": "Product",
  web_info: { title: "آپارتمان ۱۰۰ متری", city_persian: "تهران" },
  description: "قیمت توافقی",
})}</script></head><body>آپارتمان ۱۰۰ متری</body></html>`;

async function seed() {
  const db = new FakeDatabase({ sources: [SOURCE] });
  await db.prepare("INSERT INTO source_pages(id, source_id, url, label, transaction_type, category_filter, enabled, follow_detail, detail_limit, city, property_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind("p1", "src-collector", "https://divar.ir/s/tehran/buy-apartment", "تهران", "buy", null, 1, 1, 2, "تهران", "apartment").run();
  await db.prepare(
    `INSERT INTO listings(id, source, source_listing_id, source_url, title, city, property_type, transaction_type, price, features, expires_at, page_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    "l1", "divar.ir", "gaX3ZiDK", "https://divar.ir/v/test-listing/gaX3ZiDK", "آپارتمان ۱۰۰ متری", "تهران",
    "apartment", "buy", 0, "[]", new Date(Date.now() + 3600_000).toISOString(), "p1",
  ).run();
  return { db, env: fakeEnv(db) };
}

describe("background price enrichment", () => {
  it("stores the price of each listing as soon as it is read", async () => {
    const { db, env } = await seed();
    let requests = 0;
    const fetchImpl = async () => { requests++; return new Response(DETAIL_WITH_PRICE, { status: 200, headers: { "content-type": "text/html" } }); };

    await enrichPagesInBackground(env, ["p1"], { fetchImpl, limitPerPage: 2, delayMs: 0 });

    expect(requests).toBe(1);
    const listing = db.listings.find((row) => row.id === "l1")!;
    expect(Number(listing.price)).toBe(29_000_000_000);
    // The row still expires: the server keeps no listing permanently.
    expect(String(listing.expires_at ?? "")).not.toBe("");
  });

  it("leaves the price unknown when the listing page states none", async () => {
    const { db, env } = await seed();
    const fetchImpl = async () => new Response(DETAIL_WITHOUT_PRICE, { status: 200, headers: { "content-type": "text/html" } });

    await enrichPagesInBackground(env, ["p1"], { fetchImpl, limitPerPage: 2, delayMs: 0 });

    const listing = db.listings.find((row) => row.id === "l1")!;
    expect(Number(listing.price)).toBe(0);
  });
});
