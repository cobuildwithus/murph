import type { Prisma } from "@prisma/client";
import {
  type HostedExecutionLinqConversationMessage,
  type HostedExecutionLinqConversationMessagePart,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

import { issueHostedInviteTx } from "./invite-service";
import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import {
  ensureHostedMemberForPendingLinqParticipantContactTx,
  ensureHostedMemberForPhoneTx,
} from "./member-identity-service";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import {
  lookupHostedMemberByVerifiedEmailAddress,
} from "./hosted-member-store";
import {
  lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqParticipantContact,
  readHostedMemberHomeLinqRoute,
} from "./hosted-member-routing-store";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
  type HostedOnboardingStructuredLogDetails,
  type HostedOnboardingStructuredLogValue,
} from "./logging";
import {
  HOSTED_LINQ_DAILY_TEXT_LIMIT,
  incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState,
  readHostedLinqDailyState,
} from "./linq-daily-state";
import {
  type HostedLinqMessageReceivedEvent,
  type HostedLinqWebhookEvent,
  shouldIgnoreHostedLinqForLocalInboundGuard,
} from "./linq";
import {
  resolveHostedLinqActiveRouteDecision,
  resolveHostedLinqHomeBindingRecipientPhone,
} from "./linq-routing-policy";
import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
} from "../hosted-mailbox/store";
import {
  checkHostedAiUsageGate,
  claimHostedAiUsageLimitNotice,
} from "../hosted-execution/usage-allowance";
import {
  bindHostedMemberHomeLinqChatAndTrackInbound,
  bindHostedMemberPendingLinqChatAndTrackInbound,
  buildAiUsageQuotaReplyResponse,
  buildActiveMemberDirectPlan,
  buildConversationHomeRedirectResponse,
  buildIgnoredLinqWebhookPlan,
  buildQuotaReplyResponse,
  buildSignupLinkResponse,
  hostedLinqFirstContactContainsBlockedContent,
  isHostedLinqDeliverableFirstContact,
  resolveHostedOnboardingLinqMessageContext,
} from "./webhook-provider-linq-shared";
import {
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  readHostedThreadRouteByExternalThread,
  type HostedLinqThreadRouteEgressAuthority,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
export type {
  HostedOnboardingLinqDirectPlan,
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type {
  HostedOnboardingLinqDirectPlan,
} from "./webhook-provider-linq-types";
import { type HostedLinqParticipantContact } from "./linq-participant-contact";

const HOSTED_LINQ_MESSAGE_MAX_PARTS = 32;
const HOSTED_LINQ_CONVERSATION_WAKE_INLINE_TARGET_BYTES = 128 * 1024;
const HOSTED_LINQ_TEXT_PART_MAX_CHARS = 20_000;
const HOSTED_LINQ_COMPACT_TEXT_BUDGET_CHARS = 20_000;
const HOSTED_LINQ_ATTACHMENT_ID_MAX_CHARS = 256;
const HOSTED_LINQ_ATTACHMENT_FILE_NAME_MAX_CHARS = 160;
const HOSTED_LINQ_ATTACHMENT_MIME_TYPE_MAX_CHARS = 120;
const HOSTED_LINQ_STAGING_NOTE_PART_TYPE = "text";

type HostedLinqExistingMemberMatch =
  | "home-linq-chat"
  | "none"
  | "pending-contact"
  | "phone-identity"
  | "verified-email";
type HostedLinqDailyState = Awaited<ReturnType<typeof incrementHostedLinqInboundDailyState>>;
type HostedLinqUsageGate = Awaited<ReturnType<typeof checkHostedAiUsageGate>>;

export async function planHostedOnboardingLinqWebhook(input: {
  event: HostedLinqWebhookEvent;
  prisma: Prisma.TransactionClient;
}): Promise<HostedOnboardingLinqDirectPlan> {
  if (input.event.event_type !== "message.received") {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan(input.event.event_type),
      {
        eventIdSuffix: toHostedOnboardingLogIdSuffix(input.event.event_id),
        existingMemberMatch: "none",
        reason: input.event.event_type,
        routeStage: "ignored-event-type",
      },
    );
  }

  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  const {
    messageEvent,
    occurredAt,
    participantContact,
    recipientPhoneNumber,
    summary,
  } = context;

  const threadRouteAccountLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    recipientPhoneNumber,
  );
  if (threadRouteAccountLookupKeys.length > 0) {
    const explicitThreadRoute = await readHostedThreadRouteByExternalThread({
      accountLookupKeys: threadRouteAccountLookupKeys,
      channel: "linq",
      prisma: input.prisma,
      threadId: summary.chatId,
    });
    if (explicitThreadRoute) {
      return planHostedLinqExplicitThreadRouteWebhook({
        context,
        event: input.event,
        prisma: input.prisma,
        route: explicitThreadRoute,
      });
    }
  }

  if (isHostedLinqGroupChat(messageEvent)) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("group-chat"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberMatch: "none",
        reason: "group-chat",
        routeStage: "ignored-group-chat",
      }),
    );
  }

  if (messageEvent.data.message.parts.length === 0) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("empty-message-parts"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberMatch: "none",
        reason: "empty-message-parts",
        routeStage: "ignored-empty-message-parts",
      }),
    );
  }

  if (!participantContact) {
    const reason = summary.isFromMe ? "own-message" : "invalid-contact";
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan(reason),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberMatch: "none",
        reason,
        routeStage: "ignored-missing-contact",
      }),
    );
  }

  if (shouldIgnoreHostedLinqForLocalInboundGuard({
    isFromMe: summary.isFromMe,
    participantContact,
  })) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("local-inbound-not-allowlisted"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberMatch: "none",
        reason: "local-inbound-not-allowlisted",
        routeStage: "ignored-local-inbound-guard",
      }),
    );
  }

  const existingMemberLookup = participantContact.kind === "phone"
    ? await lookupHostedMemberIdentityByPhoneNumberForLinqWebhook({
        phoneNumber: participantContact.value,
        prisma: input.prisma,
      })
    : await lookupHostedMemberByVerifiedEmailAddress({
        address: participantContact.value,
        prisma: input.prisma,
      });
  const existingPendingLinqContactLookup = existingMemberLookup
    ? null
    : await lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact: participantContact,
        prisma: input.prisma,
      });
  const existingHomeLinqChatLookup = existingMemberLookup || existingPendingLinqContactLookup
    ? null
    : await lookupHostedMemberRoutingByHomeLinqChatId({
        linqChatId: summary.chatId,
        prisma: input.prisma,
      });
  const existingMember =
    existingMemberLookup?.core
    ?? existingPendingLinqContactLookup?.core
    ?? existingHomeLinqChatLookup?.core
    ?? null;
  const existingMemberMatch = resolveHostedLinqExistingMemberMatch({
    existingHomeLinqChatLookupPresent: Boolean(existingHomeLinqChatLookup),
    existingMemberLookupPresent: Boolean(existingMemberLookup),
    existingPendingLinqContactLookupPresent: Boolean(existingPendingLinqContactLookup),
    participantContactKind: participantContact.kind,
  });

  if (summary.isFromMe) {
    if (existingMember) {
      await incrementHostedLinqOutboundDailyState({
        memberId: existingMember.id,
        occurredAt,
        prisma: input.prisma,
      });
    }

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("own-message"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMember ? hasHostedMemberActiveAccess(existingMember) : false,
        existingMemberMatch,
        reason: "own-message",
        routeStage: "ignored-own-message",
      }),
    );
  }

  if (existingMember && isHostedMemberSuspended(existingMember.suspendedAt)) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("suspended-member"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: false,
        existingMemberMatch,
        reason: "suspended-member",
        routeStage: "ignored-suspended-member",
      }),
    );
  }

  if (existingMember && hasHostedMemberActiveAccess(existingMember)) {
    const homeRoute = await readHostedMemberHomeLinqRoute({
      memberId: existingMember.id,
      prisma: input.prisma,
    });

    const routeDecision = resolveHostedLinqActiveRouteDecision({
      homeChatId: homeRoute?.linqChatId ?? null,
      homeRecipientPhone: homeRoute?.linqRecipientPhone ?? null,
      incomingChatId: summary.chatId,
      incomingDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
      incomingRecipientPhone: recipientPhoneNumber,
    });

    if (routeDecision.kind === "redirect_to_home") {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildConversationHomeRedirectResponse({
          chatId: summary.chatId,
          homeRecipientPhone: routeDecision.homeRecipientPhone,
          memberId: existingMember.id,
          messageId: summary.messageId,
          sourceEventId: input.event.event_id,
        }),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          existingMemberActive: true,
          existingMemberMatch,
          homeRoutePresent: Boolean(homeRoute?.linqChatId),
          reason: "redirect-to-home",
          routeDecision: routeDecision.kind,
          routeStage: "active-member-redirect",
        }),
      );
    }

    if (routeDecision.kind === "ignore_unattested_direct") {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildIgnoredLinqWebhookPlan("unattested-direct-chat"),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          existingMemberActive: true,
          existingMemberMatch,
          homeRoutePresent: Boolean(homeRoute?.linqChatId),
          reason: "unattested-direct-chat",
          routeStage: "active-member-ignored-unattested-direct",
        }),
      );
    }

    if (routeDecision.kind === "ignore_unknown_home") {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildIgnoredLinqWebhookPlan("unknown-home-line"),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          existingMemberActive: true,
          existingMemberMatch,
          homeRoutePresent: Boolean(homeRoute?.linqChatId),
          reason: "unknown-home-line",
          routeDecision: routeDecision.kind,
          routeStage: "active-member-ignored-home-line",
        }),
      );
    }

    const existingMailboxItem = await readHostedMailboxItemByDedupeKey({
      dedupeKey: input.event.event_id,
      prisma: input.prisma,
      userId: existingMember.id,
    });

    if (existingMailboxItem) {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildActiveMemberDirectPlan({
          desiredSideEffects: [],
          response: {
            duplicate: true,
            ignored: true,
            ok: true,
            reason: "duplicate-webhook-event",
          },
          wakeMailboxItemId: existingMailboxItem.id,
          wakeUserId: existingMember.id,
        }),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          duplicate: true,
          existingMemberActive: true,
          existingMemberMatch,
          homeRoutePresent: Boolean(homeRoute?.linqChatId),
          reason: "duplicate-webhook-event",
          routeDecision: routeDecision.kind,
          routeStage: "active-member-duplicate",
        }),
      );
    }

    const dailyState = await bindHostedMemberHomeLinqChatAndTrackInbound({
      chatId: summary.chatId,
      memberId: existingMember.id,
      occurredAt,
      prisma: input.prisma,
      recipientPhone: resolveHostedLinqHomeBindingRecipientPhone({
        homeChatId: homeRoute?.linqChatId ?? null,
        homeRecipientPhone: homeRoute?.linqRecipientPhone ?? null,
        incomingChatId: summary.chatId,
        incomingRecipientPhone: recipientPhoneNumber,
      }),
    });

    // Read-first: the webhook only needs the gate decision for quota notices;
    // authoritative period bookkeeping happens at turn admission.
    const usageGate = await checkHostedAiUsageGate({
      memberId: existingMember.id,
      prisma: input.prisma,
    });

    const admissionPlan = await planHostedLinqInboundAdmissionDenied({
      context,
      dailyState,
      event: input.event,
      logDetails: {
        existingMemberActive: true,
        existingMemberMatch,
        homeRoutePresent: Boolean(homeRoute?.linqChatId),
        routeDecision: routeDecision.kind,
      },
      memberId: existingMember.id,
      prisma: input.prisma,
      routeStages: {
        aiUsageDenied: "active-member-ai-usage-denied",
        aiUsageReply: "active-member-ai-usage-reply",
        dailyQuotaReached: "active-member-daily-quota-reached",
        dailyQuotaReply: "active-member-daily-quota-reply",
      },
      usageGate,
    });
    if (admissionPlan) {
      return admissionPlan;
    }

    const mailboxWake = buildHostedLinqConversationWakeForMailbox({
      eventId: input.event.event_id,
      linqMessage: {
        chatId: summary.chatId,
        from: participantContact.value,
        isFromMe: summary.isFromMe,
        messageId: summary.messageId,
        reactionEligible: isHostedLinqMessageReactionEligible({
          parts: messageEvent.data.message.parts,
          service: messageEvent.data.service ?? null,
        }),
        ...(messageEvent.data.message.reply_to?.message_id === undefined
          ? {}
          : { replyToMessageId: messageEvent.data.message.reply_to.message_id }),
        ...(messageEvent.data.message.reply_to?.part_index === undefined
          ? {}
          : { replyToPartIndex: messageEvent.data.message.reply_to.part_index }),
        ...(messageEvent.data.service === undefined ? {} : { service: messageEvent.data.service }),
      },
      occurredAt,
      participantContact,
      rawParts: messageEvent.data.message.parts,
      userId: existingMember.id,
    });

    const mailboxAppend = await appendHostedMailboxEnvelopeTx({
      envelope: mailboxWake,
      tx: input.prisma,
    });

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildActiveMemberDirectPlan({
        desiredSideEffects: [],
        response: {
          ok: true,
          ignored: false,
          reason: "wake-appended-active-member",
        },
        wakeLinqChatId: summary.chatId,
        wakeMailboxItemId: mailboxAppend.item.id,
        wakeUserId: existingMember.id,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: true,
        existingMemberMatch,
        homeRoutePresent: Boolean(homeRoute?.linqChatId),
        mailboxAppendPresent: true,
        reason: "wake-appended-active-member",
        routeDecision: routeDecision.kind,
        routeStage: "active-member-appended",
      }),
    );
  }

  if (!isHostedLinqDeliverableFirstContact({
    event: messageEvent,
    participantContact,
  })) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("undeliverable-first-contact"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMember ? hasHostedMemberActiveAccess(existingMember) : false,
        existingMemberMatch,
        reason: "undeliverable-first-contact",
        routeStage: "ignored-undeliverable-first-contact",
      }),
    );
  }

  if (hostedLinqFirstContactContainsBlockedContent({
    event: messageEvent,
    participantContact,
  })) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("blocked-first-contact-content"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMember ? hasHostedMemberActiveAccess(existingMember) : false,
        existingMemberMatch,
        reason: "blocked-first-contact-content",
        routeStage: "ignored-blocked-first-contact-content",
      }),
    );
  }

  const member = existingMember
    ?? (participantContact.kind === "phone"
      ? await ensureHostedMemberForPhoneTx({
          phoneNumber: participantContact.value,
          prisma: input.prisma,
        })
      : await ensureHostedMemberForPendingLinqParticipantContactTx({
          contact: participantContact,
          observedAt: new Date(occurredAt),
          prisma: input.prisma,
        }));
  const existingDailyState = await readHostedLinqDailyState({
    memberId: member.id,
    occurredAt,
    prisma: input.prisma,
  });

  if (existingDailyState?.onboardingLinkSentAt) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("signup-link-already-sent"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMember ? hasHostedMemberActiveAccess(existingMember) : false,
        existingMemberMatch,
        reason: "signup-link-already-sent",
        routeStage: "first-contact-signup-already-sent",
      }),
    );
  }

  const dailyState = await bindHostedMemberPendingLinqChatAndTrackInbound({
    chatId: summary.chatId,
    memberId: member.id,
    occurredAt,
    participantContact: participantContact.kind === "email" ? participantContact : null,
    prisma: input.prisma,
    recipientPhone: recipientPhoneNumber,
  });

  if (dailyState.onboardingLinkSentAt) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("signup-link-already-sent"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: existingMember ? hasHostedMemberActiveAccess(existingMember) : false,
        existingMemberMatch,
        reason: "signup-link-already-sent",
        routeStage: "first-contact-signup-already-sent",
      }),
    );
  }

  const invite = await issueHostedInviteTx({
    channel: "linq",
    memberId: member.id,
    prisma: input.prisma,
  });

  return logHostedLinqWebhookPlannerDecisionAndReturn(
    buildSignupLinkResponse({
      chatId: summary.chatId,
      inviteCode: invite.inviteCode,
      inviteId: invite.id,
      memberId: member.id,
      messageId: summary.messageId,
      occurredAt,
      sourceEventId: input.event.event_id,
    }),
    buildHostedLinqWebhookPlannerDetails(input.event, context, {
      chatDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
      dailyInboundCount: dailyState.inboundCount,
      existingMemberActive: existingMember ? hasHostedMemberActiveAccess(existingMember) : false,
      existingMemberMatch,
      reason: "sent-signup-link",
      routeStage: "first-contact-signup-link",
    }),
  );
}

