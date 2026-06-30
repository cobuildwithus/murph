import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { HostedBillingStatus, type HostedMemberBillingRef, type PrismaClient } from "@prisma/client";
import Stripe from "stripe";

import {
  createPrismaClient,
} from "../src/lib/prisma";
import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
} from "../src/lib/hosted-onboarding/billing-plans";
import {
  projectHostedMemberStripeBillingRefSnapshot,
} from "../src/lib/hosted-onboarding/hosted-member-billing-store";

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BATCH_SIZE = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type HostedPulseTrialResetMode = "apply" | "dry-run";

export interface HostedPulseTrialResetArgs {
  batchSize: number;
  mode: HostedPulseTrialResetMode;
}

export interface HostedPulseTrialResetWindow {
  trialEndsAt: Date;
  trialStartedAt: Date;
}

export interface HostedPulseTrialResetCandidate {
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedPulseTrialResetCandidateSource {
  listCandidates(input: {
    afterMemberId: string | null;
    limit: number;
  }): Promise<readonly HostedPulseTrialResetCandidate[]>;
  updateCandidateTrialWindow(input: {
    candidate: HostedPulseTrialResetCandidate;
    resetWindow: HostedPulseTrialResetWindow;
  }): Promise<void>;
}

export interface HostedPulseTrialResetStripeSubscription {
  customer: string | { id?: string } | null;
  id: string;
  metadata?: Record<string, string> | null;
  status: string;
}

export interface HostedPulseTrialResetStripeUpdateParams {
  metadata: Record<string, string>;
  trial_end: number;
}

export interface HostedPulseTrialResetStripeClient {
  retrieveSubscription(subscriptionId: string): Promise<HostedPulseTrialResetStripeSubscription>;
  updateSubscription(
    subscriptionId: string,
    params: HostedPulseTrialResetStripeUpdateParams,
    options: { idempotencyKey: string },
  ): Promise<HostedPulseTrialResetStripeSubscription>;
}

export type HostedPulseTrialResetSkipReason =
  | "missing_stripe_refs"
  | "stripe_checkout_offer_mismatch"
  | "stripe_customer_mismatch"
  | "stripe_subscription_not_trialing";

export type HostedPulseTrialResetFailureReason =
  | "db_update_failed"
  | "stripe_retrieve_failed"
  | "stripe_update_failed";

export interface HostedPulseTrialResetSummary {
  candidates: number;
  failures: Record<HostedPulseTrialResetFailureReason, number>;
  mode: HostedPulseTrialResetMode;
  reset: number;
  resetWindow: HostedPulseTrialResetWindow;
  skipped: Record<HostedPulseTrialResetSkipReason, number>;
  wouldReset: number;
}

export function parseHostedPulseTrialResetArgs(argv: readonly string[]): HostedPulseTrialResetArgs {
  let batchSize = DEFAULT_BATCH_SIZE;
  let mode: HostedPulseTrialResetMode = "dry-run";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
      continue;
    }
    if (arg === "--dry-run") {
      mode = "dry-run";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error(
        [
          "Usage: pnpm --dir apps/web pulse-trial:reset [--apply] [--batch-size <count>]",
          "",
          "Dry-run is the default. Use --apply to update eligible Stripe subscriptions and Postgres rows.",
        ].join("\n"),
      );
    }
    if (arg === "--batch-size") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--batch-size requires a positive integer.");
      }
      batchSize = parseHostedPulseTrialResetBatchSize(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      batchSize = parseHostedPulseTrialResetBatchSize(arg.slice("--batch-size=".length));
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return {
    batchSize,
    mode,
  };
}

export function buildHostedPulseTrialResetWindow(now = new Date()): HostedPulseTrialResetWindow {
  return {
    trialEndsAt: new Date(now.getTime() + HOSTED_PULSE_TRIAL_DAYS * MS_PER_DAY),
    trialStartedAt: now,
  };
}

export function classifyHostedPulseTrialResetSubscription(input: {
  candidate: HostedPulseTrialResetCandidate;
  subscription: HostedPulseTrialResetStripeSubscription;
}): { ok: true } | { ok: false; reason: HostedPulseTrialResetSkipReason } {
  if (!input.candidate.stripeCustomerId || !input.candidate.stripeSubscriptionId) {
    return {
      ok: false,
      reason: "missing_stripe_refs",
    };
  }

  if (input.subscription.status !== "trialing") {
    return {
      ok: false,
      reason: "stripe_subscription_not_trialing",
    };
  }

  const subscriptionCustomerId = coerceHostedPulseTrialResetStripeCustomerId(
    input.subscription.customer,
  );
  if (subscriptionCustomerId !== input.candidate.stripeCustomerId) {
    return {
      ok: false,
      reason: "stripe_customer_mismatch",
    };
  }

  const metadataOffer = input.subscription.metadata?.checkoutOffer ?? null;
  if (metadataOffer !== null && metadataOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    return {
      ok: false,
      reason: "stripe_checkout_offer_mismatch",
    };
  }

  return { ok: true };
}

