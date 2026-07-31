import "server-only";

import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type PrismaClient,
} from "@prisma/client";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { logHostedOnboardingDiagnostic } from "../hosted-onboarding/logging";
import { requireHostedStripeApiMode } from "../hosted-onboarding/runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  tryChargeHostedUsageCreditSavedCard,
} from "../hosted-onboarding/usage-credit-saved-card-payment";
import {
  parseHostedUsageCreditCheckoutRequestPolicyVersion,
} from "../hosted-onboarding/usage-credit-offers";
import {
  buildHostedGroupSponsorshipPaymentAuthority,
} from "../hosted-onboarding/usage-credit-purchase-service";
import {
  assertHostedUsageCreditStripePriceMatchesPurchase,
  buildHostedUsageCreditInvariantError,
  reconstructHostedUsageCreditStripeCheckoutRequest,
} from "../hosted-onboarding/usage-credit-purchase-stripe";
import {
  markHostedGroupSponsorshipRecoveryRequiredForPurchase,
} from "./group-sponsorship-authorization";
import {
  materializeHostedGroupSponsorshipRecoveryNotification,
} from "./group-sponsorship-notification";

const HOSTED_GROUP_SPONSORSHIP_REFILL_DISPATCH_LIMIT = 20;
const AUTOMATIC_REFILL_DISPATCH_STATUSES = [
  HostedUsageCreditPurchaseStatus.created,
  HostedUsageCreditPurchaseStatus.payment_pending,
] as const;

export interface HostedGroupSponsorshipRefillDispatchSummary {
  attempted: number;
  dispatched: number;
  recoveryRequired: number;
}

