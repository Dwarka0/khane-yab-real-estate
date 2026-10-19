PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  budget_min INTEGER,
  budget_max INTEGER,
  property_types TEXT NOT NULL DEFAULT '[]',
  transaction_type TEXT NOT NULL DEFAULT 'buy' CHECK (transaction_type IN ('buy','rent')),
  city TEXT,
  neighborhoods TEXT NOT NULL DEFAULT '[]',
  min_bedrooms INTEGER,
  min_area_m2 REAL,
  max_commute_minutes INTEGER,
  must_have TEXT NOT NULL DEFAULT '[]',
  avoid TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_listing_id TEXT,
  source_url TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  neighborhood TEXT,
  address TEXT,
  property_type TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('buy','rent')),
  price INTEGER NOT NULL CHECK (price >= 0),
  area_m2 REAL,
  bedrooms INTEGER,
  bathrooms INTEGER,
  latitude REAL,
  longitude REAL,
  features TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','removed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, source_listing_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_search ON listings(status, transaction_type, city, price);
CREATE INDEX IF NOT EXISTS idx_listings_freshness ON listings(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_dedupe ON listings(content_hash);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  received_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  message TEXT
);
