import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import { composePublicWearableSummaryBundleFromStoredRows } from "../src/projection/wearable-summary-compose.ts";
import { buildWearableSummaryProjection } from "../src/projection/wearable-summary-projector.ts";
import { summarizeWearableLatest } from "../src/wearables.ts";

const DAY = "2026-04-16";

function entity(
  input: Partial<CanonicalEntity>
    & Pick<CanonicalEntity, "entityId" | "family" | "kind" | "recordClass">,
): CanonicalEntity {
  return {
    attributes: input.attributes ?? {},
    body: input.body ?? null,
    date: input.date ?? null,
    entityId: input.entityId,
    experimentSlug: input.experimentSlug ?? null,
    family: input.family,
    frontmatter: input.frontmatter ?? null,
    kind: input.kind,
    links: input.links ?? [],
    lookupIds: input.lookupIds ?? [input.entityId],
    occurredAt: input.occurredAt ?? null,
    path: input.path ?? `ledger/events/${input.entityId}.jsonl`,
    primaryLookupId: input.primaryLookupId ?? input.entityId,
    recordClass: input.recordClass,
    relatedIds: input.relatedIds ?? [],
    status: input.status ?? null,
    stream: input.stream ?? null,
    tags: input.tags ?? [],
    title: input.title ?? null,
  };
}

function observation(input: {
  id: string;
  metric: string;
  provider?: string;
  recordedAt?: string;
  unit: string;
  value: number;
}): CanonicalEntity {
  const provider = input.provider ?? "garmin";
  return entity({
    attributes: {
      dayKey: DAY,
      externalRef: {
        resourceId: `${input.id}-resource`,
        resourceType: "daily-summary",
        system: provider,
      },
      metric: input.metric,
      recordedAt: input.recordedAt ?? `${DAY}T23:05:00.000Z`,
      unit: input.unit,
      value: input.value,
    },
    date: DAY,
    entityId: input.id,
    family: "event",
    kind: "observation",
    occurredAt: `${DAY}T23:00:00.000Z`,
    recordClass: "ledger",
    title: `${provider} ${input.metric}`,
  });
}

type WorkoutMetrics = {
  activeCalories?: number;
  distanceKm?: number;
  maxHeartRate?: number;
  totalElevationGainMeters?: number;
  workoutStrain?: number;
};

function session(input: {
  durationMinutes?: number;
  endAt?: string;
  id: string;
  metrics: WorkoutMetrics;
  provider?: string;
  recordedAt?: string;
  resourceId?: string;
  startAt?: string;
}): CanonicalEntity {
  const provider = input.provider ?? "garmin";
  const startAt = input.startAt ?? `${DAY}T12:00:00.000Z`;
  const endAt = input.endAt ?? `${DAY}T13:00:00.000Z`;
  return entity({
    attributes: {
      activityType: "Running",
      dayKey: DAY,
      durationMinutes: input.durationMinutes ?? 60,
      endAt,
      externalRef: {
        resourceId: input.resourceId ?? `${input.id}-resource`,
        resourceType: "activity_session",
        system: provider,
      },
      recordedAt: input.recordedAt ?? `${DAY}T13:02:00.000Z`,
      startAt,
      workout: { metrics: input.metrics },
    },
    date: DAY,
    entityId: input.id,
    family: "event",
    kind: "activity_session",
    occurredAt: startAt,
    recordClass: "ledger",
    title: `${provider} activity session`,
  });
}

function cumulativeObservations(
  id: string,
  provider: string,
  values: readonly [number, number, number],
): CanonicalEntity[] {
  return [
    observation({
      id: `${id}-calories`,
      metric: "active-calories",
      provider,
      unit: "kcal",
      value: values[0],
    }),
    observation({
      id: `${id}-distance`,
      metric: "distance",
      provider,
      unit: "km",
      value: values[1],
    }),
    observation({
      id: `${id}-elevation`,
      metric: "total-elevation-gain",
      provider,
      unit: "m",
      value: values[2],
    }),
  ];
}

function directAndStored(entities: readonly CanonicalEntity[]) {
  const vault = createVaultReadModel({
    entities,
    metadata: null,
    vaultRoot: "/virtual/wearables-daily-reducers",
  });
  const direct = summarizeWearableLatest(vault)?.activity;
  const stored = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows: buildWearableSummaryProjection(vault),
  }, {}).activityDays.find((summary) => summary.date === DAY);
  assert.ok(direct);
  assert.ok(stored);
  return { direct, stored };
}

