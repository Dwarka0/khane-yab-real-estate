import { describe, expect, it } from "vitest";
import { resolvePages, searchLive, type SourcePageRow } from "../src/liveSearch";
import { FakeDatabase, fakeEnv } from "./fakeD1";

const page = (overrides: Partial<SourcePageRow>): SourcePageRow => ({
  id: "p1", source_id: "src-collector", url: "https://www.sheypoor.com/s/tehran/houses-apartments-for-sale",
  label: "تهران", transaction_type: "buy", category_filter: null, enabled: 1,
  follow_detail: 0, detail_limit: 0, city: "تهران", property_type: "apartment", ...overrides,
});

const ITEM = {
  type: "special", id: "1",
  attributes: {
    title: "آپارتمان ۹۰ متری", url: "https://www.sheypoor.com/v/a-1.html",
    price: [{ amount: "5,000,000,000", currency: "تومان" }], location: "تهران، ونک",
  },
  fullAttributes: [{ key: "متراژ", value: "90" }, { key: "تعداد اتاق", value: "2" }],
};
const flightPayload = `5:["$L1",null,{"state":{"queries":[{"state":{"data":{"pages":[{"data":[${JSON.stringify(ITEM)}]}]}}}]}}]`;
const escapedPayload = flightPayload.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const PAGE_HTML = `<!doctype html><html><head></head><body>
<script>self.__next_f.push([1,"${escapedPayload}"])</script>
</body></html>`;

describe("page resolution", () => {
  const pages = [
    page({ id: "tehran-sale", city: "تهران", transaction_type: "buy" }),
    page({ id: "tehran-rent", city: "تهران", transaction_type: "rent" }),
    page({ id: "karaj-sale", city: "کرج", transaction_type: "buy" }),
    page({ id: "villa", city: "تهران", transaction_type: "buy", property_type: "villa" }),
  ];

  it("picks the pages of the city and the transaction type of the search", () => {
    const resolved = resolvePages(pages, { transactionType: "buy", city: "تهران" });
    expect(resolved.map((p) => p.id)).toEqual(["tehran-sale", "villa"]);
  });

  it("falls back to the transaction type when the city has no page", () => {
    const resolved = resolvePages(pages, { transactionType: "buy", city: "یزد" });
    expect(resolved.map((p) => p.id)).toEqual(["tehran-sale", "karaj-sale", "villa"]);
  });

  it("keeps the property type when the search asks for one", () => {
    const resolved = resolvePages(pages, { transactionType: "buy", city: "تهران", propertyTypes: ["villa"] });
    expect(resolved.map((p) => p.id)).toEqual(["villa"]);
  });
});

describe("live search", () => {
  it("reads the source page, returns the matches, and keeps them only in the cache", async () => {
    const db = new FakeDatabase({
      sources: [{ id: "src-collector", name: "collector", kind: "authorized_adapter", base_url: null, allowed_host: "divar.ir,sheypoor.com", enabled: 1, permission_status: "approved", permission_reviewed_at: null, permission_notes: null }],
    });
    await db.prepare("INSERT INTO source_pages(id, source_id, url, label, transaction_type, category_filter, enabled, follow_detail, detail_limit, city, property_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind("p1", "src-collector", "https://www.sheypoor.com/s/tehran/houses-apartments-for-sale", "تهران", "buy", null, 1, 0, 0, "تهران", "apartment").run();
    const env = fakeEnv(db);

    let requests = 0;
    const fetchImpl = async () => { requests++; return new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } }); };

    const result = await searchLive(env, { transactionType: "buy", city: "تهران", budgetMax: 9_000_000_000, minAreaM2: 50, minBedrooms: 1 }, { fetchImpl });
    expect(requests).toBe(1);
    expect(result.total).toBe(1);
    expect(result.items[0]!.listing.price).toBe(5_000_000_000);
    expect(result.items[0]!.listing.areaM2).toBe(90);
    expect(result.items[0]!.listing.bedrooms).toBe(2);
    expect(result.items[0]!.reasons.length).toBeGreaterThan(0);
    // The listing lives in the cache with an expiry, not for ever.
    expect(db.listings).toHaveLength(1);
    expect(String(db.listings[0]!.expires_at ?? "")).not.toBe("");
    expect(db.pageCache).toHaveLength(1);
  });

  it("answers a repeated search from the cache without asking the source again", async () => {
    const db = new FakeDatabase({
      sources: [{ id: "src-collector", name: "collector", kind: "authorized_adapter", base_url: null, allowed_host: "divar.ir,sheypoor.com", enabled: 1, permission_status: "approved", permission_reviewed_at: null, permission_notes: null }],
    });
    await db.prepare("INSERT INTO source_pages(id, source_id, url, label, transaction_type, category_filter, enabled, follow_detail, detail_limit, city, property_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind("p1", "src-collector", "https://www.sheypoor.com/s/tehran/houses-apartments-for-sale", "تهران", "buy", null, 1, 0, 0, "تهران", "apartment").run();
    const env = fakeEnv(db);

    let requests = 0;
    const fetchImpl = async () => { requests++; return new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } }); };

    await searchLive(env, { transactionType: "buy", city: "تهران" }, { fetchImpl });
    expect(requests).toBe(1);

    const second = await searchLive(env, { transactionType: "buy", city: "تهران" }, { fetchImpl });
    expect(requests).toBe(1);
    expect(second.pages[0]!.cached).toBe(true);
    expect(second.total).toBe(1);
  });
});
