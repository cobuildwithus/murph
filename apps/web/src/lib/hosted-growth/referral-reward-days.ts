import type {
  HostedUsageReferralPolicyCode,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
} from "./signup-referral-policy";
import {
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
} from "./usage-referral-policy";

interface HostedReferralRewardUsageDayAnchor {
  rewardUsdMicros: bigint;
  usageDays: number;
}

const HOSTED_REFERRAL_REWARD_USAGE_DAY_GENERATIONS = {
  typical_usage_v1: [
    { rewardUsdMicros: 2_000_000n, usageDays: 10 },
    { rewardUsdMicros: 3_500_000n, usageDays: 14 },
  ],
} as const satisfies Readonly<Record<
  string,
  readonly HostedReferralRewardUsageDayAnchor[]
>>;

interface HostedReferralRewardUsageDayPolicyVersion {
  generation: keyof typeof HOSTED_REFERRAL_REWARD_USAGE_DAY_GENERATIONS;
  supportedPolicyCodes: readonly HostedUsageReferralPolicyCode[];
}

const HOSTED_REFERRAL_REWARD_USAGE_DAY_POLICY_VERSIONS: Readonly<Record<
  string,
  HostedReferralRewardUsageDayPolicyVersion
>> = {
  [HOSTED_SIGNUP_REFERRAL_POLICY_VERSION]: {
    generation: "typical_usage_v1",
    supportedPolicyCodes: ["new_person_activation_v1"],
  },
  [HOSTED_USAGE_REFERRAL_POLICY_VERSION]: {
    generation: "typical_usage_v1",
    supportedPolicyCodes: [
      "active_group_v1",
      "new_person_activation_v1",
    ],
  },
};

// These versioned product-display anchors are not calendar entitlements. Policy
// versions select a shared conversion generation so equal granted capacity
// always yields equal estimated days, regardless of how the reward was earned.
// Keep prior version entries when the display conversion changes.

export function computeHostedReferralRewardUsageDays(input: {
  policyCode: HostedUsageReferralPolicyCode;
  policyVersion: string;
  rewardUsdMicros: bigint;
}): number {
  const version = HOSTED_REFERRAL_REWARD_USAGE_DAY_POLICY_VERSIONS[
    input.policyVersion
  ];
  if (!version?.supportedPolicyCodes.includes(input.policyCode)) {
    throw new TypeError("Unsupported referral reward usage-day basis.");
  }
  const anchors = HOSTED_REFERRAL_REWARD_USAGE_DAY_GENERATIONS[
    version.generation
  ];
  const firstAnchor = anchors[0];
  const lastAnchor = anchors[anchors.length - 1];

  if (input.rewardUsdMicros <= firstAnchor.rewardUsdMicros) {
    return roundUsageDays({
      denominator: firstAnchor.rewardUsdMicros,
      numerator:
        input.rewardUsdMicros * BigInt(firstAnchor.usageDays),
    });
  }

  for (let index = 1; index < anchors.length; index += 1) {
    const lowerAnchor = anchors[index - 1];
    const upperAnchor = anchors[index];
    if (input.rewardUsdMicros <= upperAnchor.rewardUsdMicros) {
      return lowerAnchor.usageDays + roundUsageDays({
        denominator:
          upperAnchor.rewardUsdMicros - lowerAnchor.rewardUsdMicros,
        numerator:
          (input.rewardUsdMicros - lowerAnchor.rewardUsdMicros)
          * BigInt(upperAnchor.usageDays - lowerAnchor.usageDays),
      });
    }
  }

  return roundUsageDays({
    denominator: lastAnchor.rewardUsdMicros,
    numerator: input.rewardUsdMicros * BigInt(lastAnchor.usageDays),
  });
}

function roundUsageDays(input: {
  denominator: bigint;
  numerator: bigint;
}): number {
  return Number(
    (input.numerator + input.denominator / 2n) / input.denominator,
  );
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
