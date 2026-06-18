\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:open_product_sources:import'));

CREATE TEMP TABLE open_product_sources_product_tests_import (
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

\copy open_product_sources_product_tests_import FROM __PRODUCT_TESTS_CSV__ WITH (FORMAT csv, HEADER true, NULL '')

CREATE TEMP TABLE open_product_sources_import_options ON COMMIT DROP AS
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
  FROM open_product_sources_import_options;

  IF (SELECT replace_source FROM open_product_sources_import_options) THEN
    SELECT COUNT(*) INTO imported_product_test_rows
    FROM open_product_sources_product_tests_import;

    IF expected_product_test_rows IS NULL
      OR imported_product_test_rows <> expected_product_test_rows
    THEN
      RAISE EXCEPTION
        'Open product sources replace-source product test row count mismatch: expected %, imported %',
        expected_product_test_rows,
        imported_product_test_rows;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM open_product_sources_product_tests_import) THEN
    RAISE EXCEPTION 'open product source import prepared zero product test rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM open_product_sources_product_tests_import tests
    WHERE
      NULLIF(tests.food_id, '') IS NOT NULL
      OR NULLIF(tests.supplement_id, '') IS NOT NULL
      OR tests.match_method <> 'source_only'
  ) THEN
    RAISE EXCEPTION 'open product source test rows must import as source_only with no product link';
  END IF;
END $$;

UPDATE product_tests tests
SET
  food_id = NULL,
  supplement_id = NULL,
  match_method = 'source_only',
  imported_at = now()
FROM (
  SELECT DISTINCT source_key
  FROM open_product_sources_product_tests_import
) imported_sources
WHERE
  (SELECT replace_source FROM open_product_sources_import_options)
  AND tests.source_key = imported_sources.source_key
  AND NOT EXISTS (
    SELECT 1
    FROM open_product_sources_product_tests_import current_import
    WHERE
      current_import.source_key = tests.source_key
      AND current_import.source_result_id = tests.source_result_id
      AND current_import.contaminant_key = tests.contaminant_key
  )
  AND (
    tests.match_method <> 'source_only'
    OR tests.food_id IS NOT NULL
    OR tests.supplement_id IS NOT NULL
  );

UPDATE product_tests tests
SET
  food_id = NULL,
  supplement_id = NULL,
  match_method = 'source_only',
  imported_at = now()
FROM open_product_sources_product_tests_import current_import
WHERE
  tests.source_key = current_import.source_key
  AND tests.source_result_id = current_import.source_result_id
  AND tests.contaminant_key = current_import.contaminant_key
  AND NOT (
    tests.tested_source_product_id IS NOT DISTINCT FROM NULLIF(current_import.tested_source_product_id, '')
    AND tests.tested_product_name IS NOT DISTINCT FROM NULLIF(current_import.tested_product_name, '')
    AND tests.tested_product_brand IS NOT DISTINCT FROM NULLIF(current_import.tested_product_brand, '')
    AND tests.tested_product_upc IS NOT DISTINCT FROM NULLIF(current_import.tested_product_upc, '')
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
FROM open_product_sources_product_tests_import
ON CONFLICT (source_key, source_result_id, contaminant_key)
DO UPDATE SET
  id = EXCLUDED.id,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  source_report_title = EXCLUDED.source_report_title,
  report_date = EXCLUDED.report_date,
  tested_product_name = EXCLUDED.tested_product_name,
  tested_product_brand = EXCLUDED.tested_product_brand,
  tested_product_upc = EXCLUDED.tested_product_upc,
  tested_source_product_id = EXCLUDED.tested_source_product_id,
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_tests tests
    WHERE
      tests.source_key IN (
        SELECT DISTINCT source_key
        FROM open_product_sources_product_tests_import
      )
      AND tests.match_method = 'source_only'
      AND (
        tests.food_id IS NOT NULL
        OR tests.supplement_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'open product source source_only row retained a product link';
  END IF;
END $$;

COMMIT;
