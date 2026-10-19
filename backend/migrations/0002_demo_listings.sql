-- Clearly labelled synthetic examples so a fresh deployment has a working demo.
-- These are not real properties and contain no external listing URLs.
INSERT OR IGNORE INTO listings (
  id, source, source_listing_id, source_url, title, description, city, neighborhood,
  property_type, transaction_type, price, area_m2, bedrooms, bathrooms, features, content_hash
) VALUES
  ('demo-seed-001', 'demo', 'demo-seed-001', NULL, 'آپارتمان دوخوابه نورگیر', 'نمونه‌ی نمایشی؛ آگهی واقعی نیست', 'تهران', 'صادقیه', 'apartment', 'buy', 6500000000, 92, 2, 1, '["elevator","parking","storage"]', 'demo-seed-hash-001'),
  ('demo-seed-002', 'demo', 'demo-seed-002', NULL, 'واحد یک‌خوابه نزدیک پارک', 'نمونه‌ی نمایشی؛ آگهی واقعی نیست', 'تهران', 'پونک', 'apartment', 'rent', 180000000, 68, 1, 1, '["elevator","balcony"]', 'demo-seed-hash-002'),
  ('demo-seed-003', 'demo', 'demo-seed-003', NULL, 'آپارتمان سه‌خوابه با نور مناسب', 'نمونه‌ی نمایشی؛ مبلغ ثبت‌شده صرفاً برای آزمایش پیشنهادهاست', 'تهران', 'مرزداران', 'apartment', 'buy', 8200000000, 112, 3, 2, '["elevator","parking"]', 'demo-seed-hash-003');
