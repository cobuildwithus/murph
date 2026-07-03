import type { Prisma } from "@prisma/client";

import {
  buildHostedInviteUrl,
} from "./invite-service";
import type { HostedAiUsageGateNoticeCode } from "../hosted-execution/usage-allowance";
import {
  incrementHostedLinqInboundDailyState,
} from "./linq-daily-state";
import {
  recordHostedMemberLinqInboundEngagementTx,
} from "./linq-egress-engagement";
import {
  type HostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqOccurredAt,
  resolveHostedLinqParticipantContact,
  resolveHostedLinqParticipantEmailAddress,
  resolveHostedLinqParticipantPhoneNumber,
  resolveHostedLinqRecipientPhoneNumber,
  summarizeHostedLinqMessage,
} from "./linq";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import {
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx,
} from "./hosted-member-routing-store";
import {
  createHostedWebhookLinqMessageSideEffect,
  type HostedLinqAiUsageQuotaClaimToken,
  type HostedLinqMessageSideEffect,
} from "./webhook-transport";
import type {
  HostedLinqThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import type {
  HostedOnboardingLinqDirectPlan,
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type { HostedWebhookPlan } from "./webhook-service-types";

type HostedLinqMessageReceivedEvent = ReturnType<typeof requireHostedLinqMessageReceivedEvent>;

export type HostedOnboardingLinqMessageContext = {
  messageEvent: HostedLinqMessageReceivedEvent;
  occurredAt: string;
  participantContact: HostedLinqParticipantContact | null;
  participantEmailAddress: string | null;
  participantPhoneNumber: string | null;
  recipientPhoneNumber: string | null;
  summary: ReturnType<typeof summarizeHostedLinqMessage>;
};

export function isHostedLinqDeliverableFirstContact(input: {
  event: HostedLinqMessageReceivedEvent;
  participantContact: HostedLinqParticipantContact;
}): boolean {
  if (input.participantContact.kind === "phone") {
    return true;
  }

  return isHostedLinqIMessageService(input.event.data.service);
}

export function hostedLinqFirstContactContainsBlockedContent(input: {
  event: HostedLinqMessageReceivedEvent;
  participantContact: HostedLinqParticipantContact;
}): boolean {
  const blocksStandaloneSmsOptOutCommand = shouldBlockStandaloneSmsOptOutCommand({
    participantContact: input.participantContact,
    service: input.event.data.service,
  });

  return input.event.data.message.parts.some((part) => {
    if (part.type === "link") {
      return true;
    }

    if (part.type === "text") {
      return containsUrlLikeText(part.value)
        || containsSmsOptOutBoilerplate(part.value)
        || (
          blocksStandaloneSmsOptOutCommand
          && containsStandaloneSmsOptOutCommand(part.value)
        );
    }

    return false;
  });
}

export function isHostedLinqIMessageService(
  value: string | null | undefined,
): boolean {
  return normalizeHostedLinqService(value) === "imessage";
}

export function resolveHostedOnboardingLinqMessageContext(
  event: HostedLinqWebhookEvent,
): HostedOnboardingLinqMessageContext {
  const messageEvent = requireHostedLinqMessageReceivedEvent(event);

  return {
    messageEvent,
    occurredAt: resolveHostedLinqOccurredAt(messageEvent),
    participantContact: resolveHostedLinqParticipantContact(messageEvent),
    participantEmailAddress: resolveHostedLinqParticipantEmailAddress(messageEvent),
    participantPhoneNumber: resolveHostedLinqParticipantPhoneNumber(messageEvent),
    recipientPhoneNumber: resolveHostedLinqRecipientPhoneNumber(messageEvent),
    summary: summarizeHostedLinqMessage(messageEvent),
  };
}

export function buildIgnoredLinqWebhookPlan(
  reason: string,
): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [],
    response: {
      ok: true,
      ignored: true,
      reason,
    },
  });
}

