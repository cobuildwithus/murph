import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedUsageCreditGrantTx: vi.fn(),
  lockHostedUsageCreditBeneficiaryTx: vi.fn(),
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
    lockHostedUsageCreditBeneficiaryTx:
      mocks.lockHostedUsageCreditBeneficiaryTx,
  };
});

import {
  ensureHostedStarterUsageGrantTx,
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

function txWithEntry(entry: ReturnType<typeof validEntry> | null) {
  return {
    hostedUsageCreditEntry: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => entry),
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

  it.each([0n, 1_250_000n, 4_500_000n])(
    "preserves migrated grant history and its %s remaining balance on enrollment replay",
    async (remainingUsdMicros) => {
      const entry = {
        ...validLegacyMigrationEntry(),
        grant: { remainingUsdMicros },
      };
      const tx = txWithEntry(entry);
      await expect(readHostedStarterUsageGrantTx({
        memberId: "member_123",
        tx: tx as never,
      })).resolves.toEqual(entry);
      await expect(ensureHostedStarterUsageGrantTx({
        effectiveAt: new Date("2026-09-10T00:00:00.000Z"),
        memberId: "member_123",
        source: "web_onboarding",
        tx: tx as never,
      })).resolves.toMatchObject({
        effectiveAt: EFFECTIVE_AT,
        entryId: entry.id,
        granted: false,
      });
      expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
      expect(tx.hostedUsageCreditEntry.create).not.toHaveBeenCalled();
    },
  );

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
