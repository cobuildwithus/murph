import {
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { hostedLookupKeyMatchesValue } from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { resolveHostedFamilyUsageCreditCheckoutTargetTx } from "./family-plan";
import { requireHostedStripeApiMode } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  parseHostedUsageCreditOfferCode,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";
import {
  buildHostedUsageCreditInvariantError,
  decryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  projectHostedUsageCreditStripeSessionState,
  requireHostedUsageCreditPurchasePayerMemberId,
  retrieveAndExpireHostedUsageCreditStripeSession,
} from "./usage-credit-purchase-stripe";
import { normalizeHostedGroupUsageJoinCode } from "../hosted-groups/group-usage-funding";
import { getPrisma } from "../prisma";

const HOSTED_USAGE_CREDIT_CHECKOUT_CREATE_RETRY_DURATION_MS = 30 * 60 * 1_000;
const HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN = /^hucp_[A-Za-z0-9_-]{16}$/u;

export const HOSTED_USAGE_CREDIT_PUBLIC_PURCHASE_STATUSES = [
  "checkout_open",
  "payment_pending",
  "fulfilled",
  "expired",
  "payment_failed",
  "reconciling",
] as const;

export type HostedUsageCreditPublicPurchaseStatus =
  (typeof HOSTED_USAGE_CREDIT_PUBLIC_PURCHASE_STATUSES)[number];

export interface HostedUsageCreditCheckoutResult {
  purchaseId: string;
  recovered?: true;
  restartAt?: string;
  retryAllowed?: true;
  status: HostedUsageCreditPublicPurchaseStatus;
  targetConflict?: true;
  url?: string;
}

export interface HostedUsageCreditPurchaseStatusResult {
  purchaseId: string;
  restartAt?: string;
  status: HostedUsageCreditPublicPurchaseStatus;
}

export interface HostedActiveUsageCreditPurchaseProjection
  extends HostedUsageCreditPurchaseStatusResult {
  offerCode: HostedUsageCreditOfferCode;
  retryAllowed: boolean;
  target: HostedUsageCreditPurchaseTargetProjection;
  url?: string;
}

export type HostedUsageCreditPurchaseTargetProjection =
  | {
      beneficiaryMemberId: string;
      kind: "personal";
    }
  | {
      beneficiaryMemberId: string;
      groupJoinCode: string;
      kind: "group";
    }
  | {
      beneficiaryMemberId: string;
      familyGroupId: string;
      kind: "family";
    };

export async function readHostedUsageCreditPurchaseStatus(input: {
  beneficiaryMemberId?: string;
  payerMemberId: string;
  prisma?: HostedOnboardingReadClient;
  purchaseId: string;
}): Promise<HostedUsageCreditPurchaseStatusResult> {
  if (!HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(input.purchaseId)) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  const prisma = input.prisma ?? getPrisma();
  const purchase = await prisma.hostedUsageCreditPurchase.findFirst({
    select: {
      checkoutExpiresAt: true,
      id: true,
      status: true,
    },
    where: {
      ...(input.beneficiaryMemberId
        ? { beneficiaryMemberId: input.beneficiaryMemberId }
        : {}),
      id: input.purchaseId,
      payerMemberId: input.payerMemberId,
    },
  });
  if (!purchase) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  return projectHostedUsageCreditPurchaseStatusResult(purchase);
}

export async function readHostedActiveUsageCreditPurchaseForPayer(input: {
  beneficiaryMemberId?: string;
  now?: Date;
  // Omit this list to receive status/cancel data without a URL or retry action.
  serverApprovedPayableTargets?: readonly HostedUsageCreditPurchaseTargetProjection[];
  payerMemberId: string;
  prisma?: PrismaClient;
}): Promise<HostedActiveUsageCreditPurchaseProjection | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const purchase = await prisma.hostedUsageCreditPurchase.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      payer: {
        select: { suspendedAt: true },
      },
    },
    where: {
      OR: [
        {
          status: {
            in: [
              HostedUsageCreditPurchaseStatus.checkout_open,
              HostedUsageCreditPurchaseStatus.payment_pending,
            ],
          },
        },
        {
          checkoutExpiresAt: { gt: now },
          status: HostedUsageCreditPurchaseStatus.created,
        },
      ],
      ...(input.beneficiaryMemberId
        ? { beneficiaryMemberId: input.beneficiaryMemberId }
        : {}),
      payerMemberId: input.payerMemberId,
    },
  });
  if (!purchase) {
    return null;
  }

  const offerCode = parseHostedUsageCreditOfferCode(purchase.offerCode);
  if (!offerCode) {
    throw buildHostedUsageCreditInvariantError("purchase_offer_invalid");
  }
  if (!purchase.payer) {
    throw buildHostedUsageCreditInvariantError("purchase_payer_missing");
  }
  const target = projectHostedUsageCreditPurchaseTarget(purchase);
  const targetApprovedByCaller =
    input.serverApprovedPayableTargets?.some((payableTarget) =>
      hostedUsageCreditPurchaseTargetsMatch(target, payableTarget)
    ) === true;
  const mayExposePayableCapability =
    purchase.payer.suspendedAt === null &&
    targetApprovedByCaller &&
    await hasCurrentHostedUsageCreditPayableAuthority({
      payerMemberId: input.payerMemberId,
      prisma,
      target,
    });
  const checkout = mayExposePayableCapability
    ? await projectHostedUsageCreditCheckoutResult({
        prisma,
        purchase,
      })
    : projectHostedUsageCreditPurchaseStatusResult(purchase);

  return {
    ...checkout,
    offerCode,
    retryAllowed:
      mayExposePayableCapability &&
      canRetryHostedUsageCreditCheckoutCreate({ now, purchase }),
    target,
  };
}

