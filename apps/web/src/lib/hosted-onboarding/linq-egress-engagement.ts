import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  hostedOnboardingError,
} from "./errors";
import {
  evaluateHostedLinqEgressPolicy,
  type HostedLinqEgressPolicyResult,
} from "./linq-egress-policy";
import {
  readHostedMemberIdentityPhoneNumber,
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";
import {
  normalizeHostedLinqParticipantContactKind,
} from "./linq-participant-contact";
import {
  readHostedLinqChatHealth,
} from "./linq-provider-health-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "./linq-observability-identifiers";
import {
  isHostedLinqStaleChatAppCardFallbackIdempotencyKey,
  parseHostedLinqAppCardFallbackIdentity,
} from "./linq-app-card-fallback";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import { normalizePhoneNumber } from "./phone";
import {
  assertActiveHostedThreadRouteContainerAccess,
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import {
  runWithHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  buildHostedMailboxLiveItemWhere,
  decodeHostedMailboxStoredPayload,
  resolveHostedMailboxPayloadRef,
} from "../hosted-mailbox/store";

type HostedLinqEngagementClient = PrismaClient | Prisma.TransactionClient;
export type HostedLinqRuntimeEgressTargetOverride = {
  conversationThreadId?: string;
  target: string;
  targetKind: "thread";
} | {
  fromPhoneNumber: string;
  target: string;
  targetKind: "participant";
};
export type HostedLinqRuntimeEgressAssertionResult = {
  linePhoneNumberLookupKey?: string;
  routeDisposition?: "superseded" | "unavailable";
  threadIsDirect: boolean;
  targetOverride: HostedLinqRuntimeEgressTargetOverride | null;
};

const HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX = "signup-welcome:";
const HOSTED_LINQ_RECENT_DIRECT_INBOUND_SCAN_LIMIT = 100;

const HOSTED_LINQ_EGRESS_ROUTING_SELECT = {
  linqChatIdEncrypted: true,
  linqChatLookupKey: true,
  linqParticipantContactKind: true,
  linqParticipantContactLookupKey: true,
  linqRecipientPhoneEncrypted: true,
  linqRecipientPhoneLookupKey: true,
  memberId: true,
  pendingLinqChatIdEncrypted: true,
  pendingLinqChatLookupKey: true,
  pendingLinqParticipantContactEncrypted: true,
  pendingLinqRecipientPhoneEncrypted: true,
  pendingLinqRecipientPhoneLookupKey: true,
  telegramUserIdEncrypted: true,
} satisfies Prisma.HostedMemberRoutingSelect;

type HostedLinqEgressRouting = Prisma.HostedMemberRoutingGetPayload<{
  select: typeof HOSTED_LINQ_EGRESS_ROUTING_SELECT;
}>;

const HOSTED_LINQ_DIRECT_INBOUND_MAILBOX_ITEM_SELECT = {
  createdAt: true,
  dedupeKey: true,
  expiresAt: true,
  id: true,
  kind: true,
  lane: true,
  laneSeq: true,
  occurredAt: true,
  payloadInlineCiphertext: true,
  payloadRef: true,
  payloadSchema: true,
  userId: true,
} satisfies Prisma.HostedMailboxItemSelect;

type HostedLinqDirectInboundMailboxItem = Prisma.HostedMailboxItemGetPayload<{
  select: typeof HOSTED_LINQ_DIRECT_INBOUND_MAILBOX_ITEM_SELECT;
}>;

export async function resolveHostedLinqEgressPolicyForRuntime(input: {
  fromPhoneNumber?: string | null;
  linePhoneNumberLookupKey?: string | null;
  prisma: HostedLinqEngagementClient;
  target: string | null;
  targetKind?: string | null;
}): Promise<{ policy: HostedLinqEgressPolicyResult }> {
  const targetKind = input.targetKind?.trim() ?? "";
  const newConversation = targetKind === "participant";
  const chatHealth = newConversation
    ? null
    : await readHostedLinqChatHealth({
        chatId: input.target,
        prisma: input.prisma,
      });
  const routeLineLookupKey = normalizeNullable(
    input.linePhoneNumberLookupKey,
  );
  const lineLookupKeys = chatHealth?.phoneNumberLookupKey
    ? [chatHealth.phoneNumberLookupKey]
    : routeLineLookupKey
      ? [routeLineLookupKey]
      : createHostedPhoneLookupKeyReadCandidates(
          normalizePhoneNumber(input.fromPhoneNumber),
        );
  const line = lineLookupKeys.length === 0
    ? null
    : await input.prisma.hostedLinqLine.findFirst({
        select: {
          egressPolicy: true,
          healthStatus: true,
          phoneNumberLookupKey: true,
          providerReputationStatus: true,
          providerServiceStatus: true,
        },
        where: {
          phoneNumberLookupKey: { in: lineLookupKeys },
        },
      });

  return {
    policy: evaluateHostedLinqEgressPolicy({
      chatHealthStatus: chatHealth?.providerStatus ?? null,
      lineDeliveryHealthStatus: line?.healthStatus ?? null,
      lineEgressPolicy: line?.egressPolicy ?? null,
      lineReputationStatus: line?.providerReputationStatus ?? null,
      lineServiceStatus: line?.providerServiceStatus ?? null,
      newConversation,
    }),
  };
}

export function assertHostedLinqRouteAuthorityMatchesTarget(input: {
  chatId: string | null | undefined;
  memberId?: string | null;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
}): HostedExecutionLinqExternalThreadRouteAuthority {
  const authority = input.routeAuthority;
  const chatId = normalizeNullable(input.chatId);
  const memberId = normalizeNullable(input.memberId);

  if (
    authority.channel !== "linq"
    || !chatId
    || authority.threadId !== chatId
    || (memberId !== null && authority.containerMemberId !== memberId)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority does not match the requested thread.",
      retryable: false,
    });
  }

  return {
    ...authority,
    channel: "linq",
  };
}

