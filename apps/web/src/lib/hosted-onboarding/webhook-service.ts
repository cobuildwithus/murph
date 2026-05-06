import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  requireHostedLinqMessageReceivedEvent,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
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
  sanitizeHostedOnboardingStructuredLogDetails,
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

export async function handleHostedOnboardingLinqWebhook(input: {
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
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      signalAbortedAfterVerify: input.signal?.aborted ?? false,
    });

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
      linqChatId: plan.wakeLinqChatId,
      mailboxItemId: plan.wakeMailboxItemId,
      response: plan.response,
      source: "linq",
      userId: plan.wakeUserId,
    });

    console.warn(
      "Hosted Linq webhook outcome.",
      sanitizeHostedOnboardingStructuredLogDetails({
        desiredSideEffectCount: plan.desiredSideEffects.length,
        duplicate: Boolean(plan.response.duplicate),
        elapsedMs: Date.now() - timing.startedAtMs,
        eventType,
        ok: plan.response.ok,
        responseReason,
        wakeHandoffReason: wakeHandoff?.reason ?? null,
        wakeHandoffRunnerNudgeAccepted: wakeHandoff?.runnerNudgeAccepted ?? false,
        wakeHandoffStarted: wakeHandoff?.started ?? false,
        wakeHandoffWorkflowStarted: wakeHandoff?.workflowStarted ?? false,
        wakeUserPresent: Boolean(plan.wakeUserId),
      }),
    );

    finishHostedOnboardingTiming(timing, "completed", {
      duplicate: Boolean(plan.response.duplicate),
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
      wakeHandoffReason: wakeHandoff?.reason ?? null,
      wakeHandoffRunnerNudgeAccepted: wakeHandoff?.runnerNudgeAccepted ?? false,
      wakeHandoffStarted: wakeHandoff?.started ?? false,
      wakeHandoffWorkflowStarted: wakeHandoff?.workflowStarted ?? false,
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

async function runHostedOnboardingWebhookTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as Prisma.TransactionClient);
}
