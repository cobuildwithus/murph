import { createHash } from "node:crypto";

import {
  HostedBillingStatus,
  type HostedMemberBillingRef,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  HOSTED_PULSE_TRIAL_OFFER,
} from "../hosted-onboarding/billing-plans";
import {
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  projectHostedMemberStripeBillingRefSnapshot,
  withHostedMemberStripeMutationLock,
} from "../hosted-onboarding/hosted-member-billing-store";
import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "../hosted-onboarding/legacy-usage-price";
import { requireHostedStripeBillingPlanConfig } from "../hosted-onboarding/runtime";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import {
  reconcileHostedAiUsageAllowancePeriodForMemberTx,
} from "../hosted-execution/usage-allowance";
import { getPrisma } from "../prisma";

const DEFAULT_BATCH_SIZE = 100;
const SECONDS_PER_DAY = 24 * 60 * 60;
const STRIPE_REQUEST_MAX_NETWORK_RETRIES = 0;
const STRIPE_REQUEST_TIMEOUT_MS = 80_000;
const STRIPE_UPDATE_MINIMUM_RUNWAY_SECONDS =
  Math.ceil(STRIPE_REQUEST_TIMEOUT_MS / 1000) + 1;

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
  currentPeriodEnd: Date | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  lastStripeEventCreatedAt: Date | null;
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedPulseTrialExtensionLockedCandidate {
  candidate: HostedPulseTrialExtensionCandidate | null;
  updateTrialEnd(trialEndsAt: Date, now: Date): Promise<void>;
}

export interface HostedPulseTrialExtensionCandidateSource {
  listCandidates(input: {
    limit: number;
    offset: number;
  }): Promise<readonly HostedPulseTrialExtensionCandidate[]>;
  withStripeMutationLock<TResult>(input: {
    candidate: HostedPulseTrialExtensionCandidate;
    run: (locked: HostedPulseTrialExtensionLockedCandidate) => Promise<TResult>;
  }): Promise<TResult>;
}

export interface HostedPulseTrialExtensionStripeRequestOptions {
  maxNetworkRetries: typeof STRIPE_REQUEST_MAX_NETWORK_RETRIES;
  timeout: typeof STRIPE_REQUEST_TIMEOUT_MS;
}

export type HostedPulseTrialExtensionStripeSubscription = Pick<
  Stripe.Subscription,
  | "cancel_at"
  | "cancel_at_period_end"
  | "customer"
  | "id"
  | "metadata"
  | "status"
  | "trial_end"
> & {
  items?: {
    data: readonly HostedPulseTrialExtensionStripeSubscriptionItem[];
  };
};

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
  ): Promise<HostedPulseTrialExtensionStripeSubscription>;
}

export type HostedPulseTrialExtensionSkipReason =
  | "local_candidate_changed"
  | "local_trial_window_invalid"
  | "missing_stripe_refs"
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
  | "preview_state_changed"
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
  page: number;
  skipped: Record<HostedPulseTrialExtensionSkipReason, number>;
  stripeTrialsExtended: number;
  wouldExtend: number;
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
      kind: "skipped";
      reason: HostedPulseTrialExtensionSkipReason;
    };