test("daily cumulative reducers choose the larger explicit total or reconciled workout rollup", () => {
  const scenarios = [
    {
      expected: [600, 10, 200],
      explicit: [["garmin", [0, 1, 20]]] as const,
      name: "workout-larger",
      workout: [600, 10, 200] as const,
    },
    {
      expected: [800, 14.5, 250],
      explicit: [["garmin", [800, 14.5, 250]]] as const,
      name: "explicit-larger",
      workout: [600, 10, 200] as const,
    },
    {
      expected: [700, 12, 250],
      explicit: [
        ["garmin", [500, 9, 150]],
        ["oura", [700, 12, 250]],
      ] as const,
      name: "largest-explicit-provider",
      workout: [650, 10, 200] as const,
    },
  ] as const;

  for (const scenario of scenarios) {
    const { direct, stored } = directAndStored([
      ...scenario.explicit.flatMap(([provider, values], index) =>
        cumulativeObservations(`${scenario.name}-${index}`, provider, values)
      ),
      session({
        id: `${scenario.name}-workout`,
        metrics: {
          activeCalories: scenario.workout[0],
          distanceKm: scenario.workout[1],
          totalElevationGainMeters: scenario.workout[2],
        },
      }),
    ]);

    for (const [key, expected] of [
      ["activeCalories", scenario.expected[0]],
      ["distanceKm", scenario.expected[1]],
      ["totalElevationGainMeters", scenario.expected[2]],
    ] as const) {
      assert.equal(direct[key].selection.value, expected, `${scenario.name}: ${key}`);
      assert.equal(stored[key].selection.value, expected, `${scenario.name}: stored ${key}`);
      assert.equal(stored[key].selection.provider, direct[key].selection.provider);
      assert.equal(stored[key].selection.sourceKind, direct[key].selection.sourceKind);
      assert.deepEqual(stored[key].confidence.conflictingProviders, direct[key].confidence.conflictingProviders);
      if (scenario.name !== "largest-explicit-provider") {
        assert.deepEqual(direct[key].confidence.conflictingProviders, []);
        assert.equal(direct.summaryConfidence.conflictingMetrics.includes(key), false);
      }
    }
  }
});

test("daily maximum reducers compare explicit and workout evidence without summing", () => {
  const { direct, stored } = directAndStored([
    observation({
      id: "explicit-max-heart-rate",
      metric: "max-heart-rate",
      provider: "garmin",
      unit: "bpm",
      value: 178,
    }),
    observation({
      id: "explicit-workout-strain",
      metric: "workout-strain",
      provider: "garmin",
      unit: "strain",
      value: 15,
    }),
    session({
      id: "run",
      metrics: { maxHeartRate: 181, workoutStrain: 12 },
      provider: "oura",
    }),
    session({
      durationMinutes: 10,
      endAt: `${DAY}T18:10:00.000Z`,
      id: "strength",
      metrics: { maxHeartRate: 172, workoutStrain: 6 },
      provider: "garmin",
      startAt: `${DAY}T18:00:00.000Z`,
    }),
  ]);

  for (const [key, expected] of [
    ["maxHeartRate", 181],
    ["workoutStrain", 15],
  ] as const) {
    assert.equal(direct[key].selection.value, expected);
    assert.equal(stored[key].selection.value, expected);
    assert.equal(stored[key].selection.provider, direct[key].selection.provider);
    assert.equal(stored[key].selection.sourceKind, direct[key].selection.sourceKind);
    assert.deepEqual(stored[key].confidence, direct[key].confidence);
  }
  assert.deepEqual(direct.maxHeartRate.confidence.conflictingProviders, []);
  assert.equal(direct.summaryConfidence.conflictingMetrics.includes("maxHeartRate"), false);
});

test("an explicit 90 total beats a preferred 50 workout when a 100 workout is only its mirror", () => {
  const { direct, stored } = directAndStored([
    ...cumulativeObservations("explicit", "garmin", [90, 9, 90]),
    session({
      id: "garmin-mirror",
      metrics: {
        activeCalories: 50,
        distanceKm: 5,
        totalElevationGainMeters: 50,
      },
      provider: "garmin",
    }),
    session({
      id: "apple-mirror",
      metrics: {
        activeCalories: 100,
        distanceKm: 10,
        totalElevationGainMeters: 100,
      },
      provider: "apple-health-kit",
      recordedAt: `${DAY}T13:01:00.000Z`,
    }),
  ]);

  for (const [key, expected] of [
    ["activeCalories", 90],
    ["distanceKm", 9],
    ["totalElevationGainMeters", 90],
  ] as const) {
    assert.equal(direct[key].selection.value, expected, key);
    assert.equal(stored[key].selection.value, expected, `stored ${key}`);
    assert.equal(stored[key].selection.provider, direct[key].selection.provider);
    assert.equal(stored[key].selection.sourceKind, direct[key].selection.sourceKind);
  }
});
