import type { Prisma } from "@prisma/client";

import { generateHostedRandomPrefixedId } from "../primitives";
import {
  readHostedUsageCreditGrantCapacityTx,
} from "./usage-credit-grant-capacity";
import {
  applyHostedUsageCreditProjectionDeltaTx,
  assertHostedUsageCreditDate,
  reconcileHostedUsageCreditCurrentPeriodBlockTx,
  type HostedUsageCreditProjection,
  type LockedHostedUsageCreditBeneficiary,
} from "./usage-credit-ledger";

export type HostedUsageCreditGrantSource =
  | { kind: "purchase"; purchaseId: string; referralId?: never }
  | { kind: "referral"; referralId: string; purchaseId?: never };

export interface HostedUsageCreditGrantAppendResult
  extends HostedUsageCreditProjection {
  entryId: string;
  granted: boolean;
}

/**
 * Appends one immutable positive ledger entry and its mutable remaining-credit
 * projection. The caller holds the beneficiary lock, which orders every grant,
 * debit, and purchase adjustment for that beneficiary.
 */
export async function appendHostedUsageCreditGrantTx(input: {
  effectiveAt: Date;
  grantUsdMicros: bigint;
  lockedBeneficiary: LockedHostedUsageCreditBeneficiary;
  semanticSourceKey: string;
  source: HostedUsageCreditGrantSource;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditGrantAppendResult> {
  assertHostedUsageCreditDate(input.effectiveAt);
  if (input.grantUsdMicros <= 0n) {
    throw new TypeError("Hosted usage-credit grant must be positive.");
  }
  const semanticSourceKey = input.semanticSourceKey.trim();
  if (!semanticSourceKey) {
    throw new TypeError("Hosted usage-credit grant requires a semantic source key.");
  }

  const existing = await input.tx.hostedUsageCreditEntry.findUnique({
    where: { semanticSourceKey },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      effectiveAt: true,
      grant: {
        select: { remainingUsdMicros: true },
      },
      id: true,
      kind: true,
      parentGrantEntryId: true,
      purchaseId: true,
      referralId: true,
    },
  });
  if (existing) {
    const expectedKind = input.source.kind === "purchase"
      ? "purchase_grant"
      : "referral_grant";
    if (
      existing.amountUsdMicros !== input.grantUsdMicros
      || existing.beneficiaryMemberId
        !== input.lockedBeneficiary.beneficiaryMemberId
      || existing.effectiveAt.getTime() !== input.effectiveAt.getTime()
      || existing.kind !== expectedKind
      || existing.parentGrantEntryId !== null
      || existing.purchaseId
        !== (input.source.kind === "purchase" ? input.source.purchaseId : null)
      || existing.referralId
        !== (input.source.kind === "referral" ? input.source.referralId : null)
      || !existing.grant
      || existing.grant.remainingUsdMicros < 0n
      || existing.grant.remainingUsdMicros > existing.amountUsdMicros
    ) {
      throw new TypeError("Hosted usage-credit grant replay invariant failed.");
    }
    return {
      balanceUsdMicros: input.lockedBeneficiary.balanceUsdMicros,
      entryId: existing.id,
      granted: false,
      ledgerVersion: input.lockedBeneficiary.ledgerVersion,
    };
  }

  const capacity = await readHostedUsageCreditGrantCapacityTx({
    ...(input.source.kind === "purchase"
      ? { expectedPurchaseId: input.source.purchaseId }
      : {}),
    lockedBeneficiary: input.lockedBeneficiary,
    tx: input.tx,
  });
  if (capacity.state === "overflow") {
    throw new TypeError(
      "Hosted usage-credit active grant capacity exceeds its contract.",
    );
  }
  if (input.source.kind === "purchase") {
    if (!capacity.expectedPurchaseOwnsReservation) {
      throw new TypeError(
        "Hosted usage-credit purchase grant reservation is missing.",
      );
    }
  } else if (capacity.state === "at_capacity") {
    throw new TypeError(
      "Hosted usage-credit active grant capacity is full.",
    );
  }

  const projection = await applyHostedUsageCreditProjectionDeltaTx({
    deltaUsdMicros: input.grantUsdMicros,
    locked: input.lockedBeneficiary,
    tx: input.tx,
  });
  const entryId = generateHostedRandomPrefixedId("huce");
  await input.tx.hostedUsageCreditEntry.create({
    data: {
      amountUsdMicros: input.grantUsdMicros,
      beneficiaryMemberId: projection.beneficiaryMemberId,
      beneficiarySequence: projection.ledgerVersion,
      effectiveAt: input.effectiveAt,
      id: entryId,
      kind: input.source.kind === "purchase"
        ? "purchase_grant"
        : "referral_grant",
      ...(input.source.kind === "purchase"
        ? { purchaseId: input.source.purchaseId }
        : { referralId: input.source.referralId }),
      semanticSourceKey,
    },
  });
  await input.tx.hostedUsageCreditGrant.create({
    data: {
      entryId,
      remainingUsdMicros: input.grantUsdMicros,
    },
  });
  await reconcileHostedUsageCreditCurrentPeriodBlockTx({
    balanceUsdMicros: projection.balanceUsdMicros,
    beneficiaryMemberId: projection.beneficiaryMemberId,
    effectiveAt: input.effectiveAt,
    tx: input.tx,
  });

  return {
    balanceUsdMicros: projection.balanceUsdMicros,
    entryId,
    granted: true,
    ledgerVersion: projection.ledgerVersion,
  };
}
