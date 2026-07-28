import "server-only";

import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";

import {
  hasActiveHostedCryptoDomainRootsForUserTx,
} from "../hosted-crypto/domain-root-store";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import {
  resolveHostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import {
  hasConfirmedHostedGroupMembership,
  resolveHostedTrialContinuationOffer,
} from "./billing-plan-eligibility";
import {
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
  HOSTED_PULSE_TRIAL_OFFER,
} from "./billing-plans";
import { getHostedOnboardingEnvironment } from "./runtime";
import { readHostedStripeSubscriptionTender } from "./stripe-billing-state";

export interface HostedTrialEndingNotificationSignal {
  mailboxItemId: string;
  memberId: string;
}

export async function appendHostedTrialEndingNotificationTx(input: {
  memberId: string;
  occurredAt: Date;
  subscription: Pick<
    Stripe.Subscription,
    | "customer"
    | "default_payment_method"
    | "default_source"
    | "id"
    | "status"
    | "trial_end"
  >;
  tx: Prisma.TransactionClient;
}): Promise<HostedTrialEndingNotificationSignal | null> {
  if (
    input.subscription.status !== "trialing"
    || typeof input.subscription.trial_end !== "number"
  ) {
    return null;
  }

  const billingRef = await input.tx.hostedMemberBillingRef.findUnique({
    select: {
      currentBillingPhase: true,
      currentBillingPlanCode: true,
      currentCheckoutOffer: true,
      scheduledBillingPlanCode: true,
    },
    where: {
      memberId: input.memberId,
    },
  });
  if (
    billingRef?.currentBillingPhase !== "trial"
    || billingRef.currentBillingPlanCode !== "launch_monthly"
    || billingRef.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER
  ) {
    return null;
  }

  if (!(await hasActiveHostedCryptoDomainRootsForUserTx({
    tx: input.tx,
    userId: input.memberId,
  }))) {
    return null;
  }

  const destination = await resolveHostedAssistantNotificationDestination({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (
    !destination
    || destination.conversationShape !== "direct-member"
    || destination.route.threadIsDirect !== true
  ) {
    return null;
  }

  const environment = getHostedOnboardingEnvironment();
  const hasConfirmedGroupMembership =
    await hasConfirmedHostedGroupMembership({
      memberId: input.memberId,
      prisma: input.tx,
    });
  const offer = resolveHostedTrialContinuationOffer({
    groupPlanConfigured:
      environment.stripePriceIdsByPlan.launch_group_monthly !== null,
    hasConfirmedGroupMembership,
  });
  const trialEndsAt = new Date(input.subscription.trial_end * 1_000);
  const notificationKey =
    `trial-ending:${input.subscription.id}:${input.subscription.trial_end}`;
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: `assistant.notification.requested:${notificationKey}`,
      memberId: input.memberId,
      notification: {
        deliveryDedupeToken: notificationKey,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: notificationKey,
        instructions:
          "Private trial-ending billing notice; exact user-facing text is in responsePolicy.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: buildHostedTrialEndingNotificationText({
            availablePlanCodes: offer.availablePlanCodes,
            renewalPlanCode:
              billingRef.scheduledBillingPlanCode ===
                "launch_group_monthly"
                ? "launch_group_monthly"
                : readHostedStripeSubscriptionTender(input.subscription)
                  ? "launch_monthly"
                  : null,
            trialEndsAt,
          }),
        },
        route: destination.route,
      },
      occurredAt: input.occurredAt.toISOString(),
    }),
    tx: input.tx,
  });

  return {
    mailboxItemId: appended.item.id,
    memberId: appended.item.userId,
  };
}

export function buildHostedTrialEndingNotificationText(input: {
  availablePlanCodes: readonly (
    | "launch_group_monthly"
    | "launch_monthly"
  )[];
  renewalPlanCode:
    | "launch_group_monthly"
    | "launch_monthly"
    | null;
  trialEndsAt: Date;
}): string {
  const trialEndLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
  }).format(input.trialEndsAt);
  const groupPrice = formatHostedBillingPrice(
    getHostedBillingPlanDefinition("launch_group_monthly")
      .recurringAmountUsdCents,
  );
  const pulsePrice = formatHostedBillingPrice(
    getHostedBillingPlanDefinition("launch_monthly")
      .recurringAmountUsdCents,
  );

  if (input.renewalPlanCode === "launch_group_monthly") {
    return `Your Pulse trial ends ${trialEndLabel} and is set to continue as Group for ${groupPrice}/month. Group keeps your wearable syncing and your group activity current, with lighter private Murph usage. You can keep Group or choose Pulse in Settings before then.`;
  }

  if (input.availablePlanCodes.includes("launch_group_monthly")) {
    if (input.renewalPlanCode !== "launch_monthly") {
      return `Your Pulse trial ends ${trialEndLabel}. Since you're already part of a Murph group, you can continue with Group for ${groupPrice}/month. It keeps your wearable syncing, keeps your group activity current, and includes lighter private Murph usage. Choose Pulse instead if you expect to use Murph regularly one-on-one. Open Settings to choose.`;
    }
    return `Your trial is currently set to renew as Pulse for ${pulsePrice}/month on ${trialEndLabel}. Because you're in a Murph group, you can switch to Group for ${groupPrice}/month before then, or keep Pulse for more included one-on-one Murph usage. Group keeps your wearable syncing and your group activity current. Open Settings to choose.`;
  }

  if (input.renewalPlanCode !== "launch_monthly") {
    return `Your Pulse trial ends ${trialEndLabel}. Keep Pulse to continue using Murph, your connected wearable, and your personal health context. Open Settings to review your plan before then.`;
  }
  return `Your Pulse trial ends ${trialEndLabel} and is set to renew for ${pulsePrice}/month. Keep Pulse to continue using Murph, your connected wearable, and your personal health context. Open Settings to review your plan before then.`;
}
