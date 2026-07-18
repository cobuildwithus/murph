import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const TEST_DATABASE_ENV = "MURPH_SUPPLEMENT_SEARCH_TEST_DB_URL";
const testDatabaseUrl = process.env[TEST_DATABASE_ENV]?.trim() || null;
const remapScript = "apps/web/sql/product-tests/import-product-test-remaps.sh";
const remapHeader = [
  "source_key",
  "tested_source_product_id",
  "tested_product_name",
  "tested_product_brand",
  "tested_product_upc",
  "tested_package_size",
  "source_fingerprint",
  "source_snapshot_fingerprint",
  "expected_current_state_fingerprint",
  "desired_remap_revision",
  "food_id",
  "supplement_id",
  "target_fingerprint",
  "match_method",
  "source_id_namespace",
  "review_note",
] as const;

type RemapRow = Record<(typeof remapHeader)[number], string>;

function isClearlyLocalPostgresUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return false;
    }

    const queryHosts = parsed.searchParams.getAll("host");
    const hosts = queryHosts.length > 0 ? queryHosts : [parsed.hostname];
    return hosts.every((host) =>
      host === "localhost"
      || host === "127.0.0.1"
      || host === "::1"
      || host === "[::1]"
      || host.startsWith("/"),
    );
  } catch {
    return false;
  }
}

if (testDatabaseUrl && !isClearlyLocalPostgresUrl(testDatabaseUrl)) {
  throw new Error(`${TEST_DATABASE_ENV} must point to a loopback PostgreSQL database`);
}

describe("product-test reviewed remap safety contract", () => {
  it("defaults to dry-run, requires explicit apply, and keeps schema ownership separate", async () => {
    const script = await readFile(
      new URL("../sql/product-tests/import-product-test-remaps.sh", import.meta.url),
      "utf8",
    );
    const sql = await readFile(
      new URL("../sql/product-tests/import-product-test-remaps.sql", import.meta.url),
      "utf8",
    );

    expect(script).toContain("[--apply]");
    expect(script).toContain("apply=false");
    expect(script).toContain("Product test remaps TSV header does not match the reviewed import contract");
    expect(script).toContain("-v remap_apply=\"$apply\"");
    expect(script).not.toContain("apps/web/sql/foods/schema.sql");
    expect(script).not.toContain("apps/web/sql/supplements/schema.sql");
    expect(script).not.toContain("$script_dir/schema.sql");
    expect(sql).toContain("compare-and-set conflict with unexpected current decision state");
    expect(sql).toContain("'version', 'product-test-remap-preimage-fingerprint-v4'");
    expect(sql).toContain("'sourceSnapshotFingerprint'");
    expect(sql).toMatch(
      /'version', 'product-test-remap-preimage-fingerprint-v3'[\s\S]*'foodId', NULL::text[\s\S]*'matchMethod', 'source_only'[\s\S]*tests\.remap_revision/u,
    );
    expect(sql).toContain("product test remap source fingerprint is stale");
    expect(sql).toContain("product test remap target fingerprint is stale");
    expect(sql).toContain("'testedPackageSize', MIN(tests.tested_package_size)");
    expect(sql).toContain("remap_revision = plan.after_remap_revision");
    expect(sql).toContain("tests.remap_revision = plan.before_remap_revision");
    expect(sql).toContain("'remap_revision', 'imported_at'");
    expect(sql).not.toContain("imported_at = now()");
    expect(sql).toContain("valid GTIN checksums, canonical GTIN equality");
    expect(sql).toContain("exact_source_id proof does not match");
    expect(sql).toMatch(/\\if :remap_apply[\s\S]*pg_advisory_xact_lock/u);
    expect(sql).toMatch(/IF \(SELECT apply FROM product_test_remap_options\)[\s\S]*FOR UPDATE/u);
    expect(sql).toContain(
      "murph_product_test_canonical_gtin(source_products.tested_product_upc) IS NOT NULL",
    );
    expect(sql).toContain("murph_product_test_legacy_source_backed_origin(foods.data_origin)");
    expect(sql).toContain("murph_product_test_legacy_source_backed_origin(supplements.data_origin)");
    expect(sql).not.toContain("source_backing_tests.source_key = foods.data_origin");
    expect(sql).not.toContain("data_origin NOT IN");
  });
});

