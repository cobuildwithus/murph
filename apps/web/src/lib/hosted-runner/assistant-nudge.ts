import type { HostedAiUsageAllowDecision } from "@murphai/hosted-execution/runtime-control";

import { resolveHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { createHostedAiUsageAllowDecision } from "../hosted-execution/usage-gate-allow-decision";
import {
  nudgeHostedRunnerUserBestEffortResult,
  type HostedRunnerUserNudgeBestEffortResult,
} from "./control";

export interface HostedAssistantRunnerUserNudgeBestEffortResult
  extends HostedRunnerUserNudgeBestEffortResult {
  usageGateDenied: boolean;
}

type HostedAssistantRunnerNudgeUsageGateDecision =
  | HostedAiUsageAllowDecision
  | "denied"
  | "unavailable"
  | null;

export async function nudgeHostedAssistantRunnerUserBestEffortResult(input: {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedAssistantRunnerUserNudgeBestEffortResult> {
  const aiUsageAllowDecision = input.aiUsageAllowDecision
    ?? await createAllowedHostedAssistantRunnerNudgeDecision({
      userId: input.userId,
    });

  if (aiUsageAllowDecision === "denied") {
    return {
      accepted: false,
      alarmScheduled: null,
      configured: true,
      errorCode: "AI_USAGE_GATE_DENIED",
      immediateDriveStarted: null,
      inFlight: null,
      kind: null,
      nextAlarmAtPresent: null,
      usageGateDenied: true,
    };
  }

  if (aiUsageAllowDecision === "unavailable") {
    return {
      accepted: false,
      alarmScheduled: null,
      configured: true,
      errorCode: "AI_USAGE_GATE_UNAVAILABLE",
      immediateDriveStarted: null,
      inFlight: null,
      kind: null,
      nextAlarmAtPresent: null,
      usageGateDenied: false,
    };
  }

  return {
    ...await nudgeHostedRunnerUserBestEffortResult({
      ...(aiUsageAllowDecision ? { aiUsageAllowDecision } : {}),
      context: input.context,
      timeoutMs: input.timeoutMs,
      userId: input.userId,
    }),
    usageGateDenied: false,
  };
}

async function createAllowedHostedAssistantRunnerNudgeDecision(input: {
  userId: string;
}): Promise<HostedAssistantRunnerNudgeUsageGateDecision> {
  try {
    const gate = await resolveHostedAiUsageGate({
      memberId: input.userId,
    });
    if (!gate.allowed) {
      return "denied";
    }
    return await createHostedAiUsageAllowDecision({
      memberId: input.userId,
    });
  } catch (error) {
    console.warn("Hosted assistant runner nudge usage gate check failed.", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return "unavailable";
  }
}
