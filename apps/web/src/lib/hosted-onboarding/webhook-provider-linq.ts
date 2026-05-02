import type { Prisma } from "@prisma/client";
import {
  type HostedExecutionLinqConversationMessage,
  type HostedExecutionLinqConversationMessagePart,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

import { hostedOnboardingError } from "./errors";
import { issueHostedInviteTx } from "./invite-service";
import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import { ensureHostedMemberForPhoneTx } from "./member-identity-service";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
  incrementHostedLinqOutboundDailyState,
} from "./linq-daily-state";
import {
  type HostedLinqMessageReceivedEvent,
  type HostedLinqWebhookEvent,
} from "./linq";
import {
  resolveHostedLinqActiveRouteDecision,
  resolveHostedLinqHomeBindingRecipientPhone,
} from "./linq-routing-policy";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import {
  createHostedPhoneLookupKey,
} from "./contact-privacy";
import {
  bindHostedMemberHomeLinqChatAndTrackInbound,
  bindHostedMemberPendingLinqChatAndTrackInbound,
  buildActiveMemberDirectPlan,
  buildConversationHomeRedirectResponse,
  buildIgnoredLinqWebhookPlan,
  buildQuotaReplyResponse,
  buildSignupLinkResponse,
  isHostedLinqIMessageFirstContact,
  resolveHostedOnboardingLinqMessageContext,
} from "./webhook-provider-linq-shared";
export type {
  HostedOnboardingLinqDirectPlan,
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type {
  HostedOnboardingLinqDirectPlan,
} from "./webhook-provider-linq-types";

const HOSTED_LINQ_MESSAGE_MAX_PARTS = 32;
const HOSTED_LINQ_MESSAGE_MAX_SERIALIZED_PARTS_BYTES = 128 * 1024;
const HOSTED_LINQ_CONVERSATION_WAKE_INLINE_TARGET_BYTES = 128 * 1024;
const HOSTED_LINQ_TEXT_PART_MAX_CHARS = 20_000;
const HOSTED_LINQ_COMPACT_TEXT_BUDGET_CHARS = 20_000;
const HOSTED_LINQ_ATTACHMENT_ID_MAX_CHARS = 256;
const HOSTED_LINQ_ATTACHMENT_FILE_NAME_MAX_CHARS = 160;
const HOSTED_LINQ_ATTACHMENT_MIME_TYPE_MAX_CHARS = 120;
const HOSTED_LINQ_STAGING_NOTE_PART_TYPE = "text";

export async function planHostedOnboardingLinqWebhook(input: {
  event: HostedLinqWebhookEvent;
  prisma: Prisma.TransactionClient;
}): Promise<HostedOnboardingLinqDirectPlan> {
  if (input.event.event_type !== "message.received") {
    return buildIgnoredLinqWebhookPlan(input.event.event_type);
  }

  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  const {
    messageEvent,
    occurredAt,
    participantPhoneNumber,
    recipientPhoneNumber,
    summary,
  } = context;

  if (!participantPhoneNumber) {
    return buildIgnoredLinqWebhookPlan(summary.isFromMe ? "own-message" : "invalid-phone");
  }

  const phoneLookupKey = createHostedPhoneLookupKey(participantPhoneNumber);

  if (!phoneLookupKey) {
    return buildIgnoredLinqWebhookPlan("invalid-phone");
  }

  const existingMemberLookup = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: participantPhoneNumber,
    prisma: input.prisma,
  });
  const existingMember = existingMemberLookup?.core ?? null;

  if (summary.isFromMe) {
    if (existingMember) {
      await incrementHostedLinqOutboundDailyState({
        memberId: existingMember.id,
        occurredAt,
        prisma: input.prisma,
      });
    }

    return buildIgnoredLinqWebhookPlan("own-message");
  }

  if (existingMember && isHostedMemberSuspended(existingMember.suspendedAt)) {
    return buildIgnoredLinqWebhookPlan("suspended-member");
  }

  if (existingMember && hasHostedMemberActiveAccess(existingMember)) {
    const member = await readHostedMemberSnapshot({
      memberId: existingMember.id,
      prisma: input.prisma,
    });

    if (!member) {
      return buildIgnoredLinqWebhookPlan("missing-member");
    }

    const routeDecision = resolveHostedLinqActiveRouteDecision({
      homeChatId: member.routing?.linqChatId ?? null,
      homeRecipientPhone: member.routing?.linqRecipientPhone ?? null,
      incomingChatId: summary.chatId,
      incomingRecipientPhone: recipientPhoneNumber,
    });

    if (routeDecision.kind === "redirect_to_home") {
      assertHostedLinqMailboxPartsWithinSideEffectLimit(messageEvent.data.message.parts);

      return buildConversationHomeRedirectResponse({
        chatId: summary.chatId,
        homeRecipientPhone: routeDecision.homeRecipientPhone,
        memberId: existingMember.id,
        messageId: summary.messageId,
        sourceEventId: input.event.event_id,
      });
    }

    if (routeDecision.kind === "ignore_unknown_home") {
      return buildIgnoredLinqWebhookPlan("unknown-home-line");
    }

    const dailyState = await bindHostedMemberHomeLinqChatAndTrackInbound({
      chatId: summary.chatId,
      memberId: existingMember.id,
      occurredAt,
      prisma: input.prisma,
      recipientPhone: resolveHostedLinqHomeBindingRecipientPhone({
        homeChatId: member.routing?.linqChatId ?? null,
        homeRecipientPhone: member.routing?.linqRecipientPhone ?? null,
        incomingChatId: summary.chatId,
        incomingRecipientPhone: recipientPhoneNumber,
      }),
    });

    if (dailyState.inboundCount > 100) {
      if (dailyState.quotaReplySentAt) {
        return buildIgnoredLinqWebhookPlan("daily-quota-reached");
      }

      const claimedQuotaReply = await claimHostedLinqQuotaReplyNotice({
        memberId: existingMember.id,
        occurredAt,
        prisma: input.prisma,
      });

      if (!claimedQuotaReply) {
        return buildIgnoredLinqWebhookPlan("daily-quota-reached");
      }

      return buildQuotaReplyResponse({
        chatId: summary.chatId,
        messageId: summary.messageId,
        sourceEventId: input.event.event_id,
      });
    }

    const mailboxWake = buildHostedLinqConversationWakeForMailbox({
      eventId: input.event.event_id,
      linqMessage: {
        chatId: summary.chatId,
        from: participantPhoneNumber,
        isFromMe: summary.isFromMe,
        messageId: summary.messageId,
        ...(messageEvent.data.message.reply_to?.message_id === undefined
          ? {}
          : { replyToMessageId: messageEvent.data.message.reply_to.message_id }),
        ...(messageEvent.data.message.reply_to?.part_index === undefined
          ? {}
          : { replyToPartIndex: messageEvent.data.message.reply_to.part_index }),
        ...(messageEvent.data.service === undefined ? {} : { service: messageEvent.data.service }),
      },
      occurredAt,
      phoneLookupKey,
      rawParts: messageEvent.data.message.parts,
      userId: existingMember.id,
    });

    const mailboxAppend = await appendHostedMailboxEnvelopeTx({
      envelope: mailboxWake,
      tx: input.prisma,
    });

    return {
      ...buildActiveMemberDirectPlan({
        desiredSideEffects: [],
        response: {
          ok: true,
          ignored: false,
          reason: "wake-appended-active-member",
        },
        wakeMailboxItemId: mailboxAppend.item.id,
        wakeUserId: existingMember.id,
      }),
      ingressReadReceiptChatId: summary.chatId,
    };
  }

  if (!isHostedLinqIMessageFirstContact(messageEvent)) {
    return buildIgnoredLinqWebhookPlan("non-imessage-first-contact");
  }

  assertHostedLinqMailboxPartsWithinSideEffectLimit(messageEvent.data.message.parts);

  const member = existingMember ?? await ensureHostedMemberForPhoneTx({
    phoneNumber: participantPhoneNumber,
    prisma: input.prisma,
  });
  const dailyState = await bindHostedMemberPendingLinqChatAndTrackInbound({
    chatId: summary.chatId,
    memberId: member.id,
    occurredAt,
    prisma: input.prisma,
    recipientPhone: recipientPhoneNumber,
  });

  if (dailyState.onboardingLinkSentAt) {
    return buildIgnoredLinqWebhookPlan("signup-link-already-sent");
  }

  const claimedOnboardingLink = await claimHostedLinqOnboardingLinkNotice({
    memberId: member.id,
    occurredAt,
    prisma: input.prisma,
  });

  if (!claimedOnboardingLink) {
    return buildIgnoredLinqWebhookPlan("signup-link-already-sent");
  }

  const invite = await issueHostedInviteTx({
    channel: "linq",
    memberId: member.id,
    prisma: input.prisma,
  });

  return buildSignupLinkResponse({
    chatId: summary.chatId,
    inviteCode: invite.inviteCode,
    inviteId: invite.id,
    messageId: summary.messageId,
    sourceEventId: input.event.event_id,
  });
}

