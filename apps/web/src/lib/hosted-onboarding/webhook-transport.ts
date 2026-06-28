import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  releaseHostedAiUsageLimitNotice,
  type HostedAiUsageGateNoticeCode,
} from "../hosted-execution/usage-allowance";
import { hostedOnboardingError } from "./errors";
import { sanitizeHostedOnboardingLogString } from "./http";
import { readHostedMemberRoutingState } from "./hosted-member-routing-store";
import { buildHostedInviteUrl } from "./invite-service";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
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
  maybeShareHostedLinqContactCardAfterOutbound,
} from "./linq-contact-card-share";
import {
  assertHostedLinqRouteEgressAuthority,
  type HostedLinqThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";

type HostedLinqTransportPersistenceClient = PrismaClient | Prisma.TransactionClient;

export type HostedLinqConversationHomeRedirectPayload = {
  chatId: string;
  homeRecipientPhone: string | null;
  memberId: string | null;
  replyToMessageId: string | null;
  service?: string | null;
  threadIsDirect?: boolean | null;
  template: "conversation_home_redirect";
};

export type HostedLinqDailyQuotaPayload = {
  chatId: string;
  memberId: string;
  occurredAt: string;
  replyToMessageId: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  service?: string | null;
  threadIsDirect?: boolean | null;
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
  service?: string | null;
  sourceEventId: string;
  threadIsDirect?: boolean | null;
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

export type HostedLinqInviteSigninMessagePayload = {
  chatId: string;
  inviteId: string;
  replyToMessageId: string | null;
  service?: string | null;
  threadIsDirect?: boolean | null;
  template: "invite_signin";
};

export type HostedLinqInviteMessagePayload =
  | HostedLinqInviteSigninMessagePayload
  | HostedLinqInviteSignupMessagePayload;

export type HostedLinqMessagePayload =
  | HostedLinqAiUsageQuotaPayload
  | HostedLinqConversationHomeRedirectPayload
  | HostedLinqDailyQuotaPayload
  | HostedLinqInviteMessagePayload;

export type HostedLinqMessageSideEffect = {
  effectId: string;
  payload: HostedLinqMessagePayload;
};

export type CreateHostedWebhookLinqMessageSideEffectInput =
  | {
      chatId: string;
      homeRecipientPhone?: string | null;
      memberId: string;
      replyToMessageId?: string | null;
      service?: string | null;
      sourceEventId: string;
      threadIsDirect?: boolean | null;
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
      service?: string | null;
      sourceEventId: string;
      threadIsDirect?: boolean | null;
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
      service?: string | null;
      sourceEventId: string;
      threadIsDirect?: boolean | null;
      template: "ai_usage_quota";
    }
  | {
      chatId: string;
      memberId: string;
      occurredAt: string;
      replyToMessageId?: string | null;
      routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
      service?: string | null;
      sourceEventId: string;
      threadIsDirect?: boolean | null;
      template: "daily_quota";
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
  const replyToMessageId = input.replyToMessageId ?? null;

  return {
    effectId: buildHostedWebhookLinqMessageEffectId(input),
    payload: buildHostedWebhookLinqMessagePayload(input, replyToMessageId),
  };
}

function buildHostedWebhookLinqMessageEffectId(
  input: CreateHostedWebhookLinqMessageSideEffectInput,
): string {
  if (input.template === "invite_signup") {
    return `linq-invite-signup:${input.inviteId}`;
  }

  if (input.template === "ai_usage_quota" && input.claimToken) {
    return buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: input.memberId,
      noticeCode: input.noticeCode,
      periodStart: input.claimToken.periodStart,
    });
  }

  return `linq-message:${input.sourceEventId}`;
}

export async function drainHostedLinqSideEffectsDirect(input: {
  prisma: HostedLinqTransportPersistenceClient;
  sideEffects: readonly HostedLinqMessageSideEffect[];
  signal?: AbortSignal;
}): Promise<void> {
  for (const effect of input.sideEffects) {
    const noticeClaimed = await claimHostedLinqNoticeForSideEffect(effect, input.prisma);
    if (!noticeClaimed) {
      continue;
    }

    try {
      await sendHostedLinqSideEffect(effect, {
        prisma: input.prisma,
        signal: input.signal,
      });
    } catch (error) {
      await releaseHostedLinqNoticeClaimForSideEffect(effect, input.prisma);
      throw error;
    }

    if (isHostedInviteLinqMessagePayload(effect.payload)) {
      await markHostedInviteSentBestEffort(effect.payload.inviteId, input.prisma);
    }
  }
}

