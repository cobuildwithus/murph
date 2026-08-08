import {
  HOSTED_STANDARD_CHECKOUT_OFFER,
  type HostedBillingPlanCode,
} from "./billing-plans";

export function buildHostedBillingOfferMetadata(input: {
  billingPlanCode: HostedBillingPlanCode;
  memberId: string;
}): Record<string, string> {
  return {
    billingPlanCode: input.billingPlanCode,
    checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
    memberId: input.memberId,
  };
}
