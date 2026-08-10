import type { Prisma } from "@prisma/client";
import {
  type HostedExecutionLinqConversationMessage,
  type HostedExecutionLinqConversationMessagePart,
  buildHostedExecutionLinqConversationMessageWake,
  isHostedLinqConversationMessageWake,
  readHostedLinqConversationMessageContact,
} from "@murphai/hosted-execution";
import {
  createHostedMailboxAssistantInputId,
  readHostedConversationAssistantIdentifierSecret,
} from "@murphai/hosted-execution/assistant-identifiers";

import { issueHostedInviteTx } from "./invite-service";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import {
  activeHostedMemberAccessWhere,
  readActiveHostedMemberAccess,
  readHostedRuntimeAiAccessDecision,
} from "./member-access";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  acceptHostedFamilyInviteFromPhoneTx,
  buildHostedFamilyInviteAcceptedReplyText,
  resolveHostedFamilyInviteTokenForInbound,
} from "./family-plan";
import {
  ensureHostedMemberForPendingLinqParticipantContactTx,
  ensureHostedMemberForPhoneResolutionTx,
} from "./member-identity-service";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import {
  lookupHostedMemberByVerifiedEmailAddress,
} from "./hosted-member-store";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
  demoteHostedMemberLinqGroupChatBindingsTx,
  lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqParticipantContact,
  readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "./hosted-member-routing-store";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
  type HostedOnboardingStructuredLogDetails,
  type HostedOnboardingStructuredLogValue,
} from "./logging";
import {
  HOSTED_LINQ_DAILY_TEXT_LIMIT,
  HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
  incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState,
  readHostedLinqDailyState,
} from "./linq-daily-state";
import {
  type HostedLinqMessageEditedEvent,
  type HostedLinqMessageReceivedEvent,
  type HostedLinqTypingIndicatorStartedEvent,
  type HostedLinqWebhookEvent,
  shouldIgnoreHostedLinqForLocalInboundGuard,
} from "./linq";
import {
  getHostedLinqChatHandles,
  type HostedLinqChatHandleSummary,
} from "./linq-client";
import {
  appendHostedMailboxEnvelopeWithSourceMessageTx,
  readHostedMailboxItemByDedupeKey,
  readHostedMailboxSourceConversationEntriesTx,
} from "../hosted-mailbox/store";
import {
  renewHostedThreadContainerParticipantAccessTx,
} from "../hosted-groups/thread-container-participant-access";
import {
  bindHostedMemberHomeLinqChat,
  bindHostedMemberPendingLinqChat,
  bindHostedMemberPendingLinqChatAndTrackInbound,
  buildActiveMemberDirectPlan,
  buildConversationHomeRedirectResponse,
  buildFallbackSignupLinkResponse,
  buildFamilyInviteAcceptedResponse,
  buildGroupLineRecoveryResponse,
  buildGroupSetupRequiredResponse,
  buildIgnoredLinqWebhookPlan,
  buildQuotaReplyResponse,
  buildSignupLinkResponse,
  buildInactiveMemberAccessNoticeResponse,
  HOSTED_LINQ_INACTIVE_MEMBER_NOTICE_REASON,
  isHostedLinqDeliverableFirstContact,
  isHostedLinqIMessageService,
  resolveHostedLinqFirstContactContentDisposition,
  resolveHostedOnboardingLinqMessageContext,
} from "./webhook-provider-linq-shared";
import {
  type HostedLinqHomeLineRouteBindingAuthority,
  type HostedLinqHomeLineRouteBindingResult,
  readHostedLinqHomeLineAuthority,
  resolveHostedMemberLinqHomeLineRouteBindingTx,
  reserveHostedLinqHomeLineFromPoolTx,
  startOfUtcDay,
} from "./linq-home-routing";
import {
  claimHostedLinqProactiveConversationCapacityTx,
  readHostedLinqIncomingLineState,
} from "./linq-line-store";
import {
  readHostedLinqGroupLineRecoveryAuthorityTx,
} from "./linq-delivery-store";
import {
  resolveHostedLinqSignupWelcomeDailyLimit,
} from "./linq-routing-policy";
import {
  createHostedEmailLookupKey,
  createHostedEmailLookupKeyReadCandidates,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import { normalizePhoneNumber } from "./phone";
import {
  refreshHostedThreadContainerDeliveryRouteTx,
  type PreparedHostedThreadContainerCreation,
  type PreparedHostedThreadContainerDeliveryRoute,
} from "../hosted-routing/thread-container-service";
import {
  ensureHostedPreparedLinqThreadContainerRouteTx,
} from "../hosted-groups/prepared-thread-container";
import {
  readHostedPendingGroupSetup,
  readHostedPendingGroupSetupCandidatesForParticipantsTx,
  selectHostedPendingGroupSetupCandidate,
} from "../hosted-groups/pending-group-setup";
import type {
  HostedLinqFirstContactAdmissionDecision,
  HostedLinqFirstContactAdmissionRequest,
} from "./linq-first-contact-admission";
import {
  isHostedLinqInstantStartCandidate,
  isHostedLinqInstantStartEligible,
} from "./linq-instant-start";
import type { HostedWebhookWakeHandoff } from "./webhook-service-types";
import {
  readHostedGroupJoinOutreachReplyContextTx,
} from "../hosted-groups/group-join-outreach-store";
import {
  consumeHostedLinqThreadRouteParticipantAdditionPendingTx,
  consumeHostedLinqThreadRoutePendingContextTx,
  readHostedThreadRouteByThreadIdentity,
  requiresHostedThreadDeliveryRouteRefresh,
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
import {
  acquireHostedLinqParticipantPhoneLockTx,
  createHostedLinqParticipantContact,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContact,
  type HostedLinqParticipantIdentity,
} from "./linq-participant-contact";
import {
  observeHostedUsageReferralInboundTx,
} from "../hosted-growth/usage-referral";
import {
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  hasActiveHostedCryptoDomainRootsForUserTx,
} from "../hosted-crypto/domain-root-store";
import { getHostedOnboardingEnvironment } from "./runtime";

const HOSTED_LINQ_MESSAGE_MAX_PARTS = 32;
const HOSTED_LINQ_CONVERSATION_WAKE_INLINE_TARGET_BYTES = 128 * 1024;
const HOSTED_LINQ_TEXT_PART_MAX_CHARS = 20_000;
const HOSTED_LINQ_COMPACT_TEXT_BUDGET_CHARS = 20_000;
const HOSTED_LINQ_ATTACHMENT_ID_MAX_CHARS = 256;
const HOSTED_LINQ_ATTACHMENT_FILE_NAME_MAX_CHARS = 160;
const HOSTED_LINQ_ATTACHMENT_MIME_TYPE_MAX_CHARS = 120;
const HOSTED_LINQ_FIRST_CONTACT_ADMISSION_SERVICES = new Set([
  "imessage",
  "rcs",
  "sms",
]);
const HOSTED_LINQ_STAGING_NOTE_PART_TYPE = "text";

type HostedLinqExistingMemberMatch =
  | "home-linq-chat"
  | "none"
  | "pending-contact"
  | "phone-identity"
  | "verified-email";
type HostedLinqDailyState = Awaited<ReturnType<typeof incrementHostedLinqInboundDailyState>>;
interface VerifiedHostedLinqInboundParticipant {
  contact: HostedLinqParticipantContact;
  memberId: string;
}

/**
 * Resolves a typing hint only through an established direct home-chat binding.
 * This result is speculative latency data, never authorization to process work.
 */
export async function resolveHostedLinqTypingPrewarmMemberId(input: {
  event: HostedLinqTypingIndicatorStartedEvent;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const memberId = await lookupHostedLinqPrewarmHomeChatMemberId({
    chatId: input.event.data.chat_id,
    prisma: input.prisma,
  });
  return memberId && await isHostedLinqMailboxRootPrewarmEligible({
    memberId,
    prisma: input.prisma,
  })
    ? memberId
    : null;
}

/**
 * Resolves only a speculative KMS prewarm target. It deliberately reads blind
 * indexes and member ids rather than projecting encrypted identity/routing
 * fields. The planner repeats every route, identity, activation, and access
 * decision inside its transaction; this result never grants authority.
 */
export async function resolveHostedLinqMailboxPayloadRootPrewarmMemberId(input: {
  event: HostedLinqWebhookEvent;
  prisma: HostedOnboardingReadClient;
  threadRoute: Pick<HostedThreadRouteSnapshot, "containerMemberId"> | null;
}): Promise<string | null> {
  if (input.event.event_type !== "message.received") {
    return null;
  }

  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  const { messageEvent, participantContact, summary } = context;
  if (summary.isFromMe) {
    return null;
  }

  if (input.threadRoute) {
    return await isHostedLinqMailboxRootPrewarmEligible({
      memberId: input.threadRoute.containerMemberId,
      prisma: input.prisma,
    })
      ? input.threadRoute.containerMemberId
      : null;
  }

  if (
    isHostedLinqGroupChat(messageEvent)
    || messageEvent.data.message.parts.length === 0
    || !participantContact
    || shouldIgnoreHostedLinqForLocalInboundGuard({
      isFromMe: summary.isFromMe,
      participantContact,
    })
  ) {
    return null;
  }

  const [identityMemberId, homeChatMemberId] = await Promise.all([
    lookupHostedLinqPrewarmIdentityMemberId({
      contact: participantContact,
      prisma: input.prisma,
    }),
    lookupHostedLinqPrewarmHomeChatMemberId({
      chatId: summary.chatId,
      prisma: input.prisma,
    }),
  ]);
  const pendingContactMemberId = identityMemberId || homeChatMemberId
    ? null
    : await lookupHostedLinqPrewarmPendingContactMemberId({
        contact: participantContact,
        prisma: input.prisma,
      });
  const memberId =
    identityMemberId
    ?? homeChatMemberId
    ?? pendingContactMemberId;

  // Match the transaction's fail-closed home-chat owner check. Identity wins
  // ordinary precedence, but it cannot retarget a chat already owned by a
  // different member.
  if (
    memberId
    && homeChatMemberId
    && homeChatMemberId !== memberId
  ) {
    return null;
  }

  return memberId && await isHostedLinqMailboxRootPrewarmEligible({
    memberId,
    prisma: input.prisma,
  })
    ? memberId
    : null;
}

/**
 * Bounds speculative new-container crypto work to a group that has at least
 * one currently active creation candidate. The planner repeats identity,
 * pending-setup, access, and line-authority checks under its transaction; this
 * read only decides whether pre-transaction KMS preparation is worthwhile.
 */
export async function shouldPrepareHostedLinqThreadContainerCrypto(input: {
  event: HostedLinqWebhookEvent;
  participantMemberIds: readonly string[];
  pendingGroupRosterUnavailable?: boolean;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  if (
    input.event.event_type !== "message.received"
    || input.pendingGroupRosterUnavailable === true
  ) {
    return false;
  }
  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  const { messageEvent, participantContact, summary } = context;
  if (
    !isHostedLinqGroupChat(messageEvent)
    || summary.isFromMe
    || !participantContact
    || messageEvent.data.message.parts.length === 0
    || shouldIgnoreHostedLinqForLocalInboundGuard({
      isFromMe: summary.isFromMe,
      participantContact,
    })
  ) {
    return false;
  }

  const recipientPhone = normalizePhoneNumber(context.recipientPhoneNumber);
  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    recipientPhone,
  );
  if (!recipientPhone || recipientPhoneLookupKeys.length === 0) {
    return false;
  }
  const lineState = await readHostedLinqIncomingLineState({
    phoneNumberLookupKeys: recipientPhoneLookupKeys,
    prisma: input.prisma,
  });
  if (
    !("phoneNumberLookupKey" in lineState)
    || lineState.kind === "hard_blocked"
  ) {
    return false;
  }

  const senderMemberId = await lookupHostedLinqPrewarmIdentityMemberId({
    contact: participantContact,
    prisma: input.prisma,
  });
  const pendingSenderMemberId = senderMemberId || !recipientPhone
    ? null
    : (await lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact: participantContact,
        linqChatId: summary.chatId,
        prisma: input.prisma,
        recipientPhone,
      }))?.core.id ?? null;
  const candidateSenderMemberId = senderMemberId ?? pendingSenderMemberId;
  const activeSenderMemberId = candidateSenderMemberId
    && (await readHostedRuntimeAiAccessDecision({
      memberId: candidateSenderMemberId,
      prisma: input.prisma,
    })).allowed
    ? candidateSenderMemberId
    : null;
  if (lineState.kind === "at_risk") {
    if (
      !activeSenderMemberId
      || !isHostedLinqIMessageService(messageEvent.data.service)
    ) {
      return false;
    }
    const senderAuthority = readHostedLinqHomeLineAuthority(
      await readHostedMemberRoutingState({
        memberId: activeSenderMemberId,
        prisma: input.prisma,
      }),
    );
    return senderAuthority.kind !== "none"
      && normalizePhoneNumber(senderAuthority.recipientPhone) === recipientPhone;
  }
  if (activeSenderMemberId) {
    return true;
  }
  if (
    hostedLinqFirstContactContainsBlockedContent({
      event: messageEvent,
      participantContact,
    })
    || input.participantMemberIds.length === 0
  ) {
    return false;
  }

  const occurredAt = new Date(context.occurredAt);
  const recoveredPendingSetup = await resolveHostedLinqRecoveredPendingGroupSetup({
    occurredAt,
    participantMemberIds: input.participantMemberIds,
    recoveredRecipientPhoneLookupKey: lineState.phoneNumberLookupKey,
    senderMemberId: null,
    threadId: summary.chatId,
    tx: input.prisma,
  });
  if (recoveredPendingSetup) {
    return true;
  }
  const candidates =
    await readHostedPendingGroupSetupCandidatesForParticipantsTx({
      occurredAt,
      participantMemberIds: input.participantMemberIds,
      tx: input.prisma,
    });
  return selectHostedPendingGroupSetupCandidate({
    candidates: candidates.filter((candidate) =>
      recipientPhoneLookupKeys.includes(candidate.recipientPhoneLookupKey)
    ),
    senderMemberId: null,
  }).kind === "selected";
}

async function lookupHostedLinqPrewarmIdentityMemberId(input: {
  contact: HostedLinqParticipantContact;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  if (input.contact.kind === "phone") {
    const lookupKeys = createHostedPhoneLookupKeyReadCandidates(input.contact.value);
    if (lookupKeys.length === 0) {
      return null;
    }
    const records = await input.prisma.hostedMemberIdentity.findMany({
      select: {
        memberId: true,
      },
      where: {
        phoneLookupKey: {
          in: lookupKeys,
        },
      },
    });
    return resolveUniqueHostedLinqPrewarmMemberId({
      ambiguityCode: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
      matchedBy: "phoneNumber",
      records,
    });
  }

  const lookupKeys = createHostedEmailLookupKeyReadCandidates(input.contact.value);
  if (lookupKeys.length === 0) {
    return null;
  }
  const records = await input.prisma.hostedMemberEmailAuthorization.findMany({
    select: {
      memberId: true,
    },
    where: {
      verifiedEmailLookupKey: {
        in: lookupKeys,
      },
      verifiedEmailVerifiedAt: {
        not: null,
      },
    },
  });
  return resolveUniqueHostedLinqPrewarmMemberId({
    ambiguityCode: "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS",
    matchedBy: "verifiedEmail",
    records,
  });
}

async function lookupHostedLinqPrewarmHomeChatMemberId(input: {
  chatId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const lookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  if (lookupKeys.length === 0) {
    return null;
  }
  const records = await input.prisma.hostedMemberRouting.findMany({
    select: {
      memberId: true,
    },
    where: {
      linqChatLookupKey: {
        in: lookupKeys,
      },
    },
  });
  return resolveUniqueHostedLinqPrewarmMemberId({
    ambiguityCode: "LINQ_HOME_CHAT_ROUTING_LOOKUP_AMBIGUOUS",
    matchedBy: "linqChatLookupKey",
    records,
  });
}

async function lookupHostedLinqPrewarmPendingContactMemberId(input: {
  contact: HostedLinqParticipantContact;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
    kind: input.contact.kind,
    value: input.contact.value,
  });
  if (lookupKeys.length === 0) {
    return null;
  }
  const records = await input.prisma.hostedMemberRouting.findMany({
    select: {
      memberId: true,
    },
    where: {
      pendingLinqParticipantContactLookupKey: {
        in: lookupKeys,
      },
    },
  });
  return resolveUniqueHostedLinqPrewarmMemberId({
    ambiguityCode: "LINQ_PENDING_CONTACT_ROUTING_LOOKUP_AMBIGUOUS",
    matchedBy: "pendingLinqParticipantContactLookupKey",
    records,
  });
}

function resolveUniqueHostedLinqPrewarmMemberId(input: {
  ambiguityCode: string;
  matchedBy: string;
  records: Array<{ memberId: string }>;
}): string | null {
  const memberIds = new Set(input.records.map((record) => record.memberId));
  if (memberIds.size === 0) {
    return null;
  }
  if (memberIds.size !== 1) {
    throw hostedOnboardingError({
      code: input.ambiguityCode,
      details: {
        matchCount: memberIds.size,
        matchedBy: input.matchedBy,
      },
      httpStatus: 500,
      message: "Hosted Linq prewarm lookup matched multiple members.",
      retryable: true,
    });
  }
  return memberIds.values().next().value ?? null;
}

async function isHostedLinqMailboxRootPrewarmEligible(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  return await readActiveHostedMemberAccess(input)
    && await hasActiveHostedCryptoDomainRootsForUserTx({
      tx: input.prisma,
      userId: input.memberId,
    });
}

const HOSTED_LINQ_MESSAGE_EDIT_RETRY_WINDOW_MS = 25 * 60_000;
const HOSTED_LINQ_MESSAGE_EDIT_MAX_SOURCE_ROWS = 6;

export async function planHostedLinqMessageEditedWebhook(input: {
  event: HostedLinqMessageEditedEvent;
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedOnboardingLinqDirectPlan> {
  const event = input.event;
  if (event.data.direction === "outbound") {
    return buildIgnoredHostedLinqMessageEditPlan("outbound-message-edit");
  }

  const sourceMessageLookupKey = requireHostedLinqSourceMessageLookupKey(
    event.data.id,
  );
  const sourceMessageLookupKeyReadCandidates =
    createHostedLinqMessageLookupKeyReadCandidates(event.data.id);
  const sourceEntries = await readHostedMailboxSourceConversationEntriesTx({
    sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
    tx: input.prisma,
  });
  if (sourceEntries.length > HOSTED_LINQ_MESSAGE_EDIT_MAX_SOURCE_ROWS) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-lineage-ambiguous");
  }
  if (sourceEntries.length === 0) {
    const now = input.now ?? new Date();
    const eventAgeMs = Math.max(0, now.getTime() - Date.parse(event.created_at));
    if (eventAgeMs <= HOSTED_LINQ_MESSAGE_EDIT_RETRY_WINDOW_MS) {
      throw hostedOnboardingError({
        code: "LINQ_MESSAGE_EDIT_SOURCE_PENDING",
        httpStatus: 503,
        message: "The original Linq message has not reached the mailbox yet.",
        retryable: true,
      });
    }
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-source-missing");
  }

  const sourceUserIds = new Set(sourceEntries.map((entry) => entry.userId));
  if (sourceUserIds.size !== 1) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-source-ambiguous");
  }
  const sourceUserId = sourceEntries[0]?.userId;
  if (!sourceUserId) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-source-missing");
  }

  const linqEntries = sourceEntries.filter((entry) =>
    entry.wake && isHostedLinqConversationMessageWake(entry.wake)
  );
  const originalEntries = linqEntries.filter((entry) =>
    entry.wake
    && isHostedLinqConversationMessageWake(entry.wake)
    && entry.wake.message.linqMessage.messageId === event.data.id
    && entry.wake.message.linqMessage.editedTextPartIndex === undefined
  );
  if (originalEntries.length !== 1) {
    return buildIgnoredHostedLinqMessageEditPlan(
      sourceEntries.some((entry) => !entry.contentAvailable)
        ? "message-edit-source-retired"
        : "message-edit-source-invalid",
    );
  }
  const originalWake = originalEntries[0]?.wake;
  if (!originalWake || !isHostedLinqConversationMessageWake(originalWake)) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-source-invalid");
  }
  const correctionWake = buildHostedLinqMessageEditedWake({
    event,
    originalWake,
  });
  const replayEntry = linqEntries.find((entry) =>
    entry.wake?.eventId === event.event_id
  );
  if (replayEntry) {
    const replayMatches = replayEntry.wake
      && isHostedLinqConversationMessageWake(replayEntry.wake)
      && hasSameHostedLinqMessageEdit(replayEntry.wake, correctionWake);
    return {
      desiredSideEffects: [],
      response: {
        duplicate: true,
        ignored: true,
        ok: true,
        reason: replayMatches
          ? "duplicate-message-edit"
          : "message-edit-event-conflict",
      },
      wakeHandoffs: [{
        eventId: event.event_id,
        linqChatId: event.data.chat.id,
        mailboxItemId: replayEntry.itemId,
        source: "linq",
        userId: sourceUserId,
      }],
    };
  }
  if (sourceEntries.length >= HOSTED_LINQ_MESSAGE_EDIT_MAX_SOURCE_ROWS) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-limit-reached");
  }

  const participantContact = createHostedLinqParticipantContact({
    kind: "phone",
    value: event.data.sender_handle.handle,
  }) ?? createHostedLinqParticipantContact({
    kind: "email",
    value: event.data.sender_handle.handle,
  });
  if (!participantContact) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-sender-invalid");
  }
  const sourceContact = readHostedLinqConversationMessageContact(
    originalWake.message,
  );
  const participantLookupKeyCandidates =
    createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: participantContact.kind,
      value: participantContact.value,
    });
  if (
    sourceContact.kind !== participantContact.kind
    || !participantLookupKeyCandidates.includes(sourceContact.lookupKey)
    || originalWake.message.linqMessage.chatId !== event.data.chat.id
    || originalWake.message.linqMessage.isFromMe
  ) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-authority-mismatch");
  }

  const originalIsDirect =
    originalWake.message.linqMessage.threadIsDirect !== false;
  if (originalIsDirect) {
    await lockHostedMemberRow(input.prisma, sourceUserId);
    const [routing, accessDecision] = await Promise.all([
      readHostedMemberRoutingState({
        memberId: sourceUserId,
        prisma: input.prisma,
      }),
      readHostedRuntimeAiAccessDecision({
        memberId: sourceUserId,
        now: input.now ?? new Date(),
        prisma: input.prisma,
      }),
    ]);
    if (
      !accessDecision.allowed
      || routing?.linqChatId !== event.data.chat.id
      || routing.linqParticipantContact?.kind !== participantContact.kind
      || !participantLookupKeyCandidates.includes(
        routing.linqParticipantContact.lookupKey,
      )
    ) {
      return buildIgnoredHostedLinqMessageEditPlan(
        "message-edit-direct-route-inactive",
      );
    }
  } else {
    const authorityNow = input.now ?? new Date();
    const senderMemberId = originalWake.message.senderMemberId
      ?? (
        await resolveHostedThreadContainerInboundParticipantTx({
          participantContact,
          prisma: input.prisma,
        })
      )?.memberId
      ?? null;
    if (senderMemberId) {
      await lockHostedMemberRow(input.prisma, senderMemberId);
    }
    const [route, participant, containerAccess, senderAccess] =
      await Promise.all([
        readHostedThreadRouteByThreadIdentity({
          channel: "linq",
          prisma: input.prisma,
          threadId: event.data.chat.id,
        }),
        senderMemberId
          ? input.prisma.hostedThreadContainerParticipant.findUnique({
              select: {
                handleLookupKey: true,
                removedAt: true,
              },
              where: {
                containerMemberId_participantMemberId: {
                  containerMemberId: sourceUserId,
                  participantMemberId: senderMemberId,
                },
              },
            })
          : null,
        readHostedRuntimeAiAccessDecision({
          memberId: sourceUserId,
          now: authorityNow,
          prisma: input.prisma,
        }),
        senderMemberId
          ? readHostedRuntimeAiAccessDecision({
              memberId: senderMemberId,
              now: authorityNow,
              prisma: input.prisma,
            })
          : null,
      ]);
    if (
      route?.containerMemberId !== sourceUserId
      || !containerAccess.allowed
      || (
        senderAccess !== null
        && !senderAccess.allowed
        && senderAccess.reason === "health_data_consent_withdrawn"
      )
      || (
        participant !== null
        && (
          participant.removedAt !== null
          || !participantLookupKeyCandidates.includes(participant.handleLookupKey)
        )
      )
    ) {
      return buildIgnoredHostedLinqMessageEditPlan(
        "message-edit-group-route-inactive",
      );
    }
  }

  const editedAtMs = Date.parse(event.data.edited_at);
  const latestSamePartEditAtMs = linqEntries.reduce((latest, entry) => {
    const wake = entry.wake;
    if (
      !wake
      || !isHostedLinqConversationMessageWake(wake)
      || wake.message.linqMessage.editedTextPartIndex !== event.data.part.index
    ) {
      return latest;
    }
    return Math.max(latest, Date.parse(wake.occurredAt));
  }, Date.parse(originalWake.occurredAt));
  if (latestSamePartEditAtMs >= editedAtMs) {
    return buildIgnoredHostedLinqMessageEditPlan(
      latestSamePartEditAtMs === editedAtMs
        ? "message-edit-revision-ambiguous"
        : "message-edit-revision-stale",
    );
  }

  const mailboxAppend = await appendHostedMailboxEnvelopeWithSourceMessageTx({
    envelope: correctionWake,
    sourceMessageLookupKey,
    tx: input.prisma,
  });
  if (mailboxAppend.dedupeConflict) {
    return buildIgnoredHostedLinqMessageEditPlan("message-edit-event-conflict");
  }

  return {
    desiredSideEffects: [],
    response: {
      ...(mailboxAppend.duplicate ? { duplicate: true } : {}),
      ignored: false,
      ok: true,
      reason: mailboxAppend.duplicate
        ? "duplicate-message-edit"
        : "wake-appended-message-edit",
    },
    wakeHandoffs: [{
      eventId: event.event_id,
      linqChatId: event.data.chat.id,
      mailboxItemId: mailboxAppend.item.id,
      source: "linq",
      userId: sourceUserId,
      wakeMailboxCheckpoint: {
        lane: mailboxAppend.item.lane,
        laneSeq: mailboxAppend.item.laneSeq,
      },
    }],
  };
}

