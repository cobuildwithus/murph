import {
  checkHostedAiUsageGate,
  readHostedAiUsageGate,
  resolveHostedAiUsageGate,
  type HostedAiUsageGateDecision,
} from "../hosted-execution/usage-allowance";
import {
  hostedMailboxSystemItemKindNeedsAiUsageGate,
} from "../hosted-mailbox/ai-usage-gate";

export type HostedRuntimeUsageGateCheck =
  | {
    status: "allowed";
    usageAttribution: Extract<HostedAiUsageGateDecision, { allowed: true }>["usageAttribution"];
  }
  | {
    decision: Extract<HostedAiUsageGateDecision, { allowed: false }>;
    status: "denied";
  };

export async function resolveHostedRuntimeAiUsageGate(input: {
  // Mutating reconciliation materializes the admitted allowance period;
  // read-first and read-only callers preserve their existing write behavior.
  mode: "mutating" | "read_first" | "read_only";
  now?: Date | string;
  prisma?: Parameters<typeof resolveHostedAiUsageGate>[0]["prisma"];
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);
  const resolveGate = input.mode === "mutating"
    ? resolveHostedAiUsageGate
    : input.mode === "read_first"
      ? checkHostedAiUsageGate
      : readHostedAiUsageGate;
  const decision = await resolveGate({
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
