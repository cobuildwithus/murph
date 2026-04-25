import { type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberCoreState,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import { getHostedInviteStatus, requireHostedInviteForAuthentication } from "./invite-service";
import { type PrivyLinkedAccountLike } from "./privy-shared";
import { requireHostedStripeApi } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "./shared";
import {
  listHostedStripeCheckoutSessionMemberIds,
} from "./stripe-billing-lookup";
import { bindHostedStripeBillingRefsFromCheckoutSessionTx } from "./stripe-billing-events";

export async function reconcileHostedBillingCheckoutSuccess(input: {
  inviteCode: string;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  member: HostedMemberCoreState;
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

  assertHostedCheckoutSessionReadyForSuccessRedirect(session);

  await assertHostedCheckoutSessionBelongsToMember({
    expectedMemberId: invite.memberId,
    prisma,
    session,
  });

  await applyHostedCheckoutSessionSuccess({
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
  memberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    const memberCore = await readHostedMemberCoreState({
      memberId: input.memberId,
      prisma: tx,
    });

    if (!memberCore) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_NOT_FOUND",
        message: "Finish signup from your latest Murph link before continuing.",
        httpStatus: 403,
      });
    }

    await bindHostedStripeBillingRefsFromCheckoutSessionTx({
      memberId: memberCore.id,
      session: input.session,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function assertHostedCheckoutSessionReadyForSuccessRedirect(session: Stripe.Checkout.Session) {
  if (session.status === "complete") {
    return;
  }

  throw hostedOnboardingError({
    code: "STRIPE_CHECKOUT_SESSION_NOT_COMPLETE",
    message: "That checkout session is not ready for success reconciliation yet.",
    httpStatus: 409,
  });
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
