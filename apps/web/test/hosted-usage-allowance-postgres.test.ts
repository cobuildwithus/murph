import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) {
    throw new Error("Allowance proof requires loopback PostgreSQL.");
  }
}

describe.skipIf(!enabled)("Postgres Family allowance read", () => {
  const members: string[] = [];
  const groups: string[] = [];
  const queries: string[] = [];
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
    log: [{ emit: "event", level: "query" }],
  });
  const now = new Date("2026-09-10T12:00:00Z");
  const periodStart = new Date("2026-09-05T00:00:00Z");
  const periodEnd = new Date("2026-10-05T00:00:00Z");
  beforeAll(() => { prisma.$on("query", event => { queries.push(event.query); }); });
  afterAll(async () => {
    await prisma.hostedAccountGroup.deleteMany({ where: { id: { in: groups } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: members } } });
    await prisma.$disconnect();
  });

  async function seed() {
    const owner = `allowance_owner_${randomUUID()}`;
    const memberId = `allowance_member_${randomUUID()}`;
    const groupId = `allowance_group_${randomUUID()}`;
    members.push(owner, memberId);
    groups.push(groupId);
    await prisma.hostedMember.createMany({ data: [{ id: owner }, { id: memberId }] });
    await prisma.hostedAccountGroup.create({ data: {
      id: groupId, ownerMemberId: owner, billingStatus: "active",
      billingRef: { create: {
        currentBillingPlanCode: "launch_family_monthly", currentBillingPhase: "paid",
        currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
      } },
      memberships: { create: {
        id: `allowance_membership_${randomUUID()}`, memberId, role: "member", planCode: "edge",
      } },
    } });
    return { memberId, groupId };
  }

  it("reads sponsorship and its billing period in one SQL statement", async () => {
    const { memberId } = await seed();
    queries.length = 0;
    await expect(readHostedAiUsageGate({ memberId, now, prisma })).resolves.toMatchObject({
      allowed: true, billingPlanCode: "launch_edge_monthly", limitUsdMicros: 15_200_000n,
      periodStart, periodEnd,
    });
    // The member projection also joins access rows. Count the separate
    // sponsorship/period lookup, excluding that unchanged member projection.
    const familyQueries = queries.filter(sql => sql.includes("hosted_account_group")
      && !sql.includes('FROM "public"."hosted_member"'));
    expect(familyQueries).toHaveLength(1);
    expect(familyQueries[0]).toContain("hosted_account_group_membership");
    expect(familyQueries[0]).toContain("hosted_account_group_billing_ref");
  });

  it("retains calendar fallback when a sponsored group's billing reference is missing", async () => {
    const { memberId, groupId } = await seed();
    await prisma.hostedAccountGroupBillingRef.delete({ where: { groupId } });
    await expect(readHostedAiUsageGate({ memberId, now, prisma })).resolves.toMatchObject({
      allowed: true, billingPlanCode: "launch_edge_monthly", limitUsdMicros: 15_200_000n,
      periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it.each(["membership_removed", "group_unpaid", "group_suspended"])(
    "fails closed for %s", async condition => {
      const { memberId, groupId } = await seed();
      if (condition === "membership_removed") {
        await prisma.hostedAccountGroupMembership.update({
          where: { groupId_memberId: { groupId, memberId } },
          data: { status: "removed" },
        });
      } else {
        await prisma.hostedAccountGroup.update({
          where: { id: groupId },
          data: condition === "group_unpaid" ? { billingStatus: "unpaid" } : { suspendedAt: now },
        });
      }
      await expect(readHostedAiUsageGate({ memberId, now, prisma })).resolves.toMatchObject({
        allowed: false, reason: "hosted_access_inactive",
      });
    },
  );
});
