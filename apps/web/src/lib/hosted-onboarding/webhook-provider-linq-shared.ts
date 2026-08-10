import type { Prisma } from "@prisma/client";

import type { HostedRuntimeAiAccessNoticeCode } from "./member-access";

import {
  buildHostedLinqGroupSetupUrl,
  issueHostedLinqGroupEmailRecoveryToken,
  HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE,
  HOSTED_LINQ_GROUP_SETUP_TEMPLATE,
} from "./linq-group-setup";
import {
  buildHostedGroupAwareInviteUrl,
} from "../hosted-groups/group-join-invite-link";
import {
  incrementHostedLinqInboundDailyState,
} from "./linq-daily-state";
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
import type {
  HostedLinqParticipantContact,
  HostedLinqParticipantIdentity,
} from "./linq-participant-contact";
import {
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx,
} from "./hosted-member-routing-store";
import {
  createHostedWebhookLinqMessageSideEffect,
  type HostedLinqMessageSideEffect,
} from "./webhook-transport";
import type {
  HostedLinqThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import type {
  HostedOnboardingLinqDirectPlan,
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type {
  HostedWebhookPlan,
  HostedWebhookWakeHandoff,
} from "./webhook-service-types";

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

export type HostedLinqFirstContactContentDisposition =
  | "allow"
  | "blocked"
  | "contentless";

export function resolveHostedLinqFirstContactContentDisposition(input: {
  event: HostedLinqMessageReceivedEvent;
  participantContact: HostedLinqParticipantContact;
}): HostedLinqFirstContactContentDisposition {
  const blocksStandaloneSmsOptOutCommand = shouldBlockStandaloneSmsOptOutCommand({
    participantContact: input.participantContact,
    service: input.event.data.service,
  });
  let hasContent = false;

  for (const part of input.event.data.message.parts) {
    if (part.type === "link") {
      return "blocked";
    }

    if (part.type === "text" || part.type === "imessage_app") {
      const value = part.type === "imessage_app"
        ? part.fallback_text?.trim()
        : part.value;
      if (!value) {
        // Preserve legacy blank-text handling while making the new app-card
        // fallback the only content authority for unknown senders.
        hasContent ||= part.type === "text";
        continue;
      }

      hasContent = true;
      if (
        containsUrlLikeText(value)
        || containsSmsOptOutBoilerplate(value)
        || (
          blocksStandaloneSmsOptOutCommand
          && containsStandaloneSmsOptOutCommand(value)
        )
      ) {
        return "blocked";
      }
      continue;
    }

    // Media and voice memo first contacts retain their existing behavior.
    hasContent = true;
  }

  return hasContent ? "allow" : "contentless";
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

export function buildGroupSetupRequiredResponse(input: {
  chatId: string;
  messageId: string;
  occurredAt: string;
  participantEmail?: string | null;
  recipientPhone: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  const desiredSideEffects: HostedLinqMessageSideEffect[] = [
    createHostedWebhookLinqMessageSideEffect({
      chatId: input.chatId,
      occurredAt: input.occurredAt,
      replyToMessageId: input.messageId,
      sourceEventId: input.sourceEventId,
      template: HOSTED_LINQ_GROUP_SETUP_TEMPLATE,
    }),
  ];

  const participantEmail = input.participantEmail?.trim() ?? "";
  if (participantEmail) {
    desiredSideEffects.push(
      createHostedWebhookLinqMessageSideEffect({
        assignedRecipientPhone: input.recipientPhone,
        occurredAt: input.occurredAt,
        participantContact: {
          kind: "email",
          value: participantEmail,
        },
        recoveryToken: issueHostedLinqGroupEmailRecoveryToken({
          chatId: input.chatId,
          now: new Date(input.occurredAt),
          observedAt: input.occurredAt,
          participantEmail,
          recipientPhone: input.recipientPhone,
        }),
        sourceEventId: input.sourceEventId,
        template: HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE,
        threadId: input.chatId,
      }),
    );
  }

  return buildActiveMemberDirectPlan({
    desiredSideEffects,
    response: {
      joinUrl: buildHostedLinqGroupSetupUrl(),
      ok: true,
      reason: "sent-group-setup",
    },
  });
}

export function buildSignupLinkResponse(input: {
  chatId: string;
  groupJoinCode?: string | null;
  groupJoinOutreachId?: string | null;
  inviteCode: string;
  inviteId: string;
  memberId: string;
  messageId: string;
  occurredAt: string;
  service?: string | null;
  sourceEventId: string;
  threadIsDirect?: boolean | null;
}): HostedOnboardingLinqDirectPlan {
  const joinUrl = buildHostedGroupAwareInviteUrl({
    groupJoinCode: input.groupJoinCode,
    inviteCode: input.inviteCode,
  });

  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        groupJoinCode: input.groupJoinCode ?? null,
        groupJoinOutreachId: input.groupJoinOutreachId ?? null,
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
  groupJoinCode?: string | null;
  groupJoinOutreachId?: string | null;
  inviteCode: string;
  inviteId: string;
  memberId: string;
  memberPhone: string;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  const joinUrl = buildHostedGroupAwareInviteUrl({
    groupJoinCode: input.groupJoinCode,
    inviteCode: input.inviteCode,
  });

  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        assignedRecipientPhone: input.assignedPhone,
        groupJoinCode: input.groupJoinCode ?? null,
        groupJoinOutreachId: input.groupJoinOutreachId ?? null,
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

export function buildGroupLineRecoveryResponse(input: {
  incomingRecipientPhone: string;
  memberId: string;
  occurredAt: string;
  participantContact: Pick<HostedLinqParticipantContact, "kind" | "value">;
  pendingGroupSetupId?: string | null;
  sourceEventId: string;
  threadId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        incomingRecipientPhone: input.incomingRecipientPhone,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        participantContact: input.participantContact,
        ...(input.pendingGroupSetupId
          ? { pendingGroupSetupId: input.pendingGroupSetupId }
          : {}),
        sourceEventId: input.sourceEventId,
        threadId: input.threadId,
        template: "group_line_recovery",
      }),
    ],
    response: {
      ok: true,
      reason: "sent-group-line-recovery",
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
  wakeHandoff?: HostedWebhookWakeHandoff;
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
    postCommitGroupJoinConfirmationMemberIds: [input.memberId],
    ...(input.wakeHandoff ? { wakeHandoffs: [input.wakeHandoff] } : {}),
  });
}

export function buildActiveMemberDirectPlan(
  plan: HostedWebhookPlan<HostedOnboardingLinqWebhookResponse, HostedLinqMessageSideEffect>,
): HostedOnboardingLinqDirectPlan {
  return plan;
}

export const HOSTED_LINQ_INACTIVE_MEMBER_NOTICE_REASON: Record<
  HostedRuntimeAiAccessNoticeCode,
  string
> = {
  billing_inactive: "sent-billing-inactive-notice",
  health_data_consent_withdrawn: "sent-health-data-consent-withdrawn-notice",
  trial_conversion_pending: "sent-trial-conversion-notice",
};

/**
 * Reply-and-stop plan for a recognized member whose access has lapsed. It sends
 * the access decision's own notice and performs no routing, daily-state, or
 * mailbox writes, mirroring the home-redirect plan's shape.
 */
export function buildInactiveMemberAccessNoticeResponse(input: {
  chatId: string;
  memberId: string;
  message: string;
  messageId: string;
  noticeCode: HostedRuntimeAiAccessNoticeCode;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        claimToken: null,
        memberId: input.memberId,
        message: input.message,
        noticeCode: input.noticeCode,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "ai_usage_quota",
      }),
    ],
    response: {
      ok: true,
      reason: HOSTED_LINQ_INACTIVE_MEMBER_NOTICE_REASON[input.noticeCode],
    },
  });
}