function buildHostedLinqConversationWakeForMailbox(input: {
  eventId: string;
  linqMessage: Omit<HostedExecutionLinqConversationMessage, "parts">;
  occurredAt: string;
  phoneLookupKey: string;
  rawParts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"];
  userId: string;
}): ReturnType<typeof buildHostedExecutionLinqConversationMessageWake> {
  const fullWake = buildHostedExecutionLinqConversationMessageWake({
    eventId: input.eventId,
    linqMessage: {
      ...input.linqMessage,
      parts: buildHostedLinqMailboxParts(input.rawParts, "normal"),
    },
    occurredAt: input.occurredAt,
    phoneLookupKey: input.phoneLookupKey,
    userId: input.userId,
  });
  if (serializedHostedLinqWakeBytes(fullWake) <= HOSTED_LINQ_CONVERSATION_WAKE_INLINE_TARGET_BYTES) {
    return fullWake;
  }

  const compactWake = buildHostedExecutionLinqConversationMessageWake({
    eventId: input.eventId,
    linqMessage: {
      ...input.linqMessage,
      parts: buildHostedLinqMailboxParts(input.rawParts, "compact"),
    },
    occurredAt: input.occurredAt,
    phoneLookupKey: input.phoneLookupKey,
    userId: input.userId,
  });
  if (serializedHostedLinqWakeBytes(compactWake) <= HOSTED_LINQ_CONVERSATION_WAKE_INLINE_TARGET_BYTES) {
    return compactWake;
  }

  return buildHostedExecutionLinqConversationMessageWake({
    eventId: input.eventId,
    linqMessage: {
      ...input.linqMessage,
      parts: buildMinimalHostedLinqMailboxParts(input.rawParts),
    },
    occurredAt: input.occurredAt,
    phoneLookupKey: input.phoneLookupKey,
    userId: input.userId,
  });
}

