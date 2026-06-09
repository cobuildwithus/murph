import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createSupplementsQueries,
  normalizeSupplementConnectionString,
} from "../src/lib/supplements";

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
      "CREATE INDEX IF NOT EXISTS supplements_name_trgm_idx",
    );
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS supplements_brand_idx",
    );
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS supplements_canonical_key_idx",
    );
    expect(schemaSql).not.toContain("supplement_external_labels");
    expect(schemaSql).not.toContain("supplements_data_origin_idx");
  });

  it("parameterizes search text, off-market filter, and limit", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
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
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("GROUP BY brand");
    expect(calls[0]?.values).toEqual([]);

    const searchCall = calls[1];
    expect(searchCall?.text).toContain("websearch_to_tsquery");
    expect(searchCall?.text).toContain("$1::text AS raw_q");
    expect(searchCall?.text).toContain(
      "strict_word_similarity(name, query.raw_q)",
    );
    expect(searchCall?.text).toContain("name % query.raw_q");
    expect(searchCall?.text).toContain("name_phrase_match DESC");
    expect(searchCall?.text).toContain("name_phrase_length DESC");
    expect(searchCall?.text).toContain("name_similarity DESC");
    expect(searchCall?.text).toContain("FROM supplements, query");
    expect(searchCall?.text).toContain("PARTITION BY canonical_key");
    expect(searchCall?.text).toContain("dedupe_rank = 1");
    expect(searchCall?.text).toContain("data_origin_priority ASC");
    expect(searchCall?.text).toContain("label");
    expect(searchCall?.text).not.toContain("brand_candidates AS MATERIALIZED");
    expect(searchCall?.text).not.toContain("supplement_external_labels");
    expect(searchCall?.text).not.toContain("matched_dsld_id");
    expect(searchCall?.values).toEqual(["creatine", false, 5]);
  });

  it("scopes branded supplement searches to same-brand product matches", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        if (text.includes("GROUP BY brand")) {
          return { rows: [{ brand: "Momentous" }] as T[] };
        }
        return { rows: [] as T[] };
      },
    });

    await queries.searchSupplements({
      q: "Momentous Calcium",
      limit: 1,
      includeOffMarket: false,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("GROUP BY brand");

    const sql = calls[1]?.text ?? "";

    expect(sql).toContain("brand_candidates AS MATERIALIZED");
    expect(sql).toContain("brand = ANY($4::text[])");
    expect(sql).toContain("product_identity_match");
    expect(sql).toContain("WHERE product_identity_match = 1");
    expect(sql).toContain("websearch_to_tsquery('simple', product_q)");
    expect(sql).toContain("strict_word_similarity(name, product_q)");
    expect(sql).toContain(`"offMarket" ASC,
            data_origin_priority ASC`);
    expect(sql).toContain("data_origin_priority ASC");
    expect(calls[1]?.values).toEqual([
      "Momentous Calcium",
      false,
      1,
      ["Momentous"],
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

    expect(calls.filter((call) => call.values.length === 3)).toHaveLength(2);
    expect(calls.filter((call) => call.values.length === 4)).toEqual([
      {
        text: expect.stringContaining("brand_candidates AS MATERIALIZED"),
        values: ["Life Magnesium", false, 1, ["Life"]],
      },
    ]);
  });

  it("matches possessive brand names without requiring apostrophes", async () => {
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
      q: "Doctors Best Magnesium",
      limit: 3,
      includeOffMarket: false,
    });

    const sql = calls[1]?.text ?? "";

    expect(sql).toContain("replace(lower($1::text), '''', '')");
    expect(sql).toContain("replace(lower(name), '''', '')");
    expect(sql).toContain("replace(lower(brand), '''', '')");
    expect(calls[1]?.values).toEqual([
      "Doctors Best Magnesium",
      false,
      3,
      ["Doctor's Best"],
    ]);
  });

  it("reuses the supplement brand index across repeated searches", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
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
    expect(calls.filter((call) => call.values.length === 3)).toHaveLength(2);
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
    expect(calls.filter((call) => call.values.length === 4)).toEqual([
      {
        text: expect.stringContaining("brand_candidates AS MATERIALIZED"),
        values: ["Momentous Calcium", false, 1, ["Momentous"]],
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
    });
    expect(calls[0]?.text).toContain("off_market = false");
    expect(calls[0]?.values).toEqual(["82118", false]);
  });

  it("fetches source-qualified ids from the unified supplements table", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
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
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("FROM supplements");
    expect(calls[0]?.text).toContain("id = $1");
    expect(calls[0]?.text).not.toContain("supplement_external_labels");
    expect(calls[0]?.text).not.toContain("matched_dsld_id");
    expect(calls[0]?.text).not.toContain("NOT EXISTS");
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
    });
    expect(calls[0]?.text).toContain("off_market = false");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.text).toContain("data_origin_priority ASC");
    expect(calls[0]?.text).not.toContain("supplement_external_labels");
    expect(calls[0]?.text).not.toContain("NOT EXISTS");
    expect(calls[0]?.values).toEqual([
      ["00123456789012", "123456789012", "0123456789012"],
      false,
    ]);
  });
});
