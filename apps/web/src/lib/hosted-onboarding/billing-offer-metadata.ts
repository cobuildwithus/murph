import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  type HostedBillingPlanCode,
} from "./billing-plans";
import type { HostedPulseTrialStartSource } from "./pulse-trial-start-source";

type HostedBillingOfferMetadataInput = {
  billingPlanCode: HostedBillingPlanCode;
  memberId: string;
} & (
  | {
      checkoutOffer: typeof HOSTED_PULSE_TRIAL_OFFER;
      pulseTrialStartSource: HostedPulseTrialStartSource;
    }
  | {
      checkoutOffer: typeof HOSTED_STANDARD_CHECKOUT_OFFER;
      pulseTrialStartSource?: never;
    }
);

export function buildHostedBillingOfferMetadata(
  input: HostedBillingOfferMetadataInput,
): Record<string, string> {
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
    pulseTrialStartSource: input.pulseTrialStartSource,
    trialDurationDays: HOSTED_PULSE_TRIAL_DAYS.toString(),
    trialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
    trialUsageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString(),
  };
}
