import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "../bundle-store.js";
import { hostedEmailRawMessageUserPrefix } from "../hosted-email.ts";
import {
  destroyHostedExecutionContainer,
  resolveHostedExecutionRunnerContainerName,
  type HostedExecutionContainerNamespaceLike,
} from "../runner-container.js";
import {
  hostedArtifactUserPrefix,
  hostedBrowserVaultReplicaUserPrefix,
  hostedBundleUserPrefix,
  hostedEnvironmentVoiceUserPrefix,
  hostedMealPhotoUserPrefix,
  hostedPrivateMediaUserPrefix,
  hostedRunnerSecretsObjectKey,
  hostedWorkspaceSnapshotUserPrefix,
} from "../storage-paths.js";
import { safeCleanupErrorCode } from "./diagnostics.js";
import {
  assertR2ObjectAbsent,
  assertR2PrefixEmpty,
  deleteR2ObjectRequired,
  deleteR2ObjectsWithPrefix,
  requireR2DeletionCapabilities,
} from "./r2-delete.js";
import { readActiveRuntimeRunnerContainerName } from "./runtime-container-wake.js";
import type { RunnerStateStore } from "./runner-state-store.js";
import type { DurableObjectStateLike } from "./types.js";
import {
  readHostedBrowserVaultReplicaPostStopDrainUntil,
  readHostedWorkspaceSnapshotR2PutDrainUntil,
} from "./workspace-snapshot-sessions.js";

type HostedRunnerUserDataDeletionStateStore = Pick<
  RunnerStateStore,
  "assertStateForUser" | "clearWriteFenceForUserControl" | "deleteStateForUser"
>;

export interface HostedRunnerUserDataDeletionCompletedResult {
  deletedAt: string;
  durableObject: {
    alarmCleared: boolean;
    deleteAllCompleted: boolean;
    stateDeleted: boolean;
  };
  ok: true;
  r2: {
    deletedObjectCount: number;
    skippedUserScopedPrefixes: boolean;
    supported: boolean;
    userScopedSkipReason: string | null;
  };
  userId: string;
}

export interface HostedRunnerUserDataDeletionPendingResult {
  ok: false;
  reason: "r2_upload_drain_pending";
  retryAfterSeconds: number;
  userId: string;
}

export type HostedRunnerUserDataDeletionResult =
  | HostedRunnerUserDataDeletionCompletedResult
  | HostedRunnerUserDataDeletionPendingResult;

export class HostedRunnerUserDataDeletionRunnerStillActiveError extends Error {
  constructor() {
    super("Hosted runner container cleanup failed before user data deletion.");
    this.name = "HostedRunnerUserDataDeletionRunnerStillActiveError";
  }
}

class HostedRunnerUserDataDeletionR2CleanupFailedError extends Error {
  constructor() {
    super("Hosted runner R2 cleanup failed before user data deletion.");
    this.name = "HostedRunnerUserDataDeletionR2CleanupFailedError";
  }
}

export interface HostedRunnerUserDataDeletionServiceInput {
  bucket: R2BucketLike;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  state: DurableObjectStateLike;
  stateStore: HostedRunnerUserDataDeletionStateStore;
}

export async function deleteHostedRunnerUserData(input: HostedRunnerUserDataDeletionServiceInput & {
  userId: string;
}): Promise<HostedRunnerUserDataDeletionResult> {
  await input.stateStore.assertStateForUser(input.userId);
  const runnerCleanup = await stopRunnerBeforeUserDataDeletion(input);
  const browserVaultDrainUntil = await readHostedBrowserVaultReplicaPostStopDrainUntil({
    state: input.state,
    userId: input.userId,
  });
  if (browserVaultDrainUntil !== null) {
    return {
      ok: false,
      reason: "r2_upload_drain_pending",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((Date.parse(browserVaultDrainUntil) - Date.now()) / 1000),
      ),
      userId: input.userId,
    };
  }
  const drainUntil = await readHostedWorkspaceSnapshotR2PutDrainUntil({
    state: input.state,
    userId: input.userId,
  });
  const drainUntilMs = drainUntil === null ? null : Date.parse(drainUntil);
  if (drainUntilMs !== null && drainUntilMs > Date.now()) {
    return {
      ok: false,
      reason: "r2_upload_drain_pending",
      retryAfterSeconds: Math.max(1, Math.ceil((drainUntilMs - Date.now()) / 1000)),
      userId: input.userId,
    };
  }
  const deleteAll = input.state.storage.deleteAll;
  if (typeof deleteAll !== "function") {
    throw new Error("Durable Object deleteAll is required before hosted user deletion can proceed.");
  }
  const r2 = await deleteHostedUserR2DataBeforeStateDeletion(input);
  const stateDeletion = await input.stateStore.deleteStateForUser(input.userId);
  if (!stateDeletion.deleted) {
    throw new Error("Hosted runner logical state was not deleted after R2 cleanup.");
  }
  const deleteAlarm = input.state.storage.deleteAlarm;
  if (typeof deleteAlarm === "function") {
    await deleteAlarm.call(input.state.storage);
  }
  await deleteAll.call(input.state.storage);
  // With this Worker's compatibility date, deleteAll also removes alarms.
  const alarmCleared = true;
  const deleteAllCompleted = true;
  const stateDeleted = true;

  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      activeInvocationPreempted: runnerCleanup.activeInvocationPreempted,
      r2DeletedObjectCount: r2.deletedObjectCount,
      r2Supported: r2.supported,
      runnerContainerDestroyAttempted: runnerCleanup.runnerContainerDestroyAttempted,
      runnerContainerDestroyOk: runnerCleanup.runnerContainerDestroyOk,
      runnerStateDeleted: stateDeleted,
    },
    message: "Hosted runner user data deletion completed.",
    phase: "wake.running",
    userId: input.userId,
  });

  return {
    deletedAt: new Date().toISOString(),
    durableObject: {
      alarmCleared,
      deleteAllCompleted,
      stateDeleted,
    },
    ok: true,
    r2,
    userId: input.userId,
  };
}

