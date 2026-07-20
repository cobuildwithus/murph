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

DROP TABLE IF EXISTS product_contaminant_threshold_applications;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contaminant_thresholds'
      AND column_name = 'comparison_scope'
  ) THEN
    UPDATE contaminant_thresholds
    SET active = false
    WHERE active IS DISTINCT FROM false;
  END IF;
END $$;

ALTER TABLE contaminant_thresholds
  DROP COLUMN IF EXISTS comparison_scope;

UPDATE contaminant_thresholds
SET
  normalized_value = NULL,
  normalized_unit = NULL,
  normalized_basis = NULL
WHERE NOT (
    threshold_basis = 'product_mass'
    AND threshold_unit IN ('ppm', 'mg/kg', 'ppb', 'ug/kg', 'ng/g', 'mg/kg-dry')
  )
  AND (
    normalized_value IS NOT NULL
    OR normalized_unit IS NOT NULL
    OR normalized_basis IS NOT NULL
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

UPDATE contaminant_thresholds versioned_thresholds
SET active = false
WHERE versioned_thresholds.id LIKE 'eu_2023_915_%'
  AND versioned_thresholds.id ~ '_[0-9]{8}_v[0-9]{8}$'
  AND versioned_thresholds.active IS DISTINCT FROM false;

DROP INDEX IF EXISTS contaminant_thresholds_active_comparable_idx;
DROP INDEX IF EXISTS contaminant_thresholds_active_guidance_idx;

CREATE INDEX IF NOT EXISTS contaminant_thresholds_active_comparable_idx
  ON contaminant_thresholds (
    contaminant_key,
    normalized_unit,
    normalized_basis
  )
  WHERE active AND normalized_value IS NOT NULL;

CREATE INDEX IF NOT EXISTS contaminant_thresholds_active_guidance_idx
  ON contaminant_thresholds (
    contaminant_key,
    threshold_unit,
    threshold_basis
  )
  WHERE active;

DROP INDEX IF EXISTS contaminant_thresholds_active_identity_idx;
DROP INDEX IF EXISTS contaminant_thresholds_lookup_idx;

ALTER TABLE IF EXISTS foods
  ADD COLUMN IF NOT EXISTS serving_grams NUMERIC;

ALTER TABLE IF EXISTS supplements
  ADD COLUMN IF NOT EXISTS serving_grams NUMERIC;

CREATE OR REPLACE FUNCTION murph_product_test_valid_gtin(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN candidate !~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'
      THEN false
    ELSE right(candidate, 1)::integer = (
      10 - (
        SELECT sum(
          substring(candidate FROM position FOR 1)::integer
          * CASE
              WHEN (length(candidate) - position) % 2 = 1 THEN 3
              ELSE 1
            END
        )
        FROM generate_series(1, length(candidate) - 1) positions(position)
      ) % 10
    ) % 10
  END
$$;

CREATE OR REPLACE FUNCTION murph_product_test_canonical_gtin(candidate TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN candidate ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'
      AND right(candidate, 1)::integer = (
        10 - (
          SELECT sum(
            substring(candidate FROM position FOR 1)::integer
            * CASE
                WHEN (length(candidate) - position) % 2 = 1 THEN 3
                ELSE 1
              END
          )
          FROM generate_series(1, length(candidate) - 1) positions(position)
        ) % 10
      ) % 10
    THEN lpad(candidate, 14, '0')
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION murph_product_test_legacy_source_backed_origin(
  candidate TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT candidate IN (
    'plasticlist_bay_area_2024',
    'nyc_dohmh_consumer_products',
    'king_county_consumer_products',
    'pure_earth_rms_2024'
  )
$$;

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
  tested_product_upc_raw TEXT,
  tested_source_product_id TEXT,
  evidence_type TEXT NOT NULL DEFAULT 'laboratory_measurement',
  sampling_context TEXT NOT NULL DEFAULT 'unspecified',
  source_sample_id TEXT,
  source_sample_count INTEGER,
  tested_lot_code TEXT,
  tested_best_by TEXT,
  tested_package_size TEXT,
  collected_on DATE,
  tested_on DATE,
  match_method TEXT NOT NULL,
  contaminant_key TEXT NOT NULL,
  contaminant_name TEXT NOT NULL,
  result_operator TEXT NOT NULL,
  result_value NUMERIC,
  result_upper_value NUMERIC,
  result_unit TEXT NOT NULL,
  result_basis TEXT NOT NULL,
  normalized_value NUMERIC,
  normalized_upper_value NUMERIC,
  normalized_unit TEXT,
  normalized_basis TEXT,
  result_qualifier TEXT,
  detection_limit_value NUMERIC,
  detection_limit_unit TEXT,
  quantification_limit_value NUMERIC,
  quantification_limit_unit TEXT,
  reporting_limit_value NUMERIC,
  reporting_limit_unit TEXT,
  uncertainty_value NUMERIC,
  uncertainty_unit TEXT,
  lab_name TEXT,
  test_method TEXT,
  remap_revision BIGINT NOT NULL DEFAULT 0,
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
    CHECK (
      tested_product_upc IS NULL
      OR murph_product_test_valid_gtin(tested_product_upc)
    ),
  CONSTRAINT product_tests_tested_product_upc_raw_check
    CHECK (tested_product_upc_raw IS NULL OR btrim(tested_product_upc_raw) <> ''),
  CONSTRAINT product_tests_tested_source_product_id_check
    CHECK (tested_source_product_id IS NULL OR btrim(tested_source_product_id) <> ''),
  CONSTRAINT product_tests_evidence_type_check
    CHECK (
      evidence_type IN (
        'laboratory_measurement',
        'regulatory_laboratory',
        'regulatory_finding',
        'xrf_screening',
        'manufacturer_coa'
      )
    ),
  CONSTRAINT product_tests_sampling_context_check
    CHECK (sampling_context ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT product_tests_source_sample_id_check
    CHECK (source_sample_id IS NULL OR btrim(source_sample_id) <> ''),
  CONSTRAINT product_tests_source_sample_count_check
    CHECK (source_sample_count IS NULL OR source_sample_count > 0),
  CONSTRAINT product_tests_tested_lot_code_check
    CHECK (tested_lot_code IS NULL OR btrim(tested_lot_code) <> ''),
  CONSTRAINT product_tests_tested_best_by_check
    CHECK (tested_best_by IS NULL OR btrim(tested_best_by) <> ''),
  CONSTRAINT product_tests_tested_package_size_check
    CHECK (tested_package_size IS NULL OR btrim(tested_package_size) <> ''),
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
        'range',
        'not_detected',
        'detected',
        'trace'
      )
    ),
  CONSTRAINT product_tests_numeric_operator_value_check
    CHECK (
      result_operator NOT IN ('eq', 'lt', 'lte', 'gt', 'gte', 'range')
      OR result_value IS NOT NULL
    ),
  CONSTRAINT product_tests_result_value_check
    CHECK (result_value IS NULL OR result_value >= 0),
  CONSTRAINT product_tests_result_range_check
    CHECK (
      (
        result_operator = 'range'
        AND result_value IS NOT NULL
        AND result_upper_value IS NOT NULL
        AND result_value <= result_upper_value
      )
      OR (
        result_operator <> 'range'
        AND result_upper_value IS NULL
      )
    ),
  CONSTRAINT product_tests_result_unit_check
    CHECK (btrim(result_unit) <> ''),
  CONSTRAINT product_tests_result_basis_check
    CHECK (btrim(result_basis) <> ''),
  CONSTRAINT product_tests_normalized_triplet_check
    CHECK (
      (
        normalized_value IS NULL
        AND normalized_upper_value IS NULL
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
  CONSTRAINT product_tests_normalized_range_check
    CHECK (
      (
        result_operator = 'range'
        AND (
          (
            normalized_value IS NULL
            AND normalized_upper_value IS NULL
          )
          OR (
            normalized_value IS NOT NULL
            AND normalized_upper_value IS NOT NULL
            AND normalized_value <= normalized_upper_value
          )
        )
      )
      OR (
        result_operator <> 'range'
        AND normalized_upper_value IS NULL
      )
    ),
  CONSTRAINT product_tests_result_qualifier_check
    CHECK (result_qualifier IS NULL OR btrim(result_qualifier) <> ''),
  CONSTRAINT product_tests_detection_limit_check
    CHECK (
      (
        detection_limit_value IS NULL
        AND detection_limit_unit IS NULL
      )
      OR (
        detection_limit_value IS NOT NULL
        AND detection_limit_value >= 0
        AND detection_limit_unit IS NOT NULL
        AND btrim(detection_limit_unit) <> ''
      )
    ),
  CONSTRAINT product_tests_quantification_limit_check
    CHECK (
      (
        quantification_limit_value IS NULL
        AND quantification_limit_unit IS NULL
      )
      OR (
        quantification_limit_value IS NOT NULL
        AND quantification_limit_value >= 0
        AND quantification_limit_unit IS NOT NULL
        AND btrim(quantification_limit_unit) <> ''
      )
    ),
  CONSTRAINT product_tests_reporting_limit_check
    CHECK (
      (
        reporting_limit_value IS NULL
        AND reporting_limit_unit IS NULL
      )
      OR (
        reporting_limit_value IS NOT NULL
        AND reporting_limit_value >= 0
        AND reporting_limit_unit IS NOT NULL
        AND btrim(reporting_limit_unit) <> ''
      )
    ),
  CONSTRAINT product_tests_uncertainty_check
    CHECK (
      (
        uncertainty_value IS NULL
        AND uncertainty_unit IS NULL
      )
      OR (
        uncertainty_value IS NOT NULL
        AND uncertainty_value >= 0
        AND uncertainty_unit IS NOT NULL
        AND btrim(uncertainty_unit) <> ''
      )
    ),
  CONSTRAINT product_tests_lab_name_check
    CHECK (lab_name IS NULL OR btrim(lab_name) <> ''),
  CONSTRAINT product_tests_test_method_check
    CHECK (test_method IS NULL OR btrim(test_method) <> ''),
  CONSTRAINT product_tests_remap_revision_check
    CHECK (remap_revision >= 0)
);

ALTER TABLE product_tests
  ADD COLUMN IF NOT EXISTS evidence_type TEXT
    DEFAULT 'laboratory_measurement',
  ADD COLUMN IF NOT EXISTS sampling_context TEXT
    DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS tested_product_upc_raw TEXT,
  ADD COLUMN IF NOT EXISTS source_sample_id TEXT,
  ADD COLUMN IF NOT EXISTS source_sample_count INTEGER,
  ADD COLUMN IF NOT EXISTS tested_lot_code TEXT,
  ADD COLUMN IF NOT EXISTS tested_best_by TEXT,
  ADD COLUMN IF NOT EXISTS tested_package_size TEXT,
  ADD COLUMN IF NOT EXISTS collected_on DATE,
  ADD COLUMN IF NOT EXISTS tested_on DATE,
  ADD COLUMN IF NOT EXISTS result_upper_value NUMERIC,
  ADD COLUMN IF NOT EXISTS normalized_upper_value NUMERIC,
  ADD COLUMN IF NOT EXISTS result_qualifier TEXT,
  ADD COLUMN IF NOT EXISTS detection_limit_value NUMERIC,
  ADD COLUMN IF NOT EXISTS detection_limit_unit TEXT,
  ADD COLUMN IF NOT EXISTS quantification_limit_value NUMERIC,
  ADD COLUMN IF NOT EXISTS quantification_limit_unit TEXT,
  ADD COLUMN IF NOT EXISTS reporting_limit_value NUMERIC,
  ADD COLUMN IF NOT EXISTS reporting_limit_unit TEXT,
  ADD COLUMN IF NOT EXISTS uncertainty_value NUMERIC,
  ADD COLUMN IF NOT EXISTS uncertainty_unit TEXT,
  ADD COLUMN IF NOT EXISTS remap_revision BIGINT NOT NULL DEFAULT 0;

UPDATE product_tests
SET evidence_type = 'laboratory_measurement'
WHERE evidence_type IS NULL;

UPDATE product_tests
SET sampling_context = 'unspecified'
WHERE sampling_context IS NULL;

UPDATE product_tests grouped_tests
SET
  food_id = NULL,
  supplement_id = NULL,
  match_method = 'source_only',
  remap_revision = (
    SELECT MAX(group_revision.remap_revision)
    FROM product_tests group_revision
    WHERE
      group_revision.source_key = grouped_tests.source_key
      AND (
        (
          grouped_tests.tested_source_product_id IS NOT NULL
          AND group_revision.tested_source_product_id
            = grouped_tests.tested_source_product_id
        )
        OR (
          grouped_tests.tested_source_product_id IS NULL
          AND group_revision.id = grouped_tests.id
        )
      )
  ),
  imported_at = now()
WHERE EXISTS (
  SELECT 1
  FROM product_tests invalid_exact_upc
  WHERE
    invalid_exact_upc.source_key = grouped_tests.source_key
    AND (
      (
        invalid_exact_upc.tested_source_product_id IS NOT NULL
        AND invalid_exact_upc.tested_source_product_id
          = grouped_tests.tested_source_product_id
      )
      OR (
        invalid_exact_upc.tested_source_product_id IS NULL
        AND invalid_exact_upc.id = grouped_tests.id
      )
    )
    AND invalid_exact_upc.match_method = 'exact_upc'
    AND invalid_exact_upc.tested_product_upc IS NOT NULL
    AND NOT murph_product_test_valid_gtin(
      invalid_exact_upc.tested_product_upc
    )
);

UPDATE product_tests
SET
  tested_product_upc_raw = COALESCE(
    NULLIF(btrim(tested_product_upc_raw), ''),
    btrim(tested_product_upc)
  ),
  tested_product_upc = CASE
    WHEN murph_product_test_valid_gtin(btrim(tested_product_upc))
      THEN btrim(tested_product_upc)
    ELSE NULL
  END
WHERE
  tested_product_upc IS NOT NULL
  AND NOT murph_product_test_valid_gtin(tested_product_upc);

ALTER TABLE product_tests
  ALTER COLUMN evidence_type SET DEFAULT 'laboratory_measurement',
  ALTER COLUMN evidence_type SET NOT NULL,
  ALTER COLUMN sampling_context SET DEFAULT 'unspecified',
  ALTER COLUMN sampling_context SET NOT NULL;

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
    CHECK (contaminant_key ~ '^[a-z0-9][a-z0-9_]*$'),
  DROP CONSTRAINT IF EXISTS product_tests_evidence_type_check,
  ADD CONSTRAINT product_tests_evidence_type_check
    CHECK (
      evidence_type IN (
        'laboratory_measurement',
        'regulatory_laboratory',
        'regulatory_finding',
        'xrf_screening',
        'manufacturer_coa'
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_sampling_context_check,
  ADD CONSTRAINT product_tests_sampling_context_check
    CHECK (sampling_context ~ '^[a-z][a-z0-9_]*$'),
  DROP CONSTRAINT IF EXISTS product_tests_source_sample_id_check,
  ADD CONSTRAINT product_tests_source_sample_id_check
    CHECK (source_sample_id IS NULL OR btrim(source_sample_id) <> ''),
  DROP CONSTRAINT IF EXISTS product_tests_tested_product_upc_check,
  ADD CONSTRAINT product_tests_tested_product_upc_check
    CHECK (
      tested_product_upc IS NULL
      OR murph_product_test_valid_gtin(tested_product_upc)
    ),
  DROP CONSTRAINT IF EXISTS product_tests_tested_product_upc_raw_check,
  ADD CONSTRAINT product_tests_tested_product_upc_raw_check
    CHECK (tested_product_upc_raw IS NULL OR btrim(tested_product_upc_raw) <> ''),
  DROP CONSTRAINT IF EXISTS product_tests_source_sample_count_check,
  ADD CONSTRAINT product_tests_source_sample_count_check
    CHECK (source_sample_count IS NULL OR source_sample_count > 0),
  DROP CONSTRAINT IF EXISTS product_tests_remap_revision_check,
  ADD CONSTRAINT product_tests_remap_revision_check
    CHECK (remap_revision >= 0),
  DROP CONSTRAINT IF EXISTS product_tests_tested_lot_code_check,
  ADD CONSTRAINT product_tests_tested_lot_code_check
    CHECK (tested_lot_code IS NULL OR btrim(tested_lot_code) <> ''),
  DROP CONSTRAINT IF EXISTS product_tests_tested_best_by_check,
  ADD CONSTRAINT product_tests_tested_best_by_check
    CHECK (tested_best_by IS NULL OR btrim(tested_best_by) <> ''),
  DROP CONSTRAINT IF EXISTS product_tests_tested_package_size_check,
  ADD CONSTRAINT product_tests_tested_package_size_check
    CHECK (tested_package_size IS NULL OR btrim(tested_package_size) <> ''),
  DROP CONSTRAINT IF EXISTS product_tests_result_operator_check,
  ADD CONSTRAINT product_tests_result_operator_check
    CHECK (
      result_operator IN (
        'eq',
        'lt',
        'lte',
        'gt',
        'gte',
        'range',
        'not_detected',
        'detected',
        'trace'
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_numeric_operator_value_check,
  ADD CONSTRAINT product_tests_numeric_operator_value_check
    CHECK (
      result_operator NOT IN ('eq', 'lt', 'lte', 'gt', 'gte', 'range')
      OR result_value IS NOT NULL
    ),
  DROP CONSTRAINT IF EXISTS product_tests_result_range_check,
  ADD CONSTRAINT product_tests_result_range_check
    CHECK (
      (
        result_operator = 'range'
        AND result_value IS NOT NULL
        AND result_upper_value IS NOT NULL
        AND result_value <= result_upper_value
      )
      OR (
        result_operator <> 'range'
        AND result_upper_value IS NULL
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_normalized_triplet_check,
  ADD CONSTRAINT product_tests_normalized_triplet_check
    CHECK (
      (
        normalized_value IS NULL
        AND normalized_upper_value IS NULL
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
  DROP CONSTRAINT IF EXISTS product_tests_normalized_range_check,
  ADD CONSTRAINT product_tests_normalized_range_check
    CHECK (
      (
        result_operator = 'range'
        AND (
          (
            normalized_value IS NULL
            AND normalized_upper_value IS NULL
          )
          OR (
            normalized_value IS NOT NULL
            AND normalized_upper_value IS NOT NULL
            AND normalized_value <= normalized_upper_value
          )
        )
      )
      OR (
        result_operator <> 'range'
        AND normalized_upper_value IS NULL
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_result_qualifier_check,
  ADD CONSTRAINT product_tests_result_qualifier_check
    CHECK (result_qualifier IS NULL OR btrim(result_qualifier) <> ''),
  DROP CONSTRAINT IF EXISTS product_tests_detection_limit_check,
  ADD CONSTRAINT product_tests_detection_limit_check
    CHECK (
      (
        detection_limit_value IS NULL
        AND detection_limit_unit IS NULL
      )
      OR (
        detection_limit_value IS NOT NULL
        AND detection_limit_value >= 0
        AND detection_limit_unit IS NOT NULL
        AND btrim(detection_limit_unit) <> ''
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_quantification_limit_check,
  ADD CONSTRAINT product_tests_quantification_limit_check
    CHECK (
      (
        quantification_limit_value IS NULL
        AND quantification_limit_unit IS NULL
      )
      OR (
        quantification_limit_value IS NOT NULL
        AND quantification_limit_value >= 0
        AND quantification_limit_unit IS NOT NULL
        AND btrim(quantification_limit_unit) <> ''
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_reporting_limit_check,
  ADD CONSTRAINT product_tests_reporting_limit_check
    CHECK (
      (
        reporting_limit_value IS NULL
        AND reporting_limit_unit IS NULL
      )
      OR (
        reporting_limit_value IS NOT NULL
        AND reporting_limit_value >= 0
        AND reporting_limit_unit IS NOT NULL
        AND btrim(reporting_limit_unit) <> ''
      )
    ),
  DROP CONSTRAINT IF EXISTS product_tests_uncertainty_check,
  ADD CONSTRAINT product_tests_uncertainty_check
    CHECK (
      (
        uncertainty_value IS NULL
        AND uncertainty_unit IS NULL
      )
      OR (
        uncertainty_value IS NOT NULL
        AND uncertainty_value >= 0
        AND uncertainty_unit IS NOT NULL
        AND btrim(uncertainty_unit) <> ''
      )
    );

CREATE INDEX IF NOT EXISTS product_tests_source_key_idx
  ON product_tests (source_key);

UPDATE product_tests grouped_tests
SET
  food_id = NULL,
  supplement_id = NULL,
  match_method = 'source_only',
  remap_revision = (
    SELECT MAX(group_revision.remap_revision)
    FROM product_tests group_revision
    WHERE
      group_revision.source_key = grouped_tests.source_key
      AND (
        (
          grouped_tests.tested_source_product_id IS NOT NULL
          AND group_revision.tested_source_product_id
            = grouped_tests.tested_source_product_id
        )
        OR (
          grouped_tests.tested_source_product_id IS NULL
          AND group_revision.id = grouped_tests.id
        )
      )
  )
WHERE EXISTS (
  SELECT 1
  FROM product_tests legacy_target
  WHERE
    legacy_target.source_key = grouped_tests.source_key
    AND (
      (
        grouped_tests.tested_source_product_id IS NOT NULL
        AND legacy_target.tested_source_product_id
          = grouped_tests.tested_source_product_id
      )
      OR (
        grouped_tests.tested_source_product_id IS NULL
        AND legacy_target.id = grouped_tests.id
      )
    )
    AND (
      (
        legacy_target.food_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM foods source_food
          WHERE
            source_food.id = legacy_target.food_id
            AND murph_product_test_legacy_source_backed_origin(
              source_food.data_origin
            )
        )
      )
      OR (
        legacy_target.supplement_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM supplements source_supplement
          WHERE
            source_supplement.id = legacy_target.supplement_id
            AND murph_product_test_legacy_source_backed_origin(
              source_supplement.data_origin
            )
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
  normalized_upper_value = CASE
    WHEN normalized_upper_value IS NULL THEN NULL
    WHEN normalized_unit IN ('ppm', 'mg/kg') THEN normalized_upper_value
    WHEN normalized_unit IN ('ppb', 'ug/kg', 'ng/g') THEN normalized_upper_value / 1000
    ELSE normalized_upper_value
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
WHERE murph_product_test_legacy_source_backed_origin(foods.data_origin)
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.food_id = foods.id
  );

DELETE FROM supplements
WHERE murph_product_test_legacy_source_backed_origin(supplements.data_origin)
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.supplement_id = supplements.id
  );
