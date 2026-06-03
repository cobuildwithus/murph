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
import { buildHostedRunnerMetadataOnlyErrorDetails, safeCleanupErrorCode } from "./diagnostics.js";
import { deleteR2ObjectIfSupported, deleteR2ObjectsWithPrefix } from "./r2-delete.js";
import type { RunnerStateStore } from "./runner-state-store.js";
import type { DurableObjectStateLike } from "./types.js";

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

export {
  HostedRunnerUserDataDeletionRunnerStillActiveError
    as HostedUserRunnerDataDeletionRunnerStillActiveError,
};

interface HostedRunnerUserDataDeletionServiceInput {
  bucket: R2BucketLike;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  state: DurableObjectStateLike;
  stateStore: RunnerStateStore;
}

export class UserDataDeletionService {
  constructor(private readonly input: HostedRunnerUserDataDeletionServiceInput) {}

  async delete(userId: string): Promise<HostedRunnerUserDataDeletionResult> {
    return await deleteHostedRunnerUserData({
      ...this.input,
      userId,
    });
  }
}

export async function deleteHostedRunnerUserData(input: HostedRunnerUserDataDeletionServiceInput & {
  userId: string;
}): Promise<HostedRunnerUserDataDeletionResult> {
  await input.stateStore.assertStateForUser(input.userId);
  const runnerCleanup = await stopRunnerBeforeUserDataDeletion(input);
  const r2 = await deleteHostedUserR2DataBestEffort(input);
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
  stateStore: RunnerStateStore;
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

async function deleteHostedUserR2DataBestEffort(input: {
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunnerUserDataDeletionResult["r2"]> {
  try {
    return await deleteHostedUserR2Data(input);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildHostedRunnerMetadataOnlyErrorDetails(error),
        r2Supported: false,
        userScopedSkipReason: safeCleanupErrorCode(error),
      },
      error,
      level: "warn",
      message: "Hosted runner R2 user data deletion failed; continuing Durable Object cleanup.",
      phase: "wake.running",
      userId: input.userId,
    });
    return {
      deletedObjectCount: 0,
      skippedUserScopedPrefixes: true,
      supported: false,
      userScopedSkipReason: safeCleanupErrorCode(error),
    };
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
