import {
  checkHostedAiUsageGate,
  readHostedAiUsageGate,
  resolveHostedAiUsageGate,
} from "../hosted-execution/usage-allowance";

const HOSTED_RUNTIME_USAGE_GATE_UNAVAILABLE_RETRY_MS = 30_000;

export type HostedRuntimeUsageGateCheck =
  | { status: "allowed" }
  | { status: "denied" }
  | { retryAt: string; status: "unavailable" };

export async function resolveHostedRuntimeAiUsageGate(input: {
  // "mutating" is the authoritative turn-admission decision and owns usage-
  // period bookkeeping. "read_first" is write-free on allow and confirms
  // denials with the mutating gate. "read_only" never writes and may miss
  // unmaterialized carryover; use it only for display surfaces.
  mode: "mutating" | "read_first" | "read_only";
  now?: Date | string;
  prisma?: Parameters<typeof resolveHostedAiUsageGate>[0]["prisma"];
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);

  try {
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

// AI-gated mailbox work: conversation-lane items and explicit manual runs.
// Shared by the hosted mailbox fetch/payload routes so "what counts as AI
// work" has one definition.
export function hostedRuntimeMailboxEntryNeedsAiUsageGate(entry: {
  kind: string;
  lane: string;
}): boolean {
  return entry.lane === "conversation" || entry.kind === "runtime.manual-requested";
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
