import { requestGameRecapRegeneration } from "../src/lib/game/recap-regeneration";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { getPrisma } from "../src/lib/prisma";
import { sealGameText } from "../src/lib/game/crypto";
import { readGameRecapMaterial, readGame, sealGameRecap } from "../src/lib/game/service";
import { assertGameProposalDeliveryCurrentTx } from "../src/lib/game/chat-delivery-authority";
import { gameChatLifecycleEventId, markGameChatGenerationQueuedTx, reserveGameChatLifecycleTx } from "../src/lib/game/chat-lifecycle-receipt";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../src/lib/hosted-onboarding/linq-observability-identifiers";
import { recordHostedLinqRuntimeProviderDispatchFenceTx } from "../src/lib/hosted-onboarding/linq-delivery-store";
import { applyHostedWebContractMigrations, listHostedWebContractMigrations } from "../scripts/run-production-contract-migrations";

vi.mock("../src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: async () => false }));
vi.mock("../src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: async () => false }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Late recap proof requires an isolated loopback test database.");
}
const migrationId = "20261031190000_recover_missing_game_recap";
const migrationSql = readFileSync(new URL(`../prisma/contract-migrations/${migrationId}/migration.sql`, import.meta.url), "utf8");
// Historical SQL owns its fixed selector; never duplicate it in new fixtures.
const targetId = /target_game CONSTANT text := '([^']+)'/u.exec(migrationSql)![1];
const members: string[] = [], games: string[] = [], deliveries: string[] = [];
const recap = { pages: [
  { background: "paper" as const, blocks: [{ kind: "headline" as const, text: "A synthetic finished week" }] },
  { background: "sage" as const, blocks: [{ kind: "headline" as const, text: "The weekend was off" }] },
  { background: "slate" as const, blocks: [{ kind: "headline" as const, text: "Six days, six posts" }] },
], scoreLine: "Alex and Sam tied.", chatLine: "Six posts each and a weekend off. The story is in the app." };

async function fixture(gameId: string = randomUUID()) {
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
    id: gameId, createdBy: players[0], wordsOwnerMemberId: players[0], status: "settled", lengthDays: 8, chatContainerMemberId: room,
    createdAt: new Date("2030-01-01T00:00:00Z"), settledAt: new Date("2030-01-11T12:00:00Z"),
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] }] },
    termsWordsEncrypted,
    result: { v: 1, termsVersion: 1, scores: players.map((memberId, seat) => ({ memberId, seat, score: 6, misses: 0 })) },
    players: { create: players.map((memberId, seat) => ({ memberId, seat, joinedAt: new Date("2030-01-01T12:00:00Z"), timeZone: "UTC", dayOne: new Date("2030-01-02T00:00:00Z") })) },
  } });
  await db.gameEntry.createMany({ data: players.flatMap((memberId) => [0, 1, 2, 5, 6, 7].map((dayIndex) => ({
    id: randomUUID(), gameId, memberId, dayIndex, attempt: 1, kind: "photo", receivedAt: new Date("2030-01-10T12:00:00Z"),
  }))) });
  const newerId = randomUUID(); games.push(newerId);
  await db.game.create({ data: {
    id: newerId, createdBy: players[0], wordsOwnerMemberId: players[0], ...withStatus("live"), lengthDays: 7, chatContainerMemberId: room,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [] }] }, termsWordsEncrypted: "unused",
    players: { create: players.map((memberId, seat) => ({ memberId, seat, joinedAt: new Date("2030-01-01T12:00:00Z"), timeZone: "UTC" })) },
  } });
  const eventId = gameChatLifecycleEventId(gameId, "recap");
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
  const sealInput = { beforeMutationTx: async () => {}, containerMemberId: room, eventId, gameId, playerMemberIds: players, recap };
  return { db, gameId, newerId, players, room, eventId, key, sealInput };
}

/** The schema's roster check: only negotiating and live games hold a roster key, and keys are unique. */
function withStatus(status: string) {
  return { status,  };
}

