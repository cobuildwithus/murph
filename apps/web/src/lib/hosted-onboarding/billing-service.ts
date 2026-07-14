import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { buildStripeCancelUrl, buildStripeSuccessUrl } from "./billing";
import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  getHostedDefaultBillingPlanCode,
  isHostedPulseTrialCheckoutEnabled,
  type HostedBillingCheckoutOffer,
  type HostedBillingPlanCode,
  type HostedPublicBillingCheckoutOffer,
} from "./billing-plans";
import { buildHostedBillingOfferMetadata } from "./billing-offer-metadata";
import { assertHostedMemberCanOwnDirectBilling } from "./billing-authority";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  bindHostedMemberBillingCheckoutSessionTx,
  bindHostedMemberStripeCustomerIdIfMissingTx,
  readHostedMemberStripeBillingRef,
  reserveHostedMemberBillingCheckoutAttemptTx,
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { sha256Hex } from "../primitives";
import {
  extractHostedPrivyVerifiedEmailAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig,
} from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedMemberCheckoutAttemptId,
  lockHostedMemberRow,
  normalizeNullableString,
} from "./shared";
import { createHostedPulseTrialStripeCustomer } from "./pulse-trial-customer";

export interface HostedBillingCheckoutInput {
  billingPlanCode?: HostedBillingPlanCode;
  checkoutOffer?: HostedPublicBillingCheckoutOffer | null;
  inviteCode: string;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  member?: HostedBillingCheckoutAuthenticatedMember;
  now?: Date;
  prisma?: PrismaClient;
}

export interface HostedBillingCheckoutAuthenticatedMember {
  id: string;
  suspendedAt: Date | null;
}

export interface HostedBillingCheckoutLineItem {
  price: string;
  quantity?: number;
}

type HostedBillingCheckoutFinalization =
  | { kind: "already-active" }
  | { kind: "bound" }
  | { error: unknown; kind: "rejected" };

export function buildHostedBillingCheckoutLineItems(priceId: string): HostedBillingCheckoutLineItem[] {
  return [
    {
      price: priceId,
      quantity: 1,
    },
  ];
}

