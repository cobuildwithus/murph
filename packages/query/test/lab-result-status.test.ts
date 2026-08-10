import { describe, expect, it } from "vitest";

import {
  deriveBrowserVaultLabResultStatus,
} from "../src/browser-replica/lab-result-status.ts";
import type {
  BrowserVaultPresentedLabResultRow,
} from "../src/browser-replica/lab-results.ts";

describe("lab-result display status derivation", () => {
  it("keeps an explicit reporting-lab flag authoritative", () => {
    const result = deriveBrowserVaultLabResultStatus(row({
      flag: "high",
      normalizedReferenceRange: { high: 5, low: 3.5 },
      normalizedValue: 4.2,
    }));
    expect(result.flag).toBe("high");
  });

  it.each([
    { expected: "low", value: 3.4 },
    { expected: "normal", value: 4.2 },
    { expected: "high", value: 5.1 },
  ])("derives $expected from a numeric reporting-lab interval", ({ expected, value }) => {
    const result = deriveBrowserVaultLabResultStatus(row({
      normalizedReferenceRange: { high: 5, low: 3.5 },
      normalizedValue: value,
      value,
    }));
    expect(result.flag).toBe(expected);
  });

  it("preserves strict one-sided source bounds", () => {
    expect(deriveBrowserVaultLabResultStatus(row({
      normalizedReferenceRange: { high: 5, highComparator: "<" },
      normalizedValue: 5,
      value: 5,
    })).flag).toBe("high");
    expect(deriveBrowserVaultLabResultStatus(row({
      normalizedReferenceRange: { low: 3.5, lowComparator: ">" },
      normalizedValue: 3.5,
      value: 3.5,
    })).flag).toBe("low");
  });

  it("classifies censored source values only when every possible value has one status", () => {
    expect(deriveBrowserVaultLabResultStatus(row({
      comparator: "<",
      normalizedReferenceRange: { high: 5, low: 3.5 },
      normalizedValue: 3.5,
      value: 3.5,
    })).flag).toBe("low");
    expect(deriveBrowserVaultLabResultStatus(row({
      comparator: "<=",
      normalizedReferenceRange: { high: 5, low: 3.5 },
      normalizedValue: 3.5,
      value: 3.5,
    })).flag).toBeNull();
    expect(deriveBrowserVaultLabResultStatus(row({
      comparator: ">",
      normalizedReferenceRange: { high: 5, low: 3.5 },
      normalizedValue: 5,
      value: 5,
    })).flag).toBe("high");
    expect(deriveBrowserVaultLabResultStatus(row({
      comparator: ">=",
      normalizedReferenceRange: { high: 5, low: 3.5 },
      normalizedValue: 5,
      value: 5,
    })).flag).toBeNull();
    expect(deriveBrowserVaultLabResultStatus(row({
      comparator: "<",
      normalizedReferenceRange: { high: 5, low: 3.5 },
      normalizedValue: 4,
      value: 4,
    })).flag).toBeNull();
  });

  it("lets a source range override a broader published comparator", () => {
    const result = deriveBrowserVaultLabResultStatus(row({
      normalizedReferenceRange: { high: 4, low: 3.5 },
      normalizedValue: 4.2,
    }));
    expect(result.flag).toBe("high");
  });

  it("blocks a generic comparator when the source supplied qualified range wording", () => {
    const result = deriveBrowserVaultLabResultStatus(row({
      normalizedReferenceRange: null,
      referenceRange: { text: "3.5-5.0 for this laboratory method" },
    }));
    expect(result.flag).toBeNull();
  });

  it.each([
    { expected: "low", value: 3.4 },
    { expected: "normal", value: 4.2 },
    { expected: "high", value: 5.1 },
  ])("derives $expected from an exact published reference interval", ({ expected, value }) => {
    const result = deriveBrowserVaultLabResultStatus(row({
      normalizedValue: value,
      value,
    }));
    expect(result.flag).toBe(expected);
  });

  it("fails closed when unit or specimen does not match", () => {
    expect(deriveBrowserVaultLabResultStatus(row({
      normalizedUnit: "g/L",
    })).flag).toBeNull();
    expect(deriveBrowserVaultLabResultStatus(row({
      specimenKind: "plasma",
    })).flag).toBeNull();
  });

  it("keeps risk comparators neutral while deriving kidney reference context", () => {
    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "ApoB",
      biomarkerKey: "biomarker:apob",
      metricKey: "apob",
      normalizedUnit: "mg/dL",
      normalizedValue: 95,
      unit: "mg/dL",
      value: 95,
    })).flag).toBeNull();

    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "eGFR",
      biomarkerKey: "biomarker:egfr",
      metricKey: "egfr",
      normalizedUnit: "mL/min/1.73m^2",
      normalizedValue: 79,
      unit: "mL/min/1.73m^2",
      value: 79,
    })).flag).toBe("normal");
    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "eGFR",
      biomarkerKey: "biomarker:egfr",
      metricKey: "egfr",
      normalizedUnit: "mL/min/1.73m^2",
      normalizedValue: 50,
      unit: "mL/min/1.73m^2",
      value: 50,
    })).flag).toBe("low");
    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "eGFR",
      biomarkerKey: "biomarker:egfr",
      comparator: ">=",
      metricKey: "egfr",
      normalizedUnit: "mL/min/1.73m^2",
      normalizedValue: 60,
      unit: "mL/min/1.73m^2",
      value: 60,
    })).flag).toBe("normal");
  });

  it("keeps decision boundaries neutral and derives page-authored range status", () => {
    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "Ferritin",
      biomarkerKey: "biomarker:ferritin",
      metricKey: "ferritin",
      normalizedUnit: "ng/mL",
      normalizedValue: 10,
      unit: "ng/mL",
      value: 10,
    })).flag).toBeNull();

    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      metricKey: "chloride",
      normalizedUnit: "mmol/L",
      normalizedValue: 101,
      unit: "mmol/L",
      value: 101,
    })).flag).toBe("normal");
  });

  it("adds newly reviewed thyroid intervals", () => {
    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "Free T4",
      biomarkerKey: "biomarker:free-t4",
      metricKey: "free-t4",
      normalizedUnit: "ng/dL",
      normalizedValue: 1.2,
      unit: "ng/dL",
      value: 1.2,
    })).flag).toBe("normal");
    expect(deriveBrowserVaultLabResultStatus(row({
      analyte: "Free T4",
      biomarkerKey: "biomarker:free-t4",
      metricKey: "free-t4",
      normalizedUnit: "ng/dL",
      normalizedValue: 2,
      unit: "ng/dL",
      value: 2,
    })).flag).toBe("high");
  });

  it("derives status from sex-neutral adult whole-blood CBC ranges", () => {
    const base = {
      analyte: "White blood cells",
      biomarkerKey: "biomarker:white-blood-cell-count",
      metricKey: "white-blood-cell-count",
      normalizedUnit: "10^3/uL",
      specimenKind: "whole_blood",
      unit: "10^3/uL",
    } satisfies Partial<BrowserVaultPresentedLabResultRow>;

    expect(deriveBrowserVaultLabResultStatus(row({
      ...base,
      normalizedValue: 3,
      value: 3,
    })).flag).toBe("low");
    expect(deriveBrowserVaultLabResultStatus(row({
      ...base,
      normalizedValue: 3.9,
      value: 3.9,
    })).flag).toBe("normal");
    expect(deriveBrowserVaultLabResultStatus(row({
      ...base,
      normalizedValue: 10,
      value: 10,
    })).flag).toBe("high");
  });
});

function row(
  overrides: Partial<BrowserVaultPresentedLabResultRow> = {},
): BrowserVaultPresentedLabResultRow {
  const value = overrides.value ?? 4.2;
  return {
    analyte: "Albumin",
    biomarkerKey: "biomarker:albumin",
    comparator: null,
    date: "2026-06-14",
    flag: null,
    id: "albumin-2026",
    labName: "Example Lab",
    metricKey: "albumin",
    normalizedReferenceRange: null,
    normalizedUnit: "g/dL",
    normalizedValue: value,
    observedAt: "2026-06-14T08:00:00.000Z",
    referenceRange: null,
    rowSchema: "murph.browser-vault.lab-result-row.v1",
    sourceLabel: "Lab result",
    specimenKind: "serum",
    textValue: null,
    unit: "g/dL",
    value,
    ...overrides,
  };
}
