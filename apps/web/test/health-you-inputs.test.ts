import { describe, expect, it } from "vitest";
import {
  createBrowserVaultQueryClient,
  type BrowserVaultReplica,
  type BrowserVaultMetricRow,
} from "@murphai/query/browser";
import { projectYouInputs } from "../src/lib/health-you/inputs";
import { buildViews } from "../src/lib/health-you/views";
import { offset } from "../src/lib/health-you/engine/model";

const today = "2032-03-01",
  clock = new Date("2032-03-02T03:15:00Z");
function replica(): BrowserVaultReplica {
  const metricRows: BrowserVaultMetricRow[] = Array.from({ length: 15 }, (_, i) => {
    const date = offset(today, -i);
    return {
      metricKey: "total-sleep-minutes",
      value: 465,
      unit: "minutes",
      date,
      sourceLabel: "Garmin",
      grain: "day",
      id: "night-" + i,
      statistic: "value",
      confidence: "high",
      context: { sleepType: "main_sleep" },
      biomarkerKey: null,
      observedAt: date + "T08:00:00Z",
      pointIds: [],
      recordIds: [],
      rowSchema: "murph.browser-vault.metric-row.v1",
      sourceFamily: "derived",
      sourceKind: null,
      valueLabel: null,
    };
  });
  return {
    schema: "murph.browser-vault-replica",
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: clock.toISOString(),
    metricRows,
    metricGoalProgressRows: [],
    metricSelectionRows: [],
    labResultRows: [],
    policy: {
      id: "health-vault-browser",
      bodyPreviewChars: 0,
      excludedFamilies: [],
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    demographics: {
      birthYear: 1982,
      birthYearPrecision: "approximate",
      biologicalSex: "male",
      status: "resolved",
      revision: "d".repeat(64),
    },
    meals: { schemaVersion: 1, timeZone: "America/New_York", days: [] },
    source: { sourceBundleHash: "a".repeat(64), dataVersion: "synthetic" },
    searchRows: [],
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}
function read(r: BrowserVaultReplica) {
  return projectYouInputs(createBrowserVaultQueryClient(r), clock, new Date("2030-01-01T00:00:00Z"));
}
describe("dated private replica projections", () => {
  it("uses the vault date, year precision, qualified sleep and the evidence horizon", () => {
    const input = read(replica()),
      views = buildViews(input);
    expect(input.asOf).toBe(today);
    expect(input.evidence.profile).not.toHaveProperty("birth_date");
    expect(input.availability).toMatchObject({ sleep: "counted", bedtime: "unavailable", pulse: "absent" });
    expect(views.you.state).toBe("ready");
    expect(views.you.age?.real).toBe(50);
    expect(views.age?.history.every((p) => p.date >= offset(today, -14) && p.date <= today)).toBe(true);
    expect(views.week?.days).toHaveLength(7);
    expect(views.you.factors.map((f) => f.key)).toEqual(["sleepTime"]);
  });
  it("converts a normalized lab unit to the research scale and publishes only derived marker fields", () => {
    const r = replica();
    r.metricRows = [];
    r.labResultRows = [
      {
        id: "synthetic-result",
        rowSchema: "murph.browser-vault.lab-result-row.v1",
        date: today,
        observedAt: today + "T11:00:00Z",
        metricKey: "red-cell-distribution-width",
        biomarkerKey: null,
        analyte: "synthetic analyte text",
        sourceLabel: null,
        labName: "synthetic private source",
        textValue: "synthetic record content",
        comparator: null,
        drawId: null,
        fastingStatus: "unknown",
        parentResultStatus: "unknown",
        specimenKind: null,
        referenceRange: null,
        flag: "normal",
        unit: "%",
        value: 13,
        normalizedValue: 13,
        normalizedUnit: "percent",
      },
    ];
    const result = buildViews(read(r));
    expect(result.you.factors).toContainEqual(expect.objectContaining({ key: "rdw", unit: "%" }));
    expect(result.markers["red-cell-distribution-width"]).toMatchObject({ value: 13, unit: "%" });
    expect(JSON.stringify(result)).not.toContain("synthetic");
  });
  it("distinguishes a failed read, stale measurements and a readable empty panel", () => {
    const r = replica();
    expect(() => read({ ...r, demographics: undefined })).toThrow();
    const missing = read({ ...r, metricRows: [] });
    expect(buildViews(missing).you).toMatchObject({ state: "building" });
    expect(buildViews(missing).you.age).toBeUndefined();
    const old = read({ ...r, metricRows: r.metricRows.slice(5) });
    expect(old.availability.sleep).toBe("stale");
    expect(buildViews(old).you).toMatchObject({ state: "building", building: { have: 0 } });
    const partial = read({ ...r, metricRows: r.metricRows.slice(0, 4) });
    expect(buildViews(partial).you.building?.have).toBe(4);
  });
  it("withholds a precise headline for unsupported profiles", () => {
    const input = read(replica());
    for (const profile of [
      { birth_year: 2020, sex: "male" },
      { age: 50, sex: "unknown" },
      { age: 50, sex: "female", pregnant: true },
    ]) {
      const view = buildViews({ ...input, evidence: { ...input.evidence, profile } }).you;
      expect(view.state).toBe("paused");
      expect(view.age).toBeUndefined();
    }
  });
});