function buildIgnoredHostedLinqMessageEditPlan(
  reason: string,
): HostedOnboardingLinqDirectPlan {
  return {
    desiredSideEffects: [],
    response: {
      ignored: true,
      ok: true,
      reason,
    },
  };
}

function buildHostedLinqMessageEditedWake(input: {
  event: HostedLinqMessageEditedEvent;
  originalWake: ReturnType<typeof buildHostedExecutionLinqConversationMessageWake>;
}): ReturnType<typeof buildHostedExecutionLinqConversationMessageWake> {
  const originalMessage = input.originalWake.message;
  if (originalMessage.channel !== "linq") {
    throw new TypeError("Hosted Linq message edit source must be a Linq wake.");
  }
  const originalContact = readHostedLinqConversationMessageContact(
    originalMessage,
  );
  const originalLinqMessage = originalMessage.linqMessage;
  return buildHostedExecutionLinqConversationMessageWake({
    ...(originalMessage.accountLookupKey === undefined
      ? {}
      : { accountLookupKey: originalMessage.accountLookupKey }),
    contactKind: originalContact.kind,
    contactLookupKey: originalContact.lookupKey,
    eventId: input.event.event_id,
    linqMessage: {
      chatId: originalLinqMessage.chatId,
      editedSourceInputId: createHostedMailboxAssistantInputId({
        dedupeKey: input.originalWake.eventId,
        eventId: input.originalWake.eventId,
        lane: "conversation",
        secret: readHostedConversationAssistantIdentifierSecret(
          input.originalWake,
        ),
        userId: input.originalWake.userId,
      }),
      editedTextPartIndex: input.event.data.part.index,
      from: originalLinqMessage.from,
      isFromMe: false,
      messageId: originalLinqMessage.messageId,
      parts: [{
        type: "text",
        value: input.event.data.part.text,
      }],
      reactionEligible: false,
      ...(originalLinqMessage.replyToMessageId === undefined
        ? {}
        : { replyToMessageId: originalLinqMessage.replyToMessageId }),
      ...(originalLinqMessage.replyToPartIndex === undefined
        ? {}
        : { replyToPartIndex: originalLinqMessage.replyToPartIndex }),
      ...(originalLinqMessage.service === undefined
        ? {}
        : { service: originalLinqMessage.service }),
      ...(originalLinqMessage.threadIsDirect === undefined
        ? {}
        : { threadIsDirect: originalLinqMessage.threadIsDirect }),
    },
    occurredAt: input.event.data.edited_at,
    ...(originalMessage.phoneLookupKey === undefined
      ? {}
      : { phoneLookupKey: originalMessage.phoneLookupKey }),
    ...(originalMessage.routeAuthority === undefined
      ? {}
      : { routeAuthority: originalMessage.routeAuthority }),
    ...(originalMessage.senderMemberId === undefined
      ? {}
      : { senderMemberId: originalMessage.senderMemberId }),
    userId: input.originalWake.userId,
  });
}

