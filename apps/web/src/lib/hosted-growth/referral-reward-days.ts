import type {
  HostedUsageReferralPolicyCode,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
} from "./signup-referral-policy";
import {
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
} from "./usage-referral-policy";

const LOW_REWARD_USD_MICROS = 2_000_000n;
const LOW_REWARD_USAGE_DAYS = 10;
const HIGH_REWARD_USD_MICROS = 3_500_000n;
const HIGH_REWARD_USAGE_DAYS = 14;

// These versioned product-display anchors are not calendar entitlements. Both
// persisted referral policy families use this one conversion so equal granted
// capacity always yields equal estimated days, regardless of how it was earned.
export function computeHostedReferralRewardUsageDays(input: {
  policyCode: HostedUsageReferralPolicyCode;
  policyVersion: string;
  rewardUsdMicros: bigint;
}): number {
  assertSupportedUsageDayBasis(input);

  if (input.rewardUsdMicros <= LOW_REWARD_USD_MICROS) {
    return roundUsageDays({
      denominator: LOW_REWARD_USD_MICROS,
      numerator:
        input.rewardUsdMicros * BigInt(LOW_REWARD_USAGE_DAYS),
    });
  }

  if (input.rewardUsdMicros <= HIGH_REWARD_USD_MICROS) {
    return LOW_REWARD_USAGE_DAYS + roundUsageDays({
      denominator: HIGH_REWARD_USD_MICROS - LOW_REWARD_USD_MICROS,
      numerator:
        (input.rewardUsdMicros - LOW_REWARD_USD_MICROS)
        * BigInt(HIGH_REWARD_USAGE_DAYS - LOW_REWARD_USAGE_DAYS),
    });
  }

  return roundUsageDays({
    denominator: HIGH_REWARD_USD_MICROS,
    numerator:
      input.rewardUsdMicros * BigInt(HIGH_REWARD_USAGE_DAYS),
  });
}

function assertSupportedUsageDayBasis(input: {
  policyCode: HostedUsageReferralPolicyCode;
  policyVersion: string;
}): void {
  const isSignupBasis =
    input.policyVersion === HOSTED_SIGNUP_REFERRAL_POLICY_VERSION
    && input.policyCode === "new_person_activation_v1";
  const isConversationalBasis =
    input.policyVersion === HOSTED_USAGE_REFERRAL_POLICY_VERSION
    && (
      input.policyCode === "active_group_v1"
      || input.policyCode === "new_person_activation_v1"
    );

  if (!isSignupBasis && !isConversationalBasis) {
    throw new TypeError("Unsupported referral reward usage-day basis.");
  }
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
