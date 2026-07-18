\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.product_tests') IS NULL
    OR to_regclass('public.foods') IS NULL
    OR to_regclass('public.supplements') IS NULL
  THEN
    RAISE EXCEPTION 'product test audit requires product_tests, foods, and supplements';
  END IF;
END $$;

SELECT
  source_key,
  COUNT(*) AS observation_rows,
  COUNT(DISTINCT tested_source_product_id)
    FILTER (WHERE tested_source_product_id IS NOT NULL) AS identified_source_products,
  COUNT(*) FILTER (WHERE food_id IS NOT NULL OR supplement_id IS NOT NULL) AS linked_rows,
  COUNT(*) FILTER (WHERE match_method = 'source_only') AS source_only_rows
FROM product_tests
GROUP BY source_key
ORDER BY source_key;

SELECT
  COUNT(*) AS observation_rows,
  COUNT(DISTINCT source_key) AS sources,
  COUNT(*) FILTER (WHERE food_id IS NOT NULL) AS food_links,
  COUNT(*) FILTER (WHERE supplement_id IS NOT NULL) AS supplement_links,
  COUNT(*) FILTER (
    WHERE tested_product_name IS NULL
      AND tested_product_brand IS NULL
      AND tested_product_upc IS NULL
      AND tested_source_product_id IS NULL
  ) AS rows_without_product_identity
