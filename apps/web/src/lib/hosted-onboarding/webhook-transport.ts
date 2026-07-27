import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import {
  type HostedAiUsageGateNoticeCode,
} from "../hosted-execution/usage-allowance";
import { LINQ_API_DEFAULT_TIMEOUT_MS } from "../linq/api";
import { sha256Hex } from "../primitives";
import { hostedOnboardingError } from "./errors";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  readHostedLinqDeliveryProviderDispatchIntentTx,
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
  type HostedRuntimeAiAccessNoticeCode,
} from "./member-access";
import { sanitizeHostedOnboardingLogString } from "./http";
import { buildHostedGroupAwareInviteUrl } from "../hosted-groups/group-join-invite-link";
import { normalizePhoneNumber } from "./phone";
import {
  buildHostedLinqInviteSignupDeliverySourceRef,
  buildHostedLinqInviteSignupEffectId,
  parseHostedLinqInviteSignupDeliverySourceRef,
} from "./linq-invite-signup-effect-id";
import {
  claimHostedLinqQuotaReplyNotice,
  markHostedLinqOnboardingLinkNoticeSent,
  releaseHostedLinqOnboardingLinkNoticeClaim,
  releaseHostedLinqQuotaReplyNoticeClaim,
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
  isHostedGroupJoinOutreachReplyDeliveryAuthorizedTx,
  readHostedGroupJoinOutreachReplyDeliveryContextTx,
} from "../hosted-groups/group-join-outreach-store";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { lockHostedMemberRow } from "./shared";

type HostedLinqTransportPersistenceClient = PrismaClient | Prisma.TransactionClient;
type HostedLinqTransportPostResponseScheduler = (task: () => Promise<void>) => void;

export type HostedLinqConversationHomeRedirectPayload = {
  chatId: string;
  homeRecipientPhone: string;
  memberId: string;
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
  sentAt: string;
  usageCreditLedgerVersion: string;
};

type HostedLinqPersistedAiUsageQuotaClaimToken =
  Omit<HostedLinqAiUsageQuotaClaimToken, "usageCreditLedgerVersion"> & {
    usageCreditLedgerVersion?: string;
  };

type HostedLinqUsageLimitNoticeCode = Exclude<
  HostedAiUsageGateNoticeCode,
  "trial_conversion_pending"
>;

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

  if (input.template === "ai_usage_quota" && input.claimToken) {
    return buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: input.memberId,
      periodStart: input.claimToken.periodStart,
      usageCreditLedgerVersion: parseHostedAiUsageCreditLedgerVersion(
        input.claimToken.usageCreditLedgerVersion,
      ),
    });
  }

  if (input.template === "conversation_home_redirect") {
    return buildHostedLinqConversationHomeRedirectEffectId(input);
  }

  return `linq-message:${input.sourceEventId}`;
}

