import {
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { hostedLookupKeyMatchesValue } from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
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
  retrieveAndExpireHostedUsageCreditStripeSession,
} from "./usage-credit-purchase-stripe";
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
  url?: string;
}

export async function readHostedUsageCreditPurchaseStatus(input: {
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
      id: input.purchaseId,
      payerMemberId: input.payerMemberId,
    },
  });
  if (!purchase) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  return buildHostedUsageCreditPurchaseStatusResult(purchase);
}

export async function readHostedActiveUsageCreditPurchaseForPayer(input: {
  now?: Date;
  payerMemberId: string;
  prisma?: HostedOnboardingReadClient;
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
  const checkout = purchase.payer.suspendedAt
    ? buildHostedUsageCreditPurchaseStatusResult(purchase)
    : await projectHostedUsageCreditCheckoutResult({
        prisma,
        purchase,
      });

  return {
    ...checkout,
    offerCode,
    retryAllowed:
      purchase.payer.suspendedAt === null &&
      canRetryHostedUsageCreditCheckoutCreate({ now, purchase }),
  };
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
    return buildHostedUsageCreditPurchaseStatusResult(purchase);
  }

  const sessionId = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
    payerMemberId: purchase.payerMemberId,
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
      return buildHostedUsageCreditPurchaseStatusResult(current);
    }

    const currentSessionId = await decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
      payerMemberId: current.payerMemberId,
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
    return buildHostedUsageCreditPurchaseStatusResult(reconciled);
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
    return buildHostedUsageCreditPurchaseStatusResult(input.purchase);
  }

  const url = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutUrl,
    payerMemberId: input.purchase.payerMemberId,
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

function buildHostedUsageCreditPurchaseStatusResult(input: Pick<
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
