import "server-only";

import { HostedBillingStatus } from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import type { HostedOnboardingReadClient } from "./shared";

/**
 * Family sponsorship and a member-owned Stripe subscription are mutually
 * exclusive payment authorities. Callers that can create or activate direct
 * billing must evaluate this predicate while holding the member mutation lock.
 */
export async function hasActiveHostedFamilyBillingAuthority(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const membership = await input.prisma.hostedAccountGroupMembership.findFirst({
    select: { id: true },
    where: {
      group: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
      memberId: input.memberId,
      status: "active",
    },
  });
  return Boolean(membership);
}

export async function assertHostedMemberCanOwnDirectBilling(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  if (!await hasActiveHostedFamilyBillingAuthority(input)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_FAMILY_AUTHORITY_ACTIVE",
    httpStatus: 409,
    message:
      "Your Murph access is currently paid through Family. Leave Family before starting a separate subscription or trial.",
  });
}