async function planHostedLinqExplicitThreadRouteWebhook(input: {
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>;
  event: HostedLinqWebhookEvent;
  prisma: Prisma.TransactionClient;
  route: HostedThreadRouteSnapshot;
}): Promise<HostedOnboardingLinqDirectPlan> {
  const {
    messageEvent,
    occurredAt,
    participantContact,
    summary,
  } = input.context;

  if (
    !hasHostedMemberActiveAccess(input.route.container)
    || !hasHostedMemberActiveAccess(input.route.owner)
  ) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("thread-container-inactive"),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        existingMemberActive: false,
        existingMemberMatch: "none",
        reason: "thread-container-inactive",
        routeStage: "thread-route-container-inactive",
      }),
    );
  }

  if (summary.isFromMe) {
    await incrementHostedLinqOutboundDailyState({
      memberId: input.route.containerMemberId,
      occurredAt,
      prisma: input.prisma,
    });
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("own-message"),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        existingMemberActive: true,
        existingMemberMatch: "none",
        reason: "own-message",
        routeStage: "thread-route-ignored-own-message",
      }),
    );
  }

  if (messageEvent.data.message.parts.length === 0) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("empty-message-parts"),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        existingMemberActive: true,
        existingMemberMatch: "none",
        reason: "empty-message-parts",
        routeStage: "thread-route-empty-message-parts",
      }),
    );
  }

  if (!participantContact) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("invalid-contact"),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        existingMemberActive: true,
        existingMemberMatch: "none",
        reason: "invalid-contact",
        routeStage: "thread-route-invalid-contact",
      }),
    );
  }

  if (shouldIgnoreHostedLinqForLocalInboundGuard({
    isFromMe: summary.isFromMe,
    participantContact,
  })) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("local-inbound-not-allowlisted"),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        existingMemberActive: true,
        existingMemberMatch: "none",
        reason: "local-inbound-not-allowlisted",
        routeStage: "thread-route-local-inbound-guard",
      }),
    );
  }

  const routeAuthority = buildHostedLinqThreadRouteEgressAuthority({
    route: input.route,
    threadId: summary.chatId,
  });

  const existingMailboxItem = await readHostedMailboxItemByDedupeKey({
    dedupeKey: input.event.event_id,
    prisma: input.prisma,
    userId: input.route.containerMemberId,
  });

  if (existingMailboxItem) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildActiveMemberDirectPlan({
        desiredSideEffects: [],
        response: {
          duplicate: true,
          ignored: true,
          ok: true,
          reason: "duplicate-webhook-event",
        },
        wakeLinqChatId: summary.chatId,
        wakeMailboxItemId: existingMailboxItem.id,
        wakeUserId: input.route.containerMemberId,
        linqReadReceiptRouteAuthority: routeAuthority,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        duplicate: true,
        existingMemberActive: true,
        existingMemberMatch: "none",
        reason: "duplicate-webhook-event",
        routeStage: "thread-route-duplicate",
      }),
    );
  }

  const dailyState = await incrementHostedLinqInboundDailyState({
    memberId: input.route.containerMemberId,
    occurredAt,
    prisma: input.prisma,
  });
  const usageGate = await checkHostedAiUsageGate({
    memberId: input.route.containerMemberId,
    prisma: input.prisma,
  });

  const admissionPlan = await planHostedLinqInboundAdmissionDenied({
    context: input.context,
    dailyState,
    event: input.event,
    logDetails: {
      existingMemberActive: true,
      existingMemberMatch: "none",
    },
    memberId: input.route.containerMemberId,
    prisma: input.prisma,
    routeStages: {
      aiUsageDenied: "thread-route-ai-usage-denied",
      aiUsageReply: "thread-route-ai-usage-reply",
      dailyQuotaReached: "thread-route-daily-quota-reached",
      dailyQuotaReply: "thread-route-daily-quota-reply",
    },
    routeAuthority,
    usageGate,
  });
  if (admissionPlan) {
    return admissionPlan;
  }

  const mailboxWake = buildHostedLinqConversationWakeForMailbox({
    accountLookupKey: input.route.accountLookupKey,
    eventId: input.event.event_id,
    linqMessage: {
      chatId: summary.chatId,
      from: participantContact.value,
      isFromMe: summary.isFromMe,
      messageId: summary.messageId,
      reactionEligible: isHostedLinqMessageReactionEligible({
        parts: messageEvent.data.message.parts,
        service: messageEvent.data.service ?? null,
      }),
      threadIsDirect: isHostedLinqDirectChatAttested(messageEvent),
      ...(messageEvent.data.message.reply_to?.message_id === undefined
        ? {}
        : { replyToMessageId: messageEvent.data.message.reply_to.message_id }),
      ...(messageEvent.data.message.reply_to?.part_index === undefined
        ? {}
        : { replyToPartIndex: messageEvent.data.message.reply_to.part_index }),
      ...(messageEvent.data.service === undefined ? {} : { service: messageEvent.data.service }),
    },
    occurredAt,
    participantContact,
    rawParts: messageEvent.data.message.parts,
    routeAuthority,
    userId: input.route.containerMemberId,
  });

  const mailboxAppend = await appendHostedMailboxEnvelopeTx({
    envelope: mailboxWake,
    tx: input.prisma,
  });

  return logHostedLinqWebhookPlannerDecisionAndReturn(
    buildActiveMemberDirectPlan({
      desiredSideEffects: [],
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      },
      wakeLinqChatId: summary.chatId,
      wakeMailboxItemId: mailboxAppend.item.id,
      wakeUserId: input.route.containerMemberId,
      linqReadReceiptRouteAuthority: routeAuthority,
    }),
    buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
      dailyInboundCount: dailyState.inboundCount,
      existingMemberActive: true,
      existingMemberMatch: "none",
      mailboxAppendPresent: true,
      reason: "wake-appended-thread-route",
      routeStage: "thread-route-appended",
    }),
  );
}

