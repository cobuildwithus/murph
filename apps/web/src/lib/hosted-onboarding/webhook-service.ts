import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  HOSTED_RUNTIME_PREWARM_SOURCE,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import {
  signalHostedRuntimePrewarm,
} from "../hosted-orchestration/signal-runtime";
import {
  hasHostedMemberActiveAccess,
} from "./entitlement";
import {
  lookupHostedMemberRoutingByHomeLinqChatId,
} from "./hosted-member-routing-store";
import {
  requireHostedLinqMessageReceivedEvent,
  requireHostedLinqTypingIndicatorStartedEvent,
  resolveHostedLinqTypingOccurredAt,
  sendHostedLinqReadReceipt,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import { assertHostedTelegramWebhookSecret, buildHostedTelegramWebhookEventId, parseHostedTelegramWebhookUpdate } from "./telegram";
import {
  planHostedOnboardingLinqWebhook,
  type HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq";
import {
  isHostedLinqIMessageService,
} from "./webhook-provider-linq-shared";
import {
  planHostedOnboardingTelegramWebhook,
  type HostedOnboardingTelegramWebhookResponse,
} from "./webhook-provider-telegram";
import {
  planHostedOnboardingWhatsAppWebhook,
  type HostedOnboardingWhatsAppWebhookResponse,
} from "./webhook-provider-whatsapp";
import {
  parseHostedWhatsAppInboundTexts,
  verifyAndParseHostedWhatsAppWebhookRequest,
} from "./whatsapp";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import {
  drainHostedLinqSideEffectsDirect,
} from "./webhook-transport";
import {
  maybeHandoffHostedExecutionWebhookWake,
} from "./webhook-service-wake";

export {
  handleHostedStripeWebhook,
} from "./webhook-service-stripe";
export type {
  HostedStripeWebhookResponse,
} from "./webhook-service-types";

type HostedWebhookPostResponseScheduler = (task: () => Promise<void>) => void;

const HOSTED_LINQ_TYPING_PREWARM_COOLDOWN_MS = 30_000;
// Process-local only; Temporal still coalesces duplicate prewarm hints.
const hostedLinqTypingPrewarmLastSignalByUser = new Map<string, number>();

export async function handleHostedOnboardingLinqWebhook(input: {
  rawBody: string;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  signature: string | null;
  timestamp: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.webhook.linq", {
    rawBodyBytes: new TextEncoder().encode(input.rawBody).byteLength,
    signalAbortedAtStart: input.signal?.aborted ?? false,
    signaturePresent: Boolean(input.signature),
    timestampPresent: Boolean(input.timestamp),
  });
  let eventId: string | null = null;
  let eventType: string | null = null;
  let responseReason: string | null = null;

  try {
    const verifyTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.verify-request",
      {
        signaturePresent: Boolean(input.signature),
        timestampPresent: Boolean(input.timestamp),
      },
    );
    const event = verifyAndParseHostedLinqWebhookRequest({
      rawBody: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
    });
    eventId = event.event_id;
    eventType = event.event_type;
    finishHostedOnboardingTiming(verifyTiming, "completed", {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      signalAbortedAfterVerify: input.signal?.aborted ?? false,
    });

    if (event.event_type === "chat.typing_indicator.started") {
      const response = await handleHostedLinqTypingPrewarm({
        event,
        prisma: input.prisma ?? getPrisma(),
      });
      responseReason = response.reason ?? null;
      finishHostedOnboardingTiming(timing, "completed", {
        eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
        eventType,
        responseReason,
        signalAbortedBeforeReturn: input.signal?.aborted ?? false,
      });
      return response;
    }

    if (event.event_type === "message.received") {
      requireHostedLinqMessageReceivedEvent(event);
    }

    const prisma = input.prisma ?? getPrisma();
    const planTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.plan",
      {
        eventIdSuffix: toHostedOnboardingLogIdSuffix(event.event_id),
        eventType: event.event_type,
      },
    );
    let plan: Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>;
    try {
      plan = await runHostedOnboardingWebhookTransaction(
        prisma,
        (transaction) =>
          planHostedOnboardingLinqWebhook({
            event,
            prisma: transaction,
          }),
      );
    } catch (error) {
      finishHostedOnboardingTiming(planTiming, "failed", {
        errorName: deriveHostedOnboardingTimingErrorName(error),
      });
      throw error;
    }
    finishHostedOnboardingTiming(planTiming, plan.response.reason ?? "completed", {
      desiredSideEffectCount: plan.desiredSideEffects.length,
      duplicate: Boolean(plan.response.duplicate),
      ok: plan.response.ok,
      wakeUserPresent: Boolean(plan.wakeUserId),
    });

    if (plan.desiredSideEffects.length > 0) {
      await drainHostedLinqSideEffectsDirect({
        prisma,
        sideEffects: plan.desiredSideEffects,
        signal: input.signal,
      });
    }

    responseReason = plan.response.reason ?? null;
    const wakeHandoff = await maybeHandoffHostedExecutionWebhookWake({
      eventId: event.event_id,
      mailboxItemId: plan.wakeMailboxItemId,
      response: plan.response,
      source: "linq",
      userId: plan.wakeUserId,
    });
    const sendReadReceipt = () => maybeSendHostedLinqIngressReadReceipt({
      plan,
      signal: input.signal,
      wakeHandoff,
    });
    if (input.scheduleAfterResponse) {
      input.scheduleAfterResponse(sendReadReceipt);
    } else {
      await sendReadReceipt();
    }

    finishHostedOnboardingTiming(timing, "completed", {
      duplicate: Boolean(plan.response.duplicate),
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
      wakeHandoffReason: wakeHandoff?.reason ?? null,
      wakeHandoffSignalAccepted: wakeHandoff?.signalAccepted ?? false,
      wakeHandoffStarted: wakeHandoff?.started ?? false,
    });
    return plan.response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    throw error;
  }
}