function hasSameHostedLinqMessageEdit(
  existingWake: ReturnType<typeof buildHostedExecutionLinqConversationMessageWake>,
  requestedWake: ReturnType<typeof buildHostedExecutionLinqConversationMessageWake>,
): boolean {
  const existing = existingWake.message.linqMessage;
  const requested = requestedWake.message.linqMessage;
  return existingWake.eventId === requestedWake.eventId
    && existingWake.userId === requestedWake.userId
    && existingWake.occurredAt === requestedWake.occurredAt
    && existing.chatId === requested.chatId
    && existing.messageId === requested.messageId
    && existing.editedSourceInputId === requested.editedSourceInputId
    && existing.editedTextPartIndex === requested.editedTextPartIndex
    && existing.parts.length === 1
    && requested.parts.length === 1
    && existing.parts[0]?.type === "text"
    && requested.parts[0]?.type === "text"
    && existing.parts[0].value === requested.parts[0].value;
}

export async function planHostedOnboardingLinqWebhook(input: {
  affirmativeReaction?: boolean;
  event: HostedLinqWebhookEvent;
  firstContactAdmissionDecision?: HostedLinqFirstContactAdmissionDecision | null;
  instantStartAllowed?: boolean;
  pendingGroupParticipantMemberIds?: readonly string[] | null;
  pendingGroupRosterUnavailable?: boolean;
  preparedThreadContainerCreation?: PreparedHostedThreadContainerCreation;
  preparedThreadDeliveryRoute?: PreparedHostedThreadContainerDeliveryRoute;
  prisma: Prisma.TransactionClient;
  requireFirstContactAdmission?: boolean;
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
    participantPhoneNumber,
    recipientPhoneNumber,
    summary,
  } = context;

  const accountLookupKey = createHostedPhoneLookupKey(recipientPhoneNumber);
  const threadRouteAccountLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    recipientPhoneNumber,
  );
  const explicitThreadRoute = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: summary.chatId,
  });
  if (explicitThreadRoute) {
    return planHostedLinqExistingThreadRouteWebhook({
      ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
      accountLookupKey,
      accountLookupKeys: threadRouteAccountLookupKeys,
      context,
      event: input.event,
      preparedDeliveryRoute: input.preparedThreadDeliveryRoute,
      prisma: input.prisma,
      route: explicitThreadRoute,
    });
  }

  if (isHostedLinqGroupChat(messageEvent)) {
    return planHostedLinqGroupChatWebhook({
      ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
      context,
      event: input.event,
      firstContactAdmissionDecision: input.firstContactAdmissionDecision,
      participantMemberIds: input.pendingGroupParticipantMemberIds ?? [],
      preparedThreadContainerCreation: input.preparedThreadContainerCreation,
      preparedThreadDeliveryRoute: input.preparedThreadDeliveryRoute,
      rosterUnavailable: input.pendingGroupRosterUnavailable ?? false,
      prisma: input.prisma,
      requireFirstContactAdmission: input.requireFirstContactAdmission,
      threadRouteAccountLookupKeys,
    });
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

  if (participantContact.kind === "phone") {
    // The outreach opener holds this same lock through provider acceptance.
    // Waiting here before identity and outreach reads makes an immediate reply
    // observe either the committed opener or none of its state, never a generic
    // onboarding plan from a half-visible dispatch.
    await acquireHostedLinqParticipantPhoneLockTx({
      phoneNumber: participantContact.value,
      tx: input.prisma,
    });
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
  const incomingHomeLinqChatOwnerLookup = await lookupHostedMemberRoutingByHomeLinqChatId({
    linqChatId: summary.chatId,
    prisma: input.prisma,
  });
  const existingHomeLinqChatLookup = existingMemberLookup
    ? null
    : incomingHomeLinqChatOwnerLookup;
  const existingPendingLinqContactLookup = existingMemberLookup || existingHomeLinqChatLookup
    ? null
    : await lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact: participantContact,
        prisma: input.prisma,
      });
  const existingMember =
    existingMemberLookup?.core
    ?? existingHomeLinqChatLookup?.core
    ?? existingPendingLinqContactLookup?.core
    ?? null;
  const existingMemberMatch = resolveHostedLinqExistingMemberMatch({
    existingHomeLinqChatLookupPresent: Boolean(existingHomeLinqChatLookup),
    existingMemberLookupPresent: Boolean(existingMemberLookup),
    existingPendingLinqContactLookupPresent: Boolean(existingPendingLinqContactLookup),
    participantContactKind: participantContact.kind,
  });
  const memberRouteBindingAuthority = resolveHostedLinqHomeLineRouteBindingAuthority({
    existingMemberMatch,
    participantContact,
  });

  // Durable authority: a chat that is already another member's home chat must
  // never be rebound through a participant identity/pending-contact match.
  if (
    existingMember
    && incomingHomeLinqChatOwnerLookup
    && incomingHomeLinqChatOwnerLookup.routing.memberId !== existingMember.id
  ) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("home-chat-owner-mismatch"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: false,
        existingMemberMatch,
        reason: "home-chat-owner-mismatch",
        routeStage: "ignored-home-chat-owner-mismatch",
      }),
    );
  }
  const existingMemberSuspended = existingMember
    ? isHostedMemberSuspended(existingMember.suspendedAt)
    : false;
  let existingMemberEffectiveActive = existingMember && !existingMemberSuspended
    ? await readActiveHostedMemberAccess({
        memberId: existingMember.id,
        prisma: input.prisma,
      })
    : false;
  let instantStartOwner: HostedLinqInstantStartOwner | null = null;

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
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "own-message",
        routeStage: "ignored-own-message",
      }),
    );
  }

  if (existingMember && existingMemberSuspended) {
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

  if (existingMember) {
    await lockHostedMemberRow(input.prisma, existingMember.id);
    const exactMemberAccess = await readHostedRuntimeAiAccessDecision({
      memberId: existingMember.id,
      noticeSeed: input.event.event_id,
      now: new Date(occurredAt),
      prisma: input.prisma,
    });
    if (
      !exactMemberAccess.allowed
      && exactMemberAccess.reason === "health_data_consent_withdrawn"
    ) {
      if (
        !isHostedLinqDirectChatAttested(messageEvent)
        || !exactMemberAccess.userNotice
      ) {
        return logHostedLinqWebhookPlannerDecisionAndReturn(
          buildIgnoredLinqWebhookPlan("health-data-consent-withdrawn"),
          buildHostedLinqWebhookPlannerDetails(input.event, context, {
            accessReason: exactMemberAccess.reason,
            existingMemberActive: false,
            existingMemberMatch,
            reason: "health-data-consent-withdrawn",
            routeStage: "health-data-consent-withdrawn",
          }),
        );
      }
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildInactiveMemberAccessNoticeResponse({
          chatId: summary.chatId,
          memberId: existingMember.id,
          message: exactMemberAccess.userNotice.message,
          messageId: summary.messageId,
          noticeCode: exactMemberAccess.userNotice.code,
          occurredAt,
          sourceEventId: input.event.event_id,
        }),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          accessReason: exactMemberAccess.reason,
          existingMemberActive: false,
          existingMemberMatch,
          noticeCode: exactMemberAccess.userNotice.code,
          reason: HOSTED_LINQ_INACTIVE_MEMBER_NOTICE_REASON[
            exactMemberAccess.userNotice.code
          ],
          routeStage: "health-data-consent-withdrawn",
        }),
      );
    }
  }

  const buildUnassignableHomeLinePlan = (routeStage: string) =>
    logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("unassignable-home-line"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "unassignable-home-line",
        routeStage,
      }),
    );
  const buildHomeLineCapacityExhaustedPlan = (routeStage: string) =>
    logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("home-line-capacity-exhausted"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "home-line-capacity-exhausted",
        routeStage,
      }),
    );
  const buildRouteBindingBlockedPlan = (
    bindingResult: HostedLinqHomeLineRouteBindingResult,
    routeStages: {
      capacityExhausted: string;
      redirect: string;
      unassignable: string;
      unattestedDirect: string;
      unknownHome: string;
    },
  ): HostedOnboardingLinqDirectPlan | null => {
    if (bindingResult.kind === "bind") {
      return null;
    }

    if (bindingResult.kind === "unassignable") {
      return buildUnassignableHomeLinePlan(routeStages.unassignable);
    }

    if (bindingResult.kind === "capacity_exhausted") {
      return buildHomeLineCapacityExhaustedPlan(routeStages.capacityExhausted);
    }

    if (bindingResult.kind === "redirect_to_home") {
      if (!existingMember) {
        return buildUnassignableHomeLinePlan(routeStages.unassignable);
      }

      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildConversationHomeRedirectResponse({
          chatId: summary.chatId,
          homeRecipientPhone: bindingResult.homeRecipientPhone,
          memberId: existingMember.id,
          messageId: summary.messageId,
          occurredAt: context.occurredAt,
          sourceEventId: input.event.event_id,
        }),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          existingMemberActive: existingMemberEffectiveActive,
          existingMemberMatch,
          homeRoutePresent: true,
          reason: "redirect-to-home",
          routeDecision: bindingResult.kind,
          routeStage: routeStages.redirect,
        }),
      );
    }

    if (bindingResult.kind === "ignore_unattested_direct") {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildIgnoredLinqWebhookPlan("unattested-direct-chat"),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          existingMemberActive: existingMemberEffectiveActive,
          existingMemberMatch,
          homeRoutePresent: true,
          reason: "unattested-direct-chat",
          routeDecision: bindingResult.kind,
          routeStage: routeStages.unattestedDirect,
        }),
      );
    }

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("unknown-home-line"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        homeRoutePresent: true,
        reason: "unknown-home-line",
        routeDecision: bindingResult.kind,
        routeStage: routeStages.unknownHome,
      }),
    );
  };

  const familyInviteTokenPresent = await resolveHostedFamilyInviteTokenForInbound({
    prisma: input.prisma,
    text: summary.text,
  }) !== null;
  let familyAcceptance: Awaited<ReturnType<typeof acceptHostedFamilyInviteFromPhoneTx>> = null;
  let familyActivationWake: HostedWebhookWakeHandoff | null = null;
  let familyRouteBlockedPlan: HostedOnboardingLinqDirectPlan | null = null;
  const familyRouteBlockedError = new Error("Hosted Linq family route is not bindable.");
  if (participantContact.kind === "phone") {
    try {
      familyAcceptance = await acceptHostedFamilyInviteFromPhoneTx({
        now: new Date(occurredAt),
        onAcceptedMemberLocked: async ({ acceptedMemberId }) => {
          const bindingResult = await resolveIncomingHostedLinqHomeLineRouteBindingTx({
            incomingChatId: summary.chatId,
            incomingDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
            incomingRecipientPhone: recipientPhoneNumber,
            memberAuthority: memberRouteBindingAuthority?.kind === "pending-contact"
              ? { kind: "member-identity" }
              : memberRouteBindingAuthority,
            memberId: acceptedMemberId,
            prisma: input.prisma,
          });
          familyRouteBlockedPlan = buildRouteBindingBlockedPlan(bindingResult, {
            capacityExhausted: "ignored-home-line-capacity-exhausted",
            redirect: "family-invite-redirect",
            unassignable: "ignored-unassignable-home-line",
            unattestedDirect: "family-invite-ignored-unattested-direct",
            unknownHome: "family-invite-ignored-home-line",
          });
          if (familyRouteBlockedPlan) {
            throw familyRouteBlockedError;
          }
          if (bindingResult.kind !== "bind") {
            familyRouteBlockedPlan = buildUnassignableHomeLinePlan(
              "ignored-unassignable-home-line",
            );
            throw familyRouteBlockedError;
          }

          await upsertHostedMemberHomeLinqBindingTx({
            clearPending: true,
            homeLineAssignedAt: bindingResult.homeLineAssignedAt,
            linqChatId: summary.chatId,
            memberId: acceptedMemberId,
            participantContact,
            prisma: input.prisma,
            recipientPhone: bindingResult.recipientPhone,
          });
        },
        onAcceptedMemberActivated: (activation) => {
          if (activation.hostedExecutionEventId && activation.hostedExecutionMailboxItemId) {
            familyActivationWake = {
              eventId: activation.hostedExecutionEventId,
              mailboxItemId: activation.hostedExecutionMailboxItemId,
              source: "linq",
              userId: activation.memberId,
            };
          }
        },
        phoneNumber: participantContact.value,
        text: summary.text,
        tx: input.prisma,
      });
    } catch (error) {
      if (error === familyRouteBlockedError && familyRouteBlockedPlan) {
        return familyRouteBlockedPlan;
      }
      if (!isExpectedHostedLinqFamilyInviteAcceptanceMiss(error)) {
        throw error;
      }
    }
  }

  if (familyAcceptance) {
    const dailyState = await incrementHostedLinqInboundDailyState({
      memberId: familyAcceptance.memberId,
      occurredAt,
      prisma: input.prisma,
    });

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildFamilyInviteAcceptedResponse({
        chatId: summary.chatId,
        memberId: familyAcceptance.memberId,
        message: buildHostedFamilyInviteAcceptedReplyText({
          memberId: familyAcceptance.memberId,
        }),
        messageId: summary.messageId,
        occurredAt,
        sourceEventId: input.event.event_id,
        ...(familyActivationWake ? { wakeHandoff: familyActivationWake } : {}),
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "family-invite-accepted",
        routeStage: "family-invite-accepted",
      }),
    );
  }

  if (familyInviteTokenPresent) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("family-invite-not-accepted"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "family-invite-not-accepted",
        routeStage: "ignored-family-invite-token",
      }),
    );
  }

  if (existingMember && !existingMemberEffectiveActive) {
    // The member row is also the home-route owner. Reclassify only after any
    // activation ahead of this request commits, and keep invite or mailbox
    // writes inside that same single-owner boundary.
    await acquireHostedMemberHomeLinqRouteLockTx({
      memberId: existingMember.id,
      prisma: input.prisma,
    });
    existingMemberEffectiveActive = await readActiveHostedMemberAccess({
      memberId: existingMember.id,
      prisma: input.prisma,
    });
    if (!existingMemberEffectiveActive) {
      instantStartOwner = await readHostedLinqInstantStartOwner({
        memberId: existingMember.id,
        now: new Date(),
        prisma: input.prisma,
      });
      if (
        instantStartOwner
        && instantStartOwner.eventId !== input.event.event_id
      ) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_INSTANT_START_IN_PROGRESS",
          httpStatus: 503,
          message: "Murph is still finishing this instant start. Try again.",
          retryable: true,
        });
      }
    }
  }

  const groupJoinContext = participantPhoneNumber
    ? await readHostedGroupJoinOutreachReplyContextTx({
        linqChatId: summary.chatId,
        participantMemberId: existingMember?.id ?? null,
        participantPhoneNumber,
        recipientPhoneNumber,
        replyToMessageId:
          messageEvent.data.message.reply_to?.message_id ?? null,
        sourceEventId: input.event.event_id,
        tx: input.prisma,
      })
    : null;
  const groupJoinMemberHomeRoute = existingMember && groupJoinContext
    ? await readHostedMemberRoutingState({
        memberId: existingMember.id,
        prisma: input.prisma,
      })
    : null;
  const groupJoinMemberHasHomeRoute = Boolean(
    groupJoinMemberHomeRoute?.linqChatId
      || groupJoinMemberHomeRoute?.linqRecipientPhone,
  );

  // An accepted opener is a narrow, reply-gated authority for this exact chat,
  // participant, and group. Honor it before ordinary billing and home-route
  // branches when the member already has a durable home route; route-free
  // recipients retain the existing first-contact binding and recovery path.
  if (
    existingMember
    && groupJoinContext
    && groupJoinMemberHasHomeRoute
  ) {
    // A correlation proves which opener owns a qualifying reply; it never
    // overrides recipient control. Keep that decision inside this one ordered
    // branch so opt-out wins before the group link, which wins before generic
    // billing and home-route handling below.
    if (
      resolveHostedLinqFirstContactContentDisposition({
        event: messageEvent,
        participantContact,
      }) === "blocked"
    ) {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildIgnoredLinqWebhookPlan("blocked-first-contact-content"),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          existingMemberActive: existingMemberEffectiveActive,
          existingMemberMatch,
          reason: "blocked-first-contact-content",
          routeStage: "ignored-group-join-blocked-first-contact-content",
        }),
      );
    }
    const dailyState = await incrementHostedLinqInboundDailyState({
      memberId: existingMember.id,
      occurredAt,
      prisma: input.prisma,
    });
    const invite = await issueHostedInviteTx({
      channel: "linq",
      memberId: existingMember.id,
      prisma: input.prisma,
    });
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildSignupLinkResponse({
        chatId: summary.chatId,
        groupJoinCode: groupJoinContext.joinCode,
        groupJoinOutreachId: groupJoinContext.outreachId,
        inviteCode: invite.inviteCode,
        inviteId: invite.id,
        memberId: existingMember.id,
        messageId: summary.messageId,
        occurredAt,
        service: messageEvent.data.service ?? null,
        sourceEventId: input.event.event_id,
        threadIsDirect: resolveHostedLinqThreadIsDirect(messageEvent),
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: Boolean(existingMemberEffectiveActive),
        existingMemberMatch,
        reason: "sent-signup-link",
        routeStage: "routed-member-group-join-link",
      }),
    );
  }

  // A member who already owns billing can never be onboarded as a first contact
  // on their own bound home chat: the pending-bind write would hit the home-route
  // race guard and 503 on every retry, forever. Answer from their access decision
  // and stop here instead. The decision carries a notice only for a member with
  // billing to recover, so a genuine first-time subscriber falls through to the
  // signup-link and fallback-retry paths below rather than being answered here.
  if (
    existingMember
    && !existingMemberEffectiveActive
    && incomingHomeLinqChatOwnerLookup?.routing.memberId === existingMember.id
  ) {
    const accessDecision = await readHostedRuntimeAiAccessDecision({
      memberId: existingMember.id,
      noticeSeed: input.event.event_id,
      now: new Date(occurredAt),
      prisma: input.prisma,
    });
    if (accessDecision.allowed) {
      // The two access reads disagreed. Trust the runtime decision and let the
      // normal active-member path own this inbound: falling through to the
      // first-contact tail would attempt the pending bind and 503 forever.
      existingMemberEffectiveActive = true;
    } else {
      const userNotice = accessDecision.userNotice;
      if (userNotice) {
        return logHostedLinqWebhookPlannerDecisionAndReturn(
          buildInactiveMemberAccessNoticeResponse({
            chatId: summary.chatId,
            memberId: existingMember.id,
            message: userNotice.message,
            messageId: summary.messageId,
            noticeCode: userNotice.code,
            occurredAt,
            sourceEventId: input.event.event_id,
          }),
          buildHostedLinqWebhookPlannerDetails(input.event, context, {
            accessReason: accessDecision.reason,
            existingMemberActive: false,
            existingMemberMatch,
            homeRoutePresent: true,
            noticeCode: userNotice.code,
            reason: HOSTED_LINQ_INACTIVE_MEMBER_NOTICE_REASON[userNotice.code],
            routeStage: "inactive-member-home-access-notice",
          }),
        );
      }

    }
  }

  if (existingMember && existingMemberEffectiveActive) {
    if (!groupJoinContext) {
      const existingMailboxItem = await readHostedMailboxItemByDedupeKey({
        dedupeKey: input.event.event_id,
        prisma: input.prisma,
        userId: existingMember.id,
      });

      if (existingMailboxItem) {
        return logHostedLinqWebhookPlannerDecisionAndReturn(
          buildActiveMemberDirectPlan({
            desiredSideEffects: [],
            postCommitGroupJoinConfirmationMemberIds: [existingMember.id],
            response: {
              duplicate: true,
              ignored: true,
              ok: true,
              reason: "duplicate-webhook-event",
            },
            // No checkpoint on the duplicate read: this transaction did not run
            // the append-path workspace upsert, so the retry keeps the legacy
            // signal path that repairs a missing workspace row.
            wakeHandoffs: [{ eventId: input.event.event_id, mailboxItemId: existingMailboxItem.id, source: "linq", userId: existingMember.id }],
          }),
          buildHostedLinqWebhookPlannerDetails(input.event, context, {
            duplicate: true,
            existingMemberActive: existingMemberEffectiveActive,
            existingMemberMatch,
            reason: "duplicate-webhook-event",
            routeStage: "active-member-duplicate",
          }),
        );
      }
    }

    const bindingResult = await resolveIncomingHostedLinqHomeLineRouteBindingTx({
      incomingChatId: summary.chatId,
      incomingDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
      incomingRecipientPhone: recipientPhoneNumber,
      memberAuthority: memberRouteBindingAuthority,
      memberId: existingMember.id,
      prisma: input.prisma,
    });
    const blockedPlan = buildRouteBindingBlockedPlan(bindingResult, {
      capacityExhausted: "active-member-ignored-home-line-capacity-exhausted",
      redirect: "active-member-redirect",
      unassignable: "active-member-ignored-unassignable-home-line",
      unattestedDirect: "active-member-ignored-unattested-direct",
      unknownHome: "active-member-ignored-home-line",
    });
    if (blockedPlan) {
      return blockedPlan;
    }
    if (bindingResult.kind !== "bind") {
      return buildUnassignableHomeLinePlan("active-member-ignored-unassignable-home-line");
    }

    const dailyState = await incrementHostedLinqInboundDailyState({
      memberId: existingMember.id,
      occurredAt,
      prisma: input.prisma,
    });

    // Daily quota suppression intentionally remains ahead of both route
    // binding and mailbox append, so a suppressed message changes neither.
    const admissionPlan = groupJoinContext
      ? null
      : await planHostedLinqDailyQuotaAdmissionDenied({
          context,
          dailyState,
          dailyTextLimit: HOSTED_LINQ_DAILY_TEXT_LIMIT,
          event: input.event,
          logDetails: {
            existingMemberActive: true,
            existingMemberMatch,
            routeDecision: bindingResult.kind,
          },
          memberId: existingMember.id,
          routeStages: {
            dailyQuotaReached: "active-member-daily-quota-reached",
            dailyQuotaReply: "active-member-daily-quota-reply",
          },
        });
    if (admissionPlan) {
      return {
        ...admissionPlan,
        postCommitGroupJoinConfirmationMemberIds: [existingMember.id],
      };
    }

    const mailboxParticipantIdentity = await bindHostedMemberHomeLinqChat({
      chatId: summary.chatId,
      homeLineAssignedAt: bindingResult.homeLineAssignedAt,
      memberId: existingMember.id,
      participantContact,
      prisma: input.prisma,
      recipientPhone: bindingResult.recipientPhone,
    }) ?? participantContact;

    if (groupJoinContext) {
      const invite = await issueHostedInviteTx({
        channel: "linq",
        memberId: existingMember.id,
        prisma: input.prisma,
      });
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildSignupLinkResponse({
          chatId: summary.chatId,
          groupJoinCode: groupJoinContext.joinCode,
          groupJoinOutreachId: groupJoinContext.outreachId,
          inviteCode: invite.inviteCode,
          inviteId: invite.id,
          memberId: existingMember.id,
          messageId: summary.messageId,
          occurredAt,
          service: messageEvent.data.service ?? null,
          sourceEventId: input.event.event_id,
          threadIsDirect: resolveHostedLinqThreadIsDirect(messageEvent),
        }),
        buildHostedLinqWebhookPlannerDetails(input.event, context, {
          dailyInboundCount: dailyState.inboundCount,
          existingMemberActive: true,
          existingMemberMatch,
          reason: "sent-signup-link",
          routeDecision: bindingResult.kind,
          routeStage: "active-member-group-join-link",
        }),
      );
    }

    const mailboxWake = buildHostedLinqConversationWakeForMailbox({
      eventId: input.event.event_id,
      linqMessage: {
        ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
        chatId: summary.chatId,
        from: participantContact.value,
        isFromMe: summary.isFromMe,
        messageId: summary.messageId,
        reactionEligible: input.affirmativeReaction
          ? false
          : isHostedLinqMessageReactionEligible({
              parts: messageEvent.data.message.parts,
              service: messageEvent.data.service ?? null,
            }),
        threadIsDirect: resolveHostedLinqThreadIsDirect(messageEvent),
        ...(messageEvent.data.message.reply_to?.message_id === undefined
          ? {}
          : { replyToMessageId: messageEvent.data.message.reply_to.message_id }),
        ...(messageEvent.data.message.reply_to?.part_index === undefined
          ? {}
          : { replyToPartIndex: messageEvent.data.message.reply_to.part_index }),
        ...(messageEvent.data.service === undefined ? {} : { service: messageEvent.data.service }),
      },
      occurredAt,
      participantContact: mailboxParticipantIdentity,
      rawParts: messageEvent.data.message.parts,
      userId: existingMember.id,
    });

    const sourceMessageLookupKey = requireHostedLinqSourceMessageLookupKey(
      summary.messageId,
    );
    const mailboxAppend = await appendHostedMailboxEnvelopeWithSourceMessageTx({
      envelope: mailboxWake,
      sourceMessageLookupKey,
      tx: input.prisma,
    });

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildActiveMemberDirectPlan({
        desiredSideEffects: [],
        postCommitGroupJoinConfirmationMemberIds: [existingMember.id],
        response: {
          ok: true,
          ignored: false,
          reason: "wake-appended-active-member",
        },
        wakeHandoffs: [{
          eventId: input.event.event_id, linqChatId: summary.chatId, mailboxItemId: mailboxAppend.item.id, source: "linq", userId: existingMember.id,
          wakeMailboxCheckpoint: { lane: mailboxAppend.item.lane, laneSeq: mailboxAppend.item.laneSeq },
        }],
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        mailboxAppendPresent: true,
        reason: "wake-appended-active-member",
        routeDecision: bindingResult.kind,
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
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "undeliverable-first-contact",
        routeStage: "ignored-undeliverable-first-contact",
      }),
    );
  }

  const firstContactContentDisposition =
    resolveHostedLinqFirstContactContentDisposition({
      event: messageEvent,
      participantContact,
    });
  if (firstContactContentDisposition === "contentless") {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("contentless-first-contact"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "contentless-first-contact",
        routeStage: "ignored-contentless-first-contact",
      }),
    );
  }

  if (firstContactContentDisposition === "blocked") {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("blocked-first-contact-content"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "blocked-first-contact-content",
        routeStage: "ignored-blocked-first-contact-content",
      }),
    );
  }

  const instantStartPhonePrefixes =
    getHostedOnboardingEnvironment().linqInstantStartPhonePrefixes;
  const instantStartCandidate = input.instantStartAllowed === true
    && isHostedLinqInstantStartCandidate({
      event: messageEvent,
      participantContact,
      phonePrefixes: instantStartPhonePrefixes,
    });
  const pendingInstantStartAdmissionEventId =
    existingMember
    && instantStartCandidate
    && instantStartOwner?.eventId === input.event.event_id
    && instantStartOwner.chatId === summary.chatId
    && instantStartOwner.participantKind === participantContact.kind
    && instantStartOwner.participantLookupKey === participantContact.lookupKey
    && instantStartOwner.recipientPhoneNumber
      === normalizePhoneNumber(recipientPhoneNumber)
      ? instantStartOwner.eventId
      : null;

  if (
    existingMember === null
    && (input.requireFirstContactAdmission === true || instantStartCandidate)
    && input.firstContactAdmissionDecision?.kind !== "allow"
  ) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildFirstContactAdmissionRequiredPlan({
        participantContact,
        request: buildHostedLinqFirstContactAdmissionRequest({
          context,
          event: input.event,
          participantContact,
        }),
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: Boolean(existingMemberEffectiveActive),
        existingMemberMatch,
        reason: "first-contact-admission-required",
        routeStage: "first-contact-admission-required",
      }),
    );
  }

  const existingDailyState = existingMember
    ? await readHostedLinqDailyState({
        memberId: existingMember.id,
        occurredAt,
        prisma: input.prisma,
      })
    : null;

  if (existingDailyState?.onboardingLinkSentAt && !groupJoinContext) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("signup-link-already-sent"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "signup-link-already-sent",
        routeStage: "first-contact-signup-already-sent",
      }),
    );
  }

  if (!recipientPhoneNumber) {
    return buildUnassignableHomeLinePlan("ignored-unassignable-home-line");
  }

  const bindingResult = await resolveIncomingHostedLinqHomeLineRouteBindingTx({
    incomingChatId: summary.chatId,
    incomingDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
    incomingRecipientPhone: recipientPhoneNumber,
    memberAuthority: memberRouteBindingAuthority,
    memberId: existingMember?.id ?? null,
    prisma: input.prisma,
  });
  const retryableFallbackRecipientPhone =
    await readRetryableUnsentFallbackRecipientPhone({
      bindingResult,
      existingMemberActive: Boolean(existingMemberEffectiveActive),
      memberId: existingMember?.id ?? null,
      onboardingLinkSentAt: existingDailyState?.onboardingLinkSentAt ?? null,
      prisma: input.prisma,
    });
  if (retryableFallbackRecipientPhone) {
    const memberPhone = normalizePhoneNumber(participantPhoneNumber);
    if (!memberPhone || !existingMember) {
      return buildUnassignableHomeLinePlan("ignored-unassignable-home-line");
    }

    const dailyState = await incrementHostedLinqInboundDailyState({
      memberId: existingMember.id,
      occurredAt,
      prisma: input.prisma,
    });
    const invite = await issueHostedInviteTx({
      channel: "linq",
      memberId: existingMember.id,
      prisma: input.prisma,
    });

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildFallbackSignupLinkResponse({
        assignedPhone: retryableFallbackRecipientPhone,
        groupJoinCode: groupJoinContext?.joinCode,
        groupJoinOutreachId: groupJoinContext?.outreachId,
        inviteCode: invite.inviteCode,
        inviteId: invite.id,
        memberId: existingMember.id,
        memberPhone,
        occurredAt,
        sourceEventId: input.event.event_id,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        chatDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        fallbackLine: true,
        reason: "sent-signup-link",
        routeStage: "first-contact-fallback-retry",
      }),
    );
  }
  const blockedPlan = buildRouteBindingBlockedPlan(bindingResult, {
    capacityExhausted: "ignored-home-line-capacity-exhausted",
    redirect: "first-contact-redirect",
    unassignable: "ignored-unassignable-home-line",
    unattestedDirect: "first-contact-ignored-unattested-direct",
    unknownHome: "first-contact-ignored-home-line",
  });
  if (blockedPlan) {
    return blockedPlan;
  }
  if (bindingResult.kind !== "bind") {
    return buildUnassignableHomeLinePlan("ignored-unassignable-home-line");
  }

  const incomingLinePhone = normalizePhoneNumber(recipientPhoneNumber);
  const assignedPhone = normalizePhoneNumber(bindingResult.recipientPhone);
  const currentEventInstantStartEligible = instantStartCandidate
    && assignedPhone !== null
    && assignedPhone === incomingLinePhone
    && isHostedLinqInstantStartEligible({
      admissionDecision: input.firstContactAdmissionDecision,
      event: messageEvent,
      participantContact,
      phonePrefixes: instantStartPhonePrefixes,
    });
  const phoneMemberResolution =
    existingMember === null && participantContact.kind === "phone"
      ? await ensureHostedMemberForPhoneResolutionTx({
          phoneNumber: participantContact.value,
          ...(currentEventInstantStartEligible
            ? { phoneNumberVerifiedAt: new Date(occurredAt) }
            : {}),
          prisma: input.prisma,
        })
      : null;
  const member = existingMember
    ?? phoneMemberResolution?.member
    ?? await ensureHostedMemberForPendingLinqParticipantContactTx({
      contact: participantContact,
      observedAt: new Date(occurredAt),
      prisma: input.prisma,
    });
  // The earlier identity lookup is not creation authority: a concurrent
  // signup can commit while this transaction waits on the unique phone insert.
  // Retry that loser before it can attach this event to the winner's invite.
  if (
    currentEventInstantStartEligible
    && phoneMemberResolution?.created === false
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_MEMBER_IDENTITY_CHANGED",
      httpStatus: 503,
      message: "Murph is resolving another message from this phone. Try again.",
      retryable: true,
    });
  }
  const instantStartAdmissionEventId =
    phoneMemberResolution?.created === true && currentEventInstantStartEligible
    ? input.event.event_id
    : pendingInstantStartAdmissionEventId;
  const instantStartEligible = instantStartCandidate
    && assignedPhone !== null
    && assignedPhone === incomingLinePhone
    && instantStartAdmissionEventId !== null;

  if (assignedPhone && incomingLinePhone && assignedPhone !== incomingLinePhone) {
    const memberPhone = normalizePhoneNumber(participantPhoneNumber);
    if (!memberPhone) {
      return buildUnassignableHomeLinePlan("ignored-unassignable-home-line");
    }

    const refreshedRouting = await readHostedMemberRoutingState({
      memberId: member.id,
      prisma: input.prisma,
    });
    const existingAssignedPhone = normalizePhoneNumber(refreshedRouting?.linqRecipientPhone);
    if (existingAssignedPhone && existingAssignedPhone !== assignedPhone) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_HOME_ROUTE_CHANGED",
        httpStatus: 503,
        message: "Hosted Linq home routing changed while the fallback route was resolving.",
        retryable: true,
      });
    }

    const selectedLine = bindingResult.selectedLine;
    if (
      !selectedLine
      || selectedLine.phoneNumber !== assignedPhone
      || !await claimHostedLinqProactiveConversationCapacityTx({
        dayUtc: startOfUtcDay(new Date()),
        limit: resolveHostedLinqSignupWelcomeDailyLimit(selectedLine),
        phoneNumberLookupKey: selectedLine.phoneNumberLookupKey,
        prisma: input.prisma,
      })
    ) {
      return buildHomeLineCapacityExhaustedPlan(
        "ignored-home-line-capacity-exhausted",
      );
    }

    if (!existingAssignedPhone) {
      await upsertHostedMemberHomeLinqRecipientPhoneTx({
        clearPending: true,
        ...(bindingResult.homeLineAssignedAt === null
          ? {}
          : { homeLineAssignedAt: bindingResult.homeLineAssignedAt }),
        memberId: member.id,
        recipientPhone: assignedPhone,
        prisma: input.prisma,
      });
    }

    const dailyState = await incrementHostedLinqInboundDailyState({
      memberId: member.id,
      occurredAt,
      prisma: input.prisma,
    });
    const invite = await issueHostedInviteTx({
      channel: "linq",
      memberId: member.id,
      prisma: input.prisma,
    });

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildFallbackSignupLinkResponse({
        assignedPhone,
        groupJoinCode: groupJoinContext?.joinCode,
        groupJoinOutreachId: groupJoinContext?.outreachId,
        inviteCode: invite.inviteCode,
        inviteId: invite.id,
        memberId: member.id,
        memberPhone,
        occurredAt,
        sourceEventId: input.event.event_id,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        chatDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        fallbackLine: true,
        reason: "sent-signup-link",
        routeStage: "first-contact-signup-link",
      }),
    );
  }

  if (instantStartEligible) {
    await bindHostedMemberPendingLinqChat({
      chatId: summary.chatId,
      homeLineAssignedAt: bindingResult.homeLineAssignedAt,
      memberId: member.id,
      occurredAt,
      participantContact,
      prisma: input.prisma,
      recipientPhone: bindingResult.recipientPhone,
    });
    const invite = await issueHostedInviteTx({
      channel: "linq",
      instantStartAdmissionEventId,
      memberId: member.id,
      prisma: input.prisma,
    });

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      {
        ...buildActiveMemberDirectPlan({
          desiredSideEffects: [],
          response: {
            ignored: true,
            ok: true,
            reason: "instant-start-enrollment-required",
          },
        }),
        instantStartEnrollment: {
          admissionEventId: instantStartAdmissionEventId,
          inviteCode: invite.inviteCode,
          memberId: member.id,
        },
      },
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        chatDirectAttested: true,
        existingMemberActive: existingMemberEffectiveActive,
        existingMemberMatch,
        reason: "instant-start-enrollment-required",
        routeDecision: bindingResult.kind,
        routeStage: "first-contact-instant-start-enrollment",
      }),
    );
  }

  const dailyState = await bindHostedMemberPendingLinqChatAndTrackInbound({
    chatId: summary.chatId,
    homeLineAssignedAt: bindingResult.homeLineAssignedAt,
    memberId: member.id,
    occurredAt,
    participantContact,
    prisma: input.prisma,
    recipientPhone: bindingResult.recipientPhone,
  });

  if (dailyState.onboardingLinkSentAt && !groupJoinContext) {
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan("signup-link-already-sent"),
      buildHostedLinqWebhookPlannerDetails(input.event, context, {
        dailyInboundCount: dailyState.inboundCount,
        existingMemberActive: existingMemberEffectiveActive,
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
      groupJoinCode: groupJoinContext?.joinCode,
      groupJoinOutreachId: groupJoinContext?.outreachId,
      inviteCode: invite.inviteCode,
      inviteId: invite.id,
      memberId: member.id,
      messageId: summary.messageId,
      occurredAt,
      service: messageEvent.data.service ?? null,
      sourceEventId: input.event.event_id,
      threadIsDirect: resolveHostedLinqThreadIsDirect(messageEvent),
    }),
    buildHostedLinqWebhookPlannerDetails(input.event, context, {
      chatDirectAttested: isHostedLinqDirectChatAttested(messageEvent),
      dailyInboundCount: dailyState.inboundCount,
      existingMemberActive: existingMemberEffectiveActive,
      existingMemberMatch,
      reason: "sent-signup-link",
      routeStage: "first-contact-signup-link",
    }),
  );
}