export function buildConversationHomeRedirectResponse(input: {
  chatId: string;
  homeRecipientPhone: string;
  memberId: string;
  messageId: string;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        // Keep the current home line as an operational fallback so deferred
        // receipt sends do not depend on routing still being present later.
        homeRecipientPhone: input.homeRecipientPhone,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
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
  dailyTextLimit: number;
  memberId: string;
  messageId: string;
  occurredAt: string;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        dailyTextLimit: input.dailyTextLimit,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        sourceEventId: input.sourceEventId,
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
  participantContact: HostedLinqParticipantContact;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}) {
  const participantIdentity = await bindHostedMemberHomeLinqChat(input);
  const dailyState = await incrementHostedLinqInboundDailyState({
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });

  return {
    ...dailyState,
    participantIdentity,
  };
}

export async function bindHostedMemberHomeLinqChat(input: {
  chatId: string;
  homeLineAssignedAt?: Date | null;
  memberId: string;
  participantContact: HostedLinqParticipantContact;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<HostedLinqParticipantIdentity | null> {
  return await upsertHostedMemberHomeLinqBindingTx({
    clearPending: true,
    homeLineAssignedAt: input.homeLineAssignedAt ?? null,
    linqChatId: input.chatId,
    memberId: input.memberId,
    participantContact: input.participantContact,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });
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
  await bindHostedMemberPendingLinqChat(input);

  return incrementHostedLinqInboundDailyState({
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });
}

export async function bindHostedMemberPendingLinqChat(input: {
  chatId: string;
  homeLineAssignedAt?: Date | null;
  memberId: string;
  occurredAt: string;
  participantContact?: HostedLinqParticipantContact | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  await upsertHostedMemberPendingLinqBindingTx({
    homeLineAssignedAt: input.homeLineAssignedAt ?? null,
    linqChatId: input.chatId,
    memberId: input.memberId,
    participantContact: input.participantContact ?? null,
    participantContactObservedAt: new Date(input.occurredAt),
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
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
