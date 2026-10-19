import { z } from "zod";

const optionalNonNegative = z.number().finite().nonnegative().optional();
const stringList = z.array(z.string().trim().min(1).max(80)).max(30).default([]);

export const preferencesSchema = z.object({
  budgetMin: optionalNonNegative,
  budgetMax: optionalNonNegative,
  propertyTypes: stringList,
  transactionType: z.enum(["buy", "rent"]).default("buy"),
  city: z.string().trim().min(1).max(120).optional(),
  neighborhoods: stringList,
  minBedrooms: z.number().int().min(0).max(30).optional(),
  minAreaM2: optionalNonNegative,
  maxCommuteMinutes: z.number().int().min(0).max(600).optional(),
  mustHave: stringList,
  avoid: stringList,
}).refine(v => v.budgetMin === undefined || v.budgetMax === undefined || v.budgetMin <= v.budgetMax, {
  message: "budgetMin must be less than or equal to budgetMax", path: ["budgetMin"],
});

export const listingSchema = z.object({
  source: z.string().trim().min(1).max(80),
  sourceListingId: z.string().trim().min(1).max(160).optional(),
  sourceUrl: z.string().url().max(2048).refine(value => new URL(value).protocol === "https:", { message: "sourceUrl must use HTTPS" }).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(10000).default(""),
  city: z.string().trim().min(1).max(120),
  neighborhood: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  propertyType: z.string().trim().min(1).max(80),
  transactionType: z.enum(["buy", "rent"]),
  price: z.number().finite().nonnegative().max(10_000_000_000_000),
  salePrice: z.number().finite().nonnegative().max(10_000_000_000_000).optional(),
  monthlyRent: z.number().finite().nonnegative().max(10_000_000_000_000).optional(),
  deposit: z.number().finite().nonnegative().max(10_000_000_000_000).optional(),
  areaM2: optionalNonNegative,
  bedrooms: z.number().int().min(0).max(30).optional(),
  bathrooms: z.number().int().min(0).max(30).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  features: stringList,
  publishedAt: z.string().datetime().optional(),
}).superRefine((listing, ctx) => {
  if (listing.transactionType === "buy" && listing.monthlyRent !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["monthlyRent"], message: "Sale listings cannot include monthlyRent" });
  if (listing.transactionType === "rent" && listing.salePrice !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["salePrice"], message: "Rental listings cannot include salePrice" });
  if (listing.transactionType === "buy" && listing.deposit !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deposit"], message: "Sale listings cannot include rental deposit" });
});

export const searchSchema = z.object({
  q: z.string().trim().max(160).optional(),
  city: z.string().trim().max(120).optional(),
  transactionType: z.enum(["buy", "rent"]).optional(),
  propertyType: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().finite().nonnegative().optional(),
  maxPrice: z.coerce.number().finite().nonnegative().optional(),
  minAreaM2: z.coerce.number().finite().nonnegative().optional(),
  minBedrooms: z.coerce.number().int().min(0).max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
}).refine(v => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
  message: "minPrice must be less than or equal to maxPrice", path: ["minPrice"],
});