export async function createHostedBillingCheckout(
  input: HostedBillingCheckoutInput,
): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const billingPlanCode = input.billingPlanCode ?? getHostedDefaultBillingPlanCode();
  const checkoutOffer = input.checkoutOffer ?? HOSTED_STANDARD_CHECKOUT_OFFER;
  const now = input.now ?? new Date();
  const timing = startHostedOnboardingTiming("hosted-onboarding.billing.create-checkout", {
    billingPlanCode,
    checkoutOffer,
  });

  try {
    const auth = await resolveHostedBillingCheckoutAuth(input);
    const invite = await requireHostedInviteForBillingCheckout(input.inviteCode, prisma, now);

    if (auth.member.id !== invite.memberId) {
      throw hostedOnboardingError({
        code: "AUTH_INVITE_MISMATCH",
        message: "That invite belongs to a different hosted member.",
        httpStatus: 403,
      });
    }

    if (
      isHostedMemberSuspended(auth.member.suspendedAt) ||
      isHostedMemberSuspended(invite.member.suspendedAt)
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        httpStatus: 403,
      });
    }

    if (invite.member.billingStatus === HostedBillingStatus.active) {
      finishHostedOnboardingTiming(timing, "completed", {
        alreadyActive: true,
      });
      return {
        alreadyActive: true,
        url: null,
      };
    }

    if (!requiresHostedBillingCheckout(invite.member.billingStatus)) {
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
        message: "This hosted account cannot start a new checkout right now. Contact support to restore access.",
        httpStatus: 403,
      });
    }

    await assertHostedMemberBillingStartMessagingReady({
      identity: invite.member.identity,
      prisma,
      routing: invite.member.routing,
    });

    const { priceId, stripe } = requireHostedStripeCheckoutConfig({
      billingPlanCode,
    });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const verifiedEmailAddress =
      extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? [])?.address ?? null;
    const reservation = await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, invite.member.id);
      const currentMember = await tx.hostedMember.findUnique({
        select: {
          billingStatus: true,
          suspendedAt: true,
        },
        where: {
          id: invite.member.id,
        },
      });
      if (!currentMember) {
        throw hostedOnboardingError({
          code: "HOSTED_MEMBER_NOT_FOUND",
          message: "Finish signup from your latest Murph link before continuing.",
          httpStatus: 403,
        });
      }
      if (isHostedMemberSuspended(currentMember.suspendedAt)) {
        throw hostedOnboardingError({
          code: "HOSTED_MEMBER_SUSPENDED",
          message: "This hosted account is suspended. Contact support to restore access.",
          httpStatus: 403,
        });
      }
      if (currentMember.billingStatus === HostedBillingStatus.active) {
        return {
          alreadyActive: true as const,
        };
      }
      if (!requiresHostedBillingCheckout(currentMember.billingStatus)) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
          message: "This hosted account cannot start a new checkout right now. Contact support to restore access.",
          httpStatus: 403,
        });
      }
      await assertHostedMemberCanOwnDirectBilling({
        memberId: invite.member.id,
        prisma: tx,
      });
      const currentBillingRef = await readHostedMemberStripeBillingRef({
        memberId: invite.member.id,
        prisma: tx,
      });
      const resolvedOffer = resolveHostedBillingCheckoutOffer({
        billingPlanCode,
        checkoutOffer,
        currentBillingRef,
      });
      const checkout = await reserveHostedMemberBillingCheckoutAttemptTx({
        memberId: invite.member.id,
        proposedAttemptId: generateHostedMemberCheckoutAttemptId(),
        tx,
      });
      return {
        alreadyActive: false as const,
        currentBillingRef,
        resolvedOffer,
        ...checkout,
      };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

    if (reservation.alreadyActive) {
      finishHostedOnboardingTiming(timing, "completed", {
        alreadyActive: true,
      });
      return {
        alreadyActive: true,
        url: null,
      };
    }

    if (reservation.previousSessionId) {
      await retireHostedBillingCheckoutSessionBeforeReplacement({
        sessionId: reservation.previousSessionId,
        stripe,
      });
    }

    const currentBillingRef = reservation.currentBillingRef;
    const resolvedOffer = reservation.resolvedOffer;
    const customerId = currentBillingRef?.stripeCustomerId ??
      (resolvedOffer === HOSTED_PULSE_TRIAL_OFFER
        ? await reserveHostedPulseTrialCheckoutCustomer({
            memberId: invite.member.id,
            prisma,
            stripe,
          })
        : null);
    const verifiedEmail = customerId ? null : verifiedEmailAddress;
    const checkoutMetadata = buildHostedBillingOfferMetadata({
      billingPlanCode,
      checkoutOffer: resolvedOffer,
      memberId: invite.member.id,
    });
    const checkoutIdempotencyKey = buildHostedBillingCheckoutIdempotencyKey({
      billingPlanCode,
      checkoutAttemptId: reservation.attemptId,
      checkoutOffer: resolvedOffer,
      inviteCode: invite.inviteCode,
      memberId: invite.member.id,
      priceId,
      stripeCustomerId: customerId,
      verifiedEmail,
    });
    const checkoutSession = await stripe.checkout.sessions.create({
      cancel_url: buildStripeCancelUrl(publicBaseUrl, invite.inviteCode),
      client_reference_id: invite.member.id,
      ...(customerId ? { customer: customerId } : {}),
      ...(verifiedEmail ? { customer_email: verifiedEmail } : {}),
      line_items: buildHostedBillingCheckoutLineItems(priceId),
      metadata: checkoutMetadata,
      mode: "subscription",
      payment_method_types: ["card"],
      subscription_data: {
        metadata: checkoutMetadata,
        ...(resolvedOffer === HOSTED_PULSE_TRIAL_OFFER
          ? { trial_period_days: HOSTED_PULSE_TRIAL_DAYS }
          : {}),
      },
      success_url: buildStripeSuccessUrl(publicBaseUrl, invite.inviteCode),
    }, {
      idempotencyKey: checkoutIdempotencyKey,
    });

    let finalization: HostedBillingCheckoutFinalization;
    try {
      finalization = await prisma.$transaction(
        async (tx): Promise<HostedBillingCheckoutFinalization> => {
          await lockHostedMemberRow(tx, invite.member.id);
          const rejectStaleCheckout = async (
            error: unknown,
          ): Promise<HostedBillingCheckoutFinalization> => {
            const recordedForRetirement = await bindHostedMemberBillingCheckoutSessionTx({
              attemptId: reservation.attemptId,
              memberId: invite.member.id,
              previousSessionId: reservation.previousSessionId,
              sessionId: checkoutSession.id,
              tx,
            });
            return recordedForRetirement
              ? { error, kind: "rejected" }
              : {
                  error: buildHostedBillingCheckoutAttemptStaleError(),
                  kind: "rejected",
                };
          };
          const currentMember = await tx.hostedMember.findUnique({
            select: {
              billingStatus: true,
              suspendedAt: true,
            },
            where: {
              id: invite.member.id,
            },
          });
          if (!currentMember || isHostedMemberSuspended(currentMember.suspendedAt)) {
            return await rejectStaleCheckout(hostedOnboardingError({
              code: "HOSTED_MEMBER_SUSPENDED",
              message: "This hosted account is suspended. Contact support to restore access.",
              httpStatus: 403,
            }));
          }
          if (currentMember.billingStatus === HostedBillingStatus.active) {
            const recordedForRetirement = await bindHostedMemberBillingCheckoutSessionTx({
              attemptId: reservation.attemptId,
              memberId: invite.member.id,
              previousSessionId: reservation.previousSessionId,
              sessionId: checkoutSession.id,
              tx,
            });
            return recordedForRetirement
              ? { kind: "already-active" }
              : {
                  error: buildHostedBillingCheckoutAttemptStaleError(),
                  kind: "rejected",
                };
          }
          if (!requiresHostedBillingCheckout(currentMember.billingStatus)) {
            return await rejectStaleCheckout(hostedOnboardingError({
              code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
              message: "This hosted account cannot start a new checkout right now. Contact support to restore access.",
              httpStatus: 403,
            }));
          }
          try {
            await assertHostedMemberCanOwnDirectBilling({
              memberId: invite.member.id,
              prisma: tx,
            });
          } catch (error) {
            if (
              !isHostedOnboardingError(error)
              || error.code !== "HOSTED_BILLING_FAMILY_AUTHORITY_ACTIVE"
            ) {
              throw error;
            }
            return await rejectStaleCheckout(error);
          }
          const currentBillingRef = await readHostedMemberStripeBillingRef({
            memberId: invite.member.id,
            prisma: tx,
          });
          if (currentBillingRef?.stripeSubscriptionId) {
            return await rejectStaleCheckout(hostedOnboardingError({
              code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
              message: "This hosted account already has a billing subscription. Refresh billing before starting another checkout.",
              httpStatus: 409,
            }));
          }
          const bound = await bindHostedMemberBillingCheckoutSessionTx({
            attemptId: reservation.attemptId,
            memberId: invite.member.id,
            previousSessionId: reservation.previousSessionId,
            sessionId: checkoutSession.id,
            tx,
          });
          if (!bound) {
            return {
              error: buildHostedBillingCheckoutAttemptStaleError(),
              kind: "rejected",
            };
          }
          return { kind: "bound" };
        },
        HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      );
    } catch (error) {
      await expireHostedBillingCheckoutSessionFailClosed({
        sessionId: checkoutSession.id,
        stripe,
      });
      throw error;
    }

    if (finalization.kind !== "bound") {
      await expireHostedBillingCheckoutSessionFailClosed({
        sessionId: checkoutSession.id,
        stripe,
      });
    }
    if (finalization.kind === "rejected") {
      throw finalization.error;
    }
    if (finalization.kind === "already-active") {
      finishHostedOnboardingTiming(timing, "completed", {
        alreadyActive: true,
      });
      return {
        alreadyActive: true,
        url: null,
      };
    }
    if (!checkoutSession.url) {
      await expireHostedBillingCheckoutSessionFailClosed({
        sessionId: checkoutSession.id,
        stripe,
      });
      throw hostedOnboardingError({
        code: "CHECKOUT_URL_MISSING",
        message: "Stripe Checkout did not return a redirect URL.",
        httpStatus: 502,
      });
    }

    finishHostedOnboardingTiming(timing, "completed", {
      alreadyActive: false,
    });

    return {
      alreadyActive: false,
      url: checkoutSession.url,
    };
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

