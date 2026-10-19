import { describe, expect, it } from "vitest";
import { normalizeListing, isFresh, freshnessScore, hashListing } from "../src/listings";
import { isEligibleListing, scoreListing } from "../src/scoring";
import { listingSchema, preferencesSchema } from "../src/validation";
import { importListings } from "../src/ingestion";
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
