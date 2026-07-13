import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import {
  HostedBillingStatus,
  type HostedMemberBillingRef,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
} from "../hosted-onboarding/billing-plans";
import {
  applyHostedAutoPulseTrialCampaignDispositionTx,
  inspectHostedAutoPulseTrialCampaignDisposition,
  runHostedAutoPulseTrialCampaignPostCommitEffects,
  type HostedAutoPulseTrialCampaignApplyTxResult,
  type HostedAutoPulseTrialCampaignDisposition,
  type HostedAutoPulseTrialCampaignSubscription,
} from "../hosted-onboarding/auto-trial-enrollment-service";
import {
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { readHostedContactPrivacyKeyring } from "../hosted-onboarding/env";
import {
  HostedMemberStripeMutationLockBusyError,
  projectHostedMemberStripeBillingRefSnapshot,
  withHostedMemberStripeMutationLockForOps,
} from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberBillingSnapshot } from "../hosted-onboarding/hosted-member-store";
import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "../hosted-onboarding/legacy-usage-price";
import { requiresHostedBillingCheckout } from "../hosted-onboarding/lifecycle";
import { requireHostedStripeBillingPlanConfig } from "../hosted-onboarding/runtime";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import {
  reconcileHostedAiUsageAllowancePeriodForMemberTx,
} from "../hosted-execution/usage-allowance";
import { getPrisma } from "../prisma";

const SECONDS_PER_DAY = 24 * 60 * 60;
const STRIPE_REQUEST_MAX_NETWORK_RETRIES = 0;
const STRIPE_REQUEST_TIMEOUT_MS = 80_000;
const HOSTED_OPS_ROUTE_WORK_BUDGET_MS = 780_000;
const HOSTED_OPS_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS = 25_000;
const HOSTED_OPS_CANDIDATE_TRANSACTION_TIMEOUT_MS = 190_000;
const HOSTED_OPS_POST_COMMIT_EFFECT_TIMEOUT_MS = 5_000;
const STRIPE_UPDATE_MINIMUM_RUNWAY_SECONDS =
  Math.ceil(STRIPE_REQUEST_TIMEOUT_MS / 1000) + 1;
const HOSTED_PULSE_TRIAL_EXTENSION_CURSOR_PREFIX = "pulse-cursor-v3";
const HOSTED_PULSE_TRIAL_EXTENSION_CURSOR_AAD =
  "pulse-beta-extension-2026-07:provider-and-member-keyset-v3";

export const HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN =
  "pulse-beta-extension-2026-07" as const;
export const HOSTED_PULSE_TRIAL_EXTENSION_DAYS = 7;
export const HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO =
  "2026-07-10T00:00:00.000Z" as const;
export const HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY =
  "murphTrialExtensionCampaign" as const;
export const HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY =
  "murphTrialExtensionDays" as const;

export type HostedPulseTrialExtensionMode = "apply" | "dry-run";