export async function resetHostedPulseTrials(input: {
  batchSize?: number;
  candidateSource: HostedPulseTrialResetCandidateSource;
  mode?: HostedPulseTrialResetMode;
  now?: Date;
  stripe: HostedPulseTrialResetStripeClient;
}): Promise<HostedPulseTrialResetSummary> {
  const mode = input.mode ?? "dry-run";
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const resetWindow = buildHostedPulseTrialResetWindow(input.now);
  const summary = buildEmptyHostedPulseTrialResetSummary({
    mode,
    resetWindow,
  });
  let afterMemberId: string | null = null;

  for (;;) {
    const candidates = await input.candidateSource.listCandidates({
      afterMemberId,
      limit: batchSize,
    });
    if (candidates.length === 0) {
      return summary;
    }

    afterMemberId = candidates[candidates.length - 1]?.memberId ?? afterMemberId;

    for (const candidate of candidates) {
      summary.candidates += 1;

      if (!candidate.stripeCustomerId || !candidate.stripeSubscriptionId) {
        summary.skipped.missing_stripe_refs += 1;
        continue;
      }

      let subscription: HostedPulseTrialResetStripeSubscription;
      try {
        subscription = await input.stripe.retrieveSubscription(candidate.stripeSubscriptionId);
      } catch {
        summary.failures.stripe_retrieve_failed += 1;
        continue;
      }

      const classification = classifyHostedPulseTrialResetSubscription({
        candidate,
        subscription,
      });
      if (!classification.ok) {
        summary.skipped[classification.reason] += 1;
        continue;
      }

      if (mode === "dry-run") {
        summary.wouldReset += 1;
        continue;
      }

      try {
        await input.stripe.updateSubscription(
          candidate.stripeSubscriptionId,
          buildHostedPulseTrialResetStripeUpdateParams(resetWindow),
          {
            idempotencyKey: buildHostedPulseTrialResetIdempotencyKey({
              memberId: candidate.memberId,
              resetWindow,
            }),
          },
        );
      } catch {
        summary.failures.stripe_update_failed += 1;
        continue;
      }

      try {
        await input.candidateSource.updateCandidateTrialWindow({
          candidate,
          resetWindow,
        });
      } catch {
        summary.failures.db_update_failed += 1;
        continue;
      }

      summary.reset += 1;
    }
  }
}

export function buildHostedPulseTrialResetStripeUpdateParams(
  resetWindow: HostedPulseTrialResetWindow,
): HostedPulseTrialResetStripeUpdateParams {
  return {
    metadata: {
      checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
      trialDurationDays: HOSTED_PULSE_TRIAL_DAYS.toString(),
      trialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
      trialUsageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString(),
      [HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY]:
        resetWindow.trialStartedAt.toISOString(),
    },
    trial_end: Math.floor(resetWindow.trialEndsAt.getTime() / 1000),
  };
}

export function formatHostedPulseTrialResetSummary(summary: HostedPulseTrialResetSummary): string {
  const lines = [
    `Pulse Trial reset ${summary.mode}.`,
    `Trial window: ${summary.resetWindow.trialStartedAt.toISOString()} to ${summary.resetWindow.trialEndsAt.toISOString()}.`,
    `Candidates scanned: ${summary.candidates}.`,
    `Would reset: ${summary.wouldReset}.`,
    `Reset: ${summary.reset}.`,
  ];

  const skipped = formatCounts(summary.skipped);
  if (skipped.length > 0) {
    lines.push(`Skipped: ${skipped}.`);
  }

  const failures = formatCounts(summary.failures);
  if (failures.length > 0) {
    lines.push(`Failures: ${failures}.`);
  }

  if (summary.mode === "dry-run") {
    lines.push("Run again with --apply to update eligible Stripe subscriptions and Postgres rows.");
  }

  return lines.join("\n");
}

function parseHostedPulseTrialResetBatchSize(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 500) {
    throw new Error("--batch-size must be an integer from 1 to 500.");
  }
  return parsed;
}

function buildEmptyHostedPulseTrialResetSummary(input: {
  mode: HostedPulseTrialResetMode;
  resetWindow: HostedPulseTrialResetWindow;
}): HostedPulseTrialResetSummary {
  return {
    candidates: 0,
    failures: {
      db_update_failed: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
    },
    mode: input.mode,
    reset: 0,
    resetWindow: input.resetWindow,
    skipped: {
      missing_stripe_refs: 0,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
      stripe_subscription_not_trialing: 0,
    },
    wouldReset: 0,
  };
}