export function buildSignupLinkResponse(input: {
  chatId: string;
  inviteCode: string;
  inviteId: string;
  memberId: string;
  messageId: string;
  occurredAt: string;
  service?: string | null;
  sourceEventId: string;
  threadIsDirect?: boolean | null;
}): HostedOnboardingLinqDirectPlan {
  const joinUrl = buildHostedInviteUrl(input.inviteCode);

  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        inviteId: input.inviteId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        service: input.service ?? null,
        sourceEventId: input.sourceEventId,
        threadIsDirect: input.threadIsDirect ?? null,
        template: "invite_signup",
      }),
    ],
    response: {
      ok: true,
      inviteCode: input.inviteCode,
      joinUrl,
      reason: "sent-signup-link",
    },
  });
}

export function buildFallbackSignupLinkResponse(input: {
  assignedPhone: string;
  inviteCode: string;
  inviteId: string;
  memberId: string;
  memberPhone: string;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  const joinUrl = buildHostedInviteUrl(input.inviteCode);

  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        assignedRecipientPhone: input.assignedPhone,
        inviteId: input.inviteId,
        memberId: input.memberId,
        memberPhone: input.memberPhone,
        occurredAt: input.occurredAt,
        sourceEventId: input.sourceEventId,
        template: "invite_signup_fallback",
      }),
    ],
    response: {
      ok: true,
      inviteCode: input.inviteCode,
      joinUrl,
      reason: "sent-signup-link",
    },
  });
}

export function buildFamilyInviteAcceptedResponse(input: {
  chatId: string;
  memberId: string;
  message: string;
  messageId: string;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        memberId: input.memberId,
        message: input.message,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "family_invite_reply",
      }),
    ],
    response: {
      ok: true,
      reason: "family-invite-accepted",
    },
  });
}

export function buildActiveMemberDirectPlan(
  plan: HostedWebhookPlan<HostedOnboardingLinqWebhookResponse, HostedLinqMessageSideEffect>,
): HostedOnboardingLinqDirectPlan {
  return plan;
}

export function buildAiUsageQuotaReplyResponse(input: {
  chatId: string;
  claimToken: HostedLinqAiUsageQuotaClaimToken | null;
  memberId: string;
  message: string;
  messageId: string;
  noticeCode: HostedAiUsageGateNoticeCode;
  occurredAt: string;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  service?: string | null;
  sourceEventId: string;
  threadIsDirect?: boolean | null;
}): HostedOnboardingLinqDirectPlan {
  const baseInput = {
    chatId: input.chatId,
    memberId: input.memberId,
    message: input.message,
    occurredAt: input.occurredAt,
    replyToMessageId: input.messageId,
    ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
    service: input.service ?? null,
    sourceEventId: input.sourceEventId,
    threadIsDirect: input.threadIsDirect ?? null,
    template: "ai_usage_quota" as const,
  };

  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      input.claimToken
        ? createHostedWebhookLinqMessageSideEffect({
            ...baseInput,
            claimToken: input.claimToken,
            noticeCode: requireHostedLinqUsageLimitNoticeCode(input.noticeCode),
          })
        : createHostedWebhookLinqMessageSideEffect({
            ...baseInput,
            claimToken: null,
            noticeCode: requireHostedLinqTrialConversionNoticeCode(input.noticeCode),
          }),
    ],
    response: {
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    },
  });
}

export function buildConversationHomeRedirectResponse(input: {
  chatId: string;
  homeRecipientPhone: string;
  memberId: string;
  messageId: string;
  service?: string | null;
  sourceEventId: string;
  threadIsDirect?: boolean | null;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        // Keep the current home line as an operational fallback so deferred
        // receipt sends do not depend on routing still being present later.
        homeRecipientPhone: input.homeRecipientPhone,
        memberId: input.memberId,
        replyToMessageId: input.messageId,
        service: input.service ?? null,
        sourceEventId: input.sourceEventId,
        threadIsDirect: input.threadIsDirect ?? null,
        template: "conversation_home_redirect",
      }),
    ],
    response: {
      ok: true,
      reason: "redirected-to-home-line",
    },
  });
}

