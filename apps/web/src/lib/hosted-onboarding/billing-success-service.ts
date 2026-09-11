import { type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
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
  cleanupHostedFamilySponsoredDirectSubscription,
  cleanupHostedStandardCheckoutAndRetireAttempt,
  type HostedStripeCheckoutCleanup,
  prepareHostedStripeCheckoutCompletion,
} from "./stripe-billing-events";

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

  const checkoutOutcome = await applyHostedCheckoutSessionSuccess({
    memberId: invite.memberId,
    prisma,
    session,
  });
  if (checkoutOutcome.cleanupFamilySponsoredStripeSubscriptionId) {
    await cleanupHostedFamilySponsoredDirectSubscription({
      memberId: invite.memberId,
      prisma,
      sourceEventId: `checkout-success:${session.id}:family-sponsored-cleanup`,
      subscriptionId: checkoutOutcome.cleanupFamilySponsoredStripeSubscriptionId,
    });
  }
  if (checkoutOutcome.cleanupFamilySponsoredCheckout) {
    await cleanupHostedFamilySponsoredDirectSubscription({
      checkoutSessionId:
        checkoutOutcome.cleanupFamilySponsoredCheckout.checkoutSessionId,
      memberId: invite.memberId,
      prisma,
      sourceEventId:
        `checkout-success:${session.id}:family-sponsored-checkout-cleanup`,
      subscriptionId:
        checkoutOutcome.cleanupFamilySponsoredCheckout.subscriptionId,
    });
  }
  if (checkoutOutcome.cleanupStandardCheckout) {
    await cleanupHostedStandardCheckoutAndRetireAttempt({
      checkoutSessionId:
        checkoutOutcome.cleanupStandardCheckout.checkoutSessionId,
      memberId: invite.memberId,
      prisma,
      stripe,
      subscriptionId:
        checkoutOutcome.cleanupStandardCheckout.subscriptionId,
    });
  }
  await sendHostedCheckoutSuccessWelcomeEmailBestEffort({
    memberId: checkoutOutcome.welcomeEmailMemberId,
    prisma,
  });
  return getHostedInviteStatus({
    authenticatedMember: input.member,
    inviteCode: input.inviteCode,
    prisma,
  });
}

type HostedCheckoutSessionSuccessInput = {
  memberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
};

type HostedCheckoutSessionSuccessOutcome = {
  cleanupFamilySponsoredCheckout?: HostedStripeCheckoutCleanup | null;
  cleanupFamilySponsoredStripeSubscriptionId?: string | null;
  cleanupStandardCheckout?: HostedStripeCheckoutCleanup | null;
  welcomeEmailMemberId: string | null;
};

async function applyHostedCheckoutSessionSuccess(
  input: HostedCheckoutSessionSuccessInput,
): Promise<HostedCheckoutSessionSuccessOutcome> {
  return runWithHostedDomainRootUnwrapCache(
    () => applyHostedCheckoutSessionSuccessWithinUnwrapCache(input),
  );
}

async function applyHostedCheckoutSessionSuccessWithinUnwrapCache(
  input: HostedCheckoutSessionSuccessInput,
): Promise<HostedCheckoutSessionSuccessOutcome> {
  const preparedCheckoutCompletion =
    await prepareHostedStripeCheckoutCompletion({
      memberId: input.memberId,
      prisma: input.prisma,
      session: input.session,
    });
  return withHostedMemberStripeMutationLock({
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

      if (preparedCheckoutCompletion) {
        return applyStripeCheckoutCompleted(
          input.session,
          tx,
          undefined,
          preparedCheckoutCompletion,
        );
      }
      return applyStripeCheckoutCompleted(input.session, tx);
    },
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