type HostedLinqInstantStartOwner = {
  chatId: string;
  eventId: string;
  participantKind: HostedLinqParticipantContact["kind"];
  participantLookupKey: string;
  recipientPhoneNumber: string;
};

async function readHostedLinqInstantStartOwner(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqInstantStartOwner | null> {
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const pendingParticipant = routing?.pendingLinqParticipantContact;
  const recipientPhoneNumber = normalizePhoneNumber(
    routing?.pendingLinqRecipientPhone ?? null,
  );
  if (
    !routing?.pendingLinqChatId
    || !pendingParticipant
    || !recipientPhoneNumber
  ) {
    return null;
  }

  const invite = await input.prisma.hostedInvite.findFirst({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      instantStartAdmissionEventId: true,
    },
    where: {
      expiresAt: {
        gt: input.now,
      },
      instantStartAdmissionEventId: {
        not: null,
      },
      memberId: input.memberId,
      sentAt: null,
    },
  });
  const admissionEventId = invite?.instantStartAdmissionEventId ?? null;
  if (!admissionEventId) {
    return null;
  }

  const admissionDecision =
    await input.prisma.hostedLinqFirstContactAdmissionDecision.findUnique({
      select: {
        decision: true,
        source: true,
      },
      where: {
        eventId: admissionEventId,
      },
    });
  return admissionDecision?.decision === "allow"
    && admissionDecision.source === "model"
      ? {
          chatId: routing.pendingLinqChatId,
          eventId: admissionEventId,
          participantKind: pendingParticipant.kind,
          participantLookupKey: pendingParticipant.lookupKey,
          recipientPhoneNumber,
        }
      : null;
}

