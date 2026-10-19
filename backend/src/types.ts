export type TransactionType = "buy" | "rent";

export interface Env {
  DB: D1Database;
  ADMIN_INGEST_TOKEN?: string;
  APP_ENV?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  MAX_LISTING_AGE_DAYS?: string;
  ALLOWED_ORIGINS?: string;
}

export interface Preferences {
  budgetMin?: number;
  budgetMax?: number;
  propertyTypes: string[];
  transactionType: TransactionType;
  city?: string;
  neighborhoods: string[];
  minBedrooms?: number;
  minAreaM2?: number;
  maxCommuteMinutes?: number;
  mustHave: string[];
  avoid: string[];
}

export interface ListingInput {
  source: string;
  sourceListingId?: string;
  sourceUrl?: string;
  title: string;
  description?: string;
  city: string;
  neighborhood?: string;
  address?: string;
  propertyType: string;
  transactionType: TransactionType;
  price: number;
  areaM2?: number;
  bedrooms?: number;
  bathrooms?: number;
  latitude?: number;
  longitude?: number;
  features: string[];
  publishedAt?: string;
}

export interface Listing extends ListingInput {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  contentHash: string;
  status: "active" | "inactive" | "removed";
}
