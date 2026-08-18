import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  memberActionStatusV1Schema,
  type WorkoutSession,
  workoutSessionSchema,
} from "@murphai/contracts";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  deriveWorkoutActionBinding,
} from "@murphai/operator-config/workout-action-binding";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  addLiveWorkoutExercise,
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
    const actionId = randomUUID();
    const requestedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    expect(requestedAt).toMatch(/:\d{2}Z$/u);

    const submitResponse = await fetch(
      `${requireScenario().harness.webBaseUrl}/api/device-sync/companion/imessage-mini-app/member-actions`,
      {
        body: JSON.stringify({
          action: {
            expectedWorkout: {
              actionBinding: deriveWorkoutActionBinding(workout.id, workout.session),
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
    await requireScenario().waitForHostedCompletion(memberId);
    await requireScenario().assertHealthyHostedRun(memberId);
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
  await startLiveWorkout({
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
