import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import {
  type HostedAiUsageGateNoticeCode,
} from "../hosted-execution/usage-allowance";
import { sha256Hex } from "../primitives";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  claimHostedLinqDeliveryProviderDispatchTx,
  HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  readHostedLinqDeliveryProviderDispatchIntentTx,
  readHostedLinqDeliveryProviderDispatchIntentsTx,
  resolveHostedLinqInviteSignupDispatchEffectIdTx,
} from "./linq-delivery-store";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx,
} from "../hosted-execution/usage-limit-notice-claim";
import {
  assertHostedLinqRouteAuthorityMatchesTarget,
} from "./linq-egress-engagement";
import {
  isHostedRuntimeAiAccessNoticeCode,
  readHostedRuntimeAiAccessDecision,
  type HostedRuntimeAiAccessNoticeCode,
} from "./member-access";
import { sanitizeHostedOnboardingLogString } from "./http";
import { buildHostedGroupAwareInviteUrl } from "../hosted-groups/group-join-invite-link";
import {
  beginHostedGroupJoinProviderRequest,
  createHostedGroupJoinProviderFenceState,
  HOSTED_GROUP_JOIN_PROVIDER_FENCE_LOCK_TIMEOUT_MS,
  HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS,
  type HostedGroupJoinProviderFenceState,
} from "../hosted-groups/group-join-provider-fence";
import { normalizePhoneNumber } from "./phone";
import {
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "./linq-observability-identifiers";
import {
  buildHostedLinqInviteSignupEffectId,
} from "./linq-invite-signup-effect-id";
import {
  buildHostedLinqGroupLineRecoveryEffectId,
  buildHostedLinqGroupLineRecoveryAttemptEffectId,
  buildHostedLinqGroupLineRecoveryMessage,
  buildHostedLinqGroupLineRecoverySourceRef,
  HOSTED_LINQ_GROUP_LINE_RECOVERY_MAX_ATTEMPTS,
  HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE,
  isHostedLinqGroupLineRecoverySourceRefForSameIntent,
  readHostedLinqGroupLineRecoveryInstructionSeed,
  type HostedLinqGroupLineRecoveryParticipantContact,
} from "./linq-group-line-recovery";
import {
  buildHostedLinqGroupEmailRecoveryEffectId,
  buildHostedLinqGroupEmailRecoveryMessage,
  buildHostedLinqGroupSetupEffectId,
  buildHostedLinqGroupSetupMessage,
  HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE,
  HOSTED_LINQ_GROUP_SETUP_TEMPLATE,
  openHostedLinqGroupEmailRecoveryToken,
} from "./linq-group-setup";
import {
  claimHostedLinqQuotaReplyNotice,
  markHostedLinqOnboardingLinkNoticeSent,
  readHostedLinqDailyState,
  releaseHostedLinqOnboardingLinkNoticeClaim,
  releaseHostedLinqQuotaReplyNoticeClaim,
  resolveHostedLinqDayUtc,
} from "./linq-daily-state";
import {
  buildHostedDailyQuotaReply,
  buildHostedInviteReply,
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "./linq";
import {
  createHostedLinqChat,
} from "./linq-client";
import {
  isHostedLinqContactCardAutoShareEligible,
  type MurphHostedLinqNativeContactCardShareOutcome,
  shareMurphHostedLinqNativeContactCardToChat,
} from "./linq-contact-card-share";
import {
  assertHostedThreadRouteEgressAuthority,
  readHostedThreadRouteByThreadIdentity,
  type HostedLinqThreadRouteEgressAuthority,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";
import {
  readHostedGroupJoinOutreachReplyDeliveryContextTx,
} from "../hosted-groups/group-join-outreach-store";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState,
} from "./hosted-member-routing-store";
import {
  lookupHostedMemberIdentityByPhoneNumber,
} from "./hosted-member-identity-store";
import {
  lookupHostedMemberByVerifiedEmailAddress,
} from "./hosted-member-store";
import {
  readHostedLinqHomeLineAuthority,
  reserveHostedLinqHealthyProactiveLineTx,
  startOfUtcDay,
} from "./linq-home-routing";
import {
  claimHostedLinqProactiveConversationCapacityTx,
  listHostedLinqHealthyProactiveLines,
  readHostedLinqIncomingLineState,
  readHostedLinqReceiptCorrelatedRecoveryLineTx,
} from "./linq-line-store";
import { resolveHostedLinqSignupWelcomeDailyLimit } from "./linq-routing-policy";
import { lockHostedMemberRow } from "./shared";

type HostedLinqTransportPersistenceClient = PrismaClient | Prisma.TransactionClient;
type HostedLinqTransportPostResponseScheduler = (task: () => Promise<void>) => void;

export type HostedLinqConversationHomeRedirectPayload = {
  chatId: string;
  homeRecipientPhone: string;
  memberId: string;
  occurredAt: string;
  replyToMessageId: string | null;
  template: "conversation_home_redirect";
};

export type HostedLinqDailyQuotaPayload = {
  chatId: string;
  // Optional for payloads persisted before per-thread limits existed; render
  // falls back to the direct-chat limit.
  dailyTextLimit?: number;
  memberId: string;
  occurredAt: string;
  replyToMessageId: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  template: "daily_quota";
};

export type HostedLinqAiUsageQuotaClaimToken = {
  periodStart: string;
  planResetAt?: string | null;
  sentAt: string;
  usageCreditLedgerVersion: string;
};

type HostedLinqPersistedAiUsageQuotaClaimToken =
  Omit<HostedLinqAiUsageQuotaClaimToken, "usageCreditLedgerVersion"> & {
    usageCreditLedgerVersion?: string;
  };

type HostedLinqUsageLimitNoticeCode = HostedAiUsageGateNoticeCode;

type HostedLinqAiUsageQuotaBasePayload = {
  chatId: string;
  memberId: string;
  message: string;
  occurredAt: string;
  replyToMessageId: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  sourceEventId: string;
  template: "ai_usage_quota";
};

export type HostedLinqAiUsageQuotaPayload =
  | (HostedLinqAiUsageQuotaBasePayload & {
    claimToken: HostedLinqPersistedAiUsageQuotaClaimToken;
    noticeCode: HostedLinqUsageLimitNoticeCode;
  })
  | (HostedLinqAiUsageQuotaBasePayload & {
    claimToken: null;
    noticeCode: HostedRuntimeAiAccessNoticeCode;
  });

export type HostedLinqGroupSetupMessagePayload = {
  chatId: string;
  occurredAt: string;
  replyToMessageId: string | null;
  sourceEventId: string;
  template: typeof HOSTED_LINQ_GROUP_SETUP_TEMPLATE;
};

export type HostedLinqGroupEmailRecoveryMessagePayload = {
  assignedRecipientPhone: string;
  chatId: null;
  occurredAt: string;
  participantContact: {
    kind: "email";
    value: string;
  };
  recoveryToken: string;
  replyToMessageId: null;
  sourceEventId: string;
  template: typeof HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE;
  threadId: string;
};

export type HostedLinqInviteSignupMessagePayload = {
  chatId: string;
  groupJoinCode?: string | null;
  groupJoinOutreachId?: string | null;
  inviteId: string;
  memberId: string;
  occurredAt: string;
  replyToMessageId: string | null;
  service?: string | null;
  sourceEventId: string;
  threadIsDirect?: boolean | null;
  template: "invite_signup";
};

export type HostedLinqInviteSignupFallbackMessagePayload = {
  assignedRecipientPhone: string;
  chatId: null;
  groupJoinCode?: string | null;
  groupJoinOutreachId?: string | null;
  inviteId: string;
  memberId: string;
  memberPhone: string;
  occurredAt: string;
  replyToMessageId: null;
  sourceEventId: string;
  template: "invite_signup_fallback";
};

export type HostedLinqGroupLineRecoveryMessagePayload = {
  assignedRecipientPhone: string | null;
  chatId: null;
  incomingRecipientPhone: string;
  memberId: string;
  occurredAt: string;
  participantContact: HostedLinqGroupLineRecoveryParticipantContact;
  replyToMessageId: null;
  sourceEventId: string;
  template: typeof HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE;
  threadId: string;
};

export type HostedLinqInviteSigninMessagePayload = {
  chatId: string;
  inviteId: string;
  replyToMessageId: string | null;
  service?: string | null;
  threadIsDirect?: boolean | null;
  template: "invite_signin";
};

export type HostedLinqInviteMessagePayload =
  | HostedLinqInviteSignupFallbackMessagePayload
  | HostedLinqInviteSigninMessagePayload
  | HostedLinqInviteSignupMessagePayload;

export type HostedLinqFamilyInviteReplyPayload = {
  chatId: string;
  memberId: string;
  message: string;
  occurredAt: string;
  replyToMessageId: string | null;
  sourceEventId: string;
  template: "family_invite_reply";
};

export type HostedLinqMessagePayload =
  | HostedLinqAiUsageQuotaPayload
  | HostedLinqConversationHomeRedirectPayload
  | HostedLinqDailyQuotaPayload
  | HostedLinqFamilyInviteReplyPayload
  | HostedLinqGroupEmailRecoveryMessagePayload
  | HostedLinqGroupLineRecoveryMessagePayload
  | HostedLinqGroupSetupMessagePayload
  | HostedLinqInviteMessagePayload;

export type HostedLinqMessageSideEffect = {
  effectId: string;
  payload: HostedLinqMessagePayload;
};

export type CreateHostedWebhookLinqMessageSideEffectInput =
  | {
      chatId: string;
      homeRecipientPhone: string;
      memberId: string;
      occurredAt: string;
      replyToMessageId?: string | null;
      sourceEventId: string;
      template: "conversation_home_redirect";
    }
  | {
      chatId: string;
      claimToken: HostedLinqAiUsageQuotaClaimToken;
      message: string;
      memberId: string;
      noticeCode: HostedLinqUsageLimitNoticeCode;
      occurredAt: string;
      replyToMessageId?: string | null;
      routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
      sourceEventId: string;
      template: "ai_usage_quota";
    }
  | {
      chatId: string;
      claimToken?: null;
      message: string;
      memberId: string;
      noticeCode: HostedRuntimeAiAccessNoticeCode;
      occurredAt: string;
      replyToMessageId?: string | null;
      routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
      sourceEventId: string;
      template: "ai_usage_quota";
    }
  | {
      chatId: string;
      dailyTextLimit: number;
      memberId: string;
      occurredAt: string;
      replyToMessageId?: string | null;
      routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
      sourceEventId: string;
      template: "daily_quota";
    }
  | {
      chatId: string;
      memberId: string;
      message: string;
      occurredAt: string;
      replyToMessageId?: string | null;
      sourceEventId: string;
      template: "family_invite_reply";
    }
  | {
      chatId: string;
      occurredAt: string;
      replyToMessageId?: string | null;
      sourceEventId: string;
      template: typeof HOSTED_LINQ_GROUP_SETUP_TEMPLATE;
    }
  | {
      assignedRecipientPhone: string;
      occurredAt: string;
      participantContact: {
        kind: "email";
        value: string;
      };
      recoveryToken: string;
      sourceEventId: string;
      template: typeof HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE;
      threadId: string;
    }
  | {
      assignedRecipientPhone: string;
      groupJoinCode?: string | null;
      groupJoinOutreachId?: string | null;
      inviteId: string;
      memberId: string;
      memberPhone: string;
      occurredAt: string;
      sourceEventId: string;
      template: "invite_signup_fallback";
    }
  | {
      incomingRecipientPhone: string;
      memberId: string;
      occurredAt: string;
      participantContact: HostedLinqGroupLineRecoveryParticipantContact;
      pendingGroupSetupId?: string | null;
      sourceEventId: string;
      template: typeof HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE;
      threadId: string;
    }
  | {
      chatId: string;
      groupJoinCode?: string | null;
      groupJoinOutreachId?: string | null;
      inviteId: string;
      memberId: string;
      occurredAt: string;
      replyToMessageId?: string | null;
      service?: string | null;
      sourceEventId: string;
      threadIsDirect?: boolean | null;
      template: "invite_signup";
    };

export function createHostedWebhookLinqMessageSideEffect(
  input: CreateHostedWebhookLinqMessageSideEffectInput,
): HostedLinqMessageSideEffect {
  const replyToMessageId = "replyToMessageId" in input
    ? input.replyToMessageId ?? null
    : null;

  return {
    effectId: buildHostedWebhookLinqMessageEffectId(input),
    payload: buildHostedWebhookLinqMessagePayload(input, replyToMessageId),
  };
}

function buildHostedWebhookLinqMessageEffectId(
  input: CreateHostedWebhookLinqMessageSideEffectInput,
): string {
  if (input.template === "invite_signup" || input.template === "invite_signup_fallback") {
    return buildHostedLinqInviteSignupEffectId(input);
  }

  if (input.template === HOSTED_LINQ_GROUP_SETUP_TEMPLATE) {
    return buildHostedLinqGroupSetupEffectId({
      chatId: input.chatId,
      occurredAt: input.occurredAt,
    });
  }

  if (input.template === HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE) {
    return buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: input.threadId,
      occurredAt: input.occurredAt,
      participantEmail: input.participantContact.value,
      recipientPhone: input.assignedRecipientPhone,
    });
  }

  if (input.template === "ai_usage_quota" && input.claimToken) {
    return buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: input.memberId,
      periodStart: input.claimToken.periodStart,
      planResetAt: parseHostedAiUsagePlanResetAt(input.claimToken.planResetAt),
      usageCreditLedgerVersion: parseHostedAiUsageCreditLedgerVersion(
        input.claimToken.usageCreditLedgerVersion,
      ),
    });
  }

  if (input.template === "conversation_home_redirect") {
    return buildHostedLinqConversationHomeRedirectEffectId(input);
  }

  if (input.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE) {
    return buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: input.incomingRecipientPhone,
      memberId: input.memberId,
      pendingGroupSetupId: input.pendingGroupSetupId,
      threadId: input.threadId,
    });
  }

  return `linq-message:${input.sourceEventId}`;
}

