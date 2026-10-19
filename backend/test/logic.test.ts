import { describe, expect, it } from "vitest";
import { normalizeListing, isFresh, freshnessScore, hashListing } from "../src/listings";
import { isEligibleListing, scoreListing } from "../src/scoring";
import { listingSchema, preferencesSchema } from "../src/validation";
import { importListings } from "../src/ingestion";
import { rateLimit } from "../src/rateLimit";
import app from "../src/index";
import type { Env } from "../src/types";

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
      mustHave:["PARKING", "ELEVATOR"], avoid:["auction"],
    };
    const eligible = { ...sample, city:"tehran", neighborhood:"Saadat Abad", propertyType:"Apartment", transactionType:"buy" as const,
      price:100, areaM2:80, bedrooms:2, title:"Bright home", description:"Well maintained", features:["parking", "Elevator"] };

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
      { label:"avoided term in feature", listing:{ ...eligible, features:["parking", "elevator", "AUCTION"] } },
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

describe("failure-safe ingestion", () => {
  it("skips duplicate source IDs within one import before the D1 batch", async () => {
    const writes: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(..._values: unknown[]) { return this; },
          async first() { return null; },
          async run() { return { success: true }; },
          sql,
        };
      },
      async batch(statements: Array<{sql?: string}>) { writes.push(...statements.map(s => s.sql ?? "")); return []; },
    } as unknown as D1Database;
    const env = { DB: db } as Env;
    const base = { source:"manual", sourceListingId:"same-source-id", title:"First title", city:"Tehran", propertyType:"apartment", transactionType:"buy" as const, price:100, features:[] };

    const result = await importListings(env, "manual", [base, { ...base, title:"Second title", price:120 }]);

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(writes.filter(sql => sql.includes("INSERT INTO listings"))).toHaveLength(1);
    expect(writes.some(sql => sql.includes("status='completed'"))).toBe(true);
  });

  it("marks the run failed with a sanitized message when the transactional D1 batch fails", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind(..._values: unknown[]) { return this; },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
      async batch(_statements: unknown[]) { throw new Error("SQLITE_CONSTRAINT secret-detail"); },
    } as unknown as D1Database;
    const env = { DB: db } as Env;

    await expect(importListings(env, "manual", [{
      source:"demo", sourceListingId:"failure-test", title:"Bright Apartment", city:"Tehran",
      propertyType:"apartment", transactionType:"buy", price:100, features:[],
    }])).rejects.toThrow("Import failed; listing changes were rolled back");

    expect(statements.some(sql => sql.includes("status='failed'") && sql.includes("message='Import failed; listing changes were rolled back'"))).toBe(true);
    expect(statements.some(sql => sql.includes("status='completed'"))).toBe(true);
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

describe("anonymous preference capabilities", () => {
  it("requires UUIDv4 IDs, prevents overwriting a used ID, and does not expose a preference GET route", async () => {
    let bucketCount = 0;
    let preferenceCreated = false;
    const db = {
      prepare(sql: string) {
        return {
          bind(..._values: unknown[]) { return this; },
          async first() {
            if (sql.includes("RETURNING window_start, request_count")) return { window_start: Math.floor(Date.now() / 60_000), request_count: ++bucketCount };
            return null;
          },
          async run() {
            if (sql.includes("INSERT INTO user_preferences")) {
              if (preferenceCreated) return { meta: { changes: 0 } };
              preferenceCreated = true;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;
    const env = { DB: db, RATE_LIMIT_PER_MINUTE: "60", ALLOWED_ORIGINS: "http://localhost:5173" } as Env;
    const invalid = await app.request("/api/preferences/predictable-id", { method:"PUT", headers:{"Content-Type":"application/json"}, body:"{}" }, env);
    expect(invalid.status).toBe(400);

    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const create = () => app.request(`/api/preferences/${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:"{}" }, env);
    expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(409);
    expect((await app.request(`/api/preferences/${id}`, {}, env)).status).toBe(404);
  });
});
