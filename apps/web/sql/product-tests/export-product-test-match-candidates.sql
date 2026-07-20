\set ON_ERROR_STOP on

COPY (
WITH source_products AS MATERIALIZED (
  SELECT
    tests.source_key,
    tests.tested_source_product_id,
    NULLIF(MIN(NULLIF(tests.tested_product_name, '')), '') AS tested_product_name,
    NULLIF(MIN(NULLIF(tests.tested_product_brand, '')), '') AS tested_product_brand,
    NULLIF(MIN(NULLIF(tests.tested_product_upc, '')), '') AS tested_product_upc,
    COUNT(*) AS product_test_rows,
    string_agg(DISTINCT tests.contaminant_key, ', ' ORDER BY tests.contaminant_key) AS contaminant_keys
  FROM product_tests tests
  WHERE
    tests.match_method = 'source_only'
    AND (:'source_key_filter' = '' OR tests.source_key = :'source_key_filter')
  GROUP BY tests.source_key, tests.tested_source_product_id
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
    regexp_replace(COALESCE(source_products.tested_product_upc, ''), '\D', '', 'g') AS normalized_source_upc
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
    source_queries.product_test_rows,
    source_queries.contaminant_keys,
    candidates.candidate_kind,
    candidates.candidate_id,
    candidates.candidate_name,
    candidates.candidate_brand,
    candidates.candidate_upc,
    candidates.candidate_data_origin,
    candidates.candidate_data_origin_id,
    candidates.candidate_off_market,
    candidates.candidate_reason,
    candidates.candidate_score,
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
    SELECT DISTINCT ON (candidate_kind, candidate_id)
      candidate_kind,
      candidate_id,
      candidate_name,
      candidate_brand,
      candidate_upc,
      candidate_data_origin,
      candidate_data_origin_id,
      candidate_off_market,
      candidate_reason,
      candidate_score
    FROM (
      SELECT
        'food'::text AS candidate_kind,
        foods.id AS candidate_id,
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
        )::double precision AS candidate_score
      FROM foods
      WHERE
        source_queries.normalized_source_upc <> ''
        AND foods.upc = source_queries.normalized_source_upc
        AND foods.data_origin NOT IN (
          'plasticlist_bay_area_2024',
          'nyc_dohmh_consumer_products',
          'king_county_consumer_products',
          'pure_earth_rms_2024'
        )

      UNION ALL

      SELECT
        'supplement'::text AS candidate_kind,
        supplements.id AS candidate_id,
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
        )::double precision AS candidate_score
      FROM supplements
      WHERE
        source_queries.normalized_source_upc <> ''
        AND supplements.upc = source_queries.normalized_source_upc
        AND supplements.data_origin NOT IN (
          'plasticlist_bay_area_2024',
          'nyc_dohmh_consumer_products',
          'king_county_consumer_products',
          'pure_earth_rms_2024'
        )

      UNION ALL

      SELECT *
      FROM (
        SELECT
          'food'::text AS candidate_kind,
          foods.id AS candidate_id,
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
          )::double precision AS candidate_score
        FROM foods
        WHERE
          source_queries.source_search_query <> ''
          AND to_tsvector('simple', foods.search_text) @@ websearch_to_tsquery('simple', source_queries.source_search_query)
          AND foods.data_origin NOT IN (
            'plasticlist_bay_area_2024',
            'nyc_dohmh_consumer_products',
            'king_county_consumer_products',
            'pure_earth_rms_2024'
          )
        ORDER BY candidate_score DESC, foods.off_market ASC, foods.name ASC, foods.id ASC
        LIMIT 25
      ) food_name_candidates

      UNION ALL

      SELECT *
      FROM (
        SELECT
          'supplement'::text AS candidate_kind,
          supplements.id AS candidate_id,
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
          )::double precision AS candidate_score
        FROM supplements
        WHERE
          source_queries.source_search_query <> ''
          AND to_tsvector('simple', supplements.search_text) @@ websearch_to_tsquery('simple', source_queries.source_search_query)
          AND supplements.data_origin NOT IN (
            'plasticlist_bay_area_2024',
            'nyc_dohmh_consumer_products',
            'king_county_consumer_products',
            'pure_earth_rms_2024'
          )
        ORDER BY candidate_score DESC, supplements.off_market ASC, supplements.name ASC, supplements.id ASC
        LIMIT 25
      ) supplement_name_candidates
    ) raw_candidates
    ORDER BY
      candidate_kind,
      candidate_id,
      candidate_score DESC,
      candidate_reason ASC
  ) candidates ON true
)
SELECT
  source_key,
  tested_source_product_id,
  tested_product_name,
  tested_product_brand,
  tested_product_upc,
  product_test_rows,
  contaminant_keys,
  candidate_rank,
  candidate_kind,
  candidate_id,
  candidate_name,
  candidate_brand,
  candidate_upc,
  candidate_data_origin,
  candidate_data_origin_id,
  candidate_off_market,
  candidate_reason,
  round(candidate_score::numeric, 3) AS candidate_score,
  CASE candidate_reason WHEN 'exact_upc' THEN 'exact_upc' ELSE 'manual_confirmed' END AS suggested_match_method,
  ''::text AS review_note
FROM ranked_candidates
WHERE candidate_rank <= :'candidate_limit'::integer
ORDER BY
  source_key,
  tested_source_product_id,
  candidate_rank
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\t', HEADER true, FORCE_QUOTE *);
