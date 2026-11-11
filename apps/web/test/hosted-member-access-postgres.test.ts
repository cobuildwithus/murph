import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS,
} from "@/src/lib/hosted-groups/thread-container-participant-access";
import {
  readActiveHostedMemberAccess,
  readActiveHostedMemberAccessState,
  readActiveHostedMemberAccessIds,
  readHostedRuntimeAiAccessDecision,
  activeHostedPersonAccessSql,
  readStrictHostedPersonAccess,
  readStrictHostedMemberAccess,
} from "@/src/lib/hosted-onboarding/member-access";

import { claimHostedRuntime } from "@/src/lib/hosted-execution/runtime-owner";
import { readHostedAiUsageGate, checkHostedAiUsageGate, resolveHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";

import { resolveHostedRuntimeAiUsageGate } from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readHostedRuntimeReconciliationFacts } from "@/src/lib/hosted-orchestration/runtime-reconciliation-facts";
import * as prismaModule from "@/src/lib/prisma";
import * as memberStore from "@/src/lib/hosted-onboarding/hosted-member-store";
import { ensureHostedMemberChannelWelcome } from "@/src/lib/hosted-onboarding/channel-welcome";
import { countHostedMemberHomeLinqBindingsByRecipientPhone } from "@/src/lib/hosted-onboarding/hosted-member-routing-linq";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";

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
  it.each(["canceled", "paused", "unpaid", "past_due"] as const)("admits %s product work but denies all AI gate forms", async (billingStatus) => {
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const memberId = `lapsed_access_${randomUUID()}`;
    const now = new Date();
    try {
      await prisma.hostedMember.create({ data: { id: memberId, billingStatus } });
      expect(await readActiveHostedMemberAccess({ memberId, now, prisma })).toBe(true);
      expect(await readActiveHostedMemberAccessState({ memberId, now, prisma })).not.toBeNull();
      expect(await readActiveHostedMemberAccessIds({ memberIds: [memberId], now, prisma })).toEqual(new Set([memberId]));
      expect(await readStrictHostedPersonAccess({ memberId, prisma })).toBe(false);
      expect(await readStrictHostedMemberAccess({ memberId, prisma })).toBe(false);
      expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma })).toMatchObject({ allowed: false, userNotice: { code: "billing_inactive" } });
      expect(await readHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: false, reason: "hosted_access_inactive" });
      expect(await checkHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: false, reason: "hosted_access_inactive" });
      expect(await resolveHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: false, reason: "hosted_access_inactive" });
      for (const mode of ["read_only", "read_first", "mutating"] as const) {
        expect(await resolveHostedRuntimeAiUsageGate({ mode, now, userId: memberId, prisma })).toMatchObject({ status: "denied" });
      }
      vi.spyOn(prismaModule, "getPrisma").mockReturnValue(prisma);
      await prisma.hostedWorkspace.create({ data: { userId: memberId, nextWakeAt: now, nextWakeReason: "assistant_due" } });
      let rechecks = 0;
      for (let index = 0; index < 3; index++) {
        const at = new Date(now.getTime() + index * 15 * 60_000);
        const facts = await readHostedRuntimeReconciliationFacts({ userId: memberId, now: at, usageGateMode: "read_only" });
        rechecks++;
        expect(facts.blocked).toEqual({ reason: "ai_usage_denied", retryAt: new Date(at.getTime() + 15 * 60_000).toISOString() });
      }
      expect(rechecks).toBe(3);
      // Reconciliation is not runner admission: no owner attempt is created.
      expect(await prisma.hostedRuntimeOwner.count({ where: { userId: memberId } })).toBe(0);
      const snapshot = vi.spyOn(memberStore, "readHostedMemberSnapshot").mockResolvedValue({
        core: { id: memberId, billingStatus, suspendedAt: null },
        identity: { phoneNumber: "+12025550123", phoneNumberVerifiedAt: now },
        emailAuthorization: { verifiedEmail: { address: "synthetic@example.test", lookupKey: "synthetic-email" } },
        routing: null,
      } as never);
      for (const channel of ["email", "linq"] as const) await ensureHostedMemberChannelWelcome({ channel, memberId, prisma });
      snapshot.mockRestore();
      expect(await prisma.hostedMailboxItem.count({ where: { userId: memberId } })).toBe(0);
      expect(await prisma.hostedMemberRouting.count({ where: { memberId } })).toBe(0);
      const claim = await claimHostedRuntime({ prisma, userId: memberId, now, processingMode: "default" });
      expect(claim.status).not.toBe("blocked");
      await prisma.hostedConsentGrant.create({ data: { memberId, scope: "launch.health-data", status: "revoked", documentVersionsJson: {}, source: "web_onboarding", grantedAt: now, revokedAt: now } });
      expect((await claimHostedRuntime({ prisma, userId: memberId, now, processingMode: "default" })).status).toBe("blocked");
      await prisma.hostedConsentGrant.deleteMany({ where: { memberId } });
      await prisma.hostedMember.update({ where: { id: memberId }, data: { suspendedAt: now } });
      expect((await claimHostedRuntime({ prisma, userId: memberId, now, processingMode: "default" })).status).toBe("blocked");
      expect(await prisma.hostedWorkspace.count({ where: { userId: memberId } })).toBe(1);

      expect(await prisma.hostedAiUsagePeriod.count({ where: { memberId } })).toBe(0);
      expect(await prisma.hostedUsageCreditEntry.count({ where: { beneficiaryMemberId: memberId } })).toBe(0);
    } finally {
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: memberId } });
      await prisma.hostedMember.deleteMany({ where: { id: memberId } });
      vi.restoreAllMocks();
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  it("keeps returning incomplete access continuous and agrees with SQL and batch activation evidence", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const memberId = `returning_${randomUUID()}`;
    const now = new Date();
    const assertProduct = async (expected: boolean) => {
      expect(await readActiveHostedMemberAccess({ memberId, now, prisma })).toBe(expected);
      expect(await readActiveHostedMemberAccessState({ memberId, now, prisma }) !== null).toBe(expected);
      expect((await readActiveHostedMemberAccessIds({ memberIds: [memberId], now, prisma })).has(memberId)).toBe(expected);
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "member"."id" FROM "hosted_member" AS "member"
        WHERE "member"."id" = ${memberId} AND ${activeHostedPersonAccessSql(Prisma.sql`"member"`)}
      `);
      expect(rows.length > 0).toBe(expected);
    };
    try {
      await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "incomplete" } });
      await assertProduct(false);
      await prisma.hostedMember.update({ where: { id: memberId }, data: { billingStatus: "canceled" } });
      await assertProduct(true);
      await prisma.hostedMailboxItem.create({ data: { id: `activation_${memberId}`, userId: memberId,
        kind: "member.activated", lane: "system", laneSeq: 1n, dedupeKey: "activation", occurredAt: now,
        payloadSchema: "murph.test.activation.v1" } });
      await prisma.hostedMember.update({ where: { id: memberId }, data: { billingStatus: "incomplete" } });
      await assertProduct(true);
      expect(await readStrictHostedPersonAccess({ memberId, prisma })).toBe(false);
      expect(await readStrictHostedMemberAccess({ memberId, prisma })).toBe(false);
      await prisma.hostedMailboxItem.deleteMany({ where: { userId: memberId } });
      await assertProduct(false);
      for (const domain of ["control", "device", "ingress", "runtime"] as const) {
        await prisma.hostedUserCryptoEnvelope.create({ data: { id: `root_${domain}_${memberId}`, userId: memberId,
          domain, rootKeyId: `synthetic-${domain}`, status: "active", signedEnvelopeJson: { wraps: [{}], authoritySignature: { alg: "GCP-KMS-EC-P256-SHA256", keyVersionName: "synthetic-key", signature: "synthetic-signature", signedAt: now.toISOString() } } } });
        await assertProduct(domain === "runtime");
      }
      await prisma.hostedUserCryptoEnvelope.updateMany({ where: { userId: memberId, domain: "runtime" }, data: { status: "retired" } });
      await assertProduct(false);
      await prisma.hostedMember.update({ where: { id: memberId }, data: { billingStatus: "active" } });
      await assertProduct(true);
      await prisma.hostedMember.update({ where: { id: memberId }, data: { suspendedAt: now } });
      await assertProduct(false);
    } finally {
      await prisma.hostedMember.deleteMany({ where: { id: memberId } });
      vi.restoreAllMocks();
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  it("counts lapsed home bindings and only live pending signup reservations", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const prefix = `line_count_${randomUUID()}`;
    const now = new Date();
    const phone = "+12025550122";
    const statuses = ["canceled", "paused", "unpaid", "past_due", "not_started", "incomplete"] as const;
    const ids = statuses.map((_, index) => `${prefix}_${index}`);
    try {
      await prisma.hostedMember.createMany({ data: statuses.map((billingStatus, index) => ({ id: ids[index], billingStatus })) });
      await prisma.hostedMemberRouting.createMany({ data: ids.map(memberId => ({ memberId, linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(phone), linqHomeLineAssignedAt: now })) });
      for (const index of [4, 5]) await prisma.hostedInvite.create({ data: { id: `invite_${ids[index]}`, memberId: ids[index], inviteCode: ids[index], expiresAt: new Date(now.getTime() + (index === 4 ? 1 : -1) * 60_000) } });
      expect((await countHostedMemberHomeLinqBindingsByRecipientPhone({ recipientPhones: [phone], now, prisma })).get(phone)).toBe(5);
      await prisma.hostedMember.update({ where: { id: ids[0] }, data: { suspendedAt: now } });
      expect((await countHostedMemberHomeLinqBindingsByRecipientPhone({ recipientPhones: [phone], now, prisma })).get(phone)).toBe(4);
    } finally {
      await prisma.hostedMember.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    }
  });

  it("matches live direct, Family, owner and leased participant access in one SQL statement", async () => {
    // The separate game-room proof covers its optional fallback discovery.
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
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
      expect((await readActiveHostedMemberAccessIds({ memberIds: [memberId], now, prisma })).has(memberId), label).toBe(expected);
      expect(await readStrictHostedMemberAccess(input), label).toBe(expected);
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
      await prisma.hostedMember.update({ data: { billingStatus: "not_started" }, where: { id: memberId } });
      await assertAccess("direct inactive", false);
      await prisma.hostedAccountGroup.create({
        data: { id: groupId, ownerMemberId: ownerId, billingStatus: "active" },
      });
      const membershipWhere = { groupId_memberId: { groupId, memberId } };
      await prisma.hostedAccountGroupMembership.create({
        data: { id: `membership_${suffix}`, groupId, memberId, role: "member" },
      });
      await assertAccess("Family active", true);
      await prisma.hostedMember.update({ data: { billingStatus: "canceled" }, where: { id: memberId } });
      await assertAccess("canceled person with active Family", true);
      expect(await readHostedRuntimeAiAccessDecision(input)).toMatchObject({ allowed: true });
      expect(await readStrictHostedPersonAccess(input)).toBe(true);
      await prisma.hostedMember.update({ data: { billingStatus: "not_started" }, where: { id: memberId } });

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
      for (const billingStatus of ["canceled", "paused", "unpaid", "past_due"] as const) {
        await prisma.hostedMember.updateMany({ where: { id: { in: [ownerId, participantId] } }, data: { billingStatus } });
        await assertAccess(`all-${billingStatus} room`, false);
        for (const gate of [readHostedAiUsageGate, checkHostedAiUsageGate, resolveHostedAiUsageGate]) {
          expect(await gate(input)).toMatchObject({ allowed: false, reason: "hosted_access_inactive" });
        }
      }

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
      vi.restoreAllMocks();
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });
});
