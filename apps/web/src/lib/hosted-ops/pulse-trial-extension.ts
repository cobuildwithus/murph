import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  HOSTED_PULSE_TRIAL_OFFER,
} from "../hosted-onboarding/billing-plans";
import { readHostedContactPrivacyKeyring } from "../hosted-onboarding/env";
import {
  HostedMemberStripeMutationLockBusyError,
  withHostedMemberStripeMutationLockForOps,
  writeHostedMemberStripeBillingRefTx,
} from "../hosted-onboarding/hosted-member-billing-store";
import {
  readHostedMemberBillingSnapshot,
  updateHostedMemberCoreState,
  type HostedMemberBillingSnapshot,
} from "../hosted-onboarding/hosted-member-store";
import {
  isHostedPulseTrialSubscriptionForKnownPolicy,
} from "../hosted-onboarding/pulse-trial-subscription-cleanup";
import { requireHostedStripeBillingPlanConfig } from "../hosted-onboarding/runtime";
import {
  reconcileHostedAiUsageAllowancePeriodForMemberTx,
} from "../hosted-execution/usage-allowance";
import { getPrisma } from "../prisma";

const SECONDS_PER_DAY = 24 * 60 * 60;
const PREVIEW_PROOF_TTL_MS = 15 * 60_000;
const STRIPE_REQUEST_TIMEOUT_MS = 80_000;
const STRIPE_REQUEST_MAX_NETWORK_RETRIES = 0;
const MEMBER_LOCK_ACQUISITION_TIMEOUT_MS = 25_000;
const MEMBER_TRANSACTION_TIMEOUT_MS = 190_000;
const PREVIEW_TOKEN_PREFIX = "pulse-member-preview-v1";
const PREVIEW_HMAC_CONTEXT = "hosted-member-pulse-trial-extension-preview-v1";
const EXTENSION_OPERATION_METADATA_KEY = "murphTrialExtensionOperation";
const EXTENSION_DAYS_METADATA_KEY = "murphTrialExtensionDays";

export const HOSTED_PULSE_TRIAL_EXTENSION_DAYS = 7 as const;

export type HostedPulseTrialExtensionEligibilityCode =
  | "eligible"
  | "member_not_found"
  | "member_suspended"
  | "missing_billing_reference"
  | "not_a_redeemed_pulse_trial"
  | "paid_billing"
  | "scheduled_billing_change"
  | "missing_stripe_reference"
  | "provider_identity_mismatch"
  | "provider_subscription_canceling"
  | "provider_subscription_not_extendable"
  | "provider_trial_end_invalid";

export type HostedPulseTrialExtensionOutcome =
  | "preview"
  | "extended"
  | "reconciled";

export interface HostedPulseTrialExtensionPreviewProof {
  previewedAt: string;
  targetTrialEndsAt: string;
  token: string;
}

export interface HostedPulseTrialExtensionResult {
  currentTrialEndsAt: string | null;
  eligibilityCode: HostedPulseTrialExtensionEligibilityCode;
  eligible: boolean;
  extensionDays: typeof HOSTED_PULSE_TRIAL_EXTENSION_DAYS;
  localBillingPhase: string | null;
  localBillingStatus: string | null;
  memberId: string;
  message: string;
  outcome: HostedPulseTrialExtensionOutcome;
  previewProof: HostedPulseTrialExtensionPreviewProof | null;
  providerStatus: string | null;
  targetTrialEndsAt: string | null;
}

export interface HostedPulseTrialExtensionSubscription {
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  customer: string | { id: string } | null;
  id: string;
  items: {
    data: Array<{
      id: string;
      price: {
        id: string;
        metadata?: Record<string, string> | null;
        recurring?: {
          interval?: string;
          interval_count?: number;
          usage_type?: string;
        } | null;
      };
      quantity?: number | null;
    }>;
    has_more: boolean;
  };
  metadata: Record<string, string>;
  status: Stripe.Subscription.Status;
  trial_end: number | null;
  trial_settings?: {
    end_behavior: {
      missing_payment_method: "cancel" | "create_invoice" | "pause";
    };
  } | null;
  trial_start: number | null;
}

