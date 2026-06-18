BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:contaminant_threshold_applications:import'));

CREATE TEMP TABLE product_threshold_applications_import (
  threshold_id TEXT,
  food_id TEXT,
  supplement_id TEXT,
  review_note TEXT
) ON COMMIT DROP;

\copy product_threshold_applications_import FROM __THRESHOLD_APPLICATIONS_TSV__ WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

CREATE TEMP TABLE product_threshold_applications_cleaned AS
  SELECT
    btrim(threshold_id) AS threshold_id,
    NULLIF(btrim(food_id), '') AS food_id,
    NULLIF(btrim(supplement_id), '') AS supplement_id,
    btrim(review_note) AS review_note
  FROM product_threshold_applications_import;

DO $$
DECLARE
  invalid_rows INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO invalid_rows
  FROM product_threshold_applications_cleaned
  WHERE (
    CASE WHEN food_id IS NULL THEN 0 ELSE 1 END
    + CASE WHEN supplement_id IS NULL THEN 0 ELSE 1 END
  ) <> 1
    OR threshold_id IS NULL
    OR threshold_id = ''
    OR review_note IS NULL
    OR review_note = '';

  IF invalid_rows > 0 THEN
    RAISE EXCEPTION
      'product threshold application rows must include threshold_id, review_note, and exactly one food_id or supplement_id';
  END IF;
END $$;

DO $$
DECLARE
  missing_food_ids TEXT;
BEGIN
  SELECT string_agg(DISTINCT current_import.food_id, ', ' ORDER BY current_import.food_id)
  INTO missing_food_ids
  FROM product_threshold_applications_cleaned current_import
  LEFT JOIN foods
    ON foods.id = current_import.food_id
  WHERE current_import.food_id IS NOT NULL
    AND foods.id IS NULL;

  IF missing_food_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'product threshold application row references missing food_id: %',
      missing_food_ids;
  END IF;
END $$;

DO $$
DECLARE
  missing_supplement_ids TEXT;
BEGIN
  SELECT string_agg(DISTINCT current_import.supplement_id, ', ' ORDER BY current_import.supplement_id)
  INTO missing_supplement_ids
  FROM product_threshold_applications_cleaned current_import
  LEFT JOIN supplements
    ON supplements.id = current_import.supplement_id
  WHERE current_import.supplement_id IS NOT NULL
    AND supplements.id IS NULL;

  IF missing_supplement_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'product threshold application row references missing supplement_id: %',
      missing_supplement_ids;
  END IF;
END $$;

DO $$
DECLARE
  missing_threshold_ids TEXT;
BEGIN
  SELECT string_agg(DISTINCT current_import.threshold_id, ', ' ORDER BY current_import.threshold_id)
  INTO missing_threshold_ids
  FROM product_threshold_applications_cleaned current_import
  LEFT JOIN contaminant_thresholds
    ON contaminant_thresholds.id = current_import.threshold_id
  WHERE contaminant_thresholds.id IS NULL;

  IF missing_threshold_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'product threshold application row references missing threshold_id: %',
      missing_threshold_ids;
  END IF;
END $$;

DO $$
DECLARE
  inactive_threshold_ids TEXT;
BEGIN
  SELECT string_agg(DISTINCT current_import.threshold_id, ', ' ORDER BY current_import.threshold_id)
  INTO inactive_threshold_ids
  FROM product_threshold_applications_cleaned current_import
  JOIN contaminant_thresholds
    ON contaminant_thresholds.id = current_import.threshold_id
  WHERE contaminant_thresholds.active IS DISTINCT FROM true;

  IF inactive_threshold_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'product threshold application row references inactive threshold_id: %',
      inactive_threshold_ids;
  END IF;
END $$;

CREATE TEMP TABLE product_threshold_applications_normalized AS
  SELECT
    'threshold_application:' || md5(jsonb_build_array(
      current_import.threshold_id,
      current_import.food_id,
      current_import.supplement_id
    )::text) AS id,
    current_import.threshold_id,
    thresholds.contaminant_key,
    current_import.food_id,
    current_import.supplement_id,
    CASE
      WHEN thresholds.threshold_unit IN ('ppm', 'mg/kg') THEN thresholds.threshold_value
      WHEN thresholds.threshold_unit IN ('ppb', 'ug/kg', 'ng/g') THEN thresholds.threshold_value / 1000
      WHEN thresholds.threshold_unit = 'mg/kg-dry' THEN thresholds.threshold_value
      ELSE NULL
    END AS normalized_value,
    CASE
      WHEN thresholds.threshold_unit = 'mg/kg-dry' THEN 'mg/kg-dry'
      ELSE 'ppm'
    END AS normalized_unit,
    'product_mass' AS normalized_basis,
    current_import.review_note
  FROM product_threshold_applications_cleaned current_import
  JOIN contaminant_thresholds thresholds
    ON thresholds.id = current_import.threshold_id;

