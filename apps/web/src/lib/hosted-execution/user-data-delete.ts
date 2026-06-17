import type { CloudflareHostedControlUserDataDeletionResult } from "@murphai/cloudflare-hosted-control/client";

import { readHostedExecutionControlClientIfConfigured } from "./control";
import {
  describeHostedExecutionSafeLogErrorCode,
  formatHostedExecutionSafeLogErrorDetails,
} from "./logging";

export interface HostedRunnerUserDataDeletionBestEffortResult {
  alarmCleared: boolean | null;
  configured: boolean;
  deleted: boolean;
  errorCode: string | null;
  r2DeletedObjectCount: number | null;
  r2SkippedUserScopedPrefixes: boolean | null;
  r2Supported: boolean | null;
  r2UserScopedSkipReason: string | null;
  runnerStateDeleted: boolean | null;
}

export async function deleteHostedRunnerUserData(input: {
  timeoutMs?: number;
  userId: string;
}): Promise<CloudflareHostedControlUserDataDeletionResult | null> {
  const client = readHostedExecutionControlClientIfConfigured(input.timeoutMs);

  if (!client) {
    return null;
  }

  return await client.deleteUserData(input.userId);
}

export async function deleteHostedRunnerUserDataBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRunnerUserDataDeletionBestEffortResult> {
  try {
    const result = await deleteHostedRunnerUserData(input);
    return result
      ? {
          alarmCleared: result.durableObject.alarmCleared,
          configured: true,
          deleted: result.durableObject.stateDeleted
            && result.durableObject.alarmCleared
            && result.r2.supported
            && !result.r2.skippedUserScopedPrefixes,
          errorCode: null,
          r2DeletedObjectCount: result.r2.deletedObjectCount,
          r2SkippedUserScopedPrefixes: result.r2.skippedUserScopedPrefixes,
          r2Supported: result.r2.supported,
          r2UserScopedSkipReason: result.r2.userScopedSkipReason,
          runnerStateDeleted: result.durableObject.stateDeleted,
        }
      : {
          alarmCleared: null,
          configured: false,
          deleted: false,
          errorCode: null,
          r2DeletedObjectCount: null,
          r2SkippedUserScopedPrefixes: null,
          r2Supported: null,
          r2UserScopedSkipReason: null,
          runnerStateDeleted: null,
        };
  } catch (error) {
    const errorCode = describeHostedExecutionSafeLogErrorCode(error);
    const contextPresent = typeof input.context === "string" && input.context.trim().length > 0;

    console.error("Hosted runner user-data deletion failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, { code: errorCode }),
      contextPresent,
    });
    return {
      alarmCleared: null,
      configured: true,
      deleted: false,
      errorCode,
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      r2Supported: null,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: null,
    };
  }
}