type HostedLinqMailboxPartCompactionMode = "normal" | "compact";

function buildHostedLinqMailboxParts(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
  mode: HostedLinqMailboxPartCompactionMode,
): HostedExecutionLinqConversationMessagePart[] {
  const maxParts = mode === "compact" ? Math.min(16, HOSTED_LINQ_MESSAGE_MAX_PARTS) : HOSTED_LINQ_MESSAGE_MAX_PARTS;
  const mailboxParts: HostedExecutionLinqConversationMessagePart[] = [];
  let textBudget = mode === "compact"
    ? HOSTED_LINQ_COMPACT_TEXT_BUDGET_CHARS
    : HOSTED_LINQ_TEXT_PART_MAX_CHARS;
  const omittedParts = Math.max(0, parts.length - maxParts);
  let truncatedContent = false;

  for (const part of parts.slice(0, maxParts)) {
    if (part.type === "text" || part.type === "link") {
      const value = normalizeHostedLinqPartText(part.value);
      if (!value) {
        continue;
      }

      const truncated = truncateHostedLinqPartText(value, textBudget);
      if (truncated.truncated) {
        truncatedContent = true;
      }
      if (truncated.value) {
        mailboxParts.push({
          type: part.type,
          value: truncated.value,
        });
        textBudget = Math.max(0, textBudget - truncated.value.length);
      }
      continue;
    }

    mailboxParts.push({
      ...(part.attachment_id === undefined
        ? {}
        : { attachmentId: truncateHostedLinqScalar(part.attachment_id, HOSTED_LINQ_ATTACHMENT_ID_MAX_CHARS) }),
      ...(mode === "compact" || part.filename === undefined
        ? {}
        : { fileName: truncateHostedLinqScalar(part.filename, HOSTED_LINQ_ATTACHMENT_FILE_NAME_MAX_CHARS) }),
      ...(part.mime_type === undefined
        ? {}
        : { mimeType: truncateHostedLinqScalar(part.mime_type, HOSTED_LINQ_ATTACHMENT_MIME_TYPE_MAX_CHARS) }),
      ...(part.size === undefined ? {} : { size: normalizeHostedLinqPartSize(part.size) }),
      type: part.type,
      // Do not persist signed attachment URLs in canonical mailbox payloads.
    });
  }

  if (omittedParts > 0 || truncatedContent || mode === "compact") {
    return appendHostedLinqStagingNote(mailboxParts, {
      mode,
      omittedParts,
      truncatedContent,
    });
  }

  return mailboxParts;
}

