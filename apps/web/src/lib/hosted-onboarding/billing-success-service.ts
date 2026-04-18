import {
  HostedBillingStatus,
  type HostedMember,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { handoffHostedExecutionWakeBestEffort } from "../hosted-wake/control";
import { getPrisma } from "../prisma";
import {
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import { hostedOnboardingError } from "./errors";
import { writeHostedMemberStripeBillingRefTx } from "./hosted-member-billing-store";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import { getHostedInviteStatus, requireHostedInviteForAuthentication } from "./invite-service";
import { activateHostedMemberForPositiveSourceTx } from "./member-activation";
import { resolveHostedMemberEmailLinked } from "./member-channel-sync";
import type { PrivyLinkedAccountLike } from "./privy-shared";
import { requireHostedStripeApi } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  normalizeNullableString,
} from "./shared";
import { findMemberForStripeObject } from "./stripe-billing-lookup";
import { updateHostedMemberStripeBillingIfFreshTx } from "./stripe-billing-policy";

export async function reconcileHostedBillingCheckoutSuccess(input: {
  inviteCode: string;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  member: HostedMember;
  prisma?: PrismaClient;
  sessionId: string;
}) {
  const prisma = input.prisma ?? getPrisma();
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, new Date());

  if (input.member.id !== invite.memberId) {
    throw hostedOnboardingError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
      httpStatus: 403,
    });
  }

  const stripe = requireHostedStripeApi();
  const session = await stripe.checkout.sessions.retrieve(input.sessionId, {
    expand: ["subscription"],
  });

  await assertHostedCheckoutSessionBelongsToMember({
    expectedMemberId: invite.memberId,
    prisma,
    session,
  });

  const hostedExecutionEventId = await applyHostedCheckoutSessionSuccess({
    linkedAccounts: input.linkedAccounts,
    memberId: invite.memberId,
    prisma,
    session,
  });

  if (hostedExecutionEventId) {
    await handoffHostedExecutionWakeBestEffort({
      context: "billing-success.redirect",
      eventId: hostedExecutionEventId,
      prisma,
    });
  }

  return getHostedInviteStatus({
    authenticatedMember: input.member,
    inviteCode: input.inviteCode,
    prisma,
  });
}

async function applyHostedCheckoutSessionSuccess(input: {
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  memberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
}): Promise<string | null> {
  const member = await readHostedMemberSnapshot({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      message: "Finish signup from your latest Murph link before continuing.",
      httpStatus: 403,
    });
  }

  const sourceOccurredAt = new Date().toISOString();
  const dispatchContext = {
    eventCreatedAt: new Date(sourceOccurredAt),
    occurredAt: sourceOccurredAt,
    sourceEventId: input.session.id,
    sourceType: "stripe.checkout.session.success_redirect",
  } as const;
  const subscriptionId = coerceStripeSubscriptionId(input.session.subscription);
  const subscriptionStatus =
    input.session.subscription && typeof input.session.subscription === "object"
      ? mapStripeSubscriptionStatusToHostedBillingStatus(input.session.subscription.status)
      : null;
  const stripeCustomerId = coerceStripeObjectId(input.session.customer) ?? member.billingRef?.stripeCustomerId ?? null;
  const nextStripeSubscriptionId = subscriptionId ?? member.billingRef?.stripeSubscriptionId ?? null;

  return input.prisma.$transaction(async (tx) => {
    if (!subscriptionId || !subscriptionStatus) {
      await writeHostedMemberStripeBillingRefTx({
        memberId: member.core.id,
        stripeCustomerId,
        stripeSubscriptionId: nextStripeSubscriptionId,
        tx,
      });
      return null;
    }

    const updatedMember = await updateHostedMemberStripeBillingIfFreshTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: subscriptionStatus,
      dispatchContext,
      member,
      stripeCustomerId,
      stripeSubscriptionId: nextStripeSubscriptionId,
      tx,
    });

    if (!updatedMember) {
      return null;
    }

    const activation = await activateHostedMemberForPositiveSourceTx({
      dispatchContext,
      emailLinked: await resolveHostedMemberEmailLinked({
        linkedAccounts: input.linkedAccounts,
        memberId: updatedMember.core.id,
      }),
      member: updatedMember,
      prisma: tx,
      skipIfBillingAlreadyActive: member.core.billingStatus === HostedBillingStatus.active,
    });

    return activation.hostedExecutionEventId;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function assertHostedCheckoutSessionBelongsToMember(input: {
  expectedMemberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
}) {
  const candidateMemberIds = new Set<string>();
  const metadataMemberId = normalizeNullableString(input.session.metadata?.memberId);
  const clientReferenceId = normalizeNullableString(input.session.client_reference_id);

  if (metadataMemberId) {
    candidateMemberIds.add(metadataMemberId);
  }

  if (clientReferenceId) {
    candidateMemberIds.add(clientReferenceId);
  }

  const matchedMember = await findMemberForStripeObject({
    clientReferenceId,
    customerId: coerceStripeObjectId(input.session.customer),
    memberId: metadataMemberId,
    prisma: input.prisma,
    subscriptionId: coerceStripeSubscriptionId(input.session.subscription),
  });

  if (matchedMember) {
    candidateMemberIds.add(matchedMember.core.id);
  }

  if (
    candidateMemberIds.size === 0 ||
    [...candidateMemberIds].some((candidateMemberId) => candidateMemberId !== input.expectedMemberId)
  ) {
    throw hostedOnboardingError({
      code: "STRIPE_CHECKOUT_MEMBER_MISMATCH",
      message: "That checkout session does not belong to this hosted account.",
      httpStatus: 403,
    });
  }
}
