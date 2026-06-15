BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:contaminant_thresholds:import'));

CREATE TEMP TABLE contaminant_thresholds_import_options ON COMMIT DROP AS
  SELECT :'replace_missing_authority_thresholds'::boolean AS replace_missing_authority_thresholds;

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

CREATE TEMP TABLE contaminant_thresholds_cleaned AS
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

CREATE TEMP TABLE contaminant_thresholds_normalized AS
  SELECT
    *,
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

DO $$
BEGIN
  IF (
    SELECT replace_missing_authority_thresholds
    FROM contaminant_thresholds_import_options
  ) THEN
    IF (SELECT COUNT(*) FROM contaminant_thresholds_normalized) <> 1290 THEN
      RAISE EXCEPTION 'contaminant threshold complete seed count mismatch; refusing destructive import';
    END IF;

    IF (SELECT COUNT(*) FROM contaminant_thresholds_normalized WHERE authority_key = 'ca_oehha_prop65') <> 355
      OR (SELECT COUNT(*) FROM contaminant_thresholds_normalized WHERE authority_key = 'eu_commission') <> 529
      OR (SELECT COUNT(*) FROM contaminant_thresholds_normalized WHERE authority_key = 'fda') <> 303
      OR (SELECT COUNT(*) FROM contaminant_thresholds_normalized WHERE authority_key = 'fda_cfr') <> 103
    THEN
      RAISE EXCEPTION 'contaminant threshold authority distribution mismatch; refusing destructive import';
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_keys TEXT;
BEGIN
  WITH import_options AS (
    SELECT replace_missing_authority_thresholds
    FROM contaminant_thresholds_import_options
  ),
  imported_authorities AS (
    SELECT DISTINCT authority_key
    FROM contaminant_thresholds_normalized
  ),
  final_active_normalized_thresholds AS (
    SELECT
      id,
      contaminant_key,
      normalized_unit,
      normalized_basis
    FROM contaminant_thresholds
    WHERE active
      AND normalized_value IS NOT NULL
      AND id NOT IN (
        SELECT id
        FROM contaminant_thresholds_normalized
      )
      AND NOT (
        (SELECT replace_missing_authority_thresholds FROM import_options)
        AND authority_key IN (
          SELECT authority_key
          FROM imported_authorities
        )
      )
    UNION ALL
    SELECT
      id,
      contaminant_key,
      normalized_unit,
      normalized_basis
    FROM contaminant_thresholds_normalized
    WHERE active AND normalized_value IS NOT NULL
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

UPDATE contaminant_thresholds
SET
  active = false,
  imported_at = now()
WHERE :'replace_missing_authority_thresholds' = 'true'
  AND active = true
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

COMMIT;