// One redirect per wrong Linq chat + home line + member + inbound UTC day. If
// the member's home line changes later, the new target hashes differently.
// Hashes normalized raw inputs directly; the contact-privacy lookup keys are
// not stable across keyring rotation and would let a rotation re-send a
// duplicate. The provider occurrence day keeps webhook retries stable even when
// processing crosses midnight.
function buildHostedLinqConversationHomeRedirectEffectId(
  input: Extract<
    CreateHostedWebhookLinqMessageSideEffectInput,
    { template: "conversation_home_redirect" }
  >,
): string {
  const chatId = input.chatId.trim();
  const dayUtc = resolveHostedLinqDayUtc(input.occurredAt).toISOString();
  const homeRecipientPhone = normalizePhoneNumber(input.homeRecipientPhone);
  const memberId = input.memberId.trim();

  if (!chatId || !homeRecipientPhone || !memberId) {
    return `linq-message:${input.sourceEventId}`;
  }

  const hash = sha256Hex(JSON.stringify({
    chatId,
    dayUtc,
    homeRecipientPhone,
    memberId,
  })).slice(0, 32);
  return `linq-home-redirect:${hash}`;
}

type HostedLinqSideEffectDrainInput = {
  prisma: HostedLinqTransportPersistenceClient;
  scheduleAfterResponse?: HostedLinqTransportPostResponseScheduler;
  sideEffects: readonly HostedLinqMessageSideEffect[];
  signal?: AbortSignal;
};

type HostedLinqSignupMessageSideEffect = HostedLinqMessageSideEffect & {
  payload:
    | HostedLinqInviteSignupFallbackMessagePayload
    | HostedLinqInviteSignupMessagePayload;
};

type HostedLinqGroupLineRecoverySideEffect = HostedLinqMessageSideEffect & {
  payload: HostedLinqGroupLineRecoveryMessagePayload;
};

type HostedLinqGroupEmailRecoverySideEffect = HostedLinqMessageSideEffect & {
  payload: HostedLinqGroupEmailRecoveryMessagePayload;
};

type HostedLinqSideEffectDrainSkipReason =
  | "effect_unresolved"
  | "notice_already_claimed"
  | "notice_in_flight"
  | "notice_target_unauthorized";

type HostedLinqProviderDispatchPreparation =
  | {
      effect: HostedLinqMessageSideEffect;
      status: "claimed";
    }
  | {
      retryAt?: Date;
      status: "in_flight";
    }
  | {
      status: "already_completed";
    }
  | {
      status: "target_unauthorized";
    };

type HostedLinqSideEffectSendSkip = {
  reason: Exclude<HostedLinqSideEffectDrainSkipReason, "effect_unresolved">;
  retryAt?: Date;
};

export type HostedLinqSideEffectDrainResult = {
  sentCount: number;
  skipped: readonly {
    effectId: string;
    reason: HostedLinqSideEffectDrainSkipReason;
    retryAt?: Date;
    template: HostedLinqMessagePayload["template"];
  }[];
};

export async function drainHostedLinqSideEffectsDirect(
  input: HostedLinqSideEffectDrainInput,
): Promise<HostedLinqSideEffectDrainResult> {
  let sentCount = 0;
  const skipped: HostedLinqSideEffectDrainResult["skipped"][number][] = [];

  for (const plannedEffect of input.sideEffects) {
    const result = await drainHostedLinqSideEffectWithProviderFence(
      plannedEffect,
      input,
    );
    sentCount += result.sentCount;
    skipped.push(...result.skipped);
  }

  return {
    sentCount,
    skipped,
  };
}

async function drainHostedLinqSideEffectWithProviderFence(
  plannedEffect: HostedLinqMessageSideEffect,
  input: HostedLinqSideEffectDrainInput,
): Promise<HostedLinqSideEffectDrainResult> {
  const effect = await resolveHostedLinqDispatchSideEffect(
    plannedEffect,
    input.prisma,
  );
  if (!effect) {
    return {
      sentCount: 0,
      skipped: [{
        effectId: plannedEffect.effectId,
        reason: "effect_unresolved",
        template: plannedEffect.payload.template,
      }],
    };
  }
  const requiresProviderFence =
    await requiresHostedGroupJoinProviderFence(effect, input.prisma);
  if (!requiresProviderFence) {
    return drainHostedLinqSideEffectDirect(effect, {
      ...input,
      completeProviderOutcomeBeforeReturn:
        isHostedLinqGroupLineRecoverySideEffect(effect),
    });
  }

  const run = async (
    prisma: Prisma.TransactionClient,
  ): Promise<
    | { result: HostedLinqSideEffectDrainResult; status: "completed" }
    | { error: unknown; status: "failed" }
  > => {
    const providerFenceState = createHostedGroupJoinProviderFenceState();
    try {
      return {
        result: await drainHostedLinqSideEffectDirect(effect, {
          ...input,
          completeProviderOutcomeBeforeReturn: true,
          prisma,
          providerFenceState,
        }),
        status: "completed",
      };
    } catch (error) {
      if (
        !providerFenceState.providerRequestStarted
        || providerFenceState.providerRequestCompleted
      ) {
        throw error;
      }
      // Commit the attempted/failed delivery consequence and reopened exact
      // outreach before surfacing the provider failure to webhook retry.
      return { error, status: "failed" };
    }
  };

  const outcome = isHostedLinqTransportRootClient(input.prisma)
    ? await input.prisma.$transaction(
        run,
        HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS,
      )
    : await run(input.prisma);
  if (outcome.status === "failed") {
    throw outcome.error;
  }
  return outcome.result;
}