const HOSTED_LINQ_FAMILY_INVITE_ACCEPTANCE_MISS_CODES = new Set([
  "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
  "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
  "HOSTED_FAMILY_INVITE_NOT_FOUND",
  "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
  "HOSTED_FAMILY_INVITE_PHONE_REQUIRED",
  "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
  "HOSTED_FAMILY_OWNER_ALREADY_IN_GROUP",
  "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
]);

function isExpectedHostedLinqFamilyInviteAcceptanceMiss(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && !error.retryable
    && HOSTED_LINQ_FAMILY_INVITE_ACCEPTANCE_MISS_CODES.has(error.code);
}

async function resolveIncomingHostedLinqHomeLineRouteBindingTx(input: {
  incomingChatId: string;
  incomingDirectAttested: boolean;
  incomingRecipientPhone: string | null;
  memberAuthority?: HostedLinqHomeLineRouteBindingAuthority | null;
  memberId?: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqHomeLineRouteBindingResult> {
  if (input.memberId) {
    return resolveHostedMemberLinqHomeLineRouteBindingTx({
      incomingChatId: input.incomingChatId,
      incomingDirectAttested: input.incomingDirectAttested,
      incomingRecipientPhone: input.incomingRecipientPhone,
      memberAuthority: input.memberAuthority ?? null,
      memberId: input.memberId,
      prisma: input.prisma,
    });
  }

  if (!input.incomingRecipientPhone) {
    return {
      kind: "unassignable",
    };
  }

  const reservationResult = await reserveHostedLinqHomeLineFromPoolTx({
    preferredRecipientPhone: input.incomingRecipientPhone,
    prisma: input.prisma,
  });

  if (reservationResult.kind !== "reserved") {
    return reservationResult;
  }

  return {
    homeLineAssignedAt: reservationResult.reservation.assignedAt,
    kind: "bind",
    recipientPhone: reservationResult.reservation.line.phoneNumber,
    selectedLine: reservationResult.reservation.line,
  };
}

/**
 * Canonical convergence boundary for a route that already exists by thread
 * identity. It recovers the stored delivery account before building the
 * mailbox wake, so another Linq line cannot fork conversation or delivery
 * authority.
 */
async function planHostedLinqExistingThreadRouteWebhook(input: {
  accountLookupKey: string | null;
  accountLookupKeys: readonly string[];
  affirmativeReaction?: boolean;
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>;
  event: HostedLinqWebhookEvent;
  preparedDeliveryRoute?: PreparedHostedThreadContainerDeliveryRoute;
  prisma: Prisma.TransactionClient;
  resolvedParticipantMemberId?: string;
  route: HostedThreadRouteSnapshot;
}): Promise<HostedOnboardingLinqDirectPlan> {
  const { messageEvent, summary } = input.context;
  if (
    !input.preparedDeliveryRoute
    || input.preparedDeliveryRoute.containerMemberId
      !== input.route.containerMemberId
  ) {
    // The preflight package also warms this container's mailbox ingress root.
    // A different container here means the route changed after preparation;
    // retry outside a fresh transaction instead of unwrapping the winner's
    // root while this transaction is open.
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      httpStatus: 503,
      message: "Hosted thread delivery-route preparation is required.",
      retryable: true,
    });
  }
  let routeAccountLookupKey =
    input.route.accountLookupKey ?? input.accountLookupKey;
  let sourceMailboxConsumedAt: Date | null = null;
  if (requiresHostedThreadDeliveryRouteRefresh({
    accountLookupKey: input.accountLookupKey,
    route: input.route,
    threadId: summary.chatId,
  })) {
    if (!input.accountLookupKey) {
      throw new TypeError(
        "Hosted Linq thread route refresh requires the current account lookup key.",
      );
    }
    const refreshedRoute = await refreshHostedThreadContainerDeliveryRouteTx({
      accountLookupKey: input.accountLookupKey,
      accountLookupKeys: input.accountLookupKeys,
      mailboxDedupeKey: input.event.event_id,
      preparedDeliveryRoute: input.preparedDeliveryRoute,
      prisma: input.prisma,
      route: input.route,
      threadId: summary.chatId,
    });
    if (refreshedRoute.deliveryRoute?.channel === "linq") {
      routeAccountLookupKey = refreshedRoute.deliveryRoute.accountLookupKey;
    }
    sourceMailboxConsumedAt = refreshedRoute.demotedMailboxConsumedAt;
  } else if (isHostedLinqGroupChat(messageEvent)) {
    const demotion = await demoteHostedMemberLinqGroupChatBindingsTx({
      linqChatId: summary.chatId,
      mailboxDedupeKey: input.event.event_id,
      prisma: input.prisma,
    });
    sourceMailboxConsumedAt = demotion.mailboxConsumedAt;
  }

  return planHostedLinqExplicitThreadRouteWebhook({
    ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
    accountLookupKey: routeAccountLookupKey,
    context: input.context,
    event: input.event,
    prisma: input.prisma,
    ...(input.resolvedParticipantMemberId
      ? { resolvedParticipantMemberId: input.resolvedParticipantMemberId }
      : {}),
    route: input.route,
    sourceMailboxConsumedAt,
  });
}

