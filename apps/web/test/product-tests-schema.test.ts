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
  it("keeps contaminant observations exact-linked", async () => {
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
    expect(schemaSql).not.toContain("'source_only'");
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
    const importScript = await readFile(
      new URL("../sql/product-tests/import-plasticlist.sh", import.meta.url),
      "utf8",
    );
    const importThresholdsScript = await readFile(
      new URL("../sql/product-tests/import-thresholds.sh", import.meta.url),
      "utf8",
    );
    const importOpenProductSourcesScript = await readFile(
      new URL(
        "../sql/product-tests/import-open-product-sources.sh",
        import.meta.url,
      ),
      "utf8",
    );
    const importThresholdsSql = await readFile(
      new URL("../sql/product-tests/import-thresholds.sql", import.meta.url),
      "utf8",
    );
    const importOpenProductSourcesSql = await readFile(
      new URL(
        "../sql/product-tests/import-open-product-sources.sql",
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
    const productLabelsLib = await readFile(
      new URL("../src/lib/product-labels.ts", import.meta.url),
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

    expect(readme).toContain("PlasticList data is licensed under CC BY 4.0");
    expect(readme).toContain("Data on Plastic Chemicals in Bay Area Foods");
    expect(readme).toContain("links each result to that row");
    expect(readme).toContain("generic food text search");
    expect(readme).toContain("Fully remapped PlasticList products do not create");
    expect(readme).toContain("import-plasticlist.sh --schema-only");
    expect(readme).toContain("--legacy-supplement-db");
    expect(readme).toContain("legacy `MURPH_SUPPLEMENT_DB_URL` fallback");
    expect(readme).toContain("separate curated `contaminant_thresholds` rows");
    expect(readme).toContain("import-thresholds.sh");
    expect(readme).toContain("Single-file/custom imports are additive by default");
    expect(readme).toContain("California OEHHA Proposition 65 NSRL/MADL rows: 355 rows");
    expect(readme).toContain("U.S. federal rows excluding California: 406 rows");
    expect(readme).toContain("European Commission Regulation (EU) 2023/915 rows: 529 rows");
    expect(readme).toContain("Open Product Source Seeds");
    expect(readme).toContain("8,157 source-backed product rows");
    expect(readme).toContain("NYC DOHMH consumer-product metals open data: 6,230 rows");
    expect(readme).toContain("King County consumer-product lead open data: 277 rows");
    expect(readme).toContain("Pure Earth RMS Zenodo dataset: 1,650 rows");
    expect(readme).toContain("import-open-product-sources.sh");
    expect(readme).toContain("sync-open-product-sources.ts");
    expect(readme).toContain("CC BY 4.0 Zenodo dataset");
    expect(readme).toContain("Recall feeds such as openFDA and FSIS");
    expect(readme).toContain("source distributions match the pinned import set");
    expect(readme).toContain("guarded by pinned seed and authority counts");
    expect(readme).toContain("PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS");
    expect(readme).toContain("`threshold_basis` preserves the source/regulatory scope");
    expect(readme).toContain("normalized comparison triplet");
    expect(readme).toContain("canonical `ppm` values");
    expect(readme).toContain("rows are left as `mg/kg-dry`");
    expect(readme).toContain("They compare only to explicitly dry-weight `mg/kg-dry` threshold rows");
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
    expect(importScript).toContain("exact_source_id");
    expect(importScript).toContain("apps/web/sql/foods/schema.sql");
    expect(importScript).toContain("apps/web/sql/supplements/schema.sql");
    expect(importScript).toContain("-v foods_tsv=");
    expect(importScript).toContain("labels-db-psql.sh");
    expect(labelsDbPsqlHelper).toContain("MURPH_LABELS_DB_URL is required");
    expect(labelsDbPsqlHelper).toContain("PGPASSFILE");
    expect(labelsDbPsqlHelper).toContain("systemRootCertPath");
    expect(labelsDbPsqlHelper).toContain('key === "sslrootcert" && value === "system"');
    expect(labelsDbPsqlHelper).toContain("env[envName] = rootCertPath");
    expect(labelsDbPsqlHelper).toContain("unset MURPH_LABELS_DB_URL labels_db_url");
    expect(labelsDbPsqlHelper).toContain("\"$labels_db_psql_bin\" -X \"$@\"");
    expect(importScript).toContain("run_labels_psql -v ON_ERROR_STOP=1");
    expect(importScript).toContain("-v replace_source=\"$replace_source\"");
    expect(importScript).toContain("-v replace_source_expected_product_test_rows=\"$replace_source_expected_rows\"");
    expect(importScript).toContain("mktemp -d \"$work_dir/run.XXXXXX\"");
    expect(importScript).toContain("replace-source.lock");
    expect(importScript).toMatch(
      /LC_ALL=C\s+PLASTICLIST_PREPARED_FOODS_TSV="\$prepared_foods_tsv\.tmp"\s+awk -F '\\t'/u,
    );
    expect(importScript).toContain("clean_header(value)");
    expect(importScript).toContain("explicit_match");
    expect(importScript).toContain("csv_field(value)");
    expect(importScript).toContain("PlasticList match row references unknown sample");
    expect(importScript).toContain("prepared zero product test rows");
    expect(importScript).toContain("add_contaminant(\"bpa\", \"bisphenol_a_bpa\"");
    expect(importScript).toContain("add_contaminant(\"dehp\", \"di_2_ethylhexyl_phthalate_dehp\"");
    expect(importScript).toContain("ng_g_to_ppm");
    expect(importScript).toContain("normalized_unit = \"ppm\"");
    expect(importScript).not.toContain("echo \"$labels_db_url\"");
    expect(importSql).toContain("BEGIN;");
    expect(importSql).toContain("COMMIT;");
    expect(importSql).toContain("\\copy plasticlist_foods_import FROM :foods_tsv");
    expect(importSql).toContain(
      "\\copy plasticlist_product_tests_import FROM :product_tests_tsv",
    );
    expect(importSql).not.toContain("FROM :'foods_tsv'");
    expect(importSql).not.toContain("FROM :'product_tests_tsv'");
    expect(importSql).toContain(":'replace_source' = 'true'");
    expect(importSql).toContain(":'replace_source_expected_product_test_rows'");
    expect(importSql).toContain("PlasticList replace-source product test row count mismatch");
    expect(importSql).toContain("explicit_match BOOLEAN NOT NULL");
    expect(importSql).toContain("ELSE product_tests.food_id");
    expect(importSql).toContain("ELSE product_tests.supplement_id");
    expect(importSql).toContain("ELSE product_tests.match_method");
    expect(importSql).toContain("PlasticList food identity mismatch");
    expect(importSql).toContain("pg_advisory_xact_lock");
    expect(importSql).toContain("murph:plasticlist_bay_area_2024:import");
    expect(importSql).toContain("WHEN :'replace_source' = 'true' OR");
    expect(importSql).toContain("product_tests.match_method = 'exact_source_id'");
    expect(importSql).toContain("product_tests.food_id LIKE 'plasticlist_bay_area_2024:%'");
    expect(importSql).not.toContain("canonical_key = EXCLUDED.canonical_key");
    expect(importSql).toContain("DELETE FROM product_tests");
    expect(importSql).toContain("source_key = 'plasticlist_bay_area_2024'");
    expect(importSql).toContain("DELETE FROM foods");
    expect(importSql).toMatch(/DELETE FROM foods[\s\S]*product_tests\.food_id = foods\.id/u);
    expect(importSql).not.toMatch(/DELETE FROM foods[\s\S]*plasticlist_foods_import current_import/u);
    expect(importThresholdsScript).toContain("CONTAMINANT_THRESHOLDS_CSV_PATH");
    expect(importThresholdsScript).toContain("must be repo-relative");
    expect(importThresholdsScript).toContain("replace_missing_authority_thresholds=true");
    expect(importThresholdsScript).toContain("replace_missing_authority_thresholds=false");
    expect(importThresholdsScript).toContain("-v replace_missing_authority_thresholds=\"$replace_missing_authority_thresholds\"");
    expect(importThresholdsScript).toContain("NR > 1");
    expect(importThresholdsScript).toContain("print count + 0 > count_file");
    expect(importThresholdsScript).not.toContain("wc -l < \"$thresholds_csv\"");
    expect(importThresholdsScript).not.toContain("tail -n +2 \"$thresholds_csv\"");
    expect(importThresholdsScript).toContain("labels-db-psql.sh");
    expect(importThresholdsScript).toContain("--legacy-supplement-db");
    expect(importThresholdsScript).toContain("legacy-supplement-foods-stub.sql");
    expect(importThresholdsScript).toContain("apps/web/sql/product-tests/thresholds/");
    expect(importThresholdsScript).toContain("import-thresholds.sql");
    expect(importOpenProductSourcesScript).not.toContain("OPEN_PRODUCT_SOURCES_PRODUCTS_CSV_PATH");
    expect(importOpenProductSourcesScript).not.toContain("OPEN_PRODUCT_SOURCES_PRODUCT_TESTS_CSV_PATH");
    expect(importOpenProductSourcesScript).toContain("labels-db-psql.sh");
    expect(importOpenProductSourcesScript).toContain("apps/web/sql/foods/schema.sql");
    expect(importOpenProductSourcesScript).toContain("apps/web/sql/supplements/schema.sql");
    expect(importOpenProductSourcesScript).toContain("import-open-product-sources.sql");
    expect(importOpenProductSourcesScript).toContain("open_product_sources_products.csv");
    expect(importOpenProductSourcesScript).toContain("open_product_sources_product_tests.csv");
    expect(importOpenProductSourcesScript).toContain("-v products_csv=");
    expect(importOpenProductSourcesScript).toContain("-v product_tests_csv=");
    expect(importOpenProductSourcesScript).not.toContain("echo \"$labels_db_url\"");
    expect(importThresholdsSql).toContain("CREATE TEMP TABLE contaminant_thresholds_import");
    expect(importThresholdsSql).toContain("CREATE TEMP TABLE contaminant_thresholds_import_options");
    expect(importThresholdsSql).toContain("pg_advisory_xact_lock");
    expect(importThresholdsSql).toContain("murph:contaminant_thresholds:import");
    expect(importThresholdsSql).toContain(
      "\\copy contaminant_thresholds_import FROM :thresholds_csv",
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
    expect(importThresholdsSql).toContain("replace_missing_authority_thresholds FROM import_options");
    expect(importThresholdsSql).toContain("duplicate active normalized contaminant thresholds after import");
    expect(importThresholdsSql).toContain("resolve before importing comparable thresholds");
    expect(importThresholdsSql).toContain("contaminant threshold complete seed count mismatch");
    expect(importThresholdsSql).toContain("authority_key = 'ca_oehha_prop65') <> 355");
    expect(importThresholdsSql).toContain("authority_key = 'eu_commission') <> 529");
    expect(importThresholdsSql).toContain("authority_key = 'fda') <> 303");
    expect(importThresholdsSql).toContain("authority_key = 'fda_cfr') <> 103");
    expect(importThresholdsSql).toContain("UPDATE contaminant_thresholds");
    expect(importThresholdsSql).toContain(":'replace_missing_authority_thresholds' = 'true'");
    expect(importThresholdsSql).toContain("SELECT DISTINCT authority_key");
    expect(importThresholdsSql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(importOpenProductSourcesSql).toContain("CREATE TEMP TABLE open_product_sources_products_import");
    expect(importOpenProductSourcesSql).toContain("CREATE TEMP TABLE open_product_sources_product_tests_import");
    expect(importOpenProductSourcesSql).toContain(
      "\\copy open_product_sources_products_import FROM :products_csv",
    );
    expect(importOpenProductSourcesSql).toContain(
      "\\copy open_product_sources_product_tests_import FROM :product_tests_csv",
    );
    expect(importOpenProductSourcesSql).not.toContain("FROM :'products_csv'");
    expect(importOpenProductSourcesSql).not.toContain("FROM :'product_tests_csv'");
    expect(importOpenProductSourcesSql).toContain("pg_advisory_xact_lock");
    expect(importOpenProductSourcesSql).toContain("murph:open_product_sources:import");
    expect(importOpenProductSourcesSql).toContain("open product source test row must link to exactly one product");
    expect(importOpenProductSourcesSql).toContain("open product source test row must use exact_source_id");
    expect(importOpenProductSourcesSql).toContain("open product source test row references a missing or mismatched source-backed product");
    expect(importOpenProductSourcesSql).toContain("open product source product row is not linked to a product test");
    expect(importOpenProductSourcesSql).toContain("open product source product seed count mismatch");
    expect(importOpenProductSourcesSql).toContain("open product source product test seed count mismatch");
    expect(importOpenProductSourcesSql).toContain("data_origin = 'nyc_dohmh_consumer_products') <> 6230");
    expect(importOpenProductSourcesSql).toContain("data_origin = 'king_county_consumer_products') <> 277");
    expect(importOpenProductSourcesSql).toContain("data_origin = 'pure_earth_rms_2024') <> 1650");
    expect(importOpenProductSourcesSql).toContain("source_key = 'nyc_dohmh_consumer_products') <> 6230");
    expect(importOpenProductSourcesSql).toContain("source_key = 'king_county_consumer_products') <> 277");
    expect(importOpenProductSourcesSql).toContain("source_key = 'pure_earth_rms_2024') <> 1650");
    expect(importOpenProductSourcesSql).toContain("DELETE FROM product_tests");
    expect(importOpenProductSourcesSql).toContain("DELETE FROM foods");
    expect(importOpenProductSourcesSql).toContain("DELETE FROM supplements");
    expect(importOpenProductSourcesSql).toContain("SELECT DISTINCT source_key");
    expect(importOpenProductSourcesSql).toContain("SELECT DISTINCT data_origin");
    expect(importOpenProductSourcesSql).toContain("INSERT INTO foods");
    expect(importOpenProductSourcesSql).toContain("INSERT INTO supplements");
    expect(importOpenProductSourcesSql).toContain("INSERT INTO product_tests");
    expect(importOpenProductSourcesSql).toContain("ON CONFLICT (source_key, source_result_id, contaminant_key)");
    expect(importOpenProductSourcesSql).toContain("ELSE product_tests.food_id");
    expect(importOpenProductSourcesSql).toContain("ELSE product_tests.supplement_id");
    expect(importOpenProductSourcesSql).toContain("ELSE product_tests.match_method");
    expect(importOpenProductSourcesSql).toContain("FROM foods current_food");
    expect(importOpenProductSourcesSql).toContain("FROM supplements current_supplement");
    expect(importOpenProductSourcesSql).toContain("current_food.data_origin = product_tests.source_key");
    expect(importOpenProductSourcesSql).toContain("current_supplement.data_origin = product_tests.source_key");
    expect(importOpenProductSourcesSql).toContain("current_food.data_origin_id = product_tests.tested_source_product_id");
    expect(importOpenProductSourcesSql).toContain("current_supplement.data_origin_id = product_tests.tested_source_product_id");
    expect(importOpenProductSourcesSql).toContain("open product source exact_source_id link did not converge to imported product");
    expect(importOpenProductSourcesSql).toContain("tests.food_id IS NOT DISTINCT FROM NULLIF(current_import.food_id, '')");
    expect(importOpenProductSourcesSql).toContain("tests.supplement_id IS NOT DISTINCT FROM NULLIF(current_import.supplement_id, '')");
    expect(syncOpenProductSources).toContain("nyc_dohmh_consumer_products");
    expect(syncOpenProductSources).toContain("king_county_consumer_products");
    expect(syncOpenProductSources).toContain("pure_earth_rms_2024");
    expect(syncOpenProductSources).toContain("data.cityofnewyork.us/resource/da9u-wz3r.json");
    expect(syncOpenProductSources).toContain("data.kingcounty.gov/resource/i6sy-ckp7.json");
    expect(syncOpenProductSources).toContain("zenodo.org/records/10444602");
    expect(syncOpenProductSources).toContain("Dietary Supplement/Medications/Remedy");
    expect(syncOpenProductSources).toContain("const foodCategories = new Set([\"1\", \"7\", \"10\", \"11\"])");
    expect(syncOpenProductSources).toContain("const rowNumber = attrs.match(/\\br=\"(\\d+)\"/u)?.[1]");
    expect(syncOpenProductSources).toContain("entries.push([\"__row_number\", row.rowNumber || String(rowIndex + 2)])");
    expect(syncOpenProductSources).toContain("normalizedResultForUnit");
    expect(syncOpenProductSources).toContain("Number(value) / 1000");
    expect(syncOpenProductSources).not.toContain("Consumer Reports");
    expect(syncOpenProductSources).not.toContain("DetectLead");
    const sourceBackedContaminantOrigins = new Set([
      "plasticlist_bay_area_2024",
      ...[...syncOpenProductSources.matchAll(/key: "([^"]+)"/gu)]
        .map((match) => match[1] ?? ""),
    ]);
    expect(sourceBackedContaminantOrigins).toEqual(new Set([
      "plasticlist_bay_area_2024",
      "nyc_dohmh_consumer_products",
      "king_county_consumer_products",
      "pure_earth_rms_2024",
    ]));
    for (const sourceKey of sourceBackedContaminantOrigins) {
      expect(productLabelsLib).toContain(`"${sourceKey}"`);
    }
    expect(legacyFoodsStubSql).toContain("canonical_key TEXT NOT NULL");
    expect(legacyFoodsStubSql).toContain("UNIQUE (data_origin, data_origin_id)");
    expect(legacyFoodsStubSql).not.toContain("CREATE EXTENSION");
    expect(legacyFoodsStubSql).not.toContain("foods_search_idx");
  });

  it("keeps threshold seed CSVs import-ready", async () => {
    const thresholdsDir = new URL(
      "../sql/product-tests/thresholds/",
      import.meta.url,
    );
    const expectedFiles = new Map([
      ["california_prop65_contaminant_thresholds.csv", 355],
      ["eu_contaminant_thresholds.csv", 529],
      ["us_federal_contaminant_thresholds_excluding_california.csv", 406],
    ]);
    const expectedHeader = [
      "id",
      "contaminant_key",
      "authority_key",
      "authority_name",
      "threshold_name",
      "threshold_url",
      "threshold_value",
      "threshold_unit",
      "threshold_basis",
      "concern_level_if_exceeded",
      "effective_on",
      "active",
    ];

    const files = (await readdir(thresholdsDir)).sort();
    expect(files).toEqual([...expectedFiles.keys()].sort());

    const ids = new Set<string>();
    const activeComparableKeys = new Set<string>();
    const thresholdKeys = new Set<string>();
    let productMassScopedSeedCount = 0;
    let scopedPpbSeed: Record<string, string> | null = null;

    for (const file of files) {
      const rows = parseCsv(
        await readFile(new URL(file, thresholdsDir), "utf8"),
      );
      const [header, ...dataRows] = rows;
      const expectedRowCount = expectedFiles.get(file);
      if (expectedRowCount === undefined) {
        throw new Error(`Unexpected threshold seed file: ${file}`);
      }
      expect(header).toEqual(expectedHeader);
      expect(dataRows).toHaveLength(expectedRowCount);

      for (const row of dataRows) {
        const record = Object.fromEntries(
          expectedHeader.map((column, index) => [column, row[index] ?? ""]),
        );
        expect(record.id).toMatch(/^[a-z0-9_:.-]+$/u);
        expect(record.contaminant_key).toMatch(/^[a-z0-9][a-z0-9_]*$/u);
        thresholdKeys.add(record.contaminant_key);
        expect(record.authority_key).toMatch(/^[a-z][a-z0-9_]*$/u);
        expect(record.threshold_name).not.toHaveLength(0);
        expect(Number(record.threshold_value)).toBeGreaterThan(0);
        expect(record.threshold_unit).not.toHaveLength(0);
        expect(record.threshold_basis).not.toHaveLength(0);
        if (record.threshold_basis === "product_mass") {
          productMassScopedSeedCount += 1;
        }
        if (
          record.id
            === "us_fda_cctt_dimethylnitrosamine_nitrosodimethylamine_barley_malt_10_ppb_cpg_578_500_378034e9b1"
        ) {
          scopedPpbSeed = record;
        }
        expect(["low", "medium", "high"]).toContain(
          record.concern_level_if_exceeded,
        );
        expect(["true", "false"]).toContain(record.active);
        expect(ids.has(record.id)).toBe(false);
        ids.add(record.id);

        if (file === "california_prop65_contaminant_thresholds.csv") {
          expect(record.threshold_basis).toMatch(/^ca_prop65_(nsrl|madl):/u);
        }

        if (record.active === "true") {
          const comparableKey = [
            record.contaminant_key,
            record.threshold_unit,
            record.threshold_basis,
          ].join("\t");
          expect(activeComparableKeys.has(comparableKey)).toBe(false);
          activeComparableKeys.add(comparableKey);
        }
      }
    }

    expect(ids.size).toBe(1290);
    expect(productMassScopedSeedCount).toBe(0);
    expect(scopedPpbSeed).toMatchObject({
      contaminant_key: "dimethylnitrosamine_ndma",
      threshold_unit: "ppb",
      threshold_basis: "commodity_barley_malt",
    });
    expect(thresholdKeys.has("di_2_ethylhexyl_phthalate_dehp")).toBe(true);
    expect(thresholdKeys.has("di_2_ethylhexyl_phthalate")).toBe(false);
  });

  it("keeps open product source CSVs import-ready and exact-linked", async () => {
    const productsCsvRows = parseCsv(
      await readFile(
        new URL(
          "../sql/product-tests/open-data/open_product_sources_products.csv",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const productTestsCsvRows = parseCsv(
      await readFile(
        new URL(
          "../sql/product-tests/open-data/open_product_sources_product_tests.csv",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const productHeaders = [
      "product_table",
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
      "label_json",
      "fdc_release_date",
    ];
    const productTestHeaders = [
      "id",
      "food_id",
      "supplement_id",
      "source_key",
      "source_result_id",
      "source_name",
      "source_url",
      "source_report_title",
      "report_date",
      "tested_product_name",
      "tested_product_brand",
      "tested_product_upc",
      "tested_source_product_id",
      "match_method",
      "contaminant_key",
      "contaminant_name",
      "result_operator",
      "result_value",
      "result_unit",
      "result_basis",
      "normalized_value",
      "normalized_unit",
      "normalized_basis",
      "lab_name",
      "test_method",
    ];

    expect(productsCsvRows[0]).toEqual(productHeaders);
    expect(productTestsCsvRows[0]).toEqual(productTestHeaders);

    const productRecords = csvRecords(productsCsvRows);
    const productTestRecords = csvRecords(productTestsCsvRows);
    expect(productRecords).toHaveLength(8157);
    expect(productTestRecords).toHaveLength(8157);
    expect(countRecords(productRecords, "data_origin")).toEqual({
      king_county_consumer_products: 277,
      nyc_dohmh_consumer_products: 6230,
      pure_earth_rms_2024: 1650,
    });
    expect(countRecords(productRecords, "product_table")).toEqual({
      foods: 6319,
      supplements: 1838,
    });
    expect(countRecords(productTestRecords, "source_key")).toEqual({
      king_county_consumer_products: 277,
      nyc_dohmh_consumer_products: 6230,
      pure_earth_rms_2024: 1650,
    });
    expect(countRecords(productTestRecords, "contaminant_key")).toEqual({
      arsenic: 444,
      cadmium: 189,
      chromium: 25,
      lead: 7052,
      mercury: 447,
    });
    expect(countRecords(productTestRecords, "match_method")).toEqual({
      exact_source_id: 8157,
    });

    const productIds = new Set<string>();
    const targetIds = new Set<string>();
    const productSourceTypes = {
      king_county_consumer_products: new Set([
        "Candy",
        "Dietary Supplement/Medications",
        "Food",
        "Seasoning",
      ]),
      nyc_dohmh_consumer_products: new Set([
        "Dietary Supplement/Medications/Remedy",
        "Food Other",
        "Food-Candy",
        "Food-Spice",
      ]),
      pure_earth_rms_2024: new Set([
        "Main starch",
        "Other food",
        "Spices",
        "Sweets",
      ]),
    };

    for (const record of productRecords) {
      expect(["foods", "supplements"]).toContain(record.product_table);
      expect(record.id).not.toHaveLength(0);
      expect(record.canonical_key).toBe(record.id);
      expect(record.data_origin_id).not.toHaveLength(0);
      expect(record.data_origin_url).toMatch(/^https:\/\//u);
      expect(record.data_origin_priority).toBe("95");
      expect(record.name).not.toHaveLength(0);
      expect(record.off_market).toBe("false");
      expect(record.search_text).not.toHaveLength(0);
      expect(record.fdc_release_date).toBe("2024-01-01");
      expectNoPublicContactText(record, [
        "name",
        "brand",
        "search_text",
        "label_json",
      ]);
      expect(productIds.has(record.id)).toBe(false);
      productIds.add(record.id);

      const label: unknown = JSON.parse(record.label_json);
      expect(isJsonRecord(label)).toBe(true);
      const sourceProductType = String(
        (label as Record<string, unknown>).sourceProductType ?? "",
      );
      expect(
        productSourceTypes[
          record.data_origin as keyof typeof productSourceTypes
        ]?.has(sourceProductType),
      ).toBe(true);
    }

    const testIds = new Set<string>();
    const naturalKeys = new Set<string>();
    const productsById = new Map(
      productRecords.map((record) => [record.id, record]),
    );
    const targetCounts = new Map<string, number>();
    for (const record of productTestRecords) {
      expect(testIds.has(record.id)).toBe(false);
      testIds.add(record.id);
      const naturalKey = [
        record.source_key,
        record.source_result_id,
        record.contaminant_key,
      ].join("\t");
      expect(naturalKeys.has(naturalKey)).toBe(false);
      naturalKeys.add(naturalKey);

      const linkCount = (record.food_id ? 1 : 0) + (record.supplement_id ? 1 : 0);
      expect(linkCount).toBe(1);
      const targetId = record.food_id || record.supplement_id;
      expect(productIds.has(targetId)).toBe(true);
      targetIds.add(targetId);
      targetCounts.set(targetId, (targetCounts.get(targetId) ?? 0) + 1);
      const targetProduct = productsById.get(targetId);
      if (targetProduct === undefined) {
        throw new Error(`Missing product row for product test target: ${targetId}`);
      }
      expect(targetProduct.product_table).toBe(
        record.food_id ? "foods" : "supplements",
      );
      expect(record.source_key).toBe(targetProduct.data_origin);
      expect(record.tested_source_product_id).toBe(targetProduct.data_origin_id);

      expect(record.source_name).not.toHaveLength(0);
      expect(record.source_url).toMatch(/^https:\/\//u);
      expect(record.source_report_title).not.toHaveLength(0);
      expectNoPublicContactText(record, [
        "tested_product_name",
        "tested_product_brand",
      ]);
      if (record.report_date) {
        expect(record.report_date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      }
      expect(record.tested_source_product_id).not.toHaveLength(0);
      expect(record.contaminant_key).toMatch(/^[a-z0-9][a-z0-9_]*$/u);
      expect(record.contaminant_name).not.toHaveLength(0);
      expect(["eq", "lt", "not_detected"]).toContain(record.result_operator);
      if (record.result_operator === "not_detected") {
        expect(record.result_value).toBe("");
      } else {
        expect(Number(record.result_value)).toBeGreaterThanOrEqual(0);
      }
      expect(record.result_unit).not.toHaveLength(0);
      expect(["as_reported", "product_mass"]).toContain(record.result_basis);

      const normalizedFieldCount = [
        record.normalized_value,
        record.normalized_unit,
        record.normalized_basis,
      ].filter(Boolean).length;
      expect([0, 3]).toContain(normalizedFieldCount);
      if (record.result_operator === "eq") {
        expect(normalizedFieldCount).toBe(3);
      }
      if (record.normalized_basis === "product_mass") {
        expect(["ppm", "mg/kg-dry"]).toContain(record.normalized_unit);
        if (["ppb", "ug/kg", "ng/g"].includes(record.result_unit)) {
          expect(record.normalized_unit).toBe("ppm");
          expect(Number(record.normalized_value)).toBeCloseTo(
            Number(record.result_value) / 1000,
            12,
          );
        }
      }

      if (record.source_key === "pure_earth_rms_2024") {
        expect(record.food_id).toMatch(/^pure_earth_rms_2024:/u);
        expect(record.supplement_id).toBe("");
        expect(record.test_method).toBe("XRF screening");
      }
    }

    expect(targetIds.size).toBe(productIds.size);
    for (const productId of productIds) {
      expect(targetIds.has(productId)).toBe(true);
      expect(targetCounts.get(productId)).toBe(1);
    }
  });

  it("keeps PlasticList contaminant keys aligned with threshold taxonomy", async () => {
    const importScript = await readFile(
      new URL("../sql/product-tests/import-plasticlist.sh", import.meta.url),
      "utf8",
    );
    const mappings = parsePlasticListContaminantMappings(importScript);
    const thresholdKeys = await readThresholdContaminantKeys();
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
    for (const canonicalKey of Object.values(comparableSourceKeys)) {
      expect(thresholdKeys.has(canonicalKey)).toBe(true);
    }
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

  it("imports threshold seed CSVs through the secret-safe psql path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-thresholds-"));
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
      const committedThresholdFiles = [
        "california_prop65_contaminant_thresholds.csv",
        "eu_contaminant_thresholds.csv",
        "us_federal_contaminant_thresholds_excluding_california.csv",
      ];
      const sourceThresholdDir = new URL(
        "../sql/product-tests/thresholds/",
        import.meta.url,
      );
      for (const file of committedThresholdFiles) {
        await writeFile(
          path.join(tempThresholdDir, file),
          await readFile(new URL(file, sourceThresholdDir), "utf8"),
        );
      }

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
      expect(fakePsqlLog).toContain("-v thresholds_csv=.product-tests-work/thresholds/run.");
      expect(fakePsqlLog).toContain("-v replace_missing_authority_thresholds=true");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");

      const workDir = await readOnlyThresholdRunDir(tempRepoRoot);
      const preparedCsv = await readFile(
        path.join(workDir, "contaminant-thresholds.csv"),
        "utf8",
      );
      const preparedRows = parseCsv(preparedCsv);
      expect(preparedRows).toHaveLength(1291);
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
      expect(fakePsqlLog).toContain("-v replace_missing_authority_thresholds=false");
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

  it("imports open product source CSVs through the secret-safe psql path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-open-product-sources-"));
    try {
      const tempRepoRoot = path.join(tempRoot, "repo");
      const tempScriptDir = path.join(
        tempRepoRoot,
        "apps/web/sql/product-tests",
      );
      const tempOpenDataDir = path.join(tempScriptDir, "open-data");
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
        path.join(tempOpenDataDir, "open_product_sources_products.csv"),
        [
          "product_table,id,canonical_key,data_origin,data_origin_id,data_origin_url,data_origin_priority,name,brand,upc,off_market,search_text,label_json,fdc_release_date",
          "foods,nyc_dohmh_consumer_products:example,nyc_dohmh_consumer_products:example,nyc_dohmh_consumer_products,example,https://data.cityofnewyork.us/Health/Metal-Content-of-Consumer-Products-Tested-by-the-N/da9u-wz3r,95,Example Food,,,false,Example Food,{},2024-01-01",
          "",
        ].join("\n"),
      );
      await writeFile(
        path.join(tempOpenDataDir, "open_product_sources_product_tests.csv"),
        [
          "id,food_id,supplement_id,source_key,source_result_id,source_name,source_url,source_report_title,report_date,tested_product_name,tested_product_brand,tested_product_upc,tested_source_product_id,match_method,contaminant_key,contaminant_name,result_operator,result_value,result_unit,result_basis,normalized_value,normalized_unit,normalized_basis,lab_name,test_method",
          "nyc_dohmh_consumer_products:example:lead,nyc_dohmh_consumer_products:example,,nyc_dohmh_consumer_products,example,NYC Department of Health and Mental Hygiene,https://data.cityofnewyork.us/Health/Metal-Content-of-Consumer-Products-Tested-by-the-N/da9u-wz3r,Metal Content of Consumer Products Tested by the NYC Health Department,2024-01-01,Example Food,,,example,exact_source_id,lead,Lead,eq,1,ppm,product_mass,1,ppm,product_mass,,Laboratory",
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
      expect(fakePsqlLog).toContain("-v products_csv=apps/web/sql/product-tests/open-data/open_product_sources_products.csv");
      expect(fakePsqlLog).toContain("-v product_tests_csv=apps/web/sql/product-tests/open-data/open_product_sources_product_tests.csv");
      expect(fakePsqlLog).not.toContain(tempRoot);
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

  it("imports threshold seeds through the legacy supplement fallback path", async () => {
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
      expect(fakePsqlLog).toContain("-v replace_missing_authority_thresholds=false");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("foods/schema.sql");
      expect(fakePsqlLog).not.toContain("supplements/schema.sql");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("prepares legacy supplement fallback databases without food search extensions", async () => {
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

  it("transforms PlasticList rows into exact source links and curated remaps", async () => {
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
      const matchesPath = path.join(tempRoot, "matches.tsv");
      await writeFile(samplesPath, withBomAndCrlf(buildPlasticListSamplesTsv()));
      await writeFile(
        matchesPath,
        withBomAndCrlf([
          "plasticlist_sample_id\tfood_id\tsupplement_id\tmatch_method",
          "sample-mapped\t\tdsld:known-product\tmanual_confirmed",
          "",
        ].join("\n")),
      );

      await execFileAsync(tempScriptPath, {
        env: {
          ...process.env,
          MURPH_LABELS_DB_URL: "postgres://example.invalid/labels?sslmode=verify-full&sslcert=system&sslrootcert=system",
          PGHOSTADDR: "192.0.2.10",
          PGSSLCRL: "/tmp/old-crl.pem",
          PGSSLCERT: "system",
          PGSSLROOTCERT: "system",
          PLASTICLIST_PRODUCT_MATCHES_TSV_PATH: matchesPath,
          PLASTICLIST_SAMPLES_TSV_PATH: samplesPath,
          PSQL_BIN: fakePsqlPath,
          PSQL_FAKE_LOG: fakePsqlLogPath,
        },
      });

      const workDir = await readOnlyPlasticListRunDir(tempRepoRoot);
      const foodsRows = parseTsv(
        await readFile(path.join(workDir, "plasticlist-foods.tsv"), "utf8"),
      );
      const productTestRows = parseTsv(
        await readFile(
          path.join(workDir, "plasticlist-product-tests.tsv"),
          "utf8",
        ),
      );

      expect(foodsRows.map((row) => row.product_id)).toEqual([
        "product-default",
      ]);

      expect(productTestRows).toEqual([
        expect.objectContaining({
          id: "plasticlist_bay_area_2024:sample-default:di_2_ethylhexyl_phthalate_dehp:ng_g",
          food_id: "plasticlist_bay_area_2024:product-default",
          supplement_id: "",
          source_result_id: "sample-default",
          tested_source_product_id: "product-default",
          match_method: "exact_source_id",
          explicit_match: "false",
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
          supplement_id: "dsld:known-product",
          source_result_id: "sample-mapped",
          tested_source_product_id: "product-mapped",
          match_method: "manual_confirmed",
          explicit_match: "true",
          contaminant_key: "bisphenol_a_bpa",
          result_operator: "eq",
          result_value: "8",
          normalized_value: "0.008",
          normalized_unit: "ppm",
          test_method: "bisphenol-method",
        }),
      ]);

      const fakePsqlLog = await readFile(fakePsqlLogPath, "utf8");
      expect(fakePsqlLog.split("\n").filter(Boolean).every((line) => line.startsWith("-X "))).toBe(true);
      expect(fakePsqlLog).toContain("schema.sql");
      expect(fakePsqlLog).toContain("-v replace_source=false");
      expect(fakePsqlLog).toContain("-v foods_tsv=");
      expect(fakePsqlLog).toContain("-v product_tests_tsv=");
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

  it("rejects curated PlasticList remaps that do not match a sample", async () => {
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
          "throw new Error('psql should not run for stale curated matches');",
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

      expect(stderr).toContain("PlasticList match row references unknown sample missing-sample");
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
      const foodsTsv = await readFile(
        path.join(workDir, "plasticlist-foods.tsv"),
        "utf8",
      );
      const productTestsTsv = await readFile(
        path.join(workDir, "plasticlist-product-tests.tsv"),
        "utf8",
      );

      expect(foodsTsv).toContain('"Quote ""Drink"""');
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

function parsePlasticListContaminantMappings(script: string): Record<string, string> {
  return Object.fromEntries(
    [...script.matchAll(/add_contaminant\("([^"]+)", "([^"]+)"/gu)]
      .map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

async function readThresholdContaminantKeys(): Promise<Set<string>> {
  const thresholdsDir = new URL(
    "../sql/product-tests/thresholds/",
    import.meta.url,
  );
  const keys = new Set<string>();

  for (const file of await readdir(thresholdsDir)) {
    if (!file.endsWith(".csv")) {
      continue;
    }

    const [header, ...rows] = parseCsv(
      await readFile(new URL(file, thresholdsDir), "utf8"),
    );
    const contaminantKeyIndex = header?.indexOf("contaminant_key") ?? -1;
    expect(contaminantKeyIndex).toBeGreaterThanOrEqual(0);

    for (const row of rows) {
      keys.add(row[contaminantKeyIndex] ?? "");
    }
  }

  return keys;
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

function countRecords(
  records: Array<Record<string, string>>,
  column: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const value = record[column] ?? "";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function expectNoPublicContactText(
  record: Record<string, string>,
  columns: string[],
): void {
  for (const column of columns) {
    const value = record[column] ?? "";
    expect(value).not.toMatch(PUBLIC_CONTACT_EMAIL_PATTERN);
    expect(value).not.toMatch(PUBLIC_CONTACT_PHONE_PATTERN);
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
