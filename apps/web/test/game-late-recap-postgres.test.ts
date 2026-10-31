import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import pg from "pg";
import { getPrisma } from "../src/lib/prisma";
import { sealGameText } from "../src/lib/game/crypto";
import { readGameRecapMaterial, sealGameRecap } from "../src/lib/game/service";
import { assertGameProposalDeliveryCurrentTx } from "../src/lib/game/chat-delivery-authority";
import { gameChatLifecycleEventId, markGameChatGenerationQueuedTx, reserveGameChatLifecycleTx } from "../src/lib/game/chat-lifecycle-receipt";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../src/lib/hosted-onboarding/linq-observability-identifiers";
import { buildHostedLinqDeliveryId } from "../src/lib/hosted-onboarding/linq-delivery-store";
import { applyHostedWebContractMigrations, listHostedWebContractMigrations } from "../scripts/run-production-contract-migrations";

vi.mock("../src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: async () => false }));
vi.mock("../src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: async () => false }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Late recap proof requires an isolated loopback test database.");
}
const migrationId = "20261031190000_recover_missing_game_recap";
const migrationSql = readFileSync(new URL(`../prisma/contract-migrations/${migrationId}/migration.sql`, import.meta.url), "utf8");
const targetId = "5325824e-9e5f-48a1-91b0-2fe954e616c7";
const members: string[] = [], games: string[] = [];
const recap = { pages: [
  { background: "paper" as const, blocks: [{ kind: "headline" as const, text: "A synthetic finished week" }] },
  { background: "sage" as const, blocks: [{ kind: "headline" as const, text: "The weekend was off" }] },
  { background: "slate" as const, blocks: [{ kind: "headline" as const, text: "Six days, six posts" }] },
], scoreLine: "Alex and Sam tied.", chatLine: "Six posts each and a weekend off. The story is in the app." };

async function fixture(gameId = randomUUID()) {
  const db = getPrisma();
  const players = [randomUUID(), randomUUID()], room = randomUUID();
  members.push(...players, room); games.push(gameId);
  await db.hostedMember.createMany({ data: [...players, room].map((id) => ({ id, billingStatus: "active" })) });
  for (const [seat, memberId] of players.entries()) {
    await db.gameProfile.create({ data: { memberId, timeZone: "UTC", firstNameEncrypted: (await sealGameText(
      { table: "game_profile", field: "first_name", rowId: memberId, memberId }, seat === 0 ? "Alex" : "Sam"))! } });
  }
  const termsWordsEncrypted = (await sealGameText({ table: "game", field: "terms_words", rowId: gameId, memberId: players[0]! }, JSON.stringify({
    v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Walk" }], stakes: [] }],
  })))!;
  await db.game.create({ data: {
    id: gameId, createdBy: players[0], status: "settled", lengthDays: 8, chatContainerMemberId: room,
    createdAt: new Date("2030-01-01T00:00:00Z"), settledAt: new Date("2030-01-11T12:00:00Z"),
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] }] },
    termsWordsEncrypted,
    result: { v: 1, termsVersion: 1, scores: players.map((memberId, seat) => ({ memberId, seat, score: 6, misses: 0 })) },
    players: { create: players.map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: new Date("2030-01-02T00:00:00Z") })) },
  } });
  await db.gameEntry.createMany({ data: players.flatMap((memberId) => [0, 1, 2, 5, 6, 7].map((dayIndex) => ({
    id: randomUUID(), gameId, memberId, dayIndex, attempt: 1, kind: "photo", receivedAt: new Date("2030-01-10T12:00:00Z"),
  }))) });
  const newerId = randomUUID(); games.push(newerId);
  await db.game.create({ data: {
    id: newerId, createdBy: players[0], ...withStatus("live"), lengthDays: 7, chatContainerMemberId: room,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [] }] }, termsWordsEncrypted: "unused",
    players: { create: players.map((memberId, seat) => ({ memberId, seat, timeZone: "UTC" })) },
  } });
  const eventId = gameChatLifecycleEventId(gameId, "recap");
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
  const sealInput = { beforeMutationTx: async () => {}, containerMemberId: room, eventId, gameId, playerMemberIds: players, recap };
  return { db, gameId, newerId, players, room, eventId, key, sealInput };
}

/** The schema's roster check: only negotiating and live games hold a roster key, and keys are unique. */
function withStatus(status: string) {
  return { status, liveRosterKey: status === "live" || status === "negotiating" ? `test-late-recap-${randomUUID()}` : null };
}

