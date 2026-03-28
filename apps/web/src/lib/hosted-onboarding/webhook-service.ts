import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  assertHostedLinqWebhookSignature,
  parseHostedLinqWebhookEvent,
} from "./linq";
import {
  requireHostedOnboardingStripeClient,
} from "./runtime";
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
import {
  planHostedStripeWebhook,
  type HostedStripeWebhookResponse,
} from "./webhook-provider-stripe";
import { createHostedWebhookReceiptHandlers } from "./webhook-transport";

export async function handleHostedOnboardingLinqWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  assertHostedLinqWebhookSignature({
    payload: input.rawBody,
    signature: input.signature,
    timestamp: input.timestamp,
  });

  const prisma = input.prisma ?? getPrisma();
  const event = parseHostedLinqWebhookEvent(input.rawBody);
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
        prisma: transaction as PrismaClient,
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
        prisma: transaction as PrismaClient,
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
  const { stripe, webhookSecret } = requireHostedOnboardingStripeClient();

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

  return runHostedWebhookWithReceipt({
    duplicateResponse: {
      ok: true,
      duplicate: true,
      type: event.type,
    },
    eventId: event.id,
    eventPayload: {
      type: event.type,
    },
    handlers: createHostedWebhookReceiptHandlers(),
    plan: (transaction) =>
      planHostedStripeWebhook({
        event,
        prisma: transaction as PrismaClient,
      }),
    prisma,
    source: "stripe",
  });
}

function constructStripeWebhookEvent(input: {
  rawBody: string;
  signature: string;
  stripe: ReturnType<typeof requireHostedOnboardingStripeClient>["stripe"];
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
