import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import { composePublicWearableSummaryBundleFromStoredRows } from "../src/projection/wearable-summary-compose.ts";
import { buildWearableSummaryProjection } from "../src/projection/wearable-summary-projector.ts";
import { summarizeWearableLatest } from "../src/wearables.ts";

const DAY = "2026-04-16";

function makeEntity(
  overrides: Partial<CanonicalEntity> & Pick<CanonicalEntity, "entityId" | "family" | "kind" | "recordClass">,
): CanonicalEntity {
  return {
    entityId: overrides.entityId,
    primaryLookupId: overrides.primaryLookupId ?? overrides.entityId,
    lookupIds: overrides.lookupIds ?? [overrides.entityId],
    family: overrides.family,
    recordClass: overrides.recordClass,
    kind: overrides.kind,
    status: overrides.status ?? null,
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    path: overrides.path ?? `ledger/events/${overrides.entityId}.jsonl`,
    title: overrides.title ?? null,
    body: overrides.body ?? null,
    attributes: overrides.attributes ?? {},
    frontmatter: overrides.frontmatter ?? null,
    links: overrides.links ?? [],
    relatedIds: overrides.relatedIds ?? [],
    stream: overrides.stream ?? null,
    experimentSlug: overrides.experimentSlug ?? null,
    tags: overrides.tags ?? [],
  };
}

function makeObservation(input: {
  entityId: string;
  metric: string;
  provider?: string;
  recordedAt: string;
  unit: string;
  value: number;
}): CanonicalEntity {
  const provider = input.provider ?? "garmin";

  return makeEntity({
    attributes: {
      dayKey: DAY,
      externalRef: {
        resourceId: `${input.entityId}-resource`,
        resourceType: "daily-summary",
        system: provider,
      },
      metric: input.metric,
      recordedAt: input.recordedAt,
      unit: input.unit,
      value: input.value,
    },
    date: DAY,
    entityId: input.entityId,
    family: "event",
    kind: "observation",
    occurredAt: `${DAY}T23:00:00.000Z`,
    recordClass: "ledger",
    title: `${provider} ${input.metric}`,
  });
}

function makeActivitySession(input: {
  activeCalories?: number;
  distanceKm?: number;
  durationMinutes: number;
  endAt: string;
  entityId: string;
  maxHeartRate?: number;
  provider?: string;
  recordedAt: string;
  startAt: string;
  totalElevationGainMeters?: number;
  workoutStrain?: number;
}): CanonicalEntity {
  const provider = input.provider ?? "garmin";

  return makeEntity({
    attributes: {
      activityType: "Running",
      dayKey: DAY,
      durationMinutes: input.durationMinutes,
      endAt: input.endAt,
      externalRef: {
        resourceId: `${input.entityId}-resource`,
        resourceType: "activity_session",
        system: provider,
      },
      recordedAt: input.recordedAt,
      startAt: input.startAt,
      workout: {
        metrics: {
          ...(input.activeCalories === undefined ? {} : { activeCalories: input.activeCalories }),
          ...(input.distanceKm === undefined ? {} : { distanceKm: input.distanceKm }),
          ...(input.maxHeartRate === undefined ? {} : { maxHeartRate: input.maxHeartRate }),
          ...(input.totalElevationGainMeters === undefined
            ? {}
            : { totalElevationGainMeters: input.totalElevationGainMeters }),
          ...(input.workoutStrain === undefined ? {} : { workoutStrain: input.workoutStrain }),
        },
      },
    },
    date: DAY,
    entityId: input.entityId,
    family: "event",
    kind: "activity_session",
    occurredAt: input.startAt,
    recordClass: "ledger",
    title: `${provider} activity session`,
  });
}

function makeVault(entities: readonly CanonicalEntity[]) {
  return createVaultReadModel({
    entities,
    metadata: null,
    vaultRoot: "/virtual/wearables-daily-reducers",
  });
}

function summarizeActivity(entities: readonly CanonicalEntity[]) {
  const vault = makeVault(entities);
  const activity = summarizeWearableLatest(vault)?.activity;
  assert.ok(activity);
  return activity;
}