export interface HostedPulseTrialExtensionCandidate {
  billingRefCreatedAt: Date;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentPeriodEnd: Date | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  lastStripeEventCreatedAt: Date | null;
  memberBillingStatus: HostedBillingStatus;
  memberId: string;
  memberSuspendedAt: Date | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  pulseTrialRedeemedAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedPulseTrialExtensionLockedCandidate {
  applyProviderOnlyDisposition(
    disposition: Exclude<HostedAutoPulseTrialCampaignDisposition, { kind: "not-applicable" }>,
    now: Date,
  ): Promise<HostedAutoPulseTrialCampaignApplyTxResult["kind"]>;
  candidate: HostedPulseTrialExtensionCandidate | null;
  updateTrialEnd(trialEndsAt: Date, now: Date): Promise<void>;
}

export interface HostedPulseTrialExtensionCandidateSource {
  listCandidates(input: {
    continuationToken: string | null;
    limit: number;
  }): Promise<{
    candidates: readonly HostedPulseTrialExtensionCandidate[];
    nextContinuationToken: string | null;
  }>;
  inspectProviderOnlyTrial(input: {
    candidate: HostedPulseTrialExtensionCandidate;
    now: Date;
  }): Promise<HostedAutoPulseTrialCampaignDisposition>;
  withStripeMutationLock<TResult>(input: {
    acquisitionTimeoutMs: number;
    candidate: HostedPulseTrialExtensionCandidate;
    run: (locked: HostedPulseTrialExtensionLockedCandidate) => Promise<TResult>;
    transactionTimeoutMs: number;
  }): Promise<TResult>;
}

export interface HostedPulseTrialExtensionStripeRequestOptions {
  maxNetworkRetries: typeof STRIPE_REQUEST_MAX_NETWORK_RETRIES;
  timeout: typeof STRIPE_REQUEST_TIMEOUT_MS;
}

export type HostedPulseTrialExtensionStripeSubscription =
  HostedAutoPulseTrialCampaignSubscription;

export interface HostedPulseTrialExtensionStripeSubscriptionItem {
  id: string;
  price?: {
    id?: string;
    metadata?: Record<string, string> | null;
    recurring?: {
      interval?: string;
      interval_count?: number;
      usage_type?: string;
    } | null;
  } | null;
  quantity?: number | null;
}

export interface HostedPulseTrialExtensionStripeUpdateParams {
  metadata: Record<string, string>;
  proration_behavior: "none";
  trial_end: number;
}

export interface HostedPulseTrialExtensionStripeClient {
  retrieveSubscription(
    subscriptionId: string,
    options: HostedPulseTrialExtensionStripeRequestOptions,
  ): Promise<HostedPulseTrialExtensionStripeSubscription>;
  updateSubscription(
    subscriptionId: string,
    params: HostedPulseTrialExtensionStripeUpdateParams,
    options: {
      idempotencyKey: string;
    } & HostedPulseTrialExtensionStripeRequestOptions,
  ): Promise<HostedAutoPulseTrialCampaignSubscription>;
}

export type HostedPulseTrialExtensionSkipReason =
  | "local_candidate_changed"
  | "local_trial_window_invalid"
  | "missing_stripe_refs"
  | "outside_campaign_cohort"
  | "provider_recovery_not_found"
  | "provider_trial_ended"
  | "stripe_billing_plan_mismatch"
  | "stripe_campaign_marker_conflict"
  | "stripe_checkout_offer_mismatch"
  | "stripe_customer_mismatch"
  | "stripe_price_mismatch"
  | "stripe_subscription_canceling"
  | "stripe_subscription_id_mismatch"
  | "stripe_subscription_not_trialing"
  | "stripe_trial_end_invalid";

export type HostedPulseTrialExtensionFailureReason =
  | "db_update_failed"
  | "member_lock_busy"
  | "preview_state_changed"
  | "provider_recovery_failed"
  | "provider_recovery_lookup_failed"
  | "route_runway_exhausted"
  | "stripe_retrieve_failed"
  | "stripe_update_failed"
  | "stripe_update_result_invalid";

export interface HostedPulseTrialExtensionSummary {
  alreadyExtended: number;
  campaign: typeof HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN;
  candidatePreviewTokens: readonly string[] | null;
  candidateSnapshotDigest: string | null;
  candidates: number;
  extensionDays: typeof HOSTED_PULSE_TRIAL_EXTENSION_DAYS;
  failures: Record<HostedPulseTrialExtensionFailureReason, number>;
  hasMoreCandidates: boolean;
  localWindowsReconciled: number;
  mode: HostedPulseTrialExtensionMode;
  nextContinuationToken: string | null;
  providerTrialsCleanedUp: number;
  providerTrialsRecovered: number;
  skipped: Record<HostedPulseTrialExtensionSkipReason, number>;
  stripeTrialsExtended: number;
  wouldExtend: number;
  wouldCleanupProviderTrial: number;
  wouldRecoverProviderTrial: number;
  wouldReconcile: number;
}

type HostedPulseTrialExtensionClassification =
  | {
      alreadyMarked: boolean;
      ok: true;
      stripeTrialEnd: number;
    }
  | {
      ok: false;
      reason: HostedPulseTrialExtensionSkipReason;
    };

type HostedPulseTrialExtensionPreviewAction =
  | {
      kind: "already-marked";
      locallyReconciled: boolean;
      stripeTrialEnd: number;
    }
  | {
      kind: "extend";
      stripeTrialEnd: number;
      targetTrialEnd: number;
    }
  | {
      kind: "cleanup-provider-trial";
      stripeSubscriptionId: string;
    }
  | {
      kind: "skipped";
      reason: HostedPulseTrialExtensionSkipReason;
    };

type HostedPulseTrialLockedApplyResult =
  | {
      kind: "already-marked";
      stripeTrialEnd: number;
      subscription: HostedPulseTrialExtensionStripeSubscription;
    }
  | {
      kind: "extended";
      stripeTrialEnd: number;
      subscription: HostedPulseTrialExtensionStripeSubscription;
    }
  | {
      kind: "failure";
      reason: Exclude<
        HostedPulseTrialExtensionFailureReason,
        "db_update_failed" | "preview_state_changed"
      >;
    }
  | {
      kind: "preview-stale";
    }
  | {
      kind: "skipped";
      reason: HostedPulseTrialExtensionSkipReason;
    };

type HostedPulseTrialLockedOutcome = {
  localReconciliation: "already-current" | "reconciled" | null;
  result: HostedPulseTrialLockedApplyResult;
};

export class HostedPulseTrialExtensionPreviewMismatchError extends Error {
  constructor() {
    super("Pulse Trial extension candidates changed since Preview.");
    this.name = "HostedPulseTrialExtensionPreviewMismatchError";
  }
}

export class HostedPulseTrialExtensionContinuationError extends Error {
  constructor() {
    super("Pulse Trial extension continuation token is invalid.");
    this.name = "HostedPulseTrialExtensionContinuationError";
  }
}

export function isHostedPulseTrialExtensionContinuationTokenShape(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    /^pulse-cursor-v3\.v[0-9]+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u
      .test(value);
}

type HostedPulseTrialExtensionContinuation =
  | { afterMemberId: string | null; memberId: string | null; phase: "members" }
  | { afterSubscriptionId: string | null; memberId: string | null; phase: "provider" };

function encryptHostedPulseTrialExtensionContinuationToken(
  continuation: HostedPulseTrialExtensionContinuation,
): string {
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const version = keyring.currentVersion;
  const sourceKey = keyring.keysByVersion[version];
  if (!sourceKey) {
    throw new HostedPulseTrialExtensionContinuationError();
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveHostedPulseTrialExtensionContinuationKey(sourceKey),
    iv,
  );
  cipher.setAAD(Buffer.from(HOSTED_PULSE_TRIAL_EXTENSION_CURSOR_AAD, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(continuation), "utf8"),
    cipher.final(),
  ]);
  return [
    HOSTED_PULSE_TRIAL_EXTENSION_CURSOR_PREFIX,
    version,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function decryptHostedPulseTrialExtensionContinuationToken(
  token: string,
): HostedPulseTrialExtensionContinuation {
  const parts = token.split(".");
  if (
    parts.length !== 5 ||
    parts[0] !== HOSTED_PULSE_TRIAL_EXTENSION_CURSOR_PREFIX ||
    !/^v[0-9]+$/u.test(parts[1] ?? "")
  ) {
    throw new HostedPulseTrialExtensionContinuationError();
  }
  const version = parts[1];
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const sourceKey = version ? keyring.keysByVersion[version] : undefined;
  if (!sourceKey) {
    throw new HostedPulseTrialExtensionContinuationError();
  }

  try {
    const iv = Buffer.from(parts[2] ?? "", "base64url");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
    const authTag = Buffer.from(parts[4] ?? "", "base64url");
    if (iv.length !== 12 || ciphertext.length === 0 || authTag.length !== 16) {
      throw new HostedPulseTrialExtensionContinuationError();
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveHostedPulseTrialExtensionContinuationKey(sourceKey),
      iv,
    );
    decipher.setAAD(Buffer.from(HOSTED_PULSE_TRIAL_EXTENSION_CURSOR_AAD, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (!plaintext) {
      throw new HostedPulseTrialExtensionContinuationError();
    }
    if (!plaintext.startsWith("{")) {
      throw new HostedPulseTrialExtensionContinuationError();
    }
    const parsed: unknown = JSON.parse(plaintext);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Reflect.get(parsed, "phase") === "members" &&
      (
        Reflect.get(parsed, "afterMemberId") === null ||
        typeof Reflect.get(parsed, "afterMemberId") === "string"
      )
    ) {
      return {
        afterMemberId: Reflect.get(parsed, "afterMemberId") as string | null,
        memberId: typeof Reflect.get(parsed, "memberId") === "string"
          ? Reflect.get(parsed, "memberId") as string
          : null,
        phase: "members",
      };
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Reflect.get(parsed, "phase") === "provider" &&
      (
        Reflect.get(parsed, "afterSubscriptionId") === null ||
        typeof Reflect.get(parsed, "afterSubscriptionId") === "string"
      )
    ) {
      return {
        afterSubscriptionId: Reflect.get(parsed, "afterSubscriptionId") as string | null,
        memberId: typeof Reflect.get(parsed, "memberId") === "string"
          ? Reflect.get(parsed, "memberId") as string
          : null,
        phase: "provider",
      };
    }
    throw new HostedPulseTrialExtensionContinuationError();
  } catch (error) {
    if (error instanceof HostedPulseTrialExtensionContinuationError) {
      throw error;
    }
    throw new HostedPulseTrialExtensionContinuationError();
  }
}

function deriveHostedPulseTrialExtensionContinuationKey(sourceKey: Buffer): Buffer {
  return createHash("sha256")
    .update("hosted-pulse-trial-extension-continuation-v1", "utf8")
    .update("\0", "utf8")
    .update(sourceKey)
    .digest();
}

type HostedPulseTrialExtensionCommonInput = {
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  continuationToken?: string | null;
  currentTime?: () => Date;
  maxCandidates: number;
  now?: Date;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
};

export type HostedPulseTrialExtensionInput = HostedPulseTrialExtensionCommonInput & (
  | {
      mode: "dry-run";
    }
  | {
      expectedCandidatePreviewTokens: readonly string[];
      expectedCandidateSnapshotDigest: string;
      mode: "apply";
    }
);

export async function extendHostedPulseTrials(
  input: HostedPulseTrialExtensionInput,
): Promise<HostedPulseTrialExtensionSummary> {
  const operationDeadlineMs = Date.now() + HOSTED_OPS_ROUTE_WORK_BUDGET_MS;
  const readCurrentTime = input.currentTime ?? (() => input.now ?? new Date());
  const mode = input.mode;
  const continuationToken = input.continuationToken ?? null;
  if (!Number.isSafeInteger(input.maxCandidates) || input.maxCandidates < 1) {
    throw new Error("Pulse Trial extension candidate limit must be a positive integer.");
  }
  const candidatePage = await readHostedPulseTrialExtensionCandidatePage({
    candidateSource: input.candidateSource,
    continuationToken,
    maxCandidates: input.maxCandidates,
  });
  const candidates = candidatePage.candidates;

  const candidateSnapshotDigest = buildHostedPulseTrialExtensionCandidateSnapshotDigest(
    candidates,
    continuationToken,
  );
  if (
    input.mode === "apply" &&
    input.expectedCandidateSnapshotDigest !== candidateSnapshotDigest
  ) {
    throw new HostedPulseTrialExtensionPreviewMismatchError();
  }
  if (
    input.mode === "apply" &&
    input.expectedCandidatePreviewTokens.length !== candidates.length
  ) {
    throw new HostedPulseTrialExtensionPreviewMismatchError();
  }

  const summary = buildEmptyHostedPulseTrialExtensionSummary(
    mode,
    mode === "dry-run" ? candidateSnapshotDigest : null,
    candidatePage.hasMoreCandidates,
    candidatePage.nextContinuationToken,
  );

  for (const [candidateIndex, candidate] of candidates.entries()) {
      summary.candidates += 1;

      const providerOrigin = candidate.providerSubscriptionId !== null;
      const localSkipReason = providerOrigin
        ? null
        : classifyHostedPulseTrialExtensionCandidate(candidate);
      if (localSkipReason) {
        const previewToken = buildHostedPulseTrialExtensionCandidatePreviewToken({
          action: { kind: "skipped", reason: localSkipReason },
          candidate,
          subscription: null,
        });
        if (mode === "dry-run") {
          appendHostedPulseTrialExtensionCandidatePreviewToken(summary, previewToken);
        } else if (
          input.expectedCandidatePreviewTokens[candidateIndex] !== previewToken
        ) {
          summary.failures.preview_state_changed += 1;
          return suppressHostedPulseTrialExtensionContinuationOnFailure(summary);
        }
        summary.skipped[localSkipReason] += 1;
        continue;
      }

      if (providerOrigin || candidate.pulseTrialRedeemedAt === null) {
        if (mode === "dry-run") {
          appendHostedPulseTrialExtensionCandidatePreviewToken(
            summary,
            await previewHostedPulseTrialProviderRecoveryCandidate({
              candidate,
              candidateSource: input.candidateSource,
              now: readCurrentTime(),
              priceId: input.priceId,
              stripe: input.stripe,
              summary,
            }),
          );
          continue;
        }

        if (
          operationDeadlineMs - Date.now() <
            HOSTED_OPS_CANDIDATE_TRANSACTION_TIMEOUT_MS
        ) {
          summary.failures.route_runway_exhausted += 1;
          return suppressHostedPulseTrialExtensionContinuationOnFailure(summary);
        }

        const providerRecoveryResult = await applyHostedPulseTrialProviderRecoveryCandidate({
          candidate,
          candidateSource: input.candidateSource,
          expectedPreviewToken: input.expectedCandidatePreviewTokens[candidateIndex],
          now: readCurrentTime(),
          priceId: input.priceId,
          readCurrentTime,
          stripe: input.stripe,
          summary,
        });
        if (providerRecoveryResult === "preview-stale") {
          summary.failures.preview_state_changed += 1;
          return suppressHostedPulseTrialExtensionContinuationOnFailure(summary);
        }
        continue;
      }

      if (mode === "dry-run") {
        appendHostedPulseTrialExtensionCandidatePreviewToken(
          summary,
          await previewHostedPulseTrialExtensionCandidate({
            candidate,
            now: input.now,
            priceId: input.priceId,
            stripe: input.stripe,
            summary,
          }),
        );
        continue;
      }

      if (
        operationDeadlineMs - Date.now() <
          HOSTED_OPS_CANDIDATE_TRANSACTION_TIMEOUT_MS
      ) {
        summary.failures.route_runway_exhausted += 1;
        return suppressHostedPulseTrialExtensionContinuationOnFailure(summary);
      }

      const providerState: { result: HostedPulseTrialLockedApplyResult | null } = {
        result: null,
      };
      let lockedOutcome: HostedPulseTrialLockedOutcome;
      try {
        lockedOutcome = await input.candidateSource.withStripeMutationLock({
          acquisitionTimeoutMs: HOSTED_OPS_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
          candidate,
          run: async (locked) => {
            if (!locked.candidate) {
              return {
                localReconciliation: null,
                result: { kind: "preview-stale" },
              };
            }

            const lockedLocalSkipReason = classifyHostedPulseTrialExtensionCandidate(
              locked.candidate,
            );
            if (lockedLocalSkipReason) {
              const lockedPreviewToken = buildHostedPulseTrialExtensionCandidatePreviewToken({
                action: { kind: "skipped", reason: lockedLocalSkipReason },
                candidate: locked.candidate,
                subscription: null,
              });
              return {
                localReconciliation: null,
                result: input.expectedCandidatePreviewTokens[candidateIndex] ===
                    lockedPreviewToken
                  ? { kind: "skipped", reason: lockedLocalSkipReason }
                  : { kind: "preview-stale" },
              };
            }

            const providerResult = await applyHostedPulseTrialExtensionUnderLock({
              candidate: locked.candidate,
              expectedPreviewToken: input.expectedCandidatePreviewTokens[candidateIndex],
              now: input.now,
              priceId: input.priceId,
              stripe: input.stripe,
            });
            providerState.result = providerResult;
            if (
              providerResult.kind !== "already-marked" &&
              providerResult.kind !== "extended"
            ) {
              return {
                localReconciliation: null,
                result: providerResult,
              };
            }

            const trialEndsAt = stripeUnixSecondsToDate(providerResult.stripeTrialEnd);
            const localAlreadyCurrent = isHostedPulseTrialExtensionLocallyReconciled({
              candidate: locked.candidate,
              trialEndsAt,
            });
            await locked.updateTrialEnd(trialEndsAt, input.now ?? new Date());
            return {
              localReconciliation: localAlreadyCurrent
                ? "already-current"
                : "reconciled",
              result: providerResult,
            };
          },
          transactionTimeoutMs: HOSTED_OPS_CANDIDATE_TRANSACTION_TIMEOUT_MS,
        });
      } catch (error) {
        if (error instanceof HostedMemberStripeMutationLockBusyError) {
          summary.failures.member_lock_busy += 1;
          continue;
        }
        if (providerState.result?.kind === "extended") {
          summary.stripeTrialsExtended += 1;
        }
        summary.failures.db_update_failed += 1;
        continue;
      }

      if (lockedOutcome.result.kind === "failure") {
        summary.failures[lockedOutcome.result.reason] += 1;
        continue;
      }
      if (lockedOutcome.result.kind === "preview-stale") {
        summary.failures.preview_state_changed += 1;
        return suppressHostedPulseTrialExtensionContinuationOnFailure(summary);
      }
      if (lockedOutcome.result.kind === "skipped") {
        summary.skipped[lockedOutcome.result.reason] += 1;
        continue;
      }

      if (lockedOutcome.result.kind === "extended") {
        summary.stripeTrialsExtended += 1;
      }
      if (lockedOutcome.localReconciliation === "reconciled") {
        summary.localWindowsReconciled += 1;
      }
      if (
        lockedOutcome.result.kind === "already-marked" &&
        lockedOutcome.localReconciliation === "already-current"
      ) {
        summary.alreadyExtended += 1;
      }
  }

  return suppressHostedPulseTrialExtensionContinuationOnFailure(summary);
}

function suppressHostedPulseTrialExtensionContinuationOnFailure(
  summary: HostedPulseTrialExtensionSummary,
): HostedPulseTrialExtensionSummary {
  if (Object.values(summary.failures).some((count) => count > 0)) {
    summary.nextContinuationToken = null;
  }
  return summary;
}

type HostedPulseTrialExtensionCampaignInput = {
  continuationToken?: string | null;
  maxCandidates: number;
  memberId?: string;
  now?: Date;
  priceId?: string;
  prisma?: PrismaClient;
  stripe?: HostedPulseTrialExtensionStripeClient;
} & (
  | {
      mode: "dry-run";
    }
  | {
      expectedCandidatePreviewTokens: readonly string[];
      expectedCandidateSnapshotDigest: string;
      mode: "apply";
    }
);

export async function extendHostedPulseTrialsForCampaign(
  input: HostedPulseTrialExtensionCampaignInput,
): Promise<HostedPulseTrialExtensionSummary> {
  const prisma = input.prisma ?? getPrisma();
  const billingConfig = input.priceId && input.stripe
    ? null
    : requireHostedStripeBillingPlanConfig({ billingPlanCode: "launch_monthly" });
  const priceId = input.priceId ?? billingConfig?.priceId;
  if (!priceId) {
    throw new Error("Stripe price configuration is required for Pulse Trial extension.");
  }

  const commonInput = {
    candidateSource: createPrismaHostedPulseTrialExtensionCandidateSource(prisma, {
      ...(billingConfig?.stripe
        ? {
            campaignRecovery: {
              priceId,
              stripe: billingConfig.stripe,
            },
          }
        : {}),
      memberId: input.memberId,
    }),
    maxCandidates: input.maxCandidates,
    now: input.now,
    continuationToken: input.continuationToken,
    priceId,
    stripe: input.stripe ?? createHostedPulseTrialExtensionStripeClient(billingConfig?.stripe),
  };
  if (input.mode === "dry-run") {
    return extendHostedPulseTrials({
      ...commonInput,
      mode: "dry-run",
    });
  }
  return extendHostedPulseTrials({
    ...commonInput,
    expectedCandidatePreviewTokens: input.expectedCandidatePreviewTokens,
    expectedCandidateSnapshotDigest: input.expectedCandidateSnapshotDigest,
    mode: "apply",
  });
}

export function classifyHostedPulseTrialExtensionSubscription(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  nowUnixSeconds: number;
  priceId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscription: HostedPulseTrialExtensionStripeSubscription;
}): HostedPulseTrialExtensionClassification {
  if (
    input.subscription.id !==
      (input.stripeSubscriptionId ?? input.candidate.stripeSubscriptionId)
  ) {
    return { ok: false, reason: "stripe_subscription_id_mismatch" };
  }
  if (input.subscription.status !== "trialing") {
    return { ok: false, reason: "stripe_subscription_not_trialing" };
  }
  if (input.subscription.cancel_at_period_end || input.subscription.cancel_at !== null) {
    return { ok: false, reason: "stripe_subscription_canceling" };
  }
  if (
    coerceStripeCustomerId(input.subscription.customer) !==
      (input.stripeCustomerId ?? input.candidate.stripeCustomerId)
  ) {
    return { ok: false, reason: "stripe_customer_mismatch" };
  }
  if (input.subscription.metadata?.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    return { ok: false, reason: "stripe_checkout_offer_mismatch" };
  }
  if (input.subscription.metadata?.billingPlanCode !== "launch_monthly") {
    return { ok: false, reason: "stripe_billing_plan_mismatch" };
  }
  if (!isHostedPulseTrialExtensionSubscriptionPriceEligible({
    priceId: input.priceId,
    subscription: input.subscription,
  })) {
    return { ok: false, reason: "stripe_price_mismatch" };
  }
  if (
    !Number.isSafeInteger(input.subscription.trial_end) ||
    input.subscription.trial_end === null ||
    input.subscription.trial_end <= input.nowUnixSeconds
  ) {
    return { ok: false, reason: "stripe_trial_end_invalid" };
  }

  const campaignMarker = input.subscription.metadata?.[
    HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY
  ];
  if (campaignMarker && campaignMarker !== HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN) {
    return { ok: false, reason: "stripe_campaign_marker_conflict" };
  }

  const alreadyMarked = campaignMarker === HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN;
  if (
    alreadyMarked &&
    input.subscription.metadata?.[HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY] !==
      HOSTED_PULSE_TRIAL_EXTENSION_DAYS.toString()
  ) {
    return { ok: false, reason: "stripe_campaign_marker_conflict" };
  }

  return {
    alreadyMarked,
    ok: true,
    stripeTrialEnd: input.subscription.trial_end,
  };
}

function buildHostedPulseTrialExtensionStripeUpdateParams(input: {
  subscription: HostedPulseTrialExtensionStripeSubscription;
  targetTrialEnd: number;
}): HostedPulseTrialExtensionStripeUpdateParams {
  return {
    metadata: {
      ...(input.subscription.metadata ?? {}),
      [HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY]:
        HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      [HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY]:
        HOSTED_PULSE_TRIAL_EXTENSION_DAYS.toString(),
    },
    proration_behavior: "none",
    trial_end: input.targetTrialEnd,
  };
}

export function createPrismaHostedPulseTrialExtensionCandidateSource(
  prisma: PrismaClient,
  options: {
    campaignRecovery?: {
      priceId: string;
      stripe: Stripe;
    };
    memberId?: string;
  } = {},
): HostedPulseTrialExtensionCandidateSource {
  const where = buildPrismaHostedPulseTrialExtensionCandidateWhere(options.memberId);
  return {
    async listCandidates(input) {
      if (
        options.memberId &&
        options.campaignRecovery &&
        !input.continuationToken
      ) {
        const memberPage = await listHostedPulseTrialMemberCandidates({
          afterMemberId: null,
          limit: input.limit,
          prisma,
          where,
        });
        return {
          candidates: memberPage.candidates,
          nextContinuationToken: encryptHostedPulseTrialExtensionContinuationToken({
            afterSubscriptionId: null,
            memberId: options.memberId,
            phase: "provider",
          }),
        };
      }
      const continuation = input.continuationToken
        ? decryptHostedPulseTrialExtensionContinuationToken(input.continuationToken)
        : options.campaignRecovery
          ? { afterSubscriptionId: null, memberId: null, phase: "provider" } as const
          : {
              afterMemberId: null,
              memberId: options.memberId ?? null,
              phase: "members",
            } as const;
      if (continuation.memberId !== (options.memberId ?? null)) {
        throw new HostedPulseTrialExtensionContinuationError();
      }
      if (continuation.phase === "provider") {
        if (!options.campaignRecovery) {
          throw new HostedPulseTrialExtensionContinuationError();
        }
        const providerPage = await listHostedPulseTrialProviderCandidates({
          afterSubscriptionId: continuation.afterSubscriptionId,
          limit: input.limit,
          memberId: options.memberId,
          priceId: options.campaignRecovery.priceId,
          prisma,
          stripe: options.campaignRecovery.stripe,
        });
        if (providerPage.hasMore) {
          return {
            candidates: providerPage.candidates,
            nextContinuationToken: encryptHostedPulseTrialExtensionContinuationToken({
              afterSubscriptionId: providerPage.lastSubscriptionId,
              memberId: options.memberId ?? null,
              phase: "provider",
            }),
          };
        }
        if (providerPage.candidates.length > 0) {
          return {
            candidates: providerPage.candidates,
            nextContinuationToken: options.memberId
              ? null
              : encryptHostedPulseTrialExtensionContinuationToken({
                  afterMemberId: null,
                  memberId: null,
                  phase: "members",
                }),
          };
        }
        if (options.memberId) {
          return {
            candidates: [],
            nextContinuationToken: null,
          };
        }
        return listHostedPulseTrialMemberCandidates({
          afterMemberId: null,
          limit: input.limit,
          prisma,
          where,
        });
      }
      return listHostedPulseTrialMemberCandidates({
        afterMemberId: continuation.afterMemberId,
        limit: input.limit,
        prisma,
        where,
      });
    },
    async inspectProviderOnlyTrial(input) {
      if (!options.campaignRecovery) {
        throw new Error("Pulse Trial provider recovery configuration is required.");
      }
      const stripeCustomerId = input.candidate.providerCustomerId ??
        input.candidate.stripeCustomerId;
      if (!stripeCustomerId) {
        return {
          kind: "not-applicable",
          reason: "provider-trial-not-found",
          subscription: null,
        };
      }
      return inspectHostedAutoPulseTrialCampaignDisposition({
        candidate: buildHostedAutoPulseTrialCampaignCandidateState(input.candidate),
        priceId: options.campaignRecovery.priceId,
        requestOptions: buildHostedPulseTrialExtensionStripeRequestOptions(),
        stripe: options.campaignRecovery.stripe,
        stripeCustomerId,
        ...(input.candidate.providerSubscriptionId
          ? { targetStripeSubscriptionId: input.candidate.providerSubscriptionId }
          : {}),
        trialStartedBefore: new Date(
          HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO,
        ),
      });
    },
    async withStripeMutationLock(input) {
      let postCommitEffects:
        | HostedAutoPulseTrialCampaignApplyTxResult["postCommitEffects"]
        | null = null;
      const result = await withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs: input.acquisitionTimeoutMs,
        memberId: input.candidate.memberId,
        prisma,
        run: async (tx) => {
          const candidate = await readLockedPrismaHostedPulseTrialExtensionCandidate({
            expectedCandidate: input.candidate,
            tx,
          });
          return input.run({
            applyProviderOnlyDisposition: async (disposition, now) => {
              const providerCustomerId = candidate?.providerCustomerId ??
                candidate?.stripeCustomerId;
              if (!options.campaignRecovery || !candidate || !providerCustomerId) {
                throw new Error(
                  "Pulse Trial provider recovery configuration changed before Apply.",
                );
              }
              const currentMember = await readHostedMemberBillingSnapshot({
                memberId: input.candidate.memberId,
                prisma: tx,
              });
              if (!currentMember) {
                throw new Error("Pulse Trial provider recovery member no longer exists.");
              }
              const applied = await applyHostedAutoPulseTrialCampaignDispositionTx({
                campaignPolicy: {
                  minimumTrialRunwaySeconds: STRIPE_UPDATE_MINIMUM_RUNWAY_SECONDS,
                  priceId: options.campaignRecovery.priceId,
                  trialStartedBefore: new Date(
                    HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO,
                  ),
                },
                currentMember,
                disposition,
                now,
                requestOptions: buildHostedPulseTrialExtensionStripeRequestOptions(),
                stripe: options.campaignRecovery.stripe,
                stripeCustomerId: providerCustomerId,
                tx,
              });
              postCommitEffects = applied.postCommitEffects;
              return applied.kind;
            },
            candidate,
            updateTrialEnd: async (trialEndsAt, now) => {
              if (!candidate) {
                throw new Error("Pulse Trial extension candidate changed before apply.");
              }
              await updatePrismaHostedPulseTrialExtensionCandidateTrialEnd({
                candidate,
                now,
                trialEndsAt,
                tx,
              });
            },
          });
        },
        transactionTimeoutMs: input.transactionTimeoutMs,
      });
      if (postCommitEffects) {
        await runHostedAutoPulseTrialCampaignPostCommitEffects({
          effects: postCommitEffects,
          prisma,
          timeoutMs: HOSTED_OPS_POST_COMMIT_EFFECT_TIMEOUT_MS,
        });
      }
      return result;
    },
  };
}

