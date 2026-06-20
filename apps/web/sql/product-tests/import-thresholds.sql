\if :{?contaminant_threshold_import_standalone_transaction}
\else
\set contaminant_threshold_import_standalone_transaction true
\endif

\if :contaminant_threshold_import_standalone_transaction
BEGIN;
\endif

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

\copy contaminant_thresholds_import FROM __THRESHOLDS_CSV__ WITH (FORMAT csv, HEADER true, NULL '')

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contaminant_thresholds_import) THEN
    RAISE EXCEPTION 'contaminant threshold import prepared zero rows';
  END IF;
END $$;

CREATE TEMP TABLE contaminant_thresholds_cleaned AS
  SELECT
    CASE
      WHEN btrim(id) LIKE 'eu_2023_915_%'
        THEN regexp_replace(btrim(id), '_[0-9]{8}_v[0-9]{8}$', '')
      ELSE btrim(id)
    END AS id,
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

-- This importer accepts screening-threshold CSVs. Auto-normalizing a
-- product_mass concentration row means the row is intended for broad Murph
-- screening, not that every legal commodity limit is globally applicable.
CREATE TEMP TABLE contaminant_thresholds_normalized AS
  SELECT
    id,
    contaminant_key,
    authority_key,
    authority_name,
    threshold_name,
    threshold_url,
    threshold_value,
    threshold_unit,
    threshold_basis,
    concern_level_if_exceeded,
    effective_on,
    active,
    CASE
      WHEN threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppm', 'mg/kg')
        THEN threshold_value
      WHEN threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppb', 'ug/kg', 'ng/g')
        THEN threshold_value / 1000
      WHEN threshold_basis = 'product_mass'
        AND threshold_unit = 'mg/kg-dry'
        THEN threshold_value
      ELSE NULL
    END AS normalized_value,
    CASE
      WHEN threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppm', 'mg/kg', 'ppb', 'ug/kg', 'ng/g')
        THEN 'ppm'
      WHEN threshold_basis = 'product_mass'
        AND threshold_unit = 'mg/kg-dry'
        THEN 'mg/kg-dry'
      ELSE NULL
    END AS normalized_unit,
    CASE
      WHEN threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppm', 'mg/kg', 'ppb', 'ug/kg', 'ng/g', 'mg/kg-dry')
        THEN 'product_mass'
      ELSE NULL
    END AS normalized_basis
  FROM contaminant_thresholds_cleaned;

DELETE FROM contaminant_thresholds existing_thresholds
WHERE NOT EXISTS (
  SELECT 1
  FROM contaminant_thresholds_normalized imported_thresholds
  WHERE imported_thresholds.id = existing_thresholds.id
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
  normalized_value,
  normalized_unit,
  normalized_basis,
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
  normalized_value,
  normalized_unit,
  normalized_basis,
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
  normalized_value = EXCLUDED.normalized_value,
  normalized_unit = EXCLUDED.normalized_unit,
  normalized_basis = EXCLUDED.normalized_basis,
  concern_level_if_exceeded = EXCLUDED.concern_level_if_exceeded,
  effective_on = EXCLUDED.effective_on,
  active = EXCLUDED.active,
  imported_at = now();

\if :contaminant_threshold_import_standalone_transaction
COMMIT;
\endif
