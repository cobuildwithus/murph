import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createPublicSupplementsQueries,
  createSupplementsQueries,
  normalizeSupplementConnectionString,
} from "../src/lib/supplements";
import { ProductContaminantSchemaMissingError } from "../src/lib/product-labels";

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

describe("supplements query helpers", () => {
  it("normalizes PlanetScale system certificate markers for pg", () => {
    expect(
      normalizeSupplementConnectionString(
        "postgres://db.example.test/murph?sslmode=verify-full&sslrootcert=system&sslcert=system",
      ),
    ).toBe("postgres://db.example.test/murph?sslmode=verify-full");
  });

  it("keeps supplement imports on local env-var NDJSON paths", async () => {
    const dsldImportSql = await readFile(
      new URL("../sql/supplements/import.sql", import.meta.url),
      "utf8",
    );
    const dsldBackfillSql = await readFile(
      new URL(
        "../sql/supplements/backfill-dsld-search-text.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const dailymedImportSql = await readFile(
      new URL("../sql/supplements/import-dailymed.sql", import.meta.url),
      "utf8",
    );

    expect(dsldImportSql).toContain(
      `FROM PROGRAM 'if [ -n "$DSLD_NDJSON_PATH" ]`,
    );
    expect(dsldImportSql).toContain("\\set ON_ERROR_STOP on");
    expect(dsldImportSql).toContain(`cat "$DSLD_NDJSON_PATH"`);
    expect(dsldImportSql).toContain("WITH (FORMAT csv");
    expect(dsldImportSql).toContain("btrim(COALESCE(");
    expect(dsldImportSql).toContain("ingredient->>'name'");
    expect(dsldImportSql).toContain("nested_ingredient->>'name'");
    expect(dsldImportSql).toContain("nestedRows");
    expect(dsldImportSql).toContain("search_text_raw");
    expect(dsldImportSql).toContain("left(regexp_replace(btrim(search_text_raw)");
    expect(dsldImportSql).toContain("6000");
    expect(dsldImportSql).not.toContain("ingredient->>'amount'");
    expect(dsldImportSql).not.toContain("ingredient->>'unit'");
    expect(dsldImportSql).not.toContain("dailyValue");
    expect(dsldImportSql).not.toContain(":'DSLD_NDJSON_PATH'");
    expect(dsldImportSql).not.toContain("Unknown supplement");

    expect(dsldBackfillSql).toContain("WHERE supplements.data_origin = 'dsld'");
    expect(dsldBackfillSql).toContain("SET search_text = dsld_search_text.search_text");
    expect(dsldBackfillSql).toContain("nestedRows");
    expect(dsldBackfillSql).toContain("ingredient->>'name'");
    expect(dsldBackfillSql).toContain("nested_ingredient->>'name'");
    expect(dsldBackfillSql).toContain("6000");
    expect(dsldBackfillSql).toContain("ANALYZE supplements");
    expect(dsldBackfillSql).not.toContain("ingredient->>'amount'");
    expect(dsldBackfillSql).not.toContain("ingredient->>'unit'");
    expect(dsldBackfillSql).not.toContain("dailyValue");

    expect(dailymedImportSql).toContain(
      `FROM PROGRAM 'if [ -n "$DAILYMED_NDJSON_PATH" ]`,
    );
    expect(dailymedImportSql).toContain("\\set ON_ERROR_STOP on");
    expect(dailymedImportSql).toContain(`cat "$DAILYMED_NDJSON_PATH"`);
    expect(dailymedImportSql).toContain("WITH (FORMAT csv");
    expect(dailymedImportSql).toContain(
      "NULLIF(btrim(payload->>'brand'), '') AS brand",
    );
    expect(dailymedImportSql).toContain("search_text_raw");
    expect(dailymedImportSql).toContain(
      "NULLIF(btrim(payload->>'searchText'), '')",
    );
    expect(dailymedImportSql).toContain(
      "left(regexp_replace(btrim(search_text_raw), '\\s+', ' ', 'g'), 6000)",
    );
    expect(dailymedImportSql).toContain("WHERE data_origin = 'dailymed'");
    expect(dailymedImportSql).toContain(
      "jsonb_array_length(label->'ingredientRows') > 0",
    );
    expect(dailymedImportSql).toContain(
      "jsonb_array_length(label->'servingSizes') > 0",
    );
    expect(dailymedImportSql).toMatch(
      /CASE\s+WHEN jsonb_typeof\(label->'ingredientRows'\) = 'array'\s+THEN jsonb_array_length\(label->'ingredientRows'\) > 0\s+ELSE false\s+END/u,
    );
    expect(dailymedImportSql).toMatch(
      /CASE\s+WHEN jsonb_typeof\(label->'servingSizes'\) = 'array'\s+THEN jsonb_array_length\(label->'servingSizes'\) > 0\s+ELSE false\s+END/u,
    );
    expect(dailymedImportSql).not.toMatch(
      /jsonb_typeof\(label->'(?:ingredientRows|servingSizes)'\) = 'array'\s+AND\s+jsonb_array_length/u,
    );
    expect(dailymedImportSql).not.toContain("Unknown supplement");
    expect(dailymedImportSql).not.toContain(":'DAILYMED_NDJSON_PATH'");
  });

  it("keeps the supplements schema on one table without redundant origin indexes", async () => {
    const schemaSql = await readFile(
      new URL("../sql/supplements/schema.sql", import.meta.url),
      "utf8",
    );

    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS supplements");
    expect(schemaSql).toContain("UNIQUE (data_origin, data_origin_id)");
    expect(schemaSql).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS supplements_search_english_idx",
    );
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS supplements_name_trgm_idx",
    );
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS supplements_name_rank_idx",
    );
    expect(schemaSql).toContain("USING GIST (name gist_trgm_ops)");
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS supplements_brand_idx",
    );
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS supplements_canonical_rank_idx",
    );
    expect(schemaSql).toContain(
      "ON supplements (canonical_key, data_origin_priority, id)",
    );
    expect(schemaSql).toContain("supplements_payload_format_check");
    expect(schemaSql).toContain("char_length(search_text) <= 6000");
    expect(schemaSql).toContain(
      "COALESCE(jsonb_typeof(label) = 'object', false)",
    );
    expect(schemaSql).toContain("upc ~ '^[0-9]+$'");
    expect(schemaSql).not.toContain(
      "VALIDATE CONSTRAINT supplements_payload_format_check",
    );
    expect(schemaSql).toContain(
      "VALIDATE CONSTRAINT supplements_serving_grams_check",
    );
    expect(schemaSql).not.toContain("supplement_external_labels");
    expect(schemaSql).not.toContain("supplements_data_origin_idx");
  });

  it("keeps the audited data repair bounded and dry-run by default", async () => {
    const repairSql = await readFile(
      new URL("../sql/supplements/repair-data-quality-2026-07.sql", import.meta.url),
      "utf8",
    );
    const repairScript = await readFile(
      new URL("../sql/supplements/repair-data-quality-2026-07.sh", import.meta.url),
      "utf8",
    );

    expect(repairSql).toContain("pg_advisory_xact_lock");
    expect(repairSql).toContain("current_search_text_md5");
    expect(repairSql).toContain("current_label_md5");
    expect(repairSql).toContain("supplements.data_origin = 'brand_site'");
    expect(repairSql).toContain("supplements.data_origin = 'dailymed'");
    expect(repairSql).toContain("supplements.canonical_key = supplements.id");
    expect(repairSql).toContain("FROM product_tests");
    expect(repairSql).toContain("FROM supplements AS aliases");
    expect(repairSql).toContain("\\if :supplement_data_repair_apply");
    expect(repairSql).toContain("ROLLBACK;");
    expect(repairSql).toContain(
      "VALIDATE CONSTRAINT supplements_payload_format_check",
    );
    expect(repairSql).not.toMatch(/DELETE FROM supplements\s+WHERE data_origin/iu);

    expect(repairScript).toContain("apply=false");
    expect(repairScript).toContain("--dry-run");
    expect(repairScript).toContain("--apply");
    expect(repairScript).toContain("labels-db-psql.sh");
    expect(repairScript).toContain("prepare_labels_db_psql_env");
  });

  it("parameterizes search text, off-market filter, and limit", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: null,
              upc: null,
              offMarket: false,
              label: {
                ingredients: ["Creatine Monohydrate"],
                supplementFacts: {
                  servingSize: "1 scoop",
                },
              },
            },
          ] as T[],
        };
      },
    });

    const rows = await queries.searchSupplements({
      q: " creatine ",
      limit: 5,
      includeOffMarket: false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toEqual({
      ingredients: ["Creatine Monohydrate"],
      supplementFacts: {
        servingSize: "1 scoop",
      },
    });
    expect(rows[0]?.contaminants).toEqual(emptyContaminants);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.text).toContain("GROUP BY brand");
    expect(calls[0]?.text).toContain(productTestSourceDataOriginFilter);
    expect(calls[0]?.text).not.toContain(
      "murph_product_test_legacy_source_backed_origin",
    );
    expect(calls[0]?.text).not.toContain("FROM product_tests product_test_sources");
    expect(calls[0]?.values).toEqual([]);

    const searchCall = calls[1];
    expect(searchCall?.text).toContain("websearch_to_tsquery('simple', $1)");
    expect(searchCall?.text).toContain("websearch_to_tsquery('english', $1)");
    expect(searchCall?.text).toContain(
      "OR to_tsvector('english', search_text) @@ websearch_to_tsquery('english', $1)",
    );
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
      /fts_nearest_matches AS MATERIALIZED \([\s\S]*?FROM supplements[\s\S]*?ORDER BY name <->>> \$1::text\s*LIMIT 5000/u,
    );
    expect(searchCall?.text).toMatch(
      /fts_canonical_matches AS MATERIALIZED \([\s\S]*?DISTINCT ON \(canonical_key\)[\s\S]*?ORDER BY\s*canonical_key ASC,\s*data_origin_priority ASC,\s*id ASC\s*LIMIT 5000/u,
    );
    expect(searchCall?.text).toMatch(
      /trigram_nearest_matches AS MATERIALIZED \([\s\S]*?FROM supplements[\s\S]*?ORDER BY name <->>> \$1::text\s*LIMIT 5000/u,
    );
    expect(searchCall?.text).toContain("fts_phrase_matches AS MATERIALIZED");
    expect(searchCall?.text).toMatch(
      /fts_matches AS MATERIALIZED \([\s\S]*?SELECT \* FROM fts_phrase_matches[\s\S]*?SELECT \* FROM fts_nearest_matches[\s\S]*?SELECT \* FROM fts_canonical_matches/u,
    );
    expect(searchCall?.text).toContain("name % $1::text");
    expect(searchCall?.text).not.toContain("OR name % $1::text");
    expect(searchCall?.text).toContain("name_phrase_match DESC");
    expect(searchCall?.text).toContain("name_phrase_length DESC");
    expect(searchCall?.text).toContain("name_similarity DESC");
    expect(searchCall?.text).toContain("FROM supplements");
    expect(searchCall?.text).toContain(productTestSourceDataOriginFilter);
    expect(searchCall?.text).not.toContain(
      "murph_product_test_legacy_source_backed_origin",
    );
    expect(searchCall?.text).not.toContain("FROM product_tests product_test_sources");
    expect(searchCall?.text).not.toMatch(
      /fts_matches AS MATERIALIZED[\s\S]*?\blabel\b[\s\S]*?FROM supplements, query/u,
    );
    expect(searchCall?.text).not.toMatch(
      /trigram_matches AS MATERIALIZED[\s\S]*?\blabel\b[\s\S]*?FROM supplements, query/u,
    );
    expect(searchCall?.text).toContain("JOIN supplements labels");
    expect(searchCall?.text).toMatch(
      /selected AS \([\s\S]*?LIMIT \$3[\s\S]*?\)\s*SELECT[\s\S]*?labels\.label[\s\S]*?FROM selected[\s\S]*?JOIN supplements labels/u,
    );
    expect(searchCall?.text).toContain("PARTITION BY canonical_key");
    expect(searchCall?.text).toContain("dedupe_rank = 1");
    expect(searchCall?.text).toContain("data_origin_priority ASC");
    expect(searchCall?.text).toContain("label");
    expect(searchCall?.text).not.toContain("brand_candidates AS MATERIALIZED");
    expect(searchCall?.text).not.toContain("supplement_external_labels");
    expect(searchCall?.text).not.toContain("matched_dsld_id");
    expect(searchCall?.values).toEqual(["creatine", false, 5, null]);

    const contaminantsCall = calls[2];
    expect(contaminantsCall?.text).toContain("JOIN product_tests");
    expect(contaminantsCall?.text).toContain("linked_labels AS MATERIALIZED");
    expect(contaminantsCall?.text).toContain("JOIN supplements labels");
    expect(contaminantsCall?.text).toContain(
      "labels.canonical_key = lookup_targets.canonical_key",
    );
    expect(contaminantsCall?.text).toContain("product_tests.supplement_id");
    expect(contaminantsCall?.text).toContain(
      'product_tests.report_date::text AS "reportDate"',
    );
    expect(contaminantsCall?.text).toContain(
      'linked_labels.serving_grams::double precision AS "servingGrams"',
    );
    expect(contaminantsCall?.text).not.toContain("selected_labels AS MATERIALIZED");
    expect(contaminantsCall?.text).not.toContain("JOIN selected_labels");
    expect(contaminantsCall?.text).not.toContain("product_contaminant_threshold_applications");
    expect(contaminantsCall?.text).toContain("LEFT JOIN LATERAL");
    expect(contaminantsCall?.text).toContain("CROSS JOIN LATERAL");
    expect(contaminantsCall?.text).toContain("FROM contaminant_thresholds threshold_rows");
    expect(contaminantsCall?.text).toContain("threshold_rows.active = true");
    expect(contaminantsCall?.text).toContain(
      "product_tests.result_operator IN ('eq', 'gt', 'gte', 'range')",
    );
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
    expect(contaminantsCall?.text).toContain("linked_labels.serving_grams IS NOT NULL");
    expect(contaminantsCall?.text).toContain("scored_threshold.comparison_value IS NOT NULL");
    expect(contaminantsCall?.text).toContain("threshold_rows.concern_level_if_exceeded");
    expect(contaminantsCall?.text).not.toContain("comparison_scope");
    expect(contaminantsCall?.text).toContain(
      "threshold_rows.contaminant_key = product_tests.contaminant_key",
    );
    expect(contaminantsCall?.text).not.toContain(
      "product_threshold_applications.contaminant_key",
    );
    expect(contaminantsCall?.text).not.toContain("product_threshold_applications.supplement_id");
    expect(contaminantsCall?.text).not.toContain(
      "product_threshold_applications.supplement_id = product_tests.supplement_id",
    );
    expect(contaminantsCall?.text).not.toContain(
      "product_threshold_applications.food_id = product_tests.food_id",
    );
    expect(contaminantsCall?.text).toContain("threshold_rows.id ASC");
    expect(contaminantsCall?.text).toContain("LIMIT 1");
    expect(contaminantsCall?.text).not.toContain(
      "thresholds.threshold_basis = product_tests.normalized_basis",
    );
    expect(contaminantsCall?.text).not.toContain(
      "thresholds.threshold_unit = product_tests.normalized_unit",
    );
    expect(contaminantsCall?.text).not.toContain("threshold_basis IN");
    expect(contaminantsCall?.values).toEqual([["82118"], ["82118"]]);
  });

  it("drops weak supplement category terms before candidate selection", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "NAC ginger supplement",
      limit: 5,
      includeOffMarket: false,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.text).toContain("fts_candidates AS MATERIALIZED");
    expect(calls[1]?.values).toEqual(["nac ginger", false, 5, null]);
  });

  it.each(["supplement", " supplements ", "SUPPLEMENT supplements"])(
    "does not query the catalog for weak-only search %j",
    async (q) => {
      const calls: Array<{ text: string; values: unknown[] }> = [];
      const queries = createSupplementsQueries({
        async query<T>(text: string, values: unknown[]) {
          calls.push({ text, values });
          return { rows: [] as T[] };
        },
      });

      await expect(queries.searchSupplements({
        q,
        limit: 5,
        includeOffMarket: false,
      })).resolves.toEqual([]);

      expect(calls).toEqual([]);
    },
  );

  it("normalizes compatibility characters and punctuation before search", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Doctor's Best" }] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "  Doctor’s Best Magnesium‑Glycinate  ",
      limit: 5,
      includeOffMarket: false,
    });

    expect(calls[1]?.values).toEqual([
      "Doctors Best Magnesium Glycinate",
      false,
      5,
      ["Doctor's Best"],
      "magnesium glycinate",
    ]);
  });

  it.each(["42P01", "42703"])(
    "turns missing product-test schema code %s into a named configuration error",
    async (code) => {
      const queries = createSupplementsQueries({
        async query<T>(text: string) {
          if (isProductTestsQuery(text)) {
            const error = Object.assign(new Error("relation does not exist"), {
              code,
            });
            throw error;
          }

          return {
            rows: [
              {
                id: "82118",
                dataOrigin: "dsld",
                dataOriginId: "82118",
                name: "Creatine Monohydrate",
                brand: null,
                upc: null,
                offMarket: false,
                label: {},
              },
            ] as T[],
          };
        },
      });

      await expect(queries.getSupplementById({
        id: "82118",
        includeOffMarket: false,
      })).rejects.toBeInstanceOf(ProductContaminantSchemaMissingError);
    },
  );

  it("attaches exact product contaminant summaries from active thresholds", async () => {
    const queries = createSupplementsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
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
                thresholdValue: 10,
                thresholdUnit: "ng/g",
                thresholdBasis: "product_mass",
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
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      id: "82118",
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "medium",
        alertCount: 1,
        alerts: [
          {
            contaminantKey: "bpa",
            contaminantName: "Bisphenol A (BPA)",
            concernLevel: "medium",
            result: {
              operator: "eq",
              value: 0.012,
              unit: "ppm",
              basis: "product_mass",
            },
            threshold: {
              value: 0.01,
              unit: "ppm",
              basis: "product_mass",
              authority: "Example Authority",
              name: "Bisphenol A (BPA)",
              url: null,
            },
            source: {
              key: "plasticlist_bay_area_2024",
              name: "PlasticList",
              url: "https://plasticlist.org",
              reportTitle: "Data on Plastic Chemicals in Bay Area Foods",
              reportDate: "2024-07-11",
            },
            testedProduct: {
              name: "Creatine Monohydrate",
              brand: null,
              upc: null,
              sourceProductId: "79",
              matchMethod: "manual_confirmed",
            },
          },
        ],
      },
    });
  });

  it("attaches contaminants through canonical supplement label aliases", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          expect(text).toContain("linked_labels AS MATERIALIZED");
          expect(text).toContain("JOIN supplements labels");
          expect(text).toContain(
            "labels.canonical_key = lookup_targets.canonical_key",
          );
          expect(text).toContain(
            "product_tests.supplement_id = linked_labels.label_id",
          );
          expect(text).toContain(
            'linked_labels.serving_grams::double precision AS "servingGrams"',
          );
          expect(text).not.toContain("selected_labels AS MATERIALIZED");
          expect(text).not.toContain("JOIN selected_labels");
          expect(text).not.toContain("product_threshold_applications");
          expect(values).toEqual([
            ["brand:creatine"],
            ["dsld:82118"],
          ]);
          return {
            rows: [
              {
                productId: "brand:creatine",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
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
                servingGrams: 1.5,
                thresholdValue: 0.2,
                thresholdUnit: "ng/kg_bw/day",
                thresholdBasis: "oral_total_dietary_exposure",
                thresholdNormalizedValue: null,
                thresholdNormalizedUnit: null,
                thresholdNormalizedBasis: null,
                thresholdAuthorityName: "Example Authority",
                thresholdName: "BPA daily exposure screen",
                thresholdUrl: null,
                concernLevelIfExceeded: "high",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "brand:creatine",
              canonicalKey: "dsld:82118",
              dataOrigin: "brand_site",
              dataOriginId: "brand:creatine",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "brand:creatine",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      id: "brand:creatine",
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "high",
        alertCount: 1,
        alerts: [
          {
            contaminantKey: "bpa",
            concernLevel: "high",
            threshold: {
              value: 0.2,
              unit: "ng/kg_bw/day",
              basis: "oral_total_dietary_exposure",
            },
            screeningPolicy: {
              servingGrams: 1.5,
            },
          },
        ],
        observationCount: 1,
      },
    });
    expect(calls).toHaveLength(2);
  });

  it("compares dry-weight observations only to dry-weight thresholds", async () => {
    const queries = createSupplementsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "82118",
                sourceKey: "pure_earth_rms_2024",
                sourceName: "Pure Earth",
                sourceUrl: "https://zenodo.org/records/10444602",
                sourceReportTitle: "Rapid Market Screening",
                reportDate: "2024-01-01",
                sourceResultId: "dry-1",
                testedProductName: "Dry Spice",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "dry-1",
                matchMethod: "exact_source_id",
                contaminantKey: "lead",
                contaminantName: "Lead",
                resultOperator: "eq",
                resultValue: 12,
                resultUnit: "mg/kg-dry",
                resultBasis: "product_mass",
                normalizedValue: 12,
                normalizedUnit: "mg/kg-dry",
                normalizedBasis: "product_mass",
                thresholdValue: 10,
                thresholdUnit: "mg/kg-dry",
                thresholdBasis: "product_mass",
                thresholdNormalizedValue: 10,
                thresholdNormalizedUnit: "mg/kg-dry",
                thresholdNormalizedBasis: "product_mass",
                thresholdAuthorityName: "Example Authority",
                thresholdName: "Dry-weight lead",
                thresholdUrl: null,
                concernLevelIfExceeded: "high",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "high",
        alertCount: 1,
        alerts: [
          {
            contaminantKey: "lead",
            result: {
              operator: "eq",
              value: 12,
              unit: "mg/kg-dry",
              basis: "product_mass",
            },
            threshold: {
              value: 10,
              unit: "mg/kg-dry",
              basis: "product_mass",
            },
          },
        ],
      },
    });
  });

  it("alerts on lower-bound contaminant results when the bound proves exceedance", async () => {
    const queries = createSupplementsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey: "bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "gt",
                resultValue: 10,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.01,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                thresholdValue: 10,
                thresholdUnit: "ng/g",
                thresholdBasis: "product_mass",
                thresholdNormalizedValue: 0.01,
                thresholdNormalizedUnit: "ppm",
                thresholdNormalizedBasis: "product_mass",
                thresholdAuthorityName: "Example Authority",
                thresholdName: "Bisphenol A (BPA)",
                thresholdUrl: null,
                concernLevelIfExceeded: "low",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "low",
        alertCount: 1,
        alerts: [
          {
            contaminantKey: "bpa",
            concernLevel: "low",
            result: {
              operator: "gt",
              value: 0.01,
              unit: "ppm",
              basis: "product_mass",
            },
            threshold: {
              value: 0.01,
              unit: "ppm",
              basis: "product_mass",
            },
          },
        ],
        observationCount: 1,
        observations: [
          {
            contaminantKey: "bpa",
            result: {
              operator: "gt",
              value: 10,
              unit: "ng/g",
              basis: "product_mass",
            },
            normalizedResult: {
              value: 0.01,
              unit: "ppm",
              basis: "product_mass",
            },
          },
        ],
      },
    });
  });

  it("keeps ambiguous bounded contaminant evidence unknown", async () => {
    const queries = createSupplementsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey: "bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "gt",
                resultValue: 4,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.004,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                thresholdValue: 10,
                thresholdUnit: "ng/g",
                thresholdBasis: "product_mass",
                thresholdNormalizedValue: 0.01,
                thresholdNormalizedUnit: "ppm",
                thresholdNormalizedBasis: "product_mass",
                thresholdAuthorityName: "Example Authority",
                thresholdName: "Bisphenol A (BPA)",
                thresholdUrl: null,
                concernLevelIfExceeded: "low",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "unknown",
        alertCount: 0,
        alerts: [],
        observationCount: 1,
        observations: [
          {
            contaminantKey: "bpa",
            contaminantName: "Bisphenol A (BPA)",
            result: {
              operator: "gt",
              value: 4,
              unit: "ng/g",
              basis: "product_mass",
            },
            normalizedResult: {
              value: 0.004,
              unit: "ppm",
              basis: "product_mass",
            },
            source: {
              key: "plasticlist_bay_area_2024",
              name: "PlasticList",
              url: "https://plasticlist.org",
              reportTitle: "Data on Plastic Chemicals in Bay Area Foods",
              reportDate: "2024-07-11",
            },
            testedProduct: {
              name: "Creatine Monohydrate",
              brand: null,
              upc: null,
              sourceProductId: "79",
              matchMethod: "manual_confirmed",
            },
          },
        ],
      },
    });
  });

  it("keeps numeric upper-bound contaminant results as observation-only evidence", async () => {
    const queries = createSupplementsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey: "bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "lt",
                resultValue: 8,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.008,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                thresholdNormalizedValue: 0.01,
                thresholdNormalizedUnit: "ppm",
                thresholdNormalizedBasis: "product_mass",
                thresholdAuthorityName: "Example Authority",
                thresholdName: "Bisphenol A (BPA)",
                thresholdUrl: null,
                concernLevelIfExceeded: "low",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "unknown",
        alertCount: 0,
        alerts: [],
        observationCount: 1,
        observations: [
          {
            contaminantKey: "bpa",
            result: {
              operator: "lt",
              value: 8,
              unit: "ng/g",
              basis: "product_mass",
            },
            normalizedResult: {
              value: 0.008,
              unit: "ppm",
              basis: "product_mass",
            },
          },
        ],
      },
    });
  });

  it("keeps numeric upper-bound contaminant results unknown above thresholds", async () => {
    const queries = createSupplementsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey: "bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "lt",
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
                concernLevelIfExceeded: "low",
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    })).resolves.toMatchObject({
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "unknown",
        alertCount: 0,
        alerts: [],
        observationCount: 1,
      },
    });
  });

  it("keeps mixed below-threshold and non-comparable contaminant evidence unknown", async () => {
    const queries = createSupplementsQueries({
      async query<T>(text: string) {
        if (isProductTestsQuery(text)) {
          return {
            rows: [
              {
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey: "bpa",
                contaminantName: "Bisphenol A (BPA)",
                resultOperator: "eq",
                resultValue: 4,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.004,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
                thresholdValue: 10,
                thresholdUnit: "ng/g",
                thresholdBasis: "product_mass",
                thresholdNormalizedValue: 0.01,
                thresholdNormalizedUnit: "ppm",
                thresholdNormalizedBasis: "product_mass",
                thresholdAuthorityName: "Example Authority",
                thresholdName: "Bisphenol A (BPA)",
                thresholdUrl: null,
                concernLevelIfExceeded: "medium",
              },
              {
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey: "bps",
                contaminantName: "Bisphenol S (BPS)",
                resultOperator: "eq",
                resultValue: 8,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: 0.008,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
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
              ...["bbp", "dbp", "dehp", "dinp"].map((contaminantKey, index) => ({
                productId: "82118",
                sourceKey: "plasticlist_bay_area_2024",
                sourceName: "PlasticList",
                sourceUrl: "https://plasticlist.org",
                sourceReportTitle: "Data on Plastic Chemicals in Bay Area Foods",
                reportDate: "2024-07-11",
                sourceResultId: "7090411",
                testedProductName: "Creatine Monohydrate",
                testedProductBrand: null,
                testedProductUpc: null,
                testedSourceProductId: "79",
                matchMethod: "manual_confirmed",
                contaminantKey,
                contaminantName: contaminantKey.toUpperCase(),
                resultOperator: "eq",
                resultValue: 10 + index,
                resultUnit: "ng/g",
                resultBasis: "product_mass",
                normalizedValue: (10 + index) / 1000,
                normalizedUnit: "ppm",
                normalizedBasis: "product_mass",
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
              })),
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    const result = await queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    });

    expect(result).toMatchObject({
      id: "82118",
      contaminants: {
        status: "known_product_tests",
        murphConcernLevel: "unknown",
        alertCount: 0,
        alerts: [],
        observationCount: 6,
      },
    });
    expect(result?.contaminants?.observations).toHaveLength(6);
    expect(result?.contaminants?.observations.map((observation) => (
      observation.contaminantKey
    ))).toEqual(["bpa", "bps", "bbp", "dbp", "dehp", "dinp"]);
    expect(result?.contaminants?.observations[0]).toMatchObject({
      contaminantKey: "bpa",
      result: {
        operator: "eq",
        value: 4,
        unit: "ng/g",
        basis: "product_mass",
      },
    });
    expect(result?.contaminants?.observations[1]).toMatchObject({
      contaminantKey: "bps",
      result: {
        operator: "eq",
        value: 8,
        unit: "ng/g",
        basis: "product_mass",
      },
    });
  });

  it("scopes branded supplement searches to same-brand product matches", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Momentous" }] as T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        if (text.includes("brand_candidates AS MATERIALIZED")) {
          return {
            rows: [
              {
                id: "1001",
                dataOrigin: "dsld",
                dataOriginId: "1001",
                name: "Calcium",
                brand: "Momentous",
                upc: null,
                offMarket: false,
                label: {},
              },
            ] as T[],
          };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Momentous Calcium",
      limit: 1,
      includeOffMarket: false,
    });

    // brand index + brand-scoped search + contaminant attach for the row
    expect(calls).toHaveLength(3);
    expect(calls[0]?.text).toContain("GROUP BY brand");
    expect(calls[0]?.text).toContain(productTestSourceDataOriginFilter);
    expect(calls[0]?.text).not.toContain(
      "murph_product_test_legacy_source_backed_origin",
    );
    expect(calls[0]?.text).not.toContain("FROM product_tests product_test_sources");
    expect(calls[2]?.text).toContain("JOIN product_tests");

    const sql = calls[1]?.text ?? "";

    expect(sql).toContain("brand_candidates AS MATERIALIZED");
    expect(sql).toContain("brand = ANY($4::text[])");
    expect(sql).toContain("$5::text AS product_q");
    expect(sql).toContain(productTestSourceDataOriginFilter);
    expect(sql).not.toContain("murph_product_test_legacy_source_backed_origin");
    expect(sql).not.toContain("FROM product_tests product_test_sources");
    expect(sql).toContain("product_identity_match");
    expect(sql).toContain("WHERE product_identity_match = 1");
    expect(sql).toContain("websearch_to_tsquery('simple', product_q)");
    expect(sql).toContain("strict_word_similarity(product_q, name)");
    expect(sql).toContain("strict_word_similarity(raw_q, name)");
    expect(sql).toContain(`"offMarket" ASC,
            data_origin_priority ASC`);
    expect(sql).toContain("data_origin_priority ASC");
    expect(calls[1]?.values).toEqual([
      "Momentous Calcium",
      false,
      1,
      ["Momentous"],
      "calcium",
    ]);
  });

  it("does not brand-scope one-word brands from middle or brand-only queries", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Life" }] as T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Daily Life Magnesium",
      limit: 5,
      includeOffMarket: false,
    });
    await queries.searchSupplements({
      q: "Life",
      limit: 5,
      includeOffMarket: false,
    });
    await queries.searchSupplements({
      q: "Life Magnesium",
      limit: 1,
      includeOffMarket: false,
    });

    // Three generic searches: the two unscoped queries, plus the empty
    // brand-scoped "Life Magnesium" result falling back to the generic path.
    expect(
      calls.filter(
        (call) =>
          call.text.includes("fts_candidates AS MATERIALIZED") &&
          !call.text.includes("brand_candidates AS MATERIALIZED"),
      ),
    ).toHaveLength(3);
    expect(calls.filter((call) =>
      call.text.includes("brand_candidates AS MATERIALIZED"),
    )).toEqual([
      {
        text: expect.stringContaining("brand_candidates AS MATERIALIZED"),
        values: ["Life Magnesium", false, 1, ["Life"], "magnesium"],
      },
    ]);
  });

  it("falls back to generic search when a brand scope matches nothing", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Magnesium" }] as T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Magnesium Glycinate",
      limit: 5,
      includeOffMarket: false,
    });

    const brandScopedCalls = calls.filter((call) =>
      call.text.includes("brand_candidates AS MATERIALIZED"),
    );
    const genericCalls = calls.filter(
      (call) =>
        call.text.includes("fts_candidates AS MATERIALIZED") &&
        !call.text.includes("brand_candidates AS MATERIALIZED"),
    );

    expect(brandScopedCalls).toHaveLength(1);
    expect(genericCalls).toHaveLength(1);
    expect(genericCalls[0]?.values).toEqual([
      "Magnesium Glycinate",
      false,
      5,
      null,
    ]);
  });

  it("uses reordered multiword brand scopes to isolate product terms", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return {
            rows: [
              { brand: "Blueprint" },
              { brand: "Blueprint Bryan Johnson" },
              { brand: "Essentials" },
              { brand: "Garden of Life" },
            ],
          } as { rows: T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Bryan Johnson Blueprint Essentials",
      limit: 5,
      includeOffMarket: false,
    });

    expect(calls[1]?.values).toEqual([
      "Bryan Johnson Blueprint Essentials",
      false,
      5,
      [
        "Blueprint Bryan Johnson",
        "Essentials",
        "Blueprint",
      ],
      "essentials",
    ]);
  });

  it("does not promote middle one-word brands when the trailing ingredient word also looks like a brand", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return {
            rows: [{ brand: "Life" }, { brand: "Magnesium" }],
          } as { rows: T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Daily Life Magnesium",
      limit: 5,
      includeOffMarket: false,
    });

    const searchCall = calls.find((call) =>
      call.values.includes("Daily Life Magnesium"),
    );
    const brandScopes = searchCall?.values[3];

    expect(Array.isArray(brandScopes) ? brandScopes : []).not.toContain("Life");
  });

  it("matches possessive brand names without requiring apostrophes", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Doctor's Best" }] as T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Doctors Best Magnesium",
      limit: 3,
      includeOffMarket: false,
    });

    const sql = calls[1]?.text ?? "";

    expect(sql).toContain("replace(lower(name), '''', '')");
    expect(calls[1]?.values).toEqual([
      "Doctors Best Magnesium",
      false,
      3,
      ["Doctor's Best"],
      "magnesium",
    ]);
  });

  it("normalizes modifier-letter apostrophes before brand scoping", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Doctor's Best" }] as T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Doctorʼs Best Magnesium",
      limit: 3,
      includeOffMarket: false,
    });

    expect(calls[1]?.values).toEqual([
      "Doctors Best Magnesium",
      false,
      3,
      ["Doctor's Best"],
      "magnesium",
    ]);
  });

  it("keeps catalog brand spellings that normalize to the same one-word brand", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return {
            rows: [{ brand: "NOW" }, { brand: "Now" }, { brand: "now" }],
          } as { rows: T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "NOW Omega-3",
      limit: 5,
      includeOffMarket: false,
    });

    const scopedCall = calls.find((call) =>
      call.text.includes("brand_candidates AS MATERIALIZED"),
    );
    const scopedBrands = scopedCall?.values[3];

    expect(new Set(Array.isArray(scopedBrands) ? scopedBrands : [])).toEqual(
      new Set(["NOW", "Now", "now"]),
    );
    expect(scopedCall?.values[0]).toBe("NOW Omega 3");
    expect(scopedCall?.values[4]).toBe("omega 3");
  });

  it("reuses the supplement brand index across repeated searches", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Creatine",
      limit: 5,
      includeOffMarket: false,
    });
    await queries.searchSupplements({
      q: "Magnesium",
      limit: 5,
      includeOffMarket: false,
    });

    expect(calls.filter((call) => call.text.includes("GROUP BY brand"))).toHaveLength(
      1,
    );
    expect(
      calls.filter(
        (call) =>
          call.text.includes("fts_candidates AS MATERIALIZED") &&
          !call.text.includes("brand_candidates AS MATERIALIZED"),
      ),
    ).toEqual([
      {
        text: expect.stringContaining("fts_candidates AS MATERIALIZED"),
        values: ["Creatine", false, 5, null],
      },
      {
        text: expect.stringContaining("fts_candidates AS MATERIALIZED"),
        values: ["Magnesium", false, 5, null],
      },
    ]);
  });

  it("retries the supplement brand index after a failed load", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    let brandLoadAttempts = 0;
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          brandLoadAttempts += 1;
          if (brandLoadAttempts === 1) {
            throw new Error("brand index unavailable");
          }
          return { rows: [{ brand: "Momentous" }] as T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await expect(queries.searchSupplements({
      q: "Momentous Calcium",
      limit: 1,
      includeOffMarket: false,
    })).rejects.toThrow("brand index unavailable");

    await expect(queries.searchSupplements({
      q: "Momentous Calcium",
      limit: 1,
      includeOffMarket: false,
    })).resolves.toEqual([]);

    expect(calls.filter((call) => call.text.includes("GROUP BY brand"))).toHaveLength(
      2,
    );
    expect(calls.filter((call) => call.values.length === 5)).toEqual([
      {
        text: expect.stringContaining("brand_candidates AS MATERIALIZED"),
        values: ["Momentous Calcium", false, 1, ["Momentous"], "calcium"],
      },
    ]);
  });

  it("keeps overlapping brand scopes without one-word substring brands", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return {
            rows: [
              { brand: "Life" },
              { brand: "Garden of Life" },
              { brand: "Garden of Life Dr. Formulated" },
            ],
          } as { rows: T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Garden of Life Dr Formulated Probiotics",
      limit: 5,
      includeOffMarket: false,
    });

    expect(calls[1]?.values).toEqual([
      "Garden of Life Dr Formulated Probiotics",
      false,
      5,
      ["Garden of Life Dr. Formulated", "Garden of Life"],
      "probiotics",
    ]);
  });

  it("expands parent-brand scopes to sub-brand lines, query-overlapping lines first", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return {
            rows: [
              { brand: "Garden of Life" },
              { brand: "Garden of Life Sport" },
              { brand: "Garden of Life MyKind Organics" },
              { brand: "Momentous" },
            ],
          } as { rows: T[] };
        }
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Garden of Life Organics Women's Multi",
      limit: 5,
      includeOffMarket: false,
    });

    expect(calls[1]?.values).toEqual([
      "Garden of Life Organics Womens Multi",
      false,
      5,
      [
        "Garden of Life",
        "Garden of Life MyKind Organics",
        "Garden of Life Sport",
      ],
      "womens multi",
    ]);
  });

  it("skips invalid ids before querying", async () => {
    const queries = createSupplementsQueries({
      async query() {
        throw new Error("query should not run");
      },
    });

    await expect(queries.getSupplementById({
      id: "abc",
      includeOffMarket: false,
    })).resolves.toBeNull();
  });

  it("filters exact ids by off-market status", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "82118",
      includeOffMarket: false,
    })).resolves.toEqual({
      id: "82118",
      dataOrigin: "dsld",
      dataOriginId: "82118",
      name: "Creatine Monohydrate",
      brand: "Example",
      upc: "123456789012",
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls[0]?.text).toContain("off_market = false");
    expect(calls[0]?.values).toEqual(["82118", false]);
    expect(calls[1]?.text).toContain("product_tests.supplement_id");
    expect(calls[1]?.values).toEqual([["82118"], ["82118"]]);
  });

  it("fetches source-qualified ids from the unified supplements table", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64",
              dataOrigin: "dailymed",
              dataOriginId: "00446e6a-875c-4d46-9e13-a146c5fe7a64",
              name: "JBA STANOMAX Caffe Latte",
              brand: "Advanced Pharmaceutical Services",
              upc: null,
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64",
      includeOffMarket: false,
    })).resolves.toEqual({
      id: "dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64",
      dataOrigin: "dailymed",
      dataOriginId: "00446e6a-875c-4d46-9e13-a146c5fe7a64",
      name: "JBA STANOMAX Caffe Latte",
      brand: "Advanced Pharmaceutical Services",
      upc: null,
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("FROM supplements");
    expect(calls[0]?.text).toContain("id = $1");
    expect(calls[0]?.text).toContain(productTestSourceDataOriginFilter);
    expect(calls[0]?.text).not.toContain(
      "murph_product_test_legacy_source_backed_origin",
    );
    expect(calls[0]?.text).not.toContain("FROM product_tests product_test_sources");
    expect(calls[0]?.text).not.toContain("supplement_external_labels");
    expect(calls[0]?.text).not.toContain("matched_dsld_id");
    expect(calls[0]?.values).toEqual([
      "dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64",
      false,
    ]);
  });

  it("accepts hyphenated public id prefixes independently from data origin names", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [] as T[],
        };
      },
    });

    await expect(queries.getSupplementById({
      id: "life-extension:product-1",
      includeOffMarket: false,
    })).resolves.toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(["life-extension:product-1", false]);
  });

  it("normalizes UPC digits, checks leading-zero variants, and orders matches deterministically", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: "Example",
              upc: "123456789012",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementByUpc({
      upc: "00123-456 789012",
      includeOffMarket: false,
    })).resolves.toEqual({
      id: "82118",
      dataOrigin: "dsld",
      dataOriginId: "82118",
      name: "Creatine Monohydrate",
      brand: "Example",
      upc: "123456789012",
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls[0]?.text).toContain("off_market = false");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.text).toContain("data_origin_priority ASC");
    expect(calls[0]?.text).not.toContain("supplement_external_labels");
    expect(calls[0]?.values).toEqual([
      ["00123456789012", "123456789012", "0123456789012"],
      false,
    ]);
    expect(calls[1]?.text).toContain("product_tests.supplement_id");
    expect(calls[1]?.values).toEqual([["82118"], ["82118"]]);
  });

  it("checks a GTIN-8 supplement code against its zero-padded GTIN-14 fallback", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "82119",
              dataOrigin: "dsld",
              dataOriginId: "82119",
              name: "Electrolyte Tablets",
              brand: "Example",
              upc: "00000012345670",
              offMarket: false,
              label: {},
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getSupplementByUpc({
      upc: "12345670",
      includeOffMarket: false,
    })).resolves.toEqual({
      id: "82119",
      dataOrigin: "dsld",
      dataOriginId: "82119",
      name: "Electrolyte Tablets",
      brand: "Example",
      upc: "00000012345670",
      offMarket: false,
      label: {},
      contaminants: emptyContaminants,
    });
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.values).toEqual([
      ["12345670", "00000012345670"],
      false,
    ]);
    expect(calls[1]?.text).toContain("product_tests.supplement_id");
    expect(calls[1]?.values).toEqual([["82119"], ["82119"]]);
  });

  it("does not generate non-GTIN widths while stripping zero-padded codes", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return { rows: [] as T[] };
      },
    });

    await expect(queries.getSupplementByUpc({
      upc: "00000123456789",
      includeOffMarket: false,
    })).resolves.toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([
      ["00000123456789", "0000123456789", "000123456789"],
      false,
    ]);
  });

  it("bounds public supplement candidates before ranking", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createPublicSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              dataOriginUrl: "https://example.test/supplement/82118",
              importedAt: "2026-07-16T12:00:00.000Z",
              name: "Creatine Monohydrate",
              brand: "Example Nutrition",
              upc: "123456789012",
              observationCount: 3,
              sourceCount: 1,
              latestReportDate: "2026-06-01",
            },
          ] as T[],
        };
      },
    });

    const result = await queries.searchPublicSupplements({
      q: "Example Nutrition Creatine Monohydrate",
      limit: 5,
    });

    expect(result[0]?.testing).toEqual({
      status: "known_product_tests",
      observationCount: 3,
      sourceCount: 1,
      latestReportDate: "2026-06-01",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("fts_candidates AS MATERIALIZED");
    expect(calls[0]?.text).toContain("fts_canonical_matches AS MATERIALIZED");
    expect(calls[0]?.text).toContain(
      "product_tests.supplement_id = selected.id",
    );
    expect(calls[0]?.text).not.toContain("labels.label");
    expect(calls[0]?.text).not.toMatch(
      /brand_candidates AS MATERIALIZED[\s\S]*?\blabel\b[\s\S]*?FROM supplements/u,
    );
  });

  it("projects public supplement record provenance without food-only dates", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createPublicSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return {
          rows: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              dataOriginUrl: "https://example.test/supplement/82118",
              importedAt: "2026-07-16T12:00:00.000Z",
              releaseDate: null,
              lastSeenAt: null,
              name: "Creatine Monohydrate",
              brand: "Example Nutrition",
              upc: "123456789012",
              servingGrams: 5,
              label: { ingredientRows: [] },
              labelOmitted: false,
            },
          ] as T[],
        };
      },
    });

    await expect(queries.getPublicSupplementRecordById({
      id: "82118",
    })).resolves.toMatchObject({
      releaseDate: null,
      lastSeenAt: null,
      servingGrams: 5,
    });
    expect(calls[0]?.text).toContain("NULL::text AS \"releaseDate\"");
    expect(calls[0]?.text).toContain("NULL::text AS \"lastSeenAt\"");
    expect(calls[0]?.text).toContain("octet_length(labels.label::text)");
    expect(calls[0]?.text).toContain('AS "labelOmitted"');
  });

  it("bounds exact supplement evidence after stable observation deduplication", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createPublicSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return {
          rows: [
            {
              productId: "brand-site:example-creatine",
              productTestId: "test-1",
              observationTotal: 1,
              servingGrams: 5,
              sourceKey: "example_laboratory_report",
              sourceName: "Example Laboratory Report",
              sourceUrl: "https://example.test/report",
              sourceReportTitle: "Example product testing",
              reportDate: "2026-06-01",
              sourceResultId: "result-1",
              testedProductName: "Creatine Monohydrate",
              testedProductBrand: "Example Nutrition",
              testedProductUpc: "123456789012",
              testedSourceProductId: "source-product-123",
              matchMethod: "manual_confirmed",
              contaminantKey: "lead",
              contaminantName: "Lead",
              resultOperator: "not_detected",
              resultValue: null,
              resultUnit: "ppm",
              resultBasis: "product_mass",
              normalizedValue: null,
              normalizedUnit: null,
              normalizedBasis: null,
              labName: null,
              testMethod: null,
              importedAt: "2026-07-16T12:00:00.000Z",
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
      },
    });

    const evidence = await queries.getPublicSupplementEvidence({
      id: "brand-site:example-creatine",
    });

    expect(evidence).toMatchObject({
      total: 1,
      returned: 1,
      truncated: false,
      observations: [
        {
          id: "test-1",
          sourceResultId: "result-1",
          screening: null,
          alert: null,
        },
      ],
    });
    expect(calls).toHaveLength(1);
    const query = calls[0]?.text ?? "";
    expect(query).not.toContain("linked_labels AS MATERIALIZED");
    expect(query).toContain("labels.id = product_tests.supplement_id");
    expect(query).toContain("labels.id = $1");
    expect(query).toContain("DISTINCT ON (product_tests.id)");
    expect(query).toContain("WHERE observation_rank <= 20");
    expect(query.indexOf("bounded_observations AS MATERIALIZED")).toBeLessThan(
      query.indexOf("FROM contaminant_thresholds threshold_rows"),
    );
    expect(calls[0]?.values).toEqual(["brand-site:example-creatine"]);
  });
});
