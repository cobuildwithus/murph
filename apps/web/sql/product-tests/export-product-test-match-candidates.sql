\set ON_ERROR_STOP on

COPY (
WITH source_products AS MATERIALIZED (
  SELECT
    tests.source_key,
    tests.tested_source_product_id,
    NULLIF(MIN(NULLIF(tests.tested_product_name, '')), '') AS tested_product_name,
    NULLIF(MIN(NULLIF(tests.tested_product_brand, '')), '') AS tested_product_brand,
    NULLIF(MIN(NULLIF(tests.tested_product_upc, '')), '') AS tested_product_upc,
    NULLIF(MIN(NULLIF(tests.tested_product_upc_raw, '')), '') AS tested_product_upc_raw,
    NULLIF(MIN(NULLIF(tests.tested_package_size, '')), '') AS tested_package_size,
    COUNT(*) AS product_test_rows,
    string_agg(DISTINCT tests.contaminant_key, ', ' ORDER BY tests.contaminant_key) AS contaminant_keys,
    MIN(tests.food_id) AS current_food_id,
    MIN(tests.supplement_id) AS current_supplement_id,
    MIN(tests.match_method) AS current_match_method,
    md5(jsonb_build_object(
      'version', 'product-test-remap-preimage-fingerprint-v3',
      'foodId', MIN(tests.food_id),
      'supplementId', MIN(tests.supplement_id),
      'matchMethod', MIN(tests.match_method),
      'targetFingerprint', NULL,
      'observationRevisions', jsonb_agg(
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
      )
    )::text) AS current_state_fingerprint,
    md5(jsonb_build_object(
      'version', 'product-test-source-fingerprint-v2',
      'sourceKey', tests.source_key,
      'testedSourceProductId', tests.tested_source_product_id,
      'testedProductName', MIN(tests.tested_product_name),
      'testedProductBrand', MIN(tests.tested_product_brand),
      'testedProductUpc', MIN(tests.tested_product_upc),
      'testedProductUpcRaw', MIN(tests.tested_product_upc_raw),
      'testedPackageSize', MIN(tests.tested_package_size)
    )::text) AS source_fingerprint,
    md5(jsonb_build_object(
      'version', 'product-test-source-snapshot-v1',
      'sourceKey', tests.source_key,
      'testedSourceProductId', tests.tested_source_product_id,
      'observations', jsonb_agg(
        jsonb_build_array(tests.source_result_id, tests.contaminant_key)
        ORDER BY tests.source_result_id, tests.contaminant_key
      )
    )::text) AS source_snapshot_fingerprint
  FROM product_tests tests
  WHERE
    tests.tested_source_product_id IS NOT NULL
    AND (:'source_key_filter' = '' OR tests.source_key = :'source_key_filter')
  GROUP BY tests.source_key, tests.tested_source_product_id
  HAVING
    bool_and(
      tests.match_method = 'source_only'
      AND tests.food_id IS NULL
      AND tests.supplement_id IS NULL
    )
),
source_queries AS MATERIALIZED (
  SELECT
    source_products.*,
    btrim(concat_ws(' ', source_products.tested_product_brand, source_products.tested_product_name)) AS source_query,
    btrim(regexp_replace(
      regexp_replace(
        concat_ws(' ', source_products.tested_product_brand, source_products.tested_product_name),
        '([0-9])([[:alpha:]])',
        '\1 \2',
        'g'
      ),
      '[^[:alnum:]]+',
      ' ',
      'g'
    )) AS source_search_query,
    btrim(regexp_replace(replace(lower(COALESCE(source_products.tested_product_name, '')), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_source_name,
    btrim(regexp_replace(replace(lower(COALESCE(source_products.tested_product_brand, '')), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_source_brand,
    murph_product_test_canonical_gtin(source_products.tested_product_upc) AS canonical_source_gtin,
    CASE
      WHEN murph_product_test_canonical_gtin(source_products.tested_product_upc) IS NOT NULL THEN (
        SELECT COUNT(DISTINCT jsonb_build_array(exact_targets.target_kind, exact_targets.canonical_key))
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
        ) exact_targets
      )
      ELSE 0
    END AS exact_upc_canonical_groups
  FROM source_products
  WHERE NULLIF(source_products.tested_product_name, '') IS NOT NULL
),
ranked_candidates AS (
  SELECT
    source_queries.source_key,
    source_queries.tested_source_product_id,
    source_queries.tested_product_name,
    source_queries.tested_product_brand,
    source_queries.tested_product_upc,
    source_queries.tested_product_upc_raw,
    source_queries.tested_package_size,
    source_queries.canonical_source_gtin,
    source_queries.exact_upc_canonical_groups,
    source_queries.product_test_rows,
    source_queries.contaminant_keys,
    source_queries.source_fingerprint,
    source_queries.source_snapshot_fingerprint,
    source_queries.current_food_id,
    source_queries.current_supplement_id,
    source_queries.current_match_method,
    source_queries.current_state_fingerprint,
    candidates.candidate_kind,
    candidates.candidate_id,
    candidates.candidate_canonical_key,
    candidates.candidate_name,
    candidates.candidate_brand,
    candidates.candidate_upc,
    candidates.candidate_data_origin,
    candidates.candidate_data_origin_id,
    candidates.candidate_off_market,
    candidates.candidate_reason,
    candidates.candidate_score,
    candidates.target_fingerprint,
    row_number() OVER (
      PARTITION BY source_queries.source_key, source_queries.tested_source_product_id
      ORDER BY
        candidates.candidate_score DESC,
        candidates.candidate_off_market ASC,
        candidates.candidate_kind ASC,
        candidates.candidate_name ASC,
        candidates.candidate_id ASC
    ) AS candidate_rank
  FROM source_queries
  JOIN LATERAL (
    SELECT DISTINCT ON (candidate_kind, candidate_canonical_key)
      candidate_kind,
      candidate_id,
      candidate_canonical_key,
      candidate_name,
      candidate_brand,
      candidate_upc,
      candidate_data_origin,
      candidate_data_origin_id,
      candidate_off_market,
      candidate_reason,
      candidate_score,
      target_fingerprint
    FROM (
      SELECT
        'food'::text AS candidate_kind,
        foods.id AS candidate_id,
        foods.canonical_key AS candidate_canonical_key,
        foods.name AS candidate_name,
        foods.brand AS candidate_brand,
        foods.upc AS candidate_upc,
        foods.data_origin AS candidate_data_origin,
        foods.data_origin_id AS candidate_data_origin_id,
        foods.off_market AS candidate_off_market,
        'exact_upc'::text AS candidate_reason,
        (
          1000
          + strict_word_similarity(foods.name, source_queries.tested_product_name) * 100
          + CASE
            WHEN source_queries.normalized_source_brand <> ''
              AND btrim(regexp_replace(replace(lower(COALESCE(foods.brand, '')), '''', ''), '[^a-z0-9]+', ' ', 'g')) = source_queries.normalized_source_brand
            THEN 80
            ELSE 0
          END
          - CASE WHEN foods.off_market THEN 10 ELSE 0 END
          - (foods.data_origin_priority::double precision / 1000)
        )::double precision AS candidate_score,
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
      FROM foods
      WHERE
        source_queries.exact_upc_canonical_groups = 1
        AND source_queries.canonical_source_gtin IS NOT NULL
        AND murph_product_test_canonical_gtin(foods.upc) = source_queries.canonical_source_gtin
        AND NOT murph_product_test_legacy_source_backed_origin(foods.data_origin)

      UNION ALL

      SELECT
        'supplement'::text AS candidate_kind,
        supplements.id AS candidate_id,
        supplements.canonical_key AS candidate_canonical_key,
        supplements.name AS candidate_name,
        supplements.brand AS candidate_brand,
        supplements.upc AS candidate_upc,
        supplements.data_origin AS candidate_data_origin,
        supplements.data_origin_id AS candidate_data_origin_id,
        supplements.off_market AS candidate_off_market,
        'exact_upc'::text AS candidate_reason,
        (
          1000
          + strict_word_similarity(supplements.name, source_queries.tested_product_name) * 100
          + CASE
            WHEN source_queries.normalized_source_brand <> ''
              AND btrim(regexp_replace(replace(lower(COALESCE(supplements.brand, '')), '''', ''), '[^a-z0-9]+', ' ', 'g')) = source_queries.normalized_source_brand
            THEN 80
            ELSE 0
          END
          - CASE WHEN supplements.off_market THEN 10 ELSE 0 END
          - (supplements.data_origin_priority::double precision / 1000)
        )::double precision AS candidate_score,
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
      FROM supplements
      WHERE
        source_queries.exact_upc_canonical_groups = 1
        AND source_queries.canonical_source_gtin IS NOT NULL
        AND murph_product_test_canonical_gtin(supplements.upc) = source_queries.canonical_source_gtin
        AND NOT murph_product_test_legacy_source_backed_origin(supplements.data_origin)

      UNION ALL

      SELECT *
      FROM (
        SELECT
          'food'::text AS candidate_kind,
          foods.id AS candidate_id,
          foods.canonical_key AS candidate_canonical_key,
          foods.name AS candidate_name,
          foods.brand AS candidate_brand,
          foods.upc AS candidate_upc,
          foods.data_origin AS candidate_data_origin,
          foods.data_origin_id AS candidate_data_origin_id,
          foods.off_market AS candidate_off_market,
          'name_fts'::text AS candidate_reason,
          (
            strict_word_similarity(foods.name, source_queries.tested_product_name) * 100
            + ts_rank_cd(to_tsvector('simple', foods.search_text), websearch_to_tsquery('simple', source_queries.source_search_query)) * 25
            + CASE
              WHEN source_queries.normalized_source_brand <> ''
                AND btrim(regexp_replace(replace(lower(COALESCE(foods.brand, '')), '''', ''), '[^a-z0-9]+', ' ', 'g')) = source_queries.normalized_source_brand
              THEN 80
              ELSE 0
            END
            + CASE
              WHEN strpos(
                ' ' || btrim(regexp_replace(replace(lower(foods.name), '''', ''), '[^a-z0-9]+', ' ', 'g')) || ' ',
                ' ' || source_queries.normalized_source_name || ' '
              ) > 0
                OR strpos(
                  ' ' || source_queries.normalized_source_name || ' ',
                  ' ' || btrim(regexp_replace(replace(lower(foods.name), '''', ''), '[^a-z0-9]+', ' ', 'g')) || ' '
                ) > 0
              THEN 50
              ELSE 0
            END
            - CASE WHEN foods.off_market THEN 10 ELSE 0 END
            - (foods.data_origin_priority::double precision / 1000)
          )::double precision AS candidate_score,
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
        FROM foods
        WHERE
          source_queries.source_search_query <> ''
          AND to_tsvector('simple', foods.search_text) @@ websearch_to_tsquery('simple', source_queries.source_search_query)
          AND NOT murph_product_test_legacy_source_backed_origin(foods.data_origin)
        ORDER BY candidate_score DESC, foods.off_market ASC, foods.name ASC, foods.id ASC
        LIMIT 25
      ) food_name_candidates

      UNION ALL

      SELECT *
      FROM (
        SELECT
          'supplement'::text AS candidate_kind,
          supplements.id AS candidate_id,
          supplements.canonical_key AS candidate_canonical_key,
          supplements.name AS candidate_name,
          supplements.brand AS candidate_brand,
          supplements.upc AS candidate_upc,
          supplements.data_origin AS candidate_data_origin,
          supplements.data_origin_id AS candidate_data_origin_id,
          supplements.off_market AS candidate_off_market,
          'name_fts'::text AS candidate_reason,
          (
            strict_word_similarity(supplements.name, source_queries.tested_product_name) * 100
            + ts_rank_cd(to_tsvector('simple', supplements.search_text), websearch_to_tsquery('simple', source_queries.source_search_query)) * 25
            + CASE
              WHEN source_queries.normalized_source_brand <> ''
                AND btrim(regexp_replace(replace(lower(COALESCE(supplements.brand, '')), '''', ''), '[^a-z0-9]+', ' ', 'g')) = source_queries.normalized_source_brand
              THEN 80
              ELSE 0
            END
            + CASE
              WHEN strpos(
                ' ' || btrim(regexp_replace(replace(lower(supplements.name), '''', ''), '[^a-z0-9]+', ' ', 'g')) || ' ',
                ' ' || source_queries.normalized_source_name || ' '
              ) > 0
                OR strpos(
                  ' ' || source_queries.normalized_source_name || ' ',
                  ' ' || btrim(regexp_replace(replace(lower(supplements.name), '''', ''), '[^a-z0-9]+', ' ', 'g')) || ' '
                ) > 0
              THEN 50
              ELSE 0
            END
            - CASE WHEN supplements.off_market THEN 10 ELSE 0 END
            - (supplements.data_origin_priority::double precision / 1000)
          )::double precision AS candidate_score,
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
        FROM supplements
        WHERE
          source_queries.source_search_query <> ''
          AND to_tsvector('simple', supplements.search_text) @@ websearch_to_tsquery('simple', source_queries.source_search_query)
          AND NOT murph_product_test_legacy_source_backed_origin(supplements.data_origin)
        ORDER BY candidate_score DESC, supplements.off_market ASC, supplements.name ASC, supplements.id ASC
        LIMIT 25
      ) supplement_name_candidates
    ) raw_candidates
    ORDER BY
      candidate_kind,
      candidate_canonical_key,
      candidate_score DESC,
      candidate_off_market ASC,
      candidate_reason ASC,
      candidate_id ASC
  ) candidates ON true
),
ranked_with_runner_up AS (
  SELECT
    ranked_candidates.*,
    max(candidate_score) FILTER (WHERE candidate_rank = 2) OVER (
      PARTITION BY source_key, tested_source_product_id
    ) AS runner_up_score
  FROM ranked_candidates
)
SELECT
  source_key,
  tested_source_product_id,
  tested_product_name,
  tested_product_brand,
  tested_product_upc,
  tested_product_upc_raw,
  tested_package_size,
  canonical_source_gtin,
  exact_upc_canonical_groups,
  source_fingerprint,
  source_snapshot_fingerprint,
  product_test_rows,
  contaminant_keys,
  current_food_id,
  current_supplement_id,
  current_match_method,
  current_state_fingerprint,
  candidate_rank,
  candidate_kind,
  candidate_id,
  candidate_canonical_key,
  candidate_name,
  candidate_brand,
  candidate_upc,
  candidate_data_origin,
  candidate_data_origin_id,
  candidate_off_market,
  candidate_reason,
  round(candidate_score::numeric, 3) AS candidate_score,
  CASE WHEN candidate_rank = 1 THEN round(runner_up_score::numeric, 3) END AS runner_up_score,
  CASE WHEN candidate_rank = 1 THEN round((candidate_score - runner_up_score)::numeric, 3) END AS candidate_score_margin,
  target_fingerprint,
  CASE candidate_reason WHEN 'exact_upc' THEN 'exact_upc' ELSE 'manual_confirmed' END AS suggested_match_method,
  ''::text AS review_note
FROM ranked_with_runner_up
WHERE candidate_rank <= :'candidate_limit'::integer
ORDER BY
  source_key,
  tested_source_product_id,
  candidate_rank
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\t', HEADER true, FORCE_QUOTE *);