async function listHostedPulseTrialMemberCandidates(input: {
  afterMemberId: string | null;
  limit: number;
  prisma: PrismaClient;
  where: Prisma.HostedMemberBillingRefWhereInput;
}): Promise<{
  candidates: readonly HostedPulseTrialExtensionCandidate[];
  nextContinuationToken: string | null;
}> {
  const records = await input.prisma.hostedMemberBillingRef.findMany({
    include: {
      member: {
        select: {
          billingStatus: true,
          suspendedAt: true,
        },
      },
    },
    orderBy: { memberId: "asc" },
    take: input.limit + 1,
    where: {
      ...input.where,
      ...(input.afterMemberId ? { memberId: { gt: input.afterMemberId } } : {}),
    },
  });
  const pageRecords = records.slice(0, input.limit);
  const candidates = await Promise.all(pageRecords.map((record) =>
    projectHostedPulseTrialExtensionCandidate(record, input.prisma)
  ));
  const lastRecord = pageRecords.at(-1);
  return {
    candidates,
    nextContinuationToken:
      records.length > input.limit && lastRecord
        ? encryptHostedPulseTrialExtensionContinuationToken({
            afterMemberId: lastRecord.memberId,
            memberId: null,
            phase: "members",
          })
        : null,
  };
}

async function listHostedPulseTrialProviderCandidates(input: {
  afterSubscriptionId: string | null;
  limit: number;
  memberId?: string;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<{
  candidates: readonly HostedPulseTrialExtensionCandidate[];
  hasMore: boolean;
  lastSubscriptionId: string;
}> {
  const page = await input.stripe.subscriptions.list({
    limit: input.limit,
    ...(input.afterSubscriptionId
      ? { starting_after: input.afterSubscriptionId }
      : {}),
    status: "all",
  }, buildHostedPulseTrialExtensionStripeRequestOptions());
  const lastSubscription = page.data.at(-1);
  if (!lastSubscription && page.has_more) {
    throw new Error("Stripe returned an incomplete Pulse Trial provider page.");
  }
  const projected = await Promise.all(page.data.map(async (subscription) => {
    if (!isHistoricalHostedPulseTrialProviderSubscription({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription,
    })) {
      return null;
    }
    return projectHistoricalHostedPulseTrialProviderCandidate({
      prisma: input.prisma,
      subscription,
    });
  }));
  return {
    candidates: projected.filter(
      (candidate): candidate is HostedPulseTrialExtensionCandidate => candidate !== null,
    ),
    hasMore: page.has_more,
    lastSubscriptionId: lastSubscription?.id ?? input.afterSubscriptionId ?? "complete",
  };
}

function isHistoricalHostedPulseTrialProviderSubscription(input: {
  memberId?: string;
  priceId: string;
  subscription: Stripe.Subscription;
}): boolean {
  const metadata = input.subscription.metadata;
  const trialStart = input.subscription.trial_start;
  return input.subscription.status !== "canceled" &&
    input.subscription.status !== "incomplete_expired" &&
    typeof metadata.memberId === "string" &&
    (!input.memberId || metadata.memberId === input.memberId) &&
    metadata.billingPlanCode === "launch_monthly" &&
    metadata.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
    metadata.trialDurationDays === HOSTED_PULSE_TRIAL_DAYS.toString() &&
    metadata.trialPolicyVersion === HOSTED_PULSE_TRIAL_POLICY_VERSION &&
    metadata.trialUsageLimitUsdMicros ===
      HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString() &&
    Number.isSafeInteger(trialStart) &&
    trialStart !== null &&
    trialStart < Date.parse(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO) / 1000 &&
    isHostedPulseTrialExtensionSubscriptionPriceEligible({
      priceId: input.priceId,
      subscription: input.subscription,
    });
}

async function projectHistoricalHostedPulseTrialProviderCandidate(input: {
  prisma: PrismaClient;
  subscription: Stripe.Subscription;
}): Promise<HostedPulseTrialExtensionCandidate | null> {
  const memberId = input.subscription.metadata.memberId;
  const stripeCustomerId = coerceStripeCustomerId(input.subscription.customer);
  const trialStart = input.subscription.trial_start;
  if (!memberId || !stripeCustomerId || trialStart === null) {
    return null;
  }
  const record = await input.prisma.hostedMemberBillingRef.findUnique({
    include: {
      member: {
        select: {
          billingStatus: true,
          suspendedAt: true,
        },
      },
    },
    where: { memberId },
  });
  const cutoff = new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO);
  const trialStartedAt = stripeUnixSecondsToDate(trialStart);
  if (record) {
    const candidate = await projectHostedPulseTrialExtensionCandidate(record, input.prisma);
    const belongsToLocalCohort =
      (record.pulseTrialRedeemedAt && record.pulseTrialRedeemedAt < cutoff) ||
      (!record.pulseTrialRedeemedAt && record.createdAt < cutoff);
    if (
      belongsToLocalCohort &&
      candidate.stripeSubscriptionId === input.subscription.id
    ) {
      return null;
    }
    return {
      ...candidate,
      providerCustomerId: stripeCustomerId,
      providerSubscriptionId: input.subscription.id,
    };
  }
  const member = await readHostedMemberBillingSnapshot({
    memberId,
    prisma: input.prisma,
  });
  if (!member) {
    return null;
  }
  return {
    billingRefCreatedAt: trialStartedAt,
    currentBillingPhase: null,
    currentBillingPlanCode: null,
    currentCheckoutOffer: null,
    currentPeriodEnd: null,
    currentTrialEndsAt: null,
    currentTrialStartedAt: null,
    lastStripeEventCreatedAt: null,
    memberBillingStatus: member.core.billingStatus,
    memberId,
    memberSuspendedAt: member.core.suspendedAt,
    providerCustomerId: stripeCustomerId,
    providerSubscriptionId: input.subscription.id,
    pulseTrialRedeemedAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };
}

function buildPrismaHostedPulseTrialExtensionCandidateWhere(
  memberId?: string,
): Prisma.HostedMemberBillingRefWhereInput {
  return {
    OR: [
      {
        pulseTrialRedeemedAt: {
          lt: new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO),
        },
      },
      {
        createdAt: {
          lt: new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO),
        },
        pulseTrialRedeemedAt: null,
      },
    ],
    ...(memberId ? { memberId } : {}),
  };
}

