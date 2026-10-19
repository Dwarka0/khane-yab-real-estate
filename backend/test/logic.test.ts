import { describe, expect, it } from "vitest";
import { normalizeListing, isFresh, freshnessScore, hashListing } from "../src/listings";
import { isEligibleListing, scoreListing } from "../src/scoring";
import { listingSchema, preferencesSchema } from "../src/validation";
import { importListings } from "../src/ingestion";
import { rateLimit } from "../src/rateLimit";
import { extractListingFromHtml, parseNumber, parsePriceFromText } from "../src/pageExtract";
import { checkSourcePermission, isHostAllowed } from "../src/sources";
import { FakeDatabase, fakeEnv } from "./fakeD1";

const sample = { source:" Demo ", title:"  Bright   Apartment ", description:"", city:" تهران ", propertyType:"Apartment", transactionType:"buy" as const, price:100, areaM2:80, bedrooms:2, features:["Parking","parking"] };

describe("listing normalization and freshness", () => {
  it("normalizes whitespace and deduplicates features", () => {
    const normalized = normalizeListing(sample);
    expect(normalized.title).toBe("Bright Apartment");
    expect(normalized.features).toEqual(["parking"]);
    expect(normalized.source).toBe("demo");
  });
  it("creates stable content hashes and identifies stale listings", async () => {
    expect(await hashListing(sample)).toBe(await hashListing(normalizeListing(sample)));
    expect(isFresh(new Date(1_000).toISOString(), 1, 1_000)).toBe(true);
    expect(isFresh(new Date(0).toISOString(), 1, 3 * 86_400_000)).toBe(false);
    expect(freshnessScore(new Date(0).toISOString(), 45 * 86_400_000)).toBeCloseTo(0.5);
  });
});

