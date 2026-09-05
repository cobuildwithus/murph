import { type Prisma } from "@prisma/client";

import {
  createHostedEmailLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { acquireHostedLinqParticipantEmailLockTx } from "./linq-participant-contact";
import { lockHostedMemberRow } from "./shared";
import type { HostedPrivyAuthMethod } from "./types";

const MAX_REPLY_ALIAS_GENERATION = 2_147_483_647;

const hostedLinkedAccountRoutingSelect = {
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
  replyAliasGeneration: true,
  replyAliasLookupKey: true,
} satisfies Prisma.HostedMemberRoutingSelect;

type HostedLinkedAccountRoutingSnapshot =
  Prisma.HostedMemberRoutingGetPayload<{
    select: typeof hostedLinkedAccountRoutingSelect;
  }>;

export async function removeHostedMemberLinkedAccountProjectionTx(input: {
  expectedIdentity: string;
  memberId: string;
  method: HostedPrivyAuthMethod;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  if (input.method === "email") {
    await acquireHostedLinqParticipantEmailLockTx({
      emailAddress: input.expectedIdentity,
      tx: input.prisma,
    });
  }
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
    select: hostedLinkedAccountRoutingSelect,
  });

  const ownedLinqRoutes = resolveOwnedLinqRoutes({
    expectedLookupKeys,
    method: "phone",
    routing,
  });

  const identityChanged = Boolean(
    identity
    && Object.values(identity).some((value) => value !== null),
  );
  const routingChanged = hasOwnedLinqRouteChanges(ownedLinqRoutes);

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
      data: buildOwnedLinqRouteClearData(ownedLinqRoutes),
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

  const identityChanged = (await input.prisma.hostedMemberIdentity.updateMany({
    where: {
      memberId: input.memberId,
      linqEmailHandleLookupKey: { in: expectedLookupKeys },
    },
    data: {
      linqEmailHandleLookupKey: null,
      linqEmailHandleEncrypted: null,
    },
  })).count > 0;

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: hostedLinkedAccountRoutingSelect,
  });
  const ownedLinqRoutes = resolveOwnedLinqRoutes({
    expectedLookupKeys,
    method: "email",
    routing,
  });
  const authorizationChanged = Boolean(
    authorization
    && Object.values(authorization).some((value) => value !== null),
  );
  const replyAliasChanged = Boolean(routing?.replyAliasLookupKey);
  const routingChanged = replyAliasChanged
    || hasOwnedLinqRouteChanges(ownedLinqRoutes);

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
    await input.prisma.hostedMemberRouting.update({
      where: { memberId: input.memberId },
      data: {
        ...buildOwnedLinqRouteClearData(ownedLinqRoutes),
        ...(replyAliasChanged
          ? buildRotatedReplyAliasData(routing?.replyAliasGeneration)
          : {}),
      },
    });
  }

  return identityChanged || authorizationChanged || routingChanged;
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

interface OwnedLinqRouteChanges {
  clearHomeBinding: boolean;
  clearHomeLine: boolean;
  clearPendingBinding: boolean;
}

