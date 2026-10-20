-- Give the listing pages a slightly larger budget, so a search can state the
-- price of more of the listings it shows.

UPDATE source_pages SET detail_limit = 8 WHERE source_id = 'src-collector' AND id LIKE 'page-divar-%';
UPDATE source_pages SET detail_limit = 4 WHERE source_id = 'src-collector' AND id LIKE 'page-sheypoor-%';