describe.skipIf(!enabled)("late settled-game recap PostgreSQL proof", () => {
  afterEach(async () => {
    await getPrisma().hostedLinqDelivery.deleteMany({ where: { source: "game_lifecycle", sourceRef: { in: games.splice(0) } } });
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });

  it("reads weekend days as off and seals an older game once while the newer live game stays untouched", async () => {
    const { db, gameId, newerId, players, room, eventId, sealInput } = await fixture();
    const material = await readGameRecapMaterial(gameId, room, players);
    expect(material?.game.days).toMatchObject([
      ...[0, 1, 2].map(() => ({ posts: { Alex: { kind: "photo" }, Sam: { kind: "photo" } } })),
      { posts: { Alex: "off", Sam: "off" } }, { posts: { Alex: "off", Sam: "off" } },
      ...[5, 6, 7].map(() => ({ posts: { Alex: { kind: "photo" }, Sam: { kind: "photo" } } })),
    ]);
    expect(await readGameRecapMaterial(gameId, "wrong-room", players)).toBeNull();
    expect(await readGameRecapMaterial(gameId, room, [players[0]!, "outsider"])).toBeNull();
    expect(await sealGameRecap(sealInput)).toBeNull(); // no receipt
    await reserveGameChatLifecycleTx({ gameId, kind: "recap", now: new Date(), tx: db });
    expect(await sealGameRecap(sealInput)).toBeNull(); // not queued
    await markGameChatGenerationQueuedTx(eventId, db, room);
    await expect(sealGameRecap({ ...sealInput, beforeMutationTx: async () => { throw new Error("stale runtime"); } })).rejects.toThrow("stale runtime");
    expect(await sealGameRecap({ ...sealInput, containerMemberId: "wrong-room" })).toBeNull();
    expect(await sealGameRecap({ ...sealInput, playerMemberIds: [players[0]!, "outsider"] })).toBeNull();
    const results = await Promise.all([recap, { ...recap, chatLine: "Another candidate" }].map((candidate) => sealGameRecap({ ...sealInput, recap: candidate })));
    expect(results[0]).toBeTruthy(); expect(results[0]).toEqual(results[1]);
    expect(await sealGameRecap({ ...sealInput, recap: null })).toEqual(results[0]);
    const stored = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(stored.recapEncrypted).toBeTruthy(); expect(stored.recapEncrypted).not.toContain("synthetic");
    expect((await db.game.findUniqueOrThrow({ where: { id: newerId } })).recapEncrypted).toBeNull();
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: room, playerMemberIds: players, deliveryIdempotencyKey: eventId })).resolves.toBe(true);
    await db.game.update({ where: { id: gameId }, data: { departedPlayer: { seat: 1 } } });
    expect(await readGameRecapMaterial(gameId, room, players)).toBeNull();
    expect(await sealGameRecap(sealInput)).toBeNull();
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: room, playerMemberIds: players, deliveryIdempotencyKey: eventId })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it.each(["live", "negotiating", "void"])("does not admit %s games for recap reads, seals or delivery", async (status) => {
    const { db, gameId, room, players, eventId, sealInput } = await fixture();
    await db.game.update({ where: { id: gameId }, data: withStatus(status) });
    await reserveGameChatLifecycleTx({ gameId, kind: "recap", now: new Date(), tx: db });
    await markGameChatGenerationQueuedTx(eventId, db, room);
    expect(await readGameRecapMaterial(gameId, room, players)).toBeNull();
    expect(await sealGameRecap(sealInput)).toBeNull();
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: room, playerMemberIds: players, deliveryIdempotencyKey: eventId })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it("runs the fixed-target SQL through the existing ledger and never rearms a receipt on replay", async () => {
    const { db, gameId, key, room, eventId, sealInput } = await fixture(targetId);
    const migration = (await listHostedWebContractMigrations()).filter((item) => item.id === migrationId);
    expect(migration).toHaveLength(1);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      expect(await applyHostedWebContractMigrations(client, migration)).toEqual({ applied: 1, skipped: 0 });
      expect(await applyHostedWebContractMigrations(client, migration)).toEqual({ applied: 0, skipped: 1 });
      const receipt = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(receipt).toMatchObject({ id: buildHostedLinqDeliveryId(key), source: "game_lifecycle", sourceRef: gameId,
        template: "game_recap", status: "awaiting_generation", targetKind: "thread", payloadOwnerMemberId: null });
      for (const status of ["generation_queued", "sent", "skipped", "failed"]) {
        await db.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { status } });
        const before = await db.hostedLinqDelivery.findUnique({ where: { id: receipt.id } });
        await db.$executeRawUnsafe(migrationSql);
        expect(await db.hostedLinqDelivery.findUnique({ where: { id: receipt.id } })).toEqual(before);
      }
      await db.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { status: "awaiting_generation" } });
      await markGameChatGenerationQueuedTx(eventId, db, room);
      expect(await sealGameRecap(sealInput)).toEqual(recap);
      await db.hostedLinqDelivery.delete({ where: { id: receipt.id } });
      await db.$executeRawUnsafe(migrationSql);
      expect(await db.hostedLinqDelivery.count({ where: { sourceRef: gameId } })).toBe(0);
    } finally {
      await client.query('DELETE FROM "_hosted_web_contract_migration" WHERE migration_id = $1', [migrationId]);
      await client.end();
    }
  });

  it("leaves unrelated and ineligible targets alone", async () => {
    const other = await fixture();
    await other.db.$executeRawUnsafe(migrationSql); // target absent
    expect(await other.db.hostedLinqDelivery.count({ where: { sourceRef: other.gameId } })).toBe(0);
    const { db, gameId, players, room } = await fixture(targetId);
    for (const data of [withStatus("live"), withStatus("negotiating"), { ...withStatus("settled"), chatContainerMemberId: null },
      { chatContainerMemberId: room, departedPlayer: { seat: 1 } }, { departedPlayer: Prisma.DbNull, recapEncrypted: "already-sealed" }]) {
      await db.game.update({ where: { id: gameId }, data });
      await db.$executeRawUnsafe(migrationSql);
      expect(await db.hostedLinqDelivery.count({ where: { sourceRef: gameId } })).toBe(0);
    }
    await db.game.update({ where: { id: gameId }, data: { recapEncrypted: null } });
    await db.gameBlock.create({ data: { blockerMemberId: players[0]!, blockedMemberId: players[1]! } });
    await db.$executeRawUnsafe(migrationSql);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: gameId } })).toBe(0);
    await db.gameBlock.deleteMany({ where: { blockerMemberId: players[0] } });
    await db.gamePlayer.deleteMany({ where: { gameId, memberId: players[1] } });
    await db.$executeRawUnsafe(migrationSql);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: gameId } })).toBe(0);
  });
});
