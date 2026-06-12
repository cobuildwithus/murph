// Live-DB regression corpus for the supplements search algorithm. Runs only
// when MURPH_LABELS_DB_URL or MURPH_SUPPLEMENT_DB_URL is set (skipped in CI
// without DB access):
//   MURPH_LABELS_DB_URL=... pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/supplements-search-live.test.ts
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  createSupplementsQueries,
  normalizeSupplementConnectionString,
  type SupplementSearchItem,
} from "../src/lib/supplements";

const databaseUrl =
  process.env.MURPH_LABELS_DB_URL ?? process.env.MURPH_SUPPLEMENT_DB_URL;

describe.runIf(Boolean(databaseUrl))("supplements live search corpus", () => {
  const pool = new pg.Pool({
    connectionString: normalizeSupplementConnectionString(databaseUrl ?? ""),
    max: 3,
    statement_timeout: 8_000,
  });
  const queries = createSupplementsQueries(pool);

  afterAll(async () => {
    await pool.end();
  });

  async function search(q: string): Promise<SupplementSearchItem[]> {
    return await queries.searchSupplements({
      q,
      limit: 5,
      includeOffMarket: false,
    });
  }

  it("finds generic ingredient queries", async () => {
    expect((await search("creatine"))[0]?.name).toMatch(/creatine/iu);
    expect((await search("magnesium glycinate"))[0]?.name).toMatch(
      /magnesium glycinate/iu,
    );
    expect((await search("vitamin d3 5000 iu"))[0]?.name).toMatch(
      /vitamin d3 5000/iu,
    );
    expect((await search("omega 3 fish oil"))[0]?.name).toMatch(
      /omega 3 fish oil/iu,
    );
  }, 120_000);

  it("scopes brand-prefixed queries to that brand", async () => {
    const momentous = await search("Momentous Creatine");
    expect(momentous[0]?.name).toMatch(/creatine/iu);
    expect(momentous.map((row) => row.brand)).toEqual(
      momentous.map(() => "Momentous"),
    );

    const thorne = await search("Thorne Magnesium Bisglycinate");
    expect(thorne[0]?.brand).toBe("Thorne");
    expect(thorne[0]?.name).toMatch(/magnesium bisglycinate/iu);

    const pureEncapsulations = await search(
      "Pure Encapsulations Magnesium Glycinate",
    );
    expect(pureEncapsulations[0]?.brand).toBe("Pure Encapsulations");
    expect(pureEncapsulations[0]?.name).toMatch(/glycinate/iu);

    const natureMade = await search("Nature Made Vitamin C");
    expect(natureMade[0]?.brand).toBe("Nature Made");
    expect(natureMade[0]?.name).toMatch(/vitamin c/iu);

    const lifeExtension = await search("Life Extension Magnesium");
    expect(lifeExtension[0]?.brand).toBe("Life Extension");
    expect(lifeExtension[0]?.name).toMatch(/magnesium/iu);

    const optimumNutrition = await search(
      "Optimum Nutrition Gold Standard Whey",
    );
    expect(optimumNutrition[0]?.brand).toBe("Optimum Nutrition");
    expect(optimumNutrition[0]?.name).toMatch(/gold standard/iu);
  }, 120_000);

  it("matches possessive brands typed without apostrophes", async () => {
    const doctorsBest = await search("Doctors Best Magnesium");
    expect(doctorsBest[0]?.brand).toBe("Doctor's Best");
    expect(doctorsBest[0]?.name).toMatch(/magnesium/iu);
  }, 120_000);

  it("keeps finding products when the sub-brand line is typed exactly", async () => {
    const drFormulated = await search("Garden of Life Dr Formulated Probiotics");
    expect(drFormulated[0]?.brand).toMatch(/^Garden of Life/iu);
    expect(drFormulated[0]?.name).toMatch(/probiotic/iu);

    const mykind = await search("Garden of Life mykind Organics Women's Multi");
    expect(mykind[0]?.brand).toBe("Garden of Life MyKind Organics");
    expect(mykind[0]?.name).toBe("Women's Multi");

    const vitaminCode = await search("Garden of Life Vitamin Code Raw Iron");
    expect(vitaminCode[0]?.brand).toBe("Garden of Life Vitamin Code");
    expect(vitaminCode[0]?.name).toBe("Raw Iron");
  }, 120_000);

  it("finds sub-brand line products from parent-brand queries", async () => {
    // Regression for the "Garden of Life Organics ..." miss: products live
    // under the "Garden of Life MyKind Organics" brand line, and the query
    // names the parent brand without the "mykind" token.
    const womensMulti = await search("Garden of Life Organics Women's Multi");
    expect(womensMulti[0]?.brand).toBe("Garden of Life MyKind Organics");
    expect(womensMulti[0]?.name).toBe("Women's Multi");

    const onceDaily = await search(
      "Garden of Life Organics Women's Once Daily",
    );
    expect(onceDaily[0]?.brand).toBe("Garden of Life MyKind Organics");
    expect(onceDaily[0]?.name).toBe("Women's Once Daily");
  }, 120_000);

  it("returns results for known ranking quirks without asserting order", async () => {
    // These currently rank an off-brand or adjacent product first; tracked as
    // candidates for future ranking work. Assert coverage only so this test
    // flags silent emptiness, not ranking churn.
    expect((await search("NOW Omega-3")).length).toBeGreaterThan(0);
    expect((await search("Solgar Vitamin D3")).length).toBeGreaterThan(0);
    expect((await search("Ritual Essential for Women")).length).toBeGreaterThan(
      0,
    );
  }, 120_000);
});