interface HostedPulseTrialExtensionStripeUpdateParams {
  metadata: Record<string, string>;
  proration_behavior: "none";
  trial_end: number;
}

interface HostedPulseTrialExtensionStripeClient {
  retrieveSubscription(
    subscriptionId: string,
    options: Stripe.RequestOptions,
  ): Promise<HostedPulseTrialExtensionSubscription>;
  updateSubscription(
    subscriptionId: string,
    params: HostedPulseTrialExtensionStripeUpdateParams,
    options: Stripe.RequestOptions,
  ): Promise<HostedPulseTrialExtensionSubscription>;
}

interface HostedPulseTrialExtensionDependencies {
  priceId?: string;
  prisma?: PrismaClient;
  stripe?: HostedPulseTrialExtensionStripeClient;
}

type HostedPulseTrialExtensionState = {
  currentTrialEnd: number | null;
  eligibilityCode: HostedPulseTrialExtensionEligibilityCode;
  eligible: boolean;
  member: HostedMemberBillingSnapshot | null;
  message: string;
  providerStatus: string | null;
  subscription: HostedPulseTrialExtensionSubscription | null;
  targetTrialEnd: number | null;
};

export class HostedPulseTrialExtensionPreviewStaleError extends Error {
  constructor() {
    super("Billing changed since Preview. Preview this member again before applying.");
    this.name = "HostedPulseTrialExtensionPreviewStaleError";
  }
}

export class HostedPulseTrialExtensionProviderError extends Error {
  constructor() {
    super("Stripe could not confirm this trial extension request.");
    this.name = "HostedPulseTrialExtensionProviderError";
  }
}

export class HostedPulseTrialExtensionLockBusyError extends Error {
  constructor() {
    super("Another billing change is running for this member. Try again shortly.");
    this.name = "HostedPulseTrialExtensionLockBusyError";
  }
}

export async function previewHostedPulseTrialExtension(
  input: {
    memberId: string;
    now?: Date;
  } & HostedPulseTrialExtensionDependencies,
): Promise<HostedPulseTrialExtensionResult> {
  const dependencies = resolveHostedPulseTrialExtensionDependencies(input);
  const now = input.now ?? new Date();
  const member = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: dependencies.prisma,
  });
  const state = await inspectHostedPulseTrialExtensionState({
    member,
    memberId: input.memberId,
    now,
    priceId: dependencies.priceId,
    stripe: dependencies.stripe,
  });

  if (!state.eligible || !state.subscription || state.targetTrialEnd === null) {
    return buildHostedPulseTrialExtensionResult({
      memberId: input.memberId,
      outcome: "preview",
      previewProof: null,
      state,
    });
  }

  const proof = buildHostedPulseTrialExtensionPreviewProof({
    member: state.member,
    memberId: input.memberId,
    previewedAt: now,
    subscription: state.subscription,
    targetTrialEnd: state.targetTrialEnd,
  });
  return buildHostedPulseTrialExtensionResult({
    memberId: input.memberId,
    outcome: "preview",
    previewProof: proof,
    state,
  });
}

