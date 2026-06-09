\set ON_ERROR_STOP on

WITH dsld_search_text AS (
  SELECT
    supplements.id,
    left(
      regexp_replace(
        btrim(CONCAT_WS(
          ' ',
          supplements.name,
          supplements.brand,
          supplements.upc,
          (
            SELECT string_agg(term, ' ')
            FROM (
              SELECT ingredient->>'name' AS term
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(supplements.label->'ingredientRows') = 'array'
                  THEN supplements.label->'ingredientRows'
                  ELSE '[]'::jsonb
                END
              ) AS ingredient

              UNION ALL

              SELECT nested_ingredient->>'name' AS term
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(supplements.label->'ingredientRows') = 'array'
                  THEN supplements.label->'ingredientRows'
                  ELSE '[]'::jsonb
                END
              ) AS ingredient
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
            SELECT string_agg(other_ingredient->>'name', ' ')
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(supplements.label#>'{otheringredients,ingredients}') = 'array'
                THEN supplements.label#>'{otheringredients,ingredients}'
                ELSE '[]'::jsonb
              END
            ) AS other_ingredient
          )
        )),
        '\s+',
        ' ',
        'g'
      ),
      6000
    ) AS search_text
  FROM supplements
  WHERE supplements.data_origin = 'dsld'
),
updated AS (
  UPDATE supplements
  SET search_text = dsld_search_text.search_text
  FROM dsld_search_text
  WHERE
    supplements.id = dsld_search_text.id
    AND supplements.search_text IS DISTINCT FROM dsld_search_text.search_text
  RETURNING supplements.id
)
SELECT count(*)::int AS updated_rows
FROM updated;

ANALYZE supplements;
