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
const STRIPE_UPDATE_MAX_NETWORK_RETRIES = 2;
const STRIPE_UPDATE_TIMEOUT_MS = 80_000;
const STRIPE_UPDATE_MINIMUM_RUNWAY_SECONDS = 361;

export const HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN =
  "pulse-beta-extension-2026-07" as const;
export const HOSTED_PULSE_TRIAL_EXTENSION_DAYS = 7;
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
    afterMemberId: string | null;
    limit: number;
  }): Promise<readonly HostedPulseTrialExtensionCandidate[]>;
  withStripeMutationLock<TResult>(input: {
    candidate: HostedPulseTrialExtensionCandidate;
    run: (locked: HostedPulseTrialExtensionLockedCandidate) => Promise<TResult>;
  }): Promise<TResult>;
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
  ): Promise<HostedPulseTrialExtensionStripeSubscription>;
  updateSubscription(
    subscriptionId: string,
    params: HostedPulseTrialExtensionStripeUpdateParams,
    options: {
      idempotencyKey: string;
      maxNetworkRetries: typeof STRIPE_UPDATE_MAX_NETWORK_RETRIES;
      timeout: typeof STRIPE_UPDATE_TIMEOUT_MS;
    },
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
  | "stripe_retrieve_failed"
  | "stripe_update_failed"
  | "stripe_update_result_invalid";

export interface HostedPulseTrialExtensionSummary {
  alreadyExtended: number;
  campaign: typeof HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN;
  candidates: number;
  extensionDays: typeof HOSTED_PULSE_TRIAL_EXTENSION_DAYS;
  failures: Record<HostedPulseTrialExtensionFailureReason, number>;
  localWindowsReconciled: number;
  mode: HostedPulseTrialExtensionMode;
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
      reason: Exclude<HostedPulseTrialExtensionFailureReason, "db_update_failed">;
    }
  | {
      kind: "skipped";
      reason: HostedPulseTrialExtensionSkipReason;
    };

type HostedPulseTrialLockedOutcome = {
  localReconciliation: "already-current" | "reconciled" | null;
  result: HostedPulseTrialLockedApplyResult;
};

export async function extendHostedPulseTrials(input: {
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  mode?: HostedPulseTrialExtensionMode;
  now?: Date;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialExtensionSummary> {
  const mode = input.mode ?? "dry-run";

  const summary = buildEmptyHostedPulseTrialExtensionSummary(mode);
  let afterMemberId: string | null = null;

  for (;;) {
    const candidates = await input.candidateSource.listCandidates({
      afterMemberId,
      limit: DEFAULT_BATCH_SIZE,
    });
    if (candidates.length === 0) {
      return summary;
    }

    afterMemberId = candidates.at(-1)?.memberId ?? afterMemberId;

    for (const candidate of candidates) {
      summary.candidates += 1;

      const localSkipReason = classifyHostedPulseTrialExtensionCandidate(candidate);
      if (localSkipReason) {
        summary.skipped[localSkipReason] += 1;
        continue;
      }

      if (mode === "dry-run") {
        await previewHostedPulseTrialExtensionCandidate({
          candidate,
          now: input.now,
          priceId: input.priceId,
          stripe: input.stripe,
          summary,
        });
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
                result: { kind: "skipped", reason: "local_candidate_changed" },
              };
            }

            const lockedLocalSkipReason = classifyHostedPulseTrialExtensionCandidate(
              locked.candidate,
            );
            if (lockedLocalSkipReason) {
              return {
                localReconciliation: null,
                result: { kind: "skipped", reason: lockedLocalSkipReason },
              };
            }

            const providerResult = await applyHostedPulseTrialExtensionUnderLock({
              candidate: locked.candidate,
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
  }
}

export async function extendHostedPulseTrialsForCampaign(input: {
  mode: HostedPulseTrialExtensionMode;
  now?: Date;
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
    candidateSource: createPrismaHostedPulseTrialExtensionCandidateSource(prisma),
    mode: input.mode,
    now: input.now,
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
): HostedPulseTrialExtensionCandidateSource {
  return {
    async listCandidates(input) {
      const records = await prisma.hostedMemberBillingRef.findMany({
        ...(input.afterMemberId
          ? {
              cursor: { memberId: input.afterMemberId },
              skip: 1,
            }
          : {}),
        orderBy: { memberId: "asc" },
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

function createHostedPulseTrialExtensionStripeClient(
  stripe: Pick<Stripe, "subscriptions"> | undefined,
): HostedPulseTrialExtensionStripeClient {
  if (!stripe) {
    throw new Error("Stripe billing configuration is required for Pulse Trial extension.");
  }
  return {
    retrieveSubscription(subscriptionId) {
      return stripe.subscriptions.retrieve(subscriptionId);
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
): HostedPulseTrialExtensionSummary {
  return {
    alreadyExtended: 0,
    campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    candidates: 0,
    extensionDays: HOSTED_PULSE_TRIAL_EXTENSION_DAYS,
    failures: {
      db_update_failed: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
      stripe_update_result_invalid: 0,
    },
    localWindowsReconciled: 0,
    mode,
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
  now?: Date;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialLockedApplyResult> {
  const stripeSubscriptionId = requireStripeSubscriptionId(input.candidate);
  let subscription: HostedPulseTrialExtensionStripeSubscription;
  try {
    subscription = await input.stripe.retrieveSubscription(stripeSubscriptionId);
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
  if (!classification.ok) {
    return { kind: "skipped", reason: classification.reason };
  }
  if (classification.alreadyMarked) {
    return {
      kind: "already-marked",
      stripeTrialEnd: classification.stripeTrialEnd,
    };
  }
  if (
    classification.stripeTrialEnd <=
      nowUnixSeconds + STRIPE_UPDATE_MINIMUM_RUNWAY_SECONDS
  ) {
    return { kind: "skipped", reason: "stripe_trial_end_invalid" };
  }

  const targetTrialEnd = classification.stripeTrialEnd +
    HOSTED_PULSE_TRIAL_EXTENSION_DAYS * SECONDS_PER_DAY;
  let updatedSubscription: HostedPulseTrialExtensionStripeSubscription;
  try {
    updatedSubscription = await input.stripe.updateSubscription(
      stripeSubscriptionId,
      buildHostedPulseTrialExtensionStripeUpdateParams({
        subscription,
        targetTrialEnd,
      }),
      {
        idempotencyKey: buildHostedPulseTrialExtensionIdempotencyKey(
          stripeSubscriptionId,
        ),
        maxNetworkRetries: STRIPE_UPDATE_MAX_NETWORK_RETRIES,
        timeout: STRIPE_UPDATE_TIMEOUT_MS,
      },
    );
  } catch {
    return { kind: "failure", reason: "stripe_update_failed" };
  }

  if (!isValidHostedPulseTrialExtensionUpdateResult({
    candidate: input.candidate,
    priceId: input.priceId,
    subscription: updatedSubscription,
    targetTrialEnd,
  })) {
    return { kind: "failure", reason: "stripe_update_result_invalid" };
  }

  return {
    kind: "extended",
    stripeTrialEnd: targetTrialEnd,
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
}): Promise<void> {
  let subscription: HostedPulseTrialExtensionStripeSubscription;
  try {
    subscription = await input.stripe.retrieveSubscription(
      requireStripeSubscriptionId(input.candidate),
    );
  } catch {
    input.summary.failures.stripe_retrieve_failed += 1;
    return;
  }

  const nowUnixSeconds = resolveHostedPulseTrialExtensionNowUnixSeconds(input.now);
  const classification = classifyHostedPulseTrialExtensionSubscription({
    candidate: input.candidate,
    nowUnixSeconds,
    priceId: input.priceId,
    subscription,
  });
  if (!classification.ok) {
    input.summary.skipped[classification.reason] += 1;
    return;
  }

  if (!classification.alreadyMarked) {
    if (
      classification.stripeTrialEnd <=
        nowUnixSeconds + STRIPE_UPDATE_MINIMUM_RUNWAY_SECONDS
    ) {
      input.summary.skipped.stripe_trial_end_invalid += 1;
      return;
    }
    input.summary.wouldExtend += 1;
    return;
  }

  const trialEndsAt = stripeUnixSecondsToDate(classification.stripeTrialEnd);
  if (isHostedPulseTrialExtensionLocallyReconciled({
    candidate: input.candidate,
    trialEndsAt,
  })) {
    input.summary.alreadyExtended += 1;
  } else {
    input.summary.wouldReconcile += 1;
  }
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
