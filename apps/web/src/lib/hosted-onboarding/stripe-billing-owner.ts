import {
  lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId,
} from "./family-plan";
import {
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
} from "./hosted-member-billing-store";
import type { HostedOnboardingReadClient } from "./shared";

export type HostedStripeBillingOwner =
  | {
      groupId: string;
      kind: "family";
      lockMemberId: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string;
    }
  | {
      kind: "member";
      lockMemberId: string;
      memberId: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string;
    };

export async function resolveHostedStripeBillingOwner(input: {
  prisma: HostedOnboardingReadClient;
  stripeSubscriptionId: string;
}): Promise<HostedStripeBillingOwner | null> {
  const [memberLookup, familyLookup] = await Promise.all([
    lookupHostedMemberStripeBillingRefByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.stripeSubscriptionId,
    }),
    lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.stripeSubscriptionId,
    }),
  ]);
  if (memberLookup && familyLookup) {
    throw new Error(
      "Stripe subscription matched both member and Family billing owners.",
    );
  }
  if (memberLookup) {
    return {
      kind: "member",
      lockMemberId: memberLookup.core.id,
      memberId: memberLookup.core.id,
      stripeCustomerId: memberLookup.billingRef.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    };
  }
  if (familyLookup) {
    return {
      groupId: familyLookup.group.id,
      kind: "family",
      lockMemberId: familyLookup.group.ownerMemberId,
      stripeCustomerId: familyLookup.billingRef.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    };
  }
  return null;
}
