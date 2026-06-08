import {
  readHostedAiUsageGate,
  resolveHostedAiUsageGate,
} from "../hosted-execution/usage-allowance";

const HOSTED_RUNTIME_USAGE_GATE_UNAVAILABLE_RETRY_MS = 30_000;

export type HostedRuntimeUsageGateCheck =
  | { status: "allowed" }
  | { status: "denied" }
  | { retryAt: string; status: "unavailable" };

export async function resolveHostedRuntimeAiUsageDemandGate(input: {
  mode?: "mutating" | "read_only";
  now?: Date | string;
  prisma?: Parameters<typeof resolveHostedAiUsageGate>[0]["prisma"];
  userId: string;
}): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);

  try {
    const readGate = input.mode === "read_only"
      ? readHostedAiUsageGate
      : resolveHostedAiUsageGate;
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
