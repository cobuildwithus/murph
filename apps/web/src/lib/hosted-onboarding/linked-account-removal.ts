import { type Prisma } from "@prisma/client";

import {
  createHostedEmailLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { lockHostedMemberRow } from "./shared";
import type { HostedPrivyAuthMethod } from "./types";

const MAX_REPLY_ALIAS_GENERATION = 2_147_483_647;

export async function removeHostedMemberLinkedAccountProjectionTx(input: {
  expectedIdentity: string;
  memberId: string;
  method: HostedPrivyAuthMethod;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  switch (input.method) {
    case "phone":
      return removeHostedMemberPhoneProjectionTx(input);
    case "email":
      return removeHostedMemberEmailProjectionTx(input);
    case "telegram":
      return removeHostedMemberTelegramProjectionTx(input);
  }
}

async function removeHostedMemberPhoneProjectionTx(input: {
  expectedIdentity: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  const expectedLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    input.expectedIdentity,
  );
  const identity = await input.prisma.hostedMemberIdentity.findUnique({
    where: { memberId: input.memberId },
    select: {
      maskedPhoneNumberHint: true,
      phoneLookupKey: true,
      phoneNumberEncrypted: true,
      phoneNumberVerifiedAt: true,
      signupPhoneCodeSendAttemptId: true,
      signupPhoneCodeSendAttemptStartedAt: true,
      signupPhoneCodeSentAt: true,
      signupPhoneNumberEncrypted: true,
    },
  });

  assertExpectedLookupKey({
    currentLookupKey: identity?.phoneLookupKey ?? null,
    expectedLookupKeys,
  });

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      linqChatIdEncrypted: true,
      linqChatLookupKey: true,
      linqHomeLineAssignedAt: true,
      linqParticipantContactKind: true,
      linqParticipantContactLookupKey: true,
      linqRecipientPhoneEncrypted: true,
      linqRecipientPhoneLookupKey: true,
      pendingLinqChatIdEncrypted: true,
      pendingLinqChatLookupKey: true,
      pendingLinqParticipantContactEncrypted: true,
      pendingLinqParticipantContactKind: true,
      pendingLinqParticipantContactLookupKey: true,
      pendingLinqParticipantContactObservedAt: true,
      pendingLinqRecipientPhoneEncrypted: true,
      pendingLinqRecipientPhoneLookupKey: true,
    },
  });

  const identityChanged = Boolean(
    identity
    && Object.values(identity).some((value) => value !== null),
  );
  const routingChanged = Boolean(
    routing
    && Object.values(routing).some((value) => value !== null),
  );

  if (identityChanged) {
    await input.prisma.hostedMemberIdentity.update({
      where: { memberId: input.memberId },
      data: {
        maskedPhoneNumberHint: null,
        phoneLookupKey: null,
        phoneNumberEncrypted: null,
        phoneNumberVerifiedAt: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: null,
      },
    });
  }

  if (routingChanged) {
    await input.prisma.hostedMemberRouting.update({
      where: { memberId: input.memberId },
      data: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqHomeLineAssignedAt: null,
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
      },
    });
  }

  return identityChanged || routingChanged;
}

async function removeHostedMemberEmailProjectionTx(input: {
  expectedIdentity: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  const expectedLookupKeys = createHostedEmailLookupKeyReadCandidates(
    input.expectedIdentity,
  );
  const authorization = await input.prisma.hostedMemberEmailAuthorization.findUnique({
    where: { memberId: input.memberId },
    select: {
      directPublicSenderAddressEncrypted: true,
      directPublicSenderAuthorizedAt: true,
      directPublicSenderLookupKey: true,
      verifiedEmailAddressEncrypted: true,
      verifiedEmailLookupKey: true,
      verifiedEmailVerifiedAt: true,
    },
  });

  assertExpectedLookupKey({
    currentLookupKey: authorization?.verifiedEmailLookupKey ?? null,
    expectedLookupKeys,
  });

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      replyAliasGeneration: true,
      replyAliasLookupKey: true,
    },
  });
  const authorizationChanged = Boolean(
    authorization
    && Object.values(authorization).some((value) => value !== null),
  );
  const routingChanged = Boolean(routing?.replyAliasLookupKey);

  if (authorizationChanged) {
    await input.prisma.hostedMemberEmailAuthorization.update({
      where: { memberId: input.memberId },
      data: {
        directPublicSenderAddressEncrypted: null,
        directPublicSenderAuthorizedAt: null,
        directPublicSenderLookupKey: null,
        verifiedEmailAddressEncrypted: null,
        verifiedEmailLookupKey: null,
        verifiedEmailVerifiedAt: null,
      },
    });
  }

  if (routingChanged) {
    const currentGeneration = routing?.replyAliasGeneration ?? 0;
    if (
      !Number.isSafeInteger(currentGeneration)
      || currentGeneration < 0
      || currentGeneration >= MAX_REPLY_ALIAS_GENERATION
    ) {
      throw new RangeError("Hosted member reply alias generation cannot be rotated.");
    }
    await input.prisma.hostedMemberRouting.update({
      where: { memberId: input.memberId },
      data: {
        replyAliasGeneration: currentGeneration + 1,
        replyAliasLookupKey: null,
      },
    });
  }

  return authorizationChanged || routingChanged;
}

async function removeHostedMemberTelegramProjectionTx(input: {
  expectedIdentity: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  const expectedLookupKeys = createHostedTelegramUserLookupKeyReadCandidates(
    input.expectedIdentity,
  );
  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      telegramUserIdEncrypted: true,
      telegramUserLookupKey: true,
    },
  });

  assertExpectedLookupKey({
    currentLookupKey: routing?.telegramUserLookupKey ?? null,
    expectedLookupKeys,
  });

  const changed = Boolean(
    routing?.telegramUserLookupKey || routing?.telegramUserIdEncrypted,
  );
  if (changed) {
    await input.prisma.hostedMemberRouting.update({
      where: { memberId: input.memberId },
      data: {
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
    });
  }

  return changed;
}

function assertExpectedLookupKey(input: {
  currentLookupKey: string | null;
  expectedLookupKeys: readonly string[];
}): void {
  if (
    input.currentLookupKey
    && !input.expectedLookupKeys.includes(input.currentLookupKey)
  ) {
    throw hostedOnboardingError({
      code: "LINKED_ACCOUNT_CHANGED",
      message: "This linked account changed. Refresh Settings and try again.",
      httpStatus: 409,
    });
  }
}
