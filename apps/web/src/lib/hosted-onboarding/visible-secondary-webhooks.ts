import "server-only";

import {
  buildTelegramThreadTarget,
  extractTelegramMessage,
} from "@murphai/messaging-ingress/telegram-webhook";

import { getPrisma } from "../prisma";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "./hosted-member-store";
import {
  parseHostedLinqWebhookEvent,
  sendHostedLinqChatMessage,
} from "./linq";
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
  getPrisma: typeof getPrisma;
  lookupHostedMemberByVerifiedEmailAddress: typeof lookupHostedMemberByVerifiedEmailAddress;
  lookupHostedMemberIdentityByPhoneNumber: typeof lookupHostedMemberIdentityByPhoneNumber;
  parseHostedLinqWebhookEvent: typeof parseHostedLinqWebhookEvent;
  sendHostedLinqChatMessage: typeof sendHostedLinqChatMessage;
};

export type HostedVisibleSecondaryTelegramDependencies = {
  parseHostedTelegramWebhookUpdate: typeof parseHostedTelegramWebhookUpdate;
  requireHostedOnboardingPublicBaseUrl: typeof requireHostedOnboardingPublicBaseUrl;
  sendHostedTelegramTextMessage: typeof sendHostedTelegramTextMessage;
  summarizeHostedTelegramWebhook: typeof summarizeHostedTelegramWebhook;
};

const defaultLinqDependencies: HostedVisibleSecondaryLinqDependencies = {
  getPrisma,
  lookupHostedMemberByVerifiedEmailAddress,
  lookupHostedMemberIdentityByPhoneNumber,
  parseHostedLinqWebhookEvent,
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
  "unassignable-home-line",
  "unattested-direct-chat",
  "unknown-home-line",
]);

const HOSTED_TELEGRAM_VISIBLE_SECONDARY_REASONS = new Set([
  "ambiguous-telegram-binding",
  "family-invite-not-accepted",
  "group-chat-provision-unavailable",
  "telegram-binding-changed",
  "unlinked-telegram",
]);

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

    const recognizedSender = HOSTED_LINQ_REASONS_REQUIRING_RECOGNIZED_SENDER.has(reason)
      ? await readHostedLinqSenderRecognized({
          participantContact: context.participantContact,
          prisma: input.prisma ?? dependencies.getPrisma(),
          dependencies,
        })
      : false;
    const message = resolveHostedLinqVisibleSecondaryReply({
      reason,
      recognizedSender,
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

async function readHostedLinqSenderRecognized(input: {
  participantContact: ReturnType<
    typeof resolveHostedOnboardingLinqMessageContext
  >["participantContact"];
  prisma: HostedOnboardingReadClient;
  dependencies: HostedVisibleSecondaryLinqDependencies;
}): Promise<boolean> {
  const participantContact = input.participantContact;
  if (!participantContact) {
    return false;
  }

  if (participantContact.kind === "phone") {
    return Boolean(await input.dependencies.lookupHostedMemberIdentityByPhoneNumber({
      phoneNumber: participantContact.value,
      prisma: input.prisma,
    }));
  }

  return Boolean(await input.dependencies.lookupHostedMemberByVerifiedEmailAddress({
    address: participantContact.value,
    prisma: input.prisma,
  }));
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