test("daily cumulative reducers choose a same-provider workout rollup over zero or partial daily totals", () => {
  const activity = summarizeActivity([
    makeObservation({
      entityId: "evt_daily_active_calories_partial",
      metric: "active-calories",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "kcal",
      value: 0,
    }),
    makeObservation({
      entityId: "evt_daily_distance_partial",
      metric: "distance",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "km",
      value: 1,
    }),
    makeObservation({
      entityId: "evt_daily_elevation_partial",
      metric: "total-elevation-gain",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "m",
      value: 20,
    }),
    makeActivitySession({
      activeCalories: 600,
      distanceKm: 10,
      durationMinutes: 60,
      endAt: `${DAY}T13:00:00.000Z`,
      entityId: "evt_workout_complete",
      recordedAt: `${DAY}T13:02:00.000Z`,
      startAt: `${DAY}T12:00:00.000Z`,
      totalElevationGainMeters: 200,
    }),
  ]);

  assert.equal(activity.activeCalories.selection.value, 600);
  assert.equal(activity.distanceKm.selection.value, 10);
  assert.equal(activity.totalElevationGainMeters.selection.value, 200);
  for (const metric of [
    activity.activeCalories,
    activity.distanceKm,
    activity.totalElevationGainMeters,
  ]) {
    assert.equal(metric.selection.provider, "garmin");
    assert.equal(metric.selection.sourceKind, "activity-session-day-rollup");
    assert.deepEqual(metric.selection.recordIds, ["evt_workout_complete"]);
    assert.deepEqual(metric.confidence.conflictingProviders, []);
    assert.match(metric.confidence.reasons[0] ?? "", /overlapping totals were not added/u);
    assert.equal(
      metric.confidence.reasons.some((reason) =>
        reason.includes("Duplicate evidence") && reason.includes("after source reconciliation")
      ),
      false,
    );
  }
  assert.equal(activity.summaryConfidence.conflictingMetrics.includes("activeCalories"), false);
  assert.equal(activity.summaryConfidence.conflictingMetrics.includes("distanceKm"), false);
  assert.equal(activity.summaryConfidence.conflictingMetrics.includes("totalElevationGainMeters"), false);
});

test("daily cumulative reducers retain a larger explicit daily total and its provenance", () => {
  const activity = summarizeActivity([
    makeObservation({
      entityId: "evt_daily_active_calories_complete",
      metric: "active-calories",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "kcal",
      value: 800,
    }),
    makeObservation({
      entityId: "evt_daily_distance_complete",
      metric: "distance",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "km",
      value: 14.5,
    }),
    makeObservation({
      entityId: "evt_daily_elevation_complete",
      metric: "total-elevation-gain",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "m",
      value: 300,
    }),
    makeActivitySession({
      activeCalories: 600,
      distanceKm: 10,
      durationMinutes: 60,
      endAt: `${DAY}T13:00:00.000Z`,
      entityId: "evt_workout_subset",
      recordedAt: `${DAY}T13:02:00.000Z`,
      startAt: `${DAY}T12:00:00.000Z`,
      totalElevationGainMeters: 200,
    }),
  ]);

  assert.equal(activity.activeCalories.selection.value, 800);
  assert.equal(activity.distanceKm.selection.value, 14.5);
  assert.equal(activity.totalElevationGainMeters.selection.value, 300);
  assert.deepEqual(
    [
      activity.activeCalories.selection.recordIds,
      activity.distanceKm.selection.recordIds,
      activity.totalElevationGainMeters.selection.recordIds,
    ],
    [
      ["evt_daily_active_calories_complete"],
      ["evt_daily_distance_complete"],
      ["evt_daily_elevation_complete"],
    ],
  );
  assert.equal(activity.distanceKm.selection.sourceKind, "observation:distance");
});

