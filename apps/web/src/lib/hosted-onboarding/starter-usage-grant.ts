import type { Prisma } from "@prisma/client";

import { generateHostedRandomPrefixedId } from "../primitives";
import {
  appendHostedUsageCreditGrantTx,
} from "../hosted-execution/usage-credit-grant";
import {
  applyHostedUsageCreditProjectionDeltaTx,
  lockHostedUsageCreditBeneficiaryTx,
  reconcileHostedUsageCreditCurrentPeriodBlockTx,
  type LockedHostedUsageCreditBeneficiary,
} from "../hosted-execution/usage-credit-ledger";
import {
  HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
  HOSTED_STARTER_USAGE_POLICY_VERSION,
  buildHostedStarterUsageSemanticSourceKey,
  buildHostedStarterUsageSourceReferenceLookupKey,
  parseHostedStarterUsageSourceReferenceLookupKey,
  type HostedStarterUsageSource,
} from "./starter-usage";

export interface HostedStarterUsageGrantSnapshot {
  amountUsdMicros: bigint;
  beneficiaryMemberId: string;
  effectiveAt: Date;
  grant: { remainingUsdMicros: bigint } | null;
  id: string;
  kind: string;
  parentGrantEntryId: string | null;
  purchaseId: string | null;
  referralId: string | null;
  sourceReferenceLookupKey: string | null;
}

export interface HostedStarterUsageGrantResult {
  balanceUsdMicros: bigint;
  effectiveAt: Date;
  entryId: string;
  granted: boolean;
  ledgerVersion: bigint;
}

export async function readHostedStarterUsageGrantTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedStarterUsageGrantSnapshot | null> {
  const entry = await input.tx.hostedUsageCreditEntry.findUnique({
    where: {
      semanticSourceKey: buildHostedStarterUsageSemanticSourceKey(
        input.memberId,
      ),
    },
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
      sourceReferenceLookupKey: true,
    },
  });

  if (entry) {
    assertHostedStarterUsageGrantInvariant({
      entry,
      memberId: input.memberId,
    });
  }
  return entry;
}

/**
 * Creates the single policy-versioned Starter grant or returns its existing
 * immutable ledger entry. Callers share the beneficiary lock with every other
 * credit mutation, so web signup, companion signup, iMessage instant start,
 * migration compatibility, and retries all converge on one balance owner.
 */
