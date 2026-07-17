import type { Prisma } from "@prisma/client";

import { generateHostedRandomPrefixedId } from "../primitives";
import {
  applyHostedUsageCreditProjectionDeltaTx,
  assertHostedUsageCreditDate,
  lockHostedUsageCreditBeneficiaryTx,
  lockHostedUsageCreditPurchaseTx,
  reconcileHostedUsageCreditCurrentPeriodBlockTx,
  type HostedUsageCreditProjection,
} from "./usage-credit-ledger";

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

  let projection = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: discoveredPurchase.beneficiaryMemberId,
    tx: input.tx,
  });
  const purchase = await lockHostedUsageCreditPurchaseTx({
    purchaseId: input.purchaseId,
    tx: input.tx,
  });

  if (purchase.beneficiaryMemberId !== projection.beneficiaryMemberId) {
    throw new TypeError("Hosted usage-credit purchase beneficiary changed during fulfillment.");
  }
  if (purchase.grantUsdMicros <= 0n) {
    throw new TypeError("Hosted usage-credit purchase grant must be positive.");
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
      id: true,
      semanticSourceKey: true,
    },
  });

  if (existingGrant) {
    if (
      existingGrant.amountUsdMicros !== purchase.grantUsdMicros
      || existingGrant.beneficiaryMemberId !== purchase.beneficiaryMemberId
      || existingGrant.semanticSourceKey !== semanticSourceKey
      || purchase.status !== "fulfilled"
      || purchase.paidAt === null
      || purchase.paidAt.getTime() !== input.paidAt.getTime()
    ) {
      throw new TypeError("Hosted usage-credit purchase grant invariant failed.");
    }

    return {
      balanceUsdMicros: projection.balanceUsdMicros,
      entryId: existingGrant.id,
      granted: false,
      ledgerVersion: projection.ledgerVersion,
    };
  }

  if (purchase.status === "fulfilled") {
    throw new TypeError("Hosted usage-credit fulfilled purchase is missing its grant.");
  }
  if (purchase.remainingCreditUsdMicros !== 0n) {
    throw new TypeError("Hosted usage-credit unfulfilled purchase has remaining credit.");
  }
  if (
    purchase.paidAt !== null
    && purchase.paidAt.getTime() !== input.paidAt.getTime()
  ) {
    throw new TypeError("Hosted usage-credit purchase paid timestamp changed.");
  }

  projection = await applyHostedUsageCreditProjectionDeltaTx({
    deltaUsdMicros: purchase.grantUsdMicros,
    locked: projection,
    tx: input.tx,
  });
  const entryId = generateHostedRandomPrefixedId("huce");

  await input.tx.hostedUsageCreditEntry.create({
    data: {
      amountUsdMicros: purchase.grantUsdMicros,
      beneficiaryMemberId: purchase.beneficiaryMemberId,
      beneficiarySequence: projection.ledgerVersion,
      effectiveAt: input.paidAt,
      id: entryId,
      kind: "purchase_grant",
      purchaseId: purchase.id,
      semanticSourceKey,
    },
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

  await reconcileHostedUsageCreditCurrentPeriodBlockTx({
    balanceUsdMicros: projection.balanceUsdMicros,
    beneficiaryMemberId: purchase.beneficiaryMemberId,
    effectiveAt: input.paidAt,
    tx: input.tx,
  });

  return {
    balanceUsdMicros: projection.balanceUsdMicros,
    entryId,
    granted: true,
    ledgerVersion: projection.ledgerVersion,
  };
}

function buildHostedUsageCreditPurchaseGrantSemanticSourceKey(
  purchaseId: string,
): string {
  return `hosted-usage-credit:purchase:${purchaseId}:grant:${PURCHASE_GRANT_SEMANTIC_SOURCE_VERSION}`;
}
