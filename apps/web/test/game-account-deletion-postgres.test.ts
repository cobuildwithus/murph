import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn(async () => {}) }));

import { Prisma } from "@prisma/client";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import type { GameCommand, GameTermsInput } from "@/src/lib/game/contract";
import { applyGameAccountDeletionTx, prepareGameAccountDeletion } from "@/src/lib/game/account-deletion";
import { devSettleNow, devStartNow, readGame, readHome, runGameCommand } from "@/src/lib/game/service";
import { labelTarget, sealGameText, openGameTexts } from "@/src/lib/game/crypto";
import { getPrisma } from "@/src/lib/prisma";

vi.mock("@/src/lib/hosted-crypto/env", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { createHostedAuthorityVerifyKeyring } = await vi.importActual<typeof import("@murphai/runtime-state")>("@murphai/runtime-state");
  const { createHostedGcpKmsClientFromEnv } = await vi.importActual<typeof import("@/src/lib/hosted-crypto/gcp-kms")>("@/src/lib/hosted-crypto/gcp-kms");
  const authoritySignKeyVersionName = "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
  const authorityKey = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "jwk" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const gcpKms = createHostedGcpKmsClientFromEnv({
    HOSTED_CRYPTO_ENV: "test", HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"), NODE_ENV: "test",
  });
  return {
    getHostedWebCryptoConfig: () => ({
      authoritySignKeyVersionName, authoritySignPublicKeyPem: authorityKey.publicKey,
      authorityVerifyKeyring: createHostedAuthorityVerifyKeyring({ activeKeyVersionName: authoritySignKeyVersionName, activePublicKeyPem: authorityKey.publicKey }),
      env: "test", gcpKms, webWrapKmsKeyName: "projects/example/locations/global/keyRings/hosted/cryptoKeys/history-benchmark",
    }),
  };
});

const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (runPostgresProof && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("The game account-deletion proof needs an isolated local test database.");
}

const TERMS: GameTermsInput = {
  schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  stakes: [{ item: "Breakfast in bed", kind: "prize" }],
  tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
};
const memberIds: string[] = [];
const deletedGameIds = new Set<string>();
afterAll(async () => {
  if (deletedGameIds.size === 0) return;
  await getPrisma().hostedLinqDelivery.deleteMany({ where: {
    source: "game_lifecycle",
    OR: [...deletedGameIds].flatMap(id => [{ sourceRef: id }, { sourceRef: { startsWith: `${id}:` } }]),
  } });
});

let realCrypto = false;
async function member(firstName: string): Promise<string> {
  const id = `hbm_gamedel_${firstName.toLowerCase()}_${randomUUID().slice(0, 8)}`;
  await getPrisma().hostedMember.create({ data: { billingStatus: "active", id } });
  memberIds.push(id);
  if (realCrypto) {
    const { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } = await import("@/src/lib/hosted-crypto/domain-root-store");
    const { runWithHostedDomainRootUnwrapCache } = await import("@/src/lib/hosted-crypto/domain-root-unwrap-cache");
    await runWithHostedDomainRootUnwrapCache(async () => {
      const prepared = await prepareHostedDomainRootForWeb({ domain: "control", reason: "test", userId: id });
      await getPrisma().$transaction(tx => revalidatePreparedHostedDomainRootForWebTx({ prepared, tx }));
    });
  }
  await ok(id, { firstName, timeZone: "America/New_York", type: "setProfile" });
  return id;
}

async function run(actor: string, command: GameCommand) {
  return runGameCommand({ actorMemberId: actor, command });
}

