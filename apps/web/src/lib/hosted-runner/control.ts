import type { HostedRunnerNudgeResult } from "@murphai/hosted-execution/runtime-control";
import type { CloudflareHostedControlUserDataDeletionResult } from "@murphai/cloudflare-hosted-control/client";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { formatHostedExecutionSafeLogError } from "../hosted-execution/logging";

export interface HostedRunnerUserNudgeBestEffortResult {
  accepted: boolean;
  alarmScheduled: boolean | null;
  alreadyRunning: boolean | null;
  configured: boolean;
  errorCode: string | null;
  inFlight: boolean | null;
  nextAlarmAtPresent: boolean | null;
}

export interface HostedRunnerUserDataDeletionBestEffortResult {
  alarmCleared: boolean | null;
  configured: boolean;
  deleted: boolean;
  deletedRootKeyEnvelope: boolean | null;
  errorCode: string | null;
  r2DeletedObjectCount: number | null;
  r2SkippedUserScopedPrefixes: boolean | null;
  r2Supported: boolean | null;
  r2UserScopedSkipReason: string | null;
  runnerStateDeleted: boolean | null;
}

export async function nudgeHostedRunnerUser(input: {
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRunnerNudgeResult | null> {
  const client = readHostedExecutionControlClientIfConfigured(input.timeoutMs);

  if (!client) {
    return null;
  }

  return await client.nudgeUserRunner(input.userId);
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
            && !result.r2.skippedUserScopedPrefixes
            && result.r2.deletedRootKeyEnvelope,
          deletedRootKeyEnvelope: result.r2.deletedRootKeyEnvelope,
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
          deletedRootKeyEnvelope: null,
          errorCode: null,
          r2DeletedObjectCount: null,
          r2SkippedUserScopedPrefixes: null,
          r2Supported: null,
          r2UserScopedSkipReason: null,
          runnerStateDeleted: null,
        };
  } catch (error) {
    console.error(
      input.context
        ? `Hosted runner user-data deletion failed (${input.context}).`
        : "Hosted runner user-data deletion failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return {
      alarmCleared: null,
      configured: true,
      deleted: false,
      deletedRootKeyEnvelope: null,
      errorCode: error instanceof Error && error.name ? error.name : "UnknownError",
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      r2Supported: null,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: null,
    };
  }
}

export async function nudgeHostedRunnerUserBestEffortResult(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRunnerUserNudgeBestEffortResult> {
  try {
    const result = await nudgeHostedRunnerUser(input);
    return result
      ? {
        accepted: result.accepted,
        alarmScheduled: result.alarmScheduled,
        alreadyRunning: result.alreadyRunning,
        configured: true,
        errorCode: null,
        inFlight: result.inFlight,
        nextAlarmAtPresent: (result.nextAlarmAt ?? null) !== null,
      }
      : {
        accepted: false,
        alarmScheduled: null,
        alreadyRunning: null,
        configured: false,
        errorCode: null,
        inFlight: null,
        nextAlarmAtPresent: null,
      };
  } catch (error) {
    console.error(
      input.context
        ? `Hosted runner nudge failed (${input.context}).`
        : "Hosted runner nudge failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return {
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: true,
      errorCode: error instanceof Error && error.name ? error.name : "UnknownError",
      inFlight: null,
      nextAlarmAtPresent: null,
    };
  }
}

export async function nudgeHostedRunnerUserBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<boolean> {
  const result = await nudgeHostedRunnerUserBestEffortResult(input);
  return result.accepted;
}

export async function nudgeHostedRunnerBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<void> {
  await nudgeHostedRunnerUserBestEffort({
    context: input.context,
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });
}