export async function assertHostedLinqRecentInboundEngagementForRuntime(input: {
  answeredMailboxItemIds?: readonly string[] | null;
  authorityCheckOnly: boolean;
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
    const appCardFallbackIdentity =
      parseHostedLinqAppCardFallbackIdentity(input.idempotencyKey);
    if (appCardFallbackIdentity?.kind === "stale_chat") {
      return await assertHostedLinqAppCardFallbackParticipantEgressAuthority({
        fromPhoneNumber: input.fromPhoneNumber,
        idempotencyKey: input.idempotencyKey,
        memberId: input.memberId,
        prisma: input.prisma,
        target: input.target ?? input.directRecipientPhoneNumber ?? null,
      });
    }
    if (appCardFallbackIdentity) {
      throwHostedLinqParticipantEgressAuthorityMismatch();
    }
    await assertHostedLinqSignupWelcomeParticipantEgressAuthority({
      directRecipientPhoneNumber: input.directRecipientPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      idempotencyKey: input.idempotencyKey,
      memberId: input.memberId,
      prisma: input.prisma,
      target: input.target,
      targetKind: input.targetKind,
    });
    return { targetOverride: null, threadIsDirect: true };
  }

  await assertActiveHostedThreadRouteContainerAccess({
    containerMemberId: input.memberId,
    prisma: input.prisma,
  });
  const currentHomeOnly = isHostedLinqCurrentHomeOnlyAssertion(input);

  const targetThreadRoute = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: input.target,
  });
  if (targetThreadRoute) {
    if (
      currentHomeOnly
      || targetThreadRoute.containerMemberId !== input.memberId
    ) {
      throwHostedLinqRouteAuthorityMismatch();
    }

    return {
      ...(targetThreadRoute.accountLookupKey
        ? { linePhoneNumberLookupKey: targetThreadRoute.accountLookupKey }
        : {}),
      targetOverride: null,
      threadIsDirect: false,
    };
  }

  if (
    !currentHomeOnly
    && await matchesPersistedHostedLinqDirectInbound({
      answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
      memberId: input.memberId,
      prisma: input.prisma,
      replyToMessageId: input.replyToMessageId,
      target: input.target,
    })
  ) {
    return { targetOverride: null, threadIsDirect: true };
  }

  return await assertHostedMemberLinqRouteMatchesEgressTarget({
    chatId: input.target,
    idempotencyKey: input.idempotencyKey,
    memberId: input.memberId,
    prisma: input.prisma,
    recipientPhone: input.directRecipientPhoneNumber,
    replyToMessageId: input.replyToMessageId,
    targetKind: input.targetKind,
    homeRouteFallbackAllowed:
      currentHomeOnly && input.authorityCheckOnly === true,
  });
}

