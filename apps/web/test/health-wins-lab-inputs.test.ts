import type { BrowserVaultLabResultRow } from "@murphai/query/browser";
import { expect, it } from "vitest";
import { generateHealthWins } from "../src/lib/health-wins/engine";
import { readHealthWinLabs } from "../src/lib/health-wins/lab-inputs";

const today = "2035-06-20";
const member = { today, age: null, sex: null, wearableProvider: null };
function row(date: string, value: number, updates: Partial<BrowserVaultLabResultRow> = {}): BrowserVaultLabResultRow {
  return { analyte: "Triglycerides", biomarkerKey: "biomarker:triglycerides", comparator: null, date,
    drawId: `draw-${date}`, fastingStatus: "fasting", flag: null, id: `result-${date}`, labName: null,
    metricKey: "triglycerides", normalizedUnit: "mg/dL", normalizedValue: value, observedAt: `${date}T09:00:00Z`,
    parentResultStatus: "normal", referenceRange: null, rowSchema: "murph.browser-vault.lab-result-row.v1",
    sourceLabel: null, specimenKind: "serum", textValue: null, unit: "mg/dL", value, ...updates };
}

const first = row("2034-10-13", 128);
const second = row("2035-02-25", 134);
const latest = row("2035-06-09", 95);
it.each<Partial<BrowserVaultLabResultRow>>([
  { parentResultStatus: "abnormal" }, { parentResultStatus: "mixed" }, { parentResultStatus: "unknown" },
  { parentResultStatus: "pending" }, { drawId: null }, { flag: "critical" }, { flag: "low" },
  { flag: "high" }, { comparator: "<" }, { normalizedValue: null }, { referenceRange: { high: 80 } },
  { referenceRange: { text: "<80" } }, { normalizedUnit: "unknown" },
])("withholds the analyte when the latest row is ineligible (%j)", updates => {
  expect(readHealthWinLabs([latest, first, second, row("2035-06-15", 91, updates)], today)).toEqual([]);
});

it("coalesces repeat imports of a draw and omits ambiguous draws", () => {
  const repeat = { ...first, id: "second-copy" };
  const rows = [first, second, latest, repeat];
  const labs = readHealthWinLabs(rows, today);
  expect(labs.map(draw => draw.value)).toEqual([128, 134, 95]);
  expect(generateHealthWins({ member, labs })).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "lab_change", chart: expect.objectContaining({ baseline: { value: 131, draws: 2 } }) }),
  ]));
  const conflicting = { ...first, normalizedValue: 30 };
  expect(readHealthWinLabs([...rows, conflicting], today).map(draw => draw.value)).toEqual([134, 95]);
  expect(readHealthWinLabs([...rows, { ...first, date: latest.date }], today)).toEqual([]);
  expect(readHealthWinLabs([...rows, { ...latest, drawId: "another-draw" }], today)).toEqual([]);
});

it("uses only independently verified fasting evidence for a fasting change", () => {
  const unknown = { ...first, fastingStatus: "unknown" as const };
  const original = [unknown, second, latest];
  expect(readHealthWinLabs(original, today).map(draw => draw.value)).toEqual([134, 95]);
  for (const fastingStatus of ["unknown", "non_fasting"] as const) {
    const labs = readHealthWinLabs([first, second, { ...latest, fastingStatus }], today);
    expect(labs).toHaveLength(1);
    expect(generateHealthWins({ member, labs }).some(card => card.kind === "lab_change")).toBe(false);
  }
  expect(readHealthWinLabs([{ ...first, flag: "high" }, second, latest], today)
    .map(draw => draw.value)).toEqual([134, 95]);
});

it("keeps bounds and values in the same unit, including percent and insulin units", () => {
  const glucose = row(latest.date, 5, { metricKey: "glucose", biomarkerKey: "biomarker:blood-glucose",
    unit: "mmol/L", normalizedValue: 5 * 18.0182, referenceRange: { low: 3.5, high: 6.2 } });
  expect(readHealthWinLabs([glucose], today)).toMatchObject([{ analyte: "glucose", unit: "mg/dL",
    referenceRange: { low: 63.0637, high: 111.7128 } }]);
  expect(readHealthWinLabs([row(latest.date, 5.1, { metricKey: "hba1c", unit: "%", normalizedUnit: "percent",
    referenceRange: { low: 4.8, high: 6.0 } })], today)).toMatchObject([{ analyte: "a1c", unit: "%" }]);
  expect(readHealthWinLabs([row(latest.date, 7.6, { metricKey: "insulin", unit: "uIU/mL", normalizedUnit: "mIU/L" })],
    today)).toMatchObject([{ analyte: "insulin", unit: "µIU/mL" }]);
});

it("compares like methods and specimens, omitting unsupported or future results", () => {
  const earlier = { ...first, metricKey: "ldl-calculated" };
  const later = { ...latest, metricKey: "ldl-c" };
  const rows = [earlier, later, { ...second, specimenKind: "plasma" as const, metricKey: "ldl-c" },
    { ...latest, metricKey: "cotinine" }, { ...later, date: "2035-12-23", flag: "critical" }];
  expect(readHealthWinLabs(rows, today)).toMatchObject([{ analyte: "ldl", value: latest.value }]);
});