export async function applyHostedPulseTrialExtension(
  input: {
    memberId: string;
    now?: Date;
    previewProof: HostedPulseTrialExtensionPreviewProof;
  } & HostedPulseTrialExtensionDependencies,
): Promise<HostedPulseTrialExtensionResult> {
  const dependencies = resolveHostedPulseTrialExtensionDependencies(input);
  const now = input.now ?? new Date();
  const proofDates = parseHostedPulseTrialExtensionPreviewProofDates({
    now,
    previewProof: input.previewProof,
  });
  const operationId = readHostedPulseTrialExtensionOperationId(
    input.previewProof.token,
  );

  try {
    return await withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs: MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
      memberId: input.memberId,
      prisma: dependencies.prisma,
      run: async (tx) => {
        const member = await readHostedMemberBillingSnapshot({
          memberId: input.memberId,
          prisma: tx,
        });
        const state = await inspectHostedPulseTrialExtensionState({
          member,
          memberId: input.memberId,
          now: proofDates.previewedAt,
          priceId: dependencies.priceId,
          stripe: dependencies.stripe,
        });
        const subscription = state.subscription;

        if (
          subscription &&
          isHostedPulseTrialExtensionAlreadyApplied({
            memberId: input.memberId,
            operationId,
            priceId: dependencies.priceId,
            subscription,
            targetTrialEnd: proofDates.targetTrialEndUnix,
          })
        ) {
          const reconciledMember = await reconcileHostedPulseTrialExtensionLocalState({
            member,
            now,
            subscription,
            targetTrialEndsAt: proofDates.targetTrialEndsAt,
            tx,
          });
          return buildHostedPulseTrialExtensionResult({
            memberId: input.memberId,
            outcome: "reconciled",
            previewProof: null,
            state: {
              ...state,
              currentTrialEnd: proofDates.targetTrialEndUnix,
              eligibilityCode: "eligible",
              eligible: true,
              member: reconciledMember,
              message: "The seven-day extension was already in Stripe and local billing is reconciled.",
              providerStatus: subscription.status,
              targetTrialEnd: proofDates.targetTrialEndUnix,
            },
          });
        }

        requireHostedPulseTrialExtensionPreviewFresh({
          now,
          previewedAt: proofDates.previewedAt,
        });

        if (
          !state.eligible ||
          !member ||
          !subscription ||
          state.targetTrialEnd !== proofDates.targetTrialEndUnix ||
          !verifyHostedPulseTrialExtensionPreviewProof({
            member,
            memberId: input.memberId,
            previewProof: input.previewProof,
            subscription,
            targetTrialEnd: proofDates.targetTrialEndUnix,
          })
        ) {
          throw new HostedPulseTrialExtensionPreviewStaleError();
        }

        let updatedSubscription: HostedPulseTrialExtensionSubscription;
        try {
          updatedSubscription = await dependencies.stripe.updateSubscription(
            subscription.id,
            {
              metadata: {
                [EXTENSION_DAYS_METADATA_KEY]:
                  HOSTED_PULSE_TRIAL_EXTENSION_DAYS.toString(),
                [EXTENSION_OPERATION_METADATA_KEY]: operationId,
              },
              proration_behavior: "none",
              trial_end: proofDates.targetTrialEndUnix,
            },
            {
              idempotencyKey: `hosted-member-trial-extension:${operationId}`,
              ...buildHostedPulseTrialExtensionStripeRequestOptions(),
            },
          );
        } catch {
          throw new HostedPulseTrialExtensionProviderError();
        }

        if (!isHostedPulseTrialExtensionAlreadyApplied({
          memberId: input.memberId,
          operationId,
          priceId: dependencies.priceId,
          subscription: updatedSubscription,
          targetTrialEnd: proofDates.targetTrialEndUnix,
        })) {
          throw new HostedPulseTrialExtensionProviderError();
        }

        const reconciledMember = await reconcileHostedPulseTrialExtensionLocalState({
          member,
          now,
          subscription: updatedSubscription,
          targetTrialEndsAt: proofDates.targetTrialEndsAt,
          tx,
        });
        return buildHostedPulseTrialExtensionResult({
          memberId: input.memberId,
          outcome: "extended",
          previewProof: null,
          state: {
            ...state,
            currentTrialEnd: proofDates.targetTrialEndUnix,
            member: reconciledMember,
            message: "The member's Pulse Trial now ends seven days later.",
            providerStatus: updatedSubscription.status,
          },
        });
      },
      transactionTimeoutMs: MEMBER_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw new HostedPulseTrialExtensionLockBusyError();
    }
    throw error;
  }
}

function resolveHostedPulseTrialExtensionDependencies(
  input: HostedPulseTrialExtensionDependencies,
): Required<HostedPulseTrialExtensionDependencies> {
  const prisma = input.prisma ?? getPrisma();
  const billingConfig = input.priceId && input.stripe
    ? null
    : requireHostedStripeBillingPlanConfig({ billingPlanCode: "launch_monthly" });
  const priceId = input.priceId ?? billingConfig?.priceId;
  const stripe = input.stripe ?? (billingConfig
    ? createHostedPulseTrialExtensionStripeClient(billingConfig.stripe)
    : null);
  if (!priceId || !stripe) {
    throw new Error("Stripe Pulse billing configuration is required for trial extension.");
  }
  return { priceId, prisma, stripe };
}

