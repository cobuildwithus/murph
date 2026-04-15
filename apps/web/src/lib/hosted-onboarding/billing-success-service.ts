import { HostedBillingStatus, type HostedMember, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { drainHostedExecutionOutboxBestEffort } from "../hosted-execution/outbox";
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
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import { resolveHostedMemberEmailLinked } from "./member-channel-sync";
import type { PrivyLinkedAccountLike } from "./privy-shared";
import { requireHostedStripeApi } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  normalizeNullableString,
} from "./shared";
import { findMemberForStripeObject } from "./stripe-billing-lookup";
import { updateHostedMemberStripeBillingIfFreshTx } from "./stripe-billing-policy";

const STRIPE_CHECKOUT_SUCCESS_REDIRECT_SOURCE_TYPE = "stripe.checkout.session.success_redirect";

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

  await applyHostedCheckoutSessionSuccess({
    emailLinked: await resolveHostedMemberEmailLinked({
      linkedAccounts: input.linkedAccounts,
      memberId: invite.memberId,
      onUnconfirmed: "disable",
    }),
    memberId: invite.memberId,
    prisma,
    session,
  });

  return getHostedInviteStatus({
    authenticatedMember: input.member,
    inviteCode: input.inviteCode,
    prisma,
  });
}

async function applyHostedCheckoutSessionSuccess(input: {
  emailLinked: boolean;
  memberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
}) {
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

  const subscriptionId = coerceStripeSubscriptionId(input.session.subscription);
  const stripeCustomerId = coerceStripeObjectId(input.session.customer) ?? member.billingRef?.stripeCustomerId ?? null;

  if (!subscriptionId) {
    await input.prisma.$transaction(async (tx) => {
      await writeHostedMemberStripeBillingRefTx({
        memberId: member.core.id,
        stripeCustomerId,
        stripeSubscriptionId: member.billingRef?.stripeSubscriptionId ?? null,
        tx,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    return;
  }

  const subscription = await readHostedCheckoutSessionSubscription({
    session: input.session,
    stripe: requireHostedStripeApi(),
    subscriptionId,
  });
  const dispatchContext = {
    eventCreatedAt: new Date(),
    occurredAt: new Date().toISOString(),
    sourceEventId: input.session.id,
    sourceType: STRIPE_CHECKOUT_SUCCESS_REDIRECT_SOURCE_TYPE,
  } as const;
  const hadActiveBilling = member.core.billingStatus === HostedBillingStatus.active;
  const canonicalBillingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
  const activation = await input.prisma.$transaction(async (tx) => {
    const updatedMember = await updateHostedMemberStripeBillingIfFreshTx({
      billingStatus: canonicalBillingStatus,
      canonicalBillingStatus,
      dispatchContext,
      member,
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      tx,
    });

    if (!updatedMember || updatedMember.core.billingStatus !== HostedBillingStatus.active) {
      return null;
    }

    return activateHostedMemberForPositiveSourceTx({
      dispatchContext,
      emailLinked: input.emailLinked,
      member: updatedMember,
      prisma: tx,
      skipIfBillingAlreadyActive: hadActiveBilling,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (!activation) {
    return;
  }

  if (activation.hostedExecutionEventId) {
    await drainHostedExecutionOutboxBestEffort({
      eventIds: [activation.hostedExecutionEventId],
      limit: 1,
      prisma: input.prisma,
    });
  }
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

async function readHostedCheckoutSessionSubscription(input: {
  session: Stripe.Checkout.Session;
  stripe: Stripe;
  subscriptionId: string;
}): Promise<Stripe.Subscription> {
  if (
    input.session.subscription &&
    typeof input.session.subscription === "object" &&
    "status" in input.session.subscription
  ) {
    return input.session.subscription as Stripe.Subscription;
  }

  return input.stripe.subscriptions.retrieve(input.subscriptionId);
}