async function planHostedLinqExplicitThreadRouteWebhook(input: {
  accountLookupKey?: string | null;
  affirmativeReaction?: boolean;
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>;
  event: HostedLinqWebhookEvent;
  prisma: Prisma.TransactionClient;
  resolvedParticipantMemberId?: string;
  route: HostedThreadRouteSnapshot;
  sourceMailboxConsumedAt?: Date | null;
}): Promise<HostedOnboardingLinqDirectPlan> {
  const {
    messageEvent,
    occurredAt,
    participantContact,
    summary,
  } = input.context;

  const participantAccessNow = new Date();
  let verifiedInboundParticipant: VerifiedHostedLinqInboundParticipant | null = null;
  if (
    !summary.isFromMe
    && messageEvent.data.message.parts.length > 0
    && participantContact
    && !shouldIgnoreHostedLinqForLocalInboundGuard({
      isFromMe: summary.isFromMe,
      participantContact,
    })
  ) {
    verifiedInboundParticipant =
      await resolveHostedThreadContainerInboundParticipantTx({
        participantContact,
        prisma: input.prisma,
        resolvedParticipantMemberId: input.resolvedParticipantMemberId,
      });
    if (verifiedInboundParticipant) {
      await lockHostedMemberRow(
        input.prisma,
        verifiedInboundParticipant.memberId,
      );
      const senderAccess = await readHostedRuntimeAiAccessDecision({
        memberId: verifiedInboundParticipant.memberId,
        now: participantAccessNow,
        prisma: input.prisma,
      });
      if (
        !senderAccess.allowed
        && senderAccess.reason === "health_data_consent_withdrawn"
      ) {
        return logHostedLinqWebhookPlannerDecisionAndReturn(
          buildIgnoredLinqWebhookPlan("health-data-consent-withdrawn"),
          buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
            accessReason: senderAccess.reason,
            existingMemberActive: false,
            existingMemberMatch: "none",
            reason: "health-data-consent-withdrawn",
            routeStage: "thread-route-sender-consent-withdrawn",
          }),
        );
      }
      await renewHostedThreadContainerParticipantAccessTx({
        containerMemberId: input.route.containerMemberId,
        now: participantAccessNow,
        observedAt: new Date(occurredAt),
        participantMemberId: verifiedInboundParticipant.memberId,
        prisma: input.prisma,
      });
    }
  }

  let containerAccessActive = (await readHostedRuntimeAiAccessDecision({
    memberId: input.route.containerMemberId,
    now: participantAccessNow,
    prisma: input.prisma,
  })).allowed;
  if (!containerAccessActive && !summary.isFromMe) {
    await renewHostedThreadContainerParticipantAccessFromRosterTx({
      chatId: summary.chatId,
      containerMemberId: input.route.containerMemberId,
      now: participantAccessNow,
      prisma: input.prisma,
      verifiedInboundParticipant,
    });
    containerAccessActive = (await readHostedRuntimeAiAccessDecision({
      memberId: input.route.containerMemberId,
      now: participantAccessNow,
      prisma: input.prisma,
    })).allowed;
  }

  if (!containerAccessActive) {
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

  const routeAccountLookupKey = input.accountLookupKey
    ?? createHostedPhoneLookupKey(input.context.recipientPhoneNumber);
  const routeAuthority = buildHostedLinqThreadRouteEgressAuthority({
    accountLookupKey: routeAccountLookupKey,
    route: input.route,
    threadId: summary.chatId,
  });
  const buildMailboxWake = (context?: {
    groupParticipantAdded?: true;
    groupReactionContext?: string;
  }) =>
    buildHostedLinqConversationWakeForMailbox({
      ...(routeAccountLookupKey ? { accountLookupKey: routeAccountLookupKey } : {}),
      eventId: input.event.event_id,
      ...(context?.groupParticipantAdded ? { groupParticipantAdded: true } : {}),
      ...(context?.groupReactionContext
        ? { groupReactionContext: context.groupReactionContext }
        : {}),
      linqMessage: {
        ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
        chatId: summary.chatId,
        from: participantContact.value,
        isFromMe: summary.isFromMe,
        messageId: summary.messageId,
        reactionEligible: input.affirmativeReaction
          ? false
          : isHostedLinqMessageReactionEligible({
              parts: messageEvent.data.message.parts,
              service: messageEvent.data.service ?? null,
            }),
        threadIsDirect: false,
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
      ...(verifiedInboundParticipant
        ? { senderMemberId: verifiedInboundParticipant.memberId }
        : {}),
      userId: input.route.containerMemberId,
    });

  const existingMailboxItem = await readHostedMailboxItemByDedupeKey({
    dedupeKey: input.event.event_id,
    prisma: input.prisma,
    userId: input.route.containerMemberId,
  });

  if (input.sourceMailboxConsumedAt) {
    const sourceMessageLookupKey = requireHostedLinqSourceMessageLookupKey(
      summary.messageId,
    );
    const mailboxItem = existingMailboxItem ?? (await appendHostedMailboxEnvelopeWithSourceMessageTx({
      envelope: buildMailboxWake(),
      sourceMessageLookupKey,
      tx: input.prisma,
    })).item;
    await input.prisma.hostedMailboxItem.updateMany({
      data: {
        consumedAt: input.sourceMailboxConsumedAt,
      },
      where: {
        consumedAt: null,
        id: mailboxItem.id,
        userId: input.route.containerMemberId,
      },
    });
    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildActiveMemberDirectPlan({
        desiredSideEffects: [],
        response: {
          ...(existingMailboxItem ? { duplicate: true } : {}),
          ignored: true,
          ok: true,
          reason: "already-consumed-before-thread-route",
        },
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        duplicate: existingMailboxItem !== null,
        existingMemberActive: true,
        existingMemberMatch: "none",
        mailboxAppendPresent: existingMailboxItem === null,
        reason: "already-consumed-before-thread-route",
        routeStage: "thread-route-already-consumed",
      }),
    );
  }

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
        // No checkpoint on the duplicate read: this transaction did not run
        // the append-path workspace upsert, so the retry keeps the legacy
        // signal path that repairs a missing workspace row.
        wakeHandoffs: [{
          eventId: input.event.event_id, linqChatId: summary.chatId, mailboxItemId: existingMailboxItem.id, source: "linq", userId: input.route.containerMemberId,
        }],
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

  // Subscription/AI usage and its limit notice are gated after mailbox append,
  // so pending user input survives upgrades and allowance resets.
  // Group threads share one daily bucket across every participant, so they get
  // a higher cap than a 1:1 direct chat.
  const admissionPlan = await planHostedLinqDailyQuotaAdmissionDenied({
    context: input.context,
    dailyState,
    dailyTextLimit: HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
    event: input.event,
    logDetails: {
      existingMemberActive: true,
      existingMemberMatch: "none",
    },
    memberId: input.route.containerMemberId,
    routeStages: {
      dailyQuotaReached: "thread-route-daily-quota-reached",
      dailyQuotaReply: "thread-route-daily-quota-reply",
    },
    routeAuthority,
  });
  if (admissionPlan) {
    return admissionPlan;
  }

  const pendingContext = isHostedLinqDirectChatAttested(messageEvent)
    ? { groupParticipantAdded: false, groupReactionContext: null }
    : routeAccountLookupKey
      ? await consumeHostedLinqThreadRoutePendingContextTx({
          accountLookupKey: routeAccountLookupKey,
          containerMemberId: input.route.containerMemberId,
          prisma: input.prisma,
          threadId: summary.chatId,
        })
      : {
          groupParticipantAdded:
            await consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
              containerMemberId: input.route.containerMemberId,
              prisma: input.prisma,
              threadId: summary.chatId,
            }),
          groupReactionContext: null,
        };
  const mailboxEnvelope = buildMailboxWake({
    ...(pendingContext.groupParticipantAdded
      ? { groupParticipantAdded: true }
      : {}),
    ...(pendingContext.groupReactionContext
      ? { groupReactionContext: pendingContext.groupReactionContext }
      : {}),
  });

  const sourceMessageLookupKey = requireHostedLinqSourceMessageLookupKey(
    summary.messageId,
  );
  const mailboxAppend = await appendHostedMailboxEnvelopeWithSourceMessageTx({
    envelope: mailboxEnvelope,
    sourceMessageLookupKey,
    tx: input.prisma,
  });
  if (mailboxAppend.duplicate) {
    // The early dedupe read was empty, so this is necessarily a concurrent
    // append race. Escaping the transaction restores any consumed route
    // context; the retry then takes the ordinary early-dedupe path.
    throw hostedOnboardingError({
      code: "LINQ_MAILBOX_APPEND_RACE",
      httpStatus: 503,
      message: "Hosted Linq mailbox append raced with another delivery.",
      retryable: true,
    });
  }

  let qualificationCandidateReferralIds: string[] = [];
  if (!input.affirmativeReaction) {
    const eventKey = createHostedLinqMessageLookupKey(summary.messageId);
    const senderSubjectKey = participantContact.kind === "email"
      ? createHostedEmailLookupKey(participantContact.value)
      : createHostedPhoneLookupKey(participantContact.value);
    if (eventKey && senderSubjectKey) {
      qualificationCandidateReferralIds = (
        await observeHostedUsageReferralInboundTx({
          containerMemberId: input.route.containerMemberId,
          eventKey,
          occurredAt: new Date(occurredAt),
          senderMemberId: null,
          senderSubjectKey,
          tx: input.prisma,
        })
      ).qualificationCandidateReferralIds;
    }
  }

  return logHostedLinqWebhookPlannerDecisionAndReturn(
    buildActiveMemberDirectPlan({
      desiredSideEffects: [],
      ...(qualificationCandidateReferralIds.length > 0
        ? { postCommitUsageReferralIds: qualificationCandidateReferralIds }
        : {}),
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      },
      wakeHandoffs: [{
        eventId: input.event.event_id, linqChatId: summary.chatId, mailboxItemId: mailboxAppend.item.id, source: "linq", userId: input.route.containerMemberId,
        wakeMailboxCheckpoint: { lane: mailboxAppend.item.lane, laneSeq: mailboxAppend.item.laneSeq },
      }],
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

const HOSTED_LINQ_GROUP_PROVISION_UNAVAILABLE_ERROR_CODES = new Set([
  "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED",
  "HOSTED_THREAD_CONTAINER_OWNER_MUST_NOT_BE_CONTAINER",
  "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
]);

type HostedLinqNewGroupAdmissionIgnoreReason =
  | "blocked-first-contact-content"
  | "contentless-first-contact"
  | "empty-message-parts"
  | "local-inbound-not-allowlisted"
  | "own-message"
  | "provision-unavailable"
  | "recipient-line-hard-blocked"
  | "recipient-line-authority-unresolved"
  | "recipient-line-conflicting"
  | "recipient-line-degraded-unavailable"
  | "recipient-line-unmanaged"
  | "recipient-line-not-assigned"
  | "recipient-line-service-unavailable"
  | "recipient-line-structurally-unavailable"
  | "sender-contact-unresolved"
  | "sender-identity-unresolved"
  | "sender-inactive"
  | "suspended-member";

/**
 * An unbound group can be admitted by either one roster-matched pending setup
 * or the existing active-sender fallback when the recipient line is
 * assignable. An AT_RISK or HARD_BLOCKED line retains the stricter recovery
 * boundary: only its exact active assigned sender may proceed, and a hard
 * block plans the private backup-number prompt instead of provisioning.
 * Once that private recovery is provider-correlated, its exact live setup can
 * be selected from the current roster independently of who speaks first on
 * the replacement line. The webhook recipient alone is never line authority.
 * Existing routes are handled before this admission path.
 */
async function planHostedLinqGroupChatWebhook(input: {
  affirmativeReaction?: boolean;
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>;
  event: HostedLinqWebhookEvent;
  firstContactAdmissionDecision?: HostedLinqFirstContactAdmissionDecision | null;
  participantMemberIds: readonly string[];
  preparedThreadContainerCreation?: PreparedHostedThreadContainerCreation;
  preparedThreadDeliveryRoute?: PreparedHostedThreadContainerDeliveryRoute;
  rosterUnavailable: boolean;
  prisma: Prisma.TransactionClient;
  requireFirstContactAdmission?: boolean;
  threadRouteAccountLookupKeys: readonly string[];
}): Promise<HostedOnboardingLinqDirectPlan> {
  const {
    messageEvent,
    occurredAt,
    participantContact,
    recipientPhoneNumber,
    summary,
  } = input.context;

  const ignored = (
    reason: HostedLinqNewGroupAdmissionIgnoreReason,
    existingMemberMatch: HostedLinqExistingMemberMatch = "none",
    responseReason = "group-chat",
  ) =>
    logHostedLinqWebhookPlannerDecisionAndReturn(
      buildIgnoredLinqWebhookPlan(responseReason),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        existingMemberMatch,
        reason,
        routeStage: "new-group-admission-ignored",
      }),
    );

  if (summary.isFromMe) {
    return ignored("own-message");
  }

  if (messageEvent.data.message.parts.length === 0) {
    return ignored("empty-message-parts");
  }

  if (!participantContact) {
    return ignored("sender-contact-unresolved");
  }

  if (
    shouldIgnoreHostedLinqForLocalInboundGuard({
      isFromMe: summary.isFromMe,
      participantContact,
    })
  ) {
    return ignored("local-inbound-not-allowlisted");
  }

  const incomingRecipientPhone = normalizePhoneNumber(recipientPhoneNumber);
  const accountLookupKey = createHostedPhoneLookupKey(incomingRecipientPhone);
  if (!incomingRecipientPhone || !accountLookupKey) {
    return ignored("recipient-line-authority-unresolved");
  }

  const senderLookup = participantContact.kind === "phone"
    ? await lookupHostedMemberIdentityByPhoneNumberForLinqWebhook({
        phoneNumber: participantContact.value,
        prisma: input.prisma,
      })
    : await lookupHostedMemberByVerifiedEmailAddress({
        address: participantContact.value,
        prisma: input.prisma,
      });
  const pendingSenderLookup = senderLookup
    ? null
    : await lookupHostedMemberRoutingByPendingLinqParticipantContact({
        contact: participantContact,
        linqChatId: summary.chatId,
        prisma: input.prisma,
        recipientPhone: incomingRecipientPhone,
      });
  const sender = senderLookup?.core ?? pendingSenderLookup?.core ?? null;
  if (sender) {
    await lockHostedMemberRow(input.prisma, sender.id);
  }
  const senderIdentityMatch: HostedLinqExistingMemberMatch = senderLookup
    ? participantContact.kind === "phone"
      ? "phone-identity"
      : "verified-email"
    : pendingSenderLookup
      ? "pending-contact"
      : "none";
  const senderSuspended = sender !== null
    && isHostedMemberSuspended(sender.suspendedAt);
  const senderAccess = sender && !senderSuspended
    ? await readHostedRuntimeAiAccessDecision({
        memberId: sender.id,
        prisma: input.prisma,
      })
    : null;
  const senderAccessAllowed = senderAccess?.allowed ?? false;
  const activeSenderMemberId = senderAccessAllowed ? sender?.id ?? null : null;
  const inactiveSender = sender !== null && !senderAccessAllowed;
  const firstContactContentDisposition = !activeSenderMemberId
    ? resolveHostedLinqFirstContactContentDisposition({
        event: messageEvent,
        participantContact,
      })
    : null;

  if (senderSuspended) {
    return ignored("suspended-member", senderIdentityMatch);
  }
  // An explicit withdrawal stops group outreach: falling through to the setup
  // offer below would message a withdrawn sender and make their status
  // observable to the rest of the thread.
  if (
    senderAccess !== null
    && !senderAccess.allowed
    && senderAccess.reason === "health_data_consent_withdrawn"
  ) {
    return ignored("sender-inactive", senderIdentityMatch);
  }
  if (
    sender === null
    && firstContactContentDisposition === "contentless"
  ) {
    return ignored("contentless-first-contact", senderIdentityMatch);
  }
  const lineState = await readHostedLinqIncomingLineState({
    phoneNumberLookupKeys: input.threadRouteAccountLookupKeys,
    prisma: input.prisma,
  });

  if (lineState.kind === "unmanaged") {
    return ignored(
      "recipient-line-unmanaged",
      senderIdentityMatch,
      "group-chat-line-unavailable",
    );
  }
  if (lineState.kind === "conflicting") {
    return ignored(
      "recipient-line-conflicting",
      senderIdentityMatch,
      "group-chat-line-unavailable",
    );
  }
  if (lineState.kind === "structurally_unavailable") {
    return ignored(
      "recipient-line-structurally-unavailable",
      senderIdentityMatch,
      "group-chat-line-unavailable",
    );
  }
  if (lineState.kind === "degraded_unavailable") {
    return ignored(
      "recipient-line-degraded-unavailable",
      senderIdentityMatch,
      "group-chat-line-unavailable",
    );
  }
  if (!("phoneNumberLookupKey" in lineState)) {
    return ignored(
      "recipient-line-authority-unresolved",
      senderIdentityMatch,
      "group-chat-line-unavailable",
    );
  }
  if (
    !activeSenderMemberId
    && firstContactContentDisposition === "blocked"
  ) {
    return ignored("blocked-first-contact-content", senderIdentityMatch);
  }
  if (
    (
      lineState.kind === "at_risk"
      || lineState.kind === "hard_blocked"
    )
    && !isHostedLinqIMessageService(messageEvent.data.service)
  ) {
    return ignored(
      "recipient-line-service-unavailable",
      senderIdentityMatch,
      "group-chat-line-unavailable",
    );
  }
  let pendingSetupParticipantMemberIds: readonly string[];
  let pendingSetupRecipientPhoneLookupKeys =
    input.threadRouteAccountLookupKeys;
  let requiredPendingSetupCandidateId: string | null = null;
  if (lineState.kind === "at_risk" || lineState.kind === "hard_blocked") {
    if (!activeSenderMemberId) {
      return ignored(
        inactiveSender ? "sender-inactive" : "sender-identity-unresolved",
        senderIdentityMatch,
        "group-chat-line-unavailable",
      );
    }
    await acquireHostedMemberHomeLinqRouteLockTx({
      memberId: activeSenderMemberId,
      prisma: input.prisma,
    });
    if (
      !(await readHostedRuntimeAiAccessDecision({
        memberId: activeSenderMemberId,
        prisma: input.prisma,
      })).allowed
    ) {
      return ignored("sender-inactive", senderIdentityMatch);
    }
    const senderAuthority = readHostedLinqHomeLineAuthority(
      await readHostedMemberRoutingState({
        memberId: activeSenderMemberId,
        prisma: input.prisma,
      }),
    );
    if (
      senderAuthority.kind === "none"
      || senderAuthority.recipientPhone !== incomingRecipientPhone
    ) {
      return ignored(
        "recipient-line-not-assigned",
        senderIdentityMatch,
        "group-chat-line-unavailable",
      );
    }

    if (lineState.kind === "hard_blocked") {
      const pendingSetup = await readHostedPendingGroupSetup({
        ownerMemberId: activeSenderMemberId,
        prisma: input.prisma,
      });
      const pendingGroupSetupId = pendingSetup
        && pendingSetup.armedAt <= new Date(occurredAt)
        && pendingSetup.recipientPhoneLookupKey
          === lineState.phoneNumberLookupKey
        ? pendingSetup.id
        : null;
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildGroupLineRecoveryResponse({
          incomingRecipientPhone,
          memberId: activeSenderMemberId,
          occurredAt,
          participantContact: {
            kind: participantContact.kind,
            value: participantContact.value,
          },
          pendingGroupSetupId,
          sourceEventId: input.event.event_id,
          threadId: summary.chatId,
        }),
        buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
          existingMemberMatch: senderIdentityMatch,
          reason: "recipient-line-hard-blocked",
          routeStage: "new-group-line-recovery-planned",
        }),
      );
    }
    pendingSetupParticipantMemberIds = [activeSenderMemberId];
  } else {
    if (input.rosterUnavailable) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_PENDING_GROUP_ROSTER_UNAVAILABLE",
        httpStatus: 502,
        message:
          "Linq group roster authority is temporarily unavailable.",
        retryable: true,
      });
    }
    const recoveryParticipantMemberIds = activeSenderMemberId
      ? [...new Set([...input.participantMemberIds, activeSenderMemberId])]
      : input.participantMemberIds;
    const recoveredPendingSetup = recoveryParticipantMemberIds.length > 0
      ? await resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: new Date(occurredAt),
          participantMemberIds: recoveryParticipantMemberIds,
          recoveredRecipientPhoneLookupKey: lineState.phoneNumberLookupKey,
          senderMemberId: activeSenderMemberId,
          threadId: summary.chatId,
          tx: input.prisma,
        })
      : null;
    if (recoveredPendingSetup) {
      pendingSetupParticipantMemberIds = [
        recoveredPendingSetup.ownerMemberId,
      ];
      pendingSetupRecipientPhoneLookupKeys = [
        ...new Set([
          ...input.threadRouteAccountLookupKeys,
          recoveredPendingSetup.recipientPhoneLookupKey,
        ]),
      ];
      requiredPendingSetupCandidateId = recoveredPendingSetup.id;
    } else {
      pendingSetupParticipantMemberIds = activeSenderMemberId
        ? [...new Set([...input.participantMemberIds, activeSenderMemberId])]
        : input.participantMemberIds;
    }
  }

  let createdContainerMemberId: string | null = null;
  let demotedMailboxConsumedAt: Date | null = null;
  let routeEnsured = false;
  try {
    const preparedResult = await ensureHostedPreparedLinqThreadContainerRouteTx({
      accountLookupKey,
      accountLookupKeys: input.threadRouteAccountLookupKeys,
      fallbackOwnerMemberId: activeSenderMemberId,
      linqService: messageEvent.data.service ?? null,
      mailboxDedupeKey: input.event.event_id,
      occurredAt: new Date(occurredAt),
      participantMemberIds: pendingSetupParticipantMemberIds,
      preparedCreation: input.preparedThreadContainerCreation,
      preparedDeliveryRoute: input.preparedThreadDeliveryRoute,
      recipientPhoneLookupKeys: pendingSetupRecipientPhoneLookupKeys,
      requiredPendingSetupCandidateId,
      senderMemberId: activeSenderMemberId,
      threadId: summary.chatId,
      tx: input.prisma,
    });
    if (preparedResult.kind !== "ensured") {
      if (
        preparedResult.pendingSetupResolution
          === "recipient_line_unmanaged"
      ) {
        return ignored("recipient-line-unmanaged", senderIdentityMatch);
      }
      // A concurrent setup claimant may have committed this route while the
      // row lock was held. The canonical re-read below decides whether this
      // distinct message can append to that winner.
    } else {
      const ensureResult = preparedResult.ensure;
      if (!ensureResult.created) {
        // This branch began from an observed-absent route and therefore has
        // only creation material. An existing winner requires its own
        // delivery-route package and mailbox-root prewarm in a fresh attempt.
        throw hostedOnboardingError({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          httpStatus: 503,
          message: "Hosted thread delivery-route preparation is required.",
          retryable: true,
        });
      }
      routeEnsured = true;
      createdContainerMemberId = ensureResult.containerMemberId;
      demotedMailboxConsumedAt = ensureResult.demotedMailboxConsumedAt;
    }
  } catch (error) {
    if (
      !isHostedOnboardingError(error)
      || !HOSTED_LINQ_GROUP_PROVISION_UNAVAILABLE_ERROR_CODES.has(error.code)
    ) {
      throw error;
    }
    // A concurrent first message may have bound this thread while this webhook
    // was in flight (pooled lines allow two members of the same group to race).
    // Fall through to the re-read and converge on the committed route instead
    // of dropping an authorized inbound; a missing route still fails closed.
  }

  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: summary.chatId,
  });
  if (!route) {
    if (activeSenderMemberId || requiredPendingSetupCandidateId) {
      return ignored("provision-unavailable", senderIdentityMatch);
    }
    if (lineState.kind !== "assignable") {
      return ignored(
        inactiveSender ? "sender-inactive" : "sender-identity-unresolved",
        senderIdentityMatch,
        "group-chat-line-unavailable",
      );
    }

    // Only offer ordinary setup after the roster-authorized prepared-owner
    // path has conclusively found no route. Unknown senders use the same
    // first-contact admission gate as direct conversations.
    if (
      sender === null
      && input.requireFirstContactAdmission === true
      && input.firstContactAdmissionDecision?.kind !== "allow"
    ) {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildFirstContactAdmissionRequiredPlan({
          participantContact,
          request: buildHostedLinqFirstContactAdmissionRequest({
            context: input.context,
            event: input.event,
            participantContact,
          }),
        }),
        buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
          existingMemberActive: false,
          existingMemberMatch: senderIdentityMatch,
          reason: "first-contact-admission-required",
          routeStage: "first-contact-admission-required",
        }),
      );
    }

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildGroupSetupRequiredResponse({
        chatId: summary.chatId,
        messageId: summary.messageId,
        occurredAt,
        ...(sender === null
          && participantContact.kind === "email"
          && isHostedLinqIMessageService(messageEvent.data.service)
            ? { participantEmail: participantContact.value }
            : {}),
        recipientPhone: incomingRecipientPhone,
        sourceEventId: input.event.event_id,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        existingMemberActive: false,
        existingMemberMatch: senderIdentityMatch,
        reason: inactiveSender
          ? "sender-inactive"
          : "sender-identity-unresolved",
        routeStage: "new-group-setup-planned",
      }),
    );
  }

  const plan = routeEnsured
    ? await planHostedLinqExplicitThreadRouteWebhook({
        ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
        accountLookupKey,
        context: input.context,
        event: input.event,
        prisma: input.prisma,
        ...(activeSenderMemberId
          ? { resolvedParticipantMemberId: activeSenderMemberId }
          : {}),
        route,
        sourceMailboxConsumedAt: demotedMailboxConsumedAt,
      })
    : await planHostedLinqExistingThreadRouteWebhook({
        ...(input.affirmativeReaction ? { affirmativeReaction: true } : {}),
        accountLookupKey,
        accountLookupKeys: input.threadRouteAccountLookupKeys,
        context: input.context,
        event: input.event,
        preparedDeliveryRoute: [
          input.preparedThreadDeliveryRoute,
          input.preparedThreadContainerCreation,
        ].find((prepared) =>
          prepared?.containerMemberId === route.containerMemberId
        ),
        prisma: input.prisma,
        ...(activeSenderMemberId
          ? { resolvedParticipantMemberId: activeSenderMemberId }
          : {}),
        route,
      });
  if (createdContainerMemberId && route.containerMemberId === createdContainerMemberId) {
    return {
      ...plan,
      postCommitGroupRosterReconciles: [
        ...(plan.postCommitGroupRosterReconciles ?? []),
        {
          chatId: summary.chatId,
          containerMemberId: route.containerMemberId,
        },
      ],
    };
  }

  return plan;
}

