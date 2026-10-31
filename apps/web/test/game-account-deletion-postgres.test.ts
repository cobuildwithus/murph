import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn(async () => {}) }));

import type { GameCommand, GameTermsInput } from "@/src/lib/game/contract";
import { applyGameAccountDeletionTx, prepareGameAccountDeletion } from "@/src/lib/game/account-deletion";
import { devSettleNow, devStartNow, readGame, readHome, runGameCommand } from "@/src/lib/game/service";
import { getPrisma } from "@/src/lib/prisma";

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

async function member(firstName: string): Promise<string> {
  const id = `hbm_gamedel_${firstName.toLowerCase()}_${randomUUID().slice(0, 8)}`;
  await getPrisma().hostedMember.create({ data: { billingStatus: "active", id } });
  memberIds.push(id);
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
  return getPrisma().$transaction(async (tx) => {
    const applied = await applyGameAccountDeletionTx({ memberIds: [memberId], now: new Date(), prepared, tx });
    await tx.hostedMember.delete({ where: { id: memberId } });
    return applied;
  });
}

describe.skipIf(!runPostgresProof)("weekly game when a player deletes their account", () => {
  afterAll(async () => {
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
  });

  it.each(["creator", "invitee"] as const)("calls off a live game when the %s deletes, keeping the other player's posts", async (leaver) => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    await words(leo, gameId, "Leo day one");
    await words(ava, gameId, "Ava day one");
    await getPrisma().game.update({ where: { id: gameId }, data: { recapEncrypted: "synthetic-must-clear" } });
    const [gone, stays] = leaver === "creator" ? [leo, ava] : [ava, leo];
    expect(await deleteAccount(gone)).toEqual({ calledOff: 1, deleted: 0, kept: 1 });

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
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ liveRosterKey: null, createdBy: leaver === "creator" ? null : leo });
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
    expect(await getPrisma().gameTicket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ status: "open", ...(gone === ava ? { owedBy: null } : { owedTo: null }) });
    const stored = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } });
    expect(JSON.stringify(stored.result)).not.toContain(gone);
  });

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
    await getPrisma().game.createMany({ data: ids.map((id) => ({ createdBy: leo, id, inviteeMemberId: ava, lengthDays: 7, previousGameId: settled, round: 2,
      status: "void", terms: template.terms ?? {}, termsWordsEncrypted: template.termsWordsEncrypted })) });
    await getPrisma().gamePlayer.createMany({ data: ids.map((gameId) => ({ gameId, memberId: leo, seat: 0, timeZone: "America/New_York" })) });

    expect(await deleteAccount(ava)).toEqual({ calledOff: 0, deleted: 0, kept: 1 });
    expect(await getPrisma().game.count({ where: { id: { in: ids }, inviteeMemberId: { not: null } } })).toBe(0);
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
});
