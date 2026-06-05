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
    expect(calls[0]?.text).toContain("array_position($1::text[], upc) ASC");
    expect(calls[0]?.text).toContain("dsld_id ASC");
    expect(calls[0]?.values).toEqual([
      ["00123456789012", "123456789012", "0123456789012"],
      false,
    ]);
  });
});