function createHostedPulseTrialExtensionStripeClient(
  stripe: Pick<Stripe, "subscriptions"> | undefined,
): HostedPulseTrialExtensionStripeClient {
  if (!stripe) {
    throw new Error("Stripe billing configuration is required for Pulse Trial extension.");
  }
  return {
    retrieveSubscription(subscriptionId, options) {
      return stripe.subscriptions.retrieve(subscriptionId, undefined, options);
    },
    updateSubscription(subscriptionId, params, options) {
      return stripe.subscriptions.update(subscriptionId, params, options);
    },
  };
}

function classifyHostedPulseTrialExtensionCandidate(
  candidate: HostedPulseTrialExtensionCandidate,
): HostedPulseTrialExtensionSkipReason | null {
  if (
    candidate.pulseTrialRedeemedAt !== null &&
    candidate.pulseTrialRedeemedAt >=
      new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO)
  ) {
    return "outside_campaign_cohort";
  }
  if (candidate.pulseTrialRedeemedAt === null) {
    if (candidate.memberSuspendedAt !== null) {
      return "local_candidate_changed";
    }
    return candidate.stripeCustomerId ? null : "missing_stripe_refs";
  }
  if (
    candidate.memberBillingStatus !== HostedBillingStatus.active ||
    candidate.memberSuspendedAt !== null ||
    candidate.currentBillingPhase !== "trial" ||
    candidate.currentBillingPlanCode !== "launch_monthly" ||
    candidate.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER
  ) {
    return "local_candidate_changed";
  }
  if (!candidate.stripeCustomerId || !candidate.stripeSubscriptionId) {
    return "missing_stripe_refs";
  }
  if (
    !candidate.currentTrialStartedAt ||
    !candidate.currentTrialEndsAt ||
    !candidate.currentPeriodEnd ||
    candidate.currentTrialStartedAt >= candidate.currentTrialEndsAt
  ) {
    return "local_trial_window_invalid";
  }
  return null;
}