describe.skipIf(!enabled)("late settled-game recap PostgreSQL proof", () => {
  afterEach(async () => {
    await getPrisma().hostedLinqDelivery.deleteMany({ where: { id: { in: deliveries.splice(0) } } });
    await getPrisma().hostedLinqDelivery.deleteMany({ where: { source: "game_lifecycle", OR: games.splice(0).flatMap((gameId) => [{ sourceRef: gameId }, { sourceRef: { startsWith: `${gameId}:` } }]) } });
    await getPrisma().game.deleteMany({ where: { wordsOwnerMemberId: { in: members } } });
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
    await db.game.update({ where: { id: gameId }, data: { players: { update: { where: { gameId_seat: { gameId, seat: 1 } }, data: { leftAt: new Date() } } } } });
    expect(await readGameRecapMaterial(gameId, room, players)).toBeNull();
    expect(await sealGameRecap(sealInput)).toBeNull();
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: room, playerMemberIds: players, deliveryIdempotencyKey: eventId })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it.each([false, true])("saves, reads and replays the exact recap shape; legacy scoreLine=%s", async (legacy) => {
    const { db, gameId, room, players, eventId, sealInput } = await fixture();
    const candidate = legacy ? recap : { pages: recap.pages, chatLine: recap.chatLine };
    await reserveGameChatLifecycleTx({ gameId, kind: "recap", now: new Date(), tx: db });
    await markGameChatGenerationQueuedTx(eventId, db, room);
    expect(await sealGameRecap({ ...sealInput, recap: candidate })).toEqual(candidate);
    expect(await sealGameRecap({ ...sealInput, recap: null })).toEqual(candidate);
    expect(await sealGameRecap({ ...sealInput, recap: { ...recap, chatLine: "Ignored retry" } })).toEqual(candidate);
    const view = await readGame(gameId, players[0]!);
    expect(view?.recap).toEqual(candidate);
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

  it.each(["accepted", "sent_no_receipt_expected"])("regenerates after %s once, replacing only on acceptance without touching the rematch", async (sentStatus) => {
    const { db, gameId, newerId, room, players, eventId, key, sealInput } = await fixture();
    await reserveGameChatLifecycleTx({ gameId, kind: "recap", now: new Date(), tx: db });
    await markGameChatGenerationQueuedTx(eventId, db, room);
    await sealGameRecap(sealInput);
    const priorDelivery = await db.hostedLinqDelivery.update({ where: { idempotencyKey: key }, data: {
      source: "hosted_runtime_linq_delivery", targetKind: "thread", threadIsDirect: false,
      status: sentStatus, acceptedAt: new Date(),
    } });
    deliveries.push(priorDelivery.id);
    const before = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    const newer = await db.game.findUniqueOrThrow({ where: { id: newerId } });
    const request = { gameId, regenerationId: "synthetic_request", execute: false, operatorMemberId: "system" };
    expect(await requestGameRecapRegeneration(request)).toMatchObject({ outcome: "would_regenerate", dryRun: true });
    expect(await db.gameEvent.count({ where: { gameId } })).toBe(0);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: { startsWith: `${gameId}:` } } })).toBe(0);
    const results = await Promise.all([1, 2].map(() => requestGameRecapRegeneration({ ...request, execute: true })));
    expect(results.map((result) => result.outcome).sort()).toEqual(["already_requested", "reserved"]);
    const regeneratedEventId = `${eventId}:${request.regenerationId}`;
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: `${gameId}:${request.regenerationId}` } })).toBe(1);
    expect(await requestGameRecapRegeneration({ ...request, regenerationId: "another_request", execute: true })).toMatchObject({ outcome: "delivery_pending" });
    expect((await db.game.findUniqueOrThrow({ where: { id: gameId } })).recapEncrypted).toBe(before.recapEncrypted);
    await markGameChatGenerationQueuedTx(regeneratedEventId, db, room);
    const regenerate = { ...sealInput, eventId: regeneratedEventId };
    expect(await sealGameRecap({ ...regenerate, recap: null })).toBeNull();
    await expect(sealGameRecap({ ...regenerate, beforeMutationTx: async () => { throw new Error("synthetic turn failure"); } })).rejects.toThrow("synthetic turn failure");
    expect((await readGame(gameId, players[0]!))?.recap).toEqual(recap);
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: room, playerMemberIds: players, deliveryIdempotencyKey: regeneratedEventId })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    const replacement = { ...recap, chatLine: "A fresh synthetic story from the same finished game." };
    const accepted = await Promise.all([replacement, { ...replacement, chatLine: "Ignored second candidate" }].map((candidate) => sealGameRecap({ ...regenerate, recap: candidate })));
    expect(accepted[0]).toEqual(accepted[1]);
    expect((await readGame(gameId, players[0]!))?.recap).toEqual(accepted[0]);
    expect(await sealGameRecap({ ...regenerate, recap: null })).toEqual(accepted[0]);
    expect(await db.gameEvent.count({ where: { gameId, type: "recap_regeneration_accepted" } })).toBe(1);
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: room, playerMemberIds: players, deliveryIdempotencyKey: regeneratedEventId })).resolves.toBe(true);
    expect(await db.game.findUniqueOrThrow({ where: { id: newerId } })).toEqual(newer);
    const deliveryKey = createHostedLinqDeliveryIdempotencyLookupKey(regeneratedEventId)!;
    const reserved = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: deliveryKey } });
    deliveries.push(reserved.id);
    const postToGroup = vi.fn();
    const dispatch = async () => {
      const claim = await db.$transaction(async (tx) => {
        await assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: room, playerMemberIds: players, deliveryIdempotencyKey: regeneratedEventId });
        return recordHostedLinqRuntimeProviderDispatchFenceTx({ idempotencyKey: regeneratedEventId, linqChatId: "synthetic-chat",
          sourceRef: regeneratedEventId, targetKind: "thread", prisma: tx });
      });
      if (claim.claimed) postToGroup();
    };
    await Promise.all([dispatch(), dispatch()]);
    expect(postToGroup).toHaveBeenCalledOnce();
    expect((await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: deliveryKey } })).id).toBe(reserved.id);
    await db.hostedLinqDelivery.update({ where: { idempotencyKey: deliveryKey }, data: {
      status: sentStatus, targetKind: "thread", threadIsDirect: false, acceptedAt: new Date(),
    } });
    await dispatch();
    expect(postToGroup).toHaveBeenCalledOnce();
    expect(await requestGameRecapRegeneration({ ...request, regenerationId: "next_request" }))
      .toMatchObject({ outcome: "would_regenerate", dryRun: true });
    expect(await requestGameRecapRegeneration({ ...request, execute: true })).toMatchObject({ outcome: "already_requested" });
    // Receipt retention cannot turn an operator retry into another send.
    await db.hostedLinqDelivery.delete({ where: { idempotencyKey: deliveryKey } });
    expect(await requestGameRecapRegeneration({ ...request, execute: true })).toMatchObject({ outcome: "already_requested" });
  });

  it.each(["live", "negotiating", "void", "departed", "blocked"])("refuses operator regeneration for %s games", async (condition) => {
    const { db, gameId, players } = await fixture();
    await db.game.update({ where: { id: gameId }, data: { recapEncrypted: "synthetic-old-ciphertext",
      ...(condition === "departed" ? { players: { update: { where: { gameId_seat: { gameId, seat: 1 } }, data: { leftAt: new Date() } } } } : condition === "blocked" ? {} : withStatus(condition)) } });
    if (condition === "blocked") await db.gameBlock.create({ data: { blockerMemberId: players[0]!, blockedMemberId: players[1]! } });
    for (const execute of [false, true]) {
      expect(await requestGameRecapRegeneration({ gameId, regenerationId: "synthetic_request", execute, operatorMemberId: "system" }))
        .toMatchObject({ outcome: condition === "departed" ? "player_departed" : condition === "blocked" ? "players_blocked" : "not_settled" });
    }
    expect(await db.gameEvent.count({ where: { gameId } })).toBe(0);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: { startsWith: gameId } } })).toBe(0);
  });

  it("rechecks the roster under the deletion row lock before accepting a replacement", async () => {
    const { db, gameId, room, players, eventId, sealInput } = await fixture();
    await db.game.update({ where: { id: gameId }, data: { recapEncrypted: "old-ciphertext" } });
    const request = { gameId, regenerationId: "synthetic_request", execute: true, operatorMemberId: "system" };
    expect(await requestGameRecapRegeneration(request)).toMatchObject({ outcome: "reserved" });
    const regeneratedEventId = `${eventId}:${request.regenerationId}`;
    await markGameChatGenerationQueuedTx(regeneratedEventId, db, room);
    let release!: () => void;
    let acquired!: () => void;
    const acquiredPromise = new Promise<void>((resolve) => { acquired = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const deletion = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
      acquired(); await releasePromise;
      await tx.game.update({ where: { id: gameId }, data: { recapEncrypted: null } });
      await tx.gameEntry.deleteMany({ where: { gameId, memberId: players[1] } });
      await tx.gamePlayer.update({ where: { gameId_seat: { gameId, seat: 1 } }, data: { memberId: null, leftAt: new Date() } });
    });
    await acquiredPromise;
    let entered!: () => void;
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    const sealing = sealGameRecap({ ...sealInput, eventId: regeneratedEventId, beforeMutationTx: async () => { entered(); } });
    await entering;
    release(); await deletion;
    expect(await sealing).toBeNull();
    expect((await db.game.findUniqueOrThrow({ where: { id: gameId } })).recapEncrypted).toBeNull();
  });

  it("keeps historical recovery proof on its old schema and retires it from dispatch", async () => {
    const { gameId, players, room } = await fixture(targetId);
    expect((await listHostedWebContractMigrations()).some(item => item.id === migrationId)).toBe(false);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const schema = `legacy_recap_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      // Isolate the immutable recovery's prior shape from current application tables.
      await client.query(`CREATE TABLE game AS SELECT * FROM public.game WHERE id = $1`, [gameId]);
      await client.query("ALTER TABLE game ADD COLUMN departed_player jsonb");
      await client.query(`CREATE TABLE game_player AS SELECT * FROM public.game_player WHERE game_id = $1`, [gameId]);
      await client.query("CREATE TABLE game_block AS TABLE public.game_block WITH NO DATA");
      await client.query("CREATE TABLE hosted_linq_delivery (LIKE public.hosted_linq_delivery INCLUDING DEFAULTS INCLUDING INDEXES)");
      const count = async () => Number((await client.query("SELECT count(*) AS n FROM hosted_linq_delivery")).rows[0].n);
      for (const patch of [
        "status = 'live'", "status = 'negotiating'", "status = 'settled', chat_container_member_id = NULL",
        "departed_player = '{\"seat\":1}'", "departed_player = NULL, recap_encrypted = 'already-sealed'",
      ]) {
        await client.query(`UPDATE game SET ${patch}`);
        await client.query(migrationSql);
        expect(await count()).toBe(0);
      }
      await client.query("UPDATE game SET chat_container_member_id = $1, recap_encrypted = NULL", [room]);
      await client.query("INSERT INTO game_block(blocker_member_id, blocked_member_id, created_at) VALUES ($1,$2,now())", players);
      await client.query(migrationSql); expect(await count()).toBe(0);
      await client.query("DELETE FROM game_block");
      const migration = [{ id: migrationId, sqlPath: "historical-recovery/migration.sql", sql: migrationSql, checksum: createHash("sha256").update(migrationSql).digest("hex") }];
      expect(await applyHostedWebContractMigrations(client, migration)).toEqual({ applied: 1, skipped: 0 });
      expect(await applyHostedWebContractMigrations(client, migration)).toEqual({ applied: 0, skipped: 1 });
      expect((await client.query("SELECT source,template,status FROM hosted_linq_delivery")).rows).toEqual([{ source: "game_lifecycle", template: "game_recap", status: "awaiting_generation" }]);
      for (const status of ["generation_queued", "sent", "skipped", "failed"]) {
        await client.query("UPDATE hosted_linq_delivery SET status = $1", [status]);
        const before = (await client.query("SELECT * FROM hosted_linq_delivery")).rows;
        await client.query(migrationSql);
        expect((await client.query("SELECT * FROM hosted_linq_delivery")).rows).toEqual(before);
      }
      await client.query("DELETE FROM hosted_linq_delivery");
      await client.query("DELETE FROM game_player WHERE member_id = $1", [players[1]]);
      await client.query(migrationSql); expect(await count()).toBe(0);
      await client.query("DELETE FROM game");
      await client.query(migrationSql); expect(await count()).toBe(0);
    } finally {
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  });
});