async function handleHostedLinqTypingPrewarm(input: {
  event: ReturnType<typeof verifyAndParseHostedLinqWebhookRequest>;
  prisma: PrismaClient;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  const typingEvent = requireHostedLinqTypingIndicatorStartedEvent(input.event);
  const timing = startHostedOnboardingTiming(
    "hosted.linq.typing-prewarm",
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(typingEvent.event_id),
      eventType: typingEvent.event_type,
      scopeHashPresent: false,
    },
  );

  if (!isHostedLinqIMessageService(typingEvent.data.service)) {
    finishHostedOnboardingTiming(timing, "ignored-unsupported-service", {
      decision: "ignored-unsupported-service",
      eventIdSuffix: toHostedOnboardingLogIdSuffix(typingEvent.event_id),
      servicePresent: Boolean(typingEvent.data.service),
      scopeHashPresent: false,
    });
    return {
      ignored: true,
      ok: true,
      reason: "typing-prewarm-ignored-unsupported-service",
    };
  }

  const routing = await lookupHostedMemberRoutingByHomeLinqChatId({
    linqChatId: typingEvent.data.chat_id,
    prisma: input.prisma,
  });
  if (!routing) {
    finishHostedOnboardingTiming(timing, "ignored-no-active-route", {
      decision: "ignored-no-active-route",
      eventIdSuffix: toHostedOnboardingLogIdSuffix(typingEvent.event_id),
      scopeHashPresent: false,
    });
    return {
      ignored: true,
      ok: true,
      reason: "typing-prewarm-ignored-no-active-route",
    };
  }

  if (!hasHostedMemberActiveAccess(routing.core)) {
    finishHostedOnboardingTiming(timing, "ignored-inactive-member", {
      decision: "ignored-inactive-member",
      eventIdSuffix: toHostedOnboardingLogIdSuffix(typingEvent.event_id),
      userIdSuffix: toHostedOnboardingLogIdSuffix(routing.core.id),
      scopeHashPresent: false,
    });
    return {
      ignored: true,
      ok: true,
      reason: "typing-prewarm-ignored-inactive-member",
    };
  }

  if (!canSignalHostedLinqTypingPrewarm(routing.core.id)) {
    finishHostedOnboardingTiming(timing, "coalesced", {
      decision: "coalesced",
      eventIdSuffix: toHostedOnboardingLogIdSuffix(typingEvent.event_id),
      userIdSuffix: toHostedOnboardingLogIdSuffix(routing.core.id),
      scopeHashPresent: false,
    });
    return {
      ignored: true,
      ok: true,
      reason: "typing-prewarm-coalesced",
    };
  }

  try {
    await signalHostedRuntimePrewarm({
      eventId: typingEvent.event_id,
      occurredAt: resolveHostedLinqTypingOccurredAt(typingEvent),
      source: HOSTED_RUNTIME_PREWARM_SOURCE,
      userId: routing.core.id,
    });
  } catch (error) {
    finishHostedOnboardingTiming(timing, "temporal-signal-failed", {
      decision: "temporal-signal-failed",
      errorName: deriveHostedOnboardingTimingErrorName(error),
      eventIdSuffix: toHostedOnboardingLogIdSuffix(typingEvent.event_id),
      userIdSuffix: toHostedOnboardingLogIdSuffix(routing.core.id),
      scopeHashPresent: false,
    });
    return {
      ignored: true,
      ok: true,
      reason: "typing-prewarm-temporal-signal-failed",
    };
  }

  finishHostedOnboardingTiming(timing, "signaled", {
    decision: "signaled",
    eventIdSuffix: toHostedOnboardingLogIdSuffix(typingEvent.event_id),
    userIdSuffix: toHostedOnboardingLogIdSuffix(routing.core.id),
    scopeHashPresent: false,
  });
  recordHostedLinqTypingPrewarmSignal(routing.core.id);
  return {
    ignored: true,
    ok: true,
    reason: "typing-prewarm-signaled",
  };
}

