import {
  readHostedAiUsageGate,
  type HostedAiUsageAdmissionGateDecision,
} from "../hosted-execution/usage-allowance";
import {
  hostedMailboxSystemItemKindNeedsAiUsageGate,
} from "../hosted-mailbox/ai-usage-gate";

export type HostedRuntimeUsageGateCheck =
  | {
    status: "allowed";
    usageAttribution: Extract<HostedAiUsageAdmissionGateDecision, { allowed: true }>["usageAttribution"];
  }
  | {
    decision: Extract<HostedAiUsageAdmissionGateDecision, { allowed: false }>;
    status: "denied";
  };

export async function resolveHostedRuntimeAiUsageGate(input: {
  // The mode remains part of the reconciliation contract, but admission is
  // always write-free. Spend accounting materializes the admitted period only
  // after usage exists.
  mode: "mutating" | "read_first" | "read_only";
  now?: Date | string;
  prisma?: Parameters<typeof readHostedAiUsageGate>[0]["prisma"];
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);
  const decision = await readHostedAiUsageGate({
    memberId: input.userId,
    now,
    prisma: input.prisma,
  });

  if (!decision.allowed) {
    return {
      decision,
      status: "denied",
    };
  }

  return {
    status: "allowed",
    usageAttribution: decision.usageAttribution,
  };
}

// AI-gated mailbox work: conversation-lane items and shared gated system kinds.
export function hostedRuntimeMailboxEntryNeedsAiUsageGate(entry: {
  kind: string;
  lane: string;
}): boolean {
  return entry.lane === "conversation" ||
    (
      entry.lane === "system" &&
      hostedMailboxSystemItemKindNeedsAiUsageGate(entry.kind)
    );
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