async function inspectHostedPulseTrialExtensionState(input: {
  member: HostedMemberBillingSnapshot | null;
  memberId: string;
  now: Date;
  priceId: string;
  stripe: HostedPulseTrialExtensionStripeClient;
}): Promise<HostedPulseTrialExtensionState> {
  const localReason = classifyHostedPulseTrialExtensionLocalState(input.member);
  if (localReason) {
    return buildIneligibleHostedPulseTrialExtensionState({
      code: localReason,
      member: input.member,
    });
  }

  const billingRef = input.member?.billingRef;
  if (!billingRef?.stripeSubscriptionId) {
    return buildIneligibleHostedPulseTrialExtensionState({
      code: "missing_stripe_reference",
      member: input.member,
    });
  }

  let subscription: HostedPulseTrialExtensionSubscription;
  try {
    subscription = await input.stripe.retrieveSubscription(
      billingRef.stripeSubscriptionId,
      buildHostedPulseTrialExtensionStripeRequestOptions(),
    );
  } catch {
    throw new HostedPulseTrialExtensionProviderError();
  }

  const providerReason = classifyHostedPulseTrialExtensionProviderState({
    memberId: input.memberId,
    now: input.now,
    priceId: input.priceId,
    stripeCustomerId: billingRef.stripeCustomerId,
    stripeSubscriptionId: billingRef.stripeSubscriptionId,
    subscription,
  });
  if (providerReason) {
    return buildIneligibleHostedPulseTrialExtensionState({
      code: providerReason,
      member: input.member,
      subscription,
    });
  }

  const currentTrialEnd = readSafeUnixSecond(subscription.trial_end);
  const targetTrialEnd = subscription.status === "trialing"
    ? requireSafeUnixSecond(currentTrialEnd) +
      HOSTED_PULSE_TRIAL_EXTENSION_DAYS * SECONDS_PER_DAY
    : Math.floor(input.now.getTime() / 1000) +
      HOSTED_PULSE_TRIAL_EXTENSION_DAYS * SECONDS_PER_DAY;
  return {
    currentTrialEnd,
    eligibilityCode: "eligible",
    eligible: true,
    member: input.member,
    message: subscription.status === "paused"
      ? "This lapsed Pulse Trial can be restored for seven days."
      : "This active Pulse Trial can be extended by seven days.",
    providerStatus: subscription.status,
    subscription,
    targetTrialEnd,
  };
}

function classifyHostedPulseTrialExtensionLocalState(
  member: HostedMemberBillingSnapshot | null,
): Exclude<HostedPulseTrialExtensionEligibilityCode, "eligible"> | null {
  if (!member) {
    return "member_not_found";
  }
  if (member.core.suspendedAt) {
    return "member_suspended";
  }
  const billingRef = member.billingRef;
  if (!billingRef) {
    return "missing_billing_reference";
  }
  if (
    billingRef.currentBillingPhase === "paid" ||
    (
      member.core.billingStatus === HostedBillingStatus.active &&
      billingRef.currentBillingPhase !== "trial"
    )
  ) {
    return "paid_billing";
  }
  if (
    !billingRef.pulseTrialRedeemedAt ||
    billingRef.currentBillingPlanCode !== "launch_monthly" ||
    billingRef.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER
  ) {
    return "not_a_redeemed_pulse_trial";
  }
  if (
    billingRef.stripeSubscriptionScheduleId ||
    billingRef.scheduledBillingPlanCode ||
    billingRef.scheduledBillingEffectiveAt
  ) {
    return "scheduled_billing_change";
  }
  if (!billingRef.stripeCustomerId || !billingRef.stripeSubscriptionId) {
    return "missing_stripe_reference";
  }
  return null;
}

