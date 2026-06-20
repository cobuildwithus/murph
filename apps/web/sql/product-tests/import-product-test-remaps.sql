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
    strict_serving_mass.serving_grams
  FROM remapped_foods
  JOIN foods
    ON foods.id = remapped_foods.food_id
  CROSS JOIN LATERAL (
    SELECT candidate.serving_grams
    FROM (
      VALUES
        (
          1,
          CASE
            WHEN btrim(foods.label->>'servingSize') ~ '^[0-9]+(\.[0-9]+)?$'
              AND lower(btrim(foods.label->>'servingSizeUnit')) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
              THEN btrim(foods.label->>'servingSize')::numeric
            ELSE NULL
          END
        ),
        (
          2,
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
            ORDER BY serving_rank
            LIMIT 1
          )
        ),
        (
          3,
          (
            SELECT btrim(serving_size->>'amount')::numeric
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(foods.label->'servingSizes') = 'array'
                  THEN foods.label->'servingSizes'
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS serving_size_rows(serving_size, serving_rank)
            WHERE btrim(serving_size->>'amount') ~ '^[0-9]+(\.[0-9]+)?$'
              AND lower(btrim(serving_size->>'unit')) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
            ORDER BY serving_rank
            LIMIT 1
          )
        ),
        (
          4,
          (
            SELECT (gram_match.parts)[1]::numeric
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(foods.label->'servingSizes') = 'array'
                  THEN foods.label->'servingSizes'
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS serving_size_rows(serving_size, serving_rank)
            CROSS JOIN LATERAL (
              VALUES
                (serving_size->>'description'),
                (serving_size->>'text'),
                (serving_size->>'label')
            ) AS serving_text(source_text)
            CROSS JOIN LATERAL regexp_matches(
              COALESCE(serving_text.source_text, ''),
              '([0-9]+(\.[0-9]+)?)[[:space:]]*(gram\(s\)|grams?|grm|g)([^[:alpha:]]|$)',
              'i'
            ) AS gram_match(parts)
            ORDER BY serving_rank
            LIMIT 1
          )
        ),
        (
          5,
          (
            SELECT (gram_match.parts)[1]::numeric
            FROM (
              VALUES
                (1, foods.label#>>'{nutrition,preparationStates,0,servingSize}'),
                (2, foods.label#>>'{nutritionFacts,servingSize}'),
                (3, foods.label#>>'{nutritionFacts,panels,0,servingSize}'),
                (4, foods.label->>'servingSizeText'),
                (5, foods.label->>'servingDescription')
            ) AS text_sources(source_rank, source_text)
            CROSS JOIN LATERAL regexp_matches(
              COALESCE(text_sources.source_text, ''),
              '([0-9]+(\.[0-9]+)?)[[:space:]]*(gram\(s\)|grams?|grm|g)([^[:alpha:]]|$)',
              'i'
            ) AS gram_match(parts)
            ORDER BY text_sources.source_rank
            LIMIT 1
          )
        ),
        (
          6,
          (
            SELECT btrim(portion->>'gramWeight')::numeric
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(foods.label->'portions') = 'array'
                  THEN foods.label->'portions'
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS portion_rows(portion, portion_rank)
            WHERE btrim(portion->>'gramWeight') ~ '^[0-9]+(\.[0-9]+)?$'
              AND lower(btrim(portion->>'description')) = lower(btrim(foods.label->>'householdServing'))
              AND COALESCE(btrim(portion->>'description'), '') <> ''
              AND lower(btrim(portion->>'description')) !~ '^[0-9.[:space:]]*(fl\.?[[:space:]]*oz|fluid[[:space:]]+ounces?|cups?|tbsp|tablespoons?|tsp|teaspoons?|ml|milliliters?|millilitres?|l|liters?|litres?|bottles?|jars?|cans?|containers?|packages?|packs?|packets?|pouches?|tablets?|capsules?|caps?|softgels?|soft[[:space:]]+gels?|gummies?|scoops?)([^[:alpha:]]|$)'
            ORDER BY portion_rank
            LIMIT 1
          )
        )
    ) AS candidate(priority, serving_grams)
    WHERE candidate.serving_grams > 0
      AND candidate.serving_grams <= 2000
    ORDER BY candidate.priority
    LIMIT 1
  ) strict_serving_mass
  WHERE foods.serving_grams IS NULL
)
UPDATE foods
SET serving_grams = serving_mass.serving_grams
FROM serving_mass
WHERE foods.id = serving_mass.id
  AND foods.serving_grams IS NULL
  AND serving_mass.serving_grams > 0
  AND serving_mass.serving_grams <= 2000;

WITH remapped_supplements AS (
  SELECT DISTINCT NULLIF(supplement_id, '') AS supplement_id
  FROM product_test_remaps_import
  WHERE NULLIF(supplement_id, '') IS NOT NULL
),
serving_mass AS (
  SELECT
    supplements.id,
    strict_serving_mass.serving_grams
  FROM remapped_supplements
  JOIN supplements
    ON supplements.id = remapped_supplements.supplement_id
  CROSS JOIN LATERAL (
    SELECT candidate.serving_grams
    FROM (
      VALUES
        (
          1,
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
            ORDER BY serving_rank
            LIMIT 1
          )
        ),
        (
          2,
          (
            SELECT btrim(serving_size->>'amount')::numeric
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(supplements.label->'servingSizes') = 'array'
                  THEN supplements.label->'servingSizes'
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS serving_size_rows(serving_size, serving_rank)
            WHERE btrim(serving_size->>'amount') ~ '^[0-9]+(\.[0-9]+)?$'
              AND lower(btrim(serving_size->>'unit')) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
            ORDER BY serving_rank
            LIMIT 1
          )
        ),
        (
          3,
          CASE
            WHEN btrim(supplements.label->>'servingSize') ~ '^[0-9]+(\.[0-9]+)?$'
              AND lower(btrim(supplements.label->>'servingSizeUnit')) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
              THEN btrim(supplements.label->>'servingSize')::numeric
            ELSE NULL
          END
        )
    ) AS candidate(priority, serving_grams)
    WHERE candidate.serving_grams > 0
      AND candidate.serving_grams <= 2000
    ORDER BY candidate.priority
    LIMIT 1
  ) strict_serving_mass
  WHERE supplements.serving_grams IS NULL
)
UPDATE supplements
SET serving_grams = serving_mass.serving_grams
FROM serving_mass
WHERE supplements.id = serving_mass.id
  AND supplements.serving_grams IS NULL
  AND serving_mass.serving_grams > 0
  AND serving_mass.serving_grams <= 2000;

COMMIT;
