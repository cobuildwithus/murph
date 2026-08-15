import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
  HostedExecutionResolvedLinqDeliveryRoute,
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
  readHostedLinqLinePhoneNumberByLookupKey,
} from "./linq-line-phone-resolver";
import {
  normalizeHostedLinqParticipantContactKind,
} from "./linq-participant-contact";
import {
  readHostedLinqChatHealth,
} from "./linq-provider-health-store";
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
export type HostedLinqRuntimeEgressAssertionResult = {
  linePhoneNumberLookupKey?: string;
  resolvedRoute: HostedExecutionResolvedLinqDeliveryRoute;
};

const HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX = "signup-welcome:";
const HOSTED_LINQ_RECENT_DIRECT_INBOUND_SCAN_LIMIT = 100;

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
  expectedResolvedRoute?: HostedExecutionResolvedLinqDeliveryRoute | null;
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
    return await assertHostedLinqSignupWelcomeParticipantEgressAuthority({
      directRecipientPhoneNumber: input.directRecipientPhoneNumber,
      fromPhoneNumber: input.fromPhoneNumber,
      idempotencyKey: input.idempotencyKey,
      memberId: input.memberId,
      prisma: input.prisma,
      target: input.target,
      targetKind: input.targetKind,
    });
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
    // The route's container member is the canonical owner of this durable
    // thread, and thread containers are synthetic members that no personal
    // runtime can ever authenticate as. Exact ownership is therefore the whole
    // authority: a personal proactive send still cannot reach a group thread,
    // and the owning container is not held to a home route it cannot have.
    if (targetThreadRoute.containerMemberId !== input.memberId) {
      throwHostedLinqRouteAuthorityMismatch();
    }

    const target = normalizeNullable(input.target);
    if (!target) {
      throwHostedLinqRouteAuthorityMismatch();
    }
    const fromPhoneNumber = await readHostedLinqLinePhoneNumberByLookupKey({
      phoneNumberLookupKey: targetThreadRoute.accountLookupKey,
      prisma: input.prisma,
    });

    return {
      ...(targetThreadRoute.accountLookupKey
        ? { linePhoneNumberLookupKey: targetThreadRoute.accountLookupKey }
        : {}),
      resolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: null,
        fromPhoneNumber,
        target,
        targetKind: "thread",
        threadIsDirect: false,
      },
    };
  }

  const persistedDirectInbound = await readMatchingPersistedHostedLinqDirectInbound({
    answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
    memberId: input.memberId,
    prisma: input.prisma,
    replyToMessageId: input.replyToMessageId,
    target: input.target,
  });
  if (persistedDirectInbound) {
    const linePhoneNumberLookupKey =
      persistedDirectInbound.accountLookupKey
      ?? (await readHostedLinqChatHealth({
        chatId: persistedDirectInbound.target,
        prisma: input.prisma,
      }))?.phoneNumberLookupKey
      ?? null;
    return {
      ...(linePhoneNumberLookupKey ? { linePhoneNumberLookupKey } : {}),
      resolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber:
          normalizePhoneNumber(persistedDirectInbound.directRecipient),
        fromPhoneNumber: await readHostedLinqLinePhoneNumberByLookupKey({
          phoneNumberLookupKey: linePhoneNumberLookupKey,
          prisma: input.prisma,
        }),
        target: persistedDirectInbound.target,
        targetKind: "thread",
        threadIsDirect: true,
      },
    };
  }

  return await assertHostedMemberLinqRouteMatchesEgressTarget({
    chatId: input.target,
    directRecipientPhoneNumber: input.directRecipientPhoneNumber,
    expectedResolvedRoute: input.expectedResolvedRoute,
    fromPhoneNumber: input.fromPhoneNumber,
    memberId: input.memberId,
    prisma: input.prisma,
    replyToMessageId: input.replyToMessageId,
    targetKind: input.targetKind,
    homeRouteFallbackAllowed:
      input.homeRouteFallbackAllowed === true && input.authorityCheckOnly === true,
  });
}