export function classifyHostedPulseTrialExtensionProviderState(input: {
  memberId: string;
  now: Date;
  priceId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  subscription: HostedPulseTrialExtensionSubscription;
}): Exclude<HostedPulseTrialExtensionEligibilityCode, "eligible"> | null {
  if (
    input.subscription.id !== input.stripeSubscriptionId ||
    coerceStripeCustomerId(input.subscription.customer) !== input.stripeCustomerId ||
    !isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription: input.subscription,
    })
  ) {
    return "provider_identity_mismatch";
  }
  if (
    input.subscription.cancel_at_period_end ||
    input.subscription.cancel_at !== null
  ) {
    return "provider_subscription_canceling";
  }
  if (input.subscription.status === "trialing") {
    const trialEnd = readSafeUnixSecond(input.subscription.trial_end);
    return trialEnd && trialEnd > Math.floor(input.now.getTime() / 1000)
      ? null
      : "provider_trial_end_invalid";
  }
  if (
    input.subscription.status === "paused" &&
    input.subscription.trial_settings?.end_behavior.missing_payment_method === "pause"
  ) {
    return null;
  }
  return "provider_subscription_not_extendable";
}

function buildIneligibleHostedPulseTrialExtensionState(input: {
  code: Exclude<HostedPulseTrialExtensionEligibilityCode, "eligible">;
  member: HostedMemberBillingSnapshot | null;
  subscription?: HostedPulseTrialExtensionSubscription;
}): HostedPulseTrialExtensionState {
  return {
    currentTrialEnd: readSafeUnixSecond(input.subscription?.trial_end),
    eligibilityCode: input.code,
    eligible: false,
    member: input.member,
    message: readHostedPulseTrialExtensionEligibilityMessage(input.code),
    providerStatus: input.subscription?.status ?? null,
    subscription: input.subscription ?? null,
    targetTrialEnd: null,
  };
}

function readHostedPulseTrialExtensionEligibilityMessage(
  code: Exclude<HostedPulseTrialExtensionEligibilityCode, "eligible">,
): string {
  switch (code) {
    case "member_not_found":
      return "No hosted member exists with this ID.";
    case "member_suspended":
      return "This member is suspended, so billing was left unchanged.";
    case "missing_billing_reference":
      return "This member has no Stripe billing record.";
    case "not_a_redeemed_pulse_trial":
      return "This member does not have a redeemed Pulse Trial.";
    case "paid_billing":
      return "This member has paid billing, so the subscription was left unchanged.";
    case "scheduled_billing_change":
      return "This member has a scheduled billing change, so the subscription was left unchanged.";
    case "missing_stripe_reference":
      return "This trial is missing its Stripe customer or subscription reference.";
    case "provider_identity_mismatch":
      return "Stripe no longer matches this member's Pulse Trial billing record.";
    case "provider_subscription_canceling":
      return "This Stripe subscription is scheduled to cancel.";
    case "provider_subscription_not_extendable":
      return "Only active or lapsed paused Pulse Trials can be extended.";
    case "provider_trial_end_invalid":
      return "Stripe returned an invalid active trial end.";
  }
}

function buildHostedPulseTrialExtensionPreviewProof(input: {
  member: HostedMemberBillingSnapshot | null;
  memberId: string;
  previewedAt: Date;
  subscription: HostedPulseTrialExtensionSubscription;
  targetTrialEnd: number;
}): HostedPulseTrialExtensionPreviewProof {
  const previewedAt = input.previewedAt.toISOString();
  const targetTrialEndsAt = unixSecondsToIso(input.targetTrialEnd);
  if (!targetTrialEndsAt) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  return {
    previewedAt,
    targetTrialEndsAt,
    token: signHostedPulseTrialExtensionPreview({
      member: input.member,
      memberId: input.memberId,
      previewedAt,
      subscription: input.subscription,
      targetTrialEnd: input.targetTrialEnd,
    }),
  };
}