async function drainHostedLinqSideEffectDirect(
  effect: HostedLinqMessageSideEffect,
  input: HostedLinqSideEffectDrainInput & {
    completeProviderOutcomeBeforeReturn: boolean;
    providerFenceState?: HostedGroupJoinProviderFenceState;
  },
): Promise<HostedLinqSideEffectDrainResult> {
  const noticeClaimed = await claimHostedLinqNoticeForSideEffect(
    effect,
    input.prisma,
  );
  if (!noticeClaimed) {
    return {
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_already_claimed",
        template: effect.payload.template,
      }],
    };
  }
  let sendSkip: HostedLinqSideEffectSendSkip | null;
  try {
    sendSkip = await sendHostedLinqSideEffect(effect, {
      completeProviderOutcomeBeforeReturn:
        input.completeProviderOutcomeBeforeReturn,
      prisma: input.prisma,
      providerFenceState: input.providerFenceState,
      scheduleAfterResponse: input.scheduleAfterResponse,
      signal: input.signal,
    });
  } catch (error) {
    await releaseHostedLinqNoticeClaimForSideEffect(effect, input.prisma);
    throw error;
  }
  if (sendSkip) {
    return {
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: sendSkip.reason,
        ...(sendSkip.retryAt ? { retryAt: sendSkip.retryAt } : {}),
        template: effect.payload.template,
      }],
    };
  }

  if (isHostedInviteLinqMessagePayload(effect.payload)) {
    if (!input.completeProviderOutcomeBeforeReturn) {
      await markHostedLinqNoticeSentForSideEffect(effect, input.prisma);
    }
    await markHostedInviteSentBestEffort(effect.payload.inviteId, input.prisma);
  }
  return { sentCount: 1, skipped: [] };
}

async function requiresHostedGroupJoinProviderFence(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<boolean> {
  if (!isHostedLinqSignupMessageSideEffect(effect)) {
    return false;
  }
  if (effect.payload.groupJoinOutreachId?.trim()) {
    return true;
  }
  const persistedIntent =
    await readHostedLinqDeliveryProviderDispatchIntentTx({
      idempotencyKey: effect.effectId,
      prisma,
    });
  return Boolean(persistedIntent?.groupJoinOutreachId);
}

/**
 * Signup-link sends run as explicit delivery attempts. Generic links keep the
 * member/day base identity; group-aware links add the exact source-event
 * digest. A retry whose current lookup no longer sees its group first recovers
 * that exact-source identity from the delivery row. Terminal failure advances
 * only that identity's attempt ordinal.
 */
async function resolveHostedLinqDispatchSideEffect(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<HostedLinqMessageSideEffect | null> {
  if (
    effect.payload.template !== "invite_signup"
    && effect.payload.template !== "invite_signup_fallback"
  ) {
    return effect;
  }

  let dispatchEffect = effect;
  if (!effect.payload.groupJoinOutreachId?.trim()) {
    const exactSourceEffectId = buildHostedLinqInviteSignupEffectId({
      memberId: effect.payload.memberId,
      occurredAt: effect.payload.occurredAt,
      sourceEventId: effect.payload.sourceEventId,
      sourceEventIdentity: true,
    });
    const persistedExactSource =
      await readHostedLinqDeliveryProviderDispatchIntentTx({
        idempotencyKey: exactSourceEffectId,
        prisma,
      });
    if (persistedExactSource) {
      const persistedOutreachId =
        persistedExactSource.groupJoinOutreachId?.trim() ?? "";
      const persistedReplyOccurredAt =
        persistedExactSource.groupJoinReplyOccurredAt;
      if (Boolean(persistedOutreachId) !== Boolean(persistedReplyOccurredAt)) {
        console.warn("Hosted Linq signup-link intent has incomplete group context.", {
          effectIdSuffix:
            toHostedOnboardingLogIdSuffix(exactSourceEffectId) ?? "unknown",
        });
        return null;
      }
      dispatchEffect = {
        ...effect,
        effectId: exactSourceEffectId,
        ...(persistedOutreachId && persistedReplyOccurredAt
          ? {
              payload: {
                ...effect.payload,
                groupJoinCode: undefined,
                groupJoinOutreachId: persistedOutreachId,
                occurredAt: persistedReplyOccurredAt.toISOString(),
              },
            }
          : {}),
      };
    }
  }

  const effectId = await resolveHostedLinqInviteSignupDispatchEffectIdTx({
    effectId: dispatchEffect.effectId,
    prisma,
  });
  if (!effectId) {
    console.warn("Hosted Linq signup-link attempt budget exhausted.", {
      effectIdSuffix: toHostedOnboardingLogIdSuffix(effect.effectId) ?? "unknown",
      template: effect.payload.template,
    });
    return null;
  }
  return effectId === dispatchEffect.effectId
    ? dispatchEffect
    : {
        ...dispatchEffect,
        effectId,
      };
}

async function sendHostedLinqSideEffect(
  effect: {
    effectId: string;
    payload: HostedLinqMessagePayload;
  },
  options: {
    completeProviderOutcomeBeforeReturn: boolean;
    prisma: HostedLinqTransportPersistenceClient;
    providerFenceState?: HostedGroupJoinProviderFenceState;
    scheduleAfterResponse?: HostedLinqTransportPostResponseScheduler;
    signal?: AbortSignal;
  },
): Promise<HostedLinqSideEffectSendSkip | null> {
  const startedAtMs = Date.now();
  const usageLimitPayload =
    effect.payload.template === "ai_usage_quota" && effect.payload.claimToken
      ? effect.payload
      : null;
  const deliveryAttemptTask = usageLimitPayload
    ? Promise.resolve<HostedLinqProviderDispatchPreparation>({
        effect,
        status: "claimed",
      })
    : prepareHostedLinqSideEffectProviderDispatch({
        effect,
        prisma: options.prisma,
        providerFenceState: options.providerFenceState,
        startedAtMs,
      });
  let deliveryEffect = effect;
  let providerIdempotencyKey = effect.effectId;
  let providerRequestCompleted = false;
  let replayingRichLinkPartial = false;
  let usageLimitDispatchClaimed = false;

  try {
    const preparation = await deliveryAttemptTask;
    if (preparation.status === "target_unauthorized") {
      return { reason: "notice_target_unauthorized" };
    }
    if (preparation.status === "already_completed") {
      return { reason: "notice_already_claimed" };
    }
    if (preparation.status === "in_flight") {
      return {
        reason: "notice_in_flight",
        ...(preparation.retryAt ? { retryAt: preparation.retryAt } : {}),
      };
    }

    deliveryEffect = preparation.effect;
    providerIdempotencyKey = deliveryEffect.effectId;

    if (isHostedLinqCreateChatSideEffectPayload(deliveryEffect.payload)) {
      const assignedRecipientPhone = normalizePhoneNumber(
        deliveryEffect.payload.assignedRecipientPhone,
      );
      if (!assignedRecipientPhone) {
        throw new TypeError(
          "Hosted Linq participant side-effect dispatch requires a sending line.",
        );
      }
      const participantContact =
        deliveryEffect.payload.template === "invite_signup_fallback"
          ? deliveryEffect.payload.memberPhone
          : deliveryEffect.payload.participantContact.value;
      const message = await buildHostedLinqSideEffectMessage(
        deliveryEffect,
        options.prisma,
      );
      beginHostedGroupJoinProviderRequest(options.providerFenceState);
      const result = await createHostedLinqChat({
        from: assignedRecipientPhone,
        idempotencyKey: deliveryEffect.effectId,
        message,
        signal: options.signal,
        to: [participantContact],
      });
      providerRequestCompleted = true;
      if (options.providerFenceState) {
        options.providerFenceState.providerRequestCompleted = true;
      }

      const acceptedMilestone = () => markHostedLinqDeliveryAcceptedBestEffort({
        chatId: result.chatId,
        effect: deliveryEffect,
        messageId: result.messageId,
        messageIds: result.providerMessageIds,
        prisma: options.prisma,
        throwOnError: options.completeProviderOutcomeBeforeReturn,
      });
      if (options.completeProviderOutcomeBeforeReturn) {
        await deliveryAttemptTask;
        await acceptedMilestone();
      } else {
        scheduleHostedLinqDeliveryMilestoneAfterAttempt({
          attemptTask: deliveryAttemptTask,
          milestoneTask: acceptedMilestone,
          scheduleAfterResponse: options.scheduleAfterResponse,
        });
      }
      return null;
    }

    const message = await buildHostedLinqSideEffectMessage(
      deliveryEffect,
      options.prisma,
    );
    if (usageLimitPayload) {
      requireHostedOnboardingLinqConfig();
      options.signal?.throwIfAborted();
      const attemptedAt = new Date(usageLimitPayload.claimToken.sentAt);
      const dispatch = await startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
        assertDispatchAuthority: async (prisma) => {
          await assertHostedLinqSideEffectRouteAuthority(effect, prisma);
        },
        attemptedAt,
        memberId: usageLimitPayload.memberId,
        noticeDeliveryTarget: {
          channel: "linq",
          replyToMessageId: usageLimitPayload.replyToMessageId,
          routeAuthority: usageLimitPayload.routeAuthority ?? null,
          target: usageLimitPayload.chatId,
        },
        periodStart: new Date(usageLimitPayload.claimToken.periodStart),
        planResetAt: parseHostedAiUsagePlanResetAt(
          usageLimitPayload.claimToken.planResetAt,
        ),
        prisma: requireHostedLinqTransportPrismaClient(options.prisma),
        source: "hosted_webhook_side_effect",
        sourceRef: usageLimitPayload.sourceEventId,
        targetKind: "thread",
        usageCreditLedgerVersion: parseHostedAiUsageCreditLedgerVersion(
          usageLimitPayload.claimToken.usageCreditLedgerVersion,
        ),
      });
      if (dispatch.status !== "claimed") {
        if (dispatch.status === "not_authorized") {
          return { reason: "notice_target_unauthorized" };
        }
        return dispatch.status === "already_notified"
          ? { reason: "notice_already_claimed" }
          : {
              reason: "notice_in_flight",
              ...(dispatch.retryAt ? { retryAt: dispatch.retryAt } : {}),
            };
      }
      usageLimitDispatchClaimed = true;
      providerIdempotencyKey = dispatch.providerIdempotencyKey;
      replayingRichLinkPartial =
        dispatch.replayingRichLinkPartial === true;
      deliveryEffect = dispatch.idempotencyKey === effect.effectId
        ? effect
        : { ...effect, effectId: dispatch.idempotencyKey };
    }

    const deliveryChatId = readHostedLinqSideEffectChatId(
      deliveryEffect.payload,
    );
    if (!deliveryChatId) {
      throw new TypeError(
        "Hosted Linq thread side-effect dispatch requires a chat id.",
      );
    }
    beginHostedGroupJoinProviderRequest(options.providerFenceState);
    const result = await sendHostedLinqChatMessage({
      chatId: deliveryChatId,
      idempotencyKey: providerIdempotencyKey,
      message,
      replyToMessageId: deliveryEffect.payload.replyToMessageId,
      signal: options.signal,
    });
    providerRequestCompleted = true;
    if (options.providerFenceState) {
      options.providerFenceState.providerRequestCompleted = true;
    }
    const acceptedMilestone = () => markHostedLinqDeliveryAcceptedBestEffort({
      chatId: result.chatId ?? deliveryChatId,
      effect: deliveryEffect,
      messageId: result.messageId,
      messageIds: result.providerMessageIds,
      prisma: options.prisma,
      ...(replayingRichLinkPartial
        ? { replayingRichLinkPartial: true }
        : {}),
      throwOnError:
        deliveryEffect.payload.template === "ai_usage_quota"
        || options.completeProviderOutcomeBeforeReturn,
    });
    if (
      deliveryEffect.payload.template === "ai_usage_quota"
      || options.completeProviderOutcomeBeforeReturn
    ) {
      await deliveryAttemptTask;
      await acceptedMilestone();
    } else {
      scheduleHostedLinqDeliveryMilestoneAfterAttempt({
        attemptTask: deliveryAttemptTask,
        milestoneTask: acceptedMilestone,
        scheduleAfterResponse: options.scheduleAfterResponse,
      });
    }
  } catch (error) {
    if (
      effect.payload.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
    ) {
      await deliveryAttemptTask;
    } else if (
      effect.payload.template === "invite_signup"
      || effect.payload.template === "invite_signup_fallback"
      || effect.payload.template === HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE
    ) {
      await deliveryAttemptTask;
      if (
        (
          !options.providerFenceState
          || options.providerFenceState.providerRequestStarted
        )
        && !providerRequestCompleted
        && !options.providerFenceState?.providerRequestCompleted
      ) {
        await markHostedLinqDeliveryFailedBestEffort({
          effect: deliveryEffect,
          error,
          prisma: options.prisma,
        });
      }
    } else if (
      effect.payload.template === "ai_usage_quota"
      && usageLimitPayload
    ) {
      if (usageLimitDispatchClaimed) {
        const partialDelivery =
          readHostedLinqRichLinkPartialDeliveryFailure(error);
        await markHostedLinqDeliverySendFailedTx(
          partialDelivery
            ? {
                expectedAttemptedAt: new Date(
                  usageLimitPayload.claimToken.sentAt,
                ),
                failureCode: partialDelivery.failureCode,
                failureReason: error instanceof Error ? error.message : null,
                idempotencyKey: deliveryEffect.effectId,
                linqChatId: partialDelivery.linqChatId,
                messageIds: partialDelivery.messageIds,
                prisma: options.prisma,
                ...(replayingRichLinkPartial
                  ? { replayingRichLinkPartial: true }
                  : {}),
              }
            : replayingRichLinkPartial
              ? {
                  expectedAttemptedAt: new Date(
                    usageLimitPayload.claimToken.sentAt,
                  ),
                  failureCode:
                    HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE,
                  failureReason: error instanceof Error ? error.message : null,
                  idempotencyKey: deliveryEffect.effectId,
                  prisma: options.prisma,
                  replayingRichLinkPartial: true,
                }
            : {
                expectedAttemptedAt: new Date(
                  usageLimitPayload.claimToken.sentAt,
                ),
                failureCode: "linq_usage_limit_dispatch_retryable",
                idempotencyKey: deliveryEffect.effectId,
                prisma: options.prisma,
              },
        );
      }
      console.error(
        "Hosted Linq side-effect delivery failed.",
        buildHostedLinqSideEffectLogDetails(deliveryEffect, error, Date.now() - startedAtMs),
      );
      throw error;
    } else {
      scheduleHostedLinqDeliveryMilestoneAfterAttempt({
        attemptTask: deliveryAttemptTask,
        milestoneTask: () => markHostedLinqDeliveryFailedBestEffort({
          effect: deliveryEffect,
          error,
          prisma: options.prisma,
        }),
        scheduleAfterResponse: options.scheduleAfterResponse,
      });
    }
    console.error(
      "Hosted Linq side-effect delivery failed.",
      buildHostedLinqSideEffectLogDetails(deliveryEffect, error, Date.now() - startedAtMs),
    );
    throw error;
  }

  return null;
}

