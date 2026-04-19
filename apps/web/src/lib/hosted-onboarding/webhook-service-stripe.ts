import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import {
  handoffHostedExecutionWakeBestEffort,
} from "../hosted-wake/control";
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
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
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
      if (input.defer) {
        await input.defer(() => drainHostedRevnetIssuanceSubmissionQueueBestEffort(prisma));
      } else {
        await drainHostedRevnetIssuanceSubmissionQueueBestEffort(prisma);
      }
    }

    const hostedExecutionEventId = reconciled?.hostedExecutionEventId ?? null;

    const hostedExecutionMemberId = reconciled?.activatedMemberId ?? null;

    if (hostedExecutionEventId && hostedExecutionMemberId) {
      if (input.defer) {
        await input.defer(async () => {
          await handoffHostedExecutionWakeBestEffort({
            context: "stripe.webhook",
            eventId: hostedExecutionEventId,
            prisma,
            userId: hostedExecutionMemberId,
          });
        });
      } else {
        await handoffHostedExecutionWakeBestEffort({
          context: "stripe.webhook",
          eventId: hostedExecutionEventId,
          prisma,
          userId: hostedExecutionMemberId,
        });
      }
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
      sanitizeHostedOnboardingLogString(
        error instanceof Error ? error.message : String(error),
      ) ?? "Unknown error.",
    );
  }
}
