import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "../bundle-store.js";
import { hostedEmailRawMessageUserPrefix } from "../hosted-email.ts";

import {
  hostedArtifactUserPrefix,
  hostedBrowserVaultReplicaUserPrefix,
  hostedBundleUserPrefix,
  hostedEnvironmentVoiceUserPrefix,
  hostedMediaUserPrefix,
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

class HostedRunnerUserDataDeletionR2CleanupFailedError extends Error {
  constructor() {
    super("Hosted runner R2 cleanup failed before user data deletion.");
    this.name = "HostedRunnerUserDataDeletionR2CleanupFailedError";
  }
}

export async function deleteHostedUserR2DataBeforeStateDeletion(input: {
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedUserR2DataDeletionResult> {
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
}): Promise<HostedUserR2DataDeletionResult> {
  const prefixes = [
    await hostedBundleUserPrefix({ userId: input.userId }),
    await hostedArtifactUserPrefix({ userId: input.userId }),
    await hostedBrowserVaultReplicaUserPrefix({ userId: input.userId }),
    await hostedEnvironmentVoiceUserPrefix({ userId: input.userId }),
    await hostedMediaUserPrefix({ userId: input.userId }),
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
  // state deletion and leaves the whole operation retryable.
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

interface HostedUserR2DataDeletionResult {
  deletedObjectCount: number;
  skippedUserScopedPrefixes: boolean;
  supported: boolean;
  userScopedSkipReason: string | null;
}
