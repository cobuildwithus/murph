-- Imports USDA FoodData Central foods into the labels DB `foods` table.
-- Source: the FULL FDC CSV archive (one consistent set of support files).
-- Run via import-fdc.sh, which prefilters food_nutrient.csv locally and
-- exports the required env vars. Requires psql var :fdc_release_date.
--
-- Re-runnable and upsert-only: ON CONFLICT (data_origin, data_origin_id).
-- Rows are never deleted; rows absent from newer releases simply stop
-- advancing fdc_release_date / last_seen_at.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.fdc_compact_text(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(regexp_replace(btrim(COALESCE(value, '')), '\s+', ' ', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION pg_temp.fdc_key_text(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    regexp_replace(
      btrim(regexp_replace(lower(COALESCE(value, '')), '[^a-z0-9]+', ' ', 'g')),
      '\s+',
      ' ',
      'g'
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.fdc_numeric(value TEXT)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(value, '')) ~ '^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
    THEN btrim(value)::numeric
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.fdc_date(value TEXT)
RETURNS DATE
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(value, '')) ~ '^\d{4}-\d{2}-\d{2}$'
    THEN btrim(value)::date
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.fdc_data_type(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT regexp_replace(
      regexp_replace(
        lower(COALESCE(value, '')),
        '[^a-z0-9]+',
        '_',
        'g'
      ),
      '^_+|_+$',
      '',
      'g'
    ) AS value
  )
  SELECT CASE value
    WHEN 'branded' THEN 'branded_food'
    WHEN 'branded_food' THEN 'branded_food'
    WHEN 'foundation' THEN 'foundation_food'
    WHEN 'foundation_food' THEN 'foundation_food'
    WHEN 'sr_legacy' THEN 'sr_legacy_food'
    WHEN 'sr_legacy_food' THEN 'sr_legacy_food'
    WHEN 'survey_fndds' THEN 'survey_fndds_food'
    WHEN 'survey_fndds_food' THEN 'survey_fndds_food'
    ELSE NULL
  END
  FROM normalized;
$$;

CREATE TEMP TABLE fdc_food_raw (
  fdc_id TEXT NOT NULL,
  data_type TEXT,
  description TEXT,
  food_category_id TEXT,
  publication_date TEXT
);

CREATE TEMP TABLE fdc_branded_raw (
  fdc_id TEXT NOT NULL,
  brand_owner TEXT,
  brand_name TEXT,
  subbrand_name TEXT,
  gtin_upc TEXT,
  ingredients TEXT,
  not_a_significant_source_of TEXT,
  serving_size TEXT,
  serving_size_unit TEXT,
  household_serving_fulltext TEXT,
  branded_food_category TEXT,
  data_source TEXT,
  package_weight TEXT,
  modified_date TEXT,
  available_date TEXT,
  market_country TEXT,
  discontinued_date TEXT,
  preparation_state_code TEXT,
  trade_channel TEXT,
  short_description TEXT,
  material_code TEXT
);

CREATE TEMP TABLE fdc_survey_raw (
  fdc_id TEXT NOT NULL,
  food_code TEXT,
  wweia_category_code TEXT,
  start_date TEXT,
  end_date TEXT
);

CREATE TEMP TABLE fdc_wweia_category_raw (
  wweia_food_category TEXT NOT NULL,
  wweia_food_category_description TEXT
);

CREATE TEMP TABLE fdc_nutrient_raw (
  id TEXT NOT NULL,
  name TEXT,
  unit_name TEXT,
  nutrient_nbr TEXT,
  rank TEXT
);

-- Reduced locally by import-fdc.sh: only label-panel nutrients for branded
-- foods plus ALL nutrients for generic foods, and only these three columns.
CREATE TEMP TABLE fdc_food_nutrient_raw (
  fdc_id TEXT NOT NULL,
  nutrient_id TEXT NOT NULL,
  amount TEXT
);

CREATE TEMP TABLE fdc_portion_raw (
  id TEXT NOT NULL,
  fdc_id TEXT NOT NULL,
  seq_num TEXT,
  amount TEXT,
  measure_unit_id TEXT,
  portion_description TEXT,
  modifier TEXT,
  gram_weight TEXT,
  data_points TEXT,
  footnote TEXT,
  min_year_acquired TEXT
);

CREATE TEMP TABLE fdc_category_raw (
  id TEXT NOT NULL,
  code TEXT,
  description TEXT
);

CREATE TEMP TABLE fdc_measure_unit_raw (
  id TEXT NOT NULL,
  name TEXT
);

\copy fdc_food_raw FROM PROGRAM 'if [ -n "$FDC_FOOD_CSV" ]; then cat "$FDC_FOOD_CSV"; else echo "FDC_FOOD_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_branded_raw FROM PROGRAM 'if [ -n "$FDC_BRANDED_CSV" ]; then cat "$FDC_BRANDED_CSV"; else echo "FDC_BRANDED_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_survey_raw FROM PROGRAM 'if [ -n "$FDC_SURVEY_CSV" ]; then cat "$FDC_SURVEY_CSV"; else echo "FDC_SURVEY_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_wweia_category_raw FROM PROGRAM 'if [ -n "$FDC_WWEIA_CATEGORY_CSV" ]; then cat "$FDC_WWEIA_CATEGORY_CSV"; else echo "FDC_WWEIA_CATEGORY_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_nutrient_raw FROM PROGRAM 'if [ -n "$FDC_NUTRIENT_CSV" ]; then cat "$FDC_NUTRIENT_CSV"; else echo "FDC_NUTRIENT_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_food_nutrient_raw FROM PROGRAM 'if [ -n "$FDC_FOOD_NUTRIENT_REDUCED_CSV" ]; then cat "$FDC_FOOD_NUTRIENT_REDUCED_CSV"; else echo "FDC_FOOD_NUTRIENT_REDUCED_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_portion_raw FROM PROGRAM 'if [ -n "$FDC_PORTION_CSV" ]; then cat "$FDC_PORTION_CSV"; else echo "FDC_PORTION_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_category_raw FROM PROGRAM 'if [ -n "$FDC_CATEGORY_CSV" ]; then cat "$FDC_CATEGORY_CSV"; else echo "FDC_CATEGORY_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)
\copy fdc_measure_unit_raw FROM PROGRAM 'if [ -n "$FDC_MEASURE_UNIT_CSV" ]; then cat "$FDC_MEASURE_UNIT_CSV"; else echo "FDC_MEASURE_UNIT_CSV is required" >&2; exit 1; fi' WITH (FORMAT csv, HEADER true)

BEGIN;

WITH food_nutrients AS (
  SELECT
    fdc_id,
    nutrient_id,
    max(pg_temp.fdc_numeric(amount)) AS amount
  FROM fdc_food_nutrient_raw
  WHERE pg_temp.fdc_numeric(amount) IS NOT NULL
  GROUP BY fdc_id, nutrient_id
),
nutrients_per_100g AS (
  SELECT
    food_nutrients.fdc_id,
    jsonb_agg(
      jsonb_build_object(
        'id', nutrients.id::bigint,
        'number', pg_temp.fdc_compact_text(nutrients.nutrient_nbr),
        'name', pg_temp.fdc_compact_text(nutrients.name),
        'value', food_nutrients.amount,
        'unit', pg_temp.fdc_compact_text(nutrients.unit_name)
      )
      ORDER BY
        CASE
          WHEN nutrients.rank ~ '^\d+$' THEN nutrients.rank::integer
          ELSE 2147483647
        END,
        nutrients.id::bigint
    ) AS nutrients
  FROM food_nutrients
  JOIN fdc_nutrient_raw nutrients
    ON nutrients.id = food_nutrients.nutrient_id
  WHERE nutrients.id ~ '^\d+$'
  GROUP BY food_nutrients.fdc_id
),
ranked_portions AS (
  SELECT
    portions.fdc_id,
    pg_temp.fdc_numeric(portions.amount) AS amount,
    pg_temp.fdc_compact_text(
      CONCAT_WS(
        ' ',
        NULLIF(pg_temp.fdc_compact_text(measure_units.name), 'undetermined'),
        pg_temp.fdc_compact_text(portions.portion_description),
        pg_temp.fdc_compact_text(portions.modifier)
      )
    ) AS description,
    pg_temp.fdc_numeric(portions.gram_weight) AS gram_weight,
    row_number() OVER (
      PARTITION BY portions.fdc_id
      ORDER BY
        CASE
          WHEN portions.seq_num ~ '^\d+$' THEN portions.seq_num::integer
          ELSE 2147483647
        END,
        portions.id
    ) AS portion_rank
  FROM fdc_portion_raw portions
  LEFT JOIN fdc_measure_unit_raw measure_units
    ON measure_units.id = portions.measure_unit_id
  WHERE pg_temp.fdc_numeric(portions.gram_weight) IS NOT NULL
),
food_portions AS (
  SELECT
    fdc_id,
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'amount', amount,
          'description', description,
          'gramWeight', gram_weight
        )
      )
      ORDER BY portion_rank
    ) AS portions,
    min(description) FILTER (WHERE portion_rank = 1) AS first_portion_description,
    min(gram_weight) FILTER (WHERE portion_rank = 1) AS first_portion_gram_weight
  FROM ranked_portions
  WHERE portion_rank <= 8
  GROUP BY fdc_id
),
typed_food AS (
  SELECT
    food.*,
    pg_temp.fdc_data_type(food.data_type) AS normalized_data_type
  FROM fdc_food_raw food
),
source_rows AS (
  SELECT
    food.fdc_id,
    CASE food.normalized_data_type
      WHEN 'foundation_food' THEN 'usda_foundation'
      WHEN 'sr_legacy_food' THEN 'usda_sr_legacy'
      WHEN 'survey_fndds_food' THEN 'usda_fndds'
      WHEN 'branded_food' THEN 'usda_branded'
    END AS data_origin,
    CASE food.normalized_data_type
      WHEN 'foundation_food' THEN 10
      WHEN 'sr_legacy_food' THEN 20
      WHEN 'survey_fndds_food' THEN 25
      WHEN 'branded_food' THEN 30
    END::smallint AS data_origin_priority,
    food.normalized_data_type AS data_type,
    pg_temp.fdc_compact_text(food.description) AS name_raw,
    pg_temp.fdc_compact_text(branded.brand_name) AS brand_name,
    pg_temp.fdc_compact_text(branded.subbrand_name) AS subbrand_name,
    pg_temp.fdc_compact_text(branded.brand_owner) AS brand_owner,
    COALESCE(
      pg_temp.fdc_compact_text(branded.brand_name),
      pg_temp.fdc_compact_text(branded.subbrand_name),
      pg_temp.fdc_compact_text(branded.brand_owner)
    ) AS display_brand,
    COALESCE(
      pg_temp.fdc_compact_text(branded.brand_name),
      pg_temp.fdc_compact_text(branded.brand_owner)
    ) AS canonical_brand,
    NULLIF(regexp_replace(COALESCE(branded.gtin_upc, ''), '\D', '', 'g'), '') AS upc,
    pg_temp.fdc_compact_text(branded.ingredients) AS ingredients,
    pg_temp.fdc_compact_text(branded.not_a_significant_source_of) AS not_significant_source_of,
    pg_temp.fdc_numeric(branded.serving_size) AS serving_size,
    pg_temp.fdc_compact_text(branded.serving_size_unit) AS serving_size_unit,
    pg_temp.fdc_compact_text(branded.household_serving_fulltext) AS branded_household_serving,
    COALESCE(
      pg_temp.fdc_compact_text(branded.branded_food_category),
      pg_temp.fdc_compact_text(wweia.wweia_food_category_description),
      pg_temp.fdc_compact_text(categories.description)
    ) AS category,
    pg_temp.fdc_compact_text(branded.package_weight) AS package_weight,
    NULLIF(btrim(COALESCE(branded.discontinued_date, '')), '') IS NOT NULL AS off_market,
    pg_temp.fdc_date(food.publication_date) AS published_date,
    pg_temp.fdc_date(branded.modified_date) AS modified_date,
    pg_temp.fdc_date(branded.available_date) AS available_date
  FROM typed_food food
  LEFT JOIN fdc_branded_raw branded
    ON branded.fdc_id = food.fdc_id
    AND food.normalized_data_type = 'branded_food'
  LEFT JOIN fdc_survey_raw survey
    ON survey.fdc_id = food.fdc_id
    AND food.normalized_data_type = 'survey_fndds_food'
  LEFT JOIN fdc_wweia_category_raw wweia
    ON wweia.wweia_food_category = survey.wweia_category_code
  LEFT JOIN fdc_category_raw categories
    ON categories.id = food.food_category_id
  WHERE
    food.fdc_id ~ '^\d+$'
    AND food.normalized_data_type IN (
      'branded_food',
      'foundation_food',
      'sr_legacy_food',
      'survey_fndds_food'
    )
    AND (
      food.normalized_data_type <> 'branded_food'
      OR lower(btrim(COALESCE(branded.market_country, ''))) = 'united states'
    )
),
prepared AS (
  SELECT
    'fdc:' || source_rows.fdc_id AS id,
    CASE
      WHEN pg_temp.fdc_key_text(source_rows.canonical_brand) IS NULL
        AND pg_temp.fdc_key_text(source_rows.name_raw) IS NULL
      THEN 'fdc:' || source_rows.fdc_id
      ELSE CONCAT_WS(
        '|',
        COALESCE(pg_temp.fdc_key_text(source_rows.canonical_brand), ''),
        COALESCE(pg_temp.fdc_key_text(source_rows.name_raw), '')
      )
    END AS canonical_key,
    source_rows.data_origin,
    source_rows.fdc_id AS data_origin_id,
    'https://fdc.nal.usda.gov/food-details/' || source_rows.fdc_id || '/nutrients' AS data_origin_url,
    source_rows.data_origin_priority,
    COALESCE(source_rows.name_raw, 'Unknown food') AS name,
    source_rows.display_brand AS brand,
    source_rows.upc,
    source_rows.off_market,
    left(
      COALESCE(
        pg_temp.fdc_compact_text(
          CONCAT_WS(
            ' ',
            COALESCE(source_rows.name_raw, 'Unknown food'),
            source_rows.brand_name,
            source_rows.subbrand_name,
            source_rows.brand_owner,
            source_rows.upc
          )
        ),
        'Unknown food'
      ),
      6000
    ) AS search_text,
    CASE
      WHEN source_rows.serving_size IS NOT NULL
        AND source_rows.serving_size > 0
        AND source_rows.serving_size <= 2000
        AND lower(source_rows.serving_size_unit) IN ('g', 'gr', 'gram', 'grams', 'gram(s)', 'grm')
        THEN source_rows.serving_size
      WHEN food_portions.first_portion_gram_weight IS NOT NULL
        AND food_portions.first_portion_gram_weight > 0
        AND food_portions.first_portion_gram_weight <= 2000
        AND COALESCE(btrim(food_portions.first_portion_description), '') <> ''
        AND (
          source_rows.data_type <> 'branded_food'
          OR (
            source_rows.branded_household_serving IS NOT NULL
            AND lower(btrim(food_portions.first_portion_description)) = lower(btrim(source_rows.branded_household_serving))
          )
        )
        AND lower(btrim(food_portions.first_portion_description)) !~ '^[0-9.[:space:]]*(fl\.?[[:space:]]*oz|fluid[[:space:]]+ounces?|cups?|tbsp|tablespoons?|tsp|teaspoons?|ml|milliliters?|millilitres?|l|liters?|litres?|bottles?|jars?|cans?|containers?|packages?|packs?|packets?|pouches?|tablets?|capsules?|caps?|softgels?|soft[[:space:]]+gels?|gummies?|scoops?)([^[:alpha:]]|$)'
        THEN food_portions.first_portion_gram_weight
      ELSE NULL
    END AS serving_grams,
    jsonb_strip_nulls(
      jsonb_build_object(
        'ingredients', source_rows.ingredients,
        'notSignificantSourceOf', source_rows.not_significant_source_of,
        'servingSize', source_rows.serving_size,
        'servingSizeUnit', source_rows.serving_size_unit,
        'householdServing', COALESCE(
          source_rows.branded_household_serving,
          food_portions.first_portion_description
        ),
        'category', source_rows.category,
        'brandName', source_rows.brand_name,
        'subbrandName', source_rows.subbrand_name,
        'brandOwner', source_rows.brand_owner,
        'packageWeight', source_rows.package_weight,
        'publishedDate', to_jsonb(source_rows.published_date),
        'modifiedDate', to_jsonb(source_rows.modified_date),
        'availableDate', to_jsonb(source_rows.available_date),
        'nutrientsPer100g', COALESCE(nutrients_per_100g.nutrients, '[]'::jsonb),
        'portions', CASE
          WHEN source_rows.data_type = 'branded_food' THEN NULL
          ELSE food_portions.portions
        END
      )
    ) AS label
  FROM source_rows
  LEFT JOIN nutrients_per_100g
    ON nutrients_per_100g.fdc_id = source_rows.fdc_id
  LEFT JOIN food_portions
    ON food_portions.fdc_id = source_rows.fdc_id
)
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
  serving_grams,
  fdc_release_date
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
  serving_grams,
  :'fdc_release_date'::date
FROM prepared
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
  serving_grams = EXCLUDED.serving_grams,
  fdc_release_date = EXCLUDED.fdc_release_date,
  last_seen_at = now(),
  imported_at = now();

ANALYZE foods;

-- Post-import report (counts only; no row contents).
SELECT data_origin, count(*) AS rows
FROM foods
GROUP BY data_origin
ORDER BY data_origin;

SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE off_market) AS off_market_rows,
  count(*) FILTER (WHERE upc IS NULL) AS null_upc_rows,
  count(*) FILTER (WHERE brand IS NULL) AS null_brand_rows,
  count(*) FILTER (WHERE fdc_release_date = :'fdc_release_date'::date) AS current_release_rows
FROM foods;

\ir ../product-tests/apply-reviewed-serving-grams.sql

COMMIT;
