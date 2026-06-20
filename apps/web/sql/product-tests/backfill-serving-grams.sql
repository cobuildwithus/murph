\set ON_ERROR_STOP on

\if :{?serving_grams_backfill_apply}
\else
  \set serving_grams_backfill_apply false
\endif

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:serving_grams:strict_backfill'));

CREATE TEMP TABLE serving_grams_food_candidates ON COMMIT DROP AS
SELECT
  foods.id,
  foods.name,
  foods.data_origin,
  foods.data_origin_id,
  strict_serving_mass.source_rule,
  strict_serving_mass.serving_grams
FROM foods
CROSS JOIN LATERAL (
  SELECT
    candidate.source_rule,
    candidate.serving_grams
  FROM (
    VALUES
      (
        1,
        'label_serving_size_mass_unit',
        CASE
          WHEN btrim(foods.label->>'servingSize') ~ '^[0-9]+(\.[0-9]+)?$'
            AND lower(btrim(foods.label->>'servingSizeUnit')) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
            THEN btrim(foods.label->>'servingSize')::numeric
          ELSE NULL
        END
      ),
      (
        2,
        'label_serving_sizes_grams',
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
        'label_serving_sizes_amount_mass_unit',
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
        'label_serving_sizes_text_grams',
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
        'label_text_serving_size_grams',
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
        'fdc_exact_household_portion_grams',
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
  ) AS candidate(priority, source_rule, serving_grams)
  WHERE candidate.serving_grams > 0
    AND candidate.serving_grams <= 2000
  ORDER BY candidate.priority
  LIMIT 1
) strict_serving_mass
WHERE foods.serving_grams IS NULL;

CREATE TEMP TABLE serving_grams_supplement_candidates ON COMMIT DROP AS
SELECT
  supplements.id,
  supplements.name,
  supplements.data_origin,
  supplements.data_origin_id,
  strict_serving_mass.source_rule,
  strict_serving_mass.serving_grams
FROM supplements
CROSS JOIN LATERAL (
  SELECT
    candidate.source_rule,
    candidate.serving_grams
  FROM (
    VALUES
      (
        1,
        'label_serving_sizes_grams',
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
        'label_serving_sizes_amount_mass_unit',
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
        'label_serving_size_mass_unit',
        CASE
          WHEN btrim(supplements.label->>'servingSize') ~ '^[0-9]+(\.[0-9]+)?$'
            AND lower(btrim(supplements.label->>'servingSizeUnit')) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
            THEN btrim(supplements.label->>'servingSize')::numeric
          ELSE NULL
        END
      )
  ) AS candidate(priority, source_rule, serving_grams)
  WHERE candidate.serving_grams > 0
    AND candidate.serving_grams <= 2000
  ORDER BY candidate.priority
  LIMIT 1
) strict_serving_mass
WHERE supplements.serving_grams IS NULL;

SELECT
  'foods' AS table_name,
  source_rule,
  count(*) AS candidate_rows,
  min(serving_grams) AS min_serving_grams,
  max(serving_grams) AS max_serving_grams
FROM serving_grams_food_candidates
GROUP BY source_rule
UNION ALL
SELECT
  'supplements' AS table_name,
  source_rule,
  count(*) AS candidate_rows,
  min(serving_grams) AS min_serving_grams,
  max(serving_grams) AS max_serving_grams
FROM serving_grams_supplement_candidates
GROUP BY source_rule
ORDER BY table_name, source_rule;

SELECT
  'foods' AS table_name,
  count(*) AS candidate_rows
FROM serving_grams_food_candidates
UNION ALL
SELECT
  'supplements' AS table_name,
  count(*) AS candidate_rows
FROM serving_grams_supplement_candidates
ORDER BY table_name;

SELECT
  'foods' AS table_name,
  count(*) AS total_rows,
  count(*) FILTER (WHERE serving_grams IS NULL) AS missing_serving_grams,
  (SELECT count(*) FROM serving_grams_food_candidates) AS strict_candidate_rows
FROM foods
UNION ALL
SELECT
  'supplements' AS table_name,
  count(*) AS total_rows,
  count(*) FILTER (WHERE serving_grams IS NULL) AS missing_serving_grams,
  (SELECT count(*) FROM serving_grams_supplement_candidates) AS strict_candidate_rows
FROM supplements
ORDER BY table_name;

SELECT
  'foods' AS table_name,
  count(DISTINCT candidates.id) AS linked_candidate_rows,
  count(product_tests.id) AS linked_product_test_rows
FROM serving_grams_food_candidates candidates
JOIN product_tests
  ON product_tests.food_id = candidates.id
UNION ALL
SELECT
  'supplements' AS table_name,
  count(DISTINCT candidates.id) AS linked_candidate_rows,
  count(product_tests.id) AS linked_product_test_rows
FROM serving_grams_supplement_candidates candidates
JOIN product_tests
  ON product_tests.supplement_id = candidates.id
ORDER BY table_name;

SELECT
  'foods' AS table_name,
  id,
  data_origin,
  data_origin_id,
  source_rule,
  serving_grams,
  left(name, 120) AS name
FROM serving_grams_food_candidates
ORDER BY data_origin, id
LIMIT 20;

SELECT
  'supplements' AS table_name,
  id,
  data_origin,
  data_origin_id,
  source_rule,
  serving_grams,
  left(name, 120) AS name
FROM serving_grams_supplement_candidates
ORDER BY data_origin, id
LIMIT 20;

\if :serving_grams_backfill_apply
  UPDATE foods
  SET serving_grams = candidates.serving_grams
  FROM serving_grams_food_candidates candidates
  WHERE foods.id = candidates.id
    AND foods.serving_grams IS NULL
    AND candidates.serving_grams > 0
    AND candidates.serving_grams <= 2000;

  UPDATE supplements
  SET serving_grams = candidates.serving_grams
  FROM serving_grams_supplement_candidates candidates
  WHERE supplements.id = candidates.id
    AND supplements.serving_grams IS NULL
    AND candidates.serving_grams > 0
    AND candidates.serving_grams <= 2000;

  COMMIT;
\else
  ROLLBACK;
\endif
