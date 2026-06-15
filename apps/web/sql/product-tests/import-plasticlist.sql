\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE plasticlist_foods_import (
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  tags TEXT,
  sample_ids TEXT NOT NULL,
  search_text TEXT NOT NULL
) ON COMMIT DROP;

\copy plasticlist_foods_import FROM :'foods_tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

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

\copy plasticlist_product_tests_import FROM :'product_tests_tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

DELETE FROM product_tests
WHERE
  source_key = 'plasticlist_bay_area_2024'
  AND NOT EXISTS (
    SELECT 1
    FROM plasticlist_product_tests_import current_import
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
  'plasticlist_bay_area_2024:' || product_id AS id,
  'plasticlist_bay_area_2024:' || product_id AS canonical_key,
  'plasticlist_bay_area_2024' AS data_origin,
  product_id AS data_origin_id,
  'https://plasticlist.org' AS data_origin_url,
  90::smallint AS data_origin_priority,
  product_name AS name,
  NULL::text AS brand,
  NULL::text AS upc,
  false AS off_market,
  search_text,
  jsonb_strip_nulls(
    jsonb_build_object(
      'source', 'PlasticList',
      'sourceUrl', 'https://plasticlist.org',
      'sourceReportTitle', 'Data on Plastic Chemicals in Bay Area Foods',
      'license', 'CC BY 4.0',
      'plasticlistProductId', product_id,
      'sampleIds', string_to_array(sample_ids, ','),
      'tags', CASE
        WHEN NULLIF(tags, '') IS NULL THEN NULL
        ELSE string_to_array(tags, ',')
      END,
      'note', 'PlasticList contaminant source product; nutrition label unavailable.'
    )
  ) AS label,
  DATE '2024-01-01' AS fdc_release_date
FROM plasticlist_foods_import
ON CONFLICT (data_origin, data_origin_id) DO UPDATE SET
  id = EXCLUDED.id,
  canonical_key = EXCLUDED.canonical_key,
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
  data_origin = 'plasticlist_bay_area_2024'
  AND NOT EXISTS (
    SELECT 1
    FROM plasticlist_foods_import current_import
    WHERE current_import.product_id = foods.data_origin_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM product_tests
    WHERE product_tests.food_id = foods.id
  );

COMMIT;