describe("validation and explainable scoring", () => {
  it("rejects inverted budget ranges", () => {
    expect(preferencesSchema.safeParse({budgetMin:20,budgetMax:10}).success).toBe(false);
  });
  it("rejects unsafe or malformed listing input", () => {
    expect(listingSchema.safeParse({...sample,price:-1}).success).toBe(false);
    expect(listingSchema.safeParse({...sample,latitude:120}).success).toBe(false);
    expect(listingSchema.safeParse({...sample,sourceUrl:"http://example.com/listing"}).success).toBe(false);
    expect(listingSchema.safeParse({...sample,transactionType:"rent",monthlyRent:20,deposit:100}).success).toBe(true);
    expect(listingSchema.safeParse({...sample,transactionType:"rent",salePrice:100}).success).toBe(false);
    expect(listingSchema.safeParse({...sample,deposit:100}).success).toBe(false);
  });
  it("normalizes rent to monthly rent while preserving the separate deposit", () => {
    const rent = normalizeListing({ ...sample, transactionType:"rent", price:150, monthlyRent:90, deposit:500 });
    expect(rent.price).toBe(90);
    expect(rent.monthlyRent).toBe(90);
    expect(rent.deposit).toBe(500);
    expect(rent.salePrice).toBeUndefined();
  });
  it("includes rental deposit in the deduplication fingerprint", async () => {
    const first = { ...sample, transactionType:"rent" as const, price:90, monthlyRent:90, deposit:300 };
    const second = { ...first, deposit:400 };
    expect(await hashListing(first)).not.toBe(await hashListing(second));
  });
  it("explains matching preferences and produces bounded score", () => {
    const result = scoreListing({...sample,source:"demo",city:"Tehran",propertyType:"apartment",features:["parking"]}, {
      transactionType:"buy", propertyTypes:["apartment"], neighborhoods:[], mustHave:["parking"], avoid:[], city:"Tehran", budgetMin:50, budgetMax:200,
    });
    expect(result.score).toBe(100);
    expect(result.reasons.length).toBeGreaterThan(1);
  });

  it("applies every hard constraint before scoring and compares text case-insensitively", () => {
    const prefs = {
      transactionType:"buy" as const, city:"TEHRAN", budgetMin:80, budgetMax:150,
      propertyTypes:["APARTMENT"], neighborhoods:["SAADAT ABAD"], minBedrooms:2, minAreaM2:75,
      mustHave:["PARKING","ELEVATOR"], avoid:["auction"],
    };
    const eligible = { ...sample, city:"tehran", neighborhood:"Saadat Abad", propertyType:"Apartment", transactionType:"buy" as const,
      price:100, areaM2:80, bedrooms:2, title:"Bright home", description:"Well maintained", features:["parking","Elevator"] };

    expect(isEligibleListing(eligible, prefs)).toBe(true);
    const incompatible = [
      { label:"transaction type", listing:{ ...eligible, transactionType:"rent" as const } },
      { label:"specified city", listing:{ ...eligible, city:"Karaj" } },
      { label:"minimum budget", listing:{ ...eligible, price:79 } },
      { label:"maximum budget", listing:{ ...eligible, price:151 } },
      { label:"specified property type", listing:{ ...eligible, propertyType:"Villa" } },
      { label:"minimum bedrooms", listing:{ ...eligible, bedrooms:1 } },
      { label:"missing bedroom data", listing:{ ...eligible, bedrooms:undefined } },
      { label:"minimum area", listing:{ ...eligible, areaM2:74 } },
      { label:"missing area data", listing:{ ...eligible, areaM2:undefined } },
      { label:"specified neighborhood", listing:{ ...eligible, neighborhood:"Narmak" } },
      { label:"missing required feature", listing:{ ...eligible, features:["parking"] } },
      { label:"avoided term in title", listing:{ ...eligible, title:"AUCTION listing" } },
      { label:"avoided term in description", listing:{ ...eligible, description:"Auction only" } },
      { label:"avoided term in feature", listing:{ ...eligible, features:["parking","elevator","AUCTION"] } },
    ];

    for (const testCase of incompatible) {
      expect(isEligibleListing(testCase.listing, prefs), `${testCase.label} must be excluded`).toBe(false);
    }
  });

  it("keeps the existing scoring function and ranking order for eligible listings", () => {
    const prefs = { transactionType:"buy" as const, city:"Tehran", propertyTypes:[], neighborhoods:[], mustHave:[], avoid:[] };
    const first = { ...sample, city:"TEHRAN", transactionType:"buy" as const, features:["parking"] };
    const second = { ...sample, city:"Tehran", transactionType:"buy" as const, features:[] };
    const eligible = [first, second].filter(listing => isEligibleListing(listing,prefs));
    const ranked = eligible.map(listing => scoreListing(listing,prefs)).sort((a,b) => b.score-a.score);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.score).toBe(scoreListing(first,prefs).score);
    expect(ranked[1]!.score).toBe(scoreListing(second,prefs).score);
    expect(ranked[0]!.listing).toBe(first);
  });
});

