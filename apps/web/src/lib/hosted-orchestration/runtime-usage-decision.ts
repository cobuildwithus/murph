import {
  checkHostedAiUsageGate,
  readHostedAiUsageGate,
  resolveHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
} from "../hosted-execution/usage-allowance";
import { readHostedRuntimeAiAccessDecision } from "../hosted-onboarding/member-access";
import { HOSTED_STARTER_USAGE_GRANT_USD_MICROS } from "../hosted-onboarding/starter-usage";

export type HostedRuntimeUsageGateCheck =
  | {
    usageRunningLow?: true;
    status: "allowed";
  }
  | {
    status: "health_data_consent_withdrawn";
  }
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
  const access = await readHostedRuntimeAiAccessDecision({
    memberId: input.userId,
    now,
    prisma: input.prisma,
  });
  if (!access.allowed && access.reason === "health_data_consent_withdrawn") {
    return { status: "health_data_consent_withdrawn" };
  }

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

  return {
    ...(isHostedRuntimeUsageRunningLow(decision)
      ? { usageRunningLow: true as const }
      : {}),
    status: "allowed",
  };
}

function isHostedRuntimeUsageRunningLow(
  decision: Extract<HostedAiUsageGateDecisionWithSource, { allowed: true }>,
): boolean {
  const thresholdBasisUsdMicros = decision.allowanceSource === "direct_starter"
    ? HOSTED_STARTER_USAGE_GRANT_USD_MICROS
    : decision.limitUsdMicros;
  const lowThresholdUsdMicros = (thresholdBasisUsdMicros + 4n) / 5n;
  return decision.remainingUsdMicros > 0n
    && decision.remainingUsdMicros <= lowThresholdUsdMicros;
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