async function planHostedLinqDailyQuotaAdmissionDenied(input: {
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>;
  dailyState: HostedLinqDailyState | null;
  dailyTextLimit: number;
  event: HostedLinqWebhookEvent;
  logDetails: HostedOnboardingStructuredLogDetails;
  memberId: string;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  routeStages: {
    dailyQuotaReached: string;
    dailyQuotaReply: string;
  };
}): Promise<HostedOnboardingLinqDirectPlan | null> {
  const dailyState = input.dailyState;
  if (!dailyState) {
    return null;
  }

  if (dailyState.inboundCount > input.dailyTextLimit) {
    if (dailyState.quotaReplySentAt) {
      return logHostedLinqWebhookPlannerDecisionAndReturn(
        buildIgnoredLinqWebhookPlan("daily-quota-reached"),
        buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
          ...input.logDetails,
          dailyInboundCount: dailyState.inboundCount,
          reason: "daily-quota-reached",
          routeStage: input.routeStages.dailyQuotaReached,
        }),
      );
    }

    return logHostedLinqWebhookPlannerDecisionAndReturn(
      buildQuotaReplyResponse({
        chatId: input.context.summary.chatId,
        dailyTextLimit: input.dailyTextLimit,
        memberId: input.memberId,
        messageId: input.context.summary.messageId,
        occurredAt: input.context.occurredAt,
        routeAuthority: input.routeAuthority ?? null,
        sourceEventId: input.event.event_id,
      }),
      buildHostedLinqWebhookPlannerDetails(input.event, input.context, {
        ...input.logDetails,
        dailyInboundCount: dailyState.inboundCount,
        reason: "sent-daily-quota-reply",
        routeStage: input.routeStages.dailyQuotaReply,
      }),
    );
  }

  return null;
}