async function reserveHostedPulseTrialCheckoutCustomer(input: {
  memberId: string;
  prisma: PrismaClient;
  stripe: ReturnType<typeof requireHostedStripeCheckoutConfig>["stripe"];
}): Promise<string> {
  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const currentMember = await tx.hostedMember.findUnique({
        select: { suspendedAt: true },
        where: { id: input.memberId },
      });
      if (!currentMember || isHostedMemberSuspended(currentMember.suspendedAt)) {
        throw hostedOnboardingError({
          code: "HOSTED_MEMBER_SUSPENDED",
          message: "This hosted account is suspended. Contact support to restore access.",
          httpStatus: 403,
        });
      }
      await assertHostedMemberCanOwnDirectBilling({
        memberId: input.memberId,
        prisma: tx,
      });
      const currentBillingRef = await readHostedMemberStripeBillingRef({
        memberId: input.memberId,
        prisma: tx,
      });
      const billingRef = currentBillingRef?.stripeCustomerId
        ? currentBillingRef
        : await bindHostedMemberStripeCustomerIdIfMissingTx({
            memberId: input.memberId,
            stripeCustomerId: await createHostedPulseTrialStripeCustomer({
              memberId: input.memberId,
              stripe: input.stripe,
            }),
            tx,
          });
      if (!billingRef?.stripeCustomerId) {
        throw hostedOnboardingError({
          code: "HOSTED_AUTO_PULSE_TRIAL_CUSTOMER_BIND_FAILED",
          httpStatus: 409,
          message: "Murph could not reserve Stripe billing for trial activation. Try again.",
          retryable: true,
        });
      }
      return billingRef.stripeCustomerId;
    },
  });
}

