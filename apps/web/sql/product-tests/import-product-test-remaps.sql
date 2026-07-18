\set ON_ERROR_STOP on

BEGIN;

\if :remap_apply
SELECT pg_advisory_xact_lock(hashtext('murph:product_tests:mutation'));
\else
-- Validation uses transaction-local temp tables, so dry runs stay rollback-only
-- while deliberately taking neither advisory nor row mutation locks.
\endif

CREATE TEMP TABLE product_test_remaps_import (
  source_key TEXT NOT NULL,
  tested_source_product_id TEXT NOT NULL,
  tested_product_name TEXT,
  tested_product_brand TEXT,
  tested_product_upc TEXT,
  tested_package_size TEXT,
  source_fingerprint TEXT NOT NULL,
  expected_current_state_fingerprint TEXT NOT NULL,
  food_id TEXT,
  supplement_id TEXT,
  target_fingerprint TEXT,
  match_method TEXT NOT NULL,
  source_id_namespace TEXT,
  review_note TEXT
) ON COMMIT DROP;

CREATE TEMP TABLE product_test_remap_options (
  apply BOOLEAN NOT NULL
) ON COMMIT DROP;

INSERT INTO product_test_remap_options (apply)
VALUES (:'remap_apply'::boolean);

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
    WHERE remaps.source_fingerprint !~ '^[0-9a-f]{32}$'
  ) THEN
    RAISE EXCEPTION 'product test remap row has missing or malformed source fingerprint';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE remaps.expected_current_state_fingerprint !~ '^[0-9a-f]{32}$'
  ) THEN
    RAISE EXCEPTION 'product test remap row has missing or malformed expected current-state fingerprint';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE
      (remaps.match_method = 'source_only' AND NULLIF(remaps.target_fingerprint, '') IS NOT NULL)
      OR (
        remaps.match_method <> 'source_only'
        AND COALESCE(remaps.target_fingerprint, '') !~ '^[0-9a-f]{32}$'
      )
  ) THEN
    RAISE EXCEPTION 'product test remap row has an invalid target fingerprint';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE
      remaps.match_method IN ('manual_confirmed', 'source_only')
      AND NULLIF(btrim(remaps.review_note), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'manual_confirmed and source_only decisions require a nonempty review note';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    WHERE
      (remaps.match_method = 'exact_source_id')
      <> (NULLIF(btrim(remaps.source_id_namespace), '') IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'exact_source_id requires an exclusive source_id_namespace proof';
  END IF;

  IF (SELECT apply FROM product_test_remap_options) THEN
    PERFORM 1
    FROM product_tests tests
    JOIN product_test_remaps_import remaps
      ON tests.source_key = remaps.source_key
      AND tests.tested_source_product_id = remaps.tested_source_product_id
    FOR UPDATE OF tests;
  END IF;
END $$;

CREATE TEMP TABLE product_test_remap_sources_current ON COMMIT DROP AS
SELECT
  tests.source_key,
  tests.tested_source_product_id,
  MIN(tests.tested_product_name) AS tested_product_name,
  MIN(tests.tested_product_brand) AS tested_product_brand,
  MIN(tests.tested_product_upc) AS tested_product_upc,
  MIN(tests.tested_product_upc_raw) AS tested_product_upc_raw,
  MIN(tests.tested_package_size) AS tested_package_size,
  MIN(tests.food_id) AS food_id,
  MIN(tests.supplement_id) AS supplement_id,
  MIN(tests.match_method) AS match_method,
  COUNT(*) AS product_test_rows,
  COUNT(DISTINCT jsonb_build_array(
    tests.tested_product_name,
    tests.tested_product_brand,
    tests.tested_product_upc,
    tests.tested_product_upc_raw,
    tests.tested_package_size
  )) AS source_identity_variants,
  COUNT(DISTINCT jsonb_build_array(
    tests.food_id,
    tests.supplement_id,
    tests.match_method
  )) AS current_target_variants,
  jsonb_agg(
    jsonb_build_array(
      tests.source_result_id,
      tests.contaminant_key,
      tests.remap_revision,
      md5((
        to_jsonb(tests)
          - ARRAY['food_id', 'supplement_id', 'match_method', 'remap_revision', 'imported_at']
      )::text)
    )
    ORDER BY tests.source_result_id, tests.contaminant_key
  ) AS observation_revisions,
  md5(jsonb_build_object(
    'version', 'product-test-source-fingerprint-v2',
    'sourceKey', tests.source_key,
    'testedSourceProductId', tests.tested_source_product_id,
    'testedProductName', MIN(tests.tested_product_name),
    'testedProductBrand', MIN(tests.tested_product_brand),
    'testedProductUpc', MIN(tests.tested_product_upc),
    'testedProductUpcRaw', MIN(tests.tested_product_upc_raw),
    'testedPackageSize', MIN(tests.tested_package_size)
  )::text) AS source_fingerprint
FROM product_tests tests
JOIN product_test_remaps_import remaps
  ON tests.source_key = remaps.source_key
  AND tests.tested_source_product_id = remaps.tested_source_product_id
GROUP BY tests.source_key, tests.tested_source_product_id;

CREATE TEMP TABLE product_test_remap_targets ON COMMIT DROP AS
SELECT
  remaps.source_key,
  remaps.tested_source_product_id,
  'food'::text AS target_kind,
  foods.id AS target_id,
  foods.canonical_key AS target_canonical_key,
  foods.data_origin AS target_data_origin,
  foods.data_origin_id AS target_data_origin_id,
  foods.name AS target_name,
  foods.brand AS target_brand,
  foods.upc AS target_upc,
  foods.off_market AS target_off_market,
  md5(jsonb_build_object(
    'version', 'product-test-target-fingerprint-v1',
    'kind', 'food',
    'id', foods.id,
    'canonicalKey', foods.canonical_key,
    'dataOrigin', foods.data_origin,
    'dataOriginId', foods.data_origin_id,
    'name', foods.name,
    'brand', foods.brand,
    'upc', foods.upc,
    'offMarket', foods.off_market
  )::text) AS target_fingerprint
FROM product_test_remaps_import remaps
JOIN foods ON foods.id = NULLIF(remaps.food_id, '')
WHERE NOT murph_product_test_legacy_source_backed_origin(foods.data_origin)

UNION ALL

SELECT
  remaps.source_key,
  remaps.tested_source_product_id,
  'supplement'::text AS target_kind,
  supplements.id AS target_id,
  supplements.canonical_key AS target_canonical_key,
  supplements.data_origin AS target_data_origin,
  supplements.data_origin_id AS target_data_origin_id,
  supplements.name AS target_name,
  supplements.brand AS target_brand,
  supplements.upc AS target_upc,
  supplements.off_market AS target_off_market,
  md5(jsonb_build_object(
    'version', 'product-test-target-fingerprint-v1',
    'kind', 'supplement',
    'id', supplements.id,
    'canonicalKey', supplements.canonical_key,
    'dataOrigin', supplements.data_origin,
    'dataOriginId', supplements.data_origin_id,
    'name', supplements.name,
    'brand', supplements.brand,
    'upc', supplements.upc,
    'offMarket', supplements.off_market
  )::text) AS target_fingerprint
FROM product_test_remaps_import remaps
JOIN supplements ON supplements.id = NULLIF(remaps.supplement_id, '')
WHERE NOT murph_product_test_legacy_source_backed_origin(supplements.data_origin)

UNION ALL

SELECT
  remaps.source_key,
  remaps.tested_source_product_id,
  NULL::text AS target_kind,
  NULL::text AS target_id,
  NULL::text AS target_canonical_key,
  NULL::text AS target_data_origin,
  NULL::text AS target_data_origin_id,
  NULL::text AS target_name,
  NULL::text AS target_brand,
  NULL::text AS target_upc,
  NULL::boolean AS target_off_market,
  NULL::text AS target_fingerprint
FROM product_test_remaps_import remaps
WHERE remaps.match_method = 'source_only';

CREATE TEMP TABLE product_test_remap_current_states ON COMMIT DROP AS
WITH current_state_targets AS (
  SELECT
    source_products.*,
    CASE
      WHEN current_food.id IS NOT NULL THEN md5(jsonb_build_object(
        'version', 'product-test-target-fingerprint-v1',
        'kind', 'food',
        'id', current_food.id,
        'canonicalKey', current_food.canonical_key,
        'dataOrigin', current_food.data_origin,
        'dataOriginId', current_food.data_origin_id,
        'name', current_food.name,
        'brand', current_food.brand,
        'upc', current_food.upc,
        'offMarket', current_food.off_market
      )::text)
      WHEN current_supplement.id IS NOT NULL THEN md5(jsonb_build_object(
        'version', 'product-test-target-fingerprint-v1',
        'kind', 'supplement',
        'id', current_supplement.id,
        'canonicalKey', current_supplement.canonical_key,
        'dataOrigin', current_supplement.data_origin,
        'dataOriginId', current_supplement.data_origin_id,
        'name', current_supplement.name,
        'brand', current_supplement.brand,
        'upc', current_supplement.upc,
        'offMarket', current_supplement.off_market
      )::text)
      ELSE NULL
    END AS current_target_fingerprint
  FROM product_test_remap_sources_current source_products
  LEFT JOIN foods current_food ON current_food.id = source_products.food_id
  LEFT JOIN supplements current_supplement
    ON current_supplement.id = source_products.supplement_id
)
SELECT
  current_state_targets.*,
  md5(jsonb_build_object(
    'version', 'product-test-link-state-fingerprint-v1',
    'foodId', current_state_targets.food_id,
    'supplementId', current_state_targets.supplement_id,
    'matchMethod', current_state_targets.match_method,
    'targetFingerprint', current_state_targets.current_target_fingerprint
  )::text) AS current_link_state_fingerprint,
  md5(jsonb_build_object(
    'version', 'product-test-remap-preimage-fingerprint-v3',
    'foodId', current_state_targets.food_id,
    'supplementId', current_state_targets.supplement_id,
    'matchMethod', current_state_targets.match_method,
    'targetFingerprint', current_state_targets.current_target_fingerprint,
    'observationRevisions', current_state_targets.observation_revisions
  )::text) AS current_state_fingerprint
FROM current_state_targets;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    LEFT JOIN product_test_remap_sources_current source_products
      ON source_products.source_key = remaps.source_key
      AND source_products.tested_source_product_id = remaps.tested_source_product_id
    WHERE source_products.source_key IS NULL
  ) THEN
    RAISE EXCEPTION 'product test remap row references missing source product tests';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remap_sources_current source_products
    WHERE
      source_products.source_identity_variants <> 1
      OR source_products.current_target_variants <> 1
  ) THEN
    RAISE EXCEPTION 'product test source rows have inconsistent identity or current target state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    JOIN product_test_remap_sources_current source_products
      ON source_products.source_key = remaps.source_key
      AND source_products.tested_source_product_id = remaps.tested_source_product_id
    WHERE NOT (
      source_products.tested_product_name IS NOT DISTINCT FROM NULLIF(remaps.tested_product_name, '')
      AND source_products.tested_product_brand IS NOT DISTINCT FROM NULLIF(remaps.tested_product_brand, '')
      AND source_products.tested_product_upc IS NOT DISTINCT FROM NULLIF(remaps.tested_product_upc, '')
      AND source_products.tested_package_size IS NOT DISTINCT FROM NULLIF(remaps.tested_package_size, '')
    )
  ) THEN
    RAISE EXCEPTION 'product test remap row source identity does not match current source product tests';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    JOIN product_test_remap_sources_current source_products
      ON source_products.source_key = remaps.source_key
      AND source_products.tested_source_product_id = remaps.tested_source_product_id
    WHERE remaps.source_fingerprint <> source_products.source_fingerprint
  ) THEN
    RAISE EXCEPTION 'product test remap source fingerprint is stale';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    LEFT JOIN product_test_remap_targets targets
      ON targets.source_key = remaps.source_key
      AND targets.tested_source_product_id = remaps.tested_source_product_id
    WHERE targets.source_key IS NULL
  ) THEN
    RAISE EXCEPTION 'product test remap row references missing or source-backed target';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    JOIN product_test_remap_targets targets
      ON targets.source_key = remaps.source_key
      AND targets.tested_source_product_id = remaps.tested_source_product_id
    WHERE remaps.target_fingerprint IS DISTINCT FROM targets.target_fingerprint
  ) THEN
    RAISE EXCEPTION 'product test remap target fingerprint is stale';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    JOIN product_test_remap_sources_current source_products
      ON source_products.source_key = remaps.source_key
      AND source_products.tested_source_product_id = remaps.tested_source_product_id
    JOIN product_test_remap_targets targets
      ON targets.source_key = remaps.source_key
      AND targets.tested_source_product_id = remaps.tested_source_product_id
    WHERE
      remaps.match_method = 'exact_upc'
      AND NOT (
        murph_product_test_canonical_gtin(source_products.tested_product_upc) IS NOT NULL
        AND murph_product_test_canonical_gtin(targets.target_upc)
          = murph_product_test_canonical_gtin(source_products.tested_product_upc)
        AND 1 = (
          SELECT COUNT(DISTINCT jsonb_build_array(eligible_targets.target_kind, eligible_targets.canonical_key))
          FROM (
            SELECT 'food'::text AS target_kind, foods.canonical_key
            FROM foods
            WHERE
              murph_product_test_canonical_gtin(foods.upc)
                = murph_product_test_canonical_gtin(source_products.tested_product_upc)
              AND NOT murph_product_test_legacy_source_backed_origin(foods.data_origin)
            UNION ALL
            SELECT 'supplement'::text AS target_kind, supplements.canonical_key
            FROM supplements
            WHERE
              murph_product_test_canonical_gtin(supplements.upc)
                = murph_product_test_canonical_gtin(source_products.tested_product_upc)
              AND NOT murph_product_test_legacy_source_backed_origin(supplements.data_origin)
          ) eligible_targets
        )
      )
  ) THEN
    RAISE EXCEPTION 'exact_upc proof requires valid GTIN checksums, canonical GTIN equality, and one unique target canonical group';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    JOIN product_test_remap_sources_current source_products
      ON source_products.source_key = remaps.source_key
      AND source_products.tested_source_product_id = remaps.tested_source_product_id
    JOIN product_test_remap_targets targets
      ON targets.source_key = remaps.source_key
      AND targets.tested_source_product_id = remaps.tested_source_product_id
    WHERE
      remaps.match_method = 'exact_source_id'
      AND NOT (
        remaps.source_id_namespace = targets.target_data_origin
        AND source_products.tested_source_product_id
          = targets.target_data_origin || ':' || targets.target_data_origin_id
        AND 1 = (
          SELECT COUNT(DISTINCT jsonb_build_array(eligible_targets.target_kind, eligible_targets.canonical_key))
          FROM (
            SELECT 'food'::text AS target_kind, foods.canonical_key
            FROM foods
            WHERE
              foods.data_origin = targets.target_data_origin
              AND foods.data_origin_id = targets.target_data_origin_id
              AND NOT murph_product_test_legacy_source_backed_origin(foods.data_origin)
            UNION ALL
            SELECT 'supplement'::text AS target_kind, supplements.canonical_key
            FROM supplements
            WHERE
              supplements.data_origin = targets.target_data_origin
              AND supplements.data_origin_id = targets.target_data_origin_id
              AND NOT murph_product_test_legacy_source_backed_origin(supplements.data_origin)
          ) eligible_targets
        )
      )
  ) THEN
    RAISE EXCEPTION 'exact_source_id proof does not match one namespaced target canonical group';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM product_test_remaps_import remaps
    JOIN product_test_remap_current_states source_products
      ON source_products.source_key = remaps.source_key
      AND source_products.tested_source_product_id = remaps.tested_source_product_id
    WHERE NOT (
      source_products.current_state_fingerprint = remaps.expected_current_state_fingerprint
      OR source_products.current_link_state_fingerprint = md5(jsonb_build_object(
        'version', 'product-test-link-state-fingerprint-v1',
        'foodId', NULLIF(remaps.food_id, ''),
        'supplementId', NULLIF(remaps.supplement_id, ''),
        'matchMethod', remaps.match_method,
        'targetFingerprint', remaps.target_fingerprint
      )::text)
    )
  ) THEN
    RAISE EXCEPTION 'product test remap compare-and-set conflict with unexpected current link state';
  END IF;
