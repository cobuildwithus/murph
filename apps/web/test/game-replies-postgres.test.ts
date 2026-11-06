import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ApplePushRequest } from "@/src/lib/apple-push/send";

const mocks = vi.hoisted(() => ({ send: vi.fn(), actor: "" }));
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn(async () => {}) }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMember: async () => mocks.actor, requireGameMemberAuth: async () => ({ member: { id: mocks.actor }, sessionId: "synthetic-session" }), assertGameMemberAuthCurrentTx: async () => {}, requireCurrentTermsFor: async () => {} }));
// The provider boundary is fake; real AES envelopes still bind bytes to owner and row.
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: Buffer.alloc(32, 7), envelope: { rootKeyId: "synthetic-reply-root" } }),
  unwrapHostedDomainRootForWebByRootKeyId: async () => ({ rootKey: Buffer.alloc(32, 7) }),
}));
vi.mock("@/src/lib/game/push-delivery", () => ({
  readGamePushRoutes: async () => [],
  deliverGamePush: async (notification: { request: ApplePushRequest }, valid: () => Promise<boolean>) => {
    if (await valid()) { await mocks.send(notification.request); return "sent"; }
    return "superseded";
  },
}));

import type { GameCommand } from "@/src/lib/game/contract";
import { openGameMedia } from "@/src/lib/game/crypto";
import { devStartNow, devSettleNow, readGame, readHome, readHistory, readGameChatState, readGameRecapMaterial, readGameReplyAudio, removeGamePostForReview, runGameCommand } from "@/src/lib/game/service";
import { deliverGameReplyNotification } from "@/src/lib/game/reply-notification";
import { getPrisma } from "@/src/lib/prisma";
import { DELETE as withdrawPost } from "../app/api/game/v1/games/[id]/entries/[entryId]/route";
import { GET as audioRoute } from "../app/api/game/v1/games/[id]/replies/[replyId]/audio/route";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Reply proof needs an isolated loopback test database.");
const members: string[] = [];
const audio = readFileSync(new URL("./fixtures/game-reply-audio/apple-aac-1s.m4a", import.meta.url));
const levels = Array(32).fill(50);
const run = (actor: string, command: GameCommand) => runGameCommand({ actorMemberId: actor, command });
async function ok(actor: string, command: GameCommand) {
  const result = await run(actor, command);
  if (!result.ok) throw new Error(`${command.type}: ${result.error.code}`);
  return result.game;
}
async function member(name: string) {
  const id = `hbm_reply_${randomUUID()}`; members.push(id);
  await getPrisma().hostedMember.create({ data: { id, billingStatus: "active" } });
  await ok(id, { type: "setProfile", firstName: name, timeZone: "UTC" });
  return id;
}
async function pair(existing?: { owner: string; peer: string }, postOwner = true) {
  const owner = existing?.owner ?? await member("Ava"), peer = existing?.peer ?? await member("Sam");
  const gameId = randomUUID();
  const created = await ok(owner, { type: "createGame", gameId, inviteeFirstName: "Sam", terms: {
    tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], stakes: [{ kind: "prize", item: "Lunch" }], schedule: { count: 7 },
  } });
  await ok(peer, { type: "join", token: created!.inviteToken!, termsVersion: 1, timeZone: "UTC" });
  await devStartNow(gameId, owner).catch(() => undefined);
  const entryId = randomUUID(), peerEntry = randomUUID();
  if (postOwner) await ok(owner, { type: "post", gameId, entryId, kind: "words", text: "Owner post", mediaKeys: [] });
  await ok(peer, { type: "post", gameId, entryId: peerEntry, kind: "words", text: "Peer post", mediaKeys: [] });
  return { owner, peer, gameId, entryId, peerEntry };
}
const textReply = (gameId: string, entryId: string, replyId = randomUUID()): Extract<GameCommand, { type: "replyToPost" }> =>
  ({ type: "replyToPost", gameId, entryId, replyId, kind: "text", text: "Synthetic private reply" });
const voiceReply = (gameId: string, entryId: string): Extract<GameCommand, { type: "replyToPost" }> =>
  ({ type: "replyToPost", gameId, entryId, replyId: randomUUID(), kind: "voice", audio: audio.toString("base64"), levels });

async function latePush(gameId: string, entryId: string, replyId: string, memberId: string) {
  await deliverGameReplyNotification({ gameId, replyId, memberId, sessionId: "synthetic-session", commandKey: `game-reply-push:${entryId}`,
    request: { target: { token: "ab".repeat(32), environment: "development", topic: "ai.withmurph.app.dev" },
      collapseId: "synthetic", data: { gameId, notification: "game_reply" }, expiresAt: new Date(),
      message: { kind: "alert", title: "New game check-in", body: "New voice note on your post." } } });
}

