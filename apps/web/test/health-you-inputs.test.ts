import { describe, expect, it } from "vitest";
import {
  createBrowserVaultQueryClient,
  type BrowserVaultReplica,
  type BrowserVaultMetricRow,
} from "@murphai/query/browser";
import { projectYouInputs } from "../src/lib/health-you/inputs";
import { buildViews } from "../src/lib/health-you/views";
import { score } from "../src/lib/health-you/engine";
import { combineAgeEffect } from "../src/lib/health-you/checkins";
import { nextQuestion } from "../src/lib/health-you/questions";
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
function addPulse(r: BrowserVaultReplica) {
  r.metricRows.push(
    ...r.metricRows
      .filter((row) => row.metricKey === "total-sleep-minutes")
      .map((row) => ({ ...row, id: "pulse-" + row.id, metricKey: "resting-heart-rate", value: 62, unit: "bpm" })),
  );
  return r;
}
function read(r: BrowserVaultReplica) {
  return projectYouInputs(createBrowserVaultQueryClient(r), clock, new Date("2030-01-01T00:00:00Z"));
}
describe("dated private replica projections", () => {
  it("uses the vault date, year precision, qualified sleep and the evidence horizon", () => {
    const input = read(addPulse(replica())),
      views = buildViews(input);
    expect(input.asOf).toBe(today);
    expect(input.evidence.profile).toMatchObject({
      birth_year: 1982,
      approximate_birth_date: true,
      birth_date: "1982-07-01",
    });
    expect(input.availability).toMatchObject({ sleep: "counted", bedtime: "unavailable", pulse: "counted" });
    expect(views.you.state).toBe("ready");
    expect(views.you.age?.real).toBe(49.7);
    expect(views.age?.history.every((p) => p.date >= offset(today, -14) && p.date <= today)).toBe(true);
    expect(views.week?.days).toHaveLength(7);
    expect(views.you.factors.map((f) => f.key).sort()).toEqual(["restingHeartRate", "sleepTime"]);
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
    expect(input.evidence.checkins?.[0]).toMatchObject({ whoop_standard_zones: "notSure" });
    expect(buildViews(input).you.questions).toEqual([]);
  });
  it("replays corrections at their reporting day and remembers even an old or unsure answer", () => {
    const r = replica();
    Object.assign(r, { generation: 21, sleepTiming: [] });
    const put = (key: string, value: string | number, date: string, hour: number) => {
      r.entities.push({ id: "fixture-" + r.entities.length, family: "assessment", kind: "assessment",
        recordClass: "ledger", date, occurredAt: date + "T" + hour + ":00:00Z", links: [], tags: [],
        lookupIds: [], status: null, bodyPreview: null, experimentSlug: null, stream: null, title: null,
        attributes: { checkIn: { date, response: { instrumentVersion: 1, instrument: "you-answer", answer: { key, value } } } } });
    };
    const yesterday = offset(today, -1);
    expect(buildViews(read(structuredClone(r))).you.questions[0]?.key).toBe("smoking");
    put("smoking", "former", offset(today, -400), 12);
    expect(buildViews(read(structuredClone(r))).you.questions[0]?.key).toBe("quitDate");
    put("quitDate", "2020-01-01", yesterday, 12);
    put("diabetes", "yes", yesterday, 12);
    put("seriousDisease", "no", yesterday, 12);
    put("selfRatedHealth", "veryGood", yesterday, 12);
    put("alcoholDrinksPerWeek", 3.5, yesterday, 12);
    put("diabetes", "no", today, 13);
    put("diabetes", "unsure", today, 14);
    const input = read(r);
    expect(score(input.evidence, yesterday)?.rows).toMatchObject({
      diabetes: { value: 1 }, disease: { value: 0 }, health: { value: 2 }, alcohol: { value: 7 },
    });
    expect(score(input.evidence, today)?.rows.diabetes).toBeUndefined();
    expect(nextQuestion(input, {})).toEqual([]);
    const corrected = structuredClone(r);
    const source = corrected.entities.find(e => e.attributes.checkIn && e.id === "fixture-0")!;
    for (const [status, date] of [["current", yesterday], ["former", today]]) {
      corrected.entities.push({ ...source, id: "smoking-" + status, date, occurredAt: date + "T16:00:00Z",
        attributes: { checkIn: { date, response: { instrumentVersion: 1, instrument: "you-answer",
          answer: { key: "smoking", value: status } } } } });
    }
    expect(score(read(corrected).evidence, today)?.rows.smoking).not.toHaveProperty("quit");
  });
  it("scores a submitted floor rise against the current panel and reproduces it after publication", () => {
    const person = addPulse(replica());
    person.demographics = { ...person.demographics!, birthYear: 1967 };
    const input = read(person);
    const session = { instrument: "combine", instrumentVersion: 1, date: today,
      tests: [{ key: "sitting_rising", value: 4 }] } as const;
    const submitted = { ...session, tests: [...session.tests] };
    const years = combineAgeEffect(input, "session", submitted);
    expect(years).toEqual(expect.any(Number));
    expect(years).not.toBe(0);
    input.evidence.fitness_tests = [{ session_id: "session", date: today, test: "sit_and_rise",
      verified: "self", unit: "points", value: 4, protocol: "murph-combine-v1" }];
    expect(combineAgeEffect(input, "session", submitted)).toBe(years);
    expect(combineAgeEffect(input, "session", { ...submitted, tests: [{ key: "pullups_max", value: 6 }] })).toBeUndefined();
  });
  it("keeps an unverified canonical pressure pair in history without a pressure coefficient", () => {
    const r = addPulse(replica());
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
    expect(input.evidence.bp).toMatchObject([{ systolic: 124, diastolic: 76, validated: undefined }]);
    const bundle = buildViews(input);
    expect(bundle.age?.events).toContainEqual({ date: today, kind: "bloodPressure", label: "Blood pressure" });
    expect(bundle.you.factors.some((f) => f.key === "bloodPressure")).toBe(false);
    const split = r.metricRows.map((row) =>
      row.id === lower.id ? { ...row, recordIds: ["other-synthetic-event"] } : row,
    );
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

describe("round 3 private views", () => {
  it("marks a reference week partial even with daily phone samples", () => {
    const r = replica();
    r.metricRows = r.metricRows.map((row) => ({
      ...row,
      metricKey: "steps",
      value: 9300,
      unit: "count",
      sourceLabel: "iPhone",
    }));
    const views = buildViews(read(r));
    expect(views.you).toMatchObject({
      state: "building",
      week: { daysAged: 7, partial: true, basis: "referenceOnly" },
    });
    expect(views.week).toMatchObject({ daysAged: 7, helped: [], cost: [] });
    expect(views.you.notCounted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "sleepTime", action: "connectWearable" }),
        expect.objectContaining({ key: "grip", action: "combine" }),
        expect.objectContaining({ key: "bloodPressure", action: "addBloodPressure" }),
        expect.objectContaining({ key: "albumin", action: "bloodWork" }),
        expect.objectContaining({ key: "fruit", action: "foodWeek" }),
        expect.objectContaining({ key: "smoking", action: "answer" }),
      ]),
    );
  });
  it("withholds a single wearable comparison and a birth-year eligibility boundary", () => {
    const sparse = buildViews(read(replica()));
    expect(sparse.you).toMatchObject({
      state: "building",
      building: { text: expect.stringContaining("independent") },
    });
    const boundary = addPulse(replica());
    boundary.demographics = { ...boundary.demographics!, birthYear: 2012 };
    const views = buildViews(read(boundary));
    expect(views.you).toMatchObject({
      state: "building",
      building: { text: expect.stringContaining("birth year") },
    });
    expect(views.you.age).toBeUndefined();
  });
  it("keeps relay-only steps, manual fitness estimates and switched acquisition methods out of wearable credit", () => {
    const r = replica();
    r.metricRows = r.metricRows.flatMap((row, i) => [
      { ...row, context: { measurementMethodKey: i % 2 ? "method-a" : "method-b" } },
      { ...row, id: "relay-" + i, sourceLabel: "Apple Health", metricKey: "steps", unit: "count", value: 12000 },
      {
        ...row,
        id: "manual-" + i,
        sourceLabel: "Garmin",
        metricKey: "estimated-vo2-max",
        unit: "mL/kg/min",
        value: 41,
        context: { measurementMethodKey: "manual" },
      },
    ]);
    expect(buildViews(read(r)).you.factors).toEqual([]);
  });
  it("scores canonical food portions and matched Combine stations after submission", () => {
    const r = addPulse(replica());
    r.demographics = { ...r.demographics!, birthYear: 1971 };
    function assessment(response: Record<string, unknown>, id: string) {
      r.entities.push({
        id,
        family: "assessment",
        kind: "assessment",
        recordClass: "ledger",
        date: today,
        occurredAt: today + "T15:00:00Z",
        attributes: { checkIn: { date: today, response: { ...response, instrumentVersion: 1 } } },
        tags: [],
        lookupIds: [],
        links: [],
        title: null,
        bodyPreview: null,
        stream: null,
        status: null,
        experimentSlug: null,
      });
    }
    assessment(
      {
        instrument: "food-week",
        answers: Object.entries({
          vegetables: 12,
          fruit: 8,
          whole_grains: 6,
          plants: 4,
          red_meat: 3,
          processed_meat: 1,
          sweet_drinks: 2,
          sweets: 3,
          eating_days: 7,
          seafood: 2,
        }).map(([key, value]) => ({ key, value })),
      },
      "food-fixture",
    );
    assessment(
      {
        instrument: "combine",
        date: today,
        tests: [
          { key: "sitting_rising", value: 8 },
          { key: "grip_strength", value: 39 },
          { key: "single_leg_10s", skipped: true },
        ],
      },
      "station-fixture",
    );
    const result = buildViews(read(r));
    expect(result.you.factors.map((f) => f.key)).toEqual(
      expect.arrayContaining(["fruit", "fish", "vegetables", "sitRise"]),
    );
    expect(result.you.factors.map((f) => f.key)).not.toContain("grip");
    expect(result.you.factors.map((f) => f.key)).not.toContain("balance");
    expect(result.age?.events).toContainEqual(
      expect.objectContaining({ kind: "evidenceChange", date: today, evidenceChangeYears: expect.any(Number) }),
    );
    expect(JSON.stringify(result)).not.toContain("research_risk");
  });
});