async function planHostedLinqInboundAdmissionDenied(input: {
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>;
  dailyState: HostedLinqDailyState;
  event: HostedLinqWebhookEvent;
  logDetails: HostedOnboardingStructuredLogDetails;
  memberId: string;
  prisma: Prisma.TransactionClient;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  routeStages: {
    aiUsageDenied: string;
    aiUsageReply: string;
    dailyQuotaReached: string;
    dailyQuotaReply: string;
  };
  usageGate: HostedLinqUsageGate;
}): Promise<HostedOnboardingLinqDirectPlan | null> {
  const buildUsageGateDeniedPlan = async (
    deniedUsageGate: Extract<HostedLinqUsageGate, { allowed: false }>,
  ) => {
    if (!deniedUsageGate.userNotice) {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildIgnoredLinqWebhookPlan("ai-usage-gate-denied"),
        buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
          ...input.logDetails,
          reason: "ai-usage-gate-denied",
          routeStage: input.routeStages.aiUsageDenied,
        }),
      );
    }

    let usageLimitNoticeClaim: {
      periodStart: Date;
      sentAt: Date;
    } | null = null;
    if (deniedUsageGate.reason === "ai_usage_limit_exceeded") {
      const usageLimitNoticeClaimSentAt = new Date();
      const claimedUsageLimitNotice = await claimHostedAiUsageLimitNotice({
        memberId: input.memberId,
        periodStart: deniedUsageGate.periodStart,
        prisma: input.prisma,
        sentAt: usageLimitNoticeClaimSentAt,
      });

      if (!claimedUsageLimitNotice) {
        return logHostedLinqWebhookPlannerDecisionAndReturn(
          buildIgnoredLinqWebhookPlan("ai-usage-gate-denied"),
          buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
            ...input.logDetails,
            reason: "ai-usage-gate-denied",
            routeStage: input.routeStages.aiUsageDenied,
          }),
        );
      }

      usageLimitNoticeClaim = {
        periodStart: deniedUsageGate.periodStart,
        sentAt: usageLimitNoticeClaimSentAt,
      };
    }

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildAiUsageQuotaReplyResponse({
        chatId: input.context.summary.chatId,
        claimToken: usageLimitNoticeClaim
          ? {
              periodStart: usageLimitNoticeClaim.periodStart.toISOString(),
              sentAt: usageLimitNoticeClaim.sentAt.toISOString(),
            }
          : null,
        memberId: input.memberId,
        message: deniedUsageGate.userNotice.message,
        messageId: input.context.summary.messageId,
        noticeCode: deniedUsageGate.userNotice.code,
        occurredAt: input.context.occurredAt,
        routeAuthority: input.routeAuthority ?? null,
        sourceEventId: input.event.event_id,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        ...input.logDetails,
        reason: "sent-ai-usage-quota-reply",
        routeStage: input.routeStages.aiUsageReply,
      }),
    );
  };

  if (
    !input.usageGate.allowed
    && input.usageGate.reason === "ai_usage_limit_exceeded"
  ) {
    return buildUsageGateDeniedPlan(input.usageGate);
  }

  if (input.dailyState.inboundCount > HOSTED_LINQ_DAILY_TEXT_LIMIT) {
    if (input.dailyState.quotaReplySentAt) {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildIgnoredLinqWebhookPlan("daily-quota-reached"),
        buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
          ...input.logDetails,
          dailyInboundCount: input.dailyState.inboundCount,
          reason: "daily-quota-reached",
          routeStage: input.routeStages.dailyQuotaReached,
        }),
      );
    }

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildQuotaReplyResponse({
        chatId: input.context.summary.chatId,
        memberId: input.memberId,
        messageId: input.context.summary.messageId,
        occurredAt: input.context.occurredAt,
        routeAuthority: input.routeAuthority ?? null,
        sourceEventId: input.event.event_id,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        ...input.logDetails,
        dailyInboundCount: input.dailyState.inboundCount,
        reason: "sent-daily-quota-reply",
        routeStage: input.routeStages.dailyQuotaReply,
      }),
    );
  }

  if (!input.usageGate.allowed) {
    return buildUsageGateDeniedPlan(input.usageGate);
  }

  return null;
}