function buildHostedAutoPulseTrialCampaignCandidateState(
  candidate: HostedPulseTrialExtensionCandidate,
) {
  return {
    billingStatus: candidate.memberBillingStatus,
    currentStripeSubscriptionId: candidate.stripeSubscriptionId,
    memberId: candidate.memberId,
  };
}

function buildEmptyHostedPulseTrialExtensionSummary(
  mode: HostedPulseTrialExtensionMode,
  candidateSnapshotDigest: string | null,
  hasMoreCandidates: boolean,
  nextContinuationToken: string | null,
): HostedPulseTrialExtensionSummary {
  return {
    alreadyExtended: 0,
    campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    candidatePreviewTokens: mode === "dry-run" ? [] : null,
    candidateSnapshotDigest,
    candidates: 0,
    extensionDays: HOSTED_PULSE_TRIAL_EXTENSION_DAYS,
    failures: {
      db_update_failed: 0,
      member_lock_busy: 0,
      preview_state_changed: 0,
      provider_recovery_failed: 0,
      provider_recovery_lookup_failed: 0,
      route_runway_exhausted: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
      stripe_update_result_invalid: 0,
    },
    hasMoreCandidates,
    localWindowsReconciled: 0,
    mode,
    nextContinuationToken,
    providerTrialsCleanedUp: 0,
    providerTrialsRecovered: 0,
    skipped: {
      local_candidate_changed: 0,
      local_trial_window_invalid: 0,
      missing_stripe_refs: 0,
      outside_campaign_cohort: 0,
      provider_recovery_not_found: 0,
      provider_trial_ended: 0,
      stripe_billing_plan_mismatch: 0,
      stripe_campaign_marker_conflict: 0,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
      stripe_price_mismatch: 0,
      stripe_subscription_canceling: 0,
      stripe_subscription_id_mismatch: 0,
      stripe_subscription_not_trialing: 0,
      stripe_trial_end_invalid: 0,
    },
    stripeTrialsExtended: 0,
    wouldExtend: 0,
    wouldCleanupProviderTrial: 0,
    wouldRecoverProviderTrial: 0,
    wouldReconcile: 0,
  };
}

function buildHostedPulseTrialExtensionIdempotencyKey(subscriptionId: string): string {
  return [
    "hosted-pulse-trial-extension",
    HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    subscriptionId,
  ].join(":");
}

function isHostedPulseTrialExtensionLocallyReconciled(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  trialEndsAt: Date;
}): boolean {
  const targetTime = input.trialEndsAt.getTime();
  return input.candidate.currentTrialEndsAt?.getTime() === targetTime &&
    input.candidate.currentPeriodEnd?.getTime() === targetTime;
}

