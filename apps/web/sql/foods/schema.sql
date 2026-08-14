CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  serving_grams NUMERIC,
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
    CHECK (data_origin_priority >= 0),
  CONSTRAINT foods_serving_grams_check
    CHECK (serving_grams IS NULL OR serving_grams > 0)
);

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS serving_grams NUMERIC;

ALTER TABLE foods
  DROP CONSTRAINT IF EXISTS foods_serving_grams_check,
  ADD CONSTRAINT foods_serving_grams_check
    CHECK (serving_grams IS NULL OR serving_grams > 0) NOT VALID;

CREATE INDEX IF NOT EXISTS foods_search_idx
  ON foods
  USING GIN (to_tsvector('simple', search_text));

CREATE INDEX IF NOT EXISTS foods_search_english_idx
  ON foods
  USING GIN (to_tsvector('english', search_text));

CREATE INDEX IF NOT EXISTS foods_name_trgm_idx
  ON foods
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS foods_name_rank_idx
  ON foods
  USING GIST (name gist_trgm_ops);

CREATE INDEX IF NOT EXISTS foods_brand_idx
  ON foods (brand)
  WHERE brand IS NOT NULL;

CREATE INDEX IF NOT EXISTS foods_upc_idx
  ON foods (upc)
  WHERE upc IS NOT NULL;

CREATE INDEX IF NOT EXISTS foods_canonical_rank_idx
  ON foods (canonical_key, data_origin_priority, id);