test("daily cumulative reducers use the largest explicit total instead of the preferred-provider value", () => {
  const activity = summarizeActivity([
    makeObservation({
      entityId: "evt_garmin_active_calories_lower",
      metric: "active-calories",
      provider: "garmin",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "kcal",
      value: 500,
    }),
    makeObservation({
      entityId: "evt_oura_active_calories_higher",
      metric: "active-calories",
      provider: "oura",
      recordedAt: `${DAY}T23:04:00.000Z`,
      unit: "kcal",
      value: 700,
    }),
    makeObservation({
      entityId: "evt_garmin_distance_lower",
      metric: "distance",
      provider: "garmin",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "km",
      value: 8,
    }),
    makeObservation({
      entityId: "evt_oura_distance_higher",
      metric: "distance",
      provider: "oura",
      recordedAt: `${DAY}T23:04:00.000Z`,
      unit: "km",
      value: 12,
    }),
    makeObservation({
      entityId: "evt_garmin_elevation_lower",
      metric: "total-elevation-gain",
      provider: "garmin",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "m",
      value: 100,
    }),
    makeObservation({
      entityId: "evt_oura_elevation_higher",
      metric: "total-elevation-gain",
      provider: "oura",
      recordedAt: `${DAY}T23:04:00.000Z`,
      unit: "m",
      value: 250,
    }),
    makeActivitySession({
      activeCalories: 650,
      distanceKm: 10,
      durationMinutes: 65,
      endAt: `${DAY}T13:19:00.000Z`,
      entityId: "evt_workout_between_explicit_totals",
      recordedAt: `${DAY}T13:25:00.000Z`,
      startAt: `${DAY}T12:14:00.000Z`,
      totalElevationGainMeters: 200,
    }),
  ]);

  assert.equal(activity.activeCalories.selection.value, 700);
  assert.equal(activity.distanceKm.selection.value, 12);
  assert.equal(activity.totalElevationGainMeters.selection.value, 250);
  for (const metric of [
    activity.activeCalories,
    activity.distanceKm,
    activity.totalElevationGainMeters,
  ]) {
    assert.equal(metric.selection.provider, "oura");
    assert.equal(metric.selection.sourceKind?.startsWith("observation:"), true);
    assert.equal(
      metric.confidence.reasons.some((reason) =>
        reason.includes("explicit daily maximum reducer")
        && reason.includes("selected Oura observation:")
      ),
      true,
    );
  }
});

test("daily cumulative reducers can select a deduplicated multi-provider workout union", () => {
  const activity = summarizeActivity([
    makeObservation({
      entityId: "evt_daily_active_calories_lower",
      metric: "active-calories",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "kcal",
      value: 600,
    }),
    makeObservation({
      entityId: "evt_daily_distance_lower",
      metric: "distance",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "km",
      value: 8,
    }),
    makeObservation({
      entityId: "evt_daily_elevation_lower",
      metric: "total-elevation-gain",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "m",
      value: 100,
    }),
    makeActivitySession({
      activeCalories: 400,
      distanceKm: 6,
      durationMinutes: 40,
      endAt: `${DAY}T09:00:00.000Z`,
      entityId: "evt_morning_workout",
      provider: "garmin",
      recordedAt: `${DAY}T09:02:00.000Z`,
      startAt: `${DAY}T08:20:00.000Z`,
      totalElevationGainMeters: 120,
    }),
    makeActivitySession({
      activeCalories: 300,
      distanceKm: 4,
      durationMinutes: 30,
      endAt: `${DAY}T19:00:00.000Z`,
      entityId: "evt_evening_workout",
      provider: "apple-health-kit",
      recordedAt: `${DAY}T19:02:00.000Z`,
      startAt: `${DAY}T18:30:00.000Z`,
      totalElevationGainMeters: 80,
    }),
  ]);

  assert.equal(activity.activeCalories.selection.value, 700);
  assert.equal(activity.distanceKm.selection.value, 10);
  assert.equal(activity.totalElevationGainMeters.selection.value, 200);
  for (const metric of [
    activity.activeCalories,
    activity.distanceKm,
    activity.totalElevationGainMeters,
  ]) {
    assert.equal(metric.selection.provider, "multiple");
    assert.equal(metric.selection.sourceKind, "activity-session-day-rollup");
    assert.deepEqual(
      [...metric.selection.recordIds].sort(),
      ["evt_evening_workout", "evt_morning_workout"],
    );
  }
});

test("daily maximum reducer confidence reasons describe the selected maximum candidate", () => {
  const activity = summarizeActivity([
    makeObservation({
      entityId: "evt_daily_max_heart_rate",
      metric: "max-heart-rate",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "bpm",
      value: 172,
    }),
    makeActivitySession({
      durationMinutes: 60,
      endAt: `${DAY}T13:00:00.000Z`,
      entityId: "evt_workout_max_heart_rate",
      maxHeartRate: 180,
      recordedAt: `${DAY}T13:02:00.000Z`,
      startAt: `${DAY}T12:00:00.000Z`,
    }),
  ]);

  assert.equal(activity.maxHeartRate.selection.value, 180);
  assert.equal(activity.maxHeartRate.selection.sourceKind, "activity-session-day-rollup");
  assert.equal(activity.maxHeartRate.confidence.candidateCount, 2);
  assert.match(
    activity.maxHeartRate.confidence.reasons.join("\n"),
    /selected Garmin activity-session-day-rollup at 180 bpm/u,
  );
  assert.equal(
    activity.maxHeartRate.confidence.reasons.some((reason) =>
      reason.startsWith("Selected ") && reason.includes(" observation ")
    ),
    false,
  );
});

