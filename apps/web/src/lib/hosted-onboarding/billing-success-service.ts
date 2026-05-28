import { type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { signalHostedRuntimeManualWakeBestEffort } from "../hosted-orchestration/manual-wake";
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
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
import {
  listHostedStripeCheckoutSessionMemberIds,
} from "./stripe-billing-lookup";
import { applyStripeCheckoutCompleted } from "./stripe-billing-events";

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

  const activationOutcome = await applyHostedCheckoutSessionSuccess({
    memberId: invite.memberId,
    prisma,
    session,
  });
  await nudgeHostedCheckoutSuccessActivationRunner(activationOutcome);
  await sendHostedCheckoutSuccessWelcomeEmailBestEffort({
    memberId: activationOutcome.welcomeEmailMemberId,
    prisma,
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
}): Promise<{
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  welcomeEmailMemberId: string | null;
}> {
  let activationOutcome: {
    activatedMemberId: string | null;
    hostedExecutionEventId: string | null;
    welcomeEmailMemberId: string | null;
  } = {
    activatedMemberId: null,
    hostedExecutionEventId: null,
    welcomeEmailMemberId: null,
  };

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

    activationOutcome = await applyStripeCheckoutCompleted(input.session, tx);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return activationOutcome;
}

async function sendHostedCheckoutSuccessWelcomeEmailBestEffort(input: {
  memberId: string | null;
  prisma: PrismaClient;
}): Promise<void> {
  if (!input.memberId) {
    return;
  }

  await sendHostedSignupWelcomeEmailForMemberBestEffort({
    memberId: input.memberId,
    prisma: input.prisma,
  });
}

async function nudgeHostedCheckoutSuccessActivationRunner(input: {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
}): Promise<void> {
  if (!input.activatedMemberId || !input.hostedExecutionEventId) {
    return;
  }

  await signalHostedRuntimeManualWakeBestEffort({
    userId: input.activatedMemberId,
  });
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