function parseHostedAiUsageCreditLedgerVersion(value: unknown): bigint {
  if (value === undefined) {
    return 0n;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(
      "Hosted AI usage-limit claim ledger version must be a non-negative integer.",
    );
  }
  return BigInt(value);
}

function parseHostedAiUsagePlanResetAt(value: unknown): Date | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(
      "Hosted AI usage-limit claim plan reset must be an ISO timestamp.",
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError(
      "Hosted AI usage-limit claim plan reset must be an ISO timestamp.",
    );
  }
  return parsed;
}

/**
 * After the delivery lifecycle confirms an invite-signup reply reached the
 * handset, share the sending line's native provider contact card into that
 * thread so text-first members can save the contact without visiting the web
 * app. Direct, group, and fallback-created threads are eligible; the share
 * module owns the iMessage-only gate and the per-chat throttle reservation.
 * Best effort: a share failure never fails or delays the reply delivery, and
 * the request signal is deliberately not forwarded because the share may run
 * after the response completes. With a post-response scheduler this returns
 * after registering the task; otherwise the returned promise settles after
 * the native provider attempt reaches its terminal best-effort outcome.
 */
export function queueHostedLinqContactCardShareAfterDeliveredInviteSignup(input: {
  chatId: string | null;
  memberId: string;
  prisma: HostedLinqTransportPersistenceClient;
  scheduleAfterResponse?: HostedLinqTransportPostResponseScheduler;
  service: string | null;
}): Promise<void> | void {
  if (
    !input.chatId
    || !isHostedLinqContactCardAutoShareEligible({ service: input.service })
  ) {
    return;
  }
  const { chatId, memberId } = input;
  if (!isHostedLinqTransportPrismaClient(input.prisma)) {
    // Receipt ingestion and accepted-milestone replay run on the root client;
    // a transactional client could close before this post-response share runs.
    console.warn("Hosted Linq contact-card share skipped inside a transaction.", {
      chatIdSuffix: toHostedOnboardingLogIdSuffix(chatId),
    });
    return;
  }
  const prisma = input.prisma;
  const task = async () => {
    try {
      const outcome = await shareMurphHostedLinqNativeContactCardToChat({
        chatId,
        memberId,
        prisma,
      });
      if (outcome.status === "failed" || outcome.status === "skipped") {
        console.warn(
          "Hosted Linq contact-card share did not send.",
          buildHostedLinqContactCardShareLogDetails(chatId, outcome),
        );
      }
    } catch (error) {
      console.warn(
        "Hosted Linq contact-card share failed.",
        buildHostedLinqContactCardShareLogDetails(chatId, {
          status: "failed",
          reason: "send_failed",
          error,
        }),
      );
    }
  };

  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(task);
    return;
  }
  return task();
}

function buildHostedLinqContactCardShareLogDetails(
  chatId: string,
  outcome: Extract<
    MurphHostedLinqNativeContactCardShareOutcome,
    { status: "failed" | "skipped" }
  >,
): Record<string, boolean | number | string | null> {
  const error = outcome.status === "failed" ? outcome.error : null;
  const errorRecord = error && typeof error === "object"
    ? error as Record<string, unknown>
    : null;

  return sanitizeHostedOnboardingStructuredLogDetails({
    chatIdSuffix: toHostedOnboardingLogIdSuffix(chatId),
    errorCode: typeof errorRecord?.code === "string" ? errorRecord.code : null,
    errorName: error instanceof Error ? error.name : null,
    operation: "share_contact_card",
    provider: "linq",
    reason: outcome.reason,
    status: outcome.status,
  });
}

async function assertHostedLinqSideEffectRouteAuthority(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<HostedThreadRouteSnapshot | null> {
  const routeAuthority = "routeAuthority" in effect.payload
    ? effect.payload.routeAuthority ?? null
    : null;
  if (routeAuthority) {
    return await assertHostedThreadRouteEgressAuthority({
      authority: assertHostedLinqRouteAuthorityMatchesTarget({
        chatId: effect.payload.chatId,
        memberId: "memberId" in effect.payload ? effect.payload.memberId : null,
        routeAuthority,
      }),
      prisma,
    });
  }

  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma,
    threadId: effect.payload.chatId,
  });
  if (!route) {
    return null;
  }

  throw hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "External thread route egress is no longer authorized.",
    retryable: false,
  });
}

