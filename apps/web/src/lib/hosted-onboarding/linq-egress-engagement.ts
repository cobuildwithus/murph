import type { Prisma, PrismaClient } from "@prisma/client";

import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  hostedOnboardingError,
} from "./errors";
import {
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";
import { normalizePhoneNumber } from "./phone";
import {
  assertActiveHostedThreadRouteContainerAccess,
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import {
  decodeHostedMailboxStoredPayload,
  readHostedMailboxLiveItemById,
  readHostedMailboxPayload,
  readHostedMailboxRecentLiveConversationItemIds,
} from "../hosted-mailbox/store";

type HostedLinqEngagementClient = PrismaClient | Prisma.TransactionClient;
type HostedLinqLegacyCurrentInboundProof = {
  dedupeKey: string;
  eventId: string;
  mailboxItemId: string;
  occurredAt: string;
  replyToMessageId: string;
  target: string;
};
export type HostedLinqRuntimeEgressTargetOverride = {
  target: string;
  targetKind: "thread";
};
export type HostedLinqRuntimeEgressAssertionResult = {
  targetOverride: HostedLinqRuntimeEgressTargetOverride | null;
};

const HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX = "signup-welcome:";
const HOSTED_LINQ_RECENT_DIRECT_INBOUND_SCAN_LIMIT = 100;

export async function assertHostedLinqRecentInboundEngagementForRuntime(input: {
  answeredMailboxItemIds?: readonly string[] | null;
  currentInbound?: HostedLinqLegacyCurrentInboundProof | null;
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  homeRouteFallbackAllowed?: boolean | null;
  idempotencyKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  replyToMessageId?: string | null;
  target: string | null;
  targetKind?: string | null;
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
  if (normalizeNullable(input.targetKind) === "participant") {
    await assertHostedLinqSignupWelcomeParticipantEgressAuthority({
      directRecipientPhoneNumber: input.directRecipientPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      idempotencyKey: input.idempotencyKey,
      memberId: input.memberId,
      prisma: input.prisma,
      target: input.target,
      targetKind: input.targetKind,
    });
    return { targetOverride: null };
  }

  await assertActiveHostedThreadRouteContainerAccess({
    containerMemberId: input.memberId,
    prisma: input.prisma,
  });

  const targetThreadRoute = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: input.target,
  });
  if (targetThreadRoute) {
    if (targetThreadRoute.containerMemberId !== input.memberId) {
      throwHostedLinqRouteAuthorityMismatch();
    }

    return { targetOverride: null };
  }

  if (await matchesPersistedHostedLinqDirectInbound({
    answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
    currentInbound: input.currentInbound ?? null,
    memberId: input.memberId,
    prisma: input.prisma,
    replyToMessageId: input.replyToMessageId,
    target: input.target,
  })) {
    return { targetOverride: null };
  }

  return await assertHostedMemberLinqRouteMatchesEgressTarget({
    chatId: input.target,
    memberId: input.memberId,
    prisma: input.prisma,
    recipientPhone: input.directRecipientPhoneNumber,
    replyToMessageId: input.replyToMessageId,
    targetKind: input.targetKind,
    homeRouteFallbackAllowed: input.homeRouteFallbackAllowed === true,
  });
}

async function matchesPersistedHostedLinqDirectInbound(input: {
  answeredMailboxItemIds: readonly string[];
  currentInbound: HostedLinqLegacyCurrentInboundProof | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  replyToMessageId?: string | null;
  target: string | null;
}): Promise<boolean> {
  const proof = input.currentInbound;
  const target = normalizeNullable(input.target);
  const requestReplyToMessageId = normalizeNullable(input.replyToMessageId);
  if (!target) {
    return false;
  }

  if (
    proof
    && normalizeNullable(proof.target) === target
    && normalizeNullable(proof.eventId) === normalizeNullable(proof.dedupeKey)
    && (
      requestReplyToMessageId === null
      || normalizeNullable(proof.replyToMessageId) === requestReplyToMessageId
    )
    && await matchesPersistedHostedLinqDirectInboundMailboxItem({
      legacyProof: proof,
      mailboxItemId: proof.mailboxItemId,
      memberId: input.memberId,
      prisma: input.prisma,
      replyToMessageId: proof.replyToMessageId,
      target,
    })
  ) {
    return true;
  }

  if (!requestReplyToMessageId) {
    return false;
  }
  for (let index = input.answeredMailboxItemIds.length - 1; index >= 0; index -= 1) {
    const mailboxItemId = input.answeredMailboxItemIds[index];
    if (
      mailboxItemId
      && await matchesPersistedHostedLinqDirectInboundMailboxItem({
        legacyProof: null,
        mailboxItemId,
        memberId: input.memberId,
        prisma: input.prisma,
        replyToMessageId: requestReplyToMessageId,
        target,
      })
    ) {
      return true;
    }
  }

  const answeredMailboxItemIds = new Set(input.answeredMailboxItemIds);
  const recentMailboxItemIds = await readHostedMailboxRecentLiveConversationItemIds({
    availableAt: new Date(),
    limit: HOSTED_LINQ_RECENT_DIRECT_INBOUND_SCAN_LIMIT,
    prisma: input.prisma,
    userId: input.memberId,
  });
  for (const mailboxItemId of recentMailboxItemIds) {
    if (
      !answeredMailboxItemIds.has(mailboxItemId)
      && await matchesPersistedHostedLinqDirectInboundMailboxItem({
        legacyProof: null,
        mailboxItemId,
        memberId: input.memberId,
        prisma: input.prisma,
        replyToMessageId: requestReplyToMessageId,
        target,
      })
    ) {
      return true;
    }
  }

  return false;
}

async function matchesPersistedHostedLinqDirectInboundMailboxItem(input: {
  legacyProof: HostedLinqLegacyCurrentInboundProof | null;
  mailboxItemId: string;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  replyToMessageId: string;
  target: string;
}): Promise<boolean> {
  const item = await readHostedMailboxLiveItemById({
    availableAt: new Date(),
    mailboxItemId: input.mailboxItemId,
    prisma: input.prisma,
  });
  if (
    !item
    || item.userId !== input.memberId
    || item.kind !== "conversation.message"
    || item.lane !== "conversation"
    || (
      input.legacyProof !== null
      && (
        item.dedupeKey !== input.legacyProof.dedupeKey
        || item.occurredAt !== input.legacyProof.occurredAt
      )
    )
  ) {
    return false;
  }

  const payload = item.payloadRef
    ? await readHostedMailboxPayload({
        dedupeKey: item.dedupeKey,
        mailboxItemId: item.id,
        payloadRef: item.payloadRef,
        prisma: input.prisma,
        userId: item.userId,
      })
    : null;
  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    lane: item.lane,
    laneSeq: item.laneSeq,
    mailboxItemId: item.id,
    occurredAt: item.occurredAt,
    payloadCiphertext: payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: item.payloadInlineCiphertext,
    payloadSchema: item.payloadSchema,
    prisma: input.prisma,
    userId: item.userId,
  });
  if (!decoded) {
    return false;
  }

  const wake = parseHostedExecutionWake(decoded);
  return (
    wake.kind === "conversation.message"
    && wake.userId === input.memberId
    && wake.eventId === item.dedupeKey
    && wake.occurredAt === item.occurredAt
    && (
      input.legacyProof === null
      || (
        wake.eventId === input.legacyProof.eventId
        && wake.occurredAt === input.legacyProof.occurredAt
      )
    )
    && wake.message.channel === "linq"
    && wake.message.linqMessage.isFromMe === false
    && wake.message.linqMessage.threadIsDirect === true
    && wake.message.linqMessage.chatId === input.target
    && wake.message.linqMessage.messageId === input.replyToMessageId
  );
}

