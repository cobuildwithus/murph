\set ON_ERROR_STOP on

\ir load-reviewed-serving-grams-overlay.sql

DO $$
BEGIN
  IF to_regclass('public.foods') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM serving_grams_reviewed_overlay_options options
      WHERE options.entity_type IS NULL OR options.entity_type = 'food'
    )
  THEN
    UPDATE foods
    SET serving_grams = reviewed.serving_grams
    FROM serving_grams_reviewed_overlay_import reviewed
    WHERE reviewed.entity_type = 'food'
      AND foods.id = reviewed.label_id
      AND foods.serving_grams IS DISTINCT FROM reviewed.serving_grams;
  END IF;

  IF to_regclass('public.supplements') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM serving_grams_reviewed_overlay_options options
      WHERE options.entity_type IS NULL OR options.entity_type = 'supplement'
    )
  THEN
    UPDATE supplements
    SET serving_grams = reviewed.serving_grams
    FROM serving_grams_reviewed_overlay_import reviewed
    WHERE reviewed.entity_type = 'supplement'
      AND supplements.id = reviewed.label_id
      AND supplements.serving_grams IS DISTINCT FROM reviewed.serving_grams;
  END IF;
END $$;

DROP TABLE serving_grams_reviewed_overlay_import;
DROP TABLE serving_grams_reviewed_overlay_options;
