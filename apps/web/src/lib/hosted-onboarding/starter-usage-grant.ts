import type { Prisma } from "@prisma/client";

import {
  appendHostedUsageCreditGrantTx,
} from "../hosted-execution/usage-credit-grant";
import {
  lockHostedUsageCreditBeneficiaryTx,
  type LockedHostedUsageCreditBeneficiary,
} from "../hosted-execution/usage-credit-ledger";
import {
  HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
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
 * and retries all converge on one balance owner.
 */
export async function ensureHostedStarterUsageGrantTx(input: {
  effectiveAt: Date;
  existingGrant?: HostedStarterUsageGrantSnapshot | null;
  lockedBeneficiary?: LockedHostedUsageCreditBeneficiary;
  memberId: string;
  source: Exclude<HostedStarterUsageSource, "legacy_trial_migration">;
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
  return {
    ...appended,
    effectiveAt: input.effectiveAt,
  };
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
