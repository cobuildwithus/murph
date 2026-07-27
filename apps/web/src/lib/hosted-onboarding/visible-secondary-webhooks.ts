import "server-only";

import {
  buildTelegramThreadTarget,
  extractTelegramMessage,
} from "@murphai/messaging-ingress/telegram-webhook";
import type { HostedMember, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { readHostedMemberRoutingState } from "./hosted-member-routing-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "./hosted-member-store";
import {
  parseHostedLinqWebhookEvent,
  sendHostedLinqChatMessage,
} from "./linq";
import { getHostedLinqChatSummary } from "./linq-client";
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
const HOSTED_GROUP_CHAT_UNAVAILABLE_REPLY =
  "I couldn't connect this group chat to Murph. An active Murph member should message me from their usual account, then try again.";
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
};

export function withHostedVisibleSecondaryLinqOutcomes(
  handler: HostedOnboardingLinqWebhookHandler,
  dependencies: HostedVisibleSecondaryLinqDependencies = defaultLinqDependencies,
): HostedOnboardingLinqWebhookHandler {
  return async (input) => {
    const response = await handler(input);
    const reason = response.reason ?? "";
    if (!response.ignored || !HOSTED_LINQ_VISIBLE_SECONDARY_REASONS.has(reason)) {
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
    const recognizedSender = HOSTED_LINQ_REASONS_REQUIRING_RECOGNIZED_SENDER.has(reason)
      ? await readHostedLinqSender({
          participantContact: context.participantContact,
          prisma,
          dependencies,
        })
      : null;
    const privateRecovery =
      recognizedSender && HOSTED_LINQ_PRIVATE_GROUP_RECOVERY_REASONS.has(reason)
        ? await resolveHostedLinqPrivateGroupRecovery({
            currentChatId: context.summary.chatId,
            eventId: event.event_id,
            prisma,
            sender: recognizedSender,
            dependencies,
            ...(input.signal ? { signal: input.signal } : {}),
          })
        : null;
    if (privateRecovery) {
      await dependencies.sendHostedLinqChatMessage({
        chatId: privateRecovery.chatId,
        idempotencyKey: `visible-secondary-private:${event.event_id}`,
        message: privateRecovery.message,
        replyToMessageId: null,
        ...(input.signal ? { signal: input.signal } : {}),
      });

      return buildVisibleSecondaryResponse(response, reason);
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
    const reason = response.reason ?? "";
    if (!response.ignored || !HOSTED_TELEGRAM_VISIBLE_SECONDARY_REASONS.has(reason)) {
      return response;
    }

    // The wrapped handler verified the secret before returning. This second
    // parse only recovers the exact inbound thread and message to reply to.
    const update = dependencies.parseHostedTelegramWebhookUpdate(input.rawBody);
    const message = extractTelegramMessage(update);
    const summary = await dependencies.summarizeHostedTelegramWebhook(update);
    if (!message || !summary) {
      return response;
    }

    const signupUrl = reason === "unlinked-telegram"
      ? buildHostedSignupUrl(dependencies.requireHostedOnboardingPublicBaseUrl())
      : null;
    const reply = resolveHostedTelegramVisibleSecondaryReply({
      isDirect: summary.isDirect,
      reason,
      signupUrl,
    });
    if (!reply) {
      return response;
    }

    await dependencies.sendHostedTelegramTextMessage({
      message: reply,
      replyToMessageId: message.message_id,
      target: buildTelegramThreadTarget(message),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return buildVisibleSecondaryResponse(response, reason);
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
      return HOSTED_GROUP_CHAT_UNAVAILABLE_REPLY;
    case "group-chat":
      return input.recognizedSender ? HOSTED_GROUP_CHAT_UNAVAILABLE_REPLY : null;
    default:
      return null;
  }
}

export function resolveHostedTelegramVisibleSecondaryReply(input: {
  isDirect: boolean;
  reason: string;
  signupUrl: string | null;
}): string | null {
  switch (input.reason) {
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
      return input.isDirect ? null : HOSTED_GROUP_CHAT_UNAVAILABLE_REPLY;
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
  eventId: string;
  prisma: PrismaClient;
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
  const privateChatId = initialRouting?.linqChatId?.trim() ?? "";
  if (!privateChatId || privateChatId === input.currentChatId.trim()) {
    return null;
  }

  const readChatSummary =
    input.dependencies.getHostedLinqChatSummary
    ?? getHostedLinqChatSummary;
  try {
    const privateChat = await readChatSummary({
      chatId: privateChatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (privateChat.isGroup !== false) {
      return null;
    }
  } catch {
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
    noticeSeed: input.eventId,
    prisma: input.prisma,
  });
  if (access.kind === "allowed" || access.kind === "silent") {
    return null;
  }

  const currentRouting = await readRoutingState({
    memberId: input.sender.id,
    prisma: input.prisma,
  });
  if (currentRouting?.linqChatId?.trim() !== privateChatId) {
    return null;
  }

  return {
    chatId: privateChatId,
    message: buildHostedGroupChatAccessRecoveryMessage(access.message),
  };
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
