CREATE TABLE IF NOT EXISTS contaminant_thresholds (
  id TEXT PRIMARY KEY,
  contaminant_key TEXT NOT NULL,
  contaminant_name TEXT NOT NULL,
  authority_key TEXT NOT NULL,
  authority_name TEXT NOT NULL,
  authority_url TEXT,
  threshold_value NUMERIC NOT NULL,
  threshold_unit TEXT NOT NULL,
  threshold_basis TEXT NOT NULL,
  concern_level_if_exceeded TEXT NOT NULL,
  effective_on DATE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT contaminant_thresholds_id_check
    CHECK (btrim(id) <> ''),
  CONSTRAINT contaminant_thresholds_contaminant_key_check
    CHECK (contaminant_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT contaminant_thresholds_contaminant_name_check
    CHECK (btrim(contaminant_name) <> ''),
  CONSTRAINT contaminant_thresholds_authority_key_check
    CHECK (authority_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT contaminant_thresholds_authority_name_check
    CHECK (btrim(authority_name) <> ''),
  CONSTRAINT contaminant_thresholds_authority_url_check
    CHECK (authority_url IS NULL OR btrim(authority_url) <> ''),
  CONSTRAINT contaminant_thresholds_threshold_value_check
    CHECK (threshold_value > 0),
  CONSTRAINT contaminant_thresholds_threshold_unit_check
    CHECK (btrim(threshold_unit) <> ''),
  CONSTRAINT contaminant_thresholds_threshold_basis_check
    CHECK (btrim(threshold_basis) <> ''),
  CONSTRAINT contaminant_thresholds_concern_level_check
    CHECK (concern_level_if_exceeded IN ('low', 'medium', 'high'))
);

CREATE UNIQUE INDEX IF NOT EXISTS contaminant_thresholds_active_identity_idx
  ON contaminant_thresholds (
    contaminant_key,
    authority_key,
    threshold_unit,
    threshold_basis,
    COALESCE(effective_on, DATE '0001-01-01')
  )
  WHERE active;

CREATE INDEX IF NOT EXISTS contaminant_thresholds_lookup_idx
  ON contaminant_thresholds (contaminant_key, threshold_unit, threshold_basis)
  WHERE active;

CREATE TABLE IF NOT EXISTS product_tests (
  id TEXT PRIMARY KEY,
  food_id TEXT REFERENCES foods(id) ON DELETE CASCADE,
  supplement_id TEXT REFERENCES supplements(id) ON DELETE CASCADE,
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
      ) = 1
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
        'manual_confirmed'
      )
    ),
  CONSTRAINT product_tests_contaminant_key_check
    CHECK (contaminant_key ~ '^[a-z][a-z0-9_]*$'),
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

CREATE INDEX IF NOT EXISTS product_tests_food_idx
  ON product_tests (food_id)
  WHERE food_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_tests_supplement_idx
  ON product_tests (supplement_id)
  WHERE supplement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_tests_contaminant_idx
  ON product_tests (contaminant_key);

CREATE INDEX IF NOT EXISTS product_tests_report_date_idx
  ON product_tests (report_date)
  WHERE report_date IS NOT NULL;