async function hasCurrentHostedUsageCreditPayableAuthority(input: {
  payerMemberId: string;
  prisma: PrismaClient;
  target: HostedUsageCreditPurchaseTargetProjection;
}): Promise<boolean> {
  const target = input.target;
  if (target.kind !== "family") {
    return true;
  }
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.payerMemberId);
    const currentTarget = await resolveHostedFamilyUsageCreditCheckoutTargetTx({
      beneficiaryMemberId: target.beneficiaryMemberId,
      ownerMemberId: input.payerMemberId,
      tx,
    });
    return currentTarget?.groupId === target.familyGroupId;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function readHostedUsageCreditPurchaseTargetForPayer(input: {
  payerMemberId: string;
  prisma?: HostedOnboardingReadClient;
  purchaseId: string;
}): Promise<HostedUsageCreditPurchaseTargetProjection> {
  if (!HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(input.purchaseId)) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  const prisma = input.prisma ?? getPrisma();
  const purchase = await prisma.hostedUsageCreditPurchase.findFirst({
    select: {
      beneficiaryMemberId: true,
      checkoutSuccessUrl: true,
      id: true,
      payerMemberId: true,
    },
    where: {
      id: input.purchaseId,
      payerMemberId: input.payerMemberId,
    },
  });
  if (!purchase) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }
  return projectHostedUsageCreditPurchaseTarget(purchase);
}

export function projectHostedUsageCreditPurchaseTarget(input: Pick<
  HostedUsageCreditPurchase,
  "beneficiaryMemberId" | "checkoutSuccessUrl" | "id" | "payerMemberId"
>): HostedUsageCreditPurchaseTargetProjection {
  const target = readHostedUsageCreditPurchaseTarget(input);
  if (!target) {
    throw buildHostedUsageCreditInvariantError("purchase_target_invalid");
  }
  return target;
}

function hostedUsageCreditPurchaseTargetsMatch(
  left: HostedUsageCreditPurchaseTargetProjection,
  right: HostedUsageCreditPurchaseTargetProjection,
): boolean {
  if (
    left.kind !== right.kind ||
    left.beneficiaryMemberId !== right.beneficiaryMemberId
  ) {
    return false;
  }
  if (left.kind === "personal" && right.kind === "personal") {
    return true;
  }
  if (left.kind === "group" && right.kind === "group") {
    return left.groupJoinCode === right.groupJoinCode;
  }
  return left.kind === "family" && right.kind === "family" &&
    left.familyGroupId === right.familyGroupId;
}