END $$;

CREATE TEMP TABLE product_test_remap_plan ON COMMIT DROP AS
SELECT
  decisions.*,
  decisions.current_link_state_fingerprint = decisions.desired_state_fingerprint AS is_noop
FROM (
  SELECT
    remaps.source_key,
    remaps.tested_source_product_id,
    remaps.source_fingerprint,
    remaps.expected_current_state_fingerprint,
    source_products.current_state_fingerprint,
    source_products.current_link_state_fingerprint,
    source_products.product_test_rows,
    source_products.food_id AS before_food_id,
    source_products.supplement_id AS before_supplement_id,
    source_products.match_method AS before_match_method,
    NULLIF(remaps.food_id, '') AS after_food_id,
    NULLIF(remaps.supplement_id, '') AS after_supplement_id,
    remaps.match_method AS after_match_method,
    remaps.target_fingerprint,
    md5(jsonb_build_object(
      'version', 'product-test-link-state-fingerprint-v1',
      'foodId', NULLIF(remaps.food_id, ''),
      'supplementId', NULLIF(remaps.supplement_id, ''),
      'matchMethod', remaps.match_method,
      'targetFingerprint', remaps.target_fingerprint
    )::text) AS desired_state_fingerprint
  FROM product_test_remaps_import remaps
  JOIN product_test_remap_current_states source_products
    ON source_products.source_key = remaps.source_key
    AND source_products.tested_source_product_id = remaps.tested_source_product_id
) decisions;

