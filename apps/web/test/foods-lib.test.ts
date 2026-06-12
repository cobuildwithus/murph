import { describe, expect, it } from "vitest";

import {
  createFoodsQueries,
  createProductLabelsQueries,
  normalizeSupplementConnectionString,
} from "../src/lib/supplements";

describe("foods query helpers", () => {
  it("normalizes shared labels database connection strings for pg", () => {
    expect(
      normalizeSupplementConnectionString(
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
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("GROUP BY brand");
    expect(calls[0]?.values).toEqual([]);

    const searchCall = calls[1];
    expect(searchCall?.text).toContain("websearch_to_tsquery");
    expect(searchCall?.text).toContain("$1::text AS raw_q");
    expect(searchCall?.text).toContain(
      "strict_word_similarity(name, query.raw_q)",
    );
    expect(searchCall?.text).toContain("name % query.raw_q");
    expect(searchCall?.text).toContain("FROM foods, query");
    expect(searchCall?.text).toContain("PARTITION BY canonical_key");
    expect(searchCall?.text).toContain("dedupe_rank = 1");
    expect(searchCall?.text).toContain("data_origin_priority ASC");
    expect(searchCall?.text).toContain("label");
    expect(searchCall?.text).not.toContain("FROM supplements");
    expect(searchCall?.values).toEqual(["greek yogurt", false, 5]);
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

  it("scopes branded food searches to same-brand product matches", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Example Dairy" }] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchFoods({
      q: "Example Dairy Greek Yogurt",
      limit: 1,
      includeOffMarket: false,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("FROM foods");

    const sql = calls[1]?.text ?? "";
    expect(sql).toContain("brand_candidates AS MATERIALIZED");
    expect(sql).toContain("FROM foods");
    expect(sql).toContain("brand = ANY($4::text[])");
    expect(sql).toContain("product_identity_match");
    expect(sql).toContain("WHERE product_identity_match = 1");
    expect(sql).toContain("websearch_to_tsquery('simple', product_q)");
    expect(sql).toContain("strict_word_similarity(name, product_q)");
    expect(sql).not.toContain("FROM supplements");
    expect(calls[1]?.values).toEqual([
      "Example Dairy Greek Yogurt",
      false,
      1,
      ["Example Dairy"],
    ]);
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
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("id = $1");
    expect(calls[0]?.text).not.toContain("FROM supplements");
    expect(calls[0]?.values).toEqual(["fdc:123", false]);
  });

  it("normalizes UPC digits and checks food leading-zero variants", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createFoodsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
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
    });
    expect(calls[0]?.text).toContain("FROM foods");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.text).not.toContain("FROM supplements");
    expect(calls[0]?.values).toEqual([
      ["00123456789012", "123456789012", "0123456789012"],
      false,
    ]);
  });
});
