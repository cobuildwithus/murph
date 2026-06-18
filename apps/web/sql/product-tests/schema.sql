CREATE TABLE IF NOT EXISTS contaminant_thresholds (
  id TEXT PRIMARY KEY,
  contaminant_key TEXT NOT NULL,
  threshold_name TEXT NOT NULL,
  authority_key TEXT NOT NULL,
  authority_name TEXT NOT NULL,
  threshold_url TEXT,
  threshold_value NUMERIC NOT NULL,
  threshold_unit TEXT NOT NULL,
  threshold_basis TEXT NOT NULL,
  normalized_value NUMERIC,
  normalized_unit TEXT,
  normalized_basis TEXT,
  concern_level_if_exceeded TEXT NOT NULL,
  effective_on DATE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT contaminant_thresholds_id_check
    CHECK (btrim(id) <> ''),
  CONSTRAINT contaminant_thresholds_contaminant_key_check
    CHECK (contaminant_key ~ '^[a-z0-9][a-z0-9_]*$'),
  CONSTRAINT contaminant_thresholds_threshold_name_check
    CHECK (btrim(threshold_name) <> ''),
  CONSTRAINT contaminant_thresholds_authority_key_check
    CHECK (authority_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT contaminant_thresholds_authority_name_check
    CHECK (btrim(authority_name) <> ''),
  CONSTRAINT contaminant_thresholds_threshold_url_check
    CHECK (threshold_url IS NULL OR btrim(threshold_url) <> ''),
  CONSTRAINT contaminant_thresholds_threshold_value_check
    CHECK (threshold_value > 0),
  CONSTRAINT contaminant_thresholds_threshold_unit_check
    CHECK (btrim(threshold_unit) <> ''),
  CONSTRAINT contaminant_thresholds_threshold_basis_check
    CHECK (btrim(threshold_basis) <> ''),
  CONSTRAINT contaminant_thresholds_normalized_triplet_check
    CHECK (
      (
        normalized_value IS NULL
        AND normalized_unit IS NULL
        AND normalized_basis IS NULL
      )
      OR (
        normalized_value IS NOT NULL
        AND normalized_unit IS NOT NULL
        AND normalized_basis IS NOT NULL
        AND btrim(normalized_unit) <> ''
        AND btrim(normalized_basis) <> ''
      )
    ),
  CONSTRAINT contaminant_thresholds_normalized_value_check
    CHECK (normalized_value IS NULL OR normalized_value > 0),
  CONSTRAINT contaminant_thresholds_concern_level_check
    CHECK (concern_level_if_exceeded IN ('low', 'medium', 'high'))
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'contaminant_thresholds'
      AND column_name = 'contaminant_name'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'contaminant_thresholds'
      AND column_name = 'threshold_name'
  ) THEN
    ALTER TABLE contaminant_thresholds
      RENAME COLUMN contaminant_name TO threshold_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'contaminant_thresholds'
      AND column_name = 'authority_url'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'contaminant_thresholds'
      AND column_name = 'threshold_url'
  ) THEN
    ALTER TABLE contaminant_thresholds
      RENAME COLUMN authority_url TO threshold_url;
  END IF;
END $$;

ALTER TABLE contaminant_thresholds
  ADD COLUMN IF NOT EXISTS normalized_value NUMERIC,
  ADD COLUMN IF NOT EXISTS normalized_unit TEXT,
  ADD COLUMN IF NOT EXISTS normalized_basis TEXT;

UPDATE contaminant_thresholds
SET
  normalized_value = CASE
    WHEN threshold_unit IN ('ppm', 'mg/kg') THEN threshold_value
    WHEN threshold_unit IN ('ppb', 'ug/kg', 'ng/g') THEN threshold_value / 1000
    WHEN threshold_unit = 'mg/kg-dry' THEN threshold_value
    ELSE normalized_value
  END,
  normalized_unit = CASE
    WHEN threshold_unit = 'mg/kg-dry' THEN 'mg/kg-dry'
    ELSE 'ppm'
  END,
  normalized_basis = 'product_mass'