DO $$
DECLARE
  cleaned_row_count INTEGER;
  normalized_row_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO cleaned_row_count
  FROM product_threshold_applications_cleaned;

  SELECT COUNT(*)
  INTO normalized_row_count
  FROM product_threshold_applications_normalized;

  IF normalized_row_count <> cleaned_row_count THEN
    RAISE EXCEPTION
      'product threshold application normalization dropped rows before import mutation';
  END IF;
END $$;

DO $$
DECLARE
  unsupported_threshold_ids TEXT;
BEGIN
  SELECT string_agg(DISTINCT current_import.threshold_id, ', ' ORDER BY current_import.threshold_id)
  INTO unsupported_threshold_ids
  FROM product_threshold_applications_cleaned current_import
  LEFT JOIN product_threshold_applications_normalized normalized
    ON normalized.threshold_id = current_import.threshold_id
    AND normalized.food_id IS NOT DISTINCT FROM current_import.food_id
    AND normalized.supplement_id IS NOT DISTINCT FROM current_import.supplement_id
  WHERE normalized.normalized_value IS NULL
    OR normalized.normalized_unit IS NULL;

  IF unsupported_threshold_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'product threshold application row references threshold without supported concentration unit: %',
      unsupported_threshold_ids;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_keys TEXT;
BEGIN
  SELECT string_agg(duplicate_key, ', ' ORDER BY duplicate_key)
  INTO duplicate_keys
  FROM (
    SELECT
      COALESCE(food_id, '') || ':' || COALESCE(supplement_id, '') || ':' || contaminant_key || ':' || normalized_unit || ':' || normalized_basis AS duplicate_key
    FROM product_threshold_applications_normalized
    GROUP BY food_id, supplement_id, contaminant_key, normalized_unit, normalized_basis
    HAVING COUNT(*) > 1
  ) duplicate_product_threshold_applications;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'duplicate product threshold applications for comparable product/contaminant/unit/basis: %',
      duplicate_keys;
  END IF;
END $$;

DELETE FROM product_contaminant_threshold_applications
WHERE id NOT IN (
  SELECT id
  FROM product_threshold_applications_normalized
)
  AND :'replace_applications' = 'true';

DELETE FROM product_contaminant_threshold_applications existing_applications
USING product_threshold_applications_normalized current_import
WHERE existing_applications.id <> current_import.id
  AND existing_applications.threshold_id = current_import.threshold_id
  AND existing_applications.food_id IS NOT DISTINCT FROM current_import.food_id
  AND existing_applications.supplement_id IS NOT DISTINCT FROM current_import.supplement_id;

INSERT INTO product_contaminant_threshold_applications (
  id,
  threshold_id,
  food_id,
  supplement_id,
  review_note
)
SELECT
  id,
  threshold_id,
  food_id,
  supplement_id,
  review_note
FROM product_threshold_applications_normalized
ON CONFLICT (id) DO UPDATE SET
  threshold_id = EXCLUDED.threshold_id,
  food_id = EXCLUDED.food_id,
  supplement_id = EXCLUDED.supplement_id,
  review_note = EXCLUDED.review_note,
  imported_at = now();

DO $$
DECLARE
  duplicate_keys TEXT;
BEGIN
  SELECT string_agg(duplicate_key, ', ' ORDER BY duplicate_key)
  INTO duplicate_keys
  FROM (
    SELECT
      COALESCE(applications.food_id, '') || ':'
        || COALESCE(applications.supplement_id, '') || ':'
        || thresholds.contaminant_key || ':'
        || application_threshold.normalized_unit || ':'
        || application_threshold.normalized_basis AS duplicate_key
    FROM product_contaminant_threshold_applications applications
    JOIN contaminant_thresholds thresholds
      ON thresholds.id = applications.threshold_id
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN thresholds.threshold_unit IN ('ppm', 'mg/kg') THEN thresholds.threshold_value
          WHEN thresholds.threshold_unit IN ('ppb', 'ug/kg', 'ng/g') THEN thresholds.threshold_value / 1000
          WHEN thresholds.threshold_unit = 'mg/kg-dry' THEN thresholds.threshold_value
          ELSE NULL
        END AS normalized_value,
        CASE
          WHEN thresholds.threshold_unit = 'mg/kg-dry' THEN 'mg/kg-dry'
          ELSE 'ppm'
        END AS normalized_unit,
        'product_mass' AS normalized_basis
    ) application_threshold
    WHERE thresholds.active
      AND application_threshold.normalized_value IS NOT NULL
      AND application_threshold.normalized_unit IS NOT NULL
    GROUP BY
      applications.food_id,
      applications.supplement_id,
      thresholds.contaminant_key,
      application_threshold.normalized_unit,
      application_threshold.normalized_basis
    HAVING COUNT(*) > 1
  ) duplicate_product_threshold_applications;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'duplicate product threshold applications after import for comparable product/contaminant/unit/basis: %',
      duplicate_keys;
  END IF;
END $$;

COMMIT;