async function ok(actor: string, command: GameCommand) {
  const result = await run(actor, command);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.error.code} ${result.error.message}`);
  return result.game;
}

async function invite(challenger: string, extra: Partial<Extract<GameCommand, { type: "createGame" }>> = {}) {
  const gameId = randomUUID();
  const created = await ok(challenger, { gameId, inviteeFirstName: "Bestie", terms: TERMS, type: "createGame", ...extra });
  return { gameId, token: created!.inviteToken! };
}

async function live(challenger: string, invitee: string) {
  const { gameId, token } = await invite(challenger);
  await ok(invitee, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" });
  await devStartNow(gameId, challenger).catch(() => undefined);
  return gameId;
}

async function words(actor: string, gameId: string, text: string) {
  return ok(actor, { entryId: randomUUID(), gameId, kind: "words", mediaKeys: [], text, type: "post" });
}

/** The deletion flow's game step: seal before, then apply and remove the member in one transaction. */
async function deleteAccount(memberId: string) {
  const prepared = await prepareGameAccountDeletion({ memberIds: [memberId], prisma: getPrisma() });
  // Deleting the last player can remove the game before fixture cleanup can find its receipts.
  for (const game of prepared.games) deletedGameIds.add(game.id);
  return getPrisma().$transaction(async (tx) => {
    const applied = await applyGameAccountDeletionTx({ memberIds: [memberId], now: new Date(), prepared, tx });
    await tx.hostedMember.delete({ where: { id: memberId } });
    return applied;
  });
}

describe.skipIf(!runPostgresProof)("weekly game when a player deletes their account", () => {
  afterAll(async () => {
    await cleanupGameFixtures(getPrisma(), memberIds);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
  });

  it.each([
    ["live", "creator"], ["live", "invitee"], ["settled", "creator"], ["settled", "invitee"],
  ] as const)("cascades replies in both directions when the %s game's %s deletes", async (status, role) => {
    const a = await member("Ava"), b = await member("Sam"), gameId = await live(a, b);
    const aPost = randomUUID(), bPost = randomUUID();
    await ok(a, { type: "post", gameId, entryId: aPost, kind: "words", text: "Owner post", mediaKeys: [] });
    await ok(b, { type: "post", gameId, entryId: bPost, kind: "words", text: "Peer post", mediaKeys: [] });
    await ok(a, { type: "replyToPost", gameId, entryId: bPost, replyId: randomUUID(), kind: "text", text: "Reply A" });
    await ok(b, { type: "replyToPost", gameId, entryId: aPost, replyId: randomUUID(), kind: "text", text: "Reply B" });
    if (status === "settled") await devSettleNow(gameId, a);
    const gone = role === "creator" ? a : b, stays = gone === a ? b : a, survivingPost = gone === a ? bPost : aPost;
    const postBefore = await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: survivingPost } });
    await deleteAccount(gone);
    expect(await getPrisma().gameReply.count({ where: { entryId: { in: [aPost, bPost] } } })).toBe(0);
    expect(await getPrisma().gameEntry.findUnique({ where: { id: survivingPost } })).toEqual(postBefore);
    const view = (await readGame(gameId, stays))!;
    expect(view.status).toBe(status === "live" ? "void" : "settled");
    expect(view.players.find(player => player.left)).toMatchObject({ memberId: null });
    expect(view.days[0].mine?.entryId).toBe(survivingPost);
    expect(view.days[0].mine).not.toHaveProperty("reply");
    await deleteAccount(stays);
    expect(await getPrisma().game.findUnique({ where: { id: gameId } })).toBeNull();
  });

  it.each(["creator", "invitee"] as const)("calls off a live game when the %s deletes, keeping the other player's posts", async (leaver) => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    const secondGame = await live(leo, ava);
    await words(leo, gameId, "Leo day one");
    await words(ava, gameId, "Ava day one");
    await getPrisma().game.update({ where: { id: gameId }, data: { recapEncrypted: "synthetic-must-clear" } });
    const [gone, stays] = leaver === "creator" ? [leo, ava] : [ava, leo];
    expect(await deleteAccount(gone)).toEqual({ calledOff: 2, deleted: 0, kept: 2 });
    expect(await readGame(secondGame, stays)).toMatchObject({ status: "void" });

    const view = (await readGame(gameId, stays))!;
    expect(view).toMatchObject({ status: "void", result: null, tickets: [], settlesAt: null });
    expect((await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).recapEncrypted).toBeNull();
    const left = view.players.find((player) => player.left);
    // The name the remaining player knew them by: Leo's own label for Ava, or Leo's own name.
    expect(left).toMatchObject({ memberId: null, firstName: leaver === "creator" ? "Leo" : "Bestie", seat: leaver === "creator" ? 0 : 1, avatarUrl: null });
    expect(view.players.find((player) => player.isMe)).toMatchObject({ memberId: stays });
    expect(view.terms.tasks.map((task) => task.text)).toEqual(["100 pushups", "10 min abs"]);
    expect(view.days[0].mine).toMatchObject({ text: stays === leo ? "Leo day one" : "Ava day one" });
    expect(view.days[0].others).toEqual([]);
    expect(await getPrisma().gameEntry.count({ where: { gameId, memberId: gone } })).toBe(0);
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ createdBy: leaver === "creator" ? null : leo });
    expect((await readHome(stays)).games.map((game) => game.id)).toContain(gameId);
    // Nothing more can happen in it.
    expect(await run(stays, { entryId: randomUUID(), gameId, kind: "words", mediaKeys: [], text: "again", type: "post" })).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    expect(await getPrisma().gameEvent.findFirst({ where: { gameId, type: "player_left" } })).toMatchObject({ actor: "system", payload: { calledOff: true, seat: left!.seat } });
  });

  it("deletes a creator's open invite that nobody joined, and its link stops working", async () => {
    const leo = await member("Leo");
    const { gameId, token } = await invite(leo);
    expect(await deleteAccount(leo)).toEqual({ calledOff: 0, deleted: 1, kept: 0 });
    expect(await getPrisma().game.findUnique({ where: { id: gameId } })).toBeNull();
    const ava = await member("Ava");
    expect(await run(ava, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" })).toMatchObject({ ok: false, error: { code: "INVITE_NOT_FOUND" } });
  });

  it.each(["creator", "invitee"] as const)("calls off an open addressed rematch when the %s deletes", async (leaver) => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const first = await live(leo, ava);
    await devSettleNow(first, leo);
    const rematch = (await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Bestie", previousGameId: first, terms: TERMS, type: "createGame" }))!;
    const [gone, stays] = leaver === "creator" ? [leo, ava] : [ava, leo];
    await deleteAccount(gone);

    const view = (await readGame(rematch.id, stays))!;
    expect(view.status).toBe("void");
    expect(view.players.map((player) => [player.seat, player.isMe, player.left ?? false])).toEqual([[0, stays === leo, leaver === "creator"], [1, stays === ava, leaver === "invitee"]]);
    expect(view.players.find((player) => player.left)!.firstName).toBe(leaver === "creator" ? "Leo" : "Bestie");
    expect((await readHome(stays)).games.map((game) => game.id)).toContain(rematch.id);
    // The old link can't start anything.
    const third = await member("Kat");
    expect(await run(third, { termsVersion: 1, timeZone: "America/New_York", token: rematch.inviteToken ?? "missing", type: "join" })).toMatchObject({ ok: false });
  });

  it.each(["winner deletes (creator)", "loser deletes (invitee)"] as const)("keeps a finished game and its tickets as history when the %s", async (label) => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    await words(leo, gameId, "Leo only");
    const settled = (await devSettleNow(gameId, leo))!;
    expect(settled.result).toMatchObject({ outcome: "won" });
    const ticket = settled.tickets[0];
    expect(ticket).toMatchObject({ youHold: true, status: "open" });
    const [gone, stays] = label.startsWith("winner") ? [leo, ava] : [ava, leo];
    expect(await deleteAccount(gone)).toEqual({ calledOff: 0, deleted: 0, kept: 1 });

    const view = (await readGame(gameId, stays))!;
    expect(view.status).toBe("settled");
    expect(view.result).toMatchObject({ outcome: stays === leo ? "won" : "lost" });
    expect(view.players.find((player) => player.left)).toMatchObject({ memberId: null, score: stays === leo ? 0 : 1 });
    expect(view.terms.stakes[0].item).toBe("Breakfast in bed");
    expect(view.tickets).toEqual([expect.objectContaining({ id: ticket.id, what: "Breakfast in bed", left: true, youHold: stays === leo })]);
    const wallet = (await readHome(stays)).wallet;
    expect([...wallet.held, ...wallet.owed].map((held) => held.id)).toContain(ticket.id);
    // The winner who stayed can't mark it done: the person who owed it is gone.
    if (stays === leo) {
      expect(await run(leo, { ticketId: ticket.id, type: "redeem" })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    }
    expect(await getPrisma().gameTicket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ status: "open", owedBySeats: [1], owedToSeats: [0] });
    const stored = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } });
    expect(JSON.stringify(stored.result)).not.toContain(gone);
  });

  it("uses an anonymous seat for a never-joined invitee and clears the invitation", async () => {
    const creator = await member("Alex"), invitee = await member("Sam");
    const { gameId } = await invite(creator);
    const db = getPrisma();
    await db.gameInvitee.update({ where: { gameId_seat: { gameId, seat: 1 } },
      data: { memberId: invitee, recipientLookupKey: "synthetic_lookup" } });
    expect(await db.gamePlayer.count({ where: { gameId } })).toBe(1);
    expect(await deleteAccount(invitee)).toEqual({ calledOff: 1, deleted: 0, kept: 1 });
    const view = (await readGame(gameId, creator))!;
    expect(view.status).toBe("void");
    expect(view.players).toHaveLength(2);
    expect(view.players[1]).toEqual({ avatarUrl: null, dayIndex: null, firstName: "Bestie",
      isMe: false, left: true, memberId: null, profileAvatarUrl: null,
      relationship: null, score: 0, seat: 1, streak: 0 });
    expect((await readHome(creator)).games.find(game => game.id === gameId)).toEqual(view);
    expect(await db.gamePlayer.findUniqueOrThrow({ where: { gameId_seat: { gameId, seat: 1 } } }))
      .toMatchObject({ memberId: null, joinedAt: null, timeZone: null, leftAt: expect.any(Date),
        departedLabel: [{ ownerMemberId: creator, nameEncrypted: expect.any(String) }] });
    expect(await db.gameInvitee.findMany({ where: { gameId } })).toEqual([
      { gameId, seat: 1, memberId: null, recipientLookupKey: null, pendingLabel: null },
    ]);
  });

  it("never keeps a deleted member's id on a recap receipt, whichever lands first", async () => {
    const db = getPrisma();
    const receipts = (gameId: string) => db.gameEvent.findMany({ where: { gameId, type: "recap_watched" }, select: { actor: true } });

    // Receipt first: two at once still make one, and deletion scrubs it with Ava's other events.
    const leo = await member("Leo");
    const ava = await member("Ava");
    const first = await live(leo, ava);
    await devSettleNow(first, leo);
    const both = await Promise.all([run(ava, { gameId: first, type: "watchRecap" }), run(ava, { gameId: first, type: "watchRecap" })]);
    expect(both.map(result => result.ok)).toEqual([true, true]);
    expect(await receipts(first)).toEqual([{ actor: ava }]);
    expect(await deleteAccount(ava)).toMatchObject({ kept: 1 });
    expect(await receipts(first)).toEqual([{ actor: "system" }]);

    // Deletion first, the game kept for Mia: Sam's receipt, admitted before, waits on the game lock and then finds no seat.
    const sam = await member("Sam");
    const mia = await member("Mia");
    const second = await live(sam, mia);
    await devSettleNow(second, sam);
    const prepared = await prepareGameAccountDeletion({ memberIds: [sam], prisma: db });
    let receipt: ReturnType<typeof run> | undefined;
    let waited = false;
    await db.$transaction(async (tx) => {
      await applyGameAccountDeletionTx({ memberIds: [sam], now: new Date(), prepared, tx });
      receipt = run(sam, { gameId: second, type: "watchRecap" });
      for (let tries = 0; tries < 100 && !waited; tries += 1) {
        const [{ waiting }] = await db.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`;
        waited = waiting > 0;
        if (!waited) await new Promise(resolve => setTimeout(resolve, 20));
      }
      await tx.hostedMember.delete({ where: { id: sam } });
    }, { timeout: 15_000 });
    expect(waited).toBe(true);
    expect(await receipt).toMatchObject({ ok: false, error: { code: "GAME_NOT_FOUND" } });
    expect(await db.game.count({ where: { id: second } })).toBe(1);
    expect(await receipts(second)).toEqual([]);
  }, 30_000);

  it("deletes a finished game once both players have left", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    await devSettleNow(gameId, leo);
    await deleteAccount(leo);
    expect(await deleteAccount(ava)).toEqual({ calledOff: 0, deleted: 1, kept: 0 });
    expect(await getPrisma().game.findUnique({ where: { id: gameId } })).toBeNull();
    expect(await getPrisma().gameTicket.count({ where: { gameId } })).toBe(0);
  });

  it("isn't stranded by more cancelled addressed rematches than the game bound", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const settled = await live(leo, ava);
    await devSettleNow(settled, leo);
    // Rematches Leo addressed to Ava and cancelled: only Leo's seat, void, no departure.
    const ids = Array.from({ length: 1_001 }, () => randomUUID());
    const template = await getPrisma().game.findUniqueOrThrow({ where: { id: settled } });
    await getPrisma().game.createMany({ data: ids.map((id) => ({ createdBy: leo, wordsOwnerMemberId: leo, id, lengthDays: 7, previousGameId: settled, round: 2,
      status: "void", terms: template.terms ?? {}, termsWordsEncrypted: template.termsWordsEncrypted })) });
    await getPrisma().gameInvitee.createMany({ data: ids.map(gameId => ({ gameId, seat: 1, memberId: ava })) });
    await getPrisma().gamePlayer.createMany({ data: ids.map((gameId) => ({ gameId, memberId: leo, seat: 0, joinedAt: new Date("2030-01-01T12:00:00Z"), timeZone: "America/New_York" })) });

    expect(await deleteAccount(ava)).toEqual({ calledOff: 0, deleted: 0, kept: 1 });
    expect(await getPrisma().game.count({ where: { id: { in: ids }, invitees: { some: { memberId: { not: null } } } } })).toBe(0);
    expect((await readGame(settled, leo))!.players.find((player) => player.left)).toMatchObject({ seat: 1 });
  });

  it("fails closed when a game changes between sealing and the deletion transaction", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    const prepared = await prepareGameAccountDeletion({ memberIds: [ava], prisma: getPrisma() });
    await devSettleNow(gameId, leo);
    await expect(getPrisma().$transaction((tx) => applyGameAccountDeletionTx({ memberIds: [ava], now: new Date(), prepared, tx })))
      .rejects.toMatchObject({ code: "ACCOUNT_DELETION_GAME_STATE_CHANGED", retryable: true });
    expect((await readGame(gameId, leo))!.players.some((player) => player.left)).toBe(false);
  });

  it.each(["live", "settled"] as const)("retains seats, isolated labels and words through successive three-player %s deletions", async (status) => {
    const first = await member("Alex"), second = await member("Blair"), third = await member("Casey");
    const gameId = await live(first, second);
    const db = getPrisma();
    if (status === "settled") await devSettleNow(gameId, first);
    const row = await db.game.findUniqueOrThrow({ where: { id: gameId }, include: { players: true } });
    await db.game.update({ where: { id: gameId }, data: { maxPlayers: 10 } });
    await db.gamePlayer.create({ data: { gameId, memberId: third, seat: 2, timeZone: "UTC", joinedAt: new Date(), dayOne: row.players[0]!.dayOne } });
    for (const [ownerMemberId, subjectMemberId, name] of [[second, first, "Coach"], [third, first, "Sibling"], [third, second, "Neighbor"]]) {
      await db.gameContactLabel.upsert({ where: { ownerMemberId_subjectMemberId: { ownerMemberId, subjectMemberId } },
        create: { ownerMemberId, subjectMemberId, nameEncrypted: await sealGameText(labelTarget(ownerMemberId, "name"), name) },
        update: { nameEncrypted: await sealGameText(labelTarget(ownerMemberId, "name"), name) } });
    }
    const frozen = { v: 1, termsVersion: 1, scores: [first, second, third].map((memberId, seat) => ({ memberId, seat, score: 3 - seat, misses: seat })) };
    if (status === "settled") {
      await db.game.update({ where: { id: gameId }, data: { result: frozen } });
      await db.gameTicket.create({ data: { id: randomUUID(), gameId, stakeKey: "synthetic", owedBySeats: [2], owedToSeats: [0, 1] } });
    }
    const staleSecond = await prepareGameAccountDeletion({ memberIds: [second], prisma: db });
    expect(await deleteAccount(first)).toEqual({ calledOff: 0, deleted: 0, kept: 1 });
    await expect(db.$transaction(tx => applyGameAccountDeletionTx({ memberIds: [second], now: new Date(), prepared: staleSecond, tx })))
      .rejects.toMatchObject({ code: "ACCOUNT_DELETION_GAME_STATE_CHANGED" });
    const afterFirst = await db.game.findUniqueOrThrow({ where: { id: gameId }, include: { players: true, invitees: true } });
    expect(afterFirst).toMatchObject({ createdBy: null, wordsOwnerMemberId: second, status });
    expect(afterFirst.players.find(player => player.seat === 0)).toMatchObject({ memberId: null, leftAt: expect.any(Date) });
    expect((await readGame(gameId, second, true))!.players.find(player => player.seat === 0)!.firstName).toBe("Coach");
    expect((await readGame(gameId, third, true))!.players.find(player => player.seat === 0)!.firstName).toBe("Sibling");
    expect(afterFirst.invitees.every(invitee => invitee.pendingLabel === null)).toBe(true);
    expect(await deleteAccount(second)).toEqual({ calledOff: status === "live" ? 1 : 0, deleted: 0, kept: 1 });
    const afterSecond = await db.game.findUniqueOrThrow({ where: { id: gameId }, include: { players: true, tickets: true } });
    expect(afterSecond.wordsOwnerMemberId).toBe(third);
    expect(afterSecond.players).toHaveLength(3);
    expect(afterSecond.players.filter(player => player.memberId === null)).toHaveLength(2);
    expect(JSON.stringify(afterSecond.players.map(player => player.departedLabel))).not.toContain(second);
    const view = (await readGame(gameId, third, true))!;
    expect(view.players.filter(player => player.left).map(player => player.firstName)).toEqual(["Sibling", "Neighbor"]);
    expect(view.terms.tasks.map(task => task.text)).toEqual(["100 pushups", "10 min abs"]);
    await expect(openGameTexts([{ table: "game", field: "terms_words", rowId: gameId, memberId: third, value: afterSecond.termsWordsEncrypted }]))
      .resolves.toEqual([expect.stringContaining("100 pushups")]);
    if (status === "settled") {
      expect(afterSecond.result).toEqual({ ...frozen, scores: frozen.scores.map(score => ({ ...score, memberId: score.seat < 2 ? "" : third })) });
      expect(afterSecond.tickets).toEqual([expect.objectContaining({ owedBySeats: [2], owedToSeats: [0, 1] })]);
    }
    expect(await deleteAccount(third)).toEqual({ calledOff: 0, deleted: 1, kept: 0 });
    expect(await db.game.findUnique({ where: { id: gameId } })).toBeNull();
  });

});