export async function ensureHostedStarterUsageGrantTx(input: {
  effectiveAt: Date;
  existingGrant?: HostedStarterUsageGrantSnapshot | null;
  initialConsumedUsdMicros?: bigint;
  lockedBeneficiary?: LockedHostedUsageCreditBeneficiary;
  memberId: string;
  source: HostedStarterUsageSource;
  tx: Prisma.TransactionClient;
}): Promise<HostedStarterUsageGrantResult> {
  const lockedBeneficiary = input.lockedBeneficiary
    ?? await lockHostedUsageCreditBeneficiaryTx({
      beneficiaryMemberId: input.memberId,
      tx: input.tx,
    });
  if (lockedBeneficiary.beneficiaryMemberId !== input.memberId) {
    throw new TypeError("Hosted Starter beneficiary lock has a different owner.");
  }

  const initialConsumedUsdMicros = input.initialConsumedUsdMicros ?? 0n;
  if (
    initialConsumedUsdMicros < 0n
    || initialConsumedUsdMicros > HOSTED_STARTER_USAGE_GRANT_USD_MICROS
  ) {
    throw new TypeError("Hosted Starter initial consumption is out of range.");
  }
  if (
    initialConsumedUsdMicros > 0n
    && input.source !== "legacy_trial_migration"
  ) {
    throw new TypeError(
      "Only legacy-trial cutover may initialize a partially consumed Starter grant.",
    );
  }

  const existingGrant = input.existingGrant === undefined
    ? await readHostedStarterUsageGrantTx({
      memberId: input.memberId,
      tx: input.tx,
    })
    : input.existingGrant;
  if (existingGrant) {
    assertHostedStarterUsageGrantInvariant({
      entry: existingGrant,
      memberId: input.memberId,
    });
    if (initialConsumedUsdMicros > 0n) {
      await assertHostedStarterUsageLegacyConsumptionReplayTx({
        existingGrant,
        initialConsumedUsdMicros,
        memberId: input.memberId,
        tx: input.tx,
      });
    }
    return {
      balanceUsdMicros: lockedBeneficiary.balanceUsdMicros,
      effectiveAt: existingGrant.effectiveAt,
      entryId: existingGrant.id,
      granted: false,
      ledgerVersion: lockedBeneficiary.ledgerVersion,
    };
  }

  const appended = await appendHostedUsageCreditGrantTx({
    effectiveAt: input.effectiveAt,
    grantUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
    lockedBeneficiary,
    semanticSourceKey: buildHostedStarterUsageSemanticSourceKey(input.memberId),
    source: {
      kind: "starter",
      sourceReferenceLookupKey:
        buildHostedStarterUsageSourceReferenceLookupKey(input.source),
    },
    tx: input.tx,
  });
  if (initialConsumedUsdMicros === 0n) {
    return {
      ...appended,
      effectiveAt: input.effectiveAt,
    };
  }

  if (!appended.granted) {
    throw new TypeError(
      "Hosted Starter cutover found an unexpected concurrent grant replay.",
    );
  }
  const remainingUsdMicros =
    HOSTED_STARTER_USAGE_GRANT_USD_MICROS - initialConsumedUsdMicros;
  const updatedGrant = await input.tx.hostedUsageCreditGrant.updateMany({
    data: { remainingUsdMicros },
    where: {
      entryId: appended.entryId,
      remainingUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
    },
  });
  if (updatedGrant.count !== 1) {
    throw new TypeError(
      "Hosted Starter cutover lost its newly created grant projection.",
    );
  }

  const projection = await applyHostedUsageCreditProjectionDeltaTx({
    deltaUsdMicros: -initialConsumedUsdMicros,
    locked: {
      balanceUsdMicros: appended.balanceUsdMicros,
      beneficiaryMemberId: input.memberId,
      ledgerVersion: appended.ledgerVersion,
    },
    tx: input.tx,
  });
  const sourceUsageId = buildHostedStarterUsageLegacyConsumptionSourceUsageId(
    input.memberId,
  );
  await input.tx.hostedUsageCreditEntry.create({
    data: {
      amountUsdMicros: -initialConsumedUsdMicros,
      beneficiaryMemberId: input.memberId,
      beneficiarySequence: projection.ledgerVersion,
      effectiveAt: input.effectiveAt,
      id: generateHostedRandomPrefixedId("huce"),
      kind: "usage_debit",
      parentGrantEntryId: appended.entryId,
      semanticSourceKey:
        buildHostedStarterUsageLegacyConsumptionSemanticSourceKey({
          grantEntryId: appended.entryId,
          memberId: input.memberId,
        }),
      sourceUsageId,
    },
  });
  await reconcileHostedUsageCreditCurrentPeriodBlockTx({
    balanceUsdMicros: projection.balanceUsdMicros,
    beneficiaryMemberId: input.memberId,
    effectiveAt: input.effectiveAt,
    tx: input.tx,
  });

  return {
    balanceUsdMicros: projection.balanceUsdMicros,
    effectiveAt: input.effectiveAt,
    entryId: appended.entryId,
    granted: true,
    ledgerVersion: projection.ledgerVersion,
  };
}

