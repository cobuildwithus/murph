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
import { writeHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import { getHostedInviteStatus, requireHostedInviteForAuthentication } from "./invite-service";
import {
  activateHostedMemberForPositiveSource,
  runHostedMemberActivationPostCommitEffects,
} from "./member-activation";
import { requireHostedStripeApi } from "./runtime";
import { normalizeNullableString } from "./shared";
import { findMemberForStripeObject } from "./stripe-billing-lookup";
import { updateHostedMemberStripeBillingIfFresh } from "./stripe-billing-policy";

const STRIPE_CHECKOUT_SUCCESS_REDIRECT_SOURCE_TYPE = "stripe.checkout.session.success_redirect";

export async function reconcileHostedBillingCheckoutSuccess(input: {
  inviteCode: string;
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
    memberId: invite.memberId,
    prisma,
    session,
    stripe,
  });

  return getHostedInviteStatus({
    authenticatedMember: input.member,
    inviteCode: input.inviteCode,
    prisma,
  });
}

async function applyHostedCheckoutSessionSuccess(input: {
  memberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
  stripe: Stripe;
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

  await writeHostedMemberStripeBillingRef({
    memberId: member.core.id,
    prisma: input.prisma,
    stripeCustomerId,
    stripeSubscriptionId: subscriptionId ?? member.billingRef?.stripeSubscriptionId ?? null,
  });

  if (!subscriptionId) {
    return;
  }

  const subscription = await readHostedCheckoutSessionSubscription({
    session: input.session,
    stripe: input.stripe,
    subscriptionId,
  });
  const dispatchContext = {
    eventCreatedAt: new Date(),
    occurredAt: new Date().toISOString(),
    sourceEventId: input.session.id,
    sourceType: STRIPE_CHECKOUT_SUCCESS_REDIRECT_SOURCE_TYPE,
  } as const;
  const hadActiveBilling = member.core.billingStatus === HostedBillingStatus.active;
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingStatus: mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status),
    dispatchContext,
    member,
    prisma: input.prisma,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });

  if (!updatedMember || updatedMember.core.billingStatus !== HostedBillingStatus.active) {
    return;
  }

  const activation = await activateHostedMemberForPositiveSource({
    dispatchContext,
    member: updatedMember,
    prisma: input.prisma,
    skipIfBillingAlreadyActive: hadActiveBilling,
  });

  await runHostedMemberActivationPostCommitEffects({
    postCommitProvisionUserId: activation.postCommitProvisionUserId,
  });

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