function isValidHostedPulseTrialExtensionUpdateResult(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  priceId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscription: HostedPulseTrialExtensionStripeSubscription;
  targetTrialEnd: number;
}): boolean {
  const classification = classifyHostedPulseTrialExtensionSubscription({
    candidate: input.candidate,
    nowUnixSeconds: input.targetTrialEnd - 1,
    priceId: input.priceId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription: input.subscription,
  });
  return classification.ok &&
    classification.alreadyMarked &&
    classification.stripeTrialEnd === input.targetTrialEnd;
}

async function applyHostedPulseTrialExtensionUnderLock(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  expectedPreviewToken: string;
  now?: Date;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialLockedApplyResult> {
  const stripeSubscriptionId = requireStripeSubscriptionId(input.candidate);
  let subscription: HostedPulseTrialExtensionStripeSubscription;
  try {
    subscription = await input.stripe.retrieveSubscription(
      stripeSubscriptionId,
      buildHostedPulseTrialExtensionStripeRequestOptions(),
    );
  } catch {
    return { kind: "failure", reason: "stripe_retrieve_failed" };
  }

  const nowUnixSeconds = resolveHostedPulseTrialExtensionNowUnixSeconds(input.now);
  const classification = classifyHostedPulseTrialExtensionSubscription({
    candidate: input.candidate,
    nowUnixSeconds,
    priceId: input.priceId,
    subscription,
  });
  const action = classifyHostedPulseTrialExtensionPreviewAction({
    candidate: input.candidate,
    classification,
    nowUnixSeconds,
  });
  const previewToken = buildHostedPulseTrialExtensionCandidatePreviewToken({
    action,
    candidate: input.candidate,
    subscription,
  });
  if (
    input.expectedPreviewToken !== previewToken
  ) {
    return { kind: "preview-stale" };
  }

  if (action.kind === "skipped") {
    return { kind: "skipped", reason: action.reason };
  }
  if (action.kind === "already-marked") {
    return {
      kind: "already-marked",
      stripeTrialEnd: action.stripeTrialEnd,
      subscription,
    };
  }
  if (action.kind !== "extend") {
    throw new Error("Provider recovery action cannot mutate a redeemed trial.");
  }
  let updatedSubscription: HostedPulseTrialExtensionStripeSubscription;
  try {
    updatedSubscription = await input.stripe.updateSubscription(
      stripeSubscriptionId,
      buildHostedPulseTrialExtensionStripeUpdateParams({
        subscription,
        targetTrialEnd: action.targetTrialEnd,
      }),
      {
        idempotencyKey: buildHostedPulseTrialExtensionIdempotencyKey(
          stripeSubscriptionId,
        ),
        ...buildHostedPulseTrialExtensionStripeRequestOptions(),
      },
    );
  } catch {
    return { kind: "failure", reason: "stripe_update_failed" };
  }

  if (!isValidHostedPulseTrialExtensionUpdateResult({
    candidate: input.candidate,
    priceId: input.priceId,
    subscription: updatedSubscription,
    targetTrialEnd: action.targetTrialEnd,
  })) {
    return { kind: "failure", reason: "stripe_update_result_invalid" };
  }

  return {
    kind: "extended",
    stripeTrialEnd: action.targetTrialEnd,
    subscription: updatedSubscription,
  };
}

async function projectHostedPulseTrialExtensionCandidate(
  record: HostedMemberBillingRef & {
    member: {
      billingStatus: HostedBillingStatus;
      suspendedAt: Date | null;
    };
  },
  prisma: HostedOnboardingReadClient,
): Promise<HostedPulseTrialExtensionCandidate> {
  const snapshot = await projectHostedMemberStripeBillingRefSnapshot(record, prisma);

  return {
    billingRefCreatedAt: record.createdAt,
    currentBillingPhase: snapshot.currentBillingPhase ?? null,
    currentBillingPlanCode: snapshot.currentBillingPlanCode ?? null,
    currentCheckoutOffer: snapshot.currentCheckoutOffer ?? null,
    currentPeriodEnd: snapshot.currentPeriodEnd ?? null,
    currentTrialEndsAt: snapshot.currentTrialEndsAt ?? null,
    currentTrialStartedAt: snapshot.currentTrialStartedAt ?? null,
    lastStripeEventCreatedAt: snapshot.lastStripeEventCreatedAt ?? null,
    memberBillingStatus: record.member.billingStatus,
    memberId: snapshot.memberId,
    memberSuspendedAt: record.member.suspendedAt,
    providerCustomerId: null,
    providerSubscriptionId: null,
    pulseTrialRedeemedAt: snapshot.pulseTrialRedeemedAt ?? null,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
  };
}

async function previewHostedPulseTrialExtensionCandidate(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  now?: Date;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
  summary: HostedPulseTrialExtensionSummary;
}): Promise<string | null> {
  let subscription: HostedPulseTrialExtensionStripeSubscription;
  try {
    subscription = await input.stripe.retrieveSubscription(
      requireStripeSubscriptionId(input.candidate),
      buildHostedPulseTrialExtensionStripeRequestOptions(),
    );
  } catch {
    input.summary.failures.stripe_retrieve_failed += 1;
    return null;
  }

  const nowUnixSeconds = resolveHostedPulseTrialExtensionNowUnixSeconds(input.now);
  const classification = classifyHostedPulseTrialExtensionSubscription({
    candidate: input.candidate,
    nowUnixSeconds,
    priceId: input.priceId,
    subscription,
  });
  const action = classifyHostedPulseTrialExtensionPreviewAction({
    candidate: input.candidate,
    classification,
    nowUnixSeconds,
  });
  if (action.kind === "skipped") {
    input.summary.skipped[action.reason] += 1;
  } else if (action.kind === "extend") {
    input.summary.wouldExtend += 1;
  } else if (action.kind === "already-marked" && action.locallyReconciled) {
    input.summary.alreadyExtended += 1;
  } else if (action.kind === "already-marked") {
    input.summary.wouldReconcile += 1;
  } else {
    throw new Error("Provider recovery action cannot classify a redeemed trial.");
  }

  return buildHostedPulseTrialExtensionCandidatePreviewToken({
    action,
    candidate: input.candidate,
    subscription,
  });
}

async function previewHostedPulseTrialProviderRecoveryCandidate(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  now?: Date;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
  summary: HostedPulseTrialExtensionSummary;
}): Promise<string | null> {
  let disposition: HostedAutoPulseTrialCampaignDisposition;
  const now = input.now ?? new Date();
  try {
    disposition = await input.candidateSource.inspectProviderOnlyTrial({
      candidate: input.candidate,
      now,
    });
  } catch {
    input.summary.failures.provider_recovery_lookup_failed += 1;
    return null;
  }
  const proof = classifyHostedPulseTrialProviderDisposition({
    candidate: input.candidate,
    disposition,
    now,
    priceId: input.priceId,
  });
  if (disposition.kind === "recoverable" && proof.action.kind === "extend") {
    input.summary.wouldRecoverProviderTrial += 1;
    input.summary.wouldExtend += 1;
  } else if (
    disposition.kind === "recoverable" &&
    proof.action.kind === "already-marked"
  ) {
    input.summary.wouldRecoverProviderTrial += 1;
    input.summary.wouldReconcile += 1;
  } else if (proof.action.kind === "cleanup-provider-trial") {
    input.summary.wouldCleanupProviderTrial += 1;
  } else if (proof.action.kind === "skipped") {
    input.summary.skipped[proof.action.reason] += 1;
  } else {
    throw new Error("Provider recovery produced an unsupported Preview action.");
  }
  return buildHostedPulseTrialExtensionCandidatePreviewToken({
    action: proof.action,
    candidate: proof.candidate,
    subscription: disposition.subscription,
  });
}