export async function expireHostedUsageCreditCheckout(input: {
  now?: Date;
  payerMemberId: string;
  prisma?: PrismaClient;
  purchaseId: string;
}): Promise<HostedUsageCreditPurchaseStatusResult> {
  if (!HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(input.purchaseId)) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const purchase = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.payerMemberId);
    await closeExpiredUnattachedHostedUsageCreditPurchasesTx({
      now,
      payerMemberId: input.payerMemberId,
      purchaseId: input.purchaseId,
      tx,
    });

    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchaseId },
    });
    if (!current || current.payerMemberId !== input.payerMemberId) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    return current;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (
    purchase.status === HostedUsageCreditPurchaseStatus.fulfilled ||
    purchase.status === HostedUsageCreditPurchaseStatus.expired ||
    purchase.status === HostedUsageCreditPurchaseStatus.payment_failed ||
    purchase.status === HostedUsageCreditPurchaseStatus.created
  ) {
    return projectHostedUsageCreditPurchaseStatusResult(purchase);
  }

  const sessionId = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
    payerMemberId: input.payerMemberId,
    prisma,
    value: purchase.stripeCheckoutSessionIdEncrypted,
  });
  if (
    !sessionId ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: purchase.stripeCheckoutSessionLookupKey,
      kind: "stripe-checkout-session",
      normalizedValue: sessionId,
    })
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
  }

  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  if (stripeLiveMode !== purchase.stripeLiveMode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_STRIPE_MODE_MISMATCH",
      httpStatus: 500,
      message: "Usage-credit checkout is temporarily unavailable.",
    });
  }

  const session = await retrieveAndExpireHostedUsageCreditStripeSession({
    purchase,
    sessionId,
    stripe,
  });

  return prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchaseId },
    });
    if (!current || current.payerMemberId !== input.payerMemberId) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    if (
      current.status === HostedUsageCreditPurchaseStatus.fulfilled ||
      current.status === HostedUsageCreditPurchaseStatus.expired ||
      current.status === HostedUsageCreditPurchaseStatus.payment_failed
    ) {
      return projectHostedUsageCreditPurchaseStatusResult(current);
    }

    const currentSessionId = await decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
      payerMemberId: input.payerMemberId,
      prisma: tx,
      value: current.stripeCheckoutSessionIdEncrypted,
    });
    if (
      currentSessionId !== sessionId ||
      !hostedLookupKeyMatchesValue({
        expectedLookupKey: current.stripeCheckoutSessionLookupKey,
        kind: "stripe-checkout-session",
        normalizedValue: sessionId,
      })
    ) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_changed");
    }

    const providerState = projectHostedUsageCreditStripeSessionState(session);
    if (providerState === "checkout_open") {
      throw buildHostedUsageCreditInvariantError("stripe_session_remained_open");
    }
    const expired = providerState === "expired";
    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        lastReconciledAt: now,
        reconciliationVersion: { increment: 1n },
        status: expired
          ? HostedUsageCreditPurchaseStatus.expired
          : HostedUsageCreditPurchaseStatus.payment_pending,
        terminalAt: expired ? now : null,
        updatedAt: now,
      },
      where: {
        id: current.id,
        payerMemberId: input.payerMemberId,
        reconciliationVersion: current.reconciliationVersion,
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditInvariantError("checkout_expire_update_failed");
    }
    const reconciled = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!reconciled) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    return projectHostedUsageCreditPurchaseStatusResult(reconciled);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export function canRetryHostedUsageCreditCheckoutCreate(input: {
  now: Date;
  purchase: Pick<HostedUsageCreditPurchase, "createdAt" | "status">;
}): boolean {
  return input.purchase.status === HostedUsageCreditPurchaseStatus.created &&
    input.now.getTime() <
      input.purchase.createdAt.getTime() +
        HOSTED_USAGE_CREDIT_CHECKOUT_CREATE_RETRY_DURATION_MS;
}

export async function projectHostedUsageCreditCheckoutResult(input: {
  prisma: HostedOnboardingReadClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditCheckoutResult> {
  const status = projectHostedUsageCreditPublicPurchaseStatus(input.purchase);
  if (
    status !== "checkout_open" ||
    !input.purchase.stripeCheckoutUrlEncrypted
  ) {
    return projectHostedUsageCreditPurchaseStatusResult(input.purchase);
  }

  const url = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutUrl,
    payerMemberId: requireHostedUsageCreditPurchasePayerMemberId(input.purchase),
    prisma: input.prisma,
    value: input.purchase.stripeCheckoutUrlEncrypted,
  });
  if (!url) {
    throw buildHostedUsageCreditInvariantError("checkout_url_missing");
  }

  return {
    purchaseId: input.purchase.id,
    status,
    url,
  };
}

