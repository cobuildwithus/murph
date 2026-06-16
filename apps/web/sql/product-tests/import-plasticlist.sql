\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE plasticlist_product_tests_import (
  id TEXT NOT NULL,
  food_id TEXT,
  supplement_id TEXT,
  source_key TEXT NOT NULL,
  source_result_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_report_title TEXT,
  report_date TEXT,
  tested_product_name TEXT,
  tested_product_brand TEXT,
  tested_product_upc TEXT,
  tested_source_product_id TEXT,
  match_method TEXT NOT NULL,
  explicit_match BOOLEAN NOT NULL,
  contaminant_key TEXT NOT NULL,
  contaminant_name TEXT NOT NULL,
  result_operator TEXT NOT NULL,
  result_value TEXT,
  result_unit TEXT NOT NULL,
  result_basis TEXT NOT NULL,
  normalized_value TEXT,
  normalized_unit TEXT,
  normalized_basis TEXT,
  lab_name TEXT,
  test_method TEXT
) ON COMMIT DROP;

\copy plasticlist_product_tests_import FROM __PRODUCT_TESTS_TSV__ WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

SELECT pg_advisory_xact_lock(
  hashtext('murph:plasticlist_bay_area_2024:import')::bigint
);

CREATE TEMP TABLE plasticlist_import_options ON COMMIT DROP AS
  SELECT
    :'replace_source'::boolean AS replace_source,
    NULLIF(:'replace_source_expected_product_test_rows', '')::integer
      AS replace_source_expected_product_test_rows;

DO $$
DECLARE
  expected_product_test_rows integer;
  imported_product_test_rows integer;
BEGIN
  SELECT replace_source_expected_product_test_rows INTO expected_product_test_rows
  FROM plasticlist_import_options;

  IF (SELECT replace_source FROM plasticlist_import_options) THEN
    SELECT COUNT(*) INTO imported_product_test_rows
    FROM plasticlist_product_tests_import;

    IF expected_product_test_rows IS NULL
      OR imported_product_test_rows <> expected_product_test_rows
    THEN
      RAISE EXCEPTION
        'PlasticList replace-source product test row count mismatch: expected %, imported %',
        expected_product_test_rows,
        imported_product_test_rows;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM plasticlist_product_tests_import tests
    WHERE
      (
        NULLIF(tests.food_id, '') IS NULL
        AND NULLIF(tests.supplement_id, '') IS NULL
      ) <> (tests.match_method = 'source_only')
  ) THEN
    RAISE EXCEPTION 'PlasticList source-only rows must have no product link, and linked rows must not use source_only';
  END IF;
END $$;

DELETE FROM product_tests
WHERE
  (SELECT replace_source FROM plasticlist_import_options)
  AND
  source_key = 'plasticlist_bay_area_2024'
  AND NOT EXISTS (
    SELECT 1
    FROM plasticlist_product_tests_import current_import
    WHERE
      current_import.source_key = product_tests.source_key
      AND current_import.source_result_id = product_tests.source_result_id
      AND current_import.contaminant_key = product_tests.contaminant_key
  );

INSERT INTO product_tests (
  id,
  food_id,
  supplement_id,
  source_key,
  source_result_id,
  source_name,
  source_url,
  source_report_title,
  report_date,
  tested_product_name,
  tested_product_brand,
  tested_product_upc,
  tested_source_product_id,
  match_method,
  contaminant_key,
  contaminant_name,
  result_operator,
  result_value,
  result_unit,
  result_basis,
  normalized_value,
  normalized_unit,
  normalized_basis,
  lab_name,
  test_method
)
SELECT
  id,
  NULLIF(food_id, ''),
  NULLIF(supplement_id, ''),
  source_key,
  source_result_id,
  source_name,
  NULLIF(source_url, ''),
  NULLIF(source_report_title, ''),
  NULLIF(report_date, '')::date,
  NULLIF(tested_product_name, ''),
  NULLIF(tested_product_brand, ''),
  NULLIF(tested_product_upc, ''),
  NULLIF(tested_source_product_id, ''),
  match_method,
  contaminant_key,
  contaminant_name,
  result_operator,
  NULLIF(result_value, '')::numeric,
  result_unit,
  result_basis,
  NULLIF(normalized_value, '')::numeric,
  NULLIF(normalized_unit, ''),
  NULLIF(normalized_basis, ''),
  NULLIF(lab_name, ''),
  NULLIF(test_method, '')
