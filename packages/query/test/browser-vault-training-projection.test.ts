import assert from "node:assert/strict";

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

test("browser vault replicas expose only the workout fields needed by Training", async () => {
  const workout = {
    endedAt: "2026-08-08T15:45:00.000Z",
    exercises: [
      {
        name: "Bench press",
        order: 1,
        sets: [
          { order: 1, reps: 10, weight: 135, weightUnit: "lb" },
          { order: 2, reps: 8, rpe: 8, weight: 155, weightUnit: "lb" },
        ],
        sourceExerciseId: "EX001",
      },
    ],
    routineName: "Push day",
    startedAt: "2026-08-08T15:00:00.000Z",
  };
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-projection",
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "workout_1", {
          attributes: {
            activityType: "strength-training",
            durationMinutes: 45,
            privateProviderPayload: { shouldNotReachBrowser: true },
            source: "manual",
            title: "Push day",
            workout,
          },
          date: "2026-08-08",
          kind: "activity_session",
          occurredAt: "2026-08-08T15:00:00.000Z",
          title: "Push day",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const projected = replica.entities.find((entity) => entity.id === "workout_1");
  assert.ok(projected);
  assert.equal(projected.attributes.activityType, "strength-training");
  assert.equal(projected.attributes.durationMinutes, 45);
  assert.equal(projected.attributes.title, "Push day");
  assert.deepEqual(projected.attributes.workout, workout);
  assert.equal("privateProviderPayload" in projected.attributes, false);
  assert.equal(projected.bodyPreview, null);
  assert.equal(projected.title, null);
});
