\if :{?required_threshold_rows}
\else
\set required_threshold_rows -1
\endif

\if :{?application_rows}
\else
\set application_rows -1
\endif

DROP TABLE IF EXISTS pg_temp.reviewed_threshold_application_postflight_inputs;

CREATE TEMP TABLE reviewed_threshold_application_postflight_inputs
ON COMMIT DROP AS
SELECT
  :'required_threshold_rows'::integer AS required_threshold_rows,
  :'application_rows'::integer AS application_rows;

DO $$
DECLARE
  expected_required_threshold_rows INTEGER;
  expected_application_rows INTEGER;
  active_reviewed_threshold_count INTEGER;
  application_count INTEGER;
  threshold_application_set_drift TEXT;
  invalid_applications TEXT;
  missing_exact_join_applications TEXT;
  exact_join_count INTEGER;
BEGIN
  SELECT
    required_threshold_rows,
    application_rows
  INTO
    expected_required_threshold_rows,
    expected_application_rows
  FROM pg_temp.reviewed_threshold_application_postflight_inputs;

  IF expected_required_threshold_rows < 0 OR expected_application_rows < 0 THEN
    RAISE EXCEPTION
      'reviewed product threshold application postflight requires required_threshold_rows and application_rows psql variables';
  END IF;

  SELECT COUNT(*)
  INTO active_reviewed_threshold_count
  FROM contaminant_thresholds
  WHERE active = true
    AND comparison_scope = 'reviewed_application';

  IF active_reviewed_threshold_count <> expected_required_threshold_rows THEN
    RAISE EXCEPTION
      'active reviewed_application threshold count % does not match required CSV row count %',
      active_reviewed_threshold_count,
      expected_required_threshold_rows;
  END IF;

  SELECT COUNT(*)
  INTO application_count
  FROM product_contaminant_threshold_applications;

  IF application_count <> expected_application_rows THEN
    RAISE EXCEPTION
      'reviewed product threshold application count % does not match reviewed TSV row count %',
      application_count,
      expected_application_rows;
  END IF;

  WITH drift AS (
    SELECT 'active_threshold_without_application:' || thresholds.id AS drift_key
    FROM contaminant_thresholds thresholds
    WHERE thresholds.active = true
      AND thresholds.comparison_scope = 'reviewed_application'
      AND NOT EXISTS (
        SELECT 1
        FROM product_contaminant_threshold_applications applications
        WHERE applications.threshold_id = thresholds.id
      )

    UNION ALL

    SELECT 'application_without_active_reviewed_threshold:' || applications.threshold_id AS drift_key
    FROM product_contaminant_threshold_applications applications
    WHERE NOT EXISTS (
      SELECT 1
      FROM contaminant_thresholds thresholds
      WHERE thresholds.id = applications.threshold_id
        AND thresholds.active = true
        AND thresholds.comparison_scope = 'reviewed_application'
    )
  )
  SELECT string_agg(drift_key, ', ' ORDER BY drift_key)
  INTO threshold_application_set_drift
  FROM drift;

  IF threshold_application_set_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'active reviewed_application threshold ids must equal reviewed application threshold ids: %',
      threshold_application_set_drift;
  END IF;

  SELECT string_agg(applications.id, ', ' ORDER BY applications.id)
  INTO invalid_applications
  FROM product_contaminant_threshold_applications applications
  LEFT JOIN contaminant_thresholds thresholds
    ON thresholds.id = applications.threshold_id
  WHERE thresholds.id IS NULL
    OR thresholds.active IS DISTINCT FROM true
    OR thresholds.comparison_scope <> 'reviewed_application'
    OR thresholds.normalized_value IS NULL
    OR thresholds.normalized_unit IS NULL
    OR thresholds.normalized_basis IS NULL;

  IF invalid_applications IS NOT NULL THEN
    RAISE EXCEPTION
      'reviewed product threshold applications reference missing, inactive, non-reviewed_application, or non-normalized thresholds: %',
      invalid_applications;
  END IF;

  SELECT string_agg(applications.id, ', ' ORDER BY applications.id)
  INTO missing_exact_join_applications
  FROM product_contaminant_threshold_applications applications
  JOIN contaminant_thresholds thresholds
    ON thresholds.id = applications.threshold_id
  WHERE thresholds.active = true
    AND thresholds.comparison_scope = 'reviewed_application'
    AND thresholds.normalized_value IS NOT NULL
    AND thresholds.normalized_unit IS NOT NULL
    AND thresholds.normalized_basis IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM product_tests
      WHERE product_tests.food_id IS NOT DISTINCT FROM applications.food_id
        AND product_tests.supplement_id IS NOT DISTINCT FROM applications.supplement_id
        AND product_tests.result_operator IN ('eq', 'gt', 'gte')
        AND product_tests.normalized_value IS NOT NULL
        AND product_tests.contaminant_key = thresholds.contaminant_key
        AND product_tests.normalized_unit = thresholds.normalized_unit
        AND product_tests.normalized_basis = thresholds.normalized_basis
    );

  IF missing_exact_join_applications IS NOT NULL THEN
    RAISE EXCEPTION
      'reviewed product threshold applications produced no exact comparable product-test joins: %',
      missing_exact_join_applications;
  END IF;

  SELECT COUNT(*)
  INTO exact_join_count
  FROM product_tests
  JOIN product_contaminant_threshold_applications applications
    ON applications.food_id IS NOT DISTINCT FROM product_tests.food_id
    AND applications.supplement_id IS NOT DISTINCT FROM product_tests.supplement_id
  JOIN contaminant_thresholds thresholds
    ON thresholds.id = applications.threshold_id
  WHERE thresholds.active = true
    AND thresholds.comparison_scope = 'reviewed_application'
    AND thresholds.normalized_value IS NOT NULL
    AND product_tests.result_operator IN ('eq', 'gt', 'gte')
    AND product_tests.normalized_value IS NOT NULL
    AND thresholds.contaminant_key = product_tests.contaminant_key
    AND thresholds.normalized_unit = product_tests.normalized_unit
    AND thresholds.normalized_basis = product_tests.normalized_basis;

  IF exact_join_count <= 0 THEN
    RAISE EXCEPTION
      'reviewed product threshold applications produced zero exact comparable product-test joins';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM product_tests
    JOIN product_contaminant_threshold_applications applications
      ON applications.food_id IS NOT DISTINCT FROM product_tests.food_id
      AND applications.supplement_id IS NOT DISTINCT FROM product_tests.supplement_id
    JOIN contaminant_thresholds thresholds
      ON thresholds.id = applications.threshold_id
    WHERE applications.threshold_id = 'murph_efsa_2023_bpa_tdi_fdc_705844_70kg_52g_day'
      AND product_tests.food_id = 'fdc:705844'
      AND product_tests.source_key = 'plasticlist_bay_area_2024'
      AND product_tests.tested_source_product_id = '236'
      AND product_tests.contaminant_key = 'bisphenol_a_bpa'
      AND product_tests.result_operator IN ('eq', 'gt', 'gte')
      AND product_tests.normalized_value IS NOT NULL
      AND product_tests.normalized_unit = 'ppm'
      AND product_tests.normalized_basis = 'product_mass'
      AND thresholds.comparison_scope = 'reviewed_application'
      AND thresholds.normalized_unit = product_tests.normalized_unit
      AND thresholds.normalized_basis = product_tests.normalized_basis
      AND product_tests.normalized_value > thresholds.normalized_value
  ) THEN
    RAISE EXCEPTION
      'RXBAR BPA reviewed threshold seed must join PlasticList source product 236 on fdc:705844 and prove exceedance';
  END IF;
END $$;

SELECT
  COUNT(*) AS active_reviewed_threshold_count
FROM contaminant_thresholds
WHERE active = true
  AND comparison_scope = 'reviewed_application';

SELECT
  COUNT(*) AS reviewed_application_count
FROM product_contaminant_threshold_applications;

SELECT
  COUNT(*) AS exact_comparable_product_test_join_count
FROM product_tests
JOIN product_contaminant_threshold_applications applications
  ON applications.food_id IS NOT DISTINCT FROM product_tests.food_id
  AND applications.supplement_id IS NOT DISTINCT FROM product_tests.supplement_id
JOIN contaminant_thresholds thresholds
  ON thresholds.id = applications.threshold_id
WHERE thresholds.active = true
  AND thresholds.comparison_scope = 'reviewed_application'
  AND thresholds.normalized_value IS NOT NULL
  AND product_tests.result_operator IN ('eq', 'gt', 'gte')
  AND product_tests.normalized_value IS NOT NULL
  AND thresholds.contaminant_key = product_tests.contaminant_key
  AND thresholds.normalized_unit = product_tests.normalized_unit
  AND thresholds.normalized_basis = product_tests.normalized_basis;
