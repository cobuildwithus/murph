import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
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
import { readGameChatFundingRooms } from "@/src/lib/game/chat-access";
import { markGameChatGenerationQueuedTx, reserveGameChatProposalTx, reserveGameChatLifecycleTx } from "@/src/lib/game/chat-lifecycle-receipt";
import { buildHostedLinqDeliveryId } from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey, createHostedLinqDeliverySourceRefLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";

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
  it.each(["cancelled", "change_expired"] as const)("funds only an ended game's bound room while its %s notice awaits dispatch", async (kind) => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true"); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const ids = Array.from({length: 5}, () => randomUUID());
    const [room, alternate, first, second, stranger] = ids;
    const gameId = randomUUID();
    const now = new Date();
    const eventId = kind === "cancelled" ? `game-cancelled:${gameId}` : `game-change-expired:${gameId}:proposal`;
    const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
    const input = { memberId: room, now, prisma };
    try {
      await prisma.hostedMember.createMany({data: ids.map(id => ({id,billingStatus:"not_started"}))});
      for (const memberId of [room,alternate]) {
        await prisma.hostedThreadContainer.create({data:{memberId,ownerMemberId:first,participants:{create:[first,second].map(participantMemberId => ({participantMemberId,handleLookupKey:`synthetic_${participantMemberId}`,firstSeenAt:now,lastSeenAt:now}))}}});
        await prisma.hostedThreadRoute.create({data:{channel:"linq",containerMemberId:memberId,threadLookupKey:`synthetic_${memberId}`,threadIdentityLookupKey:`synthetic_${memberId}`}});
      }
      await prisma.gameProfile.createMany({data:[first,second].map(memberId => ({memberId,firstNameEncrypted:"synthetic",timeZone:"UTC"}))});
      await prisma.game.create({data:{id:gameId,createdBy:first,status:"void",chatContainerMemberId:room,terms:{v:1,versions:[]},termsWordsEncrypted:"synthetic",players:{create:[first,second].map((memberId,seat)=>({memberId,seat,timeZone:"UTC"}))}}});
      expect(await readActiveHostedMemberAccess(input)).toBe(false);
      await reserveGameChatLifecycleTx({gameId,kind,proposalId:"proposal",now,tx:prisma});
      expect(await readActiveHostedMemberAccess(input)).toBe(false);
      await prisma.gameEvent.create({data:{gameId,actor:first,type:kind,payload:{v:1},createdAt:now}});
      for (const status of ["awaiting_generation","generation_queued"]) {
        await prisma.hostedLinqDelivery.updateMany({where:{idempotencyKey:key},data:{status}});
        expect(await readActiveHostedMemberAccess(input)).toBe(true);
        expect((await readHostedRuntimeAiAccessDecision(input)).allowed).toBe(true);
        expect(await readHostedAiUsageGate(input)).toMatchObject({allowed:true,limitUsdMicros:7_500_000n});
      }
      expect(await readActiveHostedMemberAccess({...input,memberId:alternate})).toBe(false);
      expect(await readActiveHostedMemberAccess({...input,memberId:first})).toBe(false);
      expect(await readActiveHostedMemberAccess({...input,now:new Date(now.getTime()+7*86_400_000)})).toBe(false);
      await prisma.hostedMember.update({where:{id:second},data:{suspendedAt:now}});
      expect(await readActiveHostedMemberAccess(input)).toBe(false);
      await prisma.hostedMember.update({where:{id:second},data:{suspendedAt:null}});
      await prisma.hostedThreadContainerParticipant.create({data:{containerMemberId:room,participantMemberId:stranger,handleLookupKey:"synthetic_extra",firstSeenAt:now,lastSeenAt:now}});
      expect(await readActiveHostedMemberAccess(input)).toBe(false);
      await prisma.hostedThreadContainerParticipant.delete({where:{containerMemberId_participantMemberId:{containerMemberId:room,participantMemberId:stranger}}});
      for (const status of ["provider_dispatch_started","accepted","failed","skipped"]) {
        await prisma.hostedLinqDelivery.updateMany({where:{idempotencyKey:key},data:{status}});
        expect(await readActiveHostedMemberAccess(input)).toBe(false);
      }
    } finally {
      await prisma.hostedLinqDelivery.deleteMany({where:{idempotencyKey:key}});
      await prisma.game.deleteMany({where:{id:gameId}});
      await prisma.hostedThreadContainer.deleteMany({where:{memberId:{in:[room,alternate]}}});
      await prisma.hostedMember.deleteMany({where:{id:{in:ids}}});
      await prisma.$disconnect(); vi.unstubAllEnvs();
    }
  });
  it("funds the bound negotiating or live room without personal access or an extra allowance", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const suffix = randomUUID();
    const room = `game_room_${suffix}`;
    const alternate = `game_alternate_${suffix}`;
    const first = `game_first_${suffix}`;
    const second = `game_second_${suffix}`;
    const unrelated = `game_unrelated_${suffix}`;
    const gameId = `game_access_${suffix}`;
    const historicalIds = Array.from({ length: 1_000 }, (_, index) => `game_history_${suffix}_${index}`);
    const ids = [room, alternate, first, second, unrelated];
    const now = new Date("2030-01-15T12:00:00Z");
    const input = { memberId: room, now, prisma };
    const assertRoom = async (allowed: boolean) => {
      expect(await readActiveHostedMemberAccess(input)).toBe(allowed);
      expect(await readActiveHostedMemberAccessState(input) !== null).toBe(allowed);
      expect((await readHostedRuntimeAiAccessDecision(input)).allowed).toBe(allowed);
      expect(await readActiveHostedMemberAccessIds({ memberIds: ids, now, prisma }))
        .toEqual(new Set(allowed ? [room, alternate] : []));
      expect(await readHostedRuntimeAiAllowedMemberIds({ memberIds: ids, now, prisma }))
        .toEqual(new Set(allowed ? [room, alternate] : []));
    };
    try {
      await prisma.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "not_started" })) });
      await prisma.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: first,
        participants: { create: [first, second].map(participantMemberId => ({ participantMemberId,
          handleLookupKey: `primary_${participantMemberId}`, firstSeenAt: now, lastSeenAt: now })) },
      } });
      await prisma.hostedThreadContainer.create({ data: { memberId: alternate, ownerMemberId: first,
        participants: { create: [first, second].map(participantMemberId => ({ participantMemberId,
          handleLookupKey: `synthetic_${participantMemberId}`, firstSeenAt: now, lastSeenAt: now })) },
      } });
      await prisma.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: alternate,
        threadLookupKey: `synthetic_${suffix}`, threadIdentityLookupKey: `synthetic_${suffix}` } });
      const proposalId = `proposal_${suffix}`;
      const eventId = `game-change:${gameId}:${proposalId}`;
      const receiptKey = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
      if (!receiptKey) throw new Error("Expected a lifecycle receipt key.");
      const bootstrapReceiptId = buildHostedLinqDeliveryId(receiptKey);
      // Use the same durable reservation and pre-generation transition as
      // preparation. No generated message, sealed payload, or provider exists.
      await reserveGameChatProposalTx({ gameId, proposalId, now, tx: prisma });
      await markGameChatGenerationQueuedTx(eventId, prisma, room);
      await expect(prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: bootstrapReceiptId } }))
        .resolves.toMatchObject({ payloadSchema: null, payloadCiphertext: null, payloadOwnerMemberId: room });
      await assertRoom(false);
      await prisma.gameProfile.createMany({ data: [first, second].map(memberId => ({
        memberId, firstNameEncrypted: "synthetic-sealed-name", timeZone: "America/New_York",
      })) });
      await prisma.game.create({ data: {
        id: gameId, createdBy: first, status: "negotiating", liveRosterKey: `${first}:${second}`, chatContainerMemberId: room,
        terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic-sealed-terms",
        players: { create: [first, second].map((memberId, seat) => ({
          memberId, seat, timeZone: "America/New_York", dayOne: new Date("2030-01-15T00:00:00Z"),
        })) },
      } });
      await assertRoom(true);
      // Provider dispatch blinds sourceRef; frozen retries retain admission
      // through the exact bound payload owner, not the original raw reference.
      await prisma.hostedLinqDelivery.update({ where: { id: bootstrapReceiptId }, data: {
        sourceRef: createHostedLinqDeliverySourceRefLookupKey(gameId), status: "provider_dispatch_started",
        payloadSchema: "game_chat_bootstrap_v1", payloadCiphertext: "synthetic-frozen-message",
      } });
      await assertRoom(true);
      await prisma.hostedLinqDelivery.update({ where: { id: bootstrapReceiptId }, data: { payloadSchema: "game_chat_bootstrap_v1", bootstrapRouteAttachedAt: now } });
      // A previously attached route cannot be deleted to recover bootstrap access.
      expect(await readActiveHostedMemberAccess(input)).toBe(false);
      await prisma.hostedLinqDelivery.update({ where: { id: bootstrapReceiptId }, data: { bootstrapRouteAttachedAt: null, skippedAt: now } });
      expect(await readActiveHostedMemberAccess(input)).toBe(false);
      await prisma.hostedLinqDelivery.update({ where: { id: bootstrapReceiptId }, data: { skippedAt: null } });
      await prisma.hostedThreadRoute.updateMany({ where: { containerMemberId: alternate }, data: { channel: "telegram" } });
      expect(await readActiveHostedMemberAccess({ ...input, memberId: alternate })).toBe(false);
      await prisma.hostedThreadRoute.updateMany({ where: { containerMemberId: alternate }, data: { channel: "linq" } });
      await prisma.game.createMany({ data: historicalIds.map(id => ({ id, createdBy: first,
        status: "settled", terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic-sealed-terms",
        settledAt: new Date("2029-01-01T00:00:00Z"),
      })) });
      await prisma.gamePlayer.createMany({ data: historicalIds.flatMap(gameId => [first, second].map((memberId, seat) => ({
        gameId, memberId, seat, timeZone: "UTC",
      }))) });
      const captured: { query?: Prisma.Sql } = {};
      await readGameChatFundingRooms({ memberIds: [alternate], now, prisma: {
        $queryRaw: <T>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Prisma.PrismaPromise<T> => {
          if ("sql" in query) captured.query = query;
          return prisma.$queryRaw<T>(query, ...values);
        },
      } });
      if (!captured.query) throw new Error("Expected the canonical funding query.");
      const explained = await prisma.$queryRaw<Array<{ "QUERY PLAN": Array<{ Plan: unknown }> }>>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${captured.query}`);
      const plan = JSON.stringify(explained);
      expect(plan).toContain("game_live_roster_key_key");
      // Historical-game membership is not traversed for an active reserved
      // pair, even when both people have a thousand previous games.
      const nodes = planNodes(explained[0]["QUERY PLAN"][0].Plan);
      expect(nodes.some(node => typeof node.Filter === "string" && node.Filter.includes("settled") && node["Actual Loops"] === 0)).toBe(true);
      await expect(readHostedAiUsageGate(input)).resolves.toMatchObject({
        allowed: true, limitUsdMicros: 7_500_000n,
      });
      expect(await readActiveHostedMemberAccess({ ...input, memberId: alternate })).toBe(true);
      await prisma.hostedAiUsagePeriod.create({ data: { memberId: room,
        periodStart: new Date("2030-01-01T00:00:00Z"), periodEnd: new Date("2030-02-01T00:00:00Z"),
        billingPlanCode: "launch_monthly", limitUsdMicros: 7_500_000n, spentUsdMicros: 2_000_000n,
      } });
      await expect(readHostedAiUsageGate({ ...input, memberId: alternate })).resolves.toMatchObject({
        allowed: true, memberId: alternate, spentUsdMicros: 2_000_000n, remainingUsdMicros: 5_500_000n,
      });
      expect(await prisma.hostedAiUsagePeriod.count({ where: { memberId: alternate } })).toBe(0);
      await prisma.hostedThreadContainerParticipant.create({ data: { containerMemberId: room,
        participantMemberId: unrelated, handleLookupKey: `extra_${suffix}`, firstSeenAt: now, lastSeenAt: now,
      } });
      expect(await readActiveHostedMemberAccess(input)).toBe(false);
      expect((await readHostedRuntimeAiAccessDecision(input)).allowed).toBe(false);
      // Binding is an announcement default, not permission to expose the game
      // to a third person. The still-exact alternate room retains its budget.
      await expect(readHostedAiUsageGate({ ...input, memberId: alternate })).resolves.toMatchObject({ allowed: true, spentUsdMicros: 2_000_000n });
      await prisma.hostedThreadContainerParticipant.delete({ where: {
        containerMemberId_participantMemberId: { containerMemberId: room, participantMemberId: unrelated },
      } });
      // Negotiation can bootstrap before a provider route exists. Activation
      // continues to use the same room and the same ordinary monthly cap.
      await prisma.game.update({ where: { id: gameId }, data: { status: "live" } });
      await assertRoom(true);
      await expect(readHostedAiUsageGate(input)).resolves.toMatchObject({
        allowed: true, limitUsdMicros: 7_500_000n,
      });
      // A room binding never activates either person's private assistant.
      expect((await readHostedRuntimeAiAccessDecision({ ...input, memberId: first })).allowed).toBe(false);
      await prisma.game.update({ where: { id: gameId }, data: { status: "settled", liveRosterKey: null, result: { v: 1, scores: [], termsVersion: 1 }, settledAt: now } });
      await assertRoom(true);
      await prisma.game.update({ where: { id: gameId }, data: { settledAt: new Date(now.getTime() - 7 * 86_400_000) } });
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
      await prisma.game.deleteMany({ where: { id: { in: [gameId, ...historicalIds] } } });
      await prisma.hostedThreadContainer.deleteMany({ where: { memberId: { in: [room, alternate] } } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });
});

function planNodes(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const node = value as Record<string, unknown>;
  return [node, ...(Array.isArray(node.Plans) ? node.Plans.flatMap(planNodes) : [])];
}
