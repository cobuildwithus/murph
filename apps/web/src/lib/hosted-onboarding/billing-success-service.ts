import { type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { getPrisma } from "../prisma";
import { HOSTED_PULSE_TRIAL_OFFER } from "./billing-plans";
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
  scheduleHostedSignupNotificationEmails,
} from "./signup-notification-email";
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
  cancelHostedPulseTrialCheckoutLoserSubscription,
  type HostedStripeCheckoutCleanup,
  prepareHostedStripeDirectMemberActivationCrypto,
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

  const activationOutcome = await applyHostedCheckoutSessionSuccess({
    memberId: invite.memberId,
    prisma,
    session,
  });
  if (activationOutcome.newlyActivatedMemberIds.length > 0) {
    scheduleHostedSignupNotificationEmails({
      activationSurface: "website",
      memberIds: activationOutcome.newlyActivatedMemberIds,
      prisma,
    });
  }
  if (activationOutcome.cleanupFamilySponsoredStripeSubscriptionId) {
    await cleanupHostedFamilySponsoredDirectSubscription({
      memberId: invite.memberId,
      prisma,
      sourceEventId: `checkout-success:${session.id}:family-sponsored-cleanup`,
      subscriptionId: activationOutcome.cleanupFamilySponsoredStripeSubscriptionId,
    });
  }
  if (activationOutcome.cleanupFamilySponsoredCheckout) {
    await cleanupHostedFamilySponsoredDirectSubscription({
      checkoutSessionId:
        activationOutcome.cleanupFamilySponsoredCheckout.checkoutSessionId,
      memberId: invite.memberId,
      prisma,
      sourceEventId:
        `checkout-success:${session.id}:family-sponsored-checkout-cleanup`,
      subscriptionId:
        activationOutcome.cleanupFamilySponsoredCheckout.subscriptionId,
    });
  }
  if (activationOutcome.cleanupPulseTrialStripeSubscriptionId) {
    await cancelHostedPulseTrialCheckoutLoserSubscription({
      memberId: invite.memberId,
      prisma,
      subscriptionId: activationOutcome.cleanupPulseTrialStripeSubscriptionId,
    });
  }
  if (activationOutcome.cleanupStandardCheckout) {
    await cleanupHostedStandardCheckoutAndRetireAttempt({
      checkoutSessionId:
        activationOutcome.cleanupStandardCheckout.checkoutSessionId,
      memberId: invite.memberId,
      prisma,
      stripe,
      subscriptionId:
        activationOutcome.cleanupStandardCheckout.subscriptionId,
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

type HostedCheckoutSessionSuccessInput = {
  memberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
};

type HostedCheckoutSessionSuccessOutcome = {
  activatedMemberId: string | null;
  cleanupPulseTrialStripeSubscriptionId?: string | null;
  cleanupFamilySponsoredCheckout?: HostedStripeCheckoutCleanup | null;
  cleanupFamilySponsoredStripeSubscriptionId?: string | null;
  cleanupStandardCheckout?: HostedStripeCheckoutCleanup | null;
  hostedExecutionEventId: string | null;
  newlyActivatedMemberIds: string[];
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
  const preparedCryptoDomainRoots =
    input.session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
      ? await prepareHostedStripeDirectMemberActivationCrypto({
          memberId: input.memberId,
          prisma: input.prisma,
        })
      : null;
  const preparedCheckoutCompletion =
    await prepareHostedStripeCheckoutCompletion({
      memberId: input.memberId,
      prisma: input.prisma,
      session: input.session,
    });
  let activationOutcome: HostedCheckoutSessionSuccessOutcome = {
    activatedMemberId: null,
    hostedExecutionEventId: null,
    newlyActivatedMemberIds: [],
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

      if (preparedCheckoutCompletion) {
        return applyStripeCheckoutCompleted(
          input.session,
          tx,
          undefined,
          preparedCryptoDomainRoots ?? undefined,
          preparedCheckoutCompletion,
        );
      }
      return preparedCryptoDomainRoots
        ? applyStripeCheckoutCompleted(
            input.session,
            tx,
            undefined,
            preparedCryptoDomainRoots,
          )
        : applyStripeCheckoutCompleted(input.session, tx);
    },
  });

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
