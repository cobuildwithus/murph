import type { Prisma } from "@prisma/client";

import { generateHostedRandomPrefixedId } from "../primitives";
import {
  applyHostedUsageCreditProjectionDeltaTx,
  assertHostedUsageCreditDate,
  lockHostedUsageCreditBeneficiaryTx,
  lockHostedUsageCreditPurchaseTx,
  minHostedUsageCreditBigInt,
  reconcileHostedUsageCreditCurrentPeriodBlockTx,
  type HostedUsageCreditProjection,
  type LockedHostedUsageCreditBeneficiary,
  type LockedHostedUsageCreditPurchase,
} from "./usage-credit-ledger";

export interface HostedUsageCreditNetReversalResult
  extends HostedUsageCreditProjection {
  entryId: string | null;
  netReversedUsdMicros: bigint;
  reversedNowUsdMicros: bigint;
  restoredNowUsdMicros: bigint;
  unmetTargetUsdMicros: bigint;
}

interface LockedHostedUsageCreditReversiblePurchase {
  grant: {
    grantEntryId: string;
    remainingUsdMicros: bigint;
  };
  projection: LockedHostedUsageCreditBeneficiary;
  purchase: LockedHostedUsageCreditPurchase;
}

type HostedUsageCreditAdjustmentKind =
  | "dispute_adjustment"
  | "refund_adjustment";

