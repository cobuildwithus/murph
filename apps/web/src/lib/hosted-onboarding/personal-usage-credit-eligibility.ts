import "server-only";

import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  isHostedPulseTrialBillingState,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "./billing-plans";
import { hasHostedMemberOwnActiveBilling } from "./entitlement";
import { getHostedOnboardingEnvironment } from "./runtime";
import type { HostedOnboardingReadClient } from "./shared";
import {
  filterHostedNonGroupUsageCreditOfferCodes,
  HOSTED_USAGE_CREDIT_OFFER_CODES,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";

const hostedPersonalUsageCreditEligibilitySelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
    accountGroupMemberships: {
      select: { id: true },
      take: 1,
      where: {
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        status: "active",
      },
    },
    accountGroupsOwned: {
      select: { id: true },
      take: 1,
      where: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
    },
    billingRef: {
      select: {
        currentBillingPhase: true,
        currentBillingPlanCode: true,
        currentCheckoutOffer: true,
        stripeCustomerLookupKey: true,
        stripeSubscriptionLookupKey: true,
      },
    },
    billingStatus: true,
    suspendedAt: true,
    threadContainer: {
      select: { memberId: true },
    },
  });

/**
 * The single current-eligibility owner for new personal usage-credit purchases.
 * Existing frozen purchases are recovered before callers consult this mutable
 * projection.
 */
export async function readHostedPersonalUsageCreditOfferCodes(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedUsageCreditOfferCode[]> {
  const configuredOfferCodes = readHostedConfiguredUsageCreditOfferCodes();
  if (configuredOfferCodes.length === 0) {
    return [];
  }

  const prisma = input.prisma ?? getPrisma();
  const member = await prisma.hostedMember.findUnique({
    select: hostedPersonalUsageCreditEligibilitySelect,
    where: { id: input.memberId },
  });
  const billingRef = member?.billingRef;
  const billingPlanCode = parseHostedBillingPlanCode(
    billingRef?.currentBillingPlanCode,
  );

  if (
    !member ||
    !billingRef ||
    !hasHostedMemberOwnActiveBilling(member) ||
    member.threadContainer !== null ||
    member.accountGroupsOwned.length > 0 ||
    member.accountGroupMemberships.length > 0 ||
    parseHostedBillingPhase(billingRef.currentBillingPhase) !== "paid" ||
    (billingPlanCode !== "launch_monthly" &&
      billingPlanCode !== "launch_edge_monthly" &&
      billingPlanCode !== "launch_max_monthly") ||
    isHostedPulseTrialBillingState({
      currentBillingPhase: billingRef.currentBillingPhase,
      currentCheckoutOffer: billingRef.currentCheckoutOffer,
    }) ||
    !billingRef.stripeCustomerLookupKey ||
    !billingRef.stripeSubscriptionLookupKey
  ) {
    return [];
  }

  return filterHostedNonGroupUsageCreditOfferCodes(configuredOfferCodes);
}

export function readHostedConfiguredUsageCreditOfferCodes(): HostedUsageCreditOfferCode[] {
  const priceIdsByOffer =
    getHostedOnboardingEnvironment().stripeUsageCreditPriceIdsByOffer;
  return HOSTED_USAGE_CREDIT_OFFER_CODES.filter(
    (offerCode) => Boolean(priceIdsByOffer[offerCode]),
  );
}