CREATE TEMP TABLE product_test_remap_mutation_rows ON COMMIT DROP AS
SELECT
  tests.source_key,
  tests.source_result_id,
  tests.contaminant_key,
  tests.tested_source_product_id,
  tests.tested_package_size,
  plan.source_fingerprint,
  plan.expected_current_state_fingerprint,
  plan.current_state_fingerprint,
  plan.desired_state_fingerprint,
  tests.food_id AS before_food_id,
  tests.supplement_id AS before_supplement_id,
  tests.match_method AS before_match_method,
  tests.remap_revision AS before_remap_revision,
  plan.after_food_id,
  plan.after_supplement_id,
  plan.after_match_method,
  plan.target_fingerprint
FROM product_tests tests
JOIN product_test_remap_plan plan
  ON tests.source_key = plan.source_key
  AND tests.tested_source_product_id = plan.tested_source_product_id
WHERE NOT plan.is_noop;

\if :remap_apply
DO $$
DECLARE
  expected_rows BIGINT;
  updated_rows BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO expected_rows
  FROM product_test_remap_mutation_rows;

  UPDATE product_tests tests
  SET
    food_id = plan.after_food_id,
    supplement_id = plan.after_supplement_id,
    match_method = plan.after_match_method,
    remap_revision = plan.before_remap_revision + 1
  FROM product_test_remap_mutation_rows plan
  WHERE
    tests.source_key = plan.source_key
    AND tests.source_result_id = plan.source_result_id
    AND tests.contaminant_key = plan.contaminant_key
    AND tests.food_id IS NOT DISTINCT FROM plan.before_food_id
    AND tests.supplement_id IS NOT DISTINCT FROM plan.before_supplement_id
    AND tests.match_method = plan.before_match_method
    AND tests.remap_revision = plan.before_remap_revision;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> expected_rows THEN
    RAISE EXCEPTION 'product test remap compare-and-set update count changed unexpectedly';
  END IF;
END $$;

\copy (SELECT source_key, source_result_id, contaminant_key, tested_source_product_id, tested_package_size, source_fingerprint, expected_current_state_fingerprint, current_state_fingerprint, desired_state_fingerprint, before_food_id, before_supplement_id, before_match_method, before_remap_revision, after_food_id, after_supplement_id, after_match_method, before_remap_revision + 1 AS after_remap_revision, target_fingerprint FROM product_test_remap_mutation_rows ORDER BY source_key, source_result_id, contaminant_key) TO __MANIFEST_TSV__ WITH (FORMAT csv, DELIMITER E'\t', HEADER true)
\endif

SELECT format(
  'mode=%s decisions=%s mutations=%s noops=%s observation_rows=%s',
  CASE WHEN :'remap_apply'::boolean THEN 'apply' ELSE 'dry-run' END,
  COUNT(*),
  COUNT(*) FILTER (WHERE NOT is_noop),
  COUNT(*) FILTER (WHERE is_noop),
  COALESCE(SUM(product_test_rows) FILTER (WHERE NOT is_noop), 0)
)
FROM product_test_remap_plan;

\if :remap_apply
COMMIT;
\else
ROLLBACK;
\endif
