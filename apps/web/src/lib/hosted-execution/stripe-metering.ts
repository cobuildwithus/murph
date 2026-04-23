import type { PrismaClient } from "@prisma/client";

import {
  HOSTED_AI_USAGE_BILLING_DISABLED_MESSAGE,
  readHostedAiUsageBillingMode,
  type HostedAiUsageBillingMode,
} from "@murphai/hosted-execution";
import {
  claimHostedAiUsageStripeMetering,
  HostedAiUsageStripeMeterClaimLostError,
  markHostedAiUsageStripeFailed,
  markHostedAiUsageStripeMeteringDisabled,
  markHostedAiUsageStripeProgress,
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
const STRIPE_METER_LEASE_MS = 5 * 60_000;
const STRIPE_METER_PROGRESS_V1_PREFIX = "tokens-v1:";
const STRIPE_METER_PROGRESS_V2_PREFIX = "tokens-v2:";
const STRIPE_METER_COMPLETED_IDENTIFIER = "tokens-v1";

type HostedAiUsageStripeTokenType = "input" | "output";

interface HostedAiUsageStripeTokenEvent {
  tokenType: HostedAiUsageStripeTokenType;
  value: number;
}

interface HostedAiUsageStripeProgressState {
  completedTokenTypes: Set<HostedAiUsageStripeTokenType>;
  fencedTokenTypes: Set<HostedAiUsageStripeTokenType>;
}

export interface HostedAiUsageStripeMeterEnvironment {
  aiUsageBillingMode: HostedAiUsageBillingMode;
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

  if (environment.aiUsageBillingMode === "disabled") {
    const skipped = await markHostedAiUsageStripeMeteringDisabled({
      limit: environment.batchLimit,
      message: HOSTED_AI_USAGE_BILLING_DISABLED_MESSAGE,
      now: attemptedAt,
      prisma: input.prisma,
    });

    return {
      configured: false,
      failed: 0,
      metered: 0,
      skipped,
    };
  }

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
    let claim = await claimHostedAiUsageStripeMetering({
      attemptedAt,
      candidate,
      leaseMs: STRIPE_METER_LEASE_MS,
      prisma: input.prisma,
    });

    if (!claim) {
      continue;
    }

    const skipReason = resolveHostedAiUsageStripeSkipReason(candidate);
    const progress = parseHostedAiUsageStripeProgressIdentifier(
      candidate.stripeMeterIdentifier,
    );
    let currentIdentifier = normalizeOptionalString(candidate.stripeMeterIdentifier);

    if (progress.fencedTokenTypes.size > 0) {
      try {
        await markHostedAiUsageStripeFailed({
          attemptedAt,
          claim,
          expectedIdentifier: currentIdentifier,
          id: candidate.id,
          identifier: currentIdentifier,
          message: buildHostedAiUsageStripeCrashFenceMessage(progress),
          prisma: input.prisma,
        });
        failed += 1;
      } catch (error) {
        if (!(error instanceof HostedAiUsageStripeMeterClaimLostError)) {
          throw error;
        }
      }
      continue;
    }

    if (skipReason) {
      try {
        await markHostedAiUsageStripeSkipped({
          attemptedAt,
          claim,
          expectedIdentifier: currentIdentifier,
          id: candidate.id,
          message: skipReason,
          prisma: input.prisma,
        });
        skipped += 1;
      } catch (error) {
        if (!(error instanceof HostedAiUsageStripeMeterClaimLostError)) {
          throw error;
        }
      }
      continue;
    }

    const allTokenEvents = resolveHostedAiUsageStripeTokenEvents(candidate);
    const tokenEvents = allTokenEvents.filter(
      (tokenEvent) => !progress.completedTokenTypes.has(tokenEvent.tokenType),
    );

    if (tokenEvents.length === 0) {
      if (progress.completedTokenTypes.size > 0) {
        try {
          await markHostedAiUsageStripeMetered({
            attemptedAt,
            claim,
            expectedIdentifier: currentIdentifier,
            id: candidate.id,
            identifier: `${candidate.id}:${STRIPE_METER_COMPLETED_IDENTIFIER}`,
            prisma: input.prisma,
          });
          metered += 1;
        } catch (error) {
          if (!(error instanceof HostedAiUsageStripeMeterClaimLostError)) {
            throw error;
          }
        }
        continue;
      }

      try {
        await markHostedAiUsageStripeSkipped({
          attemptedAt,
          claim,
          expectedIdentifier: currentIdentifier,
          id: candidate.id,
          message: "Skipped Stripe AI metering because no positive input or output token count was available.",
          prisma: input.prisma,
        });
        skipped += 1;
      } catch (error) {
        if (!(error instanceof HostedAiUsageStripeMeterClaimLostError)) {
          throw error;
        }
      }
      continue;
    }

    try {
      for (const tokenEvent of tokenEvents) {
        const fencedIdentifier = formatHostedAiUsageStripeProgressIdentifier({
          completedTokenTypes: progress.completedTokenTypes,
          fencedTokenTypes: new Set([tokenEvent.tokenType]),
        });

        if (!fencedIdentifier) {
          throw new TypeError("Hosted AI usage Stripe metering fence identifier was missing.");
        }

        claim = await markHostedAiUsageStripeProgress({
          attemptedAt,
          claim,
          expectedIdentifier: currentIdentifier,
          id: candidate.id,
          identifier: fencedIdentifier,
          prisma: input.prisma,
        });
        currentIdentifier = fencedIdentifier;

        await createHostedAiUsageStripeMeterEvent({
          eventName: environment.meterEventName,
          fetchImpl,
          identifier: `${candidate.id}:${tokenEvent.tokenType}`,
          model: resolveHostedAiUsageStripeModel(candidate),
          occurredAt: candidate.occurredAt,
          stripeCustomerId: candidate.stripeCustomerId,
          stripeSecretKey: environment.stripeSecretKey,
          tokenEvent,
        });
        progress.completedTokenTypes.add(tokenEvent.tokenType);
        progress.fencedTokenTypes.delete(tokenEvent.tokenType);

        if (progress.completedTokenTypes.size < allTokenEvents.length) {
          const progressIdentifier = formatHostedAiUsageStripeProgressIdentifier(progress);

          if (!progressIdentifier) {
            throw new TypeError("Hosted AI usage Stripe metering progress identifier was missing.");
          }

          claim = await markHostedAiUsageStripeProgress({
            attemptedAt,
            claim,
            expectedIdentifier: currentIdentifier,
            id: candidate.id,
            identifier: progressIdentifier,
            prisma: input.prisma,
          });
          currentIdentifier = progressIdentifier;
        }
      }
      await markHostedAiUsageStripeMetered({
        attemptedAt,
        claim,
        expectedIdentifier: currentIdentifier,
        id: candidate.id,
        identifier: `${candidate.id}:${STRIPE_METER_COMPLETED_IDENTIFIER}`,
        prisma: input.prisma,
      });
      metered += 1;
    } catch (error) {
      if (error instanceof HostedAiUsageStripeMeterClaimLostError) {
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      const completedIdentifier = formatHostedAiUsageStripeProgressIdentifier(progress);

      if (shouldRetryStripeMeterEvent(error)) {
        try {
          await markHostedAiUsageStripeRetryableFailure({
            attemptedAt,
            claim,
            expectedIdentifier: currentIdentifier,
            id: candidate.id,
            identifier: completedIdentifier,
            message,
            nextAttemptAt: computeHostedAiUsageStripeRetryAt({
              attemptedAt,
              nextAttemptCount: claim.attemptCount,
            }),
            prisma: input.prisma,
          });
          failed += 1;
        } catch (updateError) {
          if (!(updateError instanceof HostedAiUsageStripeMeterClaimLostError)) {
            throw updateError;
          }
        }
      } else {
        try {
          await markHostedAiUsageStripeFailed({
            attemptedAt,
            claim,
            expectedIdentifier: currentIdentifier,
            id: candidate.id,
            identifier: completedIdentifier,
            message,
            prisma: input.prisma,
          });
          failed += 1;
        } catch (updateError) {
          if (!(updateError instanceof HostedAiUsageStripeMeterClaimLostError)) {
            throw updateError;
          }
        }
      }
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
    aiUsageBillingMode: readHostedAiUsageBillingMode(source),
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
  model: string;
  occurredAt: Date;
  stripeCustomerId: string;
  stripeSecretKey: string;
  tokenEvent: HostedAiUsageStripeTokenEvent;
}): Promise<void> {
  const body = new URLSearchParams();
  body.set("event_name", input.eventName);
  body.set("identifier", input.identifier);
  body.set("payload[stripe_customer_id]", input.stripeCustomerId);
  body.set("payload[value]", String(input.tokenEvent.value));
  body.set("payload[token_type]", input.tokenEvent.tokenType);
  body.set("payload[model]", input.model);
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

function resolveHostedAiUsageStripeTokenEvents(
  candidate: HostedAiUsageStripeCandidate,
): HostedAiUsageStripeTokenEvent[] {
  return [
    {
      tokenType: "input" as const,
      value: normalizePositiveTokenCount(candidate.inputTokens),
    },
    {
      tokenType: "output" as const,
      value: normalizePositiveTokenCount(candidate.outputTokens),
    },
  ].filter((event): event is HostedAiUsageStripeTokenEvent => event.value !== null);
}

function resolveHostedAiUsageStripeModel(candidate: HostedAiUsageStripeCandidate): string {
  return (
    normalizeOptionalString(candidate.servedModel)
    ?? normalizeOptionalString(candidate.requestedModel)
    ?? candidate.provider
  );
}

function parseHostedAiUsageStripeProgressIdentifier(
  identifier: string | null,
): HostedAiUsageStripeProgressState {
  const normalizedIdentifier = normalizeOptionalString(identifier);

  if (!normalizedIdentifier) {
    return buildHostedAiUsageStripeProgressState();
  }

  if (normalizedIdentifier.startsWith(STRIPE_METER_PROGRESS_V1_PREFIX)) {
    return buildHostedAiUsageStripeProgressState({
      completedTokenTypes: normalizedIdentifier
        .slice(STRIPE_METER_PROGRESS_V1_PREFIX.length)
        .split(",")
        .flatMap((tokenType) =>
          tokenType === "input" || tokenType === "output" ? [tokenType] : [],
        ),
    });
  }

  if (!normalizedIdentifier.startsWith(STRIPE_METER_PROGRESS_V2_PREFIX)) {
    return buildHostedAiUsageStripeProgressState();
  }

  const segments = normalizedIdentifier
    .slice(STRIPE_METER_PROGRESS_V2_PREFIX.length)
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const completedTokenTypes: HostedAiUsageStripeTokenType[] = [];
  const fencedTokenTypes: HostedAiUsageStripeTokenType[] = [];

  for (const segment of segments) {
    const [rawKey, rawValue = ""] = segment.split("=", 2);
    const normalizedTokenTypes = rawValue
      .split(",")
      .flatMap(parseHostedAiUsageStripeTokenType);

    if (rawKey === "completed") {
      completedTokenTypes.push(...normalizedTokenTypes);
    } else if (rawKey === "fenced") {
      fencedTokenTypes.push(...normalizedTokenTypes);
    }
  }

  return buildHostedAiUsageStripeProgressState({
    completedTokenTypes,
    fencedTokenTypes,
  });
}

function formatHostedAiUsageStripeProgressIdentifier(
  progress: HostedAiUsageStripeProgressState,
): string | null {
  const completedTokenTypes = [...progress.completedTokenTypes].sort();
  const fencedTokenTypes = [...progress.fencedTokenTypes].sort();

  if (completedTokenTypes.length === 0 && fencedTokenTypes.length === 0) {
    return null;
  }

  const segments: string[] = [];

  if (completedTokenTypes.length > 0) {
    segments.push(`completed=${completedTokenTypes.join(",")}`);
  }

  if (fencedTokenTypes.length > 0) {
    segments.push(`fenced=${fencedTokenTypes.join(",")}`);
  }

  return `${STRIPE_METER_PROGRESS_V2_PREFIX}${segments.join(";")}`;
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

function buildHostedAiUsageStripeProgressState(input: {
  completedTokenTypes?: Iterable<HostedAiUsageStripeTokenType>;
  fencedTokenTypes?: Iterable<HostedAiUsageStripeTokenType>;
} = {}): HostedAiUsageStripeProgressState {
  return {
    completedTokenTypes: new Set(input.completedTokenTypes ?? []),
    fencedTokenTypes: new Set(input.fencedTokenTypes ?? []),
  };
}

function buildHostedAiUsageStripeCrashFenceMessage(
  progress: HostedAiUsageStripeProgressState,
): string {
  const fencedTokenTypes = [...progress.fencedTokenTypes].sort().join(", ");

  return `Stopped Stripe AI metering retry because a prior worker fenced token-side progress for ${fencedTokenTypes} before POST and the delivery outcome is unknown; refusing to resend automatically.`;
}

function parseHostedAiUsageStripeTokenType(
  tokenType: string,
): HostedAiUsageStripeTokenType[] {
  return tokenType === "input" || tokenType === "output" ? [tokenType] : [];
}
