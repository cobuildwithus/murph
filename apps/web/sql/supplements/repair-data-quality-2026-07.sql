\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

-- Immutable one-time repair artifact for the July 2026 corpus audit. The hashes and
-- semantic predicates intentionally make an already-applied or drifted rerun
-- fail instead of silently changing a different row version.

\if :{?supplement_data_repair_apply}
\else
  \set supplement_data_repair_apply false
\endif

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('murph:supplements:data-quality:2026-07'));

CREATE TEMP TABLE supplement_search_text_repairs (
  id TEXT PRIMARY KEY,
  current_search_text_md5 TEXT NOT NULL,
  expected_search_text TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO supplement_search_text_repairs (
  id,
  current_search_text_md5,
  expected_search_text
)
VALUES (
  'five-percent-nutrition:code-red-pump',
  'f9172d5e39ca36c7d58d6c675c77e615',
  'Code Red Pump 5% Nutrition 850060014697 GlycerSize Salvia miltiorrhiza Root Extract S7 Green Coffee Bean Extract Green Tea Leaf Extract Turmeric Rhizome Extract Tart Cherry Blueberry Broccoli Kale USA SPSUP850060014697'
);

CREATE TEMP TABLE supplement_nonstandalone_removals (
  id TEXT PRIMARY KEY,
  current_label_md5 TEXT NOT NULL,
  current_search_text_md5 TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO supplement_nonstandalone_removals (
  id,
  current_label_md5,
  current_search_text_md5
)
VALUES
  (
    'dailymed:00c008e9-f314-4d35-bb2a-6140f970d429',
    'd77395ecbffe76673bb9e5fd7cf0d47a',
    'f1eaacbee6a241ef217b0a219e41a4b1'
  ),
  (
    'dailymed:eb18487c-5a55-4f2d-a59d-731788508171',
    '60cb36a4fc5ef20d33d7e5f752d558c5',
    'a7356033ffc5ff25bc5e3dc8654c8215'
  );

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM supplement_search_text_repairs AS repairs
    JOIN supplements
      ON supplements.id = repairs.id
      AND md5(supplements.search_text) = repairs.current_search_text_md5
    WHERE supplements.data_origin = 'brand_site'
      AND length(supplements.search_text) > 6000
      AND length(repairs.expected_search_text) <= 6000
  ) <> 1 THEN
    RAISE EXCEPTION 'supplement search-text repair precondition changed';
  END IF;

  IF (
    SELECT count(*)
    FROM supplement_nonstandalone_removals AS removals
    JOIN supplements
      ON supplements.id = removals.id
      AND md5(supplements.label::text) = removals.current_label_md5
      AND md5(supplements.search_text) = removals.current_search_text_md5
    WHERE supplements.data_origin = 'dailymed'
      AND supplements.canonical_key = supplements.id
      AND jsonb_typeof(supplements.label->'ingredientRows') IS NULL
      AND jsonb_typeof(supplements.label->'servingSizes') IS NULL
      AND supplements.name ILIKE '%combo pack%'
      AND NOT EXISTS (
        SELECT 1
        FROM product_tests
        WHERE product_tests.supplement_id = supplements.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM supplements AS aliases
        WHERE aliases.canonical_key = supplements.canonical_key
          AND aliases.id <> supplements.id
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'supplement non-standalone removal precondition changed';
  END IF;
END
$$;

SELECT jsonb_pretty(jsonb_build_object(
  'mode', CASE WHEN :supplement_data_repair_apply::boolean THEN 'apply' ELSE 'dry_run' END,
  'nonStandaloneRemovalIds', (
    SELECT jsonb_agg(id ORDER BY id)
    FROM supplement_nonstandalone_removals
  ),
  'nonStandaloneRemovalRows', (
    SELECT count(*)
    FROM supplement_nonstandalone_removals
  ),
  'searchTextRepairIds', (
    SELECT jsonb_agg(id ORDER BY id)
    FROM supplement_search_text_repairs
  ),
  'searchTextRepairRows', (
    SELECT count(*)
    FROM supplement_search_text_repairs
  )
)) AS proposed_changes;

UPDATE supplements
SET search_text = repairs.expected_search_text
FROM supplement_search_text_repairs AS repairs
WHERE supplements.id = repairs.id
  AND md5(supplements.search_text) = repairs.current_search_text_md5;

DELETE FROM supplements
USING supplement_nonstandalone_removals AS removals
WHERE supplements.id = removals.id
  AND md5(supplements.label::text) = removals.current_label_md5
  AND md5(supplements.search_text) = removals.current_search_text_md5;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM supplements
    WHERE id = 'five-percent-nutrition:code-red-pump'
      AND (length(search_text) > 6000 OR btrim(search_text) = '')
  ) THEN
    RAISE EXCEPTION 'supplement search-text repair postcondition failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM supplements
    WHERE id IN (
      'dailymed:00c008e9-f314-4d35-bb2a-6140f970d429',
      'dailymed:eb18487c-5a55-4f2d-a59d-731788508171'
    )
  ) THEN
    RAISE EXCEPTION 'supplement non-standalone removal postcondition failed';
  END IF;
END
$$;

SELECT jsonb_pretty(jsonb_build_object(
  'remainingNonStandaloneTargets', (
    SELECT count(*)
    FROM supplements
    WHERE id IN (
      'dailymed:00c008e9-f314-4d35-bb2a-6140f970d429',
      'dailymed:eb18487c-5a55-4f2d-a59d-731788508171'
    )
  ),
  'remainingOversizeSearchTextRows', (
    SELECT count(*)
    FROM supplements
    WHERE length(search_text) > 6000
  ),
  'supplementRows', (
    SELECT count(*)
    FROM supplements
  )
)) AS postconditions;

\if :supplement_data_repair_apply
  COMMIT;
\else
  ROLLBACK;
\endif
