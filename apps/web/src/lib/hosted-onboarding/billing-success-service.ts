import {
  HostedBillingStatus,
  type HostedMember,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { nudgeHostedRunBestEffort } from "../hosted-ingress/control";
import { getPrisma } from "../prisma";
import {
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import { hostedOnboardingError } from "./errors";
import { writeHostedMemberStripeBillingRefTx } from "./hosted-member-billing-store";
import {
  composeHostedMemberBillingSnapshot,
  readHostedMemberCoreState,
} from "./hosted-member-store";
import { getHostedInviteStatus, requireHostedInviteForAuthentication } from "./invite-service";
import { activateHostedMemberForPositiveSourceTx } from "./member-activation";
import {
  extractHostedPrivyVerifiedEmailAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import { requireHostedStripeApi } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "./shared";
import {
  listHostedStripeCheckoutSessionMemberIds,
} from "./stripe-billing-lookup";
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
    await nudgeHostedRunBestEffort({
      context: "billing-success.redirect",
      eventId: hostedExecutionEventId,
      prisma,
      userId: invite.memberId,
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
  const memberCore = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!memberCore) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      message: "Finish signup from your latest Murph link before continuing.",
      httpStatus: 403,
    });
  }

  const member = composeHostedMemberBillingSnapshot(memberCore, null);

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
  const stripeCustomerId = coerceStripeObjectId(input.session.customer);
  const nextStripeSubscriptionId = subscriptionId;

  const sessionEmailLinked = extractHostedPrivyVerifiedEmailAccount(
    input.linkedAccounts ?? [],
  ) !== null;

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
      ...(sessionEmailLinked ? { emailLinked: true } : {}),
      memberId: updatedMember.core.id,
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
  const candidateMemberIds = await listHostedStripeCheckoutSessionMemberIds({
    prisma: input.prisma,
    session: input.session,
  });

  if (
    candidateMemberIds.length !== 1
    || candidateMemberIds[0] !== input.expectedMemberId
  ) {
    throw hostedOnboardingError({
      code: "STRIPE_CHECKOUT_MEMBER_MISMATCH",
      message: "That checkout session does not belong to this hosted account.",
      httpStatus: 403,
    });
  }
}
