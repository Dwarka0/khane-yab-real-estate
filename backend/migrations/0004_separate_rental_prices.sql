-- Preserve the legacy `price` field for existing clients while explicitly
-- modelling sale price, monthly rent, and refundable deposit independently.
ALTER TABLE listings ADD COLUMN sale_price INTEGER CHECK (sale_price IS NULL OR sale_price >= 0);
ALTER TABLE listings ADD COLUMN monthly_rent INTEGER CHECK (monthly_rent IS NULL OR monthly_rent >= 0);
ALTER TABLE listings ADD COLUMN deposit INTEGER CHECK (deposit IS NULL OR deposit >= 0);

UPDATE listings SET sale_price = price WHERE transaction_type = 'buy';
UPDATE listings SET monthly_rent = price WHERE transaction_type = 'rent';
