-- Source registry, per-source observations, row-level import diagnostics, and
-- expiry for anonymous search preferences.
--
-- The registry makes every ingestion path explicit: a source is only usable
-- when it is enabled AND carries an approved permission record. The API
-- fails closed when either condition is missing.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('demo','manual','user_link','authorized_adapter')),
  base_url TEXT,
  allowed_host TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  permission_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (permission_status IN ('unreviewed','approved','rejected','expired')),
  permission_reviewed_at TEXT,
  permission_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sources_enabled ON sources(enabled, permission_status);

INSERT OR IGNORE INTO sources (id, name, kind, base_url, allowed_host, enabled, permission_status, permission_reviewed_at, permission_notes) VALUES
  ('src-demo', 'نمونه‌ی نمایشی', 'demo', NULL, NULL, 1, 'approved', CURRENT_TIMESTAMP,
   'Synthetic fixtures shipped with the repository. No external source is contacted.'),
  ('src-manual', 'ورود دستی اپراتور', 'manual', NULL, NULL, 1, 'approved', CURRENT_TIMESTAMP,
   'Operator-supplied JSON payloads. The operator confirms the right to use each record.'),
  ('src-user-link', 'لینک ارسالی کاربر', 'user_link', NULL, 'divar.ir,sheypoor.com', 1, 'approved', CURRENT_TIMESTAMP,
   'The user submits a public listing URL. The platform stores only the fields required for matching and always links back to the source page. No crawling and no account automation.');

-- Every sighting of a listing is kept so provenance survives reconciliation.
CREATE TABLE IF NOT EXISTS listing_observations (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_record_id TEXT,
  source_url TEXT,
  content_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, source_record_id)
);
CREATE INDEX IF NOT EXISTS idx_observations_listing ON listing_observations(listing_id);
CREATE INDEX IF NOT EXISTS idx_observations_observed ON listing_observations(observed_at DESC);

-- Row-level diagnostics; never store the full imported row.
CREATE TABLE IF NOT EXISTS import_errors (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  error_code TEXT NOT NULL,
  safe_message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_errors_run ON import_errors(run_id);

-- Anonymous preferences are short-lived search sessions, not durable profiles.
ALTER TABLE user_preferences ADD COLUMN expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_preferences_expiry ON user_preferences(expires_at);
CREATE INDEX IF NOT EXISTS idx_preferences_updated ON user_preferences(updated_at);