async function assertHostedMemberLinqRouteMatchesEgressTarget(input: {
  chatId?: string | null;
  homeRouteFallbackAllowed: boolean;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  recipientPhone?: string | null;
  replyToMessageId?: string | null;
  targetKind?: string | null;
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const recipientPhoneLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(input.recipientPhone);
  if (chatLookupKeys.length === 0 && recipientPhoneLookupKeys.length === 0) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      linqChatIdEncrypted: true,
      linqChatLookupKey: true,
      linqRecipientPhoneEncrypted: true,
      linqRecipientPhoneLookupKey: true,
      memberId: true,
      pendingLinqChatIdEncrypted: true,
      pendingLinqChatLookupKey: true,
      pendingLinqParticipantContactEncrypted: true,
      pendingLinqRecipientPhoneEncrypted: true,
      pendingLinqRecipientPhoneLookupKey: true,
      telegramUserIdEncrypted: true,
    },
  });

  if (!routing) {
    throwHostedLinqRouteAuthorityMismatch();
  }
  if (
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
  ) {
    return { targetOverride: null };
  }
  if (
    routing.pendingLinqChatLookupKey
    && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
  ) {
    return { targetOverride: null };
  }
  if (
    routing.linqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    return { targetOverride: null };
  }
  if (
    routing.pendingLinqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.pendingLinqRecipientPhoneLookupKey)
  ) {
    return { targetOverride: null };
  }

  if (canResolveHostedLinqHomeRouteOverride(input)) {
    const privateState = await readHostedMemberRoutingPrivateState(routing, input.prisma);
    const homeChatId = normalizeNullable(privateState.linqChatId);
    if (homeChatId) {
      return {
        targetOverride: {
          target: homeChatId,
          targetKind: "thread",
        },
      };
    }
  }

  throwHostedLinqRouteAuthorityMismatch();
}

