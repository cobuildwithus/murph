import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { sanitizeHostedOnboardingLogString } from "./http";
import {
  claimHostedWebhookReceiptForContinuation,
  continueHostedWebhookReceipt,
  listHostedWebhookReceiptContinuationCandidates,
  HostedWebhookReceiptSideEffectDrainError,
  type HostedWebhookPlan,
  type HostedWebhookReceiptClaim,
  type HostedWebhookSideEffect,
} from "./webhook-receipts";
import {
  markHostedWebhookReceiptFailed,
  queueHostedWebhookReceiptSideEffects,
  recordHostedWebhookReceipt,
} from "./webhook-receipt-store";
import { createHostedWebhookReceiptHandlers } from "./webhook-transport";
import { isHostedOnboardingError } from "./errors";
import type { HostedWebhookServiceResponse } from "./webhook-service-types";

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
        sanitizeHostedOnboardingLogString(
          error instanceof Error ? error.message : String(error),
        ) ?? "Unknown error.",
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

export async function drainHostedWebhookSideEffectsDirect(input: {
  handlers: ReturnType<typeof createHostedWebhookReceiptHandlers>;
  prisma: PrismaClient;
  sideEffects: readonly HostedWebhookSideEffect[];
  signal?: AbortSignal;
}): Promise<void> {
  for (const effect of input.sideEffects) {
    await input.handlers.performSideEffect(effect, {
      prisma: input.prisma,
      signal: input.signal,
    });

    if (input.handlers.afterSideEffectSent) {
      await input.handlers.afterSideEffectSent({
        effect,
        prisma: input.prisma,
      });
    }
  }
}

export async function processHostedOnboardingWebhookPlan<
  TResult extends HostedWebhookServiceResponse,
>(input: {
  deferSideEffectDrain?: (drain: () => Promise<void>) => Promise<void> | void;
  duplicateResponse: TResult;
  eventId: string;
  handlers: ReturnType<typeof createHostedWebhookReceiptHandlers>;
  plan: (prisma: Prisma.TransactionClient) => Promise<HostedWebhookPlan<TResult>>;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: "linq" | "telegram";
}): Promise<{
  response: TResult;
}> {
  let claimedReceipt = await recordHostedWebhookReceipt({
    eventId: input.eventId,
    prisma: input.prisma,
    source: input.source,
  });

  if (!claimedReceipt) {
    return {
      response: input.duplicateResponse,
    };
  }

  const activeClaim = claimedReceipt;
  let response: TResult | null = null;

  try {
    if (!activeClaim.state.plannedAt) {
      const plannedResult = await runHostedOnboardingWebhookTransaction(
        input.prisma,
        async (transaction) => {
          const plan = await input.plan(transaction);
          const nextClaim = await queueHostedWebhookReceiptSideEffects({
            claimedReceipt: activeClaim,
            desiredSideEffects: plan.desiredSideEffects,
            eventId: input.eventId,
            prisma: transaction,
            source: input.source,
          });

          return {
            claimedReceipt: nextClaim,
            response: plan.response,
          };
        },
      );

      claimedReceipt = plannedResult.claimedReceipt;
      response = plannedResult.response;
    }

    if (input.deferSideEffectDrain && hasDeferredHostedWebhookSideEffects(claimedReceipt)) {
      const deferredClaim = claimedReceipt;

      try {
        await input.deferSideEffectDrain(() =>
          continueHostedWebhookReceipt({
            claimedReceipt: deferredClaim,
            eventId: input.eventId,
            handlers: input.handlers,
            markFailure: true,
            prisma: input.prisma,
            source: input.source,
          }),
        );
        return {
          response: response ?? input.duplicateResponse,
        };
      } catch (error) {
        console.error(
          "Hosted webhook side-effect drain scheduling failed.",
          sanitizeHostedOnboardingLogString(
            error instanceof Error ? error.message : String(error),
          ) ?? "Unknown error.",
        );
      }
    }

    await continueHostedWebhookReceipt({
      claimedReceipt,
      eventId: input.eventId,
      handlers: input.handlers,
      markFailure: false,
      prisma: input.prisma,
      signal: input.signal,
      source: input.source,
    });

    return {
      response: response ?? input.duplicateResponse,
    };
  } catch (error) {
    const failure = error instanceof HostedWebhookReceiptSideEffectDrainError
      ? error.cause
      : error;
    claimedReceipt = error instanceof HostedWebhookReceiptSideEffectDrainError
      ? error.claimedReceipt
      : claimedReceipt;

    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error: failure,
      eventId: input.eventId,
      prisma: input.prisma,
      source: input.source,
    });
    throw failure;
  }
}

export async function runHostedOnboardingWebhookTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as Prisma.TransactionClient);
}

function isHostedWebhookReceiptInProgressError(error: unknown): boolean {
  return isHostedOnboardingError(error) && error.code === "WEBHOOK_RECEIPT_IN_PROGRESS";
}

function hasDeferredHostedWebhookSideEffects(
  claimedReceipt: HostedWebhookReceiptClaim,
): boolean {
  return claimedReceipt.state.sideEffects.length > 0;
}
