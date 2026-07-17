\set ON_ERROR_STOP on

\if :{?stale_food_cleanup_apply}
\else
  \set stale_food_cleanup_apply false
\endif

BEGIN;

DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('murph:product_tests:mutation'));
END
$$;

CREATE TEMP TABLE stale_food_cleanup_expected (
  id TEXT PRIMARY KEY,
  data_origin TEXT NOT NULL,
  data_origin_id TEXT NOT NULL,
  data_origin_url TEXT NOT NULL,
  label_source TEXT NOT NULL,
  label_source_type TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO stale_food_cleanup_expected (
  id,
  data_origin,
  data_origin_id,
  data_origin_url,
  label_source,
  label_source_type
)
VALUES
  (
    'brand_site:kirkland-seasoned-rotisserie-chicken',
    'brand_site',
    'kirkland-seasoned-rotisserie-chicken',
    'https://www.fatsecret.ca/calories-nutrition/costco/seasoned-rotisserie-chicken/100g',
    'fatsecret_costco',
    'third_party_nutrition_with_reported_label_ingredients'
  ),
  (
    'brand_site:nescafe-instant-coffee-powder',
    'brand_site',
    'nescafe-instant-coffee-powder',
    'https://www.nescafe.com/us/products/ice-roast-instant-coffee-6-oz-jar/',
    'nescafe',
    'official_brand_page'
  );

-- Lock either form of each stable identity before validating it. This makes a
-- concurrent product_tests insert wait on the referenced foods row, while the
-- shared product-test mutation advisory lock serializes normal import/remap
-- writers with this cleanup.
DO $$
BEGIN
  PERFORM foods.id
  FROM foods
  JOIN stale_food_cleanup_expected expected
    ON foods.id = expected.id
    OR (
      foods.data_origin = expected.data_origin
      AND foods.data_origin_id = expected.data_origin_id
    )
  FOR UPDATE OF foods;
END
$$;

DO $$
DECLARE
  divergent_rows BIGINT;
  linked_rows BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO divergent_rows
  FROM stale_food_cleanup_expected expected
  JOIN foods
    ON foods.id = expected.id
    OR (
      foods.data_origin = expected.data_origin
      AND foods.data_origin_id = expected.data_origin_id
    )
  WHERE foods.id IS DISTINCT FROM expected.id
    OR foods.data_origin IS DISTINCT FROM expected.data_origin
    OR foods.data_origin_id IS DISTINCT FROM expected.data_origin_id
    OR foods.data_origin_url IS DISTINCT FROM expected.data_origin_url
    OR foods.label->>'source' IS DISTINCT FROM expected.label_source
    OR foods.label->>'sourceType' IS DISTINCT FROM expected.label_source_type;

  IF divergent_rows <> 0 THEN
    RAISE EXCEPTION
      'stale food cleanup found % divergent expected identity row(s)',
      divergent_rows;
  END IF;

  SELECT COUNT(*)
  INTO linked_rows
  FROM product_tests
  JOIN stale_food_cleanup_expected expected
    ON product_tests.food_id = expected.id;

  IF linked_rows <> 0 THEN
    RAISE EXCEPTION
      'stale food cleanup requires zero product_tests links; found %',
      linked_rows;
  END IF;
END
$$;

CREATE TEMP TABLE stale_food_cleanup_plan ON COMMIT DROP AS
SELECT
  expected.id,
  foods.id IS NOT NULL AS was_present
FROM stale_food_cleanup_expected expected
LEFT JOIN foods
  ON foods.id = expected.id;

CREATE TEMP TABLE stale_food_cleanup_deleted (
  id TEXT PRIMARY KEY
) ON COMMIT DROP;

DO $$
DECLARE
  expected_deletes BIGINT;
  actual_deletes BIGINT;
BEGIN
  WITH deleted AS (
    DELETE FROM foods
    USING stale_food_cleanup_expected expected
    WHERE foods.id = expected.id
      AND foods.data_origin = expected.data_origin
      AND foods.data_origin_id = expected.data_origin_id
      AND foods.data_origin_url = expected.data_origin_url
      AND foods.label->>'source' = expected.label_source
      AND foods.label->>'sourceType' = expected.label_source_type
      AND NOT EXISTS (
        SELECT 1
        FROM product_tests
        WHERE product_tests.food_id = foods.id
      )
    RETURNING foods.id
  )
  INSERT INTO stale_food_cleanup_deleted (id)
  SELECT deleted.id
  FROM deleted;

  SELECT COUNT(*) FILTER (WHERE was_present)
  INTO expected_deletes
  FROM stale_food_cleanup_plan;

  SELECT COUNT(*)
  INTO actual_deletes
  FROM stale_food_cleanup_deleted;

  IF actual_deletes <> expected_deletes THEN
    RAISE EXCEPTION
      'stale food cleanup expected % exact deletion(s), deleted %',
      expected_deletes,
      actual_deletes;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stale_food_cleanup_plan plan
    LEFT JOIN stale_food_cleanup_deleted deleted
      ON deleted.id = plan.id
    WHERE plan.was_present <> (deleted.id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'stale food cleanup per-row delete assertion failed';
  END IF;
END
$$;

SELECT format(
  'mode=%s expected=%s present=%s already_absent=%s deleted=%s',
  CASE
    WHEN :'stale_food_cleanup_apply'::boolean THEN 'apply'
    ELSE 'dry-run'
  END,
  COUNT(*),
  COUNT(*) FILTER (WHERE plan.was_present),
  COUNT(*) FILTER (WHERE NOT plan.was_present),
  (SELECT COUNT(*) FROM stale_food_cleanup_deleted)
)
FROM stale_food_cleanup_plan plan;

\if :stale_food_cleanup_apply
COMMIT;
\else
ROLLBACK;
\endif
