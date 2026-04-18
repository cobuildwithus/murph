import {
  HostedBillingStatus,
  type HostedMember,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { buildStripeCancelUrl, buildStripeSuccessUrl } from "./billing";
import {
  getHostedDefaultBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import { projectHostedMemberRoutingState } from "./hosted-member-routing-store";
import { isHostedMemberMessagingSetupRequired } from "./messaging-state";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import {
  extractHostedPrivyVerifiedEmailAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import { coerceHostedWalletAddress } from "./revnet";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig,
} from "./runtime";
import { normalizeNullableString } from "./shared";

export interface HostedBillingCheckoutInput {
  billingPlanCode?: HostedBillingPlanCode;
  inviteCode: string;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  member?: HostedMember;
  now?: Date;
  prisma?: PrismaClient;
  shareCode?: string | null;
}

export async function createHostedBillingCheckout(
  input: HostedBillingCheckoutInput,
): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const billingPlanCode = input.billingPlanCode ?? getHostedDefaultBillingPlanCode();
  const now = input.now ?? new Date();
  const shareCode = normalizeNullableString(input.shareCode);
  const timing = startHostedOnboardingTiming("hosted-onboarding.billing.create-checkout", {
    billingPlanCode,
    shareCodeProvided: Boolean(shareCode),
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

    if (isHostedMemberMessagingSetupRequired({
      identity: invite.member.identity,
      routing: invite.member.routing
        ? projectHostedMemberRoutingState(invite.member.routing)
        : null,
    })) {
      throw hostedOnboardingError({
        code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
        message: "Verify your phone number or connect Telegram before checkout so Murph can message you.",
        httpStatus: 409,
      });
    }

    const { priceId, stripe } = requireHostedStripeCheckoutConfig({
      billingPlanCode,
    });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const customerId = await resolveHostedStripeCustomerId({
      memberId: invite.member.id,
      prisma,
    });
    const verifiedEmail = customerId
      ? null
      : extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? [])?.address ?? null;
    const checkoutMetadata: Record<string, string> = {
      billingPlanCode,
      memberId: invite.member.id,
    };
    const checkoutSession = await stripe.checkout.sessions.create({
      cancel_url: buildStripeCancelUrl(publicBaseUrl, invite.inviteCode, shareCode),
      client_reference_id: invite.member.id,
      ...(customerId ? { customer: customerId } : {}),
      ...(verifiedEmail ? { customer_email: verifiedEmail } : {}),
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: checkoutMetadata,
      mode: "subscription",
      payment_method_types: ["card"],
      subscription_data: {
        metadata: checkoutMetadata,
      },
      success_url: buildStripeSuccessUrl(publicBaseUrl, invite.inviteCode, shareCode),
    });

    if (!checkoutSession.url) {
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

async function resolveHostedBillingCheckoutAuth(
  input: HostedBillingCheckoutInput,
): Promise<{ member: HostedMember }> {
  if (input.member) {
    return { member: input.member };
  }

  throw new TypeError("Hosted billing checkout requires the authenticated hosted member.");
}

async function resolveHostedStripeCustomerId(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<string | null> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.billing.resolve-stripe-customer");
  const currentBillingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const currentStripeCustomerId = currentBillingRef?.stripeCustomerId ?? null;
  const customerPath = currentStripeCustomerId ? "existing" : "checkout-create";

  try {
    finishHostedOnboardingTiming(timing, "completed", {
      customerPath,
    });
    return currentStripeCustomerId;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      customerPath,
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

export function requireHostedMemberWalletAddressForRevnet(member: {
  id: string;
  walletAddress: string | null | undefined;
}) {
  const walletAddress = coerceHostedWalletAddress(member.walletAddress);

  if (!walletAddress) {
    throw hostedOnboardingError({
      code: "REVNET_BENEFICIARY_REQUIRED",
      message: "Hosted RevNet issuance requires valid account setup details on the hosted member.",
      httpStatus: 503,
      retryable: true,
      details: {
        memberId: member.id,
      },
    });
  }

  return walletAddress;
}
