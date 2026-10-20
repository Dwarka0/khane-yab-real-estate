-- Turn the listing table into a short lived cache instead of a permanent store.
--
-- The platform now searches the sources when the seeker searches, so the
-- server only keeps a listing for a short while to answer a repeated
-- search without asking the source again. `expires_at` marks that window:
-- a row without an expiry is a synthetic demo fixture and never expires.
--
-- `source_pages` gains the city and the property type it belongs to, so a
-- search can pick the pages that match the criteria instead of reading all
-- of them.

ALTER TABLE listings ADD COLUMN expires_at TEXT;
ALTER TABLE listings ADD COLUMN page_id TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_expires ON listings(expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_page ON listings(page_id);

ALTER TABLE source_pages ADD COLUMN city TEXT;
ALTER TABLE source_pages ADD COLUMN property_type TEXT;
CREATE INDEX IF NOT EXISTS idx_source_pages_city ON source_pages(city, transaction_type, enabled);

UPDATE source_pages SET city = 'تهران', property_type = 'apartment' WHERE id IN (
  'page-sheypoor-tehran-sale', 'page-sheypoor-tehran-rent',
  'page-divar-tehran-buy-apartment', 'page-divar-tehran-rent-apartment',
  'page-divar-tehran-buy-villa', 'page-divar-tehran-rent-villa'
);
UPDATE source_pages SET city = 'کرج', property_type = 'apartment' WHERE id IN (
  'page-sheypoor-karaj-sale', 'page-sheypoor-karaj-rent',
  'page-divar-karaj-buy-apartment', 'page-divar-karaj-rent-apartment', 'page-divar-karaj-buy-villa'
);
UPDATE source_pages SET city = 'اصفهان', property_type = 'apartment' WHERE id IN (
  'page-divar-isfahan-buy-apartment', 'page-divar-isfahan-rent-apartment'
);

-- The page cache records when a page was last read, so a repeated search
-- inside the window does not ask the source again.
CREATE TABLE IF NOT EXISTS page_cache (
  page_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_page_cache_expires ON page_cache(expires_at);