function isHostedLinqCurrentHomeOnlyAssertion(input: {
  answeredMailboxItemIds?: readonly string[] | null;
  homeRouteFallbackAllowed?: boolean | null;
  idempotencyKey?: string | null;
  replyToMessageId?: string | null;
}): boolean {
  const appCardFallbackIdentity =
    parseHostedLinqAppCardFallbackIdentity(input.idempotencyKey);
  return input.homeRouteFallbackAllowed === true
    && (
      appCardFallbackIdentity
        ? appCardFallbackIdentity.kind === "stale_chat"
        : (
            normalizeNullable(input.replyToMessageId) === null
            && (input.answeredMailboxItemIds?.length ?? 0) === 0
          )
    );
}

async function matchesPersistedHostedLinqDirectInbound(input: {
  answeredMailboxItemIds: readonly string[];
  memberId: string;
  prisma: HostedLinqEngagementClient;
  replyToMessageId?: string | null;
  target: string | null;
}): Promise<boolean> {
  const target = normalizeNullable(input.target);
  const requestReplyToMessageId = normalizeNullable(input.replyToMessageId);
  if (!target || !requestReplyToMessageId) {
    return false;
  }

  return runWithHostedDomainRootUnwrapCache(async () => {
    const availableAt = new Date();
    const candidates = await readHostedLinqDirectInboundCandidates({
      answeredMailboxItemIds: input.answeredMailboxItemIds,
      availableAt,
      memberId: input.memberId,
      prisma: input.prisma,
    });
    const payloadsByMailboxItemId = await readHostedLinqDirectInboundPayloads({
      availableAt,
      candidates,
      memberId: input.memberId,
      prisma: input.prisma,
    });

    for (const item of candidates) {
      if (
        await matchesPersistedHostedLinqDirectInboundMailboxItem({
          item,
          memberId: input.memberId,
          payloadCiphertext:
            payloadsByMailboxItemId.get(item.id)?.payloadCiphertext ?? null,
          prisma: input.prisma,
          replyToMessageId: requestReplyToMessageId,
          target,
        })
      ) {
        return true;
      }
    }

    return false;
  });
}

async function matchesPersistedHostedLinqDirectInboundMailboxItem(input: {
  item: HostedLinqDirectInboundMailboxItem;
  memberId: string;
  payloadCiphertext: string | null;
  prisma: HostedLinqEngagementClient;
  replyToMessageId: string;
  target: string;
}): Promise<boolean> {
  const item = input.item;
  if (
    item.userId !== input.memberId
    || item.kind !== "conversation.message"
    || item.lane !== "conversation"
  ) {
    return false;
  }

  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    lane: item.lane,
    laneSeq: item.laneSeq.toString(),
    mailboxItemId: item.id,
    occurredAt: item.occurredAt.toISOString(),
    payloadCiphertext: input.payloadCiphertext,
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
    && wake.occurredAt === item.occurredAt.toISOString()
    && wake.message.channel === "linq"
    && wake.message.linqMessage.isFromMe === false
    && wake.message.linqMessage.threadIsDirect === true
    && wake.message.linqMessage.chatId === input.target
    && wake.message.linqMessage.messageId === input.replyToMessageId
  );
}