async function stopRunnerBeforeUserDataDeletion(input: {
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  stateStore: HostedRunnerUserDataDeletionStateStore;
  userId: string;
}): Promise<{
  activeInvocationPreempted: boolean;
  runnerContainerDestroyAttempted: boolean;
  runnerContainerDestroyOk: boolean;
}> {
  const preemption = await input.stateStore.clearWriteFenceForUserControl(input.userId);
  const runnerContainerName = preemption.runnerContainerName
    ? readActiveRuntimeRunnerContainerName({
      activeRuntime: {
        attemptId: preemption.attemptId ?? "user-data-deletion-stop",
        leaseGeneration: "0",
        userId: input.userId,
      },
      runnerContainerName: preemption.runnerContainerName,
      runnerRuntimeEnvSource: input.runnerRuntimeEnvSource,
    })
    : resolveHostedExecutionRunnerContainerName({
      source: input.runnerRuntimeEnvSource,
      userId: input.userId,
    });
  if (!runnerContainerName) {
    throw new HostedRunnerUserDataDeletionRunnerStillActiveError();
  }
  const destroyed = await destroyHostedExecutionContainer({
    runnerContainerName,
    runnerContainerNamespace: input.runnerContainerNamespace,
    userId: input.userId,
  });

  if (preemption.cleared) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        runnerContainerDestroyAttempted: destroyed.attempted,
        runnerContainerDestroyOk: destroyed.ok,
        workspaceAttemptId: preemption.attemptId,
      },
      level: destroyed.ok ? "info" : "warn",
      message: "Hosted runner cleared active write fence before user data deletion.",
      phase: "wake.running",
      userId: input.userId,
    });
  }

  if (!destroyed.ok) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        runnerContainerDestroyAttempted: destroyed.attempted,
        runnerContainerDestroyErrorCode: destroyed.errorCode,
        workspaceAttemptId: preemption.attemptId,
      },
      level: "error",
      message: "Hosted runner user data deletion blocked because runner container cleanup failed.",
      phase: "wake.running",
      userId: input.userId,
    });
    throw new HostedRunnerUserDataDeletionRunnerStillActiveError();
  }

  return {
    activeInvocationPreempted: preemption.cleared,
    runnerContainerDestroyAttempted: destroyed.attempted,
    runnerContainerDestroyOk: destroyed.ok,
  };
}

async function deleteHostedUserR2DataBeforeStateDeletion(input: {
  bucket: HostedRunnerUserDataDeletionServiceInput["bucket"];
  userId: string;
}): Promise<HostedRunnerUserDataDeletionCompletedResult["r2"]> {
  try {
    return await deleteHostedUserR2Data(input);
  } catch (error) {
    const r2CleanupErrorCode = safeCleanupErrorCode(error);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        r2CleanupErrorCode,
        r2CleanupFailed: true,
      },
      level: "error",
      message: "Hosted runner user data deletion blocked because R2 cleanup failed.",
      phase: "wake.running",
      userId: input.userId,
    });
    throw new HostedRunnerUserDataDeletionR2CleanupFailedError();
  }
}

async function deleteHostedUserR2Data(input: {
  bucket: HostedRunnerUserDataDeletionServiceInput["bucket"];
  userId: string;
}): Promise<HostedRunnerUserDataDeletionCompletedResult["r2"]> {
  const prefixes = [
    await hostedBundleUserPrefix({ userId: input.userId }),
    await hostedArtifactUserPrefix({ userId: input.userId }),
    await hostedBrowserVaultReplicaUserPrefix({ userId: input.userId }),
    await hostedEnvironmentVoiceUserPrefix({ userId: input.userId }),
    await hostedMealPhotoUserPrefix({ userId: input.userId }),
    await hostedPrivateMediaUserPrefix({ userId: input.userId }),
    await hostedWorkspaceSnapshotUserPrefix({ userId: input.userId }),
    await hostedEmailRawMessageUserPrefix({ userId: input.userId }),
  ];
  const fixedKey = await hostedRunnerSecretsObjectKey({ userId: input.userId });
  let deletedObjectCount = 0;
  requireR2DeletionCapabilities(input.bucket);
  for (const prefix of prefixes) {
    deletedObjectCount += (await deleteR2ObjectsWithPrefix(input.bucket, prefix)).deletedCount;
  }
  deletedObjectCount += (await deleteR2ObjectRequired(input.bucket, fixedKey)).deletedCount;

  // The write fence and the recorded direct-PUT drain deadline make these
  // stable-empty checks the final effect boundary. Any late object prevents
  // Durable Object state deletion and leaves the whole operation retryable.
  for (const prefix of prefixes) {
    await assertR2PrefixEmpty(input.bucket, prefix);
  }
  await assertR2ObjectAbsent(input.bucket, fixedKey);

  return {
    deletedObjectCount,
    skippedUserScopedPrefixes: false,
    supported: true,
    userScopedSkipReason: null,
  };
}