test("daily and workout maximum heart rates remain conflict-free nested extrema across providers", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_daily_nested_max_heart_rate",
      metric: "max-heart-rate",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "bpm",
      value: 174,
    }),
    makeActivitySession({
      durationMinutes: 58,
      endAt: `${DAY}T13:00:00.000Z`,
      entityId: "evt_workout_nested_max_heart_rate",
      maxHeartRate: 181,
      provider: "oura",
      recordedAt: `${DAY}T13:02:00.000Z`,
      startAt: `${DAY}T12:02:00.000Z`,
    }),
  ]);
  const directLatest = summarizeWearableLatest(vault);
  const storedBundle = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows: buildWearableSummaryProjection(vault),
  }, {});
  const direct = directLatest?.activity?.maxHeartRate;
  const stored = storedBundle.activityDays.find((summary) => summary.date === DAY)?.maxHeartRate;

  assert.ok(direct);
  assert.ok(stored);
  for (const metric of [direct, stored]) {
    assert.equal(metric.selection.value, 181);
    assert.equal(metric.selection.provider, "oura");
    assert.equal(metric.selection.sourceKind, "activity-session-day-rollup");
    assert.equal(metric.confidence.level, "high");
    assert.deepEqual(metric.confidence.conflictingProviders, []);
    assert.equal(
      metric.confidence.reasons.some((reason) =>
        reason.includes("Duplicate evidence") || reason.includes("after source reconciliation")
      ),
      false,
    );
  }
  assert.deepEqual(stored.confidence, direct.confidence);
  assert.equal(
    directLatest.sourceHealth.find((summary) => summary.provider === "garmin")?.conflictCount,
    0,
  );
  assert.equal(
    storedBundle.sourceHealth.find((summary) => summary.provider === "garmin")?.conflictCount,
    0,
  );
  assert.equal(
    directLatest.sourceHealth.find((summary) => summary.provider === "oura")?.conflictCount,
    0,
  );
  assert.equal(
    storedBundle.sourceHealth.find((summary) => summary.provider === "oura")?.conflictCount,
    0,
  );
});

test("workout strain uses the daily maximum across explicit and session evidence with stored parity", () => {
  const cases = [
    {
      explicitProvider: "garmin",
      explicitValue: 15,
      name: "explicit-higher",
      sessionProvider: "whoop",
      sessionValue: 10,
    },
    {
      explicitProvider: "garmin",
      explicitValue: 8,
      name: "session-rollup-higher",
      sessionProvider: "whoop",
      sessionValue: 12,
    },
    {
      explicitProvider: "garmin",
      explicitValue: 12,
      name: "equal",
      sessionProvider: "whoop",
      sessionValue: 12,
    },
  ] as const;

  for (const scenario of cases) {
    const explicitId = `evt_${scenario.name}_explicit_workout_strain`;
    const sessionId = `evt_${scenario.name}_session_workout_strain`;
    const vault = makeVault([
      makeObservation({
        entityId: explicitId,
        metric: "workout-strain",
        provider: scenario.explicitProvider,
        recordedAt: `${DAY}T23:05:00.000Z`,
        unit: "strain",
        value: scenario.explicitValue,
      }),
      makeActivitySession({
        durationMinutes: 60,
        endAt: `${DAY}T13:00:00.000Z`,
        entityId: sessionId,
        provider: scenario.sessionProvider,
        recordedAt: `${DAY}T13:02:00.000Z`,
        startAt: `${DAY}T12:00:00.000Z`,
        workoutStrain: scenario.sessionValue,
      }),
    ]);
    const direct = summarizeWearableLatest(vault)?.activity?.workoutStrain;
    const stored = composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: false,
      providers: [],
      rows: buildWearableSummaryProjection(vault),
    }, {}).activityDays.find((summary) => summary.date === DAY)?.workoutStrain;

    assert.ok(direct);
    assert.ok(stored);
    assert.equal(direct.selection.value, Math.max(scenario.explicitValue, scenario.sessionValue));
    assert.equal(stored.selection.value, direct.selection.value);
    assert.equal(stored.selection.provider, direct.selection.provider);
    assert.equal(stored.selection.sourceKind, direct.selection.sourceKind);
    assert.equal(direct.confidence.candidateCount, 2);
    assert.equal(stored.confidence.candidateCount, 2);
    assert.deepEqual(stored.confidence.conflictingProviders, direct.confidence.conflictingProviders);
    assert.equal(
      direct.confidence.reasons.some((reason) =>
        reason.includes("daily maximum reducer")
      ),
      true,
    );

    if (scenario.explicitValue > scenario.sessionValue) {
      assert.equal(direct.selection.provider, scenario.explicitProvider);
      assert.equal(direct.selection.sourceKind, "observation:workout-strain");
      assert.deepEqual(direct.selection.recordIds, [explicitId]);
      assert.deepEqual(direct.confidence.conflictingProviders, [scenario.sessionProvider]);
    } else if (scenario.sessionValue > scenario.explicitValue) {
      assert.equal(direct.selection.provider, scenario.sessionProvider);
      assert.equal(direct.selection.sourceKind, "activity-session-day-rollup");
      assert.deepEqual(direct.selection.recordIds, [sessionId]);
      assert.deepEqual(direct.confidence.conflictingProviders, [scenario.explicitProvider]);
    } else {
      assert.deepEqual(direct.confidence.conflictingProviders, []);
    }
  }
});

