SELECT pg_advisory_xact_lock(hashtext('murph:product_tests:mutation'));

ALTER TABLE source_only_product_tests_import
  ADD COLUMN IF NOT EXISTS evidence_type TEXT
    DEFAULT 'laboratory_measurement',
  ADD COLUMN IF NOT EXISTS sampling_context TEXT
    DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS tested_product_upc_raw TEXT,
  ADD COLUMN IF NOT EXISTS source_sample_id TEXT,
  ADD COLUMN IF NOT EXISTS source_sample_count TEXT,
  ADD COLUMN IF NOT EXISTS tested_lot_code TEXT,
  ADD COLUMN IF NOT EXISTS tested_best_by TEXT,
  ADD COLUMN IF NOT EXISTS tested_package_size TEXT,
  ADD COLUMN IF NOT EXISTS collected_on TEXT,
  ADD COLUMN IF NOT EXISTS tested_on TEXT,
  ADD COLUMN IF NOT EXISTS result_upper_value TEXT,
  ADD COLUMN IF NOT EXISTS normalized_upper_value TEXT,
  ADD COLUMN IF NOT EXISTS result_qualifier TEXT,
  ADD COLUMN IF NOT EXISTS detection_limit_value TEXT,
  ADD COLUMN IF NOT EXISTS detection_limit_unit TEXT,
  ADD COLUMN IF NOT EXISTS quantification_limit_value TEXT,
  ADD COLUMN IF NOT EXISTS quantification_limit_unit TEXT,
  ADD COLUMN IF NOT EXISTS reporting_limit_value TEXT,
  ADD COLUMN IF NOT EXISTS reporting_limit_unit TEXT,
  ADD COLUMN IF NOT EXISTS uncertainty_value TEXT,
  ADD COLUMN IF NOT EXISTS uncertainty_unit TEXT;

CREATE TEMP TABLE source_only_product_tests_import_options ON COMMIT DROP AS
  SELECT
    :'replace_source'::boolean AS replace_source,
    NULLIF(:'replace_source_expected_product_test_rows', '')::integer
      AS replace_source_expected_product_test_rows;

DO $$
DECLARE
  expected_product_test_rows integer;
  imported_product_test_rows integer;
BEGIN
  SELECT replace_source_expected_product_test_rows INTO expected_product_test_rows
  FROM source_only_product_tests_import_options;

  IF (SELECT replace_source FROM source_only_product_tests_import_options) THEN
    SELECT COUNT(*) INTO imported_product_test_rows
    FROM source_only_product_tests_import;

    IF expected_product_test_rows IS NULL
      OR imported_product_test_rows <> expected_product_test_rows
    THEN
      RAISE EXCEPTION
        'source-only product test replace-source row count mismatch: expected %, imported %',
        expected_product_test_rows,
        imported_product_test_rows;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM source_only_product_tests_import) THEN
    RAISE EXCEPTION 'source-only product test import prepared zero product test rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM source_only_product_tests_import tests
    WHERE
      NULLIF(tests.food_id, '') IS NOT NULL
      OR NULLIF(tests.supplement_id, '') IS NOT NULL
      OR tests.match_method <> 'source_only'
  ) THEN
    RAISE EXCEPTION 'source-only product test rows must import as source_only with no product link';
  END IF;
END $$;

CREATE TEMP TABLE source_only_product_test_incoming_identities ON COMMIT DROP AS
SELECT DISTINCT
  source_key,
  NULLIF(tested_source_product_id, '') AS tested_source_product_id,
  NULLIF(tested_product_name, '') AS tested_product_name,
  NULLIF(tested_product_brand, '') AS tested_product_brand,
  NULLIF(tested_product_upc, '') AS tested_product_upc,
  NULLIF(tested_product_upc_raw, '') AS tested_product_upc_raw,
  NULLIF(tested_package_size, '') AS tested_package_size