function buildHostedLinqThreadRouteEgressAuthority(input: {
  route: HostedThreadRouteSnapshot;
  threadId: string;
}): HostedLinqThreadRouteEgressAuthority {
  return {
    accountLookupKey: input.route.accountLookupKey,
    channel: "linq",
    containerMemberId: input.route.containerMemberId,
    threadId: input.threadId,
  };
}

function resolveHostedLinqExistingMemberMatch(input: {
  existingHomeLinqChatLookupPresent: boolean;
  existingMemberLookupPresent: boolean;
  existingPendingLinqContactLookupPresent: boolean;
  participantContactKind: HostedLinqParticipantContact["kind"];
}): HostedLinqExistingMemberMatch {
  if (input.existingMemberLookupPresent) {
    return input.participantContactKind === "phone" ? "phone-identity" : "verified-email";
  }

  if (input.existingPendingLinqContactLookupPresent) {
    return "pending-contact";
  }

  if (input.existingHomeLinqChatLookupPresent) {
    return "home-linq-chat";
  }

  return "none";
}

function buildHostedLinqWebhookPlannerDetails(
  event: HostedLinqWebhookEvent,
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>,
  details: HostedOnboardingStructuredLogDetails,
): HostedOnboardingStructuredLogDetails {
  return {
    eventIdSuffix: toHostedOnboardingLogIdSuffix(event.event_id),
    existingMemberMatch: "none",
    linqChatPresent: context.summary.chatId.trim().length > 0,
    linqContactKind: context.participantContact?.kind ?? "none",
    linqIsFromMe: context.summary.isFromMe,
    linqRecipientPhonePresent: Boolean(context.recipientPhoneNumber),
    linqService: context.messageEvent.data.service ?? null,
    routeStage: "unknown",
    ...details,
  };
}

