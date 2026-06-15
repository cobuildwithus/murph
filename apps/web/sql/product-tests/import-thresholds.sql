BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:contaminant_thresholds:import'));

CREATE TEMP TABLE contaminant_thresholds_import (
  id TEXT,
  contaminant_key TEXT,
  authority_key TEXT,
  authority_name TEXT,
  threshold_name TEXT,
  threshold_url TEXT,
  threshold_value TEXT,
  threshold_unit TEXT,
  threshold_basis TEXT,
  concern_level_if_exceeded TEXT,
  effective_on TEXT,
  active TEXT
) ON COMMIT DROP;

\copy contaminant_thresholds_import FROM :'thresholds_csv' WITH (FORMAT csv, HEADER true, NULL '')

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contaminant_thresholds_import) THEN
    RAISE EXCEPTION 'contaminant threshold import prepared zero rows';
  END IF;
END $$;

CREATE TEMP TABLE contaminant_thresholds_normalized AS
  SELECT
    btrim(id) AS id,
    btrim(contaminant_key) AS contaminant_key,
    btrim(authority_key) AS authority_key,
    btrim(authority_name) AS authority_name,
    btrim(threshold_name) AS threshold_name,
    NULLIF(btrim(threshold_url), '') AS threshold_url,
    btrim(threshold_value)::numeric AS threshold_value,
    btrim(threshold_unit) AS threshold_unit,
    btrim(threshold_basis) AS threshold_basis,
    btrim(concern_level_if_exceeded) AS concern_level_if_exceeded,
    NULLIF(btrim(effective_on), '')::date AS effective_on,
    btrim(active)::boolean AS active
  FROM contaminant_thresholds_import;

UPDATE contaminant_thresholds
SET
  active = false,
  imported_at = now()
WHERE active = true
  AND authority_key IN (
    SELECT DISTINCT authority_key
    FROM contaminant_thresholds_normalized
  )
  AND id NOT IN (
    SELECT id
    FROM contaminant_thresholds_normalized
  );

WITH normalized AS (
  SELECT *
  FROM contaminant_thresholds_normalized
)
INSERT INTO contaminant_thresholds (
  id,
  contaminant_key,
  threshold_name,
  authority_key,
  authority_name,
  threshold_url,
  threshold_value,
  threshold_unit,
  threshold_basis,
  concern_level_if_exceeded,
  effective_on,
  active
)
SELECT
  id,
  contaminant_key,
  threshold_name,
  authority_key,
  authority_name,
  threshold_url,
  threshold_value,
  threshold_unit,
  threshold_basis,
  concern_level_if_exceeded,
  effective_on,
  active
FROM normalized
ON CONFLICT (id) DO UPDATE SET
  contaminant_key = EXCLUDED.contaminant_key,
  threshold_name = EXCLUDED.threshold_name,
  authority_key = EXCLUDED.authority_key,
  authority_name = EXCLUDED.authority_name,
  threshold_url = EXCLUDED.threshold_url,
  threshold_value = EXCLUDED.threshold_value,
  threshold_unit = EXCLUDED.threshold_unit,
  threshold_basis = EXCLUDED.threshold_basis,
  concern_level_if_exceeded = EXCLUDED.concern_level_if_exceeded,
  effective_on = EXCLUDED.effective_on,
  active = EXCLUDED.active,
  imported_at = now();

COMMIT;