/** Every bulk row uses its own authenticated encryption target. */
async function seedHistory(owner: string, count: number, survivor?: string, invited?: string) {
  const db = getPrisma();
  const ids = Array.from({ length: count }, () => `history-${randomUUID()}`).sort();
  const rows: Prisma.GameCreateManyInput[] = [];
  for (const id of ids) rows.push({ id, createdBy: owner, wordsOwnerMemberId: owner,
    status: invited ? "invited" : "settled", terms: [{ n: 1, effectiveFromDay: 0, schedule: TERMS.schedule, stakes: [{ kind: "prize" }] }],
    termsWordsEncrypted: (await sealGameText({ table: "game", field: "terms_words", rowId: id, memberId: owner }, JSON.stringify({ tasks: TERMS.tasks, stakes: TERMS.stakes })))!,
    result: { scores: [{ memberId: owner, seat: 0, score: 1 }] } });
  await db.game.createMany({ data: rows });
  await db.gamePlayer.createMany({ data: ids.flatMap(gameId => [
    { gameId, memberId: owner, seat: 0, joinedAt: new Date(), timeZone: "UTC" },
    ...(survivor ? [{ gameId, memberId: survivor, seat: 1, joinedAt: new Date(), timeZone: "UTC" }] : []),
  ]) });
  if (invited) await db.gameInvitee.createMany({ data: ids.map(gameId => ({ gameId, memberId: invited, seat: 1, recipientLookupKey: "synthetic-address" })) });
  await db.gameEvent.createMany({ data: ids.map(gameId => ({ gameId, actor: owner, type: "created", payload: {} })) });
  return ids;
}
async function assertWords(gameId: string, owner: string) {
  const row = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } });
  expect(await openGameTexts([{ table: "game", field: "terms_words", rowId: gameId, memberId: owner, value: row.termsWordsEncrypted }])).toEqual([expect.stringContaining("100 pushups")]);
}
async function seedNotes(author: string, gameIds: string[]) {
  const data: Prisma.GameEventCreateManyInput[] = [];
  for (const gameId of gameIds) {
    const proposalId = randomUUID();
    data.push({ gameId, actor: author, type: "talk_requested", commandKey: `game-change:${gameId}:${proposalId}`,
      payload: { v: 2, proposalId, invitationSeat: 2, termsVersion: 1,
        noteEncrypted: await sealGameText({ table: "game", field: `talk_note:${proposalId}`, rowId: gameId, memberId: author }, "An outdoor prize?") } });
  }
  await getPrisma().gameEvent.createMany({ data });
  return data;
}
const pageTxOptions = { timeout: 60_000 };
const changed = { code: "ACCOUNT_DELETION_GAME_STATE_CHANGED", retryable: true };

