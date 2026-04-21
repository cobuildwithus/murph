import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import {
  nudgeHostedRunBestEffort,
} from "../hosted-ingress/control";
import { hostedOnboardingError } from "./errors";
import { sanitizeHostedOnboardingLogString } from "./http";
import {
  requireHostedStripeWebhookVerificationConfig,
} from "./runtime";
import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "./stripe-event-reconciliation";
import { drainHostedRevnetIssuanceSubmissionQueue } from "./stripe-revnet-issuance";
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
    await reconcileHostedStripeWebhookEvent({
      eventId: event.id,
      prisma,
    });
  }

  return {
    duplicate: recorded.duplicate || undefined,
    ok: true,
    type: recorded.type,
  };
}

async function reconcileHostedStripeWebhookEvent(input: {
  eventId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const reconciled = await reconcileHostedStripeEventById({
    eventId: input.eventId,
    prisma: input.prisma,
  });

  if (reconciled?.createdOrUpdatedRevnetIssuance) {
    await drainHostedRevnetIssuanceSubmissionQueueBestEffort(input.prisma);
  }

  const hostedExecutionEventId = reconciled?.hostedExecutionEventId ?? null;
  const hostedExecutionMemberId = reconciled?.activatedMemberId ?? null;

  if (!hostedExecutionEventId || !hostedExecutionMemberId) {
    return;
  }

  await nudgeHostedRunBestEffort({
    context: "stripe.webhook",
    userId: hostedExecutionMemberId,
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
      sanitizeHostedOnboardingLogString(
        error instanceof Error ? error.message : String(error),
      ) ?? "Unknown error.",
    );
  }
}