async function sendHostedLinqSideEffect(
  effect: {
    effectId: string;
    payload: HostedLinqMessagePayload;
  },
  options: {
    prisma: HostedLinqTransportPersistenceClient;
    signal?: AbortSignal;
  },
): Promise<void> {
  const startedAtMs = Date.now();

  try {
    const hasValidatedRouteAuthority = await assertHostedLinqSideEffectRouteAuthority(
      effect,
      options.prisma,
    );
    await sendHostedLinqChatMessage({
      chatId: effect.payload.chatId,
      idempotencyKey: effect.effectId,
      message: await buildHostedLinqSideEffectMessage(effect, options.prisma),
      replyToMessageId: effect.payload.replyToMessageId,
      signal: options.signal,
    });

    const memberId = readHostedLinqSideEffectMemberId(effect.payload);
    if (memberId && hasValidatedRouteAuthority) {
      try {
        await maybeShareHostedLinqContactCardAfterOutbound({
          chatId: effect.payload.chatId,
          eligibility: {
            service: effect.payload.service ?? null,
            threadIsDirect: effect.payload.threadIsDirect ?? null,
          },
          memberId,
          prisma: options.prisma,
          signal: options.signal,
        });
      } catch (error) {
        console.warn(
          "Hosted Linq contact-card side-effect share failed.",
          buildHostedLinqContactCardSideEffectLogDetails(effect, error),
        );
      }
    }
  } catch (error) {
    console.error(
      "Hosted Linq side-effect delivery failed.",
      buildHostedLinqSideEffectLogDetails(effect, error, Date.now() - startedAtMs),
    );
    throw error;
  }
}

async function assertHostedLinqSideEffectRouteAuthority(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<boolean> {
  const routeAuthority = "routeAuthority" in effect.payload
    ? effect.payload.routeAuthority
    : null;
  if (!routeAuthority) {
    return false;
  }

  await assertHostedLinqRouteEgressAuthority({
    authority: routeAuthority,
    prisma,
  });
  return true;
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
    chatIdSuffix: toHostedOnboardingLogIdSuffix(effect.payload.chatId),
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

function readHostedLinqSideEffectMemberId(
  payload: HostedLinqMessagePayload,
): string | null {
  return "memberId" in payload && typeof payload.memberId === "string"
    ? payload.memberId
    : null;
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
    case "conversation_home_redirect": {
      const homeRecipientPhone = await resolveHostedHomeRecipientPhone(effect.payload, prisma);

      if (!homeRecipientPhone) {
        throw hostedOnboardingError({
          code: "LINQ_HOME_PHONE_REQUIRED",
          message: `Hosted webhook side effect ${effect.effectId} requires a home recipient phone.`,
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
    case "invite_signin":
      return buildHostedInviteSideEffectMessage({
        effectId: effect.effectId,
        payload: effect.payload,
        prisma,
      });
  }
}

async function resolveHostedHomeRecipientPhone(
  payload: HostedLinqConversationHomeRedirectPayload,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<string | null> {
  if (payload.memberId) {
    const routing = await readHostedMemberRoutingState({
      memberId: payload.memberId,
      prisma,
    });

    if (routing?.linqRecipientPhone) {
      return routing.linqRecipientPhone;
    }
  }

  return payload.homeRecipientPhone;
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
      message: `Hosted invite ${input.payload.inviteId} was not found for webhook side effect ${input.effectId}.`,
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
    payload.template === "invite_signup" || payload.template === "invite_signin"
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
        homeRecipientPhone: input.homeRecipientPhone ?? null,
        memberId: input.memberId,
        replyToMessageId,
        ...buildHostedLinqContactCardShareEligibilityPayload(input),
        template: input.template,
      };
    case "daily_quota":
      return {
        chatId: input.chatId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        ...buildHostedLinqContactCardShareEligibilityPayload(input),
        template: input.template,
      };
    case "invite_signup":
      return {
        chatId: input.chatId,
        inviteId: input.inviteId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId,
        ...buildHostedLinqContactCardShareEligibilityPayload(input),
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
    ...buildHostedLinqContactCardShareEligibilityPayload(input),
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

function buildHostedLinqContactCardShareEligibilityPayload(input: {
  service?: string | null;
  threadIsDirect?: boolean | null;
}): {
  service?: string | null;
  threadIsDirect?: boolean | null;
} {
  return {
    ...(input.service === undefined ? {} : { service: input.service }),
    ...(input.threadIsDirect === undefined ? {} : { threadIsDirect: input.threadIsDirect }),
  };
}

async function claimHostedLinqNoticeForSideEffect(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<boolean> {
  switch (effect.payload.template) {
    case "invite_signup":
      return claimHostedLinqOnboardingLinkNotice({
        memberId: effect.payload.memberId,
        occurredAt: effect.payload.occurredAt,
        prisma,
      });
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
      return true;
  }
}

async function releaseHostedLinqNoticeClaimForSideEffect(
  effect: HostedLinqMessageSideEffect,
  prisma: HostedLinqTransportPersistenceClient,
): Promise<void> {
  try {
    switch (effect.payload.template) {
      case "invite_signup":
        await releaseHostedLinqOnboardingLinkNoticeClaim({
          memberId: effect.payload.memberId,
          occurredAt: effect.payload.occurredAt,
          prisma,
        });
        return;
      case "daily_quota":
        await releaseHostedLinqQuotaReplyNoticeClaim({
          memberId: effect.payload.memberId,
          occurredAt: effect.payload.occurredAt,
          prisma,
        });
        return;
      case "ai_usage_quota":
        if (!effect.payload.claimToken) {
          return;
        }
        await releaseHostedAiUsageLimitNotice({
          memberId: effect.payload.memberId,
          periodStart: effect.payload.claimToken.periodStart,
          prisma,
          sentAt: effect.payload.claimToken.sentAt,
        });
        return;
      case "invite_signin":
      case "conversation_home_redirect":
        return;
    }
  } catch (error) {
    console.error(
      "Hosted Linq side-effect notice claim release failed.",
      buildHostedLinqSideEffectLogDetails(effect, error, 0),
    );
  }
}
