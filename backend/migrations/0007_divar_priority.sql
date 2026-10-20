-- Give the Divar pages priority and let a page follow up to its item pages.
--
-- Divar publishes only a short summary on a category page, while the item
-- page itself is server rendered and carries the description, the price,
-- the area, and the rooms. A page with `follow_detail` therefore reads a
-- small number of item pages, slowly and within a strict budget, so the
-- source is never flooded and the request rate stays low.

ALTER TABLE source_pages ADD COLUMN follow_detail INTEGER NOT NULL DEFAULT 0 CHECK (follow_detail IN (0,1));
ALTER TABLE source_pages ADD COLUMN detail_limit INTEGER NOT NULL DEFAULT 0;

UPDATE source_pages SET follow_detail = 1, detail_limit = 4 WHERE id IN ('page-divar-tehran','page-divar-karaj');

INSERT OR IGNORE INTO source_pages (id, source_id, url, label, transaction_type, category_filter, enabled, follow_detail, detail_limit) VALUES
  ('page-divar-tehran-re', 'src-collector', 'https://www.divar.ir/s/tehran/real-estate', 'دیوار · ملک · تهران', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 4),
  ('page-divar-karaj-re', 'src-collector', 'https://www.divar.ir/s/karaj/real-estate', 'دیوار · ملک · کرج', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 4),
  ('page-divar-mashhad', 'src-collector', 'https://www.divar.ir/s/mashhad', 'دیوار · مشهد', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 4),
  ('page-divar-esfahan', 'src-collector', 'https://www.divar.ir/s/esfahan', 'دیوار · اصفهان', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 4),
  ('page-divar-shiraz', 'src-collector', 'https://www.divar.ir/s/shiraz', 'دیوار · شیراز', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 4);
