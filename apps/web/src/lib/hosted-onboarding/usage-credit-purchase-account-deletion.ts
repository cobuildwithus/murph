import type Stripe from "stripe";

import {
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { coerceStripeObjectId } from "./billing";
import {
  createHostedStripeCheckoutSessionLookupKey,
  hostedLookupKeyMatchesValue,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { requireHostedStripeApiMode } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  assertHostedUsageCreditStripeSessionMatchesPurchase,
  buildHostedUsageCreditCheckoutIdempotencyKey,
  buildHostedUsageCreditInvariantError,
  buildHostedUsageCreditStripeUnavailableError,
  decryptHostedUsageCreditPurchaseStripeField,
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  isDefinitiveHostedUsageCreditStripeRequestRejection,
  projectHostedUsageCreditStripeSessionState,
  reconstructHostedUsageCreditStripeCheckoutRequest,
  requireHostedUsageCreditEncryptedValue,
  requireHostedUsageCreditLookupKey,
  requireHostedUsageCreditPurchasePayerMemberId,
  retrieveAndExpireHostedUsageCreditStripeSession,
} from "./usage-credit-purchase-stripe";
import {
  lockHostedUsageCreditPurchaseReservationOwnersTx,
} from "./usage-credit-purchase-reservation-lock";
import { logHostedStripeFailure } from "./stripe-error-log";
import {
  cancelHostedUsageCreditDirectPayment,
  canCancelHostedUsageCreditDirectPayment,
} from "./usage-credit-saved-card-payment";
import { getPrisma } from "../prisma";

export async function closeHostedUsageCreditPurchasesForAccountDeletion(input: {
  memberIds: readonly string[];
  now?: Date;
  prisma?: PrismaClient;
}): Promise<void> {
  const memberIds = [...new Set(input.memberIds)].sort();
  if (memberIds.length === 0) {
    return;
  }

  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const purchases = await prisma.hostedUsageCreditPurchase.findMany({
    orderBy: { id: "asc" },
    where: buildHostedUsageCreditAccountDeletionScope(memberIds),
  });

  for (const listedPurchase of purchases) {
    assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership({
      memberIds,
      purchase: listedPurchase,
    });
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(listedPurchase)) {
      continue;
    }
    const purchase = await prepareHostedUsageCreditPurchaseForAccountDeletion({
      memberIds,
      prisma,
      purchase: listedPurchase,
    });
    assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership({
      memberIds,
      purchase,
    });
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(purchase)) {
      continue;
    }
    if (purchase.status === HostedUsageCreditPurchaseStatus.payment_pending) {
      if (!canCancelHostedUsageCreditDirectPayment(purchase)) {
        throw buildHostedUsageCreditAccountDeletionPaymentPendingError();
      }
      const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
      if (stripeLiveMode !== purchase.stripeLiveMode) {
        throw hostedOnboardingError({
          code: "HOSTED_USAGE_CREDIT_STRIPE_MODE_MISMATCH",
          httpStatus: 500,
          message: "Usage-credit checkout is temporarily unavailable.",
        });
      }
      const reconciledDirectPayment =
        await cancelHostedUsageCreditDirectPayment({
          ...(purchase.beneficiaryMemberId !== purchase.payerMemberId
            ? { groupBeneficiaryMemberId: purchase.beneficiaryMemberId }
            : {}),
          now,
          prisma,
          purchase,
          stripe,
        });
      if (isHostedUsageCreditPurchaseSafeForAccountDeletion(
        reconciledDirectPayment,
      )) {
        continue;
      }
      if (
        reconciledDirectPayment.status ===
        HostedUsageCreditPurchaseStatus.payment_pending
      ) {
        throw buildHostedUsageCreditAccountDeletionPaymentPendingError();
      }
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }

    const resolution = await resolveHostedUsageCreditStripeSessionForAccountDeletion({
      now,
      prisma,
      purchase,
    });
    const reconciled = resolution.kind === "session"
      ? await persistHostedUsageCreditAccountDeletionSessionState({
          now,
          prisma,
          purchase,
          session: resolution.session,
        })
      : await persistHostedUsageCreditAccountDeletionNoSessionProof({
          now,
          prisma,
          purchase,
        });
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(reconciled)) {
      continue;
    }
    if (reconciled.status === HostedUsageCreditPurchaseStatus.payment_pending) {
      throw buildHostedUsageCreditAccountDeletionPaymentPendingError();
    }
    throw buildHostedUsageCreditAccountDeletionUnresolvedError();
  }
}

