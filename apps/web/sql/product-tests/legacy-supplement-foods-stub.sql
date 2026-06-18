CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  data_origin TEXT NOT NULL,
  data_origin_id TEXT NOT NULL,
  data_origin_url TEXT,
  data_origin_priority SMALLINT NOT NULL DEFAULT 100,
  name TEXT NOT NULL,
  brand TEXT,
  upc TEXT,
  off_market BOOLEAN NOT NULL DEFAULT FALSE,
  search_text TEXT NOT NULL,
  label JSONB NOT NULL,
  fdc_release_date DATE NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_origin, data_origin_id),
  CONSTRAINT foods_id_check
    CHECK (btrim(id) <> ''),
  CONSTRAINT foods_canonical_key_check
    CHECK (btrim(canonical_key) <> ''),
  CONSTRAINT foods_data_origin_check
    CHECK (data_origin ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT foods_data_origin_id_check
    CHECK (btrim(data_origin_id) <> ''),
  CONSTRAINT foods_data_origin_priority_check
    CHECK (data_origin_priority >= 0)
);
