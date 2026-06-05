\set ON_ERROR_STOP on

CREATE TEMP TABLE dailymed_import_raw (
  payload JSONB NOT NULL
);

\copy dailymed_import_raw(payload) FROM PROGRAM 'if [ -n "$DAILYMED_NDJSON_PATH" ]; then cat "$DAILYMED_NDJSON_PATH"; else echo "DAILYMED_NDJSON_PATH is required" >&2; exit 1; fi' WITH (FORMAT csv, DELIMITER E'\t', QUOTE E'\b');

WITH normalized AS (
  SELECT
    payload,
    NULLIF(btrim(payload->>'dataOrigin'), '') AS data_origin,
    NULLIF(btrim(payload->>'dataOriginId'), '') AS data_origin_id,
    COALESCE(NULLIF(payload->>'name', ''), 'Unknown supplement') AS name,
    NULLIF(payload->>'brand', '') AS brand,
    NULLIF(regexp_replace(COALESCE(payload->>'upc', ''), '\D', '', 'g'), '') AS upc,
    CASE lower(COALESCE(payload->>'offMarket', 'false'))
      WHEN '1' THEN true
      WHEN 'true' THEN true
      WHEN 'yes' THEN true
      ELSE false
    END AS off_market,
    COALESCE(
      NULLIF(payload->>'searchText', ''),
      CONCAT_WS(
        ' ',
        payload->>'name',
        payload->>'brand',
        payload->>'upc'
      )
    ) AS search_text,
    COALESCE(payload->'label', payload) AS label,
    NULLIF(payload->>'dataOriginUrl', '') AS data_origin_url,
    CASE
      WHEN payload#>>'{dedupe,dsldId}' ~ '^\d+$'
      THEN (payload#>>'{dedupe,dsldId}')::BIGINT
      ELSE NULL
    END AS dedupe_dsld_id
  FROM dailymed_import_raw
)

INSERT INTO supplements (
  id,
  canonical_key,
  data_origin,
  data_origin_id,
  data_origin_url,
  data_origin_priority,
  name,
  brand,
  upc,
  off_market,
  search_text,
  label
)
SELECT
  normalized.data_origin || ':' || normalized.data_origin_id,
  COALESCE(
    'dsld:' || supplements.data_origin_id,
    normalized.data_origin || ':' || normalized.data_origin_id
  ),
  normalized.data_origin,
  normalized.data_origin_id,
  normalized.data_origin_url,
  CASE
    WHEN normalized.data_origin = 'dailymed' THEN 30
    ELSE 100
  END::smallint,
  normalized.name,
  normalized.brand,
  normalized.upc,
  normalized.off_market,
  normalized.search_text,
  normalized.label
FROM normalized
LEFT JOIN supplements
  ON supplements.data_origin = 'dsld'
  AND supplements.data_origin_id = normalized.dedupe_dsld_id::text
WHERE
  normalized.data_origin ~ '^[a-z][a-z0-9_]*$'
  AND normalized.data_origin_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  data_origin = EXCLUDED.data_origin,
  data_origin_id = EXCLUDED.data_origin_id,
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  imported_at = now();

ANALYZE supplements;
