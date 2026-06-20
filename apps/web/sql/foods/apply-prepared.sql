-- Applies a prepared foods export (see import-fdc.sh --export-prepared) to the
-- labels DB. All heavy CSV joining/aggregation happens wherever the prepared
-- CSV was built; this side is a plain COPY plus batched idempotent upserts so
-- small managed instances never run large sorts or aggregations.

\set ON_ERROR_STOP on

CREATE TEMP TABLE foods_prepared (
  id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  data_origin TEXT NOT NULL,
  data_origin_id TEXT NOT NULL,
  data_origin_url TEXT,
  data_origin_priority SMALLINT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  upc TEXT,
  off_market BOOLEAN NOT NULL,
  search_text TEXT NOT NULL,
  label JSONB NOT NULL,
  serving_grams NUMERIC,
  fdc_release_date DATE NOT NULL
);

\copy foods_prepared FROM PROGRAM 'if [ -n "$FDC_PREPARED_CSV" ]; then cat "$FDC_PREPARED_CSV"; else echo "FDC_PREPARED_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)

CREATE INDEX foods_prepared_batch_idx
  ON foods_prepared (data_origin, data_origin_id);

UPDATE foods_prepared
SET serving_grams = NULL
WHERE serving_grams IS NOT NULL
  AND NOT (serving_grams > 0 AND serving_grams <= 2000);

ANALYZE foods_prepared;

-- Generic origins first (small), then branded in four modulo batches to keep
-- every statement bounded. Re-runs are safe: same-source upserts.
INSERT INTO foods (
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
)
SELECT
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
FROM foods_prepared
WHERE data_origin <> 'usda_branded'
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  id = EXCLUDED.id,
  canonical_key = EXCLUDED.canonical_key,
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  serving_grams = EXCLUDED.serving_grams,
  fdc_release_date = EXCLUDED.fdc_release_date,
  last_seen_at = now(),
  imported_at = now();

INSERT INTO foods (
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
)
SELECT
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
FROM foods_prepared
WHERE data_origin = 'usda_branded'
  AND data_origin_id ~ '^\d+$'
  AND data_origin_id::bigint % 4 = 0
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  id = EXCLUDED.id,
  canonical_key = EXCLUDED.canonical_key,
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  serving_grams = EXCLUDED.serving_grams,
  fdc_release_date = EXCLUDED.fdc_release_date,
  last_seen_at = now(),
  imported_at = now();

INSERT INTO foods (
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
)
SELECT
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
FROM foods_prepared
WHERE data_origin = 'usda_branded'
  AND data_origin_id ~ '^\d+$'
  AND data_origin_id::bigint % 4 = 1
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  id = EXCLUDED.id,
  canonical_key = EXCLUDED.canonical_key,
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  serving_grams = EXCLUDED.serving_grams,
  fdc_release_date = EXCLUDED.fdc_release_date,
  last_seen_at = now(),
  imported_at = now();

INSERT INTO foods (
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
)
SELECT
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
FROM foods_prepared
WHERE data_origin = 'usda_branded'
  AND data_origin_id ~ '^\d+$'
  AND data_origin_id::bigint % 4 = 2
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  id = EXCLUDED.id,
  canonical_key = EXCLUDED.canonical_key,
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  serving_grams = EXCLUDED.serving_grams,
  fdc_release_date = EXCLUDED.fdc_release_date,
  last_seen_at = now(),
  imported_at = now();

INSERT INTO foods (
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
)
SELECT
  id, canonical_key, data_origin, data_origin_id, data_origin_url,
  data_origin_priority, name, brand, upc, off_market, search_text, label,
  serving_grams, fdc_release_date
FROM foods_prepared
WHERE data_origin = 'usda_branded'
  AND data_origin_id ~ '^\d+$'
  AND data_origin_id::bigint % 4 = 3
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  id = EXCLUDED.id,
  canonical_key = EXCLUDED.canonical_key,
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  serving_grams = EXCLUDED.serving_grams,
  fdc_release_date = EXCLUDED.fdc_release_date,
  last_seen_at = now(),
  imported_at = now();

ANALYZE foods;

-- Post-apply report (counts only; no row contents).
SELECT data_origin, count(*) AS rows
FROM foods
GROUP BY data_origin
ORDER BY data_origin;

SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE off_market) AS off_market_rows,
  count(*) FILTER (WHERE upc IS NULL) AS null_upc_rows,
  count(*) FILTER (WHERE brand IS NULL) AS null_brand_rows
FROM foods;