interface MatchingPersistedHostedLinqDirectInbound {
  accountLookupKey: string | null;
  directRecipient: string;
  target: string;
}

async function readMatchingPersistedHostedLinqDirectInbound(input: {
  answeredMailboxItemIds: readonly string[];
  memberId: string;
  prisma: HostedLinqEngagementClient;
  replyToMessageId?: string | null;
  target: string | null;
}): Promise<MatchingPersistedHostedLinqDirectInbound | null> {
  const target = normalizeNullable(input.target);
  const requestReplyToMessageId = normalizeNullable(input.replyToMessageId);
  if (!target || !requestReplyToMessageId) {
    return null;
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
      const matched = await readMatchingPersistedHostedLinqDirectInboundMailboxItem({
        item,
        memberId: input.memberId,
        payloadCiphertext:
          payloadsByMailboxItemId.get(item.id)?.payloadCiphertext ?? null,
        prisma: input.prisma,
        replyToMessageId: requestReplyToMessageId,
        target,
      });
      if (matched) {
        return matched;
      }
    }

    return null;
  });
}

async function readMatchingPersistedHostedLinqDirectInboundMailboxItem(input: {
  item: HostedLinqDirectInboundMailboxItem;
  memberId: string;
  payloadCiphertext: string | null;
  prisma: HostedLinqEngagementClient;
  replyToMessageId: string;
  target: string;
}): Promise<MatchingPersistedHostedLinqDirectInbound | null> {
  const item = input.item;
  if (
    item.userId !== input.memberId
    || item.kind !== "conversation.message"
    || item.lane !== "conversation"
  ) {
    return null;
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
    return null;
  }

  const wake = parseHostedExecutionWake(decoded);
  if (
    wake.kind !== "conversation.message"
    || wake.userId !== input.memberId
    || wake.eventId !== item.dedupeKey
    || wake.occurredAt !== item.occurredAt.toISOString()
    || wake.message.channel !== "linq"
    || wake.message.linqMessage.isFromMe !== false
    || wake.message.linqMessage.threadIsDirect !== true
    || wake.message.linqMessage.chatId !== input.target
    || wake.message.linqMessage.messageId !== input.replyToMessageId
  ) {
    return null;
  }

  return {
    accountLookupKey: normalizeNullable(wake.message.accountLookupKey),
    directRecipient: wake.message.linqMessage.from,
    target: wake.message.linqMessage.chatId,
  };
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
  return new Map<string, { payloadCiphertext: string }>(
    payloads.map((payload) => [
      payload.mailboxItemId,
      { payloadCiphertext: payload.payloadCiphertext },
    ]),
  );
}

async function assertHostedMemberLinqRouteMatchesEgressTarget(input: {
  chatId?: string | null;
  directRecipientPhoneNumber?: string | null;
  expectedResolvedRoute?: HostedExecutionResolvedLinqDeliveryRoute | null;
  fromPhoneNumber?: string | null;
  homeRouteFallbackAllowed: boolean;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  replyToMessageId?: string | null;
  targetKind?: string | null;
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  if (chatLookupKeys.length === 0 && !canResolveHostedLinqHomeRouteOverride(input)) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
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
      pendingLinqParticipantContactKind: true,
      pendingLinqParticipantContactLookupKey: true,
      pendingLinqRecipientPhoneEncrypted: true,
      pendingLinqRecipientPhoneLookupKey: true,
      telegramUserIdEncrypted: true,
    },
  });

  if (!routing) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  const exactRouteKind =
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
      ? "current"
      : routing.pendingLinqChatLookupKey
        && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
        ? "pending"
        : null;
  const routeKind = exactRouteKind
    ?? (canResolveHostedLinqHomeRouteOverride(input) ? "current" : null);
  if (!routeKind) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  if (exactRouteKind) {
    const hintedRoute = await resolveHostedMemberDirectLinqRouteFromAuthorityHints({
      directRecipientPhoneNumber: input.directRecipientPhoneNumber,
      expectedResolvedRoute: input.expectedResolvedRoute,
      fromPhoneNumber: input.fromPhoneNumber,
      memberId: input.memberId,
      prisma: input.prisma,
      routeKind: exactRouteKind,
      routing,
      target: input.chatId,
    });
    if (hintedRoute) {
      return hintedRoute;
    }
  }

  const privateState = await readHostedMemberRoutingPrivateState(routing, input.prisma);
  return await resolveHostedMemberDirectLinqRoute({
    memberId: input.memberId,
    prisma: input.prisma,
    privateState,
    routeKind,
    routing,
  });
}