function scheduleHostedLinqDeliveryMilestoneAfterAttempt(
  input: {
    attemptTask: Promise<unknown>;
    milestoneTask: () => Promise<void>;
    scheduleAfterResponse?: HostedLinqTransportPostResponseScheduler;
  },
): void {
  const task = async () => {
    await input.attemptTask;
    await input.milestoneTask();
  };

  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(task);
    return;
  }

  void task().catch((error) => {
    console.warn("Hosted Linq delivery milestone recording failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  });
}

/**
 * New direct-chat side effects target a participant on a selected line (their
 * chat does not exist yet); every other side effect targets an existing thread.
 * This is the one interpretation of a payload's delivery target, shared by
 * attempt recording and dispatch claiming so the shapes cannot drift.
 */
function readHostedLinqSideEffectDeliveryTarget(payload: HostedLinqMessagePayload): {
  linqChatId: string | null;
  phoneNumber?: string;
  targetKind: "participant" | "thread";
} {
  return isHostedLinqCreateChatSideEffectPayload(payload)
    ? {
        linqChatId: null,
        ...(payload.assignedRecipientPhone
          ? { phoneNumber: payload.assignedRecipientPhone }
          : {}),
        targetKind: "participant",
      }
    : {
        linqChatId: readHostedLinqSideEffectChatId(payload),
        targetKind: "thread",
      };
}

async function prepareHostedLinqSideEffectProviderDispatch(input: {
  effect: HostedLinqMessageSideEffect;
  prisma: HostedLinqTransportPersistenceClient;
  providerFenceState?: HostedGroupJoinProviderFenceState;
  startedAtMs: number;
}): Promise<HostedLinqProviderDispatchPreparation> {
  const signupEffect = isHostedLinqSignupMessageSideEffect(input.effect)
    ? input.effect
    : null;
  const groupLineRecoveryEffect =
    isHostedLinqGroupLineRecoverySideEffect(input.effect)
      ? input.effect
      : null;

  const groupEmailRecoveryEffect =
    isHostedLinqGroupEmailRecoverySideEffect(input.effect)
      ? input.effect
      : null;
  const restartableSetupEffect =
    input.effect.payload.template === HOSTED_LINQ_GROUP_SETUP_TEMPLATE
    || groupEmailRecoveryEffect !== null;

  return await runHostedLinqTransportTransaction(input.prisma, async (prisma) => {
    let dispatchEffect = input.effect;
    let dispatchSourceRef = input.effect.effectId;
    let recoveryCapacityClaimed = false;
    if (signupEffect) {
      await lockHostedMemberRow(
        prisma,
        signupEffect.payload.memberId,
        input.providerFenceState
          ? { timeoutMs: HOSTED_GROUP_JOIN_PROVIDER_FENCE_LOCK_TIMEOUT_MS }
          : {},
      );
      const invite = await prisma.hostedInvite.findUnique({
        select: { id: true },
        where: {
          id: signupEffect.payload.inviteId,
          member: { suspendedAt: null },
          memberId: signupEffect.payload.memberId,
        },
      });
      if (!invite) {
        return { status: "target_unauthorized" };
      }
      const persistedIntent =
        await readHostedLinqDeliveryProviderDispatchIntentTx({
          idempotencyKey: signupEffect.effectId,
          prisma,
        });
      if (persistedIntent?.providerCorrelated) {
        return { status: "already_completed" };
      }
      const recoveredIntent = await resolveHostedLinqSignupDispatchIntentTx({
        effect: signupEffect,
        persistedDeliveryId: persistedIntent?.id ?? null,
        persistedGroupJoinOutreachId:
          persistedIntent?.groupJoinOutreachId ?? null,
        persistedGroupJoinReplyOccurredAt:
          persistedIntent?.groupJoinReplyOccurredAt ?? null,
        persistedSourceRef: persistedIntent?.sourceRef ?? null,
        persistedIntentExists: persistedIntent !== null,
        prisma,
      });
      if (recoveredIntent.status !== "resolved") {
        return { status: recoveredIntent.status };
      }
      const signupDispatchEffect = recoveredIntent.effect;
      if (
        !persistedIntent
        && !signupDispatchEffect.payload.groupJoinOutreachId?.trim()
      ) {
        const dailyState = await readHostedLinqDailyState({
          memberId: signupDispatchEffect.payload.memberId,
          occurredAt: signupDispatchEffect.payload.occurredAt,
          prisma,
        });
        if (dailyState?.onboardingLinkSentAt) {
          return { status: "already_completed" };
        }
      }
      dispatchEffect = signupDispatchEffect;
      dispatchSourceRef = recoveredIntent.sourceRef;
    }
    if (groupLineRecoveryEffect) {
      const recoveredIntent =
        await resolveHostedLinqGroupLineRecoveryDispatchIntentTx({
          effect: groupLineRecoveryEffect,
          now: new Date(input.startedAtMs),
          prisma,
        });
      if (recoveredIntent.status === "already_completed") {
        return { status: "already_completed" };
      }
      if (recoveredIntent.status !== "resolved") {
        return { status: recoveredIntent.status };
      }
      dispatchEffect = recoveredIntent.effect;
      dispatchSourceRef = recoveredIntent.sourceRef;
      recoveryCapacityClaimed = recoveredIntent.capacityClaimed;
    }

    if (groupEmailRecoveryEffect) {
      // The token's lifetime is anchored to the provider's observed send time
      // so plan retries stay byte-identical for idempotency. A redelivery from
      // a long backlog can therefore surface a token that is already dead, so
      // re-open it with the same reader the redeem endpoint uses and skip
      // rather than open a conversation around a link that cannot work.
      if (
        !openHostedLinqGroupEmailRecoveryToken({
          now: new Date(input.startedAtMs),
          token: groupEmailRecoveryEffect.payload.recoveryToken,
        })
      ) {
        return { status: "target_unauthorized" };
      }
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: groupEmailRecoveryEffect.payload.threadId,
        tx: prisma,
      });
      const existingRoute = await readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma,
        threadId: groupEmailRecoveryEffect.payload.threadId,
      });
      if (existingRoute) {
        return { status: "already_completed" };
      }
      const persistedIntent =
        await readHostedLinqDeliveryProviderDispatchIntentTx({
          idempotencyKey: groupEmailRecoveryEffect.effectId,
          prisma,
        });
      if (persistedIntent?.providerCorrelated) {
        return { status: "already_completed" };
      }
      const incomingLineState = await readHostedLinqIncomingLineState({
        phoneNumberLookupKeys: createHostedPhoneLookupKeyReadCandidates(
          groupEmailRecoveryEffect.payload.assignedRecipientPhone,
        ),
        prisma,
      });
      if (incomingLineState.kind !== "assignable") {
        return { status: "target_unauthorized" };
      }
      // Private email recovery opens a brand-new conversation from the managed
      // line, so the first unresolved attempt claims the same per-line daily
      // new-conversation budget as every other proactive path. The chat lock
      // serializes this lookup with the delivery claim below; a retry that
      // already has a durable intent must reuse the original reservation rather
      // than burn another slot without opening another conversation.
      if (!persistedIntent) {
        const recoveryLine = await prisma.hostedLinqLine.findUnique({
          select: { maxNewConversationsPerDay: true },
          where: {
            phoneNumberLookupKey: incomingLineState.phoneNumberLookupKey,
          },
        });
        if (
          !recoveryLine
          || !await claimHostedLinqProactiveConversationCapacityTx({
            dayUtc: startOfUtcDay(new Date(input.startedAtMs)),
            limit: resolveHostedLinqSignupWelcomeDailyLimit(recoveryLine),
            phoneNumberLookupKey: incomingLineState.phoneNumberLookupKey,
            prisma,
            requiredHealthStatus: "healthy",
          })
        ) {
          return { status: "target_unauthorized" };
        }
        recoveryCapacityClaimed = true;
      }
    }

    const template = dispatchEffect.payload.template;
    const target = readHostedLinqSideEffectDeliveryTarget(dispatchEffect.payload);
    if (target.linqChatId) {
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: target.linqChatId,
        tx: prisma,
      });
      await assertHostedLinqSideEffectRouteAuthority(dispatchEffect, prisma);
    }
    const groupJoinOutreachId = isHostedLinqSignupMessageSideEffect(dispatchEffect)
      ? dispatchEffect.payload.groupJoinOutreachId?.trim() || null
      : null;
    const claim = await claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: new Date(input.startedAtMs),
      groupJoinOutreachId,
      groupJoinReplyOccurredAt: groupJoinOutreachId
        && isHostedLinqSignupMessageSideEffect(dispatchEffect)
          ? new Date(dispatchEffect.payload.occurredAt)
          : null,
      idempotencyKey: dispatchEffect.effectId,
      ...(target.linqChatId
        ? { linqChatId: target.linqChatId }
        : { phoneNumber: target.phoneNumber }),
      prisma,
      ...(signupEffect || groupLineRecoveryEffect || restartableSetupEffect
        ? { reclaimStalePreProviderAttempt: true }
        : {}),
      source: "hosted_webhook_side_effect",
      sourceRef: dispatchSourceRef,
      // The effect id is also the stable provider idempotency key and message
      // seed. Until provider correlation exists, a restart must be able to
      // reclaim this exact payload instead of stranding it as in-flight.
      status: signupEffect || groupLineRecoveryEffect || restartableSetupEffect
        ? "attempted"
        : "provider_dispatch_started",
      targetKind: target.targetKind,
      template,
    });
    if (recoveryCapacityClaimed && !claim.claimed) {
      throw new Error(
        "Hosted Linq recovery delivery conflicted after reserving line capacity.",
      );
    }
    if (claim.claimed) {
      return {
        effect: dispatchEffect,
        status: "claimed",
      };
    }
    if (claim.outcome === "completed") {
      return { status: "already_completed" };
    }
    if (claim.outcome === "incompatible") {
      return { status: "target_unauthorized" };
    }
    return {
      ...(claim.retryAt ? { retryAt: claim.retryAt } : {}),
      status: "in_flight",
    };
  });
}

