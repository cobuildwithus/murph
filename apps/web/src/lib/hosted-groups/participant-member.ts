import "server-only";

import type {
  HostedExecutionAcceptedGroupMessageParticipant,
} from "@murphai/hosted-execution/contracts";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberRoutingByTelegramUserId } from "../hosted-onboarding/hosted-member-routing-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  createHostedLinqParticipantContact,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
} from "../hosted-onboarding/linq-participant-contact";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";

export async function lookupHostedGroupParticipantMemberIdByHandle(input: {
  handle: string;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const contact = createHostedLinqParticipantContact({
    kind: input.handle.includes("@") ? "email" : "phone",
    value: input.handle,
  });
  if (!contact) {
    return null;
  }
  const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
    kind: contact.kind,
    value: contact.value,
  });
  if (lookupKeys.length === 0) {
    return null;
  }

  const records = contact.kind === "phone"
    ? await input.prisma.hostedMemberIdentity.findMany({
        select: { memberId: true },
        where: { phoneLookupKey: { in: lookupKeys } },
      })
    : await input.prisma.hostedMemberEmailAuthorization.findMany({
        select: { memberId: true },
        where: {
          verifiedEmailLookupKey: { in: lookupKeys },
          verifiedEmailVerifiedAt: { not: null },
        },
      });
  const memberIds = new Set(records.map((record) => record.memberId));
  if (memberIds.size > 1) {
    throw hostedOnboardingError({
      code: contact.kind === "phone"
        ? "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS"
        : "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: memberIds.size,
        matchedBy: contact.kind === "phone" ? "phoneNumber" : "verifiedEmail",
      },
      httpStatus: 500,
      message: "Hosted group participant lookup matched multiple members.",
      retryable: true,
    });
  }
  return memberIds.values().next().value ?? null;
}

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
