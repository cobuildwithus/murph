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
    const grantCreate = vi.fn(async (input: unknown) => {
      events.push("grant-create");
      return input;
    });
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
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedUsageCreditGrant: {
        create: grantCreate,
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
      "grant-create",
      "period-unblock",
      "purchase-update",
    ]);
    expect(entryCreate).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        amountUsdMicros: 5_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 1n,
        effectiveAt: PAID_AT,
        kind: "purchase_grant",
        purchaseId: "purchase_1",
        semanticSourceKey:
          "hosted-usage-credit:purchase:purchase_1:grant:v1",
      }),
    });
    expect(grantCreate).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        entryId: expect.stringMatching(/^huce_/u),
        remainingUsdMicros: 5_000_000n,
      }),
    });
    expect(purchaseUpdateMany).toHaveBeenCalledExactlyOnceWith({
      data: {
        paidAt: PAID_AT,
        remainingCreditUsdMicros: 5_000_000n,
        status: "fulfilled",
        terminalAt: PAID_AT,
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
            effectiveAt: PAID_AT,
            grant: { remainingUsdMicros: 3_000_000n },
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

  it("settles eligible grants FIFO with one bounded set-based statement", async () => {
    const settlementQueries: Array<{ sql: string; values: unknown[] }> = [];
    const queryRaw = createTaggedSqlMock(({ sql, values }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 12_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 2n,
        }];
      }
      if (sql.includes("settlement_input AS MATERIALIZED")) {
        settlementQueries.push({ sql, values });
        const normalizedSql = sql.replace(/\s+/gu, " ");

        expect(normalizedSql).toContain(
          'ORDER BY entry."beneficiary_sequence" ASC LIMIT ? '
            + "FOR UPDATE OF entry, grant_projection",
        );
        expect(normalizedSql).toContain(
          '?::timestamp(3) AS "effectiveAt"',
        );
        expect(normalizedSql).toContain(
          "ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING",
        );
        expect(normalizedSql).toContain(
          'ROW_NUMBER() OVER ( ORDER BY '
            + 'allocation_candidates."beneficiarySequence" ASC ) '
            + 'AS "allocationOrdinal"',
        );
        expect(normalizedSql).toContain(
          'WHERE allocation_candidates."allocationUsdMicros" > 0',
        );
        expect(normalizedSql).toContain(
          'settlement_gate."lockedLedgerVersion" '
            + '+ allocation."allocationOrdinal"',
        );
        expect(normalizedSql).toContain(
          'allocation."purchaseId", allocation."referralId", '
            + 'allocation."entryId", settlement_gate."sourceUsageId"',
        );
        expect(normalizedSql).toContain(
          "\"entryKind\" = 'purchase_grant' AND \"purchaseId\" IS NOT NULL "
            + 'AND "referralId" IS NULL',
        );
        expect(normalizedSql).toContain(
          "\"entryKind\" = 'referral_grant' AND \"purchaseId\" IS NULL "
            + 'AND "referralId" IS NOT NULL',
        );
        expect(normalizedSql).toContain(
          '"purchaseGrantUsdMicros" IS DISTINCT FROM "grantAmountUsdMicros"',
        );
        expect(normalizedSql).toContain(
          "\"purchaseStatus\" IS DISTINCT FROM 'fulfilled'",
        );
        expect(normalizedSql).toContain(
          "'hosted-usage-credit:usage:' "
            + '|| settlement_gate."sourceUsageId" '
            + "|| ':grant:' || allocation.\"entryId\" || ':debit:' || ?",
        );
        expect(normalizedSql).toContain("jsonb_array_elements_text");
        expect(normalizedSql).toContain(
          '"remaining_usd_micros" = allocation."remainingUsdMicros" '
            + '- allocation."allocationUsdMicros"',
        );
        expect(normalizedSql).toContain(
          '"remaining_credit_usd_micros" = '
            + 'allocation."remainingUsdMicros" '
            + '- allocation."allocationUsdMicros"',
        );
        expect(normalizedSql).toContain(
          '"usage_credit_balance_usd_micros" = '
            + 'settlement_gate."lockedBalanceUsdMicros" '
            + '- allocation_totals."debitedUsdMicros"',
        );
        expect(normalizedSql).toContain(
          '"usage_credit_ledger_version" = '
            + 'settlement_gate."lockedLedgerVersion" '
            + '+ allocation_totals."allocationCount"',
        );
        expect(sql.match(
          /UPDATE "hosted_usage_credit_grant" AS grant_projection/gu,
        ) ?? []).toHaveLength(1);
        expect(sql.match(
          /UPDATE "hosted_usage_credit_purchase" AS purchase_projection/gu,
        ) ?? []).toHaveLength(1);
        expect(sql.match(/UPDATE "hosted_member" AS beneficiary/gu) ?? [])
          .toHaveLength(1);
        expect(sql.match(/INSERT INTO "hosted_usage_credit_entry"/gu) ?? [])
          .toHaveLength(1);
        expect(values.filter((value) => value === 33)).toHaveLength(1);
        expect(values.filter((value) => value === 32)).toHaveLength(2);
        expect(values).toContain("usage_1");
        expect(values).toContain("v1");

        const preparedEntryIdsJson = values.find((value) =>
          typeof value === "string" && value.startsWith('["huce_'));
        expect(preparedEntryIdsJson).toBeTypeOf("string");
        if (typeof preparedEntryIdsJson !== "string") {
          throw new TypeError("Missing prepared usage-credit entry ids.");
        }
        const preparedEntryIds: unknown = JSON.parse(preparedEntryIdsJson);
        expect(Array.isArray(preparedEntryIds)).toBe(true);
        if (!Array.isArray(preparedEntryIds)) {
          throw new TypeError("Invalid prepared usage-credit entry ids.");
        }
        expect(preparedEntryIds).toHaveLength(32);
        expect(preparedEntryIds.every((value) =>
          typeof value === "string" && /^huce_[A-Za-z0-9_-]+$/u.test(value)))
          .toBe(true);

        return [buildUsageSettlementMutationRow()];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      debitUsdMicros: 15_000_000n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_1",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
    })).resolves.toEqual({
      absorbedUsdMicros: 3_000_000n,
      balanceUsdMicros: 0n,
      debitedUsdMicros: 12_000_000n,
      ledgerVersion: 4n,
    });

    expect(settlementQueries).toHaveLength(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("keeps a zero debit as a beneficiary-lock-only no-op", async () => {
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      expect(sql).toContain('FROM "hosted_member"');
      expect(sql).not.toContain("settlement_input AS MATERIALIZED");
      return [{
        balanceUsdMicros: 12_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        ledgerVersion: 2n,
      }];
    });

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      debitUsdMicros: 0n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_zero",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
    })).resolves.toEqual({
      absorbedUsdMicros: 0n,
      balanceUsdMicros: 12_000_000n,
      debitedUsdMicros: 0n,
      ledgerVersion: 2n,
    });

    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("absorbs a positive debit without mutations when no credit remains", async () => {
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 0n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 4n,
        }];
      }
      if (sql.includes("settlement_input AS MATERIALIZED")) {
        return [buildUsageSettlementMutationRow({
          allocationCount: 0,
          balanceUsdMicros: null,
          beneficiaryMemberId: null,
          debitedUsdMicros: 0n,
          eligibleGrantCount: 0,
          eligibleGrantTotalUsdMicros: 0n,
          grantUpdatedCount: 0,
          insertedDebitUsdMicros: 0n,
          ledgerEntryInsertedCount: 0,
          ledgerVersion: null,
          memberUpdatedCount: 0,
          purchaseAllocationCount: 0,
          purchaseUpdatedCount: 0,
        })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      debitUsdMicros: 2_000_000n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_no_credit",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
    })).resolves.toEqual({
      absorbedUsdMicros: 2_000_000n,
      balanceUsdMicros: 0n,
      debitedUsdMicros: 0n,
      ledgerVersion: 4n,
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("fails closed before settlement mutations when a 33rd grant is eligible", async () => {
    const queryRaw = createTaggedSqlMock(({ sql, values }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 33_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 40n,
        }];
      }
      if (sql.includes("settlement_input AS MATERIALIZED")) {
        const normalizedSql = sql.replace(/\s+/gu, " ");
        expect(values.filter((value) => value === 33)).toHaveLength(1);
        expect(normalizedSql).toContain(
          'WHEN COUNT(*) <= ? THEN COALESCE('
            + 'SUM("remainingUsdMicros"), 0)::bigint ELSE 0::bigint',
        );
        expect(normalizedSql).toContain(
          'grant_capacity."eligibleGrantCount" <= ?',
        );
        expect(normalizedSql).toContain(
          'FROM locked_grants CROSS JOIN settlement_gate '
            + 'WHERE settlement_gate."settlementReady"',
        );
        expect(normalizedSql).toContain(
          'FROM settlement_gate CROSS JOIN allocation_totals '
            + 'WHERE settlement_gate."settlementReady"',
        );
        return [buildUsageSettlementMutationRow({
          allocationCount: 0,
          balanceUsdMicros: null,
          beneficiaryMemberId: null,
          debitedUsdMicros: 0n,
          eligibleGrantCount: 33,
          eligibleGrantTotalUsdMicros: 0n,
          grantUpdatedCount: 0,
          insertedDebitUsdMicros: 0n,
          ledgerEntryInsertedCount: 0,
          ledgerVersion: null,
          memberUpdatedCount: 0,
          purchaseAllocationCount: 0,
          purchaseUpdatedCount: 0,
        })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      debitUsdMicros: 1_000_000n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_overflow",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
    })).rejects.toThrow(
      "Hosted usage-credit settlement exceeds the temporary active grant limit.",
    );
  });

  it.each([
    [
      "grant source",
      { grantInvariantFailureCount: 1 },
      "Hosted usage-credit eligible grant invariant failed.",
    ],
    [
      "purchase pre-projection",
      { purchaseProjectionMismatchCount: 1 },
      "Hosted usage-credit purchase projection diverged from its grant.",
    ],
    [
      "member/grant conservation",
      { eligibleGrantTotalUsdMicros: 11_000_000n },
      "Hosted usage-credit member and grant projections diverged.",
    ],
    [
      "grant update count",
      { grantUpdatedCount: 1 },
      "Hosted usage-credit debit lost a locked grant projection.",
    ],
    [
      "purchase update count",
      { purchaseUpdatedCount: 0 },
      "Hosted usage-credit debit lost a purchase projection.",
    ],
    [
      "allocation total",
      { debitedUsdMicros: 11_000_000n },
      "Hosted usage-credit FIFO allocation invariant failed.",
    ],
    [
      "member update count",
      {
        balanceUsdMicros: null,
        beneficiaryMemberId: null,
        ledgerVersion: null,
        memberUpdatedCount: 0,
      },
      "Hosted usage-credit beneficiary projection update invariant failed.",
    ],
    [
      "ledger insert count",
      { ledgerEntryInsertedCount: 1 },
      "Hosted usage-credit usage-debit ledger insert invariant failed.",
    ],
    [
      "ledger debit total",
      { insertedDebitUsdMicros: 11_000_000n },
      "Hosted usage-credit usage-debit ledger insert invariant failed.",
    ],
  ] as const)("rejects a %s mismatch", async (_label, overrides, message) => {
    const queryRaw = createTaggedSqlMock(({ sql }) => {
      if (sql.includes('FROM "hosted_member"')) {
        return [{
          balanceUsdMicros: 12_000_000n,
          beneficiaryMemberId: BENEFICIARY_ID,
          ledgerVersion: 2n,
        }];
      }
      if (sql.includes("settlement_input AS MATERIALIZED")) {
        return [buildUsageSettlementMutationRow(overrides)];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: BENEFICIARY_ID,
      debitUsdMicros: 15_000_000n,
      effectiveAt: EFFECTIVE_AT,
      sourceUsageId: "usage_mismatch",
      tx: {
        $queryRaw: queryRaw,
        hostedUsageCreditEntry: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
    })).rejects.toThrow(message);
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
        hostedUsageCreditGrant: {
          updateMany: vi.fn(),
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
    }]);

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
        kind: "refund_adjustment",
        parentGrantEntryId: "grant_1",
        semanticSourceKey:
          "hosted-usage-credit:refund:purchase:purchase_1:net:1000000:to:3000000:ledger:6:v2",
        sourceReferenceLookupKey: "refund_lookup_1",
      }),
    });
    expect(fixture.entryFindMany).toHaveBeenCalledOnce();
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
    }]);

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
    expect(fixture.entryFindMany).toHaveBeenCalledOnce();
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
    }]);

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
        kind: "refund_adjustment",
        semanticSourceKey:
          "hosted-usage-credit:refund:purchase:purchase_1:net:3000000:to:0:ledger:7:v2",
        sourceReferenceLookupKey: "refund_lookup_failed",
      }),
    });
    expect(fixture.entryFindMany).toHaveBeenCalledOnce();
    expect(fixture.executeRaw).toHaveBeenCalledOnce();
  });

  it("fails closed when signed adjustments restore more than they reversed", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 5_000_000n,
      ledgerVersion: 2n,
      remainingCreditUsdMicros: 5_000_000n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([{
      amountUsdMicros: 1_000_000n,
      beneficiaryMemberId: BENEFICIARY_ID,
      beneficiarySequence: 2n,
      parentGrantEntryId: "grant_1",
      sourceReferenceLookupKey: "refund_lookup_corrupt",
    }]);

    await expect(reconcileHostedUsageCreditRefundNetReversalTx({
      effectiveAt: EFFECTIVE_AT,
      purchaseId: "purchase_1",
      sourceReferenceLookupKey: "refund_lookup_corrupt",
      targetNetReversalUsdMicros: 0n,
      tx: fixture.tx as never,
    })).rejects.toThrowError(
      "Hosted usage-credit adjustment restored more than it reversed.",
    );

    expect(fixture.entryCreate).not.toHaveBeenCalled();
    expect(fixture.purchaseUpdateMany).not.toHaveBeenCalled();
    expect(fixture.executeRaw).not.toHaveBeenCalled();
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
        kind: "refund_adjustment",
        sourceReferenceLookupKey: "refund_lookup_r1",
      },
      {
        amountUsdMicros: -2_500_000n,
        kind: "refund_adjustment",
        sourceReferenceLookupKey: "refund_lookup_r2",
      },
      {
        amountUsdMicros: 2_500_000n,
        kind: "refund_adjustment",
        sourceReferenceLookupKey: "refund_lookup_r1",
      },
      {
        amountUsdMicros: 2_500_000n,
        kind: "refund_adjustment",
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
    }]);

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
        kind: "dispute_adjustment",
        purchaseId: "purchase_1",
        sourceReferenceLookupKey: {
          in: ["dispute_lookup_1"],
        },
      },
    });
    expect(fixture.entryCreate).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        amountUsdMicros: -2_000_000n,
        kind: "dispute_adjustment",
        semanticSourceKey:
          "hosted-usage-credit:dispute:dispute_lookup_1:net:1000000:to:3000000:ledger:5:v2",
      }),
    });
    expect(fixture.entryFindMany).toHaveBeenCalledOnce();
  });

  it("partially restores a dispute and keeps its original lookup key across rotation", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 2_000_000n,
      ledgerVersion: 7n,
      nextBalanceUsdMicros: 3_000_000n,
      nextLedgerVersion: 8n,
      remainingCreditUsdMicros: 2_000_000n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([
      {
        amountUsdMicros: -3_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 2n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_old",
      },
      {
        amountUsdMicros: 1_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 4n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_old",
      },
    ]);

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

    expect(fixture.entryFindMany).toHaveBeenCalledExactlyOnceWith({
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
        kind: "dispute_adjustment",
        purchaseId: "purchase_1",
        sourceReferenceLookupKey: {
          in: ["dispute_lookup_new", "dispute_lookup_old"],
        },
      },
    });
    expect(fixture.entryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountUsdMicros: 1_000_000n,
        kind: "dispute_adjustment",
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
    fixture.entryFindMany.mockResolvedValueOnce([
      {
        amountUsdMicros: -3_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 2n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_1",
      },
      {
        amountUsdMicros: 1_000_000n,
        beneficiaryMemberId: BENEFICIARY_ID,
        beneficiarySequence: 4n,
        parentGrantEntryId: "grant_1",
        sourceReferenceLookupKey: "dispute_lookup_1",
      },
    ]);

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
    expect(fixture.entryFindMany).toHaveBeenCalledOnce();
    expect(fixture.purchaseUpdateMany).not.toHaveBeenCalled();
  });

  it("reports an unmet dispute target when overlapping exposure consumed the credit", async () => {
    const fixture = createFinancialCreditFixture({
      balanceUsdMicros: 0n,
      ledgerVersion: 5n,
      remainingCreditUsdMicros: 0n,
    });
    fixture.entryFindMany.mockResolvedValueOnce([]);

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
    expect(fixture.entryFindMany).toHaveBeenCalledOnce();
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
          kind: "dispute_adjustment",
        }),
        expect.objectContaining({
          amountUsdMicros: -2_000_000n,
          kind: "dispute_adjustment",
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
          kind: "refund_adjustment",
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
      .toEqual(["refund_adjustment", "dispute_adjustment"]);
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

interface UsageSettlementMutationRowFixture {
  allocationCount: number;
  balanceUsdMicros: bigint | null;
  beneficiaryMemberId: string | null;
  debitedUsdMicros: bigint;
  eligibleGrantCount: number;
  eligibleGrantTotalUsdMicros: bigint;
  grantInvariantFailureCount: number;
  grantUpdatedCount: number;
  insertedDebitUsdMicros: bigint;
  ledgerEntryInsertedCount: number;
  ledgerVersion: bigint | null;
  memberUpdatedCount: number;
  purchaseAllocationCount: number;
  purchaseProjectionMismatchCount: number;
  purchaseUpdatedCount: number;
}

function buildUsageSettlementMutationRow(
  overrides: Partial<UsageSettlementMutationRowFixture> = {},
): UsageSettlementMutationRowFixture {
  return {
    allocationCount: 2,
    balanceUsdMicros: 0n,
    beneficiaryMemberId: BENEFICIARY_ID,
    debitedUsdMicros: 12_000_000n,
    eligibleGrantCount: 2,
    eligibleGrantTotalUsdMicros: 12_000_000n,
    grantInvariantFailureCount: 0,
    grantUpdatedCount: 2,
    insertedDebitUsdMicros: 12_000_000n,
    ledgerEntryInsertedCount: 2,
    ledgerVersion: 4n,
    memberUpdatedCount: 1,
    purchaseAllocationCount: 1,
    purchaseProjectionMismatchCount: 0,
    purchaseUpdatedCount: 1,
    ...overrides,
  };
}

function buildLockedPurchase(
  overrides: Partial<{
    beneficiaryMemberId: string;
    grantUsdMicros: bigint;
    id: string;
    paidAt: Date | null;
    remainingCreditUsdMicros: bigint;
    status: string;
  }> = {},
) {
  return {
    beneficiaryMemberId: BENEFICIARY_ID,
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
  const grantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const purchaseUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const executeRaw = vi.fn().mockResolvedValue(1);

  return {
    entryCreate,
    entryFindMany,
    executeRaw,
    grantUpdateMany,
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
      hostedUsageCreditGrant: {
        findUnique: vi.fn().mockResolvedValue({
          remainingUsdMicros: input.remainingCreditUsdMicros,
        }),
        updateMany: grantUpdateMany,
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
  kind?: "dispute_adjustment" | "refund_adjustment";
  sourceReferenceLookupKey: string;
}): FinancialEntryFixtureRow {
  const kind = input.kind ?? "dispute_adjustment";
  const semanticSourceKey = kind === "refund_adjustment"
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
  let remainingGrantUsdMicros = input.remainingCreditUsdMicros;
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
  const grantUpdateMany = vi.fn(async (value: {
    data: { remainingUsdMicros: bigint };
    where: { remainingUsdMicros: bigint };
  }) => {
    if (value.where.remainingUsdMicros !== remainingGrantUsdMicros) {
      return { count: 0 };
    }
    remainingGrantUsdMicros = value.data.remainingUsdMicros;
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
      hostedUsageCreditGrant: {
        findUnique: vi.fn(async () => ({
          remainingUsdMicros: remainingGrantUsdMicros,
        })),
        updateMany: grantUpdateMany,
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