FROM plasticlist_product_tests_import
ON CONFLICT (source_key, source_result_id, contaminant_key)
DO UPDATE SET
  id = EXCLUDED.id,
  food_id = CASE
    WHEN (SELECT replace_source FROM plasticlist_import_options) OR (
      SELECT current_import.explicit_match
      FROM plasticlist_product_tests_import current_import
      WHERE
        current_import.source_key = EXCLUDED.source_key
        AND current_import.source_result_id = EXCLUDED.source_result_id
        AND current_import.contaminant_key = EXCLUDED.contaminant_key
      LIMIT 1
    ) OR (
      product_tests.supplement_id IS NULL
      AND product_tests.match_method = 'exact_source_id'
      AND product_tests.food_id LIKE 'plasticlist_bay_area_2024:%'
    ) THEN EXCLUDED.food_id
    ELSE product_tests.food_id
  END,
  supplement_id = CASE
    WHEN (SELECT replace_source FROM plasticlist_import_options) OR (
      SELECT current_import.explicit_match
      FROM plasticlist_product_tests_import current_import
      WHERE
        current_import.source_key = EXCLUDED.source_key
        AND current_import.source_result_id = EXCLUDED.source_result_id
        AND current_import.contaminant_key = EXCLUDED.contaminant_key
      LIMIT 1
    ) OR (
      product_tests.supplement_id IS NULL
      AND product_tests.match_method = 'exact_source_id'
      AND product_tests.food_id LIKE 'plasticlist_bay_area_2024:%'
    ) THEN EXCLUDED.supplement_id
    ELSE product_tests.supplement_id
  END,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  source_report_title = EXCLUDED.source_report_title,
  report_date = EXCLUDED.report_date,
  tested_product_name = EXCLUDED.tested_product_name,
  tested_product_brand = EXCLUDED.tested_product_brand,
  tested_product_upc = EXCLUDED.tested_product_upc,
  tested_source_product_id = EXCLUDED.tested_source_product_id,
  match_method = CASE
    WHEN (SELECT replace_source FROM plasticlist_import_options) OR (
      SELECT current_import.explicit_match
      FROM plasticlist_product_tests_import current_import
      WHERE
        current_import.source_key = EXCLUDED.source_key
        AND current_import.source_result_id = EXCLUDED.source_result_id
        AND current_import.contaminant_key = EXCLUDED.contaminant_key
      LIMIT 1
    ) OR (
      product_tests.supplement_id IS NULL
      AND product_tests.match_method = 'exact_source_id'
      AND product_tests.food_id LIKE 'plasticlist_bay_area_2024:%'
    ) THEN EXCLUDED.match_method
    ELSE product_tests.match_method
  END,
  contaminant_name = EXCLUDED.contaminant_name,
  result_operator = EXCLUDED.result_operator,
  result_value = EXCLUDED.result_value,
  result_unit = EXCLUDED.result_unit,
  result_basis = EXCLUDED.result_basis,
  normalized_value = EXCLUDED.normalized_value,
  normalized_unit = EXCLUDED.normalized_unit,
  normalized_basis = EXCLUDED.normalized_basis,
  lab_name = EXCLUDED.lab_name,
  test_method = EXCLUDED.test_method,
  imported_at = now();

DELETE FROM foods
WHERE
  data_origin = 'plasticlist_bay_area_2024'
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.food_id = foods.id
  );

COMMIT;
