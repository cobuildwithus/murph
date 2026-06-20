\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:product_tests:mutation'));

CREATE TEMP TABLE product_test_remaps_import (
  source_key TEXT NOT NULL,
  tested_source_product_id TEXT NOT NULL,
  tested_product_name TEXT,
  tested_product_brand TEXT,
  tested_product_upc TEXT,
  food_id TEXT,
  supplement_id TEXT,
  match_method TEXT NOT NULL,
  review_note TEXT
) ON COMMIT DROP;

\copy product_test_remaps_import FROM __REMAPS_TSV__ WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM product_test_remaps_import) THEN
    RAISE EXCEPTION 'product test remap import prepared zero rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE
      btrim(remaps.source_key) = ''
      OR btrim(remaps.tested_source_product_id) = ''
  ) THEN
    RAISE EXCEPTION 'product test remap row is missing source identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    GROUP BY remaps.source_key, remaps.tested_source_product_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate product test remap source identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE remaps.match_method NOT IN (
      'exact_upc',
      'exact_source_id',
      'manual_confirmed',
      'source_only'
    )
  ) THEN
    RAISE EXCEPTION 'product test remap row has unsupported match_method';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE
      (
        NULLIF(remaps.food_id, '') IS NULL
        AND NULLIF(remaps.supplement_id, '') IS NULL
      ) <> (remaps.match_method = 'source_only')
      OR (
        NULLIF(remaps.food_id, '') IS NOT NULL
        AND NULLIF(remaps.supplement_id, '') IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'product test remap row must use source_only with no product link or a linked method with exactly one product link';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE
      NULLIF(remaps.food_id, '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM foods
        WHERE foods.id = remaps.food_id
          AND foods.data_origin NOT IN (
            'plasticlist_bay_area_2024',
            'nyc_dohmh_consumer_products',
            'king_county_consumer_products',
            'pure_earth_rms_2024'
          )
      )
  ) THEN
    RAISE EXCEPTION 'product test remap row references missing or source-backed food_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE
      NULLIF(remaps.supplement_id, '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM supplements
        WHERE supplements.id = remaps.supplement_id
          AND supplements.data_origin NOT IN (
            'plasticlist_bay_area_2024',
            'nyc_dohmh_consumer_products',
            'king_county_consumer_products',
            'pure_earth_rms_2024'
          )
      )
  ) THEN
    RAISE EXCEPTION 'product test remap row references missing or source-backed supplement_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE NOT EXISTS (
      SELECT 1
      FROM product_tests tests
      WHERE
        tests.source_key = remaps.source_key
        AND tests.tested_source_product_id = remaps.tested_source_product_id
    )
  ) THEN
    RAISE EXCEPTION 'product test remap row references missing source product tests';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    JOIN product_tests tests
      ON tests.source_key = remaps.source_key
      AND tests.tested_source_product_id = remaps.tested_source_product_id
    WHERE NOT (
      tests.tested_product_name IS NOT DISTINCT FROM NULLIF(remaps.tested_product_name, '')
      AND tests.tested_product_brand IS NOT DISTINCT FROM NULLIF(remaps.tested_product_brand, '')
      AND tests.tested_product_upc IS NOT DISTINCT FROM NULLIF(remaps.tested_product_upc, '')
    )
  ) THEN
    RAISE EXCEPTION 'product test remap row source identity does not match current source product tests';
  END IF;
END $$;

UPDATE product_tests tests
SET
  food_id = NULLIF(remaps.food_id, ''),
  supplement_id = NULLIF(remaps.supplement_id, ''),
  match_method = remaps.match_method,
  imported_at = now()
FROM product_test_remaps_import remaps
WHERE
  tests.source_key = remaps.source_key
  AND tests.tested_source_product_id = remaps.tested_source_product_id
  AND tests.tested_product_name IS NOT DISTINCT FROM NULLIF(remaps.tested_product_name, '')
  AND tests.tested_product_brand IS NOT DISTINCT FROM NULLIF(remaps.tested_product_brand, '')
  AND tests.tested_product_upc IS NOT DISTINCT FROM NULLIF(remaps.tested_product_upc, '');

WITH remapped_foods AS (
  SELECT DISTINCT NULLIF(food_id, '') AS food_id
  FROM product_test_remaps_import
  WHERE NULLIF(food_id, '') IS NOT NULL
),
serving_mass AS (
  SELECT
    foods.id,
    COALESCE(
      CASE
        WHEN btrim(foods.label->>'servingSize') ~ '^[0-9]+(\.[0-9]+)?$'
          AND lower(btrim(foods.label->>'servingSizeUnit')) IN ('g', 'gram', 'grams')
          THEN btrim(foods.label->>'servingSize')::numeric
        ELSE NULL
      END,
      (
        SELECT btrim(serving_size->>'grams')::numeric
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(foods.label->'servingSizes') = 'array'
              THEN foods.label->'servingSizes'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS serving_size_rows(serving_size, serving_rank)
        WHERE btrim(serving_size->>'grams') ~ '^[0-9]+(\.[0-9]+)?$'
          AND btrim(serving_size->>'grams')::numeric > 0
        ORDER BY serving_rank
        LIMIT 1
      )
    ) AS serving_grams
  FROM remapped_foods
  JOIN foods
    ON foods.id = remapped_foods.food_id
  WHERE foods.serving_grams IS NULL
)
UPDATE foods
SET serving_grams = serving_mass.serving_grams
FROM serving_mass
WHERE foods.id = serving_mass.id
  AND serving_mass.serving_grams > 0;

WITH remapped_supplements AS (
  SELECT DISTINCT NULLIF(supplement_id, '') AS supplement_id
  FROM product_test_remaps_import
  WHERE NULLIF(supplement_id, '') IS NOT NULL
),
serving_mass AS (
  SELECT
    supplements.id,
    COALESCE(
      (
        SELECT btrim(serving_size->>'grams')::numeric
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(supplements.label->'servingSizes') = 'array'
              THEN supplements.label->'servingSizes'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS serving_size_rows(serving_size, serving_rank)
        WHERE btrim(serving_size->>'grams') ~ '^[0-9]+(\.[0-9]+)?$'
          AND btrim(serving_size->>'grams')::numeric > 0
        ORDER BY serving_rank
        LIMIT 1
      ),
      CASE
        WHEN btrim(supplements.label->>'servingSize') ~ '^[0-9]+(\.[0-9]+)?$'
          AND lower(btrim(supplements.label->>'servingSizeUnit')) IN ('g', 'gram', 'grams')
          THEN btrim(supplements.label->>'servingSize')::numeric
        ELSE NULL
      END
    ) AS serving_grams
  FROM remapped_supplements
  JOIN supplements
    ON supplements.id = remapped_supplements.supplement_id
  WHERE supplements.serving_grams IS NULL
)
UPDATE supplements
SET serving_grams = serving_mass.serving_grams
FROM serving_mass
WHERE supplements.id = serving_mass.id
  AND serving_mass.serving_grams > 0;

COMMIT;
