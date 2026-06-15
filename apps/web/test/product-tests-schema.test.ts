import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(schemaSql).toContain("contaminant_thresholds_lookup_idx");
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

    expect(readme).toContain("PlasticList data is licensed under CC BY 4.0");
    expect(readme).toContain("Data on Plastic Chemicals in Bay Area Foods");
    expect(readme).toContain("links every contaminant result to that row");
    expect(readme).toContain("import-plasticlist.sh --schema-only");
    expect(readme).toContain("--legacy-supplement-db");
    expect(readme).toContain("legacy `MURPH_SUPPLEMENT_DB_URL` fallback");
    expect(readme).toContain("separate curated `contaminant_thresholds` rows");
    expect(importScript).toContain("PLASTICLIST_SAMPLES_TSV_PATH is required");
    expect(importScript).toContain("MURPH_LABELS_DB_URL is required");
    expect(importScript).toContain("--schema-only");
    expect(importScript).toContain("--legacy-supplement-db");
    expect(importScript).toContain("legacy-supplement-foods-stub.sql");
    expect(importScript).toContain("apply_product_test_schemas");
    expect(importScript).toContain("plasticlist_bay_area_2024");
    expect(importScript).toContain("exact_source_id");
    expect(importScript).toContain("apps/web/sql/foods/schema.sql");
    expect(importScript).toContain("apps/web/sql/supplements/schema.sql");
    expect(importScript).toContain("-v foods_tsv=");
    expect(importScript).toContain("PGPASSFILE");
    expect(importScript).toContain("unset MURPH_LABELS_DB_URL labels_db_url");
    expect(importScript).toContain("\"$psql_bin\" -X \"$@\"");
    expect(importScript).toContain("run_labels_psql -v ON_ERROR_STOP=1");
    expect(importScript).not.toContain("echo \"$labels_db_url\"");
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

      const sourceScriptPath = new URL(
        "../sql/product-tests/import-plasticlist.sh",
        import.meta.url,
      );
      const tempScriptPath = path.join(tempScriptDir, "import-plasticlist.sh");
      await writeFile(tempScriptPath, await readFile(sourceScriptPath, "utf8"));
      await chmod(tempScriptPath, 0o755);

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
      const tempScriptPath = path.join(tempScriptDir, "import-plasticlist.sh");
      await writeFile(
        tempScriptPath,
        await readFile(new URL("import-plasticlist.sh", sourceScriptDir), "utf8"),
      );
      await chmod(tempScriptPath, 0o755);
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

      const sourceScriptPath = new URL(
        "../sql/product-tests/import-plasticlist.sh",
        import.meta.url,
      );
      const tempScriptPath = path.join(tempScriptDir, "import-plasticlist.sh");
      await writeFile(tempScriptPath, await readFile(sourceScriptPath, "utf8"));
      await chmod(tempScriptPath, 0o755);

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

      const sourceScriptPath = new URL(
        "../sql/product-tests/import-plasticlist.sh",
        import.meta.url,
      );
      const tempScriptPath = path.join(tempScriptDir, "import-plasticlist.sh");
      await writeFile(tempScriptPath, await readFile(sourceScriptPath, "utf8"));
      await chmod(tempScriptPath, 0o755);

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
      await writeFile(samplesPath, buildPlasticListSamplesTsv());
      await writeFile(
        matchesPath,
        [
          "plasticlist_sample_id\tfood_id\tsupplement_id\tmatch_method",
          "sample-mapped\t\tdsld:known-product\tmanual_confirmed",
          "",
        ].join("\n"),
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

      const workDir = path.join(
        tempRepoRoot,
        ".plasticlist-work/product-tests",
      );
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
        "product-mapped",
      ]);

      expect(productTestRows).toEqual([
        expect.objectContaining({
          id: "plasticlist_bay_area_2024:sample-default:dehp:ng_g",
          food_id: "plasticlist_bay_area_2024:product-default",
          supplement_id: "",
          source_result_id: "sample-default",
          tested_source_product_id: "product-default",
          match_method: "exact_source_id",
          contaminant_key: "dehp",
          result_operator: "eq",
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
      expect(fakePsqlLog).toContain("-v foods_tsv=");
      expect(fakePsqlLog).toContain("-v product_tests_tsv=");
      expect(fakePsqlLog).not.toContain(tempRoot);
      expect(fakePsqlLog).not.toContain("postgres://");
      expect(fakePsqlLog).not.toContain("postgresql://");
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
      DEHP_ng_g: "12",
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

function buildPlasticListSampleRow(
  headers: string[],
  values: Record<string, string>,
): string {
  return headers.map((header) => values[header] ?? "").join("\t");
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
