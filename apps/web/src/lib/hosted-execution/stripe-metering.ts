import type { PrismaClient } from "@prisma/client";

import {
  markHostedAiUsageStripeFailed,
  listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeMetered,
  markHostedAiUsageStripeRetryableFailure,
  markHostedAiUsageStripeSkipped,
  type HostedAiUsageStripeCandidate,
} from "./usage";

const STRIPE_METER_EVENTS_URL = "https://api.stripe.com/v1/billing/meter_events";
const DEFAULT_STRIPE_METER_BATCH_LIMIT = 32;
const STRIPE_METER_RETRY_BASE_DELAY_MS = 5 * 60_000;
const STRIPE_METER_RETRY_MAX_DELAY_MS = 24 * 60 * 60_000;

export interface HostedAiUsageStripeMeterEnvironment {
  meterEventName: string | null;
  stripeSecretKey: string | null;
  batchLimit: number;
}

export interface HostedAiUsageStripeDrainResult {
  configured: boolean;
  failed: number;
  metered: number;
  skipped: number;
}

export async function drainHostedAiUsageStripeMetering(input: {
  environment?: HostedAiUsageStripeMeterEnvironment;
  fetchImpl?: typeof fetch;
  now?: Date | string;
  prisma?: PrismaClient;
} = {}): Promise<HostedAiUsageStripeDrainResult> {
  const environment = input.environment ?? readHostedAiUsageStripeMeterEnvironment(process.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  const attemptedAt = normalizeStripeMeterDate(input.now ?? new Date().toISOString(), "now");

  if (!environment.stripeSecretKey || !environment.meterEventName) {
    return {
      configured: false,
      failed: 0,
      metered: 0,
      skipped: 0,
    };
  }

  const candidates = await listHostedAiUsagePendingStripeMetering({
    limit: environment.batchLimit,
    now: attemptedAt,
    prisma: input.prisma,
  });
  let metered = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const skipReason = resolveHostedAiUsageStripeSkipReason(candidate);

    if (skipReason) {
      await markHostedAiUsageStripeSkipped({
        attemptedAt,
        id: candidate.id,
        message: skipReason,
        prisma: input.prisma,
      });
      skipped += 1;
      continue;
    }

    const value = resolveHostedAiUsageStripeValue(candidate);

    if (value === null) {
      await markHostedAiUsageStripeSkipped({
        attemptedAt,
        id: candidate.id,
        message: "Skipped Stripe AI metering because no positive token count was available.",
        prisma: input.prisma,
      });
      skipped += 1;
      continue;
    }

    try {
      await createHostedAiUsageStripeMeterEvent({
        eventName: environment.meterEventName,
        fetchImpl,
        identifier: candidate.id,
        occurredAt: candidate.occurredAt,
        stripeCustomerId: candidate.stripeCustomerId,
        stripeSecretKey: environment.stripeSecretKey,
        value,
      });
      await markHostedAiUsageStripeMetered({
        attemptedAt,
        id: candidate.id,
        identifier: candidate.id,
        prisma: input.prisma,
      });
      metered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (shouldRetryStripeMeterEvent(error)) {
        await markHostedAiUsageStripeRetryableFailure({
          attemptedAt,
          id: candidate.id,
          message,
          nextAttemptAt: computeHostedAiUsageStripeRetryAt({
            attemptedAt,
            nextAttemptCount: candidate.stripeMeterAttemptCount + 1,
          }),
          prisma: input.prisma,
        });
      } else {
        await markHostedAiUsageStripeFailed({
          attemptedAt,
          id: candidate.id,
          message,
          prisma: input.prisma,
        });
      }
      failed += 1;
    }
  }

  return {
    configured: true,
    failed,
    metered,
    skipped,
  };
}

export function readHostedAiUsageStripeMeterEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): HostedAiUsageStripeMeterEnvironment {
  return {
    meterEventName: normalizeOptionalString(source.HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME),
    stripeSecretKey: normalizeOptionalString(source.STRIPE_SECRET_KEY),
    batchLimit: readPositiveInteger(
      normalizeOptionalString(source.HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT),
      DEFAULT_STRIPE_METER_BATCH_LIMIT,
      "HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT",
    ),
  };
}

async function createHostedAiUsageStripeMeterEvent(input: {
  eventName: string;
  fetchImpl: typeof fetch;
  identifier: string;
  occurredAt: Date;
  stripeCustomerId: string;
  stripeSecretKey: string;
  value: number;
}): Promise<void> {
  const body = new URLSearchParams();
  body.set("event_name", input.eventName);
  body.set("identifier", input.identifier);
  body.set("payload[stripe_customer_id]", input.stripeCustomerId);
  body.set("payload[value]", String(input.value));
  body.set("timestamp", String(Math.floor(input.occurredAt.getTime() / 1000)));

  const response = await input.fetchImpl(STRIPE_METER_EVENTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.identifier,
    },
    body,
  });
  if (!response.ok) {
    throw new StripeMeterEventError(
      `Stripe meter event ${input.identifier} failed with HTTP ${response.status}.`,
      response.status,
    );
  }
}

function resolveHostedAiUsageStripeSkipReason(
  candidate: HostedAiUsageStripeCandidate,
): string | null {
  if (candidate.credentialSource === "platform") {
    return null;
  }

  return candidate.credentialSource === "member"
    ? "Skipped Stripe AI metering because the run used member-supplied credentials."
    : "Skipped Stripe AI metering because the credential source could not be proven platform-owned.";
}

function resolveHostedAiUsageStripeValue(
  candidate: HostedAiUsageStripeCandidate,
): number | null {
  const totalTokens = normalizePositiveTokenCount(candidate.totalTokens);

  if (totalTokens !== null) {
    return totalTokens;
  }

  const fallbackTokenTotal = [candidate.inputTokens, candidate.outputTokens]
    .map(normalizePositiveTokenCount)
    .reduce<number>((sum, value) => sum + (value ?? 0), 0);

  return fallbackTokenTotal > 0 ? fallbackTokenTotal : null;
}

function normalizePositiveTokenCount(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function computeHostedAiUsageStripeRetryAt(input: {
  attemptedAt: Date;
  nextAttemptCount: number;
}): Date {
  const exponent = Math.max(0, input.nextAttemptCount - 1);
  const delayMs = Math.min(
    STRIPE_METER_RETRY_MAX_DELAY_MS,
    STRIPE_METER_RETRY_BASE_DELAY_MS * (2 ** exponent),
  );

  return new Date(input.attemptedAt.getTime() + delayMs);
}

function normalizeStripeMeterDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Hosted AI usage Stripe metering ${label} must be a valid date.`);
  }

  return date;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readPositiveInteger(value: string | null, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return parsed;
}

function shouldRetryStripeMeterEvent(error: unknown): boolean {
  if (!(error instanceof StripeMeterEventError)) {
    return true;
  }

  return error.status === 408 || error.status === 429 || error.status >= 500;
}

class StripeMeterEventError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StripeMeterEventError";
  }
}
