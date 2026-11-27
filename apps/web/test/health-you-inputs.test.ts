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

describe("canonical check-in and sleep timing projections", () => {
  it("reads the versioned response inside a checked assessment and suppresses an answered WHOOP prompt", () => {
    const r = replica();
    r.metricRows = r.metricRows.map((row) => ({ ...row, sourceLabel: "WHOOP" }));
    Object.assign(r, { sleepTiming: [] });
    expect(buildViews(read(structuredClone(r))).you.questions.map((q) => q.key)).toEqual(["whoopZones"]);
    r.entities.push({
      id: "synthetic-assessment",
      family: "assessment",
      kind: "assessment",
      recordClass: "ledger",
      date: offset(today, 1),
      occurredAt: offset(today, 1) + "T02:00:00Z",
      attributes: {
        checkIn: {
          date: today,
          response: {
            instrument: "you-answer",
            instrumentVersion: 1,
            answer: { key: "whoopZones", value: "notSure" },
          },
        },
      },
      tags: [],
      lookupIds: [],
      links: [],
      title: null,
      bodyPreview: null,
      stream: null,
      status: null,
      experimentSlug: null,
    });
    const input = read(r);
    expect(input.evidence.checkins?.[0]).toMatchObject({ whoop_zones: "notSure" });
    expect(buildViews(input).you.questions).toEqual([]);
  });
  it("keeps an unverified canonical pressure pair in history without a pressure coefficient", () => {
    const r = replica();
    const upper = {
      ...r.metricRows[0]!,
      id: "synthetic-upper",
      metricKey: "systolic-blood-pressure",
      value: 124,
      unit: "mmHg",
      sourceKind: "measurement" as const,
      recordIds: ["synthetic-event"],
    };
    const lower = { ...upper, id: "synthetic-lower", metricKey: "diastolic-blood-pressure", value: 76 };
    r.metricRows.push(upper, lower);
    const input = read(r);
    expect(input.evidence.bp).toMatchObject([{ systolic: 124, diastolic: 76, validated: false }]);
    const bundle = buildViews(input);
    expect(bundle.age?.events).toContainEqual({ date: today, kind: "bloodPressure", label: "Blood pressure" });
    expect(bundle.you.factors.some((f) => f.key === "bloodPressure")).toBe(false);
    const split = r.metricRows.map(row => row.id === lower.id ? { ...row, recordIds: ["other-synthetic-event"] } : row);
    expect(read({ ...r, metricRows: split }).evidence.bp).toEqual([]);
  });
  it("uses observed nights on both sides of midnight for the weekly bedtime target", () => {
    const r = replica();
    const timing = Array.from({ length: 14 }, (_, i) => {
      const date = offset(today, -i);
      return {
        date,
        timeZone: "America/New_York",
        startAt: date + (i % 2 ? "T04:50:00Z" : "T05:15:00Z"),
        endAt: date + "T12:15:00Z",
      };
    });
    Object.assign(r, { sleepTiming: timing });
    const input = read(r);
    expect(input.bedtime).toEqual([{ date: today, inTarget: true }]);
    expect(buildViews(input).you.thisWeek).toContainEqual(
      expect.objectContaining({ factor: "bedtime", value: 1 }),
    );
    expect(input.availability.sleep_regularity).not.toBe("counted");
  });
});
