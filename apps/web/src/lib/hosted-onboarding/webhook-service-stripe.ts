import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  requireHostedStripeWebhookVerificationConfig,
} from "./runtime";
import {
  recordHostedStripeEvent,
} from "./stripe-event-reconciliation";
import {
  prepareDuplicateHostedStripeWebhookEventForWorkflowRetry,
} from "./stripe-webhook-reconciliation";
import { scheduleHostedStripePaymentFailureEventAlert } from "./stripe-alert-email";
import {
  startHostedStripeWebhookReconciliationWorkflow,
} from "./stripe-webhook-workflow-start";
import type { HostedStripeWebhookResponse } from "./webhook-service-types";

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
    scheduleHostedStripePaymentFailureEventAlert({
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
    });
  }

  await handoffHostedStripeWebhookReconciliation({
    duplicate: recorded.duplicate,
    eventId: event.id,
    prisma,
  });

  return {
    duplicate: recorded.duplicate || undefined,
    ok: true,
    type: recorded.type,
  };
}

async function handoffHostedStripeWebhookReconciliation(input: {
  duplicate: boolean;
  eventId: string;
  prisma: PrismaClient;
}): Promise<void> {
  if (input.duplicate) {
    const shouldSkip = await prepareDuplicateHostedStripeWebhookEventForWorkflowRetry(
      input.eventId,
      input.prisma,
    );

    if (shouldSkip) {
      return;
    }
  }

  await startHostedStripeWebhookReconciliationWorkflow({
    eventId: input.eventId,
  });
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
    console.error("Hosted Stripe webhook verification failed.");
    throw hostedOnboardingError({
      code: "STRIPE_SIGNATURE_INVALID",
      message: error instanceof Error ? error.message : "Invalid Stripe webhook signature.",
      httpStatus: 401,
    });
  }
}