async function resolveHostedLinqGroupLineRecoveryDispatchIntentTx(input: {
  effect: HostedLinqGroupLineRecoverySideEffect;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<
  | {
      capacityClaimed: boolean;
      effect: HostedLinqGroupLineRecoverySideEffect;
      sourceRef: string;
      status: "resolved";
    }
  | {
      status: "already_completed" | "target_unauthorized";
    }
> {
  const payload = input.effect.payload;
  await lockHostedMemberRow(input.prisma, payload.memberId);
  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: payload.memberId,
    prisma: input.prisma,
  });

  const access = await readHostedRuntimeAiAccessDecision({
    memberId: payload.memberId,
    now: input.now,
    prisma: input.prisma,
  });
  if (!access.allowed) {
    return { status: "target_unauthorized" };
  }

  const participantMemberId =
    await readHostedLinqGroupLineRecoveryParticipantMemberId({
      contact: payload.participantContact,
      prisma: input.prisma,
    });
  if (participantMemberId !== payload.memberId) {
    return { status: "target_unauthorized" };
  }

  const incomingLine = await readHostedLinqIncomingLineState({
    phoneNumberLookupKeys: createHostedPhoneLookupKeyReadCandidates(
      payload.incomingRecipientPhone,
    ),
    prisma: input.prisma,
  });
  if (incomingLine.kind !== "hard_blocked") {
    return { status: "target_unauthorized" };
  }

  const authority = readHostedLinqHomeLineAuthority(
    await readHostedMemberRoutingState({
      memberId: payload.memberId,
      prisma: input.prisma,
    }),
  );
  if (
    authority.kind === "none"
    || normalizePhoneNumber(authority.recipientPhone)
      !== normalizePhoneNumber(payload.incomingRecipientPhone)
  ) {
    return { status: "target_unauthorized" };
  }

  const sourceRef = buildHostedLinqGroupLineRecoverySourceRef({
    effectId: input.effect.effectId,
    sourceEventId: payload.sourceEventId,
  });
  const attemptEffectIds = Array.from(
    { length: HOSTED_LINQ_GROUP_LINE_RECOVERY_MAX_ATTEMPTS },
    (_, index) => buildHostedLinqGroupLineRecoveryAttemptEffectId({
      attempt: index + 1,
      effectId: input.effect.effectId,
    }),
  );
  const persistedIntents =
    await readHostedLinqDeliveryProviderDispatchIntentsTx({
      idempotencyKeys: attemptEffectIds,
      prisma: input.prisma,
    });
  const persistedIntentByLookupKey = new Map(
    persistedIntents.map((intent) => [
      intent.idempotencyLookupKey,
      intent,
    ]),
  );
  let attemptEffectId: string | null = null;
  let persistedIntent: (typeof persistedIntents)[number] | null = null;
  let dispatchSourceRef = sourceRef;
  let currentSourceAlreadyFailed = false;
  let failedSenderLastProviderEventId: string | null = null;
  let failedSenderLookupKey: string | null = null;
  for (const candidateEffectId of attemptEffectIds) {
    const candidateLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(candidateEffectId);
    const candidateIntent = candidateLookupKey
      ? persistedIntentByLookupKey.get(candidateLookupKey) ?? null
      : null;
    if (!candidateIntent) {
      if (currentSourceAlreadyFailed) {
        return { status: "target_unauthorized" };
      }
      attemptEffectId = candidateEffectId;
      break;
    }
    if (
      !isHostedLinqGroupLineRecoverySourceRefForSameIntent({
        candidate: candidateIntent.sourceRef,
        expected: sourceRef,
      })
      || candidateIntent.targetKind !== "participant"
      || candidateIntent.template !== HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
      || !candidateIntent.phoneNumberLookupKey
      || candidateIntent.phoneNumberLookupKey
        === incomingLine.phoneNumberLookupKey
    ) {
      return { status: "target_unauthorized" };
    }
    if (candidateIntent.providerCorrelated) {
      if (candidateIntent.status === "failed") {
        if (!candidateIntent.lastProviderEventId) {
          return { status: "target_unauthorized" };
        }
        if (
          failedSenderLookupKey
          && failedSenderLookupKey !== candidateIntent.phoneNumberLookupKey
        ) {
          return { status: "target_unauthorized" };
        }
        failedSenderLookupKey = candidateIntent.phoneNumberLookupKey;
        failedSenderLastProviderEventId = candidateIntent.lastProviderEventId;
        currentSourceAlreadyFailed ||= candidateIntent.sourceRef === sourceRef;
        continue;
      }
      return { status: "already_completed" };
    }
    attemptEffectId = candidateEffectId;
    persistedIntent = candidateIntent;
    dispatchSourceRef = candidateIntent.sourceRef ?? sourceRef;
    break;
  }
  if (!attemptEffectId) {
    return { status: "target_unauthorized" };
  }

  let assignedRecipientPhone: string | null = null;
  let capacityClaimed = false;
  if (persistedIntent) {
    assignedRecipientPhone = (
      await listHostedLinqHealthyProactiveLines({ prisma: input.prisma })
    ).find((line) =>
      line.phoneNumberLookupKey === persistedIntent.phoneNumberLookupKey
    )?.phoneNumber ?? null;
  } else if (failedSenderLookupKey && failedSenderLastProviderEventId) {
    assignedRecipientPhone = (
      await readHostedLinqReceiptCorrelatedRecoveryLineTx({
        expectedFailureReceiptEventId: failedSenderLastProviderEventId,
        phoneNumberLookupKey: failedSenderLookupKey,
        prisma: input.prisma,
      })
    )?.phoneNumber ?? null;
  } else {
    const reservation = await reserveHostedLinqHealthyProactiveLineTx({
      excludedPhoneNumberLookupKey: incomingLine.phoneNumberLookupKey,
      now: input.now,
      prisma: input.prisma,
    });
    if (
      reservation.kind === "reserved"
      && reservation.reservation.line.phoneNumberLookupKey
        !== incomingLine.phoneNumberLookupKey
    ) {
      assignedRecipientPhone = reservation.reservation.line.phoneNumber;
      capacityClaimed = reservation.reservation.proactiveConversationReserved;
    }
  }

  if (!assignedRecipientPhone) {
    return { status: "target_unauthorized" };
  }

  return {
    capacityClaimed,
    effect: {
      ...input.effect,
      effectId: attemptEffectId,
      payload: {
        ...payload,
        assignedRecipientPhone,
      },
    },
    sourceRef: dispatchSourceRef,
    status: "resolved",
  };
}

async function readHostedLinqGroupLineRecoveryParticipantMemberId(input: {
  contact: HostedLinqGroupLineRecoveryParticipantContact;
  prisma: Prisma.TransactionClient;
}): Promise<string | null> {
  try {
    const match = input.contact.kind === "phone"
      ? await lookupHostedMemberIdentityByPhoneNumber({
          phoneNumber: input.contact.value,
          prisma: input.prisma,
        })
      : await lookupHostedMemberByVerifiedEmailAddress({
          address: input.contact.value,
          prisma: input.prisma,
        });
    return match?.core.id ?? null;
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && (
        error.code === "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS"
        || error.code === "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS"
      )
    ) {
      return null;
    }
    throw error;
  }
}

async function resolveHostedLinqSignupDispatchIntentTx(input: {
  effect: HostedLinqSignupMessageSideEffect;
  persistedDeliveryId: string | null;
  persistedGroupJoinOutreachId: string | null;
  persistedGroupJoinReplyOccurredAt: Date | null;
  persistedIntentExists: boolean;
  persistedSourceRef: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<
  | {
      effect: HostedLinqSignupMessageSideEffect;
      sourceRef: string;
      status: "resolved";
    }
  | {
      status: "target_unauthorized";
    }
> {
  const currentSourceRef = input.effect.effectId;
  if (
    input.persistedIntentExists
    && input.persistedSourceRef !== currentSourceRef
  ) {
    return { status: "target_unauthorized" };
  }

  const persistedOutreachId =
    input.persistedGroupJoinOutreachId?.trim() ?? "";
  if (
    input.persistedIntentExists
    && Boolean(persistedOutreachId)
      !== Boolean(input.persistedGroupJoinReplyOccurredAt)
  ) {
    return { status: "target_unauthorized" };
  }

  const payload = input.effect.payload;
  const outreachId = input.persistedIntentExists
    ? persistedOutreachId
    : payload.groupJoinOutreachId?.trim() ?? "";
  if (!outreachId) {
    return {
      effect: {
        ...input.effect,
        payload: {
          ...payload,
          groupJoinCode: undefined,
          groupJoinOutreachId: undefined,
        },
      },
      sourceRef: currentSourceRef,
      status: "resolved",
    };
  }

  const replyOccurredAt = input.persistedIntentExists
    ? input.persistedGroupJoinReplyOccurredAt
    : new Date(payload.occurredAt);
  if (!replyOccurredAt || Number.isNaN(replyOccurredAt.getTime())) {
    return { status: "target_unauthorized" };
  }

  const originalContext =
    await readHostedGroupJoinOutreachReplyDeliveryContextTx({
      excludeSignupDeliveryId: input.persistedDeliveryId,
      memberId: payload.memberId,
      outreachId,
      tx: input.prisma,
    });
  if (originalContext?.kind === "already_member") {
    if (!input.persistedIntentExists) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_JOIN_MEMBERSHIP_CHANGED",
        httpStatus: 503,
        message:
          "Group membership changed while the reply was being prepared. Retry the inbound message against current membership.",
        retryable: true,
      });
    }
    return {
      effect: {
        ...input.effect,
        payload: {
          ...payload,
          groupJoinCode: originalContext.joinCode,
          groupJoinOutreachId: outreachId,
          occurredAt: replyOccurredAt.toISOString(),
        },
      },
      sourceRef: currentSourceRef,
      status: "resolved",
    };
  }
  if (!originalContext) {
    return { status: "target_unauthorized" };
  }

  return {
    effect: {
      ...input.effect,
      payload: {
        ...payload,
        groupJoinCode: originalContext.joinCode,
        groupJoinOutreachId: outreachId,
        occurredAt: replyOccurredAt.toISOString(),
      },
    },
    sourceRef: currentSourceRef,
    status: "resolved",
  };
}

function isHostedLinqSignupMessageSideEffect(
  effect: HostedLinqMessageSideEffect,
): effect is HostedLinqSignupMessageSideEffect {
  return effect.payload.template === "invite_signup"
    || effect.payload.template === "invite_signup_fallback";
}

