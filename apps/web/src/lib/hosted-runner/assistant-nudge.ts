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
      alreadyRunning: null,
      configured: true,
      errorCode: "AI_USAGE_GATE_DENIED",
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
      usageGateDenied: true,
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
}): Promise<HostedAiUsageAllowDecision | "denied" | null> {
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
    return "denied";
  }
}
