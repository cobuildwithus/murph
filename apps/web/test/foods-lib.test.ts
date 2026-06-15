import { describe, expect, it } from "vitest";

import { createFoodsQueries } from "../src/lib/foods";
import {
  createFoodsQueries as createFoodsQueriesFromSupplements,
} from "../src/lib/supplements";
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

function isProductTestsQuery(text: string): boolean {
  return text.includes("FROM product_tests");
}

describe("foods query helpers", () => {
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
      "strict_word_similarity(name, query.raw_q)",
    );
    expect(searchCall?.text).toContain("fts_candidates AS MATERIALIZED");
    expect(searchCall?.text).toContain("trigram_candidates AS MATERIALIZED");
    expect(searchCall?.text).toContain(
      "NOT EXISTS (SELECT 1 FROM fts_candidates)",
    );
    expect(searchCall?.text).toContain("name % query.raw_q");
    expect(searchCall?.text).not.toContain("OR name % query.raw_q");
    expect(searchCall?.text).toContain("FROM foods, query");
    expect(searchCall?.text).toContain("data_origin <> 'plasticlist_bay_area_2024'");
    expect(searchCall?.text).toContain("data_origin <> 'nyc_dohmh_consumer_products'");
    expect(searchCall?.text).toContain("data_origin <> 'king_county_consumer_products'");
    expect(searchCall?.text).toContain("data_origin <> 'pure_earth_rms_2024'");
    expect(searchCall?.text).not.toMatch(
      /fts_candidates AS MATERIALIZED[\s\S]*?\blabel\b[\s\S]*?FROM foods, query/u,
    );
    expect(searchCall?.text).not.toMatch(
      /trigram_candidates AS MATERIALIZED[\s\S]*?\blabel\b[\s\S]*?FROM foods, query/u,
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
    expect(searchCall?.values).toEqual(["greek yogurt", false, 5]);

    const contaminantsCall = calls[1];
    expect(contaminantsCall?.text).toContain("FROM product_tests");
    expect(contaminantsCall?.text).toContain("product_tests.food_id");
    expect(contaminantsCall?.values).toEqual([["fdc:123"]]);
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
    expect(calls).toHaveLength(2);

    const sql = calls[0]?.text ?? "";
    expect(sql).toContain("FROM foods");
    expect(sql).toContain("websearch_to_tsquery('simple', $1)");
    expect(sql).toContain("strict_word_similarity(name, query.raw_q)");
    expect(sql).toContain("fts_candidates AS MATERIALIZED");
    expect(sql).toContain("trigram_candidates AS MATERIALIZED");
    expect(sql).toContain("data_origin <> 'plasticlist_bay_area_2024'");
    expect(sql).toContain("data_origin <> 'nyc_dohmh_consumer_products'");
    expect(sql).toContain("data_origin <> 'king_county_consumer_products'");
    expect(sql).toContain("data_origin <> 'pure_earth_rms_2024'");
    expect(sql).toContain("JOIN foods labels");
    expect(sql).toMatch(
      /selected AS \([\s\S]*?LIMIT \$3[\s\S]*?\)\s*SELECT[\s\S]*?labels\.label[\s\S]*?FROM selected[\s\S]*?JOIN foods labels/u,
    );
    expect(sql).not.toContain("brand_candidates AS MATERIALIZED");
    expect(sql).not.toContain("brand = ANY($4::text[])");
    expect(sql).not.toMatch(
      /SELECT\s+brand[\s\S]*FROM foods[\s\S]*GROUP BY brand/u,
    );
    expect(sql).not.toContain("FROM supplements");
    expect(calls[0]?.values).toEqual(["Example Dairy Greek Yogurt", false, 1]);
  });

  it("preserves the legacy supplements export for food query creation", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueriesFromSupplements({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (isProductTestsQuery(text)) {
          return { rows: [] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchFoods({
      q: "banana",
      limit: 1,
      includeOffMarket: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).not.toContain("FROM supplements");
    expect(calls[0]?.values).toEqual(["banana", false, 1]);
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
    expect(calls[0]?.text).not.toContain("data_origin <> 'plasticlist_bay_area_2024'");
    expect(calls[0]?.text).not.toContain("data_origin <> 'nyc_dohmh_consumer_products'");
    expect(calls[0]?.text).not.toContain("data_origin <> 'king_county_consumer_products'");
    expect(calls[0]?.text).not.toContain("data_origin <> 'pure_earth_rms_2024'");
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
});
