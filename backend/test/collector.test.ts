import { describe, expect, it } from "vitest";
import { extractCollectedItems, extractFlightItems, extractJsonLdProducts, parseAmount } from "../src/collector";
import { matchesCategoryFilter, runCollection } from "../src/collectorRun";
import { toListingInput, type SourcePageRow } from "../src/liveSearch";
import { FakeDatabase, fakeEnv } from "./fakeD1";

/** A page shaped like the Divar category page: a JSON-LD array of products. */
const DIVAR_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify([
  {
    "@type": "Product", name: "آپارتمان ۹۵ متری خیابان ولیعصر",
    url: "https://divar.ir/v/apartment-95-metre-123456789",
    image: "https://s100.divarcdn.com/x.jpg",
    category: "املاک",
    offers: { "@type": "Offer", price: "7500000000", priceCurrency: "IRR" },
    web_info: { title: "آپارتمان ۹۵ متری", city_persian: "تهران", district_persian: "ولیعصر", category_slug_persian: "آپارتمان" },
  },
  {
    "@type": "Product", name: "کفش مردانه",
    url: "https://divar.ir/v/shoes-987654321",
    category: "پوشاک",
    offers: { "@type": "Offer", price: "1200000", priceCurrency: "IRR" },
    web_info: { title: "کفش مردانه", city_persian: "تهران", district_persian: "بازار", category_slug_persian: "کفش، کفش مردانه" },
  },
])}</script></head><body></body></html>`;

/** A page shaped like the Sheypoor category page: a flight payload with items. */
const SHEYPOOR_ITEM = {
  type: "special", id: "468409496",
  attributes: {
    title: "فروش آپارتمان ۹۳ متر در جنت آباد مرکزی",
    url: "https://www.sheypoor.com/v/forush-aparteman-468409496.html",
    timePassedLabel: "ساعاتی پیش",
    price: [{ label: "", amount: "32,000,000,000", currency: "تومان" }],
    location: "تهران، جنت آباد مرکزی",
  },
  fullAttributes: [
    { id: "1", key: "نوع ملک", value: "آپارتمان" },
    { id: "2", key: "متراژ", value: "93" },
    { id: "3", key: "تعداد اتاق", value: "2" },
    { id: "4", key: "پارکینگ", value: "دارد" },
    { id: "5", key: "آسانسور", value: "دارد" },
  ],
};

const flightPayload = `5:["$L1",null,{"state":{"queries":[{"state":{"data":{"pages":[{"data":[${JSON.stringify(SHEYPOOR_ITEM)}]}]}}}]}}]`;
const escapedPayload = flightPayload.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const SHEYPOOR_PAGE = `<!doctype html><html><head></head><body>
<script>self.__next_f.push([1,"${escapedPayload}"])</script>
</body></html>`;

describe("category page extraction", () => {
  it("reads the product list of a Divar style page", () => {
    const items = extractJsonLdProducts(DIVAR_PAGE);
    expect(items).toHaveLength(2);
    const apartment = items[0]!;
    expect(apartment.title).toContain("آپارتمان");
    expect(apartment.price).toBe(7_500_000_000);
    expect(apartment.city).toBe("تهران");
    expect(apartment.neighborhood).toBe("ولیعصر");
    expect(apartment.category).toBe("آپارتمان");
    expect(apartment.propertyType).toBe("apartment");
    expect(apartment.sourceListingId).toBe("123456789");
  });

  it("reads the item objects of a Sheypoor style page", () => {
    const items = extractFlightItems(SHEYPOOR_PAGE);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.title).toContain("آپارتمان");
    expect(item.price).toBe(32_000_000_000);
    expect(item.areaM2).toBe(93);
    expect(item.bedrooms).toBe(2);
    expect(item.city).toBe("تهران");
    expect(item.neighborhood).toContain("جنت آباد");
    expect(item.features).toEqual(["parking", "elevator"]);
    expect(item.transactionType).toBe("buy");
  });

  it("keeps only the categories a page is configured for", () => {
    expect(matchesCategoryFilter("آپارتمان", "آپارتمان,خانه")).toBe(true);
    expect(matchesCategoryFilter("کفش، کفش مردانه", "آپارتمان,خانه")).toBe(false);
    expect(matchesCategoryFilter("کفش", null)).toBe(true);
  });

  it("parses Persian numbers in prices", () => {
    expect(parseAmount("32,000,000,000")).toBe(32_000_000_000);
    expect(parseAmount("۱۵۰٬۰۰۰٬۰۰۰")).toBe(150_000_000);
  });

  it("turns a collected item into a listing input", () => {
    const page: SourcePageRow = { id: "p", source_id: "s", url: "https://www.sheypoor.com/s/tehran/x", label: null, transaction_type: "buy", category_filter: null, enabled: 1, follow_detail: 0, detail_limit: 0, city: "تهران", property_type: "apartment" };
    const input = toListingInput({
      sourceListingId: "1", title: "آگهی", url: "https://www.sheypoor.com/v/a-1.html", price: 100, features: ["elevator"],
      city: "تهران", neighborhood: "ونک", propertyType: "apartment", transactionType: "buy",
    }, page);
    expect(input.source).toBe("sheypoor.com");
    expect(input.price).toBe(100);
    expect(input.salePrice).toBe(100);
    expect(input.city).toBe("تهران");
  });
});

describe("collection run", () => {
  it("reads the configured pages and stores the listings with provenance", async () => {
    const db = new FakeDatabase({
      sources: [{ id: "src-collector", name: "collector", kind: "authorized_adapter", base_url: null, allowed_host: "divar.ir,sheypoor.com", enabled: 1, permission_status: "approved", permission_reviewed_at: null, permission_notes: null }],
    });
    await db.prepare("INSERT INTO source_pages(id, source_id, url, label, transaction_type, category_filter, enabled) VALUES(?,?,?,?,?,?,?)")
      .bind("page-1", "src-collector", "https://www.sheypoor.com/s/tehran/x", "x", "buy", null, 1).run();

    const env = fakeEnv(db);
    const result = await runCollection(env, {
      fetchImpl: async () => new Response(SHEYPOOR_PAGE, { status: 200, headers: { "content-type": "text/html" } }),
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.status).toBe("ok");
    expect(result.inserted).toBe(1);
    expect(db.listings).toHaveLength(1);
    expect(db.listings[0]!.title).toContain("آپارتمان");
    expect(db.listings[0]!.area_m2).toBe(93);
    expect(db.listingObservations).toHaveLength(1);
    expect(db.ingestionRuns[0]!.status).toBe("completed");
  });

  it("refuses to collect when the source permission is missing", async () => {
    const db = new FakeDatabase({
      sources: [{ id: "src-collector", name: "collector", kind: "authorized_adapter", base_url: null, allowed_host: "divar.ir,sheypoor.com", enabled: 1, permission_status: "unreviewed", permission_reviewed_at: null, permission_notes: null }],
    });
    const env = fakeEnv(db);
    await expect(runCollection(env, { fetchImpl: async () => new Response(SHEYPOOR_PAGE) })).rejects.toThrow();
    expect(db.listings).toHaveLength(0);
  });
});
