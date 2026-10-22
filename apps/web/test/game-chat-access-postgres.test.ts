import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { readHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import {
  readActiveHostedMemberAccess,
  readActiveHostedMemberAccessIds,
  readActiveHostedMemberAccessState,
  readHostedRuntimeAiAccessDecision,
  readHostedRuntimeAiAllowedMemberIds,
} from "@/src/lib/hosted-onboarding/member-access";
import { HOSTED_HEALTH_DATA_CONSENT_SCOPE } from "@/src/lib/legal/consent";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")
    || !url.pathname.startsWith("/murph_test")) {
    throw new Error("Game chat access proof requires a loopback murph_test database.");
  }
}

describe.skipIf(!enabled)("game chat access PostgreSQL", () => {
  it("admits only the bound live room with ordinary group capacity and revokes that access with game authority", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const suffix = randomUUID();
    const room = `game_room_${suffix}`;
    const first = `game_first_${suffix}`;
    const second = `game_second_${suffix}`;
    const unrelated = `game_unrelated_${suffix}`;
    const gameId = `game_access_${suffix}`;
    const ids = [room, first, second, unrelated];
    const now = new Date("2030-01-15T12:00:00Z");
    const input = { memberId: room, now, prisma };
    const assertRoom = async (allowed: boolean) => {
      expect(await readActiveHostedMemberAccess(input)).toBe(allowed);
      expect(await readActiveHostedMemberAccessState(input) !== null).toBe(allowed);
      expect((await readHostedRuntimeAiAccessDecision(input)).allowed).toBe(allowed);
      expect(await readActiveHostedMemberAccessIds({ memberIds: ids, now, prisma }))
        .toEqual(new Set(allowed ? [room] : []));
      expect(await readHostedRuntimeAiAllowedMemberIds({ memberIds: ids, now, prisma }))
        .toEqual(new Set(allowed ? [room] : []));
    };
    try {
      await prisma.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "not_started" })) });
      await prisma.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: first } });
      await assertRoom(false);
      await prisma.gameProfile.createMany({ data: [first, second].map(memberId => ({
        memberId, firstNameEncrypted: "synthetic-sealed-name", timeZone: "America/New_York",
      })) });
      await prisma.game.create({ data: {
        id: gameId, createdBy: first, status: "live", liveRosterKey: `${first}:${second}`, chatContainerMemberId: room,
        terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic-sealed-terms",
        players: { create: [first, second].map((memberId, seat) => ({
          memberId, seat, timeZone: "America/New_York", dayOne: new Date("2030-01-15T00:00:00Z"),
        })) },
      } });
      await assertRoom(true);
      await expect(readHostedAiUsageGate(input)).resolves.toMatchObject({
        allowed: true, limitUsdMicros: 7_500_000n,
      });
      // A room binding never activates either person's private assistant.
      expect((await readHostedRuntimeAiAccessDecision({ ...input, memberId: first })).allowed).toBe(false);
      await prisma.game.update({ where: { id: gameId }, data: { status: "settled", liveRosterKey: null, result: { v: 1, scores: [], termsVersion: 1 }, settledAt: now } });
      await assertRoom(false);
      await prisma.game.update({ where: { id: gameId }, data: { status: "live", liveRosterKey: `${first}:${second}` } });
      await prisma.hostedMember.update({ where: { id: second }, data: { suspendedAt: now } });
      await assertRoom(false);
      await prisma.hostedMember.update({ where: { id: second }, data: { suspendedAt: null } });
      await prisma.hostedConsentGrant.create({ data: {
        memberId: second, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: "revoked",
        source: "synthetic-test", documentVersionsJson: {}, grantedAt: now, revokedAt: now,
      } });
      await assertRoom(false);
      await prisma.hostedConsentGrant.delete({ where: {
        memberId_scope: { memberId: second, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE },
      } });
      vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", first);
      await assertRoom(false);
      vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", `${first},${second}`);
      await assertRoom(true);
      vi.stubEnv("MURPH_GAME_ENABLED", "false");
      await assertRoom(false);
      vi.stubEnv("MURPH_GAME_ENABLED", "true");
      await prisma.hostedMember.update({ where: { id: room }, data: { suspendedAt: now } });
      await assertRoom(false);
      await prisma.hostedMember.update({ where: { id: room }, data: { suspendedAt: null } });
      await prisma.gamePlayer.delete({ where: { gameId_memberId: { gameId, memberId: second } } });
      await assertRoom(false);
      await prisma.game.update({ where: { id: gameId }, data: { chatContainerMemberId: first } });
      expect(await readActiveHostedMemberAccess({ ...input, memberId: first })).toBe(false);
    } finally {
      await prisma.game.deleteMany({ where: { id: gameId } });
      await prisma.hostedThreadContainer.deleteMany({ where: { memberId: room } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });
});
