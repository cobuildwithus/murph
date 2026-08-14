CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  serving_grams NUMERIC,
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
    CHECK (data_origin_priority >= 0),
  CONSTRAINT supplements_payload_format_check
    CHECK (
      btrim(name) <> ''
      AND btrim(search_text) <> ''
      AND char_length(search_text) <= 6000
      AND COALESCE(jsonb_typeof(label) = 'object', false)
      AND (brand IS NULL OR btrim(brand) <> '')
      AND (upc IS NULL OR upc ~ '^[0-9]+$')
      AND (data_origin_url IS NULL OR btrim(data_origin_url) <> '')
    ),
  CONSTRAINT supplements_serving_grams_check
    CHECK (serving_grams IS NULL OR serving_grams > 0)
);

ALTER TABLE supplements
  ADD COLUMN IF NOT EXISTS serving_grams NUMERIC;

ALTER TABLE supplements
  DROP CONSTRAINT IF EXISTS supplements_serving_grams_check,
  ADD CONSTRAINT supplements_serving_grams_check
    CHECK (serving_grams IS NULL OR serving_grams > 0) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'supplements'::regclass
      AND conname = 'supplements_payload_format_check'
  ) THEN
    ALTER TABLE supplements
      ADD CONSTRAINT supplements_payload_format_check
      CHECK (
        btrim(name) <> ''
        AND btrim(search_text) <> ''
        AND char_length(search_text) <= 6000
        AND COALESCE(jsonb_typeof(label) = 'object', false)
        AND (brand IS NULL OR btrim(brand) <> '')
        AND (upc IS NULL OR upc ~ '^[0-9]+$')
        AND (data_origin_url IS NULL OR btrim(data_origin_url) <> '')
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE supplements
  VALIDATE CONSTRAINT supplements_serving_grams_check;

CREATE INDEX IF NOT EXISTS supplements_search_idx
  ON supplements
  USING GIN (to_tsvector('simple', search_text));

CREATE INDEX IF NOT EXISTS supplements_search_english_idx
  ON supplements
  USING GIN (to_tsvector('english', search_text));

CREATE INDEX IF NOT EXISTS supplements_name_trgm_idx
  ON supplements
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS supplements_brand_idx
  ON supplements (brand)
  WHERE brand IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplements_upc_idx
  ON supplements (upc)
  WHERE upc IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplements_canonical_key_idx
  ON supplements (canonical_key);