export async function assertHostedUsageCreditPurchasesReadyForAccountDeletionTx(
  input: {
    memberIds: readonly string[];
    now?: Date;
    prisma?: HostedOnboardingReadClient;
  },
): Promise<void> {
  const memberIds = [...new Set(input.memberIds)].sort();
  if (memberIds.length === 0) {
    return;
  }

  const prisma = input.prisma ?? getPrisma();
  const purchases = await prisma.hostedUsageCreditPurchase.findMany({
    select: {
      beneficiaryMemberId: true,
      groupSponsorshipAuthorizationId: true,
      groupSponsorshipChargeOrdinal: true,
      grantSlotReleasedAt: true,
      id: true,
      lastReconciledAt: true,
      paidAt: true,
      payerMemberId: true,
      status: true,
      stripeChargeIdEncrypted: true,
      stripeChargeLookupKey: true,
      stripeCheckoutSessionIdEncrypted: true,
      stripeCheckoutSessionLookupKey: true,
      stripeCheckoutUrlEncrypted: true,
      stripeCustomerIdEncrypted: true,
      stripePaymentIntentIdEncrypted: true,
      stripePaymentIntentLookupKey: true,
      stripePriceIdEncrypted: true,
      terminalAt: true,
    },
    where: buildHostedUsageCreditAccountDeletionScope(memberIds),
  });
  let expectedDetachedCount = 0;
  for (const purchase of purchases) {
    assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership({
      memberIds,
      purchase,
    });
    if (!isHostedUsageCreditPurchaseSafeForAccountDeletion(purchase)) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    if (
      purchase.payerMemberId
      && memberIds.includes(purchase.payerMemberId)
      && !memberIds.includes(purchase.beneficiaryMemberId)
    ) {
      expectedDetachedCount += 1;
    }
  }

  const detached = await prisma.hostedUsageCreditPurchase.updateMany({
    data: {
      payerMemberId: null,
      reconciliationVersion: {
        increment: 1n,
      },
      stripeChargeIdEncrypted: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutUrlEncrypted: null,
      stripeCustomerIdEncrypted: null,
      stripePaymentIntentIdEncrypted: null,
      stripePriceIdEncrypted: null,
      updatedAt: input.now ?? new Date(),
    },
    where: {
      beneficiaryMemberId: { notIn: memberIds },
      payerMemberId: { in: memberIds },
      status: {
        in: [
          HostedUsageCreditPurchaseStatus.expired,
          HostedUsageCreditPurchaseStatus.fulfilled,
          HostedUsageCreditPurchaseStatus.payment_failed,
        ],
      },
    },
  });
  if (detached.count !== expectedDetachedCount) {
    throw buildHostedUsageCreditAccountDeletionUnresolvedError();
  }
}

