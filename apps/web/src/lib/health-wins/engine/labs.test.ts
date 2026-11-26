import { describe, expect, it, vi } from "vitest";
import { labCandidates } from "./labs";
import type { Analyte, HealthWinRank, HealthWinsInput, LabDraw } from "./types";

const member: HealthWinsInput["member"] = { today: "2031-07-22", age: 44, sex: "female", wearableProvider: "garmin" };
function draw(value: number, day: number, overrides: Partial<LabDraw> = {}): LabDraw {
  return { analyte: "ldl", unit: "mg/dL", value, date: `2031-07-${String(day).padStart(2, "0")}`, ...overrides };
}
function cards(labs: LabDraw[], rank: HealthWinRank = () => null) {
  return labCandidates({ member, labs }, rank).map(result => result.card);
}

describe("lab draws", () => {
  it.each([["2031-07-03", "Jul 3"], ["2030-07-03", "Jul 3, 2030"]])(
    "30. uses the member's current year to label the draw on %s", (date, label) => {
      const only = draw(78, 3, { date, referenceRange: { high: 110 } });
      const rank: HealthWinRank = () => ({ betterShare: 80, lowerIsBetter: true, group: "Women 40 to 49",
        source: "Synthetic reference", cuts: [{ percentile: 50, value: 100 }] });
      const change = cards([draw(112, 1, { date: "2029-02-08" }), draw(108, 2, { date: "2029-04-11" }), only]);
      expect(change).toMatchObject([{ kind: "lab_change", source_note: `Latest draw on ${label}. Lab draws in mg/dL.`,
        chart: { latest: { date } } }]);
      expect(cards([only])).toMatchObject([{ kind: "lab_range", source_note: `Reporting laboratory reference range. Draw on ${label}.`,
        chart: { date } }]);
      expect(cards([only], rank)).toMatchObject([{ kind: "percentile", source_note: `Lab draw on ${label}. Synthetic reference` }]);
    },
  );

  it.each<[Analyte, string, number, number]>([
    ["triglycerides", "mg/dL", 112, 97], ["hdl", "mg/dL", 62, 67], ["ldl", "mg/dL", 108, 98],
    ["hs_crp", "mg/L", 1.2, 0.9], ["a1c", "%", 5.8, 5.6], ["insulin", "µIU/mL", 12, 10],
    ["glucose", "mg/dL", 98, 93],
  ])("13. %s needs a favorable change of at least its own step", (analyte, unit, base, latest) => {
    const options = { analyte, unit, fasting: true };
    const history = [draw(base - 0.1, 1, options), draw(base + 0.1, 2, options)];
    const result = cards([...history, draw(latest, 3, options)]);
    expect(result).toMatchObject([{ kind: "lab_change", chart: { baseline: { value: base, draws: 2 }, latest: { value: latest } } }]);
    for (const other of [base + (latest - base) * 0.99, base - (latest - base)]) {
      expect(cards([...history, draw(other, 3, options)])).toEqual([]);
    }
  });

  it("13. audit 10 compares all eligible fasting draws to their median", () => {
    const options = { analyte: "triglycerides" as const, fasting: true };
    const labs = [draw(208, 1, options), draw(98, 2, options), draw(102, 3, options), draw(95, 8, options)];
    expect(cards(labs)).toEqual([]);
    const rise = draw(181, 5, { ...options, fasting: false });
    const unknown = draw(199, 4, { ...options, fasting: undefined });
    expect(cards([unknown, rise, ...labs])).toEqual([]);
    const latest = draw(80, 10, options);
    expect(cards([...labs, unknown, rise, latest])).toMatchObject([{ chart: { baseline: { value: 100, draws: 4 } } }]);
    expect(cards([...labs, { ...latest, fasting: false }])).toEqual([]);
    expect(cards([...labs, { ...latest, fasting: undefined }])).toEqual([]);
    expect(cards([draw(185, 1, { analyte: "triglycerides" }), draw(165, 3, { analyte: "triglycerides" }),
      draw(134, 8, { analyte: "triglycerides" })])).toMatchObject([{ kind: "lab_change" }]);
  });

  it("13. reference draws must be independent, like-for-like and in the step's units", () => {
    const first = draw(150, 1);
    const latest = draw(88, 12);
    expect(cards([first, first, draw(150, 2, { analyte: "hdl" }), draw(2.6, 3, { unit: "mmol/L" }), latest])).toEqual([]);
    expect(cards([first, draw(130, 2), latest, draw(104, 12)])).toEqual([]);
    for (const unit of ["mmol/L", "Mg/dL"]) {
      expect(cards([first, draw(130, 2), latest].map(row => ({ ...row, unit })))).toEqual([]);
    }
    expect(cards([draw(14, 1, { unit: "μIU/mL", analyte: "insulin" }), draw(18, 2, { unit: "uIU/mL", analyte: "insulin" }),
      draw(10, 3, { unit: "µIU/mL", analyte: "insulin" })])).toMatchObject([{ kind: "lab_change" }]);
    expect(cards([first, draw(130, 2), latest, draw(175, 30)])).toMatchObject([{ chart: { latest: { value: 88 } } }]);
    expect(cards([first, draw(130, 2), latest].map(row => ({ ...row, analyte: "total_chol" })))).toEqual([]);
  });

  it.each(["high", "low"] as const)("13. flagged %s latest blocks every card and older substitute", flag => {
    const rank = vi.fn<HealthWinRank>(() => null);
    const labs = [draw(114, 1), draw(108, 2), draw(84, 3), draw(31, 9, { flag, referenceRange: { high: 100 } })];
    expect(cards(labs, rank)).toEqual([]);
    expect(cards(labs.reverse(), rank)).toEqual([]);
    expect(rank).not.toHaveBeenCalled();
  });

  it("13. audit 12 gives a single in-range draw a range with its reported bounds", () => {
    const only = draw(7.8, 9, { analyte: "insulin", unit: "µIU/mL", referenceRange: { low: 3.1, high: 15.2 } });
    expect(cards([only])).toMatchObject([{ kind: "lab_range", chart: { type: "gauge", value: 7.8,
      range: { low: { value: 3.1 }, high: { value: 15.2 } } } }]);
    expect(cards([{ ...only, value: 15.2 }])).toHaveLength(1);
    expect(cards([{ ...only, value: 18 }])).toEqual([]);
    expect(cards([{ ...only, referenceRange: undefined, flag: "normal" }])).toEqual([]);
  });

  it("13. retains a measured zero within the reporting lab's interval", () => {
    const only = draw(0, 7, { analyte: "hs_crp", unit: "mg/L", referenceRange: { low: 0, high: 1.7 } });
    expect(cards([only])).toMatchObject([{ kind: "lab_range", chart: { value: 0 } }]);
    expect(cards([{ ...only, flag: "low" }])).toEqual([]);
  });

  it("keeps precise measurements and range boundaries in the chart", () => {
    const only = draw(0.026, 7, { analyte: "hs_crp", unit: "mg/L", referenceRange: { high: 2.35 } });
    expect(cards([only])).toMatchObject([{ kind: "lab_range", title: { number: "<0.1 mg/L" },
      subtitle: "within the reference range", chart: { value: 0.026, range: { high: { value: 2.35 } } } }]);
  });

  it("13. a reviewed serum comparator needs its exact unit, applicability and strict bound", () => {
    const only = draw(94, 9, { specimen: "serum" });
    expect(cards([only])).toMatchObject([{ kind: "lab_range", chart: { range: { high: { value: 100, inclusive: false } } } }]);
    expect(cards([{ ...only, value: 100 }])).toEqual([]);
    expect(cards([{ ...only, unit: "mmol/L" }])).toEqual([]);
    expect(cards([{ ...only, specimen: undefined }])).toEqual([]);
    expect(labCandidates({ labs: [only], member: { ...member, age: 15 } }, () => null)).toEqual([]);
    expect(cards([{ ...only, referenceRange: { low: 110 } }])).toEqual([]);
  });

  it("12. audit 9 uses the injected lab rank when eligible and falls back to the reporting range", () => {
    const only = draw(6.8, 11, { analyte: "insulin", unit: "µIU/mL", fasting: true, referenceRange: { low: 2, high: 14 } });
    const result = { betterShare: 74, lowerIsBetter: true, group: "Women 40 to 49",
      source: "Synthetic fasting cohort", cuts: [{ percentile: 25, value: 6.5 }, { percentile: 50, value: 9 }] };
    const rank = vi.fn<HealthWinRank>(() => result);
    expect(cards([only], rank)).toMatchObject([{ kind: "percentile", title: { number: "Top 26%" },
      chart: { cuts: result.cuts, group: result.group, unit: only.unit, lowerIsBetter: true },
      source_note: expect.stringContaining(result.source) }]);
    expect(rank).toHaveBeenCalledExactlyOnceWith("fastingInsulin", only.value, { member, unit: only.unit, fasting: true });
    for (const fallback of [null, { ...result, source: "" }, { ...result, betterShare: 69.99 }]) {
      expect(cards([only], () => fallback)).toMatchObject([{ kind: "lab_range" }]);
    }
    rank.mockClear();
    expect(cards([{ ...only, analyte: "glucose" }], rank)).toMatchObject([{ kind: "lab_range" }]);
    expect(rank).not.toHaveBeenCalled();
  });
});
