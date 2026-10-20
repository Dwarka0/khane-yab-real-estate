-- Correct the Isfahan city slug and widen the Divar coverage.
--
-- The city path of the source uses the transliterated city name, so Isfahan
-- is `isfahan`. The additional city pages follow the same rules: one request
-- per page every six hours, a small number of item pages on request, and the
-- real-estate categories only.

UPDATE source_pages SET url = 'https://www.divar.ir/s/isfahan' WHERE id = 'page-divar-esfahan';

INSERT OR IGNORE INTO source_pages (id, source_id, url, label, transaction_type, category_filter, enabled, follow_detail, detail_limit) VALUES
  ('page-divar-qom', 'src-collector', 'https://www.divar.ir/s/qom', 'دیوار · قم', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 3),
  ('page-divar-tabriz', 'src-collector', 'https://www.divar.ir/s/tabriz', 'دیوار · تبریز', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 3),
  ('page-divar-kermanshah', 'src-collector', 'https://www.divar.ir/s/kermanshah', 'دیوار · کرمانشاه', 'buy', 'آپارتمان,خانه,ویلا,زمین,مغازه,دفتر کار,کلنگی,باغ', 1, 1, 3);
