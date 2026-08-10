import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedUsageCreditGrantTx: vi.fn(),
  applyHostedUsageCreditProjectionDeltaTx: vi.fn(),
  lockHostedUsageCreditBeneficiaryTx: vi.fn(),
  reconcileHostedUsageCreditCurrentPeriodBlockTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-credit-grant", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-credit-grant")
  >("@/src/lib/hosted-execution/usage-credit-grant");
  return {
    ...actual,
    appendHostedUsageCreditGrantTx: mocks.appendHostedUsageCreditGrantTx,
  };
});

vi.mock("@/src/lib/hosted-execution/usage-credit-ledger", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-credit-ledger")
  >("@/src/lib/hosted-execution/usage-credit-ledger");
  return {
    ...actual,
    applyHostedUsageCreditProjectionDeltaTx:
      mocks.applyHostedUsageCreditProjectionDeltaTx,
    lockHostedUsageCreditBeneficiaryTx:
      mocks.lockHostedUsageCreditBeneficiaryTx,
    reconcileHostedUsageCreditCurrentPeriodBlockTx:
      mocks.reconcileHostedUsageCreditCurrentPeriodBlockTx,
  };
});

import {
  ensureHostedStarterUsageGrantTx,
  readHostedLegacyTrialConsumedUsageUsdMicrosTx,
  readHostedStarterUsageGrantTx,
} from "@/src/lib/hosted-onboarding/starter-usage-grant";
import {
  buildHostedStarterUsageSemanticSourceKey,
  buildHostedStarterUsageSourceReferenceLookupKey,
} from "@/src/lib/hosted-onboarding/starter-usage";

const EFFECTIVE_AT = new Date("2026-08-07T20:00:00.000Z");

function validEntry() {
  return {
    amountUsdMicros: 4_500_000n,
    beneficiaryMemberId: "member_123",
    effectiveAt: EFFECTIVE_AT,
    grant: { remainingUsdMicros: 3_000_000n },
    id: "huce_starter",
    kind: "starter_grant",
    parentGrantEntryId: null,
    purchaseId: null,
    referralId: null,
    sourceReferenceLookupKey:
      buildHostedStarterUsageSourceReferenceLookupKey("web_onboarding"),
  };
}

function validLegacyMigrationEntry() {
  return {
    ...validEntry(),
    sourceReferenceLookupKey:
      buildHostedStarterUsageSourceReferenceLookupKey(
        "legacy_trial_migration",
      ),
  };
}

function validLegacyConsumptionDebit(amountUsdMicros = -1_500_000n) {
  return {
    amountUsdMicros,
    beneficiaryMemberId: "member_123",
    kind: "usage_debit",
    parentGrantEntryId: "huce_starter",
    purchaseId: null,
    referralId: null,
    sourceReferenceLookupKey: null,
    sourceUsageId:
      "starter-usage-migration:member_123:starter-usage-2026-08-07-v1",
  };
}

function txWithEntry(
  entry: ReturnType<typeof validEntry> | null,
  period: { limitUsdMicros: bigint; spentUsdMicros: bigint } | null = null,
  legacyConsumptionDebit:
    | ReturnType<typeof validLegacyConsumptionDebit>
    | null = null,
) {
  return {
    hostedAiUsagePeriod: {
      findUnique: vi.fn(async () => period),
    },
    hostedUsageCreditEntry: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async (input: {
        where: { semanticSourceKey: string };
      }) => input.where.semanticSourceKey ===
          buildHostedStarterUsageSemanticSourceKey("member_123")
        ? entry
        : legacyConsumptionDebit),
    },
    hostedUsageCreditGrant: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

