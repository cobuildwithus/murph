import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("product test contaminant schema", () => {
  it("keeps contaminant observations exact-linked", async () => {
    const schemaSql = await readFile(
      new URL("../sql/product-tests/schema.sql", import.meta.url),
      "utf8",
    );

    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS product_tests");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS contaminant_thresholds");
    expect(schemaSql).toContain("UNIQUE (source_key, source_result_id, contaminant_key)");
    expect(schemaSql).toContain("CASE WHEN food_id IS NULL THEN 0 ELSE 1 END");
    expect(schemaSql).toContain("'exact_upc'");
    expect(schemaSql).toContain("'exact_source_id'");
    expect(schemaSql).toContain("'manual_confirmed'");
    expect(schemaSql).not.toContain("'source_only'");
    expect(schemaSql).toContain("product_tests_food_idx");
    expect(schemaSql).toContain("product_tests_supplement_idx");
    expect(schemaSql).toContain("contaminant_thresholds_active_comparable_idx");
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
    const importThresholdsSql = await readFile(
      new URL("../sql/product-tests/import-thresholds.sql", import.meta.url),
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
    expect(readme).toContain("California OEHHA Proposition 65 NSRL/MADL rows: 355 rows");
    expect(readme).toContain("U.S. federal rows excluding California: 406 rows");
    expect(readme).toContain("European Commission Regulation (EU) 2023/915 rows: 529 rows");
    expect(importScript).toContain("PLASTICLIST_SAMPLES_TSV_PATH is required");
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
    expect(labelsDbPsqlHelper).toContain("unset MURPH_LABELS_DB_URL labels_db_url");
    expect(labelsDbPsqlHelper).toContain("\"$labels_db_psql_bin\" -X \"$@\"");
    expect(importScript).toContain("run_labels_psql -v ON_ERROR_STOP=1");
    expect(importScript).toContain("-v replace_source=\"$replace_source\"");
    expect(importScript).toContain("mktemp -d \"$work_dir/run.XXXXXX\"");
    expect(importScript).toContain("replace-source.lock");
    expect(importScript).toContain("clean_header(value)");
    expect(importScript).toContain("explicit_match");
    expect(importScript).toContain("csv_field(value)");
    expect(importScript).toContain("PlasticList match row references unknown sample");
    expect(importScript).toContain("prepared zero product test rows");
    expect(importScript).not.toContain("echo \"$labels_db_url\"");
    expect(importSql).toContain("BEGIN;");
    expect(importSql).toContain("COMMIT;");
    expect(importSql).toContain(":'replace_source' = 'true'");
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
    expect(importThresholdsScript).toContain("labels-db-psql.sh");
    expect(importThresholdsScript).toContain("apps/web/sql/product-tests/thresholds/");
    expect(importThresholdsScript).toContain("import-thresholds.sql");
    expect(importThresholdsSql).toContain("CREATE TEMP TABLE contaminant_thresholds_import");
    expect(importThresholdsSql).toContain("pg_advisory_xact_lock");
    expect(importThresholdsSql).toContain("murph:contaminant_thresholds:import");
    expect(importThresholdsSql).toContain("\\copy contaminant_thresholds_import");
    expect(importThresholdsSql).toContain("contaminant_thresholds_normalized");
    expect(importThresholdsSql).toContain("UPDATE contaminant_thresholds");
    expect(importThresholdsSql).toContain("SELECT DISTINCT authority_key");
    expect(importThresholdsSql).toContain("ON CONFLICT (id) DO UPDATE");
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
        expect(record.authority_key).toMatch(/^[a-z][a-z0-9_]*$/u);
        expect(record.threshold_name).not.toHaveLength(0);
        expect(Number(record.threshold_value)).toBeGreaterThan(0);
        expect(record.threshold_unit).not.toHaveLength(0);
        expect(record.threshold_basis).not.toHaveLength(0);
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
          id: "plasticlist_bay_area_2024:sample-default:dehp:ng_g",
          food_id: "plasticlist_bay_area_2024:product-default",
          supplement_id: "",
          source_result_id: "sample-default",
          tested_source_product_id: "product-default",
          match_method: "exact_source_id",
          explicit_match: "false",
          contaminant_key: "dehp",
          result_operator: "gt",
          result_value: "12",
          normalized_value: "12",
          normalized_unit: "ng/g",
          test_method: "phthalate-method",
        }),
        expect.objectContaining({
          id: "plasticlist_bay_area_2024:sample-mapped:bpa:ng_g",
          food_id: "",
          supplement_id: "dsld:known-product",
          source_result_id: "sample-mapped",
          tested_source_product_id: "product-mapped",
          match_method: "manual_confirmed",
          explicit_match: "true",
          contaminant_key: "bpa",
          result_operator: "eq",
          result_value: "8",
          normalized_value: "8",
          normalized_unit: "ng/g",
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
