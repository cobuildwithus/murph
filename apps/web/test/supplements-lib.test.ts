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
    expect(dsldImportSql).not.toContain(":'DSLD_NDJSON_PATH'");

    expect(dailymedImportSql).toContain(
      `FROM PROGRAM 'if [ -n "$DAILYMED_NDJSON_PATH" ]`,
    );
    expect(dailymedImportSql).toContain("\\set ON_ERROR_STOP on");
    expect(dailymedImportSql).toContain(`cat "$DAILYMED_NDJSON_PATH"`);
    expect(dailymedImportSql).toContain("WITH (FORMAT csv");
    expect(dailymedImportSql).not.toContain(":'DAILYMED_NDJSON_PATH'");
  });

  it("keeps the supplements schema on one table without redundant origin indexes", async () => {
    const schemaSql = await readFile(
      new URL("../sql/supplements/schema.sql", import.meta.url),
      "utf8",
    );

    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS supplements");
    expect(schemaSql).toContain("UNIQUE (data_origin, data_origin_id)");
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS supplements_canonical_key_idx");
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
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("websearch_to_tsquery");
    expect(calls[0]?.text).toContain("FROM supplements, query");
    expect(calls[0]?.text).toContain("PARTITION BY canonical_key");
    expect(calls[0]?.text).toContain("dedupe_rank = 1");
    expect(calls[0]?.text).toContain("data_origin_priority ASC");
    expect(calls[0]?.text).toContain("label");
    expect(calls[0]?.text).not.toContain("supplement_external_labels");
    expect(calls[0]?.text).not.toContain("matched_dsld_id");
    expect(calls[0]?.values).toEqual(["creatine", false, 5]);
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