// One redirect per wrong Linq chat + home line + member. If the member's home
// line changes later, the new target hashes differently and is announced once.
// Hashes normalized raw inputs directly; the contact-privacy lookup keys are
// not stable across keyring rotation and would let a rotation re-send a duplicate.
function buildHostedLinqConversationHomeRedirectEffectId(
  input: Extract<
    CreateHostedWebhookLinqMessageSideEffectInput,
    { template: "conversation_home_redirect" }
  >,
): string {
  const chatId = input.chatId.trim();
  const homeRecipientPhone = normalizePhoneNumber(input.homeRecipientPhone);
  const memberId = input.memberId.trim();

  if (!chatId || !homeRecipientPhone || !memberId) {
    return `linq-message:${input.sourceEventId}`;
  }

  const hash = sha256Hex(JSON.stringify({
    chatId,
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

type HostedLinqProviderFenceState = {
  providerRequestCompleted: boolean;
  providerRequestStarted: boolean;
  startedAtMs: number;
};

const HOSTED_GROUP_JOIN_PROVIDER_FENCE_LOCK_TIMEOUT_MS = 1_500;
const HOSTED_GROUP_JOIN_PROVIDER_FENCE_COMMIT_MARGIN_MS = 2_000;
const HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  // The provider body remains inside its ten-second request timeout. Provider
  // entry is refused unless that full timeout and the commit margin remain.
  timeout: 15_000,
} as const;

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
      completeProviderOutcomeBeforeReturn: false,
    });
  }

  const run = async (
    prisma: Prisma.TransactionClient,
  ): Promise<
    | { result: HostedLinqSideEffectDrainResult; status: "completed" }
    | { error: unknown; status: "failed" }
  > => {
    const providerFenceState: HostedLinqProviderFenceState = {
      providerRequestCompleted: false,
      providerRequestStarted: false,
      startedAtMs: performance.now(),
    };
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
    providerFenceState?: HostedLinqProviderFenceState;
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
  return Boolean(
    persistedIntent?.groupJoinOutreachId
    || parseHostedLinqInviteSignupDeliverySourceRef(
      persistedIntent?.sourceRef ?? null,
    )?.groupJoinReplyContext,
  );
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
      dispatchEffect = {
        ...effect,
        effectId: exactSourceEffectId,
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
    providerFenceState?: HostedLinqProviderFenceState;
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

    if (deliveryEffect.payload.template === "invite_signup_fallback") {
      const message = await buildHostedLinqSideEffectMessage(
        deliveryEffect,
        options.prisma,
      );
      beginHostedGroupJoinProviderRequest(options.providerFenceState);
      const result = await createHostedLinqChat({
        from: deliveryEffect.payload.assignedRecipientPhone,
        idempotencyKey: deliveryEffect.effectId,
        message,
        signal: options.signal,
        to: [deliveryEffect.payload.memberPhone],
      });
      if (options.providerFenceState) {
        options.providerFenceState.providerRequestCompleted = true;
      }

      const acceptedMilestone = () => markHostedLinqDeliveryAcceptedBestEffort({
        chatId: result.chatId,
        effect: deliveryEffect,
        messageId: result.messageId,
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
    if (options.providerFenceState) {
      options.providerFenceState.providerRequestCompleted = true;
    }
    const acceptedMilestone = () => markHostedLinqDeliveryAcceptedBestEffort({
      chatId: result.chatId ?? deliveryChatId,
      effect: deliveryEffect,
      messageId: result.messageId,
      prisma: options.prisma,
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
      effect.payload.template === "invite_signup"
      || effect.payload.template === "invite_signup_fallback"
    ) {
      await deliveryAttemptTask;
      if (
        (
          !options.providerFenceState
          || options.providerFenceState.providerRequestStarted
        )
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
        await markHostedLinqDeliverySendFailedTx({
          expectedAttemptedAt: new Date(usageLimitPayload.claimToken.sentAt),
          failureCode: "linq_usage_limit_dispatch_retryable",
          idempotencyKey: deliveryEffect.effectId,
          prisma: options.prisma,
        });
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
 * A fallback signup link targets a participant on the assigned line (its chat
 * does not exist yet); every other side effect targets an existing thread.
 * This is the one interpretation of a payload's delivery target, shared by
 * attempt recording and dispatch claiming so the shapes cannot drift.
 */
function readHostedLinqSideEffectDeliveryTarget(payload: HostedLinqMessagePayload): {
  linqChatId: string | null;
  phoneNumber?: string;
  targetKind: "participant" | "thread";
} {
  return payload.template === "invite_signup_fallback"
    ? {
        linqChatId: null,
        phoneNumber: payload.assignedRecipientPhone,
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
  providerFenceState?: HostedLinqProviderFenceState;
  startedAtMs: number;
}): Promise<HostedLinqProviderDispatchPreparation> {
  const signupEffect = isHostedLinqSignupMessageSideEffect(input.effect)
    ? input.effect
    : null;

  return await runHostedLinqTransportTransaction(input.prisma, async (prisma) => {
    let dispatchEffect = input.effect;
    let dispatchSourceRef = buildHostedLinqSideEffectDeliverySourceRef(
      input.effect,
    );
    let dispatchGroupJoinOutreachId: string | null = null;
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
        persistedSourceRef: persistedIntent?.sourceRef ?? null,
        persistedIntentExists: persistedIntent !== null,
        prisma,
      });
      if (recoveredIntent.status !== "resolved") {
        return { status: recoveredIntent.status };
      }
      const signupDispatchEffect = recoveredIntent.effect;
      dispatchEffect = signupDispatchEffect;
      dispatchSourceRef = recoveredIntent.sourceRef;

      const groupJoinOutreachId =
        signupDispatchEffect.payload.groupJoinOutreachId?.trim() ?? "";
      if (groupJoinOutreachId) {
        const groupJoinCode =
          signupDispatchEffect.payload.groupJoinCode?.trim() ?? "";
        if (
          !groupJoinCode
          || !await isHostedGroupJoinOutreachReplyDeliveryAuthorizedTx({
            groupJoinCode,
            outreachId: groupJoinOutreachId,
            tx: prisma,
          })
        ) {
          return { status: "target_unauthorized" };
        }
        dispatchGroupJoinOutreachId = groupJoinOutreachId;
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
    const claim = await claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: new Date(input.startedAtMs),
      ...(dispatchGroupJoinOutreachId
        ? { groupJoinOutreachId: dispatchGroupJoinOutreachId }
        : {}),
      idempotencyKey: dispatchEffect.effectId,
      ...(target.linqChatId
        ? { linqChatId: target.linqChatId }
        : { phoneNumber: target.phoneNumber }),
      prisma,
      ...(signupEffect
        ? { reclaimStalePreProviderAttempt: true }
        : {}),
      source: "hosted_webhook_side_effect",
      sourceRef: dispatchSourceRef,
      // The effect id is also the stable provider idempotency key and message
      // seed. Until provider correlation exists, a restart must be able to
      // reclaim this exact payload instead of stranding it as in-flight.
      status: signupEffect ? "attempted" : "provider_dispatch_started",
      targetKind: target.targetKind,
      template,
    });
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

function beginHostedGroupJoinProviderRequest(
  providerFenceState: HostedLinqProviderFenceState | undefined,
): void {
  if (!providerFenceState) {
    return;
  }
  const elapsedMs = performance.now() - providerFenceState.startedAtMs;
  const requiredRemainingMs =
    LINQ_API_DEFAULT_TIMEOUT_MS
    + HOSTED_GROUP_JOIN_PROVIDER_FENCE_COMMIT_MARGIN_MS;
  const remainingMs =
    HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS.timeout
    - elapsedMs;
  if (remainingMs < requiredRemainingMs) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_PROVIDER_FENCE_BUDGET_EXHAUSTED",
      httpStatus: 503,
      message: "Hosted Linq provider fence budget was exhausted before dispatch.",
      retryable: true,
    });
  }
  providerFenceState.providerRequestStarted = true;
}

async function resolveHostedLinqSignupDispatchIntentTx(input: {
  effect: HostedLinqSignupMessageSideEffect;
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
  const currentSourceRef = buildHostedLinqSideEffectDeliverySourceRef(
    input.effect,
  );
  if (
    !input.persistedIntentExists
    || input.persistedSourceRef === currentSourceRef
  ) {
    return {
      effect: input.effect,
      sourceRef: currentSourceRef,
      status: "resolved",
    };
  }

  const payload = input.effect.payload;
  const persistedSource = parseHostedLinqInviteSignupDeliverySourceRef(
    input.persistedSourceRef,
  );
  if (
    persistedSource?.effectId !== input.effect.effectId
  ) {
    return { status: "target_unauthorized" };
  }

  if (!persistedSource.groupJoinReplyContext) {
    return {
      effect: {
        ...input.effect,
        payload: {
          ...payload,
          groupJoinCode: undefined,
          groupJoinOutreachId: undefined,
        },
      },
      sourceRef: input.persistedSourceRef ?? currentSourceRef,
      status: "resolved",
    };
  }

  const originalContext =
    await readHostedGroupJoinOutreachReplyDeliveryContextTx({
      outreachId: persistedSource.groupJoinReplyContext.outreachId,
      tx: input.prisma,
    });
  if (!originalContext) {
    return { status: "target_unauthorized" };
  }

  return {
    effect: {
      ...input.effect,
      payload: {
        ...payload,
        groupJoinCode: originalContext.joinCode,
        groupJoinOutreachId:
          persistedSource.groupJoinReplyContext.outreachId,
        occurredAt: persistedSource.groupJoinReplyContext.repliedAt,
      },
    },
    sourceRef: input.persistedSourceRef ?? currentSourceRef,
    status: "resolved",
  };
}

function isHostedLinqSignupMessageSideEffect(
  effect: HostedLinqMessageSideEffect,
): effect is HostedLinqSignupMessageSideEffect {
  return effect.payload.template === "invite_signup"
    || effect.payload.template === "invite_signup_fallback";
}

async function markHostedLinqDeliveryAcceptedBestEffort(input: {
  chatId: string | null;
  effect: HostedLinqMessageSideEffect;
  messageId: string | null;
  prisma: HostedLinqTransportPersistenceClient;
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
        prisma,
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

function buildHostedLinqSideEffectDeliverySourceRef(
  effect: HostedLinqMessageSideEffect,
): string {
  const payload = effect.payload;
  if (
    payload.template === "invite_signup"
    || payload.template === "invite_signup_fallback"
  ) {
    return buildHostedLinqInviteSignupDeliverySourceRef({
      effectId: effect.effectId,
      groupJoinOutreachId: payload.groupJoinOutreachId,
      groupJoinRepliedAt: payload.occurredAt,
    });
  }
  return effect.effectId;
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
    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: input.expectedAttemptedAt,
      failureCode: readHostedLinqSideEffectString(readErrorRecord(input.error), "code"),
      failureReason: input.error instanceof Error ? input.error.message : null,
      idempotencyKey: input.effect.effectId,
      prisma: input.prisma,
    });
  } catch {
    // Preserve the original delivery error. This telemetry update is non-critical.
  }
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
      errorMessage:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : null,
      errorName: error instanceof Error ? error.name : null,
      ...(nestedDetails ?? {}),
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
    case "ai_usage_quota":
      return buildHostedLinqAiUsageQuotaPayload(input, replyToMessageId);
    case "conversation_home_redirect":
      return {
        chatId: input.chatId,
        homeRecipientPhone: input.homeRecipientPhone,
        memberId: input.memberId,
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
    case "invite_signup_fallback":
    case "invite_signup":
      return true;
    case "invite_signin":
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