function canSignalHostedLinqTypingPrewarm(userId: string): boolean {
  const now = Date.now();
  const lastSignaledAt = hostedLinqTypingPrewarmLastSignalByUser.get(userId);
  return lastSignaledAt === undefined
    || now - lastSignaledAt >= HOSTED_LINQ_TYPING_PREWARM_COOLDOWN_MS;
}

function recordHostedLinqTypingPrewarmSignal(userId: string): void {
  hostedLinqTypingPrewarmLastSignalByUser.set(userId, Date.now());
}

async function maybeSendHostedLinqIngressReadReceipt(input: {
  plan: Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>;
  signal?: AbortSignal;
  wakeHandoff: Awaited<ReturnType<typeof maybeHandoffHostedExecutionWebhookWake>>;
}): Promise<void> {
  const chatId = input.plan.wakeLinqChatId?.trim() ?? "";

  if (chatId.length === 0) {
    return;
  }

  const responseReason = input.plan.response.reason ?? null;
  const wakeHandoffReason = input.wakeHandoff?.reason ?? null;
  const wakeHandoffStarted = input.wakeHandoff?.started === true;
  const wakeHandoffSignalAccepted = input.wakeHandoff?.signalAccepted ?? false;
  const readReceiptTiming = startHostedOnboardingTiming(
    "hosted-onboarding.webhook.linq.ingress-read-receipt",
    {
      chatIdPresent: true,
      responseReason,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    },
  );

  if (!wakeHandoffStarted) {
    finishHostedOnboardingTiming(readReceiptTiming, "skipped-handoff-not-started", {
      responseReason,
      signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    });
    return;
  }

  try {
    const result = await sendHostedLinqReadReceipt({
      chatId,
      signal: input.signal,
    });

    finishHostedOnboardingTiming(readReceiptTiming, result.ok ? "sent" : "failed", {
      httpStatus: result.status,
      responseReason,
      signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    });
  } catch (error) {
    finishHostedOnboardingTiming(readReceiptTiming, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      responseReason,
      signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    });
  }
}

