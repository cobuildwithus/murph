\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:open_product_sources:import'));

CREATE TEMP TABLE open_product_sources_products_import (
  product_table TEXT NOT NULL,
  id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  data_origin TEXT NOT NULL,
  data_origin_id TEXT NOT NULL,
  data_origin_url TEXT,
  data_origin_priority TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  upc TEXT,
  off_market TEXT NOT NULL,
  search_text TEXT NOT NULL,
  label_json TEXT NOT NULL,
  fdc_release_date TEXT
) ON COMMIT DROP;

\copy open_product_sources_products_import FROM :'products_csv' WITH (FORMAT csv, HEADER true, NULL '')

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

\copy open_product_sources_product_tests_import FROM :'product_tests_csv' WITH (FORMAT csv, HEADER true, NULL '')

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM open_product_sources_products_import) THEN
    RAISE EXCEPTION 'open product source import prepared zero product rows';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM open_product_sources_product_tests_import) THEN
    RAISE EXCEPTION 'open product source import prepared zero product test rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM open_product_sources_products_import products
    WHERE products.product_table NOT IN ('foods', 'supplements')
  ) THEN
    RAISE EXCEPTION 'open product source import has unsupported product_table';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM open_product_sources_product_tests_import tests
    WHERE
      (
        CASE WHEN NULLIF(tests.food_id, '') IS NULL THEN 0 ELSE 1 END
        + CASE WHEN NULLIF(tests.supplement_id, '') IS NULL THEN 0 ELSE 1 END
      ) <> 1
  ) THEN
    RAISE EXCEPTION 'open product source test row must link to exactly one product';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM open_product_sources_product_tests_import tests
    WHERE tests.match_method <> 'exact_source_id'
  ) THEN
    RAISE EXCEPTION 'open product source test row must use exact_source_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM open_product_sources_product_tests_import tests
    WHERE NOT EXISTS (
      SELECT 1
      FROM open_product_sources_products_import products
      WHERE
        products.id = COALESCE(NULLIF(tests.food_id, ''), NULLIF(tests.supplement_id, ''))
        AND products.product_table = CASE
          WHEN NULLIF(tests.food_id, '') IS NOT NULL THEN 'foods'
          ELSE 'supplements'
        END
        AND products.data_origin = tests.source_key
        AND products.data_origin_id = tests.source_result_id
    )
  ) THEN
    RAISE EXCEPTION 'open product source test row references a missing or mismatched source-backed product';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM open_product_sources_products_import products
    WHERE NOT EXISTS (
      SELECT 1
      FROM open_product_sources_product_tests_import tests
      WHERE
        COALESCE(NULLIF(tests.food_id, ''), NULLIF(tests.supplement_id, '')) = products.id
        AND tests.source_key = products.data_origin
        AND tests.source_result_id = products.data_origin_id
    )
  ) THEN
    RAISE EXCEPTION 'open product source product row is not linked to a product test';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM foods existing_food
    JOIN open_product_sources_products_import current_import
      ON current_import.product_table = 'foods'
      AND existing_food.data_origin = current_import.data_origin
      AND existing_food.data_origin_id = current_import.data_origin_id
    WHERE
      existing_food.id <> current_import.id
      OR existing_food.canonical_key <> current_import.canonical_key
  ) THEN
    RAISE EXCEPTION 'open product source food identity mismatch; repair food id/canonical_key before import';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM supplements existing_supplement
    JOIN open_product_sources_products_import current_import
      ON current_import.product_table = 'supplements'
      AND existing_supplement.data_origin = current_import.data_origin
      AND existing_supplement.data_origin_id = current_import.data_origin_id
    WHERE
      existing_supplement.id <> current_import.id
      OR existing_supplement.canonical_key <> current_import.canonical_key
  ) THEN
    RAISE EXCEPTION 'open product source supplement identity mismatch; repair supplement id/canonical_key before import';
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

INSERT INTO foods (
  id,
  canonical_key,
  data_origin,
  data_origin_id,
  data_origin_url,
  data_origin_priority,
  name,
  brand,
  upc,
  off_market,
  search_text,
  label,
  fdc_release_date
)
SELECT
  id,
  canonical_key,
  data_origin,
  data_origin_id,
  NULLIF(data_origin_url, ''),
  data_origin_priority::smallint,
  name,
  NULLIF(brand, ''),
  NULLIF(upc, ''),
  off_market::boolean,
  search_text,
  label_json::jsonb,
  COALESCE(NULLIF(fdc_release_date, '')::date, DATE '2024-01-01')
FROM open_product_sources_products_import
WHERE product_table = 'foods'
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  fdc_release_date = EXCLUDED.fdc_release_date,
  last_seen_at = now(),
  imported_at = now();

INSERT INTO supplements (
  id,
  canonical_key,
  data_origin,
  data_origin_id,
  data_origin_url,
  data_origin_priority,
  name,
  brand,
  upc,
  off_market,
  search_text,
  label
)
SELECT
  id,
  canonical_key,
  data_origin,
  data_origin_id,
  NULLIF(data_origin_url, ''),
  data_origin_priority::smallint,
  name,
  NULLIF(brand, ''),
  NULLIF(upc, ''),
  off_market::boolean,
  search_text,
  label_json::jsonb
FROM open_product_sources_products_import
WHERE product_table = 'supplements'
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  imported_at = now();

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
  food_id = EXCLUDED.food_id,
  supplement_id = EXCLUDED.supplement_id,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  source_report_title = EXCLUDED.source_report_title,
  report_date = EXCLUDED.report_date,
  tested_product_name = EXCLUDED.tested_product_name,
  tested_product_brand = EXCLUDED.tested_product_brand,
  tested_product_upc = EXCLUDED.tested_product_upc,
  tested_source_product_id = EXCLUDED.tested_source_product_id,
  match_method = EXCLUDED.match_method,
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
  data_origin IN (
    SELECT DISTINCT data_origin
    FROM open_product_sources_products_import
  )
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.food_id = foods.id
  );

DELETE FROM supplements
WHERE
  data_origin IN (
    SELECT DISTINCT data_origin
    FROM open_product_sources_products_import
  )
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.supplement_id = supplements.id
  );

COMMIT;
