import assert from "node:assert/strict";

import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_TRAINING_SESSION_SCHEMA,
} from "@murphai/contracts/browser-vault";
import { test } from "vitest";

import {
  createBrowserVaultReplica,
  createVaultReadModel,
} from "../src/browser.ts";
import {
  resolveCanonicalRecordClass,
  type CanonicalEntity,
} from "../src/canonical-entities.ts";

function createEntity(
  family: CanonicalEntity["family"],
  entityId: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    attributes: {},
    body: null,
    date: null,
    entityId,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind: family,
    links: [],
    lookupIds: [entityId],
    occurredAt: null,
    path: `vault/${entityId}.md`,
    primaryLookupId: entityId,
    recordClass: resolveCanonicalRecordClass(family),
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: null,
    ...overrides,
  };
}

test("browser vault replicas expose a bounded sanitized training projection without widening generic activity rows", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-projection",
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "strength_recent", {
          attributes: {
            activityType: "strength-training",
            durationMinutes: 45,
            privateProviderPayload: { shouldNotReachBrowser: true },
            source: "manual",
            title: "Push day",
            workout: {
              endedAt: "2026-08-08T15:45:00.000Z",
              exercises: [
                {
                  groupId: "superset-private",
                  mode: "weight_reps",
                  name: "Bench press",
                  order: 1,
                  privateExercisePayload: "hidden",
                  sets: [
                    {
                      order: 1,
                      privateSetPayload: "hidden",
                      reps: 10,
                      type: "normal",
                      weight: 135,
                      weightUnit: "lb",
                    },
                    {
                      order: 2,
                      reps: 8,
                      rpe: 8,
                      weight: 155,
                      weightUnit: "lb",
                    },
                  ],
                  sourceExerciseId: "EX001",
                },
              ],
              mapId: "private-map",
              privateNestedPayload: "hidden",
              routeName: "private-route",
              routineName: "Push day",
              sourceApp: "strong",
              sourceWorkoutId: "provider-workout-id",
              startedAt: "2026-08-08T15:00:00.000Z",
            },
          },
          date: "2026-08-08",
          kind: "activity_session",
          occurredAt: "2026-08-08T15:00:00.000Z",
          title: "Push day",
        }),
        createEntity("event", "generic_run", {
          attributes: {
            activityType: "workout",
            durationMinutes: 45,
            source: "device",
            workout: {
              privateNestedPayload: "hidden",
              sportName: "Run",
            },
          },
          date: "2026-08-08",
          kind: "activity_session",
          occurredAt: "2026-08-08T08:00:00.000Z",
        }),
        createEntity("event", "strength_old", {
          attributes: {
            activityType: "strength-training",
            source: "manual",
            workout: {
              endedAt: "2025-01-01T11:00:00.000Z",
              exercises: [
                {
                  name: "Squat",
                  order: 1,
                  sets: [{ order: 1, reps: 5, weight: 185 }],
                },
              ],
              startedAt: "2025-01-01T10:00:00.000Z",
            },
          },
          date: "2025-01-01",
          kind: "activity_session",
          occurredAt: "2025-01-01T10:00:00.000Z",
        }),
        createEntity("event", "live_old", {
          attributes: {
            activityType: "strength-training",
            source: "manual",
            workout: {
              exercises: [],
              sourceApp: "murph-live",
              startedAt: "2025-01-01T10:00:00.000Z",
            },
          },
          date: "2025-01-01",
          kind: "activity_session",
          occurredAt: "2025-01-01T10:00:00.000Z",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const projectedStrength = replica.entities.find(
    (entity) => entity.id === "strength_recent",
  );
  assert.ok(projectedStrength);
  const training = requireRecord(projectedStrength.attributes.training);
  assert.equal(
    training.schema,
    BROWSER_VAULT_TRAINING_SESSION_SCHEMA,
  );
  assert.equal(training.activityType, "strength-training");
  assert.equal(training.title, "Push day");
  assert.equal(training.durationMinutes, 45);
  assert.equal(training.state, "completed");
  assert.equal("sourceApp" in training, false);
  assert.equal(training.routineName, "Push day");
  assert.equal(training.startedAt, "2026-08-08T15:00:00.000Z");
  assert.equal(training.endedAt, "2026-08-08T15:45:00.000Z");
  assert.deepEqual(training.exercises, [
    {
      name: "Bench press",
      order: 1,
      sets: [
        { order: 1, reps: 10, weight: 135, weightUnit: "lb" },
        {
          order: 2,
          reps: 8,
          rpe: 8,
          weight: 155,
          weightUnit: "lb",
        },
      ],
      sourceExerciseId: "EX001",
    },
  ]);
  assert.equal("workout" in projectedStrength.attributes, false);
  assert.equal("activityType" in projectedStrength.attributes, false);
  assert.equal("privateProviderPayload" in projectedStrength.attributes, false);
  assert.equal("routineId" in training, false);
  const projectedExercises = training.exercises as Record<string, unknown>[];
  assert.equal("groupId" in projectedExercises[0]!, false);
  assert.equal("mode" in projectedExercises[0]!, false);
  const projectedSets = projectedExercises[0]!.sets as Record<string, unknown>[];
  assert.equal("type" in projectedSets[0]!, false);
  assert.equal(projectedStrength.bodyPreview, null);
  assert.equal(projectedStrength.title, null);

  const projectedRun = replica.entities.find(
    (entity) => entity.id === "generic_run",
  );
  assert.ok(projectedRun);
  assert.deepEqual(projectedRun.attributes, {
    activityKind: "run",
    source: "device",
  });

  const projectedOld = replica.entities.find(
    (entity) => entity.id === "strength_old",
  );
  assert.ok(projectedOld);
  assert.equal("training" in projectedOld.attributes, false);

  const projectedLive = replica.entities.find(
    (entity) => entity.id === "live_old",
  );
  assert.ok(projectedLive);
  const liveTraining = requireRecord(projectedLive.attributes.training);
  assert.equal(liveTraining.state, "in_progress");
  assert.equal("sourceApp" in liveTraining, false);
  assert.deepEqual(liveTraining.exercises, []);
  assert.equal(BROWSER_VAULT_REPLICA_CURRENT_GENERATION, 6);
});