export async function handleHostedOnboardingTelegramWebhook(input: {
  rawBody: string;
  secretToken: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingTelegramWebhookResponse> {
  const prisma = input.prisma ?? getPrisma();

  assertHostedTelegramWebhookSecret(input.secretToken);

  const update = parseHostedTelegramWebhookUpdate(input.rawBody);
  const eventId = buildHostedTelegramWebhookEventId(update);
  const plan = await runHostedOnboardingWebhookTransaction(
    prisma,
    (transaction) =>
      planHostedOnboardingTelegramWebhook({
        prisma: transaction,
        update,
      }),
  );

  if (plan.desiredSideEffects.length > 0) {
    throw new Error(
      "Hosted Telegram webhook planning unexpectedly queued local side effects.",
    );
  }

  await maybeHandoffHostedExecutionWebhookWake({
    eventId,
    mailboxItemId: plan.wakeMailboxItemId,
    response: plan.response,
    source: "telegram",
    userId: plan.wakeUserId,
  });
  return plan.response;
}

export async function handleHostedOnboardingWhatsAppWebhook(input: {
  rawBody: string;
  prisma?: PrismaClient;
  signature: string | null;
  signal?: AbortSignal;
}): Promise<HostedOnboardingWhatsAppWebhookResponse> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.webhook.whatsapp", {
    rawBodyBytes: new TextEncoder().encode(input.rawBody).byteLength,
    signalAbortedAtStart: input.signal?.aborted ?? false,
    signaturePresent: Boolean(input.signature),
  });
  let responseReason: string | null = null;

  try {
    const body = verifyAndParseHostedWhatsAppWebhookRequest({
      rawBody: input.rawBody,
      signature: input.signature,
    });
    const inboundTextCount = parseHostedWhatsAppInboundTexts(body).length;
    if (inboundTextCount === 0) {
      const plan = await planHostedOnboardingWhatsAppWebhook({
        body,
      });
      responseReason = plan.response.reason ?? null;
      finishHostedOnboardingTiming(timing, "completed", {
        commandHandledCount: plan.response.commandHandledCount,
        inboundTextCount: plan.response.inboundTextCount,
        responseReason,
        routedTextCount: plan.response.routedTextCount,
        signalAbortedBeforeReturn: input.signal?.aborted ?? false,
        wakeHandoffCount: 0,
      });
      return plan.response;
    }

    const prisma = input.prisma ?? getPrisma();
    const plan = await runHostedOnboardingWebhookTransaction(
      prisma,
      (transaction) =>
        planHostedOnboardingWhatsAppWebhook({
          body,
          prisma: transaction,
        }),
    );

    if (plan.desiredSideEffects.length > 0 || plan.wakeMailboxItemId || plan.wakeUserId) {
      throw new Error(
        "Hosted WhatsApp webhook planning unexpectedly requested legacy runtime side effects.",
      );
    }

    const wakeHandoffs = plan.wakeHandoffs ?? [];
    for (const wakeHandoff of wakeHandoffs) {
      await maybeHandoffHostedExecutionWebhookWake({
        eventId: wakeHandoff.eventId,
        mailboxItemId: wakeHandoff.mailboxItemId,
        response: plan.response,
        source: "whatsapp",
        userId: wakeHandoff.userId,
      });
    }

    responseReason = plan.response.reason ?? null;
    finishHostedOnboardingTiming(timing, "completed", {
      commandHandledCount: plan.response.commandHandledCount,
      inboundTextCount: plan.response.inboundTextCount,
      responseReason,
      routedTextCount: plan.response.routedTextCount,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
      wakeHandoffCount: wakeHandoffs.length,
    });
    return plan.response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    throw error;
  }
}

async function runHostedOnboardingWebhookTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as Prisma.TransactionClient);
}
