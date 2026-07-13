import {
  readHostedRuntimeAiAccessDecision,
  type HostedRuntimeAiAccessDecision,
} from "../hosted-onboarding/member-access";
import {
  hostedMailboxSystemItemKindNeedsAiUsageGate,
} from "../hosted-mailbox/ai-usage-gate";
import {
  readHostedAiUsageGate,
  resolveHostedAiUsageGate,
  type HostedAiUsageGateDecision,
} from "../hosted-execution/usage-allowance";

export type HostedRuntimeUsageGateCheck =
  | { status: "allowed" }
  | {
    decision: Extract<HostedRuntimeAiAccessDecision, { allowed: false }>;
    status: "denied";
  }
  | { retryAt: string; status: "unavailable" };

export async function resolveHostedRuntimeAiUsageGate(input: {
  access?: "accepted_conversation";
  acceptedConversationPeriodStart?: Date | string;
  // Reconciliation may materialize exact-period bookkeeping; status reads stay
  // write-free. Ordinary admission remains a write-free member-access read.
  mode: "mutating" | "read_first" | "read_only";
  now?: Date | string;
  prisma?: Parameters<typeof readHostedRuntimeAiAccessDecision>[0]["prisma"];
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);
  if (input.access === "accepted_conversation") {
    if (input.acceptedConversationPeriodStart === undefined) {
      return {
        retryAt: new Date(now.getTime() + 30_000).toISOString(),
        status: "unavailable",
      };
    }
    const acceptedDecision = await (
      input.mode === "mutating" ? resolveHostedAiUsageGate : readHostedAiUsageGate
    )({
      access: "accepted_conversation",
      acceptedConversationPeriodStart: input.acceptedConversationPeriodStart,
      memberId: input.userId,
      now,
      prisma: input.prisma,
    });
    return projectHostedAcceptedConversationUsageGate({
      decision: acceptedDecision,
      now,
    });
  }
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

function projectHostedAcceptedConversationUsageGate(input: {
  decision: HostedAiUsageGateDecision;
  now: Date;
}): HostedRuntimeUsageGateCheck {
  if (input.decision.allowed) {
    // Exhaustion is advisory. The exact accepted period still revalidates the
    // member and fails closed on suspension without reapplying current billing.
    return { status: "allowed" };
  }

  const userNotice = input.decision.userNotice?.code === "trial_conversion_pending"
    ? {
        code: "trial_conversion_pending" as const,
        message: input.decision.userNotice.message,
      }
    : null;
  return {
    decision: {
      allowed: false,
      reason: input.decision.reason,
      retryAfter: input.decision.retryAfter
        ?? new Date(input.now.getTime() + 15 * 60_000),
      userNotice,
    },
    status: "denied",
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
