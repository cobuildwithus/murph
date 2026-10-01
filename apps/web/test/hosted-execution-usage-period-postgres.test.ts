import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { resolveHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Usage period proof requires local PostgreSQL.");
  }
}

describe.skipIf(!runPostgresProof)("locked usage period reads", () => {
  it("creates and reuses a period, then reads committed spending after contention", async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
      log: [{ emit: "event", level: "query" }],
    });
    let periodStatements = 0;
    prisma.$on("query", ({ query }) => {
      if (query.includes('"hosted_ai_usage_period"')) periodStatements += 1;
    });
    const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
    const memberId = `member_usage_period_${randomUUID()}`;
    const now = new Date("2031-06-15T12:00:00.000Z");
    const periodStart = new Date("2031-06-01T00:00:00.000Z");
    const periodEnd = new Date("2031-07-01T00:00:00.000Z");
    let markHolderReady!: () => void;
    let rejectHolderReady!: (error: unknown) => void;
    const holderReady = new Promise<void>((resolve, reject) => {
      markHolderReady = resolve;
      rejectHolderReady = reject;
    });
    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => { releaseHolder = resolve; });
    let holder: Promise<unknown> | undefined;
    let contender: ReturnType<typeof resolveHostedAiUsageGate> | undefined;

    try {
      await prisma.hostedMember.create({
        data: {
          id: memberId,
          billingStatus: "active",
          billingRef: {
            create: {
              currentBillingPlanCode: "launch_monthly",
              stripeSubscriptionLookupKey: `subscription_${memberId}`,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
            },
          },
        },
      });
      const first = await resolveHostedAiUsageGate({ memberId, now, prisma });
      expect(first).toMatchObject({ allowed: true, periodStart, periodEnd, spentUsdMicros: 0n });
      expect(typeof first.limitUsdMicros).toBe("bigint");
      expect(periodStatements).toBe(2);
      periodStatements = 0;
      expect(await resolveHostedAiUsageGate({ memberId, now, prisma })).toEqual(first);
      expect(periodStatements).toBe(2);
      expect(await prisma.hostedAiUsagePeriod.count({ where: { memberId } })).toBe(1);

      let holderPid = 0;
      holder = prisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        holderPid = backend!.pid;
        await tx.hostedAiUsagePeriod.update({
          where: { memberId_periodStart: { memberId, periodStart } },
          data: { spentUsdMicros: first.limitUsdMicros },
        });
        markHolderReady();
        await holderReleased;
      });
      // Make a setup failure visible without leaving the waiting test stranded.
      void holder.catch(rejectHolderReady);
      await holderReady;

      contender = resolveHostedAiUsageGate({ memberId, now, prisma });
      // Attach a handler while the deterministic lock observation is pending.
      void contender.catch(() => undefined);
      await vi.waitFor(async () => {
        const [row] = await observer.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
          ) AS blocked
        `;
        expect(row?.blocked).toBe(true);
      }, { timeout: 5_000, interval: 10 });
      releaseHolder();
      await holder;

      await expect(contender).resolves.toMatchObject({
        allowed: false,
        reason: "ai_usage_limit_exceeded",
        spentUsdMicros: first.limitUsdMicros,
      });
      const persisted = await prisma.hostedAiUsagePeriod.findUniqueOrThrow({
        where: { memberId_periodStart: { memberId, periodStart } },
      });
      expect(persisted.blockedAt).toEqual(now);
      expect(persisted.spentUsdMicros).toBe(first.limitUsdMicros);
      expect(persisted.periodStart).toEqual(periodStart);
      expect(persisted.periodEnd).toEqual(periodEnd);
    } finally {
      releaseHolder();
      await Promise.allSettled([holder, contender]);
      try {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
      } finally {
        await Promise.all([prisma.$disconnect(), observer.$disconnect()]);
      }
    }
  });
});