async function readHostedLinqDirectInboundCandidates(input: {
  answeredMailboxItemIds: readonly string[];
  availableAt: Date;
  memberId: string;
  prisma: HostedLinqEngagementClient;
}): Promise<HostedLinqDirectInboundMailboxItem[]> {
  const answeredMailboxItemIds = input.answeredMailboxItemIds.filter(
    (mailboxItemId) => mailboxItemId.length > 0,
  );
  const answeredRows = answeredMailboxItemIds.length > 0
    ? await input.prisma.hostedMailboxItem.findMany({
        select: HOSTED_LINQ_DIRECT_INBOUND_MAILBOX_ITEM_SELECT,
        where: {
          id: { in: [...new Set(answeredMailboxItemIds)] },
          ...buildHostedMailboxLiveItemWhere(input.availableAt),
        },
      })
    : [];
  const recentRows = await input.prisma.hostedMailboxItem.findMany({
    orderBy: { laneSeq: "desc" },
    select: HOSTED_LINQ_DIRECT_INBOUND_MAILBOX_ITEM_SELECT,
    take: HOSTED_LINQ_RECENT_DIRECT_INBOUND_SCAN_LIMIT,
    where: {
      ...buildHostedMailboxLiveItemWhere(input.availableAt),
      kind: "conversation.message",
      lane: "conversation",
      userId: input.memberId,
    },
  });

  const answeredRowsById = new Map(answeredRows.map((item) => [item.id, item]));
  const candidates: HostedLinqDirectInboundMailboxItem[] = [];
  for (let index = input.answeredMailboxItemIds.length - 1; index >= 0; index -= 1) {
    const mailboxItemId = input.answeredMailboxItemIds[index];
    const item = mailboxItemId ? answeredRowsById.get(mailboxItemId) : null;
    if (item) {
      candidates.push(item);
    }
  }

  const answeredMailboxItemIdSet = new Set(input.answeredMailboxItemIds);
  for (const item of recentRows) {
    if (!answeredMailboxItemIdSet.has(item.id)) {
      candidates.push(item);
    }
  }
  return candidates;
}

async function readHostedLinqDirectInboundPayloads(input: {
  availableAt: Date;
  candidates: readonly HostedLinqDirectInboundMailboxItem[];
  memberId: string;
  prisma: HostedLinqEngagementClient;
}) {
  const mailboxItemIds = [...new Set(input.candidates
    .filter((item) => {
      const payloadRef = normalizeNullable(item.payloadRef);
      return item.userId === input.memberId
        && item.kind === "conversation.message"
        && item.lane === "conversation"
        && payloadRef !== null
        && resolveHostedMailboxPayloadRef(payloadRef) === item.id;
    })
    .map((item) => item.id))];
  if (mailboxItemIds.length === 0) {
    return new Map<string, { payloadCiphertext: string }>();
  }

  const payloads = await input.prisma.hostedMailboxPayload.findMany({
    select: {
      mailboxItemId: true,
      payloadCiphertext: true,
    },
    where: {
      mailboxItem: buildHostedMailboxLiveItemWhere(input.availableAt),
      mailboxItemId: { in: mailboxItemIds },
      userId: input.memberId,
    },
  });
  return new Map(payloads.map((payload) => [payload.mailboxItemId, payload]));
}

