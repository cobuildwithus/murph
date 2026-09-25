import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS,
} from "@/src/lib/hosted-groups/thread-container-participant-access";
import {
  readActiveHostedMemberAccess,
  readActiveHostedMemberAccessState,
} from "@/src/lib/hosted-onboarding/member-access";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")
  ) {
    throw new Error("The hosted member-access proof requires a local DATABASE_URL.");
  }
}

describe.skipIf(!runPostgresProof)("hosted member-access PostgreSQL projection", () => {
  it("matches live direct, Family, owner and leased participant access in one SQL statement", async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      log: [{ emit: "event", level: "query" }],
    });
    const queries: string[] = [];
    prisma.$on("query", ({ query }) => queries.push(query));
    const suffix = randomUUID();
    const memberId = `access_member_${suffix}`;
    const ownerId = `access_owner_${suffix}`;
    const participantId = `access_participant_${suffix}`;
    const groupId = `access_family_${suffix}`;
    const memberIds = [memberId, ownerId, participantId];
    const now = new Date("2030-01-15T12:00:00.000Z");
    const cutoff = new Date(now.getTime() - HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS);
    const input = { memberId, now, prisma };
    const assertAccess = async (label: string, expected: boolean) => {
      expect(await readActiveHostedMemberAccessState(input) !== null, label).toBe(expected);
      queries.length = 0;
      expect(await readActiveHostedMemberAccess(input), label).toBe(expected);
      expect(queries, label).toHaveLength(1);
      expect(queries[0], label).toMatch(/^SELECT /);
    };

    try {
      await assertAccess("missing member", false);
      await prisma.hostedMember.createMany({
        data: memberIds.map((id) => ({ id, billingStatus: "active" })),
      });
      await assertAccess("direct active", true);
      await prisma.hostedMember.update({ data: { billingStatus: "paused" }, where: { id: memberId } });
      await assertAccess("direct inactive", false);
      await prisma.hostedAccountGroup.create({
        data: { id: groupId, ownerMemberId: ownerId, billingStatus: "active" },
      });
      const membershipWhere = { groupId_memberId: { groupId, memberId } };
      await prisma.hostedAccountGroupMembership.create({
        data: { id: `membership_${suffix}`, groupId, memberId, role: "member" },
      });
      await assertAccess("Family active", true);
      await prisma.hostedAccountGroupMembership.update({ data: { status: "removed" }, where: membershipWhere });
      await assertAccess("Family membership removed", false);
      await prisma.hostedAccountGroupMembership.update({ data: { status: "active" }, where: membershipWhere });
      await prisma.hostedAccountGroup.update({ data: { suspendedAt: now }, where: { id: groupId } });
      await assertAccess("Family suspended", false);
      await prisma.hostedAccountGroup.update({ data: { suspendedAt: null, billingStatus: "paused" }, where: { id: groupId } });
      await assertAccess("Family inactive", false);
      await prisma.hostedAccountGroup.update({ data: { billingStatus: "active" }, where: { id: groupId } });
      await prisma.hostedMember.update({ data: { suspendedAt: now }, where: { id: memberId } });
      await assertAccess("suspended sponsored member", false);
      await prisma.hostedMember.update({ data: { suspendedAt: null, billingStatus: "active" }, where: { id: memberId } });
      await prisma.hostedMember.update({ data: { billingStatus: "paused" }, where: { id: ownerId } });
      await prisma.hostedThreadContainer.create({ data: { memberId, ownerMemberId: ownerId } });
      await assertAccess("synthetic billing and Family membership cannot grant container access", false);
      await prisma.hostedMember.update({ data: { billingStatus: "active" }, where: { id: ownerId } });
      await assertAccess("direct owner access", true);
      await prisma.hostedMember.update({ data: { suspendedAt: now }, where: { id: ownerId } });
      await assertAccess("suspended owner", false);
      await prisma.hostedMember.update({ data: { suspendedAt: null, billingStatus: "paused" }, where: { id: ownerId } });
      await prisma.hostedAccountGroupMembership.create({
        data: { id: `owner_membership_${suffix}`, groupId, memberId: ownerId, role: "owner" },
      });
      await assertAccess("Family owner access", true);
      await prisma.hostedMember.update({ data: { suspendedAt: now }, where: { id: memberId } });
      await assertAccess("suspended owner-backed container", false);
      await prisma.hostedMember.update({ data: { suspendedAt: null }, where: { id: memberId } });
      await prisma.hostedAccountGroupMembership.delete({
        where: { groupId_memberId: { groupId, memberId: ownerId } },
      });
      await assertAccess("owner access revoked", false);

      const participantWhere = { containerMemberId_participantMemberId: { containerMemberId: memberId, participantMemberId: participantId } };
      await prisma.hostedThreadContainerParticipant.create({
        data: { containerMemberId: memberId, participantMemberId: participantId, handleLookupKey: `handle_${suffix}`, firstSeenAt: cutoff, lastSeenAt: now },
      });
      await assertAccess("active current participant", true);
      await prisma.hostedThreadContainerParticipant.update({ data: { lastSeenAt: cutoff }, where: participantWhere });
      await assertAccess("participant at inclusive lease boundary", true);
      await prisma.hostedThreadContainerParticipant.update({ data: { lastSeenAt: new Date(cutoff.getTime() - 1) }, where: participantWhere });
      await assertAccess("expired participant", false);
      await prisma.hostedThreadContainerParticipant.update({ data: { lastSeenAt: now, removedAt: now }, where: participantWhere });
      await assertAccess("removed participant", false);
      await prisma.hostedThreadContainerParticipant.update({ data: { removedAt: null }, where: participantWhere });
      await prisma.hostedMember.update({ data: { suspendedAt: now }, where: { id: participantId } });
      await assertAccess("suspended participant", false);
      await prisma.hostedMember.update({ data: { suspendedAt: null, billingStatus: "paused" }, where: { id: participantId } });
      await assertAccess("inactive participant", false);
      await prisma.hostedAccountGroupMembership.create({
        data: { id: `participant_membership_${suffix}`, groupId, memberId: participantId, role: "member" },
      });
      await assertAccess("Family-sponsored participant", true);
      await prisma.hostedAccountGroup.update({ data: { suspendedAt: now }, where: { id: groupId } });
      await assertAccess("participant Family access revoked", false);
      await prisma.hostedAccountGroup.update({ data: { suspendedAt: null }, where: { id: groupId } });
      await prisma.hostedMember.update({ data: { suspendedAt: now }, where: { id: memberId } });
      await assertAccess("suspended participant-backed container", false);
    } finally {
      await prisma.hostedThreadContainer.deleteMany({ where: { memberId } });
      await prisma.hostedAccountGroup.deleteMany({ where: { id: groupId } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: memberIds } } });
      await prisma.$disconnect();
    }
  });
});