async function applyHostedPulseTrialProviderRecoveryCandidate(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  expectedPreviewToken: string;
  now: Date;
  priceId: string;
  readCurrentTime: () => Date;
  stripe: HostedPulseTrialExtensionStripeClient;
  summary: HostedPulseTrialExtensionSummary;
}): Promise<"complete" | "preview-stale"> {
  let inspectionCompleted = false;
  try {
    const result = await input.candidateSource.withStripeMutationLock({
      acquisitionTimeoutMs: HOSTED_OPS_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
      candidate: input.candidate,
      run: async (locked) => {
        if (
          !locked.candidate ||
          locked.candidate.providerSubscriptionId !==
            input.candidate.providerSubscriptionId
        ) {
          return { kind: "preview-stale" } as const;
        }

        const disposition = await input.candidateSource.inspectProviderOnlyTrial({
          candidate: locked.candidate,
          now: input.now,
        });
        inspectionCompleted = true;
        const decisionNow = input.readCurrentTime();
        const proof = classifyHostedPulseTrialProviderDisposition({
          candidate: locked.candidate,
          disposition,
          now: decisionNow,
          priceId: input.priceId,
        });
        const lockedToken = buildHostedPulseTrialExtensionCandidatePreviewToken({
          action: proof.action,
          candidate: proof.candidate,
          subscription: disposition.subscription,
        });
        if (lockedToken !== input.expectedPreviewToken) {
          return { kind: "preview-stale" } as const;
        }
        if (proof.action.kind === "skipped") {
          return { kind: "skipped", reason: proof.action.reason } as const;
        }
        if (disposition.kind === "not-applicable") {
          throw new Error("Provider disposition action did not match its source state.");
        }

        if (disposition.kind === "recoverable") {
          let finalizedSubscription = disposition.subscription;
          let providerExtended = false;
          if (proof.action.kind === "extend") {
            try {
              finalizedSubscription = await input.stripe.updateSubscription(
                disposition.subscription.id,
                buildHostedPulseTrialExtensionStripeUpdateParams({
                  subscription: disposition.subscription,
                  targetTrialEnd: proof.action.targetTrialEnd,
                }),
                {
                  idempotencyKey: buildHostedPulseTrialExtensionIdempotencyKey(
                    disposition.subscription.id,
                  ),
                  ...buildHostedPulseTrialExtensionStripeRequestOptions(),
                },
              );
            } catch {
              return { kind: "failure", reason: "stripe_update_failed" } as const;
            }
            if (!isValidHostedPulseTrialExtensionUpdateResult({
              candidate: proof.candidate,
              priceId: input.priceId,
              stripeCustomerId: proof.candidate.providerCustomerId ?? undefined,
              stripeSubscriptionId: disposition.subscription.id,
              subscription: finalizedSubscription,
              targetTrialEnd: proof.action.targetTrialEnd,
            })) {
              return {
                kind: "failure",
                reason: "stripe_update_result_invalid",
              } as const;
            }
            providerExtended = true;
          } else if (proof.action.kind !== "already-marked") {
            throw new Error("Recoverable provider disposition was not extendable.");
          }
          const kind = await locked.applyProviderOnlyDisposition({
            ...disposition,
            subscription: finalizedSubscription,
          }, decisionNow);
          return {
            kind,
            providerExtended,
          } as const;
        }

        return {
          kind: await locked.applyProviderOnlyDisposition(disposition, decisionNow),
          providerExtended: false,
        } as const;
      },
      transactionTimeoutMs: HOSTED_OPS_CANDIDATE_TRANSACTION_TIMEOUT_MS,
    });
    if (result.kind === "preview-stale") {
      return "preview-stale";
    }
    if (result.kind === "failure") {
      input.summary.failures[result.reason] += 1;
    } else if (result.kind === "skipped") {
      input.summary.skipped[result.reason] += 1;
    } else if (result.kind === "recovered") {
      input.summary.providerTrialsRecovered += 1;
      if (result.providerExtended) {
        input.summary.stripeTrialsExtended += 1;
      }
    } else {
      input.summary.providerTrialsCleanedUp += 1;
    }
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      input.summary.failures.member_lock_busy += 1;
      return "complete";
    }
    if (!inspectionCompleted) {
      input.summary.failures.provider_recovery_lookup_failed += 1;
      return "complete";
    }
    input.summary.failures.provider_recovery_failed += 1;
  }
  return "complete";
}

function classifyHostedPulseTrialProviderDisposition(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  disposition: HostedAutoPulseTrialCampaignDisposition;
  now: Date;
  priceId: string;
}): {
  action: HostedPulseTrialExtensionPreviewAction;
  candidate: HostedPulseTrialExtensionCandidate;
} {
  const disposition = input.disposition;
  if (disposition.kind === "recoverable") {
    if (
      input.candidate.memberSuspendedAt !== null ||
      input.candidate.pulseTrialRedeemedAt !== null ||
      !requiresHostedBillingCheckout(input.candidate.memberBillingStatus)
    ) {
      return {
        action: { kind: "skipped", reason: "local_candidate_changed" },
        candidate: input.candidate,
      };
    }
    if (
      input.candidate.stripeCustomerId &&
      input.candidate.providerCustomerId &&
      input.candidate.stripeCustomerId !== input.candidate.providerCustomerId
    ) {
      return {
        action: { kind: "skipped", reason: "stripe_customer_mismatch" },
        candidate: input.candidate,
      };
    }
    const nowUnixSeconds = resolveHostedPulseTrialExtensionNowUnixSeconds(input.now);
    return {
      action: classifyHostedPulseTrialExtensionPreviewAction({
        candidate: input.candidate,
        classification: classifyHostedPulseTrialExtensionSubscription({
          candidate: input.candidate,
          nowUnixSeconds,
          priceId: input.priceId,
          stripeCustomerId: input.candidate.providerCustomerId ?? undefined,
          stripeSubscriptionId: disposition.subscription.id,
          subscription: disposition.subscription,
        }),
        nowUnixSeconds,
      }),
      candidate: input.candidate,
    };
  }
  if (disposition.kind === "cleanup-obsolete") {
    return {
      action: {
        kind: "cleanup-provider-trial",
        stripeSubscriptionId: disposition.subscription.id,
      },
      candidate: input.candidate,
    };
  }
  return {
    action: {
      kind: "skipped",
      reason: disposition.reason === "provider-trial-ended"
        ? "provider_trial_ended"
        : "provider_recovery_not_found",
    },
    candidate: input.candidate,
  };
}

async function readLockedPrismaHostedPulseTrialExtensionCandidate(input: {
  expectedCandidate: HostedPulseTrialExtensionCandidate;
  tx: Prisma.TransactionClient;
}): Promise<HostedPulseTrialExtensionCandidate | null> {
  const stripeCustomerLookupKeys = createHostedStripeCustomerLookupKeyReadCandidates(
    input.expectedCandidate.stripeCustomerId ??
      input.expectedCandidate.providerCustomerId,
  );
  const stripeSubscriptionLookupKeys = createHostedStripeSubscriptionLookupKeyReadCandidates(
    input.expectedCandidate.stripeSubscriptionId,
  );
  if (stripeCustomerLookupKeys.length === 0) {
    return null;
  }

  let record = await input.tx.hostedMemberBillingRef.findFirst({
    include: {
      member: {
        select: {
          billingStatus: true,
          suspendedAt: true,
        },
      },
    },
    where: {
      memberId: input.expectedCandidate.memberId,
      stripeCustomerLookupKey: { in: stripeCustomerLookupKeys },
      stripeSubscriptionLookupKey:
        stripeSubscriptionLookupKeys.length > 0
          ? { in: stripeSubscriptionLookupKeys }
          : null,
    },
  });
  if (!record && input.expectedCandidate.pulseTrialRedeemedAt === null) {
    record = await input.tx.hostedMemberBillingRef.findFirst({
      include: {
        member: {
          select: {
            billingStatus: true,
            suspendedAt: true,
          },
        },
      },
      where: { memberId: input.expectedCandidate.memberId },
    });
  }

  if (!record) {
    if (input.expectedCandidate.pulseTrialRedeemedAt !== null) {
      return null;
    }
    const member = await input.tx.hostedMember.findUnique({
      select: {
        billingStatus: true,
        suspendedAt: true,
      },
      where: { id: input.expectedCandidate.memberId },
    });
    return member
      ? {
          ...input.expectedCandidate,
          memberBillingStatus: member.billingStatus,
          memberSuspendedAt: member.suspendedAt,
        }
      : null;
  }

  if (
    input.expectedCandidate.pulseTrialRedeemedAt === null &&
    record.stripeCustomerLookupKey &&
    !stripeCustomerLookupKeys.includes(record.stripeCustomerLookupKey)
  ) {
    return null;
  }

  const lockedCandidate = await projectHostedPulseTrialExtensionCandidate(record, input.tx);
  return {
    ...lockedCandidate,
    providerCustomerId: input.expectedCandidate.providerCustomerId,
    providerSubscriptionId: input.expectedCandidate.providerSubscriptionId,
    pulseTrialRedeemedAt:
      input.expectedCandidate.pulseTrialRedeemedAt &&
        record.pulseTrialRedeemedAt &&
        record.pulseTrialRedeemedAt >=
          new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO)
        ? input.expectedCandidate.pulseTrialRedeemedAt
        : record.pulseTrialRedeemedAt,
  };
}

async function updatePrismaHostedPulseTrialExtensionCandidateTrialEnd(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  now: Date;
  trialEndsAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const currentTrialStartedAt = input.candidate.currentTrialStartedAt;
  if (!currentTrialStartedAt) {
    throw new Error("Pulse Trial extension candidate is missing its local window.");
  }

  const billingUpdate = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      currentPeriodEnd: input.trialEndsAt,
      currentTrialEndsAt: input.trialEndsAt,
    },
    where: {
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
      currentPeriodEnd: input.candidate.currentPeriodEnd,
      currentTrialEndsAt: input.candidate.currentTrialEndsAt,
      currentTrialStartedAt,
      lastStripeEventCreatedAt: input.candidate.lastStripeEventCreatedAt,
      memberId: input.candidate.memberId,
      member: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
    },
  });
  if (billingUpdate.count !== 1) {
    throw new Error("Pulse Trial billing state changed during extension.");
  }

  await reconcileHostedAiUsageAllowancePeriodForMemberTx({
    memberId: input.candidate.memberId,
    now: input.now,
    tx: input.tx,
  });
}