async function resolveHostedBillingCheckoutAuth(
  input: HostedBillingCheckoutInput,
): Promise<{ member: HostedBillingCheckoutAuthenticatedMember }> {
  if (input.member) {
    return { member: input.member };
  }

  throw new TypeError("Hosted billing checkout requires the authenticated hosted member.");
}

export function buildHostedBillingCheckoutIdempotencyKey(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutAttemptId?: string;
  checkoutOffer?: HostedBillingCheckoutOffer;
  inviteCode: string;
  memberId: string;
  priceId: string;
  stripeCustomerId?: string | null;
  verifiedEmail?: string | null;
}): string {
  const customerBindingKey = deriveHostedBillingCheckoutCustomerBindingKey({
    stripeCustomerId: input.stripeCustomerId,
    verifiedEmail: input.verifiedEmail,
  });
  const lineItemBindingKey = deriveHostedBillingCheckoutLineItemBindingKey(input.priceId);
  const offerBindingKey = deriveHostedBillingCheckoutOfferBindingKey({
    checkoutOffer: input.checkoutOffer ?? HOSTED_STANDARD_CHECKOUT_OFFER,
  });
  return [
    "hosted-billing-checkout",
    input.memberId,
    input.inviteCode,
    ...(input.checkoutAttemptId ? [input.checkoutAttemptId] : []),
    input.billingPlanCode,
    offerBindingKey,
    lineItemBindingKey,
    customerBindingKey,
  ].join(":");
}

