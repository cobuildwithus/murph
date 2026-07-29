import "server-only";

import type {
  HostedExecutionAcceptedGroupMessageParticipant,
} from "@murphai/hosted-execution/contracts";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberRoutingByTelegramUserId } from "../hosted-onboarding/hosted-member-routing-store";
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

export async function lookupHostedGroupParticipantMemberByProviderEvidence(input: {
  participant: Pick<
    HostedExecutionAcceptedGroupMessageParticipant,
    "senderHandle" | "source"
  >;
  prisma: HostedOnboardingReadClient;
}) {
  if (input.participant.source === "telegram") {
    return await lookupHostedMemberRoutingByTelegramUserId({
      prisma: input.prisma,
      telegramUserId: input.participant.senderHandle,
    });
  }

  return await lookupHostedGroupParticipantMemberByHandle({
    handle: input.participant.senderHandle,
    prisma: input.prisma,
  });
}