FROM product_tests;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_tests tests
    LEFT JOIN foods ON foods.id = tests.food_id
    WHERE tests.food_id IS NOT NULL AND foods.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM product_tests tests
    LEFT JOIN supplements ON supplements.id = tests.supplement_id
    WHERE tests.supplement_id IS NOT NULL AND supplements.id IS NULL
  ) THEN
    RAISE EXCEPTION 'product test audit failed: orphan product link';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests
    WHERE food_id IS NOT NULL AND supplement_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'product test audit failed: row links to both product tables';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests
    WHERE (
      food_id IS NULL
      AND supplement_id IS NULL
    ) IS DISTINCT FROM (match_method = 'source_only')
  ) THEN
    RAISE EXCEPTION 'product test audit failed: match method disagrees with link state';
  END IF;

  IF EXISTS (
    SELECT source_key, source_result_id, contaminant_key
    FROM product_tests
    GROUP BY source_key, source_result_id, contaminant_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'product test audit failed: duplicate source result identity';
  END IF;

  IF EXISTS (
    SELECT source_key, tested_source_product_id
    FROM product_tests
    WHERE tested_source_product_id IS NOT NULL
    GROUP BY source_key, tested_source_product_id
    HAVING COUNT(DISTINCT jsonb_build_array(
      tested_product_name,
      tested_product_brand,
      tested_product_upc,
      tested_product_upc_raw,
      tested_package_size
    )) > 1
  ) THEN
    RAISE EXCEPTION 'product test audit failed: source product identity drift';
  END IF;

  IF EXISTS (
    SELECT source_key, tested_source_product_id
    FROM product_tests
    WHERE tested_source_product_id IS NOT NULL
    GROUP BY source_key, tested_source_product_id
    HAVING COUNT(DISTINCT jsonb_build_array(
      food_id,
      supplement_id,
      match_method
    )) > 1
      OR COUNT(DISTINCT remap_revision) > 1
  ) THEN
    RAISE EXCEPTION 'product test audit failed: source product has mixed target or remap revision state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests tests
    JOIN foods ON foods.id = tests.food_id
    WHERE murph_product_test_legacy_source_backed_origin(foods.data_origin)
  ) OR EXISTS (
    SELECT 1
    FROM product_tests tests
    JOIN supplements ON supplements.id = tests.supplement_id
    WHERE murph_product_test_legacy_source_backed_origin(supplements.data_origin)
  ) THEN
    RAISE EXCEPTION 'product test audit failed: catalog-backed product used as a match target';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests tests
    LEFT JOIN foods ON foods.id = tests.food_id
    LEFT JOIN supplements ON supplements.id = tests.supplement_id
    WHERE tests.match_method = 'exact_upc'
      AND NOT (
        murph_product_test_valid_gtin(tests.tested_product_upc)
        AND murph_product_test_valid_gtin(COALESCE(foods.upc, supplements.upc))
        AND murph_product_test_canonical_gtin(tests.tested_product_upc)
          = murph_product_test_canonical_gtin(
            COALESCE(foods.upc, supplements.upc)
          )
        AND 1 = (
          SELECT COUNT(DISTINCT jsonb_build_array(target_kind, canonical_key))
          FROM (
            SELECT 'food'::text AS target_kind, eligible_foods.canonical_key
            FROM foods eligible_foods
            WHERE murph_product_test_canonical_gtin(eligible_foods.upc)
                = murph_product_test_canonical_gtin(tests.tested_product_upc)
              AND NOT murph_product_test_legacy_source_backed_origin(
                eligible_foods.data_origin
              )
            UNION ALL
            SELECT 'supplement'::text, eligible_supplements.canonical_key
            FROM supplements eligible_supplements
            WHERE murph_product_test_canonical_gtin(eligible_supplements.upc)
                = murph_product_test_canonical_gtin(tests.tested_product_upc)
              AND NOT murph_product_test_legacy_source_backed_origin(
                eligible_supplements.data_origin
              )
          ) exact_upc_targets
        )
      )
  ) THEN
    RAISE EXCEPTION 'product test audit failed: exact UPC link lacks exclusive proof';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests tests
    LEFT JOIN foods ON foods.id = tests.food_id
    LEFT JOIN supplements ON supplements.id = tests.supplement_id
    WHERE tests.match_method = 'exact_source_id'
      AND NOT (
        tests.tested_source_product_id = (
          COALESCE(foods.data_origin, supplements.data_origin)
          || ':'
          || COALESCE(foods.data_origin_id, supplements.data_origin_id)
        )
        AND 1 = (
          SELECT COUNT(DISTINCT jsonb_build_array(target_kind, canonical_key))
          FROM (
            SELECT 'food'::text AS target_kind, eligible_foods.canonical_key
            FROM foods eligible_foods
            WHERE tests.tested_source_product_id
              = eligible_foods.data_origin || ':' || eligible_foods.data_origin_id
              AND NOT murph_product_test_legacy_source_backed_origin(
                eligible_foods.data_origin
              )
            UNION ALL
            SELECT 'supplement'::text, eligible_supplements.canonical_key
            FROM supplements eligible_supplements
            WHERE tests.tested_source_product_id
              = eligible_supplements.data_origin || ':' || eligible_supplements.data_origin_id
              AND NOT murph_product_test_legacy_source_backed_origin(
                eligible_supplements.data_origin
              )
          ) exact_source_targets
        )
      )
  ) THEN
    RAISE EXCEPTION 'product test audit failed: exact source ID lacks namespaced proof';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests
    WHERE tested_product_upc IS NOT NULL
      AND NOT murph_product_test_valid_gtin(tested_product_upc)
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE tested_product_upc_raw IS NOT NULL
      AND btrim(tested_product_upc_raw) = ''
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE source_sample_count IS NOT NULL AND source_sample_count <= 0
  ) THEN
    RAISE EXCEPTION 'product test audit failed: invalid product or sample identifier metadata';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests
    WHERE result_operator IN ('eq', 'lt', 'lte', 'gt', 'gte', 'range')
      AND result_value IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE result_value IS NOT NULL AND result_value < 0
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE result_operator = 'range'
      AND (
        result_value IS NULL
        OR result_upper_value IS NULL
        OR result_value > result_upper_value
      )
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE result_operator <> 'range' AND result_upper_value IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'product test audit failed: invalid raw result range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests
    WHERE normalized_value IS NULL
      AND (normalized_upper_value IS NOT NULL OR normalized_unit IS NOT NULL OR normalized_basis IS NOT NULL)
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE normalized_value IS NOT NULL
      AND (normalized_unit IS NULL OR normalized_basis IS NULL)
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE result_operator = 'range'
      AND normalized_value IS NOT NULL
      AND (normalized_upper_value IS NULL OR normalized_value > normalized_upper_value)
  ) OR EXISTS (
    SELECT 1
    FROM product_tests
    WHERE result_operator <> 'range' AND normalized_upper_value IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'product test audit failed: invalid normalized result tuple';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_tests
    WHERE (detection_limit_value IS NULL) IS DISTINCT FROM (detection_limit_unit IS NULL)
      OR (quantification_limit_value IS NULL) IS DISTINCT FROM (quantification_limit_unit IS NULL)
      OR (reporting_limit_value IS NULL) IS DISTINCT FROM (reporting_limit_unit IS NULL)
      OR (uncertainty_value IS NULL) IS DISTINCT FROM (uncertainty_unit IS NULL)
      OR detection_limit_value < 0
      OR quantification_limit_value < 0
      OR reporting_limit_value < 0
      OR uncertainty_value < 0
  ) THEN
    RAISE EXCEPTION 'product test audit failed: invalid limit or uncertainty tuple';
  END IF;
END $$;

ROLLBACK;
