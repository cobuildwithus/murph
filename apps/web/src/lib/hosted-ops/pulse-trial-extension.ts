import {
  HostedBillingStatus,
  type HostedMemberBillingRef,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  HOSTED_PULSE_TRIAL_OFFER,
} from "../hosted-onboarding/billing-plans";
import {
  projectHostedMemberStripeBillingRefSnapshot,
  withHostedMemberStripeMutationLock,
} from "../hosted-onboarding/hosted-member-billing-store";
import { requireHostedStripeApi } from "../hosted-onboarding/runtime";
import { getPrisma } from "../prisma";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const SECONDS_PER_DAY = 24 * 60 * 60;

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
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  usagePeriodEnd: Date | null;
}

export interface HostedPulseTrialExtensionCandidateSource {
  listCandidates(input: {
    afterMemberId: string | null;
    limit: number;
  }): Promise<readonly HostedPulseTrialExtensionCandidate[]>;
  updateCandidateTrialEnd(input: {
    candidate: HostedPulseTrialExtensionCandidate;
    trialEndsAt: Date;
  }): Promise<void>;
  withStripeMutationLock<TResult>(input: {
    candidate: HostedPulseTrialExtensionCandidate;
    run: () => Promise<TResult>;
  }): Promise<TResult>;
}

export interface HostedPulseTrialExtensionStripeSubscription {
  customer: string | { id?: string } | null;
  id: string;
  metadata?: Record<string, string> | null;
  status: string;
  trial_end: number | null;
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
    options: { idempotencyKey: string },
  ): Promise<HostedPulseTrialExtensionStripeSubscription>;
}

export type HostedPulseTrialExtensionSkipReason =
  | "local_trial_window_invalid"
  | "local_usage_period_missing"
  | "missing_stripe_refs"
  | "stripe_billing_plan_mismatch"
  | "stripe_campaign_marker_conflict"
  | "stripe_checkout_offer_mismatch"
  | "stripe_customer_mismatch"
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

