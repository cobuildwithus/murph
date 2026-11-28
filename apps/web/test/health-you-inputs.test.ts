import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeVault, saveMemberCheckIn } from "@murphai/core";
import { buildMetricProjection, readVault } from "@murphai/query";
import { describe, expect, it } from "vitest";
import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  type BrowserVaultReplica,
  type BrowserVaultMetricRow,
} from "@murphai/query/browser";
import { projectYouInputs } from "../src/lib/health-you/inputs";
import { buildViews, favorableRank } from "../src/lib/health-you/views";
import { score } from "../src/lib/health-you/engine";
import { combineAgeEffect } from "../src/lib/health-you/checkins";
import { nextQuestion } from "../src/lib/health-you/questions";
import { youLabel } from "../src/lib/health-you/labels";
import { model, offset, YEAR } from "../src/lib/health-you/engine/model";

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
      .map((row) => ({
        ...row,
        id: "pulse-" + row.id,
        metricKey: "resting-heart-rate",
        value: 62,
        unit: "bpm",
      })),
  );
  return r;
}
function read(r: BrowserVaultReplica) {
  return projectYouInputs(
    createBrowserVaultQueryClient(structuredClone(r)),
    clock,
    new Date("2030-01-01T00:00:00Z"),
  );
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
  it("carries portion nutrients and timestamps into a private fibre-density row", () => {
    const r = replica();
    const meals = r.meals!;
    for (let i = 0; i < 3; i++) {
      const date = offset(today, -i);
      const calories = 400, fiberGrams = i === 0 ? 0 : 6;
      const totals = { calories, proteinGrams: null, carbsGrams: null, fatGrams: null };
      meals.days.push({
        ...totals, date, mealCount: 1, calorieMealCount: 1,
        meals: [{ ...totals, id: "meal_sample" + i, name: null, eatenAt: date + "T15:00:00Z", fiberGrams, uploadId: null }],
      });
    }
    const input = read(r);
    expect(input.evidence.meals?.[0]).toMatchObject({ date: today, timestamp: today + "T15:00:00Z", fiber_g: 0 });
    const view = buildViews(input).you;
    expect(view.factors.find(f => f.key === "mealFibreDensity")).toMatchObject({
      group: "food", label: "Fibre in logged meals", value: "15", unit: "g per 1,000 logged calories", target: null, rank: null,
    });
    expect(view.factors.map(f => f.key)).not.toContain("mealFibre");
    delete meals.days[0].meals[0].fiberGrams;
    expect(score(read(r).evidence, today)?.rows.meal_density).toBeUndefined();
  });
  it("qualifies sleep timing by the selected provider and preserves offsets across a clock change", () => {
    const r = replica();
    const date = "2031-11-02";
    r.sleepTiming = [
      { date, timeZone: "America/New_York", startAt: "2031-11-02T03:23:47Z", endAt: "2031-11-02T12:03:18Z" },
    ];
    const windows = () => read(r).evidence.sleep_sessions?.filter((night) => night.start_at);
    expect(windows()).toEqual([]);
    r.sleepTimingProviders = { [date]: "oura" };
    expect(windows()).toEqual([
      expect.objectContaining({ source: "oura", start_offset_min: -240, end_offset_min: -300 }),
    ]);
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
    expect(result.markers["red-cell-distribution-width"]).toMatchObject({
      value: 13,
      unit: "%",
      label: "Red cell size range",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic");
    const prior = r.labResultRows[0];
    prior.date = offset(today, -4);
    prior.normalizedValue = 17;
    const project = () =>
      buildViews(projectYouInputs(createBrowserVaultQueryClient(structuredClone(r)), clock, clock));
    const baseline = project();
    expect(baseline.you.state).toBe("ready");
    expect(baseline.markers[prior.metricKey!]).toMatchObject({ value: 17 });
    expect(baseline.blood.all.total).toBe(1);
    expect(baseline.age?.history.map((p) => p.date)).toEqual([today]);
    const repeat = {
      ...prior,
      id: "repeat",
      drawId: "new-draw",
      date: today,
      parentResultStatus: "pending" as const,
    };
    r.labResultRows.push(repeat);
    expect(project()).toEqual(baseline);
    const projectedValue = () => score(read(r).evidence, today)!.rows.rdw.value;
    expect(projectedValue()).toBe(17);
    // A finalized but impossible repeat cannot displace the earlier usable draw.
    r.labResultRows[1] = { ...repeat, parentResultStatus: "abnormal", normalizedValue: -8 };
    expect(projectedValue()).toBe(17);
    expect(project().markers[prior.metricKey!].value).toBe(17);
    // Each replica is the current publication of this draw, including corrections.
    r.labResultRows[1] = { ...repeat, parentResultStatus: "normal", normalizedValue: 12 };
    expect(projectedValue()).toBe(12);
    expect(project().markers[prior.metricKey!].history).toHaveLength(2);
    r.labResultRows[1] = { ...repeat, parentResultStatus: "pending", normalizedValue: 15 };
    expect(projectedValue()).toBe(17);
    r.labResultRows[1] = {
      ...repeat,
      parentResultStatus: "abnormal",
      normalizedValue: 15,
      reportedAt: offset(today, 1) + "T16:00:00Z",
    };
    expect(projectedValue()).toBe(17);
    r.labResultRows[1].reportedAt = today + "T18:00:00Z";
    expect(projectedValue()).toBe(15);
    expect(project().markers[prior.metricKey!].value).toBe(15);
    // Tied copies can agree on the measurement but disagree on its display flag.
    const final = r.labResultRows[1];
    r.labResultRows.push({ ...final, id: "synthetic-tied-result", flag: "low" });
    expect(projectedValue()).toBe(15);
    expect(project().markers[prior.metricKey!]).toBeUndefined();
  });
  it("derives insulin resistance only from explicitly fasting results with the same draw", () => {
    const r = replica();
    const base = {
      rowSchema: "murph.browser-vault.lab-result-row.v1" as const,
      date: today,
      observedAt: today + "T12:00:00Z",
      biomarkerKey: null,
      analyte: "Synthetic marker",
      sourceLabel: null,
      labName: null,
      textValue: null,
      comparator: null,
      drawId: "same",
      fastingStatus: "fasting" as const,
      parentResultStatus: "normal" as const,
      specimenKind: null,
      referenceRange: null,
      flag: null,
    };
    r.labResultRows = [
      {
        ...base,
        id: "test-glucose",
        metricKey: "glucose",
        value: 100,
        unit: "mg/dL",
        normalizedValue: 100,
        normalizedUnit: "mg/dL",
      },
      {
        ...base,
        id: "test-insulin",
        metricKey: "insulin",
        value: 12,
        unit: "mIU/L",
        normalizedValue: 12,
        normalizedUnit: "mIU/L",
      },
    ];
    const factors = () => score(read(r).evidence, today)?.rows;
    expect(factors()?.homa_ir?.value).toBeCloseTo(1200 / 405);
    r.labResultRows[1].drawId = "different";
    expect(factors()?.homa_ir).toBeUndefined();
    r.labResultRows[1].drawId = "same";
    r.labResultRows[0].fastingStatus = "unknown";
    expect(factors()?.homa_ir).toBeUndefined();
  });
  it.each(["short_sleep", "tentative"])("counts only completed nights when a third is %s", (flag) => {
    const r = addPulse(replica());
    r.metricRows = r.metricRows.filter(
      (row) => row.metricKey !== "total-sleep-minutes" || row.date >= offset(today, -2),
    );
    const third = r.metricRows.find((row) => row.date === today && row.metricKey === "total-sleep-minutes")!;
    third.context = flag === "tentative" ? { sleepState: flag } : { sleepType: flag };
    expect(read(r).evidence.sleep_sessions).toHaveLength(2);
    expect(buildViews(read(r)).you.factors.map((f) => f.key)).not.toContain("sleepTime");
    third.context = { sleepType: "main_sleep" };
    expect(buildViews(read(r)).you.factors.map((f) => f.key)).toContain("sleepTime");
  });
  it("keeps the headline through four missing wear days and replays a late reading on its release day", () => {
    const r = addPulse(replica());
    for (const row of r.metricRows) row.value = row.metricKey === "total-sleep-minutes" ? 318 : 83;
    const before = buildViews(read(r)).you.age!;
    const last = offset(today, -4);
    const late = r.metricRows.find(
      (row) => row.date === offset(today, -2) && row.metricKey === "resting-heart-rate",
    )!;
    r.metricRows = r.metricRows.filter((row) => row.date <= last);
    const gap = read(r);
    expect(gap.evidence.daily?.every((row) => String(row.date) <= last)).toBe(true);
    expect(gap.evidence.sleep_sessions?.every((row) => String(row.date) <= last)).toBe(true);
    const after = buildViews(gap).you.age!;
    expect(after.value).toBe(before.value);
    expect(after.high - after.low).toBeGreaterThan(before.high - before.low);
    r.metricRows.push({ ...late, value: 57, context: { recordedAt: clock.toISOString() } });
    const filled = read(r);
    expect(filled.evidence.daily).toContainEqual(
      expect.objectContaining({ date: late.date, reported_at: today, rhr: 57 }),
    );
    const yesterday = offset(today, -1);
    expect(score(filled.evidence, yesterday)).toEqual(score(gap.evidence, yesterday));
    expect(score(filled.evidence, today)?.rows.pulse.wear_age_days).toBe(2);
    expect(buildViews(filled).week?.saved).toBe(0);
  });
  it("keeps late pulse backfill out of the saved-days comparison", () => {
    const r = addPulse(replica());
    const base = r.metricRows.find((row) => row.metricKey === "resting-heart-rate")!;
    const pulse = Array.from({ length: 60 }, (_, i) => ({
      ...base,
      date: offset(today, -i),
      id: "pulse-day-" + i,
      value: i < 7 ? 52 : 73,
    }));
    r.metricRows = [...r.metricRows.filter((row) => row.metricKey !== base.metricKey), ...pulse];
    expect(buildViews(read(r)).week!.saved).toBeGreaterThan(0);
    for (const row of pulse.slice(0, 7)) row.context = { recordedAt: clock.toISOString() };
    const projected = read(r);
    expect(projected.evidence.daily?.find((row) => row.date === offset(today, -3))?.reported_at).toBe(today);
    expect(buildViews(projected).week!.saved).toBe(0);
  });
  it("uses only complete workout windows across weekly publications", () => {
    const snapshots = [0, 7].map((delta) => {
      const date = offset(today, delta);
      const at = new Date(date + "T16:00:00Z");
      const r = replica();
      r.generatedAt = at.toISOString();
      const persistent = offset(today, -130);
      r.labResultRows = [
        {
          rowSchema: "murph.browser-vault.lab-result-row.v1",
          id: "prior-draw",
          date: persistent,
          observedAt: persistent + "T12:00:00Z",
          metricKey: "red-cell-distribution-width",
          biomarkerKey: null,
          analyte: "RDW",
          sourceLabel: null,
          labName: null,
          textValue: null,
          comparator: null,
          drawId: "prior",
          fastingStatus: "unknown",
          parentResultStatus: "unknown",
          specimenKind: null,
          referenceRange: null,
          flag: "normal",
          unit: "%",
          value: 14,
          normalizedValue: 14,
          normalizedUnit: "percent",
        },
      ];
      r.metricRows = [];
      r.activitySessions = Array.from({ length: 63 }, (_, i) => ({
        type: "run",
        minutes: 24,
        date: offset(date, -i),
      }));
      const result = buildViews(
        projectYouInputs(createBrowserVaultQueryClient(r), at, new Date("2030-01-01")),
      );
      expect(result.age?.history[0].date).toBe(offset(date, -35));
      expect(result.you.factors.some((f) => f.key === "aerobic")).toBe(true);
      return result.age!.history;
    });
    for (const point of snapshots[1].filter((p) => p.date <= today)) {
      expect(snapshots[0].find((p) => p.date === point.date)).toEqual(point);
    }
  });
  it.each([
    [39, null],
    [40, null],
    [59, null],
    [60, "Top 40%"],
  ] as const)("bands favorable percentiles at %i", (percentile, label) => {
    expect(favorableRank("grip", percentile)?.label ?? null).toBe(label);
    expect(favorableRank("ldl_c", 100 - percentile)?.label ?? null).toBe(label);
    expect(favorableRank("sleep", percentile)).toBeNull();
  });
  it("distinguishes a failed read, stale measurements and a readable empty panel", () => {
    const r = replica();
    expect(() => read({ ...r, demographics: undefined })).toThrow();
    const missing = read({ ...r, metricRows: [] });
    expect(buildViews(missing).you).toMatchObject({ state: "building" });
    expect(buildViews(missing).you.age).toBeUndefined();
    const old = read({ ...r, metricRows: r.metricRows.map(row => ({ ...row, date: offset(row.date, -18) })) });
    expect(old.availability.sleep).toBe("stale");
    expect(buildViews(old).you).toMatchObject({ state: "building", building: { have: 0 } });
    const partial = read({ ...r, metricRows: r.metricRows.slice(0, 2) });
    expect(buildViews(partial).you.building).toEqual({ have: 2, need: 3, text: "Wear your band for 1 more night." });
  });
  it("withholds a precise headline for unsupported profiles", () => {
    const input = read(replica());
    for (const [profile, text] of [
      [{ age: 18, sex: "male" }, "Murph works out ages 20 to 80"],
      [{ age: 50, sex: "unknown" }, "Add your sex in About you to see your age"],
      [{ age: 50, sex: "female", pregnant: true }, "Paused while you're pregnant"],
      [{ age: 50, sex: "female", delivery_date: offset(today, -11) }, "Paused for now after having a baby"],
    ] as const) {
      const view = buildViews({ ...input, evidence: { ...input.evidence, profile } }).you;
      expect(view).toMatchObject({ state: "paused", paused: { text } });
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
    const r = addPulse(replica());
    Object.assign(r, { generation: 21, sleepTiming: [] });
    const put = (key: string, value: string | number, date: string, hour: number) => {
      r.entities.push({
        id: "fixture-" + r.entities.length,
        family: "assessment",
        kind: "assessment",
        recordClass: "ledger",
        date,
        occurredAt: date + "T" + hour + ":00:00Z",
        links: [],
        tags: [],
        lookupIds: [],
        status: null,
        bodyPreview: null,
        experimentSlug: null,
        stream: null,
        title: null,
        attributes: {
          checkIn: {
            date,
            response: { instrumentVersion: 1, instrument: "you-answer", answer: { key, value } },
          },
        },
      });
    };
    r.demographics = { ...r.demographics!, biologicalSex: "female" };
    expect(buildViews(read(r)).you).toMatchObject({ state: "ready", questions: [{ key: "ageEligibility" }] });
    for (const status of ["pregnant", "postpartum"]) {
      put("ageEligibility", status, offset(today, -2), 12);
      expect(buildViews(read(structuredClone(r))).you).toMatchObject({ state: "paused" });
      put("ageEligibility", "neither", offset(today, -1), 13);
      expect(buildViews(read(r)).you.state).toBe("ready");
      r.entities = [];
    }
    r.demographics = { ...r.demographics!, biologicalSex: "male" };
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
      diabetes: { value: 1 },
      disease: { value: 0 },
      health: { value: 2 },
      alcohol: { value: 7 },
    });
    expect(score(input.evidence, today)?.rows.diabetes).toBeUndefined();
    expect(nextQuestion(input, {})).toEqual([]);
    const corrected = structuredClone(r);
    const source = corrected.entities.find((e) => e.attributes.checkIn && e.id === "fixture-0")!;
    for (const [status, date] of [
      ["current", yesterday],
      ["former", today],
    ]) {
      corrected.entities.push({
        ...source,
        id: "smoking-" + status,
        date,
        occurredAt: date + "T16:00:00Z",
        attributes: {
          checkIn: {
            date,
            response: {
              instrumentVersion: 1,
              instrument: "you-answer",
              answer: { key: "smoking", value: status },
            },
          },
        },
      });
    }
    expect(score(read(corrected).evidence, today)?.rows.smoking).not.toHaveProperty("quit");
  });
  it("scores a submitted floor rise against the current panel and reproduces it after publication", () => {
    const person = addPulse(replica());
    person.demographics = { ...person.demographics!, birthYear: 1967 };
    const input = read(person);
    const session = {
      instrument: "combine",
      instrumentVersion: 1,
      date: today,
      tests: [{ key: "sitting_rising", value: 4 }],
    } as const;
    const submitted = { ...session, tests: [...session.tests] };
    const years = combineAgeEffect(input, "session", submitted);
    expect(years).toEqual(expect.any(Number));
    expect(years).not.toBe(0);
    input.evidence.fitness_tests = [
      {
        session_id: "session",
        date: today,
        test: "sit_and_rise",
        verified: "self",
        unit: "points",
        value: 4,
        protocol: "murph-combine-v1",
      },
    ];
    expect(combineAgeEffect(input, "session", submitted)).toBe(years);
    expect(
      combineAgeEffect(input, "session", { ...submitted, tests: [{ key: "pullups_max", value: 6 }] }),
    ).toBeUndefined();
  });
  it.each(["home", "clinic"] as const)("scores a canonical %s series after publication", async (setting) => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "synthetic-pressure-"));
    try {
      await initializeVault({ vaultRoot, timezone: "America/New_York", createdAt: clock.toISOString() });
      const times = setting === "home" ? ["07:00", "07:03", "19:00", "19:03"] : ["09:10", "09:12"];
      const days = setting === "home" ? 3 : 2;
      for (let i = 0; i < days; i++)
        for (const time of times) {
          const takenAt = new Date(offset(today, -i) + "T" + time + ":00-05:00").toISOString();
          expect(
            await saveMemberCheckIn(
              vaultRoot,
              {
                kind: "measurement.blood-pressure",
                version: 1,
                setting,
                systolic: 128,
                diastolic: 78,
                takenAt,
              },
              { actionId: randomUUID(), requestedAt: takenAt },
            ),
          ).toBe("applied");
        }
      const vault = await readVault(vaultRoot);
      const publication = await createBrowserVaultReplica({
        vault,
        generatedAt: clock.toISOString(),
        sourceBundleHash: "b".repeat(64),
        demographics: replica().demographics,
        metricPoints: buildMetricProjection(vault).metricPoints,
      });
      const input = read(publication);
      expect(input.evidence.bp).toHaveLength(days * times.length);
      expect(score(input.evidence, today)?.rows.sbp).toMatchObject({
        value: 128,
        quality: setting === "home" ? 0.75 : 1,
      });
      expect(buildViews(input).you.factors.map((f) => f.key)).toContain("bloodPressure");
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
  it("retains an unverified pressure pair without marking an age event or counting a factor", () => {
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
    expect(bundle.age?.events).toEqual([]);
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
    expect(buildViews(input).you.factors.some((f) => f.key === "bedtime")).toBe(false);
    Object.assign(r, { sleepTimingProviders: Object.fromEntries(timing.map((t) => [t.date, "garmin"])) });
    expect(buildViews(read(r)).you.factors).toContainEqual(
      expect.objectContaining({ key: "bedtime", label: "Bedtime regularity" }),
    );
  });
});