FROM source_only_product_tests_import
WHERE NULLIF(tested_source_product_id, '') IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM source_only_product_test_incoming_identities incoming
    GROUP BY incoming.source_key, incoming.tested_source_product_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'source-only product test import grouped multiple product identities under one source product id';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM source_only_product_test_incoming_identities incoming
    JOIN product_tests existing_identity
      ON existing_identity.source_key = incoming.source_key
      AND existing_identity.tested_source_product_id = incoming.tested_source_product_id
      AND NOT (
        existing_identity.tested_product_name IS NOT DISTINCT FROM incoming.tested_product_name
        AND existing_identity.tested_product_brand IS NOT DISTINCT FROM incoming.tested_product_brand
        AND existing_identity.tested_product_upc IS NOT DISTINCT FROM incoming.tested_product_upc
        AND existing_identity.tested_product_upc_raw IS NOT DISTINCT FROM incoming.tested_product_upc_raw
        AND existing_identity.tested_package_size IS NOT DISTINCT FROM incoming.tested_package_size
      )
    WHERE
      NOT (SELECT replace_source FROM source_only_product_tests_import_options)
      AND EXISTS (
        SELECT 1
        FROM product_tests omitted
        WHERE
          omitted.source_key = incoming.source_key
          AND omitted.tested_source_product_id = incoming.tested_source_product_id
          AND NOT EXISTS (
            SELECT 1
            FROM source_only_product_tests_import current_import
            WHERE
              current_import.source_key = omitted.source_key
              AND current_import.source_result_id = omitted.source_result_id
              AND current_import.contaminant_key = omitted.contaminant_key
          )
      )
  ) THEN
    RAISE EXCEPTION
      'source-only product test identity drift requires a complete source-product snapshot';
  END IF;
END $$;

CREATE TEMP TABLE source_only_product_test_group_high_watermarks ON COMMIT DROP AS
SELECT
  revision_candidates.source_key,
  revision_candidates.tested_source_product_id,
  MAX(revision_candidates.remap_revision) AS remap_revision
FROM (
  SELECT
    incoming.source_key,
    incoming.tested_source_product_id,
    destination_rows.remap_revision
  FROM source_only_product_test_incoming_identities incoming
  JOIN product_tests destination_rows
    ON destination_rows.source_key = incoming.source_key
    AND destination_rows.tested_source_product_id
      = incoming.tested_source_product_id

  UNION ALL

  SELECT
    current_import.source_key,
    NULLIF(current_import.tested_source_product_id, ''),
    moving_rows.remap_revision
  FROM source_only_product_tests_import current_import
  JOIN product_tests moving_rows
    ON moving_rows.source_key = current_import.source_key
    AND moving_rows.source_result_id = current_import.source_result_id
    AND moving_rows.contaminant_key = current_import.contaminant_key
  WHERE NULLIF(current_import.tested_source_product_id, '') IS NOT NULL
) revision_candidates
GROUP BY
  revision_candidates.source_key,
  revision_candidates.tested_source_product_id;

CREATE TEMP TABLE source_only_product_test_groups_to_demote ON COMMIT DROP AS
SELECT
  incoming.source_key,
  incoming.tested_source_product_id,
  high_watermarks.remap_revision
FROM source_only_product_test_incoming_identities incoming
JOIN product_tests existing
  ON existing.source_key = incoming.source_key
  AND existing.tested_source_product_id = incoming.tested_source_product_id
JOIN source_only_product_test_group_high_watermarks high_watermarks
  ON high_watermarks.source_key = incoming.source_key
  AND high_watermarks.tested_source_product_id
    = incoming.tested_source_product_id
GROUP BY
  incoming.source_key,
  incoming.tested_source_product_id,
  high_watermarks.remap_revision
HAVING BOOL_OR(NOT (
  existing.tested_product_name IS NOT DISTINCT FROM incoming.tested_product_name
  AND existing.tested_product_brand IS NOT DISTINCT FROM incoming.tested_product_brand
  AND existing.tested_product_upc IS NOT DISTINCT FROM incoming.tested_product_upc
  AND existing.tested_product_upc_raw IS NOT DISTINCT FROM incoming.tested_product_upc_raw
  AND existing.tested_package_size IS NOT DISTINCT FROM incoming.tested_package_size
));

UPDATE product_tests existing
SET
  food_id = NULL,
  supplement_id = NULL,
  match_method = 'source_only',
  remap_revision = groups_to_demote.remap_revision,
  imported_at = now()
FROM source_only_product_test_groups_to_demote groups_to_demote
WHERE
  existing.source_key = groups_to_demote.source_key
  AND existing.tested_source_product_id = groups_to_demote.tested_source_product_id;

