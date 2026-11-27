import { describe, expect, it } from "vitest";
import golden from "../../../../test/fixtures/health-you/reference.json";
import { score, type MemberEvidence } from "./index";
import { curveAt, model, refs } from "./model";

const sources: Record<string, Omit<MemberEvidence, "profile">> = golden.inputs;
describe("R2 Python parity", () => {
  for (const test of golden.cases)
    it([test.kind, test.profile.sex, test.profile.age, test.date].join(" "), () => {
      const data = { ...sources[test.kind], profile: test.profile };
      const actual = score(data, test.date)!;
      expect(actual.value).toBeCloseTo(test.age, 1);
      expect(actual.parts).toEqual(test.tenths);
      expect(actual.real).toBe(test.real);
      if (test.days === null) expect(actual.days).toBeNull();
      else expect(actual.days).toBeCloseTo(test.days, 1);
      expect(Object.fromEntries(Object.entries(actual.rows).map(([k, r]) => [k, r.percentile]))).toEqual(
        test.ranks,
      );
      const targets: Record<string, number | string | null | undefined> = test.targets;
      expect(Object.keys(actual.rows).sort()).toEqual(Object.keys(targets).sort());
      for (const [k, r] of Object.entries(actual.rows)) {
        expect(r.target).toBe(targets[k]);
        expect(Number.isFinite(r.years)).toBe(true);
      }
      expect(Object.values(actual.parts).reduce((s, n) => s + n, 0)).toBe(Math.round(actual.gap * 10));
      expect(score(data, test.date)).toEqual(actual);
    });
  it("centers an absent lab at its age and sex expectation", () => {
    const date = "2024-02-11",
      profile = { age: 44, sex: "female" };
    const [mu] = curveAt(44, refs.ggt.ref["2"], (r) => [r.mu])!;
    const data = { profile, labs: [{ date, marker: "ggt", value: Math.exp(mu), unit: model.fields.ggt.unit }] };
    expect(score(data, date)!.rows.ggt.years).toBeCloseTo(0, 12);
    expect(score(data, date)!.value).toBe(score({ profile }, date)!.value);
  });
});