function isHostedLinqGroupLineRecoverySideEffect(
  effect: HostedLinqMessageSideEffect,
): effect is HostedLinqGroupLineRecoverySideEffect {
  return effect.payload.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE;
}

function isHostedLinqGroupEmailRecoverySideEffect(
  effect: HostedLinqMessageSideEffect,
): effect is HostedLinqGroupEmailRecoverySideEffect {
  return effect.payload.template
    === HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE;
}

function isHostedLinqPrivateRecoveryTemplate(
  template: HostedLinqMessagePayload["template"],
): boolean {
  return template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
    || template === HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE;
}

async function markHostedLinqDeliveryAcceptedBestEffort(input: {
  chatId: string | null;
  effect: HostedLinqMessageSideEffect;
  messageId: string | null;
  messageIds?: readonly string[];
  prisma: HostedLinqTransportPersistenceClient;
  replayingRichLinkPartial?: boolean;
  throwOnError?: boolean;
}): Promise<void> {
  const template = input.effect.payload.template;
  try {
    // A terminal receipt can beat this milestone write (it only just learned
    // the provider message id); the milestone replays that receipt and this
    // applies the same daily-state consequence as live receipt ingestion.
    // Milestone and consequence commit atomically. Group reply availability is
    // derived from live delivery rows; the shared member/day suppression clears
    // only after the final live signup delivery fails.
    const milestone = await runHostedLinqTransportTransaction(input.prisma, async (prisma) => {
      const milestone = await markHostedLinqDeliveryAcceptedTx({
        idempotencyKey: input.effect.effectId,
        linqChatId: input.chatId,
        messageId: input.messageId,
        ...(input.messageIds ? { messageIds: input.messageIds } : {}),
        prisma,
        ...(input.replayingRichLinkPartial
          ? { replayingRichLinkPartial: true }
          : {}),
      });
      if (milestone.reopenOnboardingLink) {
        const groupJoinReplyContext =
          milestone.reopenOnboardingLink.groupJoinReplyContext;
        if (
          !groupJoinReplyContext
          || milestone.reopenOnboardingLink.releaseDailySuppression === true
        ) {
          await releaseHostedLinqOnboardingLinkNoticeClaim({
            memberId: milestone.reopenOnboardingLink.memberId,
            occurredAt: milestone.reopenOnboardingLink.occurredAt,
            prisma,
          });
        }
      }
      const payload = input.effect.payload;
      if (
        (
          milestone.deliveryStatus === "accepted"
          || milestone.deliveryStatus === "delivered"
        )
        &&
        (
          payload.template === "invite_signup"
          || payload.template === "invite_signup_fallback"
        )
      ) {
        await markHostedLinqOnboardingLinkNoticeSent({
          memberId: payload.memberId,
          occurredAt: payload.occurredAt,
          prisma,
        });
      }
      return milestone;
    });
    if (milestone.restoreOnboardingLink) {
      // A rare delivered-before-accepted race can let receipt ingestion and
      // this milestone commit without cross-observing the other's uncommitted
      // write, omitting this best-effort card. The signup reply still lands and
      // Murph remains available in the web picker; that accepted limitation
      // does not warrant an advisory lock or a new durable obligation.
      await queueHostedLinqContactCardShareAfterDeliveredInviteSignup({
        chatId: milestone.restoreOnboardingLink.linqChatId,
        memberId: milestone.restoreOnboardingLink.memberId,
        prisma: input.prisma,
        service: milestone.restoreOnboardingLink.service,
      });
    }
  } catch (error) {
    console.warn("Hosted Linq delivery accepted recording failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      template,
    });
    if (input.throwOnError === true) {
      throw error;
    }
  }
}

async function runHostedLinqTransportTransaction<TResult>(
  prisma: HostedLinqTransportPersistenceClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return isHostedLinqTransportRootClient(prisma)
    ? prisma.$transaction(callback)
    : callback(prisma);
}

function isHostedLinqTransportRootClient(
  prisma: HostedLinqTransportPersistenceClient,
): prisma is PrismaClient {
  return "$transaction" in prisma;
}

async function markHostedLinqDeliveryFailedBestEffort(input: {
  effect: HostedLinqMessageSideEffect;
  error: unknown;
  expectedAttemptedAt?: Date;
  prisma: HostedLinqTransportPersistenceClient;
}): Promise<void> {
  try {
    const errorRecord = readErrorRecord(input.error);
    const partialDelivery =
      readHostedLinqRichLinkPartialDeliveryFailure(input.error);
    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: input.expectedAttemptedAt,
      failureCode: readHostedLinqSideEffectString(errorRecord, "code"),
      // This path can carry provider prose. Recovery deliveries retain only a
      // bounded code so participant or provider text cannot enter durable state.
      failureReason:
        isHostedLinqPrivateRecoveryTemplate(input.effect.payload.template)
          ? null
          : input.error instanceof Error
            ? input.error.message
            : null,
      idempotencyKey: input.effect.effectId,
      ...(partialDelivery
        ? {
            linqChatId: partialDelivery.linqChatId,
            messageIds: partialDelivery.messageIds,
          }
        : {}),
      prisma: input.prisma,
    });
  } catch {
    // Preserve the original delivery error. This telemetry update is non-critical.
  }
}

function readHostedLinqRichLinkPartialDeliveryFailure(
  error: unknown,
): {
  failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY";
  linqChatId: string | null;
  messageIds: string[];
} | null {
  const errorRecord = readErrorRecord(error);
  if (
    readHostedLinqSideEffectString(errorRecord, "code")
    !== "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY"
  ) {
    return null;
  }
  return {
    failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
    linqChatId: readHostedLinqSideEffectString(
      errorRecord,
      "providerThreadId",
    ),
    messageIds: readHostedLinqPartialDeliveryMessageIds(error),
  };
}

function readHostedLinqPartialDeliveryMessageIds(error: unknown): string[] {
  const errorRecord = readErrorRecord(error);
  const values = errorRecord?.providerMessageIds;
  if (!Array.isArray(values)) {
    return [];
  }
  const output: string[] = [];
  for (const value of values) {
    const messageId = typeof value === "string" ? value.trim() : "";
    if (messageId && !output.includes(messageId)) {
      output.push(messageId);
    }
  }
  return output;
}

function buildHostedLinqSideEffectLogDetails(
  effect: HostedLinqMessageSideEffect,
  error: unknown,
  elapsedMs: number,
): Record<string, boolean | number | string> {
  const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const nestedDetails = errorRecord?.details && typeof errorRecord.details === "object"
    ? errorRecord.details as Record<string, unknown>
    : null;
  const includeProviderErrorText =
    !isHostedLinqPrivateRecoveryTemplate(effect.payload.template);

  return {
    elapsedMs: Math.max(0, elapsedMs),
    effectIdSuffix: toHostedOnboardingLogIdSuffix(effect.effectId) ?? "unknown",
    hasIdempotencyKey: true,
    hasReplyToMessageId: typeof effect.payload.replyToMessageId === "string"
      && effect.payload.replyToMessageId.trim().length > 0,
    operation: "send_message",
    provider: "linq",
    retryable: readHostedLinqSideEffectRetryable(error),
    ...buildHostedLinqSideEffectTraceLogDetails(effect),
    template: effect.payload.template,
    ...sanitizeHostedOnboardingStructuredLogDetails({
      errorCode: readHostedLinqSideEffectString(errorRecord, "code"),
      ...(includeProviderErrorText
        ? {
            errorMessage:
              error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : null,
          }
        : {}),
      errorName: error instanceof Error ? error.name : null,
      ...(includeProviderErrorText ? nestedDetails ?? {} : {}),
    }),
  };
}

function buildHostedLinqSideEffectTraceLogDetails(
  effect: HostedLinqMessageSideEffect,
): Record<string, string> {
  if (effect.payload.template !== "ai_usage_quota") {
    return {};
  }

  return {
    sourceEventIdSuffix:
      toHostedOnboardingLogIdSuffix(effect.payload.sourceEventId) ?? "unknown",
  };
}

function readHostedLinqSideEffectRetryable(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "retryable" in error
      && typeof error.retryable === "boolean"
      && error.retryable,
  );
}

function readHostedLinqSideEffectString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  return record && typeof record[key] === "string"
    ? record[key] as string
    : null;
}

function readHostedLinqSideEffectChatId(
  payload: HostedLinqMessagePayload,
): string | null {
  return typeof payload.chatId === "string" ? payload.chatId : null;
}

function readErrorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object" ? error as Record<string, unknown> : null;
}