export function buildQuotaReplyResponse(input: {
  chatId: string;
  memberId: string;
  messageId: string;
  occurredAt: string;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  service?: string | null;
  sourceEventId: string;
  threadIsDirect?: boolean | null;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        service: input.service ?? null,
        sourceEventId: input.sourceEventId,
        threadIsDirect: input.threadIsDirect ?? null,
        template: "daily_quota",
      }),
    ],
    response: {
      ok: true,
      reason: "sent-daily-quota-reply",
    },
  });
}

export async function bindHostedMemberHomeLinqChatAndTrackInbound(input: {
  chatId: string;
  homeLineAssignedAt?: Date | null;
  memberId: string;
  occurredAt: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
  routeAlreadyBound?: boolean;
}) {
  if (input.routeAlreadyBound !== true) {
    await upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      homeLineAssignedAt: input.homeLineAssignedAt ?? null,
      linqChatId: input.chatId,
      memberId: input.memberId,
      prisma: input.prisma,
      recipientPhone: input.recipientPhone,
    });
  }

  await recordHostedMemberLinqInboundEngagementTx({
    chatId: input.chatId,
    linePhoneNumber: input.recipientPhone,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });

  return incrementHostedLinqInboundDailyState({
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });
}

function requireHostedLinqUsageLimitNoticeCode(
  code: HostedAiUsageGateNoticeCode,
): Exclude<HostedAiUsageGateNoticeCode, "trial_conversion_pending"> {
  if (code === "trial_conversion_pending") {
    throw new TypeError(
      "Hosted Linq AI usage-limit notices require usage-limit notice codes.",
    );
  }

  return code;
}

function requireHostedLinqTrialConversionNoticeCode(
  code: HostedAiUsageGateNoticeCode,
): "trial_conversion_pending" {
  if (code !== "trial_conversion_pending") {
    throw new TypeError(
      "Hosted Linq trial conversion notices require the trial conversion notice code.",
    );
  }

  return code;
}

export async function bindHostedMemberPendingLinqChatAndTrackInbound(input: {
  chatId: string;
  homeLineAssignedAt?: Date | null;
  memberId: string;
  occurredAt: string;
  participantContact?: HostedLinqParticipantContact | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}) {
  await upsertHostedMemberPendingLinqBindingTx({
    homeLineAssignedAt: input.homeLineAssignedAt ?? null,
    linqChatId: input.chatId,
    memberId: input.memberId,
    participantContact: input.participantContact ?? null,
    participantContactObservedAt: new Date(input.occurredAt),
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });

  await recordHostedMemberLinqInboundEngagementTx({
    chatId: input.chatId,
    linePhoneNumber: input.recipientPhone,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });

  return incrementHostedLinqInboundDailyState({
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });
}

function normalizeHostedLinqService(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function containsUrlLikeText(value: string): boolean {
  if (/\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S+/iu.test(value)) {
    return true;
  }

  return /(?:^|[\s([<{])(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})(?::\d{2,5})?(?:[/?#][^\s<>)\]}]*)?(?=$|[\s).,!?;:>\]}])/iu
    .test(value);
}

function containsSmsOptOutBoilerplate(value: string): boolean {
  const normalized = value
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

  if (/\b(?:(?:standard|std)\s+)?(?:(?:(?:msg|message)s?\s*(?:(?:&|and|\/)\s*|\s+)?)?data|(?:msg|message)s?)\s+rates?\s+(?:may\s+)?apply\b/u.test(normalized)) {
    return true;
  }

  return /\b(?:text|reply)\s+['"]?stop['"]?\s+(?:to\s+)?(?:quit|stop|end|cancel|unsubscribe|opt(?:\s*|-)?out)\b/u
    .test(normalized);
}

function shouldBlockStandaloneSmsOptOutCommand(input: {
  participantContact: HostedLinqParticipantContact;
  service: string | null | undefined;
}): boolean {
  const service = normalizeHostedLinqService(input.service);

  if (service === "sms" || service === "rcs") {
    return true;
  }

  return service === null && input.participantContact.kind === "phone";
}

function containsStandaloneSmsOptOutCommand(value: string): boolean {
  const normalized = value
    .replace(/[\u2010-\u2015]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

  return /^(?:stop|unsubscribe|cancel|end|quit|opt\s*-?\s*out)$/u.test(normalized);
}