function logHostedLinqWebhookPlannerDecisionAndReturn<T extends HostedOnboardingLinqDirectPlan>(
  plan: T,
  details: HostedOnboardingStructuredLogDetails,
): T {
  const plannerResultLog = sanitizeHostedOnboardingPlannerResultForLog(plan.response);
  console.info("Hosted Linq webhook planner decision.", {
    ...sanitizeHostedOnboardingStructuredLogDetails(details),
    desiredSideEffectCount: plan.desiredSideEffects.length,
    ...plannerResultLog,
    wakeMailboxItemPresent: Boolean(plan.wakeMailboxItemId),
    wakeUserPresent: Boolean(plan.wakeUserId),
  });

  return plan;
}

function sanitizeHostedOnboardingPlannerResultForLog(
  result: HostedOnboardingLinqDirectPlan["response"],
): HostedOnboardingStructuredLogDetails {
  return {
    duplicate: Boolean(result.duplicate),
    ignored: Boolean(result.ignored),
    ok: result.ok,
    responseReason: sanitizeHostedOnboardingPlannerLogValue(result.reason),
  };
}

function sanitizeHostedOnboardingPlannerLogValue(
  value: string | null | undefined,
): HostedOnboardingStructuredLogValue {
  return value ?? null;
}

function buildHostedLinqConversationWakeForMailbox(input: {
  accountLookupKey?: string | null;
  eventId: string;
  linqMessage: Omit<HostedExecutionLinqConversationMessage, "parts">;
  occurredAt: string;
  participantContact: HostedLinqParticipantContact;
  rawParts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"];
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  userId: string;
}): ReturnType<typeof buildHostedExecutionLinqConversationMessageWake> {
  const fullWake = buildHostedExecutionLinqConversationMessageWake({
    ...(input.accountLookupKey === undefined
      ? {}
      : { accountLookupKey: input.accountLookupKey }),
    eventId: input.eventId,
    linqMessage: {
      ...input.linqMessage,
      parts: buildHostedLinqMailboxParts(input.rawParts, "normal"),
    },
    occurredAt: input.occurredAt,
    contactKind: input.participantContact.kind,
    contactLookupKey: input.participantContact.lookupKey,
    ...(input.participantContact.kind === "phone"
      ? { phoneLookupKey: input.participantContact.lookupKey }
      : {}),
    ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
    userId: input.userId,
  });
  if (serializedHostedLinqWakeBytes(fullWake) <= HOSTED_LINQ_CONVERSATION_WAKE_INLINE_TARGET_BYTES) {
    return fullWake;
  }

  const compactWake = buildHostedExecutionLinqConversationMessageWake({
    ...(input.accountLookupKey === undefined
      ? {}
      : { accountLookupKey: input.accountLookupKey }),
    eventId: input.eventId,
    linqMessage: {
      ...input.linqMessage,
      parts: buildHostedLinqMailboxParts(input.rawParts, "compact"),
    },
    occurredAt: input.occurredAt,
    contactKind: input.participantContact.kind,
    contactLookupKey: input.participantContact.lookupKey,
    ...(input.participantContact.kind === "phone"
      ? { phoneLookupKey: input.participantContact.lookupKey }
      : {}),
    ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
    userId: input.userId,
  });
  if (serializedHostedLinqWakeBytes(compactWake) <= HOSTED_LINQ_CONVERSATION_WAKE_INLINE_TARGET_BYTES) {
    return compactWake;
  }

  return buildHostedExecutionLinqConversationMessageWake({
    ...(input.accountLookupKey === undefined
      ? {}
      : { accountLookupKey: input.accountLookupKey }),
    eventId: input.eventId,
    linqMessage: {
      ...input.linqMessage,
      parts: buildMinimalHostedLinqMailboxParts(input.rawParts),
    },
    occurredAt: input.occurredAt,
    contactKind: input.participantContact.kind,
    contactLookupKey: input.participantContact.lookupKey,
    ...(input.participantContact.kind === "phone"
      ? { phoneLookupKey: input.participantContact.lookupKey }
      : {}),
    ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
    userId: input.userId,
  });
}

