import { describe, expect, it, vi } from "vitest";

import {
  grantHostedUsageCreditForPurchaseTx,
  lockHostedUsageCreditBeneficiaryTx,
  readHostedUsageCreditProjection,
  reconcileHostedUsageCreditDisputeNetReversalTx,
  reconcileHostedUsageCreditRefundNetReversalTx,
  settleHostedUsageCreditForUsageTx,
} from "@/src/lib/hosted-execution/usage-credits";

const BENEFICIARY_ID = "member_beneficiary";
const EFFECTIVE_AT = new Date("2026-07-16T15:00:00.000Z");
const PAID_AT = new Date("2026-07-16T14:59:58.000Z");

describe("hosted usage credits", () => {
  it("normalizes expand-phase nullable member projections to zero", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      usageCreditBalanceUsdMicros: null,
      usageCreditLedgerVersion: null,
    });

    await expect(readHostedUsageCreditProjection({
      beneficiaryMemberId: BENEFICIARY_ID,
      prisma: {
        hostedMember: { findUnique },
      } as never,
    })).resolves.toEqual({
      balanceUsdMicros: 0n,
      ledgerVersion: 0n,
    });
  });

  it("locks and normalizes the beneficiary projection", async () => {
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      expect(sql).toContain('FROM "hosted_member"');
      expect(sql).toContain("FOR UPDATE");
      return [{
        balanceUsdMicros: null,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion: null,
      }];
    });

    await expect(lockHostedUsageCreditBeneficiaryTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      tx: { $queryRaw: queryRaw } as never,
    })).resolves.toEqual({
      balanceUsdMicros: 0n,
      beneficiaryMemberId: BENEFICIARY_ID,
      ledgerVersion: 0n,
    });
  });

  it("grants a paid purchase under beneficiary-before-purchase locking", async () => {
    const events: string[] = [];
    const entryCreate = vi.fn(async (input: unknown) => {
      events.push("entry-create");
      return input;
    });
    const purchaseUpdateMany = vi.fn(async () => {
      events.push("purchase-update");
      return { count: 1 };
    });
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      if (sql.includes('FROM "hosted_member"')) {
        events.push("beneficiary-lock");
        return [{
          balanceUsdMicros: 0n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 0n,
        }];
      }
      if (sql.includes('FROM "hosted_usage_credit_purchase"')) {
        events.push("purchase-lock");
        return [buildLockedPurchase()];
      }
      if (sql.includes('UPDATE "hosted_member"')) {
        events.push("projection-update");
        return [{
          balanceUsdMicros: 5_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 1n,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const executeRaw = createTaggedSqlMock(({ sql }) => {
      events.push("period-unblock");
      expect(sql).toContain('UPDATE "hosted_ai_usage_period"');
      expect(sql).toContain('"blocked_at" = CASE');
      expect(sql).toContain("ELSE NULL");
      return 1;
    });
    const tx = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedUsageCreditEntry: {
        create: entryCreate,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedUsageCreditPurchase: {
        findUnique: vi.fn().mockImplementation(async () => {
          events.push("purchase-discovery");
          return { beneficiaryMemberId: BENEFICIARY_ID };
        }),
        updateMany: purchaseUpdateMany,
      },
    };

    await expect(grantHostedUsageCreditForPurchaseTx({
      effectiveAt: EFFECTIVE_AT,
      paidAt: PAID_AT,
      purchaseId: "purchase_1",
      tx: tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 5_000_000n,
      entryId: expect.stringMatching(/^huce_/u),
      granted: true,
      ledgerVersion: 1n,
    });

    expect(events.indexOf("beneficiary-lock"))
      .toBeLessThan(events.indexOf("purchase-lock"));
    expect(events).toEqual([
      "purchase-discovery",
      "beneficiary-lock",
      "purchase-lock",
      "projection-update",
      "entry-create",
      "purchase-update",
      "period-unblock",
    ]);
    expect(entryCreate).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        amountUsdMicros: 5_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 1n,
        effectiveAt: EFFECTIVE_AT,
        kind: "purchase_grant",
        purchaseId: "purchase_1",
        semanticSourceKey:
          "hosted-usage-credit:purchase:purchase_1:grant:v1",
      }),
    });
    expect(purchaseUpdateMany).toHaveBeenCalledExactlyOnceWith({
      data: {
        fulfilledAt: EFFECTIVE_AT,
        paidAt: PAID_AT,
        remainingCreditUsdMicros: 5_000_000n,
        status: "fulfilled",
        terminalAt: EFFECTIVE_AT,
      },
      where: {
        beneficiaryMemberId: BENEFICIARY_ID,
        id: "purchase_1",
        remainingCreditUsdMicros: 0n,
      },
    });
  });

  it("returns an existing purchase grant without mutating the ledger", async () => {
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 3_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 2n,
        }];
      }
      if (sql.includes('FROM "hosted_usage_credit_purchase"')) {
        return [buildLockedPurchase({
          fulfilledAt: EFFECTIVE_AT,
          paidAt: PAID_AT,
          remainingCreditUsdMicros: 3_000_000n,
          status: "fulfilled",
        })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const entryCreate = vi.fn();
    const purchaseUpdateMany = vi.fn();
    const executeRaw = vi.fn();

    await expect(grantHostedUsageCreditForPurchaseTx({
      effectiveAt: EFFECTIVE_AT,
      paidAt: PAID_AT,
      purchaseId: "purchase_1",
      tx: {
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          create: entryCreate,
          findFirst: vi.fn().mockResolvedValue({
            amountUsdMicros: 5_000_000n,
            beneficiaryMemberId: BENEFICIARY_ID,
            id: "grant_1",
            semanticSourceKey:
              "hosted-usage-credit:purchase:purchase_1:grant:v1",
          }),
        },
        hostedUsageCreditPurchase: {
          findUnique: vi.fn().mockResolvedValue({
            beneficiaryMemberId: BENEFICIARY_ID,
          }),
          updateMany: purchaseUpdateMany,
        },
      } as never,
    })).resolves.toEqual({
      balanceUsdMicros: 3_000_000n,
      entryId: "grant_1",
      granted: false,
      ledgerVersion: 2n,
    });

    expect(entryCreate).not.toHaveBeenCalled();
    expect(purchaseUpdateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("debits eligible grants FIFO, caps at available credit, and absorbs overrun", async () => {
    const createdEntries: Array<{ data: Record<string, unknown> }> = [];
    const projectionRows = [
      {
        balanceUsdMicros: 7_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion: 3n,
      },
      {
        balanceUsdMicros: 0n,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion: 4n,
      },
    ];
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 12_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 2n,
        }];
      }
      if (sql.includes('FROM "hosted_usage_credit_entry" AS entry')) {
        expect(sql).toContain('ORDER BY entry."beneficiary_sequence" ASC');
        expect(sql).toContain("FOR UPDATE OF entry, purchase");
        return [
          {
            beneficiarySequence: 1n,
            entryId: "grant_1",
            purchaseId: "purchase_1",
            remainingCreditUsdMicros: 5_000_000n,
          },
          {
            beneficiarySequence: 2n,
            entryId: "grant_2",
            purchaseId: "purchase_2",
            remainingCreditUsdMicros: 7_000_000n,
          },
        ];
      }
      if (sql.includes('UPDATE "hosted_member"')) {
        const row = projectionRows.shift();
        if (!row) throw new Error("Unexpected projection update.");
        return [row];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const purchaseUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const entryCreate = vi.fn(async (input: { data: Record<string, unknown> }) => {
      createdEntries.push(input);
      return input;
    });

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      creditEligibilitySequence: 2n,
      debitUsdMicros: 15_000_000n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_1",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          create: entryCreate,
          findMany: vi.fn().mockResolvedValue([]),
        },
        hostedUsageCreditPurchase: {
          updateMany: purchaseUpdateMany,
        },
      } as never,
    })).resolves.toEqual({
      absorbedUsdMicros: 3_000_000n,
      balanceUsdMicros: 0n,
      debitedUsdMicros: 12_000_000n,
      ledgerVersion: 4n,
    });

    expect(purchaseUpdateMany).toHaveBeenNthCalledWith(1, {
      data: { remainingCreditUsdMicros: 0n },
      where: {
        beneficiaryMemberId: BENEFICIARY_ID,
        id: "purchase_1",
        remainingCreditUsdMicros: 5_000_000n,
      },
    });
    expect(purchaseUpdateMany).toHaveBeenNthCalledWith(2, {
      data: { remainingCreditUsdMicros: 0n },
      where: {
        beneficiaryMemberId: BENEFICIARY_ID,
        id: "purchase_2",
        remainingCreditUsdMicros: 7_000_000n,
      },
    });
    expect(createdEntries.map((entry) => entry.data)).toEqual([
      expect.objectContaining({
        amountUsdMicros: -5_000_000n,
        beneficiarySequence: 3n,
        kind: "usage_debit",
        parentGrantEntryId: "grant_1",
        purchaseId: "purchase_1",
        semanticSourceKey:
          "hosted-usage-credit:usage:usage_1:grant:grant_1:debit:v1",
        sourceUsageId: "usage_1",
      }),
      expect.objectContaining({
        amountUsdMicros: -7_000_000n,
        beneficiarySequence: 4n,
        kind: "usage_debit",
        parentGrantEntryId: "grant_2",
        purchaseId: "purchase_2",
        semanticSourceKey:
          "hosted-usage-credit:usage:usage_1:grant:grant_2:debit:v1",
        sourceUsageId: "usage_1",
      }),
    ]);
  });

  it("treats a missing eligibility cutoff as no purchased-credit authority", async () => {
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 5_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 1n,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const entryCreate = vi.fn();
    const purchaseUpdateMany = vi.fn();

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      creditEligibilitySequence: null,
      debitUsdMicros: 2_000_000n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_legacy",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          create: entryCreate,
          findMany: vi.fn().mockResolvedValue([]),
        },
        hostedUsageCreditPurchase: {
          updateMany: purchaseUpdateMany,
        },
      } as never,
    })).resolves.toEqual({
      absorbedUsdMicros: 2_000_000n,
      balanceUsdMicros: 5_000_000n,
      debitedUsdMicros: 0n,
      ledgerVersion: 1n,
    });

    expect(entryCreate).not.toHaveBeenCalled();
    expect(purchaseUpdateMany).not.toHaveBeenCalled();
  });

  it("replays existing per-grant usage allocations without another debit", async () => {
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 9_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 8n,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const entryCreate = vi.fn();
    const purchaseUpdateMany = vi.fn();

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      creditEligibilitySequence: 6n,
      debitUsdMicros: 7_000_000n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_replay",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          create: entryCreate,
          findMany: vi.fn().mockResolvedValue([
            {
              amountUsdMicros: -5_000_000n,
              beneficiaryMemberId: BENEFICIARY_ID,
              parentGrantEntryId: "grant_1",
            },
            {
              amountUsdMicros: -2_000_000n,
              beneficiaryMemberId: BENEFICIARY_ID,
              parentGrantEntryId: "grant_2",
            },
          ]),
        },
        hostedUsageCreditPurchase: {
          updateMany: purchaseUpdateMany,
        },
      } as never,
    })).resolves.toEqual({
      absorbedUsdMicros: 0n,
      balanceUsdMicros: 9_000_000n,
      debitedUsdMicros: 7_000_000n,
      ledgerVersion: 8n,
    });

    expect(entryCreate).not.toHaveBeenCalled();
    expect(purchaseUpdateMany).not.toHaveBeenCalled();
  });

  it("converges a refund net reversal and reports credit it could not recover", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 4_000_000n,
      ledgerVersion: 5n,
      nextBalanceUsdMicros: 2_000_000n,
      nextLedgerVersion: 6n,
      remainingCreditUsdMicros: 2_000_000n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([{
      amountUsdMicros: -1_000_000n,
      beneficiaryMemberId: BENEFICIARY_ID,
      beneficiarySequence: 2n,
      parentGrantEntryId: "grant_1",
      sourceReferenceLookupKey: "refund_lookup_prior",
    }]).mockResolvedValueOnce([]);

    await expect(reconcileHostedUsageCreditRefundNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "refund_lookup_1",
      targetNetReversalUsdMicros: 5_000_000n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 2_000_000n,
      entryId: expect.stringMatching(/^huce_/u),
      ledgerVersion: 6n,
      netReversedUsdMicros: 3_000_000n,
      reversedNowUsdMicros: 2_000_000n,
      restoredNowUsdMicros: 0n,
      unmetTargetUsdMicros: 2_000_000n,
    });

    expect(fixture.purchaseUpdateMany).toHaveBeenCalledExactlyOnceWith({
      data: { remainingCreditUsdMicros: 0n },
      where: {
        beneficiaryMemberId: BENEFICIARY_ID,
        id: "purchase_1",
        remainingCreditUsdMicros: 2_000_000n,
        status: "fulfilled",
      },
    });
    expect(fixture.entryCreate).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        amountUsdMicros: -2_000_000n,
        beneficiarySequence: 6n,
        kind: "refund_reversal",
        parentGrantEntryId: "grant_1",
        semanticSourceKey:
          "hosted-usage-credit:refund:purchase:purchase_1:net:1000000:to:3000000:ledger:6:v2",
        sourceReferenceLookupKey: "refund_lookup_1",
      }),
    });
    expect(fixture.executeRaw).toHaveBeenCalledOnce();
  });

  it("replays an already-converged refund target without another entry", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 2_000_000n,
      ledgerVersion: 6n,
      remainingCreditUsdMicros: 2_000_000n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([{
      amountUsdMicros: -3_000_000n,
      beneficiaryMemberId: BENEFICIARY_ID,
      beneficiarySequence: 3n,
      parentGrantEntryId: "grant_1",
      sourceReferenceLookupKey: "refund_lookup_1",
    }]).mockResolvedValueOnce([]);

    await expect(reconcileHostedUsageCreditRefundNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "refund_lookup_1",
      targetNetReversalUsdMicros: 3_000_000n,
      tx: fixture.tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 2_000_000n,
      entryId: null,
      ledgerVersion: 6n,
      netReversedUsdMicros: 3_000_000n,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 0n,
      unmetTargetUsdMicros: 0n,
    });

    expect(fixture.entryCreate).not.toHaveBeenCalled();
    expect(fixture.purchaseUpdateMany).not.toHaveBeenCalled();
  });

  it("restores a failed refund target back to zero", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 2_000_000n,
      ledgerVersion: 6n,
      nextBalanceUsdMicros: 5_000_000n,
      nextLedgerVersion: 7n,
      remainingCreditUsdMicros: 2_000_000n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([{
      amountUsdMicros: -3_000_000n,
      beneficiaryMemberId: BENEFICIARY_ID,
      beneficiarySequence: 3n,
      parentGrantEntryId: "grant_1",
      sourceReferenceLookupKey: "refund_lookup_1",
    }]).mockResolvedValueOnce([]);

    await expect(reconcileHostedUsageCreditRefundNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "refund_lookup_failed",
      targetNetReversalUsdMicros: 0n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 5_000_000n,
      entryId: expect.stringMatching(/^huce_/u),
      ledgerVersion: 7n,
      netReversedUsdMicros: 0n,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 3_000_000n,
      unmetTargetUsdMicros: 0n,
    });

    expect(fixture.entryCreate).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        amountUsdMicros: 3_000_000n,
        beneficiarySequence: 7n,
        kind: "reversal_restoration",
        semanticSourceKey:
          "hosted-usage-credit:refund:purchase:purchase_1:net:3000000:to:0:ledger:7:v2",
        sourceReferenceLookupKey: "refund_lookup_failed",
      }),
    });
    expect(fixture.executeRaw).toHaveBeenCalledOnce();
  });

  it("converges aggregate refunds when the provenance source changes", async () => {
    const fixture = createStatefulFinancialCreditFixture({
      balanceUsdMicros: 5_000_000n,
      entries: [],
      ledgerVersion: 1n,
      remainingCreditUsdMicros: 5_000_000n,
    });

    const reconcileRefund = (
      sourceReferenceLookupKey: string,
      targetNetReversalUsdMicros: bigint,
    ) => reconcileHostedUsageCreditRefundNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey,
      targetNetReversalUsdMicros,
      tx: fixture.tx as never,
    });

    await expect(reconcileRefund("refund_lookup_r1", 2_500_000n))
      .resolves.toMatchObject({
        balanceUsdMicros: 2_500_000n,
        netReversedUsdMicros: 2_500_000n,
        reversedNowUsdMicros: 2_500_000n,
      });
    await expect(reconcileRefund("refund_lookup_r2", 5_000_000n))
      .resolves.toMatchObject({
        balanceUsdMicros: 0n,
        netReversedUsdMicros: 5_000_000n,
        reversedNowUsdMicros: 2_500_000n,
      });
    await expect(reconcileRefund("refund_lookup_r1", 2_500_000n))
      .resolves.toMatchObject({
        balanceUsdMicros: 2_500_000n,
        netReversedUsdMicros: 2_500_000n,
        restoredNowUsdMicros: 2_500_000n,
      });
    await expect(reconcileRefund("refund_lookup_r2", 0n))
      .resolves.toMatchObject({
        balanceUsdMicros: 5_000_000n,
        netReversedUsdMicros: 0n,
        restoredNowUsdMicros: 2_500_000n,
        unmetTargetUsdMicros: 0n,
      });

    expect(fixture.entryCreate.mock.calls.map(([value]) => ({
      amountUsdMicros: value.data.amountUsdMicros,
      kind: value.data.kind,
      sourceReferenceLookupKey: value.data.sourceReferenceLookupKey,
    }))).toEqual([
      {
        amountUsdMicros: -2_500_000n,
        kind: "refund_reversal",
        sourceReferenceLookupKey: "refund_lookup_r1",
      },
      {
        amountUsdMicros: -2_500_000n,
        kind: "refund_reversal",
        sourceReferenceLookupKey: "refund_lookup_r2",
      },
      {
        amountUsdMicros: 2_500_000n,
        kind: "reversal_restoration",
        sourceReferenceLookupKey: "refund_lookup_r1",
      },
      {
        amountUsdMicros: 2_500_000n,
        kind: "reversal_restoration",
        sourceReferenceLookupKey: "refund_lookup_r2",
      },
    ]);
  });

  it("converges a dispute net reversal per blind dispute lookup key", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 7_000_000n,
      ledgerVersion: 4n,
      nextBalanceUsdMicros: 5_000_000n,
      nextLedgerVersion: 5n,
      remainingCreditUsdMicros: 4_000_000n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([{
      amountUsdMicros: -1_000_000n,
      beneficiaryMemberId: BENEFICIARY_ID,
      beneficiarySequence: 2n,
      parentGrantEntryId: "grant_1",
      sourceReferenceLookupKey: "dispute_lookup_1",
    }]).mockResolvedValueOnce([]);

    await expect(reconcileHostedUsageCreditDisputeNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "dispute_lookup_1",
      sourceReferenceLookupKeyCandidates: ["dispute_lookup_1"],
      targetNetReversalUsdMicros: 3_000_000n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 5_000_000n,
      ledgerVersion: 5n,
      netReversedUsdMicros: 3_000_000n,
      reversedNowUsdMicros: 2_000_000n,
      restoredNowUsdMicros: 0n,
      unmetTargetUsdMicros: 0n,
    });

    expect(fixture.entryFindMany).toHaveBeenNthCalledWith(1, {
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
      where: {
        kind: "dispute_reversal",
        purchaseId: "purchase_1",
        sourceReferenceLookupKey: {
          in: ["dispute_lookup_1"],
        },
      },
    });
    expect(fixture.entryCreate).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        amountUsdMicros: -2_000_000n,
        kind: "dispute_reversal",
        semanticSourceKey:
          "hosted-usage-credit:dispute:dispute_lookup_1:net:1000000:to:3000000:ledger:5:v2",
      }),
    });
  });

  it("partially restores a dispute and keeps its original lookup key across rotation", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 2_000_000n,
      ledgerVersion: 7n,
      nextBalanceUsdMicros: 3_000_000n,
      nextLedgerVersion: 8n,
      remainingCreditUsdMicros: 2_000_000n,
    });
    fixture.entryFindMany
      .mockResolvedValueOnce([{
        amountUsdMicros: -3_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 2n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_old",
      }])
      .mockResolvedValueOnce([{
        amountUsdMicros: 1_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 4n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_old",
      }]);

    await expect(reconcileHostedUsageCreditDisputeNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "dispute_lookup_new",
      sourceReferenceLookupKeyCandidates: [
        "dispute_lookup_new",
        "dispute_lookup_old",
      ],
      targetNetReversalUsdMicros: 1_000_000n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 3_000_000n,
      ledgerVersion: 8n,
      netReversedUsdMicros: 1_000_000n,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 1_000_000n,
      unmetTargetUsdMicros: 0n,
    });

    expect(fixture.entryFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        kind: "reversal_restoration",
        semanticSourceKey: {
          startsWith: "hosted-usage-credit:dispute:",
        },
        sourceReferenceLookupKey: {
          in: ["dispute_lookup_new", "dispute_lookup_old"],
        },
      }),
    }));
    expect(fixture.entryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountUsdMicros: 1_000_000n,
        kind: "reversal_restoration",
        semanticSourceKey:
          "hosted-usage-credit:dispute:dispute_lookup_old:net:2000000:to:1000000:ledger:8:v2",
        sourceReferenceLookupKey: "dispute_lookup_old",
      }),
    });
  });

  it("does not append another dispute entry after the net target converges", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 3_000_000n,
      ledgerVersion: 8n,
      remainingCreditUsdMicros: 3_000_000n,
    });
    fixture.entryFindMany
      .mockResolvedValueOnce([{
        amountUsdMicros: -3_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 2n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_1",
      }])
      .mockResolvedValueOnce([{
        amountUsdMicros: 1_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 4n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_1",
      }]);

    await expect(reconcileHostedUsageCreditDisputeNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "dispute_lookup_1",
      sourceReferenceLookupKeyCandidates: ["dispute_lookup_1"],
      targetNetReversalUsdMicros: 2_000_000n,
      tx: fixture.tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 3_000_000n,
      entryId: null,
      ledgerVersion: 8n,
      netReversedUsdMicros: 2_000_000n,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 0n,
      unmetTargetUsdMicros: 0n,
    });

    expect(fixture.entryCreate).not.toHaveBeenCalled();
    expect(fixture.purchaseUpdateMany).not.toHaveBeenCalled();
  });

  it("reports an unmet dispute target when overlapping exposure consumed the credit", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 0n,
      ledgerVersion: 5n,
      remainingCreditUsdMicros: 0n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(reconcileHostedUsageCreditDisputeNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "dispute_lookup_waiting",
      sourceReferenceLookupKeyCandidates: ["dispute_lookup_waiting"],
      targetNetReversalUsdMicros: 5_000_000n,
      tx: fixture.tx as never,
    })).resolves.toEqual({
      balanceUsdMicros: 0n,
      entryId: null,
      ledgerVersion: 5n,
      netReversedUsdMicros: 0n,
      reversedNowUsdMicros: 0n,
      restoredNowUsdMicros: 0n,
      unmetTargetUsdMicros: 5_000_000n,
    });

    expect(fixture.entryCreate).not.toHaveBeenCalled();
    expect(fixture.purchaseUpdateMany).not.toHaveBeenCalled();
    expect(fixture.executeRaw).not.toHaveBeenCalled();
  });

  it("restores one dispute before retrying an overlapping target", async () => {
    const fixture = createStatefulFinancialCreditFixture({
      balanceUsdMicros: 0n,
      entries: [
        buildFinancialEntry({
          amountUsdMicros: -3_000_000n,
          beneficiarySequence: 2n,
          sourceReferenceLookupKey: "dispute_lookup_a",
        }),
        buildFinancialEntry({
          amountUsdMicros: -2_000_000n,
          beneficiarySequence: 3n,
          sourceReferenceLookupKey: "dispute_lookup_b",
        }),
      ],
      ledgerVersion: 3n,
      remainingCreditUsdMicros: 0n,
    });

    await expect(reconcileHostedUsageCreditDisputeNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "dispute_lookup_a",
      sourceReferenceLookupKeyCandidates: ["dispute_lookup_a"],
      targetNetReversalUsdMicros: 1_000_000n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 2_000_000n,
      ledgerVersion: 4n,
      netReversedUsdMicros: 1_000_000n,
      restoredNowUsdMicros: 2_000_000n,
      unmetTargetUsdMicros: 0n,
    });

    await expect(reconcileHostedUsageCreditDisputeNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "dispute_lookup_b",
      sourceReferenceLookupKeyCandidates: ["dispute_lookup_b"],
      targetNetReversalUsdMicros: 5_000_000n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 0n,
      ledgerVersion: 5n,
      netReversedUsdMicros: 4_000_000n,
      reversedNowUsdMicros: 2_000_000n,
      unmetTargetUsdMicros: 1_000_000n,
    });

    expect(fixture.entryCreate.mock.calls.map(([value]) => value.data))
      .toEqual([
        expect.objectContaining({
          amountUsdMicros: 2_000_000n,
          kind: "reversal_restoration",
        }),
        expect.objectContaining({
          amountUsdMicros: -2_000_000n,
          kind: "dispute_reversal",
        }),
      ]);
  });

  it("restores a refund before retrying an active dispute target", async () => {
    const fixture = createStatefulFinancialCreditFixture({
      balanceUsdMicros: 0n,
      entries: [
        buildFinancialEntry({
          amountUsdMicros: -3_000_000n,
          beneficiarySequence: 2n,
          kind: "refund_reversal",
          sourceReferenceLookupKey: "refund_lookup_failed",
        }),
        buildFinancialEntry({
          amountUsdMicros: -2_000_000n,
          beneficiarySequence: 3n,
          sourceReferenceLookupKey: "dispute_lookup_active",
        }),
      ],
      ledgerVersion: 3n,
      remainingCreditUsdMicros: 0n,
    });

    await expect(reconcileHostedUsageCreditRefundNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "refund_lookup_failed",
      targetNetReversalUsdMicros: 0n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 3_000_000n,
      ledgerVersion: 4n,
      netReversedUsdMicros: 0n,
      restoredNowUsdMicros: 3_000_000n,
      unmetTargetUsdMicros: 0n,
    });

    await expect(reconcileHostedUsageCreditDisputeNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "dispute_lookup_active",
      sourceReferenceLookupKeyCandidates: ["dispute_lookup_active"],
      targetNetReversalUsdMicros: 5_000_000n,
      tx: fixture.tx as never,
    })).resolves.toMatchObject({
      balanceUsdMicros: 0n,
      ledgerVersion: 5n,
      netReversedUsdMicros: 5_000_000n,
      reversedNowUsdMicros: 3_000_000n,
      unmetTargetUsdMicros: 0n,
    });

    expect(fixture.entryCreate.mock.calls.map(([value]) => value.data.kind))
      .toEqual(["reversal_restoration", "dispute_reversal"]);
  });

  it("uses ledger sequence to keep repeated target cycles uniquely append-only", async () => {
    const fixture = createStatefulFinancialCreditFixture({
      balanceUsdMicros: 5_000_000n,
      entries: [],
      ledgerVersion: 1n,
      remainingCreditUsdMicros: 5_000_000n,
    });

    for (const targetNetReversalUsdMicros of [
      3_000_000n,
      1_000_000n,
      3_000_000n,
      1_000_000n,
    ]) {
      await reconcileHostedUsageCreditDisputeNetReversalTx({
        effectiveAt: EFFECTIVE_AT,
        purchaseId: "purchase_1",
        sourceReferenceLookupKey: "dispute_lookup_cycle",
        sourceReferenceLookupKeyCandidates: ["dispute_lookup_cycle"],
        targetNetReversalUsdMicros,
        tx: fixture.tx as never,
      });
    }

    const semanticSourceKeys = fixture.entryCreate.mock.calls
      .map(([value]) => value.data.semanticSourceKey);
    expect(semanticSourceKeys).toHaveLength(4);
    expect(new Set(semanticSourceKeys).size).toBe(4);
    expect(semanticSourceKeys).toEqual([
      "hosted-usage-credit:dispute:dispute_lookup_cycle:net:0:to:3000000:ledger:2:v2",
      "hosted-usage-credit:dispute:dispute_lookup_cycle:net:3000000:to:1000000:ledger:3:v2",
      "hosted-usage-credit:dispute:dispute_lookup_cycle:net:1000000:to:3000000:ledger:4:v2",
      "hosted-usage-credit:dispute:dispute_lookup_cycle:net:3000000:to:1000000:ledger:5:v2",
    ]);
  });
});

