-- Keep migration-seeded examples idempotent with the protected demo import endpoint.
UPDATE listings SET
  id = 'demo-001', source_listing_id = 'demo-001',
  title = 'آپارتمان دوخوابه نورگیر',
  description = 'نزدیک حمل‌ونقل عمومی و فروشگاه‌ها',
  content_hash = 'demo-seed-hash-001'
WHERE id = 'demo-seed-001' AND source = 'demo';

UPDATE listings SET
  id = 'demo-002', source_listing_id = 'demo-002',
  title = 'واحد یک‌خوابه نزدیک پارک',
  description = 'ساختمان کم‌واحد با نور مناسب',
  content_hash = 'demo-seed-hash-002'
WHERE id = 'demo-seed-002' AND source = 'demo';