test("stored recomposition does not turn overlapping daily and workout totals into same-provider conflicts", () => {
  const entities = [
    makeObservation({
      entityId: "evt_daily_active_calories_above_workout",
      metric: "active-calories",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "kcal",
      value: 150,
    }),
    makeObservation({
      entityId: "evt_daily_distance_below_workout",
      metric: "distance",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "km",
      value: 5,
    }),
    makeObservation({
      entityId: "evt_daily_elevation_above_workout",
      metric: "total-elevation-gain",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "m",
      value: 150,
    }),
    makeActivitySession({
      activeCalories: 100,
      distanceKm: 10,
      durationMinutes: 60,
      endAt: `${DAY}T13:00:00.000Z`,
      entityId: "evt_workout_overlapping_daily_totals",
      recordedAt: `${DAY}T13:05:00.000Z`,
      startAt: `${DAY}T12:00:00.000Z`,
      totalElevationGainMeters: 100,
    }),
  ];
  const vault = makeVault(entities);
  const direct = summarizeWearableLatest(vault)?.activity;
  const rows = buildWearableSummaryProjection(vault);
  const stored = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows,
  }, {}).activityDays.find((summary) => summary.date === DAY);

  assert.ok(direct);
  assert.ok(stored);
  for (const [directMetric, storedMetric, expectedValue] of [
    [direct.activeCalories, stored.activeCalories, 150],
    [direct.distanceKm, stored.distanceKm, 10],
    [direct.totalElevationGainMeters, stored.totalElevationGainMeters, 150],
  ] as const) {
    assert.equal(directMetric.selection.value, expectedValue);
    assert.equal(storedMetric.selection.value, expectedValue);
    assert.equal(storedMetric.selection.provider, directMetric.selection.provider);
    assert.deepEqual(directMetric.confidence.conflictingProviders, []);
    assert.deepEqual(storedMetric.confidence.conflictingProviders, []);
    assert.equal(
      storedMetric.confidence.reasons.some((reason) =>
        reason.includes("Duplicate evidence") && reason.includes("after source reconciliation")
      ),
      false,
    );
  }
});

