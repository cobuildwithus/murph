import type {
  HostedUsageReferralPolicyCode,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
} from "./signup-referral-policy";
import {
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
} from "./usage-referral-policy";

interface HostedReferralRewardDayBasis {
  baselineRewardUsdMicros: bigint;
  baselineUsageDays: number;
}

const HOSTED_REFERRAL_REWARD_DAY_BASES: Readonly<Record<
  string,
  Readonly<
    Partial<Record<HostedUsageReferralPolicyCode, HostedReferralRewardDayBasis>>
  >
>> = {
  [HOSTED_SIGNUP_REFERRAL_POLICY_VERSION]: {
    new_person_activation_v1: {
      baselineRewardUsdMicros: 2_000_000n,
      baselineUsageDays: 10,
    },
  },
  [HOSTED_USAGE_REFERRAL_POLICY_VERSION]: {
    active_group_v1: {
      baselineRewardUsdMicros: 3_500_000n,
      baselineUsageDays: 14,
    },
    new_person_activation_v1: {
      baselineRewardUsdMicros: 2_000_000n,
      baselineUsageDays: 10,
    },
  },
};

// These are versioned product-display baselines, not calendar entitlements.
// Keep prior entries when a policy changes so persisted receipts retain the
// estimate that belonged to the policy under which they were created.

export function computeHostedReferralRewardUsageDays(input: {
  policyCode: HostedUsageReferralPolicyCode;
  policyVersion: string;
  rewardUsdMicros: bigint;
}): number {
  const versionBasis = HOSTED_REFERRAL_REWARD_DAY_BASES[input.policyVersion];
  const basis = versionBasis?.[input.policyCode];
  if (!basis) {
    throw new TypeError("Unsupported referral reward usage-day basis.");
  }
  const roundedDays = (
    input.rewardUsdMicros * BigInt(basis.baselineUsageDays)
    + basis.baselineRewardUsdMicros / 2n
  ) / basis.baselineRewardUsdMicros;
  return Number(roundedDays);
}

export function formatHostedReferralRewardUsageDays(input: {
  policyCode: HostedUsageReferralPolicyCode;
  policyVersion: string;
  rewardUsdMicros: bigint;
  sentenceCase?: boolean;
}): string {
  const days = computeHostedReferralRewardUsageDays(input);
  const prefix = input.sentenceCase === true ? "About" : "about";
  const unit = days === 1 ? "day" : "days";
  return `${prefix} ${days} more ${unit} of Murph usage`;
}