describe("private age views", () => {
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
    expect(views.you.notCounted.map(tile => tile.action)).toEqual(["bloodWork", "connectWearable", "foodWeek", "addBloodPressure"]);
    expect(views.you.notCounted.filter(tile => tile.primary)).toEqual([views.you.notCounted[0]]);
  });
  it("keeps a connected device out of the action list even with just one context-only sample", () => {
    const r = replica();
    r.metricRows = [{ ...r.metricRows[0], metricKey: "hrv-rmssd", value: 38, unit: "ms" }];
    const view = buildViews(read(r)).you;
    expect(view.factors).toEqual([]);
    expect(view.notCounted.map(tile => tile.action)).not.toContain("connectWearable");
  });
  it("features only the five largest contributions and retains the full blood panel in detail", () => {
    const input = read(replica());
    const panel = { albumin: 4.5, rdw: 13, wbc: 6, ggt: 20, alp: 80, sodium: 140, potassium: 4 };
    input.evidence.labs = Object.entries(panel).map(([marker, value]) => ({
      date: today, marker, value, unit: model.labs[marker as keyof typeof panel][1],
    }));
    const { you, blood } = buildViews(input);
    expect(blood.factors).toHaveLength(Object.keys(panel).length);
    expect(you.factors.map(f => Math.abs(f.years))).toEqual(you.factors.map(f => Math.abs(f.years)).sort((a, b) => b - a));
    expect(you.factors.filter(f => f.featured)).toEqual(you.factors.slice(0, 5));
    expect(blood.factors).toEqual(you.factors.filter(f => f.group === "blood"));
  });
  it("has a display label for every frozen factor and marker", () => {
    const keys = new Set([...Object.keys(model.display), ...Object.keys(model.coef), ...model.optional,
      ...Object.keys(model.labs), ...model.feeds.known_markers, ...Object.keys(model.bridges.markers)]);
    for (const key of keys) expect(youLabel(key), key).toMatch(/^[A-Z][^_]+$/);
    expect(["alp", "ast", "rdw", "egfr", "hs-crp", "hba1c"].map(youLabel)).toEqual([
      "Alkaline phosphatase", "Liver enzyme AST", "Red cell size range", "Kidney filtration", "Inflammation", "Blood sugar (A1c)",
    ]);
  });
  it("withholds a single wearable comparison and a birth-year eligibility boundary", () => {
    const sparse = buildViews(read(replica()));
    expect(sparse.you).toMatchObject({
      state: "building",
      building: { have: 1, need: 2, text: expect.stringContaining("one more type") },
    });
    const boundary = addPulse(replica());
    boundary.demographics = { ...boundary.demographics!, birthYear: 2012 };
    const views = buildViews(read(boundary));
    expect(views.you).toMatchObject({
      state: "building",
      building: { text: expect.stringContaining("date of birth") },
    });
    expect(views.you.age).toBeUndefined();
  });
  it("gives a small sustained sleep change a small weekly effect", () => {
    const r = replica();
    for (const row of r.metricRows) row.value = row.date > offset(today, -7) ? 400 : 390;
    const input = read(r);
    expect(score(input.evidence, today)?.changes.sleep).toBeCloseTo(-0.000134, 8);
    expect(buildViews(input).you.week).toMatchObject({ daysAged: 6.95, basis: "observed" });
  });
  it.each([-1, 1])("omits tiny observed weekly movements in direction %i", direction => {
    const r = replica();
    r.metricRows = r.metricRows.map(row => ({ ...row,
      value: 390 + (row.date > offset(today, -7) ? direction * (model.daily.deadband.sleep * 60 + 0.1) : 0),
    }));
    const input = read(r);
    const movement = Math.abs(score(input.evidence, today)!.changes.sleep * YEAR);
    expect(movement).toBeGreaterThan(0);
    expect(movement).toBeLessThan(0.05);
    expect(buildViews(input).week).toMatchObject({ helped: [], cost: [] });
  });
  it("hides a marker's zero-year contribution and omits interpretation-only advice", () => {
    const input = read(addPulse(replica()));
    input.evidence.labs = [{ date: today, marker: "b12", value: 480, unit: "pg/mL" }];
    input.markers = [{ date: today, key: "b12", modelKey: "b12", label: "Vitamin B12",
      value: 480, unit: "pg/mL", flag: null, system: "Other markers" }];
    const views = buildViews(input);
    expect(views.you.factors.find(f => f.key === "b12")?.years).toBe(0);
    expect(views.markers.b12.years).toBeNull();
    expect(views.markers.b12.whatLowersIt).toBeUndefined();
  });
  it("marks each kind once a week and only the first qualifying blood pressure series", () => {
    const input = read(addPulse(replica()));
    const dates = [-7, -6, -5, 0].map(d => offset(today, d));
    input.evidence.bp = dates.flatMap(date => ["09:00", "09:02"].map(time => ({
      date, measured_at: date + "T" + time, setting: "clinic", systolic: 123, diastolic: 76,
    })));
    input.evidence.labs = dates.map(date => ({ date, marker: "rdw", unit: "%", value: 13 }));
    input.evidence.checkins = dates.map(date => ({ date, diet_day_complete: true }));
    const view = buildViews(input);
    expect(view.age?.events).toEqual([
      { date: dates[0], kind: "bloodWork", label: "Blood work" },
      { date: dates[1], kind: "bloodPressure", label: "Blood pressure" },
      { date: today, kind: "bloodWork", label: "Blood work" },
    ]);
    expect(view.age?.history.at(-1)?.age).toBe(view.you.age?.value);
  });
  it("uses the member's measured activity, cardio fitness and sleep numbers", () => {
    const input = read(addPulse(replica()));
    input.evidence.vo2 = [{ date: today, value: 44, method: "lab_cpet" }];
    input.activeMinutes = [];
    let view = buildViews(input);
    expect(view.fitness.hero).toMatchObject({ value: "44", unit: "VO2 max" });
    expect(view.sleep.hero.value).toBe("7h 45m");
    expect(view.sleep.tiles).toContainEqual({ label: "Resting heart rate", value: "62 bpm" });
    input.activeMinutes = [{ date: today, value: 37 }, { date: offset(today, -8), value: 80 }];
    view = buildViews(input);
    expect(view.fitness.hero).toMatchObject({ value: "37", unit: "active min in 7 days" });
    expect(view.fitness.tiles).toContainEqual({ label: "Cardio fitness", value: "44 VO2 max" });
    expect(buildViews(read({ ...replica(), metricRows: [] })).fitness.tiles).toEqual([]);
  });
  it("keeps relay-only steps, manual fitness estimates and switched acquisition methods out of wearable credit", () => {
    const r = replica();
    r.metricRows = r.metricRows.flatMap((row, i) => [
      { ...row, context: { measurementMethodKey: i % 2 ? "method-a" : "method-b" } },
      {
        ...row,
        id: "relay-" + i,
        sourceLabel: "Apple Health",
        metricKey: "steps",
        unit: "count",
        value: 12000,
      },
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
    expect(result.you.factors.map((f) => f.key)).toEqual(expect.arrayContaining(["foodPattern", "sitRise"]));
    expect(result.you.factors.map((f) => f.key)).not.toContain("grip");
    expect(result.you.factors.map((f) => f.key)).not.toContain("balance");
    expect(result.age?.events).toEqual([
      { date: today, kind: "combine", label: "Fitness Combine" },
      { date: today, kind: "foodWeek", label: "Food week" },
    ]);
    expect(JSON.stringify(result)).not.toContain("research_risk");
  });
});
