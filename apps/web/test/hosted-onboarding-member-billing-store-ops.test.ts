import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assertHostedStripeEffectClaimAbsent,
  HostedMemberStripeMutationLockBusyError,
  withHostedMemberStripeMutationLockForOps,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";

describe("hosted Stripe effect compatibility fence", () => {
  it("allows an empty future claim and rejects an opaque owned claim", () => {
    expect(() => assertHostedStripeEffectClaimAbsent(null)).not.toThrow();
    expect(() => assertHostedStripeEffectClaimAbsent("opaque-future-claim"))
      .toThrow(expect.objectContaining({
        code: "HOSTED_STRIPE_EFFECT_PENDING",
        httpStatus: 409,
        retryable: true,
      }));
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