test("same-provider lower-bound values stay conflict-free across direct and stored paths", () => {
  for (const dailyValue of [0, 100, 300]) {
    for (const workoutValue of [50, 150, 300]) {
      const suffix = `${dailyValue}_${workoutValue}`;
      const vault = makeVault([
        makeObservation({
          entityId: `evt_daily_active_calories_${suffix}`,
          metric: "active-calories",
          recordedAt: `${DAY}T23:05:00.000Z`,
          unit: "kcal",
          value: dailyValue,
        }),
        makeActivitySession({
          activeCalories: workoutValue,
          durationMinutes: 60,
          endAt: `${DAY}T13:00:00.000Z`,
          entityId: `evt_workout_active_calories_${suffix}`,
          recordedAt: `${DAY}T13:05:00.000Z`,
          startAt: `${DAY}T12:00:00.000Z`,
        }),
      ]);
      const direct = summarizeWearableLatest(vault)?.activity?.activeCalories;
      const stored = composePublicWearableSummaryBundleFromStoredRows({
        providerFilterWasProvided: false,
        providers: [],
        rows: buildWearableSummaryProjection(vault),
      }, {}).activityDays.find((summary) => summary.date === DAY)?.activeCalories;

      assert.ok(direct);
      assert.ok(stored);
      assert.equal(direct.selection.value, Math.max(dailyValue, workoutValue));
      assert.equal(stored.selection.value, direct.selection.value);
      assert.equal(stored.selection.provider, direct.selection.provider);
      assert.deepEqual(direct.confidence.conflictingProviders, []);
      assert.deepEqual(stored.confidence.conflictingProviders, []);
      assert.equal(
        stored.confidence.reasons.some((reason) => reason.includes("after source reconciliation")),
        false,
      );
    }
  }
});

test("stored recomposition retains an explicit cumulative total hidden by a provider-local workout", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_garmin_explicit_cumulative_total",
      metric: "active-calories",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "kcal",
      value: 278.868,
    }),
    makeObservation({
      entityId: "evt_garmin_explicit_distance_total",
      metric: "distance",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "km",
      value: 27.8868,
    }),
    makeObservation({
      entityId: "evt_garmin_explicit_elevation_total",
      metric: "total-elevation-gain",
      recordedAt: `${DAY}T23:05:00.000Z`,
      unit: "m",
      value: 278.868,
    }),
    makeActivitySession({
      activeCalories: 405,
      distanceKm: 40.5,
      durationMinutes: 99,
      endAt: `${DAY}T13:39:00.000Z`,
      entityId: "evt_garmin_provider_local_workout",
      provider: "garmin",
      recordedAt: `${DAY}T13:40:00.000Z`,
      startAt: `${DAY}T12:00:00.000Z`,
      totalElevationGainMeters: 405,
    }),
    makeActivitySession({
      activeCalories: 276,
      distanceKm: 27.6,
      durationMinutes: 105,
      endAt: `${DAY}T13:45:00.000Z`,
      entityId: "evt_apple_preferred_mirror",
      provider: "apple-health-kit",
      recordedAt: `${DAY}T13:46:00.000Z`,
      startAt: `${DAY}T12:00:00.000Z`,
      totalElevationGainMeters: 276,
    }),
  ]);
  const direct = summarizeWearableLatest(vault)?.activity;
  const storedBundle = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows: buildWearableSummaryProjection(vault),
  }, {});
  const stored = storedBundle.activityDays.find((summary) => summary.date === DAY);

  assert.ok(direct);
  assert.ok(stored);
  for (const [directMetric, storedMetric, expectedValue] of [
    [direct.activeCalories, stored.activeCalories, 278.868],
    [direct.distanceKm, stored.distanceKm, 27.8868],
    [direct.totalElevationGainMeters, stored.totalElevationGainMeters, 278.868],
  ] as const) {
    assert.equal(directMetric.selection.value, expectedValue);
    assert.equal(storedMetric.selection.value, expectedValue);
    assert.equal(storedMetric.selection.provider, directMetric.selection.provider);
    assert.equal(storedMetric.selection.sourceKind, directMetric.selection.sourceKind);
  }
  assert.equal(JSON.stringify(storedBundle).includes("activityMetricRankingEvidence"), false);
});

