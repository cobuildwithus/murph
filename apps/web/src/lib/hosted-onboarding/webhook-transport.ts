import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import {
  buildHostedAiUsageGateLegacyNoticeIdempotencyKeys,
  buildHostedAiUsageGateNoticeIdempotencyKey,
  hasFreshHostedAiUsageLimitNoticeClaim,
  markHostedAiUsageLimitNoticeSent,
  type HostedAiUsageGateNoticeCode,
} from "../hosted-execution/usage-allowance";
import { sha256Hex } from "../primitives";
import { hostedOnboardingError } from "./errors";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  hasHostedLinqProviderCorrelatedOrFreshDeliveryForIdempotencyKeysTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  recordHostedLinqDeliveryAttemptTx,
  resolveHostedLinqInviteSignupDispatchEffectIdTx,
} from "./linq-delivery-store";
import {
  assertHostedLinqRouteAuthorityMatchesTarget,
} from "./linq-egress-engagement";
import { sanitizeHostedOnboardingLogString } from "./http";
import { buildHostedInviteUrl } from "./invite-service";
import { normalizePhoneNumber } from "./phone";
import { buildHostedLinqInviteSignupEffectId } from "./linq-invite-signup-effect-id";
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
  maybeShareHostedLinqContactCardAfterOutboundForRuntime,
} from "./linq-contact-card-share";
import {
  assertHostedThreadRouteEgressAuthority,
  type HostedLinqThreadRouteEgressAuthority,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";

type HostedLinqTransportPersistenceClient = PrismaClient | Prisma.TransactionClient;
type HostedLinqTransportPostResponseScheduler = (task: () => Promise<void>) => void;

export type HostedLinqCurrentInboundReplyProof = {
  chatId: string | null;
  messageId: string | null;
};

export type HostedLinqConversationHomeRedirectPayload = {
  chatId: string;
  homeRecipientPhone: string;
  memberId: string;
  replyToMessageId: string | null;
  template: "conversation_home_redirect";
};

export type HostedLinqDailyQuotaPayload = {
  chatId: string;
  memberId: string;
  occurredAt: string;
  replyToMessageId: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  template: "daily_quota";
};

export type HostedLinqAiUsageQuotaClaimToken = {
  periodStart: string;
  sentAt: string;
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
    claimToken: HostedLinqAiUsageQuotaClaimToken;
    noticeCode: HostedLinqUsageLimitNoticeCode;
  })
  | (HostedLinqAiUsageQuotaBasePayload & {
    claimToken: null;
    noticeCode: "trial_conversion_pending";
  });

export type HostedLinqInviteSignupMessagePayload = {
  chatId: string;
  inviteId: string;
  memberId: string;
  occurredAt: string;
  replyToMessageId: string | null;
  service?: string | null;
  threadIsDirect?: boolean | null;
  template: "invite_signup";
};

export type HostedLinqInviteSignupFallbackMessagePayload = {
  assignedRecipientPhone: string;
  chatId: null;
  inviteId: string;
  memberId: string;
  memberPhone: string;
  occurredAt: string;
  replyToMessageId: null;
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
      noticeCode: "trial_conversion_pending";
      occurredAt: string;
      replyToMessageId?: string | null;
      routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
      sourceEventId: string;
      template: "ai_usage_quota";
    }
  | {
      chatId: string;
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
      inviteId: string;
      memberId: string;
      memberPhone: string;
      occurredAt: string;
      sourceEventId: string;
      template: "invite_signup_fallback";
    }
  | {
      chatId: string;
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
  collectResult?: boolean;
  currentInboundReply?: HostedLinqCurrentInboundReplyProof | null;
  prisma: HostedLinqTransportPersistenceClient;
  scheduleAfterResponse?: HostedLinqTransportPostResponseScheduler;
  sideEffects: readonly HostedLinqMessageSideEffect[];
  signal?: AbortSignal;
};

type HostedLinqSideEffectDrainSkipReason =
  | "delivery_skipped"
  | "effect_unresolved"
  | "notice_already_claimed";

