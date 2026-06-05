CREATE TABLE IF NOT EXISTS supplements (
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
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_origin, data_origin_id),
  CONSTRAINT supplements_id_check
    CHECK (btrim(id) <> ''),
  CONSTRAINT supplements_canonical_key_check
    CHECK (btrim(canonical_key) <> ''),
  CONSTRAINT supplements_data_origin_check
    CHECK (data_origin ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT supplements_data_origin_id_check
    CHECK (btrim(data_origin_id) <> ''),
  CONSTRAINT supplements_data_origin_priority_check
    CHECK (data_origin_priority >= 0)
);

CREATE INDEX IF NOT EXISTS supplements_search_idx
  ON supplements
  USING GIN (to_tsvector('simple', search_text));

CREATE INDEX IF NOT EXISTS supplements_upc_idx
  ON supplements (upc)
  WHERE upc IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplements_canonical_key_idx
  ON supplements (canonical_key);
