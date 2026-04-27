import type { HostedRunnerNudgeResult } from "@murphai/hosted-execution/runtime-control";

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