type HostedLinqMailboxPartCompactionMode = "normal" | "compact";

type HostedLinqMailboxTextPartBuildResult = {
  omittedParts: number;
  part: HostedExecutionLinqConversationMessagePart | null;
  truncatedContent: boolean;
};

type HostedLinqMailboxAttachmentPartsBuildResult = {
  omittedParts: number;
  parts: HostedExecutionLinqConversationMessagePart[];
};

function buildHostedLinqMailboxParts(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
  mode: HostedLinqMailboxPartCompactionMode,
): HostedExecutionLinqConversationMessagePart[] {
  const textPart = buildHostedLinqMailboxTextPart(parts, mode);
  const attachmentParts = buildHostedLinqMailboxAttachmentParts(parts, mode);
  const mailboxParts = [
    ...(textPart.part ? [textPart.part] : []),
    ...attachmentParts.parts,
  ];
  const omittedParts = textPart.omittedParts + attachmentParts.omittedParts;

  if (omittedParts > 0 || textPart.truncatedContent || mode === "compact") {
    return appendHostedLinqStagingNote(mailboxParts, {
      mode,
      omittedAttachmentParts: attachmentParts.omittedParts,
      omittedParts,
      omittedTextParts: textPart.omittedParts,
      truncatedContent: textPart.truncatedContent,
    });
  }

  return mailboxParts;
}

