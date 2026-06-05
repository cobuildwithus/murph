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
    expect(dsldImportSql).not.toContain(":'DSLD_NDJSON_PATH'");

    expect(dailymedImportSql).toContain(
      `FROM PROGRAM 'if [ -n "$DAILYMED_NDJSON_PATH" ]`,
    );
    expect(dailymedImportSql).toContain("\\set ON_ERROR_STOP on");
    expect(dailymedImportSql).toContain(`cat "$DAILYMED_NDJSON_PATH"`);
    expect(dailymedImportSql).not.toContain(":'DAILYMED_NDJSON_PATH'");
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
              name: "Creatine Monohydrate",
              brand: null,
              upc: null,
              offMarket: false,
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
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("websearch_to_tsquery");
    expect(calls[0]?.text).toContain("FROM supplements, query");
    expect(calls[0]?.text).toContain("FROM supplement_external_labels, query");
    expect(calls[0]?.text).toContain("matched_dsld_id IS NULL");
    expect(calls[0]?.text).toContain("NOT EXISTS");
    expect(calls[0]?.text).toContain("to_tsvector('simple', matched.search_text) @@ query.tsq");
    expect(calls[0]?.text).toContain("matched.off_market = false");
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
      name: "Creatine Monohydrate",
      brand: "Example",
      upc: "123456789012",
      offMarket: false,
      label: {},
    });
    expect(calls[0]?.text).toContain("off_market = false");
    expect(calls[0]?.values).toEqual(["82118", false]);
  });

  it("fetches external source ids from the external labels table", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queries = createSupplementsQueries({
      async query<T>(text: string, values: unknown[]) {
        calls.push({ text, values });
        return {
          rows: [
            {
              id: "dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64",
              source: "dailymed",
              sourceId: "00446e6a-875c-4d46-9e13-a146c5fe7a64",
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
      source: "dailymed",
      sourceId: "00446e6a-875c-4d46-9e13-a146c5fe7a64",
      name: "JBA STANOMAX Caffe Latte",
      brand: "Advanced Pharmaceutical Services",
      upc: null,
      offMarket: false,
      label: {},
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("FROM supplement_external_labels");
    expect(calls[0]?.text).not.toContain("matched_dsld_id IS NULL");
    expect(calls[0]?.text).not.toContain("NOT EXISTS");
    expect(calls[0]?.values).toEqual([
      "dailymed",
      "00446e6a-875c-4d46-9e13-a146c5fe7a64",
      false,
    ]);
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
      name: "Creatine Monohydrate",
      brand: "Example",
      upc: "123456789012",
      offMarket: false,
      label: {},
    });
    expect(calls[0]?.text).toContain("off_market = false");
    expect(calls[0]?.text).toContain("upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) AS upc_order");
    expect(calls[0]?.text).toContain("upc_order ASC");
    expect(calls[0]?.text).toContain("FROM supplement_external_labels");
    expect(calls[0]?.text).toContain("NOT EXISTS");
    expect(calls[0]?.text).toContain("matched.upc = ANY($1::text[])");
    expect(calls[0]?.text).toContain("source_order ASC");
    expect(calls[0]?.values).toEqual([
      ["00123456789012", "123456789012", "0123456789012"],
      false,
    ]);
  });
});