describe("hosted Starter usage grant owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedUsageCreditBeneficiaryTx.mockResolvedValue({
      balanceUsdMicros: 2_000_000n,
      beneficiaryMemberId: "member_123",
      ledgerVersion: 7n,
    });
    mocks.appendHostedUsageCreditGrantTx.mockResolvedValue({
      balanceUsdMicros: 6_500_000n,
      entryId: "huce_created",
      granted: true,
      ledgerVersion: 8n,
    });
    mocks.applyHostedUsageCreditProjectionDeltaTx.mockResolvedValue({
      balanceUsdMicros: 5_000_000n,
      beneficiaryMemberId: "member_123",
      ledgerVersion: 9n,
    });
    mocks.reconcileHostedUsageCreditCurrentPeriodBlockTx.mockResolvedValue(
      undefined,
    );
  });

  it("creates the canonical immutable grant through the shared ledger owner", async () => {
    const tx = txWithEntry(null);

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      memberId: "member_123",
      source: "web_onboarding",
      tx: tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 6_500_000n,
      effectiveAt: EFFECTIVE_AT,
      entryId: "huce_created",
      granted: true,
      ledgerVersion: 8n,
    });

    expect(mocks.appendHostedUsageCreditGrantTx).toHaveBeenCalledWith({
      effectiveAt: EFFECTIVE_AT,
      grantUsdMicros: 4_500_000n,
      lockedBeneficiary: {
        balanceUsdMicros: 2_000_000n,
        beneficiaryMemberId: "member_123",
        ledgerVersion: 7n,
      },
      semanticSourceKey:
        buildHostedStarterUsageSemanticSourceKey("member_123"),
      source: {
        kind: "starter",
        sourceReferenceLookupKey:
          buildHostedStarterUsageSourceReferenceLookupKey("web_onboarding"),
      },
      tx,
    });
  });

  it("records legacy consumption against the new Starter grant without touching older credits", async () => {
    const tx = txWithEntry(null);

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      initialConsumedUsdMicros: 1_500_000n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 5_000_000n,
      effectiveAt: EFFECTIVE_AT,
      entryId: "huce_created",
      granted: true,
      ledgerVersion: 9n,
    });

    expect(tx.hostedUsageCreditGrant.updateMany).toHaveBeenCalledWith({
      data: { remainingUsdMicros: 3_000_000n },
      where: {
        entryId: "huce_created",
        remainingUsdMicros: 4_500_000n,
      },
    });
    expect(mocks.applyHostedUsageCreditProjectionDeltaTx).toHaveBeenCalledWith({
      deltaUsdMicros: -1_500_000n,
      locked: {
        balanceUsdMicros: 6_500_000n,
        beneficiaryMemberId: "member_123",
        ledgerVersion: 8n,
      },
      tx,
    });
    expect(tx.hostedUsageCreditEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountUsdMicros: -1_500_000n,
        beneficiaryMemberId: "member_123",
        beneficiarySequence: 9n,
        kind: "usage_debit",
        parentGrantEntryId: "huce_created",
        sourceUsageId:
          "starter-usage-migration:member_123:starter-usage-2026-08-07-v1",
      }),
    });
  });

  it("derives bounded legacy consumption from the exact trial period", async () => {
    const trialStartedAt = new Date("2026-07-10T12:00:00.000Z");
    const tx = txWithEntry(null, {
      limitUsdMicros: 4_500_000n,
      spentUsdMicros: 1_750_000n,
    });

    await expect(readHostedLegacyTrialConsumedUsageUsdMicrosTx({
      memberId: "member_123",
      trialStartedAt,
      tx: tx as never,
    })).resolves.toBe(1_750_000n);
    expect(tx.hostedAiUsagePeriod.findUnique).toHaveBeenCalledWith({
      where: {
        memberId_periodStart: {
          memberId: "member_123",
          periodStart: trialStartedAt,
        },
      },
      select: {
        limitUsdMicros: true,
        spentUsdMicros: true,
      },
    });
  });

  it("treats a lower legacy limit as already consumed rather than granting extra capacity", async () => {
    await expect(readHostedLegacyTrialConsumedUsageUsdMicrosTx({
      memberId: "member_123",
      trialStartedAt: EFFECTIVE_AT,
      tx: txWithEntry(null, {
        limitUsdMicros: 4_000_000n,
        spentUsdMicros: 1_000_000n,
      }) as never,
    })).resolves.toBe(1_500_000n);
  });

  it("returns zero when the legacy trial period was never materialized", async () => {
    const tx = txWithEntry(null);

    await expect(readHostedLegacyTrialConsumedUsageUsdMicrosTx({
      memberId: "member_123",
      trialStartedAt: EFFECTIVE_AT,
      tx: tx as never,
    })).resolves.toBe(0n);
    await expect(readHostedLegacyTrialConsumedUsageUsdMicrosTx({
      memberId: "member_123",
      trialStartedAt: null,
      tx: tx as never,
    })).resolves.toBe(0n);
  });

  it("caps legacy consumption at the canonical Starter grant", async () => {
    await expect(readHostedLegacyTrialConsumedUsageUsdMicrosTx({
      memberId: "member_123",
      trialStartedAt: EFFECTIVE_AT,
      tx: txWithEntry(null, {
        limitUsdMicros: 8_000_000n,
        spentUsdMicros: 9_000_000n,
      }) as never,
    })).resolves.toBe(4_500_000n);
  });

  it("rejects invalid or non-migration initial consumption", async () => {
    const tx = txWithEntry(null);

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      initialConsumedUsdMicros: 4_500_001n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: tx as never,
    })).rejects.toThrow("Hosted Starter initial consumption is out of range.");
    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      initialConsumedUsdMicros: 1n,
      memberId: "member_123",
      source: "web_onboarding",
      tx: tx as never,
    })).rejects.toThrow(
      "Only legacy-trial cutover may initialize a partially consumed Starter grant.",
    );
    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("returns the existing immutable grant without appending another entry", async () => {
    const entry = validEntry();
    const tx = txWithEntry(entry);

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: new Date("2026-08-09T20:00:00.000Z"),
      memberId: "member_123",
      source: "companion_onboarding",
      tx: tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 2_000_000n,
      effectiveAt: EFFECTIVE_AT,
      entryId: "huce_starter",
      granted: false,
      ledgerVersion: 7n,
    });

    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("accepts an exact replay after legacy consumption was already reconciled", async () => {
    const entry = validLegacyMigrationEntry();
    const tx = txWithEntry(
      entry,
      null,
      validLegacyConsumptionDebit(),
    );

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: new Date("2026-08-09T20:00:00.000Z"),
      initialConsumedUsdMicros: 1_500_000n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 2_000_000n,
      effectiveAt: EFFECTIVE_AT,
      entryId: "huce_starter",
      granted: false,
      ledgerVersion: 7n,
    });

    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("accepts a reconciled legacy grant after later Starter usage reduced its remaining balance", async () => {
    const entry = {
      ...validLegacyMigrationEntry(),
      grant: { remainingUsdMicros: 2_250_000n },
    };
    const tx = txWithEntry(
      entry,
      null,
      validLegacyConsumptionDebit(),
    );

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: new Date("2026-08-09T20:00:00.000Z"),
      initialConsumedUsdMicros: 1_500_000n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 2_000_000n,
      effectiveAt: EFFECTIVE_AT,
      entryId: "huce_starter",
      granted: false,
      ledgerVersion: 7n,
    });

    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("fails closed when late legacy consumption finds a non-migration Starter grant", async () => {
    const tx = txWithEntry(validEntry());

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      initialConsumedUsdMicros: 1_500_000n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: tx as never,
    })).rejects.toThrow(
      "Hosted Starter cutover found unreconciled legacy consumption.",
    );

    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("fails closed when a migrated grant is missing its deterministic consumption debit", async () => {
    const tx = txWithEntry(validLegacyMigrationEntry());

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      initialConsumedUsdMicros: 1_500_000n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: tx as never,
    })).rejects.toThrow(
      "Hosted Starter cutover found unreconciled legacy consumption.",
    );

    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("fails closed when the migrated grant projection disagrees with its debit", async () => {
    const tx = txWithEntry(
      {
        ...validLegacyMigrationEntry(),
        grant: { remainingUsdMicros: 3_000_001n },
      },
      null,
      validLegacyConsumptionDebit(),
    );

    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      initialConsumedUsdMicros: 1_500_000n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: tx as never,
    })).rejects.toThrow(
      "Hosted Starter cutover found unreconciled legacy consumption.",
    );
  });

  it("rejects malformed existing Starter entries instead of normalizing them", async () => {
    const tx = txWithEntry({
      ...validEntry(),
      amountUsdMicros: 1n,
    });

    await expect(readHostedStarterUsageGrantTx({
      memberId: "member_123",
      tx: tx as never,
    })).rejects.toThrow("Hosted starter-usage grant invariant failed.");
  });

  it("rejects a beneficiary lock owned by another member", async () => {
    await expect(ensureHostedStarterUsageGrantTx({
      effectiveAt: EFFECTIVE_AT,
      existingGrant: null,
      lockedBeneficiary: {
        balanceUsdMicros: 0n,
        beneficiaryMemberId: "member_other",
        ledgerVersion: 0n,
      },
      memberId: "member_123",
      source: "web_onboarding",
      tx: txWithEntry(null) as never,
    })).rejects.toThrow("Hosted Starter beneficiary lock has a different owner.");

    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });
});
