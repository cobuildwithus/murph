\set ON_ERROR_STOP on

CREATE TEMP TABLE dsld_import_raw (
  label JSONB NOT NULL
);

\copy dsld_import_raw(label) FROM PROGRAM 'if [ -n "$DSLD_NDJSON_PATH" ]; then cat "$DSLD_NDJSON_PATH"; else echo "DSLD_NDJSON_PATH is required" >&2; exit 1; fi' WITH (FORMAT text);

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
      COALESCE(
        label->>'brandName',
        label->>'brand',
        label->>'brand_name'
      ),
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
    END AS other_ingredient_rows

  FROM dsld_import_raw
)

INSERT INTO supplements (
  dsld_id,
  name,
  brand,
  upc,
  off_market,
  search_text,
  label
)
SELECT
  id_text::BIGINT,
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
      SELECT string_agg(ingredient->>'name', ' ')
      FROM jsonb_array_elements(ingredient_rows) AS ingredient
    ),
    (
      SELECT string_agg(ingredient->>'name', ' ')
      FROM jsonb_array_elements(other_ingredient_rows) AS ingredient
    )
  ) AS search_text,

  label
FROM normalized
WHERE id_text ~ '^\d+$'
ON CONFLICT (dsld_id) DO UPDATE SET
  name = EXCLUDED.name,
  brand = EXCLUDED.brand,
  upc = EXCLUDED.upc,
  off_market = EXCLUDED.off_market,
  search_text = EXCLUDED.search_text,
  label = EXCLUDED.label,
  imported_at = now();

ANALYZE supplements;
