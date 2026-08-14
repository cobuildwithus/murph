import "server-only";

import {
  buildTelegramThreadTarget,
  extractTelegramMessage,
} from "@murphai/messaging-ingress/telegram-webhook";
import type { HostedMember, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { sha256Hex } from "../primitives";
import { isHostedOnboardingError } from "./errors";
import {
  buildHostedFamilyDraftCheckoutConflictReplyText,
} from "./family-plan";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { readHostedMemberRoutingState } from "./hosted-member-routing-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "./hosted-member-store";
import {
  parseHostedLinqWebhookEvent,
  sendHostedLinqChatMessage,
} from "./linq";
import { getHostedLinqChatSummary } from "./linq-client";
import { buildHostedLinqGroupSetupEffectId } from "./linq-group-setup";
import {
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  normalizeHostedLinqParticipantContactValue,
  type HostedLinqParticipantContact,
  type HostedLinqParticipantIdentity,
} from "./linq-participant-contact";
import { normalizePhoneNumber } from "./phone";
import {
  buildHostedGroupChatAccessRecoveryMessage,
  resolveHostedRecognizedInboundAccess,
} from "./recognized-inbound-access";
import { requireHostedOnboardingPublicBaseUrl } from "./runtime";
import type { HostedOnboardingReadClient } from "./shared";
import {
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import { sendHostedTelegramTextMessage } from "./telegram-client";
import { resolveHostedOnboardingLinqMessageContext } from "./webhook-provider-linq-shared";
import type {
  handleHostedOnboardingLinqWebhook,
  handleHostedOnboardingTelegramWebhook,
} from "./webhook-service";

export type HostedOnboardingLinqWebhookHandler = typeof handleHostedOnboardingLinqWebhook;
export type HostedOnboardingTelegramWebhookHandler = typeof handleHostedOnboardingTelegramWebhook;

export type HostedVisibleSecondaryLinqDependencies = {
  getHostedLinqChatSummary?: typeof getHostedLinqChatSummary;
  getPrisma: typeof getPrisma;
  lookupHostedMemberByVerifiedEmailAddress: typeof lookupHostedMemberByVerifiedEmailAddress;
  lookupHostedMemberIdentityByPhoneNumber: typeof lookupHostedMemberIdentityByPhoneNumber;
  parseHostedLinqWebhookEvent: typeof parseHostedLinqWebhookEvent;
  readHostedMemberRoutingState?: typeof readHostedMemberRoutingState;
  resolveHostedRecognizedInboundAccess?: typeof resolveHostedRecognizedInboundAccess;
  sendHostedLinqChatMessage: typeof sendHostedLinqChatMessage;
};

export type HostedVisibleSecondaryTelegramDependencies = {
  parseHostedTelegramWebhookUpdate: typeof parseHostedTelegramWebhookUpdate;
  requireHostedOnboardingPublicBaseUrl: typeof requireHostedOnboardingPublicBaseUrl;
  sendHostedTelegramTextMessage: typeof sendHostedTelegramTextMessage;
  summarizeHostedTelegramWebhook: typeof summarizeHostedTelegramWebhook;
};

const defaultLinqDependencies: HostedVisibleSecondaryLinqDependencies = {
  getHostedLinqChatSummary,
  getPrisma,
  lookupHostedMemberByVerifiedEmailAddress,
  lookupHostedMemberIdentityByPhoneNumber,
  parseHostedLinqWebhookEvent,
  readHostedMemberRoutingState,
  resolveHostedRecognizedInboundAccess,
  sendHostedLinqChatMessage,
};

const defaultTelegramDependencies: HostedVisibleSecondaryTelegramDependencies = {
  parseHostedTelegramWebhookUpdate,
  requireHostedOnboardingPublicBaseUrl,
  sendHostedTelegramTextMessage,
  summarizeHostedTelegramWebhook,
};

const HOSTED_FAMILY_INVITE_UNAVAILABLE_REPLY =
  "That Family invite isn't usable anymore. Ask the person who invited you for a fresh link.";
const HOSTED_LINQ_GROUP_CHAT_UNAVAILABLE_REPLY =
  "I couldn't connect this group chat to Murph. Message me privately first, then make sure this group includes that same Murph number and try again.";
const HOSTED_LINQ_CHAT_UNAVAILABLE_REPLY =
  "I couldn't connect this chat to Murph right now. Try again shortly. If it keeps happening, open Murph Settings.";
const HOSTED_LINQ_CHAT_UNVERIFIED_REPLY =
  "I couldn't verify this as your Murph chat. Message me from your usual Murph thread or reconnect messaging in Settings.";
const HOSTED_SIGNUP_LINK_REMINDER_REPLY =
  "I already sent your setup link in your Murph messages. Open it to finish setting up Murph.";
const HOSTED_TELEGRAM_BINDING_REPAIR_REPLY =
  "This Telegram account isn't linked cleanly. Reconnect Telegram in Murph Settings or contact support.";
const HOSTED_TELEGRAM_PRIVATE_SETUP_REPLY =
  "I can't finish that account setup in a group. Message me privately and I'll help you connect Murph.";
const HOSTED_TELEGRAM_GROUP_CHAT_UNAVAILABLE_REPLY =
  "I couldn't connect this group chat to Murph. Message me privately, then try again here.";

const HOSTED_LINQ_VISIBLE_SECONDARY_REASONS = new Set([
  "family-invite-not-accepted",
  "group-chat",
  "home-line-capacity-exhausted",
  "signup-link-already-sent",
  "thread-container-inactive",
  "unassignable-home-line",
  "unattested-direct-chat",
  "unknown-home-line",
]);

const HOSTED_LINQ_REASONS_REQUIRING_RECOGNIZED_SENDER = new Set([
  "group-chat",
  "home-line-capacity-exhausted",
  "thread-container-inactive",
  "unassignable-home-line",
  "unattested-direct-chat",
  "unknown-home-line",
]);

const HOSTED_LINQ_PRIVATE_GROUP_RECOVERY_REASONS = new Set([
  "group-chat",
  "thread-container-inactive",
]);

const HOSTED_TELEGRAM_VISIBLE_SECONDARY_REASONS = new Set([
  "ambiguous-telegram-binding",
  "family-invite-draft-recovery-required",
  "family-invite-not-accepted",
  "group-chat-provision-unavailable",
  "telegram-binding-changed",
  "unlinked-telegram",
]);

type HostedVisibleSecondaryLinqSender = Pick<
  HostedMember,
  "id" | "suspendedAt"
>;

type HostedVisibleSecondaryLinqPrivateRecovery = {
  chatId: string;
  message: string;
  recoveryKind: string;
};

type HostedVisibleSecondaryLinqPrivateRoute = {
  chatId: string;
  kind: "committed" | "pending";
  participantContact: HostedLinqParticipantIdentity;
  recipientPhone: string | null;
};

export function withHostedVisibleSecondaryLinqOutcomes(
  handler: HostedOnboardingLinqWebhookHandler,
  dependencies: HostedVisibleSecondaryLinqDependencies = defaultLinqDependencies,
): HostedOnboardingLinqWebhookHandler {
  return async (input) => {
    const response = await handler(input);
    const reason = response.reason ?? "";
    const groupSetupAlreadySent = !response.ignored && reason === "sent-group-setup";
    const needsVisibleSecondary = response.ignored
      && HOSTED_LINQ_VISIBLE_SECONDARY_REASONS.has(reason);
    if (!groupSetupAlreadySent && !needsVisibleSecondary) {
      return response;
    }

    // The wrapped handler verified the signature before returning. Parse the
    // already-authenticated body once more only to address the reply target.
    const event = dependencies.parseHostedLinqWebhookEvent(input.rawBody);
    if (event.event_type !== "message.received") {
      return response;
    }

    const context = resolveHostedOnboardingLinqMessageContext(event);
    if (context.summary.isFromMe) {
      return response;
    }

    const prisma = input.prisma ?? dependencies.getPrisma();
    const recognizedSender = (
      groupSetupAlreadySent
      || HOSTED_LINQ_REASONS_REQUIRING_RECOGNIZED_SENDER.has(reason)
    )
      ? await readHostedLinqSender({
          participantContact: context.participantContact,
          prisma,
          dependencies,
        })
      : null;
    const privateRecoveryReason = groupSetupAlreadySent ? "group-chat" : reason;
    const privateRecoverySeed = groupSetupAlreadySent && recognizedSender
      ? buildHostedLinqPrivateGroupSetupRecoverySeed({
          chatId: context.summary.chatId,
          memberId: recognizedSender.id,
          occurredAt: context.occurredAt,
        })
      : event.event_id;
    const privateRecovery =
      recognizedSender
      && HOSTED_LINQ_PRIVATE_GROUP_RECOVERY_REASONS.has(privateRecoveryReason)
        ? await resolveHostedLinqPrivateGroupRecovery({
            currentChatId: context.summary.chatId,
            incomingRecipientPhone: context.recipientPhoneNumber,
            participantContact: context.participantContact,
            prisma,
            reason: privateRecoveryReason,
            noticeSeed: privateRecoverySeed,
            sender: recognizedSender,
            dependencies,
            ...(input.signal ? { signal: input.signal } : {}),
          })
        : null;
    if (privateRecovery) {
      try {
        await dependencies.sendHostedLinqChatMessage({
          chatId: privateRecovery.chatId,
          idempotencyKey: groupSetupAlreadySent
            ? buildHostedLinqPrivateGroupSetupRecoveryId({
                recoveryKind: privateRecovery.recoveryKind,
                recoverySeed: privateRecoverySeed,
              })
            : `visible-secondary-private:${event.event_id}`,
          message: privateRecovery.message,
          replyToMessageId: null,
          ...(input.signal ? { signal: input.signal } : {}),
        });

        return groupSetupAlreadySent
          ? response
          : buildVisibleSecondaryResponse(response, reason);
      } catch (error) {
        if (!isHostedOnboardingError(error) || error.retryable) {
          throw error;
        }
        // A provider-confirmed permanent rejection means the private message
        // did not land. Continue to the neutral room response instead of
        // retrying a stale private route forever.
      }
    }

    // The primary handler already sent the account-neutral setup guidance to
    // the room. If private re-attestation is unavailable, do not add another
    // room message or reveal why the sender could not start the group.
    if (groupSetupAlreadySent) {
      return response;
    }

    const message = resolveHostedLinqVisibleSecondaryReply({
      reason,
      recognizedSender: Boolean(recognizedSender),
    });
    if (!message) {
      return response;
    }

    await dependencies.sendHostedLinqChatMessage({
      chatId: context.summary.chatId,
      idempotencyKey: `visible-secondary:${event.event_id}`,
      message,
      replyToMessageId: context.summary.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return buildVisibleSecondaryResponse(response, reason);
  };
}

export function withHostedVisibleSecondaryTelegramOutcomes(
  handler: HostedOnboardingTelegramWebhookHandler,
  dependencies: HostedVisibleSecondaryTelegramDependencies = defaultTelegramDependencies,
): HostedOnboardingTelegramWebhookHandler {
  return async (input) => {
    const response = await handler(input);
    const { familyInviteCode, ...publicResponse } = response;
    const reason = publicResponse.reason ?? "";
    if (!response.ignored || !HOSTED_TELEGRAM_VISIBLE_SECONDARY_REASONS.has(reason)) {
      return publicResponse;
    }

    // The wrapped handler verified the secret before returning. This second
    // parse only recovers the exact inbound thread and message to reply to.
    const update = dependencies.parseHostedTelegramWebhookUpdate(input.rawBody);
    const message = extractTelegramMessage(update);
    const summary = await dependencies.summarizeHostedTelegramWebhook(update);
    if (!message || !summary) {
      return publicResponse;
    }

    const signupUrl = reason === "unlinked-telegram"
      ? buildHostedSignupUrl(dependencies.requireHostedOnboardingPublicBaseUrl())
      : null;
    const reply = resolveHostedTelegramVisibleSecondaryReply({
      familyInviteCode,
      isDirect: summary.isDirect,
      reason,
      signupUrl,
    });
    if (!reply) {
      return publicResponse;
    }

    await dependencies.sendHostedTelegramTextMessage({
      message: reply,
      replyToMessageId: message.message_id,
      target: buildTelegramThreadTarget(message),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return buildVisibleSecondaryResponse(publicResponse, reason);
  };
}

export function resolveHostedLinqVisibleSecondaryReply(input: {
  reason: string;
  recognizedSender: boolean;
}): string | null {
  switch (input.reason) {
    case "family-invite-not-accepted":
      return HOSTED_FAMILY_INVITE_UNAVAILABLE_REPLY;
    case "signup-link-already-sent":
      return HOSTED_SIGNUP_LINK_REMINDER_REPLY;
    case "home-line-capacity-exhausted":
    case "unassignable-home-line":
      return input.recognizedSender ? HOSTED_LINQ_CHAT_UNAVAILABLE_REPLY : null;
    case "unattested-direct-chat":
    case "unknown-home-line":
      return input.recognizedSender ? HOSTED_LINQ_CHAT_UNVERIFIED_REPLY : null;
    case "thread-container-inactive":
      return HOSTED_LINQ_GROUP_CHAT_UNAVAILABLE_REPLY;
    case "group-chat":
      return input.recognizedSender
        ? HOSTED_LINQ_GROUP_CHAT_UNAVAILABLE_REPLY
        : null;
    default:
      return null;
  }
}

export function resolveHostedTelegramVisibleSecondaryReply(input: {
  familyInviteCode?: string | null;
  isDirect: boolean;
  reason: string;
  signupUrl: string | null;
}): string | null {
  switch (input.reason) {
    case "family-invite-draft-recovery-required":
      return input.isDirect && input.familyInviteCode
        ? buildHostedFamilyDraftCheckoutConflictReplyText({
            inviteCode: input.familyInviteCode,
          })
        : null;
    case "family-invite-not-accepted":
      return input.isDirect ? HOSTED_FAMILY_INVITE_UNAVAILABLE_REPLY : null;
    case "unlinked-telegram":
      if (!input.isDirect) {
        return HOSTED_TELEGRAM_PRIVATE_SETUP_REPLY;
      }
      return input.signupUrl
        ? `I can't match this Telegram account to Murph yet. Open this setup page and choose Telegram: ${input.signupUrl}\n\nThen message me again.`
        : null;
    case "ambiguous-telegram-binding":
    case "telegram-binding-changed":
      return input.isDirect
        ? HOSTED_TELEGRAM_BINDING_REPAIR_REPLY
        : HOSTED_TELEGRAM_PRIVATE_SETUP_REPLY;
    case "group-chat-provision-unavailable":
      return input.isDirect
        ? null
        : HOSTED_TELEGRAM_GROUP_CHAT_UNAVAILABLE_REPLY;
    default:
      return null;
  }
}

async function readHostedLinqSender(input: {
  participantContact: ReturnType<
    typeof resolveHostedOnboardingLinqMessageContext
  >["participantContact"];
  prisma: HostedOnboardingReadClient;
  dependencies: HostedVisibleSecondaryLinqDependencies;
}): Promise<HostedVisibleSecondaryLinqSender | null> {
  const participantContact = input.participantContact;
  if (!participantContact) {
    return null;
  }

  const memberLookup = participantContact.kind === "phone"
    ? await input.dependencies.lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: participantContact.value,
        prisma: input.prisma,
      })
    : await input.dependencies.lookupHostedMemberByVerifiedEmailAddress({
        address: participantContact.value,
        prisma: input.prisma,
      });
  if (!memberLookup) {
    return null;
  }

  return {
    id: memberLookup.core.id,
    suspendedAt: memberLookup.core.suspendedAt,
  };
}

async function resolveHostedLinqPrivateGroupRecovery(input: {
  currentChatId: string;
  dependencies: HostedVisibleSecondaryLinqDependencies;
  incomingRecipientPhone: string | null;
  noticeSeed: string;
  participantContact: HostedLinqParticipantContact | null;
  prisma: PrismaClient;
  reason: string;
  sender: HostedVisibleSecondaryLinqSender;
  signal?: AbortSignal;
}): Promise<HostedVisibleSecondaryLinqPrivateRecovery | null> {
  const readRoutingState =
    input.dependencies.readHostedMemberRoutingState
    ?? readHostedMemberRoutingState;
  const initialRouting = await readRoutingState({
    memberId: input.sender.id,
    prisma: input.prisma,
  });
  const privateRoute = resolveHostedLinqPrivateGroupRecoveryRoute({
    incomingRecipientPhone: input.incomingRecipientPhone,
    participantContact: input.participantContact,
    reason: input.reason,
    routing: initialRouting,
  });
  if (!privateRoute || privateRoute.chatId === input.currentChatId.trim()) {
    return null;
  }

  if (!await isHostedLinqPrivateRecoveryChatAttested({
    chatId: privateRoute.chatId,
    dependencies: input.dependencies,
    participantContact: input.participantContact,
    ...(input.signal ? { signal: input.signal } : {}),
  })) {
    // Never disclose account state to a route whose direct audience cannot be
    // re-attested. The ordinary privacy-safe group response remains available.
    return null;
  }

  const resolveAccess =
    input.dependencies.resolveHostedRecognizedInboundAccess
    ?? resolveHostedRecognizedInboundAccess;
  const access = await resolveAccess({
    allowSignupFallback: true,
    inviteChannel: "linq",
    member: input.sender,
    noticeSeed: input.noticeSeed,
    prisma: input.prisma,
  });
  if (access.kind === "allowed" || access.kind === "silent") {
    return null;
  }

  const currentRouting = await readRoutingState({
    memberId: input.sender.id,
    prisma: input.prisma,
  });
  if (
    !isSameHostedLinqPrivateRecoveryRoute(
      resolveHostedLinqPrivateGroupRecoveryRoute({
        incomingRecipientPhone: input.incomingRecipientPhone,
        participantContact: input.participantContact,
        reason: input.reason,
        routing: currentRouting,
      }),
      privateRoute,
    )
  ) {
    return null;
  }
  if (!await isHostedLinqPrivateRecoveryChatAttested({
    chatId: privateRoute.chatId,
    dependencies: input.dependencies,
    participantContact: input.participantContact,
    ...(input.signal ? { signal: input.signal } : {}),
  })) {
    return null;
  }

  return {
    chatId: privateRoute.chatId,
    message: buildHostedGroupChatAccessRecoveryMessage(access.message),
    recoveryKind: access.kind === "access_notice"
      ? `access-notice:${access.noticeCode}`
      : "signup",
  };
}

function buildHostedLinqPrivateGroupSetupRecoverySeed(input: {
  chatId: string;
  memberId: string;
  occurredAt: string;
}): string {
  const groupSetupEffectId = buildHostedLinqGroupSetupEffectId({
    chatId: input.chatId,
    occurredAt: input.occurredAt,
  });

  return `linq-group-private-recovery-seed:${sha256Hex(JSON.stringify({
    groupSetupEffectId,
    memberId: input.memberId,
  })).slice(0, 32)}`;
}

function buildHostedLinqPrivateGroupSetupRecoveryId(input: {
  recoveryKind: string;
  recoverySeed: string;
}): string {
  return `visible-secondary-private:${sha256Hex(JSON.stringify(input)).slice(0, 32)}`;
}

function resolveHostedLinqPrivateGroupRecoveryRoute(input: {
  incomingRecipientPhone: string | null;
  participantContact: HostedLinqParticipantContact | null;
  reason: string;
  routing: Awaited<ReturnType<typeof readHostedMemberRoutingState>>;
}): HostedVisibleSecondaryLinqPrivateRoute | null {
  const routing = input.routing;
  const participantContact = input.participantContact;
  if (!routing || !participantContact) {
    return null;
  }

  const participantLookupKeyCandidates =
    createHostedLinqParticipantContactLookupKeyReadCandidates(
      participantContact,
    );
  const committedRoute =
    routing.linqChatId?.trim()
    && routing.linqParticipantContact?.kind === participantContact.kind
    && participantLookupKeyCandidates.includes(
      routing.linqParticipantContact.lookupKey,
    )
      ? {
          chatId: routing.linqChatId.trim(),
          kind: "committed" as const,
          participantContact: routing.linqParticipantContact,
          recipientPhone: routing.linqRecipientPhone,
        }
      : null;
  const pendingRoute =
    routing.pendingLinqChatId?.trim()
    && routing.pendingLinqParticipantContact?.kind === participantContact.kind
    && participantLookupKeyCandidates.includes(
      routing.pendingLinqParticipantContact.lookupKey,
    )
      ? {
          chatId: routing.pendingLinqChatId.trim(),
          kind: "pending" as const,
          participantContact: routing.pendingLinqParticipantContact,
          recipientPhone: routing.pendingLinqRecipientPhone,
        }
      : null;
  const route = committedRoute ?? pendingRoute;
  if (!route) {
    return null;
  }

  if (input.reason === "group-chat") {
    const incomingRecipientPhone = normalizePhoneNumber(
      input.incomingRecipientPhone,
    );
    const privateRouteRecipientPhone = normalizePhoneNumber(
      route.recipientPhone,
    );
    if (
      !incomingRecipientPhone
      || !privateRouteRecipientPhone
      || incomingRecipientPhone !== privateRouteRecipientPhone
    ) {
      return null;
    }
  }

  return route;
}

function isSameHostedLinqPrivateRecoveryRoute(
  currentRoute: HostedVisibleSecondaryLinqPrivateRoute | null,
  initialRoute: HostedVisibleSecondaryLinqPrivateRoute,
): boolean {
  return Boolean(
    currentRoute
    && currentRoute.chatId === initialRoute.chatId
    && currentRoute.kind === initialRoute.kind
    && currentRoute.participantContact.kind
      === initialRoute.participantContact.kind
    && currentRoute.participantContact.lookupKey
      === initialRoute.participantContact.lookupKey
    && normalizePhoneNumber(currentRoute.recipientPhone)
      === normalizePhoneNumber(initialRoute.recipientPhone),
  );
}

async function isHostedLinqPrivateRecoveryChatAttested(input: {
  chatId: string;
  dependencies: HostedVisibleSecondaryLinqDependencies;
  participantContact: HostedLinqParticipantContact | null;
  signal?: AbortSignal;
}): Promise<boolean> {
  const participantContact = input.participantContact;
  if (!participantContact) {
    return false;
  }

  const readChatSummary =
    input.dependencies.getHostedLinqChatSummary
    ?? getHostedLinqChatSummary;
  try {
    const privateChat = await readChatSummary({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const expectedParticipantValue =
      normalizeHostedLinqParticipantContactValue(participantContact);
    if (privateChat.isGroup !== false || !expectedParticipantValue) {
      return false;
    }

    const participantHandles = privateChat.handles
      .filter((handle) =>
        !handle.isMe
        && (!handle.status || handle.status.trim().toLowerCase() === "active")
      )
      .map((handle) => normalizeHostedLinqParticipantContactValue({
        kind: participantContact.kind,
        value: handle.handle,
      }));
    return (
      participantHandles.length > 0
      && participantHandles.every(
        (handle) => handle === expectedParticipantValue,
      )
    );
  } catch {
    return false;
  }
}

function buildHostedSignupUrl(publicBaseUrl: string): string {
  return new URL("/", publicBaseUrl).toString();
}

function buildVisibleSecondaryResponse<TResponse extends {
  ignored?: boolean;
  ok: true;
  reason?: string;
}>(
  response: TResponse,
  originalReason: string,
): TResponse {
  return {
    ...response,
    ignored: false,
    reason: `visible-secondary-reply:${originalReason}`,
  };
}
