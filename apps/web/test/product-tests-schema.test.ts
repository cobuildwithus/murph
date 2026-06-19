import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const PUBLIC_CONTACT_EMAIL_PATTERN = /\S+@\S+\.\S+/u;
const PUBLIC_CONTACT_PHONE_PATTERN =
  /(?:\+?\d{1,3}[\s.-])?(?:\(?\d{3}\)?[\s.-])\d{3}[\s.-]\d{4}/u;

describe("product test contaminant schema", () => {
  it("keeps contaminant observations explicitly linked or source-only", async () => {
    const schemaSql = await readFile(
      new URL("../sql/product-tests/schema.sql", import.meta.url),
      "utf8",
    );

    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS product_tests");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS contaminant_thresholds");
    expect(schemaSql).toContain("UNIQUE (source_key, source_result_id, contaminant_key)");
    expect(schemaSql).toContain("FOREIGN KEY (food_id) REFERENCES foods(id)");
    expect(schemaSql).toContain("FOREIGN KEY (supplement_id) REFERENCES supplements(id)");
    expect(schemaSql).not.toContain("ON DELETE CASCADE");
    expect(schemaSql).toContain("CASE WHEN food_id IS NULL THEN 0 ELSE 1 END");
    expect(schemaSql).toContain("'exact_upc'");
    expect(schemaSql).toContain("'exact_source_id'");
    expect(schemaSql).toContain("'manual_confirmed'");
    expect(schemaSql).toContain("'source_only'");
    expect(schemaSql).toContain("product_tests_source_only_link_check");
    expect(schemaSql).toContain("product_tests_source_only_idx");
    expect(schemaSql).toContain("match_method = 'source_only'");
    expect(schemaSql).toContain("source_food.data_origin IN");
    expect(schemaSql).toContain("source_supplement.data_origin IN");
    const sourceSupplementRepairSql = schemaSql.slice(
      schemaSql.indexOf("FROM supplements source_supplement"),
      schemaSql.indexOf("ALTER TABLE product_tests\n  DROP CONSTRAINT IF EXISTS product_tests_source_only_link_check"),
    );
    expect(sourceSupplementRepairSql).toContain("'plasticlist_bay_area_2024'");
    expect(sourceSupplementRepairSql).toContain("'nyc_dohmh_consumer_products'");
    expect(sourceSupplementRepairSql).toContain("'king_county_consumer_products'");
    expect(sourceSupplementRepairSql).toContain("'pure_earth_rms_2024'");
    const supplementPlaceholderCleanupSql = schemaSql.slice(
      schemaSql.lastIndexOf("DELETE FROM supplements"),
    );
    expect(supplementPlaceholderCleanupSql).toContain("'plasticlist_bay_area_2024'");
    expect(supplementPlaceholderCleanupSql).toContain("'nyc_dohmh_consumer_products'");
    expect(supplementPlaceholderCleanupSql).toContain("'king_county_consumer_products'");
    expect(supplementPlaceholderCleanupSql).toContain("'pure_earth_rms_2024'");
    expect(schemaSql).toContain("product_tests_food_idx");
    expect(schemaSql).toContain("product_tests_supplement_idx");
    expect(schemaSql).toContain("contaminant_thresholds_active_comparable_idx");
    expect(schemaSql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS contaminant_thresholds_active_comparable_idx");
    expect(schemaSql).toContain("duplicate active normalized contaminant thresholds");
    expect(schemaSql).toContain("resolve before creating comparable threshold index");
    expect(schemaSql).toContain("normalized_value NUMERIC");
    expect(schemaSql).toContain("normalized_unit TEXT");
    expect(schemaSql).toContain("normalized_basis TEXT");
    expect(schemaSql).toContain("contaminant_thresholds_normalized_triplet_check");
    expect(schemaSql).toContain("WHERE active AND normalized_value IS NOT NULL");
    expect(schemaSql).toContain("normalized_unit,\n    normalized_basis\n  )");
    expect(schemaSql).toContain("UPDATE contaminant_thresholds");
    expect(schemaSql).toContain("WHEN threshold_unit IN ('ppm', 'mg/kg') THEN threshold_value");
    expect(schemaSql).toContain("threshold_value / 1000");
    expect(schemaSql).toContain("normalized_unit = 'ppm'");
    expect(schemaSql).toContain("WHEN threshold_unit = 'mg/kg-dry' THEN threshold_value");
    expect(schemaSql).toContain("WHEN threshold_unit = 'mg/kg-dry' THEN 'mg/kg-dry'");
    expect(schemaSql).toContain("SET\n  normalized_value = NULL");
    expect(schemaSql).toContain("WHERE NOT (\n    threshold_basis = 'product_mass'");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS product_contaminant_threshold_applications");
    expect(schemaSql).toContain("threshold_id TEXT NOT NULL REFERENCES contaminant_thresholds(id) ON UPDATE CASCADE");
    expect(schemaSql).toContain("product_contaminant_threshold_applications_product_link_check");
    expect(schemaSql).toContain("DROP INDEX IF EXISTS product_contaminant_threshold_applications_food_comparable_idx");
    expect(schemaSql).toContain("DROP INDEX IF EXISTS product_contaminant_threshold_applications_supplement_comparable_idx");
    expect(schemaSql).toContain("DROP INDEX IF EXISTS product_contaminant_threshold_applications_food_lookup_idx");
    expect(schemaSql).toContain("DROP INDEX IF EXISTS product_contaminant_threshold_applications_supplement_lookup_idx");
    expect(schemaSql).toContain("DROP COLUMN IF EXISTS contaminant_key");
    expect(schemaSql).toContain("DROP COLUMN IF EXISTS normalized_value");
    expect(schemaSql).toContain("DROP COLUMN IF EXISTS normalized_unit");
    expect(schemaSql).toContain("DROP COLUMN IF EXISTS normalized_basis");
    expect(schemaSql).not.toContain("SET id = regexp_replace(id, '_[0-9]{8}_v[0-9]{8}$', '')");
    expect(schemaSql).toContain("product_contaminant_threshold_applications_threshold_idx");
    expect(schemaSql).toContain("product_contaminant_threshold_applications_food_lookup_idx");
    expect(schemaSql).toContain("product_contaminant_threshold_applications_supplement_lookup_idx");
    expect(schemaSql).toContain("SET threshold_id = regexp_replace(threshold_id, '_[0-9]{8}_v[0-9]{8}$', '')");
    expect(schemaSql).toContain("UPDATE contaminant_thresholds versioned_thresholds");
    expect(schemaSql.indexOf("UPDATE contaminant_thresholds versioned_thresholds")).toBeLessThan(
      schemaSql.indexOf("duplicate active normalized contaminant thresholds"),
    );
    const foodThresholdApplicationLookupIndexSql = schemaSql.slice(
      schemaSql.indexOf("CREATE INDEX IF NOT EXISTS product_contaminant_threshold_applications_food_lookup_idx"),
      schemaSql.indexOf("CREATE INDEX IF NOT EXISTS product_contaminant_threshold_applications_supplement_lookup_idx"),
    );
    const supplementThresholdApplicationLookupIndexSql = schemaSql.slice(
      schemaSql.indexOf("CREATE INDEX IF NOT EXISTS product_contaminant_threshold_applications_supplement_lookup_idx"),
      schemaSql.indexOf("CREATE TABLE IF NOT EXISTS product_tests"),
    );
    expect(foodThresholdApplicationLookupIndexSql).not.toContain("contaminant_key");
    expect(supplementThresholdApplicationLookupIndexSql).not.toContain("contaminant_key");
    expect(schemaSql).toContain("UPDATE product_tests");
    expect(schemaSql).toContain("normalized_unit IN ('mg/kg', 'ppb', 'ug/kg', 'ng/g')");
    expect(schemaSql).toContain("threshold_basis = 'product_mass'");
    expect(schemaSql).toContain("DROP INDEX IF EXISTS contaminant_thresholds_active_identity_idx");
    expect(schemaSql).toContain("DROP INDEX IF EXISTS contaminant_thresholds_lookup_idx");
    expect(schemaSql).toContain("RENAME COLUMN contaminant_name TO threshold_name");
    expect(schemaSql).toContain("RENAME COLUMN authority_url TO threshold_url");
    expect(schemaSql).toContain("DROP CONSTRAINT IF EXISTS contaminant_thresholds_contaminant_key_check");
    expect(schemaSql).toContain("DROP CONSTRAINT IF EXISTS product_tests_contaminant_key_check");
    expect(schemaSql).not.toContain("authority_key,\n    threshold_unit");
  });

  it("documents PlasticList attribution and keeps imports behind explicit env", async () => {
    const readme = await readFile(
      new URL("../sql/product-tests/README.md", import.meta.url),
      "utf8",
    );
    const webReadme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const webEnvExample = await readFile(
      new URL("../.env.example", import.meta.url),
      "utf8",
    );
    const webPackageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const cloudflareReadme = await readFile(
      new URL("../../cloudflare/README.md", import.meta.url),
      "utf8",
    );
    const cloudflareDeployDoc = await readFile(
      new URL("../../cloudflare/DEPLOY.md", import.meta.url),
      "utf8",
    );
    const architecture = await readFile(
      new URL("../../../ARCHITECTURE.md", import.meta.url),
      "utf8",
    );
    const importScript = await readFile(
      new URL("../sql/product-tests/import-plasticlist.sh", import.meta.url),
      "utf8",
    );
    const importThresholdsScript = await readFile(
      new URL("../sql/product-tests/import-thresholds.sh", import.meta.url),
      "utf8",
    );
    const importThresholdApplicationsScript = await readFile(
      new URL(
        "../sql/product-tests/import-threshold-applications.sh",
        import.meta.url,
      ),
      "utf8",
    );
    const importOpenProductSourcesScript = await readFile(
      new URL(
        "../sql/product-tests/import-open-product-sources.sh",
        import.meta.url,
      ),
      "utf8",
    );
    const importProductTestRemapsScript = await readFile(
      new URL(
        "../sql/product-tests/import-product-test-remaps.sh",
        import.meta.url,
      ),
      "utf8",
    );
    const exportProductTestMatchCandidatesScript = await readFile(
      new URL(
        "../sql/product-tests/export-product-test-match-candidates.sh",
        import.meta.url,
      ),
      "utf8",
    );
    const importPlasticListBrandSiteFoodsScript = await readFile(
      new URL(
        "../sql/foods/import-plasticlist-brand-site-foods.sh",
        import.meta.url,
      ),
      "utf8",
    );
    const buildProductTestRemapReviewScript = await readFile(
      new URL(
        "../sql/product-tests/build-product-test-remap-review.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const importThresholdsSql = await readFile(
      new URL("../sql/product-tests/import-thresholds.sql", import.meta.url),
      "utf8",
    );
    const importThresholdApplicationsSql = await readFile(
      new URL(
        "../sql/product-tests/import-threshold-applications.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const importOpenProductSourcesSql = await readFile(
      new URL(
        "../sql/product-tests/import-open-product-sources.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const importSourceOnlyProductTestsBodySql = await readFile(
      new URL(
        "../sql/product-tests/import-source-only-product-tests-body.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const importProductTestRemapsSql = await readFile(
      new URL(
        "../sql/product-tests/import-product-test-remaps.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const exportProductTestMatchCandidatesSql = await readFile(
      new URL(
        "../sql/product-tests/export-product-test-match-candidates.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const syncOpenProductSources = await readFile(
      new URL(
        "../sql/product-tests/sync-open-product-sources.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const labelsDbPsqlHelper = await readFile(
      new URL("../sql/product-tests/labels-db-psql.sh", import.meta.url),
      "utf8",
    );
    const importSql = await readFile(
      new URL("../sql/product-tests/import-plasticlist.sql", import.meta.url),
      "utf8",
    );
    const legacyFoodsStubSql = await readFile(
      new URL(
        "../sql/product-tests/legacy-supplement-foods-stub.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const supplementBrandSiteLabelsScript = await readFile(
      new URL(
        "../../../.agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs",
        import.meta.url,
      ),
      "utf8",
    );

    expect(readme).toContain("PlasticList data is licensed under CC BY 4.0");
    expect(readme).toContain("Data on Plastic Chemicals in Bay Area Foods");
    expect(readme).toContain("`source_only` with no product link");
    expect(readme).toContain("It is intentionally not a product-matching");
    expect(readme).toContain("interface. To attach known exact matches");
    expect(readme).toContain("No PlasticList product creates a source-backed label row");
    expect(readme).toContain("does not clear curated product links");
    expect(readme).toContain("identity drift still repairs");
    expect(readme).toContain("same source product id, tested product");
    expect(readme).toContain("source identity");
    expect(readme).toContain("drift repairs the row back");
    expect(readme).toContain("import-plasticlist.sh --schema-only");
    expect(readme).toContain("--legacy-supplement-db");
    expect(readme).toContain("MURPH_SUPPLEMENT_DB_URL` is not a runtime");
    expect(webReadme).toContain("both require the shared product labels");
    expect(webReadme).toContain("every web environment serving `/api/foods` or `/api/supplements`");
    expect(webReadme).toContain("MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback");
    expect(webReadme).not.toContain("legacy supplement-only fallback");
    expect(webReadme).not.toContain("may still use the legacy");
    expect(webReadme).not.toContain("when the shared labels database is unset");
    expect(webEnvExample).toContain("MURPH_LABELS_DB_URL");
    expect(webEnvExample).not.toContain("MURPH_SUPPLEMENT_DB_URL");
    expect(webPackageJson).toContain("product-labels:env-check");
    expect(webPackageJson).toContain("check-product-label-runtime-env.ts");
    expect(cloudflareReadme).toContain("MURPH_SUPPLEMENT_DB_URL` is not a runtime");
    expect(cloudflareReadme).toContain("fallback.");
    expect(cloudflareReadme).not.toContain("may still use the legacy");
    expect(cloudflareReadme).not.toContain("when the shared");
    expect(cloudflareDeployDoc).toContain("MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback");
    expect(cloudflareDeployDoc).not.toContain("may still use the legacy");
    expect(cloudflareDeployDoc).not.toContain("fallback remains supplement-only");
    expect(architecture).toContain("both `/api/foods` and `/api/supplements` require it");
    expect(architecture).toContain("`MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback");
    expect(architecture).not.toContain("may still use legacy");
    expect(architecture).not.toContain("supplement-only fallback");
    expect(readme).toContain("separate curated `contaminant_thresholds` rows");
    expect(readme).toContain("import-thresholds.sh");
    expect(readme).toContain("Threshold imports are additive by default");
    expect(readme).toContain("Open Product Source Seeds");
    expect(readme).toContain("Bulk open-source contaminant CSV snapshots are intentionally not committed");
    expect(readme).toContain(".product-tests-work/seed-data/open-product-sources/");
    expect(readme).toContain("OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH");
    expect(readme).toContain("OPEN_PRODUCT_SOURCES_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS");
    expect(readme).toContain("With `--replace-source`, the importer requires");
    expect(readme).toContain("deletes rows absent from the complete");
    expect(readme).toContain("snapshot for the source keys present in the snapshot");
    expect(readme).toContain("import-open-product-sources.sh");
    expect(readme).toContain("sync-open-product-sources.ts");
    expect(readme).toContain("CC BY 4.0 Zenodo dataset");
    expect(readme).toContain("Recall feeds such as openFDA and FSIS");
    expect(readme).toContain("Re-imports are additive upserts");
    expect(readme).toContain("Bulk threshold CSV snapshots are intentionally not committed");
    expect(readme).toContain(".product-tests-work/seed-data/thresholds/");
    expect(readme).toContain("Reviewed Remaps");
    expect(readme).toContain("import-product-test-remaps.sh");
    expect(readme).toContain("Match Candidate Export");
    expect(readme).toContain("export-product-test-match-candidates.sh");
    expect(readme).toContain("build-product-test-remap-review.ts");
    expect(readme).toContain("review queue is intentionally not importable");
    expect(readme).toContain("Do not upsert sparse `foods` or `supplements` rows");
    expect(readme).toContain("plasticlist-brand-site-foods.json");
    expect(readme).toContain("plasticlist-brand-site-supplements.json");
    expect(readme).toContain("import-plasticlist-brand-site-foods.sh");
    expect(readme).toContain("They contain source URLs");
    expect(readme).toContain("ingredients, serving sizes, and available facts");
    expect(readme).toContain("Ambiguous fresh, counter, or");
    expect(readme).toContain("source-variable PlasticList products stay reviewed");
    expect(readme).toContain("supplement-db-brand-site-labels.mjs");
    expect(readme).toContain("plasticlist-brand-site-supplements.json");
    expect(readme).toContain("source_key\ttested_source_product_id\ttested_product_name");
    expect(readme).toContain("remaps/plasticlist-reviewed.tsv");
    expect(readme).toContain("PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS");
    expect(readme).toContain("`threshold_basis` preserves the source/regulatory scope");
    expect(readme).toContain("normalized comparison triplet");
    expect(readme).toContain("canonical `ppm` values");
    expect(readme).toContain("rows are left as `mg/kg-dry`");
    expect(readme).toContain("They compare only to explicitly dry-weight `mg/kg-dry` threshold rows");
    expect(readme).toContain("Public threshold snapshots can validly");
    expect(readme).toContain("produce zero active comparable rows");
    expect(readme).toContain("product_contaminant_threshold_applications");
    expect(readme).toContain("import-threshold-applications.sh");
    expect(readme).toContain("threshold-applications/reviewed.tsv");
    expect(readme).toContain("--replace-applications");
    expect(readme).toContain("PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS");
    expect(readme).toContain("Do not add");
    expect(readme).toMatch(/API-side raw threshold\s+fallback/u);
    expect(importScript).toContain("PLASTICLIST_SAMPLES_TSV_PATH is required");
    expect(importScript).toContain("PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS");
    expect(importScript).toContain("is required with --replace-source");
    expect(importScript).toContain("refusing destructive import");
    expect(importScript).toContain("--schema-only");
    expect(importScript).toContain("--legacy-supplement-db");
    expect(importScript).toContain("--replace-source");
    expect(importScript).toContain("legacy-supplement-foods-stub.sql");
    expect(importScript).toContain("apply_product_test_schemas");
    expect(importScript).toContain("plasticlist_bay_area_2024");
    expect(importScript).toContain("source_only");
    expect(importScript).toContain("apps/web/sql/foods/schema.sql");
    expect(importScript).toContain("apps/web/sql/supplements/schema.sql");
    expect(importScript).toContain("labels_db_psql_copy_literal \"$prepared_tsv\"");
    expect(importScript).toContain("labels-db-psql.sh");
    expect(labelsDbPsqlHelper).toContain("MURPH_LABELS_DB_URL is required");
    expect(labelsDbPsqlHelper).toContain("PGPASSFILE");
    expect(labelsDbPsqlHelper).toContain("systemRootCertPath");
    expect(labelsDbPsqlHelper).toContain('key === "sslrootcert" && value === "system"');
    expect(labelsDbPsqlHelper).toContain("env[envName] = rootCertPath");
    expect(labelsDbPsqlHelper).toContain("labels_db_psql_copy_literal");
    expect(labelsDbPsqlHelper).toContain("unset MURPH_LABELS_DB_URL labels_db_url");
    expect(labelsDbPsqlHelper).toContain("\"$labels_db_psql_bin\" -X \"$@\"");
    expect(importPlasticListBrandSiteFoodsScript).toContain("plasticlist-brand-site-foods.json");
    expect(importPlasticListBrandSiteFoodsScript).toContain("FDC_PREPARED_CSV");
    expect(importPlasticListBrandSiteFoodsScript).toContain("apps/web/sql/foods/apply-prepared.sql");
    expect(importPlasticListBrandSiteFoodsScript).toContain("labels-db-psql.sh");
    expect(importPlasticListBrandSiteFoodsScript).not.toContain("echo \"$labels_db_url\"");
    expect(supplementBrandSiteLabelsScript).toContain("process.env.MURPH_LABELS_DB_URL");
    expect(supplementBrandSiteLabelsScript).toContain("parseEnvValue(line, \"MURPH_LABELS_DB_URL\")");
    expect(supplementBrandSiteLabelsScript).not.toContain("process.env.MURPH_SUPPLEMENT_DB_URL");
    expect(supplementBrandSiteLabelsScript).not.toContain("supplementDbUrl");
    expect(supplementBrandSiteLabelsScript).toContain("sslRootCert === \"system\"");
    expect(supplementBrandSiteLabelsScript).toContain("function systemRootCertPath()");
    expect(supplementBrandSiteLabelsScript).toContain("delete env.MURPH_LABELS_DB_URL");
    expect(importScript).toContain("run_labels_psql -v ON_ERROR_STOP=1");
    expect(importScript).toContain("-v replace_source=\"$replace_source\"");
    expect(importScript).toContain("-v replace_source_expected_product_test_rows=\"$replace_source_expected_rows\"");
    expect(importScript).toContain("mktemp -d \"$work_dir/run.XXXXXX\"");
    expect(importScript).not.toContain("replace-source.lock");
    expect(importScript).not.toContain(
      "Another PlasticList --replace-source import is already running",
    );
    expect(importScript).toMatch(/LC_ALL=C\s+awk -F '\\t'/u);
    expect(importScript).toContain("clean_header(value)");
    expect(importScript).toContain("PLASTICLIST_PRODUCT_MATCHES_TSV_PATH is no longer supported");
    expect(importScript).not.toContain("match_header");
    expect(importScript).not.toContain("explicit_match");
    expect(importScript).toContain("csv_field(value)");
    expect(importScript).toContain("prepared zero product test rows");
    expect(importScript).toContain("add_contaminant(\"bpa\", \"bisphenol_a_bpa\"");
    expect(importScript).toContain("add_contaminant(\"dehp\", \"di_2_ethylhexyl_phthalate_dehp\"");
    expect(importScript).toContain("ng_g_to_ppm");
    expect(importScript).toContain("normalized_unit = \"ppm\"");
    expect(importScript).not.toContain("echo \"$labels_db_url\"");
    expect(importSql).toContain("BEGIN;");
    expect(importSql).toContain("COMMIT;");
    expect(importSql).toContain(
      "\\copy source_only_product_tests_import FROM __PRODUCT_TESTS_TSV__",
    );
    expect(importSql).toContain("import-source-only-product-tests-body.sql");
    expect(importSql).not.toContain("FROM :'product_tests_tsv'");
    expect(importSql).not.toContain("ON CONFLICT (source_key, source_result_id, contaminant_key)");
    expect(importSourceOnlyProductTestsBodySql).toContain("CREATE TEMP TABLE source_only_product_tests_import_options");
    expect(importSourceOnlyProductTestsBodySql).toContain(":'replace_source'::boolean");
    expect(importSourceOnlyProductTestsBodySql).toContain(":'replace_source_expected_product_test_rows'");
    expect(importSourceOnlyProductTestsBodySql).toContain("(SELECT replace_source FROM source_only_product_tests_import_options)");
    expect(importSourceOnlyProductTestsBodySql).toContain("source-only product test replace-source row count mismatch");
    expect(importSourceOnlyProductTestsBodySql).toContain("UPDATE product_tests tests");
    expect(importSourceOnlyProductTestsBodySql).toContain("NULLIF(current_import.tested_source_product_id, '')");
    expect(importSourceOnlyProductTestsBodySql).toMatch(
      /UPDATE product_tests tests[\s\S]*tests\.tested_source_product_id IS NOT DISTINCT FROM NULLIF\(current_import\.tested_source_product_id, ''\)[\s\S]*tests\.tested_product_name IS NOT DISTINCT FROM NULLIF\(current_import\.tested_product_name, ''\)[\s\S]*tests\.tested_product_brand IS NOT DISTINCT FROM NULLIF\(current_import\.tested_product_brand, ''\)[\s\S]*tests\.tested_product_upc IS NOT DISTINCT FROM NULLIF\(current_import\.tested_product_upc, ''\)/u,
    );
    expect(importSourceOnlyProductTestsBodySql).toContain("tests.tested_product_upc IS NOT DISTINCT FROM NULLIF(current_import.tested_product_upc, '')");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("tests.tested_source_product_id IS NOT NULL");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("explicit_match");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("food_id = CASE");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("supplement_id = CASE");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("match_method = CASE");
    expect(importSourceOnlyProductTestsBodySql).toContain("source-only product test rows must import as source_only with no product link");
    expect(importSourceOnlyProductTestsBodySql).toContain("pg_advisory_xact_lock");
    expect(importSourceOnlyProductTestsBodySql).toContain("murph:product_tests:mutation");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("murph:plasticlist_bay_area_2024:import");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("WHEN :'replace_source' = 'true' OR");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("product_tests.match_method = 'exact_source_id'");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("product_tests.food_id LIKE 'plasticlist_bay_area_2024:%'");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("canonical_key = EXCLUDED.canonical_key");
    expect(importSourceOnlyProductTestsBodySql).toContain("DELETE FROM product_tests");
    expect(importSql).toContain("DELETE FROM foods");
    expect(importSql).toMatch(/DELETE FROM foods[\s\S]*product_tests\.food_id = foods\.id/u);
    expect(importSql).not.toMatch(/DELETE FROM foods[\s\S]*plasticlist_foods_import current_import/u);
    expect(importThresholdsScript).toContain("CONTAMINANT_THRESHOLDS_CSV_PATH");
    expect(importThresholdsScript).toContain("CONTAMINANT_THRESHOLDS_CSV_PATH is required");
    expect(importThresholdsScript).toContain("must be repo-relative");
    expect(importThresholdsScript).not.toContain("replace_missing_authority_thresholds");
    expect(importThresholdsScript).toContain("NR > 1");
    expect(importThresholdsScript).toContain("print count + 0 > count_file");
    expect(importThresholdsScript).not.toContain("wc -l < \"$thresholds_csv\"");
    expect(importThresholdsScript).not.toContain("tail -n +2 \"$thresholds_csv\"");
    expect(importThresholdsScript).toContain("labels-db-psql.sh");
    expect(importThresholdsScript).toContain("--legacy-supplement-db");
    expect(importThresholdsScript).toContain("legacy-supplement-foods-stub.sql");
    expect(importThresholdsScript).not.toContain("apps/web/sql/product-tests/thresholds/");
    expect(importThresholdsScript).toContain("import-thresholds.sql");
    expect(importThresholdApplicationsScript).toContain("PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH");
    expect(importThresholdApplicationsScript).toContain("PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH is required");
    expect(importThresholdApplicationsScript).toContain("PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH must be repo-relative");
    expect(importThresholdApplicationsScript).toContain("PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS");
    expect(importThresholdApplicationsScript).toContain("--replace-applications");
    expect(importThresholdApplicationsScript).toContain("[ \"$replace_applications\" = true ]");
    expect(importThresholdApplicationsScript).toContain("refusing destructive import");
    expect(importThresholdApplicationsScript).toContain("refusing to run no-op import");
    expect(importThresholdApplicationsScript).toContain("labels-db-psql.sh");
    expect(importThresholdApplicationsScript).toContain("apps/web/sql/foods/schema.sql");
    expect(importThresholdApplicationsScript).toContain("apps/web/sql/supplements/schema.sql");
    expect(importThresholdApplicationsScript).toContain("import-threshold-applications.sql");
    expect(importThresholdApplicationsScript).toContain("labels_db_psql_copy_literal \"$prepared_applications_tsv\"");
    expect(importThresholdApplicationsScript).toContain("-v replace_applications=\"$replace_applications\"");
    expect(importThresholdApplicationsScript).toContain("NR > 1");
    expect(importThresholdApplicationsScript).toContain("print count + 0 > count_file");
    expect(importThresholdApplicationsScript).not.toContain("echo \"$labels_db_url\"");
    expect(importOpenProductSourcesScript).not.toContain("OPEN_PRODUCT_SOURCES_PRODUCTS_CSV_PATH");
    expect(importOpenProductSourcesScript).toContain("OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH is required");
    expect(importOpenProductSourcesScript).toContain("OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH must be repo-relative");
    expect(importOpenProductSourcesScript).toContain("labels-db-psql.sh");
    expect(importOpenProductSourcesScript).toContain("apps/web/sql/foods/schema.sql");
    expect(importOpenProductSourcesScript).toContain("apps/web/sql/supplements/schema.sql");
    expect(importOpenProductSourcesScript).toContain("import-open-product-sources.sql");
    expect(importOpenProductSourcesScript).toContain("labels_db_psql_copy_literal \"$product_tests_csv_path\"");
    expect(importOpenProductSourcesScript).not.toContain("echo \"$labels_db_url\"");
    expect(importProductTestRemapsScript).toContain("PRODUCT_TEST_REMAPS_TSV_PATH is required");
    expect(importProductTestRemapsScript).toContain("PRODUCT_TEST_REMAPS_TSV_PATH must be repo-relative");
    expect(importProductTestRemapsScript).toContain("labels_db_psql_copy_literal \"$remaps_tsv_path\"");
    expect(importProductTestRemapsScript).toContain("apps/web/sql/foods/schema.sql");
    expect(importProductTestRemapsScript).toContain("apps/web/sql/supplements/schema.sql");
    expect(importProductTestRemapsScript).toContain("import-product-test-remaps.sql");
    expect(importProductTestRemapsScript).not.toContain("echo \"$labels_db_url\"");
    expect(exportProductTestMatchCandidatesScript).toContain("PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH is required");
    expect(exportProductTestMatchCandidatesScript).toContain("PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH must be repo-relative");
    expect(exportProductTestMatchCandidatesScript).toContain("PRODUCT_TEST_MATCH_SOURCE_KEY");
    expect(exportProductTestMatchCandidatesScript).toContain("PRODUCT_TEST_MATCH_CANDIDATE_LIMIT");
    expect(exportProductTestMatchCandidatesScript).toContain("> \"$candidate_tmp\"");
    expect(exportProductTestMatchCandidatesScript).toContain("mv \"$candidate_tmp\" \"$candidates_tsv_path\"");
    expect(exportProductTestMatchCandidatesScript).toContain("export-product-test-match-candidates.sql");
    expect(exportProductTestMatchCandidatesScript).not.toContain("echo \"$labels_db_url\"");
    expect(buildProductTestRemapReviewScript).toContain("PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH is required");
    expect(buildProductTestRemapReviewScript).toContain("PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH is required");
    expect(buildProductTestRemapReviewScript).toContain("row.candidate_rank === \"1\"");
    expect(buildProductTestRemapReviewScript).toContain("suggested_food_id");
    expect(buildProductTestRemapReviewScript).toContain("suggested_supplement_id");
    expect(importThresholdsSql).toContain("CREATE TEMP TABLE contaminant_thresholds_import");
    expect(importThresholdsSql).not.toContain("contaminant_thresholds_import_options");
    expect(importThresholdsSql).toContain("pg_advisory_xact_lock");
    expect(importThresholdsSql).toContain("murph:contaminant_thresholds:import");
    expect(importThresholdsSql).toContain(
      "\\copy contaminant_thresholds_import FROM __THRESHOLDS_CSV__",
    );
    expect(importThresholdsSql).not.toContain("FROM :'thresholds_csv'");
    expect(importThresholdsSql).toContain("contaminant_thresholds_cleaned");
    expect(importThresholdsSql).toContain("contaminant_thresholds_normalized");
    expect(importThresholdsSql).toContain("threshold_basis = 'product_mass'");
    expect(importThresholdsSql).toContain("THEN threshold_value");
    expect(importThresholdsSql).toContain("THEN threshold_value / 1000");
    expect(importThresholdsSql).toContain("THEN 'ppm'");
    expect(importThresholdsSql).toContain("threshold_unit = 'mg/kg-dry'");
    expect(importThresholdsSql).toContain("THEN 'mg/kg-dry'");
    expect(importThresholdsSql).toContain("normalized_value = EXCLUDED.normalized_value");
    expect(importThresholdsSql).toContain("final_active_normalized_thresholds");
    expect(importThresholdsSql).toContain("id NOT IN");
    expect(importThresholdsSql).not.toContain("replace_missing_authority_thresholds");
    expect(importThresholdsSql).toContain("duplicate active normalized contaminant thresholds after import");
    expect(importThresholdsSql).toContain("resolve before importing comparable thresholds");
    expect(importThresholdsSql).not.toContain("contaminant threshold complete seed count mismatch");
    expect(importThresholdsSql).not.toContain("authority_key = 'ca_oehha_prop65') <> 355");
    expect(importThresholdsSql).not.toContain("authority_key = 'eu_commission') <> 529");
    expect(importThresholdsSql).not.toContain("authority_key = 'fda') <> 303");
    expect(importThresholdsSql).not.toContain("authority_key = 'fda_cfr') <> 103");
    expect(importThresholdsSql).not.toContain("SELECT DISTINCT authority_key");
    expect(importThresholdsSql).toContain("regexp_replace(btrim(id), '_[0-9]{8}_v[0-9]{8}$', '')");
    expect(importThresholdsSql).toContain("UPDATE contaminant_thresholds versioned_thresholds");
    expect(importThresholdsSql.indexOf("UPDATE contaminant_thresholds versioned_thresholds")).toBeLessThan(
      importThresholdsSql.indexOf("duplicate active normalized contaminant thresholds after import"),
    );
    expect(importThresholdsSql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(importThresholdApplicationsSql).toContain("CREATE TEMP TABLE product_threshold_applications_import");
    expect(importThresholdApplicationsSql).toContain("product_contaminant_threshold_applications");
    expect(importThresholdApplicationsSql).toContain("pg_advisory_xact_lock");
    expect(importThresholdApplicationsSql).toContain("murph:contaminant_threshold_applications:import");
    expect(importThresholdApplicationsSql).toContain(
      "\\copy product_threshold_applications_import FROM __THRESHOLD_APPLICATIONS_TSV__",
    );
    expect(importThresholdApplicationsSql).toContain("jsonb_build_array");
    expect(importThresholdApplicationsSql).toContain("'product_mass' AS normalized_basis");
    expect(importThresholdApplicationsSql).toContain("OR threshold_id IS NULL");
    expect(importThresholdApplicationsSql).toContain("OR review_note IS NULL");
    expect(importThresholdApplicationsSql).toContain("WHEN thresholds.threshold_unit IN ('ppm', 'mg/kg') THEN thresholds.threshold_value");
    expect(importThresholdApplicationsSql).toContain("WHEN thresholds.threshold_unit IN ('ppb', 'ug/kg', 'ng/g') THEN thresholds.threshold_value / 1000");
    expect(importThresholdApplicationsSql).toContain("WHEN thresholds.threshold_unit = 'mg/kg-dry' THEN thresholds.threshold_value");
    expect(importThresholdApplicationsSql).not.toContain("WHERE thresholds.threshold_basis = 'product_mass'");
    expect(importThresholdApplicationsSql).toContain(
      "product threshold application normalization dropped rows before import mutation",
    );
    expect(importThresholdApplicationsSql).toContain(
      "product threshold application row references inactive threshold_id",
    );
    expect(importThresholdApplicationsSql).toContain(
      "contaminant_thresholds.active IS DISTINCT FROM true",
    );
    expect(importThresholdApplicationsSql).toContain("DELETE FROM product_contaminant_threshold_applications");
    expect(importThresholdApplicationsSql).toContain("WHERE id NOT IN");
    expect(importThresholdApplicationsSql).toContain(":'replace_applications' = 'true'");
    expect(importThresholdApplicationsSql).toContain("existing_applications.id <> current_import.id");
    expect(importThresholdApplicationsSql).toContain("duplicate product threshold applications after import");
    expect(importThresholdApplicationsSql).toContain("duplicate product threshold applications");
    expect(importThresholdApplicationsSql).toContain("ON CONFLICT (id) DO UPDATE");
    const productThresholdApplicationsInsertSql = importThresholdApplicationsSql.slice(
      importThresholdApplicationsSql.indexOf("INSERT INTO product_contaminant_threshold_applications"),
      importThresholdApplicationsSql.indexOf("DO $$\nDECLARE", importThresholdApplicationsSql.indexOf("ON CONFLICT (id) DO UPDATE")),
    );
    expect(productThresholdApplicationsInsertSql).not.toContain("contaminant_key");
    expect(importThresholdApplicationsSql).not.toContain("contaminant_key = EXCLUDED.contaminant_key");
    expect(importThresholdApplicationsSql).not.toContain("normalized_value = EXCLUDED.normalized_value");
    expect(importThresholdApplicationsSql).not.toContain("normalized_unit = EXCLUDED.normalized_unit");
    expect(importThresholdApplicationsSql).not.toContain("normalized_basis = EXCLUDED.normalized_basis");
    expect(importThresholdApplicationsSql).not.toContain("product threshold application import prepared zero rows");
    expect(importThresholdApplicationsSql.indexOf(
      "product threshold application normalization dropped rows before import mutation",
    )).toBeLessThan(importThresholdApplicationsSql.indexOf(
      "DELETE FROM product_contaminant_threshold_applications",
    ));
    expect(importThresholdApplicationsSql.indexOf(
      "product threshold application row references inactive threshold_id",
    )).toBeLessThan(importThresholdApplicationsSql.indexOf(
      "DELETE FROM product_contaminant_threshold_applications",
    ));
    expect(importOpenProductSourcesSql).toContain("CREATE TEMP TABLE source_only_product_tests_import");
    expect(importOpenProductSourcesSql).toContain(
      "\\copy source_only_product_tests_import FROM __PRODUCT_TESTS_CSV__",
    );
    expect(importOpenProductSourcesSql).toContain("import-source-only-product-tests-body.sql");
    expect(importOpenProductSourcesSql).not.toContain("FROM :'products_csv'");
    expect(importOpenProductSourcesSql).not.toContain("FROM :'product_tests_csv'");
    expect(importOpenProductSourcesSql).not.toContain("pg_advisory_xact_lock");
    expect(importSourceOnlyProductTestsBodySql).toContain("pg_advisory_xact_lock");
    expect(importSourceOnlyProductTestsBodySql).toContain("murph:product_tests:mutation");
    expect(importOpenProductSourcesSql).not.toContain("murph:open_product_sources:import");
    expect(importOpenProductSourcesScript).toContain("--replace-source");
    expect(importOpenProductSourcesScript).toContain("OPEN_PRODUCT_SOURCES_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS");
    expect(importOpenProductSourcesScript).toContain("Open product sources --replace-source expected");
    expect(importOpenProductSourcesScript).toContain("-v replace_source=\"$replace_source\"");
    expect(importOpenProductSourcesScript).toContain("-v replace_source_expected_product_test_rows=\"$replace_source_expected_rows\"");
    expect(importOpenProductSourcesScript).not.toContain("replace-source.lock");
    expect(importOpenProductSourcesScript).not.toContain(
      "Another open product sources --replace-source import is already running",
    );
    expect(importSourceOnlyProductTestsBodySql).toContain(":'replace_source'::boolean");
    expect(importSourceOnlyProductTestsBodySql).toContain(":'replace_source_expected_product_test_rows'");
    expect(importSourceOnlyProductTestsBodySql).toContain("source-only product test replace-source row count mismatch");
    expect(importSourceOnlyProductTestsBodySql).toContain("source-only product test rows must import as source_only with no product link");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("open product source product test seed count mismatch");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("source_key = 'nyc_dohmh_consumer_products') <> 6230");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("source_key = 'king_county_consumer_products') <> 277");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("source_key = 'pure_earth_rms_2024') <> 1640");
    expect(importSourceOnlyProductTestsBodySql).toContain("DELETE FROM product_tests");
    expect(importSourceOnlyProductTestsBodySql).toContain("USING (\n  SELECT DISTINCT source_key");
    expect(importSourceOnlyProductTestsBodySql).toContain("UPDATE product_tests tests");
    expect(importSourceOnlyProductTestsBodySql).toContain("NOT EXISTS (\n    SELECT 1\n    FROM source_only_product_tests_import current_import");
    const openProductSourcesReplaceDelete = importSourceOnlyProductTestsBodySql.match(
      /DELETE FROM product_tests tests[\s\S]*?;\n\nUPDATE product_tests tests/u,
    )?.[0] ?? "";
    expect(openProductSourcesReplaceDelete).not.toContain("tests.match_method <> 'source_only'");
    expect(importSourceOnlyProductTestsBodySql).toContain("NULLIF(current_import.tested_source_product_id, '')");
    expect(importSourceOnlyProductTestsBodySql).toContain("tests.tested_product_name IS NOT DISTINCT FROM NULLIF(current_import.tested_product_name, '')");
    expect(importSourceOnlyProductTestsBodySql).toMatch(
      /UPDATE product_tests tests[\s\S]*tests\.tested_source_product_id IS NOT DISTINCT FROM NULLIF\(current_import\.tested_source_product_id, ''\)[\s\S]*tests\.tested_product_name IS NOT DISTINCT FROM NULLIF\(current_import\.tested_product_name, ''\)[\s\S]*tests\.tested_product_brand IS NOT DISTINCT FROM NULLIF\(current_import\.tested_product_brand, ''\)[\s\S]*tests\.tested_product_upc IS NOT DISTINCT FROM NULLIF\(current_import\.tested_product_upc, ''\)/u,
    );
    expect(importSourceOnlyProductTestsBodySql).not.toContain("tests.tested_source_product_id IS NOT NULL");
    expect(importOpenProductSourcesSql).not.toContain("DELETE FROM foods");
    expect(importOpenProductSourcesSql).not.toContain("DELETE FROM supplements");
    expect(importSourceOnlyProductTestsBodySql).toContain("SELECT DISTINCT source_key");
    expect(importOpenProductSourcesSql).not.toContain("SELECT DISTINCT data_origin");
    expect(importOpenProductSourcesSql).not.toContain("INSERT INTO foods");
    expect(importOpenProductSourcesSql).not.toContain("INSERT INTO supplements");
    expect(importSourceOnlyProductTestsBodySql).toContain("INSERT INTO product_tests");
    expect(importSourceOnlyProductTestsBodySql).toContain("ON CONFLICT (source_key, source_result_id, contaminant_key)");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("food_id = CASE");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("supplement_id = CASE");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("match_method = CASE");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("ELSE product_tests.food_id");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("ELSE product_tests.supplement_id");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("ELSE product_tests.match_method");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("FROM foods current_food");
    expect(importSourceOnlyProductTestsBodySql).not.toContain("FROM supplements current_supplement");
    const openProductSourcesConflictUpdate = importSourceOnlyProductTestsBodySql.match(
      /ON CONFLICT \(source_key, source_result_id, contaminant_key\)[\s\S]*?DO UPDATE SET(?<update>[\s\S]*?)DO \$\$/u,
    )?.groups?.update ?? "";
    expect(openProductSourcesConflictUpdate).not.toContain("food_id =");
    expect(openProductSourcesConflictUpdate).not.toContain("supplement_id =");
    expect(openProductSourcesConflictUpdate).not.toContain("match_method =");
    expect(importSourceOnlyProductTestsBodySql).toContain("source-only product test row retained a product link");
    expect(importProductTestRemapsSql).toContain("CREATE TEMP TABLE product_test_remaps_import");
    expect(importProductTestRemapsSql).toContain("murph:product_tests:mutation");
    expect(importProductTestRemapsSql).not.toContain("murph:product_test_remaps:import");
    expect(importProductTestRemapsSql).toContain("\\copy product_test_remaps_import FROM __REMAPS_TSV__");
    expect(importProductTestRemapsSql).toContain("tested_product_name TEXT");
    expect(importProductTestRemapsSql).toContain("tested_product_brand TEXT");
    expect(importProductTestRemapsSql).toContain("tested_product_upc TEXT");
    expect(importProductTestRemapsSql).toContain("product test remap row must use source_only with no product link or a linked method with exactly one product link");
    expect(importProductTestRemapsSql).toContain("product test remap row references missing or source-backed food_id");
    expect(importProductTestRemapsSql).toContain("product test remap row references missing or source-backed supplement_id");
    expect(importProductTestRemapsSql).toContain("foods.data_origin NOT IN");
    expect(importProductTestRemapsSql).toContain("supplements.data_origin NOT IN");
    expect(importProductTestRemapsSql).toContain("product test remap row references missing source product tests");
    expect(importProductTestRemapsSql).toContain("product test remap row source identity does not match current source product tests");
    expect(importProductTestRemapsSql).toContain("tests.tested_product_name IS NOT DISTINCT FROM NULLIF(remaps.tested_product_name, '')");
    expect(importProductTestRemapsSql).toContain("tests.tested_product_brand IS NOT DISTINCT FROM NULLIF(remaps.tested_product_brand, '')");
    expect(importProductTestRemapsSql).toContain("tests.tested_product_upc IS NOT DISTINCT FROM NULLIF(remaps.tested_product_upc, '')");
    expect(importProductTestRemapsSql).toContain("UPDATE product_tests tests");
    expect(importProductTestRemapsSql).toContain("match_method = remaps.match_method");
    expect(importProductTestRemapsSql).toMatch(
      /UPDATE product_tests tests[\s\S]*tests\.tested_product_name IS NOT DISTINCT FROM NULLIF\(remaps\.tested_product_name, ''\)[\s\S]*tests\.tested_product_brand IS NOT DISTINCT FROM NULLIF\(remaps\.tested_product_brand, ''\)[\s\S]*tests\.tested_product_upc IS NOT DISTINCT FROM NULLIF\(remaps\.tested_product_upc, ''\)/u,
    );
    expect(exportProductTestMatchCandidatesSql).toContain("tests.match_method = 'source_only'");
    expect(exportProductTestMatchCandidatesSql).toContain(":'source_key_filter' = '' OR tests.source_key = :'source_key_filter'");
    expect(exportProductTestMatchCandidatesSql).toContain("foods.upc = source_queries.normalized_source_upc");
    expect(exportProductTestMatchCandidatesSql).toContain("supplements.upc = source_queries.normalized_source_upc");
    expect(exportProductTestMatchCandidatesSql).toContain("strict_word_similarity");
    expect(exportProductTestMatchCandidatesSql).toContain("websearch_to_tsquery");
    expect(exportProductTestMatchCandidatesSql).toContain("'name_fts'::text AS candidate_reason");
    expect(exportProductTestMatchCandidatesSql).not.toContain("% source_queries.source_query");
    expect(exportProductTestMatchCandidatesSql).toContain("suggested_match_method");
    expect(exportProductTestMatchCandidatesSql).toContain("TO STDOUT");
    expect(syncOpenProductSources).toContain("nyc_dohmh_consumer_products");
    expect(syncOpenProductSources).toContain("king_county_consumer_products");
    expect(syncOpenProductSources).toContain("pure_earth_rms_2024");
    expect(syncOpenProductSources).toContain("data.cityofnewyork.us/resource/da9u-wz3r.json");
    expect(syncOpenProductSources).toContain("data.kingcounty.gov/resource/i6sy-ckp7.json");
    expect(syncOpenProductSources).toContain("zenodo.org/records/10444602");
    expect(syncOpenProductSources).toContain("Dietary Supplement/Medications/Remedy");
    expect(syncOpenProductSources).toContain("const foodCategories = new Set([\"1\", \"7\", \"10\", \"11\"])");
    expect(syncOpenProductSources).toContain("Pure Earth RMS eligible food row is missing Item ID");
    expect(syncOpenProductSources).toContain("function pureEarthSourceRowId");
    expect(syncOpenProductSources).toContain("createHash(\"sha256\")");
    expect(syncOpenProductSources).not.toContain("__row_number");
    expect(syncOpenProductSources).toContain("normalizedResultForUnit");
    expect(syncOpenProductSources).toContain("hasNumericComparableResult");
    expect(syncOpenProductSources).toContain("Number(value) / 1000");
    expect(syncOpenProductSources).toContain(".product-tests-work/seed-data/open-product-sources/");
    expect(syncOpenProductSources).not.toContain("./open-data/");
    expect(syncOpenProductSources).not.toContain("Consumer Reports");
    expect(syncOpenProductSources).not.toContain("DetectLead");
    const openContaminantSourceKeys = new Set([
      "plasticlist_bay_area_2024",
      ...[...syncOpenProductSources.matchAll(/key: "([^"]+)"/gu)]
        .map((match) => match[1] ?? ""),
    ]);
    expect(openContaminantSourceKeys).toEqual(new Set([
      "plasticlist_bay_area_2024",
      "nyc_dohmh_consumer_products",
      "king_county_consumer_products",
      "pure_earth_rms_2024",
    ]));
    expect(legacyFoodsStubSql).toContain("canonical_key TEXT NOT NULL");
    expect(legacyFoodsStubSql).toContain("UNIQUE (data_origin, data_origin_id)");
    expect(legacyFoodsStubSql).not.toContain("CREATE EXTENSION");
    expect(legacyFoodsStubSql).not.toContain("foods_search_idx");
  });

  it("builds a non-importable remap review queue from rank-one candidates", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-remap-review-"));
    const reviewQueueRoot = path.join(
      process.cwd(),
      ".product-tests-work",
      `test-remap-review-${Date.now()}-${process.pid}`,
    );
    try {
      const candidatesPath = path.join(tempRoot, "candidates.tsv");
      const reviewQueuePath = path.join(reviewQueueRoot, "review-queue.tsv");
      const header = [
        "source_key",
        "tested_source_product_id",
        "tested_product_name",
        "tested_product_brand",
        "tested_product_upc",
        "product_test_rows",
        "contaminant_keys",
        "candidate_rank",
        "candidate_kind",
        "candidate_id",
        "candidate_name",
        "candidate_brand",
        "candidate_upc",
        "candidate_data_origin",
        "candidate_data_origin_id",
        "candidate_off_market",
        "candidate_reason",
        "candidate_score",
        "suggested_match_method",
        "review_note",
      ];
      await writeFile(
        candidatesPath,
        [
          header.join("\t"),
          quotedTsvRow([
            "plasticlist_bay_area_2024",
            "75",
            "Celsius Sparkling Drink Wildberry",
            "",
            "",
            "57",
            "bisphenol_a_bpa",
            "1",
            "supplement",
            "40352",
            "Celsius Sparkling Wild Berry",
            "Celsius",
            "889392000429",
            "dsld",
            "40352",
            "f",
            "name_fts",
            "101.5",
            "manual_confirmed",
            "",
          ]),
          quotedTsvRow([
            "plasticlist_bay_area_2024",
            "75",
            "Celsius Sparkling Drink Wildberry",
            "",
            "",
            "57",
            "bisphenol_a_bpa",
            "2",
            "supplement",
            "17937",
            "Celsius Sparkling Wild Berry",
            "Celsius",
            "889392000320",
            "dsld",
            "17937",
            "t",
            "name_fts",
            "99.5",
            "manual_confirmed",
            "",
          ]),
          quotedTsvRow([
            "plasticlist_bay_area_2024",
            "222",
            "Cheerios 100% Whole Grain Oats Cereal",
            "",
            "",
            "95",
            "bisphenol_a_bpa",
            "1",
            "food",
            "fdc:1757907",
            "Cheerios Whole Grain Oats Gluten Free Breakfast Cereal",
            "Cheerios",
            "00016000275263",
            "usda_branded",
            "1757907",
            "f",
            "name_fts",
            "88.1",
            "manual_confirmed",
            "",
          ]),
          "",
        ].join("\n"),
      );

      await execFileAsync(
        "pnpm",
        [
          "exec",
          "tsx",
          "apps/web/sql/product-tests/build-product-test-remap-review.ts",
        ],
        {
          env: {
            ...process.env,
            PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH: candidatesPath,
            PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH: reviewQueuePath,
          },
        },
      );

      const reviewQueue = await readFile(reviewQueuePath, "utf8");
      const lines = reviewQueue.trimEnd().split("\n");
      expect(lines[0]).toContain("suggested_food_id");
      expect(lines[0]).toContain("suggested_supplement_id");
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("\t40352\tmanual_confirmed");
      expect(lines[1]).not.toContain("17937");
      expect(lines[2]).toContain("\tfdc:1757907\t\tmanual_confirmed");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(reviewQueueRoot, { recursive: true, force: true });
    }
  });

  it("keeps remap review queue output in the ignored work directory", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-remap-review-"));
    try {
      const candidatesPath = path.join(tempRoot, "candidates.tsv");
      const reviewQueuePath = path.join(tempRoot, "review-queue.tsv");
      await writeFile(
        candidatesPath,
        "source_key\ttested_source_product_id\tcandidate_rank\n",
      );

      await expect(execFileAsync(
        "pnpm",
        [
          "exec",
          "tsx",
          "apps/web/sql/product-tests/build-product-test-remap-review.ts",
        ],
        {
          env: {
            ...process.env,
            PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH: candidatesPath,
            PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH: reviewQueuePath,
          },
        },
      )).rejects.toMatchObject({
        stderr: expect.stringContaining("must be under .product-tests-work/"),
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps bulk contaminant CSV snapshots out of committed seed directories", async () => {
    const gitignore = await readFile(
      new URL("../../../.gitignore", import.meta.url),
      "utf8",
    );

    await expect(readFile(
      new URL(
        "../sql/product-tests/open-data/open_product_sources_product_tests.csv",
        import.meta.url,
      ),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });

    for (const file of [
      "california_prop65_contaminant_thresholds.csv",
      "eu_contaminant_thresholds.csv",
      "us_federal_contaminant_thresholds_excluding_california.csv",
    ]) {
      await expect(readFile(
        new URL(`../sql/product-tests/thresholds/${file}`, import.meta.url),
        "utf8",
      )).rejects.toMatchObject({ code: "ENOENT" });
    }

    expect(gitignore).toContain(".product-tests-work/");
  });

  it("keeps reviewed PlasticList remaps import-ready", async () => {
    const brandSiteFoodIds = new Set(
      (await readPlasticListBrandSiteFoodRows()).map((row) => row.id),
    );
    const brandSiteSupplementIds = new Set(
      (await readPlasticListBrandSiteSupplementRows()).map((row) => row.id),
    );
    const remapRecords = parseTsv(
      await readFile(
        new URL(
          "../sql/product-tests/remaps/plasticlist-reviewed.tsv",
          import.meta.url,
        ),
        "utf8",
      ),
    );

    expect(remapRecords).toHaveLength(71);

    const identities = new Set<string>();
    for (const record of remapRecords) {
      const testedSourceProductId = record.tested_source_product_id ?? "";
      const testedProductName = record.tested_product_name ?? "";
      const foodId = record.food_id ?? "";
      const supplementId = record.supplement_id ?? "";

      expect(record.source_key).toBe("plasticlist_bay_area_2024");
      expect(testedSourceProductId).toMatch(/^\d+$/u);
      expect(testedProductName).not.toHaveLength(0);
      expect(record.tested_product_brand).toBe("");
      expect(record.tested_product_upc).toBe("");
      expect(identities.has(testedSourceProductId)).toBe(false);
      identities.add(testedSourceProductId);

      const linkCount = (foodId ? 1 : 0) + (supplementId ? 1 : 0);
      if (record.match_method === "source_only") {
        expect(linkCount).toBe(0);
      } else {
        expect(linkCount).toBe(1);
        expect(record.match_method).toBe("manual_confirmed");
      }

      if (foodId) {
        expect(
          /^fdc:\d+$/u.test(foodId) || brandSiteFoodIds.has(foodId),
        ).toBe(true);
      }
      if (supplementId) {
        expect(
          /^\d+$/u.test(supplementId)
            || brandSiteSupplementIds.has(supplementId),
        ).toBe(true);
      }
      expect(record.review_note).not.toHaveLength(0);
    }

    expect(
      remapRecords.find((record) => record.tested_source_product_id === "236"),
    ).toMatchObject({
      food_id: "fdc:705844",
      supplement_id: "",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "86"),
    ).toMatchObject({
      food_id: "",
      supplement_id: "emergen-c:1000-mg-vitamin-c-super-orange",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "87"),
    ).toMatchObject({
      food_id: "",
      supplement_id: "liquid-iv:strawberry-hydration-multiplier",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "142"),
    ).toMatchObject({
      food_id: "rxbar:nut-butter-oat-protein-bar-blueberry-cashew-butter",
      supplement_id: "",
      match_method: "manual_confirmed",
    });
    const requestedSourceOnlyIds = [
      "8",
      "11",
      "64",
      "65",
      "135",
      "136",
      "143",
      "144",
      "206",
      "207",
      "209",
      "214",
      "336",
      "400",
      "401",
    ];
    for (const sourceOnlyId of requestedSourceOnlyIds) {
      expect(
        remapRecords.find((record) => record.tested_source_product_id === sourceOnlyId),
      ).toMatchObject({
        food_id: "",
        supplement_id: "",
        match_method: "source_only",
      });
    }
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "75"),
    ).toMatchObject({
      food_id: "",
      supplement_id: "40352",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "59"),
    ).toMatchObject({
      food_id: "fdc:2663955",
      supplement_id: "",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "78"),
    ).toMatchObject({
      food_id: "fdc:1086537",
      supplement_id: "",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "128"),
    ).toMatchObject({
      food_id: "",
      supplement_id: "262237",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "139"),
    ).toMatchObject({
      food_id: "fdc:1848079",
      supplement_id: "",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "149"),
    ).toMatchObject({
      food_id: "fdc:2677664",
      supplement_id: "",
      match_method: "manual_confirmed",
    });
    expect(
      remapRecords.find((record) => record.tested_source_product_id === "222"),
    ).toMatchObject({
      food_id: "fdc:1757907",
      supplement_id: "",
      match_method: "manual_confirmed",
    });
    expect(identities.has("142")).toBe(true);
  });

  it("keeps PlasticList brand-site label anchors import-ready", async () => {
    const foodRows = await readPlasticListBrandSiteFoodRows();
    const supplementRows = await readPlasticListBrandSiteSupplementRows();

    expect(foodRows).toHaveLength(5);
    expect(supplementRows).toHaveLength(2);
    expect(
      await readFile(
        new URL("../sql/foods/plasticlist-brand-site-foods.json", import.meta.url),
        "utf8",
      ),
    ).not.toMatch(/Brands May Vary|official_listing_missing_nutrition/u);

    const foodIds = new Set<string>();
    for (const row of foodRows) {
      expect(row.id).toMatch(/^[a-z][a-z0-9_-]*:\S+$/u);
      expect(row.dataOrigin).toBe("brand_site");
      expect(row.dataOriginId).toBe(row.id);
      expect(row.dataOriginPriority).toBe(5);
      expect(row.name).not.toHaveLength(0);
      expect(row.searchText).not.toHaveLength(0);
      expect(row.searchText.length).toBeLessThanOrEqual(6000);
      expect(row.fdcReleaseDate).toBe("2026-06-16");
      expect(row.dataOriginUrl).toMatch(/^https:\/\//u);
      expect(foodIds.has(row.id)).toBe(false);
      foodIds.add(row.id);
      expect(row.label.schemaVersion).toBe(1);
      expect(row.label.sourceFetchedAt).toBe("2026-06-16");
      expect(row.label.sourceUrl).toBe(row.dataOriginUrl);
      expect(row.label.ingredientRows.length).toBeGreaterThan(0);
      expect(row.label.servingSizes.length).toBeGreaterThan(0);
      expectNoPublicContactText(row, ["name", "brand", "searchText"]);
    }

    expect(foodIds).toEqual(new Set([
      "rxbar:nut-butter-oat-protein-bar-blueberry-cashew-butter",
      "trader-joes:099032",
      "whole-foods-market:organic-boneless-skinless-chicken-breast-b079vnn5m4",
      "whole-foods-market:organic-creamy-peanut-butter-unsweetened-unsalted-16-ounce-b074h5zhvz",
      "whole-foods-market:organic-spaghetti-16-ounce-b074h6g7gx",
    ]));

    const supplementIds = new Set<string>();
    for (const row of supplementRows) {
      expect(row.id).toMatch(/^[a-z][a-z0-9_-]*:\S+$/u);
      expect(row.dataOrigin).toBe("brand_site");
      expect(row.dataOriginId).toBe(row.id);
      expect(row.dataOriginUrl).toMatch(/^https:\/\//u);
      expect(row.source).toMatch(/^[a-z][a-z0-9_-]*$/u);
      expect(row.sourceId).not.toHaveLength(0);
      expect(row.label.schemaVersion).toBe(1);
      expect(row.label.sourceFetchedAt).toBe("2026-06-16");
      expect(row.label.sourceUrl).toBe(row.dataOriginUrl);
      expect(row.label.ingredientRows.length).toBeGreaterThan(0);
      expect(row.label.servingSizes.length).toBeGreaterThan(0);
      expect(row.label.needsManualReview).not.toBe(true);
      expect(supplementIds.has(row.id)).toBe(false);
      supplementIds.add(row.id);
      expectNoPublicContactText(row, ["name", "brand"]);
    }

    expect(supplementIds).toEqual(new Set([
      "emergen-c:1000-mg-vitamin-c-super-orange",
      "liquid-iv:strawberry-hydration-multiplier",
    ]));
  });

  it("imports PlasticList brand-site food anchors through the prepared-food path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-plasticlist-food-anchors-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempFoodDir = path.join(tempRepoRoot, "apps/web/sql/foods");
      const tempProductTestsDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempFoodDir, { recursive: true });
      await mkdir(tempProductTestsDir, { recursive: true });

      const sourceFoodDir = new URL("../sql/foods/", import.meta.url);
      const sourceProductTestsDir = new URL(
        "../sql/product-tests/",
        import.meta.url,
      );
      const scriptName = "import-plasticlist-brand-site-foods.sh";
      const tempScriptPath = path.join(tempFoodDir, scriptName);
      await writeFile(
        tempScriptPath,
        await readFile(new URL(scriptName, sourceFoodDir), "utf8"),
      );
      await chmod(tempScriptPath, 0o755);
      for (const file of [
        "schema.sql",
        "apply-prepared.sql",
        "plasticlist-brand-site-foods.json",
      ]) {
        await writeFile(
          path.join(tempFoodDir, file),
          await readFile(new URL(file, sourceFoodDir), "utf8"),
        );
      }
      const helperPath = path.join(tempProductTestsDir, "labels-db-psql.sh");
      await writeFile(
        helperPath,
        await readFile(new URL("labels-db-psql.sh", sourceProductTestsDir), "utf8"),
      );
      await chmod(helperPath, 0o755);

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      const preparedCsvLogPath = path.join(tempRoot, "prepared-foods.csv");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
          "if (process.env.MURPH_LABELS_DB_URL || process.env.PGPASSWORD) {",
          "  throw new Error('database credentials leaked into psql environment');",
          "}",
          "const argv = process.argv.slice(2).join(' ');",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${argv}\\n`);",
          "if (argv.includes('apply-prepared.sql')) {",
          "  const preparedCsv = process.env.FDC_PREPARED_CSV;",
          "  if (!preparedCsv || !existsSync(preparedCsv)) {",
          "    throw new Error('prepared foods CSV was not passed to psql');",
          "  }",
          "  appendFileSync(process.env.PREPARED_CSV_LOG, readFileSync(preparedCsv, 'utf8'));",
          "}",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          MURPH_LABELS_DB_URL:
            "postgres://example.invalid/labels?sslmode=verify-full&sslcert=system&sslrootcert=system",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
          PREPARED_CSV_LOG: preparedCsvLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("apps/web/sql/foods/schema.sql");
      expect(fakePsqlLog).toContain("apps/web/sql/foods/apply-prepared.sql");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");

      const preparedCsv = await readFile(preparedCsvLogPath, "utf8");
      const preparedRows = parseCsv(preparedCsv);
      expect(preparedRows[0]).toEqual([
        "id",
        "canonical_key",
        "data_origin",
        "data_origin_id",
        "data_origin_url",
        "data_origin_priority",
        "name",
        "brand",
        "upc",
        "off_market",
        "search_text",
        "label",
        "fdc_release_date",
      ]);
      expect(preparedRows).toHaveLength(
        (await readPlasticListBrandSiteFoodRows()).length + 1,
      );
      const preparedIds = new Set(csvRecords(preparedRows).map((row) => row.id ?? ""));
      expect(preparedIds.has("rxbar:nut-butter-oat-protein-bar-blueberry-cashew-butter")).toBe(true);
      expect(preparedIds.has("trader-joes:099032")).toBe(true);
      expect(preparedIds.has("whole-foods-market:organic-broccoli-b000p6l3k0")).toBe(false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses the labels DB URL from .env.local for supplement brand-site imports", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-supplement-db-env-"));
    try {
      await writeFile(
        path.join(tempRoot, ".env.local"),
        [
          "MURPH_LABELS_DB_URL=postgres://labels:secret@example.invalid/labels",
          "MURPH_SUPPLEMENT_DB_URL=postgres://supplements:secret@example.invalid/supplements",
          "",
        ].join("\n"),
      );
      const helperModuleUrl = new URL(
        "../../../.agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs",
        import.meta.url,
      ).href;
      const env = { ...process.env };
      delete env.MURPH_LABELS_DB_URL;
      delete env.MURPH_SUPPLEMENT_DB_URL;
      await execFileAsync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          [
            "const helperUrl = process.argv.at(-1);",
            "const { getDbUrl } = await import(helperUrl);",
            "if (!getDbUrl().endsWith('/labels')) {",
            "  throw new Error('expected labels DB URL');",
            "}",
          ].join("\n"),
          helperModuleUrl,
        ],
        {
          cwd: tempRoot,
          env,
        },
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps PlasticList contaminant keys canonicalized", async () => {
    const importScript = await readFile(
      new URL("../sql/product-tests/import-plasticlist.sh", import.meta.url),
      "utf8",
    );
    const mappings = parsePlasticListContaminantMappings(importScript);
    const comparableSourceKeys = {
      bbp: "butyl_benzyl_phthalate_bbp",
      bpa: "bisphenol_a_bpa",
      dbp: "di_n_butyl_phthalate_dbp",
      deha: "di_2_ethylhexyl_adipate",
      dehp: "di_2_ethylhexyl_phthalate_dehp",
      didp: "di_isodecyl_phthalate_didp",
      dinp: "diisononyl_phthalate_dinp",
      dnhp: "di_n_hexyl_phthalate_dnhp",
    };

    expect(mappings).toMatchObject(comparableSourceKeys);
  });

  it("applies label and contaminant schemas without requiring sample data", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-product-tests-schema-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "if (process.env.MURPH_LABELS_DB_URL || process.env.PGPASSWORD) {",
          "  throw new Error('database credentials leaked into psql environment');",
          "}",
          "if (process.env.PGHOSTADDR || process.env.PGSSLCRL || process.env.PGSSLCERT === 'system' || process.env.PGSSLROOTCERT === 'system') {",
          "  throw new Error('inherited libpq environment leaked into psql environment');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, ["--schema-only"], {
        env: {
          ...process.env,
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels?sslmode=verify-full&sslcert=system&sslrootcert=system",
          PGHOSTADDR: "192.0.2.10",
          PGSSLCRL: "/tmp/old-crl.pem",
          PGSSLCERT: "system",
          PGSSLROOTCERT: "system",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("foods/schema.sql");
      expect(fakePsqlLog).toContain("supplements/schema.sql");
      expect(fakePsqlLog).toContain("product-tests/schema.sql");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");
      expect(fakePsqlLog).not.toContain("postgresql://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports an explicit local threshold CSV through the secret-safe psql path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-thresholds-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempThresholdDir = path.join(
        tempRepoRoot,
        ".product-tests-work/seed-data/thresholds",
      );
      await mkdir(tempScriptDir, { recursive: true });
      await mkdir(tempThresholdDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-thresholds.sh",
      );
      await writeFile(
        path.join(tempScriptDir, "import-thresholds.sql"),
        await readFile(
          new URL("../sql/product-tests/import-thresholds.sql", import.meta.url),
          "utf8",
        ),
      );
      await writeFile(
        path.join(tempThresholdDir, "local_thresholds.csv"),
        [
          "id,contaminant_key,authority_key,authority_name,threshold_name,threshold_url,threshold_value,threshold_unit,threshold_basis,concern_level_if_exceeded,effective_on,active",
          "local_lead,lead,test_authority,Test Authority,Lead local threshold,,1,ppm,product_mass,high,,true",
          "",
        ].join("\n"),
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "if (process.env.MURPH_LABELS_DB_URL || process.env.PGPASSWORD) {",
          "  throw new Error('database credentials leaked into psql environment');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          CONTAMINANT_THRESHOLDS_CSV_PATH:
            ".product-tests-work/seed-data/thresholds/local_thresholds.csv",
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("foods/schema.sql");
      expect(fakePsqlLog).toContain("supplements/schema.sql");
      expect(fakePsqlLog).toContain("product-tests/schema.sql");
      expect(fakePsqlLog).toContain("import-thresholds.sql");
      expect(
        fakePsqlLog
          .split("\n")
          .filter((line) => line.includes("import-thresholds.sql")),
      ).toHaveLength(1);
      expect(fakePsqlLog).toContain("-f .product-tests-work/thresholds/run.");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");

      const workDir = await readOnlyThresholdRunDir(tempRepoRoot);
      const preparedCsv = await readFile(
        path.join(workDir, "contaminant-thresholds.csv"),
        "utf8",
      );
      const preparedRows = parseCsv(preparedCsv);
      expect(preparedRows).toHaveLength(2);
      const renderedSql = await readFile(
        path.join(workDir, "import-thresholds.sql"),
        "utf8",
      );
      expect(renderedSql).toContain(
        "\\copy contaminant_thresholds_import FROM '.product-tests-work/thresholds/run.",
      );
      expect(renderedSql).not.toContain("__THRESHOLDS_CSV__");
      expect(renderedSql).not.toContain(tempRoot);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports a one-row threshold CSV without a trailing newline", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-threshold-no-newline-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempThresholdDir = path.join(tempScriptDir, "thresholds");
      await mkdir(tempThresholdDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-thresholds.sh",
      );
      await writeFile(
        path.join(tempScriptDir, "import-thresholds.sql"),
        await readFile(
          new URL("../sql/product-tests/import-thresholds.sql", import.meta.url),
          "utf8",
        ),
      );
      await writeFile(
        path.join(tempThresholdDir, "custom_thresholds.csv"),
        [
          "id,contaminant_key,authority_key,authority_name,threshold_name,threshold_url,threshold_value,threshold_unit,threshold_basis,concern_level_if_exceeded,effective_on,active",
          "custom_lead,lead,test_authority,Test Authority,Lead test threshold,,1,ppm,product_mass,high,,true",
        ].join("\n"),
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          CONTAMINANT_THRESHOLDS_CSV_PATH:
            "apps/web/sql/product-tests/thresholds/custom_thresholds.csv",
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog).toContain("import-thresholds.sql");
      expect(fakePsqlLog).not.toContain("postgres://");

      const workDir = await readOnlyThresholdRunDir(tempRepoRoot);
      const preparedCsv = await readFile(
        path.join(workDir, "contaminant-thresholds.csv"),
        "utf8",
      );
      expect(preparedCsv.endsWith("\n")).toBe(true);
      expect(parseCsv(preparedCsv)).toHaveLength(2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports exact-product threshold applications through the secret-safe psql path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-threshold-applications-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempApplicationsDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests/threshold-applications",
      );
      await mkdir(tempScriptDir, { recursive: true });
      await mkdir(tempApplicationsDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-threshold-applications.sh",
      );
      await writeFile(
        path.join(tempApplicationsDir, "reviewed.tsv"),
        [
          "threshold_id\tfood_id\tsupplement_id\treview_note",
          "local_lead\tfdc:123\t\tManual exact product threshold application.",
          "",
        ].join("\n"),
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "if (process.env.MURPH_LABELS_DB_URL || process.env.PGPASSWORD) {",
          "  throw new Error('database credentials leaked into psql environment');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH:
            "apps/web/sql/product-tests/threshold-applications/reviewed.tsv",
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("foods/schema.sql");
      expect(fakePsqlLog).toContain("supplements/schema.sql");
      expect(fakePsqlLog).toContain("product-tests/schema.sql");
      expect(fakePsqlLog).toContain("import-threshold-applications.sql");
      expect(fakePsqlLog).toContain("-f .product-tests-work/threshold-applications/run.");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");

      const workDir = await readOnlyThresholdApplicationRunDir(tempRepoRoot);
      const preparedTsv = await readFile(
        path.join(workDir, "product-threshold-applications.tsv"),
        "utf8",
      );
      expect(parseTsv(preparedTsv)).toEqual([
        {
          threshold_id: "local_lead",
          food_id: "fdc:123",
          supplement_id: "",
          review_note: "Manual exact product threshold application.",
        },
      ]);
      const renderedSql = await readFile(
        path.join(workDir, "import-threshold-applications.sql"),
        "utf8",
      );
      expect(renderedSql).toContain(
        "\\copy product_threshold_applications_import FROM '.product-tests-work/threshold-applications/run.",
      );
      expect(renderedSql).not.toContain("__THRESHOLD_APPLICATIONS_TSV__");
      expect(renderedSql).not.toContain(tempRoot);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("allows an explicit header-only threshold application replacement to clear reviewed rows", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-threshold-applications-empty-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempApplicationsDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests/threshold-applications",
      );
      await mkdir(tempScriptDir, { recursive: true });
      await mkdir(tempApplicationsDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-threshold-applications.sh",
      );
      await writeFile(
        path.join(tempApplicationsDir, "reviewed.tsv"),
        "threshold_id\tfood_id\tsupplement_id\treview_note\n",
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "if (process.env.MURPH_LABELS_DB_URL || process.env.PGPASSWORD) {",
          "  throw new Error('database credentials leaked into psql environment');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, ["--replace-applications"], {
        env: {
          ...process.env,
          PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS: "0",
          PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH:
            "apps/web/sql/product-tests/threshold-applications/reviewed.tsv",
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog).toContain("import-threshold-applications.sql");
      expect(fakePsqlLog).not.toContain("postgres://");

      const workDir = await readOnlyThresholdApplicationRunDir(tempRepoRoot);
      const preparedTsv = await readFile(
        path.join(workDir, "product-threshold-applications.tsv"),
        "utf8",
      );
      expect(parseTsv(preparedTsv)).toEqual([]);
      const renderedSql = await readFile(
        path.join(workDir, "import-threshold-applications.sql"),
        "utf8",
      );
      expect(renderedSql).toContain("DELETE FROM product_contaminant_threshold_applications");
      expect(fakePsqlLog).toContain("-v replace_applications=true");
      expect(renderedSql).not.toContain("product threshold application import prepared zero rows");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses header-only threshold application imports without replacement mode", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-threshold-applications-refuse-empty-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempApplicationsDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests/threshold-applications",
      );
      await mkdir(tempScriptDir, { recursive: true });
      await mkdir(tempApplicationsDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-threshold-applications.sh",
      );
      await writeFile(
        path.join(tempApplicationsDir, "reviewed.tsv"),
        "threshold_id\tfood_id\tsupplement_id\treview_note\n",
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
          "throw new Error('psql should not run for zero-row threshold application imports');",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      let stderr = "";
      try {
        await execFileAsync(tempScriptPath, {
          env: {
            ...process.env,
            PRODUCT_THRESHOLD_APPLICATIONS_TSV_PATH:
              "apps/web/sql/product-tests/threshold-applications/reviewed.tsv",
            MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
            PSQL_BIN: fakePsqlPath,
            PSQL_FAKE_LOG: fakePsqlLogPath,
          },
        });
      } catch (error) {
        stderr = error instanceof Error && "stderr" in error
          ? String(error.stderr)
          : String(error);
      }

      expect(stderr).toContain("Product threshold applications import prepared zero rows");
      expect(stderr).toContain("refusing to run no-op import");
      expect(stderr).toContain("--replace-applications");
      expect(stderr).toContain("PRODUCT_THRESHOLD_APPLICATIONS_REPLACE_EXPECTED_ROWS=0");
      expect(stderr).not.toContain("postgres://");
      await expect(readFile(fakePsqlLogPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports open product source CSVs through the secret-safe psql path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-open-product-sources-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempOpenDataDir = path.join(
        tempRepoRoot,
        ".product-tests-work/seed-data/open-product-sources",
      );
      await mkdir(tempScriptDir, { recursive: true });
      await mkdir(tempOpenDataDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-open-product-sources.sh",
      );
      await writeFile(
        path.join(tempScriptDir, "import-open-product-sources.sql"),
        await readFile(
          new URL(
            "../sql/product-tests/import-open-product-sources.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await writeFile(
        path.join(tempOpenDataDir, "open_product_sources_product_tests.csv"),
        [
          "id,food_id,supplement_id,source_key,source_result_id,source_name,source_url,source_report_title,report_date,tested_product_name,tested_product_brand,tested_product_upc,tested_source_product_id,match_method,contaminant_key,contaminant_name,result_operator,result_value,result_unit,result_basis,normalized_value,normalized_unit,normalized_basis,lab_name,test_method",
          "nyc_dohmh_consumer_products:example:lead,,,nyc_dohmh_consumer_products,example,NYC Department of Health and Mental Hygiene,https://data.cityofnewyork.us/Health/Metal-Content-of-Consumer-Products-Tested-by-the-N/da9u-wz3r,Metal Content of Consumer Products Tested by the NYC Health Department,2024-01-01,Example Food,,,example,source_only,lead,Lead,eq,1,ppm,product_mass,1,ppm,product_mass,,Laboratory",
          "",
        ].join("\n"),
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "if (process.env.MURPH_LABELS_DB_URL || process.env.PGPASSWORD) {",
          "  throw new Error('database credentials leaked into psql environment');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH:
            ".product-tests-work/seed-data/open-product-sources/open_product_sources_product_tests.csv",
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("foods/schema.sql");
      expect(fakePsqlLog).toContain("supplements/schema.sql");
      expect(fakePsqlLog).toContain("product-tests/schema.sql");
      expect(fakePsqlLog).toContain("import-open-product-sources.sql");
      expect(fakePsqlLog).toContain("-f .product-tests-work/open-product-sources/run.");
      expect(fakePsqlLog).toContain("-v replace_source=false");
      expect(fakePsqlLog).toContain("-v replace_source_expected_product_test_rows=");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("guards open product source replace-source repair with an expected complete row count", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-open-product-sources-replace-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempOpenDataDir = path.join(
        tempRepoRoot,
        ".product-tests-work/seed-data/open-product-sources",
      );
      await mkdir(tempScriptDir, { recursive: true });
      await mkdir(tempOpenDataDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-open-product-sources.sh",
      );
      await writeFile(
        path.join(tempOpenDataDir, "open_product_sources_product_tests.csv"),
        [
          "id,food_id,supplement_id,source_key,source_result_id,source_name,source_url,source_report_title,report_date,tested_product_name,tested_product_brand,tested_product_upc,tested_source_product_id,match_method,contaminant_key,contaminant_name,result_operator,result_value,result_unit,result_basis,normalized_value,normalized_unit,normalized_basis,lab_name,test_method",
          "nyc_dohmh_consumer_products:example:lead,,,nyc_dohmh_consumer_products,example,NYC Department of Health and Mental Hygiene,https://data.cityofnewyork.us/Health/Metal-Content-of-Consumer-Products-Tested-by-the-N/da9u-wz3r,Metal Content of Consumer Products Tested by the NYC Health Department,2024-01-01,Example Food,,,example,source_only,lead,Lead,eq,1,ppm,product_mass,1,ppm,product_mass,,Laboratory",
          "",
        ].join("\n"),
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      const runReplaceImport = async (
        expectedRows: string | undefined,
      ): Promise<string> => {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH:
            ".product-tests-work/seed-data/open-product-sources/open_product_sources_product_tests.csv",
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        };
        if (expectedRows !== undefined) {
          env.OPEN_PRODUCT_SOURCES_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS = expectedRows;
        }

        try {
          await execFileAsync(tempScriptPath, ["--replace-source"], {
            env,
          });
          return "";
        } catch (error) {
          return error instanceof Error && "stderr" in error
            ? String(error.stderr)
            : String(error);
        }
      };

      const missingExpectedRowsStderr = await runReplaceImport(undefined);
      expect(missingExpectedRowsStderr).toContain(
        "OPEN_PRODUCT_SOURCES_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS is required with --replace-source",
      );
      expect(missingExpectedRowsStderr).not.toContain("postgres://");
      await expect(readFile(fakePsqlLogPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      const mismatchedExpectedRowsStderr = await runReplaceImport("2");
      expect(mismatchedExpectedRowsStderr).toContain(
        "Open product sources --replace-source expected 2 product test rows but found 1; refusing destructive import.",
      );
      expect(mismatchedExpectedRowsStderr).not.toContain("postgres://");
      await expect(readFile(fakePsqlLogPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      await expect(runReplaceImport("1")).resolves.toBe("");
      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog).toContain("-v replace_source=true");
      expect(fakePsqlLog).toContain("-v replace_source_expected_product_test_rows=1");
      expect(fakePsqlLog).not.toContain("postgres://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects absolute threshold CSV paths before psql argv exposure", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-threshold-path-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-thresholds.sh",
      );
      const absoluteCsvPath = path.join(tempRoot, "external-thresholds.csv");
      await writeFile(
        absoluteCsvPath,
        [
          "id,contaminant_key,authority_key,authority_name,threshold_name,threshold_url,threshold_value,threshold_unit,threshold_basis,concern_level_if_exceeded,effective_on,active",
          "example,bpa,fda,U.S. Food and Drug Administration,Example BPA,,1,ng/g,product_mass,high,,true",
          "",
        ].join("\n"),
      );

      let stderr = "";
      try {
        await execFileAsync(tempScriptPath, {
          env: {
            ...process.env,
            CONTAMINANT_THRESHOLDS_CSV_PATH: absoluteCsvPath,
            MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
            PSQL_BIN: process.execPath,
          },
        });
      } catch (error) {
        stderr = error instanceof Error && "stderr" in error
          ? String(error.stderr)
          : String(error);
      }

      expect(stderr).toContain("CONTAMINANT_THRESHOLDS_CSV_PATH must be repo-relative");
      expect(stderr).not.toContain(tempRoot);
      expect(stderr).not.toContain("postgres://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports a local threshold CSV through the legacy supplement-only path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-threshold-legacy-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempThresholdDir = path.join(tempScriptDir, "thresholds");
      await mkdir(tempThresholdDir, { recursive: true });
      const sourceScriptDir = new URL("../sql/product-tests/", import.meta.url);
      const tempScriptPath = await copyProductTestImportScript(
        tempScriptDir,
        "import-thresholds.sh",
      );
      await writeFile(
        path.join(tempScriptDir, "import-thresholds.sql"),
        await readFile(new URL("import-thresholds.sql", sourceScriptDir), "utf8"),
      );
      await writeFile(
        path.join(tempScriptDir, "legacy-supplement-foods-stub.sql"),
        await readFile(
          new URL("legacy-supplement-foods-stub.sql", sourceScriptDir),
          "utf8",
        ),
      );
      const thresholdPath = path.join(tempThresholdDir, "example.csv");
      await writeFile(
        thresholdPath,
        [
          "id,contaminant_key,authority_key,authority_name,threshold_name,threshold_url,threshold_value,threshold_unit,threshold_basis,concern_level_if_exceeded,effective_on,active",
          "example,bisphenol_a_bpa,fda,U.S. Food and Drug Administration,Example BPA,,1,ng/g,product_mass,high,,true",
          "",
        ].join("\n"),
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "const argv = process.argv.slice(2).join(' ');",
          "if (argv.includes('/foods/schema.sql') || argv.includes('/supplements/schema.sql')) {",
          "  throw new Error('legacy threshold import must not apply search schemas');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${argv}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(tempScriptPath, ["--legacy-supplement-db"], {
        env: {
          ...process.env,
          CONTAMINANT_THRESHOLDS_CSV_PATH:
            "apps/web/sql/product-tests/thresholds/example.csv",
          MURPH_LABELS_DB_URL: "postgres://example.invalid/supplements",
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog).toContain("legacy-supplement-foods-stub.sql");
      expect(fakePsqlLog).toContain("product-tests/schema.sql");
      expect(fakePsqlLog).toContain("import-thresholds.sql");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("foods/schema.sql");
      expect(fakePsqlLog).not.toContain("supplements/schema.sql");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("prepares legacy supplement-only databases without food search extensions", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-product-tests-legacy-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });

      const sourceScriptDir = new URL("../sql/product-tests/", import.meta.url);
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);
      await writeFile(
        path.join(tempScriptDir, "legacy-supplement-foods-stub.sql"),
        await readFile(
          new URL("legacy-supplement-foods-stub.sql", sourceScriptDir),
          "utf8",
        ),
      );

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "const argv = process.argv.slice(2).join(' ');",
          "if (argv.includes('/foods/schema.sql') || argv.includes('/supplements/schema.sql')) {",
          "  throw new Error('legacy supplement schema-only must not apply search schemas');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${argv}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      await execFileAsync(
        tempScriptPath,
        ["--schema-only", "--legacy-supplement-db"],
        {
          env: {
            ...process.env,
            MURPH_LABELS_DB_URL: "postgres://example.invalid/supplements",
            PSQL_BIN: fakePsqlPath,
            PSQL_FAKE_LOG: fakePsqlLogPath,
          },
        },
      );

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("legacy-supplement-foods-stub.sql");
      expect(fakePsqlLog).toContain("product-tests/schema.sql");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("foods/schema.sql");
      expect(fakePsqlLog).not.toContain("supplements/schema.sql");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed labels database URLs without printing the URL", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-product-tests-bad-url-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);

      let stderr = "";
      try {
        await execFileAsync(tempScriptPath, ["--schema-only"], {
          env: {
            ...process.env,
            MURPH_LABELS_DB_URL: "postgres://user:super-secret@[broken/labels",
            PSQL_BIN: process.execPath,
          },
        });
      } catch (error) {
        stderr = error instanceof Error && "stderr" in error
          ? String(error.stderr)
          : String(error);
      }

      expect(stderr).toContain("labels database URL is invalid");
      expect(stderr).not.toContain("super-secret");
      expect(stderr).not.toContain("postgres://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("transforms PlasticList rows into source-only product tests", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-plasticlist-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "if (process.env.MURPH_LABELS_DB_URL || process.env.PGPASSWORD) {",
          "  throw new Error('database credentials leaked into psql environment');",
          "}",
          "if (process.env.PGHOSTADDR || process.env.PGSSLCRL || process.env.PGSSLCERT === 'system' || process.env.PGSSLROOTCERT === 'system') {",
          "  throw new Error('inherited libpq environment leaked into psql environment');",
          "}",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      const samplesPath = path.join(tempRoot, "samples.tsv");
      await writeFile(samplesPath, withBomAndCrlf(buildPlasticListSamplesTsv()));

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels?sslmode=verify-full&sslcert=system&sslrootcert=system",
          PGHOSTADDR: "192.0.2.10",
          PGSSLCRL: "/tmp/old-crl.pem",
          PGSSLCERT: "system",
          PGSSLROOTCERT: "system",
          PLASTICLIST_SAMPLES_TSV_PATH: samplesPath,
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const workDir = await readOnlyPlasticListRunDir(tempRepoRoot);
      const productTestRows = parseTsv(
        await readFile(
          path.join(workDir, "plasticlist-product-tests.tsv"),
          "utf8",
        ),
      );

      expect(productTestRows).toEqual([
        expect.objectContaining({
          id: "plasticlist_bay_area_2024:sample-default:di_2_ethylhexyl_phthalate_dehp:ng_g",
          food_id: "",
          supplement_id: "",
          source_result_id: "sample-default",
          tested_source_product_id: "product-default",
          match_method: "source_only",
          contaminant_key: "di_2_ethylhexyl_phthalate_dehp",
          result_operator: "gt",
          result_value: "12",
          normalized_value: "0.012",
          normalized_unit: "ppm",
          test_method: "phthalate-method",
        }),
        expect.objectContaining({
          id: "plasticlist_bay_area_2024:sample-mapped:bisphenol_a_bpa:ng_g",
          food_id: "",
          supplement_id: "",
          source_result_id: "sample-mapped",
          tested_source_product_id: "product-mapped",
          match_method: "source_only",
          contaminant_key: "bisphenol_a_bpa",
          result_operator: "eq",
          result_value: "8",
          normalized_value: "0.008",
          normalized_unit: "ppm",
          test_method: "bisphenol-method",
        }),
      ]);

      const renderedSql = await readFile(
        path.join(workDir, "import-plasticlist.sql"),
        "utf8",
      );
      expect(renderedSql).toContain(
        "\\copy source_only_product_tests_import FROM '.plasticlist-work/product-tests/run.",
      );
      expect(renderedSql).not.toContain("__FOODS_TSV__");
      expect(renderedSql).not.toContain("__PRODUCT_TESTS_TSV__");
      expect(renderedSql).not.toContain(tempRoot);

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("schema.sql");
      expect(fakePsqlLog).toContain("-v replace_source=false");
      expect(fakePsqlLog).toContain("-f .plasticlist-work/product-tests/run.");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");
      expect(fakePsqlLog).not.toContain("postgresql://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses zero-row PlasticList imports before database writes", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-plasticlist-empty-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "throw new Error('psql should not run for zero-row imports');",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      const samplesPath = path.join(tempRoot, "samples.tsv");
      await writeFile(samplesPath, `${buildPlasticListSamplesTsv().split("\n")[0]}\n`);

      let stderr = "";
      try {
        await execFileAsync(tempScriptPath, {
          env: {
            ...process.env,
            MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
            PLASTICLIST_SAMPLES_TSV_PATH: samplesPath,
            PSQL_BIN: fakePsqlPath,
          },
        });
      } catch (error) {
        stderr = error instanceof Error && "stderr" in error
          ? String(error.stderr)
          : String(error);
      }

      expect(stderr).toContain("prepared zero product test rows");
      expect(stderr).not.toContain("postgres://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("guards PlasticList replace-source pruning with an expected complete row count", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-plasticlist-replace-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      const samplesPath = path.join(tempRoot, "samples.tsv");
      await writeFile(samplesPath, buildPlasticListSamplesTsv());

      const runReplaceImport = async (
        expectedRows: string | undefined,
      ): Promise<string> => {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PLASTICLIST_SAMPLES_TSV_PATH: samplesPath,
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        };
        if (expectedRows !== undefined) {
          env.PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS = expectedRows;
        }

        try {
          await execFileAsync(tempScriptPath, ["--replace-source"], {
            env,
          });
          return "";
        } catch (error) {
          return error instanceof Error && "stderr" in error
            ? String(error.stderr)
            : String(error);
        }
      };

      const missingExpectedRowsStderr = await runReplaceImport(undefined);
      expect(missingExpectedRowsStderr).toContain(
        "PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS is required with --replace-source",
      );
      expect(missingExpectedRowsStderr).not.toContain("postgres://");
      await expect(readFile(fakePsqlLogPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      const mismatchedExpectedRowsStderr = await runReplaceImport("1");
      expect(mismatchedExpectedRowsStderr).toContain(
        "PlasticList --replace-source expected 1 product test rows but prepared 2; refusing destructive import.",
      );
      expect(mismatchedExpectedRowsStderr).not.toContain("postgres://");
      await expect(readFile(fakePsqlLogPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      await expect(runReplaceImport("2")).resolves.toBe("");
      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog).toContain("-v replace_source=true");
      expect(fakePsqlLog).toContain("-v replace_source_expected_product_test_rows=2");
      expect(fakePsqlLog).not.toContain("postgres://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy direct PlasticList product match env", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-plasticlist-match-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "throw new Error('psql should not run for legacy PlasticList matches');",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      const samplesPath = path.join(tempRoot, "samples.tsv");
      const matchesPath = path.join(tempRoot, "matches.tsv");
      await writeFile(samplesPath, buildPlasticListSamplesTsv());
      await writeFile(
        matchesPath,
        [
          "plasticlist_sample_id\tfood_id\tsupplement_id\tmatch_method",
          "missing-sample\tfdc:known-product\t\tmanual_confirmed",
          "",
        ].join("\n"),
      );

      let stderr = "";
      try {
        await execFileAsync(tempScriptPath, {
          env: {
            ...process.env,
            MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
            PLASTICLIST_PRODUCT_MATCHES_TSV_PATH: matchesPath,
            PLASTICLIST_SAMPLES_TSV_PATH: samplesPath,
            PSQL_BIN: fakePsqlPath,
          },
        });
      } catch (error) {
        stderr = error instanceof Error && "stderr" in error
          ? String(error.stderr)
          : String(error);
      }

      expect(stderr).toContain("PLASTICLIST_PRODUCT_MATCHES_TSV_PATH is no longer supported");
      expect(stderr).toContain("import-product-test-remaps.sh");
      expect(stderr).not.toContain("postgres://");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CSV-escapes quoted source fields in prepared PlasticList TSVs", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-plasticlist-quotes-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      await mkdir(tempScriptDir, { recursive: true });
      const tempScriptPath = await copyProductTestImportScript(tempScriptDir);

      const fakePsqlPath = path.join(tempRoot, "fake-psql.mjs");
      const fakePsqlLogPath = path.join(tempRoot, "psql.log");
      await writeFile(
        fakePsqlPath,
        [
          "#!/usr/bin/env node",
          "import { appendFileSync } from 'node:fs';",
          "appendFileSync(process.env.PSQL_FAKE_LOG, `${process.argv.slice(2).join(' ')}\\n`);",
        ].join("\n"),
      );
      await chmod(fakePsqlPath, 0o755);

      const samplesPath = path.join(tempRoot, "samples.tsv");
      await writeFile(samplesPath, buildQuotedPlasticListSamplesTsv());

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels",
          PLASTICLIST_SAMPLES_TSV_PATH: samplesPath,
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const workDir = await readOnlyPlasticListRunDir(tempRepoRoot);
      const productTestsTsv = await readFile(
        path.join(workDir, "plasticlist-product-tests.tsv"),
        "utf8",
      );

      expect(productTestsTsv).toContain('"Quote ""Drink"""');
      expect(productTestsTsv).toContain('"Phthalate ""Method"""');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function buildPlasticListSamplesTsv(): string {
  const headers = [
    "id",
    "product_id",
    "product",
    "tags",
    "analysis_method_phthalates",
    "analysis_method_bisphenols",
    "DEHP_equivalents_ng_g",
    "DEHP_ng_g",
    "DBP_ng_g",
    "BBP_ng_g",
    "DINP_ng_g",
    "DIDP_ng_g",
    "DEP_ng_g",
    "DMP_ng_g",
    "DIBP_ng_g",
    "DNHP_ng_g",
    "DCHP_ng_g",
    "DNOP_ng_g",
    "BPA_ng_g",
    "BPS_ng_g",
    "BPF_ng_g",
    "DEHT_ng_g",
    "DEHA_ng_g",
    "DINCH_ng_g",
    "DIDA_ng_g",
  ];

  return [
    headers.join("\t"),
    buildPlasticListSampleRow(headers, {
      id: "sample-default",
      product_id: "product-default",
      product: "Default Yogurt",
      tags: "dairy",
      analysis_method_phthalates: "phthalate-method",
      analysis_method_bisphenols: "bisphenol-method",
      DEHP_ng_g: ">12",
    }),
    buildPlasticListSampleRow(headers, {
      id: "sample-mapped",
      product_id: "product-mapped",
      product: "Known Supplement",
      tags: "supplement",
      analysis_method_phthalates: "phthalate-method",
      analysis_method_bisphenols: "bisphenol-method",
      BPA_ng_g: "8",
    }),
    "",
  ].join("\n");
}

function buildQuotedPlasticListSamplesTsv(): string {
  const headers = [
    "id",
    "product_id",
    "product",
    "tags",
    "analysis_method_phthalates",
    "analysis_method_bisphenols",
    "DEHP_equivalents_ng_g",
    "DEHP_ng_g",
    "DBP_ng_g",
    "BBP_ng_g",
    "DINP_ng_g",
    "DIDP_ng_g",
    "DEP_ng_g",
    "DMP_ng_g",
    "DIBP_ng_g",
    "DNHP_ng_g",
    "DCHP_ng_g",
    "DNOP_ng_g",
    "BPA_ng_g",
    "BPS_ng_g",
    "BPF_ng_g",
    "DEHT_ng_g",
    "DEHA_ng_g",
    "DINCH_ng_g",
    "DIDA_ng_g",
  ];

  return [
    headers.join("\t"),
    buildPlasticListSampleRow(headers, {
      id: "sample-quoted",
      product_id: "product-quoted",
      product: 'Quote "Drink"',
      tags: "beverage",
      analysis_method_phthalates: 'Phthalate "Method"',
      analysis_method_bisphenols: "bisphenol-method",
      DEHP_ng_g: "12",
    }),
    "",
  ].join("\n");
}

function buildPlasticListSampleRow(
  headers: string[],
  values: Record<string, string>,
): string {
  return headers.map((header) => values[header] ?? "").join("\t");
}

function withBomAndCrlf(text: string): string {
  return `\uFEFF${text.replace(/\n/g, "\r\n")}`;
}

async function copyProductTestImportScript(
  tempScriptDir: string,
  scriptName = "import-plasticlist.sh",
): Promise<string> {
  const sourceScriptDir = new URL("../sql/product-tests/", import.meta.url);
  const tempScriptPath = path.join(tempScriptDir, scriptName);
  await writeFile(
    tempScriptPath,
    await readFile(new URL(scriptName, sourceScriptDir), "utf8"),
  );
  await chmod(tempScriptPath, 0o755);
  const helperPath = path.join(tempScriptDir, "labels-db-psql.sh");
  await writeFile(
    helperPath,
    await readFile(new URL("labels-db-psql.sh", sourceScriptDir), "utf8"),
  );
  await chmod(helperPath, 0o755);
  const sourceSqlName = scriptName.replace(/\.sh$/u, ".sql");
  await writeFile(
    path.join(tempScriptDir, sourceSqlName),
    await readFile(new URL(sourceSqlName, sourceScriptDir), "utf8"),
  );
  return tempScriptPath;
}

async function readOnlyPlasticListRunDir(repoRoot: string): Promise<string> {
  const workDir = path.join(repoRoot, ".plasticlist-work/product-tests");
  const runDirs = (await readdir(workDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run."))
    .map((entry) => entry.name);

  expect(runDirs).toHaveLength(1);
  return path.join(workDir, runDirs[0] ?? "");
}

async function readOnlyThresholdRunDir(repoRoot: string): Promise<string> {
  const workDir = path.join(repoRoot, ".product-tests-work/thresholds");
  const runDirs = (await readdir(workDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run."))
    .map((entry) => entry.name);

  expect(runDirs).toHaveLength(1);
  return path.join(workDir, runDirs[0] ?? "");
}

async function readOnlyThresholdApplicationRunDir(repoRoot: string): Promise<string> {
  const workDir = path.join(repoRoot, ".product-tests-work/threshold-applications");
  const runDirs = (await readdir(workDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run."))
    .map((entry) => entry.name);

  expect(runDirs).toHaveLength(1);
  return path.join(workDir, runDirs[0] ?? "");
}

function parseTsv(text: string): Array<Record<string, string>> {
  const [headerLine, ...lines] = text.trimEnd().split("\n");
  const headers = headerLine?.split("\t") ?? [];

  return lines.filter(Boolean).map((line) => {
    const fields = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => [header, fields[index] ?? ""]),
    );
  });
}

function quotedTsvRow(fields: readonly string[]): string {
  return fields
    .map((field) => `"${field.replace(/"/gu, "\"\"")}"`)
    .join("\t");
}

function parsePlasticListContaminantMappings(script: string): Record<string, string> {
  return Object.fromEntries(
    [...script.matchAll(/add_contaminant\("([^"]+)", "([^"]+)"/gu)]
      .map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

type PlasticListBrandSiteFoodRow = {
  id: string;
  canonicalKey: string;
  dataOrigin: string;
  dataOriginId: string;
  dataOriginUrl: string;
  dataOriginPriority: number;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
  searchText: string;
  fdcReleaseDate: string;
  label: BrandSiteLabelForTest;
};

type PlasticListBrandSiteSupplementRow = {
  id: string;
  dataOrigin: string;
  dataOriginId: string;
  dataOriginUrl: string;
  source: string;
  sourceId: string;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
  label: BrandSiteLabelForTest;
};

type BrandSiteLabelForTest = {
  schemaVersion: number;
  sourceFetchedAt: string;
  sourceUrl: string;
  ingredientRows: unknown[];
  servingSizes: unknown[];
  needsManualReview?: boolean;
};

async function readPlasticListBrandSiteFoodRows(): Promise<PlasticListBrandSiteFoodRow[]> {
  const records = await readJsonRecordArray(
    new URL("../sql/foods/plasticlist-brand-site-foods.json", import.meta.url),
    "plasticlist-brand-site-foods.json",
  );

  return records.map((record, index) => {
    const context = `plasticlist-brand-site-foods.json row ${index + 1}`;
    return {
      id: requiredString(record, "id", context),
      canonicalKey: requiredString(record, "canonicalKey", context),
      dataOrigin: requiredString(record, "dataOrigin", context),
      dataOriginId: requiredString(record, "dataOriginId", context),
      dataOriginUrl: requiredString(record, "dataOriginUrl", context),
      dataOriginPriority: requiredNumber(record, "dataOriginPriority", context),
      name: requiredString(record, "name", context),
      brand: nullableString(record, "brand", context),
      upc: nullableString(record, "upc", context),
      offMarket: requiredBoolean(record, "offMarket", context),
      searchText: requiredString(record, "searchText", context),
      fdcReleaseDate: requiredString(record, "fdcReleaseDate", context),
      label: brandSiteLabel(record.label, `${context} label`),
    };
  });
}

async function readPlasticListBrandSiteSupplementRows(): Promise<PlasticListBrandSiteSupplementRow[]> {
  const records = await readJsonRecordArray(
    new URL(
      "../sql/supplements/plasticlist-brand-site-supplements.json",
      import.meta.url,
    ),
    "plasticlist-brand-site-supplements.json",
  );

  return records.map((record, index) => {
    const context = `plasticlist-brand-site-supplements.json row ${index + 1}`;
    return {
      id: requiredString(record, "id", context),
      dataOrigin: requiredString(record, "dataOrigin", context),
      dataOriginId: requiredString(record, "dataOriginId", context),
      dataOriginUrl: requiredString(record, "dataOriginUrl", context),
      source: requiredString(record, "source", context),
      sourceId: requiredString(record, "sourceId", context),
      name: requiredString(record, "name", context),
      brand: nullableString(record, "brand", context),
      upc: nullableString(record, "upc", context),
      offMarket: requiredBoolean(record, "offMarket", context),
      label: brandSiteLabel(record.label, `${context} label`),
    };
  });
}

async function readJsonRecordArray(
  url: URL,
  context: string,
): Promise<Array<Record<string, unknown>>> {
  const parsed: unknown = JSON.parse(await readFile(url, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`${context} must be an array`);
  }
  return parsed.map((value, index) =>
    jsonRecord(value, `${context} row ${index + 1}`),
  );
}

function brandSiteLabel(value: unknown, context: string): BrandSiteLabelForTest {
  const label = jsonRecord(value, context);
  const needsManualReview = optionalBoolean(label, "needsManualReview", context);
  return {
    schemaVersion: requiredNumber(label, "schemaVersion", context),
    sourceFetchedAt: requiredString(label, "sourceFetchedAt", context),
    sourceUrl: requiredString(label, "sourceUrl", context),
    ingredientRows: requiredArray(label, "ingredientRows", context),
    servingSizes: requiredArray(label, "servingSizes", context),
    ...(needsManualReview === undefined ? {} : { needsManualReview }),
  };
}

function jsonRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string`);
  }
  return value;
}

function nullableString(
  record: Record<string, unknown>,
  field: string,
  context: string,
): string | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string or null`);
  }
  return value;
}

function requiredNumber(
  record: Record<string, unknown>,
  field: string,
  context: string,
): number {
  const value = record[field];
  if (typeof value !== "number") {
    throw new Error(`${context}.${field} must be a number`);
  }
  return value;
}

function requiredBoolean(
  record: Record<string, unknown>,
  field: string,
  context: string,
): boolean {
  const value = record[field];
  if (typeof value !== "boolean") {
    throw new Error(`${context}.${field} must be a boolean`);
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  field: string,
  context: string,
): boolean | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${context}.${field} must be a boolean when present`);
  }
  return value;
}

function requiredArray(
  record: Record<string, unknown>,
  field: string,
  context: string,
): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${field} must be an array`);
  }
  return value;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }

  return rows.filter((parsedRow) =>
    parsedRow.some((value) => value.length > 0),
  );
}

function csvRecords(rows: string[][]): Array<Record<string, string>> {
  const [headers = [], ...dataRows] = rows;
  return dataRows.map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? ""]),
    ),
  );
}

function expectNoPublicContactText(
  record: Record<string, unknown>,
  columns: string[],
): void {
  for (const column of columns) {
    const value = String(record[column] ?? "");
    expect(value).not.toMatch(PUBLIC_CONTACT_EMAIL_PATTERN);
    expect(value).not.toMatch(PUBLIC_CONTACT_PHONE_PATTERN);
  }
}