export async function reconcileHostedUsageCreditRefundNetReversalTx(input: {
  effectiveAt: Date;
  purchaseId: string;
  sourceReferenceLookupKey: string;
  targetNetReversalUsdMicros: bigint;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditNetReversalResult> {
  return reconcileHostedUsageCreditNetReversalTx({
    effectiveAt: input.effectiveAt,
    kind: "refund_adjustment",
    purchaseId: input.purchaseId,
    sourceReferenceLookupKey: input.sourceReferenceLookupKey,
    targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    tx: input.tx,
  });
}

export async function reconcileHostedUsageCreditDisputeNetReversalTx(input: {
  effectiveAt: Date;
  purchaseId: string;
  sourceReferenceLookupKey: string;
  sourceReferenceLookupKeyCandidates: readonly string[];
  targetNetReversalUsdMicros: bigint;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditNetReversalResult> {
  return reconcileHostedUsageCreditNetReversalTx({
    effectiveAt: input.effectiveAt,
    kind: "dispute_adjustment",
    purchaseId: input.purchaseId,
    sourceReferenceLookupKey: input.sourceReferenceLookupKey,
    sourceReferenceLookupKeyCandidates:
      input.sourceReferenceLookupKeyCandidates,
    targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    tx: input.tx,
  });
}

async function reconcileHostedUsageCreditNetReversalTx(input: {
  effectiveAt: Date;
  kind: HostedUsageCreditAdjustmentKind;
  purchaseId: string;
  sourceReferenceLookupKey: string;
  sourceReferenceLookupKeyCandidates?: readonly string[];
  targetNetReversalUsdMicros: bigint;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageCreditNetReversalResult> {
  assertHostedUsageCreditDate(input.effectiveAt);
  const sourceReferenceLookupKeys = normalizeHostedUsageCreditSourceLookupKeys({
    current: input.sourceReferenceLookupKey,
    readableCandidates: input.sourceReferenceLookupKeyCandidates ?? [],
  });
  if (input.targetNetReversalUsdMicros < 0n) {
    throw new TypeError("Hosted usage-credit net reversal target cannot be negative.");
  }

  const locked = await lockHostedUsageCreditReversiblePurchaseTx({
    purchaseId: input.purchaseId,
    tx: input.tx,
  });
  const adjustmentWhere: Prisma.HostedUsageCreditEntryWhereInput = {
    kind: input.kind,
    purchaseId: input.purchaseId,
    ...(input.kind === "dispute_adjustment"
      ? {
          sourceReferenceLookupKey: {
            in: sourceReferenceLookupKeys,
          },
        }
      : {}),
  };
  const adjustmentEntries = await input.tx.hostedUsageCreditEntry.findMany({
    where: adjustmentWhere,
    orderBy: {
      beneficiarySequence: "asc",
    },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      beneficiarySequence: true,
      parentGrantEntryId: true,
      sourceReferenceLookupKey: true,
    },
  });
  const canonicalSourceReferenceLookupKey = input.kind === "dispute_adjustment"
    ? resolveHostedUsageCreditCanonicalSourceLookupKey({
        current: input.sourceReferenceLookupKey,
        entries: adjustmentEntries,
      })
    : input.sourceReferenceLookupKey;
  const currentNetReversedUsdMicros = sumHostedUsageCreditAdjustmentEntries({
    beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
    entries: adjustmentEntries,
    grantEntryId: locked.grant.grantEntryId,
  });

  if (currentNetReversedUsdMicros < 0n) {
    throw new TypeError("Hosted usage-credit adjustment restored more than it reversed.");
  }
  if (locked.projection.balanceUsdMicros < locked.grant.remainingUsdMicros) {
    throw new TypeError("Hosted usage-credit grant remaining exceeds its beneficiary balance.");
  }

  if (input.targetNetReversalUsdMicros === currentNetReversedUsdMicros) {
    return buildHostedUsageCreditNetReversalResult({
      entryId: null,
      netReversedUsdMicros: currentNetReversedUsdMicros,
      projection: locked.projection,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 0n,
      targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    });
  }

  const increasing =
    input.targetNetReversalUsdMicros > currentNetReversedUsdMicros;
  const desiredDeltaUsdMicros = increasing
    ? input.targetNetReversalUsdMicros - currentNetReversedUsdMicros
    : currentNetReversedUsdMicros - input.targetNetReversalUsdMicros;
  const appliedDeltaUsdMicros = increasing
    ? minHostedUsageCreditBigInt(
        desiredDeltaUsdMicros,
        locked.grant.remainingUsdMicros,
        locked.projection.balanceUsdMicros,
      )
    : desiredDeltaUsdMicros;

  if (appliedDeltaUsdMicros === 0n) {
    return buildHostedUsageCreditNetReversalResult({
      entryId: null,
      netReversedUsdMicros: currentNetReversedUsdMicros,
      projection: locked.projection,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 0n,
      targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
    });
  }

  const nextRemainingUsdMicros = increasing
    ? locked.grant.remainingUsdMicros - appliedDeltaUsdMicros
    : locked.grant.remainingUsdMicros + appliedDeltaUsdMicros;
  if (nextRemainingUsdMicros > locked.purchase.grantUsdMicros) {
    throw new TypeError("Hosted usage-credit restoration exceeds its purchase grant.");
  }

  const grantUpdated = await input.tx.hostedUsageCreditGrant.updateMany({
    where: {
      entryId: locked.grant.grantEntryId,
      remainingUsdMicros: locked.grant.remainingUsdMicros,
    },
    data: { remainingUsdMicros: nextRemainingUsdMicros },
  });
  if (grantUpdated.count !== 1) {
    throw new TypeError(
      "Hosted usage-credit net reversal lost its locked grant projection.",
    );
  }
  const purchaseUpdated = await input.tx.hostedUsageCreditPurchase.updateMany({
    where: {
      beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
      id: locked.purchase.id,
      remainingCreditUsdMicros: locked.purchase.remainingCreditUsdMicros,
      status: "fulfilled",
    },
    data: { remainingCreditUsdMicros: nextRemainingUsdMicros },
  });
  if (purchaseUpdated.count !== 1) {
    throw new TypeError("Hosted usage-credit net reversal lost its purchase projection.");
  }

  const projection = await applyHostedUsageCreditProjectionDeltaTx({
    deltaUsdMicros: increasing
      ? -appliedDeltaUsdMicros
      : appliedDeltaUsdMicros,
    locked: locked.projection,
    tx: input.tx,
  });
  const nextNetReversedUsdMicros = increasing
    ? currentNetReversedUsdMicros + appliedDeltaUsdMicros
    : currentNetReversedUsdMicros - appliedDeltaUsdMicros;
  const entryId = generateHostedRandomPrefixedId("huce");
  await input.tx.hostedUsageCreditEntry.create({
    data: {
      amountUsdMicros: increasing
        ? -appliedDeltaUsdMicros
        : appliedDeltaUsdMicros,
      beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
      beneficiarySequence: projection.ledgerVersion,
      effectiveAt: input.effectiveAt,
      id: entryId,
      kind: input.kind,
      parentGrantEntryId: locked.grant.grantEntryId,
      purchaseId: locked.purchase.id,
      semanticSourceKey: buildHostedUsageCreditNetReversalSemanticSourceKey({
        beforeNetReversedUsdMicros: currentNetReversedUsdMicros,
        kind: input.kind,
        ledgerVersion: projection.ledgerVersion,
        nextNetReversedUsdMicros,
        purchaseId: input.purchaseId,
        sourceReferenceLookupKey: canonicalSourceReferenceLookupKey,
      }),
      sourceReferenceLookupKey: canonicalSourceReferenceLookupKey,
    },
  });
  await reconcileHostedUsageCreditCurrentPeriodBlockTx({
    balanceUsdMicros: projection.balanceUsdMicros,
    beneficiaryMemberId: locked.purchase.beneficiaryMemberId,
    effectiveAt: input.effectiveAt,
    tx: input.tx,
  });

  return buildHostedUsageCreditNetReversalResult({
    entryId,
    netReversedUsdMicros: nextNetReversedUsdMicros,
    projection,
    reversedNowUsdMicros: increasing ? appliedDeltaUsdMicros : 0n,
    restoredNowUsdMicros: increasing ? 0n : appliedDeltaUsdMicros,
    targetNetReversalUsdMicros: input.targetNetReversalUsdMicros,
  });
}

async function lockHostedUsageCreditReversiblePurchaseTx(input: {
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<LockedHostedUsageCreditReversiblePurchase> {
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

  const projection = await lockHostedUsageCreditBeneficiaryTx({
    beneficiaryMemberId: discoveredPurchase.beneficiaryMemberId,
    tx: input.tx,
  });
  const purchase = await lockHostedUsageCreditPurchaseTx({
    purchaseId: input.purchaseId,
    tx: input.tx,
  });
  if (
    purchase.beneficiaryMemberId !== projection.beneficiaryMemberId
    || purchase.status !== "fulfilled"
    || purchase.paidAt === null
  ) {
    throw new TypeError("Hosted usage-credit reversal requires a fulfilled purchase.");
  }
  if (
    purchase.remainingCreditUsdMicros < 0n
    || purchase.remainingCreditUsdMicros > purchase.grantUsdMicros
  ) {
    throw new TypeError("Hosted usage-credit purchase remaining invariant failed.");
  }
  const grantEntry = await input.tx.hostedUsageCreditEntry.findFirst({
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      id: true,
    },
    where: {
      kind: "purchase_grant",
      purchaseId: input.purchaseId,
    },
  });
  const grantProjection = grantEntry
    ? await input.tx.hostedUsageCreditGrant.findUnique({
        where: { entryId: grantEntry.id },
        select: { remainingUsdMicros: true },
      })
    : null;
  if (
    !grantEntry
    || !grantProjection
    || grantProjection.remainingUsdMicros
      !== purchase.remainingCreditUsdMicros
    || grantEntry.amountUsdMicros !== purchase.grantUsdMicros
    || grantEntry.beneficiaryMemberId !== purchase.beneficiaryMemberId
  ) {
    throw new TypeError("Hosted usage-credit fulfilled purchase grant invariant failed.");
  }

  return {
    grant: {
      grantEntryId: grantEntry.id,
      remainingUsdMicros: grantProjection.remainingUsdMicros,
    },
    projection,
    purchase,
  };
}

function buildHostedUsageCreditNetReversalSemanticPrefix(input: {
  kind: HostedUsageCreditAdjustmentKind;
  purchaseId: string;
  sourceReferenceLookupKey: string;
}): string {
  if (input.kind === "refund_adjustment") {
    return `hosted-usage-credit:refund:purchase:${input.purchaseId}:`;
  }

  return `hosted-usage-credit:dispute:${input.sourceReferenceLookupKey}:`;
}

function buildHostedUsageCreditNetReversalSemanticSourceKey(input: {
  beforeNetReversedUsdMicros: bigint;
  kind: HostedUsageCreditAdjustmentKind;
  ledgerVersion: bigint;
  nextNetReversedUsdMicros: bigint;
  purchaseId: string;
  sourceReferenceLookupKey: string;
}): string {
  return `${buildHostedUsageCreditNetReversalSemanticPrefix(input)}net:${input.beforeNetReversedUsdMicros}:to:${input.nextNetReversedUsdMicros}:ledger:${input.ledgerVersion}:v2`;
}

function buildHostedUsageCreditNetReversalResult(input: {
  entryId: string | null;
  netReversedUsdMicros: bigint;
  projection: HostedUsageCreditProjection;
  reversedNowUsdMicros: bigint;
  restoredNowUsdMicros: bigint;
  targetNetReversalUsdMicros: bigint;
}): HostedUsageCreditNetReversalResult {
  return {
    balanceUsdMicros: input.projection.balanceUsdMicros,
    entryId: input.entryId,
    ledgerVersion: input.projection.ledgerVersion,
    netReversedUsdMicros: input.netReversedUsdMicros,
    reversedNowUsdMicros: input.reversedNowUsdMicros,
    restoredNowUsdMicros: input.restoredNowUsdMicros,
    unmetTargetUsdMicros:
      input.targetNetReversalUsdMicros - input.netReversedUsdMicros,
  };
}

function sumHostedUsageCreditAdjustmentEntries(input: {
  beneficiaryMemberId: string;
  entries: Array<{
    amountUsdMicros: bigint;
    beneficiaryMemberId: string;
    parentGrantEntryId: string | null;
  }>;
  grantEntryId: string;
}): bigint {
  let total = 0n;
  for (const entry of input.entries) {
    if (
      entry.beneficiaryMemberId !== input.beneficiaryMemberId
      || entry.parentGrantEntryId !== input.grantEntryId
      || entry.amountUsdMicros === 0n
    ) {
      throw new TypeError("Hosted usage-credit adjustment entry invariant failed.");
    }
    total += entry.amountUsdMicros;
  }
  return -total;
}

function normalizeHostedUsageCreditSourceLookupKeys(input: {
  current: string;
  readableCandidates: readonly string[];
}): string[] {
  const keys = [...new Set([input.current, ...input.readableCandidates])];
  if (keys.some((value) => !value.trim())) {
    throw new TypeError("Hosted usage-credit reversal requires source lookup keys.");
  }
  return keys;
}

function resolveHostedUsageCreditCanonicalSourceLookupKey(input: {
  current: string;
  entries: Array<{
    sourceReferenceLookupKey: string | null;
  }>;
}): string {
  const stored = input.entries[0]?.sourceReferenceLookupKey;
  if (stored === null || stored === undefined) {
    return input.current;
  }
  if (!stored.trim()) {
    throw new TypeError("Hosted usage-credit reversal stored an invalid source lookup key.");
  }
  return stored;
}
