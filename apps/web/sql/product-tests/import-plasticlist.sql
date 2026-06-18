\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE source_only_product_tests_import (
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

\copy source_only_product_tests_import FROM __PRODUCT_TESTS_TSV__ WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

\i apps/web/sql/product-tests/import-source-only-product-tests-body.sql

DELETE FROM foods
WHERE
  data_origin = 'plasticlist_bay_area_2024'
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.food_id = foods.id
  );

COMMIT;
