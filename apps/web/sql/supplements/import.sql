\set ON_ERROR_STOP on

CREATE TEMP TABLE dsld_import_raw (
  label JSONB NOT NULL
);

\copy dsld_import_raw(label) FROM PROGRAM 'if [ -n "$DSLD_NDJSON_PATH" ]; then cat "$DSLD_NDJSON_PATH"; else echo "DSLD_NDJSON_PATH is required" >&2; exit 1; fi' WITH (FORMAT csv, DELIMITER E'\t', QUOTE E'\b');

BEGIN;

WITH normalized AS (
  SELECT
    label,

    COALESCE(
      NULLIF(label->>'id', ''),
      NULLIF(label->>'dsldId', ''),
      NULLIF(label->>'DSLD_ID', '')
    ) AS id_text,

    COALESCE(
      NULLIF(label->>'fullName', ''),
      NULLIF(label->>'name', ''),
      NULLIF(label->>'productName', ''),
      'Unknown supplement'
    ) AS name,

    NULLIF(
      btrim(COALESCE(
        label->>'brandName',
        label->>'brand',
        label->>'brand_name'
      )),
      ''
    ) AS brand,

    NULLIF(
      regexp_replace(
        COALESCE(
          label->>'upcSku',
          label->>'upc',
          label->>'upc_code',
          ''
        ),
        '\D',
        '',
        'g'
      ),
      ''
    ) AS upc,

    CASE lower(
      COALESCE(
        label->>'offMarket',
        label->>'off_market',
        'false'
      )
    )
      WHEN '1' THEN true
      WHEN 'true' THEN true
      WHEN 'yes' THEN true
      ELSE false
    END AS off_market,

    CASE
      WHEN jsonb_typeof(label->'ingredientRows') = 'array'
      THEN label->'ingredientRows'
      ELSE '[]'::jsonb
    END AS ingredient_rows,

    CASE
      WHEN jsonb_typeof(label#>'{otheringredients,ingredients}') = 'array'
      THEN label#>'{otheringredients,ingredients}'
      ELSE '[]'::jsonb
    END AS other_ingredient_rows,

    COALESCE(
      (
        SELECT (serving_size->>'grams')::numeric
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(label->'servingSizes') = 'array'
              THEN label->'servingSizes'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS serving_size_rows(serving_size, serving_rank)
        WHERE serving_size->>'grams' ~ '^[0-9]+(\.[0-9]+)?$'
          AND (serving_size->>'grams')::numeric > 0
          AND (serving_size->>'grams')::numeric <= 2000
        ORDER BY serving_rank
        LIMIT 1
      ),
      (
        SELECT (serving_size->>'amount')::numeric
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(label->'servingSizes') = 'array'
              THEN label->'servingSizes'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS serving_size_rows(serving_size, serving_rank)
        WHERE serving_size->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
          AND lower(btrim(serving_size->>'unit')) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
          AND (serving_size->>'amount')::numeric > 0
          AND (serving_size->>'amount')::numeric <= 2000
        ORDER BY serving_rank
        LIMIT 1
      )
    ) AS serving_grams

  FROM dsld_import_raw
),
rows_to_import AS (
  SELECT
    id_text::BIGINT::text AS id,
    'dsld:' || id_text::BIGINT::text AS canonical_key,
    'dsld' AS data_origin,
    id_text::BIGINT::text AS data_origin_id,
    NULL::text AS data_origin_url,
    10::smallint AS data_origin_priority,
    name,
    brand,
    upc,
    off_market,

    CONCAT_WS(
      ' ',
      name,
      brand,
      upc,
      (
        SELECT string_agg(term, ' ')
        FROM (
          SELECT ingredient->>'name' AS term
          FROM jsonb_array_elements(ingredient_rows) AS ingredient

          UNION ALL

          SELECT nested_ingredient->>'name' AS term
          FROM jsonb_array_elements(ingredient_rows) AS ingredient
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(ingredient->'nestedRows') = 'array'
              THEN ingredient->'nestedRows'
              ELSE '[]'::jsonb
            END
          ) AS nested_ingredient
        ) ingredient_terms
      ),
      (
        SELECT string_agg(ingredient->>'name', ' ')
        FROM jsonb_array_elements(other_ingredient_rows) AS ingredient
      )
    ) AS search_text_raw,

    label,
    serving_grams
  FROM normalized
  WHERE id_text ~ '^\d+$'
),
prepared AS (
  SELECT
    *,
    left(regexp_replace(btrim(search_text_raw), '\s+', ' ', 'g'), 6000) AS search_text
  FROM rows_to_import
)
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
  label,
  serving_grams
)
SELECT
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
  serving_grams
FROM prepared
ON CONFLICT (id) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key,
  data_origin = EXCLUDED.data_origin,
  data_origin_id = EXCLUDED.data_origin_id,
  data_origin_url = EXCLUDED.data_origin_url,
  data_origin_priority = EXCLUDED.data_origin_priority,
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  serving_grams = EXCLUDED.serving_grams,
  imported_at = now();

ANALYZE supplements;

\set reviewed_serving_grams_entity_type supplement
\ir ../product-tests/apply-reviewed-serving-grams.sql
\unset reviewed_serving_grams_entity_type

COMMIT;