function verifyHostedPulseTrialExtensionPreviewProof(input: {
  member: HostedMemberBillingSnapshot;
  memberId: string;
  previewProof: HostedPulseTrialExtensionPreviewProof;
  subscription: HostedPulseTrialExtensionSubscription;
  targetTrialEnd: number;
}): boolean {
  const tokenParts = readHostedPulseTrialExtensionTokenParts(input.previewProof.token);
  const expected = signHostedPulseTrialExtensionPreview({
    keyVersion: tokenParts.keyVersion,
    member: input.member,
    memberId: input.memberId,
    previewedAt: input.previewProof.previewedAt,
    subscription: input.subscription,
    targetTrialEnd: input.targetTrialEnd,
  });
  const actualBuffer = Buffer.from(input.previewProof.token);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

function signHostedPulseTrialExtensionPreview(input: {
  keyVersion?: string;
  member: HostedMemberBillingSnapshot | null;
  memberId: string;
  previewedAt: string;
  subscription: HostedPulseTrialExtensionSubscription;
  targetTrialEnd: number;
}): string {
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const keyVersion = input.keyVersion ?? keyring.currentVersion;
  const sourceKey = keyring.keysByVersion[keyVersion];
  if (!sourceKey) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  const digest = createHmac(
    "sha256",
    createHash("sha256")
      .update(PREVIEW_HMAC_CONTEXT, "utf8")
      .update("\0", "utf8")
      .update(sourceKey)
      .digest(),
  )
    .update(JSON.stringify({
      local: projectHostedPulseTrialExtensionLocalProofState(input.member),
      memberId: input.memberId,
      previewedAt: input.previewedAt,
      provider: projectHostedPulseTrialExtensionProviderProofState(
        input.subscription,
      ),
      targetTrialEnd: input.targetTrialEnd,
    }), "utf8")
    .digest("base64url");
  return `${PREVIEW_TOKEN_PREFIX}.${keyVersion}.${digest}`;
}

function projectHostedPulseTrialExtensionLocalProofState(
  member: HostedMemberBillingSnapshot | null,
): object | null {
  if (!member) {
    return null;
  }
  const ref = member.billingRef;
  return {
    billingStatus: member.core.billingStatus,
    currentBillingPhase: ref?.currentBillingPhase ?? null,
    currentBillingPlanCode: ref?.currentBillingPlanCode ?? null,
    currentCheckoutOffer: ref?.currentCheckoutOffer ?? null,
    currentPeriodEnd: ref?.currentPeriodEnd?.toISOString() ?? null,
    currentTrialEndsAt: ref?.currentTrialEndsAt?.toISOString() ?? null,
    currentTrialStartedAt: ref?.currentTrialStartedAt?.toISOString() ?? null,
    pulseTrialPolicyVersion: ref?.pulseTrialPolicyVersion ?? null,
    pulseTrialRedeemedAt: ref?.pulseTrialRedeemedAt?.toISOString() ?? null,
    scheduledBillingEffectiveAt:
      ref?.scheduledBillingEffectiveAt?.toISOString() ?? null,
    scheduledBillingPlanCode: ref?.scheduledBillingPlanCode ?? null,
    stripeCustomerId: ref?.stripeCustomerId ?? null,
    stripeSubscriptionId: ref?.stripeSubscriptionId ?? null,
    stripeSubscriptionScheduleId: ref?.stripeSubscriptionScheduleId ?? null,
    suspendedAt: member.core.suspendedAt?.toISOString() ?? null,
  };
}

function projectHostedPulseTrialExtensionProviderProofState(
  subscription: HostedPulseTrialExtensionSubscription,
): object {
  return {
    cancelAt: subscription.cancel_at,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    customerId: coerceStripeCustomerId(subscription.customer),
    extensionOperation:
      subscription.metadata[EXTENSION_OPERATION_METADATA_KEY] ?? null,
    id: subscription.id,
    items: subscription.items.data.map((item) => ({
      id: item.id,
      priceId: item.price.id,
      quantity: item.quantity ?? null,
    })),
    metadata: {
      billingPlanCode: subscription.metadata.billingPlanCode ?? null,
      checkoutOffer: subscription.metadata.checkoutOffer ?? null,
      memberId: subscription.metadata.memberId ?? null,
      trialDurationDays: subscription.metadata.trialDurationDays ?? null,
      trialPolicyVersion: subscription.metadata.trialPolicyVersion ?? null,
      trialUsageLimitUsdMicros:
        subscription.metadata.trialUsageLimitUsdMicros ?? null,
    },
    status: subscription.status,
    trialEnd: subscription.trial_end,
    trialStart: subscription.trial_start,
  };
}

function parseHostedPulseTrialExtensionPreviewProofDates(input: {
  now: Date;
  previewProof: HostedPulseTrialExtensionPreviewProof;
}): {
  previewedAt: Date;
  targetTrialEndsAt: Date;
  targetTrialEndUnix: number;
} {
  const previewedAt = new Date(input.previewProof.previewedAt);
  const targetTrialEndsAt = new Date(input.previewProof.targetTrialEndsAt);
  if (
    !Number.isFinite(previewedAt.getTime()) ||
    !Number.isFinite(targetTrialEndsAt.getTime()) ||
    input.now.getTime() < previewedAt.getTime() - 60_000
  ) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  const targetTrialEndUnix = Math.floor(targetTrialEndsAt.getTime() / 1000);
  const canonicalTargetTrialEndsAt = unixSecondsToDate(targetTrialEndUnix);
  if (
    !canonicalTargetTrialEndsAt ||
    input.previewProof.targetTrialEndsAt !==
      canonicalTargetTrialEndsAt.toISOString() ||
    targetTrialEndUnix <= Math.floor(input.now.getTime() / 1000)
  ) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  return {
    previewedAt,
    targetTrialEndsAt: canonicalTargetTrialEndsAt,
    targetTrialEndUnix,
  };
}

function requireHostedPulseTrialExtensionPreviewFresh(input: {
  now: Date;
  previewedAt: Date;
}): void {
  if (
    input.now.getTime() >
      input.previewedAt.getTime() + PREVIEW_PROOF_TTL_MS
  ) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
}

function readHostedPulseTrialExtensionTokenParts(token: string): {
  digest: string;
  keyVersion: string;
} {
  const parts = token.split(".");
  const digest = parts[2];
  const keyVersion = parts[1];
  if (
    parts.length !== 3 ||
    parts[0] !== PREVIEW_TOKEN_PREFIX ||
    !keyVersion ||
    !/^v[0-9]+$/u.test(keyVersion) ||
    !digest ||
    !/^[A-Za-z0-9_-]{43}$/u.test(digest)
  ) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  return { digest, keyVersion };
}

function readHostedPulseTrialExtensionOperationId(token: string): string {
  return readHostedPulseTrialExtensionTokenParts(token).digest;
}

function isHostedPulseTrialExtensionAlreadyApplied(input: {
  memberId: string;
  operationId: string;
  priceId: string;
  subscription: HostedPulseTrialExtensionSubscription;
  targetTrialEnd: number;
}): boolean {
  return input.subscription.status === "trialing" &&
    input.subscription.trial_end === input.targetTrialEnd &&
    input.subscription.metadata[EXTENSION_OPERATION_METADATA_KEY] ===
      input.operationId &&
    input.subscription.metadata[EXTENSION_DAYS_METADATA_KEY] ===
      HOSTED_PULSE_TRIAL_EXTENSION_DAYS.toString() &&
    isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription: input.subscription,
    });
}