async function retireHostedBillingCheckoutSessionBeforeReplacement(input: {
  sessionId: string;
  stripe: ReturnType<typeof requireHostedStripeCheckoutConfig>["stripe"];
}): Promise<void> {
  const session = await input.stripe.checkout.sessions.retrieve(input.sessionId);
  if (session.status === "expired") {
    return;
  }
  if (session.status === "open") {
    await input.stripe.checkout.sessions.expire(input.sessionId);
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ALREADY_COMPLETED",
    message: "Your prior checkout is already complete and billing is still syncing. Try again shortly.",
    httpStatus: 409,
    retryable: true,
  });
}

async function expireHostedBillingCheckoutSessionFailClosed(input: {
  sessionId: string;
  stripe: ReturnType<typeof requireHostedStripeCheckoutConfig>["stripe"];
}): Promise<void> {
  const session = await input.stripe.checkout.sessions.retrieve(input.sessionId);
  if (session.status === "expired") {
    return;
  }
  if (session.status === "open") {
    await input.stripe.checkout.sessions.expire(input.sessionId);
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRED",
    message: "Billing changed while checkout was starting. Contact support before retrying.",
    httpStatus: 409,
    retryable: true,
  });
}

function buildHostedBillingCheckoutAttemptStaleError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_STALE",
    message: "Billing checkout changed before Stripe returned a session. Start checkout again.",
    httpStatus: 409,
  });
}

export function deriveHostedBillingCheckoutOfferBindingKey(input: {
  checkoutOffer: HostedBillingCheckoutOffer;
  trialDurationDays?: number | null;
  trialPolicyVersion?: string | null;
  trialUsageLimitUsdMicros?: bigint | null;
}): string {
  const binding = {
    checkoutOffer: input.checkoutOffer,
    trialDurationDays: input.trialDurationDays ?? (
      input.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER ? HOSTED_PULSE_TRIAL_DAYS : null
    ),
    trialPolicyVersion: input.trialPolicyVersion ?? (
      input.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
        ? HOSTED_PULSE_TRIAL_POLICY_VERSION
        : null
    ),
    trialUsageLimitUsdMicros: (
      input.trialUsageLimitUsdMicros ?? (
        input.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
          ? HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS
          : null
      )
    )?.toString() ?? null,
  };

  return `offer:${sha256Hex(JSON.stringify(binding)).slice(0, 12)}`;
}

function resolveHostedBillingCheckoutOffer(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer: HostedBillingCheckoutOffer;
  currentBillingRef: Awaited<ReturnType<typeof readHostedMemberStripeBillingRef>>;
}): HostedBillingCheckoutOffer {
  if (input.checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER) {
    return input.checkoutOffer;
  }

  if (input.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_OFFER_UNSUPPORTED",
      message: "That hosted checkout offer is not supported.",
      httpStatus: 400,
    });
  }

  if (input.billingPlanCode !== "launch_monthly") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_OFFER_PLAN_MISMATCH",
      message: "Pulse Trial is only available for the Pulse plan.",
      httpStatus: 400,
    });
  }

  if (!isHostedPulseTrialCheckoutEnabled()) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_CHECKOUT_DISABLED",
      message: "Pulse Trial checkout is not available yet.",
      httpStatus: 404,
    });
  }

  if (input.currentBillingRef?.pulseTrialRedeemedAt) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      message: "This hosted account has already used its Pulse Trial. Continue with Pulse instead.",
      httpStatus: 409,
    });
  }

  return input.checkoutOffer;
}

function deriveHostedBillingCheckoutLineItemBindingKey(priceId: string): string {
  return `items:${sha256Hex(priceId).slice(0, 12)}`;
}

function deriveHostedBillingCheckoutCustomerBindingKey(input: {
  stripeCustomerId?: string | null;
  verifiedEmail?: string | null;
}): string {
  const stripeCustomerId = normalizeNullableString(input.stripeCustomerId);

  if (stripeCustomerId) {
    return `customer:${stripeCustomerId}`;
  }

  const verifiedEmail = normalizeNullableString(input.verifiedEmail)?.toLowerCase() ?? null;

  if (verifiedEmail) {
    return `email:${sha256Hex(verifiedEmail).slice(0, 12)}`;
  }

  return "customer:none";
}
