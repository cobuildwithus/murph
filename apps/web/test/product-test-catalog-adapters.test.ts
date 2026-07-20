import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  adaptKingCountyRows,
  adaptNycRows,
  adaptPureEarthRows,
  assertSyncManagedSourcesPresent,
  pureEarthSourceRowId,
} from "../sql/product-tests/product-test-source-adapters";
import {
  PRODUCT_TEST_HEADERS,
  type JsonRecord,
} from "../sql/product-tests/product-test-catalog-types";

const FIXTURE_ROOT = new URL("../sql/product-tests/fixtures/", import.meta.url);

describe("product-test catalog adapters", () => {
  it("uses the additive fidelity fields in the shared CSV order", () => {
    expect(PRODUCT_TEST_HEADERS.indexOf("tested_product_upc_raw")).toBe(
      PRODUCT_TEST_HEADERS.indexOf("tested_product_upc") + 1,
    );
    expect(PRODUCT_TEST_HEADERS.indexOf("source_sample_count")).toBe(
      PRODUCT_TEST_HEADERS.indexOf("source_sample_id") + 1,
    );
    expect(PRODUCT_TEST_HEADERS.indexOf("result_upper_value")).toBe(
      PRODUCT_TEST_HEADERS.indexOf("result_value") + 1,
    );
    expect(PRODUCT_TEST_HEADERS.indexOf("normalized_upper_value")).toBe(
      PRODUCT_TEST_HEADERS.indexOf("normalized_value") + 1,
    );
  });

  it("keeps generated CSV columns aligned with the SQL import table", async () => {
    const importSql = await readFile(
      new URL(
        "../sql/product-tests/import-open-product-sources.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const importColumns = importSql.match(
      /CREATE TEMP TABLE source_only_product_tests_import \(\n(?<columns>[\s\S]*?)\n\) ON COMMIT DROP;/u,
    )?.groups?.columns
      .split("\n")
      .map((line) => line.trim().match(/^(?<column>[a-z_]+)/u)?.groups?.column)
      .filter((column): column is string => column !== undefined);

    expect(importColumns).toEqual(PRODUCT_TEST_HEADERS);
  });

  it("fails generation when any sync-managed source produces zero rows", async () => {
    const existing = await existingSourceFixture();
    const outputs = [
      adaptNycRows(existing.nyc),
      adaptKingCountyRows(existing.kingCounty),
      adaptPureEarthRows(existing.pureEarth),
    ];
    const rows = outputs.flatMap((output) => output.rows);

    expect(() => assertSyncManagedSourcesPresent(rows)).not.toThrow();
    expect(() =>
      assertSyncManagedSourcesPresent(
        rows.filter((row) => row.source_key !== "pure_earth_rms_2024"),
      )
    ).toThrow(
      "Product-test sync produced zero rows for managed sources: pure_earth_rms_2024",
    );
  });

  it("preserves existing open-source transformations and skips identityless rows", async () => {
    const fixture = await existingSourceFixture();
    const nyc = adaptNycRows(fixture.nyc);
    const kingCounty = adaptKingCountyRows(fixture.kingCounty);
    const pureEarth = adaptPureEarthRows(fixture.pureEarth);

    expect(nyc.rows).toHaveLength(1);
    expect(nyc.rows[0]).toMatchObject({
      collected_on: "2025-02-03",
      normalized_unit: "ppm",
      normalized_value: "1.2",
      test_method: "ICP-MS",
    });
    expect(nyc.skipped).toMatchObject({
      ineligible_product_type: 1,
      missing_product_identity: 1,
    });

    expect(kingCounty.rows).toHaveLength(1);
    expect(kingCounty.rows[0]).toMatchObject({
      result_operator: "lt",
      result_qualifier: "<LOD",
      source_sample_id: "king-1",
    });
    expect(kingCounty.skipped.missing_product_identity).toBe(1);

    expect(pureEarth.rows).toHaveLength(1);
    expect(pureEarth.rows[0]).toMatchObject({
      evidence_type: "xrf_screening",
      source_sample_id: "pure-1",
      test_method: "XRF screening",
    });
  });

  it("keeps Pure Earth natural keys independent of readings and measurement counts", () => {
    const identity: JsonRecord = {
      "Item ID": "stable-item",
      "Sample type category": "7",
      "Sample description": "Example Seasoning",
      Spice_category: "seasoning",
      Country: "Example Country",
      City: "Example City",
      "Highest XRF reading": "1",
      "Number of measurements": "1",
    };
    const changedMeasurement: JsonRecord = {
      ...identity,
      "Highest XRF reading": "99",
      "Number of measurements": "8",
    };
    expect(pureEarthSourceRowId(identity)).toBe(pureEarthSourceRowId(changedMeasurement));
  });
});

async function fixtureText(name: string): Promise<string> {
  return readFile(new URL(name, FIXTURE_ROOT), "utf8");
}

async function existingSourceFixture(): Promise<{
  nyc: JsonRecord[];
  kingCounty: JsonRecord[];
  pureEarth: JsonRecord[];
}> {
  const parsed: unknown = JSON.parse(await fixtureText("existing-open-source-adapters.json"));
  if (!isRecord(parsed)) {
    throw new Error("Existing-source adapter fixture must be an object");
  }
  return {
    nyc: recordArray(parsed.nyc),
    kingCounty: recordArray(parsed.kingCounty),
    pureEarth: recordArray(parsed.pureEarth),
  };
}

function recordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected a fixture record array");
  }
  const records = value.filter(isRecord);
  if (records.length !== value.length) {
    throw new Error("Fixture array contains a non-record value");
  }
  return records;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