export type HostedLinqSideEffectDrainResult = {
  sentCount: number;
  skipped: readonly {
    effectId: string;
    reason: HostedLinqSideEffectDrainSkipReason;
    template: HostedLinqMessagePayload["template"];
  }[];
};

export async function drainHostedLinqSideEffectsDirect(
  input: HostedLinqSideEffectDrainInput & { collectResult: true },
): Promise<HostedLinqSideEffectDrainResult>;
export async function drainHostedLinqSideEffectsDirect(
  input: HostedLinqSideEffectDrainInput & { collectResult?: false },
): Promise<void>;
export async function drainHostedLinqSideEffectsDirect(
  input: HostedLinqSideEffectDrainInput,
): Promise<HostedLinqSideEffectDrainResult | void> {
  let sentCount = 0;
  const skipped: HostedLinqSideEffectDrainResult["skipped"][number][] = [];

  for (const plannedEffect of input.sideEffects) {
    const effect = await resolveHostedLinqDispatchSideEffect(plannedEffect, input.prisma);
    if (!effect) {
      skipped.push({
        effectId: plannedEffect.effectId,
        reason: "effect_unresolved",
        template: plannedEffect.payload.template,
      });
      continue;
    }
    const noticeClaimed = await claimHostedLinqNoticeForSideEffect(effect, input.prisma);
    if (!noticeClaimed) {
      skipped.push({
        effectId: effect.effectId,
        reason: "notice_already_claimed",
        template: effect.payload.template,
      });
      continue;
    }

    try {
      const result = await sendHostedLinqSideEffect(effect, {
        currentInboundReply: input.currentInboundReply ?? null,
        prisma: input.prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
        signal: input.signal,
      });

      if (result.status === "skipped") {
        await releaseHostedLinqNoticeClaimForSideEffect(effect, input.prisma);
        skipped.push({
          effectId: effect.effectId,
          reason: "delivery_skipped",
          template: effect.payload.template,
        });
        continue;
      }
    } catch (error) {
      await releaseHostedLinqNoticeClaimForSideEffect(effect, input.prisma);
      throw error;
    }

    await markHostedAiUsageLimitNoticeSentForSideEffectBestEffort(effect, input.prisma);
    if (isHostedInviteLinqMessagePayload(effect.payload)) {
      await markHostedLinqNoticeSentForSideEffect(effect, input.prisma);
      await markHostedInviteSentBestEffort(effect.payload.inviteId, input.prisma);
    }
    sentCount += 1;
  }

  if (input.collectResult === true) {
    return {
      sentCount,
      skipped,
    };
  }
}

