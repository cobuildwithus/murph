import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { resolveHostedRuntimeAiUsageGate } from "@/src/lib/hosted-orchestration/runtime-usage-decision";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) throw new Error("Query-load proof requires local PostgreSQL.");
}

describe.skipIf(!enabled)("hosted runtime SQL load", () => {
  it("halves round trips without changing direct, sponsored or group allowance decisions", async () => {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }),
      log: [{ emit: "event", level: "query" }] });
    let statements = 0;
    client.$on("query", () => { statements += 1; });
    // Preserve the public client surface while selecting the previous relation strategy.
    const baseline = client.$extends({ query: { $allModels: {
      async findUnique({ args, query }) { return query({ ...args, relationLoadStrategy: "query" }); },
      async findFirst({ args, query }) { return query({ ...args, relationLoadStrategy: "query" }); },
      async findMany({ args, query }) { return query({ ...args, relationLoadStrategy: "query" }); },
    } } }) as PrismaClient;
    const suffix = randomUUID();
    const owner = `query_owner_${suffix}`;
    const member = `query_member_${suffix}`;
    const container = `query_container_${suffix}`;
    const group = `query_family_${suffix}`;
    const now = new Date("2030-01-15T12:00:00Z");
    const ids = [owner, member, container];
    try {
      await client.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "active" })) });
      await client.hostedMemberBillingRef.create({ data: { memberId: owner,
        currentBillingPlanCode: "launch_monthly", stripeSubscriptionLookupKey: `test_subscription_${suffix}`,
        currentPeriodStart: new Date("2030-01-01T00:00:00Z"), currentPeriodEnd: new Date("2030-02-01T00:00:00Z") } });
      await client.hostedAccountGroup.create({ data: { id: group, ownerMemberId: owner, billingStatus: "active" } });
      await client.hostedAccountGroupMembership.create({ data: { id: `query_membership_${suffix}`, groupId: group, memberId: member, role: "member" } });
      await client.hostedThreadContainer.create({ data: { memberId: container, ownerMemberId: owner } });
      // Materialize allowance periods before comparing steady-state callback work.
      for (const userId of ids) await resolveHostedRuntimeAiUsageGate({ mode: "mutating", userId, now, prisma: client });
      const sample = async (prisma: PrismaClient, mode: "mutating" | "read_first" | "read_only") => {
        statements = 0;
        const started = performance.now();
        const decisions = [];
        for (let index = 0; index < 60; index += 1) {
          decisions.push(await resolveHostedRuntimeAiUsageGate({ mode, userId: ids[index % ids.length]!, now, prisma }));
        }
        return { statements, elapsedMs: Math.round(performance.now() - started), decisions };
      };
      for (const mode of ["mutating", "read_first", "read_only"] as const) {
        const before = await sample(baseline, mode);
        const after = await sample(client, mode);
        expect(after.decisions).toEqual(before.decisions);
        expect(after.statements).toBeLessThanOrEqual(before.statements / 2);
        process.stdout.write(JSON.stringify({ label: "Synthetic 60-callback SQL comparison", mode,
          before: before.statements, after: after.statements,
          beforeMs: before.elapsedMs, afterMs: after.elapsedMs,
        }) + "\n");
      }
      // The next request must observe withdrawal; relation joining never retains authority.
      await client.hostedConsentGrant.create({ data: { memberId: owner, scope: "launch.health-data",
        status: "revoked", documentVersionsJson: {}, source: "synthetic_test", grantedAt: now, revokedAt: now } });
      for (const userId of [owner, container]) {
        for (const mode of ["mutating", "read_first", "read_only"] as const) {
          const input = { mode, userId, now };
          const before = await resolveHostedRuntimeAiUsageGate({ ...input, prisma: baseline });
          expect(before).toEqual({ status: "health_data_consent_withdrawn" });
          expect(await resolveHostedRuntimeAiUsageGate({ ...input, prisma: client })).toEqual(before);
        }
      }
    } finally {
      await client.hostedThreadContainer.deleteMany({ where: { memberId: container } });
      await client.hostedAccountGroup.deleteMany({ where: { id: group } });
      await client.hostedMember.deleteMany({ where: { id: { in: ids } } });
      await client.$disconnect();
    }
  });
});
