import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromRaw, score } from "./index";
import { offset, curveAt, isObject, model, refs, type Observation } from "./model";

const cases: { case: string; member: Observation; history: Observation; as_of: string; expected: unknown }[] =
  JSON.parse(
    readFileSync(new URL("../../../../test/fixtures/health-you/reference.json", import.meta.url), "utf8"),
  );

// Match the research verifier's exact display, shape and attribution checks.
function compare(actual: unknown, expected: unknown, path: string) {
  if (
    typeof expected === "number" &&
    !Number.isInteger(expected) &&
    /\.(years|probability|quality|value|target)$/.test(path)
  ) {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs(Number(actual) - expected), path).toBeLessThanOrEqual(1e-10);
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    expect(actual.length, path).toBe(expected.length);
    expected.forEach((x, i) => compare(actual[i], x, path + "." + i));
  } else if (isObject(expected) && isObject(actual)) {
    expect(Object.keys(actual).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) compare(actual[k], v, path + "." + k);
  } else expect(actual, path).toEqual(expected);
}
describe("round 5 scorer parity", () => {
  it("contains the entire synthetic release", () => expect(new Set(cases.map((r) => r.case)).size).toBe(180));
  for (const row of cases)
    it(row.case, () => {
      compare(fromRaw(row.member, row.as_of, row.history), row.expected, row.case);
    });
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
    const [mu] = curveAt(44, refs.ggt.ref["2"], (r) => [r.mu])!;
    const data = {
      profile,
      labs: [{ date, marker: "ggt", value: Math.exp(mu), unit: model.fields.ggt.unit }],
    };
    expect(score(data, date)!.rows.ggt.years).toBeCloseTo(0, 12);
    expect(score(data, date)!.value).toBe(score({ profile }, date)!.value);
  });
});