function assertHostedLinqMailboxPartsWithinSideEffectLimit(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
): void {
  if (parts.length > HOSTED_LINQ_MESSAGE_MAX_PARTS) {
    throw hostedOnboardingError({
      code: "LINQ_MESSAGE_PARTS_TOO_MANY",
      httpStatus: 413,
      message: "Linq webhook message contains too many parts.",
      retryable: false,
    });
  }

  const mailboxParts = parts.map(buildHostedLinqMailboxPartForLimitCheck);
  const serializedParts = JSON.stringify(mailboxParts);
  const serializedPartsBytes = new TextEncoder().encode(serializedParts).byteLength;

  if (serializedPartsBytes > HOSTED_LINQ_MESSAGE_MAX_SERIALIZED_PARTS_BYTES) {
    throw hostedOnboardingError({
      code: "LINQ_MESSAGE_PARTS_TOO_LARGE",
      httpStatus: 413,
      message: "Linq webhook message parts are too large.",
      retryable: false,
    });
  }
}

function buildHostedLinqMailboxPartForLimitCheck(
  part: HostedLinqMessageReceivedEvent["data"]["message"]["parts"][number],
): HostedExecutionLinqConversationMessagePart {
  return part.type === "text" || part.type === "link"
    ? {
        type: part.type,
        value: part.value,
      }
    : {
        ...(part.attachment_id === undefined ? {} : { attachmentId: part.attachment_id }),
        ...(part.filename === undefined ? {} : { fileName: part.filename }),
        ...(part.mime_type === undefined ? {} : { mimeType: part.mime_type }),
        ...(part.size === undefined ? {} : { size: part.size }),
        type: part.type,
      };
}

function buildMinimalHostedLinqMailboxParts(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
): HostedExecutionLinqConversationMessagePart[] {
  const text = parts
    .filter((part) => part.type === "text" || part.type === "link")
    .map((part) => normalizeHostedLinqPartText(part.value) ?? "")
    .filter(Boolean)
    .join("\n")
    .slice(0, HOSTED_LINQ_COMPACT_TEXT_BUDGET_CHARS);
  const attachmentCount = parts.filter((part) => part.type === "media" || part.type === "voice_memo").length;
  const note = [
    "Internal staging note: this Linq message exceeded hosted mailbox staging limits and was compacted before assistant processing.",
    attachmentCount > 0
      ? `Attachment descriptors may be incomplete; original attachment count: ${attachmentCount}.`
      : null,
  ].filter((line): line is string => line !== null).join(" ");

  return [
    ...(text
      ? [{ type: "text", value: text } satisfies HostedExecutionLinqConversationMessagePart]
      : []),
    {
      type: HOSTED_LINQ_STAGING_NOTE_PART_TYPE,
      value: note,
    },
  ];
}

function appendHostedLinqStagingNote(
  parts: HostedExecutionLinqConversationMessagePart[],
  input: {
    mode: HostedLinqMailboxPartCompactionMode;
    omittedParts: number;
    truncatedContent: boolean;
  },
): HostedExecutionLinqConversationMessagePart[] {
  const details = [
    input.mode === "compact" ? "payload was compacted" : null,
    input.omittedParts > 0 ? `${input.omittedParts} part(s) omitted` : null,
    input.truncatedContent ? "some content truncated" : null,
  ].filter((detail): detail is string => detail !== null);

  if (details.length === 0) {
    return parts;
  }

  return [
    ...parts,
    {
      type: HOSTED_LINQ_STAGING_NOTE_PART_TYPE,
      value: `Internal staging note: ${details.join("; ")}.`,
    },
  ];
}

function serializedHostedLinqWakeBytes(
  wake: ReturnType<typeof buildHostedExecutionLinqConversationMessageWake>,
): number {
  return new TextEncoder().encode(JSON.stringify(wake)).byteLength;
}

function normalizeHostedLinqPartText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function truncateHostedLinqPartText(value: string, maxChars: number): {
  truncated: boolean;
  value: string;
} {
  if (maxChars <= 0) {
    return {
      truncated: true,
      value: "",
    };
  }
  if (value.length <= maxChars) {
    return {
      truncated: false,
      value,
    };
  }

  const suffix = "... [truncated]";
  return {
    truncated: true,
    value: `${value.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`,
  };
}

function truncateHostedLinqScalar(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.length <= maxChars
    ? normalized
    : normalized.slice(0, maxChars);
}

function normalizeHostedLinqPartSize(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
