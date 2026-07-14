import "server-only";

import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedAccountGroupStripeBillingRef,
  readHostedFamilyAccessForMember,
  readHostedFamilyOwnerSnapshotForMember,
} from "./family-plan";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import { readHostedMemberCoreState } from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";
import { normalizeNullableString } from "./shared";

export type HostedBillingPortalScope = "family" | "member";

export async function createHostedBillingPortalSession(input: {
  billingScope: HostedBillingPortalScope;
  memberId: string;
  prisma?: PrismaClient;
  returnUrl: string;
}): Promise<{ url: string }> {
  const prisma = input.prisma ?? getPrisma();
  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma,
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }
  assertHostedMemberNotSuspended(member);

  if (
    input.billingScope === "member" &&
    await readHostedFamilyAccessForMember({
      memberId: input.memberId,
      prisma,
    })
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_DIRECT_MUTATION_SPONSORED_UNSUPPORTED",
      httpStatus: 409,
      message: "Direct billing management is unavailable while Family sponsorship is active.",
    });
  }

  const stripeCustomerId = input.billingScope === "family"
    ? await readFamilyStripeCustomerId({
        memberId: input.memberId,
        prisma,
      })
    : (await readHostedMemberStripeBillingRef({
        memberId: input.memberId,
        prisma,
      }))?.stripeCustomerId ?? null;

  if (!stripeCustomerId) {
    throw hostedOnboardingError({
      code: "STRIPE_CUSTOMER_NOT_READY",
      message: input.billingScope === "family"
        ? "Your Family subscription is not ready for management yet."
        : "Your subscription is not ready for management yet.",
      httpStatus: 409,
    });
  }

  const familyPortalConfigurationId = normalizeNullableString(
    process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID,
  );
  const session = await requireHostedStripeApi().billingPortal.sessions.create({
    ...(input.billingScope === "family" && familyPortalConfigurationId
      ? { configuration: familyPortalConfigurationId }
      : {}),
    customer: stripeCustomerId,
    return_url: input.returnUrl,
  });
  if (!session.url) {
    throw hostedOnboardingError({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      message: "Stripe did not return a billing portal URL.",
      httpStatus: 502,
    });
  }

  return { url: session.url };
}

async function readFamilyStripeCustomerId(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<string | null> {
  const familyOwner = await readHostedFamilyOwnerSnapshotForMember({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (!familyOwner) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_NOT_FOUND",
      httpStatus: 403,
      message: "Only the Family plan owner can manage Family billing.",
    });
  }

  const billingRef = await readHostedAccountGroupStripeBillingRef({
    groupId: familyOwner.groupId,
    prisma: input.prisma,
  });
  return billingRef?.stripeCustomerId ?? null;
}
