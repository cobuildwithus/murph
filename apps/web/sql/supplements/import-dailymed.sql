\set ON_ERROR_STOP on

CREATE TEMP TABLE dailymed_import_raw (
  payload JSONB NOT NULL
);

\copy dailymed_import_raw(payload) FROM PROGRAM 'if [ -n "$DAILYMED_NDJSON_PATH" ]; then cat "$DAILYMED_NDJSON_PATH"; else echo "DAILYMED_NDJSON_PATH is required" >&2; exit 1; fi' WITH (FORMAT text);

WITH normalized AS (
  SELECT
    payload,
    NULLIF(btrim(payload->>'source'), '') AS source,
    NULLIF(btrim(payload->>'sourceId'), '') AS source_id,
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
    NULLIF(payload->>'sourceUrl', '') AS source_url,
    CASE
      WHEN payload#>>'{dedupe,matchedDsldId}' ~ '^\d+$'
      THEN (payload#>>'{dedupe,matchedDsldId}')::BIGINT
      ELSE NULL
    END AS raw_matched_dsld_id
  FROM dailymed_import_raw
)

INSERT INTO supplement_external_labels (
  source,
  source_id,
  name,
  brand,
  upc,
  off_market,
  search_text,
  label,
  source_url,
  matched_dsld_id
)
SELECT
  normalized.source,
  normalized.source_id,
  normalized.name,
  normalized.brand,
  normalized.upc,
  normalized.off_market,
  normalized.search_text,
  normalized.label,
  normalized.source_url,
  supplements.dsld_id
FROM normalized
LEFT JOIN supplements
  ON supplements.dsld_id = normalized.raw_matched_dsld_id
WHERE
  normalized.source ~ '^[a-z][a-z0-9_-]*$'
  AND normalized.source_id IS NOT NULL
ON CONFLICT (source, source_id) DO UPDATE SET
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  source_url = EXCLUDED.source_url,
  matched_dsld_id = EXCLUDED.matched_dsld_id,
  imported_at = now();

ANALYZE supplement_external_labels;