describe("page extraction", () => {
  const saleOffer = {
    "@context":"https://schema.org","@type":"Offer",
    url:"https://www.sheypoor.com/v/test-468409496.html", name:"فروش آپارتمان",
    description:"آپارتمان خوش ساخت", price:8000000000, priceCurrency:"toman", category:"forSale",
    itemOffered:{ "@type":"Apartment", floorSize:{ "@type":"QuantitativeValue", value:93, unitCode:"MTK" }, numberOfRooms:"2",
      address:{ "@type":"PostalAddress", addressCountry:"IR", addressRegion:"قائم شهر", addressLocality:"خیابان ساری" },
      geo:{ "@type":"GeoCoordinates", longitude:52.8899, latitude:36.4769 },
      amenityFeature:[{ "@type":"LocationFeatureSpecification", name:"Parking", value:true }] },
  };
  const rentOffer = {
    "@context":"https://schema.org","@type":"Offer",
    url:"https://www.sheypoor.com/v/rent-468408820.html", name:"آپارتمان روشن دشت",
    description:"برای اجاره تماس بگیرید", price:15000000, priceCurrency:"toman", category:"rent",
    priceSpecification:{ "@type":"CompoundPriceSpecification", priceComponent:[
      { "@type":"UnitPriceSpecification", priceType:"Rent", price:15000000, unitText:"PerMonth" },
      { "@type":"UnitPriceSpecification", priceType:"Deposit", price:150000000, unitText:"OneTime" }] },
    itemOffered:{ "@type":"Apartment", floorSize:{ value:64 }, numberOfRooms:"1" },
  };

  it("reads a sale listing from schema.org structured data", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(saleOffer)}</script></head><body></body></html>`;
    const extracted = extractListingFromHtml(html, "https://www.sheypoor.com/v/test-468409496.html");
    expect(extracted).not.toBeNull();
    expect(extracted!.title).toBe("فروش آپارتمان");
    expect(extracted!.price).toBe(8000000000);
    expect(extracted!.transactionType).toBe("buy");
    expect(extracted!.areaM2).toBe(93);
    expect(extracted!.bedrooms).toBe(2);
    expect(extracted!.city).toBe("قائم شهر");
    expect(extracted!.features).toEqual(["parking"]);
    expect(extracted!.sourceListingId).toBe("468409496");
  });

  it("keeps the monthly rent and the deposit apart for rentals", () => {
    const html = `<script type="application/ld+json">${JSON.stringify(rentOffer)}</script>`;
    const extracted = extractListingFromHtml(html, "https://www.sheypoor.com/v/rent-468408820.html");
    expect(extracted!.transactionType).toBe("rent");
    expect(extracted!.monthlyRent).toBe(15000000);
    expect(extracted!.deposit).toBe(150000000);
    expect(extracted!.price).toBeUndefined();
  });

  it("falls back to OpenGraph metadata when structured data is absent", () => {
    const html = `<html><head><meta property="og:title" content="آپارتمان ۹۰ متری" /><meta property="og:description" content="قیمت ۵ میلیارد تومان" /></head><body></body></html>`;
    const extracted = extractListingFromHtml(html, "https://www.divar.ir/v/abc123456");
    expect(extracted!.title).toBe("آپارتمان ۹۰ متری");
    expect(extracted!.price).toBe(5000000000);
  });

  it("understands Persian numerals and price notations", () => {
    expect(parseNumber("۱۲,۵۰۰")).toBe(12500);
    expect(parsePriceFromText("قیمت ۸ میلیارد تومان")).toBe(8000000000);
    expect(parsePriceFromText("اجاره ۲۵ میلیون تومان")).toBe(25000000);
  });
});

describe("source authorization", () => {
  it("fails closed when a source is missing, disabled, or not approved", async () => {
    const db = new FakeDatabase({ sources: [] });
    const env = fakeEnv(db);
    expect((await checkSourcePermission(env, "src-demo")).allowed).toBe(false);

    const disabled = new FakeDatabase({ sources: [{ id:"src-demo", name:"x", kind:"demo", enabled:0, permission_status:"approved" }] });
    const disabledResult = await checkSourcePermission(fakeEnv(disabled), "src-demo");
    expect(disabledResult.allowed).toBe(false);
    expect(disabledResult.allowed === false && disabledResult.code).toBe("SOURCE_DISABLED");

    const unreviewed = new FakeDatabase({ sources: [{ id:"src-demo", name:"x", kind:"demo", enabled:1, permission_status:"unreviewed" }] });
    const unreviewedResult = await checkSourcePermission(fakeEnv(unreviewed), "src-demo");
    expect(unreviewedResult.allowed).toBe(false);
    expect(unreviewedResult.allowed === false && unreviewedResult.code).toBe("PERMISSION_NOT_APPROVED");
  });

  it("allows a host only when it matches an allowed suffix", () => {
    expect(isHostAllowed("www.sheypoor.com", ["sheypoor.com"])).toBe(true);
    expect(isHostAllowed("sheypoor.com", ["sheypoor.com"])).toBe(true);
    expect(isHostAllowed("evil-sheypoor.com", ["sheypoor.com"])).toBe(false);
    expect(isHostAllowed("sheypoor.com.evil.test", ["sheypoor.com"])).toBe(false);
  });
});

describe("failure-safe ingestion", () => {
  it("skips duplicate source IDs within one import before the D1 batch", async () => {
    const db = new FakeDatabase();
    const env = fakeEnv(db);
    const base = { source:"manual", sourceListingId:"same-source-id", title:"First title", city:"Tehran", propertyType:"apartment", transactionType:"buy" as const, price:100, features:[] };

    const result = await importListings(env, "manual", [base, { ...base, title:"Second title", price:120 }]);

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(db.listings).toHaveLength(1);
    expect(db.statements.filter(sql => sql.includes("INSERT INTO listings"))).toHaveLength(1);
    expect(db.ingestionRuns[0]!.status).toBe("completed");
  });

  it("records a row-level diagnostic for every invalid row", async () => {
    const db = new FakeDatabase();
    const env = fakeEnv(db);
    const result = await importListings(env, "manual", [
      { source:"manual", title:"Valid", city:"Tehran", propertyType:"apartment", transactionType:"buy", price:100, features:[] },
      { source:"manual", title:"Broken", city:"Tehran", propertyType:"apartment", transactionType:"buy", price:-5, features:[] },
    ]);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(1);
    expect(db.importErrors).toHaveLength(1);
    expect(db.importErrors[0]!.error_code).toBe("VALIDATION_ERROR");
    expect(db.importErrors[0]!.safe_message).not.toContain("Broken");
  });

  it("marks the run failed with a sanitized message when the transactional D1 batch fails", async () => {
    const db = new FakeDatabase();
    const original = db.batch?.bind?.(db as unknown as { batch: unknown });
    void original;
    const failing = {
      prepare(sql: string) {
        db.statements.push(sql);
        return {
          bind() { return this; },
          async first() {
            if (sql.includes("FROM sources")) {
              return { id: "src-demo", name: "demo", kind: "demo", base_url: null, allowed_host: null, enabled: 1, permission_status: "approved", permission_reviewed_at: null, permission_notes: null };
            }
            return null;
          },
          async run() { return { success: true, meta: { changes: 1 } }; },
        };
      },
      async batch() { throw new Error("SQLITE_CONSTRAINT secret-detail"); },
    } as unknown as D1Database;
    const env = { DB: failing, RATE_LIMIT_PER_MINUTE: "60" } as never;

    await expect(importListings(env, "manual", [{
      source:"demo", sourceListingId:"failure-test", title:"Bright Apartment", city:"Tehran",
      propertyType:"apartment", transactionType:"buy", price:100, features:[],
    }])).rejects.toThrow("Import failed; listing changes were rolled back");

    expect(db.statements.some(sql => sql.includes("status='failed'") && sql.includes("Import failed; listing changes were rolled back"))).toBe(true);
  });
});

describe("atomic rate limiting", () => {
  it("rejects a request based on the atomically returned incremented count", async () => {
    let sql = "";
    let continued = false;
    const db = { prepare(statement: string) { sql = statement; return { bind() { return this; }, async first() { return { window_start: Math.floor(Date.now() / 60_000), request_count: 11 }; } }; } } as unknown as D1Database;
    const context = {
      env: { DB: db, RATE_LIMIT_PER_MINUTE: "10" },
      req: { header: () => "192.0.2.10" },
      json: (payload: unknown, status: number) => ({ payload, status }),
    } as unknown as Parameters<typeof rateLimit>[0];

    const response = await rateLimit(context, async () => { continued = true; });

    expect(sql).toContain("RETURNING window_start, request_count");
    expect(response).toMatchObject({ status: 429 });
    expect(continued).toBe(false);
  });
});
