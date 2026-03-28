import {
  listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeFailed,
  markHostedAiUsageStripeMetered,
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
    if (candidate.credentialSource === "member") {
      await markHostedAiUsageStripeSkipped({
        id: candidate.id,
        message: "Skipped Stripe AI metering because the run used a member-supplied API key.",
      });
      skipped += 1;
      continue;
    }

    const stripeCustomerId = candidate.member.stripeCustomerId;
    const value = resolveHostedAiUsageStripeValue(candidate);

    if (!stripeCustomerId || value === null) {
      await markHostedAiUsageStripeSkipped({
        id: candidate.id,
        message: !stripeCustomerId
          ? "Skipped Stripe AI metering because the member does not have a Stripe customer id yet."
          : "Skipped Stripe AI metering because no total token count was available.",
      });
      skipped += 1;
      continue;
    }

    try {
      await createHostedAiUsageStripeMeterEvent({
        eventName: environment.meterEventName,
        identifier: candidate.id,
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
      await markHostedAiUsageStripeFailed({
        id: candidate.id,
        message: error instanceof Error ? error.message : String(error),
      });
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
  stripeCustomerId: string;
  stripeSecretKey: string;
  value: number;
}): Promise<void> {
  const body = new URLSearchParams();
  body.set("event_name", input.eventName);
  body.set("identifier", input.identifier);
  body.set("payload[stripe_customer_id]", input.stripeCustomerId);
  body.set("payload[value]", String(input.value));

  const response = await fetch(STRIPE_METER_EVENTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.identifier,
    },
    body,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Stripe meter event ${input.identifier} failed with HTTP ${response.status}${formatStripeMeterErrorSuffix(text)}.`,
    );
  }
}

function resolveHostedAiUsageStripeValue(
  candidate: HostedAiUsageStripeCandidate,
): number | null {
  if (typeof candidate.totalTokens === "number" && candidate.totalTokens > 0) {
    return candidate.totalTokens;
  }

  const fallback = (candidate.inputTokens ?? 0) + (candidate.outputTokens ?? 0);
  return fallback > 0 ? fallback : null;
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

function formatStripeMeterErrorSuffix(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? `: ${trimmed.slice(0, 500)}` : "";
}