/**
 * Signup-link sends run as explicit delivery attempts: the planner emits the
 * member/day base effect id and dispatch resolves it to the first attempt
 * whose delivery row is absent or still actionable. A terminally failed
 * attempt advances the ordinal so the provider idempotency key is fresh and
 * Linq cannot dedupe the retry against the dead message. Returns null (drops
 * the send) once the day's attempt budget is exhausted.
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

  const effectId = await resolveHostedLinqInviteSignupDispatchEffectIdTx({
    effectId: effect.effectId,
    prisma,
  });
  if (!effectId) {
    console.warn("Hosted Linq signup-link attempt budget exhausted for the day.", {
      effectIdSuffix: toHostedOnboardingLogIdSuffix(effect.effectId) ?? "unknown",
      template: effect.payload.template,
    });
    return null;
  }
  return effectId === effect.effectId
    ? effect
    : {
        ...effect,
        effectId,
      };
}

async function sendHostedLinqSideEffect(
  effect: {
    effectId: string;
    payload: HostedLinqMessagePayload;
  },
  options: {
    currentInboundReply: HostedLinqCurrentInboundReplyProof | null;
    prisma: HostedLinqTransportPersistenceClient;
    scheduleAfterResponse?: HostedLinqTransportPostResponseScheduler;
    signal?: AbortSignal;
  },
): Promise<{ status: "sent" | "skipped" }> {
  const startedAtMs = Date.now();
  const deliveryAttemptTask = recordHostedLinqDeliveryAttemptBestEffort({
    effect,
    prisma: options.prisma,
    startedAtMs,
  });

  try {
    if (effect.payload.template === "invite_signup_fallback") {
      const result = await createHostedLinqChat({
        from: effect.payload.assignedRecipientPhone,
        idempotencyKey: effect.effectId,
        message: await buildHostedLinqSideEffectMessage(effect, options.prisma),
        signal: options.signal,
        to: [effect.payload.memberPhone],
      });

      scheduleHostedLinqDeliveryMilestoneAfterAttempt({
        attemptTask: deliveryAttemptTask,
        milestoneTask: () => markHostedLinqDeliveryAcceptedBestEffort({
          chatId: result.chatId,
          effect,
          messageId: result.messageId,
          prisma: options.prisma,
        }),
        scheduleAfterResponse: options.scheduleAfterResponse,
      });
      return { status: "sent" };
    }

    await assertHostedLinqSideEffectRouteAuthority(effect, options.prisma);

    const result = await sendHostedLinqChatMessage({
      chatId: effect.payload.chatId,
      idempotencyKey: effect.effectId,
      message: await buildHostedLinqSideEffectMessage(effect, options.prisma),
      replyToMessageId: effect.payload.replyToMessageId,
      signal: options.signal,
    });
    if (effect.payload.template === "invite_signup") {
      queueHostedLinqContactCardSideEffectShare({
        effect: {
          effectId: effect.effectId,
          payload: effect.payload,
        },
        prisma: options.prisma,
        signal: options.signal,
      });
    }
    scheduleHostedLinqDeliveryMilestoneAfterAttempt({
      attemptTask: deliveryAttemptTask,
      milestoneTask: () => markHostedLinqDeliveryAcceptedBestEffort({
        chatId: result.chatId ?? effect.payload.chatId,
        effect,
        messageId: result.messageId,
        prisma: options.prisma,
      }),
      scheduleAfterResponse: options.scheduleAfterResponse,
    });
  } catch (error) {
    if (
      effect.payload.template === "invite_signup"
      || effect.payload.template === "invite_signup_fallback"
    ) {
      await deliveryAttemptTask;
      await markHostedLinqDeliveryFailedBestEffort({
        effect,
        error,
        prisma: options.prisma,
      });
    } else {
      scheduleHostedLinqDeliveryMilestoneAfterAttempt({
        attemptTask: deliveryAttemptTask,
        milestoneTask: () => markHostedLinqDeliveryFailedBestEffort({
          effect,
          error,
          prisma: options.prisma,
        }),
        scheduleAfterResponse: options.scheduleAfterResponse,
      });
    }
    console.error(
      "Hosted Linq side-effect delivery failed.",
      buildHostedLinqSideEffectLogDetails(effect, error, Date.now() - startedAtMs),
    );
    throw error;
  }

  return { status: "sent" };
}

function queueHostedLinqContactCardSideEffectShare(share: {
  effect: {
    effectId: string;
    payload: HostedLinqInviteSignupMessagePayload;
  };
  prisma: HostedLinqTransportPersistenceClient;
  signal?: AbortSignal;
}): void {
  void maybeShareHostedLinqContactCardAfterOutboundForRuntime({
    boundUserId: share.effect.payload.memberId,
    chatId: share.effect.payload.chatId,
    eligibility: {
      service: share.effect.payload.service ?? null,
      threadIsDirect: share.effect.payload.threadIsDirect ?? null,
    },
    prisma: share.prisma,
    ...(share.signal ? { signal: share.signal } : {}),
  }).catch((error: unknown) => {
    console.warn(
      "Hosted Linq contact-card side-effect share failed.",
      buildHostedLinqContactCardSideEffectLogDetails(share.effect, error),
    );
  });
}

async function assertHostedLinqSideEffectRouteAuthority(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<HostedThreadRouteSnapshot | null> {
  const routeAuthority = "routeAuthority" in effect.payload
    ? effect.payload.routeAuthority ?? null
    : null;
  if (!routeAuthority) {
    return null;
  }

  return await assertHostedThreadRouteEgressAuthority({
    authority: assertHostedLinqRouteAuthorityMatchesTarget({
      chatId: effect.payload.chatId,
      memberId: "memberId" in effect.payload ? effect.payload.memberId : null,
      routeAuthority,
    }),
    prisma,
  });
}

function scheduleHostedLinqDeliveryMilestoneAfterAttempt(
  input: {
    attemptTask: Promise<void>;
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

async function recordHostedLinqDeliveryAttemptBestEffort(input: {
  effect: HostedLinqMessageSideEffect;
  prisma: HostedLinqTransportPersistenceClient;
  startedAtMs: number;
}): Promise<void> {
  const template = input.effect.payload.template;
  const target = readHostedLinqSideEffectDeliveryTarget(input.effect.payload);
  try {
    await recordHostedLinqDeliveryAttemptTx({
      attemptedAt: new Date(input.startedAtMs),
      idempotencyKey: input.effect.effectId,
      linqChatId: target.linqChatId,
      phoneNumber: target.phoneNumber,
      prisma: input.prisma,
      source: "hosted_webhook_side_effect",
      sourceRef: input.effect.effectId,
      targetKind: target.targetKind,
      template: input.effect.payload.template,
    });
  } catch (error) {
    console.warn("Hosted Linq delivery attempt recording failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      template,
    });
  }
}

async function markHostedLinqDeliveryAcceptedBestEffort(input: {
  chatId: string | null;
  effect: HostedLinqMessageSideEffect;
  messageId: string | null;
  prisma: HostedLinqTransportPersistenceClient;
}): Promise<void> {
  const template = input.effect.payload.template;
  try {
    // A terminal receipt can beat this milestone write (it only just learned
    // the provider message id); the milestone replays that receipt and this
    // applies the same daily-state consequence as live receipt ingestion.
    // Milestone and consequence commit atomically: a replayed failure must
    // never mark the delivery terminally failed while leaving the member/day
    // marked sent, or the planner suppresses retries for the rest of the day.
    await runHostedLinqTransportTransaction(input.prisma, async (prisma) => {
      const milestone = await markHostedLinqDeliveryAcceptedTx({
        idempotencyKey: input.effect.effectId,
        linqChatId: input.chatId,
        messageId: input.messageId,
        prisma,
      });
      if (milestone.reopenOnboardingLink) {
        await releaseHostedLinqOnboardingLinkNoticeClaim({
          memberId: milestone.reopenOnboardingLink.memberId,
          occurredAt: milestone.reopenOnboardingLink.occurredAt,
          prisma,
        });
      }
      if (milestone.restoreOnboardingLink) {
        await markHostedLinqOnboardingLinkNoticeSent({
          memberId: milestone.restoreOnboardingLink.memberId,
          occurredAt: milestone.restoreOnboardingLink.occurredAt,
          prisma,
        });
      }
    });
  } catch (error) {
    console.warn("Hosted Linq delivery accepted recording failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      template,
    });
  }
}

async function runHostedLinqTransportTransaction<TResult>(
  prisma: HostedLinqTransportPersistenceClient,
  callback: (transaction: HostedLinqTransportPersistenceClient) => Promise<TResult>,
): Promise<TResult> {
  const candidate = prisma as HostedLinqTransportPersistenceClient & {
    $transaction?: <T>(
      operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
  };
  return candidate.$transaction
    ? candidate.$transaction(callback)
    : callback(prisma);
}

async function markHostedLinqDeliveryFailedBestEffort(input: {
  effect: HostedLinqMessageSideEffect;
  error: unknown;
  prisma: HostedLinqTransportPersistenceClient;
}): Promise<void> {
  try {
    await markHostedLinqDeliverySendFailedTx({
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

function buildHostedLinqContactCardSideEffectLogDetails(
  effect: HostedLinqMessageSideEffect,
  error: unknown,
): Record<string, boolean | number | string | null> {
  const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const nestedDetails = errorRecord?.details && typeof errorRecord.details === "object"
    ? errorRecord.details as Record<string, unknown>
    : null;

  return sanitizeHostedOnboardingStructuredLogDetails({
    chatIdSuffix: toHostedOnboardingLogIdSuffix(readHostedLinqSideEffectChatId(effect.payload)),
    errorCode: readHostedLinqSideEffectString(errorRecord, "code"),
    errorMessage:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : null,
    errorName: error instanceof Error ? error.name : null,
    operation: "share_contact_card",
    provider: "linq",
    ...(nestedDetails ?? {}),
    template: effect.payload.template,
  });
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
    joinUrl: buildHostedInviteUrl(invite.inviteCode),
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
        inviteId: input.inviteId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId,
        ...(input.service === undefined ? {} : { service: input.service }),
        ...(input.threadIsDirect === undefined ? {} : { threadIsDirect: input.threadIsDirect }),
        template: input.template,
      };
    case "invite_signup_fallback":
      return {
        assignedRecipientPhone: input.assignedRecipientPhone,
        chatId: null,
        inviteId: input.inviteId,
        memberId: input.memberId,
        memberPhone: input.memberPhone,
        occurredAt: input.occurredAt,
        replyToMessageId: null,
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

  if (input.noticeCode === "trial_conversion_pending") {
    if (input.claimToken) {
      throw new TypeError(
        "Hosted Linq trial conversion notices must not include AI usage claim metadata.",
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
    case "invite_signup": {
      const target = readHostedLinqSideEffectDeliveryTarget(effect.payload);
      const claim = await claimHostedLinqDeliveryProviderDispatchTx({
        idempotencyKey: effect.effectId,
        linqChatId: target.linqChatId,
        phoneNumber: target.phoneNumber,
        prisma,
        source: "hosted_webhook_side_effect",
        sourceRef: effect.effectId,
        targetKind: target.targetKind,
        template: effect.payload.template,
      });
      return claim.claimed;
    }
    case "invite_signin":
      return true;
    case "ai_usage_quota": {
      if (!effect.payload.claimToken) {
        return true;
      }
      const target = readHostedLinqSideEffectDeliveryTarget(effect.payload);
      const attemptedAt = new Date(effect.payload.claimToken.sentAt);
      const legacyDeliveryOwnsNotice =
        await hasHostedLinqProviderCorrelatedOrFreshDeliveryForIdempotencyKeysTx({
          attemptedAt,
          idempotencyKeys: buildHostedAiUsageGateLegacyNoticeIdempotencyKeys({
            memberId: effect.payload.memberId,
            periodStart: effect.payload.claimToken.periodStart,
          }),
          prisma,
        });
      if (legacyDeliveryOwnsNotice) {
        return false;
      }
      const legacyPeriodClaimOwnsNotice =
        await hasFreshHostedAiUsageLimitNoticeClaim({
          memberId: effect.payload.memberId,
          now: attemptedAt,
          periodStart: effect.payload.claimToken.periodStart,
          prisma,
        });
      if (legacyPeriodClaimOwnsNotice) {
        return false;
      }
      const claim = await claimHostedLinqDeliveryProviderDispatchTx({
        idempotencyKey: effect.effectId,
        linqChatId: target.linqChatId,
        phoneNumber: target.phoneNumber,
        prisma,
        reclaimFreshPreProviderAttempt: true,
        source: "hosted_webhook_side_effect",
        sourceRef: effect.effectId,
        targetKind: target.targetKind,
        template: effect.payload.template,
      });
      return claim.claimed;
    }
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

async function releaseHostedLinqNoticeClaimForSideEffect(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<void> {
  try {
    switch (effect.payload.template) {
      case "invite_signup_fallback":
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

async function markHostedAiUsageLimitNoticeSentForSideEffectBestEffort(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<void> {
  if (effect.payload.template !== "ai_usage_quota" || !effect.payload.claimToken) {
    return;
  }

  try {
    await markHostedAiUsageLimitNoticeSent({
      memberId: effect.payload.memberId,
      periodStart: effect.payload.claimToken.periodStart,
      prisma,
      sentAt: effect.payload.claimToken.sentAt,
    });
  } catch (error) {
    console.warn(
      "Hosted Linq AI usage-limit notice sent marker failed.",
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