export async function dispatchHostedGroupSponsorshipRefills(input: {
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedGroupSponsorshipRefillDispatchSummary> {
  const now = input.now ?? new Date();
  const purchases = await readHostedGroupSponsorshipRefillDispatchBatch({
    now,
    prisma: input.prisma,
  });

  let dispatched = 0;
  let recoveryRequired = 0;
  const dispatchablePurchases: HostedUsageCreditPurchase[] = [];
  for (const purchase of purchases) {
    await markHostedGroupSponsorshipRefillAttempt({
      now,
      prisma: input.prisma,
      purchaseId: purchase.id,
    });
    if (
      purchase.status === HostedUsageCreditPurchaseStatus.created &&
      now.getTime() >= purchase.checkoutExpiresAt.getTime()
    ) {
      try {
        await expireElapsedUnboundHostedGroupSponsorshipRefill({
          now,
          prisma: input.prisma,
          purchase,
        });
      } catch (error) {
        logHostedOnboardingDiagnostic(
          "hosted-groups.sponsorship-refill-dispatch",
          {
            kind: "purchase_expiry_failed",
            purchaseId: purchase.id,
            reason: isHostedOnboardingError(error) ? error.code : "unhandled",
          },
        );
      }
      continue;
    }
    dispatchablePurchases.push(purchase);
  }
  if (dispatchablePurchases.length > 0) {
    const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
    for (const purchase of dispatchablePurchases) {
      try {
        if (purchase.stripeLiveMode !== stripeLiveMode) {
          throw buildHostedUsageCreditInvariantError(
            "group_sponsorship_stripe_mode_mismatch",
          );
        }
        const policyVersion = parseHostedUsageCreditCheckoutRequestPolicyVersion(
          purchase.checkoutRequestPolicyVersion,
        );
        const authority = buildHostedGroupSponsorshipPaymentAuthority({
          mode: "automatic",
          purchase,
        });
        if (!policyVersion || !authority) {
          throw buildHostedUsageCreditInvariantError(
            "group_sponsorship_refill_identity_invalid",
          );
        }
        const checkoutRequest =
          await reconstructHostedUsageCreditStripeCheckoutRequest({
            prisma: input.prisma,
            purchase,
          });
        await assertHostedUsageCreditStripePriceMatchesPurchase({
          checkoutRequest,
          purchase,
          stripe,
        });
        const result = await tryChargeHostedUsageCreditSavedCard({
          billingAuthority: { automaticSponsorship: authority, kind: "group" },
          checkoutRequest,
          now,
          policyVersion,
          prisma: input.prisma,
          purchase,
          stripe,
        });
        if (
          result &&
          (
            result.status === HostedUsageCreditPurchaseStatus.payment_pending ||
            result.status === HostedUsageCreditPurchaseStatus.fulfilled
          )
        ) {
          dispatched += 1;
          continue;
        }
        const recovery =
          await markHostedGroupSponsorshipRecoveryRequiredForPurchase({
            now,
            prisma: input.prisma,
            purchaseId: purchase.id,
          });
        if (recovery) {
          recoveryRequired += 1;
        }
      } catch (error) {
        // The exact purchase and provider idempotency keys remain the work
        // identity. Updating only existing reconciliation-attempt metadata
        // rotates this row behind untouched work without inventing a queue.
        logHostedOnboardingDiagnostic("hosted-groups.sponsorship-refill-dispatch", {
          kind: "purchase_failed",
          purchaseId: purchase.id,
          reason: isHostedOnboardingError(error) ? error.code : "unhandled",
        });
      }
    }
  }

  await retryHostedGroupSponsorshipRecoveryNotifications({
    now,
    prisma: input.prisma,
  });

  return {
    attempted: purchases.length,
    dispatched,
    recoveryRequired,
  };
}

async function readHostedGroupSponsorshipRefillDispatchBatch(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<HostedUsageCreditPurchase[]> {
  return input.prisma.hostedUsageCreditPurchase.findMany({
    orderBy: [
      { lastReconciledAt: { nulls: "first", sort: "asc" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: HOSTED_GROUP_SPONSORSHIP_REFILL_DISPATCH_LIMIT,
    where: {
      groupSponsorshipChargeOrdinal: { gt: 0 },
      OR: [
        {
          checkoutExpiresAt: { lte: input.now },
          status: HostedUsageCreditPurchaseStatus.created,
          stripeChargeIdEncrypted: null,
          stripeChargeLookupKey: null,
          stripeCheckoutSessionIdEncrypted: null,
          stripeCheckoutSessionLookupKey: null,
          stripeCheckoutUrlEncrypted: null,
          stripePaymentIntentIdEncrypted: null,
          stripePaymentIntentLookupKey: null,
        },
        {
          groupSponsorshipAuthorization: {
            status: HostedGroupSponsorshipAuthorizationStatus.active,
          },
          status: HostedUsageCreditPurchaseStatus.created,
        },
        {
          // A crash may leave an intent bound before confirmation. Keep that
          // purchase visible even after pause/cancel so the saved-card owner
          // can recheck authority and prove the intent canceled or paid.
          status: HostedUsageCreditPurchaseStatus.payment_pending,
        },
      ],
    },
  });
}

async function markHostedGroupSponsorshipRefillAttempt(input: {
  now: Date;
  prisma: PrismaClient;
  purchaseId: string;
}): Promise<void> {
  await input.prisma.hostedUsageCreditPurchase.updateMany({
    data: {
      lastReconciledAt: input.now,
      updatedAt: input.now,
    },
    where: {
      groupSponsorshipChargeOrdinal: { gt: 0 },
      id: input.purchaseId,
      status: { in: [...AUTOMATIC_REFILL_DISPATCH_STATUSES] },
    },
  });
}

async function expireElapsedUnboundHostedGroupSponsorshipRefill(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.purchase.beneficiaryMemberId);
    const payerMemberId = input.purchase.payerMemberId;
    if (!payerMemberId) {
      return;
    }
    await lockHostedMemberRow(tx, payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (
      !current ||
      !isElapsedUnboundAutomaticRefill({ now: input.now, purchase: current })
    ) {
      return;
    }
    const expired = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        lastReconciledAt: input.now,
        reconciliationVersion: { increment: 1n },
        status: HostedUsageCreditPurchaseStatus.expired,
        terminalAt: input.now,
        updatedAt: input.now,
      },
      where: {
        checkoutExpiresAt: { lte: input.now },
        groupSponsorshipChargeOrdinal: { gt: 0 },
        id: current.id,
        reconciliationVersion: current.reconciliationVersion,
        paidAt: null,
        status: HostedUsageCreditPurchaseStatus.created,
        stripeChargeIdEncrypted: null,
        stripeChargeLookupKey: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        stripeCheckoutUrlEncrypted: null,
        stripePaymentIntentIdEncrypted: null,
        stripePaymentIntentLookupKey: null,
        terminalAt: null,
      },
    });
    if (expired.count !== 1) {
      throw new TypeError(
        "Hosted group sponsorship refill expiry changed concurrently.",
      );
    }
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function isElapsedUnboundAutomaticRefill(input: {
  now: Date;
  purchase: HostedUsageCreditPurchase | null;
}): boolean {
  const purchase = input.purchase;
  return Boolean(
    purchase &&
    purchase.payerMemberId &&
    purchase.groupSponsorshipAuthorizationId &&
    purchase.groupSponsorshipChargeOrdinal !== null &&
    purchase.groupSponsorshipChargeOrdinal > 0 &&
    purchase.status === HostedUsageCreditPurchaseStatus.created &&
    input.now.getTime() >= purchase.checkoutExpiresAt.getTime() &&
    !purchase.stripeCheckoutSessionLookupKey &&
    !purchase.stripeCheckoutSessionIdEncrypted &&
    !purchase.stripeCheckoutUrlEncrypted &&
    !purchase.stripePaymentIntentLookupKey &&
    !purchase.stripePaymentIntentIdEncrypted &&
    !purchase.stripeChargeLookupKey &&
    !purchase.stripeChargeIdEncrypted,
  );
}

async function retryHostedGroupSponsorshipRecoveryNotifications(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<void> {
  const purchases = await input.prisma.hostedUsageCreditPurchase.findMany({
    orderBy: [
      { lastReconciledAt: { nulls: "first", sort: "asc" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: HOSTED_GROUP_SPONSORSHIP_REFILL_DISPATCH_LIMIT,
    where: {
      groupSponsorshipAuthorization: {
        status: HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      },
      groupSponsorshipChargeOrdinal: { gt: 0 },
      status: HostedUsageCreditPurchaseStatus.payment_failed,
    },
  });
  for (const purchase of purchases) {
    try {
      await materializeHostedGroupSponsorshipRecoveryNotification({
        now: input.now,
        prisma: input.prisma,
        purchaseId: purchase.id,
      });
    } catch (error) {
      logHostedOnboardingDiagnostic("hosted-groups.sponsorship-refill-dispatch", {
        kind: "recovery_notification_failed",
        purchaseId: purchase.id,
        reason: isHostedOnboardingError(error) ? error.code : "unhandled",
      });
    } finally {
      await input.prisma.hostedUsageCreditPurchase.updateMany({
        data: {
          lastReconciledAt: input.now,
          updatedAt: input.now,
        },
        where: {
          groupSponsorshipChargeOrdinal: { gt: 0 },
          id: purchase.id,
          status: HostedUsageCreditPurchaseStatus.payment_failed,
        },
      });
    }
  }
}