async function resolveHostedUsageCreditStripeSessionForAccountDeletion(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<
  | { kind: "absent_after_expiry" }
  | { kind: "session"; session: Stripe.Checkout.Session }
> {
  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  if (stripeLiveMode !== input.purchase.stripeLiveMode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_STRIPE_MODE_MISMATCH",
      httpStatus: 500,
      message: "Usage-credit checkout is temporarily unavailable.",
    });
  }
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );

  const sessionId = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
    payerMemberId,
    prisma: input.prisma,
    value: input.purchase.stripeCheckoutSessionIdEncrypted,
  });
  let resolvedSessionId = sessionId;
  if (sessionId) {
    if (
      !hostedLookupKeyMatchesValue({
        expectedLookupKey: input.purchase.stripeCheckoutSessionLookupKey,
        kind: "stripe-checkout-session",
        normalizedValue: sessionId,
      })
    ) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
    }
  } else {
    if (input.purchase.stripeCheckoutSessionLookupKey) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
    }
    const checkoutRequest = await reconstructHostedUsageCreditStripeCheckoutRequest({
      prisma: input.prisma,
      purchase: input.purchase,
    });
    let replayedSession: Stripe.Checkout.Session | null = null;
    try {
      replayedSession = await stripe.checkout.sessions.create(checkoutRequest, {
        idempotencyKey: buildHostedUsageCreditCheckoutIdempotencyKey(input.purchase.id),
      });
    } catch (error) {
      if (
        input.now.getTime() >= input.purchase.checkoutExpiresAt.getTime() &&
        isDefinitiveHostedUsageCreditStripeRequestRejection(error)
      ) {
        // Expired-checkout recovery absorbs this rejection, so record it here.
        logHostedStripeFailure({
          error,
          operationName: "checkout.sessions.create.deletion-replay",
        });
        const matchedSession = await findHostedUsageCreditStripeSessionForExpiredAttempt({
          checkoutRequest,
          purchase: input.purchase,
          stripe,
        });
        if (!matchedSession) {
          return { kind: "absent_after_expiry" };
        }
        resolvedSessionId = matchedSession.id;
      } else {
        throw buildHostedUsageCreditStripeUnavailableError(
          error,
          "checkout.sessions.create.deletion-replay",
        );
      }
    }
    if (replayedSession) {
      assertHostedUsageCreditStripeSessionMatchesPurchase({
        purchase: input.purchase,
        session: replayedSession,
      });
      resolvedSessionId = replayedSession.id;
    }
  }

  if (!resolvedSessionId) {
    throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
  }
  return {
    kind: "session",
    session: await retrieveAndExpireHostedUsageCreditStripeSession({
      purchase: input.purchase,
      sessionId: resolvedSessionId,
      stripe,
    }),
  };
}

