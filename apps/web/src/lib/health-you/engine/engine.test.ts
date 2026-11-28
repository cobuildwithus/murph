import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromRaw, score } from "./index";
import { offset, curveAt, isObject, model, refs, type Observation } from "./model";

const cases: { case: string; member: Observation; history: Observation; as_of: string; expected: unknown }[] =
  JSON.parse(
    readFileSync(new URL("../../../../test/fixtures/health-you/reference.json", import.meta.url), "utf8"),
  );

// Displayed ages, intervals, days, ranks, integer allocations and the evidence ledger are exact.
// Match the reference checker's tolerance for its existing floating-point fields.
function tolerance(path: string, expected: number) {
  if (/\.(years|probability|quality|value|target)$/.test(path)) return 1e-10;
  if (
    /\.(current_years|landmark_years|projected_years)$/.test(path) ||
    /\.projection\.(historical_panel_risk|five_year_risk_fit_ci95|midlife_age_fit_ci95)\./.test(path) ||
    /\.projection\.(current_age|projected_age|midlife_equivalent_age)$/.test(path)
  ) {
    return 16 * Number.EPSILON * Math.max(1, Math.abs(expected));
  }
  return 0;
}
function compare(actual: unknown, expected: unknown, path: string) {
  const epsilon = typeof expected === "number" && !Number.isInteger(expected) ? tolerance(path, expected) : 0;
  if (epsilon && typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs(Number(actual) - expected), path).toBeLessThanOrEqual(epsilon);
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    expect(actual.length, path).toBe(expected.length);
    expected.forEach((x, i) => compare(actual[i], x, path + "." + i));
  } else if (isObject(expected) && isObject(actual)) {
    expect(Object.keys(actual).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) compare(actual[k], v, path + "." + k);
  } else expect(actual, path).toEqual(expected);
}
describe("round 17 scorer parity", () => {
  it("contains the entire synthetic release", () => expect(new Set(cases.map((r) => r.case)).size).toBe(1071));
  for (const row of cases)
    it(row.case, () => {
      compare(fromRaw(row.member, row.as_of, row.history), row.expected, row.case);
    });
  it.each([
    ["oral_rating", 4, 3],
    ["edentulous", 1, 9],
    ["chair", 3, 10],
    ["hospital", 1, 9],
    ["k6", 13, 10],
    ["delayed", 1, 10],
    ["vision", 1, 7],
    ["cac", 258, 3],
  ] as const)(
    "matches the reference for the %s instrument and rejects an unmatched protocol",
    (key, value, tenths) => {
      const at = "2032-07-14";
      const { protocol, unit } = model.coverage.factors[key];
      const observation = {
        key,
        value,
        protocol,
        unit,
        date: at,
        source: "clinical_report",
        asymptomatic: true,
        known_cvd: false,
        items_completed: key === "k6" ? 6 : 3,
      };
      const profile = { age: 66, sex: "female" };
      expect(score({ profile, extensions: [observation] }, at)?.parts[key]).toBe(tenths);
      expect(
        score({ profile, extensions: [{ ...observation, protocol: "unspecified" }] }, at)?.rows[key],
      ).toBeUndefined();
    },
  );
  it("uses daily fibre grams on confirmed days with consistent meal energy", () => {
    const at = "2034-08-19";
    const dates = Array.from({ length: 9 }, (_, i) => offset(at, -i));
    const data = {
      profile: { age: 53, sex: "female" },
      checkins: dates.map((date) => ({ date, diet_day_complete: true })),
      meals: dates.map((date) => ({
        date,
        id: date,
        fiber_g: 23,
        protein_g: 30,
        carbs_g: 50,
        fat_g: 20,
        calories: 500,
      })),
    };
    const confirmed = score(data, at)?.rows;
    expect(confirmed?.meal_fibre?.value).toBe(23);
    expect(confirmed?.meal_density).toBeUndefined();
    const partial = score({ ...data, checkins: [] }, at)?.rows;
    expect(partial?.meal_fibre).toBeUndefined();
    expect(partial?.meal_density?.value).toBe(46);
    expect(
      score({ ...data, meals: data.meals.map((m) => ({ ...m, calories: 1800 })) }, at)?.rows.meal_fibre,
    ).toBeUndefined();
  });
  it("centers an absent lab at its age and sex expectation", () => {
    const date = "2024-02-11",
      profile = { age: 44, sex: "female" };
    const [median] = curveAt(44, refs.ggt.ref["2"], (r) => [r.q[2]])!;
    const data = {
      profile,
      labs: [{ date, marker: "ggt", value: median, unit: model.fields.ggt.unit }],
    };
    expect(score(data, date)!.rows.ggt.years).toBeCloseTo(0, 12);
    expect(score(data, date)!.value).toBe(score({ profile }, date)!.value);
  });
});
