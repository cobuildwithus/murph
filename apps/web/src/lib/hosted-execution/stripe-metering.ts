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

export async function drainHostedAiUsageStripeMetering(): Promise<HostedAiUsageStripeDrainResult> {
  const environment = readHostedAiUsageStripeMeterEnvironment(process.env);

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
  });
  let metered = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    if (candidate.credentialSource !== "platform") {
      await markHostedAiUsageStripeSkipped({
        id: candidate.id,
        message: "Skipped Stripe AI metering because the run did not use platform credentials.",
      });
      skipped += 1;
      continue;
    }

    const stripeCustomerId = candidate.stripeCustomerId;
    const value = resolveHostedAiUsageStripeValue(candidate);

    if (value === null) {
      await markHostedAiUsageStripeSkipped({
        id: candidate.id,
        message: "Skipped Stripe AI metering because no total token count was available.",
      });
      skipped += 1;
      continue;
    }

    try {
      await createHostedAiUsageStripeMeterEvent({
        eventName: environment.meterEventName,
        identifier: candidate.id,
        occurredAt: candidate.occurredAt,
        stripeCustomerId,
        stripeSecretKey: environment.stripeSecretKey,
        value,
      });
      await markHostedAiUsageStripeMetered({
        id: candidate.id,
        identifier: candidate.id,
      });
      metered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (shouldRetryStripeMeterEvent(error)) {
        await markHostedAiUsageStripeRetryableFailure({
          id: candidate.id,
          message,
        });
      } else {
        await markHostedAiUsageStripeFailed({
          id: candidate.id,
          message,
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

  const response = await fetch(STRIPE_METER_EVENTS_URL, {
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

function resolveHostedAiUsageStripeValue(
  candidate: HostedAiUsageStripeCandidate,
): number | null {
  if (typeof candidate.totalTokens === "number" && candidate.totalTokens > 0) {
    return candidate.totalTokens;
  }

  return null;
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