function projectHostedUsageCreditPublicPurchaseStatus(input: Pick<
  HostedUsageCreditPurchase,
  "status"
>): HostedUsageCreditPublicPurchaseStatus {
  switch (input.status) {
    case HostedUsageCreditPurchaseStatus.checkout_open:
    case HostedUsageCreditPurchaseStatus.payment_pending:
    case HostedUsageCreditPurchaseStatus.fulfilled:
    case HostedUsageCreditPurchaseStatus.expired:
    case HostedUsageCreditPurchaseStatus.payment_failed:
      return input.status;
    case HostedUsageCreditPurchaseStatus.created:
      return "reconciling";
  }
}

export function projectHostedUsageCreditPurchaseStatusResult(input: Pick<
  HostedUsageCreditPurchase,
  "checkoutExpiresAt" | "id" | "status"
>): HostedUsageCreditPurchaseStatusResult {
  const status = projectHostedUsageCreditPublicPurchaseStatus(input);
  return {
    purchaseId: input.id,
    ...(status === "reconciling"
      ? { restartAt: input.checkoutExpiresAt.toISOString() }
      : {}),
    status,
  };
}

export async function closeExpiredUnattachedHostedUsageCreditPurchasesTx(input: {
  now: Date;
  payerMemberId: string;
  purchaseId?: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedUsageCreditPurchase.updateMany({
    data: {
      reconciliationVersion: { increment: 1n },
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: input.now,
      updatedAt: input.now,
    },
    where: {
      checkoutExpiresAt: { lte: input.now },
      ...(input.purchaseId ? { id: input.purchaseId } : {}),
      payerMemberId: input.payerMemberId,
      status: HostedUsageCreditPurchaseStatus.created,
    },
  });
}

export function buildHostedUsageCreditPurchaseNotFoundError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_PURCHASE_NOT_FOUND",
    httpStatus: 404,
    message: "That usage-credit purchase was not found.",
  });
}

function readHostedUsageCreditPurchaseTarget(input: Pick<
  HostedUsageCreditPurchase,
  "beneficiaryMemberId" | "checkoutSuccessUrl" | "id" | "payerMemberId"
>): HostedUsageCreditPurchaseTargetProjection | null {
  if (!input.payerMemberId) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(input.checkoutSuccessUrl);
  } catch {
    return null;
  }
  if (
    url.searchParams.get("usageCheckout") !== "success"
    || url.searchParams.get("usagePurchase") !== input.id
  ) {
    return null;
  }

  const searchKeys = [...url.searchParams.keys()].sort();
  if (
    url.pathname === "/settings"
    && url.hash === "#subscription"
    && stringArraysEqual(searchKeys, ["usageCheckout", "usagePurchase"])
    && input.beneficiaryMemberId === input.payerMemberId
  ) {
    return {
      beneficiaryMemberId: input.beneficiaryMemberId,
      kind: "personal",
    };
  }

  const familyGroupId = url.searchParams.get("usageFamily");
  const familyMemberId = url.searchParams.get("usageMember");
  if (
    url.pathname === "/settings"
    && url.hash === "#family"
    && stringArraysEqual(searchKeys, [
      "usageCheckout",
      "usageFamily",
      "usageMember",
      "usagePurchase",
    ])
    && isHostedOpaqueSelector(familyGroupId, "hbag_")
    && familyMemberId === input.beneficiaryMemberId
  ) {
    return {
      beneficiaryMemberId: input.beneficiaryMemberId,
      familyGroupId,
      kind: "family",
    };
  }

  const groupPathPrefix = "/groups/fund/";
  if (
    url.pathname.startsWith(groupPathPrefix)
    && url.hash === ""
    && stringArraysEqual(searchKeys, ["usageCheckout", "usagePurchase"])
  ) {
    const encodedJoinCode = url.pathname.slice(groupPathPrefix.length);
    if (!encodedJoinCode || encodedJoinCode.includes("/")) {
      return null;
    }
    let decodedJoinCode: string;
    try {
      decodedJoinCode = decodeURIComponent(encodedJoinCode);
    } catch {
      return null;
    }
    const groupJoinCode = normalizeHostedGroupUsageJoinCode(decodedJoinCode);
    if (!groupJoinCode) {
      return null;
    }
    return {
      beneficiaryMemberId: input.beneficiaryMemberId,
      groupJoinCode,
      kind: "group",
    };
  }

  return null;
}

function isHostedOpaqueSelector(
  value: string | null,
  prefix: string,
): value is string {
  return Boolean(
    value
    && value.startsWith(prefix)
    && value.length <= 200
    && /^[A-Za-z0-9_-]+$/u.test(value),
  );
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