interface HostedLinqMemberRoutingAuthority {
  linqChatLookupKey: string | null;
  linqParticipantContactKind: string | null;
  linqParticipantContactLookupKey: string | null;
  linqRecipientPhoneLookupKey: string | null;
  pendingLinqChatLookupKey: string | null;
  pendingLinqParticipantContactKind: string | null;
  pendingLinqParticipantContactLookupKey: string | null;
  pendingLinqRecipientPhoneLookupKey: string | null;
}

async function resolveHostedMemberDirectLinqRouteFromAuthorityHints(input: {
  directRecipientPhoneNumber?: string | null;
  expectedResolvedRoute?: HostedExecutionResolvedLinqDeliveryRoute | null;
  fromPhoneNumber?: string | null;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  routeKind: "current" | "pending";
  routing: HostedLinqMemberRoutingAuthority;
  target?: string | null;
}): Promise<HostedLinqRuntimeEgressAssertionResult | null> {
  const current = input.routeKind === "current";
  const target = normalizeNullable(input.target);
  const targetLookupKey = normalizeNullable(
    current
      ? input.routing.linqChatLookupKey
      : input.routing.pendingLinqChatLookupKey,
  );
  if (
    !target
    || !targetLookupKey
    || !createHostedLinqChatLookupKeyReadCandidates(target).includes(targetLookupKey)
  ) {
    return null;
  }

  const expectedRoute = input.expectedResolvedRoute ?? null;
  if (
    expectedRoute
    && (
      expectedRoute.target !== target
      || expectedRoute.targetKind !== "thread"
      || expectedRoute.threadIsDirect !== true
    )
  ) {
    return null;
  }

  const linePhoneNumberLookupKey = normalizeNullable(
    current
      ? input.routing.linqRecipientPhoneLookupKey
      : input.routing.pendingLinqRecipientPhoneLookupKey,
  );
  const fromPhoneNumberInput = expectedRoute
    ? expectedRoute.fromPhoneNumber
    : input.fromPhoneNumber;
  const fromPhoneNumber = normalizePhoneNumber(fromPhoneNumberInput);
  if (
    (fromPhoneNumberInput !== null && fromPhoneNumberInput !== undefined)
    && !fromPhoneNumber
  ) {
    return null;
  }
  if (
    linePhoneNumberLookupKey !== null
    && (
      !fromPhoneNumber
      || !createHostedPhoneLookupKeyReadCandidates(fromPhoneNumber)
        .includes(linePhoneNumberLookupKey)
    )
  ) {
    return null;
  }
  if (linePhoneNumberLookupKey === null && fromPhoneNumber !== null) {
    // A raw sender hint is not authority without the persisted route blind.
    return null;
  }

  const contactKind = normalizeHostedLinqParticipantContactKind(
    current
      ? input.routing.linqParticipantContactKind
      : input.routing.pendingLinqParticipantContactKind,
  );
  const routeContactLookupKey = normalizeNullable(
    current
      ? input.routing.linqParticipantContactLookupKey
      : input.routing.pendingLinqParticipantContactLookupKey,
  );
  const directRecipientInput = expectedRoute
    ? expectedRoute.directRecipientPhoneNumber
    : input.directRecipientPhoneNumber;
  const directRecipientPhoneNumber = normalizePhoneNumber(directRecipientInput);
  if (
    (directRecipientInput !== null && directRecipientInput !== undefined)
    && !directRecipientPhoneNumber
  ) {
    return null;
  }

  let contactLookupKey: string | null;
  if (contactKind === "email") {
    if (directRecipientPhoneNumber !== null) {
      return null;
    }
    contactLookupKey = routeContactLookupKey;
  } else if (current) {
    const identity = await input.prisma.hostedMemberIdentity.findUnique({
      select: { phoneLookupKey: true },
      where: { memberId: input.memberId },
    });
    const identityLookupKey = normalizeNullable(identity?.phoneLookupKey);
    const expectedContactLookupKey = routeContactLookupKey ?? identityLookupKey;
    const recipientLookupKeys = createHostedPhoneLookupKeyReadCandidates(
      directRecipientPhoneNumber,
    );
    if (
      (contactKind !== null && contactKind !== "phone")
      || !directRecipientPhoneNumber
      || !identityLookupKey
      || !expectedContactLookupKey
      || !recipientLookupKeys.includes(identityLookupKey)
      || !recipientLookupKeys.includes(expectedContactLookupKey)
    ) {
      return null;
    }
    contactLookupKey = expectedContactLookupKey;
  } else {
    const recipientLookupKeys = createHostedPhoneLookupKeyReadCandidates(
      directRecipientPhoneNumber,
    );
    if (
      contactKind !== "phone"
      || !directRecipientPhoneNumber
      || !routeContactLookupKey
      || !recipientLookupKeys.includes(routeContactLookupKey)
    ) {
      return null;
    }
    contactLookupKey = routeContactLookupKey;
  }

  const conversationThreadId = resolveHostedLinqConversationThreadId({
    linqContactLookupKey: contactLookupKey,
    memberId: input.memberId,
    threadId: target,
  });
  if (
    expectedRoute
    && expectedRoute.conversationThreadId !== conversationThreadId
  ) {
    return null;
  }

  return {
    ...(linePhoneNumberLookupKey ? { linePhoneNumberLookupKey } : {}),
    resolvedRoute: {
      conversationThreadId,
      directRecipientPhoneNumber,
      fromPhoneNumber,
      target,
      targetKind: "thread",
      threadIsDirect: true,
    },
  };
}