async function assertHostedStarterUsageLegacyConsumptionReplayTx(input: {
  existingGrant: HostedStarterUsageGrantSnapshot;
  initialConsumedUsdMicros: bigint;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const grantSource = parseHostedStarterUsageSourceReferenceLookupKey(
    input.existingGrant.sourceReferenceLookupKey,
  );
  if (grantSource !== "legacy_trial_migration") {
    throw new TypeError(
      "Hosted Starter cutover found unreconciled legacy consumption.",
    );
  }

  const sourceUsageId = buildHostedStarterUsageLegacyConsumptionSourceUsageId(
    input.memberId,
  );
  const debit = await input.tx.hostedUsageCreditEntry.findUnique({
    where: {
      semanticSourceKey:
        buildHostedStarterUsageLegacyConsumptionSemanticSourceKey({
          grantEntryId: input.existingGrant.id,
          memberId: input.memberId,
        }),
    },
    select: {
      amountUsdMicros: true,
      beneficiaryMemberId: true,
      kind: true,
      parentGrantEntryId: true,
      purchaseId: true,
      referralId: true,
      sourceReferenceLookupKey: true,
      sourceUsageId: true,
    },
  });
  const expectedRemainingUsdMicros =
    HOSTED_STARTER_USAGE_GRANT_USD_MICROS - input.initialConsumedUsdMicros;
  const actualRemainingUsdMicros =
    input.existingGrant.grant?.remainingUsdMicros ?? -1n;
  if (
    actualRemainingUsdMicros < 0n
    || actualRemainingUsdMicros > expectedRemainingUsdMicros
    || !debit
    || debit.amountUsdMicros !== -input.initialConsumedUsdMicros
    || debit.beneficiaryMemberId !== input.memberId
    || debit.kind !== "usage_debit"
    || debit.parentGrantEntryId !== input.existingGrant.id
    || debit.purchaseId !== null
    || debit.referralId !== null
    || debit.sourceReferenceLookupKey !== null
    || debit.sourceUsageId !== sourceUsageId
  ) {
    throw new TypeError(
      "Hosted Starter cutover found unreconciled legacy consumption.",
    );
  }
}

export async function readHostedLegacyTrialConsumedUsageUsdMicrosTx(input: {
  memberId: string;
  trialStartedAt: Date | null;
  tx: Prisma.TransactionClient;
}): Promise<bigint> {
  if (!input.trialStartedAt) {
    return 0n;
  }
  const period = await input.tx.hostedAiUsagePeriod.findUnique({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: input.trialStartedAt,
      },
    },
    select: {
      limitUsdMicros: true,
      spentUsdMicros: true,
    },
  });
  if (!period) {
    return 0n;
  }
  const limitUsdMicros = BigInt(period.limitUsdMicros);
  const spentUsdMicros = BigInt(period.spentUsdMicros);
  if (limitUsdMicros < 0n || spentUsdMicros < 0n) {
    throw new TypeError("Hosted legacy-trial usage period is malformed.");
  }

  const boundedLimit = limitUsdMicros < HOSTED_STARTER_USAGE_GRANT_USD_MICROS
    ? limitUsdMicros
    : HOSTED_STARTER_USAGE_GRANT_USD_MICROS;
  const remainingUsdMicros = boundedLimit > spentUsdMicros
    ? boundedLimit - spentUsdMicros
    : 0n;
  return HOSTED_STARTER_USAGE_GRANT_USD_MICROS - remainingUsdMicros;
}

function buildHostedStarterUsageLegacyConsumptionSourceUsageId(
  memberId: string,
): string {
  return `starter-usage-migration:${memberId}:${HOSTED_STARTER_USAGE_POLICY_VERSION}`;
}

function buildHostedStarterUsageLegacyConsumptionSemanticSourceKey(input: {
  grantEntryId: string;
  memberId: string;
}): string {
  return `hosted-usage-credit:usage:${buildHostedStarterUsageLegacyConsumptionSourceUsageId(input.memberId)}:grant:${input.grantEntryId}:debit:v1`;
}

export function assertHostedStarterUsageGrantInvariant(input: {
  entry: Pick<
    HostedStarterUsageGrantSnapshot,
    | "amountUsdMicros"
    | "beneficiaryMemberId"
    | "grant"
    | "kind"
    | "parentGrantEntryId"
    | "purchaseId"
    | "referralId"
    | "sourceReferenceLookupKey"
  >;
  memberId: string;
}): void {
  const source = parseHostedStarterUsageSourceReferenceLookupKey(
    input.entry.sourceReferenceLookupKey,
  );
  const remainingUsdMicros = input.entry.grant?.remainingUsdMicros ?? -1n;
  if (
    input.entry.amountUsdMicros !== HOSTED_STARTER_USAGE_GRANT_USD_MICROS
    || input.entry.beneficiaryMemberId !== input.memberId
    || input.entry.kind !== "starter_grant"
    || input.entry.parentGrantEntryId !== null
    || input.entry.purchaseId !== null
    || input.entry.referralId !== null
    || source === null
    || remainingUsdMicros < 0n
    || remainingUsdMicros > input.entry.amountUsdMicros
  ) {
    throw new TypeError("Hosted starter-usage grant invariant failed.");
  }
}
