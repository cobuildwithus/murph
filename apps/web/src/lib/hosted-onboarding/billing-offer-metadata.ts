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
  checkoutOffer: HostedBillingCheckoutOffer;
  memberId: string;
}): Record<string, string> {
  if (input.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    return {
      billingPlanCode: input.billingPlanCode,
      checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
      memberId: input.memberId,
    };
  }

  return {
    billingPlanCode: "launch_monthly",
    checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    memberId: input.memberId,
    trialDurationDays: HOSTED_PULSE_TRIAL_DAYS.toString(),
    trialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
    trialUsageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString(),
  };
}
