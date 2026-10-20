-- Point the Divar pages at the category slugs the source publishes.
--
-- A general city page mixes every category and contributes almost no
-- property listings, while a category page carries the full result list of
-- that category in its embedded data. The city pages are therefore replaced
-- by the property categories of three cities, and the request rate is kept
-- low by the collector's pause between requests.

UPDATE source_pages SET enabled = 0 WHERE id IN (
  'page-divar-tehran', 'page-divar-karaj', 'page-divar-mashhad', 'page-divar-esfahan',
  'page-divar-shiraz', 'page-divar-qom', 'page-divar-tabriz', 'page-divar-kermanshah',
  'page-divar-tehran-re', 'page-divar-karaj-re'
);

INSERT OR IGNORE INTO source_pages (id, source_id, url, label, transaction_type, category_filter, enabled, follow_detail, detail_limit) VALUES
  ('page-divar-tehran-buy-apartment', 'src-collector', 'https://www.divar.ir/s/tehran/buy-apartment', 'دیوار · خرید آپارتمان · تهران', 'buy', 'آپارتمان,ویلا,خانه', 1, 1, 3),
  ('page-divar-tehran-rent-apartment', 'src-collector', 'https://www.divar.ir/s/tehran/rent-apartment', 'دیوار · اجاره آپارتمان · تهران', 'rent', 'آپارتمان,ویلا,خانه', 1, 1, 3),
  ('page-divar-tehran-buy-villa', 'src-collector', 'https://www.divar.ir/s/tehran/buy-villa', 'دیوار · خرید ویلا · تهران', 'buy', 'ویلا,خانه,آپارتمان', 1, 1, 2),
  ('page-divar-tehran-rent-villa', 'src-collector', 'https://www.divar.ir/s/tehran/rent-villa', 'دیوار · اجاره ویلا · تهران', 'rent', 'ویلا,خانه,آپارتمان', 1, 1, 2),
  ('page-divar-karaj-buy-apartment', 'src-collector', 'https://www.divar.ir/s/karaj/buy-apartment', 'دیوار · خرید آپارتمان · کرج', 'buy', 'آپارتمان,ویلا,خانه', 1, 1, 3),
  ('page-divar-karaj-rent-apartment', 'src-collector', 'https://www.divar.ir/s/karaj/rent-apartment', 'دیوار · اجاره آپارتمان · کرج', 'rent', 'آپارتمان,ویلا,خانه', 1, 1, 3),
  ('page-divar-karaj-buy-villa', 'src-collector', 'https://www.divar.ir/s/karaj/buy-villa', 'دیوار · خرید ویلا · کرج', 'buy', 'ویلا,خانه,آپارتمان', 1, 1, 2),
  ('page-divar-isfahan-buy-apartment', 'src-collector', 'https://www.divar.ir/s/isfahan/buy-apartment', 'دیوار · خرید آپارتمان · اصفهان', 'buy', 'آپارتمان,ویلا,خانه', 1, 1, 3),
  ('page-divar-isfahan-rent-apartment', 'src-collector', 'https://www.divar.ir/s/isfahan/rent-apartment', 'دیوار · اجاره آپارتمان · اصفهان', 'rent', 'آپارتمان,ویلا,خانه', 1, 1, 3);
