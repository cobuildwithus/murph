import {
  checkHostedAiUsageGate,
  readHostedAiUsageGate,
  resolveHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
} from "../hosted-execution/usage-allowance";
import {
  hostedMailboxSystemItemKindNeedsAiUsageGate,
} from "../hosted-mailbox/ai-usage-gate";

export type HostedRuntimeUsageGateCheck =
  | { status: "allowed" }
  | {
    decision: Extract<HostedAiUsageGateDecisionWithSource, { allowed: false }>;
    status: "denied";
  };

export async function resolveHostedRuntimeAiUsageGate(input: {
  // "mutating" is authoritative turn admission and owns usage-period
  // bookkeeping. "read_first" stays write-free on allow and confirms denials
  // through that owner. "read_only" never writes and is for status surfaces.
  mode: "mutating" | "read_first" | "read_only";
  now?: Date | string;
  prisma?: Parameters<typeof resolveHostedAiUsageGate>[0]["prisma"];
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);
  const readGate = input.mode === "read_only"
    ? readHostedAiUsageGate
    : input.mode === "mutating"
      ? resolveHostedAiUsageGate
      : checkHostedAiUsageGate;
  const decision = await readGate({
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