test("cross-provider stored recomposition preserves cumulative lower-bound selection parity", () => {
  const cases = [100, 276, 450].flatMap((appleWorkout) =>
    [150, 278.868, 500].flatMap((explicitDaily) =>
      [200, 405].map((garminWorkout) => ({
        appleWorkout,
        explicitDaily,
        garminWorkout,
      }))
    )
  );

  cases.forEach((values, index) => {
    const scaleDistance = (value: number) => Number((value / 10).toFixed(4));
    const vault = makeVault([
      makeObservation({
        entityId: `evt_explicit_active_calories_case_${index}`,
        metric: "active-calories",
        recordedAt: `${DAY}T23:05:00.000Z`,
        unit: "kcal",
        value: values.explicitDaily,
      }),
      makeObservation({
        entityId: `evt_explicit_distance_case_${index}`,
        metric: "distance",
        recordedAt: `${DAY}T23:05:00.000Z`,
        unit: "km",
        value: scaleDistance(values.explicitDaily),
      }),
      makeObservation({
        entityId: `evt_explicit_elevation_case_${index}`,
        metric: "total-elevation-gain",
        recordedAt: `${DAY}T23:05:00.000Z`,
        unit: "m",
        value: values.explicitDaily,
      }),
      makeActivitySession({
        activeCalories: values.garminWorkout,
        distanceKm: scaleDistance(values.garminWorkout),
        durationMinutes: 99,
        endAt: `${DAY}T13:39:00.000Z`,
        entityId: `evt_garmin_mirror_case_${index}`,
        provider: "garmin",
        recordedAt: `${DAY}T13:40:00.000Z`,
        startAt: `${DAY}T12:00:00.000Z`,
        totalElevationGainMeters: values.garminWorkout,
      }),
      makeActivitySession({
        activeCalories: values.appleWorkout,
        distanceKm: scaleDistance(values.appleWorkout),
        durationMinutes: 105,
        endAt: `${DAY}T13:45:00.000Z`,
        entityId: `evt_apple_mirror_case_${index}`,
        provider: "apple-health-kit",
        recordedAt: `${DAY}T13:46:00.000Z`,
        startAt: `${DAY}T12:00:00.000Z`,
        totalElevationGainMeters: values.appleWorkout,
      }),
    ]);
    const direct = summarizeWearableLatest(vault)?.activity;
    const stored = composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: false,
      providers: [],
      rows: buildWearableSummaryProjection(vault),
    }, {}).activityDays.find((summary) => summary.date === DAY);

    assert.ok(direct);
    assert.ok(stored);
    for (const [directMetric, storedMetric] of [
      [direct.activeCalories, stored.activeCalories],
      [direct.distanceKm, stored.distanceKm],
      [direct.totalElevationGainMeters, stored.totalElevationGainMeters],
    ] as const) {
      assert.equal(storedMetric.selection.value, directMetric.selection.value);
      assert.equal(storedMetric.selection.provider, directMetric.selection.provider);
      assert.equal(storedMetric.selection.sourceKind, directMetric.selection.sourceKind);
      assert.deepEqual(storedMetric.confidence, directMetric.confidence);
    }
  });
});

test("stored conflict merge does not import an explicit-branch self-conflict into a workout selection", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_garmin_explicit_active_calories_lower",
      metric: "active-calories",
      recordedAt: `${DAY}T22:00:00.000Z`,
      unit: "kcal",
      value: 100,
    }),
    makeObservation({
      entityId: "evt_garmin_explicit_active_calories_higher",
      metric: "active-calories",
      recordedAt: `${DAY}T23:00:00.000Z`,
      unit: "kcal",
      value: 150,
    }),
    makeActivitySession({
      activeCalories: 50,
      durationMinutes: 30,
      endAt: `${DAY}T09:00:00.000Z`,
      entityId: "evt_garmin_small_workout",
      provider: "garmin",
      recordedAt: `${DAY}T09:05:00.000Z`,
      startAt: `${DAY}T08:30:00.000Z`,
    }),
    makeActivitySession({
      activeCalories: 200,
      durationMinutes: 60,
      endAt: `${DAY}T19:00:00.000Z`,
      entityId: "evt_apple_distinct_workout",
      provider: "apple-health-kit",
      recordedAt: `${DAY}T19:05:00.000Z`,
      startAt: `${DAY}T18:00:00.000Z`,
    }),
  ]);
  const direct = summarizeWearableLatest(vault)?.activity?.activeCalories;
  const stored = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows: buildWearableSummaryProjection(vault),
  }, {}).activityDays.find((summary) => summary.date === DAY)?.activeCalories;

  assert.ok(direct);
  assert.ok(stored);
  assert.equal(direct.selection.value, 250);
  assert.equal(stored.selection.value, 250);
  assert.equal(stored.selection.sourceKind, "activity-session-day-rollup");
  assert.deepEqual(direct.confidence.conflictingProviders, []);
  assert.deepEqual(stored.confidence.conflictingProviders, []);
  assert.equal(
    stored.confidence.reasons.some((reason) => reason.includes("after source reconciliation")),
    false,
  );
});
