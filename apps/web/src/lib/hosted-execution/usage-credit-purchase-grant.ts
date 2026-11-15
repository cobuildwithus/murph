import type { Prisma } from "@prisma/client";

import {
  assertHostedUsageCreditDate,
  lockHostedUsageCreditBeneficiaryTx,
  lockHostedUsageCreditPurchaseTx,
  type HostedUsageCreditProjection,
} from "./usage-credit-ledger";
import { appendHostedUsageCreditGrantTx } from "./usage-credit-grant";

export interface HostedUsageCreditGrantResult
  extends HostedUsageCreditProjection {
  entryId: string;
  granted: boolean;
}

const PURCHASE_GRANT_SEMANTIC_SOURCE_VERSION = "v1";

export async function grantHostedUsageCreditForPurchaseTx(input: {
  paidAt: Date;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditGrantResult> {
  assertHostedUsageCreditDate(input.paidAt);

  // This first read discovers the lock owner only. Every mutable purchase fact
  // is re-read after the beneficiary row has been locked.
  const discoveredPurchase = await input.tx.hostedUsageCreditPurchase.findUnique({
    where: {
      id: input.purchaseId,
    },
    select: {
      beneficiaryMemberId: true,
    },
  });

  if (!discoveredPurchase) {
    throw new TypeError("Hosted usage-credit purchase does not exist.");
  }

  const lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: discoveredPurchase.beneficiaryMemberId,
    tx: input.tx,
  });
  const purchase = await lockHostedUsageCreditPurchaseTx({
    purchaseId: input.purchaseId,
    tx: input.tx,
  });

  if (purchase.beneficiaryMemberId !== lockedBeneficiary.beneficiaryMemberId) {
    throw new TypeError("Hosted usage-credit purchase beneficiary changed during fulfillment.");
  }
  if (purchase.grantSlotReleasedAt !== null) {
    throw new TypeError(
      "Hosted usage-credit purchase has provider-final no-payment release.",
    );
  }
  if (purchase.grantUsdMicros <= 0n) {
    throw new TypeError("Hosted usage-credit purchase grant must be positive.");
  }
  if (
    purchase.paidAt !== null
    && purchase.paidAt.getTime() !== input.paidAt.getTime()
  ) {
    throw new TypeError("Hosted usage-credit purchase paid timestamp changed.");
  }

  const semanticSourceKey = buildHostedUsageCreditPurchaseGrantSemanticSourceKey(
    purchase.id,
  );
  const existingGrant = await input.tx.hostedUsageCreditEntry.findFirst({
    where: {
      kind: "purchase_grant",
      purchaseId: purchase.id,
    },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      effectiveAt: true,
      grant: {
        select: { remainingUsdMicros: true },
      },
      id: true,
      semanticSourceKey: true,
    },
  });

  if (existingGrant) {
    if (
      purchase.status !== "fulfilled"
      || purchase.paidAt === null
      || purchase.paidAt.getTime() !== input.paidAt.getTime()
      || existingGrant.amountUsdMicros !== purchase.grantUsdMicros
      || existingGrant.beneficiaryMemberId !== purchase.beneficiaryMemberId
      || existingGrant.grant?.remainingUsdMicros
        !== purchase.remainingCreditUsdMicros
      || existingGrant.effectiveAt.getTime() !== input.paidAt.getTime()
      || existingGrant.semanticSourceKey !== semanticSourceKey
    ) {
      throw new TypeError("Hosted usage-credit purchase grant invariant failed.");
    }

    return {
      balanceUsdMicros: lockedBeneficiary.balanceUsdMicros,
      entryId: existingGrant.id,
      granted: false,
      ledgerVersion: lockedBeneficiary.ledgerVersion,
    };
  }

  if (purchase.status === "fulfilled") {
    throw new TypeError(
      "Hosted usage-credit fulfilled purchase is missing its grant projection.",
    );
  }
  if (purchase.remainingCreditUsdMicros !== 0n) {
    throw new TypeError("Hosted usage-credit unfulfilled purchase has remaining credit.");
  }
  const grant = await appendHostedUsageCreditGrantTx({
    effectiveAt: input.paidAt,
    grantUsdMicros: purchase.grantUsdMicros,
    lockedBeneficiary,
    semanticSourceKey,
    source: { kind: "purchase", purchaseId: purchase.id },
    tx: input.tx,
  });
  const fulfilled = await input.tx.hostedUsageCreditPurchase.updateMany({
    where: {
      beneficiaryMemberId: purchase.beneficiaryMemberId,
      id: purchase.id,
      remainingCreditUsdMicros: 0n,
    },
    data: {
      paidAt: input.paidAt,
      remainingCreditUsdMicros: purchase.grantUsdMicros,
      status: "fulfilled",
      terminalAt: input.paidAt,
    },
  });

  if (fulfilled.count !== 1) {
    throw new TypeError("Hosted usage-credit purchase fulfillment lost its locked row.");
  }

  return {
    balanceUsdMicros: grant.balanceUsdMicros,
    entryId: grant.entryId,
    granted: grant.granted,
    ledgerVersion: grant.ledgerVersion,
  };
}

function buildHostedUsageCreditPurchaseGrantSemanticSourceKey(
  purchaseId: string,
): string {
  return `hosted-usage-credit:purchase:${purchaseId}:grant:${PURCHASE_GRANT_SEMANTIC_SOURCE_VERSION}`;
}