WHERE threshold_basis = 'product_mass'
  AND threshold_unit IN ('ppm', 'mg/kg', 'ppb', 'ug/kg', 'ng/g', 'mg/kg-dry')
  AND (
    normalized_value IS DISTINCT FROM CASE
      WHEN threshold_unit IN ('ppm', 'mg/kg') THEN threshold_value
      WHEN threshold_unit IN ('ppb', 'ug/kg', 'ng/g') THEN threshold_value / 1000
      WHEN threshold_unit = 'mg/kg-dry' THEN threshold_value
      ELSE normalized_value
    END
    OR normalized_unit IS DISTINCT FROM CASE
      WHEN threshold_unit = 'mg/kg-dry' THEN 'mg/kg-dry'
      ELSE 'ppm'
    END
    OR normalized_basis IS DISTINCT FROM 'product_mass'
  );

ALTER TABLE contaminant_thresholds
  DROP CONSTRAINT IF EXISTS contaminant_thresholds_contaminant_key_check,
  ADD CONSTRAINT contaminant_thresholds_contaminant_key_check
    CHECK (contaminant_key ~ '^[a-z0-9][a-z0-9_]*$');

ALTER TABLE contaminant_thresholds
  DROP CONSTRAINT IF EXISTS contaminant_thresholds_normalized_triplet_check,
  ADD CONSTRAINT contaminant_thresholds_normalized_triplet_check
    CHECK (
      (
        normalized_value IS NULL
        AND normalized_unit IS NULL
        AND normalized_basis IS NULL
      )
      OR (
        normalized_value IS NOT NULL
        AND normalized_unit IS NOT NULL
        AND normalized_basis IS NOT NULL
        AND btrim(normalized_unit) <> ''
        AND btrim(normalized_basis) <> ''
      )
    ),
  DROP CONSTRAINT IF EXISTS contaminant_thresholds_normalized_value_check,
  ADD CONSTRAINT contaminant_thresholds_normalized_value_check
    CHECK (normalized_value IS NULL OR normalized_value > 0);

DO $$
DECLARE
  duplicate_keys TEXT;
BEGIN
  SELECT string_agg(duplicate_key, ', ' ORDER BY duplicate_key)
  INTO duplicate_keys
  FROM (
    SELECT
      contaminant_key || ':' || normalized_unit || ':' || normalized_basis AS duplicate_key
    FROM contaminant_thresholds
    WHERE active AND normalized_value IS NOT NULL
    GROUP BY contaminant_key, normalized_unit, normalized_basis
    HAVING COUNT(*) > 1
  ) duplicate_normalized_thresholds;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'duplicate active normalized contaminant thresholds; resolve before creating comparable threshold index: %',
      duplicate_keys;
  END IF;
END $$;

DROP INDEX IF EXISTS contaminant_thresholds_active_comparable_idx;

CREATE UNIQUE INDEX IF NOT EXISTS contaminant_thresholds_active_comparable_idx
  ON contaminant_thresholds (
    contaminant_key,
    normalized_unit,
    normalized_basis
  )
  WHERE active AND normalized_value IS NOT NULL;

DROP INDEX IF EXISTS contaminant_thresholds_active_identity_idx;
DROP INDEX IF EXISTS contaminant_thresholds_lookup_idx;