describe.skipIf(!enabled)("post reply PostgreSQL contract", () => {
  afterAll(async () => {
    await getPrisma().game.deleteMany({ where: { wordsOwnerMemberId: { in: members } } });
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } });
  });

  it("preserves an occupied slot and its reply on a guarded different-ID post, and replays the committed ID", async () => {
    const { owner, peer, gameId, entryId } = await pair();
    await ok(peer, textReply(gameId, entryId));
    const snapshot = async () => ({
      entries: await getPrisma().gameEntry.findMany({ where: { gameId }, orderBy: { id: "asc" } }),
      replies: await getPrisma().gameReply.findMany({ where: { entry: { gameId } } }),
      events: await getPrisma().gameEvent.findMany({ where: { gameId }, orderBy: { id: "asc" } }),
    });
    const before = await snapshot();
    const command = { type: "post", gameId, entryId: randomUUID(), kind: "words", text: "Delayed post", expectEmptySlot: true };
    expect(await runGameCommand({ actorMemberId: owner, command })).toMatchObject({
      ok: false, status: 409, error: { code: "SLOT_TAKEN" },
    });
    expect(await snapshot()).toEqual(before);
    expect(await runGameCommand({ actorMemberId: owner, command: { ...command, entryId } })).toMatchObject({ ok: true });
    expect(await snapshot()).toEqual(before);
  });

  it.each([false, true])("accepts a guarded empty slot, including an explicit withdrawal retake=%s", async retake => {
    const { owner, gameId, entryId } = await pair(undefined, retake);
    if (retake) await ok(owner, { type: "withdraw", gameId, entryId });
    const nextId = randomUUID();
    expect(await runGameCommand({ actorMemberId: owner, command: {
      type: "post", gameId, entryId: nextId, kind: "words", text: "Next post", expectEmptySlot: true,
    } })).toMatchObject({ ok: true });
    expect(await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: nextId } })).toMatchObject({ attempt: retake ? 2 : 1, withdrawnAt: null });
  });

  it.each([false, null, "true", 1])("rejects an invalid empty-slot expectation: %s", async expectEmptySlot => {
    const { owner, gameId } = await pair();
    expect(await runGameCommand({ actorMemberId: owner, command: {
      type: "post", gameId, entryId: randomUUID(), kind: "words", text: "Delayed post", expectEmptySlot,
    } })).toMatchObject({ ok: false, status: 400, error: { code: "INVALID_REQUEST" } });
  });

  it("serializes two racing replies and keeps only content-free receipts", async () => {
    const { owner, peer, gameId, entryId } = await pair();
    const results = await Promise.all([run(peer, textReply(gameId, entryId)), run(peer, textReply(gameId, entryId))]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toMatchObject({ status: 409, error: { code: "REPLY_USED" } });
    expect(await getPrisma().gameReply.count({ where: { entryId } })).toBe(1);
    const events = await getPrisma().gameEvent.findMany({ where: { gameId, type: { in: ["reply_accepted", "reply_notification"] } } });
    expect(events).toHaveLength(2);
    for (const event of events) expect(Object.keys(event.payload as object).sort()).toEqual(event.type === "reply_accepted" ? ["entryId", "v"] : ["entryId"]);
    const received = (await readGame(gameId, owner))!.days[0].mine!;
    expect(received.reply).toMatchObject({ text: "Synthetic private reply", mine: false });
    expect(received).not.toHaveProperty("canReply");
    expect((await readGame(gameId, peer))!.days[0].others[0].entry).toMatchObject({ canReply: false, reply: { mine: true } });
  });

  it("replays simultaneous requests with one UUID and refuses groups at the command boundary", async () => {
    const { owner, peer, gameId, entryId } = await pair();
    const command = textReply(gameId, entryId);
    const results = await Promise.all([run(peer, command), run(peer, command)]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(await getPrisma().gameReply.count({ where: { entryId } })).toBe(1);
    await ok(peer, { type: "deleteReply", gameId, replyId: command.replyId });
    await getPrisma().game.update({ where: { id: gameId }, data: { maxPlayers: 10 } });
    expect(await runGameCommand({ actorMemberId: peer, multiplayer: true, command: textReply(gameId, entryId) })).toMatchObject({ ok: false });
    const group = await readGame(gameId, owner, true);
    expect(group).not.toBeNull();
    expect(JSON.stringify(group)).not.toContain('"canReply"');
  });

  it.each([false, true])("never resurrects a deleted UUID, with replacement=%s", async replacement => {
    const { owner, peer, gameId, entryId } = await pair();
    const original = textReply(gameId, entryId);
    await ok(peer, original);
    expect(await run(owner, { type: "deleteReply", gameId, replyId: original.replyId })).toMatchObject({ ok: false });
    const eventsBefore = await getPrisma().gameEvent.count({ where: { gameId } });
    await ok(peer, { type: "deleteReply", gameId, replyId: original.replyId });
    expect(await getPrisma().gameEvent.count({ where: { gameId } })).toBe(eventsBefore);
    const next = textReply(gameId, entryId);
    if (replacement) await ok(peer, next);
    await ok(peer, original);
    expect(await getPrisma().gameReply.findUnique({ where: { id: original.replyId } })).toBeNull();
    expect(await getPrisma().gameReply.count({ where: { entryId } })).toBe(replacement ? 1 : 0);
    if (replacement) expect(await getPrisma().gameReply.findUnique({ where: { id: next.replyId } })).not.toBeNull();
    expect(await getPrisma().gameEvent.count({ where: { commandKey: `game-reply-push:${entryId}` } })).toBe(1);
  });

  it("rejects cross-author, cross-entry, cross-game ID reuse, including after deletion", async () => {
    const first = await pair(), other = await pair(first);
    const command = textReply(first.gameId, first.entryId);
    await ok(first.peer, command);
    for (const afterDelete of [false, true]) {
      if (afterDelete) await ok(first.peer, { type: "deleteReply", gameId: first.gameId, replyId: command.replyId });
      expect(await run(first.owner, command)).toMatchObject({ ok: false, status: 409 });
      expect(await run(first.peer, { ...command, entryId: first.peerEntry })).toMatchObject({ ok: false, status: 409 });
      expect(await run(first.peer, { ...command, gameId: other.gameId, entryId: other.entryId })).toMatchObject({ ok: false, status: 409 });
    }
  });

  it.each(["withdraw", "retake", "ops"] as const)("removes voice rows, playback and pending pushes on %s", async action => {
    const { owner, peer, gameId, entryId } = await pair();
    const reply = voiceReply(gameId, entryId); await ok(peer, reply);
    expect(Buffer.from((await readGameReplyAudio(gameId, reply.replyId, owner))!)).toEqual(audio);
    const row = await getPrisma().gameReply.findUniqueOrThrow({ where: { id: reply.replyId } });
    await expect(openGameMedia({ envelope: row.audioEncrypted!, key: `game_reply:${randomUUID()}`, ownerMemberId: peer })).rejects.toThrow();
    await expect(openGameMedia({ envelope: row.audioEncrypted!, key: `game_reply:${row.id}`, ownerMemberId: owner })).rejects.toThrow();
    if (action === "withdraw") {
      mocks.actor = owner;
      expect((await withdrawPost(new Request("http://localhost/post", { method: "DELETE" }), { params: Promise.resolve({ id: gameId, entryId }) })).status).toBe(200);
    } else if (action === "retake") await ok(owner, { type: "post", gameId, entryId: randomUUID(), kind: "words", text: "Replacement", mediaKeys: [] });
    else await removeGamePostForReview(entryId);
    expect(await getPrisma().gameReply.findUnique({ where: { id: reply.replyId } })).toBeNull();
    mocks.actor = owner;
    expect((await audioRoute(new Request("http://localhost/audio"), { params: Promise.resolve({ id: gameId, replyId: reply.replyId }) })).status).toBe(404);
    mocks.send.mockClear(); await latePush(gameId, entryId, reply.replyId, owner); expect(mocks.send).not.toHaveBeenCalled();
  });

  it("serializes reply creation against public withdrawal", async () => {
    const { owner, peer, gameId, entryId } = await pair(); mocks.actor = owner;
    const results = await Promise.all([run(peer, voiceReply(gameId, entryId)),
      withdrawPost(new Request("http://localhost/post", { method: "DELETE" }), { params: Promise.resolve({ id: gameId, entryId }) })]);
    expect(results[1].status).toBe(200);
    expect(await getPrisma().gameReply.count({ where: { entryId } })).toBe(0);
  });

  it("authorizes each audio object, reads after settlement, deletes after block, and hides cross-game reports both ways", async () => {
    const first = await pair(), other = await pair(first), third = await member("Jo");
    const reply = voiceReply(first.gameId, first.entryId); await ok(first.peer, reply);
    expect(await readGameReplyAudio(first.gameId, reply.replyId, third)).toBeNull();
    expect(await readGameReplyAudio(other.gameId, reply.replyId, first.owner)).toBeNull();
    await devSettleNow(first.gameId, first.owner);
    expect(await readGameReplyAudio(first.gameId, reply.replyId, first.owner)).not.toBeNull();
    for (const [reporter, reported] of [[first.owner, first.peer], [first.peer, first.owner]]) {
      const reportId = randomUUID();
      await getPrisma().gameReport.create({ data: { id: reportId, reporterMemberId: reporter, reportedMemberId: reported, gameId: other.gameId, about: "player", reason: "other" } });
      for (const viewer of [first.owner, first.peer]) expect(await readGameReplyAudio(first.gameId, reply.replyId, viewer)).toBeNull();
      expect((await readGame(first.gameId, first.owner))!.days[0].mine).not.toHaveProperty("reply");
      mocks.send.mockClear(); await latePush(first.gameId, first.entryId, reply.replyId, first.owner); expect(mocks.send).not.toHaveBeenCalled();
      await getPrisma().gameReport.delete({ where: { id: reportId } });
    }
    await ok(first.owner, { type: "block", memberId: first.peer });
    expect(await readGameReplyAudio(first.gameId, reply.replyId, first.peer)).toBeNull();
    await ok(first.peer, { type: "deleteReply", gameId: first.gameId, replyId: reply.replyId });
    expect(await getPrisma().gameReply.count({ where: { entryId: first.entryId } })).toBe(0);
  });

  it("batches metadata without audio and keeps replies out of chat, recap and history", async () => {
    const { owner, peer, gameId, entryId } = await pair();
    const reply = voiceReply(gameId, entryId); await ok(peer, reply);
    const query = vi.spyOn(getPrisma().gameReply, "findMany");
    const reports = vi.spyOn(getPrisma().gameReport, "groupBy");
    await readHome(owner);
    expect(reports).toHaveBeenCalledTimes(1);
    expect(reports.mock.calls[0][0].by).toEqual(["reporterMemberId", "reportedMemberId"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]?.select).toBeDefined();
    expect(query.mock.calls[0][0]?.select).not.toHaveProperty("audioEncrypted");
    query.mockClear();
    const room = await member("Room");
    await getPrisma().game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    const chat = await readGameChatState(room, [owner, peer], owner);
    expect(chat.games).toHaveLength(1);
    expect(query).not.toHaveBeenCalled();
    await devSettleNow(gameId, owner);
    query.mockClear();
    const material = await readGameRecapMaterial(gameId, room, [owner, peer]);
    expect(material).not.toBeNull();
    const history = await readHistory(owner);
    for (const output of [chat, material, history]) {
      const json = JSON.stringify(output);
      expect(json).not.toContain(reply.replyId); expect(json).not.toContain('"reply":'); expect(json).not.toContain('"audio'); expect(json).not.toContain('"canReply"');
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("enforces the SQL shape checks and physical entry/game cascades", async () => {
    const { owner, peer, gameId, entryId, peerEntry } = await pair();
    const text = { id: randomUUID(), entryId, authorMemberId: peer, kind: "text", textEncrypted: "synthetic-sealed", levels: [] };
    for (const extra of [{ kind: "other" }, { textEncrypted: null }, { audioEncrypted: "extra" }, { durationMs: 1 }, { levels: [1] }]) {
      await expect(getPrisma().gameReply.create({ data: { ...text, ...extra } })).rejects.toThrow();
    }
    const voice = { ...text, kind: "voice", textEncrypted: null, audioEncrypted: "synthetic-sealed", durationMs: 1000, levels };
    for (const extra of [{ audioEncrypted: null }, { durationMs: null }, { durationMs: 0 }, { durationMs: 30_501 }, { levels: [1] }, { levels: Array(32).fill(-1) }, { levels: Array(32).fill(101) }]) {
      await expect(getPrisma().gameReply.create({ data: { ...voice, ...extra } })).rejects.toThrow();
    }
    await getPrisma().gameReply.create({ data: voice });
    await ok(owner, textReply(gameId, peerEntry));
    await getPrisma().gameEntry.delete({ where: { id: entryId } });
    expect(await getPrisma().gameReply.count({ where: { entryId } })).toBe(0);
    await getPrisma().game.delete({ where: { id: gameId } });
    expect(await getPrisma().gameReply.count({ where: { entryId: peerEntry } })).toBe(0);
  });
});