function isHostedLinqMessageReactionEligible(input: {
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"];
  service: string | null;
}): boolean {
  return input.service?.trim().toLowerCase() === "imessage"
    && input.parts.length === 1;
}

function buildHostedLinqMailboxTextPart(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
  mode: HostedLinqMailboxPartCompactionMode,
): HostedLinqMailboxTextPartBuildResult {
  const textValues: string[] = [];
  let textBudget = mode === "compact"
    ? HOSTED_LINQ_COMPACT_TEXT_BUDGET_CHARS
    : HOSTED_LINQ_TEXT_PART_MAX_CHARS;
  let omittedParts = 0;
  let truncatedContent = false;

  for (const part of parts) {
    if (part.type !== "text" && part.type !== "link") {
      continue;
    }

    const value = normalizeHostedLinqPartText(part.value);
    if (!value) {
      continue;
    }

    const separatorBudget = textValues.length > 0 ? 1 : 0;
    const available = textBudget - separatorBudget;
    if (available <= 0) {
      omittedParts += 1;
      truncatedContent = true;
      continue;
    }

    const truncated = truncateHostedLinqPartText(value, available);
    if (truncated.truncated) {
      truncatedContent = true;
    }

    if (!truncated.value) {
      omittedParts += 1;
      continue;
    }

    textValues.push(truncated.value);
    textBudget = Math.max(0, textBudget - separatorBudget - truncated.value.length);
  }

  const text = textValues.join("\n");

  return {
    omittedParts,
    part: text
      ? {
          type: "text",
          value: text,
        }
      : null,
    truncatedContent,
  };
}