async function assertHostedMemberLinqRouteMatchesEgressTarget(input: {
  chatId?: string | null;
  homeRouteFallbackAllowed: boolean;
  idempotencyKey?: string | null;
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
    select: HOSTED_LINQ_EGRESS_ROUTING_SELECT,
  });

  if (!routing) {
    throwHostedLinqRouteAuthorityMismatch();
  }
  const appCardFallbackRoute = input.homeRouteFallbackAllowed
    && isHostedLinqStaleChatAppCardFallbackIdempotencyKey(input.idempotencyKey)
      ? await readHostedLinqAppCardFallbackRoute({
          idempotencyKey: input.idempotencyKey,
          prisma: input.prisma,
        })
      : null;
  if (
    appCardFallbackRoute?.fallbackTargetKind === "participant"
    && routing.linqChatLookupKey
  ) {
    const participantRecovery =
      await resolveHostedLinqAppCardFallbackParticipantRoute({
        expectedCurrentChatLookupKey: routing.linqChatLookupKey,
        memberId: input.memberId,
        prisma: input.prisma,
        routing,
      });
    if (participantRecovery.kind !== "unavailable") {
      return participantRecovery.authority;
    }
    return {
      ...(routing.linqRecipientPhoneLookupKey
        ? {
            linePhoneNumberLookupKey:
              routing.linqRecipientPhoneLookupKey,
          }
        : {}),
      targetOverride: null,
      threadIsDirect: true,
    };
  }
  if (
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
  ) {
    if (
      input.homeRouteFallbackAllowed
      && isHostedLinqStaleChatAppCardFallbackIdempotencyKey(
        input.idempotencyKey,
      )
    ) {
      if (
        appCardFallbackRoute
        && chatLookupKeys.includes(
          appCardFallbackRoute.predecessorChatLookupKey,
        )
      ) {
        const participantRecovery =
          await resolveHostedLinqAppCardFallbackParticipantRoute({
            expectedCurrentChatId: normalizeNullable(input.chatId),
            expectedCurrentChatLookupKey:
              appCardFallbackRoute.predecessorChatLookupKey,
            memberId: input.memberId,
            prisma: input.prisma,
            routing,
          });
        if (participantRecovery.kind !== "unavailable") {
          return participantRecovery.authority;
        }
      } else {
        const currentChatId = normalizeNullable(input.chatId);
        if (currentChatId) {
          return {
            ...(routing.linqRecipientPhoneLookupKey
              ? {
                  linePhoneNumberLookupKey:
                    routing.linqRecipientPhoneLookupKey,
                }
              : {}),
            targetOverride: {
              target: currentChatId,
              targetKind: "thread",
            },
            threadIsDirect: true,
          };
        }
      }
    }
    return {
      ...(routing.linqRecipientPhoneLookupKey
        ? {
            linePhoneNumberLookupKey:
              routing.linqRecipientPhoneLookupKey,
          }
        : {}),
      targetOverride: null,
      threadIsDirect: true,
    };
  }
  if (
    routing.pendingLinqChatLookupKey
    && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
  ) {
    return {
      ...(routing.pendingLinqRecipientPhoneLookupKey
        ? {
            linePhoneNumberLookupKey:
              routing.pendingLinqRecipientPhoneLookupKey,
          }
        : {}),
      targetOverride: null,
      threadIsDirect: true,
    };
  }
  if (
    routing.linqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    return {
      linePhoneNumberLookupKey: routing.linqRecipientPhoneLookupKey,
      targetOverride: null,
      threadIsDirect: true,
    };
  }
  if (
    routing.pendingLinqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.pendingLinqRecipientPhoneLookupKey)
  ) {
    return {
      linePhoneNumberLookupKey:
        routing.pendingLinqRecipientPhoneLookupKey,
      targetOverride: null,
      threadIsDirect: true,
    };
  }

  if (canResolveHostedLinqHomeRouteOverride(input)) {
    const privateState = await readHostedMemberRoutingPrivateState(routing, input.prisma);
    const homeChatId = normalizeNullable(privateState.linqChatId);
    if (homeChatId) {
      // Session identity follows the member/contact blind used by ordinary
      // direct inbound and notification routing, not the assigned Murph line.
      const canonicalParticipantKind =
        normalizeHostedLinqParticipantContactKind(
          routing.linqParticipantContactKind,
        );
      const canonicalContactLookupKey = canonicalParticipantKind
        ? normalizeNullable(routing.linqParticipantContactLookupKey)
        : null;
      const legacyIdentity = canonicalContactLookupKey
        ? null
        : await input.prisma.hostedMemberIdentity.findUnique({
            select: { phoneLookupKey: true },
            where: { memberId: input.memberId },
          });
      const conversationThreadId =
        resolveHostedLinqConversationThreadId({
          linqContactLookupKey:
            canonicalContactLookupKey ?? legacyIdentity?.phoneLookupKey,
          memberId: input.memberId,
          threadId: homeChatId,
        });
      return {
        ...(routing.linqRecipientPhoneLookupKey
          ? {
              linePhoneNumberLookupKey:
                routing.linqRecipientPhoneLookupKey,
            }
          : {}),
        targetOverride: {
          ...(conversationThreadId ? { conversationThreadId } : {}),
          target: homeChatId,
          targetKind: "thread",
        },
        threadIsDirect: true,
      };
    }
  }

  throwHostedLinqRouteAuthorityMismatch();
}