export async function extendHostedPulseTrials(input: {
  batchSize?: number;
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  mode?: HostedPulseTrialExtensionMode;
  now?: Date;
  stripe: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialExtensionSummary> {
  const mode = input.mode ?? "dry-run";
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("Pulse Trial extension batch size must be from 1 to 500.");
  }

  const now = input.now ?? new Date();
  const nowUnixSeconds = Math.floor(now.getTime() / 1000);
  const summary = buildEmptyHostedPulseTrialExtensionSummary(mode);
  let afterMemberId: string | null = null;

  for (;;) {
    const candidates = await input.candidateSource.listCandidates({
      afterMemberId,
      limit: batchSize,
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

      let subscription: HostedPulseTrialExtensionStripeSubscription;
      try {
        subscription = await input.stripe.retrieveSubscription(
          requireStripeSubscriptionId(candidate),
        );
      } catch {
        summary.failures.stripe_retrieve_failed += 1;
        continue;
      }

      const classification = classifyHostedPulseTrialExtensionSubscription({
        candidate,
        nowUnixSeconds,
        subscription,
      });
      if (!classification.ok) {
        summary.skipped[classification.reason] += 1;
        continue;
      }

      if (classification.alreadyMarked) {
        const markedTrialEndsAt = stripeUnixSecondsToDate(classification.stripeTrialEnd);
        if (isHostedPulseTrialExtensionLocallyReconciled({
          candidate,
          trialEndsAt: markedTrialEndsAt,
        })) {
          summary.alreadyExtended += 1;
          continue;
        }

        if (mode === "dry-run") {
          summary.wouldReconcile += 1;
          continue;
        }

        if (await reconcileHostedPulseTrialExtension({
          candidate,
          candidateSource: input.candidateSource,
          summary,
          trialEndsAt: markedTrialEndsAt,
        })) {
          summary.localWindowsReconciled += 1;
        }
        continue;
      }

      if (mode === "dry-run") {
        summary.wouldExtend += 1;
        continue;
      }

      let lockedResult: HostedPulseTrialLockedApplyResult;
      try {
        lockedResult = await input.candidateSource.withStripeMutationLock({
          candidate,
          run: () => applyHostedPulseTrialExtensionUnderLock({
            candidate,
            nowUnixSeconds,
            stripe: input.stripe,
          }),
        });
      } catch {
        summary.failures.db_update_failed += 1;
        continue;
      }

      if (lockedResult.kind === "failure") {
        summary.failures[lockedResult.reason] += 1;
        continue;
      }
      if (lockedResult.kind === "skipped") {
        summary.skipped[lockedResult.reason] += 1;
        continue;
      }

      if (lockedResult.kind === "extended") {
        summary.stripeTrialsExtended += 1;
      }
      if (await reconcileHostedPulseTrialExtension({
        candidate,
        candidateSource: input.candidateSource,
        summary,
        trialEndsAt: stripeUnixSecondsToDate(lockedResult.stripeTrialEnd),
      })) {
        summary.localWindowsReconciled += 1;
      }
    }
  }
}

export async function extendHostedPulseTrialsForOps(input: {
  mode: HostedPulseTrialExtensionMode;
  now?: Date;
  prisma?: PrismaClient;
  stripe?: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialExtensionSummary> {
  const prisma = input.prisma ?? getPrisma();

  return extendHostedPulseTrials({
    candidateSource: createPrismaHostedPulseTrialExtensionCandidateSource(prisma),
    mode: input.mode,
    now: input.now,
    stripe: input.stripe ?? createHostedPulseTrialExtensionStripeClient(),
  });
}

export function classifyHostedPulseTrialExtensionSubscription(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  nowUnixSeconds: number;
  subscription: HostedPulseTrialExtensionStripeSubscription;
}): HostedPulseTrialExtensionClassification {
  if (input.subscription.id !== input.candidate.stripeSubscriptionId) {
    return { ok: false, reason: "stripe_subscription_id_mismatch" };
  }
  if (input.subscription.status !== "trialing") {
    return { ok: false, reason: "stripe_subscription_not_trialing" };
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

export function buildHostedPulseTrialExtensionStripeUpdateParams(input: {
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
    async updateCandidateTrialEnd(input) {
      const currentTrialStartedAt = input.candidate.currentTrialStartedAt;
      if (!currentTrialStartedAt) {
        throw new Error("Pulse Trial extension candidate is missing its trial start.");
      }

      await prisma.$transaction(async (tx) => {
        const billingUpdate = await tx.hostedMemberBillingRef.updateMany({
          data: {
            currentPeriodEnd: input.trialEndsAt,
            currentTrialEndsAt: input.trialEndsAt,
          },
          where: {
            currentBillingPhase: "trial",
            currentBillingPlanCode: "launch_monthly",
            currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
            currentTrialStartedAt,
            memberId: input.candidate.memberId,
          },
        });
        if (billingUpdate.count !== 1) {
          throw new Error("Pulse Trial billing state changed during extension.");
        }

        const usageUpdate = await tx.hostedAiUsagePeriod.updateMany({
          data: {
            periodEnd: input.trialEndsAt,
          },
          where: {
            billingPlanCode: "launch_monthly",
            memberId: input.candidate.memberId,
            periodStart: currentTrialStartedAt,
          },
        });
        if (usageUpdate.count !== 1) {
          throw new Error("Pulse Trial usage period changed during extension.");
        }
      });
    },
    withStripeMutationLock(input) {
      return withHostedMemberStripeMutationLock({
        memberId: input.candidate.memberId,
        prisma,
        run: input.run,
      });
    },
  };
}

export function createHostedPulseTrialExtensionStripeClient(
  stripe: Pick<Stripe, "subscriptions"> = requireHostedStripeApi(),
): HostedPulseTrialExtensionStripeClient {
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
  if (!candidate.usagePeriodEnd) {
    return "local_usage_period_missing";
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
      local_trial_window_invalid: 0,
      local_usage_period_missing: 0,
      missing_stripe_refs: 0,
      stripe_billing_plan_mismatch: 0,
      stripe_campaign_marker_conflict: 0,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
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
    input.candidate.currentPeriodEnd?.getTime() === targetTime &&
    input.candidate.usagePeriodEnd?.getTime() === targetTime;
}

function isValidHostedPulseTrialExtensionUpdateResult(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  subscription: HostedPulseTrialExtensionStripeSubscription;
  targetTrialEnd: number;
}): boolean {
  const classification = classifyHostedPulseTrialExtensionSubscription({
    candidate: input.candidate,
    nowUnixSeconds: input.targetTrialEnd - 1,
    subscription: input.subscription,
  });
  return classification.ok &&
    classification.alreadyMarked &&
    classification.stripeTrialEnd === input.targetTrialEnd;
}

async function applyHostedPulseTrialExtensionUnderLock(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  nowUnixSeconds: number;
  stripe: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialLockedApplyResult> {
  const stripeSubscriptionId = requireStripeSubscriptionId(input.candidate);
  let subscription: HostedPulseTrialExtensionStripeSubscription;
  try {
    subscription = await input.stripe.retrieveSubscription(stripeSubscriptionId);
  } catch {
    return { kind: "failure", reason: "stripe_retrieve_failed" };
  }

  const classification = classifyHostedPulseTrialExtensionSubscription({
    candidate: input.candidate,
    nowUnixSeconds: input.nowUnixSeconds,
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
      },
    );
  } catch {
    return { kind: "failure", reason: "stripe_update_failed" };
  }

  if (!isValidHostedPulseTrialExtensionUpdateResult({
    candidate: input.candidate,
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

async function reconcileHostedPulseTrialExtension(input: {
  candidate: HostedPulseTrialExtensionCandidate;
  candidateSource: HostedPulseTrialExtensionCandidateSource;
  summary: HostedPulseTrialExtensionSummary;
  trialEndsAt: Date;
}): Promise<boolean> {
  try {
    await input.candidateSource.updateCandidateTrialEnd({
      candidate: input.candidate,
      trialEndsAt: input.trialEndsAt,
    });
    return true;
  } catch {
    input.summary.failures.db_update_failed += 1;
    return false;
  }
}

async function projectHostedPulseTrialExtensionCandidate(
  record: HostedMemberBillingRef,
  prisma: PrismaClient,
): Promise<HostedPulseTrialExtensionCandidate> {
  const snapshot = await projectHostedMemberStripeBillingRefSnapshot(record, prisma);
  const usagePeriod = snapshot.currentTrialStartedAt
    ? await prisma.hostedAiUsagePeriod.findUnique({
        select: { periodEnd: true },
        where: {
          memberId_periodStart: {
            memberId: snapshot.memberId,
            periodStart: snapshot.currentTrialStartedAt,
          },
        },
      })
    : null;

  return {
    currentPeriodEnd: snapshot.currentPeriodEnd ?? null,
    currentTrialEndsAt: snapshot.currentTrialEndsAt ?? null,
    currentTrialStartedAt: snapshot.currentTrialStartedAt ?? null,
    memberId: snapshot.memberId,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    usagePeriodEnd: usagePeriod?.periodEnd ?? null,
  };
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