type HostedPulseTrialLockedApplyResult =
  | {
      kind: "already-marked";
      stripeTrialEnd: number;
    }
  | {
      kind: "extended";
      stripeTrialEnd: number;
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

export async function extendHostedPulseTrials(input: {
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  expectedCandidatePreviewTokens?: readonly string[];
  expectedCandidateSnapshotDigest?: string;
  maxCandidates?: number;
  mode?: HostedPulseTrialExtensionMode;
  now?: Date;
  page?: number;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialExtensionSummary> {
  const mode = input.mode ?? "dry-run";
  const page = input.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new Error("Pulse Trial extension page must be a non-negative integer.");
  }
  let boundedCandidates: readonly HostedPulseTrialExtensionCandidate[] | null = null;
  let hasMoreCandidates = false;
  if (input.maxCandidates !== undefined) {
    if (!Number.isSafeInteger(input.maxCandidates) || input.maxCandidates < 1) {
      throw new Error("Pulse Trial extension candidate limit must be a positive integer.");
    }
    const candidatePage = await readHostedPulseTrialExtensionCandidatePage({
      candidateSource: input.candidateSource,
      maxCandidates: input.maxCandidates,
      page,
    });
    boundedCandidates = candidatePage.candidates;
    hasMoreCandidates = candidatePage.hasMoreCandidates;
  }

  const candidateSnapshotDigest = boundedCandidates
    ? buildHostedPulseTrialExtensionCandidateSnapshotDigest(boundedCandidates, page)
    : null;
  if (
    input.expectedCandidateSnapshotDigest !== undefined &&
    input.expectedCandidateSnapshotDigest !== candidateSnapshotDigest
  ) {
    throw new HostedPulseTrialExtensionPreviewMismatchError();
  }
  if (
    input.expectedCandidatePreviewTokens !== undefined &&
    input.expectedCandidatePreviewTokens.length !== boundedCandidates?.length
  ) {
    throw new HostedPulseTrialExtensionPreviewMismatchError();
  }

  const summary = buildEmptyHostedPulseTrialExtensionSummary(
    mode,
    mode === "dry-run" ? candidateSnapshotDigest : null,
    hasMoreCandidates,
    page,
  );
  let candidateOffset = 0;

  for (;;) {
    const candidates: readonly HostedPulseTrialExtensionCandidate[] = boundedCandidates ??
      await input.candidateSource.listCandidates({
        limit: DEFAULT_BATCH_SIZE,
        offset: candidateOffset,
      });
    if (candidates.length === 0) {
      return summary;
    }

    candidateOffset += candidates.length;

    for (const [candidateIndex, candidate] of candidates.entries()) {
      summary.candidates += 1;

      const localSkipReason = classifyHostedPulseTrialExtensionCandidate(candidate);
      if (localSkipReason) {
        const previewToken = buildHostedPulseTrialExtensionCandidatePreviewToken({
          action: { kind: "skipped", reason: localSkipReason },
          candidate,
          subscription: null,
        });
        if (mode === "dry-run") {
          appendHostedPulseTrialExtensionCandidatePreviewToken(summary, previewToken);
        } else if (
          input.expectedCandidatePreviewTokens !== undefined &&
          input.expectedCandidatePreviewTokens[candidateIndex] !== previewToken
        ) {
          summary.failures.preview_state_changed += 1;
          return summary;
        }
        summary.skipped[localSkipReason] += 1;
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

      const providerState: { result: HostedPulseTrialLockedApplyResult | null } = {
        result: null,
      };
      let lockedOutcome: HostedPulseTrialLockedOutcome;
      try {
        lockedOutcome = await input.candidateSource.withStripeMutationLock({
          candidate,
          run: async (locked) => {
            if (!locked.candidate) {
              return {
                localReconciliation: null,
                result: input.expectedCandidatePreviewTokens
                  ? { kind: "preview-stale" }
                  : { kind: "skipped", reason: "local_candidate_changed" },
              };
            }

            const lockedLocalSkipReason = classifyHostedPulseTrialExtensionCandidate(
              locked.candidate,
            );
            if (lockedLocalSkipReason) {
              return {
                localReconciliation: null,
                result: input.expectedCandidatePreviewTokens
                  ? { kind: "preview-stale" }
                  : { kind: "skipped", reason: lockedLocalSkipReason },
              };
            }

            const providerResult = await applyHostedPulseTrialExtensionUnderLock({
              candidate: locked.candidate,
              expectedPreviewToken: input.expectedCandidatePreviewTokens?.[candidateIndex],
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
        });
      } catch {
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
        return summary;
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

    if (boundedCandidates) {
      return summary;
    }
  }
}

export async function extendHostedPulseTrialsForCampaign(input: {
  expectedCandidatePreviewTokens?: readonly string[];
  expectedCandidateSnapshotDigest?: string;
  maxCandidates?: number;
  memberId?: string;
  mode: HostedPulseTrialExtensionMode;
  now?: Date;
  page?: number;
  priceId?: string;
  prisma?: PrismaClient;
  stripe?: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialExtensionSummary> {
  const prisma = input.prisma ?? getPrisma();
  const billingConfig = input.priceId && input.stripe
    ? null
    : requireHostedStripeBillingPlanConfig({ billingPlanCode: "launch_monthly" });
  const priceId = input.priceId ?? billingConfig?.priceId;
  if (!priceId) {
    throw new Error("Stripe price configuration is required for Pulse Trial extension.");
  }

  return extendHostedPulseTrials({
    candidateSource: createPrismaHostedPulseTrialExtensionCandidateSource(prisma, {
      memberId: input.memberId,
    }),
    expectedCandidatePreviewTokens: input.expectedCandidatePreviewTokens,
    expectedCandidateSnapshotDigest: input.expectedCandidateSnapshotDigest,
    maxCandidates: input.maxCandidates,
    mode: input.mode,
    now: input.now,
    page: input.page,
    priceId,
    stripe: input.stripe ?? createHostedPulseTrialExtensionStripeClient(billingConfig?.stripe),
  });
}

export function classifyHostedPulseTrialExtensionSubscription(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  nowUnixSeconds: number;
  priceId: string;
  subscription: HostedPulseTrialExtensionStripeSubscription;
}): HostedPulseTrialExtensionClassification {
  if (input.subscription.id !== input.candidate.stripeSubscriptionId) {
    return { ok: false, reason: "stripe_subscription_id_mismatch" };
  }
  if (input.subscription.status !== "trialing") {
    return { ok: false, reason: "stripe_subscription_not_trialing" };
  }
  if (input.subscription.cancel_at_period_end || input.subscription.cancel_at !== null) {
    return { ok: false, reason: "stripe_subscription_canceling" };
  }
  if (coerceStripeCustomerId(input.subscription.customer) !== input.candidate.stripeCustomerId) {
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
    memberId?: string;
  } = {},
): HostedPulseTrialExtensionCandidateSource {
  const where = buildPrismaHostedPulseTrialExtensionCandidateWhere(options.memberId);
  return {
    async listCandidates(input) {
      const records = await prisma.hostedMemberBillingRef.findMany({
        orderBy: { memberId: "asc" },
        skip: input.offset,
        take: input.limit,
        where,
      });

      return Promise.all(records.map((record) =>
        projectHostedPulseTrialExtensionCandidate(record, prisma)
      ));
    },
    withStripeMutationLock(input) {
      return withHostedMemberStripeMutationLock({
        memberId: input.candidate.memberId,
        prisma,
        run: async (tx) => {
          const candidate = await readLockedPrismaHostedPulseTrialExtensionCandidate({
            expectedCandidate: input.candidate,
            tx,
          });
          return input.run({
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
      });
    },
  };
}

function buildPrismaHostedPulseTrialExtensionCandidateWhere(
  memberId?: string,
): Prisma.HostedMemberBillingRefWhereInput {
  return {
    pulseTrialRedeemedAt: {
      lt: new Date(HOSTED_PULSE_TRIAL_EXTENSION_COHORT_END_EXCLUSIVE_ISO),
    },
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

function buildEmptyHostedPulseTrialExtensionSummary(
  mode: HostedPulseTrialExtensionMode,
  candidateSnapshotDigest: string | null,
  hasMoreCandidates: boolean,
  page: number,
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
      preview_state_changed: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
      stripe_update_result_invalid: 0,
    },
    hasMoreCandidates,
    localWindowsReconciled: 0,
    mode,
    page,
    skipped: {
      local_candidate_changed: 0,
      local_trial_window_invalid: 0,
      missing_stripe_refs: 0,
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
  subscription: HostedPulseTrialExtensionStripeSubscription;
  targetTrialEnd: number;
}): boolean {
  const classification = classifyHostedPulseTrialExtensionSubscription({
    candidate: input.candidate,
    nowUnixSeconds: input.targetTrialEnd - 1,
    priceId: input.priceId,
    subscription: input.subscription,
  });
  return classification.ok &&
    classification.alreadyMarked &&
    classification.stripeTrialEnd === input.targetTrialEnd;
}

async function applyHostedPulseTrialExtensionUnderLock(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  expectedPreviewToken?: string;
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
    input.expectedPreviewToken !== undefined &&
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
    };
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
  };
}

async function projectHostedPulseTrialExtensionCandidate(
  record: HostedMemberBillingRef,
  prisma: HostedOnboardingReadClient,
): Promise<HostedPulseTrialExtensionCandidate> {
  const snapshot = await projectHostedMemberStripeBillingRefSnapshot(record, prisma);

  return {
    currentPeriodEnd: snapshot.currentPeriodEnd ?? null,
    currentTrialEndsAt: snapshot.currentTrialEndsAt ?? null,
    currentTrialStartedAt: snapshot.currentTrialStartedAt ?? null,
    lastStripeEventCreatedAt: snapshot.lastStripeEventCreatedAt ?? null,
    memberId: snapshot.memberId,
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
  } else if (action.locallyReconciled) {
    input.summary.alreadyExtended += 1;
  } else {
    input.summary.wouldReconcile += 1;
  }

  return buildHostedPulseTrialExtensionCandidatePreviewToken({
    action,
    candidate: input.candidate,
    subscription,
  });
}

async function readLockedPrismaHostedPulseTrialExtensionCandidate(input: {
  expectedCandidate: HostedPulseTrialExtensionCandidate;
  tx: Prisma.TransactionClient;
}): Promise<HostedPulseTrialExtensionCandidate | null> {
  const stripeCustomerLookupKeys = createHostedStripeCustomerLookupKeyReadCandidates(
    input.expectedCandidate.stripeCustomerId,
  );
  const stripeSubscriptionLookupKeys = createHostedStripeSubscriptionLookupKeyReadCandidates(
    input.expectedCandidate.stripeSubscriptionId,
  );
  if (stripeCustomerLookupKeys.length === 0 || stripeSubscriptionLookupKeys.length === 0) {
    return null;
  }

  const record = await input.tx.hostedMemberBillingRef.findFirst({
    where: {
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
      memberId: input.expectedCandidate.memberId,
      member: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
      stripeCustomerLookupKey: { in: stripeCustomerLookupKeys },
      stripeSubscriptionLookupKey: { in: stripeSubscriptionLookupKeys },
    },
  });

  if (!record) {
    return null;
  }

  return {
    currentPeriodEnd: record.currentPeriodEnd,
    currentTrialEndsAt: record.currentTrialEndsAt,
    currentTrialStartedAt: record.currentTrialStartedAt,
    lastStripeEventCreatedAt: record.lastStripeEventCreatedAt,
    memberId: record.memberId,
    stripeCustomerId: input.expectedCandidate.stripeCustomerId,
    stripeSubscriptionId: input.expectedCandidate.stripeSubscriptionId,
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
  maxCandidates: number;
  page: number;
}): Promise<{
  candidates: readonly HostedPulseTrialExtensionCandidate[];
  hasMoreCandidates: boolean;
}> {
  const offset = input.page * input.maxCandidates;
  if (!Number.isSafeInteger(offset)) {
    throw new Error("Pulse Trial extension page offset must be a safe integer.");
  }
  const candidates = await input.candidateSource.listCandidates({
    limit: input.maxCandidates + 1,
    offset,
  });

  return {
    candidates: candidates.slice(0, input.maxCandidates),
    hasMoreCandidates: candidates.length > input.maxCandidates,
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
  page: number,
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
      candidate.stripeCustomerId,
      candidate.stripeSubscriptionId,
      candidate.currentTrialStartedAt?.toISOString() ?? null,
      candidate.currentTrialEndsAt?.toISOString() ?? null,
      candidate.currentPeriodEnd?.toISOString() ?? null,
      candidate.lastStripeEventCreatedAt?.toISOString() ?? null,
    ]);

  return `pulse-candidates-v2.${createHash("sha256")
    .update(HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN, "utf8")
    .update("\0", "utf8")
    .update(page.toString(), "utf8")
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
      currentPeriodEnd: input.candidate.currentPeriodEnd?.toISOString() ?? null,
      currentTrialEndsAt: input.candidate.currentTrialEndsAt?.toISOString() ?? null,
      currentTrialStartedAt: input.candidate.currentTrialStartedAt?.toISOString() ?? null,
      lastStripeEventCreatedAt: input.candidate.lastStripeEventCreatedAt?.toISOString() ?? null,
      memberId: input.candidate.memberId,
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
        }
      : null,
  };

  return `pulse-target-v1.${createHash("sha256")
    .update(HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("base64url")}`;
}