async function assertHostedLinqAppCardFallbackParticipantEgressAuthority(input: {
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  target?: string | null;
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
  const [routing, predecessor] = await Promise.all([
    input.prisma.hostedMemberRouting.findUnique({
      where: { memberId: input.memberId },
      select: HOSTED_LINQ_EGRESS_ROUTING_SELECT,
    }),
    readHostedLinqAppCardFallbackRoute({
      idempotencyKey: input.idempotencyKey,
      prisma: input.prisma,
    }),
  ]);
  if (
    !routing
    || !predecessor
  ) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }
  const resolution = await resolveHostedLinqAppCardFallbackParticipantRoute({
    expectedCurrentChatLookupKey: predecessor.predecessorChatLookupKey,
    memberId: input.memberId,
    prisma: input.prisma,
    routing,
  });
  if (resolution.kind === "superseded") {
    return {
      ...resolution.authority,
      routeDisposition: "superseded",
    };
  }
  if (resolution.kind === "unavailable") {
    return {
      routeDisposition: "unavailable",
      targetOverride: null,
      threadIsDirect: true,
    };
  }
  const authority = resolution.authority;
  const expected = authority?.targetOverride;
  if (
    !authority
    || expected?.targetKind !== "participant"
    || normalizePhoneNumber(input.target) !== expected.target
    || normalizePhoneNumber(input.fromPhoneNumber) !== expected.fromPhoneNumber
  ) {
    throwHostedLinqParticipantEgressAuthorityMismatch();
  }
  return {
    ...(authority.linePhoneNumberLookupKey
      ? { linePhoneNumberLookupKey: authority.linePhoneNumberLookupKey }
      : {}),
    targetOverride: null,
    threadIsDirect: true,
  };
}

async function readHostedLinqAppCardFallbackRoute(input: {
  idempotencyKey?: string | null;
  prisma: HostedLinqEngagementClient;
}): Promise<{
  fallbackTargetKind: "participant" | "thread" | null;
  predecessorChatLookupKey: string;
} | null> {
  const predecessorIdempotencyKey =
    parseHostedLinqAppCardFallbackIdentity(input.idempotencyKey)
      ?.predecessorIdempotencyKey ?? null;
  const predecessorIdempotencyLookupKey =
    createHostedLinqDeliveryIdempotencyLookupKey(
      predecessorIdempotencyKey,
    );
  if (!predecessorIdempotencyLookupKey) {
    return null;
  }
  const fallbackIdempotencyLookupKey =
    createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  const [predecessor, fallback] = await Promise.all([
    input.prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey: predecessorIdempotencyLookupKey },
      select: {
        linqChatLookupKey: true,
        source: true,
        targetKind: true,
      },
    }),
    fallbackIdempotencyLookupKey
      ? input.prisma.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: fallbackIdempotencyLookupKey },
          select: {
            source: true,
            targetKind: true,
          },
        })
      : null,
  ]);
  if (!(
    predecessor?.linqChatLookupKey
    && predecessor.source === "hosted_runtime_linq_delivery"
    && predecessor.targetKind === "thread"
  )) {
    return null;
  }
  return {
    fallbackTargetKind:
      fallback?.source === "hosted_runtime_linq_delivery"
      && (
        fallback.targetKind === "participant"
        || fallback.targetKind === "thread"
      )
        ? fallback.targetKind
        : null,
    predecessorChatLookupKey: predecessor.linqChatLookupKey,
  };
}

async function resolveHostedLinqAppCardFallbackParticipantRoute(input: {
  expectedCurrentChatId?: string | null;
  expectedCurrentChatLookupKey?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  routing: HostedLinqEgressRouting;
}): Promise<
  | {
      authority: HostedLinqRuntimeEgressAssertionResult;
      kind: "participant" | "superseded";
    }
  | { kind: "unavailable" }
