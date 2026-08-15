import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assertNoHostedDirectSubscriptionStripeEffectTx,
  assertHostedStripeEffectClaimAbsent,
  HostedMemberStripeMutationLockBusyError,
  withHostedMemberStripeMutationLockForOps,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";

describe("hosted Stripe effect compatibility fence", () => {
  it("allows only an absent future claim and rejects every persisted claim", () => {
    expect(() => assertHostedStripeEffectClaimAbsent(null)).not.toThrow();
    expect(() => assertHostedStripeEffectClaimAbsent(undefined)).not.toThrow();
    for (const claimId of ["", "opaque-future-claim"]) {
      expect(() => assertHostedStripeEffectClaimAbsent(claimId))
        .toThrow(expect.objectContaining({
          code: "HOSTED_STRIPE_EFFECT_PENDING",
          httpStatus: 409,
          retryable: true,
        }));
    }
  });

  it("blocks an owner-group claim for the exact direct subscription until terminal removal", async () => {
    const memberFindFirst = vi.fn().mockResolvedValue(null);
    const familyFindFirst = vi.fn()
      .mockResolvedValueOnce({ stripeEffectClaimId: "opaque-family-conversion" })
      .mockResolvedValueOnce(null);
    const tx = {
      hostedAccountGroupBillingRef: { findFirst: familyFindFirst },
      hostedMemberBillingRef: { findFirst: memberFindFirst },
    };

    await expect(assertNoHostedDirectSubscriptionStripeEffectTx({
      memberId: "member_123",
      stripeSubscriptionId: "sub_direct_123",
      tx: tx as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    await expect(assertNoHostedDirectSubscriptionStripeEffectTx({
      memberId: "member_123",
      stripeSubscriptionId: "sub_direct_123",
      tx: tx as never,
    })).resolves.toBeUndefined();
    expect(familyFindFirst).toHaveBeenCalledWith({
      select: { stripeEffectClaimId: true },
      where: {
        group: { ownerMemberId: "member_123" },
        stripeEffectClaimId: { not: null },
        stripeEffectDirectSubscriptionLookupKey: {
          in: expect.arrayContaining([expect.any(String)]),
        },
      },
    });
  });
});

function createPrismaHarness(queryRaw = vi.fn().mockResolvedValue([])) {
  const tx = {
    $queryRaw: queryRaw,
  };
  const transaction = vi.fn(
    async (run: (transactionClient: never) => Promise<unknown>) =>
      run(tx as never),
  );

  return {
    prisma: {
      $transaction: transaction,
    } as never,
    queryRaw,
    transaction,
  };
}

function createAdapterPgLockTimeout(
  codeField: "code" | "originalCode" = "originalCode",
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Raw query failed. Code: `55P03`.",
    {
      clientVersion: "7.8.0",
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: {
            [codeField]: "55P03",
            kind: "postgres",
            message: "canceling statement due to lock timeout",
            severity: "ERROR",
          },
          name: "DriverAdapterError",
        },
      },
    },
  );
}

describe("hosted member Stripe mutation lock for ops", () => {
  it.each(["originalCode", "code"] as const)(
    "recognizes adapter-pg P2010 lock timeouts from the nested cause %s",
    async (codeField) => {
      const lockTimeout = createAdapterPgLockTimeout(codeField);
      const queryRaw = vi.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(lockTimeout);
      const harness = createPrismaHarness(queryRaw);
      const run = vi.fn();

      await expect(
        withHostedMemberStripeMutationLockForOps({
          acquisitionTimeoutMs: 2_000,
          memberId: "member_123",
          prisma: harness.prisma,
          run,
          transactionTimeoutMs: 120_000,
        }),
      ).rejects.toBeInstanceOf(HostedMemberStripeMutationLockBusyError);

      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("resets the transaction-local timeout immediately after acquiring the member row", async () => {
    const harness = createPrismaHarness();
    const run = vi.fn().mockResolvedValue("completed");

    await expect(
      withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs: 2_000,
        memberId: "member_123",
        prisma: harness.prisma,
        run,
        transactionTimeoutMs: 120_000,
      }),
    ).resolves.toBe("completed");

    expect(harness.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 120_000,
      },
    );
    expect(harness.queryRaw).toHaveBeenCalledTimes(3);
    const sql = harness.queryRaw.mock.calls.map(([strings]) =>
      Array.from(strings).join("?"),
    );
    expect(sql[0]).toContain("set_config('lock_timeout'");
    expect(harness.queryRaw.mock.calls[0]?.slice(1)).toEqual(["2000ms"]);
    expect(sql[1]).toContain('from "hosted_member"');
    expect(harness.queryRaw.mock.calls[1]?.slice(1)).toEqual(["member_123"]);
    expect(sql[2]).toContain("set_config('lock_timeout', '0', true)");
    expect(harness.queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      run.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("does not run billing work when resetting the transaction-local timeout fails", async () => {
    const resetError = createAdapterPgLockTimeout();
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(resetError);
    const harness = createPrismaHarness(queryRaw);
    const run = vi.fn();

    await expect(
      withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs: 2_000,
        memberId: "member_123",
        prisma: harness.prisma,
        run,
        transactionTimeoutMs: 120_000,
      }),
    ).rejects.toBe(resetError);

    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not relabel a later lock timeout as member-lock acquisition contention", async () => {
    const laterLockTimeout = createAdapterPgLockTimeout();
    const harness = createPrismaHarness();
    const run = vi.fn().mockRejectedValue(laterLockTimeout);

    await expect(
      withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs: 2_000,
        memberId: "member_123",
        prisma: harness.prisma,
        run,
        transactionTimeoutMs: 120_000,
      }),
    ).rejects.toBe(laterLockTimeout);

    expect(harness.queryRaw).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledOnce();
  });
});
