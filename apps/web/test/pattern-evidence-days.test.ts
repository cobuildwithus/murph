import { expect, test } from "vitest";
import type { PersonalPatternCell } from "@murphai/query/browser-overview";
import { patternEvidenceDays } from "@/src/components/overview/pattern-evidence-days";

const cell: PersonalPatternCell = {
  factorId: "running", outcomeId: "hrv", stage: "seen_again", direction: "higher",
  exposedMean: 48, comparisonMean: 44, delta: 4, deltaPercent: 9,
  exposedDays: 2, comparisonDays: 1, repeatedDirection: true,
  firstExposedDate: "2024-02-29", lastExposedDate: "2024-03-01",
  exposedDates: ["2024-02-29", "2024-03-01"], comparisonDates: ["2024-02-28"],
};

test("preserves saved group membership across leap day and Monday week boundaries", () => {
  const evidence = patternEvidenceDays({ asOfDate: "2024-03-02", windowDays: 4 }, cell);
  expect(evidence?.days.map(day => day.date)).toEqual([
    "2024-02-26", "2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-02", "2024-03-03",
  ]);
  expect(evidence?.days.filter(day => day.exposed).map(day => day.date)).toEqual(cell.exposedDates);
  expect(evidence?.days.filter(day => day.comparison).map(day => day.date)).toEqual(cell.comparisonDates);
  expect(evidence?.days.filter(day => day.inWindow)).toHaveLength(4);
  expect(evidence?.hasMissingDates).toBe(false);
});

test("does not invent missing dates or normalize invalid dates into valid observations", () => {
  const report = { asOfDate: "2024-03-02", windowDays: 4 };
  const incomplete = { ...cell, exposedDates: ["2024-02-29", "2024-02-29", "2024-02-30", "2024-03-03", "2024-02-01"], comparisonDates: [] };
  const evidence = patternEvidenceDays(report, incomplete);
  expect(evidence?.days.filter(day => day.exposed).map(day => day.date)).toEqual(["2024-02-29"]);
  expect(evidence?.hasMissingDates).toBe(true);
  expect(patternEvidenceDays(report, { ...cell, exposedDates: undefined, comparisonDates: undefined })).toBeNull();
  expect(patternEvidenceDays({ ...report, asOfDate: "2024-02-30" }, cell)).toBeNull();
  for (const windowDays of [0, 367, 1.5, Infinity, NaN]) expect(patternEvidenceDays({ ...report, windowDays }, cell)).toBeNull();
  expect(patternEvidenceDays({ ...report, windowDays: 366 }, cell)?.days.length).toBeLessThanOrEqual(378);
});