async function reconcileHostedPulseTrialExtensionLocalState(input: {
  member: HostedMemberBillingSnapshot | null;
  now: Date;
  subscription: HostedPulseTrialExtensionSubscription;
  targetTrialEndsAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberBillingSnapshot> {
  const member = input.member;
  const billingRef = member?.billingRef;
  if (!member || !billingRef?.stripeCustomerId || !billingRef.stripeSubscriptionId) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  const providerTrialStartedAt = unixSecondsToDate(input.subscription.trial_start);
  const currentTrialStartedAt = billingRef.currentTrialStartedAt ??
    providerTrialStartedAt ?? billingRef.pulseTrialRedeemedAt;
  if (!currentTrialStartedAt) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  const providerPeriod = readHostedPulseTrialExtensionProviderPeriod(
    input.subscription,
  );

  const core = await updateHostedMemberCoreState({
    billingStatus: HostedBillingStatus.active,
    memberId: member.core.id,
    prisma: input.tx,
  });
  const updatedBillingRef = await writeHostedMemberStripeBillingRefTx({
    currentBillingPhase: "trial",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    currentPeriodEnd: providerPeriod?.currentPeriodEnd ??
      input.targetTrialEndsAt,
    currentPeriodStart: providerPeriod?.currentPeriodStart ??
      billingRef.currentPeriodStart ?? currentTrialStartedAt,
    currentTrialEndsAt: input.targetTrialEndsAt,
    currentTrialStartedAt,
    memberId: member.core.id,
    pulseTrialPolicyVersion: billingRef.pulseTrialPolicyVersion,
    pulseTrialRedeemedAt: billingRef.pulseTrialRedeemedAt,
    stripeCustomerId: billingRef.stripeCustomerId,
    stripeSubscriptionId: billingRef.stripeSubscriptionId,
    tx: input.tx,
  });
  await reconcileHostedAiUsageAllowancePeriodForMemberTx({
    memberId: member.core.id,
    now: input.now,
    tx: input.tx,
  });
  return {
    billingRef: updatedBillingRef,
    core,
  };
}

function readHostedPulseTrialExtensionProviderPeriod(
  subscription: HostedPulseTrialExtensionSubscription,
): { currentPeriodEnd: Date; currentPeriodStart: Date } | null {
  const candidates: object[] = [subscription, ...subscription.items.data];
  for (const candidate of candidates) {
    const currentPeriodStart = unixSecondsToDate(
      readSafeUnixSecond(Reflect.get(candidate, "current_period_start")),
    );
    const currentPeriodEnd = unixSecondsToDate(
      readSafeUnixSecond(Reflect.get(candidate, "current_period_end")),
    );
    if (
      currentPeriodStart &&
      currentPeriodEnd &&
      currentPeriodStart.getTime() < currentPeriodEnd.getTime()
    ) {
      return { currentPeriodEnd, currentPeriodStart };
    }
  }
  return null;
}

function buildHostedPulseTrialExtensionResult(input: {
  memberId: string;
  outcome: HostedPulseTrialExtensionOutcome;
  previewProof: HostedPulseTrialExtensionPreviewProof | null;
  state: HostedPulseTrialExtensionState;
}): HostedPulseTrialExtensionResult {
  return {
    currentTrialEndsAt: unixSecondsToIso(input.state.currentTrialEnd),
    eligibilityCode: input.state.eligibilityCode,
    eligible: input.state.eligible,
    extensionDays: HOSTED_PULSE_TRIAL_EXTENSION_DAYS,
    localBillingPhase:
      input.state.member?.billingRef?.currentBillingPhase ?? null,
    localBillingStatus: input.state.member?.core.billingStatus ?? null,
    memberId: input.memberId,
    message: input.state.message,
    outcome: input.outcome,
    previewProof: input.previewProof,
    providerStatus: input.state.providerStatus,
    targetTrialEndsAt: unixSecondsToIso(input.state.targetTrialEnd),
  };
}

function createHostedPulseTrialExtensionStripeClient(
  stripe: Pick<Stripe, "subscriptions">,
): HostedPulseTrialExtensionStripeClient {
  return {
    retrieveSubscription(subscriptionId, options) {
      return stripe.subscriptions.retrieve(subscriptionId, {}, options);
    },
    updateSubscription(subscriptionId, params, options) {
      return stripe.subscriptions.update(subscriptionId, params, options);
    },
  };
}

function buildHostedPulseTrialExtensionStripeRequestOptions(): Stripe.RequestOptions {
  return {
    maxNetworkRetries: STRIPE_REQUEST_MAX_NETWORK_RETRIES,
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
  };
}

function coerceStripeCustomerId(
  customer: HostedPulseTrialExtensionSubscription["customer"],
): string | null {
  return typeof customer === "string" ? customer : customer?.id ?? null;
}

function readSafeUnixSecond(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function requireSafeUnixSecond(value: number | null): number {
  if (value === null) {
    throw new HostedPulseTrialExtensionPreviewStaleError();
  }
  return value;
}

function unixSecondsToDate(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value * 1000);
}

function unixSecondsToIso(value: number | null): string | null {
  return unixSecondsToDate(value)?.toISOString() ?? null;
}
