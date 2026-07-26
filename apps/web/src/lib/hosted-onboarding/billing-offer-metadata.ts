import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  type HostedBillingCheckoutOffer,
  type HostedBillingPlanCode,
} from "./billing-plans";

export function buildHostedBillingOfferMetadata(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutAttemptId?: string;
  checkoutIntentHash?: string;
  checkoutOffer: HostedBillingCheckoutOffer;
  memberId: string;
}): Record<string, string> {
  const checkoutAttemptMetadata: Record<string, string> =
    input.checkoutAttemptId && input.checkoutIntentHash
    ? {
        checkoutAttemptId: input.checkoutAttemptId,
        checkoutIntentHash: input.checkoutIntentHash,
      }
    : {};

  if (input.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    return {
      billingPlanCode: input.billingPlanCode,
      ...checkoutAttemptMetadata,
      checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
      memberId: input.memberId,
    };
  }

  return {
    billingPlanCode: "launch_monthly",
    ...checkoutAttemptMetadata,
    checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    memberId: input.memberId,
    trialDurationDays: HOSTED_PULSE_TRIAL_DAYS.toString(),
    trialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
    trialUsageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString(),
  };
}
