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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM open_product_sources_product_tests_import) THEN
    RAISE EXCEPTION 'open product source import prepared zero product test rows';
  END IF;

  IF (SELECT COUNT(*) FROM open_product_sources_product_tests_import) <> 8147 THEN
    RAISE EXCEPTION 'open product source product test seed count mismatch; refusing destructive import';
  END IF;

  IF (SELECT COUNT(*) FROM open_product_sources_product_tests_import WHERE source_key = 'nyc_dohmh_consumer_products') <> 6230
    OR (SELECT COUNT(*) FROM open_product_sources_product_tests_import WHERE source_key = 'king_county_consumer_products') <> 277
    OR (SELECT COUNT(*) FROM open_product_sources_product_tests_import WHERE source_key = 'pure_earth_rms_2024') <> 1640
  THEN
    RAISE EXCEPTION 'open product source product test source distribution mismatch; refusing destructive import';
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

DELETE FROM product_tests
WHERE
  source_key IN (
    SELECT DISTINCT source_key
    FROM open_product_sources_product_tests_import
  )
  AND NOT EXISTS (
    SELECT 1
    FROM open_product_sources_product_tests_import current_import
    WHERE
      current_import.source_key = product_tests.source_key
      AND current_import.source_result_id = product_tests.source_result_id
      AND current_import.contaminant_key = product_tests.contaminant_key
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
  food_id = CASE
    WHEN product_tests.match_method = 'source_only' OR (
      product_tests.match_method = 'exact_source_id'
      AND (
        (
          product_tests.food_id IS NOT NULL
          AND product_tests.supplement_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM foods current_food
            WHERE
              current_food.id = product_tests.food_id
              AND current_food.data_origin = product_tests.source_key
              AND current_food.data_origin_id = product_tests.tested_source_product_id
          )
        )
        OR (
          product_tests.supplement_id IS NOT NULL
          AND product_tests.food_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM supplements current_supplement
            WHERE
              current_supplement.id = product_tests.supplement_id
              AND current_supplement.data_origin = product_tests.source_key
              AND current_supplement.data_origin_id = product_tests.tested_source_product_id
          )
        )
      )
    ) THEN EXCLUDED.food_id
    ELSE product_tests.food_id
  END,
  supplement_id = CASE
    WHEN product_tests.match_method = 'source_only' OR (
      product_tests.match_method = 'exact_source_id'
      AND (
        (
          product_tests.food_id IS NOT NULL
          AND product_tests.supplement_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM foods current_food
            WHERE
              current_food.id = product_tests.food_id
              AND current_food.data_origin = product_tests.source_key
              AND current_food.data_origin_id = product_tests.tested_source_product_id
          )
        )
        OR (
          product_tests.supplement_id IS NOT NULL
          AND product_tests.food_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM supplements current_supplement
            WHERE
              current_supplement.id = product_tests.supplement_id
              AND current_supplement.data_origin = product_tests.source_key
              AND current_supplement.data_origin_id = product_tests.tested_source_product_id
          )
        )
      )
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
    WHEN product_tests.match_method = 'source_only' OR (
      product_tests.match_method = 'exact_source_id'
      AND (
        (
          product_tests.food_id IS NOT NULL
          AND product_tests.supplement_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM foods current_food
            WHERE
              current_food.id = product_tests.food_id
              AND current_food.data_origin = product_tests.source_key
              AND current_food.data_origin_id = product_tests.tested_source_product_id
          )
        )
        OR (
          product_tests.supplement_id IS NOT NULL
          AND product_tests.food_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM supplements current_supplement
            WHERE
              current_supplement.id = product_tests.supplement_id
              AND current_supplement.data_origin = product_tests.source_key
              AND current_supplement.data_origin_id = product_tests.tested_source_product_id
          )
        )
      )
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

DELETE FROM foods
WHERE
  data_origin IN (
    SELECT DISTINCT source_key
    FROM open_product_sources_product_tests_import
  )
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.food_id = foods.id
  );

DELETE FROM supplements
WHERE
  data_origin IN (
    SELECT DISTINCT source_key
    FROM open_product_sources_product_tests_import
  )
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.supplement_id = supplements.id
  );

COMMIT;