function buildFirstContactAdmissionRequiredPlan(input: {
  participantContact: HostedLinqParticipantContact;
  request: HostedLinqFirstContactAdmissionRequest;
}): HostedOnboardingLinqDirectPlan {
  return {
    ...buildActiveMemberDirectPlan({
      desiredSideEffects: [],
      response: {
        ignored: true,
        ok: true,
        reason: "first-contact-admission-required",
      },
    }),
    firstContactAdmissionParticipantContact: input.participantContact,
    firstContactAdmissionRequest: input.request,
  };
}

function buildHostedLinqFirstContactAdmissionRequest(input: {
  context: ReturnType<typeof resolveHostedOnboardingLinqMessageContext>;
  event: HostedLinqWebhookEvent;
  participantContact: HostedLinqParticipantContact;
}): HostedLinqFirstContactAdmissionRequest {
  return {
    eventId: input.event.event_id,
    participantContactKind: input.participantContact.kind,
    partTypes: buildHostedLinqFirstContactAdmissionPartTypes(input.context.messageEvent.data.message.parts),
    service: normalizeHostedLinqFirstContactAdmissionService(input.context.messageEvent.data.service),
    text: buildHostedLinqFirstContactAdmissionText(input.context.messageEvent.data.message.parts),
  };
}

function buildHostedLinqFirstContactAdmissionPartTypes(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
): string[] {
  return [...new Set(parts.map((part) => part.type))].sort();
}

function buildHostedLinqFirstContactAdmissionText(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"],
): string | null {
  const text = parts
    .filter((part) =>
      part.type === "text"
      || part.type === "link"
      || part.type === "imessage_app"
    )
    .map((part) => part.type === "imessage_app"
      ? normalizeHostedLinqPartText(part.fallback_text) ?? ""
      : normalizeHostedLinqPartText(part.value) ?? "")
    .filter(Boolean)
    .join("\n")
    .slice(0, 2_000)
    .trim();

  return text.length > 0 ? text : null;
}

function normalizeHostedLinqFirstContactAdmissionService(
  value: string | null | undefined,
): HostedLinqFirstContactAdmissionRequest["service"] {
  const normalized = value?.trim().toLowerCase() ?? "";
  return HOSTED_LINQ_FIRST_CONTACT_ADMISSION_SERVICES.has(normalized)
    ? normalized as HostedLinqFirstContactAdmissionRequest["service"]
    : "unknown";
}

function buildHostedLinqThreadRouteEgressAuthority(input: {
  accountLookupKey?: string | null;
  route: HostedThreadRouteSnapshot;
  threadId: string;
}): HostedLinqThreadRouteEgressAuthority {
  return {
    ...(input.accountLookupKey ? { accountLookupKey: input.accountLookupKey } : {}),
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

  if (input.existingHomeLinqChatLookupPresent) {
    return "home-linq-chat";
  }

  if (input.existingPendingLinqContactLookupPresent) {
    return "pending-contact";
  }

  return "none";
}

function resolveHostedLinqHomeLineRouteBindingAuthority(input: {
  existingMemberMatch: HostedLinqExistingMemberMatch;
  participantContact: HostedLinqParticipantContact;
}): HostedLinqHomeLineRouteBindingAuthority | null {
  if (
    input.existingMemberMatch === "phone-identity"
    || input.existingMemberMatch === "verified-email"
  ) {
    return {
      kind: "member-identity",
    };
  }

  if (input.existingMemberMatch === "home-linq-chat") {
    return {
      kind: "home-linq-chat",
    };
  }

  if (input.existingMemberMatch === "pending-contact") {
    return {
      contact: input.participantContact,
      kind: "pending-contact",
    };
  }

  return null;
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
    wakeHandoffCount: plan.wakeHandoffs?.length ?? 0,
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

function requireHostedLinqSourceMessageLookupKey(messageId: string): string {
  const lookupKey = createHostedLinqMessageLookupKey(messageId);
  if (!lookupKey) {
    throw new TypeError("Hosted Linq message id must produce a source lookup key.");
  }
  return lookupKey;
}

function buildHostedLinqConversationWakeForMailbox(input: {
  accountLookupKey?: string | null;
  eventId: string;
  groupParticipantAdded?: true;
  groupReactionContext?: string;
  linqMessage: Omit<HostedExecutionLinqConversationMessage, "parts">;
  occurredAt: string;
  participantContact: HostedLinqParticipantIdentity;
  rawParts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"];
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  senderMemberId?: string;
  userId: string;
}): ReturnType<typeof buildHostedExecutionLinqConversationMessageWake> {
  const fullWake = buildHostedExecutionLinqConversationMessageWake({
    ...(input.accountLookupKey === undefined
      ? {}
      : { accountLookupKey: input.accountLookupKey }),
    eventId: input.eventId,
    ...(input.groupParticipantAdded ? { groupParticipantAdded: true } : {}),
    ...(input.groupReactionContext
      ? { groupReactionContext: input.groupReactionContext }
      : {}),
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
    ...(input.senderMemberId ? { senderMemberId: input.senderMemberId } : {}),
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
    ...(input.groupParticipantAdded ? { groupParticipantAdded: true } : {}),
    ...(input.groupReactionContext
      ? { groupReactionContext: input.groupReactionContext }
      : {}),
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
    ...(input.senderMemberId ? { senderMemberId: input.senderMemberId } : {}),
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
    ...(input.groupParticipantAdded ? { groupParticipantAdded: true } : {}),
    ...(input.groupReactionContext
      ? { groupReactionContext: input.groupReactionContext }
      : {}),
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
    ...(input.senderMemberId ? { senderMemberId: input.senderMemberId } : {}),
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
    if (
      part.type !== "text"
      && part.type !== "link"
      && part.type !== "imessage_app"
    ) {
      continue;
    }

    const value = part.type === "imessage_app"
      ? normalizeHostedLinqPartText(part.fallback_text) ?? "[iMessage app]"
      : normalizeHostedLinqPartText(part.value);
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
    .filter((part) =>
      part.type === "text"
      || part.type === "link"
      || part.type === "imessage_app"
    )
    .map((part) => part.type === "imessage_app"
      ? normalizeHostedLinqPartText(part.fallback_text) ?? "[iMessage app]"
      : normalizeHostedLinqPartText(part.value) ?? "")
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

async function resolveHostedThreadContainerInboundParticipantTx(input: {
  participantContact: HostedLinqParticipantContact;
  prisma: Prisma.TransactionClient;
  resolvedParticipantMemberId?: string;
}): Promise<VerifiedHostedLinqInboundParticipant | null> {
  const participantMemberId = input.resolvedParticipantMemberId ?? (
    input.participantContact.kind === "phone"
      ? (await lookupHostedMemberIdentityByPhoneNumberForLinqWebhook({
          phoneNumber: input.participantContact.value,
          prisma: input.prisma,
        }))?.core.id
      : (await lookupHostedMemberByVerifiedEmailAddress({
          address: input.participantContact.value,
          prisma: input.prisma,
        }))?.core.id
  ) ?? null;
  if (!participantMemberId) {
    return null;
  }

  return {
    contact: input.participantContact,
    memberId: participantMemberId,
  };
}

async function renewHostedThreadContainerParticipantAccessFromRosterTx(input: {
  chatId: string;
  containerMemberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  verifiedInboundParticipant: VerifiedHostedLinqInboundParticipant | null;
}): Promise<void> {
  if (!input.verifiedInboundParticipant) {
    return;
  }

  let handles: readonly HostedLinqChatHandleSummary[];
  try {
    handles = await getHostedLinqChatHandles({
      chatId: input.chatId,
      timeoutMs: 1_500,
    });
  } catch {
    return;
  }

  const currentContactsByLookupKey = new Map<string, HostedLinqParticipantContact>();
  for (const handle of handles) {
    if (
      handle.isMe
      || (handle.status && handle.status.trim().toLowerCase() !== "active")
    ) {
      continue;
    }
    const contact = createHostedLinqParticipantContact({
      kind: handle.handle.includes("@") ? "email" : "phone",
      value: handle.handle,
    });
    if (!contact) {
      continue;
    }
    for (const lookupKey of createHostedLinqParticipantContactLookupKeyReadCandidates(
      contact,
    )) {
      if (!currentContactsByLookupKey.has(lookupKey)) {
        currentContactsByLookupKey.set(lookupKey, contact);
      }
    }
  }
  if (currentContactsByLookupKey.size === 0) {
    return;
  }

  const verifiedInboundContact =
    createHostedLinqParticipantContactLookupKeyReadCandidates(
      input.verifiedInboundParticipant.contact,
    ).some((lookupKey) => currentContactsByLookupKey.has(lookupKey));
  if (!verifiedInboundContact) {
    return;
  }

  const lookup = input.verifiedInboundParticipant.contact.kind === "phone"
    ? await lookupHostedMemberIdentityByPhoneNumberForLinqWebhook({
        phoneNumber: input.verifiedInboundParticipant.contact.value,
        prisma: input.prisma,
      })
    : await lookupHostedMemberByVerifiedEmailAddress({
        address: input.verifiedInboundParticipant.contact.value,
        prisma: input.prisma,
      });
  if (lookup?.core.id !== input.verifiedInboundParticipant.memberId) {
    return;
  }

  const activeParticipant = await input.prisma.hostedMember.findFirst({
    select: { id: true },
    where: {
      ...activeHostedMemberAccessWhere(),
      id: input.verifiedInboundParticipant.memberId,
    },
  });
  if (!activeParticipant) {
    return;
  }

  await input.prisma.hostedThreadContainerParticipant.upsert({
    create: {
      containerMemberId: input.containerMemberId,
      firstSeenAt: input.now,
      handleLookupKey: input.verifiedInboundParticipant.contact.lookupKey,
      lastSeenAt: input.now,
      participantMemberId: input.verifiedInboundParticipant.memberId,
      removedAt: null,
    },
    update: {
      handleLookupKey: input.verifiedInboundParticipant.contact.lookupKey,
      lastSeenAt: input.now,
      removedAt: null,
    },
    where: {
      containerMemberId_participantMemberId: {
        containerMemberId: input.containerMemberId,
        participantMemberId: input.verifiedInboundParticipant.memberId,
      },
    },
  });
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

export async function resolveHostedLinqRecoveredPendingGroupSetup(input: {
  occurredAt: Date;
  participantMemberIds: readonly string[];
  recoveredRecipientPhoneLookupKey: string;
  senderMemberId?: string | null;
  threadId: string;
  tx: Prisma.TransactionClient;
}): Promise<{
  id: string;
  ownerMemberId: string;
  recipientPhoneLookupKey: string;
} | null> {
  const candidates =
    await readHostedPendingGroupSetupCandidatesForParticipantsTx({
      occurredAt: input.occurredAt,
      participantMemberIds: input.participantMemberIds,
      tx: input.tx,
    });
  const recoveredCandidates: typeof candidates = [];
  for (const candidate of candidates) {
    const authority = readHostedLinqHomeLineAuthority(
      await readHostedMemberRoutingState({
        memberId: candidate.ownerMemberId,
        prisma: input.tx,
      }),
    );
    if (authority.kind === "none") {
      continue;
    }
    const originalRecipientPhone = normalizePhoneNumber(
      authority.recipientPhone,
    );
    if (!originalRecipientPhone) {
      continue;
    }
    const originalRecipientPhoneLookupKeys =
      createHostedPhoneLookupKeyReadCandidates(originalRecipientPhone);
    if (
      !originalRecipientPhoneLookupKeys.includes(
        candidate.recipientPhoneLookupKey,
      )
      || originalRecipientPhoneLookupKeys.includes(
        input.recoveredRecipientPhoneLookupKey,
      )
    ) {
      continue;
    }
    const recoveryAuthority =
      await readHostedLinqGroupLineRecoveryAuthorityTx({
        memberId: candidate.ownerMemberId,
        occurredAt: input.occurredAt,
        originalRecipientPhone,
        pendingGroupSetupId: candidate.id,
        prisma: input.tx,
        recoveredRecipientPhoneLookupKey:
          input.recoveredRecipientPhoneLookupKey,
        setupArmedAt: candidate.armedAt,
        threadId: input.threadId,
      });
    if (recoveryAuthority === "in_flight") {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
        httpStatus: 503,
        message:
          "The group line recovery message is still recovering. Retry this webhook after the current delivery attempt completes.",
        retryable: true,
      });
    }
    if (recoveryAuthority !== "accepted") {
      continue;
    }
    recoveredCandidates.push(candidate);
  }
  const selection = selectHostedPendingGroupSetupCandidate({
    candidates: recoveredCandidates,
    senderMemberId: input.senderMemberId,
  });
  if (selection.kind === "none") {
    return null;
  }
  const selected = recoveredCandidates.find(
    (candidate) =>
      candidate.id === selection.candidate.id
      && candidate.ownerMemberId === selection.candidate.ownerMemberId,
  );
  if (!selected) {
    return null;
  }

  return {
    id: selected.id,
    ownerMemberId: selected.ownerMemberId,
    recipientPhoneLookupKey: selected.recipientPhoneLookupKey,
  };
}

function isHostedLinqGroupChat(messageEvent: HostedLinqMessageReceivedEvent): boolean {
  return messageEvent.data.chat?.is_group === true;
}

function isHostedLinqDirectChatAttested(
  messageEvent: HostedLinqMessageReceivedEvent,
): boolean {
  return messageEvent.data.chat?.is_group === false;
}

function resolveHostedLinqThreadIsDirect(
  messageEvent: HostedLinqMessageReceivedEvent,
): boolean | null {
  const isGroup = messageEvent.data.chat?.is_group;
  return typeof isGroup === "boolean" ? !isGroup : null;
}

async function readRetryableUnsentFallbackRecipientPhone(input: {
  bindingResult: HostedLinqHomeLineRouteBindingResult;
  existingMemberActive: boolean;
  memberId: string | null;
  onboardingLinkSentAt: Date | null;
  prisma: Prisma.TransactionClient;
}): Promise<string | null> {
  if (
    input.bindingResult.kind !== "redirect_to_home"
    || input.existingMemberActive
    || input.onboardingLinkSentAt
    || !input.memberId
  ) {
    return null;
  }

  const routeAuthority = readHostedLinqHomeLineAuthority(
    await readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
  );
  const fallbackRecipientPhone = normalizePhoneNumber(input.bindingResult.homeRecipientPhone);
  if (
    !fallbackRecipientPhone
    || routeAuthority.kind !== "bare"
    || routeAuthority.recipientPhone !== fallbackRecipientPhone
  ) {
    return null;
  }

  return fallbackRecipientPhone;
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