CREATE TABLE IF NOT EXISTS product_tests (
  id TEXT PRIMARY KEY,
  food_id TEXT REFERENCES foods(id),
  supplement_id TEXT REFERENCES supplements(id),
  source_key TEXT NOT NULL,
  source_result_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_report_title TEXT,
  report_date DATE,
  tested_product_name TEXT,
  tested_product_brand TEXT,
  tested_product_upc TEXT,
  tested_source_product_id TEXT,
  match_method TEXT NOT NULL,
  contaminant_key TEXT NOT NULL,
  contaminant_name TEXT NOT NULL,
  result_operator TEXT NOT NULL,
  result_value NUMERIC,
  result_unit TEXT NOT NULL,
  result_basis TEXT NOT NULL,
  normalized_value NUMERIC,
  normalized_unit TEXT,
  normalized_basis TEXT,
  lab_name TEXT,
  test_method TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_key, source_result_id, contaminant_key),
  CONSTRAINT product_tests_id_check
    CHECK (btrim(id) <> ''),
  CONSTRAINT product_tests_product_link_check
    CHECK (
      (
        CASE WHEN food_id IS NULL THEN 0 ELSE 1 END
        + CASE WHEN supplement_id IS NULL THEN 0 ELSE 1 END
      ) <= 1
    ),
  CONSTRAINT product_tests_source_key_check
    CHECK (source_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT product_tests_source_result_id_check
    CHECK (btrim(source_result_id) <> ''),
  CONSTRAINT product_tests_source_name_check
    CHECK (btrim(source_name) <> ''),
  CONSTRAINT product_tests_source_url_check
    CHECK (source_url IS NULL OR btrim(source_url) <> ''),
  CONSTRAINT product_tests_source_report_title_check
    CHECK (source_report_title IS NULL OR btrim(source_report_title) <> ''),
  CONSTRAINT product_tests_tested_product_name_check
    CHECK (tested_product_name IS NULL OR btrim(tested_product_name) <> ''),
  CONSTRAINT product_tests_tested_product_brand_check
    CHECK (tested_product_brand IS NULL OR btrim(tested_product_brand) <> ''),
  CONSTRAINT product_tests_tested_product_upc_check
    CHECK (tested_product_upc IS NULL OR btrim(tested_product_upc) <> ''),
  CONSTRAINT product_tests_tested_source_product_id_check
    CHECK (tested_source_product_id IS NULL OR btrim(tested_source_product_id) <> ''),
  CONSTRAINT product_tests_match_method_check
    CHECK (
      match_method IN (
        'exact_upc',
        'exact_source_id',
        'manual_confirmed',
        'source_only'
      )
    ),
  CONSTRAINT product_tests_source_only_link_check
    CHECK (
      (
        food_id IS NULL
        AND supplement_id IS NULL
      ) = (match_method = 'source_only')
    ),
  CONSTRAINT product_tests_contaminant_key_check
    CHECK (contaminant_key ~ '^[a-z0-9][a-z0-9_]*$'),
  CONSTRAINT product_tests_contaminant_name_check
    CHECK (btrim(contaminant_name) <> ''),
  CONSTRAINT product_tests_result_operator_check
    CHECK (
      result_operator IN (
        'eq',
        'lt',
        'lte',
        'gt',
        'gte',
        'not_detected',
        'detected',
        'trace'
      )
    ),
  CONSTRAINT product_tests_numeric_operator_value_check
    CHECK (
      result_operator NOT IN ('eq', 'lt', 'lte', 'gt', 'gte')
      OR result_value IS NOT NULL
    ),
  CONSTRAINT product_tests_result_value_check
    CHECK (result_value IS NULL OR result_value >= 0),
  CONSTRAINT product_tests_result_unit_check
    CHECK (btrim(result_unit) <> ''),
  CONSTRAINT product_tests_result_basis_check
    CHECK (btrim(result_basis) <> ''),
  CONSTRAINT product_tests_normalized_triplet_check
    CHECK (
      (
        normalized_value IS NULL
        AND normalized_unit IS NULL
        AND normalized_basis IS NULL
      )
      OR (
        normalized_value IS NOT NULL
        AND normalized_unit IS NOT NULL
        AND normalized_basis IS NOT NULL
        AND btrim(normalized_unit) <> ''
        AND btrim(normalized_basis) <> ''
      )
    ),
  CONSTRAINT product_tests_normalized_value_check
    CHECK (normalized_value IS NULL OR normalized_value >= 0),
  CONSTRAINT product_tests_lab_name_check
    CHECK (lab_name IS NULL OR btrim(lab_name) <> ''),
  CONSTRAINT product_tests_test_method_check
    CHECK (test_method IS NULL OR btrim(test_method) <> '')
);