describe.skipIf(!runPostgresProof)("residual account deletion pages", () => {
  const holder = globalThis as typeof globalThis & { __murphHostedSecureBoxStringTestCodec?: Parameters<typeof setHostedSecureBoxStringTestCodecForTests>[0] };
  let codec: Parameters<typeof setHostedSecureBoxStringTestCodecForTests>[0];
  beforeEach(() => { realCrypto = true; codec = holder.__murphHostedSecureBoxStringTestCodec ?? null; setHostedSecureBoxStringTestCodecForTests(null); });
  afterEach(() => { realCrypto = false; setHostedSecureBoxStringTestCodecForTests(codec); });
  afterAll(async () => {
    await cleanupGameFixtures(getPrisma(), memberIds);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
  });

  it("drains over 1,000 sealed games with rollback and fresh preparation at every boundary", async () => {
    const db = getPrisma(), leaver = await member("Leaver"), survivor = await member("Survivor");
    const kept = await seedHistory(leaver, 1_001, survivor);
    const sole = await seedHistory(leaver, 3);
    let residual = kept.length + sole.length;
    while (residual) {
      const prepared = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
      expect(prepared.games.length).toBe(Math.min(100, residual));
      expect(prepared.more).toBe(residual > 100);
      const pageIds = prepared.games.map(game => game.id);
      const snapshot = () => db.game.findMany({ where: { id: { in: pageIds } }, include: { players: true, invitees: true, events: true }, orderBy: { id: "asc" } });
      const before = await snapshot();
      await expect(db.$transaction(async tx => {
        await applyGameAccountDeletionTx({ memberIds: [leaver], prepared, tx, now: new Date() });
        throw new Error("rollback page");
      }, pageTxOptions)).rejects.toThrow("rollback page");
      expect(await snapshot()).toEqual(before);
      await db.$transaction(async tx => {
        await applyGameAccountDeletionTx({ memberIds: [leaver], prepared, tx, now: new Date() });
        if (!prepared.more) await tx.hostedMember.delete({ where: { id: leaver } });
      }, pageTxOptions);
      residual -= pageIds.length;
      expect(await db.game.count({ where: { wordsOwnerMemberId: leaver } })).toBe(residual);
      const processed = pageIds.find(id => kept.includes(id));
      if (processed) await assertWords(processed, survivor);
      if (prepared.more) {
        expect(await db.hostedMember.findUnique({ where: { id: leaver } })).not.toBeNull();
        expect(await db.gameProfile.findUnique({ where: { memberId: leaver } })).not.toBeNull();
        const untouched = await db.game.findFirstOrThrow({ where: { wordsOwnerMemberId: leaver } });
        await assertWords(untouched.id, leaver);
      }
    }
    expect(await db.game.count({ where: { id: { in: sole } } })).toBe(0);
    const retained = await db.game.findMany({ where: { id: { in: kept } }, include: { players: true, events: true } });
    expect(retained).toHaveLength(1_001);
    for (const game of retained) {
      expect(game).toMatchObject({ createdBy: null, wordsOwnerMemberId: survivor });
      expect(game.players.find(player => player.seat === 0)).toMatchObject({ memberId: null, leftAt: expect.any(Date) });
      expect(JSON.stringify([game.events.map(event => ({ actor: event.actor, payload: event.payload })), game.result])).not.toContain(leaver);
    }
  }, 180_000);

  it("drains over 1,000 unseated notes independently, scrubbing ciphertext before actor and retaining quota", async () => {
    const db = getPrisma(), author = await member("Author"), owner = await member("Owner");
    const games = await seedHistory(owner, 1_001);
    await db.game.updateMany({ where: { id: { in: games } }, data: { maxPlayers: 10 } });
    await db.gameInvitee.createMany({ data: games.map(gameId => ({ gameId, memberId: author, seat: 2 })) });
    const notes = await seedNotes(author, games);
    const first = notes[0], payload = first.payload as Prisma.InputJsonObject;
    const receiptId = `deletion-note-proof-${randomUUID()}`;
    await db.hostedLinqDelivery.create({ data: { id: receiptId, source: "game_lifecycle", sourceRef: `${first.gameId}:${payload.proposalId}`,
      template: "game_talk", status: "generation_queued", attemptedAt: new Date(),
      idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(`game-talk:${first.gameId}:${payload.proposalId}`) } });
    let residual = 1_001;
    while (residual) {
      const prepared = await prepareGameAccountDeletion({ memberIds: [author], prisma: db });
      expect(prepared.games).toEqual([]);
      // Applying before this assertion also proves the old independent note overflow.
      await db.$transaction(tx => applyGameAccountDeletionTx({ memberIds: [author], prepared, tx, now: new Date() }), pageTxOptions);
      expect(prepared.more).toBe(residual > 100);
      residual -= Math.min(100, residual);
      const rows = await db.gameEvent.findMany({ where: { gameId: { in: games }, type: "talk_requested" }, orderBy: { id: "asc" } });
      expect(rows.filter(row => row.actor === author)).toHaveLength(residual);
      for (const row of rows) {
        expect(row.payload).toMatchObject({ v: 2, invitationSeat: 2, termsVersion: 1,
          noteEncrypted: row.actor === "system" ? null : expect.any(String) });
      }
      const untouched = rows.find(row => row.actor === author);
      if (untouched) {
        const value = untouched.payload as { proposalId: string; noteEncrypted: string };
        expect(await openGameTexts([{ table: "game", rowId: untouched.gameId, field: `talk_note:${value.proposalId}`, memberId: author, value: value.noteEncrypted }])).toEqual(["An outdoor prize?"]);
      }
      expect(await db.hostedLinqDelivery.findUniqueOrThrow({ where: { id: receiptId } })).toMatchObject({ status: "skipped" });
    }
    await deleteAccount(author);
  }, 180_000);

  it("never selects a processed unjoined pair invitee again on resume", async () => {
    const db = getPrisma(), owner = await member("Owner"), leaver = await member("Invitee");
    const games = await seedHistory(owner, 101, undefined, leaver);
    const prepared = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
    expect(prepared.games).toHaveLength(100);
    await db.$transaction(tx => applyGameAccountDeletionTx({ memberIds: [leaver], prepared, tx, now: new Date() }), pageTxOptions);
    const next = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
    // Apply first so removal of the page invitation clear proves a duplicate-seat failure.
    await db.$transaction(tx => applyGameAccountDeletionTx({ memberIds: [leaver], prepared: next, tx, now: new Date() }), pageTxOptions);
    expect(next.games).toHaveLength(1);
    expect(next.games.every(game => !prepared.games.some(prior => prior.id === game.id))).toBe(true);
    expect(await db.gamePlayer.count({ where: { gameId: { in: games }, memberId: null, leftAt: { not: null } } })).toBe(101);
    expect(await db.gameInvitee.count({ where: { gameId: { in: games }, OR: [{ memberId: { not: null } }, { recipientLookupKey: { not: null } }] } })).toBe(0);
  }, 60_000);

  it("reprepares after a survivor command and serializes a waiting command with page commit", async () => {
    const db = getPrisma(), leaver = await member("Leaver"), survivor = await member("Survivor");
    const gameId = await live(leaver, survivor);
    await seedHistory(leaver, 101);
    const prepared = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
    expect(prepared.more).toBe(true);
    expect(prepared.games.some(game => game.id === gameId)).toBe(true);
    const snapshot = () => db.game.findMany({ where: { id: { in: prepared.games.map(game => game.id) } }, include: { players: true, events: true }, orderBy: { id: "asc" } });
    const proposalId = randomUUID();
    await ok(survivor, { type: "proposeChange", gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", stakes: [{ kind: "prize", item: "Choose a film" }] } });
    const before = await snapshot();
    await expect(db.$transaction(tx => applyGameAccountDeletionTx({ memberIds: [leaver], prepared, tx, now: new Date() }), pageTxOptions)).rejects.toMatchObject(changed);
    expect(await snapshot()).toEqual(before);
    expect(await db.gameEvent.count({ where: { gameId, type: "change_proposed", actor: survivor } })).toBe(1);
    const fresh = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
    let waiting: ReturnType<typeof run> | undefined;
    let waited = false;
    await db.$transaction(async tx => {
      await applyGameAccountDeletionTx({ memberIds: [leaver], prepared: fresh, tx, now: new Date() });
      waiting = run(survivor, { type: "post", gameId, entryId: randomUUID(), kind: "words", text: "After deletion", mediaKeys: [] });
      for (let tries = 0; tries < 100 && !waited; tries++) {
        const [locks] = await db.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`;
        waited = locks.waiting > 0;
        if (!waited) await new Promise(resolve => setTimeout(resolve, 20));
      }
    }, pageTxOptions);
    expect(waited).toBe(true);
    expect(await waiting).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    expect(await db.gameEvent.count({ where: { gameId, type: "change_proposed", actor: survivor } })).toBe(1);
    await deleteAccount(leaver);
  }, 60_000);

  it.each(["game", "invitation", "note"] as const)("retains keys when a new %s arrives after final preparation", async kind => {
    const db = getPrisma(), leaver = await member("Leaver"), survivor = await member("Survivor");
    await seedHistory(leaver, 101);
    const page = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
    expect(page.more).toBe(true);
    await db.$transaction(tx => applyGameAccountDeletionTx({ memberIds: [leaver], prepared: page, tx, now: new Date() }), pageTxOptions);
    if (kind === "note") {
      const noteGames = await seedHistory(survivor, 100);
      await db.game.updateMany({ where: { id: { in: noteGames } }, data: { maxPlayers: 10 } });
      await seedNotes(leaver, noteGames);
    }
    const final = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
    expect(final.more).toBe(false);
    const [newId] = await seedHistory(kind === "game" ? leaver : survivor, 1, undefined, kind === "invitation" ? leaver : undefined);
    if (kind === "note") {
      await db.game.update({ where: { id: newId }, data: { maxPlayers: 10 } });
      await seedNotes(leaver, [newId]);
    }
    await expect(db.$transaction(async tx => {
      await applyGameAccountDeletionTx({ memberIds: [leaver], prepared: final, tx, now: new Date() });
      await tx.hostedMember.delete({ where: { id: leaver } });
    }, pageTxOptions)).rejects.toMatchObject(changed);
    expect(await db.hostedMember.findUnique({ where: { id: leaver } })).not.toBeNull();
    const profile = await db.gameProfile.findUniqueOrThrow({ where: { memberId: leaver } });
    expect(await openGameTexts([{ table: "game_profile", field: "first_name", rowId: leaver, memberId: leaver, value: profile.firstNameEncrypted }])).toEqual(["Leaver"]);
    await assertWords(newId, kind === "game" ? leaver : survivor);
    if (kind === "note") {
      const note = await db.gameEvent.findFirstOrThrow({ where: { gameId: newId, actor: leaver, type: "talk_requested" } });
      const payload = note.payload as { proposalId: string; noteEncrypted: string };
      expect(await openGameTexts([{ table: "game", field: `talk_note:${payload.proposalId}`, rowId: newId, memberId: leaver, value: payload.noteEncrypted }])).toEqual(["An outdoor prize?"]);
    }
    for (;;) {
      const fresh = await prepareGameAccountDeletion({ memberIds: [leaver], prisma: db });
      await db.$transaction(async tx => {
        await applyGameAccountDeletionTx({ memberIds: [leaver], prepared: fresh, tx, now: new Date() });
        if (!fresh.more) await tx.hostedMember.delete({ where: { id: leaver } });
      }, pageTxOptions);
      if (!fresh.more) break;
    }
    expect(await db.hostedMember.findUnique({ where: { id: leaver } })).toBeNull();
  }, 90_000);
});