function buildHostedLinqMailboxAttachmentParts(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
  mode: HostedLinqMailboxPartCompactionMode,
): HostedLinqMailboxAttachmentPartsBuildResult {
  const maxAttachmentParts = mode === "compact"
    ? Math.min(16, HOSTED_LINQ_MESSAGE_MAX_PARTS)
    : HOSTED_LINQ_MESSAGE_MAX_PARTS;
  const attachmentParts: HostedExecutionLinqConversationMessagePart[] = [];
  let omittedParts = 0;

  for (const part of parts) {
    if (part.type !== "media" && part.type !== "voice_memo") {
      continue;
    }

    if (attachmentParts.length >= maxAttachmentParts) {
      omittedParts += 1;
      continue;
    }

    attachmentParts.push({
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

  return {
    omittedParts,
    parts: attachmentParts,
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
    omittedAttachmentParts?: number;
    omittedParts: number;
    omittedTextParts?: number;
    truncatedContent: boolean;
  },
): HostedExecutionLinqConversationMessagePart[] {
  const details = [
    input.mode === "compact" ? "payload was compacted" : null,
    input.omittedTextParts && input.omittedTextParts > 0
      ? `${input.omittedTextParts} text/link part(s) omitted`
      : null,
    input.omittedAttachmentParts && input.omittedAttachmentParts > 0
      ? `${input.omittedAttachmentParts} attachment descriptor(s) omitted`
      : null,
    input.omittedParts > 0 && !input.omittedTextParts && !input.omittedAttachmentParts
      ? `${input.omittedParts} part(s) omitted`
      : null,
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

async function lookupHostedMemberIdentityByPhoneNumberForLinqWebhook(input: {
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<Awaited<ReturnType<typeof lookupHostedMemberIdentityByPhoneNumber>>> {
  try {
    return await lookupHostedMemberIdentityByPhoneNumber(input);
  } catch (error) {
    if (isLocalHostedDomainRootAuthorityMismatch(error)) {
      return null;
    }

    throw error;
  }
}

function isLocalHostedDomainRootAuthorityMismatch(error: unknown): boolean {
  return (
    process.env.HOSTED_CRYPTO_ENV === "local"
    && error instanceof Error
    && error.message === "Hosted domain root envelope authority signature verification failed."
  );
}

function isHostedLinqGroupChat(messageEvent: HostedLinqMessageReceivedEvent): boolean {
  return messageEvent.data.chat?.is_group === true;
}

function isHostedLinqDirectChatAttested(
  messageEvent: HostedLinqMessageReceivedEvent,
): boolean {
  return messageEvent.data.chat?.is_group === false;
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
