import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  getHostedVaultShareActivityMinutesProjectionSpec,
  getHostedVaultShareActivityDistanceProjectionSpec,
  getHostedVaultShareActivitySessionCountProjectionSpec,
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS,
  parseHostedVaultShareDeliverRequest,
  resolveHostedVaultShareDataSource,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import {
  selectProjectableSleepNights,
  selectProjectableDailyMetricDays,
  selectProjectableMealNutritionDays,
  selectProjectableWorkoutDays,
  selectProjectableWorkoutsDays,
  selectProjectableActivityMinutesDays,
  selectProjectableActivityDistanceDays,
  selectProjectableActivitySessionCountDays,
  selectProjectableHeartRateZoneDays,
} from "../src/hosted-runtime/vault-share-projection.ts";

const NOW = Date.parse("2026-09-17T23:00:00.000Z");
const date = (age: number) => new Date(NOW - age * 86_400_000).toISOString().slice(0, 10);
const dates = Array.from({ length: 92 }, (_, index) => date(index - 1)); // future and day 91 included
const sources = ["whoop", "oura", "garmin", "fitbit", "apple-health", "polar", "suunto", "manual"]
  .map((source) => { const resolved = resolveHostedVaultShareDataSource(source); if (!resolved) throw new Error("Expected a public source."); return resolved; });
const rows = dates.flatMap((day) => sources.map((source) => ({
  date: day, source, sourceFamily: "derived" as const, sourceKind: "activity-summary", grain: "day" as const,
  statistic: "value" as const, recordIds: [`event-${day}-${source.source}`], pointIds: [`point-${day}-${source.source}`],
  observedAt: `${day}T10:00:00.000Z`, context: { zoneLabel: "Zone 2" }, unit: "minutes", value: 30,
})));
const sessions = rows.map((row) => ({ ...row, sourceKind: "activity_session", activityKind: "running",
  distanceMeters: 5000, durationMinutes: 30, startedAt: `${row.date}T10:00:00.000Z`, endedAt: null,
  isWorkout: true, timeZone: "UTC",
}));
function admit(scope: HostedVaultShareProjectionScope, records: unknown[]) {
  return parseHostedVaultShareDeliverRequest({ projectionScope: scope, records,
    memberTimeZone: "UTC", expectedGenerationToken: "a".repeat(43), sourceWorkspaceVersion: "7" }).records;
}

describe("all plain-grant history producer families", () => {
  it("retains 90 dates for each of eight public sleep sources, excluding future/outside dates", () => {
    const records = sources.flatMap((source) => selectProjectableSleepNights(dates.map((day) => ({
      date: day, sleepStartAt: `${day}T00:00:00.000Z`, sleepEndAt: `${day}T08:00:00.000Z`,
    })), date(0), source));
    assert.equal(admit({ projectionKind: "sleep-times.v0" }, records).length, 720);
    for (const source of sources) assert.equal(records.filter((record) => record.source?.source === source.source).length, 90);
  });

  it("retains every metric-series scope including sleep duration and both stage representations", () => {
    for (const spec of HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS.filter((spec) => spec.source.kind === "metric-series")) {
      const points = rows.map((row) => ({ ...row, metricKey: spec.metricKey, unit: "expectedUnit" in spec ? spec.expectedUnit : "count",
        value: Math.max(spec.minValue, Math.min(spec.maxValue, 30)) }));
      const records = selectProjectableDailyMetricDays(points, spec, NOW, date(0));
      assert.equal(admit({ projectionKind: spec.projectionKind }, records).length, 720, spec.projectionKind);
      assert.ok(records.some((record) => record.recordKey.startsWith(date(89))));
    }
  });

  it("retains 90 complete meal totals for every macro without changing missing-nutrient semantics", () => {
    for (const spec of HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS) {
      if (spec.source.kind !== "meal-nutrition-total") continue;
      const nutrient = { mealCount: 1, total: 10 };
      const totals = { calories: nutrient, proteinGrams: nutrient, carbsGrams: nutrient,
        fatGrams: nutrient, fiberGrams: nutrient };
      const days = dates.map((day) => ({ date: day, mealCount: 1, totals }));
      const records = selectProjectableMealNutritionDays(days, spec, date(0));
      assert.equal(admit({ projectionKind: spec.projectionKind }, records).length, 90);
      assert.ok(records.some((record) => record.recordKey.startsWith(date(89))));
      assert.ok(records.every((record) => record.source?.source === "murph"));
    }
  });

  it("retains source-complete workout counts/minutes and heart-rate zones", () => {
    const workouts = selectProjectableWorkoutDays({ currentDate: date(0),
      countRows: rows.map((row) => ({ ...row, metricKey: "workout-count", value: 1 })),
      minuteRows: rows.map((row) => ({ ...row, metricKey: "workout-minutes" })),
    });
    assert.equal(admit({ projectionKind: "workout-days.v0" }, workouts).length, 720);
    const zones = selectProjectableHeartRateZoneDays(rows.map((row) => ({ ...row, metricKey: "heart-rate-zone-2-minutes" })), date(0));
    assert.equal(admit({ projectionKind: "heart-rate-zones-days.v0" }, zones).length, 720);
  });

  it("retains selected activity minutes, distance and session-count scopes", () => {
    const minutes = { projectionKind: "activity-minutes-days.v1", selector: { activityKind: "running" } } as const;
    const distance = { projectionKind: "activity-distance-days.v1", selector: { activityKind: "running" } } as const;
    const counts = { projectionKind: "activity-session-count-days.v1", selector: { activityKind: "running" } } as const;
    const minutesSpec = getHostedVaultShareActivityMinutesProjectionSpec(minutes);
    const distanceSpec = getHostedVaultShareActivityDistanceProjectionSpec(distance);
    const countSpec = getHostedVaultShareActivitySessionCountProjectionSpec(counts);
    if (!minutesSpec || !distanceSpec || !countSpec) throw new Error("Expected activity scopes.");
    const common = { currentDate: date(0), rows: sessions };
    assert.equal(admit(minutes, selectProjectableActivityMinutesDays({ ...common, spec: minutesSpec })).length, 720);
    assert.equal(admit(distance, selectProjectableActivityDistanceDays({ ...common, spec: distanceSpec })).length, 720);
    assert.equal(admit(counts, selectProjectableActivitySessionCountDays({ ...common, spec: countSpec })).length, 720);
  });

  it("keeps complete workout days, member-local window and monotonic completion watermark separate", () => {
    const records = selectProjectableWorkoutsDays({ nowMs: NOW, rows: sessions, vaultTimeZone: "UTC" });
    assert.equal(admit({ projectionKind: "workouts.v0" }, records).length, 90);
    assert.ok(records.every((record) => "workouts" in record.data && record.data.workouts.length === 8));
    const future = selectProjectableWorkoutsDays({ nowMs: NOW, rows: sessions,
      vaultTimeZone: "Pacific/Kiritimati" });
    assert.equal(future[0]?.recordKey, date(-1));
    assert.ok(future.every((record) => "workouts" in record.data && record.data.calendarClosedThroughDate === date(1)));
  });
});