function resolveOwnedLinqRoutes(input: {
  expectedLookupKeys: readonly string[];
  method: "email" | "phone";
  routing: HostedLinkedAccountRoutingSnapshot | null;
}): OwnedLinqRouteChanges {
  if (!input.routing) {
    return {
      clearHomeBinding: false,
      clearHomeLine: false,
      clearPendingBinding: false,
    };
  }

  const hasHomeBinding = [
    input.routing.linqChatIdEncrypted,
    input.routing.linqChatLookupKey,
    input.routing.linqParticipantContactKind,
    input.routing.linqParticipantContactLookupKey,
  ].some((value) => value !== null);
  const hasHomeLine = [
    input.routing.linqHomeLineAssignedAt,
    input.routing.linqRecipientPhoneEncrypted,
    input.routing.linqRecipientPhoneLookupKey,
  ].some((value) => value !== null);
  const hasPendingBinding = [
    input.routing.pendingLinqChatIdEncrypted,
    input.routing.pendingLinqChatLookupKey,
    input.routing.pendingLinqParticipantContactEncrypted,
    input.routing.pendingLinqParticipantContactKind,
    input.routing.pendingLinqParticipantContactLookupKey,
    input.routing.pendingLinqParticipantContactObservedAt,
    input.routing.pendingLinqRecipientPhoneEncrypted,
    input.routing.pendingLinqRecipientPhoneLookupKey,
  ].some((value) => value !== null);
  const clearHomeBinding = hasHomeBinding && isOwnedLinqParticipant({
    expectedLookupKeys: input.expectedLookupKeys,
    kind: input.routing.linqParticipantContactKind,
    lookupKey: input.routing.linqParticipantContactLookupKey,
    method: input.method,
  });
  const clearPendingBinding = hasPendingBinding && isOwnedLinqParticipant({
    expectedLookupKeys: input.expectedLookupKeys,
    kind: input.routing.pendingLinqParticipantContactKind,
    lookupKey: input.routing.pendingLinqParticipantContactLookupKey,
    method: input.method,
  });

  return {
    clearHomeBinding,
    clearHomeLine: clearHomeBinding
      || (clearPendingBinding && !hasHomeBinding)
      || (
        input.method === "phone"
        && hasHomeLine
        && !hasHomeBinding
        && !hasPendingBinding
      ),
    clearPendingBinding,
  };
}

function isOwnedLinqParticipant(input: {
  expectedLookupKeys: readonly string[];
  kind: string | null;
  lookupKey: string | null;
  method: "email" | "phone";
}): boolean {
  if (input.method === "email") {
    return input.kind === "email"
      && input.lookupKey !== null
      && input.expectedLookupKeys.includes(input.lookupKey);
  }

  if (input.kind === null) {
    return true;
  }

  return input.kind === "phone"
    && input.lookupKey !== null
    && input.expectedLookupKeys.includes(input.lookupKey);
}

function hasOwnedLinqRouteChanges(input: OwnedLinqRouteChanges): boolean {
  return input.clearHomeBinding
    || input.clearHomeLine
    || input.clearPendingBinding;
}

function buildOwnedLinqRouteClearData(
  input: OwnedLinqRouteChanges,
): Prisma.HostedMemberRoutingUncheckedUpdateInput {
  return {
    ...(input.clearHomeBinding
      ? {
          linqChatIdEncrypted: null,
          linqChatLookupKey: null,
          linqParticipantContactKind: null,
          linqParticipantContactLookupKey: null,
        }
      : {}),
    ...(input.clearHomeLine
      ? {
          linqHomeLineAssignedAt: null,
          linqRecipientPhoneEncrypted: null,
          linqRecipientPhoneLookupKey: null,
        }
      : {}),
    ...(input.clearPendingBinding
      ? {
          pendingLinqChatIdEncrypted: null,
          pendingLinqChatLookupKey: null,
          pendingLinqParticipantContactEncrypted: null,
          pendingLinqParticipantContactKind: null,
          pendingLinqParticipantContactLookupKey: null,
          pendingLinqParticipantContactObservedAt: null,
          pendingLinqRecipientPhoneEncrypted: null,
          pendingLinqRecipientPhoneLookupKey: null,
        }
      : {}),
  };
}

function buildRotatedReplyAliasData(
  replyAliasGeneration: number | null | undefined,
): Prisma.HostedMemberRoutingUncheckedUpdateInput {
  const currentGeneration = replyAliasGeneration ?? 0;
  if (
    !Number.isSafeInteger(currentGeneration)
    || currentGeneration < 0
    || currentGeneration >= MAX_REPLY_ALIAS_GENERATION
  ) {
    throw new RangeError("Hosted member reply alias generation cannot be rotated.");
  }

  return {
    replyAliasGeneration: currentGeneration + 1,
    replyAliasLookupKey: null,
  };
}
