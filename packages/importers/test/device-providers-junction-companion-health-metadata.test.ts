import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as coreRuntime from "@murphai/core";
import { test } from "vitest";

import {
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
} from "../src/index.ts";

const RECOVERY_RECORD_ID = "a".repeat(64);
const WORKOUT_STRAIN_RECORD_ID = "b".repeat(64);

function buildSnapshot(input: {
  importedAt: string;
  recoveryScore: number;
  syncVersion: number;
  workoutStrain: number;
}) {
  return {
    accountId: "junction-companion-account",
    importedAt: input.importedAt,
    summaries: {
      sleep: [{
        id: RECOVERY_RECORD_ID,
        date: "2026-04-02T12:00:00.000Z",
        companionStartAt: "2026-04-02T04:00:00.000Z",
        companionEndAt: "2026-04-02T12:00:00.000Z",
        companionSyncVersion: input.syncVersion,
        recovery_readiness_score: input.recoveryScore,
        sourceProviderSlug: "apple_health_kit",
        sourceType: "companion-whoop-metadata-unverified",
      }],
      activity: [{
        id: WORKOUT_STRAIN_RECORD_ID,
        date: "2026-04-02T17:45:00.000Z",
        companionStartAt: "2026-04-02T17:00:00.000Z",
        companionEndAt: "2026-04-02T17:45:00.000Z",
        companionSyncVersion: input.syncVersion,
        workout_strain: input.workoutStrain,
        sourceProviderSlug: "apple_health_kit",
        sourceType: "companion-whoop-metadata-unverified",
      }],
    },
    timeseries: {},
  };
}

test("Junction companion health metadata normalizes into recovery and workout-strain observations without phantom sessions", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    snapshot: buildSnapshot({
      importedAt: "2026-04-03T00:00:00.000Z",
      recoveryScore: 72,
      syncVersion: 1,
      workoutStrain: 11.3,
    }),
  });

  const recovery = payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "recovery-score"
  );
  const workoutStrain = payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "workout-strain"
  );

  assert.equal(payload.events?.some((event) => event.kind === "sleep_session"), false);
  assert.equal(payload.events?.some((event) => event.kind === "activity_session"), false);
  assert.equal(recovery?.fields?.value, 72);
  assert.equal(recovery?.fields?.unit, "%");
  assert.equal(recovery?.dataOrigin?.aggregatorProvider, "junction");
  assert.equal(recovery?.dataOrigin?.sourceProviderSlug, "apple-health-kit");
  assert.equal(recovery?.dataOrigin?.sourceType, "companion-whoop-metadata-unverified");
  assert.equal(recovery?.externalRef?.resourceType, "junction-apple-health-kit-sleep");
  assert.equal(workoutStrain?.fields?.value, 11.3);
  assert.equal(workoutStrain?.fields?.unit, "score");
  assert.equal(workoutStrain?.fields?.observationGrain, "summary");
  assert.equal(workoutStrain?.dataOrigin?.aggregatorProvider, "junction");
  assert.equal(workoutStrain?.dataOrigin?.sourceProviderSlug, "apple-health-kit");
  assert.equal(workoutStrain?.dataOrigin?.sourceType, "companion-whoop-metadata-unverified");
  assert.equal(workoutStrain?.externalRef?.resourceType, "junction-apple-health-kit-activity");
  assert.equal(workoutStrain?.externalRef?.facet, "workout-strain");
});

test("Junction companion workout strain coexists with the provider workout as one session plus one observation", async () => {
  const baseSnapshot = buildSnapshot({
    importedAt: "2026-04-03T00:00:00.000Z",
    recoveryScore: 72,
    syncVersion: 1,
    workoutStrain: 11.3,
  });
  const snapshot = {
    ...baseSnapshot,
    summaries: {
      ...baseSnapshot.summaries,
      workouts: [{
        id: "junction-provider-workout-id",
        start: "2026-04-02T17:00:00.000Z",
        end: "2026-04-02T17:45:00.000Z",
        sourceProviderSlug: "whoop",
        sourceType: "apple-health-kit",
      }],
    },
  };

  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    snapshot,
  });
  const sessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  const workoutStrain = payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "workout-strain"
  );

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.externalRef?.resourceType, "junction-whoop-workouts");
  assert.equal(workoutStrain?.fields?.value, 11.3);
  assert.equal(workoutStrain?.externalRef?.resourceType, "junction-apple-health-kit-activity");
});

test("Junction companion health metadata replays exactly and updates the same canonical event spines", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-junction-companion-health-metadata-"));
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-01T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const importSnapshot = (input: {
      importedAt: string;
      recoveryScore: number;
      syncVersion: number;
      workoutStrain: number;
    }) => importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        snapshot: buildSnapshot(input),
        vaultRoot,
      },
      { corePort: coreRuntime },
    );

    const first = await importSnapshot({
      importedAt: "2026-04-03T00:00:00.000Z",
      recoveryScore: 72,
      syncVersion: 1,
      workoutStrain: 11.3,
    });
    const replay = await importSnapshot({
      importedAt: "2026-04-03T01:00:00.000Z",
      recoveryScore: 72,
      syncVersion: 1,
      workoutStrain: 11.3,
    });
    const update = await importSnapshot({
      importedAt: "2026-04-03T02:00:00.000Z",
      recoveryScore: 78,
      syncVersion: 2,
      workoutStrain: 12.1,
    });

    const findRecovery = (result: typeof first) => result.events.find((event) =>
      event.kind === "observation" && event.metric === "recovery-score"
    );
    const findWorkoutStrain = (result: typeof first) => result.events.find((event) =>
      event.kind === "observation" && event.metric === "workout-strain"
    );
    const firstRecovery = findRecovery(first);
    const firstWorkoutStrain = findWorkoutStrain(first);
    const replayRecovery = findRecovery(replay);
    const replayWorkoutStrain = findWorkoutStrain(replay);
    const updatedRecovery = findRecovery(update);
    const updatedWorkoutStrain = findWorkoutStrain(update);

    assert.ok(firstRecovery);
    assert.ok(firstWorkoutStrain);
    assert.equal(replayRecovery?.id, firstRecovery.id);
    assert.equal(replayWorkoutStrain?.id, firstWorkoutStrain.id);
    assert.equal(updatedRecovery?.id, firstRecovery.id);
    assert.equal(updatedWorkoutStrain?.id, firstWorkoutStrain.id);
    assert.equal(updatedRecovery?.lifecycle?.revision, 2);
    assert.equal(updatedWorkoutStrain?.lifecycle?.revision, 2);
    assert.equal(
      updatedRecovery?.kind === "observation" ? updatedRecovery.value : undefined,
      78,
    );
    assert.equal(
      updatedWorkoutStrain?.kind === "observation" ? updatedWorkoutStrain.value : undefined,
      12.1,
    );

    const eventPaths = [...new Set([
      ...first.eventShardPaths,
      ...replay.eventShardPaths,
      ...update.eventShardPaths,
    ])];
    const storedEvents = (
      await Promise.all(eventPaths.map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ))
    ).flat();
    assert.equal(storedEvents.length, 4, "exact replay must append nothing; update adds two revisions");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