async function resolveHostedMemberDirectLinqRoute(input: {
  memberId: string;
  prisma: HostedLinqEngagementClient;
  privateState: Awaited<ReturnType<typeof readHostedMemberRoutingPrivateState>>;
  routeKind: "current" | "pending";
  routing: Pick<
    HostedLinqMemberRoutingAuthority,
    | "linqChatLookupKey"
    | "linqParticipantContactKind"
    | "linqParticipantContactLookupKey"
    | "linqRecipientPhoneLookupKey"
    | "pendingLinqChatLookupKey"
    | "pendingLinqParticipantContactKind"
    | "pendingLinqParticipantContactLookupKey"
    | "pendingLinqRecipientPhoneLookupKey"
  >;
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
  const current = input.routeKind === "current";
  const target = normalizeNullable(
    current
      ? input.privateState.linqChatId
      : input.privateState.pendingLinqChatId,
  );
  const targetLookupKey = normalizeNullable(
    current
      ? input.routing.linqChatLookupKey
      : input.routing.pendingLinqChatLookupKey,
  );
  const linePhoneNumberLookupKey = normalizeNullable(
    current
      ? input.routing.linqRecipientPhoneLookupKey
      : input.routing.pendingLinqRecipientPhoneLookupKey,
  );
  const fromPhoneNumber = normalizePhoneNumber(
    current
      ? input.privateState.linqRecipientPhone
      : input.privateState.pendingLinqRecipientPhone,
  );
  if (
    !target
    || !targetLookupKey
    || !createHostedLinqChatLookupKeyReadCandidates(target).includes(targetLookupKey)
    || (
      linePhoneNumberLookupKey !== null
      && (
        fromPhoneNumber === null
        || !createHostedPhoneLookupKeyReadCandidates(fromPhoneNumber)
          .includes(linePhoneNumberLookupKey)
      )
    )
  ) {
    throwHostedLinqRouteAuthorityMismatch();
  }

  const contactKind = normalizeHostedLinqParticipantContactKind(
    current
      ? input.routing.linqParticipantContactKind
      : input.routing.pendingLinqParticipantContactKind,
  );
  const contactLookupKey = normalizeNullable(
    current
      ? input.routing.linqParticipantContactLookupKey
      : input.routing.pendingLinqParticipantContactLookupKey,
  );
  const contact = await resolveHostedMemberDirectLinqParticipant({
    contactKind,
    contactLookupKey,
    memberId: input.memberId,
    pendingParticipantContact: current
      ? null
      : input.privateState.pendingLinqParticipantContact,
    prisma: input.prisma,
  });
  const conversationThreadId = resolveHostedLinqConversationThreadId({
    linqContactLookupKey: contact.lookupKey,
    memberId: input.memberId,
    threadId: target,
  });

  return {
    ...(linePhoneNumberLookupKey ? { linePhoneNumberLookupKey } : {}),
    resolvedRoute: {
      conversationThreadId,
      directRecipientPhoneNumber: contact.phoneNumber,
      fromPhoneNumber,
      target,
      targetKind: "thread",
      threadIsDirect: true,
    },
  };
}

async function resolveHostedMemberDirectLinqParticipant(input: {
  contactKind: "email" | "phone" | null;
  contactLookupKey: string | null;
  memberId: string;
  pendingParticipantContact: string | null;
  prisma: HostedLinqEngagementClient;
}): Promise<{ lookupKey: string | null; phoneNumber: string | null }> {
  if (input.contactKind === "email") {
    return {
      lookupKey: input.contactLookupKey,
      phoneNumber: null,
    };
  }

  if (input.pendingParticipantContact !== null) {
    const phoneNumber = normalizePhoneNumber(input.pendingParticipantContact);
    if (
      input.contactKind !== "phone"
      || !phoneNumber
      || !input.contactLookupKey
      || !createHostedPhoneLookupKeyReadCandidates(phoneNumber)
        .includes(input.contactLookupKey)
    ) {
      throwHostedLinqRouteAuthorityMismatch();
    }
    return {
      lookupKey: input.contactLookupKey,
      phoneNumber,
    };
  }

  const identity = await input.prisma.hostedMemberIdentity.findUnique({
    select: {
      memberId: true,
      phoneLookupKey: true,
      phoneNumberEncrypted: true,
    },
    where: { memberId: input.memberId },
  });
  if (!identity) {
    throwHostedLinqRouteAuthorityMismatch();
  }
  const phoneNumber = normalizePhoneNumber(
    await readHostedMemberIdentityPhoneNumber(identity, input.prisma),
  );
  const identityLookupKey = normalizeNullable(identity.phoneLookupKey);
  const expectedLookupKey = input.contactLookupKey ?? identityLookupKey;
  const phoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(phoneNumber);
  if (
    (input.contactKind !== null && input.contactKind !== "phone")
    || !phoneNumber
    || !expectedLookupKey
    || !identityLookupKey
    || !phoneLookupKeys.includes(identityLookupKey)
    || !phoneLookupKeys.includes(expectedLookupKey)
  ) {
    throwHostedLinqRouteAuthorityMismatch();
  }
  return {
    lookupKey: expectedLookupKey,
    phoneNumber,
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
  replyToMessageId?: string | null;
  targetKind?: string | null;
}): boolean {
  const targetKind = normalizeNullable(input.targetKind);
  return (
    input.homeRouteFallbackAllowed === true
    && normalizeNullable(input.chatId) !== null
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
}): Promise<HostedLinqRuntimeEgressAssertionResult> {
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

  return {
    linePhoneNumberLookupKey: routing.linqRecipientPhoneLookupKey,
    resolvedRoute: {
      conversationThreadId: null,
      directRecipientPhoneNumber: recipientPhone,
      fromPhoneNumber,
      target: recipientPhone,
      targetKind: "participant",
      threadIsDirect: true,
    },
  };
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
