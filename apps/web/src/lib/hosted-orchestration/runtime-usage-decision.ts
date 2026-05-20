import type {
  HostedAiUsageAllowDecision,
} from "@murphai/hosted-execution/runtime-control";

import {
  resolveHostedAiUsageGate,
} from "../hosted-execution/usage-allowance";
import {
  createHostedAiUsageAllowDecision,
} from "../hosted-execution/usage-gate-allow-decision";

const HOSTED_RUNTIME_USAGE_GATE_UNAVAILABLE_RETRY_MS = 30_000;

export type HostedRuntimeUsageGateCheck =
  | { status: "allowed" }
  | { status: "denied" }
  | { retryAt: string; status: "unavailable" };

export type HostedRuntimeUsageAllowDecisionResponse =
  | {
      aiUsageAllowDecision: HostedAiUsageAllowDecision;
      kind: "allowed";
    }
  | {
      kind: "blocked";
      reason: "ai_usage_denied" | "ai_usage_gate_unavailable";
      retryAt: string | null;
    };

export async function resolveHostedRuntimeAiUsageDemandGate(input: {
  now?: Date | string;
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);

  try {
    const decision = await resolveHostedAiUsageGate({
      memberId: input.userId,
      now,
    });

    if (!decision.allowed) {
      return { status: "denied" };
    }

    return { status: "allowed" };
  } catch {
    return {
      retryAt: buildHostedRuntimeUsageGateUnavailableRetryAt(now),
      status: "unavailable",
    };
  }
}

export async function createHostedRuntimeUsageAllowDecisionResponse(input: {
  now?: Date | string;
  userId: string;
}): Promise<HostedRuntimeUsageAllowDecisionResponse> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);
  const gate = await resolveHostedRuntimeAiUsageDemandGate({
    now,
    userId: input.userId,
  });

  if (gate.status === "denied") {
    return {
      kind: "blocked",
      reason: "ai_usage_denied",
      retryAt: null,
    };
  }

  if (gate.status === "unavailable") {
    return {
      kind: "blocked",
      reason: "ai_usage_gate_unavailable",
      retryAt: gate.retryAt,
    };
  }

  const aiUsageAllowDecision = await createHostedAiUsageAllowDecision({
    memberId: input.userId,
    now,
  });

  if (!aiUsageAllowDecision) {
    return {
      kind: "blocked",
      reason: "ai_usage_gate_unavailable",
      retryAt: buildHostedRuntimeUsageGateUnavailableRetryAt(now),
    };
  }

  return {
    aiUsageAllowDecision,
    kind: "allowed",
  };
}

function buildHostedRuntimeUsageGateUnavailableRetryAt(now: Date): string {
  return new Date(
    now.getTime() + HOSTED_RUNTIME_USAGE_GATE_UNAVAILABLE_RETRY_MS,
  ).toISOString();
}

function normalizeHostedRuntimeUsageDecisionDate(value: Date | string | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}