ALTER TABLE product_tests
  DROP CONSTRAINT IF EXISTS product_tests_food_id_fkey,
  DROP CONSTRAINT IF EXISTS product_tests_supplement_id_fkey,
  ADD CONSTRAINT product_tests_food_id_fkey
    FOREIGN KEY (food_id) REFERENCES foods(id),
  ADD CONSTRAINT product_tests_supplement_id_fkey
    FOREIGN KEY (supplement_id) REFERENCES supplements(id);

ALTER TABLE product_tests
  DROP CONSTRAINT IF EXISTS product_tests_product_link_check,
  ADD CONSTRAINT product_tests_product_link_check
    CHECK (
      (
        CASE WHEN food_id IS NULL THEN 0 ELSE 1 END
        + CASE WHEN supplement_id IS NULL THEN 0 ELSE 1 END
      ) <= 1
    ),
  DROP CONSTRAINT IF EXISTS product_tests_match_method_check,
  ADD CONSTRAINT product_tests_match_method_check
    CHECK (
      match_method IN (
        'exact_upc',
        'exact_source_id',
        'manual_confirmed',
        'source_only'
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_contaminant_key_check,
  ADD CONSTRAINT product_tests_contaminant_key_check
    CHECK (contaminant_key ~ '^[a-z0-9][a-z0-9_]*$');

UPDATE product_tests
SET
  food_id = NULL,
  supplement_id = NULL,
  match_method = 'source_only'
WHERE
  (
    (
      food_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM foods source_food
        WHERE
          source_food.id = product_tests.food_id
          AND source_food.data_origin IN (
            'plasticlist_bay_area_2024',
            'nyc_dohmh_consumer_products',
            'king_county_consumer_products',
            'pure_earth_rms_2024'
          )
      )
    )
    OR (
      supplement_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM supplements source_supplement
        WHERE
          source_supplement.id = product_tests.supplement_id
          AND source_supplement.data_origin IN (
            'plasticlist_bay_area_2024',
            'nyc_dohmh_consumer_products',
            'king_county_consumer_products',
            'pure_earth_rms_2024'
          )
      )
    )
  );

ALTER TABLE product_tests
  DROP CONSTRAINT IF EXISTS product_tests_source_only_link_check,
  ADD CONSTRAINT product_tests_source_only_link_check
    CHECK (
      (
        food_id IS NULL
        AND supplement_id IS NULL
      ) = (match_method = 'source_only')
    );

UPDATE product_tests
SET
  normalized_value = CASE
    WHEN normalized_unit IN ('ppm', 'mg/kg') THEN normalized_value
    WHEN normalized_unit IN ('ppb', 'ug/kg', 'ng/g') THEN normalized_value / 1000
    ELSE normalized_value
  END,
  normalized_unit = 'ppm'
WHERE normalized_basis = 'product_mass'
  AND normalized_value IS NOT NULL
  AND normalized_unit IN ('mg/kg', 'ppb', 'ug/kg', 'ng/g');

CREATE INDEX IF NOT EXISTS product_tests_food_idx
  ON product_tests (food_id)
  WHERE food_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_tests_supplement_idx
  ON product_tests (supplement_id)
  WHERE supplement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_tests_contaminant_idx
  ON product_tests (contaminant_key);

CREATE INDEX IF NOT EXISTS product_tests_source_only_idx
  ON product_tests (source_key, tested_source_product_id)
  WHERE food_id IS NULL AND supplement_id IS NULL;

CREATE INDEX IF NOT EXISTS product_tests_report_date_idx
  ON product_tests (report_date)
  WHERE report_date IS NOT NULL;

DELETE FROM foods
WHERE
  data_origin IN (
    'plasticlist_bay_area_2024',
    'nyc_dohmh_consumer_products',
    'king_county_consumer_products',
    'pure_earth_rms_2024'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.food_id = foods.id
  );

DELETE FROM supplements
WHERE
  data_origin IN (
    'plasticlist_bay_area_2024',
    'nyc_dohmh_consumer_products',
    'king_county_consumer_products',
    'pure_earth_rms_2024'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.supplement_id = supplements.id
  );
