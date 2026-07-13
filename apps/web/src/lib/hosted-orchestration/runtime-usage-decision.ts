import {
  readHostedRuntimeAiAccessDecision,
  type HostedRuntimeAiAccessDecision,
} from "../hosted-onboarding/member-access";
import {
  hostedMailboxSystemItemKindNeedsAiUsageGate,
} from "../hosted-mailbox/ai-usage-gate";

export type HostedRuntimeUsageGateCheck =
  | { status: "allowed" }
  | {
    decision: Extract<HostedRuntimeAiAccessDecision, { allowed: false }>;
    status: "denied";
  };

export async function resolveHostedRuntimeAiUsageGate(input: {
  // Retained so reconciliation can distinguish side-effecting workflow reads
  // from status reads. Admission itself is always a write-free access read.
  mode: "mutating" | "read_first" | "read_only";
  now?: Date | string;
  prisma?: Parameters<typeof readHostedRuntimeAiAccessDecision>[0]["prisma"];
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);
  const decision = await readHostedRuntimeAiAccessDecision({
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

  return { status: "allowed" };
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