test("browser training projection preserves completed next-local-day sessions before UTC midnight", async () => {
  const createReplica = (endedAt?: string) => createBrowserVaultReplica({
    generatedAt: "2026-08-09T23:30:00.000Z",
    metricPoints: [],
    sourceBundleHash: endedAt
      ? "training-next-local-day-completed"
      : "training-next-local-day-active",
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "next_local_day", {
          attributes: {
            activityType: "strength-training",
            workout: {
              ...(endedAt ? { endedAt } : {}),
              exercises: [
                {
                  name: "Bench press",
                  order: 1,
                  sets: [{ order: 1, reps: 8, weight: 60, weightUnit: "kg" }],
                },
              ],
              sourceApp: "murph-live",
              startedAt: "2026-08-09T23:00:00.000Z",
            },
          },
          date: "2026-08-10",
          kind: "activity_session",
          occurredAt: "2026-08-09T23:00:00.000Z",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const activeReplica = await createReplica();
  const completedReplica = await createReplica("2026-08-09T23:25:00.000Z");
  const active = activeReplica.entities.find(
    (entity) => entity.id === "next_local_day",
  );
  const completed = completedReplica.entities.find(
    (entity) => entity.id === "next_local_day",
  );
  assert.ok(active);
  assert.ok(completed);
  assert.equal(requireRecord(active.attributes.training).state, "in_progress");
  assert.equal(requireRecord(completed.attributes.training).state, "completed");
});

test("browser training projection fails closed on impractically large sessions", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-projection-bound",
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "strength_oversized", {
          attributes: {
            activityType: "strength-training",
            source: "manual",
            workout: {
              endedAt: "2026-08-09T11:00:00.000Z",
              exercises: [
                {
                  name: "Pull-up",
                  order: 1,
                  sets: Array.from({ length: 301 }, (_, index) => ({
                    order: index + 1,
                    reps: 1,
                  })),
                },
              ],
              startedAt: "2026-08-09T10:00:00.000Z",
            },
          },
          date: "2026-08-09",
          kind: "activity_session",
          occurredAt: "2026-08-09T10:00:00.000Z",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const projected = replica.entities.find(
    (entity) => entity.id === "strength_oversized",
  );
  assert.ok(projected);
  assert.equal("training" in projected.attributes, false);
  assert.deepEqual(projected.attributes, {
    activityKind: "strength-training",
    source: "manual",
  });
});

test("browser training projection fails closed on aggregate session set limits", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-projection-aggregate-bound",
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "strength_aggregate_oversized", {
          attributes: {
            activityType: "strength-training",
            source: "manual",
            workout: {
              endedAt: "2026-08-09T11:00:00.000Z",
              exercises: Array.from({ length: 3 }, (_, exerciseIndex) => ({
                name: `Exercise ${exerciseIndex + 1}`,
                order: exerciseIndex + 1,
                sets: Array.from({ length: 101 }, (_, setIndex) => ({
                  order: setIndex + 1,
                  reps: 1,
                })),
              })),
              startedAt: "2026-08-09T10:00:00.000Z",
            },
          },
          date: "2026-08-09",
          kind: "activity_session",
          occurredAt: "2026-08-09T10:00:00.000Z",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const projected = replica.entities.find(
    (entity) => entity.id === "strength_aggregate_oversized",
  );
  assert.ok(projected);
  assert.equal("training" in projected.attributes, false);
  assert.deepEqual(projected.attributes, {
    activityKind: "strength-training",
    source: "manual",
  });
});

function requireRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