function canResolveHostedLinqHomeRouteOverride(input: {
  chatId?: string | null;
  homeRouteFallbackAllowed?: boolean | null;
  recipientPhone?: string | null;
  replyToMessageId?: string | null;
  targetKind?: string | null;
}): boolean {
  const targetKind = normalizeNullable(input.targetKind);
  return (
    input.homeRouteFallbackAllowed === true
    && normalizeNullable(input.chatId) !== null
    && normalizeNullable(input.recipientPhone) === null
    && normalizeNullable(input.replyToMessageId) === null
    && (targetKind === null || targetKind === "explicit" || targetKind === "thread")
  );
}

function throwHostedLinqRouteAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Linq egress target does not match the runtime user's Linq route.",
    retryable: false,
  });
}

async function assertHostedLinqSignupWelcomeParticipantEgressAuthority(input: {
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  target: string | null;
  targetKind?: string | null;
}): Promise<void> {
  if (!isHostedLinqSignupWelcomeFirstContact(input)) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }

  const targetKind = normalizeNullable(input.targetKind);
  const recipientPhone = normalizePhoneNumber(
    targetKind === "participant"
      ? input.target ?? input.directRecipientPhoneNumber ?? null
      : null,
  );
  const fromPhoneNumber = normalizePhoneNumber(input.fromPhoneNumber);
  if (targetKind !== "participant" || !recipientPhone || !fromPhoneNumber) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }

  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(recipientPhone);
  const fromPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(fromPhoneNumber);
  if (recipientPhoneLookupKeys.length === 0 || fromPhoneLookupKeys.length === 0) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }

  const [identity, routing] = await Promise.all([
    input.prisma.hostedMemberIdentity.findUnique({
      where: { memberId: input.memberId },
      select: { phoneLookupKey: true },
    }),
    input.prisma.hostedMemberRouting.findUnique({
      where: { memberId: input.memberId },
      select: { linqRecipientPhoneLookupKey: true },
    }),
  ]);

  if (
    !identity?.phoneLookupKey
    || !recipientPhoneLookupKeys.includes(identity.phoneLookupKey)
    || !routing?.linqRecipientPhoneLookupKey
    || !fromPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }
}

function throwHostedLinqParticipantEgressAuthorityMismatch(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
    httpStatus: 403,
    message: "Linq participant egress requires signup welcome authority for the runtime user.",
    retryable: false,
  });
}

function isHostedLinqSignupWelcomeFirstContact(input: {
  idempotencyKey?: string | null;
  memberId: string;
}): boolean {
  return normalizeNullable(input.idempotencyKey)
    === `${HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX}${input.memberId}`;
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
