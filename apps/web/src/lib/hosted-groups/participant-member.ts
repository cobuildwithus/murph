import "server-only";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";

export async function lookupHostedGroupParticipantMemberByHandle(input: {
  handle: string;
  prisma: HostedOnboardingReadClient;
}) {
  if (input.handle.includes("@")) {
    return await lookupHostedMemberByVerifiedEmailAddress({
      address: input.handle,
      prisma: input.prisma,
    });
  }

  const phoneNumber = normalizePhoneNumber(input.handle);
  return phoneNumber
    ? await lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber,
        prisma: input.prisma,
      })
    : null;
}