async function buildHostedLinqSideEffectMessage(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<string> {
  switch (effect.payload.template) {
    case HOSTED_LINQ_GROUP_SETUP_TEMPLATE:
      return buildHostedLinqGroupSetupMessage({ seed: effect.effectId });
    case HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE:
      return buildHostedLinqGroupEmailRecoveryMessage({
        recoveryToken: effect.payload.recoveryToken,
      });
    case "ai_usage_quota":
      return effect.payload.message;
    case "daily_quota":
      return buildHostedDailyQuotaReply({
        ...(effect.payload.dailyTextLimit === undefined
          ? {}
          : { dailyTextLimit: effect.payload.dailyTextLimit }),
        seed: effect.effectId,
      });
    case "family_invite_reply":
      return effect.payload.message;
    case HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE:
      if (!effect.payload.assignedRecipientPhone) {
        throw new TypeError(
          "Hosted Linq group-line recovery requires a resolved backup sender.",
        );
      }
      return buildHostedLinqGroupLineRecoveryMessage({
        backupPhoneNumber: effect.payload.assignedRecipientPhone,
        seed: readHostedLinqGroupLineRecoveryInstructionSeed(effect.effectId),
      });
    case "conversation_home_redirect": {
      const homeRecipientPhone = normalizePhoneNumber(effect.payload.homeRecipientPhone);

      if (!homeRecipientPhone) {
        throw hostedOnboardingError({
          code: "LINQ_HOME_PHONE_REQUIRED",
          message: `Hosted webhook side effect ${effect.effectId} requires a valid home recipient phone.`,
          httpStatus: 500,
          retryable: false,
        });
      }

      return buildHostedLinqConversationHomeRedirectReply({
        homeRecipientPhone,
        seed: effect.effectId,
      });
    }
    case "invite_signup":
    case "invite_signup_fallback":
    case "invite_signin":
      return buildHostedInviteSideEffectMessage({
        effectId: effect.effectId,
        payload: effect.payload,
        prisma,
      });
  }
}

async function buildHostedInviteSideEffectMessage(input: {
  effectId: string;
  payload: HostedLinqInviteMessagePayload;
  prisma: HostedLinqTransportPersistenceClient;
}): Promise<string> {
  const inviteLookup =
    "findUnique" in input.prisma.hostedInvite && typeof input.prisma.hostedInvite.findUnique === "function"
      ? input.prisma.hostedInvite.findUnique({
          where: {
            id: input.payload.inviteId,
          },
          select: {
            inviteCode: true,
          },
        })
      : input.prisma.hostedInvite.findFirst({
          where: {
            id: input.payload.inviteId,
          },
          select: {
            inviteCode: true,
          },
        });
  const invite = await inviteLookup;

  if (!invite) {
    throw hostedOnboardingError({
      code: "HOSTED_INVITE_NOT_FOUND",
      message: `Hosted invite ${
        toHostedOnboardingLogIdSuffix(input.payload.inviteId) ?? "unknown"
      } was not found for webhook side effect ${
        toHostedOnboardingLogIdSuffix(input.effectId) ?? "unknown"
      }.`,
      httpStatus: 500,
      retryable: false,
    });
  }

  return buildHostedInviteReply({
    joinUrl: buildHostedGroupAwareInviteUrl({
      groupJoinCode: "groupJoinCode" in input.payload
        ? input.payload.groupJoinCode
        : null,
      inviteCode: invite.inviteCode,
    }),
    seed: input.effectId,
  });
}

function isHostedInviteLinqMessagePayload(
  payload: HostedLinqMessagePayload,
): payload is HostedLinqInviteMessagePayload {
  return (
    payload.template === "invite_signup"
    || payload.template === "invite_signup_fallback"
    || payload.template === "invite_signin"
  );
}

function isHostedLinqCreateChatSideEffectPayload(
  payload: HostedLinqMessagePayload,
): payload is
  | HostedLinqGroupEmailRecoveryMessagePayload
  | HostedLinqGroupLineRecoveryMessagePayload
  | HostedLinqInviteSignupFallbackMessagePayload {
  return payload.template === "invite_signup_fallback"
    || payload.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
    || payload.template === HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE;
}

async function markHostedInviteSentBestEffort(
  inviteId: string,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<void> {
  try {
    await prisma.hostedInvite.update({
      where: {
        id: inviteId,
      },
      data: {
        sentAt: new Date(),
      },
    });
  } catch (error) {
    console.error(
      "Hosted invite sentAt update failed.",
      sanitizeHostedOnboardingLogString(
        error instanceof Error ? error.message : String(error),
      ) ?? "Unknown error.",
    );
  }
}

function buildHostedWebhookLinqMessagePayload(
  input: CreateHostedWebhookLinqMessageSideEffectInput,
  replyToMessageId: string | null,
): HostedLinqMessagePayload {
  switch (input.template) {
    case HOSTED_LINQ_GROUP_SETUP_TEMPLATE:
      return {
        chatId: input.chatId,
        occurredAt: input.occurredAt,
        replyToMessageId,
        sourceEventId: input.sourceEventId,
        template: input.template,
      };
    case HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE:
      return {
        assignedRecipientPhone: input.assignedRecipientPhone,
        chatId: null,
        occurredAt: input.occurredAt,
        participantContact: input.participantContact,
        recoveryToken: input.recoveryToken,
        replyToMessageId: null,
        sourceEventId: input.sourceEventId,
        template: input.template,
        threadId: input.threadId,
      };
    case "ai_usage_quota":
      return buildHostedLinqAiUsageQuotaPayload(input, replyToMessageId);
    case "conversation_home_redirect":
      return {
        chatId: input.chatId,
        homeRecipientPhone: input.homeRecipientPhone,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId,
        template: input.template,
      };
    case "daily_quota":
      return {
        chatId: input.chatId,
        dailyTextLimit: input.dailyTextLimit,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        template: input.template,
      };
    case "family_invite_reply":
      return {
        chatId: input.chatId,
        memberId: input.memberId,
        message: input.message,
        occurredAt: input.occurredAt,
        replyToMessageId,
        sourceEventId: input.sourceEventId,
        template: input.template,
      };
    case "invite_signup":
      return {
        chatId: input.chatId,
        ...(input.groupJoinCode
          ? { groupJoinCode: input.groupJoinCode }
          : {}),
        ...(input.groupJoinOutreachId
          ? { groupJoinOutreachId: input.groupJoinOutreachId }
          : {}),
        inviteId: input.inviteId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId,
        ...(input.service === undefined ? {} : { service: input.service }),
        sourceEventId: input.sourceEventId,
        ...(input.threadIsDirect === undefined ? {} : { threadIsDirect: input.threadIsDirect }),
        template: input.template,
      };
    case "invite_signup_fallback":
      return {
        assignedRecipientPhone: input.assignedRecipientPhone,
        chatId: null,
        ...(input.groupJoinCode
          ? { groupJoinCode: input.groupJoinCode }
          : {}),
        ...(input.groupJoinOutreachId
          ? { groupJoinOutreachId: input.groupJoinOutreachId }
          : {}),
        inviteId: input.inviteId,
        memberId: input.memberId,
        memberPhone: input.memberPhone,
        occurredAt: input.occurredAt,
        replyToMessageId: null,
        sourceEventId: input.sourceEventId,
        template: input.template,
      };
    case HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE:
      return {
        assignedRecipientPhone: null,
        chatId: null,
        incomingRecipientPhone: input.incomingRecipientPhone,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        participantContact: input.participantContact,
        replyToMessageId: null,
        sourceEventId: input.sourceEventId,
        template: input.template,
        threadId: input.threadId,
      };
  }
}

function buildHostedLinqAiUsageQuotaPayload(
  input: Extract<CreateHostedWebhookLinqMessageSideEffectInput, { template: "ai_usage_quota" }>,
  replyToMessageId: string | null,
): HostedLinqAiUsageQuotaPayload {
  const basePayload = {
    chatId: input.chatId,
    memberId: input.memberId,
    message: input.message,
    occurredAt: input.occurredAt,
    replyToMessageId,
    ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
    sourceEventId: input.sourceEventId,
    template: input.template,
  };

  if (isHostedRuntimeAiAccessNoticeCode(input.noticeCode)) {
    if (input.claimToken) {
      throw new TypeError(
        "Hosted Linq access notices must not include AI usage claim metadata.",
      );
    }
    return {
      ...basePayload,
      claimToken: null,
      noticeCode: input.noticeCode,
    };
  }

  if (!input.claimToken) {
    throw new TypeError(
      "Hosted Linq AI usage-limit notices require AI usage claim metadata.",
    );
  }

  return {
    ...basePayload,
    claimToken: input.claimToken,
    noticeCode: input.noticeCode,
  };
}

async function claimHostedLinqNoticeForSideEffect(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<boolean> {
  switch (effect.payload.template) {
    case HOSTED_LINQ_GROUP_SETUP_TEMPLATE:
    case HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE:
    case "invite_signup_fallback":
    case "invite_signup":
      return true;
    case "invite_signin":
      return true;
    case HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE:
      return true;
    case "ai_usage_quota":
      return true;
    case "daily_quota":
      return claimHostedLinqQuotaReplyNotice({
        memberId: effect.payload.memberId,
        occurredAt: effect.payload.occurredAt,
        prisma,
      });
    case "conversation_home_redirect":
    case "family_invite_reply":
      return true;
  }
}

function requireHostedLinqTransportPrismaClient(
  prisma: HostedLinqTransportPersistenceClient,
): PrismaClient {
  if (!isHostedLinqTransportPrismaClient(prisma)) {
    throw new TypeError(
      "Hosted AI usage-limit notice dispatch must run outside an existing transaction.",
    );
  }
  return prisma;
}

function isHostedLinqTransportPrismaClient(
  prisma: HostedLinqTransportPersistenceClient,
): prisma is PrismaClient {
  return "$transaction" in prisma;
}

async function releaseHostedLinqNoticeClaimForSideEffect(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<void> {
  try {
    switch (effect.payload.template) {
      case HOSTED_LINQ_GROUP_SETUP_TEMPLATE:
      case HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE:
        return;
      case "invite_signup_fallback":
        if (effect.payload.groupJoinOutreachId?.trim()) {
          return;
        }
        await releaseHostedLinqOnboardingLinkNoticeClaim({
          memberId: effect.payload.memberId,
          occurredAt: effect.payload.occurredAt,
          prisma,
        });
        return;
      case "invite_signup":
        return;
      case "daily_quota":
        await releaseHostedLinqQuotaReplyNoticeClaim({
          memberId: effect.payload.memberId,
          occurredAt: effect.payload.occurredAt,
          prisma,
        });
        return;
      case "ai_usage_quota":
        return;
      case HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE:
        return;
      case "invite_signin":
      case "conversation_home_redirect":
      case "family_invite_reply":
        return;
    }
  } catch (error) {
    console.error(
      "Hosted Linq side-effect notice claim release failed.",
      buildHostedLinqSideEffectLogDetails(effect, error, 0),
    );
  }
}

async function markHostedLinqNoticeSentForSideEffect(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<void> {
  if (
    effect.payload.template !== "invite_signup"
    && effect.payload.template !== "invite_signup_fallback"
  ) {
    return;
  }
  await markHostedLinqOnboardingLinkNoticeSent({
    memberId: effect.payload.memberId,
    occurredAt: effect.payload.occurredAt,
    prisma,
  });
}