function buildLockedPurchase(
  overrides: Partial<{
    beneficiaryMemberId: string;
    fulfilledAt: Date | null;
    grantUsdMicros: bigint;
    id: string;
    paidAt: Date | null;
    remainingCreditUsdMicros: bigint;
    status: string;
  }> = {},
) {
  return {
    beneficiaryMemberId: BENEFICIARY_ID,
    fulfilledAt: null,
    grantUsdMicros: 5_000_000n,
    id: "purchase_1",
    paidAt: null,
    remainingCreditUsdMicros: 0n,
    status: "payment_pending",
    ...overrides,
  };
}

function createTaggedSqlMock(
  handler: (input: {
    sql: string;
    values: unknown[];
  }) => unknown | Promise<unknown>,
) {
  return vi.fn(async (strings: readonly string[], ...values: unknown[]) =>
    handler({
      sql: strings.join("?"),
      values,
    }));
}

function createFinancialCreditFixture(input: {
  balanceUsdMicros: bigint;
  ledgerVersion: bigint;
  nextBalanceUsdMicros?: bigint;
  nextLedgerVersion?: bigint;
  remainingCreditUsdMicros: bigint;
}) {
  const queryRaw = createTaggedSqlMock(({ sql }) => {
    if (sql.includes('FROM "hosted_member"')) {
      return [{
        balanceUsdMicros: input.balanceUsdMicros,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion: input.ledgerVersion,
      }];
    }
    if (sql.includes('FROM "hosted_usage_credit_purchase"')) {
      return [buildLockedPurchase({
        fulfilledAt: EFFECTIVE_AT,
        paidAt: PAID_AT,
        remainingCreditUsdMicros: input.remainingCreditUsdMicros,
        status: "fulfilled",
      })];
    }
    if (sql.includes('UPDATE "hosted_member"')) {
      if (
        input.nextBalanceUsdMicros === undefined
        || input.nextLedgerVersion === undefined
      ) {
        throw new Error("Unexpected projection update.");
      }
      return [{
        balanceUsdMicros: input.nextBalanceUsdMicros,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion: input.nextLedgerVersion,
      }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const entryCreate = vi.fn(async (value: unknown) => value);
  const entryFindMany = vi.fn().mockResolvedValue([]);
  const purchaseUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const executeRaw = vi.fn().mockResolvedValue(1);

  return {
    entryCreate,
    entryFindMany,
    executeRaw,
    purchaseUpdateMany,
    tx: {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedUsageCreditEntry: {
        create: entryCreate,
        findFirst: vi.fn().mockResolvedValue({
          amountUsdMicros: 5_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          id: "grant_1",
        }),
        findMany: entryFindMany,
      },
      hostedUsageCreditPurchase: {
        findUnique: vi.fn().mockResolvedValue({
          beneficiaryMemberId: BENEFICIARY_ID,
        }),
        updateMany: purchaseUpdateMany,
      },
    },
  };
}

interface FinancialEntryFixtureRow {
  amountUsdMicros: bigint;
  beneficiaryMemberId: string;
  beneficiarySequence: bigint;
  kind: string;
  parentGrantEntryId: string | null;
  purchaseId: string;
  semanticSourceKey: string;
  sourceReferenceLookupKey: string | null;
}

function buildFinancialEntry(input: {
  amountUsdMicros: bigint;
  beneficiarySequence: bigint;
  kind?: "dispute_reversal" | "refund_reversal";
  sourceReferenceLookupKey: string;
}): FinancialEntryFixtureRow {
  const kind = input.kind ?? "dispute_reversal";
  const semanticSourceKey = kind === "refund_reversal"
    ? `hosted-usage-credit:refund:purchase:purchase_1:fixture:${input.beneficiarySequence}`
    : `hosted-usage-credit:dispute:${input.sourceReferenceLookupKey}:fixture:${input.beneficiarySequence}`;
  return {
    amountUsdMicros: input.amountUsdMicros,
    beneficiaryMemberId: BENEFICIARY_ID,
    beneficiarySequence: input.beneficiarySequence,
    kind,
    parentGrantEntryId: "grant_1",
    purchaseId: "purchase_1",
    semanticSourceKey,
    sourceReferenceLookupKey: input.sourceReferenceLookupKey,
  };
}

function createStatefulFinancialCreditFixture(input: {
  balanceUsdMicros: bigint;
  entries: FinancialEntryFixtureRow[];
  ledgerVersion: bigint;
  remainingCreditUsdMicros: bigint;
}) {
  let balanceUsdMicros = input.balanceUsdMicros;
  let ledgerVersion = input.ledgerVersion;
  let remainingCreditUsdMicros = input.remainingCreditUsdMicros;
  const entries = [...input.entries];
  const queryRaw = createTaggedSqlMock(({ sql, values }) => {
    if (sql.includes('FROM "hosted_member"')) {
      return [{
        balanceUsdMicros,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion,
      }];
    }
    if (sql.includes('FROM "hosted_usage_credit_purchase"')) {
      return [buildLockedPurchase({
        fulfilledAt: EFFECTIVE_AT,
        paidAt: PAID_AT,
        remainingCreditUsdMicros,
        status: "fulfilled",
      })];
    }
    if (sql.includes('UPDATE "hosted_member"')) {
      const nextBalanceUsdMicros = values[0];
      const nextLedgerVersion = values[1];
      if (
        typeof nextBalanceUsdMicros !== "bigint"
        || typeof nextLedgerVersion !== "bigint"
      ) {
        throw new TypeError("Unexpected stateful projection update values.");
      }
      balanceUsdMicros = nextBalanceUsdMicros;
      ledgerVersion = nextLedgerVersion;
      return [{
        balanceUsdMicros,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion,
      }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const entryFindMany = vi.fn(async (query: {
    where: {
      kind: string;
      purchaseId: string;
      semanticSourceKey?: { startsWith: string };
      sourceReferenceLookupKey?: { in: string[] };
    };
  }) => entries
    .filter((entry) => {
      if (
        entry.kind !== query.where.kind
        || entry.purchaseId !== query.where.purchaseId
      ) {
        return false;
      }
      const lookupKeys = query.where.sourceReferenceLookupKey?.in;
      if (
        lookupKeys
        && (
          entry.sourceReferenceLookupKey === null
          || !lookupKeys.includes(entry.sourceReferenceLookupKey)
        )
      ) {
        return false;
      }
      const semanticPrefix = query.where.semanticSourceKey?.startsWith;
      return !semanticPrefix
        || entry.semanticSourceKey.startsWith(semanticPrefix);
    })
    .sort((left, right) => {
      if (left.beneficiarySequence < right.beneficiarySequence) return -1;
      if (left.beneficiarySequence > right.beneficiarySequence) return 1;
      return 0;
    }));
  const entryCreate = vi.fn(async (value: {
    data: FinancialEntryFixtureRow & {
      effectiveAt: Date;
      id: string;
    };
  }) => {
    entries.push(value.data);
    return value;
  });
  const purchaseUpdateMany = vi.fn(async (value: {
    data: { remainingCreditUsdMicros: bigint };
    where: { remainingCreditUsdMicros: bigint };
  }) => {
    if (value.where.remainingCreditUsdMicros !== remainingCreditUsdMicros) {
      return { count: 0 };
    }
    remainingCreditUsdMicros = value.data.remainingCreditUsdMicros;
    return { count: 1 };
  });

  return {
    entryCreate,
    tx: {
      $executeRaw: createTaggedSqlMock(() => 1),
      $queryRaw: queryRaw,
      hostedUsageCreditEntry: {
        create: entryCreate,
        findFirst: vi.fn().mockResolvedValue({
          amountUsdMicros: 5_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          id: "grant_1",
        }),
        findMany: entryFindMany,
      },
      hostedUsageCreditPurchase: {
        findUnique: vi.fn().mockResolvedValue({
          beneficiaryMemberId: BENEFICIARY_ID,
        }),
        updateMany: purchaseUpdateMany,
      },
    },
  };
}
