\set ON_ERROR_STOP on

\if :{?reviewed_serving_grams_entity_type}
\else
\set reviewed_serving_grams_entity_type ''
\endif

DROP TABLE IF EXISTS serving_grams_reviewed_overlay_import;
DROP TABLE IF EXISTS serving_grams_reviewed_overlay_options;

CREATE TEMP TABLE serving_grams_reviewed_overlay_options AS
SELECT NULLIF(:'reviewed_serving_grams_entity_type', '') AS entity_type;

CREATE TEMP TABLE serving_grams_reviewed_overlay_import (
  entity_type TEXT NOT NULL,
  label_id TEXT NOT NULL,
  serving_grams NUMERIC NOT NULL,
  evidence_url TEXT NOT NULL,
  evidence_note TEXT NOT NULL
);

\copy serving_grams_reviewed_overlay_import FROM PROGRAM 'reviewed_path="${REVIEWED_SERVING_GRAMS_TSV_PATH:-}"; if [ -z "$reviewed_path" ]; then repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"; reviewed_path="$repo_root/apps/web/sql/product-tests/reviewed-serving-grams.tsv"; fi; if [ -f "$reviewed_path" ]; then cat "$reviewed_path"; else echo "REVIEWED_SERVING_GRAMS_TSV_PATH is required or run from a git checkout" >&2; exit 1; fi' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

UPDATE serving_grams_reviewed_overlay_import
SET
  entity_type = btrim(entity_type),
  label_id = btrim(label_id),
  evidence_url = btrim(evidence_url),
  evidence_note = btrim(evidence_note);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM serving_grams_reviewed_overlay_import) THEN
    RAISE EXCEPTION 'reviewed serving grams overlay prepared zero rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM serving_grams_reviewed_overlay_options options
    WHERE options.entity_type NOT IN ('food', 'supplement')
  ) THEN
    RAISE EXCEPTION 'reviewed serving grams overlay entity scope is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM serving_grams_reviewed_overlay_import reviewed
    WHERE
      reviewed.entity_type NOT IN ('food', 'supplement')
      OR reviewed.label_id = ''
      OR reviewed.evidence_url = ''
      OR reviewed.evidence_note = ''
      OR NOT (reviewed.serving_grams > 0 AND reviewed.serving_grams <= 2000)
  ) THEN
    RAISE EXCEPTION 'reviewed serving grams overlay row is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM serving_grams_reviewed_overlay_import reviewed
    GROUP BY reviewed.entity_type, reviewed.label_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate reviewed serving grams overlay label';
  END IF;

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
