import { type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "./member-activation-runtime-wake";
import {
  readHostedMemberCoreState,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import { getHostedInviteStatus, requireHostedInviteForAuthentication } from "./invite-service";
import { type PrivyLinkedAccountLike } from "./privy-shared";
import { requireHostedStripeApi } from "./runtime";
import { withHostedStripeFailureLog } from "./stripe-error-log";
import {
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";
import {
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
import {
  listHostedStripeCheckoutSessionMemberIds,
} from "./stripe-billing-lookup";
import {
  applyStripeCheckoutCompleted,
  cancelHostedPulseTrialCheckoutLoserSubscription,
} from "./stripe-billing-events";
import {
  executeHostedCheckoutSubscriptionCleanup,
  type HostedCheckoutSubscriptionCleanupCandidate,
} from "./stripe-checkout-subscription-cleanup";

export async function reconcileHostedBillingCheckoutSuccess(input: {
  inviteCode: string;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  member: HostedMemberCoreState;
  now?: Date;
  prisma?: PrismaClient;
  sessionId: string;
}) {
  const prisma = input.prisma ?? getPrisma();
  const observedAt = input.now ?? new Date();
  const invite = await requireHostedInviteForAuthentication(
    input.inviteCode,
    prisma,
    observedAt,
  );

  if (input.member.id !== invite.memberId) {
    throw hostedOnboardingError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
      httpStatus: 403,
    });
  }

  const stripe = requireHostedStripeApi();
  const session = await withHostedStripeFailureLog(
    "checkout.sessions.retrieve.billing-success",
    () => stripe.checkout.sessions.retrieve(input.sessionId, {
      expand: ["subscription"],
    }),
  );

  assertHostedCheckoutSessionReadyForSuccessRedirect(session);

  await assertHostedCheckoutSessionBelongsToMember({
    expectedMemberId: invite.memberId,
    prisma,
    session,
  });

  const activationOutcome = await applyHostedCheckoutSessionSuccess({
    memberId: invite.memberId,
    observedAt,
    prisma,
    session,
  });
  await cleanupHostedCheckoutSubscriptionIfNeeded({
    candidate: activationOutcome.cleanupCheckoutSubscription,
    prisma,
    stripe,
  });
  if (activationOutcome.cleanupPulseTrialStripeSubscriptionId) {
    await cancelHostedPulseTrialCheckoutLoserSubscription({
      memberId: invite.memberId,
      prisma,
      subscriptionId: activationOutcome.cleanupPulseTrialStripeSubscriptionId,
    });
  }
  await nudgeHostedCheckoutSuccessActivationRunner({
    ...activationOutcome,
    prisma,
  });
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
  observedAt: Date;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
}): Promise<{
  activatedMemberId: string | null;
  cleanupCheckoutSubscription?: HostedCheckoutSubscriptionCleanupCandidate | null;
  cleanupPulseTrialStripeSubscriptionId?: string | null;
  hostedExecutionEventId: string | null;
  welcomeEmailMemberId: string | null;
}> {
  let activationOutcome: {
    activatedMemberId: string | null;
    cleanupCheckoutSubscription?: HostedCheckoutSubscriptionCleanupCandidate | null;
    cleanupPulseTrialStripeSubscriptionId?: string | null;
    hostedExecutionEventId: string | null;
    welcomeEmailMemberId: string | null;
  } = {
    activatedMemberId: null,
    hostedExecutionEventId: null,
    welcomeEmailMemberId: null,
  };

  activationOutcome = await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
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

      return applyStripeCheckoutCompleted(
        input.session,
        tx,
        undefined,
        input.observedAt,
      );
    },
  });

  return activationOutcome;
}

async function cleanupHostedCheckoutSubscriptionIfNeeded(input: {
  candidate?: HostedCheckoutSubscriptionCleanupCandidate | null;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<void> {
  if (!input.candidate) {
    return;
  }

  await executeHostedCheckoutSubscriptionCleanup({
    candidate: input.candidate,
    prisma: input.prisma,
    stripe: input.stripe,
  });
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
  prisma: PrismaClient;
}): Promise<void> {
  if (!input.activatedMemberId || !input.hostedExecutionEventId) {
    return;
  }

  await signalHostedMemberActivationRuntimeWakeBestEffortResult({
    hostedExecutionEventId: input.hostedExecutionEventId,
    memberId: input.activatedMemberId,
    prisma: input.prisma,
    source: "checkout-success.activation",
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
