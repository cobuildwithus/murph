import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  requireHostedLinqMessageReceivedEvent,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import {
  requireHostedStripeWebhookVerificationConfig,
} from "./runtime";
import { drainHostedExecutionOutboxBestEffort } from "../hosted-execution/outbox";
import { drainHostedActivationWelcomeMessages } from "./activation-welcome";
import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "./stripe-event-queue";
import { drainHostedRevnetIssuanceSubmissionQueue } from "./stripe-revnet-issuance";
import { assertHostedTelegramWebhookSecret, buildHostedTelegramWebhookEventId, parseHostedTelegramWebhookUpdate } from "./telegram";
import { runHostedWebhookWithReceipt } from "./webhook-receipts";
import {
  planHostedOnboardingLinqWebhook,
  type HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq";
import {
  planHostedOnboardingTelegramWebhook,
  type HostedOnboardingTelegramWebhookResponse,
} from "./webhook-provider-telegram";
import { createHostedWebhookReceiptHandlers } from "./webhook-transport";

export type HostedStripeWebhookResponse = {
  duplicate?: boolean;
  ok: true;
  type: string;
};

export async function handleHostedOnboardingLinqWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  const event = verifyAndParseHostedLinqWebhookRequest({
    rawBody: input.rawBody,
    signature: input.signature,
    timestamp: input.timestamp,
  });
  const prisma = input.prisma ?? getPrisma();
  if (event.event_type === "message.received") {
    requireHostedLinqMessageReceivedEvent(event);
  }
  return runHostedWebhookWithReceipt({
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: event.event_id,
    eventPayload: {
      eventType: event.event_type,
    },
    handlers: createHostedWebhookReceiptHandlers(),
    plan: (transaction) =>
      planHostedOnboardingLinqWebhook({
        event,
        prisma: transaction,
      }),
    prisma,
    signal: input.signal,
    source: "linq",
  });
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
  return runHostedWebhookWithReceipt({
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: buildHostedTelegramWebhookEventId(update),
    eventPayload: {
      updateId: update.update_id,
    },
    handlers: createHostedWebhookReceiptHandlers(),
    plan: (transaction) =>
      planHostedOnboardingTelegramWebhook({
        prisma: transaction,
        update,
      }),
    prisma,
    signal: input.signal,
    source: "telegram",
  });
}

export async function handleHostedStripeWebhook(input: {
  rawBody: string;
  signature: string | null;
  prisma?: PrismaClient;
}): Promise<HostedStripeWebhookResponse> {
  const prisma = input.prisma ?? getPrisma();
  const { stripe, webhookSecret } = requireHostedStripeWebhookVerificationConfig();

  if (!webhookSecret) {
    throw hostedOnboardingError({
      code: "STRIPE_WEBHOOK_SECRET_REQUIRED",
      message: "STRIPE_WEBHOOK_SECRET must be configured for Stripe webhooks.",
      httpStatus: 500,
    });
  }

  if (!input.signature) {
    throw hostedOnboardingError({
      code: "STRIPE_SIGNATURE_REQUIRED",
      message: "Missing Stripe webhook signature.",
      httpStatus: 401,
    });
  }

  const event = constructStripeWebhookEvent({
    rawBody: input.rawBody,
    signature: input.signature,
    stripe,
    webhookSecret,
  });

  const recorded = await recordHostedStripeEvent({
    event,
    prisma,
  });

  if (!recorded.duplicate) {
    const reconciled = await reconcileHostedStripeEventById({
      eventId: event.id,
      prisma,
    });

    if (reconciled?.createdOrUpdatedRevnetIssuance) {
      await drainHostedRevnetIssuanceSubmissionQueueBestEffort(prisma);
    }

    if (reconciled?.hostedExecutionEventId) {
      await drainHostedExecutionOutboxBestEffort({
        eventIds: [
          reconciled.hostedExecutionEventId,
        ],
        limit: 1,
        prisma,
      });
    }

    if (reconciled?.activatedMemberId) {
      await drainHostedActivationWelcomeMessages({
        memberIds: [
          reconciled.activatedMemberId,
        ],
        prisma,
      });
    }
  }

  return {
    duplicate: recorded.duplicate || undefined,
    ok: true,
    type: recorded.type,
  };
}

function constructStripeWebhookEvent(input: {
  rawBody: string;
  signature: string;
  stripe: ReturnType<typeof requireHostedStripeWebhookVerificationConfig>["stripe"];
  webhookSecret: string;
}): Stripe.Event {
  try {
    return input.stripe.webhooks.constructEvent(input.rawBody, input.signature, input.webhookSecret);
  } catch (error) {
    throw hostedOnboardingError({
      code: "STRIPE_SIGNATURE_INVALID",
      message: error instanceof Error ? error.message : "Invalid Stripe webhook signature.",
      httpStatus: 401,
    });
  }
}

async function drainHostedRevnetIssuanceSubmissionQueueBestEffort(
  prisma: PrismaClient,
): Promise<void> {
  try {
    await drainHostedRevnetIssuanceSubmissionQueue({
      limit: 1,
      prisma,
    });
  } catch (error) {
    console.error(
      "Hosted RevNet issuance best-effort drain failed.",
      error instanceof Error ? error.message : String(error),
    );
  }
}
