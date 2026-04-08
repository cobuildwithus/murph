import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  requireHostedLinqMessageReceivedEvent,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import {
  requireHostedStripeWebhookVerificationConfig,
} from "./runtime";
import { drainHostedExecutionOutboxBestEffort } from "../hosted-execution/outbox";
import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "./stripe-event-reconciliation";
import { drainHostedRevnetIssuanceSubmissionQueue } from "./stripe-revnet-issuance";
import { assertHostedTelegramWebhookSecret, buildHostedTelegramWebhookEventId, parseHostedTelegramWebhookUpdate } from "./telegram";
import {
  claimHostedWebhookReceiptForContinuation,
  continueHostedWebhookReceipt,
  listHostedWebhookReceiptContinuationCandidates,
  runHostedWebhookWithReceipt,
} from "./webhook-receipts";
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
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
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
  const response = await runHostedWebhookWithReceipt({
    deferSideEffectDrain: input.defer,
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: event.event_id,
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
  await maybeDrainHostedExecutionWebhookDispatch({
    eventId: event.event_id,
    prisma,
    response,
  });
  return response;
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
  const response = await runHostedWebhookWithReceipt({
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: buildHostedTelegramWebhookEventId(update),
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
  await maybeDrainHostedExecutionWebhookDispatch({
    eventId: buildHostedTelegramWebhookEventId(update),
    prisma,
    response,
  });
  return response;
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
  }

  return {
    duplicate: recorded.duplicate || undefined,
    ok: true,
    type: recorded.type,
  };
}

export async function continueHostedOnboardingWebhookReceiptBestEffort(input: {
  eventId: string;
  prisma?: PrismaClient;
  signal?: AbortSignal;
  source: "linq" | "telegram";
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  try {
    const claimedReceipt = await claimHostedWebhookReceiptForContinuation({
      eventId: input.eventId,
      prisma,
      source: input.source,
    });

    if (!claimedReceipt) {
      return;
    }

    await continueHostedWebhookReceipt({
      claimedReceipt,
      eventId: input.eventId,
      handlers: createHostedWebhookReceiptHandlers(),
      prisma,
      signal: input.signal,
      source: input.source,
    });
  } catch (error) {
    console.error(
      "Hosted webhook receipt continuation failed.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function drainHostedOnboardingWebhookReceipts(input: {
  limit?: number;
  prisma?: PrismaClient;
} = {}): Promise<Array<{
  eventId: string;
  source: string;
  status: "continued" | "failed" | "skipped";
}>> {
  const prisma = input.prisma ?? getPrisma();
  const candidates = await listHostedWebhookReceiptContinuationCandidates({
    limit: input.limit,
    prisma,
  });
  const drained: Array<{
    eventId: string;
    source: string;
    status: "continued" | "failed" | "skipped";
  }> = [];

  for (const candidate of candidates) {
    let claimedReceipt;

    try {
      claimedReceipt = await claimHostedWebhookReceiptForContinuation({
        eventId: candidate.eventId,
        prisma,
        source: candidate.source,
      });
    } catch (error) {
      if (isHostedWebhookReceiptInProgressError(error)) {
        drained.push({
          eventId: candidate.eventId,
          source: candidate.source,
          status: "skipped",
        });
        continue;
      }

      console.error(
        "Hosted webhook receipt claim failed during cron recovery.",
        error instanceof Error ? error.message : String(error),
      );
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "failed",
      });
      continue;
    }

    if (!claimedReceipt) {
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "skipped",
      });
      continue;
    }

    try {
      await continueHostedWebhookReceipt({
        claimedReceipt,
        eventId: candidate.eventId,
        handlers: createHostedWebhookReceiptHandlers(),
        prisma,
        source: candidate.source,
      });
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "continued",
      });
    } catch {
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "failed",
      });
    }
  }

  return drained;
}

function isHostedWebhookReceiptInProgressError(error: unknown): boolean {
  return isHostedOnboardingError(error) && error.code === "WEBHOOK_RECEIPT_IN_PROGRESS";
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

async function maybeDrainHostedExecutionWebhookDispatch(input: {
  eventId: string;
  prisma: PrismaClient;
  response:
    | HostedOnboardingLinqWebhookResponse
    | HostedOnboardingTelegramWebhookResponse;
}): Promise<void> {
  if (input.response.reason !== "dispatched-active-member") {
    return;
  }

  await drainHostedExecutionOutboxBestEffort({
    eventIds: [
      input.eventId,
    ],
    limit: 1,
    prisma: input.prisma,
  });
}
