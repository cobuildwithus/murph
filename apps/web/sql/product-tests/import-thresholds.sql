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
  active TEXT,
  comparison_scope TEXT,
  normalized_value TEXT,
  normalized_unit TEXT,
  normalized_basis TEXT
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
    btrim(active)::boolean AS active,
    btrim(comparison_scope) AS comparison_scope,
    NULLIF(btrim(normalized_value), '')::numeric AS csv_normalized_value,
    NULLIF(btrim(normalized_unit), '') AS csv_normalized_unit,
    NULLIF(btrim(normalized_basis), '') AS csv_normalized_basis
  FROM contaminant_thresholds_import;

DO $$
DECLARE
  invalid_scope_ids TEXT;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO invalid_scope_ids
  FROM contaminant_thresholds_cleaned
  WHERE comparison_scope IS NULL
    OR comparison_scope NOT IN ('global', 'reviewed_application');

  IF invalid_scope_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'contaminant threshold rows must set comparison_scope to global or reviewed_application: %',
      invalid_scope_ids;
  END IF;
END $$;

DO $$
DECLARE
  invalid_reviewed_ids TEXT;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO invalid_reviewed_ids
  FROM contaminant_thresholds_cleaned
  WHERE comparison_scope = 'reviewed_application'
    AND (
      csv_normalized_value IS NULL
      OR csv_normalized_unit IS NULL
      OR csv_normalized_unit NOT IN ('ppm', 'mg/kg-dry')
      OR csv_normalized_basis IS DISTINCT FROM 'product_mass'
    );

  IF invalid_reviewed_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'reviewed_application threshold rows must include normalized_value, normalized_unit in ppm/mg/kg-dry, and normalized_basis product_mass: %',
      invalid_reviewed_ids;
  END IF;
END $$;

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
    comparison_scope,
    CASE
      WHEN comparison_scope = 'reviewed_application'
        THEN csv_normalized_value
      WHEN comparison_scope = 'global'
        AND threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppm', 'mg/kg')
        THEN threshold_value
      WHEN comparison_scope = 'global'
        AND threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppb', 'ug/kg', 'ng/g')
        THEN threshold_value / 1000
      WHEN comparison_scope = 'global'
        AND threshold_basis = 'product_mass'
        AND threshold_unit = 'mg/kg-dry'
        THEN threshold_value
      ELSE NULL
    END AS normalized_value,
    CASE
      WHEN comparison_scope = 'reviewed_application'
        THEN csv_normalized_unit
      WHEN comparison_scope = 'global'
        AND threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppm', 'mg/kg', 'ppb', 'ug/kg', 'ng/g')
        THEN 'ppm'
      WHEN comparison_scope = 'global'
        AND threshold_basis = 'product_mass'
        AND threshold_unit = 'mg/kg-dry'
        THEN 'mg/kg-dry'
      ELSE NULL
    END AS normalized_unit,
    CASE
      WHEN comparison_scope = 'reviewed_application'
        THEN csv_normalized_basis
      WHEN comparison_scope = 'global'
        AND threshold_basis = 'product_mass'
        AND threshold_unit IN ('ppm', 'mg/kg', 'ppb', 'ug/kg', 'ng/g', 'mg/kg-dry')
        THEN 'product_mass'
      ELSE NULL
    END AS normalized_basis
  FROM contaminant_thresholds_cleaned;

UPDATE contaminant_thresholds versioned_thresholds
SET active = false
WHERE versioned_thresholds.id LIKE 'eu_2023_915_%'
  AND versioned_thresholds.id ~ '_[0-9]{8}_v[0-9]{8}$'
  AND versioned_thresholds.active IS DISTINCT FROM false;

DO $$
DECLARE
  duplicate_keys TEXT;
BEGIN
  WITH final_active_normalized_thresholds AS (
    SELECT
      id,
      contaminant_key,
      normalized_unit,
      normalized_basis
    FROM contaminant_thresholds
    WHERE active
      AND normalized_value IS NOT NULL
      AND comparison_scope = 'global'
      AND id NOT IN (
        SELECT id
        FROM contaminant_thresholds_normalized
      )
    UNION ALL
    SELECT
      id,
      contaminant_key,
      normalized_unit,
      normalized_basis
    FROM contaminant_thresholds_normalized
    WHERE active
      AND normalized_value IS NOT NULL
      AND comparison_scope = 'global'
  ),
  duplicate_normalized_thresholds AS (
    SELECT
      contaminant_key || ':' || normalized_unit || ':' || normalized_basis AS duplicate_key
    FROM final_active_normalized_thresholds
    GROUP BY contaminant_key, normalized_unit, normalized_basis
    HAVING COUNT(*) > 1
  )
  SELECT string_agg(duplicate_key, ', ' ORDER BY duplicate_key)
  INTO duplicate_keys
  FROM duplicate_normalized_thresholds;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'duplicate active normalized contaminant thresholds after import; resolve before importing comparable thresholds: %',
      duplicate_keys;
  END IF;
END $$;

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
  comparison_scope,
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
  comparison_scope,
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
  comparison_scope = EXCLUDED.comparison_scope,
  concern_level_if_exceeded = EXCLUDED.concern_level_if_exceeded,
  effective_on = EXCLUDED.effective_on,
  active = EXCLUDED.active,
  imported_at = now();

\if :contaminant_threshold_import_standalone_transaction
COMMIT;
\endif
