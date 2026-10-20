-- Give the Divar item pages a slightly larger budget.
--
-- The Divar category pages publish the area, the rooms, the location, and
-- the link, but not the price. The price is read from the listing page
-- itself, so a small number of listing pages are read per category page
-- with a pause between them.

UPDATE source_pages SET detail_limit = 6 WHERE source_id = 'src-collector' AND id LIKE 'page-divar-%';
