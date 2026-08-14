import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createFoodsQueries,
  createPublicFoodsQueries,
  toFoodNutritionSearchItem,
} from "../src/lib/foods";
import {
  createProductLabelsQueries,
  normalizeProductLabelsConnectionString,
} from "../src/lib/product-labels";

const emptyContaminants = {
  status: "no_known_product_tests",
  murphConcernLevel: "unknown",
  alertCount: 0,
  alerts: [],
  observationCount: 0,
  observations: [],
};
const productTestSourceDataOriginFilter =
  "data_origin NOT IN ('plasticlist_bay_area_2024', 'nyc_dohmh_consumer_products', 'king_county_consumer_products', 'pure_earth_rms_2024')";

function isProductTestsQuery(text: string): boolean {
  return text.includes('product_tests.id AS "productTestId"');
}

describe("foods query helpers", () => {
  it("keeps the indexes required by bounded ranked search", async () => {
    const schemaSql = await readFile(
      new URL("../sql/foods/schema.sql", import.meta.url),
      "utf8",
    );

    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS foods_name_rank_idx",
    );
    expect(schemaSql).toContain("USING GIST (name gist_trgm_ops)");
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS foods_canonical_rank_idx",
    );
    expect(schemaSql).toContain(
      "ON foods (canonical_key, data_origin_priority, id)",
    );
  });

  it("projects meal nutrition and bounded contaminant evidence without unrelated payloads", () => {
    const projected = toFoodNutritionSearchItem({
      id: "fdc:123",
      dataOrigin: "usda_foundation",
      dataOriginId: "123",
      name: "Example food",
      brand: null,
      upc: null,
      offMarket: false,
      label: {
        nutrientsPer100g: [
          { name: "Energy", unit: "kcal", value: 120 },
          { name: "Protein", unit: "g", value: 10 },
          { name: "Sodium", unit: "mg", value: 400 },
        ],
        portions: [
          { amount: 1, description: "slice", gramWeight: 28 },
        ],
        unrelatedSourcePayload: "x".repeat(500_000),
      },
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "medium",
        alertCount: 1,
        alerts: [
          {
            contaminantKey: "lead",
            contaminantName: "Lead",
            concernLevel: "medium",
            result: {
              operator: "eq",
              value: 0.2,
              unit: "ppm",
              basis: "product_mass",
            },
            threshold: {
              value: 0.1,
              unit: "ppm",
              basis: "product_mass",
              authority: "Example Authority",
              name: "Example screening level",
              url: "https://example.test/threshold",
            },
            source: {
              key: "example_source",
              name: "Example Source",
              url: "https://example.test/report",
              reportTitle: "Example report",
              reportDate: "2026-01-02",
            },
            testedProduct: {
              name: "Example food",
              brand: null,
              upc: null,
              sourceProductId: "sample-1",
              matchMethod: "manual_confirmed",
            },
          },
        ],
        observationCount: 6,
        observations: Array.from({ length: 6 }, (_, index) => ({
          contaminantKey: `analyte_${index + 1}`,
          contaminantName: `Analyte ${index + 1}`,
          result: {
            operator: "eq" as const,
            value: index + 1,
            unit: "ng/g",
            basis: "product_mass",
          },
          normalizedResult: null,
          source: {
            key: "example_source",
            name: "Example Source",
            url: "https://example.test/report",
            reportTitle: "x".repeat(100_000),
            reportDate: "2026-01-02",
          },
          testedProduct: {
            name: "Example food",
            brand: null,
            upc: null,
            sourceProductId: `sample-${index + 1}`,
            matchMethod: "manual_confirmed" as const,
          },
        })),
      },
    });

    expect(projected.label).toEqual({
      nutrition: {
        basis: "per_100_g",
        rows: [
          {
            name: "Energy",
            amount: { display: "120", unit: "kcal", value: 120 },
            dailyValuePercent: null,
            basis: "per_100_g",
          },
          {
            name: "Protein",
            amount: { display: "10", unit: "g", value: 10 },
            dailyValuePercent: null,
            basis: "per_100_g",
          },
        ],
      },
      serving: {
        amount: 1,
        description: "slice",
        grams: 28,
        unit: null,
      },
    });
    expect(projected.contaminantSummary).toEqual({
      status: "known_product_tests",
      murphConcernLevel: "medium",
      alertCount: 1,
      alertsTruncated: false,
      alerts: [
        {
          contaminantKey: "lead",
          contaminantName: "Lead",
          concernLevel: "medium",
          result: {
            operator: "eq",
            value: 0.2,
            unit: "ppm",
            basis: "product_mass",
          },
          threshold: {
            value: 0.1,
            unit: "ppm",
            basis: "product_mass",
            authority: "Example Authority",
            name: "Example screening level",
          },
          source: {
            name: "Example Source",
            reportDate: "2026-01-02",
          },
        },
      ],
      observationCount: 6,
      observationsTruncated: true,
      observations: Array.from({ length: 5 }, (_, index) => ({
        contaminantKey: `analyte_${index + 1}`,
        contaminantName: `Analyte ${index + 1}`,
        result: {
          operator: "eq",
          value: index + 1,
          upperValue: null,
          unit: "ng/g",
          basis: "product_mass",
        },
        source: {
          name: "Example Source",
          reportDate: "2026-01-02",
        },
      })),
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("unrelatedSourcePayload");
    expect(serialized).not.toContain("reportTitle");
    expect(serialized).not.toContain("testedProduct");
    expect(serialized.length).toBeLessThan(3_000);
  });

  it("loads exact contaminant summaries for compact food searches", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:123",
              dataOrigin: "usda_foundation",
              dataOriginId: "123",
              name: "Example food",
              brand: null,
              upc: null,
              offMarket: false,
              label: { nutrientsPer100g: [] },
            },
          ] as T[],
        };
      },
    });

    const rows = await queries.searchFoods({
      q: "example food",
      limit: 1,
      includeOffMarket: false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.contaminants).toEqual(emptyContaminants);
    expect(calls).toHaveLength(2);
    expect(isProductTestsQuery(calls[0]!.text)).toBe(false);
    expect(isProductTestsQuery(calls[1]!.text)).toBe(true);
    expect(calls[1]!.values).toEqual([["fdc:123"]]);
  });

  it("normalizes shared labels database connection strings for pg", () => {
    expect(
      normalizeProductLabelsConnectionString(
        "postgres://db.example.test/murph?sslmode=verify-full&sslrootcert=system&sslcert=system",
      ),
    ).toBe("postgres://db.example.test/murph?sslmode=verify-full");
  });

  it("parameterizes food search text, off-market filter, limit, and table", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createProductLabelsQueries(
      {
        async query<T>(text: string, values: unknown[]) {
          calls.push({ text, values });
          if (isProductTestsQuery(text)) {
            return { rows: [] as T[] };
          }
          return {
            rows: [
              {
                id: "fdc:123",
                dataOrigin: "usda_branded",
                dataOriginId: "123",
                name: "Greek Yogurt",
                brand: "Example Dairy",
                upc: "123456789012",
                offMarket: false,
                label: {
                  servingSize: 170,
                  servingSizeUnit: "g",
                  nutrients: [
                    {
                      name: "Protein",
                      value: 10,
                      unit: "g",
                    },
                  ],
                },
              },
            ] as T[],
          };
        },
      },
      "foods",
    );

    const rows = await queries.search({
      q: " greek yogurt ",
      limit: 5,
      includeOffMarket: false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toEqual({
      servingSize: 170,
      servingSizeUnit: "g",
      nutrients: [
        {
          name: "Protein",
          value: 10,
          unit: "g",
        },
      ],
    });
    expect(rows[0]?.contaminants).toEqual(emptyContaminants);
    expect(calls).toHaveLength(2);

    const searchCall = calls[0];
    expect(searchCall?.text).toContain("websearch_to_tsquery");
    expect(searchCall?.text).toContain("$1::text AS raw_q");
    expect(searchCall?.text).toContain(
      "strict_word_similarity(query.raw_q, name)",
    );
    expect(searchCall?.text).toContain("fts_matches AS MATERIALIZED");
    expect(searchCall?.text).toContain("fts_candidates AS MATERIALIZED");
    expect(searchCall?.text).toContain("trigram_matches AS MATERIALIZED");
    expect(searchCall?.text).toContain("trigram_candidates AS MATERIALIZED");
    expect(searchCall?.text).toContain(
      "NOT EXISTS (SELECT 1 FROM fts_matches)",
    );
    expect(searchCall?.text).toMatch(
      /fts_nearest_matches AS MATERIALIZED \([\s\S]*?FROM foods[\s\S]*?ORDER BY name <->>> \$1::text\s*LIMIT 5000/u,
    );
    expect(searchCall?.text).toMatch(
      /fts_canonical_matches AS MATERIALIZED \([\s\S]*?DISTINCT ON \(canonical_key\)[\s\S]*?ORDER BY\s*canonical_key ASC,\s*data_origin_priority ASC,\s*id ASC\s*LIMIT 5000/u,
    );
    expect(searchCall?.text).toMatch(
      /trigram_nearest_matches AS MATERIALIZED \([\s\S]*?FROM foods[\s\S]*?ORDER BY name <->>> \$1::text\s*LIMIT 5000/u,
    );
    expect(searchCall?.text).toContain("fts_phrase_matches AS MATERIALIZED");
    expect(searchCall?.text).toMatch(
      /fts_matches AS MATERIALIZED \([\s\S]*?SELECT \* FROM fts_phrase_matches[\s\S]*?SELECT \* FROM fts_nearest_matches[\s\S]*?SELECT \* FROM fts_canonical_matches/u,
    );
    expect(searchCall?.text).toContain("name % $1::text");
    expect(searchCall?.text).not.toContain("OR name % $1::text");
    expect(searchCall?.text).toContain("FROM foods");
    expect(searchCall?.text).toContain(productTestSourceDataOriginFilter);
    expect(searchCall?.text).not.toContain(
      "murph_product_test_legacy_source_backed_origin",
    );
    expect(searchCall?.text).not.toContain("FROM product_tests product_test_sources");
    expect(searchCall?.text).not.toMatch(
      /fts_matches AS MATERIALIZED[\s\S]*?\blabel\b[\s\S]*?FROM foods, query/u,
    );
    expect(searchCall?.text).not.toMatch(
      /trigram_matches AS MATERIALIZED[\s\S]*?\blabel\b[\s\S]*?FROM foods, query/u,
    );
    expect(searchCall?.text).toContain("JOIN foods labels");
    expect(searchCall?.text).toMatch(
      /selected AS \([\s\S]*?LIMIT \$3[\s\S]*?\)\s*SELECT[\s\S]*?labels\.label[\s\S]*?FROM selected[\s\S]*?JOIN foods labels/u,
    );
    expect(searchCall?.text).toContain("PARTITION BY canonical_key");
    expect(searchCall?.text).toContain("dedupe_rank = 1");
    expect(searchCall?.text).toContain("data_origin_priority ASC");
    expect(searchCall?.text).toContain("label");
    expect(searchCall?.text).not.toContain("FROM supplements");
    expect(searchCall?.text).not.toMatch(
      /SELECT\s+brand[\s\S]*FROM foods[\s\S]*GROUP BY brand/u,
    );
    expect(searchCall?.values).toEqual(["greek yogurt", false, 5, null]);

    const contaminantsCall = calls[1];
    expect(contaminantsCall?.text).toContain("FROM product_tests");
    expect(contaminantsCall?.text).not.toContain("linked_labels AS MATERIALIZED");
    expect(contaminantsCall?.text).toContain("JOIN foods labels");
    expect(contaminantsCall?.text).not.toContain(
      "labels.canonical_key = lookup_targets.canonical_key",
    );
    expect(contaminantsCall?.text).toContain("product_tests.food_id");
    expect(contaminantsCall?.text).toContain(
      'labels.serving_grams::double precision AS "servingGrams"',
    );
    expect(contaminantsCall?.text).not.toContain("product_contaminant_threshold_applications");
    expect(contaminantsCall?.text).toContain("LEFT JOIN LATERAL");
    expect(contaminantsCall?.text).toContain("CROSS JOIN LATERAL");
    expect(contaminantsCall?.text).toContain("FROM contaminant_thresholds threshold_rows");
    expect(contaminantsCall?.text).toContain("threshold_rows.active = true");
    expect(contaminantsCall?.text).toContain(
      'thresholds.threshold_value::double precision AS "thresholdValue"',
    );
    expect(contaminantsCall?.text).toContain(
      'thresholds.normalized_value::double precision AS "thresholdNormalizedValue"',
    );
    expect(contaminantsCall?.text).toContain(
      "threshold_rows.normalized_unit = product_tests.normalized_unit",
    );
    expect(contaminantsCall?.text).toContain(
      "threshold_rows.normalized_basis = product_tests.normalized_basis",
    );
    expect(contaminantsCall?.text).toContain("threshold_rows.threshold_unit = 'ng/kg_bw/day'");
    expect(contaminantsCall?.text).toContain(
      "threshold_rows.threshold_basis = 'oral_total_dietary_exposure'",
    );
    expect(contaminantsCall?.text).toContain("product_tests.normalized_unit = 'ppm'");
    expect(contaminantsCall?.text).toContain("product_tests.normalized_basis = 'product_mass'");
    expect(contaminantsCall?.text).toContain("labels.serving_grams IS NOT NULL");
    expect(contaminantsCall?.text).toContain("scored_threshold.comparison_value IS NOT NULL");
    expect(contaminantsCall?.text).toContain("threshold_rows.concern_level_if_exceeded");
    expect(contaminantsCall?.text).not.toContain("comparison_scope");
    expect(contaminantsCall?.text).toContain(
      "threshold_rows.contaminant_key = product_tests.contaminant_key",
    );
    expect(contaminantsCall?.text).not.toContain(
      "product_threshold_applications.contaminant_key",
    );
    expect(contaminantsCall?.text).not.toContain("product_threshold_applications.food_id");
    expect(contaminantsCall?.text).not.toContain(
      "product_threshold_applications.supplement_id = product_tests.supplement_id",
    );
    expect(contaminantsCall?.text).toContain("threshold_rows.id ASC");
    expect(contaminantsCall?.text).toContain("LIMIT 1");
    expect(contaminantsCall?.text).not.toContain(
      "thresholds.threshold_unit = product_tests.normalized_unit",
    );
    expect(contaminantsCall?.text).not.toContain("threshold_basis IN");
    expect(contaminantsCall?.values).toEqual([["fdc:123"]]);
  });

  it("filters generic food searches to USDA non-branded origins", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:331960",
              dataOrigin: "usda_foundation",
              dataOriginId: "331960",
              name: "Chicken, breast, skinless, boneless, meat only, cooked, braised",
              brand: null,
              upc: null,
              offMarket: false,
              label: {
                servingSize: 100,
                servingSizeUnit: "g",
              },
            },
          ] as T[],
        };
      },
    });

    const rows = await queries.searchFoods({
      q: "chicken breast cooked skinless",
      limit: 1,
      includeOffMarket: false,
      genericOnly: true,
    });

    expect(rows[0]?.dataOrigin).toBe("usda_foundation");
    expect(calls).toHaveLength(2);

    const searchCall = calls[0];
    expect(searchCall?.text).toContain(
      "AND ($4::text[] IS NULL OR data_origin = ANY($4::text[]))",
    );
    expect(searchCall?.values).toEqual([
      "chicken breast cooked skinless",
      false,
      1,
      ["usda_foundation", "usda_sr_legacy", "usda_fndds"],
    ]);
  });

  it("rejects non-whitelisted table names before query construction", () => {
    expect(() =>
      Reflect.apply(createProductLabelsQueries, undefined, [
        {
          async query<T>() {
            return { rows: [] as T[] };
          },
        },
        "foods; DROP TABLE supplements",
      ]),
    ).toThrow("unsupported product labels table");
  });

  it("keeps branded food searches on the generic path without loading the brand index", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          throw new Error("foods search must not load brand index");
        }
        if (text.includes("brand_candidates AS MATERIALIZED")) {
          throw new Error("foods search must not use brand-scoped SQL");
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:123",
              dataOrigin: "usda_branded",
              dataOriginId: "123",
              name: "Greek Yogurt",
              brand: "Example Dairy",
              upc: "123456789012",
              offMarket: false,
              label: {
                servingSize: 170,
                servingSizeUnit: "g",
              },
            },
          ] as T[],
        };
      },
    });

    const rows = await queries.searchFoods({
      q: "Example Dairy Greek Yogurt",
      limit: 1,
      includeOffMarket: false,
    });

    expect(rows).toEqual([
      {
        id: "fdc:123",
        dataOrigin: "usda_branded",
        dataOriginId: "123",
        name: "Greek Yogurt",
        brand: "Example Dairy",
        upc: "123456789012",
        offMarket: false,
        label: {
          servingSize: 170,
          servingSizeUnit: "g",
        },
        contaminants: emptyContaminants,
      },
    ]);
    expect(calls.some((call) => call.text.includes("GROUP BY brand"))).toBe(false);
    expect(calls.some((call) => call.text.includes("brand_candidates AS MATERIALIZED"))).toBe(false);
  });

  it("preserves apostrophes in generic food search parameters", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return { rows: [] as T[] };
      },
    });

    await queries.searchFoods({
      q: "  Trader Joe's Butter Chicken  ",
      limit: 5,
      includeOffMarket: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([
      "Trader Joe's Butter Chicken",
      false,
      5,
      null,
    ]);
  });

  it("returns empty contaminant summaries when no product-test rows are linked", async () => {
    const queries = createFoodsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:123",
              dataOrigin: "usda_branded",
              dataOriginId: "123",
              name: "Greek Yogurt",
              brand: "Example Dairy",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getFoodById({
      id: "fdc:123",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      id: "fdc:123",
      contaminants: emptyContaminants,
    });
  });

  it("attaches exact product contaminant summaries from active thresholds", async () => {
    const queries = createFoodsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "fdc:123",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Greek Yogurt",
                testedProductBrand: "Example Dairy",
                testedProductUpc: "123456789012",
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey: "bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "eq",
                resultValue: 12,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.012,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                thresholdNormalizedValue: 0.01,
                thresholdNormalizedUnit: "ppm",
                thresholdNormalizedBasis: "product_mass",
                thresholdAuthorityName: "Example Authority",
                thresholdName: "Bisphenol A (BPA)",
                thresholdUrl: null,
                concernLevelIfExceeded: "medium",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "fdc:123",
              dataOrigin: "usda_branded",
              dataOriginId: "123",
              name: "Greek Yogurt",
              brand: "Example Dairy",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getFoodById({
      id: "fdc:123",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "medium",
        alertCount: 1,
      },
    });
  });

  it("preserves sample metadata for laboratory results and regulatory findings", async () => {
    const calls: string[] = [];
    const queries = createFoodsQueries({
      async query<T>(text: string) {
        calls.push(text);
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "fdc:123",
                productTestId: "federal_catalog:sample-1:lead",
                servingGrams: null,
                sourceKey: "federal_catalog",
                sourceName: "Federal Catalog",
                sourceUrl: "https://example.test/catalog",
                sourceReportTitle: "Market sampling",
                reportDate: "2025-12-01",
                sourceResultId: "sample-1",
                testedProductName: "Ground Cinnamon",
                testedProductBrand: "Example Spice",
                testedProductUpc: null,
                testedProductUpcRaw: "12345678901",
                testedSourceProductId: "product-1",
                evidenceType: "regulatory_laboratory",
                samplingContext: "targeted_market_sampling",
                sourceSampleId: "sample-1",
                sourceSampleCount: 6,
                testedLotCode: "LOT-1",
                testedBestBy: "2027-01",
                testedPackageSize: "2 oz",
                collectedOn: "2025-10-01",
                testedOn: "2025-10-08",
                matchMethod: "manual_confirmed",
                contaminantKey: "lead",
                contaminantName: "Lead",
                resultOperator: "range",
                resultValue: 1.2,
                resultUpperValue: 1.8,
                resultUnit: "ppm",
                resultBasis: "product_mass",
                normalizedValue: 1.2,
                normalizedUpperValue: 1.8,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                resultQualifier: "estimated range",
                detectionLimitValue: 0.01,
                detectionLimitUnit: "ppm",
                quantificationLimitValue: 0.03,
                quantificationLimitUnit: "ppm",
                reportingLimitValue: 0.05,
                reportingLimitUnit: "ppm",
                uncertaintyValue: 0.2,
                uncertaintyUnit: "ppm",
                labName: "Public Laboratory",
                testMethod: "ICP-MS",
                thresholdId: "example-lead-threshold",
                thresholdValue: 1,
                thresholdUnit: "ppm",
                thresholdBasis: "product_mass",
                thresholdNormalizedValue: 1,
                thresholdNormalizedUnit: "ppm",
                thresholdNormalizedBasis: "product_mass",
                thresholdAuthorityName: "Example Authority",
                thresholdName: "Example lead threshold",
                thresholdUrl: null,
                concernLevelIfExceeded: "high",
              },
              {
                productId: "fdc:123",
                productTestId: "fda_health_fraud_products:finding-1:undeclared_drug",
                servingGrams: null,
                sourceKey: "fda_health_fraud_products",
                sourceName: "FDA Health Fraud Product Database",
                sourceUrl: "https://example.test/enforcement-table",
                sourceReportTitle: "Health Fraud Product Database",
                reportDate: "2025-12-01",
                sourceResultId: "finding-1",
                testedProductName: "Example Supplement",
                testedProductBrand: null,
                testedProductUpc: null,
                testedProductUpcRaw: null,
                testedSourceProductId: "finding-1",
                evidenceType: "regulatory_finding",
                samplingContext: "regulatory_enforcement_table",
                sourceSampleId: null,
                sourceSampleCount: null,
                testedLotCode: null,
                testedBestBy: null,
                testedPackageSize: null,
                collectedOn: null,
                testedOn: null,
                matchMethod: "manual_confirmed",
                contaminantKey: "undeclared_drug",
                contaminantName: "Undeclared active ingredient",
                resultOperator: "detected",
                resultValue: null,
                resultUpperValue: null,
                resultUnit: "presence",
                resultBasis: "regulatory_finding",
                normalizedValue: null,
                normalizedUpperValue: null,
                normalizedUnit: null,
                normalizedBasis: null,
                resultQualifier: "subject of regulatory action",
                detectionLimitValue: null,
                detectionLimitUnit: null,
                quantificationLimitValue: null,
                quantificationLimitUnit: null,
                reportingLimitValue: null,
                reportingLimitUnit: null,
                uncertaintyValue: null,
                uncertaintyUnit: null,
                labName: null,
                testMethod: null,
                thresholdId: null,
                thresholdValue: null,
                thresholdUnit: null,
                thresholdBasis: null,
                thresholdNormalizedValue: null,
                thresholdNormalizedUnit: null,
                thresholdNormalizedBasis: null,
                thresholdAuthorityName: null,
                thresholdName: null,
                thresholdUrl: null,
                concernLevelIfExceeded: null,
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "fdc:123",
              dataOrigin: "usda_branded",
              dataOriginId: "123",
              name: "Ground Cinnamon",
              brand: "Example Spice",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getFoodById({
      id: "fdc:123",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "high",
        alertCount: 1,
        alerts: [
          {
            result: {
              operator: "range",
              value: 1.2,
              upperValue: 1.8,
            },
            sample: {
              sampleCount: 6,
              reportedUpc: "12345678901",
            },
          },
        ],
        observationCount: 2,
        observations: [
          {
            result: {
              operator: "range",
              value: 1.2,
              upperValue: 1.8,
              qualifier: "estimated range",
              detectionLimit: { value: 0.01, unit: "ppm" },
              quantificationLimit: { value: 0.03, unit: "ppm" },
              reportingLimit: { value: 0.05, unit: "ppm" },
              uncertainty: { value: 0.2, unit: "ppm" },
            },
            normalizedResult: {
              value: 1.2,
              upperValue: 1.8,
            },
            sample: {
              evidenceType: "regulatory_laboratory",
              samplingContext: "targeted_market_sampling",
              sourceSampleId: "sample-1",
              sampleCount: 6,
              reportedUpc: "12345678901",
              lotCode: "LOT-1",
              bestBy: "2027-01",
              packageSize: "2 oz",
              collectedOn: "2025-10-01",
              testedOn: "2025-10-08",
              labName: "Public Laboratory",
              testMethod: "ICP-MS",
            },
          },
          {
            result: {
              operator: "detected",
              value: null,
              qualifier: "subject of regulatory action",
            },
            sample: {
              evidenceType: "regulatory_finding",
              samplingContext: "regulatory_enforcement_table",
              sourceSampleId: null,
              labName: null,
              testMethod: null,
            },
          },
        ],
      },
    });

    const contaminantQuery = calls.find(isProductTestsQuery) ?? "";
    expect(contaminantQuery).toContain(
      'product_tests.result_upper_value::double precision AS "resultUpperValue"',
    );
    expect(contaminantQuery).toContain(
      'product_tests.evidence_type AS "evidenceType"',
    );
    expect(contaminantQuery).toContain(
      'product_tests.tested_product_upc_raw AS "testedProductUpcRaw"',
    );
    expect(contaminantQuery).toContain(
      'product_tests.source_sample_count AS "sourceSampleCount"',
    );
    expect(contaminantQuery).toContain(
      'product_tests.detection_limit_value::double precision AS "detectionLimitValue"',
    );
  });

  it("screens BPA against daily exposure guidance using one label serving", async () => {
    const queries = createFoodsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "fdc:705844",
                productTestId: "plasticlist_bay_area_2024:236:bisphenol_a_bpa:ng_g",
                servingGrams: 52,
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "236",
                testedProductName: "RXBAR Blueberry",
                testedProductBrand: "RXBAR",
                testedProductUpc: null,
                testedSourceProductId: "236",
                matchMethod: "manual_confirmed",
                contaminantKey: "bisphenol_a_bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "eq",
                resultValue: 1,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.001,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                thresholdId: "efsa_2023_bpa_tdi_adult_one_serving_day",
                thresholdValue: 0.2,
                thresholdUnit: "ng/kg_bw/day",
                thresholdBasis: "oral_total_dietary_exposure",
                thresholdNormalizedValue: null,
                thresholdNormalizedUnit: null,
                thresholdNormalizedBasis: null,
                thresholdAuthorityName: "European Food Safety Authority",
                thresholdName:
                  "EFSA 2023 BPA TDI screened by Murph using one label serving per day and 70 kg adult",
                thresholdUrl: "https://www.efsa.europa.eu/en/news/bisphenol-food-health-risk",
                concernLevelIfExceeded: "high",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "fdc:705844",
              dataOrigin: "usda_branded",
              dataOriginId: "705844",
              name: "RXBAR Blueberry",
              brand: "RXBAR",
              upc: "857777004607",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    const result = await queries.getFoodById({
      id: "fdc:705844",
      includeOffMarket: false,
    });

    expect(result?.contaminants).toMatchObject({
      status: "known_product_tests",
      murphConcernLevel: "high",
      alertCount: 1,
      alerts: [
        {
          contaminantKey: "bisphenol_a_bpa",
          concernLevel: "high",
          threshold: {
            value: 0.2,
            unit: "ng/kg_bw/day",
            basis: "oral_total_dietary_exposure",
            authority: "European Food Safety Authority",
          },
          screeningPolicy: {
            id: "adult_one_serving_per_day_v1",
            assumedBodyWeightKg: 70,
            assumedServingsPerDay: 1,
            servingGrams: 52,
            exposure: {
              unit: "ng/kg_bw/day",
              basis: "oral_total_dietary_exposure",
            },
          },
        },
      ],
    });
    expect(
      result?.contaminants.alerts[0]?.screeningPolicy?.exposure.value,
    ).toBeCloseTo(0.742857, 6);
    expect(result?.contaminants.alerts[0]?.screeningPolicy?.ratio).toBeCloseTo(
      3.714286,
      6,
    );
    if (!result) {
      throw new Error("expected exact food result");
    }

    const compact = toFoodNutritionSearchItem(result);
    expect(
      compact.contaminantSummary.alerts[0]?.screeningPolicy,
    ).toMatchObject({
      id: "adult_one_serving_per_day_v1",
      assumedBodyWeightKg: 70,
      assumedServingsPerDay: 1,
      servingGrams: 52,
      exposure: {
        unit: "ng/kg_bw/day",
        basis: "oral_total_dietary_exposure",
      },
    });
    expect(
      compact.contaminantSummary.alerts[0]?.screeningPolicy?.exposure.value,
    ).toBeCloseTo(0.742857, 6);
    expect(
      compact.contaminantSummary.alerts[0]?.screeningPolicy?.ratio,
    ).toBeCloseTo(3.714286, 6);
    const compactJson = JSON.stringify(compact);
    expect(compactJson).not.toContain("sourceReportTitle");
    expect(compactJson).not.toContain("testedProduct");
    expect(compactJson.length).toBeLessThan(3_000);
  });

  it("keeps daily-exposure guidance unknown when serving mass is missing", async () => {
    const queries = createFoodsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "fdc:705844",
                productTestId: "plasticlist_bay_area_2024:236:bisphenol_a_bpa:ng_g",
                servingGrams: null,
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "236",
                testedProductName: "RXBAR Blueberry",
                testedProductBrand: "RXBAR",
                testedProductUpc: null,
                testedSourceProductId: "236",
                matchMethod: "manual_confirmed",
                contaminantKey: "bisphenol_a_bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "eq",
                resultValue: 1,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.001,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                thresholdId: null,
                thresholdValue: null,
                thresholdUnit: null,
                thresholdBasis: null,
                thresholdNormalizedValue: null,
                thresholdNormalizedUnit: null,
                thresholdNormalizedBasis: null,
                thresholdAuthorityName: null,
                thresholdName: null,
                thresholdUrl: null,
                concernLevelIfExceeded: null,
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "fdc:705844",
              dataOrigin: "usda_branded",
              dataOriginId: "705844",
              name: "RXBAR Blueberry",
              brand: "RXBAR",
              upc: "857777004607",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    const result = await queries.getFoodById({
      id: "fdc:705844",
      includeOffMarket: false,
    });

    expect(result?.contaminants).toMatchObject({
      status: "known_product_tests",
      murphConcernLevel: "unknown",
      alertCount: 0,
      observationCount: 1,
      observations: [
        {
          contaminantKey: "bisphenol_a_bpa",
          normalizedResult: {
            value: 0.001,
            unit: "ppm",
            basis: "product_mass",
          },
        },
      ],
    });
  });

  it("does not attach contaminants through broad food canonical groups", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          expect(text).toContain("FROM product_tests");
          expect(text).not.toContain("linked_labels AS MATERIALIZED");
          expect(text).toContain("JOIN foods labels");
          expect(text).not.toContain(
            "labels.canonical_key = lookup_targets.canonical_key",
          );
          expect(text).toContain("product_tests.food_id = ANY($1::text[])");
          expect(values).toEqual([["whole-foods-market:sourdough"]]);
          return { rows: [] as T[] };
        }

        return {
          rows: [
            {
              id: "whole-foods-market:sourdough",
              canonicalKey: "fdc:1244242",
              dataOrigin: "brand_site",
              dataOriginId: "whole-foods-market:sourdough",
              name: "Sourdough Bread",
              brand: "Whole Foods Market",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getFoodById({
      id: "whole-foods-market:sourdough",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      id: "whole-foods-market:sourdough",
      contaminants: emptyContaminants,
    });
    expect(calls).toHaveLength(2);
  });

  it("skips invalid food ids before querying", async () => {
    const queries = createFoodsQueries({
      async query() {
        throw new Error("query should not run");
      },
    });

    await expect(
      queries.getFoodById({
        id: "abc",
        includeOffMarket: false,
      }),
    ).resolves.toBeNull();
  });

  it("fetches source-qualified food ids from the foods table", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:123",
              dataOrigin: "usda_foundation",
              dataOriginId: "123",
              name: "Banana",
              brand: null,
              upc: null,
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(
      queries.getFoodById({
        id: "fdc:123",
        includeOffMarket: false,
      }),
    ).resolves.toEqual({
      id: "fdc:123",
      dataOrigin: "usda_foundation",
      dataOriginId: "123",
      name: "Banana",
      brand: null,
      upc: null,
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("id = $1");
    expect(calls[0]?.text).toContain(productTestSourceDataOriginFilter);
    expect(calls[0]?.text).not.toContain(
      "murph_product_test_legacy_source_backed_origin",
    );
    expect(calls[0]?.text).not.toContain("FROM product_tests product_test_sources");
    expect(calls[0]?.text).not.toContain("FROM supplements");
    expect(calls[0]?.values).toEqual(["fdc:123", false]);
  });

  it("normalizes UPC digits and checks food leading-zero variants", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:456",
              dataOrigin: "usda_branded",
              dataOriginId: "456",
              name: "Peanut Butter",
              brand: "Example Foods",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(
      queries.getFoodByUpc({
        upc: "00123-456 789012",
        includeOffMarket: false,
      }),
    ).resolves.toEqual({
      id: "fdc:456",
      dataOrigin: "usda_branded",
      dataOriginId: "456",
      name: "Peanut Butter",
      brand: "Example Foods",
      upc: "123456789012",
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.text).not.toContain("FROM supplements");
    expect(calls[0]?.values).toEqual([
      ["00123456789012", "123456789012", "0123456789012"],
      false,
    ]);
    expect(calls[1]?.text).toContain("product_tests.food_id");
    expect(calls[1]?.values).toEqual([["fdc:456"]]);
  });

  it("checks a 12-digit UPC-A against leading-zero EAN and GTIN fallbacks", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:457",
              dataOrigin: "usda_branded",
              dataOriginId: "457",
              name: "Coconut Water",
              brand: "Example Foods",
              upc: "0123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(
      queries.getFoodByUpc({
        upc: "123-456 789012",
        includeOffMarket: false,
      }),
    ).resolves.toEqual({
      id: "fdc:457",
      dataOrigin: "usda_branded",
      dataOriginId: "457",
      name: "Coconut Water",
      brand: "Example Foods",
      upc: "0123456789012",
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.values).toEqual([
      ["123456789012", "0123456789012", "00123456789012"],
      false,
    ]);
    expect(calls[1]?.text).toContain("product_tests.food_id");
    expect(calls[1]?.values).toEqual([["fdc:457"]]);
  });

  it("checks a 14-digit GTIN with one leading zero as a 13-digit EAN fallback", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:789",
              dataOrigin: "usda_branded",
              dataOriginId: "789",
              name: "Sparkling Water",
              brand: "Example Foods",
              upc: "1234567890123",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(
      queries.getFoodByUpc({
        upc: "0123-4567890123",
        includeOffMarket: false,
      }),
    ).resolves.toEqual({
      id: "fdc:789",
      dataOrigin: "usda_branded",
      dataOriginId: "789",
      name: "Sparkling Water",
      brand: "Example Foods",
      upc: "1234567890123",
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.values).toEqual([
      ["01234567890123", "1234567890123"],
      false,
    ]);
    expect(calls[1]?.text).toContain("product_tests.food_id");
    expect(calls[1]?.values).toEqual([["fdc:789"]]);
  });

  it("checks a 13-digit GTIN against a zero-padded 14-digit fallback", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "fdc:790",
              dataOrigin: "usda_branded",
              dataOriginId: "790",
              name: "Granola",
              brand: "Example Foods",
              upc: "01234567890123",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(
      queries.getFoodByUpc({
        upc: "1234567890123",
        includeOffMarket: false,
      }),
    ).resolves.toEqual({
      id: "fdc:790",
      dataOrigin: "usda_branded",
      dataOriginId: "790",
      name: "Granola",
      brand: "Example Foods",
      upc: "01234567890123",
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.values).toEqual([
      ["1234567890123", "01234567890123"],
      false,
    ]);
    expect(calls[1]?.text).toContain("product_tests.food_id");
    expect(calls[1]?.values).toEqual([["fdc:790"]]);
  });

  it("keeps public food search compact, branded-only, and testing-aggregate-only", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createPublicFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return {
          rows: [
            {
              id: "fdc:123",
              canonicalKey: "fdc:123",
              dataOrigin: "usda_branded",
              dataOriginId: "123",
              dataOriginUrl: "https://example.test/food/123",
              importedAt: "2026-07-16T12:00:00.000Z",
              name: "Greek Yogurt",
              brand: "Example Dairy",
              upc: "123456789012",
              observationCount: 4,
              sourceCount: 2,
              latestReportDate: "2026-06-01",
            },
          ] as T[],
        };
      },
    });

    await expect(queries.searchPublicFoods({
      q: "Greek Yogurt",
      limit: 5,
    })).resolves.toEqual([
      {
        id: "fdc:123",
        dataOrigin: "usda_branded",
        dataOriginId: "123",
        dataOriginUrl: "https://example.test/food/123",
        importedAt: "2026-07-16T12:00:00.000Z",
        name: "Greek Yogurt",
        brand: "Example Dairy",
        upc: "123456789012",
        testing: {
          status: "known_product_tests",
          observationCount: 4,
          sourceCount: 2,
          latestReportDate: "2026-06-01",
        },
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(["Greek Yogurt", false, 5, null]);
    expect(calls[0]?.text).toContain("'usda_foundation'");
    expect(calls[0]?.text).toContain("'usda_sr_legacy'");
    expect(calls[0]?.text).toContain("'usda_fndds'");
    expect(calls[0]?.text).toContain("COUNT(DISTINCT product_tests.id)");
    expect(calls[0]?.text).not.toContain("labels.label");
  });

  it("resolves a bare public food GTIN exactly before ranked search", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createPublicFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return {
          rows: [
            {
              id: "fdc:456",
              canonicalKey: "fdc:456",
              dataOrigin: "usda_branded",
              dataOriginId: "456",
              dataOriginUrl: null,
              importedAt: "2026-07-16T12:00:00.000Z",
              name: "Peanut Butter",
              brand: "Example Foods",
              upc: "123456789012",
              observationCount: 0,
              sourceCount: 0,
              latestReportDate: null,
            },
          ] as T[],
        };
      },
    });

    const result = await queries.searchPublicFoods({
      q: "123-456 789012",
      limit: 5,
    });

    expect(result).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).not.toContain("websearch_to_tsquery");
    expect(calls[0]?.values).toEqual([
      ["123456789012", "0123456789012", "00123456789012"],
    ]);
  });

  it("excludes generic food origins from exact public records", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createPublicFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return { rows: [] as T[] };
      },
    });

    await expect(queries.getPublicFoodRecordById({
      id: "fdc:123",
    })).resolves.toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("labels.id = $1");
    expect(calls[0]?.text).toContain("labels.off_market = false");
    expect(calls[0]?.text).toContain("labels.data_origin NOT IN");
    expect(calls[0]?.text).toContain("fdc_release_date::text AS \"releaseDate\"");
    expect(calls[0]?.text).toContain("last_seen_at");
    expect(calls[0]?.values).toEqual(["fdc:123"]);
  });

  it("bounds public food evidence in SQL and preserves exact totals and screening", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createPublicFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return {
          rows: Array.from({ length: 20 }, (_, index) => ({
            productId: "fdc:123",
            productTestId: `test-${index + 1}`,
            observationTotal: 21,
            servingGrams: 30,
            sourceKey: "example_laboratory_report",
            sourceName: "Example Laboratory Report",
            sourceUrl: "https://example.test/report",
            sourceReportTitle: "Example product testing",
            reportDate: "2026-06-01",
            sourceResultId: `result-${index + 1}`,
            testedProductName: "Greek Yogurt",
            testedProductBrand: "Example Dairy",
            testedProductUpc: "123456789012",
            testedSourceProductId: "source-product-123",
            matchMethod: "exact_upc",
            contaminantKey: `analyte_${index + 1}`,
            contaminantName: `Analyte ${index + 1}`,
            resultOperator: "eq",
            resultValue: index === 1 ? 2 : 0.5,
            resultUnit: "ppm",
            resultBasis: "product_mass",
            normalizedValue: index === 1 ? 2 : 0.5,
            normalizedUnit: "ppm",
            normalizedBasis: "product_mass",
            labName: "Example Lab",
            testMethod: "Example Method",
            importedAt: "2026-07-16T12:00:00.000Z",
            thresholdId: "example-threshold",
            thresholdValue: 1,
            thresholdUnit: "ppm",
            thresholdBasis: "product_mass",
            thresholdNormalizedValue: 1,
            thresholdNormalizedUnit: "ppm",
            thresholdNormalizedBasis: "product_mass",
            thresholdAuthorityName: "Example Authority",
            thresholdName: "Example screening threshold",
            thresholdUrl: "https://example.test/threshold",
            concernLevelIfExceeded: "medium",
          })) as T[],
        };
      },
    });

    const evidence = await queries.getPublicFoodEvidence({
      id: "fdc:123",
    });

    expect(evidence).toMatchObject({
      status: "known_product_tests",
      total: 21,
      returned: 20,
      truncated: true,
    });
    expect(evidence.observations[0]).toMatchObject({
      id: "test-1",
      sourceResultId: "result-1",
      labName: "Example Lab",
      testMethod: "Example Method",
      screening: {
        comparison: "does_not_exceed",
        threshold: {
          authority: "Example Authority",
          name: "Example screening threshold",
        },
      },
      alert: null,
    });
    expect(evidence.observations[1]?.screening?.comparison).toBe("exceeds");
    expect(evidence.observations[1]?.alert?.concernLevel).toBe("medium");
    expect(evidence.alerts).toHaveLength(1);

    expect(calls).toHaveLength(1);
    const query = calls[0]?.text ?? "";
    expect(query).toContain("DISTINCT ON (product_tests.id)");
    expect(query).toContain("(COUNT(*) OVER ())::integer AS observation_total");
    expect(query).toContain("bounded_observations AS MATERIALIZED");
    expect(query).toContain("WHERE observation_rank <= 20");
    expect(query).toContain("product_tests.lab_name AS \"labName\"");
    expect(query).toContain("product_tests.test_method AS \"testMethod\"");
    expect(query).toContain("product_tests.source_result_id AS \"sourceResultId\"");
    expect(query).toContain("product_tests.food_id");
    expect(query).not.toContain("labels.canonical_key = $2");
    expect(query.indexOf("bounded_observations AS MATERIALIZED")).toBeLessThan(
      query.indexOf("FROM contaminant_thresholds threshold_rows"),
    );
    expect(calls[0]?.values).toEqual(["fdc:123"]);
  });
});
