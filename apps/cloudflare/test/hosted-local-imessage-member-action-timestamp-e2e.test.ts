import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  memberActionStatusV1Schema,
  type WorkoutSession,
  workoutSessionSchema,
} from "@murphai/contracts";
import {
  type HostedExecutionBundleRefState,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  deriveWorkoutActionBinding,
} from "@murphai/operator-config/workout-action-binding";
import {
  createHostedPortableWorkspaceManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  restoreHostedWorkspaceWorkingDelta,
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
  type HostedBundleArtifactRestoreInput,
} from "@murphai/runtime-state/node";
import {
  addLiveWorkoutExercise,
  setWorkoutUnitPreferences,
  showWorkoutUnitPreferences,
  startLiveWorkout,
} from "@murphai/vault-usecases/workouts";
import {
  createIntegratedVaultServices,
} from "@murphai/vault-usecases/vault-services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listHostedRuntimeLogsForTest,
  seedHostedLaunchConsentForTest,
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const runId = Date.now();
const memberId = `member_local_imessage_action_${runId}`;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride =
  process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Messages member-action timestamp e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-imessage-action-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted Messages member-action timestamp e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 180_000);

  it("accepts a no-fraction phone timestamp through the real mailbox and receipt path", async () => {
    await requireScenario().seedActiveHostedMember({ memberId });
    await seedHostedLaunchConsentForTest({
      environment: requireScenario().runtimeEnv,
      memberId,
    });
    const workout = await seedWorkoutCheckpoint();
    const credential = await requireScenario().issueHostedIMessageMiniAppCredential({
      memberId,
    });
    const actionBinding = deriveWorkoutActionBinding(workout.id, workout.session);
    const actionId = randomUUID();
    const requestedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    expect(requestedAt).toMatch(/:\d{2}Z$/u);

    const submitResponse = await fetch(
      `${requireScenario().harness.webBaseUrl}/api/device-sync/companion/imessage-mini-app/member-actions`,
      {
        body: JSON.stringify({
          action: {
            expectedWorkout: {
              actionBinding,
              exercises: [{
                name: "Push-ups",
                sets: [{ logged: false }],
              }],
            },
            kind: "workout.live.apply",
            mutations: [{
              exerciseName: "Push-ups",
              exercisePosition: 1,
              expectedResult: null,
              kind: "set.put",
              result: { kind: "reps", reps: 12 },
              setPosition: 1,
            }],
            version: 1,
            weightUnitPreference: "kg",
          },
          actionId,
          requestedAt,
          schemaVersion: 1,
        }),
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(submitResponse.status).toBe(202);
    await expect(submitResponse.json()).resolves.toMatchObject({
      accepted: true,
      actionId,
      duplicate: false,
      schemaVersion: 1,
    });

    const outcome = await waitForMemberActionOutcome({
      actionId,
      token: credential.token,
    });
    expect(outcome).toMatchObject({
      actionId,
      reason: null,
      schemaVersion: 1,
      status: "applied",
    });
    const appliedStatus = await requireScenario().waitForHostedCompletion(memberId);
    await requireScenario().assertHealthyHostedRun(memberId);

    const appliedWorkspace = await restoreSnapshotForStatus(
      appliedStatus,
      "applied",
    );
    try {
      const shown = await createIntegratedVaultServices().query.show({
        id: workout.id,
        requestId: null,
        vault: appliedWorkspace.vaultRoot,
      });
      const canonicalWorkout = workoutSessionSchema.parse(
        readRecord(shown.entity.data)?.workout,
      );
      expect(canonicalWorkout.exercises[0]?.sets[0]).toMatchObject({ reps: 12 });
      await expect(
        showWorkoutUnitPreferences(appliedWorkspace.vaultRoot),
      ).resolves.toMatchObject({
        unitPreferences: { weight: "kg" },
      });
    } finally {
      await rm(appliedWorkspace.workspaceRoot, { force: true, recursive: true });
    }

    const staleActionId = randomUUID();
    const staleResponse = await fetch(
      `${requireScenario().harness.webBaseUrl}/api/device-sync/companion/imessage-mini-app/member-actions`,
      {
        body: JSON.stringify({
          action: {
            expectedWorkout: {
              actionBinding,
              exercises: [{
                name: "Push-ups",
                sets: [{ logged: false }],
              }],
            },
            kind: "workout.live.apply",
            mutations: [{
              exerciseName: "Push-ups",
              exercisePosition: 1,
              expectedResult: null,
              kind: "set.put",
              result: { kind: "reps", reps: 15 },
              setPosition: 1,
            }],
            version: 1,
            weightUnitPreference: "lb",
          },
          actionId: staleActionId,
          requestedAt: new Date().toISOString(),
          schemaVersion: 1,
        }),
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    expect(staleResponse.status).toBe(202);
    const staleOutcome = await waitForMemberActionOutcome({
      actionId: staleActionId,
      token: credential.token,
    });
    expect(staleOutcome).toMatchObject({
      actionId: staleActionId,
      reason: "workout_changed",
      status: "rejected",
    });

    const rejectedStatus = await requireScenario().waitForHostedCompletion(memberId);
    const rejectedWorkspace = await restoreSnapshotForStatus(
      rejectedStatus,
      "rejected",
    );
    try {
      await expect(
        showWorkoutUnitPreferences(rejectedWorkspace.vaultRoot),
      ).resolves.toMatchObject({
        unitPreferences: { weight: "kg" },
      });
    } finally {
      await rm(rejectedWorkspace.workspaceRoot, { force: true, recursive: true });
    }
  }, 600_000);
});

async function seedWorkoutCheckpoint(): Promise<{
  id: string;
  session: WorkoutSession;
}> {
  const root = await mkdtemp(
    path.join(requireScenario().harness.persistDir, "member-action-vault-"),
  );
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });
  await createIntegratedVaultServices().core.init({
    requestId: `seed-member-action-${runId}`,
    timezone: "UTC",
    vault: vaultRoot,
  });
  await setWorkoutUnitPreferences({
    recordedAt: new Date().toISOString(),
    vault: vaultRoot,
    weight: "lb",
  });
  const started = await startLiveWorkout({
    name: "Card action fixture",
    startedAt: new Date().toISOString(),
    vault: vaultRoot,
  });
  const shown = await addLiveWorkoutExercise({
    mode: "bodyweight",
    name: "Push-ups",
    order: 1,
    setCount: 1,
    vault: vaultRoot,
    workoutId: started.eventId,
  });
  const workout = findWorkoutShowResult(shown);
  if (!workout) {
    throw new Error("The seeded workout did not return a canonical workout snapshot.");
  }

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef(hash),
    environment: requireScenario().runtimeEnv,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: { seededMemberActionFixture: true },
    snapshotRef: createSnapshotBundleRef(hash, snapshot.bundle.byteLength),
    userId: memberId,
  });
  expect(checkpoint.status).toBe("updated");

  const upload = await requireScenario().harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(memberId)}&sha256=${hash}`,
    {
      body: new Blob([new Uint8Array(snapshot.bundle)]),
      headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: memberId },
      method: "PUT",
    },
  );
  expect(upload.status).toBe(200);
  return workout;
}

function findWorkoutShowResult(
  value: unknown,
  depth = 0,
): { id: string; session: WorkoutSession } | null {
  if (depth > 5) return null;
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const workout = findWorkoutShowResult(entry, depth + 1);
      if (workout) return workout;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const entity = readRecord(record.entity);
  const data = readRecord(entity?.data);
  const parsedWorkout = workoutSessionSchema.safeParse(data?.workout);
  if (typeof entity?.id === "string" && parsedWorkout.success) {
    return { id: entity.id, session: parsedWorkout.data };
  }
  for (const child of Object.values(record)) {
    const workout = findWorkoutShowResult(child, depth + 1);
    if (workout) return workout;
  }
  return null;
}

async function waitForMemberActionOutcome(input: {
  actionId: string;
  token: string;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 180_000) {
    const response = await fetch(
      `${requireScenario().harness.webBaseUrl}/api/device-sync/companion/imessage-mini-app/member-actions/${input.actionId}`,
      {
        headers: { authorization: `Bearer ${input.token}` },
      },
    );
    expect(response.status).toBe(200);
    const status = memberActionStatusV1Schema.parse(await response.json());
    if (status.status !== "pending") return status;
    await sleep(1_000);
  }
  const runtimeLogs = await listHostedRuntimeLogsForTest({
    environment: requireScenario().runtimeEnv,
    limit: 1_500,
    userId: memberId,
  }).catch(() => []);
  const recordFailures = runtimeLogs
    .filter((entry) =>
      entry.eventCode === "mailbox.system_processed"
      && entry.level === "warn"
    )
    .slice(-4)
    .map((entry) => ({
      at: entry.at,
      errorCode: entry.redactedJson?.errorCode ?? null,
      recordFailed: entry.redactedJson?.recordFailed ?? null,
      responseStatus: entry.redactedJson?.responseStatus ?? null,
      routeAction: entry.redactedJson?.routeAction ?? null,
      safeErrorMessage: entry.redactedJson?.safeErrorMessage ?? null,
      status: entry.redactedJson?.status ?? null,
      wakeKind: entry.redactedJson?.wakeKind ?? null,
    }));
  throw new Error(await requireScenario().buildFailureMessage(memberId, [
    "Timed out waiting for the Messages member-action receipt.",
    `member-action record failures: ${JSON.stringify(recordFailures)}`,
  ]));
}

async function restoreSnapshotForStatus(
  status: HostedRunnerStatusResponse,
  label: string,
): Promise<{
  vaultRoot: string;
  workspaceRoot: string;
}> {
  const snapshotRef = status.workspace?.snapshotRef ?? null;
  if (!snapshotRef) {
    throw new Error(`Hosted status ${label} did not include a workspace snapshot.`);
  }
  const baseRef = readHostedExecutionSnapshotBaseRef(snapshotRef);
  if (!baseRef) {
    throw new Error(`Hosted status ${label} did not include a base snapshot bundle.`);
  }

  const workspaceRoot = await mkdtemp(path.join(
    requireScenario().harness.persistDir,
    `restored-member-action-${label}-`,
  ));
  const artifactResolver = async (
    artifact: HostedBundleArtifactRestoreInput,
  ): Promise<Uint8Array> => await fetchHostedArtifact(artifact.ref.sha256);
  const baseBundle = await fetchHostedBundle(baseRef);
  const restored = await restoreHostedExecutionContext({
    artifactResolver,
    bundle: baseBundle,
    workspaceRoot,
  });
  const baseManifest = readHostedPortableWorkspaceManifestFromBundle(baseBundle)
    ?? createHostedPortableWorkspaceManifestFromBundle(baseBundle);
  const deltaRef = readHostedExecutionSnapshotDeltaRef(snapshotRef);
  if (deltaRef) {
    await restoreHostedWorkspaceWorkingDelta({
      artifactResolver,
      baseManifest,
      baseSnapshotHash: baseRef.hash,
      bundle: await fetchHostedBundle(deltaRef),
      roots: {
        "operator-home": restored.operatorHomeRoot,
        vault: restored.vaultRoot,
      },
      shouldRestoreArtifact: () => true,
    });
  }
  const hotRef = readHostedExecutionSnapshotHotRef(snapshotRef);
  if (hotRef) {
    await restoreHostedBundleRoots({
      artifactResolver,
      bytes: await fetchHostedBundle(hotRef),
      expectedKind: "vault",
      roots: {
        "operator-home": restored.operatorHomeRoot,
        vault: restored.vaultRoot,
      },
    });
  }
  return { vaultRoot: restored.vaultRoot, workspaceRoot };
}

async function fetchHostedBundle(
  ref: HostedExecutionBundleRefState,
): Promise<Uint8Array> {
  if (!ref) {
    throw new Error("Expected hosted bundle ref.");
  }
  const search = new URLSearchParams({
    key: ref.key,
    sha256: ref.hash,
    size: String(ref.size),
    userId: memberId,
  });
  return fetchHostedArtifact(search);
}

async function fetchHostedArtifact(
  input: string | URLSearchParams,
): Promise<Uint8Array> {
  const search = typeof input === "string"
    ? new URLSearchParams({ sha256: input, userId: memberId })
    : input;
  const response = await requireScenario().harness.request(
    `/__test/artifacts?${search.toString()}`,
    {
      headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: memberId },
      method: "GET",
    },
  );
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function createSnapshotBundleRef(
  hash: string,
  size: number,
): HostedExecutionSnapshotRef {
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size,
    updatedAt: new Date().toISOString(),
  };
}

function createBrowserVaultReplicaRef(
  sourceBundleHash: string,
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `member-action-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:member-action",
    objectKey: `browser-vault/member-action-${sourceBundleHash.slice(0, 32)}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:member-action",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) throw new Error("Hosted local full-stack scenario was not initialized.");
  return scenario;
}