async function findHostedUsageCreditStripeSessionForExpiredAttempt(input: {
  checkoutRequest: Stripe.Checkout.SessionCreateParams;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<Stripe.Checkout.Session | null> {
  const customerId = coerceStripeObjectId(input.checkoutRequest.customer);
  if (!customerId) {
    throw buildHostedUsageCreditInvariantError("checkout_customer_missing");
  }

  let matchedSession: Stripe.Checkout.Session | null = null;
  let startingAfter: string | undefined;
  const seenPageBoundaries = new Set<string>();
  while (true) {
    let page: Stripe.ApiList<Stripe.Checkout.Session>;
    try {
      const listParams: Stripe.Checkout.SessionListParams = {
        created: {
          gte: Math.max(
            0,
            Math.floor(input.purchase.createdAt.getTime() / 1_000) - 1,
          ),
          lte: Math.floor(input.purchase.checkoutExpiresAt.getTime() / 1_000),
        },
        customer: customerId,
        limit: 100,
      };
      if (startingAfter) {
        listParams.starting_after = startingAfter;
      }
      page = await input.stripe.checkout.sessions.list(listParams);
    } catch (error) {
      throw buildHostedUsageCreditStripeUnavailableError(
        error,
        "checkout.sessions.list.deletion-recovery",
      );
    }

    for (const session of page.data) {
      if (
        session.client_reference_id !== input.purchase.id &&
        session.metadata?.purchaseId !== input.purchase.id
      ) {
        continue;
      }
      assertHostedUsageCreditStripeSessionMatchesPurchase({
        purchase: input.purchase,
        session,
      });
      if (matchedSession && matchedSession.id !== session.id) {
        throw buildHostedUsageCreditInvariantError("multiple_checkout_sessions");
      }
      matchedSession = session;
    }

    if (!page.has_more) {
      return matchedSession;
    }
    const pageBoundary = page.data.at(-1)?.id;
    if (!pageBoundary || seenPageBoundaries.has(pageBoundary)) {
      throw buildHostedUsageCreditInvariantError("checkout_session_list_invalid");
    }
    seenPageBoundaries.add(pageBoundary);
    startingAfter = pageBoundary;
  }
}

async function prepareHostedUsageCreditPurchaseForAccountDeletion(input: {
  memberIds: readonly string[];
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  return input.prisma.$transaction(async (tx) => {
    const ownedMemberIds = [
      input.purchase.beneficiaryMemberId,
      input.purchase.payerMemberId,
    ].filter(
      (memberId): memberId is string =>
        memberId !== null && input.memberIds.includes(memberId),
    );
    for (const memberId of [...new Set(ownedMemberIds)].sort()) {
      await lockHostedMemberRow(tx, memberId);
    }
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership({
      memberIds: input.memberIds,
      purchase: current,
    });
    const currentOwnedMemberIds = [
      current.beneficiaryMemberId,
      current.payerMemberId,
    ].filter(
      (memberId): memberId is string =>
        memberId !== null && input.memberIds.includes(memberId),
    );
    for (const memberId of [...new Set(currentOwnedMemberIds)]) {
      const member = await tx.hostedMember.findUnique({
        select: { suspendedAt: true },
        where: { id: memberId },
      });
      if (!member?.suspendedAt) {
        throw buildHostedUsageCreditAccountDeletionUnresolvedError();
      }
    }
    return current;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function persistHostedUsageCreditAccountDeletionSessionState(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  session: Stripe.Checkout.Session;
}): Promise<HostedUsageCreditPurchase> {
  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase: input.purchase,
    session: input.session,
  });
  const providerState = projectHostedUsageCreditStripeSessionState(input.session);
  if (providerState === "checkout_open") {
    throw buildHostedUsageCreditInvariantError("stripe_session_remained_open");
  }
  const sessionLookupKey = requireHostedUsageCreditLookupKey(
    createHostedStripeCheckoutSessionLookupKey(input.session.id),
    "checkout_session",
  );
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const [stripeCheckoutSessionIdEncrypted, stripeCheckoutUrlEncrypted] =
    await Promise.all([
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
        payerMemberId,
        prisma: input.prisma,
        value: input.session.id,
      }),
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutUrl,
        payerMemberId,
        prisma: input.prisma,
        value: null,
      }),
    ]);
  const nextStatus = providerState === "expired"
    ? HostedUsageCreditPurchaseStatus.expired
    : HostedUsageCreditPurchaseStatus.payment_pending;
  return input.prisma.$transaction(async (tx) => {
    if (providerState === "expired") {
      await lockHostedUsageCreditPurchaseReservationOwnersTx({
        beneficiaryMemberId: input.purchase.beneficiaryMemberId,
        payerMemberId,
        tx,
      });
    } else {
      await lockHostedMemberRow(tx, payerMemberId);
    }
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (
      !current ||
      current.payerMemberId !== payerMemberId ||
      current.beneficiaryMemberId !== input.purchase.beneficiaryMemberId
    ) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    if (
      current.grantSlotReleasedAt !== null &&
      (
        current.status !== HostedUsageCreditPurchaseStatus.expired ||
        current.paidAt !== null ||
        providerState !== "expired"
      )
    ) {
      throw buildHostedUsageCreditInvariantError(
        "checkout_release_state_invalid",
      );
    }
    const providerFinalReleaseRequired =
      providerState === "expired" &&
      current.grantSlotReleasedAt === null &&
      current.status !== HostedUsageCreditPurchaseStatus.fulfilled;
    if (
      isHostedUsageCreditPurchaseSafeForAccountDeletion(current) &&
      !providerFinalReleaseRequired
    ) {
      return current;
    }
    if (
      current.status === HostedUsageCreditPurchaseStatus.payment_pending &&
      !providerFinalReleaseRequired
    ) {
      return current;
    }
    if (current.reconciliationVersion !== input.purchase.reconciliationVersion) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    if (
      current.stripeCheckoutSessionIdEncrypted !==
        input.purchase.stripeCheckoutSessionIdEncrypted ||
      current.stripeCheckoutSessionLookupKey !==
        input.purchase.stripeCheckoutSessionLookupKey
    ) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_changed");
    }

    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        ...(providerState === "expired"
          ? { grantSlotReleasedAt: input.now }
          : {}),
        lastReconciledAt: input.now,
        reconciliationVersion: { increment: 1n },
        status: nextStatus,
        stripeCheckoutSessionIdEncrypted: requireHostedUsageCreditEncryptedValue(
          stripeCheckoutSessionIdEncrypted,
          "checkout_session",
        ),
        stripeCheckoutSessionLookupKey: sessionLookupKey,
        stripeCheckoutUrlEncrypted,
        terminalAt: providerState === "expired" ? input.now : null,
        updatedAt: input.now,
      },
      where: {
        id: current.id,
        ...(providerState === "expired"
          ? { grantSlotReleasedAt: null, paidAt: null }
          : {}),
        payerMemberId: current.payerMemberId,
        reconciliationVersion: input.purchase.reconciliationVersion,
        status: {
          in: [
            HostedUsageCreditPurchaseStatus.created,
            HostedUsageCreditPurchaseStatus.checkout_open,
            HostedUsageCreditPurchaseStatus.payment_pending,
            HostedUsageCreditPurchaseStatus.expired,
            HostedUsageCreditPurchaseStatus.payment_failed,
          ],
        },
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    const reconciled = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!reconciled) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    return reconciled;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function persistHostedUsageCreditAccountDeletionNoSessionProof(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  if (
    input.purchase.stripeCheckoutSessionIdEncrypted ||
    input.purchase.stripeCheckoutSessionLookupKey
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
  }

  return input.prisma.$transaction(async (tx) => {
    const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
      input.purchase,
    );
    await lockHostedUsageCreditPurchaseReservationOwnersTx({
      beneficiaryMemberId: input.purchase.beneficiaryMemberId,
      payerMemberId,
      tx,
    });
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (
      !current ||
      current.payerMemberId !== payerMemberId ||
      current.beneficiaryMemberId !== input.purchase.beneficiaryMemberId
    ) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(current)) {
      return current;
    }
    if (current.status === HostedUsageCreditPurchaseStatus.payment_pending) {
      return current;
    }
    if (
      current.reconciliationVersion !== input.purchase.reconciliationVersion ||
      current.stripeCheckoutSessionIdEncrypted !== null ||
      current.stripeCheckoutSessionLookupKey !== null
    ) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }

    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        grantSlotReleasedAt: input.now,
        lastReconciledAt: input.now,
        reconciliationVersion: { increment: 1n },
        status: HostedUsageCreditPurchaseStatus.expired,
        stripeCheckoutUrlEncrypted: null,
        terminalAt: input.now,
        updatedAt: input.now,
      },
      where: {
        id: current.id,
        grantSlotReleasedAt: null,
        paidAt: null,
        payerMemberId: current.payerMemberId,
        reconciliationVersion: input.purchase.reconciliationVersion,
        status: {
          in: [
            HostedUsageCreditPurchaseStatus.created,
            HostedUsageCreditPurchaseStatus.expired,
          ],
        },
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    const reconciled = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!reconciled) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    return reconciled;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function buildHostedUsageCreditAccountDeletionScope(
  memberIds: readonly string[],
): Prisma.HostedUsageCreditPurchaseWhereInput {
  return {
    OR: [
      { beneficiaryMemberId: { in: [...memberIds] } },
      { payerMemberId: { in: [...memberIds] } },
    ],
  };
}

function assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership(input: {
  memberIds: readonly string[];
  purchase: Pick<
    HostedUsageCreditPurchase,
    "beneficiaryMemberId" | "payerMemberId"
  >;
}): void {
  if (
    !input.memberIds.includes(input.purchase.beneficiaryMemberId)
    && (
      input.purchase.payerMemberId === null
      || !input.memberIds.includes(input.purchase.payerMemberId)
    )
  ) {
    throw buildHostedUsageCreditAccountDeletionUnresolvedError();
  }
}

function isHostedUsageCreditPurchaseSafeForAccountDeletion(input: Pick<
  HostedUsageCreditPurchase,
  | "groupSponsorshipAuthorizationId"
  | "groupSponsorshipChargeOrdinal"
  | "grantSlotReleasedAt"
  | "lastReconciledAt"
  | "paidAt"
  | "payerMemberId"
  | "status"
  | "stripeChargeIdEncrypted"
  | "stripeChargeLookupKey"
  | "stripeCheckoutSessionIdEncrypted"
  | "stripeCheckoutSessionLookupKey"
  | "stripeCheckoutUrlEncrypted"
  | "stripeCustomerIdEncrypted"
  | "stripePaymentIntentIdEncrypted"
  | "stripePaymentIntentLookupKey"
  | "stripePriceIdEncrypted"
  | "terminalAt"
>): boolean {
  if (!input.lastReconciledAt || !input.terminalAt) {
    return false;
  }

  const isTerminalUnboundAutomaticRefillFailure =
    input.status === HostedUsageCreditPurchaseStatus.payment_failed &&
    input.groupSponsorshipAuthorizationId !== null &&
    input.groupSponsorshipChargeOrdinal !== null &&
    input.groupSponsorshipChargeOrdinal > 0 &&
    input.paidAt === null &&
    input.stripeChargeIdEncrypted === null &&
    input.stripeChargeLookupKey === null &&
    input.stripeCheckoutSessionIdEncrypted === null &&
    input.stripeCheckoutSessionLookupKey === null &&
    input.stripeCheckoutUrlEncrypted === null &&
    input.stripePaymentIntentIdEncrypted === null &&
    input.stripePaymentIntentLookupKey === null;

  if (input.payerMemberId === null) {
    const privateReferencesCleared =
      input.stripeChargeIdEncrypted === null
      && input.stripeCheckoutSessionIdEncrypted === null
      && input.stripeCheckoutUrlEncrypted === null
      && input.stripeCustomerIdEncrypted === null
      && input.stripePaymentIntentIdEncrypted === null
      && input.stripePriceIdEncrypted === null;
    if (!privateReferencesCleared) {
      return false;
    }
    switch (input.status) {
      case HostedUsageCreditPurchaseStatus.expired:
        return input.grantSlotReleasedAt !== null && input.paidAt === null;
      case HostedUsageCreditPurchaseStatus.payment_failed:
        return isTerminalUnboundAutomaticRefillFailure ||
          input.stripeCheckoutSessionLookupKey !== null;
      case HostedUsageCreditPurchaseStatus.fulfilled:
        return Boolean(
          input.paidAt
          && input.stripeChargeLookupKey
          && input.stripePaymentIntentLookupKey,
        );
      case HostedUsageCreditPurchaseStatus.created:
      case HostedUsageCreditPurchaseStatus.checkout_open:
      case HostedUsageCreditPurchaseStatus.payment_pending:
        return false;
    }
  }

  const hasSessionProof = Boolean(
    input.stripeCheckoutSessionIdEncrypted &&
    input.stripeCheckoutSessionLookupKey,
  );
  const hasNoSessionProof =
    input.stripeCheckoutSessionIdEncrypted === null &&
    input.stripeCheckoutSessionLookupKey === null;
  if (!hasSessionProof && !hasNoSessionProof) {
    return false;
  }

  switch (input.status) {
    case HostedUsageCreditPurchaseStatus.expired:
      return input.grantSlotReleasedAt !== null && input.paidAt === null;
    case HostedUsageCreditPurchaseStatus.payment_failed:
      return hasSessionProof || isTerminalUnboundAutomaticRefillFailure;
    case HostedUsageCreditPurchaseStatus.fulfilled:
      return Boolean(
        (hasSessionProof || hasNoSessionProof) &&
        input.paidAt &&
        input.stripeChargeIdEncrypted &&
        input.stripeChargeLookupKey &&
        input.stripePaymentIntentIdEncrypted &&
        input.stripePaymentIntentLookupKey,
      );
    case HostedUsageCreditPurchaseStatus.created:
    case HostedUsageCreditPurchaseStatus.checkout_open:
    case HostedUsageCreditPurchaseStatus.payment_pending:
      return false;
  }
}

function buildHostedUsageCreditAccountDeletionPaymentPendingError() {
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_USAGE_CREDIT_PAYMENT_PENDING",
    httpStatus: 409,
    message: "A usage-credit payment is still processing. Retry account deletion after it settles.",
    retryable: true,
  });
}

function buildHostedUsageCreditAccountDeletionUnresolvedError() {
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_USAGE_CREDIT_UNRESOLVED",
    httpStatus: 503,
    message: "A usage-credit checkout could not be safely closed. Retry account deletion.",
    retryable: true,
  });
}
