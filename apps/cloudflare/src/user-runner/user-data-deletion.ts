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
  hostedRunnerSecretsObjectKey,
  hostedWorkspaceSnapshotUserPrefix,
} from "../storage-paths.js";
import { safeCleanupErrorCode } from "./diagnostics.js";
import { deleteR2ObjectIfSupported, deleteR2ObjectsWithPrefix } from "./r2-delete.js";
import type { RunnerStateStore } from "./runner-state-store.js";
import type { DurableObjectStateLike } from "./types.js";

type HostedRunnerUserDataDeletionStateStore = Pick<
  RunnerStateStore,
  "assertStateForUser" | "clearWriteFenceForUserDeletion" | "deleteStateForUser"
>;

export interface HostedRunnerUserDataDeletionResult {
  deletedAt: string;
  durableObject: {
    alarmCleared: boolean;
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

export {
  HostedRunnerUserDataDeletionRunnerStillActiveError
    as HostedUserRunnerDataDeletionRunnerStillActiveError,
};

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
  const r2 = await deleteHostedUserR2DataBeforeStateDeletion(input);
  const stateDeletion = await input.stateStore.deleteStateForUser(input.userId);
  const deleteAlarm = input.state.storage.deleteAlarm;
  const alarmCleared = typeof deleteAlarm === "function";
  if (alarmCleared) {
    await deleteAlarm.call(input.state.storage);
  }

  emitHostedExecutionStructuredLog({
    component: "hosted.runner",
    details: {
      activeInvocationPreempted: runnerCleanup.activeInvocationPreempted,
      r2DeletedObjectCount: r2.deletedObjectCount,
      r2Supported: r2.supported,
      runnerContainerDestroyAttempted: runnerCleanup.runnerContainerDestroyAttempted,
      runnerContainerDestroyOk: runnerCleanup.runnerContainerDestroyOk,
      runnerStateDeleted: stateDeletion.deleted,
    },
    message: "Hosted runner user data deletion completed.",
    phase: "wake.running",
    userId: input.userId,
  });

  return {
    deletedAt: new Date().toISOString(),
    durableObject: {
      alarmCleared,
      stateDeleted: stateDeletion.deleted,
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
  const preemption = await input.stateStore.clearWriteFenceForUserDeletion(input.userId);
  const destroyed = await destroyHostedExecutionContainer({
    runnerContainerName: resolveHostedExecutionRunnerContainerName({
      source: input.runnerRuntimeEnvSource,
      userId: input.userId,
    }),
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
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunnerUserDataDeletionResult["r2"]> {
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
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunnerUserDataDeletionResult["r2"]> {
  const supportsObjectDeletion = Boolean(input.bucket.delete);
  const supportsPrefixDeletion = Boolean(input.bucket.delete && input.bucket.list);
  const userScopedSkipReasons: string[] = [];

  let deletedObjectCount = 0;
  if (supportsPrefixDeletion) {
    const prefixes = [
      await hostedBundleUserPrefix({ userId: input.userId }),
      await hostedArtifactUserPrefix({ userId: input.userId }),
      await hostedBrowserVaultReplicaUserPrefix({ userId: input.userId }),
      await hostedWorkspaceSnapshotUserPrefix({ userId: input.userId }),
    ];
    for (const prefix of prefixes) {
      deletedObjectCount += (await deleteR2ObjectsWithPrefix(input.bucket, prefix)).deletedCount;
    }

    deletedObjectCount += (await deleteR2ObjectIfSupported(
      input.bucket,
      await hostedRunnerSecretsObjectKey({ userId: input.userId }),
    )).deletedCount;
    deletedObjectCount += (await deleteR2ObjectsWithPrefix(
      input.bucket,
      await hostedEmailRawMessageUserPrefix({ userId: input.userId }),
    )).deletedCount;
  } else {
    userScopedSkipReasons.push("R2PrefixDeletionUnsupported");
  }

  const skippedUserScopedPrefixes =
    !supportsPrefixDeletion;
  return {
    deletedObjectCount,
    skippedUserScopedPrefixes,
    supported: supportsObjectDeletion && supportsPrefixDeletion,
    userScopedSkipReason: skippedUserScopedPrefixes
      ? Array.from(new Set(userScopedSkipReasons)).join(",") || null
      : null,
  };
}