describe.runIf(Boolean(testDatabaseUrl))(
  "product-test reviewed remap PostgreSQL safety",
  () => {
    const schemaName = `product_test_remap_${randomUUID().replaceAll("-", "")}`;
    const client = new pg.Client({ connectionString: testDatabaseUrl ?? undefined });
    const workDir = path.join(
      ".product-tests-work",
      "product-test-remap-safety",
      randomUUID(),
    );
    let scopedDatabaseUrl = "";
    let schemaCreated = false;

    beforeAll(async () => {
      await client.connect();
      await client.query(`CREATE SCHEMA ${schemaName}`);
      schemaCreated = true;
      await client.query(`
        CREATE FUNCTION ${schemaName}.strict_word_similarity(TEXT, TEXT)
        RETURNS REAL
        LANGUAGE sql
        IMMUTABLE
        AS 'SELECT 1::real';
        CREATE FUNCTION ${schemaName}.murph_product_test_valid_gtin(TEXT)
        RETURNS BOOLEAN
        LANGUAGE sql
        IMMUTABLE
        STRICT
        AS 'WITH gtin AS (
          SELECT $1 AS value, length($1) AS value_length
        )
        SELECT COALESCE(
          value ~ ''^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$''
          AND (
            10 - (
              SELECT SUM(
                substring(value FROM digit_position FOR 1)::integer
                * CASE WHEN (value_length - digit_position) % 2 = 1 THEN 3 ELSE 1 END
              )
              FROM generate_series(1, value_length - 1) digit_position
            ) % 10
          ) % 10 = substring(value FROM value_length FOR 1)::integer,
          false
        )
        FROM gtin';
        CREATE FUNCTION ${schemaName}.murph_product_test_canonical_gtin(TEXT)
        RETURNS TEXT
        LANGUAGE sql
        IMMUTABLE
        STRICT
        AS 'SELECT CASE
          WHEN ${schemaName}.murph_product_test_valid_gtin($1) THEN lpad($1, 14, ''0'')
          ELSE NULL
        END';
        CREATE FUNCTION ${schemaName}.murph_product_test_legacy_source_backed_origin(TEXT)
        RETURNS BOOLEAN
        LANGUAGE sql
        IMMUTABLE
        STRICT
        AS 'SELECT $1 IN (
          ''plasticlist_bay_area_2024'',
          ''nyc_dohmh_consumer_products'',
          ''king_county_consumer_products'',
          ''pure_earth_rms_2024''
        )';
        CREATE TABLE ${schemaName}.foods (
          id TEXT PRIMARY KEY,
          canonical_key TEXT NOT NULL,
          data_origin TEXT NOT NULL,
          data_origin_id TEXT NOT NULL,
          data_origin_priority SMALLINT NOT NULL DEFAULT 100,
          name TEXT NOT NULL,
          brand TEXT,
          upc TEXT,
          off_market BOOLEAN NOT NULL DEFAULT false,
          search_text TEXT NOT NULL
        );
        CREATE TABLE ${schemaName}.supplements (
          id TEXT PRIMARY KEY,
          canonical_key TEXT NOT NULL,
          data_origin TEXT NOT NULL,
          data_origin_id TEXT NOT NULL,
          data_origin_priority SMALLINT NOT NULL DEFAULT 100,
          name TEXT NOT NULL,
          brand TEXT,
          upc TEXT,
          off_market BOOLEAN NOT NULL DEFAULT false,
          search_text TEXT NOT NULL
        );
        CREATE TABLE ${schemaName}.product_tests (
          source_key TEXT NOT NULL,
          source_result_id TEXT NOT NULL,
          contaminant_key TEXT NOT NULL,
          tested_source_product_id TEXT,
          tested_product_name TEXT,
          tested_product_brand TEXT,
          tested_product_upc TEXT,
          tested_product_upc_raw TEXT,
          tested_lot_code TEXT,
          tested_best_by TEXT,
          tested_package_size TEXT,
          food_id TEXT,
          supplement_id TEXT,
          match_method TEXT NOT NULL,
          remap_revision BIGINT NOT NULL DEFAULT 0,
          imported_at TIMESTAMPTZ NOT NULL
        );
      `);

      const parsed = new URL(testDatabaseUrl ?? "");
      parsed.searchParams.set(
        "options",
        `-csearch_path=${schemaName},public -cstatement_timeout=2000`,
      );
      scopedDatabaseUrl = parsed.toString();
      await mkdir(workDir, { recursive: true });
    });

    beforeEach(async () => {
      await client.query(`
        TRUNCATE ${schemaName}.product_tests, ${schemaName}.foods, ${schemaName}.supplements;
        INSERT INTO ${schemaName}.foods (
          id, canonical_key, data_origin, data_origin_id, name, brand, upc, off_market, search_text
        ) VALUES
          ('food-a', 'canonical-a', 'brand_site', 'food-a', 'Target A', 'Example', '00012348', false, 'Target A Example'),
          ('food-a-alias', 'canonical-a', 'usda_branded', 'food-a-alias', 'Target A alias', 'Example', '00012348', false, 'Target A alias Example'),
          ('food-b', 'canonical-b', 'brand_site', 'food-b', 'Target B', 'Example', '00054321', false, 'Target B Example'),
          ('food-c', 'canonical-c', 'brand_site', 'food-c', 'Target C', 'Example', null, false, 'Target C Example'),
          ('food-d', 'canonical-d', 'brand_site', 'food-d', 'Target D', 'Example', null, false, 'Target D Example'),
          ('food-e', 'canonical-e', 'brand_site', 'food-e', 'Target E', 'Example', null, false, 'Target E Example'),
          ('food-namespace', 'canonical-namespace', 'fdc', '789', 'Namespace Target', 'Example', null, false, 'Namespace Target Example');
        INSERT INTO ${schemaName}.product_tests (
          source_key, source_result_id, contaminant_key,
          tested_source_product_id, tested_product_name, tested_product_brand,
          tested_product_upc, food_id, supplement_id, match_method, imported_at
        ) VALUES
          ('catalog', 'manual-1', 'lead', 'manual', 'Manual Product', 'Example', null, null, null, 'source_only', '2000-01-01'),
          ('catalog', 'manual-2', 'cadmium', 'manual', 'Manual Product', 'Example', null, null, null, 'source_only', '2001-01-01'),
          ('catalog', 'upc-1', 'lead', 'upc', 'UPC Product', 'Example', '00012348', null, null, 'source_only', '2000-01-01'),
          ('catalog', 'source-only-1', 'lead', 'source-only', 'Unmatched Product', null, null, null, null, 'source_only', '2000-01-01'),
          ('catalog', 'conflict-1', 'lead', 'conflict', 'Conflict Product', null, null, 'food-b', null, 'manual_confirmed', '2000-01-01'),
          ('catalog', 'namespace-1', 'lead', 'fdc:789', 'Namespace Product', null, null, null, null, 'source_only', '2000-01-01'),
          ('catalog', 'bare-namespace-1', 'lead', '789', 'Bare Namespace Product', null, null, null, null, 'source_only', '2000-01-01'),
          ('catalog', 'stale-1', 'lead', 'stale', 'Stale Product', null, null, null, null, 'source_only', '2000-01-01'),
          ('export_catalog', 'export-1', 'lead', 'export-product', 'Target', 'Example', '00012348', null, null, 'source_only', '2000-01-01'),
          ('brand_site', 'collision-1', 'lead', 'collision-product', 'Catalog collision', null, null, null, null, 'source_only', '2000-01-01');
      `);
    });

    afterAll(async () => {
      if (schemaCreated) {
        await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
      }
      await client.end();
      await rm(workDir, { recursive: true, force: true });
    });

    it("dry-runs by default, applies once, writes a private manifest, and replays without timestamp churn", async () => {
      const row = await remapRow({
        sourceId: "manual",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "Brand and exact package evidence were reviewed.",
      });

      const dryRun = await runRemap([row]);
      expect(dryRun.stdout).toContain("mode=dry-run decisions=1 mutations=1 noops=0 observation_rows=2");
      expect(await currentState("manual")).toMatchObject({
        food_id: null,
        match_method: "source_only",
      });

      const manifestsBefore = await manifestNames();
      const applied = await runRemap([row], ["--apply"]);
      expect(applied.stdout).toContain("mode=apply decisions=1 mutations=1 noops=0 observation_rows=2");
      const firstState = await currentState("manual");
      expect(firstState).toMatchObject({ food_id: "food-a", match_method: "manual_confirmed" });

      const manifestsAfter = await manifestNames();
      const newManifest = [...manifestsAfter].find((name) => !manifestsBefore.has(name));
      expect(newManifest).toBeTruthy();
      const manifestPath = path.join(
        ".product-tests-work/product-test-remaps/manifests",
        newManifest ?? "missing",
      );
      expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
      const manifest = await readFile(manifestPath, "utf8");
      expect(manifest).toContain("source_result_id");
      expect(manifest).toContain("tested_package_size");
      expect(manifest).toContain("before_food_id");
      expect(manifest).toContain("before_remap_revision");
      expect(manifest).toContain("after_remap_revision");

      const replayed = await runRemap([row], ["--apply"]);
      expect(replayed.stdout).toContain("mode=apply decisions=1 mutations=0 noops=1 observation_rows=0");
      expect((await currentState("manual")).imported_at).toEqual(firstState.imported_at);
    });

    it("dry-run remains nonblocking while mutation locks are held elsewhere", async () => {
      const row = await remapRow({
        sourceId: "manual",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "Brand and exact package evidence were reviewed.",
      });
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('murph:product_tests:mutation'))");
        await client.query(`
          SELECT 1
          FROM ${schemaName}.product_tests
          WHERE tested_source_product_id = 'manual'
          FOR UPDATE
        `);
        expect((await runRemap([row])).stdout).toContain("mode=dry-run");
      } finally {
        await client.query("ROLLBACK");
      }
    });

    it("rejects stale source identity and source or target fingerprints", async () => {
      const identityMismatch = await remapRow({
        sourceId: "stale",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "Reviewed against the current package evidence.",
      });
      identityMismatch.tested_product_name = "Changed Product";
      await expect(runRemap([identityMismatch])).rejects.toMatchObject({
        stderr: expect.stringContaining("source identity does not match"),
      });

      const staleSource = await remapRow({
        sourceId: "stale",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "Reviewed against the current package evidence.",
      });
      staleSource.source_fingerprint = "0".repeat(32);
      await expect(runRemap([staleSource])).rejects.toMatchObject({
        stderr: expect.stringContaining("source fingerprint is stale"),
      });

      const staleTarget = await remapRow({
        sourceId: "stale",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "Reviewed against the current package evidence.",
      });
      staleTarget.target_fingerprint = "0".repeat(32);
      await expect(runRemap([staleTarget])).rejects.toMatchObject({
        stderr: expect.stringContaining("target fingerprint is stale"),
      });

      const staleRawUpc = await remapRow({
        sourceId: "stale",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "Reviewed against the current package evidence.",
      });
      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_product_upc_raw = 'unverified source identifier'
        WHERE tested_source_product_id = 'stale'
      `);
      await expect(runRemap([staleRawUpc])).rejects.toMatchObject({
        stderr: expect.stringContaining("source fingerprint is stale"),
      });
    });

    it("invalidates identity drift and source-observation drift", async () => {
      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_package_size = '500 mL', tested_lot_code = 'LOT-A', tested_best_by = '2027-01'
        WHERE tested_source_product_id = 'stale'
      `);
      const reviewed = await remapRow({
        sourceId: "stale",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "The exact 500 mL package was reviewed.",
      });

      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_package_size = '1 L'
        WHERE tested_source_product_id = 'stale'
      `);
      await expect(runRemap([reviewed])).rejects.toMatchObject({
        stderr: expect.stringContaining("source identity does not match"),
      });

      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_package_size = '500 mL', tested_lot_code = 'LOT-B', tested_best_by = '2028-06'
        WHERE tested_source_product_id = 'stale'
      `);
      await expect(runRemap([reviewed])).rejects.toMatchObject({
        stderr: expect.stringContaining("source snapshot fingerprint is stale"),
      });

      const refreshed = await remapRow({
        sourceId: "stale",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "The refreshed source observation was reviewed.",
      });
      expect((await runRemap([refreshed])).stdout).toContain("mutations=1");
    });

    it("rejects a different existing link instead of overwriting it", async () => {
      const row = await remapRow({
        sourceId: "conflict",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "A different target was reviewed for comparison.",
      });
      row.expected_current_state_fingerprint = "0".repeat(32);

      await expect(runRemap([row], ["--apply"])).rejects.toMatchObject({
        stderr: expect.stringContaining("compare-and-set conflict"),
      });
      expect(await currentState("conflict")).toMatchObject({
        food_id: "food-b",
        match_method: "manual_confirmed",
        remap_revision: "0",
      });
    });

    it("applies an intentional correction only from the reviewed current state", async () => {
      const corrected = await remapRow({
        sourceId: "conflict",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "The prior target was disproven and this replacement was reviewed.",
      });
      expect((await runRemap([corrected], ["--apply"])).stdout).toContain("mutations=1");
      expect(await currentState("conflict")).toMatchObject({
        food_id: "food-a",
        match_method: "manual_confirmed",
      });

      const demoted = await remapRow({
        sourceId: "conflict",
        matchMethod: "source_only",
        reviewNote: "The linked variant was disproven and no exact replacement exists.",
      });
      expect((await runRemap([demoted], ["--apply"])).stdout).toContain("mutations=1");
      expect(await currentState("conflict")).toMatchObject({
        food_id: null,
        match_method: "source_only",
      });
    });

    it("rejects ABA replay after a reviewed link is disproven", async () => {
      const firstCorrection = await remapRow({
        sourceId: "conflict",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "The original target was disproven and target A was reviewed.",
      });
      expect((await runRemap([firstCorrection], ["--apply"])).stdout)
        .toContain("mutations=1");

      const disproven = await remapRow({
        sourceId: "conflict",
        matchMethod: "source_only",
        reviewNote: "Target A was disproven and no exact replacement exists.",
      });
      expect((await runRemap([disproven], ["--apply"])).stdout)
        .toContain("mutations=1");

      await expect(runRemap([firstCorrection], ["--apply"]))
        .rejects.toMatchObject({
          stderr: expect.stringContaining("compare-and-set conflict"),
        });
      expect((await runRemap([disproven], ["--apply"])).stdout)
        .toContain("mutations=0 noops=1");
    });

    it("keeps mutating artifacts portable across operational import times", async () => {
      const portableArtifact = await remapRow({
        sourceId: "stale",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "The source-owned observation was reviewed.",
      });
      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET imported_at = imported_at + interval '1 second'
        WHERE tested_source_product_id = 'stale'
      `);

      expect((await runRemap([portableArtifact], ["--apply"])).stdout)
        .toContain("mutations=1");
    });

    it("converges migrated, independently imported, and pristine histories on absolute generations", async () => {
      const legacySchema = `product_test_remap_legacy_${randomUUID().replaceAll("-", "")}`;
      const freshSchema = `product_test_remap_fresh_${randomUUID().replaceAll("-", "")}`;
      const pristineSchema = `product_test_remap_pristine_${randomUUID().replaceAll("-", "")}`;
      const firstDecision = await remapRow({
        sourceId: "manual",
        targetFoodId: "food-a",
        matchMethod: "manual_confirmed",
        reviewNote: "The equivalent source snapshot and target were reviewed.",
      });
      const explicitSourceOnly = await remapRow({
        sourceId: "source-only",
        matchMethod: "source_only",
        reviewNote: "The source snapshot has no defensible product match.",
      });

      try {
        for (const portableSchema of [legacySchema, freshSchema, pristineSchema]) {
          await client.query(`
            CREATE SCHEMA ${portableSchema};
            CREATE TABLE ${portableSchema}.foods
              (LIKE ${schemaName}.foods INCLUDING ALL);
            CREATE TABLE ${portableSchema}.supplements
              (LIKE ${schemaName}.supplements INCLUDING ALL);
            CREATE TABLE ${portableSchema}.product_tests
              (LIKE ${schemaName}.product_tests INCLUDING ALL);
            INSERT INTO ${portableSchema}.foods (
              id, canonical_key, data_origin, data_origin_id,
              data_origin_priority, name, brand, upc, off_market, search_text
            ) VALUES
              ('food-a', 'canonical-a', 'brand_site', 'food-a', 100,
                'Target A', 'Example', '00012348', false, 'Target A Example'),
              ('food-b', 'canonical-b', 'brand_site', 'food-b', 100,
                'Target B', 'Example', '00054321', false, 'Target B Example');
          `);
        }

        for (const portableSchema of [legacySchema, freshSchema, pristineSchema]) {
          const isLegacy = portableSchema === legacySchema;
          await client.query(`
            INSERT INTO ${portableSchema}.product_tests (
              source_key, source_result_id, contaminant_key,
              tested_source_product_id, tested_product_name, tested_product_brand,
              tested_product_upc, tested_product_upc_raw, tested_lot_code,
              tested_best_by, tested_package_size, food_id, supplement_id,
              match_method, remap_revision, imported_at
            ) VALUES
              ('catalog', 'manual-1', 'lead', 'manual', 'Manual Product', 'Example',
                NULL, NULL, NULL, NULL, NULL, ${isLegacy ? "'food-a'" : "NULL"}, NULL,
                ${isLegacy ? "'manual_confirmed'" : "'source_only'"}, 0, '2030-01-01'),
              ('catalog', 'manual-2', 'cadmium', 'manual', 'Manual Product', 'Example',
                NULL, NULL, NULL, NULL, NULL, ${isLegacy ? "'food-a'" : "NULL"}, NULL,
                ${isLegacy ? "'manual_confirmed'" : "'source_only'"}, 0, '2031-01-01'),
              ('catalog', 'source-only-1', 'lead', 'source-only', 'Unmatched Product', NULL,
                NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'source_only', 0, '2032-01-01');
          `);
        }

        const legacyUrl = portableDatabaseUrl(legacySchema);
        const freshUrl = portableDatabaseUrl(freshSchema);
        const pristineUrl = portableDatabaseUrl(pristineSchema);

        for (const databaseUrl of [legacyUrl, freshUrl]) {
          expect((await runRemap(
            [firstDecision, explicitSourceOnly],
            ["--apply"],
            databaseUrl,
          )).stdout).toContain("mutations=2 noops=0");
        }

        expect(await portableState(legacySchema, "manual"))
          .toEqual(await portableState(freshSchema, "manual"));
        expect(await portableState(legacySchema, "source-only"))
          .toEqual(await portableState(freshSchema, "source-only"));
        expect(await portableState(legacySchema, "manual")).toMatchObject({
          food_id: "food-a",
          remap_revision: "1",
        });

        await runRemap([firstDecision], ["--apply"]);
        const secondDecision = await remapRow({
          sourceId: "manual",
          targetFoodId: "food-b",
          matchMethod: "manual_confirmed",
          reviewNote: "The first target was disproven and target B was reviewed.",
        });
        expect(secondDecision.desired_remap_revision).toBe("2");

        for (const databaseUrl of [legacyUrl, freshUrl, pristineUrl]) {
          expect((await runRemap([secondDecision], ["--apply"], databaseUrl)).stdout)
            .toContain("mutations=1 noops=0");
        }

        const convergedStates = await Promise.all(
          [legacySchema, freshSchema, pristineSchema]
            .map((portableSchema) => portableState(portableSchema, "manual")),
        );
        expect(new Set(convergedStates.map((state) => state.current_state_fingerprint)).size)
          .toBe(1);
        expect(convergedStates[0]).toMatchObject({
          food_id: "food-b",
          match_method: "manual_confirmed",
          remap_revision: "2",
        });

        for (const databaseUrl of [legacyUrl, freshUrl, pristineUrl]) {
          expect((await runRemap([secondDecision], ["--apply"], databaseUrl)).stdout)
            .toContain("mutations=0 noops=1");
          await expect(runRemap([firstDecision], ["--apply"], databaseUrl))
            .rejects.toMatchObject({
              stderr: expect.stringContaining("non-monotonic generation"),
            });
        }
      } finally {
        for (const portableSchema of [legacySchema, freshSchema, pristineSchema]) {
          await client.query(`DROP SCHEMA IF EXISTS ${portableSchema} CASCADE`);
        }
      }
    });

    it("requires a review note for manual and explicit source-only decisions", async () => {
      const sourceOnly = await remapRow({
        sourceId: "source-only",
        matchMethod: "source_only",
        reviewNote: "No product-specific identity evidence was available.",
      });
      expect((await runRemap([sourceOnly], ["--apply"])).stdout)
        .toContain("mutations=1 noops=0");
      expect(await currentState("source-only")).toMatchObject({
        match_method: "source_only",
        remap_revision: "1",
      });
      expect((await runRemap([sourceOnly], ["--apply"])).stdout)
        .toContain("mutations=0 noops=1");

      sourceOnly.review_note = "";
      await expect(runRemap([sourceOnly])).rejects.toMatchObject({
        stderr: expect.stringContaining("require a nonempty review note"),
      });
    });

    it("mechanically proves exact UPC equality and canonical-group uniqueness", async () => {
      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_product_upc = '036000291452'
        WHERE tested_source_product_id = 'upc';
        UPDATE ${schemaName}.foods
        SET upc = CASE id
          WHEN 'food-a' THEN '0036000291452'
          WHEN 'food-a-alias' THEN '00036000291452'
          ELSE upc
        END
        WHERE canonical_key = 'canonical-a'
      `);
      const exact = await remapRow({
        sourceId: "upc",
        targetFoodId: "food-a",
        matchMethod: "exact_upc",
      });
      expect((await runRemap([exact])).stdout).toContain("mutations=1");

      await client.query(`
        INSERT INTO ${schemaName}.supplements (
          id, canonical_key, data_origin, data_origin_id, name, brand, upc, off_market, search_text
        ) VALUES ('supplement-ambiguous', 'canonical-other', 'dsld', '1', 'Other entity', 'Example', '036000291452', false, 'Other entity Example')
      `);
      await expect(runRemap([exact])).rejects.toMatchObject({
        stderr: expect.stringContaining("one unique target canonical group"),
      });

      await client.query(`
        DELETE FROM ${schemaName}.supplements WHERE id = 'supplement-ambiguous';
        UPDATE ${schemaName}.product_tests
        SET tested_product_upc = '00012-348'
        WHERE tested_source_product_id = 'upc'
      `);
      const punctuated = await remapRow({
        sourceId: "upc",
        targetFoodId: "food-a",
        matchMethod: "exact_upc",
      });
      await expect(runRemap([punctuated])).rejects.toMatchObject({
        stderr: expect.stringContaining("canonical GTIN equality"),
      });

      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_product_upc = '036000291452'
        WHERE tested_source_product_id = 'upc';
        UPDATE ${schemaName}.foods
        SET upc = '10036000291459'
        WHERE canonical_key = 'canonical-a'
      `);
      const distinctGtin = await remapRow({
        sourceId: "upc",
        targetFoodId: "food-a",
        matchMethod: "exact_upc",
      });
      await expect(runRemap([distinctGtin])).rejects.toMatchObject({
        stderr: expect.stringContaining("canonical GTIN equality"),
      });

      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_product_upc = '00012345'
        WHERE tested_source_product_id = 'upc';
        UPDATE ${schemaName}.foods
        SET upc = '00012345'
        WHERE canonical_key = 'canonical-a'
      `);
      const invalidChecksum = await remapRow({
        sourceId: "upc",
        targetFoodId: "food-a",
        matchMethod: "exact_upc",
      });
      await expect(runRemap([invalidChecksum])).rejects.toMatchObject({
        stderr: expect.stringContaining("valid GTIN checksums"),
      });

      await client.query(`
        UPDATE ${schemaName}.product_tests
        SET tested_product_upc = null
        WHERE tested_source_product_id = 'upc';
        UPDATE ${schemaName}.foods
        SET upc = '00012348'
        WHERE canonical_key = 'canonical-a'
      `);
      const missingSourceGtin = await remapRow({
        sourceId: "upc",
        targetFoodId: "food-a",
        matchMethod: "exact_upc",
      });
      await expect(runRemap([missingSourceGtin])).rejects.toMatchObject({
        stderr: expect.stringContaining("valid GTIN checksums"),
      });
    });

    it("requires and proves an exact-source-id namespace", async () => {
      const missingNamespace = await remapRow({
        sourceId: "fdc:789",
        targetFoodId: "food-namespace",
        matchMethod: "exact_source_id",
      });
      await expect(runRemap([missingNamespace])).rejects.toMatchObject({
        stderr: expect.stringContaining("requires an exclusive source_id_namespace proof"),
      });

      const proven = await remapRow({
        sourceId: "fdc:789",
        targetFoodId: "food-namespace",
        matchMethod: "exact_source_id",
        sourceIdNamespace: "fdc",
      });
      expect((await runRemap([proven])).stdout).toContain("mutations=1");

      const bareNumeric = await remapRow({
        sourceId: "789",
        targetFoodId: "food-namespace",
        matchMethod: "exact_source_id",
        sourceIdNamespace: "fdc",
      });
      await expect(runRemap([bareNumeric])).rejects.toMatchObject({
        stderr: expect.stringContaining("does not match one namespaced target"),
      });

      proven.source_id_namespace = "other_namespace";
      await expect(runRemap([proven])).rejects.toMatchObject({
        stderr: expect.stringContaining("does not match one namespaced target"),
      });
    });

    it("exports five review options and importer-compatible identity fingerprints", async () => {
      const firstCandidatesPath = path.join(workDir, "candidates-before.tsv");
      const secondCandidatesPath = path.join(workDir, "candidates-after.tsv");
      await runCandidateExport(firstCandidatesPath);
      const firstRows = parseTsv(await readFile(firstCandidatesPath, "utf8"));
      expect(firstRows).toHaveLength(5);
      expect(firstRows.map((row) => row.candidate_rank)).toEqual(["1", "2", "3", "4", "5"]);
      expect(new Set(firstRows.map((row) => `${row.candidate_kind}:${row.candidate_canonical_key}`)).size).toBe(5);
      expect(firstRows[0]?.runner_up_score).not.toBe("");
      expect(firstRows[0]?.candidate_score_margin).not.toBe("");
      expect(firstRows[0]?.current_match_method).toBe("source_only");
      expect(firstRows[0]?.current_remap_revision).toBe("0");
      expect(firstRows[0]?.source_fingerprint).toMatch(/^[0-9a-f]{32}$/u);
      expect(firstRows[0]?.source_snapshot_fingerprint).toMatch(/^[0-9a-f]{32}$/u);
      expect(firstRows[0]?.target_fingerprint).toMatch(/^[0-9a-f]{32}$/u);
      expect(firstRows[0]?.candidate_reason).toBe("exact_upc");
      expect(firstRows[0]?.exact_upc_canonical_groups).toBe("1");
      expect(firstRows[0]?.canonical_source_gtin).toBe("00000000012348");

      await client.query(`
        INSERT INTO ${schemaName}.product_tests (
          source_key, source_result_id, contaminant_key,
          tested_source_product_id, tested_product_name, tested_product_brand,
          tested_product_upc, food_id, supplement_id, match_method, imported_at
        ) VALUES (
          'export_catalog', 'export-2', 'cadmium',
          'export-product', 'Target', 'Example', '00012348',
          null, null, 'source_only', '2002-01-01'
        )
      `);
      await runCandidateExport(secondCandidatesPath);
      const secondRows = parseTsv(await readFile(secondCandidatesPath, "utf8"));
      expect(secondRows[0]?.source_fingerprint).toBe(firstRows[0]?.source_fingerprint);
      expect(secondRows[0]?.current_state_fingerprint).not.toBe(
        firstRows[0]?.current_state_fingerprint,
      );
      expect(secondRows[0]?.source_snapshot_fingerprint).not.toBe(
        firstRows[0]?.source_snapshot_fingerprint,
      );

      const top = secondRows[0];
      if (!top || top.candidate_kind !== "food") {
        throw new Error("expected a food candidate fixture");
      }
      const compatibleRemap: RemapRow = {
        source_key: top.source_key,
        tested_source_product_id: top.tested_source_product_id,
        tested_product_name: top.tested_product_name,
        tested_product_brand: top.tested_product_brand,
        tested_product_upc: top.tested_product_upc,
        tested_package_size: top.tested_package_size,
        source_fingerprint: top.source_fingerprint,
        source_snapshot_fingerprint: top.source_snapshot_fingerprint,
        expected_current_state_fingerprint: top.current_state_fingerprint,
        desired_remap_revision: String(BigInt(top.current_remap_revision) + 1n),
        food_id: top.candidate_id,
        supplement_id: "",
        target_fingerprint: top.target_fingerprint,
        match_method: "manual_confirmed",
        source_id_namespace: "",
        review_note: "The top product identity was manually reviewed.",
      };
      expect((await runRemap([compatibleRemap])).stdout).toContain("observation_rows=2");

      const reviewPath = path.join(workDir, "review.tsv");
      await execFileAsync(
        "pnpm",
        ["exec", "tsx", "apps/web/sql/product-tests/build-product-test-remap-review.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH: secondCandidatesPath,
            PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH: reviewPath,
          },
        },
      );
      const reviewRows = parseTsv(await readFile(reviewPath, "utf8"));
      expect(reviewRows).toHaveLength(1);
      const options = JSON.parse(reviewRows[0]?.candidate_options_json ?? "[]") as unknown[];
      expect(options).toHaveLength(5);
      expect(reviewRows[0]?.source_fingerprint).toBe(top.source_fingerprint);
      expect(reviewRows[0]?.source_snapshot_fingerprint)
        .toBe(top.source_snapshot_fingerprint);
      expect(reviewRows[0]?.desired_remap_revision).toBe("1");
      expect(reviewRows[0]?.target_fingerprint).toBe(top.target_fingerprint);
      expect((await stat(reviewPath)).mode & 0o777).toBe(0o600);

      const ambiguousCandidatesPath = path.join(workDir, "candidates-ambiguous.tsv");
      await client.query(`
        INSERT INTO ${schemaName}.supplements (
          id, canonical_key, data_origin, data_origin_id, name, brand, upc, off_market, search_text
        ) VALUES (
          'supplement-export-ambiguous', 'canonical-export-ambiguous', 'dsld', 'export-ambiguous',
          'Target Supplement', 'Example', '00012348', false, 'Target Supplement Example'
        )
      `);
      await runCandidateExport(ambiguousCandidatesPath);
      const ambiguousRows = parseTsv(await readFile(ambiguousCandidatesPath, "utf8"));
      expect(ambiguousRows[0]?.exact_upc_canonical_groups).toBe("2");
      expect(ambiguousRows.every((row) => row.candidate_reason !== "exact_upc")).toBe(true);
    });

    async function runRemap(
      rows: RemapRow[],
      args: string[] = [],
      databaseUrl: string = scopedDatabaseUrl,
    ): Promise<{ stderr: string; stdout: string }> {
      const remapPath = path.join(workDir, `${randomUUID()}.tsv`);
      await writeFile(remapPath, serializeRemaps(rows), { mode: 0o600 });
      return execFileAsync("bash", [remapScript, ...args], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MURPH_LABELS_DB_URL: databaseUrl,
          PRODUCT_TEST_REMAPS_TSV_PATH: remapPath,
        },
        maxBuffer: 1024 * 1024,
      });
    }

    function portableDatabaseUrl(portableSchema: string): string {
      const databaseUrl = new URL(scopedDatabaseUrl);
      databaseUrl.searchParams.set(
        "options",
        `-csearch_path=${portableSchema},${schemaName},public -cstatement_timeout=2000`,
      );
      return databaseUrl.toString();
    }

    async function portableState(portableSchema: string, sourceId: string): Promise<{
      current_state_fingerprint: string;
      food_id: string | null;
      match_method: string;
      remap_revision: string;
    }> {
      const result = await client.query<{
        current_state_fingerprint: string;
        food_id: string | null;
        match_method: string;
        remap_revision: string;
      }>(`
        WITH source_group AS (
          SELECT
            source_key,
            tested_source_product_id,
            MIN(food_id) AS food_id,
            MIN(supplement_id) AS supplement_id,
            MIN(match_method) AS match_method,
            MIN(remap_revision) AS remap_revision,
            md5(jsonb_build_object(
              'version', 'product-test-remap-preimage-fingerprint-v3',
              'foodId', NULL::text,
              'supplementId', NULL::text,
              'matchMethod', 'source_only',
              'targetFingerprint', NULL::text,
              'observationRevisions', jsonb_agg(
                jsonb_build_array(
                  source_result_id,
                  contaminant_key,
                  0,
                  md5((
                    to_jsonb(product_tests)
                      - ARRAY['food_id', 'supplement_id', 'match_method', 'remap_revision', 'imported_at']
                  )::text)
                )
                ORDER BY source_result_id, contaminant_key
              )
            )::text) AS source_snapshot_fingerprint
          FROM ${portableSchema}.product_tests
          WHERE source_key = 'catalog' AND tested_source_product_id = $1
          GROUP BY source_key, tested_source_product_id
        ),
        source_with_target AS (
          SELECT
            source_group.*,
            CASE WHEN current_food.id IS NOT NULL THEN md5(jsonb_build_object(
              'version', 'product-test-target-fingerprint-v1',
              'kind', 'food',
              'id', current_food.id,
              'canonicalKey', current_food.canonical_key,
              'dataOrigin', current_food.data_origin,
              'dataOriginId', current_food.data_origin_id,
              'name', current_food.name,
              'brand', current_food.brand,
              'upc', current_food.upc,
              'offMarket', current_food.off_market
            )::text) END AS current_target_fingerprint
          FROM source_group
          LEFT JOIN ${portableSchema}.foods current_food
            ON current_food.id = source_group.food_id
        )
        SELECT
          food_id,
          match_method,
          remap_revision::text,
          md5(jsonb_build_object(
            'version', 'product-test-remap-preimage-fingerprint-v4',
            'foodId', food_id,
            'supplementId', supplement_id,
            'matchMethod', match_method,
            'targetFingerprint', current_target_fingerprint,
            'remapRevision', remap_revision,
            'sourceSnapshotFingerprint', source_snapshot_fingerprint
          )::text) AS current_state_fingerprint
        FROM source_with_target
      `, [sourceId]);
      const row = result.rows[0];
      if (!row) throw new Error("missing portable-state fixture");
      return row;
    }

    async function runCandidateExport(outputPath: string): Promise<void> {
      await execFileAsync(
        "bash",
        ["apps/web/sql/product-tests/export-product-test-match-candidates.sh"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            MURPH_LABELS_DB_URL: scopedDatabaseUrl,
            PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH: outputPath,
            PRODUCT_TEST_MATCH_SOURCE_KEY: "export_catalog",
            PRODUCT_TEST_MATCH_CANDIDATE_LIMIT: "5",
          },
          maxBuffer: 1024 * 1024,
        },
      );
    }

    async function remapRow(input: {
      matchMethod: RemapRow["match_method"];
      reviewNote?: string;
      sourceId: string;
      sourceIdNamespace?: string;
      targetFoodId?: string;
      desiredRemapRevision?: string;
    }): Promise<RemapRow> {
      const source = await client.query<{
        current_remap_revision: string;
        current_state_fingerprint: string;
        source_fingerprint: string;
        source_snapshot_fingerprint: string;
        tested_product_brand: string | null;
        tested_product_name: string | null;
        tested_package_size: string | null;
        tested_product_upc: string | null;
      }>(`
        WITH source_group AS (
          SELECT
            source_key,
            tested_source_product_id,
            MIN(tested_product_name) AS tested_product_name,
            MIN(tested_product_brand) AS tested_product_brand,
            MIN(tested_product_upc) AS tested_product_upc,
            MIN(tested_product_upc_raw) AS tested_product_upc_raw,
            MIN(tested_package_size) AS tested_package_size,
            MIN(food_id) AS food_id,
            MIN(supplement_id) AS supplement_id,
            MIN(match_method) AS match_method,
            MIN(remap_revision) AS current_remap_revision,
            md5(jsonb_build_object(
              'version', 'product-test-remap-preimage-fingerprint-v3',
              'foodId', NULL::text,
              'supplementId', NULL::text,
              'matchMethod', 'source_only',
              'targetFingerprint', NULL::text,
              'observationRevisions', jsonb_agg(
                jsonb_build_array(
                  source_result_id,
                  contaminant_key,
                  0,
                  md5((
                    to_jsonb(product_tests)
                      - ARRAY['food_id', 'supplement_id', 'match_method', 'remap_revision', 'imported_at']
                  )::text)
                )
                ORDER BY source_result_id, contaminant_key
              )
            )::text) AS source_snapshot_fingerprint
          FROM ${schemaName}.product_tests
          WHERE source_key = 'catalog' AND tested_source_product_id = $1
          GROUP BY source_key, tested_source_product_id
        ),
        source_with_target AS (
          SELECT
            source_group.*,
            CASE
              WHEN current_food.id IS NOT NULL THEN md5(jsonb_build_object(
                'version', 'product-test-target-fingerprint-v1',
                'kind', 'food',
                'id', current_food.id,
                'canonicalKey', current_food.canonical_key,
                'dataOrigin', current_food.data_origin,
                'dataOriginId', current_food.data_origin_id,
                'name', current_food.name,
                'brand', current_food.brand,
                'upc', current_food.upc,
                'offMarket', current_food.off_market
              )::text)
              ELSE NULL
            END AS current_target_fingerprint
          FROM source_group
          LEFT JOIN ${schemaName}.foods current_food ON current_food.id = source_group.food_id
        )
        SELECT
          tested_product_name,
          tested_product_brand,
          tested_product_upc,
          tested_package_size,
          current_remap_revision,
          source_snapshot_fingerprint,
          md5(jsonb_build_object(
            'version', 'product-test-source-fingerprint-v2',
            'sourceKey', source_key,
            'testedSourceProductId', tested_source_product_id,
            'testedProductName', tested_product_name,
            'testedProductBrand', tested_product_brand,
            'testedProductUpc', tested_product_upc,
            'testedProductUpcRaw', tested_product_upc_raw,
            'testedPackageSize', tested_package_size
          )::text) AS source_fingerprint,
          md5(jsonb_build_object(
            'version', 'product-test-remap-preimage-fingerprint-v4',
            'foodId', food_id,
            'supplementId', supplement_id,
            'matchMethod', match_method,
            'targetFingerprint', current_target_fingerprint,
            'remapRevision', current_remap_revision,
            'sourceSnapshotFingerprint', source_snapshot_fingerprint
          )::text) AS current_state_fingerprint
        FROM source_with_target
      `, [input.sourceId]);
      const sourceRow = source.rows[0];
      if (!sourceRow) throw new Error("missing source fixture");

      let targetFingerprint = "";
      if (input.targetFoodId) {
        const target = await client.query<{ target_fingerprint: string }>(`
          SELECT md5(jsonb_build_object(
            'version', 'product-test-target-fingerprint-v1',
            'kind', 'food',
            'id', id,
            'canonicalKey', canonical_key,
            'dataOrigin', data_origin,
            'dataOriginId', data_origin_id,
            'name', name,
            'brand', brand,
            'upc', upc,
            'offMarket', off_market
          )::text) AS target_fingerprint
          FROM ${schemaName}.foods
          WHERE id = $1
        `, [input.targetFoodId]);
        targetFingerprint = target.rows[0]?.target_fingerprint ?? "";
      }

      return {
        source_key: "catalog",
        tested_source_product_id: input.sourceId,
        tested_product_name: sourceRow.tested_product_name ?? "",
        tested_product_brand: sourceRow.tested_product_brand ?? "",
        tested_product_upc: sourceRow.tested_product_upc ?? "",
        tested_package_size: sourceRow.tested_package_size ?? "",
        source_fingerprint: sourceRow.source_fingerprint,
        source_snapshot_fingerprint: sourceRow.source_snapshot_fingerprint,
        expected_current_state_fingerprint: sourceRow.current_state_fingerprint,
        desired_remap_revision: input.desiredRemapRevision
          ?? String(BigInt(sourceRow.current_remap_revision) + 1n),
        food_id: input.targetFoodId ?? "",
        supplement_id: "",
        target_fingerprint: targetFingerprint,
        match_method: input.matchMethod,
        source_id_namespace: input.sourceIdNamespace ?? "",
        review_note: input.reviewNote ?? "",
      };
    }

    async function currentState(sourceId: string): Promise<{
      food_id: string | null;
      imported_at: string;
      match_method: string;
      remap_revision: string;
    }> {
      const result = await client.query<{
        food_id: string | null;
        imported_at: Date;
        match_method: string;
        remap_revision: string;
      }>(`
        SELECT
          food_id,
          match_method,
          MIN(imported_at) AS imported_at,
          MIN(remap_revision)::text AS remap_revision
        FROM ${schemaName}.product_tests
        WHERE source_key = 'catalog' AND tested_source_product_id = $1
        GROUP BY food_id, match_method
      `, [sourceId]);
      const row = result.rows[0];
      if (!row) throw new Error("missing current-state fixture");
      return {
        food_id: row.food_id,
        imported_at: row.imported_at.toISOString(),
        match_method: row.match_method,
        remap_revision: row.remap_revision,
      };
    }

    async function manifestNames(): Promise<Set<string>> {
      try {
        return new Set(await readdir(".product-tests-work/product-test-remaps/manifests"));
      } catch {
        return new Set();
      }
    }
  },
);

function serializeRemaps(rows: RemapRow[]): string {
  return `${[
    remapHeader.join("\t"),
    ...rows.map((row) => remapHeader.map((column) => row[column]).join("\t")),
  ].join("\n")}\n`;
}

function parseTsv(text: string): Record<string, string>[] {
  const parsedRows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === "\"") {
      quoted = true;
    } else if (character === "\t") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      parsedRows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }

  const [header, ...dataRows] = parsedRows;
  if (!header) return [];
  return dataRows
    .filter((fields) => fields.some(Boolean))
    .map((fields) => Object.fromEntries(
      header.map((column, index) => [column, fields[index] ?? ""]),
    ));
}
