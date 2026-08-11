import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionLinqConversationMessageWake,
  createHostedExecutionGroupReactionEventId,
  formatHostedExecutionGroupReactionEventText,
  HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
} from "@murphai/hosted-execution";
import { getHostedCryptoDomainForLane } from "@murphai/runtime-state";

import {
  lockAndReadActiveHostedDomainRootKeyIdTx,
  unwrapHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import {
  runWithHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";
import {
  lockHostedThreadRouteByThreadIdentityTx,
  readHostedThreadRouteByThreadIdentity,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { createHostedPhoneLookupKey } from "./contact-privacy";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import { getHostedLinqChatSummary } from "./linq-client";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import {
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "./linq-provider-events";
import type { HostedLinqWebhookEvent } from "./linq-webhook";
import { readActiveHostedMemberAccess } from "./member-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  appendConsumedHostedGroupReactionMailboxEnvelopeTx,
} from "./group-reaction-mailbox";

const HOSTED_LINQ_GROUP_REACTION_VALUE_MAX_CHARS = 256;
const HOSTED_LINQ_GROUP_REACTION_PREPARATION_REQUIRED_CODE =
  "HOSTED_LINQ_GROUP_REACTION_PREPARATION_REQUIRED";
const HOSTED_LINQ_GROUP_REACTION_MAILBOX_DOMAIN =
  getHostedCryptoDomainForLane("mailbox-payload");

type HostedLinqGroupReactionRoute = Pick<
  HostedThreadRouteSnapshot,
  "accountLookupKey" | "containerMemberId"
>;

interface HostedLinqGroupReactionRouteCandidate {
  accountLookupKey: string | null;
  containerMemberId: string;
  deliveryRouteEncrypted: string | null;
  deliveryRouteEncryptedPresent: boolean;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
}

interface PreparedHostedLinqGroupReactionContext {
  ingressRootKeyId: string;
  route: HostedLinqGroupReactionRouteCandidate;
}

export type HostedLinqGroupReactionMailboxAppend = {
  containerMemberId: string;
  item: Awaited<
    ReturnType<typeof appendConsumedHostedGroupReactionMailboxEnvelopeTx>
  >["item"];
};

export async function buildHostedLinqAffirmativeReactionMessageEvent(input: {
  event: ParsedHostedLinqProviderEvent;
  signal?: AbortSignal;
}): Promise<HostedLinqWebhookEvent | null> {
  if (!isHostedLinqAffirmativeReaction({
    customEmoji: input.event.reactionCustomEmoji,
    eventType: input.event.eventType,
    reactionType: input.event.reactionType,
  })) {
    return null;
  }
  const eventContext = readHostedLinqReactionEventContext(input.event);
  if (!eventContext) {
    return null;
  }

  const chat = await readHostedLinqReactionCanonicalChat({
    actor: eventContext.actor,
    chatId: eventContext.chatId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!chat) {
    return null;
  }

  const occurredAt = input.event.providerCreatedAt.toISOString();
  const service = input.event.service ?? "iMessage";
  return {
    api_version: input.event.apiVersion ?? "v3",
    created_at: occurredAt,
    event_id: input.event.eventId,
    event_type: "message.received",
    ...(input.event.webhookVersion
      ? { webhook_version: input.event.webhookVersion }
      : {}),
    data: {
      chat_id: eventContext.chatId,
      chat: {
        id: eventContext.chatId,
        is_group: chat.isGroup,
        owner_handle: {
          handle: chat.accountHandle,
          is_me: true,
          service,
        },
      },
      direction: "inbound",
      from: eventContext.actor.value,
      from_handle: {
        handle: eventContext.actor.value,
        is_me: false,
        service,
      },
      is_from_me: false,
      message: {
        id: input.event.eventId,
        parts: [
          {
            type: "text",
            value: `Reacted with ${
              input.event.reactionCustomEmoji
              ?? readHostedLinqReactionLabel(input.event)
            }.`,
          },
        ],
        reply_to: {
          message_id: eventContext.messageId,
          ...(eventContext.partIndex === null
            ? {}
            : { part_index: eventContext.partIndex }),
        },
      },
      received_at: occurredAt,
      recipient_handle: {
        handle: chat.accountHandle,
        is_me: true,
        service,
      },
      recipient_phone: chat.accountHandle,
      sender_handle: {
        handle: eventContext.actor.value,
        is_me: false,
        service,
      },
      service,
    },
  };
}

/**
 * Appends one provider-authenticated Linq reaction through the existing
 * conversation mailbox. Canonical offer owners may pass `actor: null` after
 * they have decided the reaction so a pre-member handle never enters
 * group-visible room evidence. The blind contact lookup stays envelope-local
 * for the existing identifier and crypto contracts.
 *
 * Target text is deliberately absent here and resolved later from the bounded
 * durable input/outbox spine. The same provider event therefore always rebuilds
 * byte-identical mailbox content on retry.
 */
export async function appendHostedLinqGroupReactionMailboxTx(input: {
  actor: string | null;
  event: ParsedHostedLinqProviderEvent;
  route: HostedLinqGroupReactionRoute;
  tx: Prisma.TransactionClient;
}): Promise<HostedLinqGroupReactionMailboxAppend> {
  const eventContext = readHostedLinqReactionEventContext(input.event);
  if (!eventContext) {
    throw new TypeError("Hosted Linq group reaction context is invalid.");
  }

  const occurredAt = input.event.providerCreatedAt.toISOString();
  const reactionEventId = createHostedExecutionGroupReactionEventId(
    input.event.eventId,
  );
  const reactionText = formatHostedExecutionGroupReactionEventText({
    actor: input.actor,
    changes: [{
      operation: input.event.eventType === "reaction.removed"
        ? "removed"
        : "added",
      reaction: readHostedLinqReactionValue(input.event),
    }],
    channel: "linq",
    mode: "delta",
    targetMessageId: eventContext.messageId,
    targetText: null,
  });
  const envelope = buildHostedExecutionLinqConversationMessageWake({
    ...(input.route.accountLookupKey
      ? { accountLookupKey: input.route.accountLookupKey }
      : {}),
    contactKind: eventContext.actor.kind,
    contactLookupKey: eventContext.actor.lookupKey,
    eventId: reactionEventId,
    linqMessage: {
      chatId: eventContext.chatId,
      from: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
      isFromMe: false,
      messageId: reactionEventId,
      parts: [{ type: "text", value: reactionText }],
      reactionEligible: false,
      replyToMessageId: eventContext.messageId,
      ...(eventContext.partIndex === null
        ? {}
        : { replyToPartIndex: eventContext.partIndex }),
      service: input.event.service ?? "iMessage",
      threadIsDirect: false,
    },
    occurredAt,
    routeAuthority: {
      channel: "linq",
      containerMemberId: input.route.containerMemberId,
      threadId: eventContext.chatId,
    },
    userId: input.route.containerMemberId,
  });
  const appended = await appendConsumedHostedGroupReactionMailboxEnvelopeTx({
    envelope,
    tx: input.tx,
  });
  return {
    containerMemberId: input.route.containerMemberId,
    item: appended.item,
  };
}

export async function signalHostedLinqGroupReactionMailbox(input: {
  abortSignal?: AbortSignal;
  append: HostedLinqGroupReactionMailboxAppend;
  prisma: PrismaClient;
}): Promise<void> {
  await signalHostedMailboxAppendRuntime({
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    expectedUserId: input.append.containerMemberId,
    knownCheckpoint: {
      lane: input.append.item.lane,
      laneSeq: input.append.item.laneSeq,
      userId: input.append.containerMemberId,
    },
    mailboxItemId: input.append.item.id,
    prisma: input.prisma,
  });
}

/**
 * Retains the historical function name for the webhook call site, but no longer
 * stages a lossy next-message hint. The verified provider event supplies the
 * actor and target id; the canonical thread route supplies group/runtime
 * authority. The shared append owner above keeps generic and operational Linq
 * reactions on one durability contract.
 *
 * The reaction becomes an ordinary durable conversation mailbox item whose row
 * is marked consumed at ingress, so it is imported as context without ever
 * becoming a reply candidate or depending on a live roster re-read.
 */
export async function stageHostedLinqGroupReactionContext(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<boolean> {
  input.signal?.throwIfAborted();
  const eventContext = readHostedLinqReactionEventContext(input.event);
  if (!eventContext) {
    return false;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const append = await runWithHostedDomainRootUnwrapCache(async () => {
        const prepared = await prepareHostedLinqGroupReactionContext({
          chatId: eventContext.chatId,
          prisma: input.prisma,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        if (!prepared) {
          return null;
        }

        input.signal?.throwIfAborted();
        return input.prisma.$transaction(
          (tx) => appendPreparedHostedLinqGroupReactionMailboxTx({
            actor: eventContext.actor.value,
            chatId: eventContext.chatId,
            event: input.event,
            prepared,
            tx,
          }),
          HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
        );
      });

      if (!append) {
        return false;
      }
      input.signal?.throwIfAborted();
      await signalHostedLinqGroupReactionMailbox({
        ...(input.signal ? { abortSignal: input.signal } : {}),
        append,
        prisma: input.prisma,
      });
      return true;
    } catch (error) {
      if (
        attempt === 0
        && isHostedOnboardingError(error)
        && error.code === HOSTED_LINQ_GROUP_REACTION_PREPARATION_REQUIRED_CODE
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    "Hosted Linq group reaction preparation retry exhausted unexpectedly.",
  );
}

async function prepareHostedLinqGroupReactionContext(input: {
  chatId: string;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<PreparedHostedLinqGroupReactionContext | null> {
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: input.chatId,
  });
  if (
    !route
    || !(await readActiveHostedMemberAccess({
      memberId: route.containerMemberId,
      prisma: input.prisma,
    }))
  ) {
    return null;
  }

  const routeCandidate = requireHostedLinqGroupReactionRouteCandidate(route);
  const root = await unwrapHostedDomainRootForWeb({
    domain: HOSTED_LINQ_GROUP_REACTION_MAILBOX_DOMAIN,
    prisma: input.prisma,
    retainFailureInScopedCache: true,
    ...(input.signal ? { signal: input.signal } : {}),
    userId: routeCandidate.containerMemberId,
  });
  try {
    return {
      ingressRootKeyId: root.envelope.rootKeyId,
      route: routeCandidate,
    };
  } finally {
    root.rootKey.fill(0);
  }
}

async function appendPreparedHostedLinqGroupReactionMailboxTx(input: {
  actor: string;
  chatId: string;
  event: ParsedHostedLinqProviderEvent;
  prepared: PreparedHostedLinqGroupReactionContext;
  tx: Prisma.TransactionClient;
}): Promise<HostedLinqGroupReactionMailboxAppend | null> {
  await acquireHostedLinqChatOwnershipLockTx({
    chatId: input.chatId,
    tx: input.tx,
  });
  await lockHostedThreadRouteByThreadIdentityTx({
    authority: {
      channel: "linq",
      containerMemberId: input.prepared.route.containerMemberId,
      threadId: input.chatId,
    },
    prisma: input.tx,
  });

  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.tx,
    threadId: input.chatId,
  });
  if (!matchesHostedLinqGroupReactionRouteCandidate({
    candidate: input.prepared.route,
    route,
  })) {
    throw hostedLinqGroupReactionPreparationRequired("route");
  }

  if (!(await readActiveHostedMemberAccess({
    memberId: input.prepared.route.containerMemberId,
    prisma: input.tx,
  }))) {
    return null;
  }

  const activeRootKeyId = await lockAndReadActiveHostedDomainRootKeyIdTx({
    domain: HOSTED_LINQ_GROUP_REACTION_MAILBOX_DOMAIN,
    tx: input.tx,
    userId: input.prepared.route.containerMemberId,
  });
  if (activeRootKeyId !== input.prepared.ingressRootKeyId) {
    throw hostedLinqGroupReactionPreparationRequired("ingress-root");
  }

  return appendHostedLinqGroupReactionMailboxTx({
    actor: input.actor,
    event: input.event,
    route: {
      ...(input.prepared.route.accountLookupKey
        ? { accountLookupKey: input.prepared.route.accountLookupKey }
        : {}),
      containerMemberId: input.prepared.route.containerMemberId,
    },
    tx: input.tx,
  });
}

function requireHostedLinqGroupReactionRouteCandidate(
  route: HostedThreadRouteSnapshot,
): HostedLinqGroupReactionRouteCandidate {
  const state = route.deliveryRouteState;
  if (route.channel !== "linq" || !state) {
    throw new TypeError(
      "Hosted Linq group reaction preparation requires a canonical route snapshot.",
    );
  }
  return {
    accountLookupKey: route.accountLookupKey ?? null,
    containerMemberId: route.containerMemberId,
    deliveryRouteEncrypted: state.deliveryRouteEncrypted,
    deliveryRouteEncryptedPresent: state.deliveryRouteEncryptedPresent,
    threadIdentityLookupKey: state.threadIdentityLookupKey,
    threadLookupKey: state.threadLookupKey,
  };
}

function matchesHostedLinqGroupReactionRouteCandidate(input: {
  candidate: HostedLinqGroupReactionRouteCandidate;
  route: HostedThreadRouteSnapshot | null;
}): boolean {
  if (!input.route || input.route.channel !== "linq") {
    return false;
  }
  const state = input.route.deliveryRouteState;
  return Boolean(
    state
    && (input.route.accountLookupKey ?? null) === input.candidate.accountLookupKey
    && input.route.containerMemberId === input.candidate.containerMemberId
    && state.deliveryRouteEncrypted === input.candidate.deliveryRouteEncrypted
    && (
      state.deliveryRouteEncryptedPresent
        === input.candidate.deliveryRouteEncryptedPresent
    )
    && state.threadIdentityLookupKey === input.candidate.threadIdentityLookupKey
    && state.threadLookupKey === input.candidate.threadLookupKey
  );
}

function hostedLinqGroupReactionPreparationRequired(
  reason: "ingress-root" | "route",
) {
  return hostedOnboardingError({
    code: HOSTED_LINQ_GROUP_REACTION_PREPARATION_REQUIRED_CODE,
    details: { reason },
    httpStatus: 503,
    message: "Hosted Linq group reaction preparation is stale.",
    retryable: true,
  });
}

async function readHostedLinqReactionCanonicalChat(input: {
  actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
  chatId: string;
  signal?: AbortSignal;
}): Promise<{
  accountHandle: string;
  accountLookupKey: string;
  isGroup: boolean;
} | null> {
  const chat = await getHostedLinqChatSummary({
    chatId: input.chatId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (chat.isGroup === null) {
    return null;
  }
  const accountHandles = chat.handles.filter((handle) =>
    handle.isMe && isHostedLinqRosterHandleActive(handle.status),
  );
  const accountLookupKeys = new Set(
    accountHandles
      .map((handle) => createHostedPhoneLookupKey(handle.handle))
      .filter((value): value is string => value !== null),
  );
  if (accountLookupKeys.size !== 1) {
    return null;
  }
  const accountLookupKey = accountLookupKeys.values().next().value;
  const accountHandle = accountHandles.find((handle) =>
    createHostedPhoneLookupKey(handle.handle) === accountLookupKey,
  )?.handle;
  if (!accountLookupKey || !accountHandle) {
    return null;
  }

  const matchingActors = chat.handles.filter((handle) => {
    if (handle.isMe || !isHostedLinqRosterHandleActive(handle.status)) {
      return false;
    }
    const participant = createHostedLinqParticipantContact({
      kind: handle.handle.includes("@") ? "email" : "phone",
      value: handle.handle,
    });
    return participant?.kind === input.actor.kind
      && participant.lookupKey === input.actor.lookupKey;
  });
  return matchingActors.length === 1
    ? { accountHandle, accountLookupKey, isGroup: chat.isGroup }
    : null;
}

function isHostedLinqRosterHandleActive(
  status: string | null | undefined,
): boolean {
  return status?.trim().toLowerCase() === "active";
}

function readHostedLinqReactionEventContext(
  event: ParsedHostedLinqProviderEvent,
): {
  actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
  chatId: string;
  messageId: string;
  partIndex: number | null;
} | null {
  if (
    event.reactionIsFromMe === true
    || !event.linqChatId
    || !event.linqMessageId
    || !event.reactionFromHandle
  ) {
    return null;
  }
  const actor = createHostedLinqParticipantContact({
    kind: event.reactionFromHandle.includes("@") ? "email" : "phone",
    value: event.reactionFromHandle,
  });
  if (!actor) {
    return null;
  }
  return {
    actor,
    chatId: event.linqChatId,
    messageId: event.linqMessageId,
    partIndex: event.reactionPartIndex,
  };
}

function readHostedLinqReactionValue(event: ParsedHostedLinqProviderEvent): string {
  const value = event.reactionCustomEmoji?.trim()
    || event.reactionType?.trim().toLowerCase().replace(/[\s-]+/gu, "_")
    || "unknown";
  return Array.from(value)
    .slice(0, HOSTED_LINQ_GROUP_REACTION_VALUE_MAX_CHARS)
    .join("");
}

function readHostedLinqReactionLabel(event: ParsedHostedLinqProviderEvent): string {
  const token = event.reactionType?.trim().toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
  switch (token) {
    case "dislike":
    case "thumbs_down":
    case "thumbsdown":
      return "a dislike reaction";
    case "emphasize":
    case "exclamation":
      return "an emphasis reaction";
    case "laugh":
    case "laughed":
      return "a laugh reaction";
    case "like":
    case "thumbs_up":
    case "thumbsup":
      return "a like reaction";
    case "love":
    case "heart":
      return "a heart reaction";
    case "question":
      return "a question reaction";
    default:
      return event.reactionCustomEmoji ? "a custom reaction" : "a reaction";
  }
}
