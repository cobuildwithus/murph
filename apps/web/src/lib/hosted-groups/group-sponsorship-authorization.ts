import "server-only";

import { createHash } from "node:crypto";

import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
  Prisma,
  type HostedGroupSponsorshipAuthorization,
  type HostedUsageCreditPurchase,
  type PrismaClient,
} from "@prisma/client";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import {
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  getHostedUsageCreditOfferDefinition,
} from "../hosted-onboarding/usage-credit-offers";
import {
  readHostedUsageCreditGrantCapacityTx,
} from "../hosted-execution/usage-credit-grant-capacity";
import {
  lockHostedUsageCreditBeneficiaryTx,
  type LockedHostedUsageCreditBeneficiary,
} from "../hosted-execution/usage-credit-ledger";
import {
  hasHostedRuntimeActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import { generateHostedRandomPrefixedId } from "../primitives";
import { getPrisma } from "../prisma";
import type { HostedGroupUsageCapacityState } from "./group-usage-capacity";

export const HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR = [
  500,
  1_000,
  2_000,
] as const;

export type HostedGroupSponsorshipMonthlyCapMinor =
  (typeof HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR)[number];

export type HostedGroupSponsorshipManagementAction =
  | { action: "cancel"; authorizationId: string }
  | {
      action: "change_cap";
      authorizationId: string;
      confirmed: true;
      monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
    }
  | { action: "pause"; authorizationId: string }
  | { action: "recover"; authorizationId: string }
  | { action: "resume"; authorizationId: string };

export interface HostedGroupSponsorshipManagementProjection {
  authorizationId: string;
  chargedThisPeriodMinor: number;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
  pendingThisPeriodMinor: number;
  pendingMonthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor | null;
  periodEnd: string;
  status:
    | "active"
    | "paused"
    | "pending_activation"
    | "recovery_required";
}

export interface HostedGroupSponsorshipAuthorizationCreation {
  authorizationId: string;
  periodStartedAt: Date;
}

export interface HostedGroupSponsorshipRefillAdmission {
  authorizationId: string;
  purchaseId: string;
}

export type HostedGroupSponsorshipRecoveryPreparation =
  | { kind: "reactivated" }
  | { kind: "purchase"; purchaseId: string };

export interface HostedGroupSponsorshipPaymentAuthority {
  authorizationId: string;
  beneficiaryMemberId: string;
  chargeOrdinal: number;
  mode: "automatic" | "payer_recovery";
  periodStartedAt: Date;
}

const HOSTED_GROUP_SPONSORSHIP_REFILL_AMOUNT_MINOR = 500;
const HOSTED_GROUP_SPONSORSHIP_REFILL_OFFER_CODE = "usage_5_usd" as const;
const HOSTED_GROUP_SPONSORSHIP_PURCHASE_ID_DOMAIN =
  "murph.hosted-group-sponsorship-refill-purchase.v1";
const HOSTED_GROUP_SPONSORSHIP_REQUEST_KEY_DOMAIN =
  "murph.hosted-group-sponsorship-refill-request.v1";
const HOSTED_GROUP_SPONSORSHIP_AUTHORIZATION_ID_PATTERN =
  /^hgsa_[A-Za-z0-9_-]{16}$/u;

const COMMITTED_PURCHASE_STATUSES = [
  HostedUsageCreditPurchaseStatus.created,
  HostedUsageCreditPurchaseStatus.checkout_open,
  HostedUsageCreditPurchaseStatus.payment_pending,
  HostedUsageCreditPurchaseStatus.fulfilled,
] as const;

const PENDING_PURCHASE_STATUSES = [
  HostedUsageCreditPurchaseStatus.created,
  HostedUsageCreditPurchaseStatus.checkout_open,
  HostedUsageCreditPurchaseStatus.payment_pending,
] as const;

const LIVE_AUTHORIZATION_STATUSES = [
  HostedGroupSponsorshipAuthorizationStatus.pending_activation,
  HostedGroupSponsorshipAuthorizationStatus.active,
  HostedGroupSponsorshipAuthorizationStatus.paused,
  HostedGroupSponsorshipAuthorizationStatus.recovery_required,
] as const;

type HostedGroupSponsorshipPeriodState = Pick<
  HostedGroupSponsorshipAuthorization,
  | "anchorDay"
  | "anchorEndOfMonth"
  | "monthlyCapMinor"
  | "pendingMonthlyCapMinor"
  | "periodEndsAt"
  | "periodStartedAt"
>;

type HostedGroupSponsorshipRefillAccounting = Pick<
  HostedUsageCreditPurchase,
  "cashAmountMinor" | "groupSponsorshipChargeOrdinal" | "status"
>;

type HostedGroupSponsorshipRefillAuthority = Pick<
  HostedUsageCreditPurchase,
  | "offerCode"
  | "payerMemberId"
  | "status"
  | "stripeCustomerIdEncrypted"
  | "stripePriceIdEncrypted"
>;

export function parseHostedGroupSponsorshipMonthlyCapMinor(
  value: unknown,
): HostedGroupSponsorshipMonthlyCapMinor | null {
  return typeof value === "number" &&
      Number.isInteger(value) &&
      HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR.includes(
        value as HostedGroupSponsorshipMonthlyCapMinor,
      )
    ? value as HostedGroupSponsorshipMonthlyCapMinor
    : null;
}

export function parseHostedGroupSponsorshipManagementAction(
  value: Record<string, unknown>,
): HostedGroupSponsorshipManagementAction {
  const action = value.action;
  const authorizationId = parseHostedGroupSponsorshipAuthorizationId(
    value.authorizationId,
  );
  if (
    action === "cancel" ||
    action === "pause" ||
    action === "recover" ||
    action === "resume"
  ) {
    if (
      Object.keys(value).sort().join("\0") !==
        ["action", "authorizationId"].sort().join("\0") ||
      authorizationId === null
    ) {
      throw invalidManagementRequest();
    }
    return { action, authorizationId };
  }
  if (action === "change_cap") {
    const monthlyCapMinor = parseHostedGroupSponsorshipMonthlyCapMinor(
      value.monthlyCapMinor,
    );
    if (
      Object.keys(value).sort().join("\0") !==
        [
          "action",
          "authorizationId",
          "confirmed",
          "monthlyCapMinor",
        ].sort().join("\0") ||
      authorizationId === null ||
      value.confirmed !== true ||
      monthlyCapMinor === null
    ) {
      throw invalidManagementRequest();
    }
    return { action, authorizationId, confirmed: true, monthlyCapMinor };
  }
  throw invalidManagementRequest();
}

export async function createHostedGroupSponsorshipAuthorizationTx(input: {
  beneficiaryMemberId: string;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
  now: Date;
  payerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSponsorshipAuthorizationCreation> {
  const monthlyCapMinor = parseHostedGroupSponsorshipMonthlyCapMinor(
    input.monthlyCapMinor,
  );
  if (monthlyCapMinor === null) {
    throw invalidMonthlyCap();
  }
  const periodStartedAt = requireValidDate(input.now);
  const periodEndsAt = addHostedGroupSponsorshipCalendarMonth({
    anchorDay: periodStartedAt.getUTCDate(),
    anchorEndOfMonth: isUtcMonthEnd(periodStartedAt),
    date: periodStartedAt,
  });
  // The purchase owner calls this only after locking the beneficiary member,
  // which is also the ledger and fulfillment serialization boundary.
  const current = await readLiveHostedGroupSponsorshipAuthorizationTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  const payerMemberIds = [
    ...new Set(
      [current?.payerMemberId, input.payerMemberId].filter(
        (memberId): memberId is string =>
          memberId !== null && memberId !== undefined,
      ),
    ),
  ].sort();
  for (const payerMemberId of payerMemberIds) {
    await lockHostedMemberRow(input.tx, payerMemberId);
  }
  if (current) {
    let normalized = await normalizeHostedGroupSponsorshipAuthorizationTx({
      authorization: current,
      now: periodStartedAt,
      tx: input.tx,
    });
    if (
      normalized.status ===
        HostedGroupSponsorshipAuthorizationStatus.pending_activation &&
      normalized.payerMemberId !== null &&
      await expireUnattachedHostedGroupSponsorshipActivationTx({
        authorizationId: normalized.id,
        beneficiaryMemberId: input.beneficiaryMemberId,
        now: periodStartedAt,
        payerMemberId: normalized.payerMemberId,
        tx: input.tx,
      })
    ) {
      normalized = await normalizeHostedGroupSponsorshipAuthorizationTx({
        authorization: normalized,
        now: periodStartedAt,
        tx: input.tx,
      });
    }
    if (
      normalized.status !== HostedGroupSponsorshipAuthorizationStatus.canceled
    ) {
      throw groupSponsorshipAlreadyActive();
    }
  }
  const authorizationId = generateHostedRandomPrefixedId("hgsa");

  try {
    await input.tx.hostedGroupSponsorshipAuthorization.create({
      data: {
        anchorDay: periodStartedAt.getUTCDate(),
        anchorEndOfMonth: isUtcMonthEnd(periodStartedAt),
        beneficiaryMemberId: input.beneficiaryMemberId,
        createdAt: periodStartedAt,
        id: authorizationId,
        monthlyCapMinor,
        payerMemberId: input.payerMemberId,
        periodEndsAt,
        periodStartedAt,
        status: HostedGroupSponsorshipAuthorizationStatus.pending_activation,
        updatedAt: periodStartedAt,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw groupSponsorshipAlreadyActive();
    }
    throw error;
  }

  return { authorizationId, periodStartedAt };
}

export async function activateHostedGroupSponsorshipAuthorizationForPurchaseTx(
  input: {
    paidAt: Date;
    purchaseId: string;
    tx: Prisma.TransactionClient;
  },
): Promise<boolean> {
  const paidAt = requireValidDate(input.paidAt);
  const purchase = await input.tx.hostedUsageCreditPurchase.findUnique({
    select: {
      groupSponsorshipAuthorizationId: true,
      groupSponsorshipChargeOrdinal: true,
      groupSponsorshipPeriodStartedAt: true,
    },
    where: { id: input.purchaseId },
  });
  if (!purchase?.groupSponsorshipAuthorizationId) {
    return false;
  }
  if (
    purchase.groupSponsorshipChargeOrdinal === null ||
    purchase.groupSponsorshipPeriodStartedAt === null
  ) {
    throw new TypeError(
      "Hosted group sponsorship purchase association is incomplete.",
    );
  }

  const authorization = await input.tx.hostedGroupSponsorshipAuthorization.findUnique({
    where: { id: purchase.groupSponsorshipAuthorizationId },
  });
  if (!authorization) {
    throw new TypeError("Hosted group sponsorship authorization is missing.");
  }

  const canActivate =
    purchase.groupSponsorshipChargeOrdinal === 0 &&
    authorization.status ===
      HostedGroupSponsorshipAuthorizationStatus.pending_activation;
  const canRecover =
    purchase.groupSponsorshipChargeOrdinal > 0 &&
    purchase.groupSponsorshipPeriodStartedAt.getTime() ===
      authorization.periodStartedAt.getTime() &&
    authorization.status ===
      HostedGroupSponsorshipAuthorizationStatus.recovery_required;
  if (!canActivate && !canRecover) {
    return false;
  }

  if (canActivate) {
    const periodStartedAt = paidAt;
    const periodEndsAt = addHostedGroupSponsorshipCalendarMonth({
      anchorDay: periodStartedAt.getUTCDate(),
      anchorEndOfMonth: isUtcMonthEnd(periodStartedAt),
      date: periodStartedAt,
    });
    const purchaseUpdated = await input.tx.hostedUsageCreditPurchase.updateMany({
      data: { groupSponsorshipPeriodStartedAt: periodStartedAt },
      where: {
        groupSponsorshipAuthorizationId: authorization.id,
        groupSponsorshipChargeOrdinal: 0,
        groupSponsorshipPeriodStartedAt:
          purchase.groupSponsorshipPeriodStartedAt,
        id: input.purchaseId,
      },
    });
    if (purchaseUpdated.count !== 1) {
      throw new TypeError(
        "Hosted group sponsorship activation purchase lost its period anchor.",
      );
    }
    const updated = await input.tx.hostedGroupSponsorshipAuthorization.updateMany({
      data: {
        anchorDay: periodStartedAt.getUTCDate(),
        anchorEndOfMonth: isUtcMonthEnd(periodStartedAt),
        periodEndsAt,
        periodStartedAt,
        recoveryStartedAt: null,
        status: HostedGroupSponsorshipAuthorizationStatus.active,
        updatedAt: paidAt,
      },
      where: {
        id: authorization.id,
        status: HostedGroupSponsorshipAuthorizationStatus.pending_activation,
        updatedAt: authorization.updatedAt,
      },
    });
    if (updated.count !== 1) {
      throw new TypeError(
        "Hosted group sponsorship activation lost its authorization.",
      );
    }
    return true;
  }

  const updated = await input.tx.hostedGroupSponsorshipAuthorization.updateMany({
    data: {
      recoveryStartedAt: null,
      status: HostedGroupSponsorshipAuthorizationStatus.active,
      updatedAt: paidAt,
    },
    where: {
      id: authorization.id,
      status: HostedGroupSponsorshipAuthorizationStatus.recovery_required,
      updatedAt: authorization.updatedAt,
    },
  });
  if (updated.count !== 1) {
    throw new TypeError(
      "Hosted group sponsorship recovery lost its authorization.",
    );
  }
  return true;
}

async function expireUnattachedHostedGroupSponsorshipActivationTx(
  input: {
    authorizationId: string;
    beneficiaryMemberId: string;
    now: Date;
    payerMemberId: string;
    tx: Prisma.TransactionClient;
  },
): Promise<boolean> {
  const unboundExpiredPurchase = {
    beneficiaryMemberId: input.beneficiaryMemberId,
    checkoutExpiresAt: { lte: input.now },
    groupSponsorshipAuthorizationId: input.authorizationId,
    groupSponsorshipChargeOrdinal: 0,
    paidAt: null,
    payerMemberId: input.payerMemberId,
    status: HostedUsageCreditPurchaseStatus.created,
    stripeChargeIdEncrypted: null,
    stripeChargeLookupKey: null,
    stripeCheckoutSessionIdEncrypted: null,
    stripeCheckoutSessionLookupKey: null,
    stripeCheckoutUrlEncrypted: null,
    stripePaymentIntentIdEncrypted: null,
    stripePaymentIntentLookupKey: null,
    terminalAt: null,
  } satisfies Prisma.HostedUsageCreditPurchaseWhereInput;
  const purchase = await input.tx.hostedUsageCreditPurchase.findFirst({
    select: {
      id: true,
      reconciliationVersion: true,
    },
    where: unboundExpiredPurchase,
  });
  if (!purchase) {
    return false;
  }

  const expired = await input.tx.hostedUsageCreditPurchase.updateMany({
    data: {
      reconciliationVersion: { increment: 1n },
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: input.now,
      updatedAt: input.now,
    },
    where: {
      ...unboundExpiredPurchase,
      id: purchase.id,
      reconciliationVersion: purchase.reconciliationVersion,
    },
  });
  if (expired.count !== 1) {
    return false;
  }

  return true;
}

export async function readHostedGroupSponsorshipManagementProjection(input: {
  beneficiaryMemberId: string;
  now?: Date;
  payerMemberId: string;
  prisma?: PrismaClient;
}): Promise<HostedGroupSponsorshipManagementProjection | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = requireValidDate(input.now ?? new Date());
  return prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.beneficiaryMemberId);
    await lockHostedMemberRow(tx, input.payerMemberId);
    const authorization = await readLiveHostedGroupSponsorshipAuthorizationTx({
      beneficiaryMemberId: input.beneficiaryMemberId,
      tx,
    });
    if (!authorization || authorization.payerMemberId !== input.payerMemberId) {
      return null;
    }
    const normalized = await normalizeHostedGroupSponsorshipAuthorizationTx({
      authorization,
      now,
      tx,
    });
    if (
      normalized.status === HostedGroupSponsorshipAuthorizationStatus.canceled ||
      normalized.payerMemberId !== input.payerMemberId
    ) {
      return null;
    }
    return projectHostedGroupSponsorshipAuthorizationTx({
      authorization: normalized,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function manageHostedGroupSponsorshipAuthorization(input: {
  action: HostedGroupSponsorshipManagementAction;
  beneficiaryMemberId: string;
  now?: Date;
  payerMemberId: string;
  prisma: PrismaClient;
}): Promise<HostedGroupSponsorshipManagementProjection | null> {
  const now = requireValidDate(input.now ?? new Date());
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.beneficiaryMemberId);
    await lockHostedMemberRow(tx, input.payerMemberId);
    const current = await readLiveHostedGroupSponsorshipAuthorizationTx({
      beneficiaryMemberId: input.beneficiaryMemberId,
      tx,
    });
    if (!current && input.action.action === "cancel") {
      const canceled = await tx.hostedGroupSponsorshipAuthorization.findUnique({
        where: { id: input.action.authorizationId },
      });
      if (
        canceled?.beneficiaryMemberId === input.beneficiaryMemberId &&
        canceled.payerMemberId === input.payerMemberId &&
        canceled.status === HostedGroupSponsorshipAuthorizationStatus.canceled
      ) {
        return null;
      }
    }
    if (!current || current.payerMemberId !== input.payerMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_SPONSORSHIP_NOT_FOUND",
        httpStatus: 404,
        message: "This monthly sponsorship is not available to this account.",
      });
    }
    if (current.id !== input.action.authorizationId) {
      throw invalidManagementState();
    }
    const authorization = await normalizeHostedGroupSponsorshipAuthorizationTx({
      authorization: current,
      now,
      tx,
    });
    if (
      authorization.status === HostedGroupSponsorshipAuthorizationStatus.canceled ||
      authorization.payerMemberId !== input.payerMemberId
    ) {
      return null;
    }

    if (input.action.action === "cancel") {
      await updateAuthorizationStateTx({
        authorization,
        data: {
          canceledAt: now,
          recoveryStartedAt: null,
          status: HostedGroupSponsorshipAuthorizationStatus.canceled,
          updatedAt: now,
        },
        tx,
      });
      return null;
    }

    if (input.action.action === "pause") {
      if (
        authorization.status === HostedGroupSponsorshipAuthorizationStatus.paused
      ) {
        return projectHostedGroupSponsorshipAuthorizationTx({
          authorization,
          tx,
        });
      }
      if (
        authorization.status !== HostedGroupSponsorshipAuthorizationStatus.active
      ) {
        throw invalidManagementState();
      }
      const paused = await updateAuthorizationStateTx({
        authorization,
        data: {
          status: HostedGroupSponsorshipAuthorizationStatus.paused,
          updatedAt: now,
        },
        tx,
      });
      return projectHostedGroupSponsorshipAuthorizationTx({
        authorization: paused,
        tx,
      });
    }

    if (input.action.action === "resume") {
      if (
        authorization.status !== HostedGroupSponsorshipAuthorizationStatus.paused
      ) {
        throw invalidManagementState();
      }
      const resumed = await updateAuthorizationStateTx({
        authorization,
        data: {
          recoveryStartedAt: null,
          status: HostedGroupSponsorshipAuthorizationStatus.active,
          updatedAt: now,
        },
        tx,
      });
      return projectHostedGroupSponsorshipAuthorizationTx({
        authorization: resumed,
        tx,
      });
    }

    if (input.action.action === "recover") {
      // The authenticated recovery route either resumes without a charge when
      // no charge is admissible or reuses the exact failed purchase. Only
      // Stripe-event reconciliation may reactivate a payment-backed recovery.
      throw invalidManagementState();
    }

    if (
      authorization.status ===
      HostedGroupSponsorshipAuthorizationStatus.pending_activation
    ) {
      throw invalidManagementState();
    }
    const monthlyCapMinor = input.action.monthlyCapMinor;
    const committedThisPeriodMinor =
      await readHostedGroupSponsorshipCommittedMinorTx({
        authorization,
        tx,
      });
    const shouldDeferDecrease =
      monthlyCapMinor < authorization.monthlyCapMinor &&
      monthlyCapMinor < committedThisPeriodMinor;
    const changed = await updateAuthorizationStateTx({
      authorization,
      data: shouldDeferDecrease
        ? {
            pendingMonthlyCapMinor: monthlyCapMinor,
            updatedAt: now,
          }
        : {
            monthlyCapMinor,
            pendingMonthlyCapMinor: null,
            updatedAt: now,
          },
      tx,
    });
    return projectHostedGroupSponsorshipAuthorizationTx({
      authorization: changed,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function admitHostedGroupSponsorshipRefillTx(input: {
  beneficiaryMemberId: string;
  capacityState: HostedGroupUsageCapacityState;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSponsorshipRefillAdmission | null> {
  if (input.capacityState === "healthy") {
    return null;
  }
  const now = requireValidDate(input.now);
  const lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  const current = await readLiveHostedGroupSponsorshipAuthorizationTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  if (!current) {
    return null;
  }
  const authorization = await normalizeHostedGroupSponsorshipAuthorizationTx({
    authorization: current,
    now,
    tx: input.tx,
  });
  if (
    authorization.status !== HostedGroupSponsorshipAuthorizationStatus.active ||
    !authorization.payerMemberId
  ) {
    return null;
  }
  if (
    authorization.payerMemberId !== lockedBeneficiary.beneficiaryMemberId
  ) {
    await lockHostedMemberRow(input.tx, authorization.payerMemberId);
  }

  const purchaseId = await readOrCreateHostedGroupSponsorshipRefillPurchaseTx({
    authorization,
    checkoutExpiresAt: authorization.periodEndsAt,
    lockedBeneficiary,
    now,
    tx: input.tx,
  });
  return purchaseId
    ? { authorizationId: authorization.id, purchaseId }
    : null;
}

export async function prepareHostedGroupSponsorshipRecoveryTx(input: {
  authorizationId: string;
  beneficiaryMemberId: string;
  capacityState: HostedGroupUsageCapacityState;
  checkoutExpiresAt: Date;
  now: Date;
  payerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSponsorshipRecoveryPreparation> {
  const now = requireValidDate(input.now);
  const checkoutExpiresAt = requireValidDate(input.checkoutExpiresAt);
  const lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  const current = await readLiveHostedGroupSponsorshipAuthorizationTx({
    beneficiaryMemberId: input.beneficiaryMemberId,
    tx: input.tx,
  });
  if (
    !current ||
    current.id !== input.authorizationId ||
    current.payerMemberId !== input.payerMemberId
  ) {
    throw recoveryUnavailable();
  }
  if (input.payerMemberId !== lockedBeneficiary.beneficiaryMemberId) {
    await lockHostedMemberRow(input.tx, input.payerMemberId);
  }
  let authorization = await normalizeHostedGroupSponsorshipAuthorizationTx({
    authorization: current,
    now,
    tx: input.tx,
  });
  const boundedCheckoutExpiresAt = new Date(Math.min(
    checkoutExpiresAt.getTime(),
    authorization.periodEndsAt.getTime(),
  ));
  if (boundedCheckoutExpiresAt.getTime() <= now.getTime()) {
    throw recoveryUnavailable();
  }
  if (
    authorization.status !==
      HostedGroupSponsorshipAuthorizationStatus.recovery_required ||
    authorization.payerMemberId !== input.payerMemberId
  ) {
    throw recoveryUnavailable();
  }
  const reactivateWithoutCharge = async () => {
    authorization = await updateAuthorizationStateTx({
      authorization,
      data: {
        recoveryStartedAt: null,
        status: HostedGroupSponsorshipAuthorizationStatus.active,
        updatedAt: now,
      },
      tx: input.tx,
    });
    if (authorization.status !== HostedGroupSponsorshipAuthorizationStatus.active) {
      throw recoveryUnavailable();
    }
    return { kind: "reactivated" } as const;
  };

  // Explicit recovery should not create an unnecessary charge if another
  // contribution restored capacity while the sponsorship was blocked.
  if (input.capacityState === "healthy") {
    return reactivateWithoutCharge();
  }

  const failed = await input.tx.hostedUsageCreditPurchase.findFirst({
    orderBy: { groupSponsorshipChargeOrdinal: "desc" },
    where: {
      groupSponsorshipAuthorizationId: authorization.id,
      groupSponsorshipChargeOrdinal: { gt: 0 },
      groupSponsorshipPeriodStartedAt: authorization.periodStartedAt,
      payerMemberId: input.payerMemberId,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
    },
  });
  if (failed) {
    if (
      failed.stripeCheckoutSessionLookupKey ||
      failed.stripePaymentIntentLookupKey
    ) {
      throw recoveryUnavailable();
    }
    const committedMinor = await readHostedGroupSponsorshipCommittedMinorTx({
      authorization,
      tx: input.tx,
    });
    if (
      committedMinor + failed.cashAmountMinor >
      authorization.monthlyCapMinor
    ) {
      return reactivateWithoutCharge();
    }
    const capacity = await readHostedUsageCreditGrantCapacityTx({
      ...(failed.grantSlotReleasedAt === null
        ? { expectedPurchaseId: failed.id }
        : {}),
      lockedBeneficiary,
      tx: input.tx,
    });
    if (capacity.state === "overflow") {
      throw new TypeError(
        "Hosted group sponsorship usage-credit capacity exceeds its contract.",
      );
    }
    if (
      failed.grantSlotReleasedAt === null &&
      !capacity.expectedPurchaseOwnsReservation
    ) {
      throw new TypeError(
        "Hosted group sponsorship refill purchase reservation is missing.",
      );
    }
    if (
      failed.grantSlotReleasedAt !== null &&
      capacity.state !== "available"
    ) {
      throw recoveryUnavailable();
    }
    const returnUrls = buildHostedGroupSponsorshipRefillReturnUrls({
      checkoutCancelUrl: failed.checkoutCancelUrl,
      checkoutSuccessUrl: failed.checkoutSuccessUrl,
      purchaseId: failed.id,
    });
    const reset = await input.tx.hostedUsageCreditPurchase.updateMany({
      data: {
        checkoutExpiresAt: boundedCheckoutExpiresAt,
        checkoutRequestPolicyVersion:
          HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
        ...returnUrls,
        grantSlotReleasedAt: null,
        lastReconciledAt: null,
        reconciliationVersion: { increment: 1n },
        status: HostedUsageCreditPurchaseStatus.created,
        terminalAt: null,
        updatedAt: now,
      },
      where: {
        id: failed.id,
        grantSlotReleasedAt: failed.grantSlotReleasedAt,
        reconciliationVersion: failed.reconciliationVersion,
        status: HostedUsageCreditPurchaseStatus.payment_failed,
        stripeCheckoutSessionLookupKey: null,
        stripePaymentIntentLookupKey: null,
      },
    });
    if (reset.count !== 1) {
      throw recoveryUnavailable();
    }
    return { kind: "purchase", purchaseId: failed.id };
  }

  // A failure can remain recovery-blocked across a calendar rollover. In that
  // case the old failed purchase stays immutable history and the payer's
  // explicit recovery creates the first deterministic $5 purchase in the new
  // period, subject to the new period's cap headroom.
  const purchaseId = await readOrCreateHostedGroupSponsorshipRefillPurchaseTx({
    authorization,
    checkoutExpiresAt: boundedCheckoutExpiresAt,
    lockedBeneficiary,
    now,
    tx: input.tx,
  });
  if (!purchaseId) {
    throw recoveryUnavailable();
  }
  return { kind: "purchase", purchaseId };
}

async function readOrCreateHostedGroupSponsorshipRefillPurchaseTx(input: {
  authorization: HostedGroupSponsorshipAuthorization;
  checkoutExpiresAt: Date;
  lockedBeneficiary: LockedHostedUsageCreditBeneficiary;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<string | null> {
  const { authorization } = input;
  const payerMemberId = authorization.payerMemberId;
  if (!payerMemberId) {
    throw new TypeError(
      "Hosted group sponsorship refill has no payer authorization.",
    );
  }
  const purchases = await input.tx.hostedUsageCreditPurchase.findMany({
    orderBy: { groupSponsorshipChargeOrdinal: "asc" },
    select: {
      cashAmountMinor: true,
      checkoutCancelUrl: true,
      checkoutSuccessUrl: true,
      groupSponsorshipChargeOrdinal: true,
      id: true,
      reconciliationVersion: true,
      status: true,
    },
    where: {
      groupSponsorshipAuthorizationId: authorization.id,
      groupSponsorshipPeriodStartedAt: authorization.periodStartedAt,
    },
  });
  const pendingAutomatic = purchases.find(
    isHostedGroupSponsorshipRefillPending,
  );
  if (pendingAutomatic) {
    const capacity = await readHostedUsageCreditGrantCapacityTx({
      expectedPurchaseId: pendingAutomatic.id,
      lockedBeneficiary: input.lockedBeneficiary,
      tx: input.tx,
    });
    if (capacity.state === "overflow") {
      throw new TypeError(
        "Hosted group sponsorship usage-credit capacity exceeds its contract.",
      );
    }
    if (!capacity.expectedPurchaseOwnsReservation) {
      throw new TypeError(
        "Hosted group sponsorship refill purchase reservation is missing.",
      );
    }
    if (pendingAutomatic.status === HostedUsageCreditPurchaseStatus.created) {
      await normalizeHostedGroupSponsorshipRefillReturnUrlsTx({
        now: input.now,
        purchase: pendingAutomatic,
        tx: input.tx,
      });
    }
    return pendingAutomatic.id;
  }

  const chargeOrdinal = projectHostedGroupSponsorshipNextRefillChargeOrdinal({
    monthlyCapMinor: authorization.monthlyCapMinor,
    purchases,
  });
  if (chargeOrdinal === null) {
    return null;
  }

  const activationPurchase =
    await input.tx.hostedUsageCreditPurchase.findFirst({
      select: {
        checkoutCancelUrl: true,
        checkoutSuccessUrl: true,
        offerCode: true,
        payerMemberId: true,
        status: true,
        stripeCustomerIdEncrypted: true,
        stripeCustomerLookupKey: true,
        stripeLiveMode: true,
        stripePriceIdEncrypted: true,
        stripePriceLookupKey: true,
      },
      where: {
        groupSponsorshipAuthorizationId: authorization.id,
        groupSponsorshipChargeOrdinal: 0,
      },
    });
  if (
    !activationPurchase ||
    !hasHostedGroupSponsorshipRefillPaymentAuthority({
      activationPurchase,
      payerMemberId,
    })
  ) {
    throw new TypeError(
      "Hosted group sponsorship refill lacks a fulfilled activation purchase.",
    );
  }

  const purchaseId = buildHostedGroupSponsorshipRefillPurchaseId({
    authorizationId: authorization.id,
    chargeOrdinal,
    periodStartedAt: authorization.periodStartedAt,
  });
  const offer = getHostedUsageCreditOfferDefinition(
    HOSTED_GROUP_SPONSORSHIP_REFILL_OFFER_CODE,
  );
  const returnUrls = buildHostedGroupSponsorshipRefillReturnUrls({
    checkoutCancelUrl: activationPurchase.checkoutCancelUrl,
    checkoutSuccessUrl: activationPurchase.checkoutSuccessUrl,
    purchaseId,
  });
  const capacity = await readHostedUsageCreditGrantCapacityTx({
    lockedBeneficiary: input.lockedBeneficiary,
    tx: input.tx,
  });
  if (capacity.state === "overflow") {
    throw new TypeError(
      "Hosted group sponsorship usage-credit capacity exceeds its contract.",
    );
  }
  if (capacity.state === "at_capacity") {
    return null;
  }

  try {
    await input.tx.hostedUsageCreditPurchase.create({
      data: {
        beneficiaryMemberId: authorization.beneficiaryMemberId,
        cashAmountMinor: offer.cashAmountMinor,
        cashCurrency: offer.cashCurrency,
        checkoutCancelUrl: returnUrls.checkoutCancelUrl,
        checkoutExpiresAt: input.checkoutExpiresAt,
        checkoutRequestPolicyVersion:
          HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
        checkoutSuccessUrl: returnUrls.checkoutSuccessUrl,
        clientRequestKey: buildHostedGroupSponsorshipRefillRequestKey({
          authorizationId: authorization.id,
          chargeOrdinal,
          periodStartedAt: authorization.periodStartedAt,
        }),
        createdAt: input.now,
        grantSlotReleasedAt: null,
        grantUsdMicros: offer.grantUsdMicros,
        groupSponsorshipAuthorizationId: authorization.id,
        groupSponsorshipChargeOrdinal: chargeOrdinal,
        groupSponsorshipPeriodStartedAt: authorization.periodStartedAt,
        id: purchaseId,
        offerCode: offer.code,
        payerMemberId,
        status: HostedUsageCreditPurchaseStatus.created,
        stripeCustomerIdEncrypted:
          activationPurchase.stripeCustomerIdEncrypted,
        stripeCustomerLookupKey: activationPurchase.stripeCustomerLookupKey,
        stripeLiveMode: activationPurchase.stripeLiveMode,
        stripePriceIdEncrypted: activationPurchase.stripePriceIdEncrypted,
        stripePriceLookupKey: activationPurchase.stripePriceLookupKey,
        updatedAt: input.now,
      },
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }
    const existing = await input.tx.hostedUsageCreditPurchase.findUnique({
      select: { id: true },
      where: {
        groupSponsorshipAuthorizationId_groupSponsorshipPeriodStartedAt_groupSponsorshipChargeOrdinal:
          {
            groupSponsorshipAuthorizationId: authorization.id,
            groupSponsorshipChargeOrdinal: chargeOrdinal,
            groupSponsorshipPeriodStartedAt: authorization.periodStartedAt,
          },
      },
    });
    if (!existing || existing.id !== purchaseId) {
      throw error;
    }
    const existingCapacity = await readHostedUsageCreditGrantCapacityTx({
      expectedPurchaseId: purchaseId,
      lockedBeneficiary: input.lockedBeneficiary,
      tx: input.tx,
    });
    if (existingCapacity.state === "overflow") {
      throw new TypeError(
        "Hosted group sponsorship usage-credit capacity exceeds its contract.",
      );
    }
    if (!existingCapacity.expectedPurchaseOwnsReservation) {
      throw new TypeError(
        "Hosted group sponsorship refill purchase reservation is missing.",
      );
    }
  }

  return purchaseId;
}

function buildHostedGroupSponsorshipRefillReturnUrls(input: {
  checkoutCancelUrl: string;
  checkoutSuccessUrl: string;
  purchaseId: string;
}): { checkoutCancelUrl: string; checkoutSuccessUrl: string } {
  return {
    checkoutCancelUrl: rebindHostedGroupSponsorshipRefillReturnUrl({
      outcome: "cancel",
      purchaseId: input.purchaseId,
      value: input.checkoutCancelUrl,
    }),
    checkoutSuccessUrl: rebindHostedGroupSponsorshipRefillReturnUrl({
      outcome: "success",
      purchaseId: input.purchaseId,
      value: input.checkoutSuccessUrl,
    }),
  };
}

function rebindHostedGroupSponsorshipRefillReturnUrl(input: {
  outcome: "cancel" | "success";
  purchaseId: string;
  value: string;
}): string {
  let url: URL;
  try {
    url = new URL(input.value);
  } catch {
    throw new TypeError(
      "Hosted group sponsorship refill has an invalid return URL.",
    );
  }
  if (
    url.searchParams.get("usageCheckout") !== input.outcome ||
    !url.searchParams.has("usagePurchase")
  ) {
    throw new TypeError(
      "Hosted group sponsorship refill has an invalid return URL.",
    );
  }
  url.searchParams.set("usagePurchase", input.purchaseId);
  return url.toString();
}

async function normalizeHostedGroupSponsorshipRefillReturnUrlsTx(input: {
  now: Date;
  purchase: {
    checkoutCancelUrl: string;
    checkoutSuccessUrl: string;
    id: string;
    reconciliationVersion: bigint;
  };
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const returnUrls = buildHostedGroupSponsorshipRefillReturnUrls({
    checkoutCancelUrl: input.purchase.checkoutCancelUrl,
    checkoutSuccessUrl: input.purchase.checkoutSuccessUrl,
    purchaseId: input.purchase.id,
  });
  if (
    returnUrls.checkoutCancelUrl === input.purchase.checkoutCancelUrl &&
    returnUrls.checkoutSuccessUrl === input.purchase.checkoutSuccessUrl
  ) {
    return;
  }
  const updated = await input.tx.hostedUsageCreditPurchase.updateMany({
    data: {
      ...returnUrls,
      reconciliationVersion: { increment: 1n },
      updatedAt: input.now,
    },
    where: {
      id: input.purchase.id,
      reconciliationVersion: input.purchase.reconciliationVersion,
      status: HostedUsageCreditPurchaseStatus.created,
    },
  });
  if (updated.count !== 1) {
    throw new TypeError(
      "Hosted group sponsorship refill return URL repair lost its write fence.",
    );
  }
}

export async function hasHostedGroupSponsorshipPaymentAuthorityTx(input: {
  authority: HostedGroupSponsorshipPaymentAuthority;
  now: Date;
  payerMemberId: string;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const now = requireValidDate(input.now);
  await lockHostedMemberRow(input.tx, input.authority.beneficiaryMemberId);
  if (!(await hasHostedRuntimeActiveAccessForUpdateTx(
    input.authority.beneficiaryMemberId,
    { prisma: input.tx },
  ))) {
    return false;
  }
  await lockHostedMemberRow(input.tx, input.payerMemberId);
  const payer = await input.tx.hostedMember.findUnique({
    select: { suspendedAt: true },
    where: { id: input.payerMemberId },
  });
  if (!payer || payer.suspendedAt) {
    return false;
  }
  const purchase = await input.tx.hostedUsageCreditPurchase.findUnique({
    select: {
      beneficiaryMemberId: true,
      groupSponsorshipAuthorizationId: true,
      groupSponsorshipChargeOrdinal: true,
      groupSponsorshipPeriodStartedAt: true,
      payerMemberId: true,
      status: true,
    },
    where: { id: input.purchaseId },
  });
  if (
    !purchase ||
    purchase.payerMemberId !== input.payerMemberId ||
    purchase.beneficiaryMemberId !== input.authority.beneficiaryMemberId ||
    purchase.groupSponsorshipAuthorizationId !== input.authority.authorizationId ||
    purchase.groupSponsorshipChargeOrdinal !== input.authority.chargeOrdinal ||
    purchase.groupSponsorshipChargeOrdinal <= 0 ||
    purchase.groupSponsorshipPeriodStartedAt?.getTime() !==
      input.authority.periodStartedAt.getTime() ||
    (
      purchase.status !== HostedUsageCreditPurchaseStatus.created &&
      purchase.status !== HostedUsageCreditPurchaseStatus.payment_pending
    )
  ) {
    return false;
  }
  const current = await input.tx.hostedGroupSponsorshipAuthorization.findUnique({
    where: { id: input.authority.authorizationId },
  });
  if (!current) {
    return false;
  }
  const authorization = await normalizeHostedGroupSponsorshipAuthorizationTx({
    authorization: current,
    now,
    tx: input.tx,
  });
  const expectedStatus = input.authority.mode === "automatic"
    ? HostedGroupSponsorshipAuthorizationStatus.active
    : HostedGroupSponsorshipAuthorizationStatus.recovery_required;
  if (
    authorization.status !== expectedStatus ||
    authorization.payerMemberId !== input.payerMemberId ||
    authorization.beneficiaryMemberId !== input.authority.beneficiaryMemberId ||
    authorization.periodStartedAt.getTime() !==
      input.authority.periodStartedAt.getTime()
  ) {
    return false;
  }
  const committedMinor = await readHostedGroupSponsorshipCommittedMinorTx({
    authorization,
    tx: input.tx,
  });
  return committedMinor <= authorization.monthlyCapMinor;
}

export interface HostedGroupSponsorshipRecoveryProjection {
  authorizationId: string;
  payerMemberId: string;
}

export async function markHostedGroupSponsorshipRecoveryRequiredForPurchase(
  input: {
    now?: Date;
    prisma: PrismaClient;
    purchaseId: string;
  },
): Promise<HostedGroupSponsorshipRecoveryProjection | null> {
  const now = requireValidDate(input.now ?? new Date());
  return input.prisma.$transaction(async (tx) => {
    const purchase = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchaseId },
    });
    if (
      !purchase?.groupSponsorshipAuthorizationId ||
      !purchase.payerMemberId ||
      purchase.groupSponsorshipChargeOrdinal === null ||
      purchase.groupSponsorshipChargeOrdinal <= 0
    ) {
      return null;
    }
    await lockHostedMemberRow(tx, purchase.beneficiaryMemberId);
    await lockHostedMemberRow(tx, purchase.payerMemberId);
    const authorization =
      await tx.hostedGroupSponsorshipAuthorization.findUnique({
        where: { id: purchase.groupSponsorshipAuthorizationId },
      });
    if (
      !authorization ||
      !authorization.payerMemberId ||
      authorization.payerMemberId !== purchase.payerMemberId
    ) {
      return null;
    }
    if (
      authorization.status ===
        HostedGroupSponsorshipAuthorizationStatus.recovery_required &&
      purchase.status === HostedUsageCreditPurchaseStatus.payment_failed
    ) {
      return {
        authorizationId: authorization.id,
        payerMemberId: authorization.payerMemberId,
      };
    }
    if (
      authorization.status !== HostedGroupSponsorshipAuthorizationStatus.active ||
      purchase.status !== HostedUsageCreditPurchaseStatus.created
    ) {
      return null;
    }
    const purchaseUpdated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        lastReconciledAt: now,
        reconciliationVersion: { increment: 1n },
        status: HostedUsageCreditPurchaseStatus.payment_failed,
        terminalAt: now,
        updatedAt: now,
      },
      where: {
        id: purchase.id,
        reconciliationVersion: purchase.reconciliationVersion,
        status: HostedUsageCreditPurchaseStatus.created,
        stripePaymentIntentLookupKey: null,
      },
    });
    if (purchaseUpdated.count !== 1) {
      return null;
    }
    await updateAuthorizationStateTx({
      authorization,
      data: {
        recoveryStartedAt: now,
        status: HostedGroupSponsorshipAuthorizationStatus.recovery_required,
        updatedAt: now,
      },
      tx,
    });
    return {
      authorizationId: authorization.id,
      payerMemberId: authorization.payerMemberId,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function cancelHostedGroupSponsorshipsForPayerAccountDeletionTx(
  input: {
    now: Date;
    payerMemberIds: readonly string[];
    tx: Prisma.TransactionClient;
  },
): Promise<number> {
  const payerMemberIds = [...new Set(input.payerMemberIds)].sort();
  if (payerMemberIds.length === 0) {
    return 0;
  }

  // Account deletion is the only payer-initiated operation that may cancel
  // several group authorizations at once. Discover the exact live beneficiary
  // set, then acquire the same beneficiary-first, payer-second member-row order
  // used by refill, checkout, recovery, and saved-card binding. Re-read after
  // the payer locks so a concurrently created beneficiary cannot escape the
  // locked set.
  const liveAuthorizations =
    await input.tx.hostedGroupSponsorshipAuthorization.findMany({
      select: { beneficiaryMemberId: true },
      where: {
        payerMemberId: { in: payerMemberIds },
        status: { in: [...LIVE_AUTHORIZATION_STATUSES] },
      },
    });
  const beneficiaryMemberIds = [...new Set(liveAuthorizations.map(
    (authorization) => authorization.beneficiaryMemberId,
  ))].sort();
  if (beneficiaryMemberIds.length > 0) {
    await input.tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM hosted_member
      WHERE id IN (${Prisma.join(beneficiaryMemberIds)})
      ORDER BY id ASC
      FOR UPDATE
    `;
  }
  await input.tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id IN (${Prisma.join(payerMemberIds)})
    ORDER BY id ASC
    FOR UPDATE
  `;

  const currentAuthorizations =
    await input.tx.hostedGroupSponsorshipAuthorization.findMany({
      select: { beneficiaryMemberId: true },
      where: {
        payerMemberId: { in: payerMemberIds },
        status: { in: [...LIVE_AUTHORIZATION_STATUSES] },
      },
    });
  const lockedBeneficiaryMemberIds = new Set(beneficiaryMemberIds);
  if (currentAuthorizations.some(
    (authorization) => !lockedBeneficiaryMemberIds.has(
      authorization.beneficiaryMemberId,
    ),
  )) {
    throw new TypeError(
      "Hosted group sponsorship changed during payer account deletion.",
    );
  }

  const result = await input.tx.hostedGroupSponsorshipAuthorization.updateMany({
    data: {
      canceledAt: requireValidDate(input.now),
      recoveryStartedAt: null,
      status: HostedGroupSponsorshipAuthorizationStatus.canceled,
      updatedAt: input.now,
    },
    where: {
      payerMemberId: { in: payerMemberIds },
      status: { in: [...LIVE_AUTHORIZATION_STATUSES] },
    },
  });
  return result.count;
}

export async function pauseHostedGroupSponsorshipForFinancialReversalTx(input: {
  effectiveAt: Date;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const effectiveAt = requireValidDate(input.effectiveAt);
  const purchase = await input.tx.hostedUsageCreditPurchase.findUnique({
    select: { groupSponsorshipAuthorizationId: true },
    where: { id: input.purchaseId },
  });
  if (!purchase?.groupSponsorshipAuthorizationId) {
    return false;
  }
  const authorization =
    await input.tx.hostedGroupSponsorshipAuthorization.findUnique({
      where: { id: purchase.groupSponsorshipAuthorizationId },
    });
  if (
    !authorization ||
    authorization.status !== HostedGroupSponsorshipAuthorizationStatus.active
  ) {
    return false;
  }
  await updateAuthorizationStateTx({
    authorization,
    data: {
      recoveryStartedAt: null,
      status: HostedGroupSponsorshipAuthorizationStatus.paused,
      updatedAt: effectiveAt,
    },
    tx: input.tx,
  });
  return true;
}

export async function readHostedGroupSponsorshipPublicState(input: {
  beneficiaryMemberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<"sponsored" | "not_sponsored"> {
  const authorization = await input.prisma.hostedGroupSponsorshipAuthorization.findFirst({
    select: { id: true },
    where: {
      beneficiaryMemberId: input.beneficiaryMemberId,
      status: {
        in: [
          HostedGroupSponsorshipAuthorizationStatus.active,
          HostedGroupSponsorshipAuthorizationStatus.paused,
          HostedGroupSponsorshipAuthorizationStatus.recovery_required,
        ],
      },
    },
  });
  return authorization ? "sponsored" : "not_sponsored";
}

/**
 * Returns only whether a low room can recover without asking the conversation
 * for more funding. Payer identity, limits, purchases, and refill state stay
 * inside Web.
 */
export async function hasHostedGroupAutomaticRefillAvailable(input: {
  beneficiaryMemberId: string;
  now?: Date;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const now = requireValidDate(input.now ?? new Date());
  const authorizations =
    await input.prisma.hostedGroupSponsorshipAuthorization.findMany({
      select: {
        anchorDay: true,
        anchorEndOfMonth: true,
        id: true,
        monthlyCapMinor: true,
        payerMemberId: true,
        pendingMonthlyCapMinor: true,
        periodEndsAt: true,
        periodStartedAt: true,
        purchases: {
          select: {
            groupSponsorshipChargeOrdinal: true,
            groupSponsorshipPeriodStartedAt: true,
            status: true,
          },
          where: {
            groupSponsorshipChargeOrdinal: { gt: 0 },
            status: { in: [...PENDING_PURCHASE_STATUSES] },
          },
        },
        status: true,
      },
      where: {
        beneficiaryMemberId: input.beneficiaryMemberId,
        OR: [
          { status: HostedGroupSponsorshipAuthorizationStatus.active },
          {
            purchases: {
              some: {
                groupSponsorshipChargeOrdinal: { gt: 0 },
                status: HostedUsageCreditPurchaseStatus.payment_pending,
              },
            },
          },
        ],
      },
    });

  for (const candidate of authorizations) {
    const period = projectHostedGroupSponsorshipPeriod(candidate, now);
    const pendingRefill = candidate.purchases.some((purchase) =>
      purchase.groupSponsorshipPeriodStartedAt?.getTime() ===
        period.periodStartedAt.getTime()
      && (candidate.status === HostedGroupSponsorshipAuthorizationStatus.active
        || purchase.status === HostedUsageCreditPurchaseStatus.payment_pending)
    );
    if (pendingRefill) {
      return true;
    }
  }

  const authorization = authorizations.find(
    (candidate) =>
      candidate.status === HostedGroupSponsorshipAuthorizationStatus.active,
  );
  if (!authorization) {
    return false;
  }

  const activation = await input.prisma.hostedUsageCreditPurchase.findFirst({
    select: {
      offerCode: true,
      payerMemberId: true,
      status: true,
      stripeCustomerIdEncrypted: true,
      stripePriceIdEncrypted: true,
    },
    where: {
      groupSponsorshipAuthorizationId: authorization.id,
      groupSponsorshipChargeOrdinal: 0,
    },
  });
  if (!hasHostedGroupSponsorshipRefillPaymentAuthority({
    activationPurchase: activation,
    payerMemberId: authorization.payerMemberId,
  })) {
    return false;
  }

  const period = projectHostedGroupSponsorshipPeriod(authorization, now);

  const purchases = await input.prisma.hostedUsageCreditPurchase.findMany({
    select: {
      cashAmountMinor: true,
      groupSponsorshipChargeOrdinal: true,
      status: true,
    },
    where: {
      groupSponsorshipAuthorizationId: authorization.id,
      groupSponsorshipPeriodStartedAt: period.periodStartedAt,
    },
  });
  if (purchases.some(isHostedGroupSponsorshipRefillPending)) {
    return true;
  }

  return projectHostedGroupSponsorshipNextRefillChargeOrdinal({
    monthlyCapMinor: period.monthlyCapMinor,
    purchases,
  }) !== null;
}

export async function readHostedGroupSponsorshipAuthorizationByPurchase(input: {
  prisma: HostedOnboardingReadClient;
  purchaseId: string;
}): Promise<{
  authorizationId: string;
  chargeOrdinal: number;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
  payerMemberId: string;
  periodStartedAt: Date;
} | null> {
  const purchase = await input.prisma.hostedUsageCreditPurchase.findUnique({
    select: {
      groupSponsorshipAuthorization: {
        select: {
          id: true,
          monthlyCapMinor: true,
          payerMemberId: true,
          periodStartedAt: true,
        },
      },
      groupSponsorshipChargeOrdinal: true,
      groupSponsorshipPeriodStartedAt: true,
    },
    where: { id: input.purchaseId },
  });
  const authorization = purchase?.groupSponsorshipAuthorization;
  const monthlyCapMinor = parseHostedGroupSponsorshipMonthlyCapMinor(
    authorization?.monthlyCapMinor,
  );
  if (
    !authorization ||
    monthlyCapMinor === null ||
    !authorization.payerMemberId ||
    purchase.groupSponsorshipChargeOrdinal === null ||
    !purchase.groupSponsorshipPeriodStartedAt
  ) {
    return null;
  }
  return {
    authorizationId: authorization.id,
    chargeOrdinal: purchase.groupSponsorshipChargeOrdinal,
    monthlyCapMinor,
    payerMemberId: authorization.payerMemberId,
    periodStartedAt: purchase.groupSponsorshipPeriodStartedAt,
  };
}

export async function readHostedGroupSponsorshipCommittedMinor(input: {
  authorizationId: string;
  periodStartedAt: Date;
  prisma: HostedOnboardingReadClient;
}): Promise<number> {
  const aggregate = await input.prisma.hostedUsageCreditPurchase.aggregate({
    _sum: { cashAmountMinor: true },
    where: {
      groupSponsorshipAuthorizationId: input.authorizationId,
      groupSponsorshipPeriodStartedAt: input.periodStartedAt,
      status: { in: [...COMMITTED_PURCHASE_STATUSES] },
    },
  });
  return aggregate._sum.cashAmountMinor ?? 0;
}

export async function isHostedGroupSponsorshipNearCapNotificationCurrentTx(
  input: {
    authorizationId: string;
    beneficiaryMemberId: string;
    monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
    now: Date;
    payerMemberId: string;
    periodStartedAt: Date;
    purchaseId: string;
    tx: Prisma.TransactionClient;
  },
): Promise<boolean> {
  const purchase = await input.tx.hostedUsageCreditPurchase.findUnique({
    select: {
      beneficiaryMemberId: true,
      groupSponsorshipAuthorizationId: true,
      groupSponsorshipPeriodStartedAt: true,
      payerMemberId: true,
      status: true,
    },
    where: { id: input.purchaseId },
  });
  if (
    !purchase ||
    purchase.status !== HostedUsageCreditPurchaseStatus.fulfilled ||
    purchase.payerMemberId !== input.payerMemberId ||
    purchase.beneficiaryMemberId !== input.beneficiaryMemberId ||
    purchase.groupSponsorshipAuthorizationId !== input.authorizationId ||
    purchase.groupSponsorshipPeriodStartedAt?.getTime() !==
      input.periodStartedAt.getTime()
  ) {
    return false;
  }
  const current = await input.tx.hostedGroupSponsorshipAuthorization.findUnique({
    where: { id: input.authorizationId },
  });
  if (!current) {
    return false;
  }
  const authorization = await normalizeHostedGroupSponsorshipAuthorizationTx({
    authorization: current,
    now: requireValidDate(input.now),
    tx: input.tx,
  });
  if (
    authorization.status !== HostedGroupSponsorshipAuthorizationStatus.active ||
    authorization.payerMemberId !== input.payerMemberId ||
    authorization.beneficiaryMemberId !== input.beneficiaryMemberId ||
    authorization.periodStartedAt.getTime() !== input.periodStartedAt.getTime() ||
    authorization.monthlyCapMinor !== input.monthlyCapMinor ||
    authorization.monthlyCapMinor <= 500
  ) {
    return false;
  }
  return (await readHostedGroupSponsorshipCommittedMinorTx({
    authorization,
    tx: input.tx,
  })) === authorization.monthlyCapMinor - 500;
}

export function addHostedGroupSponsorshipCalendarMonth(input: {
  anchorDay: number;
  anchorEndOfMonth: boolean;
  date: Date;
}): Date {
  const date = requireValidDate(input.date);
  if (!Number.isInteger(input.anchorDay) || input.anchorDay < 1 || input.anchorDay > 31) {
    throw new TypeError("Hosted group sponsorship anchor day is invalid.");
  }
  const nextMonthStart = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    1,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
  const lastDay = new Date(Date.UTC(
    nextMonthStart.getUTCFullYear(),
    nextMonthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  nextMonthStart.setUTCDate(
    input.anchorEndOfMonth ? lastDay : Math.min(input.anchorDay, lastDay),
  );
  return nextMonthStart;
}

function projectHostedGroupSponsorshipPeriod(
  authorization: HostedGroupSponsorshipPeriodState,
  now: Date,
) {
  let monthlyCapMinor = authorization.monthlyCapMinor;
  let pendingMonthlyCapMinor = authorization.pendingMonthlyCapMinor;
  let periodEndsAt = authorization.periodEndsAt;
  let periodStartedAt = authorization.periodStartedAt;
  let iterations = 0;
  while (now.getTime() >= periodEndsAt.getTime()) {
    periodStartedAt = periodEndsAt;
    periodEndsAt = addHostedGroupSponsorshipCalendarMonth({
      anchorDay: authorization.anchorDay,
      anchorEndOfMonth: authorization.anchorEndOfMonth,
      date: periodStartedAt,
    });
    if (pendingMonthlyCapMinor !== null) {
      monthlyCapMinor = pendingMonthlyCapMinor;
      pendingMonthlyCapMinor = null;
    }
    iterations += 1;
    if (iterations > 1_200) {
      throw new TypeError("Hosted group sponsorship period rollover is invalid.");
    }
  }
  return {
    monthlyCapMinor,
    pendingMonthlyCapMinor,
    periodEndsAt,
    periodStartedAt,
  };
}

function isHostedGroupSponsorshipRefillPending(
  purchase: HostedGroupSponsorshipRefillAccounting,
): boolean {
  return (purchase.groupSponsorshipChargeOrdinal ?? 0) > 0 &&
    PENDING_PURCHASE_STATUSES.includes(
      purchase.status as (typeof PENDING_PURCHASE_STATUSES)[number],
    );
}

function projectHostedGroupSponsorshipNextRefillChargeOrdinal(input: {
  monthlyCapMinor: number;
  purchases: readonly HostedGroupSponsorshipRefillAccounting[];
}): number | null {
  const committedMinor = input.purchases.reduce((sum, purchase) =>
    COMMITTED_PURCHASE_STATUSES.includes(
      purchase.status as (typeof COMMITTED_PURCHASE_STATUSES)[number],
    )
      ? sum + purchase.cashAmountMinor
      : sum, 0);
  if (
    committedMinor + HOSTED_GROUP_SPONSORSHIP_REFILL_AMOUNT_MINOR >
    input.monthlyCapMinor
  ) {
    return null;
  }
  return input.purchases.reduce(
    (highest, purchase) => Math.max(
      highest,
      purchase.groupSponsorshipChargeOrdinal ?? 0,
    ),
    0,
  ) + 1;
}

function hasHostedGroupSponsorshipRefillPaymentAuthority(input: {
  activationPurchase: HostedGroupSponsorshipRefillAuthority | null;
  payerMemberId: string | null;
}): boolean {
  const activation = input.activationPurchase;
  return Boolean(
    input.payerMemberId &&
    activation?.status === HostedUsageCreditPurchaseStatus.fulfilled &&
    activation.offerCode === HOSTED_GROUP_SPONSORSHIP_REFILL_OFFER_CODE &&
    activation.payerMemberId === input.payerMemberId &&
    activation.stripePriceIdEncrypted &&
    activation.stripeCustomerIdEncrypted,
  );
}

function isUtcMonthEnd(date: Date): boolean {
  return date.getUTCDate() === new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0,
  )).getUTCDate();
}

async function normalizeHostedGroupSponsorshipAuthorizationTx(input: {
  authorization: HostedGroupSponsorshipAuthorization;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSponsorshipAuthorization> {
  let authorization = input.authorization;
  if (
    authorization.status ===
    HostedGroupSponsorshipAuthorizationStatus.pending_activation
  ) {
    const activationPurchase = await input.tx.hostedUsageCreditPurchase.findFirst({
      select: { status: true },
      where: {
        groupSponsorshipAuthorizationId: authorization.id,
        groupSponsorshipChargeOrdinal: 0,
      },
    });
    if (
      activationPurchase &&
      (activationPurchase.status === HostedUsageCreditPurchaseStatus.expired ||
        activationPurchase.status ===
          HostedUsageCreditPurchaseStatus.payment_failed)
    ) {
      return updateAuthorizationStateTx({
        authorization,
        data: {
          canceledAt: input.now,
          recoveryStartedAt: null,
          status: HostedGroupSponsorshipAuthorizationStatus.canceled,
          updatedAt: input.now,
        },
        tx: input.tx,
      });
    }
    return authorization;
  }
  if (
    authorization.status === HostedGroupSponsorshipAuthorizationStatus.canceled ||
    input.now.getTime() < authorization.periodEndsAt.getTime()
  ) {
    return authorization;
  }

  const period = projectHostedGroupSponsorshipPeriod(authorization, input.now);

  authorization = await updateAuthorizationStateTx({
    authorization,
    data: {
      ...period,
      // A payment failure remains fail-closed across period rollover. Only an
      // explicit payer recovery or a successfully reconciled recovery payment
      // may reactivate automatic charges.
      updatedAt: input.now,
    },
    tx: input.tx,
  });
  return authorization;
}

async function readLiveHostedGroupSponsorshipAuthorizationTx(input: {
  beneficiaryMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSponsorshipAuthorization | null> {
  return input.tx.hostedGroupSponsorshipAuthorization.findFirst({
    where: {
      beneficiaryMemberId: input.beneficiaryMemberId,
      status: { in: [...LIVE_AUTHORIZATION_STATUSES] },
    },
  });
}

async function projectHostedGroupSponsorshipAuthorizationTx(input: {
  authorization: HostedGroupSponsorshipAuthorization;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSponsorshipManagementProjection> {
  const monthlyCapMinor = parseHostedGroupSponsorshipMonthlyCapMinor(
    input.authorization.monthlyCapMinor,
  );
  const pendingMonthlyCapMinor = input.authorization.pendingMonthlyCapMinor === null
    ? null
    : parseHostedGroupSponsorshipMonthlyCapMinor(
        input.authorization.pendingMonthlyCapMinor,
      );
  if (
    monthlyCapMinor === null ||
    (input.authorization.pendingMonthlyCapMinor !== null &&
      pendingMonthlyCapMinor === null) ||
    input.authorization.status === HostedGroupSponsorshipAuthorizationStatus.canceled
  ) {
    throw new TypeError("Hosted group sponsorship projection is invalid.");
  }
  return {
    authorizationId: input.authorization.id,
    chargedThisPeriodMinor: (
      await input.tx.hostedUsageCreditPurchase.aggregate({
        _sum: { cashAmountMinor: true },
        where: {
          groupSponsorshipAuthorizationId: input.authorization.id,
          groupSponsorshipPeriodStartedAt:
            input.authorization.periodStartedAt,
          status: HostedUsageCreditPurchaseStatus.fulfilled,
        },
      })
    )._sum.cashAmountMinor ?? 0,
    monthlyCapMinor,
    pendingThisPeriodMinor: (
      await input.tx.hostedUsageCreditPurchase.aggregate({
        _sum: { cashAmountMinor: true },
        where: {
          groupSponsorshipAuthorizationId: input.authorization.id,
          groupSponsorshipPeriodStartedAt:
            input.authorization.periodStartedAt,
          status: { in: [...PENDING_PURCHASE_STATUSES] },
        },
      })
    )._sum.cashAmountMinor ?? 0,
    pendingMonthlyCapMinor,
    periodEnd: input.authorization.periodEndsAt.toISOString(),
    status: input.authorization.status,
  };
}

async function readHostedGroupSponsorshipCommittedMinorTx(input: {
  authorization: HostedGroupSponsorshipAuthorization;
  tx: Prisma.TransactionClient;
}): Promise<number> {
  return readHostedGroupSponsorshipCommittedMinor({
    authorizationId: input.authorization.id,
    periodStartedAt: input.authorization.periodStartedAt,
    prisma: input.tx,
  });
}

async function updateAuthorizationStateTx(input: {
  authorization: HostedGroupSponsorshipAuthorization;
  data: Prisma.HostedGroupSponsorshipAuthorizationUpdateManyMutationInput;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSponsorshipAuthorization> {
  const updated = await input.tx.hostedGroupSponsorshipAuthorization.updateMany({
    data: input.data,
    where: {
      id: input.authorization.id,
      updatedAt: input.authorization.updatedAt,
    },
  });
  if (updated.count !== 1) {
    throw new TypeError("Hosted group sponsorship authorization changed concurrently.");
  }
  const authorization = await input.tx.hostedGroupSponsorshipAuthorization.findUnique({
    where: { id: input.authorization.id },
  });
  if (!authorization) {
    throw new TypeError("Hosted group sponsorship authorization disappeared.");
  }
  return authorization;
}

function buildHostedGroupSponsorshipRefillPurchaseId(input: {
  authorizationId: string;
  chargeOrdinal: number;
  periodStartedAt: Date;
}): string {
  return `hucp_${buildSponsorshipDigest(
    HOSTED_GROUP_SPONSORSHIP_PURCHASE_ID_DOMAIN,
    input,
  ).slice(0, 16)}`;
}

function buildHostedGroupSponsorshipRefillRequestKey(input: {
  authorizationId: string;
  chargeOrdinal: number;
  periodStartedAt: Date;
}): string {
  return buildSponsorshipDigest(
    HOSTED_GROUP_SPONSORSHIP_REQUEST_KEY_DOMAIN,
    input,
  );
}

function buildSponsorshipDigest(
  domain: string,
  input: {
    authorizationId: string;
    chargeOrdinal: number;
    periodStartedAt: Date;
  },
): string {
  return createHash("sha256")
    .update(domain)
    .update("\0")
    .update(input.authorizationId)
    .update("\0")
    .update(input.periodStartedAt.toISOString())
    .update("\0")
    .update(String(input.chargeOrdinal))
    .digest("base64url");
}

function requireValidDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Hosted group sponsorship date is invalid.");
  }
  return value;
}

function parseHostedGroupSponsorshipAuthorizationId(
  value: unknown,
): string | null {
  return typeof value === "string" &&
      HOSTED_GROUP_SPONSORSHIP_AUTHORIZATION_ID_PATTERN.test(value)
    ? value
    : null;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002";
}

function invalidMonthlyCap() {
  return hostedOnboardingError({
    code: "HOSTED_GROUP_SPONSORSHIP_CAP_INVALID",
    httpStatus: 400,
    message: "Choose a monthly maximum of $5, $10, or $20.",
  });
}

function groupSponsorshipAlreadyActive() {
  return hostedOnboardingError({
    code: "HOSTED_GROUP_SPONSORSHIP_ALREADY_ACTIVE",
    httpStatus: 409,
    message: "This group already has a monthly sponsor.",
  });
}

function invalidManagementRequest() {
  return hostedOnboardingError({
    code: "HOSTED_GROUP_SPONSORSHIP_MANAGEMENT_INVALID",
    httpStatus: 400,
    message: "Choose a valid monthly sponsorship change.",
  });
}

function recoveryUnavailable() {
  return hostedOnboardingError({
    code: "HOSTED_GROUP_SPONSORSHIP_RECOVERY_UNAVAILABLE",
    httpStatus: 409,
    message: "This sponsorship recovery is no longer available.",
  });
}

function invalidManagementState() {
  return hostedOnboardingError({
    code: "HOSTED_GROUP_SPONSORSHIP_STATE_CONFLICT",
    httpStatus: 409,
    message: "This monthly sponsorship changed. Refresh and try again.",
  });
}