function coerceHostedPulseTrialResetStripeCustomerId(
  value: HostedPulseTrialResetStripeSubscription["customer"],
): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const id = Reflect.get(value, "id");
    return typeof id === "string" ? id : null;
  }
  return null;
}

function buildHostedPulseTrialResetIdempotencyKey(input: {
  memberId: string;
  resetWindow: HostedPulseTrialResetWindow;
}): string {
  return [
    "hosted-pulse-trial-reset",
    HOSTED_PULSE_TRIAL_POLICY_VERSION,
    input.memberId,
    Math.floor(input.resetWindow.trialStartedAt.getTime() / 1000).toString(),
  ].join(":");
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");
}

function createPrismaHostedPulseTrialResetCandidateSource(
  prisma: PrismaClient,
): HostedPulseTrialResetCandidateSource {
  return {
    async listCandidates(input) {
      const records = await prisma.hostedMemberBillingRef.findMany({
        ...(input.afterMemberId
          ? {
              cursor: {
                memberId: input.afterMemberId,
              },
              skip: 1,
            }
          : {}),
        orderBy: {
          memberId: "asc",
        },
        take: input.limit,
        where: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
          member: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
        },
      });

      return Promise.all(records.map((record) =>
        projectHostedPulseTrialResetCandidate(record, prisma)
      ));
    },
    async updateCandidateTrialWindow(input) {
      await prisma.hostedMemberBillingRef.update({
        data: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
          currentPeriodEnd: input.resetWindow.trialEndsAt,
          currentPeriodStart: input.resetWindow.trialStartedAt,
          currentTrialEndsAt: input.resetWindow.trialEndsAt,
          currentTrialStartedAt: input.resetWindow.trialStartedAt,
          lastStripeEventCreatedAt: input.resetWindow.trialStartedAt,
          pulseTrialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
          pulseTrialRedeemedAt: input.resetWindow.trialStartedAt,
        },
        where: {
          memberId: input.candidate.memberId,
        },
      });
    },
  };
}

async function projectHostedPulseTrialResetCandidate(
  record: HostedMemberBillingRef,
  prisma: PrismaClient,
): Promise<HostedPulseTrialResetCandidate> {
  const snapshot = await projectHostedMemberStripeBillingRefSnapshot(record, prisma);
  return {
    currentTrialEndsAt: snapshot.currentTrialEndsAt ?? null,
    currentTrialStartedAt: snapshot.currentTrialStartedAt ?? null,
    memberId: snapshot.memberId,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
  };
}

function createStripeHostedPulseTrialResetClient(): HostedPulseTrialResetStripeClient {
  const stripe = new Stripe(resolveHostedPulseTrialResetStripeSecretKey());
  return {
    retrieveSubscription(subscriptionId) {
      return stripe.subscriptions.retrieve(subscriptionId);
    },
    updateSubscription(subscriptionId, params, options) {
      return stripe.subscriptions.update(subscriptionId, params, options);
    },
  };
}

function resolveHostedPulseTrialResetStripeSecretKey(): string {
  const stripeSecretKey = nonEmptyEnv(process.env.STRIPE_SECRET_KEY);
  if (stripeSecretKey) {
    return stripeSecretKey;
  }

  throw new Error("STRIPE_SECRET_KEY is required to reset Pulse Trial Stripe subscriptions.");
}

function resolveHostedPulseTrialResetDatabaseUrl(): string {
  const directDatabaseUrl = nonEmptyEnv(process.env.DIRECT_DATABASE_URL);
  if (directDatabaseUrl) {
    return directDatabaseUrl;
  }

  const databaseUrl = nonEmptyEnv(process.env.DATABASE_URL);
  if (databaseUrl) {
    return databaseUrl;
  }

  throw new Error("DATABASE_URL or DIRECT_DATABASE_URL is required to reset Pulse Trials.");
}

function nonEmptyEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function loadHostedWebEnvFiles(): void {
  for (const envPath of [".env.local", ".env"]) {
    const absoluteEnvPath = path.join(CONFIG_DIR, envPath);

    if (existsSync(absoluteEnvPath)) {
      process.loadEnvFile(absoluteEnvPath);
    }
  }
}

async function main(): Promise<void> {
  loadHostedWebEnvFiles();
  const args = parseHostedPulseTrialResetArgs(process.argv.slice(2));
  const prisma = createPrismaClient({
    databaseUrl: resolveHostedPulseTrialResetDatabaseUrl(),
    poolMax: 2,
  });

  try {
    const summary = await resetHostedPulseTrials({
      batchSize: args.batchSize,
      candidateSource: createPrismaHostedPulseTrialResetCandidateSource(prisma),
      mode: args.mode,
      stripe: createStripeHostedPulseTrialResetClient(),
    });
    console.log(formatHostedPulseTrialResetSummary(summary));
    if (formatCounts(summary.failures).length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