> {
  const [privateState, identity] = await Promise.all([
    readHostedMemberRoutingPrivateState(input.routing, input.prisma),
    input.prisma.hostedMemberIdentity.findUnique({
      where: { memberId: input.memberId },
      select: {
        memberId: true,
        phoneLookupKey: true,
        phoneNumberEncrypted: true,
      },
    }),
  ]);
  const expectedCurrentChatId = normalizeNullable(input.expectedCurrentChatId);
  if (
    expectedCurrentChatId
    && normalizeNullable(privateState.linqChatId) !== expectedCurrentChatId
  ) {
    return resolveHostedLinqSupersedingHomeThreadRoute({
      identityPhoneLookupKey: identity?.phoneLookupKey,
      memberId: input.memberId,
      privateState,
      routing: input.routing,
    });
  }
  const expectedCurrentChatLookupKey = normalizeNullable(
    input.expectedCurrentChatLookupKey,
  );
  if (
    expectedCurrentChatLookupKey
    && !createHostedLinqChatLookupKeyReadCandidates(privateState.linqChatId)
      .includes(expectedCurrentChatLookupKey)
  ) {
    return resolveHostedLinqSupersedingHomeThreadRoute({
      identityPhoneLookupKey: identity?.phoneLookupKey,
      memberId: input.memberId,
      privateState,
      routing: input.routing,
    });
  }
  if (!identity?.phoneLookupKey) {
    return { kind: "unavailable" };
  }
  const memberPhoneNumber = normalizePhoneNumber(
    await readHostedMemberIdentityPhoneNumber(identity, input.prisma),
  );
  const messaging = resolveHostedMemberMessagingState({
    identity: { phoneLookupKey: identity.phoneLookupKey },
    routing: null,
  });
  const route = resolveHostedMemberAssistantNotificationRoute({
    linqChatId: null,
    linqRecipientPhone: privateState.linqRecipientPhone,
    memberId: input.memberId,
    memberPhoneNumber,
    messaging,
  });
  if (route?.channel !== "linq" || route.delivery.kind !== "participant") {
    return { kind: "unavailable" };
  }
  const fromPhoneNumber = normalizePhoneNumber(
    route.delivery.source?.fromPhoneNumber,
  );
  const target = normalizePhoneNumber(route.delivery.target);
  if (!fromPhoneNumber || !target) {
    return { kind: "unavailable" };
  }
  return {
    authority: {
      ...(input.routing.linqRecipientPhoneLookupKey
        ? {
            linePhoneNumberLookupKey:
              input.routing.linqRecipientPhoneLookupKey,
          }
        : {}),
      targetOverride: {
        fromPhoneNumber,
        target,
        targetKind: "participant",
      },
      threadIsDirect: true,
    },
    kind: "participant",
  };
}

function resolveHostedLinqSupersedingHomeThreadRoute(input: {
  identityPhoneLookupKey: string | null | undefined;
  memberId: string;
  privateState: Awaited<ReturnType<typeof readHostedMemberRoutingPrivateState>>;
  routing: HostedLinqEgressRouting;
}):
  | {
      authority: HostedLinqRuntimeEgressAssertionResult;
      kind: "superseded";
    }
  | { kind: "unavailable" } {
  const homeChatId = normalizeNullable(input.privateState.linqChatId);
  if (!homeChatId) {
    return { kind: "unavailable" };
  }
  const canonicalParticipantKind =
    normalizeHostedLinqParticipantContactKind(
      input.routing.linqParticipantContactKind,
    );
  const canonicalContactLookupKey = canonicalParticipantKind
    ? normalizeNullable(input.routing.linqParticipantContactLookupKey)
    : null;
  const conversationThreadId = resolveHostedLinqConversationThreadId({
    linqContactLookupKey:
      canonicalContactLookupKey ?? input.identityPhoneLookupKey,
    memberId: input.memberId,
    threadId: homeChatId,
  });
  return {
    authority: {
      ...(input.routing.linqRecipientPhoneLookupKey
        ? {
            linePhoneNumberLookupKey:
              input.routing.linqRecipientPhoneLookupKey,
          }
        : {}),
      targetOverride: {
        ...(conversationThreadId ? { conversationThreadId } : {}),
        target: homeChatId,
        targetKind: "thread",
      },
      threadIsDirect: true,
    },
    kind: "superseded",
  };
}

function resolveHostedLinqConversationThreadId(input: {
  linqContactLookupKey: string | null | undefined;
  memberId: string;
  threadId: string;
}): string | null {
  const linqContactLookupKey = normalizeNullable(input.linqContactLookupKey);
  const memberId = normalizeNullable(input.memberId);
  const threadId = normalizeNullable(input.threadId);
  if (!linqContactLookupKey || !memberId || !threadId) {
    return null;
  }

  const messaging = resolveHostedMemberMessagingState({
    identity: null,
    routing: { linqChatId: threadId },
  });
  const route = resolveHostedMemberAssistantNotificationRoute({
    linqChatId: threadId,
    linqContactLookupKey,
    memberId,
    messaging,
  });
  return route?.channel === "linq"
    && route.delivery.kind === "thread"
    && route.delivery.target === threadId
    ? route.threadId
    : null;
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
    message: "Linq participant egress requires an exact approved first-contact authority.",
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
