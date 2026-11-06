import {
  checkHostedAiUsageGate,
  hostedAiUsageMemberSelect,
  readHostedAiUsageGate,
  resolveHostedAiUsageGate,
  type HostedAiUsageGateDecisionWithSource,
  type HostedAiUsageMemberState,
} from "../hosted-execution/usage-allowance";
import {
  readHostedRuntimeAiAccessDecision,
  hostedRuntimeAiMemberAccessSelect,
  type HostedRuntimeAiMemberAccessState,
} from "../hosted-onboarding/member-access";
import { HOSTED_STARTER_USAGE_GRANT_USD_MICROS } from "../hosted-onboarding/starter-usage";

import { getPrisma } from "../prisma";

// One request-local projection serves both access and read-only allowance.
// Mutating admission still re-reads allowance under its own beneficiary lock.
export const hostedRuntimeUsageMemberSelect = {
  ...hostedRuntimeAiMemberAccessSelect,
  ...hostedAiUsageMemberSelect,
  threadContainer: {
    select: {
      ...hostedRuntimeAiMemberAccessSelect.threadContainer.select,
      monthlyUsageLimitUsdMicros: true,
    },
  },
} as const;

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

  now?: Date | string;
  prisma?: Parameters<typeof resolveHostedAiUsageGate>[0]["prisma"];
  userId: string;
} & (
  | { mode: "mutating"; memberState?: never }
  | {
      mode: "read_first" | "read_only";
      // Fresh projection for this user and request only; never warm admission.
      memberState?: HostedAiUsageMemberState & HostedRuntimeAiMemberAccessState;
    }
)): Promise<HostedRuntimeUsageGateCheck> {
  const now = normalizeHostedRuntimeUsageDecisionDate(input.now);
  const prisma = input.prisma ?? getPrisma();
  const memberState = input.memberState ?? (input.mode === "mutating"
    ? undefined
    : await prisma.hostedMember.findUnique({
        select: hostedRuntimeUsageMemberSelect,
        where: { id: input.userId },
      }) ?? undefined);
  const access = await readHostedRuntimeAiAccessDecision({
    memberId: input.userId,
    ...(memberState
      ? { memberState }
      : {}),
    now,
    prisma,
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
    ...(memberState
      ? { memberState }
      : {}),
    now,
    prisma,
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