function isHostedPulseTrialExtensionSubscriptionPriceEligible(input: {
  priceId: string;
  subscription: HostedPulseTrialExtensionStripeSubscription;
}): boolean {
  const items = input.subscription.items?.data ?? [];
  const recurringItems = items.filter((item) => item.price?.id === input.priceId);
  if (recurringItems.length !== 1) {
    return false;
  }

  const recurringItem = recurringItems[0];
  if (!recurringItem) {
    return false;
  }
  if (
    recurringItem.price?.recurring?.interval !== "month" ||
    recurringItem.price.recurring.usage_type === "metered" ||
    recurringItem.quantity !== 1
  ) {
    return false;
  }

  return items.every((item) =>
    item.id === recurringItem.id || isHostedPulseTrialExtensionLegacyMeteredItem(item)
  );
}

function isHostedPulseTrialExtensionLegacyMeteredItem(
  item: HostedPulseTrialExtensionStripeSubscriptionItem,
): boolean {
  const recurring = item.price?.recurring;
  return recurring?.interval === "month" &&
    (recurring.interval_count ?? 1) === 1 &&
    recurring.usage_type === "metered" &&
    item.price?.metadata?.[HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY] ===
      HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE &&
    !(typeof item.quantity === "number" && Number.isFinite(item.quantity));
}

function requireStripeSubscriptionId(candidate: HostedPulseTrialExtensionCandidate): string {
  if (!candidate.stripeSubscriptionId) {
    throw new Error("Pulse Trial extension candidate is missing its Stripe subscription.");
  }
  return candidate.stripeSubscriptionId;
}

function coerceStripeCustomerId(
  value: HostedPulseTrialExtensionStripeSubscription["customer"],
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

function stripeUnixSecondsToDate(value: number): Date {
  return new Date(value * 1000);
}

function resolveHostedPulseTrialExtensionNowUnixSeconds(now?: Date): number {
  return Math.floor((now ?? new Date()).getTime() / 1000);
}

async function readHostedPulseTrialExtensionCandidatePage(input: {
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  continuationToken: string | null;
  maxCandidates: number;
}): Promise<{
  candidates: readonly HostedPulseTrialExtensionCandidate[];
  hasMoreCandidates: boolean;
  nextContinuationToken: string | null;
}> {
  const page = await input.candidateSource.listCandidates({
    continuationToken: input.continuationToken,
    limit: input.maxCandidates,
  });

  return {
    candidates: page.candidates,
    hasMoreCandidates: page.nextContinuationToken !== null,
    nextContinuationToken: page.nextContinuationToken,
  };
}

function classifyHostedPulseTrialExtensionPreviewAction(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  classification: HostedPulseTrialExtensionClassification;
  nowUnixSeconds: number;
}): HostedPulseTrialExtensionPreviewAction {
  if (!input.classification.ok) {
    return { kind: "skipped", reason: input.classification.reason };
  }
  if (input.classification.alreadyMarked) {
    return {
      kind: "already-marked",
      locallyReconciled: isHostedPulseTrialExtensionLocallyReconciled({
        candidate: input.candidate,
        trialEndsAt: stripeUnixSecondsToDate(input.classification.stripeTrialEnd),
      }),
      stripeTrialEnd: input.classification.stripeTrialEnd,
    };
  }
  if (
    input.classification.stripeTrialEnd <=
      input.nowUnixSeconds + STRIPE_UPDATE_MINIMUM_RUNWAY_SECONDS
  ) {
    return { kind: "skipped", reason: "stripe_trial_end_invalid" };
  }
  return {
    kind: "extend",
    stripeTrialEnd: input.classification.stripeTrialEnd,
    targetTrialEnd: input.classification.stripeTrialEnd +
      HOSTED_PULSE_TRIAL_EXTENSION_DAYS * SECONDS_PER_DAY,
  };
}

function appendHostedPulseTrialExtensionCandidatePreviewToken(
  summary: HostedPulseTrialExtensionSummary,
  token: string | null,
): void {
  if (summary.candidatePreviewTokens === null) {
    throw new Error("Pulse Trial extension Apply cannot collect preview proof.");
  }
  summary.candidatePreviewTokens = [...summary.candidatePreviewTokens, token ?? ""];
}

function buildHostedPulseTrialExtensionStripeRequestOptions():
  HostedPulseTrialExtensionStripeRequestOptions {
  return {
    maxNetworkRetries: STRIPE_REQUEST_MAX_NETWORK_RETRIES,
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
  };
}

function buildHostedPulseTrialExtensionCandidateSnapshotDigest(
  candidates: readonly HostedPulseTrialExtensionCandidate[],
  continuationToken: string | null,
): string {
  const snapshot = [...candidates]
    .sort((left, right) => {
      if (left.memberId < right.memberId) {
        return -1;
      }
      return left.memberId > right.memberId ? 1 : 0;
    })
    .map((candidate) => [
      candidate.memberId,
      candidate.billingRefCreatedAt.toISOString(),
      candidate.memberBillingStatus,
      candidate.memberSuspendedAt?.toISOString() ?? null,
      candidate.providerCustomerId,
      candidate.providerSubscriptionId,
      candidate.pulseTrialRedeemedAt?.toISOString() ?? null,
      candidate.currentBillingPhase,
      candidate.currentBillingPlanCode,
      candidate.currentCheckoutOffer,
      candidate.stripeCustomerId,
      candidate.stripeSubscriptionId,
      candidate.currentTrialStartedAt?.toISOString() ?? null,
      candidate.currentTrialEndsAt?.toISOString() ?? null,
      candidate.currentPeriodEnd?.toISOString() ?? null,
      candidate.lastStripeEventCreatedAt?.toISOString() ?? null,
    ]);

  return `pulse-candidates-v4.${createHash("sha256")
    .update(HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN, "utf8")
    .update("\0", "utf8")
    .update(continuationToken ?? "first", "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("base64url")}`;
}

function buildHostedPulseTrialExtensionCandidatePreviewToken(input: {
  action: HostedPulseTrialExtensionPreviewAction;
  candidate: HostedPulseTrialExtensionCandidate;
  subscription: HostedPulseTrialExtensionStripeSubscription | null;
}): string {
  const subscriptionItems = [...(input.subscription?.items?.data ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      legacyUsagePrice: item.price?.metadata?.[
        HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY
      ] ?? null,
      priceId: item.price?.id ?? null,
      quantity: item.quantity ?? null,
      recurringInterval: item.price?.recurring?.interval ?? null,
      recurringIntervalCount: item.price?.recurring?.interval_count ?? null,
      recurringUsageType: item.price?.recurring?.usage_type ?? null,
    }));
  const snapshot = {
    action: input.action,
    candidate: {
      billingRefCreatedAt: input.candidate.billingRefCreatedAt.toISOString(),
      currentBillingPhase: input.candidate.currentBillingPhase,
      currentBillingPlanCode: input.candidate.currentBillingPlanCode,
      currentCheckoutOffer: input.candidate.currentCheckoutOffer,
      currentPeriodEnd: input.candidate.currentPeriodEnd?.toISOString() ?? null,
      currentTrialEndsAt: input.candidate.currentTrialEndsAt?.toISOString() ?? null,
      currentTrialStartedAt: input.candidate.currentTrialStartedAt?.toISOString() ?? null,
      lastStripeEventCreatedAt: input.candidate.lastStripeEventCreatedAt?.toISOString() ?? null,
      memberBillingStatus: input.candidate.memberBillingStatus,
      memberId: input.candidate.memberId,
      memberSuspendedAt: input.candidate.memberSuspendedAt?.toISOString() ?? null,
      providerCustomerId: input.candidate.providerCustomerId,
      providerSubscriptionId: input.candidate.providerSubscriptionId,
      pulseTrialRedeemedAt: input.candidate.pulseTrialRedeemedAt?.toISOString() ?? null,
      stripeCustomerId: input.candidate.stripeCustomerId,
      stripeSubscriptionId: input.candidate.stripeSubscriptionId,
    },
    subscription: input.subscription
      ? {
          billingPlanCode: input.subscription.metadata?.billingPlanCode ?? null,
          campaign: input.subscription.metadata?.[
            HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN_METADATA_KEY
          ] ?? null,
          campaignDays: input.subscription.metadata?.[
            HOSTED_PULSE_TRIAL_EXTENSION_DAYS_METADATA_KEY
          ] ?? null,
          cancelAt: input.subscription.cancel_at,
          cancelAtPeriodEnd: input.subscription.cancel_at_period_end,
          checkoutOffer: input.subscription.metadata?.checkoutOffer ?? null,
          customerId: coerceStripeCustomerId(input.subscription.customer),
          id: input.subscription.id,
          items: subscriptionItems,
          status: input.subscription.status,
          trialEnd: input.subscription.trial_end,
          trialStart: input.subscription.trial_start,
        }
      : null,
  };

  return `pulse-target-v3.${createHash("sha256")
    .update(HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("base64url")}`;
}
