import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createProductLabelsQueries } from "../src/lib/product-labels";

const TEST_DATABASE_ENV = "MURPH_SUPPLEMENT_SEARCH_TEST_DB_URL";
const testDatabaseUrl = process.env[TEST_DATABASE_ENV]?.trim() || null;

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

describe("product-test measurement metadata contract", () => {
  it("keeps bounded results, sample provenance, and source discovery in the schema", async () => {
    const schema = await readFile(
      new URL("../sql/product-tests/schema.sql", import.meta.url),
      "utf8",
    );
    const openImport = await readFile(
      new URL(
        "../sql/product-tests/import-open-product-sources.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const sourceOnlyImport = await readFile(
      new URL(
        "../sql/product-tests/import-source-only-product-tests-body.sql",
        import.meta.url,
      ),
      "utf8",
    );

    for (const column of [
      "evidence_type",
      "sampling_context",
      "tested_product_upc_raw",
      "source_sample_id",
      "source_sample_count",
      "tested_lot_code",
      "tested_best_by",
      "tested_package_size",
      "collected_on",
      "tested_on",
      "result_upper_value",
      "normalized_upper_value",
      "result_qualifier",
      "detection_limit_value",
      "detection_limit_unit",
      "quantification_limit_value",
      "quantification_limit_unit",
      "reporting_limit_value",
      "reporting_limit_unit",
      "uncertainty_value",
      "uncertainty_unit",
    ]) {
      expect(schema).toContain(column);
      expect(openImport).toContain(column);
      expect(sourceOnlyImport).toContain(column);
    }

    expect(schema).toContain("'regulatory_laboratory'");
    expect(schema).toContain("'regulatory_finding'");
    expect(schema).toContain("'xrf_screening'");
    expect(schema).toContain("'manufacturer_coa'");
    expect(schema).toContain(
      "CREATE OR REPLACE FUNCTION murph_product_test_valid_gtin",
    );
    expect(schema).toContain(
      "CREATE OR REPLACE FUNCTION murph_product_test_canonical_gtin",
    );
    expect(schema).toContain(
      "THEN lpad(candidate, 14, '0')",
    );
    expect(schema).toContain(
      "OR murph_product_test_valid_gtin(tested_product_upc)",
    );
    expect(schema).toContain("result_operator = 'range'");
    expect(schema).toContain("result_value <= result_upper_value");
    expect(schema).toContain("normalized_value <= normalized_upper_value");
    expect(schema).toContain(
      "source_sample_count IS NULL OR source_sample_count > 0",
    );
    expect(schema).toContain("CREATE INDEX IF NOT EXISTS product_tests_source_key_idx");
    expect(schema).toMatch(
      /murph_product_test_legacy_source_backed_origin\(\s+source_food\.data_origin/u,
    );
    expect(schema).toMatch(
      /murph_product_test_legacy_source_backed_origin\(\s+source_supplement\.data_origin/u,
    );
    expect(sourceOnlyImport).toContain("source_only_product_test_group_links");
    expect(sourceOnlyImport).toContain("existing.remap_revision");
    expect(sourceOnlyImport).toContain(
      "remap_revision = group_links.remap_revision",
    );
    expect(sourceOnlyImport).toContain(
      "source_only_product_test_group_high_watermarks",
    );
    expect(sourceOnlyImport).toContain(
      "product_tests.match_method = 'source_only'",
    );
    expect(sourceOnlyImport).toContain(
      "product_tests.result_upper_value IS DISTINCT FROM EXCLUDED.result_upper_value",
    );
    expect(sourceOnlyImport).toContain(
      "existing.tested_product_upc_raw IS NOT DISTINCT FROM incoming.tested_product_upc_raw",
    );
    expect(sourceOnlyImport).toContain(
      "grouped multiple product identities under one source product id",
    );
  });
});

describe.runIf(Boolean(testDatabaseUrl))(
  "product-test metadata PostgreSQL contract",
  () => {
    const schemaName = `product_test_metadata_${randomUUID().replaceAll("-", "")}`;
    const client = new pg.Client({ connectionString: testDatabaseUrl ?? undefined });
    let importBody = "";
    let schemaSql = "";

    beforeAll(async () => {
      await client.connect();
      await client.query(`CREATE SCHEMA ${schemaName}`);
      await client.query(`SET search_path TO ${schemaName}, public`);
      await client.query(`
        CREATE TABLE foods (
          id TEXT PRIMARY KEY,
          canonical_key TEXT,
          data_origin TEXT NOT NULL,
          data_origin_id TEXT,
          data_origin_priority SMALLINT NOT NULL DEFAULT 100,
          name TEXT,
          brand TEXT,
          upc TEXT,
          off_market BOOLEAN NOT NULL DEFAULT FALSE,
          label JSONB NOT NULL DEFAULT '{}'::jsonb,
          serving_grams NUMERIC
        );
        CREATE TABLE supplements (
          id TEXT PRIMARY KEY,
          canonical_key TEXT,
          data_origin TEXT NOT NULL,
          data_origin_id TEXT,
          data_origin_priority SMALLINT NOT NULL DEFAULT 100,
          name TEXT,
          brand TEXT,
          upc TEXT,
          off_market BOOLEAN NOT NULL DEFAULT FALSE,
          label JSONB NOT NULL DEFAULT '{}'::jsonb,
          serving_grams NUMERIC
        );
      `);

      schemaSql = await readFile(
        new URL("../sql/product-tests/schema.sql", import.meta.url),
        "utf8",
      );
      await client.query(schemaSql);
      await client.query(schemaSql);

      importBody = await readFile(
        new URL(
          "../sql/product-tests/import-source-only-product-tests-body.sql",
          import.meta.url,
        ),
        "utf8",
      );
    });

    afterAll(async () => {
      await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await client.end();
    });

    beforeEach(async () => {
      await client.query(
        "TRUNCATE product_tests, contaminant_thresholds, foods, supplements",
      );
    });

    it("carries one consistent reviewed link to new observations without replay churn", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc,
          tested_product_upc_raw, tested_source_product_id, match_method, contaminant_key,
          contaminant_name, result_operator, result_value, result_unit,
          result_basis, normalized_value, normalized_unit, normalized_basis,
          imported_at
        ) VALUES (
          'catalog:old:lead', 'target-food', 'catalog', 'old', 'Catalog',
          'Ground Cinnamon', 'Example Spice', NULL, '12345678901', 'product-1',
          'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm',
          'product_mass', 1, 'ppm', 'product_mass', '2000-01-01'
        );
      `);

      await runImport([
        {
          id: "catalog:old:lead",
          sourceResultId: "old",
          contaminantKey: "lead",
          contaminantName: "Lead",
          lotCode: "LOT-A",
          resultValue: "1",
        },
        {
          id: "catalog:new:cadmium",
          sourceResultId: "new",
          contaminantKey: "cadmium",
          contaminantName: "Cadmium",
          lotCode: "LOT-B",
          resultValue: "0.2",
        },
      ]);

      const first = await client.query<{
        food_id: string | null;
        imported_at: Date;
        match_method: string;
        source_result_id: string;
        source_sample_count: number | null;
        tested_lot_code: string | null;
        tested_product_upc_raw: string | null;
      }>(`
        SELECT
          source_result_id,
          food_id,
          match_method,
          source_sample_count,
          tested_lot_code,
          tested_product_upc_raw,
          imported_at
        FROM product_tests
        WHERE source_key = 'catalog'
        ORDER BY source_result_id
      `);

      expect(first.rows).toMatchObject([
        {
          source_result_id: "new",
          food_id: "target-food",
          match_method: "manual_confirmed",
          source_sample_count: 6,
          tested_lot_code: "LOT-B",
          tested_product_upc_raw: "12345678901",
        },
        {
          source_result_id: "old",
          food_id: "target-food",
          match_method: "manual_confirmed",
          source_sample_count: 6,
          tested_lot_code: "LOT-A",
          tested_product_upc_raw: "12345678901",
        },
      ]);

      await runImport([
        {
          id: "catalog:old:lead",
          sourceResultId: "old",
          contaminantKey: "lead",
          contaminantName: "Lead",
          lotCode: "LOT-A",
          resultValue: "1",
        },
        {
          id: "catalog:new:cadmium",
          sourceResultId: "new",
          contaminantKey: "cadmium",
          contaminantName: "Cadmium",
          lotCode: "LOT-B",
          resultValue: "0.2",
        },
      ]);

      const replay = await client.query<{
        imported_at: Date;
        source_result_id: string;
      }>(`
        SELECT source_result_id, imported_at
        FROM product_tests
        WHERE source_key = 'catalog'
        ORDER BY source_result_id
      `);
      expect(replay.rows).toEqual(
        first.rows.map((row) => ({
          source_result_id: row.source_result_id,
          imported_at: row.imported_at,
        })),
      );
    });

    it("rejects unordered bounded results", async () => {
      await expect(client.query(`
        INSERT INTO product_tests (
          id, source_key, source_result_id, source_name, match_method,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_upper_value, result_unit, result_basis
        ) VALUES (
          'catalog:bad:lead', 'catalog', 'bad', 'Catalog', 'source_only',
          'lead', 'Lead', 'range', 2, 1, 'ppm', 'product_mass'
        )
      `)).rejects.toMatchObject({ code: "23514" });
    });

    it("stores regulatory findings separately from laboratory evidence", async () => {
      await client.query(`
        INSERT INTO product_tests (
          id, source_key, source_result_id, source_name, evidence_type,
          sampling_context, match_method, contaminant_key, contaminant_name,
          result_operator, result_unit, result_basis
        ) VALUES (
          'catalog:finding:undeclared-drug', 'catalog', 'finding', 'Catalog',
          'regulatory_finding', 'regulatory_enforcement_table', 'source_only',
          'undeclared_drug', 'Undeclared active ingredient', 'detected',
          'presence', 'regulatory_finding'
        )
      `);

      const stored = await client.query<{ evidence_type: string }>(`
        SELECT evidence_type
        FROM product_tests
        WHERE id = 'catalog:finding:undeclared-drug'
      `);
      expect(stored.rows).toEqual([{ evidence_type: "regulatory_finding" }]);
    });

    it("keeps real label origins visible when a source key collides", async () => {
      await client.query(`
        INSERT INTO foods (
          id, canonical_key, data_origin, data_origin_id, name, off_market, label
        ) VALUES (
          'usda:collision', 'usda:collision', 'usda_branded', 'collision',
          'Collision Food', false, '{}'::jsonb
        );

        INSERT INTO product_tests (
          id, source_key, source_result_id, source_name, match_method,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES (
          'usda-source:collision:lead', 'usda_branded', 'collision',
          'Colliding source', 'source_only', 'lead', 'Lead', 'eq', 1,
          'ppm', 'product_mass'
        );
      `);

      await client.query(schemaSql);

      const result = await createFoodsRuntimeQueries().getById({
        id: "usda:collision",
        includeOffMarket: false,
      });
      expect(result).toMatchObject({
        id: "usda:collision",
        dataOrigin: "usda_branded",
      });
    });

    it("keeps a straddled range unknown ahead of a definitely-below threshold", async () => {
      await client.query(`
        INSERT INTO foods (
          id, canonical_key, data_origin, data_origin_id, name, off_market, label
        ) VALUES (
          'brand:range', 'brand:range', 'brand_site', 'range',
          'Range Food', false, '{}'::jsonb
        );

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          evidence_type, sampling_context, match_method, contaminant_key,
          contaminant_name, result_operator, result_value, result_upper_value,
          result_unit, result_basis, normalized_value, normalized_upper_value,
          normalized_unit, normalized_basis
        ) VALUES (
          'catalog:range:lead', 'brand:range', 'catalog', 'range', 'Catalog',
          'laboratory_measurement', 'retail_sampling', 'manual_confirmed',
          'lead', 'Lead', 'range', 1, 3, 'ppm', 'product_mass', 1, 3,
          'ppm', 'product_mass'
        );

        INSERT INTO contaminant_thresholds (
          id, contaminant_key, threshold_name, authority_key, authority_name,
          threshold_value, threshold_unit, threshold_basis, normalized_value,
          normalized_unit, normalized_basis, concern_level_if_exceeded, active
        ) VALUES
          (
            'range-low-2', 'lead', 'Low threshold', 'authority', 'Authority',
            2, 'ppm', 'product_mass', 2, 'ppm', 'product_mass', 'low', true
          ),
          (
            'range-high-4', 'lead', 'High threshold', 'authority', 'Authority',
            4, 'ppm', 'product_mass', 4, 'ppm', 'product_mass', 'high', true
          );
      `);

      const result = await createFoodsRuntimeQueries().getById({
        id: "brand:range",
        includeOffMarket: false,
      });
      expect(result?.contaminants).toMatchObject({
        status: "known_product_tests",
        murphConcernLevel: "unknown",
        alertCount: 0,
        observationCount: 1,
      });
    });

    it("carries a reviewed link through complete source-result replacement", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc,
          tested_product_upc_raw, tested_source_product_id, match_method, contaminant_key,
          contaminant_name, result_operator, result_value, result_unit,
          result_basis, remap_revision
        ) VALUES (
          'catalog:retired:lead', 'target-food', 'catalog', 'retired', 'Catalog',
          'Ground Cinnamon', 'Example Spice', NULL, '12345678901', 'product-1',
          'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass', 7
        );
      `);

      await runImport([{
        id: "catalog:replacement:cadmium",
        sourceResultId: "replacement",
        contaminantKey: "cadmium",
        contaminantName: "Cadmium",
        lotCode: "LOT-B",
        resultValue: "0.2",
      }], { replaceSource: true });

      const result = await client.query<{
        food_id: string | null;
        match_method: string;
        remap_revision: string;
        source_result_id: string;
      }>(`
        SELECT source_result_id, food_id, match_method, remap_revision::text
        FROM product_tests
        WHERE source_key = 'catalog'
      `);
      expect(result.rows).toEqual([{
        source_result_id: "replacement",
        food_id: "target-food",
        match_method: "manual_confirmed",
        remap_revision: "7",
      }]);
    });

    it("carries an explicit reviewed source-only generation to later observations", async () => {
      await client.query(`
        INSERT INTO product_tests (
          id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, match_method, remap_revision,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES (
          'catalog:old:lead', 'catalog', 'old', 'Catalog',
          'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
          'source_only', 4, 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass'
        )
      `);

      await runImport([{
        id: "catalog:new:cadmium",
        sourceResultId: "new",
        contaminantKey: "cadmium",
        contaminantName: "Cadmium",
        lotCode: "LOT-B",
        resultValue: "0.2",
      }]);

      const generations = await client.query<{
        match_methods: string;
        remap_revisions: string;
      }>(`
        SELECT
          COUNT(DISTINCT match_method)::text AS match_methods,
          string_agg(DISTINCT remap_revision::text, ',' ORDER BY remap_revision::text)
            AS remap_revisions
        FROM product_tests
        WHERE source_key = 'catalog' AND tested_source_product_id = 'product-1'
      `);
      expect(generations.rows).toEqual([{
        match_methods: "1",
        remap_revisions: "4",
      }]);
    });

    it("preserves rows omitted from a later additive snapshot", async () => {
      const rows = [
        {
          id: "source-a:a1:lead",
          sourceKey: "source_a",
          sourceResultId: "a1",
          contaminantKey: "lead",
          contaminantName: "Lead",
          lotCode: "LOT-A1",
          resultValue: "1",
        },
        {
          id: "source-a:a2:cadmium",
          sourceKey: "source_a",
          sourceResultId: "a2",
          contaminantKey: "cadmium",
          contaminantName: "Cadmium",
          lotCode: "LOT-A2",
          resultValue: "0.2",
        },
      ];

      await runImport(rows);
      await runImport([rows[0]]);

      const imported = await client.query<{
        source_result_id: string;
      }>(`
        SELECT source_result_id
        FROM product_tests
        WHERE source_key = 'source_a'
        ORDER BY source_result_id
      `);
      expect(imported.rows).toEqual([
        { source_result_id: "a1" },
        { source_result_id: "a2" },
      ]);
    });

    it("keeps single-source replacement compatible without an open-source manifest", async () => {
      await runImport([{
        id: "plasticlist:one:lead",
        sourceKey: "plasticlist_bay_area_2024",
        sourceResultId: "one",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-A",
        resultValue: "1",
      }], {
        replaceSource: true,
      });

      const imported = await client.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM product_tests
        WHERE source_key = 'plasticlist_bay_area_2024'
      `);
      expect(imported.rows).toEqual([{ count: "1" }]);
    });

    it("rejects inconsistent reviewed targets without discarding them", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES
          ('target-food-1', 'brand_site'),
          ('target-food-2', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc,
          tested_product_upc_raw, tested_source_product_id, match_method, contaminant_key,
          contaminant_name, result_operator, result_value, result_unit,
          result_basis
        ) VALUES
          (
            'catalog:old-1:lead', 'target-food-1', 'catalog', 'old-1', 'Catalog',
            'Ground Cinnamon', 'Example Spice', NULL, '12345678901', 'product-1',
            'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass'
          ),
          (
            'catalog:old-2:cadmium', 'target-food-2', 'catalog', 'old-2', 'Catalog',
            'Ground Cinnamon', 'Example Spice', NULL, '12345678901', 'product-1',
            'manual_confirmed', 'cadmium', 'Cadmium', 'eq', 0.2, 'ppm', 'product_mass'
          );
      `);

      await expect(runImport([{
        id: "catalog:replacement:arsenic",
        sourceResultId: "replacement",
        contaminantKey: "arsenic",
        contaminantName: "Arsenic",
        lotCode: "LOT-C",
        resultValue: "0.1",
      }], { replaceSource: true })).rejects.toThrow(
        "inconsistent reviewed links for one source product identity",
      );

      const converged = await client.query<{
        count: string;
        linked: string;
      }>(`
        SELECT
          COUNT(*)::text AS count,
          COUNT(*) FILTER (WHERE match_method <> 'source_only')::text AS linked
        FROM product_tests
        WHERE source_key = 'catalog'
      `);
      expect(converged.rows).toEqual([{ count: "2", linked: "2" }]);
    });

    it("converges a mixed linked/source-only group on its reviewed target", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, match_method, contaminant_key,
          contaminant_name, result_operator, result_value, result_unit,
          result_basis, remap_revision
        ) VALUES
          (
            'catalog:old-1:lead', 'target-food', 'catalog', 'old-1', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
            'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass', 7
          ),
          (
            'catalog:old-2:cadmium', NULL, 'catalog', 'old-2', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
            'source_only', 'cadmium', 'Cadmium', 'eq', 0.2, 'ppm',
            'product_mass', 0
          );
      `);

      await runImport([{
        id: "catalog:new:arsenic",
        sourceResultId: "new",
        contaminantKey: "arsenic",
        contaminantName: "Arsenic",
        lotCode: "LOT-C",
        resultValue: "0.1",
      }]);

      const state = await client.query<{
        linked: string;
        revisions: string;
        rows: string;
        target_states: string;
      }>(`
        SELECT
          COUNT(*)::text AS rows,
          COUNT(*) FILTER (WHERE match_method <> 'source_only')::text AS linked,
          COUNT(DISTINCT remap_revision)::text AS revisions,
          COUNT(DISTINCT jsonb_build_array(
            food_id,
            supplement_id,
            match_method
          ))::text AS target_states
        FROM product_tests
        WHERE source_key = 'catalog' AND tested_source_product_id = 'product-1'
      `);
      expect(state.rows).toEqual([{
        rows: "3",
        linked: "3",
        revisions: "1",
        target_states: "1",
      }]);
    });

    it("rejects partial additive identity replacement for a reused source id", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, match_method, contaminant_key,
          contaminant_name, result_operator, result_value, result_unit,
          result_basis
        ) VALUES (
          'catalog:old:lead', 'target-food', 'catalog', 'old', 'Catalog',
          'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
          'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass'
        );
      `);

      await expect(runImport([{
        id: "catalog:new:cadmium",
        sourceResultId: "new",
        contaminantKey: "cadmium",
        contaminantName: "Cadmium",
        lotCode: "LOT-B",
        resultValue: "0.2",
        testedProductName: "Different Cinnamon",
      }])).rejects.toThrow(
        "identity drift requires a complete source-product snapshot",
      );

      const unchanged = await client.query<{
        food_id: string | null;
        match_method: string;
      }>(`
        SELECT food_id, match_method FROM product_tests
      `);
      expect(unchanged.rows).toEqual([{
        food_id: "target-food",
        match_method: "manual_confirmed",
      }]);
    });

    it("keeps invalid reported UPCs out of the canonical GTIN field", async () => {
      const validity = await client.query<{
        invalid: boolean;
        valid: boolean;
      }>(`
        SELECT
          murph_product_test_valid_gtin('036000291452') AS valid,
          murph_product_test_valid_gtin('036000291453') AS invalid
      `);
      expect(validity.rows).toEqual([{ valid: true, invalid: false }]);

      await expect(client.query(`
        INSERT INTO product_tests (
          id, source_key, source_result_id, source_name,
          tested_product_upc, tested_product_upc_raw, match_method,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES (
          'catalog:invalid-upc:lead', 'catalog', 'invalid-upc', 'Catalog',
          '036000291453', '036000291453', 'source_only',
          'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass'
        )
      `)).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects multiple incoming identities for one source product id", async () => {
      await expect(runImport([
        {
          id: "catalog:identity-1:lead",
          sourceResultId: "identity-1",
          contaminantKey: "lead",
          contaminantName: "Lead",
          lotCode: "LOT-A",
          resultValue: "1",
        },
        {
          id: "catalog:identity-2:cadmium",
          sourceResultId: "identity-2",
          contaminantKey: "cadmium",
          contaminantName: "Cadmium",
          lotCode: "LOT-B",
          resultValue: "0.2",
          testedProductName: "Different Cinnamon",
        },
      ])).rejects.toThrow(
        "grouped multiple product identities under one source product id",
      );

      const unchanged = await client.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count FROM product_tests
      `);
      expect(unchanged.rows).toEqual([{ count: "0" }]);
    });

    it("moves legacy invalid canonical UPCs into the raw reported field", async () => {
      await client.query(`
        ALTER TABLE product_tests
          DROP CONSTRAINT product_tests_tested_product_upc_check;
        ALTER TABLE product_tests
          DROP COLUMN remap_revision;

        INSERT INTO product_tests (
          id, source_key, source_result_id, source_name,
          tested_product_upc, match_method, contaminant_key,
          contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES (
          'catalog:legacy-upc:lead', 'catalog', 'legacy-upc', 'Catalog',
          ' 036000291453 ', 'source_only', 'lead',
          'Lead', 'eq', 1, 'ppm', 'product_mass'
        );
      `);

      await client.query(schemaSql);

      const migrated = await client.query<{
        tested_product_upc: string | null;
        tested_product_upc_raw: string | null;
      }>(`
        SELECT tested_product_upc, tested_product_upc_raw
        FROM product_tests
        WHERE id = 'catalog:legacy-upc:lead'
      `);
      expect(migrated.rows).toEqual([{
        tested_product_upc: null,
        tested_product_upc_raw: "036000291453",
      }]);
    });

    it("demotes an entire legacy group before erasing invalid exact-UPC proof", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        ALTER TABLE product_tests
          DROP CONSTRAINT product_tests_tested_product_upc_check;

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_upc, tested_source_product_id,
          match_method, contaminant_key, contaminant_name, result_operator,
          result_value, result_unit, result_basis, remap_revision
        ) VALUES
          (
            'catalog:legacy:lead', 'target-food', 'catalog', 'legacy-lead',
            'Catalog', 'Legacy Product', '036000291453', 'product-1',
            'exact_upc', 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass', 5
          ),
          (
            'catalog:legacy:cadmium', 'target-food', 'catalog', 'legacy-cadmium',
            'Catalog', 'Legacy Product', '036000291453', 'product-1',
            'manual_confirmed', 'cadmium', 'Cadmium', 'eq', 0.2, 'ppm',
            'product_mass', 7
          );
      `);

      await client.query(schemaSql);

      const migrated = await client.query<{
        food_id: string | null;
        match_method: string;
        remap_revision: string;
        tested_product_upc: string | null;
        tested_product_upc_raw: string | null;
      }>(`
        SELECT
          food_id,
          match_method,
          remap_revision::text,
          tested_product_upc,
          tested_product_upc_raw
        FROM product_tests
        WHERE source_key = 'catalog'
        ORDER BY contaminant_key
      `);
      expect(migrated.rows).toEqual([
        {
          food_id: null,
          match_method: "source_only",
          remap_revision: "7",
          tested_product_upc: null,
          tested_product_upc_raw: "036000291453",
        },
        {
          food_id: null,
          match_method: "source_only",
          remap_revision: "7",
          tested_product_upc: null,
          tested_product_upc_raw: "036000291453",
        },
      ]);
    });

    it("demotes a reviewed link when the product identity actually changes", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc,
          tested_product_upc_raw, tested_source_product_id, match_method, contaminant_key,
          contaminant_name, result_operator, result_value, result_unit,
          result_basis, remap_revision
        ) VALUES (
          'catalog:old:lead', 'target-food', 'catalog', 'old', 'Catalog',
          'Ground Cinnamon', 'Example Spice', NULL, '12345678901', 'product-1',
          'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass', 7
        );
      `);

      await runImport([
        {
          id: "catalog:old:lead",
          sourceResultId: "old",
          contaminantKey: "lead",
          contaminantName: "Lead",
          lotCode: "LOT-A",
          resultValue: "1",
          testedProductName: "Different Cinnamon",
        },
      ]);

      const result = await client.query<{
        food_id: string | null;
        match_method: string;
        remap_revision: string;
        tested_product_name: string | null;
      }>(`
        SELECT food_id, match_method, remap_revision::text, tested_product_name
        FROM product_tests
        WHERE source_key = 'catalog' AND source_result_id = 'old'
      `);
      expect(result.rows).toEqual([
        {
          food_id: null,
          match_method: "source_only",
          remap_revision: "7",
          tested_product_name: "Different Cinnamon",
        },
      ]);
    });

    it("retains the reviewed high-watermark through complete identity replacement and restoration", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, match_method, remap_revision,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES
          (
            'catalog:old:lead', 'target-food', 'catalog', 'old', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
            'manual_confirmed', 5, 'lead', 'Lead', 'eq', 1, 'ppm',
            'product_mass'
          ),
          (
            'catalog:prior:cadmium', NULL, 'catalog', 'prior', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
            'source_only', 7, 'cadmium', 'Cadmium', 'eq', 0.2, 'ppm',
            'product_mass'
          );
      `);

      await runImport([{
        id: "catalog:replacement:lead",
        sourceResultId: "replacement",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-B",
        resultValue: "1",
        testedProductName: "Different Cinnamon",
      }], { replaceSource: true });
      await runImport([{
        id: "catalog:restored:lead",
        sourceResultId: "restored",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-C",
        resultValue: "1",
      }], { replaceSource: true });

      const restored = await client.query<{
        food_id: string | null;
        match_method: string;
        remap_revision: string;
        source_result_id: string;
        tested_product_name: string | null;
      }>(`
        SELECT
          source_result_id,
          food_id,
          match_method,
          remap_revision::text,
          tested_product_name
        FROM product_tests
        WHERE source_key = 'catalog'
      `);
      expect(restored.rows).toEqual([{
        source_result_id: "restored",
        food_id: null,
        match_method: "source_only",
        remap_revision: "7",
        tested_product_name: "Ground Cinnamon",
      }]);
    });

    it("retains the maximum generation when a stable observation moves between source-product groups", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES
          ('target-a', 'brand_site'),
          ('target-b', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, match_method, remap_revision,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES
          (
            'catalog:stable:lead', 'target-a', 'catalog', 'stable', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-a',
            'manual_confirmed', 2, 'lead', 'Lead', 'eq', 1, 'ppm',
            'product_mass'
          ),
          (
            'catalog:b:cadmium', 'target-b', 'catalog', 'b-cadmium', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-b',
            'manual_confirmed', 1, 'cadmium', 'Cadmium', 'eq', 0.2, 'ppm',
            'product_mass'
          ),
          (
            'catalog:b:arsenic', 'target-b', 'catalog', 'b-arsenic', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-b',
            'manual_confirmed', 1, 'arsenic', 'Arsenic', 'eq', 0.1, 'ppm',
            'product_mass'
          );
      `);

      const stableObservation = {
        id: "catalog:stable:lead",
        sourceResultId: "stable",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-A",
        resultValue: "1",
      };
      await runImport([{
        ...stableObservation,
        testedSourceProductId: "product-b",
      }]);

      const moved = await client.query<{
        food_ids: string;
        revisions: string;
        rows: string;
      }>(`
        SELECT
          COUNT(*)::text AS rows,
          string_agg(DISTINCT food_id, ',' ORDER BY food_id) AS food_ids,
          string_agg(
            DISTINCT remap_revision::text,
            ',' ORDER BY remap_revision::text
          ) AS revisions
        FROM product_tests
        WHERE source_key = 'catalog' AND tested_source_product_id = 'product-b'
      `);
      expect(moved.rows).toEqual([{
        rows: "3",
        food_ids: "target-b",
        revisions: "2",
      }]);

      await runImport([{
        ...stableObservation,
        testedSourceProductId: "product-a",
      }]);

      const restored = await client.query<{
        food_id: string | null;
        match_method: string;
        remap_revision: string;
      }>(`
        SELECT food_id, match_method, remap_revision::text
        FROM product_tests
        WHERE source_key = 'catalog' AND source_result_id = 'stable'
      `);
      expect(restored.rows).toEqual([{
        food_id: null,
        match_method: "source_only",
        remap_revision: "2",
      }]);

      const inconsistentGroups = await client.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM (
          SELECT source_key, tested_source_product_id
          FROM product_tests
          WHERE tested_source_product_id IS NOT NULL
          GROUP BY source_key, tested_source_product_id
          HAVING
            COUNT(DISTINCT jsonb_build_array(
              food_id,
              supplement_id,
              match_method
            )) > 1
            OR COUNT(DISTINCT remap_revision) > 1
        ) inconsistent
      `);
      expect(inconsistentGroups.rows).toEqual([{ count: "0" }]);
    });

    it("carries a moving generation into a source-only generation-zero group without replay churn", async () => {
      await client.query(`
        INSERT INTO product_tests (
          id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, match_method, remap_revision,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis, imported_at
        ) VALUES
          (
            'catalog:stable:lead', 'catalog', 'stable', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-a',
            'source_only', 2, 'lead', 'Lead', 'eq', 1, 'ppm',
            'product_mass', '2000-01-01'
          ),
          (
            'catalog:b:cadmium', 'catalog', 'b-cadmium', 'Catalog',
            'Ground Cinnamon', 'Example Spice', '12345678901', 'product-b',
            'source_only', 0, 'cadmium', 'Cadmium', 'eq', 0.2, 'ppm',
            'product_mass', '2001-01-01'
          );
      `);

      const movingObservation = {
        id: "catalog:stable:lead",
        sourceResultId: "stable",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-A",
        resultValue: "1",
        testedSourceProductId: "product-b",
      };
      await runImport([movingObservation]);

      const first = await client.query<{
        food_id: string | null;
        imported_at: Date;
        match_method: string;
        remap_revision: string;
        source_result_id: string;
      }>(`
        SELECT
          source_result_id,
          food_id,
          match_method,
          remap_revision::text,
          imported_at
        FROM product_tests
        WHERE source_key = 'catalog' AND tested_source_product_id = 'product-b'
        ORDER BY source_result_id
      `);
      expect(first.rows).toMatchObject([
        { food_id: null, match_method: "source_only", remap_revision: "2" },
        { food_id: null, match_method: "source_only", remap_revision: "2" },
      ]);

      await runImport([movingObservation]);
      const replay = await client.query<{
        imported_at: Date;
        source_result_id: string;
      }>(`
        SELECT source_result_id, imported_at
        FROM product_tests
        WHERE source_key = 'catalog' AND tested_source_product_id = 'product-b'
        ORDER BY source_result_id
      `);
      expect(replay.rows).toEqual(first.rows.map((row) => ({
        source_result_id: row.source_result_id,
        imported_at: row.imported_at,
      })));
    });

    it("preserves the group high-watermark when schema repair demotes a legacy target", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('legacy-target', 'plasticlist_bay_area_2024');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_source_product_id, match_method,
          remap_revision, contaminant_key, contaminant_name, result_operator,
          result_value, result_unit, result_basis
        ) VALUES
          (
            'catalog:legacy-target:lead', 'legacy-target', 'catalog',
            'legacy-target-lead', 'Catalog', 'Legacy Target', 'product-1',
            'manual_confirmed', 5, 'lead', 'Lead', 'eq', 1, 'ppm',
            'product_mass'
          ),
          (
            'catalog:legacy-target:cadmium', NULL, 'catalog',
            'legacy-target-cadmium', 'Catalog', 'Legacy Target', 'product-1',
            'source_only', 7, 'cadmium', 'Cadmium', 'eq', 0.2, 'ppm',
            'product_mass'
          );
      `);

      await client.query(schemaSql);

      const repaired = await client.query<{
        food_id: string | null;
        match_method: string;
        remap_revision: string;
      }>(`
        SELECT food_id, match_method, remap_revision::text
        FROM product_tests
        WHERE source_key = 'catalog'
        ORDER BY contaminant_key
      `);
      expect(repaired.rows).toEqual([
        { food_id: null, match_method: "source_only", remap_revision: "7" },
        { food_id: null, match_method: "source_only", remap_revision: "7" },
      ]);
    });

    it("preserves a same-result reviewed link when only the lot changes", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, tested_lot_code, tested_package_size,
          match_method, contaminant_key, contaminant_name, result_operator,
          result_value, result_unit, result_basis, remap_revision
        ) VALUES (
          'catalog:old:lead', 'target-food', 'catalog', 'old', 'Catalog',
          'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
          'LOT-A', '1 L', 'manual_confirmed', 'lead', 'Lead', 'eq', 1,
          'ppm', 'product_mass', 7
        );
      `);

      await runImport([{
        id: "catalog:old:lead",
        sourceResultId: "old",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-B",
        resultValue: "1",
        testedPackageSize: "1 L",
      }]);

      const result = await client.query<{
        food_id: string | null;
        match_method: string;
        remap_revision: string;
        tested_lot_code: string | null;
      }>(`
        SELECT food_id, match_method, remap_revision::text, tested_lot_code
        FROM product_tests
        WHERE source_key = 'catalog' AND source_result_id = 'old'
      `);
      expect(result.rows).toEqual([{
        food_id: "target-food",
        match_method: "manual_confirmed",
        remap_revision: "7",
        tested_lot_code: "LOT-B",
      }]);
    });

    it("demotes a same-result reviewed link when package identity changes", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc_raw,
          tested_source_product_id, tested_package_size, match_method,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES (
          'catalog:old:lead', 'target-food', 'catalog', 'old', 'Catalog',
          'Ground Cinnamon', 'Example Spice', '12345678901', 'product-1',
          '1 L', 'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm',
          'product_mass'
        );
      `);

      await runImport([{
        id: "catalog:old:lead",
        sourceResultId: "old",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-A",
        resultValue: "1",
        testedPackageSize: "500 mL",
      }]);

      const result = await client.query<{
        food_id: string | null;
        match_method: string;
        tested_package_size: string | null;
      }>(`
        SELECT food_id, match_method, tested_package_size
        FROM product_tests
        WHERE source_key = 'catalog' AND source_result_id = 'old'
      `);
      expect(result.rows).toEqual([{
        food_id: null,
        match_method: "source_only",
        tested_package_size: "500 mL",
      }]);
    });

    it("demotes a reviewed link when the reported UPC identity changes", async () => {
      await client.query(`
        INSERT INTO foods (id, data_origin)
        VALUES ('target-food', 'brand_site');

        INSERT INTO product_tests (
          id, food_id, source_key, source_result_id, source_name,
          tested_product_name, tested_product_brand, tested_product_upc,
          tested_product_upc_raw, tested_source_product_id, match_method,
          contaminant_key, contaminant_name, result_operator, result_value,
          result_unit, result_basis
        ) VALUES (
          'catalog:old:lead', 'target-food', 'catalog', 'old', 'Catalog',
          'Ground Cinnamon', 'Example Spice', NULL, 'reported-upc-v1', 'product-1',
          'manual_confirmed', 'lead', 'Lead', 'eq', 1, 'ppm', 'product_mass'
        );
      `);

      await runImport([{
        id: "catalog:old:lead",
        sourceResultId: "old",
        contaminantKey: "lead",
        contaminantName: "Lead",
        lotCode: "LOT-A",
        resultValue: "1",
        testedProductUpcRaw: "reported-upc-v2",
      }]);

      const result = await client.query<{
        food_id: string | null;
        match_method: string;
        tested_product_upc_raw: string | null;
      }>(`
        SELECT food_id, match_method, tested_product_upc_raw
        FROM product_tests
        WHERE source_key = 'catalog' AND source_result_id = 'old'
      `);
      expect(result.rows).toEqual([{
        food_id: null,
        match_method: "source_only",
        tested_product_upc_raw: "reported-upc-v2",
      }]);
    });

    function createFoodsRuntimeQueries() {
      return createProductLabelsQueries(
        {
          async query<T>(text: string, values: unknown[]) {
            const result = await client.query(text, values);
            return { rows: result.rows as T[] };
          },
        },
        "foods",
      );
    }

    async function runImport(rows: Array<{
      contaminantKey: string;
      contaminantName: string;
      id: string;
      lotCode: string;
      resultValue: string;
      sourceKey?: string;
      sourceResultId: string;
      testedPackageSize?: string;
      testedProductName?: string;
      testedProductUpcRaw?: string;
      testedSourceProductId?: string;
    }>, options: { replaceSource?: boolean } = {}): Promise<void> {
      await client.query("DROP TABLE IF EXISTS source_only_product_tests_import");
      await client.query(`
        CREATE TEMP TABLE source_only_product_tests_import (
          id TEXT NOT NULL,
          food_id TEXT,
          supplement_id TEXT,
          source_key TEXT NOT NULL,
          source_result_id TEXT NOT NULL,
          source_name TEXT NOT NULL,
          source_url TEXT,
          source_report_title TEXT,
          report_date TEXT,
          tested_product_name TEXT,
          tested_product_brand TEXT,
          tested_product_upc TEXT,
          tested_product_upc_raw TEXT,
          tested_source_product_id TEXT,
          evidence_type TEXT,
          sampling_context TEXT,
          source_sample_id TEXT,
          source_sample_count TEXT,
          tested_lot_code TEXT,
          tested_best_by TEXT,
          tested_package_size TEXT,
          collected_on TEXT,
          tested_on TEXT,
          match_method TEXT NOT NULL,
          contaminant_key TEXT NOT NULL,
          contaminant_name TEXT NOT NULL,
          result_operator TEXT NOT NULL,
          result_value TEXT,
          result_upper_value TEXT,
          result_unit TEXT NOT NULL,
          result_basis TEXT NOT NULL,
          normalized_value TEXT,
          normalized_upper_value TEXT,
          normalized_unit TEXT,
          normalized_basis TEXT,
          result_qualifier TEXT,
          detection_limit_value TEXT,
          detection_limit_unit TEXT,
          quantification_limit_value TEXT,
          quantification_limit_unit TEXT,
          reporting_limit_value TEXT,
          reporting_limit_unit TEXT,
          uncertainty_value TEXT,
          uncertainty_unit TEXT,
          lab_name TEXT,
          test_method TEXT
        )
      `);

      for (const row of rows) {
        await client.query(`
          INSERT INTO source_only_product_tests_import (
            id, source_key, source_result_id, source_name,
            tested_product_name, tested_product_brand, tested_product_upc,
            tested_product_upc_raw, tested_source_product_id, evidence_type,
            sampling_context, source_sample_count, tested_lot_code,
            tested_package_size,
            match_method, contaminant_key, contaminant_name,
            result_operator, result_value, result_unit, result_basis,
            normalized_value, normalized_unit, normalized_basis
          ) VALUES (
            $1, $9, $2, 'Catalog',
            $7, 'Example Spice', NULL,
            $8, $11, 'regulatory_laboratory',
            'targeted_market_sampling', '6', $3, $10, 'source_only', $4, $5,
            'eq', $6, 'ppm', 'product_mass', $6, 'ppm', 'product_mass'
          )
        `, [
          row.id,
          row.sourceResultId,
          row.lotCode,
          row.contaminantKey,
          row.contaminantName,
          row.resultValue,
          row.testedProductName ?? "Ground Cinnamon",
          row.testedProductUpcRaw ?? "12345678901",
          row.sourceKey ?? "catalog",
          row.testedPackageSize ?? null,
          row.testedSourceProductId ?? "product-1",
        ]);
      }

      const renderedImportBody = importBody
        .replace(
          ":'replace_source'::boolean",
          `${options.replaceSource === true}::boolean`,
        )
        .replace(
          "NULLIF(:'replace_source_expected_product_test_rows', '')::integer",
          options.replaceSource === true
            ? `${rows.length}::integer`
            : "NULL::integer",
        );
      await client.query(renderedImportBody);
      await client.query("DROP TABLE source_only_product_tests_import");
    }
  },
);
