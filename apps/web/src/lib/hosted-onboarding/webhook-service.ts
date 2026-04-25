import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  requireHostedLinqMessageReceivedEvent,
  sendHostedLinqTypingPing,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import { getHostedOnboardingEnvironment } from "./runtime";
import { assertHostedTelegramWebhookSecret, buildHostedTelegramWebhookEventId, parseHostedTelegramWebhookUpdate } from "./telegram";
import {
  planHostedOnboardingLinqWebhook,
  type HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq";
import {
  planHostedOnboardingTelegramWebhook,
  type HostedOnboardingTelegramWebhookResponse,
} from "./webhook-provider-telegram";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
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

export async function handleHostedOnboardingLinqWebhook(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  rawBody: string;
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
      eventId,
      eventType,
      signalAbortedAfterVerify: input.signal?.aborted ?? false,
    });

    if (event.event_type === "message.received") {
      requireHostedLinqMessageReceivedEvent(event);
    }

    const prisma = input.prisma ?? getPrisma();
    const plan = await runHostedOnboardingWebhookTransaction(
      prisma,
      (transaction) =>
        planHostedOnboardingLinqWebhook({
          event,
          prisma: transaction,
        }),
    );

    if (plan.desiredSideEffects.length > 0) {
      await drainHostedLinqSideEffectsDirect({
        prisma,
        sideEffects: plan.desiredSideEffects,
        signal: input.signal,
      });
    }

    await maybeStartHostedLinqIngressTypingDiagnostic({
      defer: input.defer,
      plan,
      signal: input.signal,
    });

    responseReason = plan.response.reason ?? null;
    await maybeHandoffHostedExecutionWebhookWake({
      defer: input.defer,
      eventId: event.event_id,
      response: plan.response,
      source: "linq",
      userId: plan.wakeUserId,
    });
    finishHostedOnboardingTiming(timing, "completed", {
      duplicate: Boolean(plan.response.duplicate),
      eventId,
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    return plan.response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      eventId,
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    throw error;
  }
}

async function maybeStartHostedLinqIngressTypingDiagnostic(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  plan: Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>;
  signal?: AbortSignal;
}): Promise<void> {
  const chatId = input.plan.ingressTypingChatId?.trim() ?? "";

  if (chatId.length === 0) {
    return;
  }

  const environment = getHostedOnboardingEnvironment();

  if (!environment.linqIngressTypingDiagnosticEnabled) {
    return;
  }

  const burstDelaysMs = environment.linqIngressTypingDiagnosticBurstDelaysMs;
  const burstMode = environment.linqIngressTypingDiagnosticBurstMode;
  const immediateDelaysMs = burstDelaysMs.filter((delayMs) => delayMs === 0);
  const deferredDelaysMs = burstDelaysMs.filter((delayMs) => delayMs > 0);
  const responseReason = input.plan.response.reason ?? null;
  const timeoutMs = environment.linqIngressTypingDiagnosticTimeoutMs;

  if (burstMode === "inline") {
    const burstTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.ingress-typing-burst",
      {
        burstMode,
        inlineAttempts: burstDelaysMs.length,
        responseReason,
        totalAttempts: burstDelaysMs.length,
      },
    );

    await runHostedLinqIngressTypingDiagnosticBurst({
      attemptOffset: 0,
      burstMode,
      chatId,
      delaysMs: burstDelaysMs,
      responseReason,
      signal: input.signal,
      timeoutMs,
      totalAttempts: burstDelaysMs.length,
    });

    finishHostedOnboardingTiming(burstTiming, "completed", {
      burstMode,
      deferred: false,
      responseReason,
    });
    return;
  }

  await runHostedLinqIngressTypingDiagnosticBurst({
    attemptOffset: 0,
    burstMode,
    chatId,
    delaysMs: immediateDelaysMs.length > 0 ? immediateDelaysMs : [0],
    responseReason,
    signal: input.signal,
    timeoutMs,
    totalAttempts: burstDelaysMs.length,
  });

  if (deferredDelaysMs.length === 0) {
    return;
  }

  const burstTiming = startHostedOnboardingTiming(
    "hosted-onboarding.webhook.linq.ingress-typing-burst",
    {
      burstMode,
      deferredAttempts: deferredDelaysMs.length,
      responseReason,
      totalAttempts: burstDelaysMs.length,
    },
  );

  if (!input.defer) {
    finishHostedOnboardingTiming(burstTiming, "skipped", {
      burstMode,
      deferred: false,
      responseReason,
    });
    return;
  }

  try {
    await input.defer(async () => {
      await runHostedLinqIngressTypingDiagnosticBurst({
        attemptOffset: immediateDelaysMs.length,
        burstMode,
        chatId,
        delaysMs: deferredDelaysMs,
        responseReason,
        timeoutMs,
        totalAttempts: burstDelaysMs.length,
      });
    });

    finishHostedOnboardingTiming(burstTiming, "scheduled", {
      burstMode,
      deferred: true,
      responseReason,
    });
  } catch (error) {
    finishHostedOnboardingTiming(burstTiming, "failed", {
      burstMode,
      errorName: deriveHostedOnboardingTimingErrorName(error),
      responseReason,
    });
  }
}

async function runHostedLinqIngressTypingDiagnosticBurst(input: {
  attemptOffset: number;
  burstMode: string;
  chatId: string;
  delaysMs: readonly number[];
  responseReason: string | null;
  signal?: AbortSignal;
  timeoutMs: number;
  totalAttempts: number;
}): Promise<void> {
  let previousDelayMs = 0;

  for (const [index, delayMs] of input.delaysMs.entries()) {
    const waitMs = Math.max(0, delayMs - previousDelayMs);
    previousDelayMs = delayMs;

    if (waitMs > 0) {
      await waitForHostedLinqIngressTypingDiagnosticDelay(waitMs);
    }

    const attempt = input.attemptOffset + index + 1;
    const typingTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.ingress-typing",
      {
        burstAttempt: attempt,
        burstDelayMs: delayMs,
        burstMode: input.burstMode,
        burstTotal: input.totalAttempts,
        chatIdPresent: true,
        responseReason: input.responseReason,
        timeoutMs: input.timeoutMs,
      },
    );

    try {
      const result = await sendHostedLinqTypingPing({
        chatId: input.chatId,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      });

      finishHostedOnboardingTiming(typingTiming, result.ok ? "started" : "failed", {
        burstAttempt: attempt,
        burstDelayMs: delayMs,
        burstMode: input.burstMode,
        burstTotal: input.totalAttempts,
        httpStatus: result.status,
        responseReason: input.responseReason,
        signalAbortedAfterTyping: input.signal?.aborted ?? false,
      });
    } catch (error) {
      finishHostedOnboardingTiming(typingTiming, "failed", {
        burstAttempt: attempt,
        burstDelayMs: delayMs,
        burstMode: input.burstMode,
        burstTotal: input.totalAttempts,
        errorName: deriveHostedOnboardingTimingErrorName(error),
        responseReason: input.responseReason,
        signalAbortedAfterTyping: input.signal?.aborted ?? false,
      });
    }
  }
}

function waitForHostedLinqIngressTypingDiagnosticDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function handleHostedOnboardingTelegramWebhook(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
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
    defer: input.defer,
    eventId,
    response: plan.response,
    source: "telegram",
    userId: plan.wakeUserId,
  });
  return plan.response;
}

async function runHostedOnboardingWebhookTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as Prisma.TransactionClient);
}
