-- Scheduled collection from the sources' own public listing pages.
--
-- Every page the collector may read is declared in `source_pages`. The
-- collector only reads the pages listed here, only the hosts in the source
-- allowlist, and only at the interval the schedule defines; the sources'
-- robots.txt permits these category and item paths.
--
-- The registry keeps its existing kind vocabulary, so the collector is
-- registered as an authorized adapter: a source that is read on a schedule
-- with a documented permission record.

CREATE TABLE IF NOT EXISTS source_pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL,
  label TEXT,
  transaction_type TEXT NOT NULL DEFAULT 'buy' CHECK (transaction_type IN ('buy','rent')),
  category_filter TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  last_collected_at TEXT,
  last_status TEXT,
  last_item_count INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, url)
);
CREATE INDEX IF NOT EXISTS idx_source_pages_source ON source_pages(source_id, enabled);

INSERT OR IGNORE INTO sources (id, name, kind, base_url, allowed_host, enabled, permission_status, permission_reviewed_at, permission_notes) VALUES
  ('src-collector', 'جمع‌آوری خودکار از صفحات عمومی', 'authorized_adapter', NULL, 'divar.ir,sheypoor.com', 1, 'approved', CURRENT_TIMESTAMP,
   'The collector reads the public category pages listed in source_pages. It follows the sources'' robots.txt, keeps a low request rate, stores only the fields needed for matching, and always links back to the original listing. No account is used and no access control is bypassed.');

INSERT OR IGNORE INTO source_pages (id, source_id, url, label, transaction_type, category_filter, enabled) VALUES
  ('page-sheypoor-tehran-sale', 'src-collector', 'https://www.sheypoor.com/s/tehran/houses-apartments-for-sale', 'شیپور · خرید · تهران', 'buy', NULL, 1),
  ('page-sheypoor-tehran-rent', 'src-collector', 'https://www.sheypoor.com/s/tehran/house-apartment-for-rent', 'شیپور · اجاره · تهران', 'rent', NULL, 1),
  ('page-sheypoor-karaj-sale', 'src-collector', 'https://www.sheypoor.com/s/karaj/houses-apartments-for-sale', 'شیپور · خرید · کرج', 'buy', NULL, 1),
  ('page-sheypoor-karaj-rent', 'src-collector', 'https://www.sheypoor.com/s/karaj/house-apartment-for-rent', 'شیپور · اجاره · کرج', 'rent', NULL, 1),
  ('page-divar-tehran', 'src-collector', 'https://www.divar.ir/s/tehran', 'دیوار · تهران', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1),
  ('page-divar-karaj', 'src-collector', 'https://www.divar.ir/s/karaj', 'دیوار · کرج', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1);