CREATE TEMP TABLE source_only_product_test_group_link_candidates ON COMMIT DROP AS
SELECT DISTINCT
  incoming.source_key,
  incoming.tested_source_product_id,
  existing.food_id,
  existing.supplement_id,
  existing.match_method,
  high_watermarks.remap_revision
FROM source_only_product_test_incoming_identities incoming
JOIN product_tests existing
  ON existing.source_key = incoming.source_key
  AND existing.tested_source_product_id = incoming.tested_source_product_id
  AND existing.tested_product_name IS NOT DISTINCT FROM incoming.tested_product_name
  AND existing.tested_product_brand IS NOT DISTINCT FROM incoming.tested_product_brand
  AND existing.tested_product_upc IS NOT DISTINCT FROM incoming.tested_product_upc
  AND existing.tested_product_upc_raw IS NOT DISTINCT FROM incoming.tested_product_upc_raw
  AND existing.tested_package_size IS NOT DISTINCT FROM incoming.tested_package_size
JOIN source_only_product_test_group_high_watermarks high_watermarks
  ON high_watermarks.source_key = incoming.source_key
  AND high_watermarks.tested_source_product_id
    = incoming.tested_source_product_id
  AND (
    existing.match_method <> 'source_only'
    OR existing.remap_revision > 0
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM source_only_product_test_group_link_candidates candidates
    GROUP BY candidates.source_key, candidates.tested_source_product_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'source-only product test import found inconsistent reviewed links for one source product identity';
  END IF;
END $$;

CREATE TEMP TABLE source_only_product_test_group_links ON COMMIT DROP AS
SELECT *
FROM source_only_product_test_group_link_candidates;

UPDATE product_tests existing
SET
  food_id = group_links.food_id,
  supplement_id = group_links.supplement_id,
  match_method = group_links.match_method,
  remap_revision = group_links.remap_revision,
  imported_at = now()
FROM
  source_only_product_test_group_links group_links,
  source_only_product_test_incoming_identities incoming
WHERE
  incoming.source_key = group_links.source_key
  AND incoming.tested_source_product_id = group_links.tested_source_product_id
  AND existing.source_key = group_links.source_key
  AND existing.tested_source_product_id = group_links.tested_source_product_id
  AND existing.tested_product_name IS NOT DISTINCT FROM incoming.tested_product_name
  AND existing.tested_product_brand IS NOT DISTINCT FROM incoming.tested_product_brand
  AND existing.tested_product_upc IS NOT DISTINCT FROM incoming.tested_product_upc
  AND existing.tested_product_upc_raw IS NOT DISTINCT FROM incoming.tested_product_upc_raw
  AND existing.tested_package_size IS NOT DISTINCT FROM incoming.tested_package_size
  AND (
    existing.food_id IS DISTINCT FROM group_links.food_id
    OR existing.supplement_id IS DISTINCT FROM group_links.supplement_id
    OR existing.match_method IS DISTINCT FROM group_links.match_method
    OR existing.remap_revision IS DISTINCT FROM group_links.remap_revision
  );

UPDATE product_tests existing
SET
  remap_revision = high_watermarks.remap_revision,
  imported_at = now()
FROM
  source_only_product_test_group_high_watermarks high_watermarks,
  source_only_product_test_incoming_identities incoming
WHERE
  incoming.source_key = high_watermarks.source_key
  AND incoming.tested_source_product_id
    = high_watermarks.tested_source_product_id
  AND existing.source_key = high_watermarks.source_key
  AND existing.tested_source_product_id
    = high_watermarks.tested_source_product_id
  AND existing.tested_product_name IS NOT DISTINCT FROM incoming.tested_product_name
  AND existing.tested_product_brand IS NOT DISTINCT FROM incoming.tested_product_brand
  AND existing.tested_product_upc IS NOT DISTINCT FROM incoming.tested_product_upc
  AND existing.tested_product_upc_raw IS NOT DISTINCT FROM incoming.tested_product_upc_raw
  AND existing.tested_package_size IS NOT DISTINCT FROM incoming.tested_package_size
  AND existing.remap_revision < high_watermarks.remap_revision;

DELETE FROM product_tests tests
USING (
  SELECT DISTINCT source_key
  FROM source_only_product_tests_import
) replacement_sources
WHERE
  (SELECT replace_source FROM source_only_product_tests_import_options)
  AND tests.source_key = replacement_sources.source_key
  AND NOT EXISTS (
    SELECT 1
    FROM source_only_product_tests_import current_import
    WHERE
      current_import.source_key = tests.source_key
      AND current_import.source_result_id = tests.source_result_id
      AND current_import.contaminant_key = tests.contaminant_key
  );

UPDATE product_tests tests
SET
  food_id = NULL,
  supplement_id = NULL,
  match_method = 'source_only',
  imported_at = now()
FROM source_only_product_tests_import current_import
WHERE
  tests.source_key = current_import.source_key
  AND tests.source_result_id = current_import.source_result_id
  AND tests.contaminant_key = current_import.contaminant_key
  AND NOT (
    tests.tested_source_product_id IS NOT DISTINCT FROM NULLIF(current_import.tested_source_product_id, '')
    AND tests.tested_product_name IS NOT DISTINCT FROM NULLIF(current_import.tested_product_name, '')
    AND tests.tested_product_brand IS NOT DISTINCT FROM NULLIF(current_import.tested_product_brand, '')
    AND tests.tested_product_upc IS NOT DISTINCT FROM NULLIF(current_import.tested_product_upc, '')
    AND tests.tested_product_upc_raw IS NOT DISTINCT FROM NULLIF(current_import.tested_product_upc_raw, '')
    AND tests.tested_package_size IS NOT DISTINCT FROM NULLIF(current_import.tested_package_size, '')
  );

INSERT INTO product_tests (
  id,
  food_id,
  supplement_id,
  source_key,
  source_result_id,
  source_name,
  source_url,
  source_report_title,
  report_date,
  tested_product_name,
  tested_product_brand,
  tested_product_upc,
  tested_product_upc_raw,
  tested_source_product_id,
  evidence_type,
  sampling_context,
  source_sample_id,
  source_sample_count,
  tested_lot_code,
  tested_best_by,
  tested_package_size,
  collected_on,
  tested_on,
  match_method,
  remap_revision,
  contaminant_key,
  contaminant_name,
  result_operator,
  result_value,
  result_upper_value,
  result_unit,
  result_basis,
  normalized_value,
  normalized_upper_value,
  normalized_unit,
  normalized_basis,
  result_qualifier,
  detection_limit_value,
  detection_limit_unit,
  quantification_limit_value,
  quantification_limit_unit,
  reporting_limit_value,
  reporting_limit_unit,
  uncertainty_value,
  uncertainty_unit,
  lab_name,
  test_method
)
SELECT
  current_import.id,
  group_links.food_id,
  group_links.supplement_id,
  current_import.source_key,
  current_import.source_result_id,
  current_import.source_name,
  NULLIF(current_import.source_url, ''),
  NULLIF(current_import.source_report_title, ''),
  NULLIF(current_import.report_date, '')::date,
  NULLIF(current_import.tested_product_name, ''),
  NULLIF(current_import.tested_product_brand, ''),
  NULLIF(current_import.tested_product_upc, ''),
  NULLIF(current_import.tested_product_upc_raw, ''),
  NULLIF(current_import.tested_source_product_id, ''),
  COALESCE(NULLIF(evidence_type, ''), 'laboratory_measurement'),
  COALESCE(NULLIF(sampling_context, ''), 'unspecified'),
  NULLIF(source_sample_id, ''),
  NULLIF(source_sample_count, '')::integer,
  NULLIF(tested_lot_code, ''),
  NULLIF(tested_best_by, ''),
  NULLIF(tested_package_size, ''),
  NULLIF(collected_on, '')::date,
  NULLIF(tested_on, '')::date,
  COALESCE(group_links.match_method, current_import.match_method),
  COALESCE(
    group_links.remap_revision,
    high_watermarks.remap_revision,
    0
  ),
  current_import.contaminant_key,
  current_import.contaminant_name,
  current_import.result_operator,
  NULLIF(current_import.result_value, '')::numeric,
  NULLIF(current_import.result_upper_value, '')::numeric,
  current_import.result_unit,
  current_import.result_basis,
  NULLIF(current_import.normalized_value, '')::numeric,
  NULLIF(current_import.normalized_upper_value, '')::numeric,
  NULLIF(current_import.normalized_unit, ''),
  NULLIF(current_import.normalized_basis, ''),
  NULLIF(current_import.result_qualifier, ''),
  NULLIF(current_import.detection_limit_value, '')::numeric,
  NULLIF(current_import.detection_limit_unit, ''),
  NULLIF(current_import.quantification_limit_value, '')::numeric,
  NULLIF(current_import.quantification_limit_unit, ''),
  NULLIF(current_import.reporting_limit_value, '')::numeric,
  NULLIF(current_import.reporting_limit_unit, ''),
  NULLIF(current_import.uncertainty_value, '')::numeric,
  NULLIF(current_import.uncertainty_unit, ''),
  NULLIF(current_import.lab_name, ''),
  NULLIF(current_import.test_method, '')
FROM source_only_product_tests_import current_import
LEFT JOIN source_only_product_test_group_links group_links
  ON group_links.source_key = current_import.source_key
  AND group_links.tested_source_product_id
    = NULLIF(current_import.tested_source_product_id, '')
LEFT JOIN source_only_product_test_group_high_watermarks high_watermarks
  ON high_watermarks.source_key = current_import.source_key
  AND high_watermarks.tested_source_product_id
    = NULLIF(current_import.tested_source_product_id, '')
ON CONFLICT (source_key, source_result_id, contaminant_key)
DO UPDATE SET
  id = EXCLUDED.id,
  food_id = CASE
    WHEN product_tests.match_method = 'source_only' THEN EXCLUDED.food_id
    ELSE product_tests.food_id
  END,
  supplement_id = CASE
    WHEN product_tests.match_method = 'source_only' THEN EXCLUDED.supplement_id
    ELSE product_tests.supplement_id
  END,
  match_method = CASE
    WHEN product_tests.match_method = 'source_only' THEN EXCLUDED.match_method
    ELSE product_tests.match_method
  END,
  remap_revision = CASE
    WHEN product_tests.match_method = 'source_only'
      THEN GREATEST(product_tests.remap_revision, EXCLUDED.remap_revision)
    ELSE product_tests.remap_revision
  END,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  source_report_title = EXCLUDED.source_report_title,
  report_date = EXCLUDED.report_date,
  tested_product_name = EXCLUDED.tested_product_name,
  tested_product_brand = EXCLUDED.tested_product_brand,
  tested_product_upc = EXCLUDED.tested_product_upc,
  tested_product_upc_raw = EXCLUDED.tested_product_upc_raw,
  tested_source_product_id = EXCLUDED.tested_source_product_id,
  evidence_type = EXCLUDED.evidence_type,
  sampling_context = EXCLUDED.sampling_context,
  source_sample_id = EXCLUDED.source_sample_id,
  source_sample_count = EXCLUDED.source_sample_count,
  tested_lot_code = EXCLUDED.tested_lot_code,
  tested_best_by = EXCLUDED.tested_best_by,
  tested_package_size = EXCLUDED.tested_package_size,
  collected_on = EXCLUDED.collected_on,
  tested_on = EXCLUDED.tested_on,
  contaminant_name = EXCLUDED.contaminant_name,
  result_operator = EXCLUDED.result_operator,
  result_value = EXCLUDED.result_value,
  result_upper_value = EXCLUDED.result_upper_value,
  result_unit = EXCLUDED.result_unit,
  result_basis = EXCLUDED.result_basis,
  normalized_value = EXCLUDED.normalized_value,
  normalized_upper_value = EXCLUDED.normalized_upper_value,
  normalized_unit = EXCLUDED.normalized_unit,
  normalized_basis = EXCLUDED.normalized_basis,
  result_qualifier = EXCLUDED.result_qualifier,
  detection_limit_value = EXCLUDED.detection_limit_value,
  detection_limit_unit = EXCLUDED.detection_limit_unit,
  quantification_limit_value = EXCLUDED.quantification_limit_value,
  quantification_limit_unit = EXCLUDED.quantification_limit_unit,
  reporting_limit_value = EXCLUDED.reporting_limit_value,
  reporting_limit_unit = EXCLUDED.reporting_limit_unit,
  uncertainty_value = EXCLUDED.uncertainty_value,
  uncertainty_unit = EXCLUDED.uncertainty_unit,
  lab_name = EXCLUDED.lab_name,
  test_method = EXCLUDED.test_method,
  imported_at = now()
WHERE
  (
    product_tests.match_method = 'source_only'
    AND EXCLUDED.match_method <> 'source_only'
  )
  OR product_tests.id IS DISTINCT FROM EXCLUDED.id
  OR product_tests.source_name IS DISTINCT FROM EXCLUDED.source_name
  OR product_tests.source_url IS DISTINCT FROM EXCLUDED.source_url
  OR product_tests.source_report_title IS DISTINCT FROM EXCLUDED.source_report_title
  OR product_tests.report_date IS DISTINCT FROM EXCLUDED.report_date
  OR product_tests.tested_product_name IS DISTINCT FROM EXCLUDED.tested_product_name
  OR product_tests.tested_product_brand IS DISTINCT FROM EXCLUDED.tested_product_brand
  OR product_tests.tested_product_upc IS DISTINCT FROM EXCLUDED.tested_product_upc
  OR product_tests.tested_product_upc_raw IS DISTINCT FROM EXCLUDED.tested_product_upc_raw
  OR product_tests.tested_source_product_id IS DISTINCT FROM EXCLUDED.tested_source_product_id
  OR product_tests.evidence_type IS DISTINCT FROM EXCLUDED.evidence_type
  OR product_tests.sampling_context IS DISTINCT FROM EXCLUDED.sampling_context
  OR product_tests.source_sample_id IS DISTINCT FROM EXCLUDED.source_sample_id
  OR product_tests.source_sample_count IS DISTINCT FROM EXCLUDED.source_sample_count
  OR product_tests.tested_lot_code IS DISTINCT FROM EXCLUDED.tested_lot_code
  OR product_tests.tested_best_by IS DISTINCT FROM EXCLUDED.tested_best_by
  OR product_tests.tested_package_size IS DISTINCT FROM EXCLUDED.tested_package_size
  OR product_tests.collected_on IS DISTINCT FROM EXCLUDED.collected_on
  OR product_tests.tested_on IS DISTINCT FROM EXCLUDED.tested_on
  OR product_tests.contaminant_name IS DISTINCT FROM EXCLUDED.contaminant_name
  OR product_tests.result_operator IS DISTINCT FROM EXCLUDED.result_operator
  OR product_tests.result_value IS DISTINCT FROM EXCLUDED.result_value
  OR product_tests.result_upper_value IS DISTINCT FROM EXCLUDED.result_upper_value
  OR product_tests.result_unit IS DISTINCT FROM EXCLUDED.result_unit
  OR product_tests.result_basis IS DISTINCT FROM EXCLUDED.result_basis
  OR product_tests.normalized_value IS DISTINCT FROM EXCLUDED.normalized_value
  OR product_tests.normalized_upper_value IS DISTINCT FROM EXCLUDED.normalized_upper_value
  OR product_tests.normalized_unit IS DISTINCT FROM EXCLUDED.normalized_unit
  OR product_tests.normalized_basis IS DISTINCT FROM EXCLUDED.normalized_basis
  OR product_tests.result_qualifier IS DISTINCT FROM EXCLUDED.result_qualifier
  OR product_tests.detection_limit_value IS DISTINCT FROM EXCLUDED.detection_limit_value
  OR product_tests.detection_limit_unit IS DISTINCT FROM EXCLUDED.detection_limit_unit
  OR product_tests.quantification_limit_value IS DISTINCT FROM EXCLUDED.quantification_limit_value
  OR product_tests.quantification_limit_unit IS DISTINCT FROM EXCLUDED.quantification_limit_unit
  OR product_tests.reporting_limit_value IS DISTINCT FROM EXCLUDED.reporting_limit_value
  OR product_tests.reporting_limit_unit IS DISTINCT FROM EXCLUDED.reporting_limit_unit
  OR product_tests.uncertainty_value IS DISTINCT FROM EXCLUDED.uncertainty_value
  OR product_tests.uncertainty_unit IS DISTINCT FROM EXCLUDED.uncertainty_unit
  OR product_tests.lab_name IS DISTINCT FROM EXCLUDED.lab_name
  OR product_tests.test_method IS DISTINCT FROM EXCLUDED.test_method;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_tests tests
    WHERE
      tests.source_key IN (
        SELECT DISTINCT source_key
        FROM source_only_product_tests_import
      )
      AND tests.match_method = 'source_only'
      AND (
        tests.food_id IS NOT NULL
        OR tests.supplement_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'source-only product test row retained a product link';
  END IF;
END $$;
