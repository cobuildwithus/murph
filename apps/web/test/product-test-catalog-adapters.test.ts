import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  adaptKingCountyRows,
  adaptNycRows,
  adaptPureEarthRows,
  assertSyncManagedSourcesPresent,
  parseFdaCinnamonAlertHtml,
  parseFdaHealthFraudHtml,
  parseFdaWanaBanaInvestigationHtml,
  parseFdaWanaBanaWarningLetterHtml,
  parseNyAgHollePdfText,
  pureEarthSourceRowId,
} from "../sql/product-tests/product-test-source-adapters";
import {
  PRODUCT_TEST_HEADERS,
  type JsonRecord,
} from "../sql/product-tests/product-test-catalog-types";
import { buildProductTestSourceCountManifest } from "../sql/product-tests/product-test-source-count-manifest";

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

  it("fails generation when any sync-managed source produces zero rows", async () => {
    const existing = await existingSourceFixture();
    const outputs = [
      adaptNycRows(existing.nyc),
      adaptKingCountyRows(existing.kingCounty),
      adaptPureEarthRows(existing.pureEarth),
      parseFdaCinnamonAlertHtml(
        await fixtureText("fda-cinnamon-march.html"),
        "fda_cinnamon_alert_2024_03",
      ),
      parseFdaCinnamonAlertHtml(
        await fixtureText("fda-cinnamon-rolling.html"),
        "fda_cinnamon_alert_2024_07",
      ),
      parseFdaCinnamonAlertHtml(
        await fixtureText("fda-cinnamon-july-25.html"),
        "fda_cinnamon_alert_2024_07_25",
      ),
      parseFdaWanaBanaWarningLetterHtml(
        await fixtureText("fda-wanabana-warning-letter.html"),
      ),
      parseFdaWanaBanaInvestigationHtml(
        await fixtureText("fda-wanabana-investigation.html"),
      ),
      parseNyAgHollePdfText(await fixtureText("ny-ag-holle-pdftotext.txt")),
      parseFdaHealthFraudHtml(await fixtureText("fda-health-fraud.html")),
    ];
    const rows = outputs.flatMap((output) => output.rows);

    expect(() => assertSyncManagedSourcesPresent(rows)).not.toThrow();
    const manifest = buildProductTestSourceCountManifest(rows);
    const manifestLines = manifest.trimEnd().split("\n");
    expect(manifestLines[0]).toBe("source_key\trow_count");
    expect(manifestLines.slice(1)).toEqual([...manifestLines.slice(1)].sort());
    expect(manifestLines).toContain("fda_cinnamon_alert_2024_07_25\t1");
    expect(manifestLines).toContain("fda_health_fraud_products\t4");
    expect(() =>
      buildProductTestSourceCountManifest([
        ...rows,
        { ...rows[0], source_key: "plasticlist_bay_area_2024" },
      ])
    ).toThrow(
      "Product-test source-count manifest received unmanaged source: plasticlist_bay_area_2024",
    );
    expect(() =>
      assertSyncManagedSourcesPresent(
        rows.filter((row) => row.source_key !== "fda_health_fraud_products"),
      )
    ).toThrow(
      "Product-test sync produced zero rows for managed sources: fda_health_fraud_products",
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

  it("parses all 15 March and 24 rolling FDA cinnamon measurements", async () => {
    const marchHtml = await fixtureText("fda-cinnamon-march.html");
    const rollingHtml = await fixtureText("fda-cinnamon-rolling.html");
    const march = parseFdaCinnamonAlertHtml(marchHtml, "fda_cinnamon_alert_2024_03");
    const rolling = parseFdaCinnamonAlertHtml(rollingHtml, "fda_cinnamon_alert_2024_07");

    expect(march.rows).toHaveLength(15);
    expect(rolling.rows).toHaveLength(24);
    expect(march.skipped).toEqual({});
    expect(rolling.skipped).toEqual({});

    const marcum = march.rows.find((row) => row.result_value === "3.2");
    expect(marcum).toMatchObject({
      tested_product_brand: "Marcum",
      tested_product_name: "Marcum Ground Cinnamon",
      tested_package_size: "1.5 oz",
      tested_lot_code: "10DB",
      tested_best_by: "10/16/25",
      test_method: "",
    });

    const devi = rolling.rows.find((row) => row.tested_product_brand === "DEVI");
    expect(devi).toMatchObject({
      tested_product_name: "DEVI Ground Cinnamon / Dalchini Powder",
      tested_product_upc: "609595119045",
      tested_product_upc_raw: "6 09595 11904 5",
      tested_lot_code: "2502315",
    });
    const roshni = rolling.rows.find((row) => row.tested_product_brand === "Roshni");
    expect(roshni).toMatchObject({
      tested_product_upc: "",
      tested_product_upc_raw: "15990 012878",
      tested_lot_code: "2409191",
    });
    const lucky = rolling.rows.filter((row) => row.tested_product_brand === "Lucky Foods Brand");
    expect(lucky).toHaveLength(2);
    expect(lucky[0]).toMatchObject({
      report_date: "2025-12-10",
      tested_product_name: "Lucky Foods 100% Natural Cinnamon Powder",
      tested_package_size: "40 g",
      tested_best_by: "15.09.2027",
    });
  });

  it("parses the separate July 25 FDA El Servidor observation", async () => {
    const output = parseFdaCinnamonAlertHtml(
      await fixtureText("fda-cinnamon-july-25.html"),
      "fda_cinnamon_alert_2024_07_25",
    );
    expect(output.rows).toHaveLength(1);
    expect(output.skipped).toEqual({});
    expect(output.rows[0]).toMatchObject({
      report_date: "2024-07-25",
      tested_product_brand: "El Servidor",
      tested_product_name: "El Servidor Ground Cinnamon",
      tested_lot_code: "",
      result_value: "20",
      result_unit: "ppm",
      evidence_type: "regulatory_laboratory",
      test_method: "",
    });
  });

  it("keeps FDA cinnamon natural keys stable when a measurement is corrected", async () => {
    const html = await fixtureText("fda-cinnamon-rolling.html");
    const before = parseFdaCinnamonAlertHtml(html, "fda_cinnamon_alert_2024_07");
    const after = parseFdaCinnamonAlertHtml(
      html.replace("<td>2.92</td>", "<td>2.93</td>"),
      "fda_cinnamon_alert_2024_07",
    );
    const beforeDevi = before.rows.find((row) => row.tested_product_brand === "DEVI");
    const afterDevi = after.rows.find((row) => row.tested_product_brand === "DEVI");
    expect(afterDevi?.source_result_id).toBe(beforeDevi?.source_result_id);
    expect(afterDevi?.result_value).not.toBe(beforeDevi?.result_value);
  });

  it("fails closed on changed WanaBana values and preserves aggregate/sample semantics", async () => {
    const warningHtml = await fixtureText("fda-wanabana-warning-letter.html");
    const warning = parseFdaWanaBanaWarningLetterHtml(warningHtml);
    expect(warning.rows).toHaveLength(8);
    const range = warning.rows.find((row) => row.result_operator === "range");
    expect(range).toMatchObject({
      result_value: "2.16",
      result_upper_value: "3.19",
      normalized_upper_value: "3.19",
      source_sample_count: "6",
      tested_package_size: "",
      test_method: "",
    });
    const chromium = warning.rows.filter((row) => row.contaminant_key === "total_chromium");
    expect(chromium).toHaveLength(2);
    expect(chromium.every((row) => row.contaminant_name === "Total Chromium")).toBe(true);
    expect(() =>
      parseFdaWanaBanaWarningLetterHtml(warningHtml.replace("2.18", "2.19"))
    ).toThrow(/measurement structure changed/u);

    const investigation = parseFdaWanaBanaInvestigationHtml(
      await fixtureText("fda-wanabana-investigation.html"),
    );
    expect(investigation.rows).toHaveLength(2);
    expect(investigation.rows.every((row) => row.contaminant_key === "total_chromium")).toBe(true);
  });

  it("parses 18 Holle samples into 72 qualified results without auto-matching invalid UPCs", async () => {
    const output = parseNyAgHollePdfText(await fixtureText("ny-ag-holle-pdftotext.txt"));
    expect(output.rows).toHaveLength(72);
    expect(new Set(output.rows.map((row) => row.source_sample_id))).toHaveLength(18);
    expect(output.rows.every((row) => row.tested_product_upc === "")).toBe(true);
    expect(new Set(output.rows.map((row) => row.tested_product_upc_raw))).toEqual(
      new Set(["260688630210", "260688630074", "260688630111"]),
    );
    expect(new Set(output.rows.map((row) => row.tested_source_product_id))).toEqual(
      new Set(["carrot", "zebra", "veggie"]),
    );
    const estimated = output.rows.find((row) =>
      row.source_result_id === "2112258-01:arsenic"
    );
    expect(estimated).toMatchObject({
      result_qualifier: "J",
      detection_limit_value: "0.8",
      reporting_limit_value: "3.3",
      tested_on: "2022-01-28",
    });
    const nonDetect = output.rows.find((row) =>
      row.source_result_id === "2112258-01:mercury"
    );
    expect(nonDetect).toMatchObject({ result_operator: "lte", result_qualifier: "U" });
  });

  it("strictly imports recent Foods health-fraud ingredient findings", async () => {
    const html = await fixtureText("fda-health-fraud.html");
    const output = parseFdaHealthFraudHtml(html);
    expect(output.rows).toHaveLength(4);
    expect(output.rows.map((row) => row.contaminant_key).sort()).toEqual([
      "1_4_dimethylamylamine_dmaa",
      "muscimol",
      "sildenafil",
      "tadalafil",
    ]);
    expect(output.rows.every((row) =>
      row.evidence_type === "regulatory_finding"
        && row.result_operator === "detected"
        && row.result_value === ""
        && row.result_unit === "presence"
        && row.result_basis === "product_sample"
        && row.test_method === ""
    )).toBe(true);
    expect(output.skipped).toMatchObject({
      ambiguous_or_non_laboratory_subject: 1,
      before_cutoff: 1,
      outside_foods_program: 1,
    });

    const renamed = parseFdaHealthFraudHtml(
      html.replace("Example Chocolate", "Corrected Chocolate Name"),
    );
    const beforeId = output.rows.find((row) => row.contaminant_key === "sildenafil")?.source_result_id;
    const afterId = renamed.rows.find((row) => row.contaminant_key === "sildenafil")?.source_result_id;
    expect(afterId).toBe(beforeId);
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
