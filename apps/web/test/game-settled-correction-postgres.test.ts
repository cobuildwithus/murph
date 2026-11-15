import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { toPrismaJsonObject } from "@/src/lib/device-sync/prisma-store/prisma-json";
import { prepareGameChangeWords } from "@/src/lib/game/change-words";
import { sealGameText } from "@/src/lib/game/crypto";
import { buildRecapFallback } from "@/src/lib/game/recap-fallback";
import { currentTerms, GAME_SETTLED_OPEN_MS, mergeStakeSlots, parseStoredResult, parseStoredTerms } from "@/src/lib/game/rules";
import { devSettleNow, readGame, readGameChatState, readHistory, readHome, removeGamePostForReview, runGameCommand } from "@/src/lib/game/service";
import { addDays, gameLocalDate } from "@/src/lib/game/time";
import { getPrisma } from "@/src/lib/prisma";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";

vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: (task: () => Promise<void>) => { void task(); } }));
vi.mock("@/src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: async () => {} }));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Settled correction proof needs an isolated local test database.");
const members: string[] = [];
const DAYS = 7;

type Score = { seat: number; score: number };
type RemovedTicket = { id: string; stakeKey: string; owedBySeats: number[]; owedToSeats: number[]; createdAt: string };
type Correction = { actor: string; v: number; dayIndex: number; before: Score[]; after: Score[]; ticketsAdded: string[]; ticketsRemoved: RemovedTicket[] };

/** The audit record as stored: who corrected which day, the result before and after, and the tickets that changed. */
function correctionOf(actor: string, payload: unknown): Correction {
  if (typeof payload !== "object" || payload === null) throw new Error("A correction event has an object payload.");
  const { v, dayIndex, before, after, ticketsAdded, ticketsRemoved } = payload as Partial<Record<keyof Correction, unknown>>;
  if (typeof v !== "number" || typeof dayIndex !== "number" || !Array.isArray(before) || !Array.isArray(after) || !Array.isArray(ticketsAdded) || !Array.isArray(ticketsRemoved)) throw new Error("A correction event records the day, both results and the ticket changes.");
  return { actor, v, dayIndex, before: before as Score[], after: after as Score[], ticketsAdded: ticketsAdded as string[], ticketsRemoved: ticketsRemoved as RemovedTicket[] };
}

/**
 * A seven-day, every-day pair game that has just settled. `missed` lists the
 * day indexes each player (Maya, then Sam) never posted.
 */
async function settledGame(missed: readonly [readonly number[], readonly number[]], options: { bothGet?: string; perMiss?: true; stillLive?: true } = {}) {
  const db = getPrisma();
  const a = randomUUID(), b = randomUUID(), room = randomUUID(), gameId = randomUUID();
  members.push(a, b, room);
  await db.hostedMember.createMany({ data: [a, b, room].map(id => ({ id, billingStatus: "active" })) });
  for (const [id, firstName] of [[a, "Maya"], [b, "Sam"]]) {
    expect((await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName, timeZone: "UTC" } })).ok).toBe(true);
  }
  const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Sam",
    terms: { tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose a film" }] } } });
  if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture create failed");
  expect((await runGameCommand({ actorMemberId: b, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).ok).toBe(true);
  let dayOne = addDays(gameLocalDate(new Date(), "UTC"), -DAYS);
  await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
  await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${dayOne}T00:00:00Z`) } });
  if (options.bothGet) {
    const row = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    const prepared = await prepareGameChangeWords(row, { kind: "edit", stakes: [{ kind: "both_get", item: options.bothGet }] }, 1);
    const previous = currentTerms(parseStoredTerms(row.terms));
    await db.game.update({ where: { id: gameId }, data: { termsWordsEncrypted: prepared.termsWordsEncrypted,
      terms: toPrismaJsonObject({ v: 1, versions: [{ ...previous, stakes: mergeStakeSlots(previous.stakes, prepared.stakes!) }] }) } });
  }
  if (options.perMiss) {
    // A released legacy stake: one ticket for each missed day of difference.
    const row = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    const stored = parseStoredTerms(row.terms);
    await db.game.update({ where: { id: gameId }, data: { terms: toPrismaJsonObject({ ...stored, versions: stored.versions.map(version => ({ ...version, stakes: version.stakes.map(stake => ({ ...stake, kind: "per_miss" as const })) })) }) } });
  }
  await db.gameEntry.createMany({ data: [a, b].flatMap((memberId, seat) => Array.from({ length: DAYS }, (_, dayIndex) => dayIndex)
    .filter(dayIndex => !missed[seat].includes(dayIndex))
    .map(dayIndex => ({ id: randomUUID(), gameId, memberId, dayIndex, attempt: 1, kind: "words", mediaKeys: [], receivedAt: new Date(`${addDays(dayOne, dayIndex)}T12:00:00Z`) }))) });
  if (!options.stillLive) await devSettleNow(gameId, a);
  const settled = await db.game.findUniqueOrThrow({ where: { id: gameId } });
  expect(settled.status).toBe(options.stillLive ? "live" : "settled");
  const day = (actor: string, dayIndex: number, incomplete: boolean, extra = {}) => runGameCommand({ actorMemberId: actor, chatContainerMemberId: room, chatPlayerMemberIds: [a, b],
    command: { type: "setDayCompletion", gameId, date: addDays(dayOne, dayIndex), incomplete, ...extra } });
  return { a, b, room, gameId, settledAt: settled.settledAt,
    date: (dayIndex: number) => addDays(dayOne, dayIndex),
    /** Moves the whole finished game into the past, so it ended `ms` ago. */
    endedAgo: async (ms: number) => {
      dayOne = addDays(dayOne, -8);
      await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${dayOne}T00:00:00Z`) } });
      await db.game.update({ where: { id: gameId }, data: { settledAt: new Date(Date.now() - ms) } });
    },
    count: (actor: string, dayIndex: number, text: string | null = "Did it, forgot to post") => day(actor, dayIndex, false, { credit: true, ...(text === null ? {} : { text }) }),
    uncount: (actor: string, dayIndex: number) => day(actor, dayIndex, true),
    scores: async () => parseStoredResult((await db.game.findUniqueOrThrow({ where: { id: gameId } })).result).scores.map(score => score.score),
    tickets: () => db.gameTicket.findMany({ where: { gameId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    corrections: async () => (await db.gameEvent.findMany({ where: { gameId, type: "result_corrected" }, orderBy: { id: "asc" } })).map(event => correctionOf(event.actor, event.payload)),
    outcome: async (viewer: string) => (await readGame(gameId, viewer))?.result?.outcome };
}

describe.skipIf(!enabled)("day corrections after a pair game settles, against PostgreSQL", () => {
  afterAll(async () => {
    await cleanupGameFixtures(getPrisma(), members);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } });
  });

  it("flips a loss to a tie and then to a win, and the records, prize and audit trail follow", async () => {
    const f = await settledGame([[2, 3], [4]]), db = getPrisma();
    const announcements = () => db.hostedLinqDelivery.findMany({ where: { source: "game_lifecycle", OR: [{ sourceRef: f.gameId }, { sourceRef: { startsWith: `${f.gameId}:` } }] }, orderBy: { id: "asc" } });
    const announced = await announcements();
    expect(announced.map(row => row.template)).toContain("game_recap");
    expect(await f.scores()).toEqual([5, 6]);
    expect(await f.outcome(f.a)).toBe("lost");
    const [owedToSam] = await f.tickets();
    expect(owedToSam).toMatchObject({ owedBySeats: [0], owedToSeats: [1], status: "open" });

    const tie = await f.count(f.a, 2);
    expect(tie).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
    expect(tie.ok && tie.chatLine).toMatch(/^Maya's check-in for \w+, \w+ \d+ now counts\. That changes the result\. The game ended in a 6–6 tie\.$/u);
    expect(await f.scores()).toEqual([6, 6]);
    expect([await f.outcome(f.a), await f.outcome(f.b)]).toEqual(["tie", "tie"]);
    expect(await f.tickets()).toEqual([]);
    expect((await readHome(f.b)).wallet.held).toEqual([]);
    expect((await readHistory(f.a)).people[0].record).toEqual({ won: 0, lost: 0, tied: 1 });

    // Once a recap exists it keeps the result it was written from, and the line says so.
    const owner = (await db.game.findUniqueOrThrow({ where: { id: f.gameId } })).wordsOwnerMemberId;
    const recapEncrypted = await sealGameText({ table: "game", field: "recap", rowId: f.gameId, memberId: owner }, JSON.stringify(buildRecapFallback([{ name: "Maya", score: 6 }, { name: "Sam", score: 6 }])));
    await db.game.update({ where: { id: f.gameId }, data: { recapEncrypted } });
    const win = await f.count(f.a, 3);
    expect(win.ok && win.chatLine).toMatch(/now counts\. That changes the result\. Maya won 7–6\. The recap was made before this change\.$/u);
    expect((await db.game.findUniqueOrThrow({ where: { id: f.gameId } })).recapEncrypted).toBe(recapEncrypted);
    expect(await f.scores()).toEqual([7, 6]);
    expect([await f.outcome(f.a), await f.outcome(f.b)]).toEqual(["won", "lost"]);
    const [owedToMaya, ...rest] = await f.tickets();
    expect(rest).toEqual([]);
    expect(owedToMaya).toMatchObject({ owedBySeats: [1], owedToSeats: [0], status: "open" });
    expect(owedToMaya.id).not.toBe(owedToSam.id);
    expect((await readHome(f.a)).wallet.held.map(ticket => ticket.id)).toEqual([owedToMaya.id]);
    expect((await readHistory(f.a)).people[0].record).toEqual({ won: 1, lost: 0, tied: 0 });
    expect((await readHistory(f.b)).people[0].record).toEqual({ won: 0, lost: 1, tied: 0 });

    // Who corrected which day, and the result before and after. The removed prize is kept in the record.
    expect(await f.corrections()).toEqual([
      { actor: f.a, v: 1, dayIndex: 2, before: [{ seat: 0, score: 5 }, { seat: 1, score: 6 }], after: [{ seat: 0, score: 6 }, { seat: 1, score: 6 }], ticketsAdded: [],
        ticketsRemoved: [{ id: owedToSam.id, stakeKey: owedToSam.stakeKey, owedBySeats: [0], owedToSeats: [1], createdAt: owedToSam.createdAt.toISOString() }] },
      { actor: f.a, v: 1, dayIndex: 3, before: [{ seat: 0, score: 6 }, { seat: 1, score: 6 }], after: [{ seat: 0, score: 7 }, { seat: 1, score: 6 }], ticketsAdded: [owedToMaya.id], ticketsRemoved: [] },
    ]);
    expect((await db.gameEvent.findMany({ where: { gameId: f.gameId, type: "day_credited" }, orderBy: { id: "asc" } })).map(event => [event.actor, (event.payload as { dayIndex: number }).dayIndex])).toEqual([[f.a, 2], [f.a, 3]]);

    // The game is still the same finished game: nothing that keys on the end moved, and nothing was announced.
    const row = await db.game.findUniqueOrThrow({ where: { id: f.gameId } });
    expect(row).toMatchObject({ status: "settled", settledAt: f.settledAt });
    expect(await announcements()).toEqual(announced);
    // The day itself reads as posted in the player's own words, for both players.
    expect((await readGame(f.gameId, f.b))?.days[2].others[0].entry).toMatchObject({ kind: "words", text: "Did it, forgot to post" });
  });

  it("says nothing extra and keeps the same prize when the added day does not change who won", async () => {
    const f = await settledGame([[1, 2, 3], []]);
    const [before] = await f.tickets();
    // The words are still the player's own: asked for once, and nothing is written until they give them.
    expect(await f.count(f.a, 1, null)).toMatchObject({ ok: true, dayOutcome: { status: "words_needed" } });
    expect(await f.scores()).toEqual([4, 7]);
    const counted = await f.count(f.a, 1);
    expect(counted).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
    expect(counted.ok && counted.chatLine).toBeUndefined();
    expect(await f.scores()).toEqual([5, 7]);
    expect(await f.tickets()).toEqual([before]);
    // A repeat changes nothing and records nothing.
    expect(await f.count(f.a, 1)).toMatchObject({ ok: true, dayOutcome: { status: "already_complete" } });
    expect(await f.corrections()).toHaveLength(1);
    expect(await getPrisma().gameEntry.count({ where: { gameId: f.gameId, memberId: f.a, dayIndex: 1 } })).toBe(1);
  });

  it("refuses with a plain reason once the game ended more than 7 days ago", async () => {
    const f = await settledGame([[2], []]), db = getPrisma();
    const chatDays = async () => {
      const players = (await readGameChatState(f.room, [f.a, f.b])).games.find(game => game.id === f.gameId)?.progress?.players;
      return players && [f.a, f.b].map(memberId => players.find(player => player.memberId === memberId)?.days.map(day => day.status));
    };
    // Murph is sent a finished game's days only while they can still be corrected.
    expect(await chatDays()).toEqual([["posted", "posted", "missed", "posted", "posted", "posted", "posted"], Array.from({ length: DAYS }, () => "posted")]);
    await f.endedAgo(GAME_SETTLED_OPEN_MS + 60_000);
    for (const attempt of [f.count(f.a, 2), f.uncount(f.b, 2)]) {
      expect(await attempt).toEqual({ ok: false, status: 409, error: { code: "GAME_NOT_LIVE", message: "This game ended more than 7 days ago, so its result is final." } });
    }
    expect(await f.scores()).toEqual([6, 7]);
    expect(await db.gameEntry.count({ where: { gameId: f.gameId, memberId: f.a, dayIndex: 2 } })).toBe(0);
    expect(await f.corrections()).toEqual([]);
    expect(await chatDays()).toBeUndefined();
    expect((await readGameChatState(f.room, [f.a, f.b])).games.find(game => game.id === f.gameId)?.result?.scores.map(score => score.score)).toEqual([6, 7]);
    // One minute inside the window it still works.
    await db.game.update({ where: { id: f.gameId }, data: { settledAt: new Date(Date.now() - GAME_SETTLED_OPEN_MS + 60_000) } });
    expect(await f.scores()).toEqual([6, 7]);
    expect(await f.count(f.a, 2)).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
  });

  it("keeps the same rules as a live game: own days only, in the game's chat, never a day off the calendar", async () => {
    const f = await settledGame([[2], [2]]);
    const outsider = randomUUID();
    members.push(outsider);
    await getPrisma().hostedMember.create({ data: { id: outsider, billingStatus: "active" } });
    expect(await runGameCommand({ actorMemberId: outsider, chatContainerMemberId: f.room, chatPlayerMemberIds: [f.a, f.b],
      command: { type: "setDayCompletion", gameId: f.gameId, date: f.date(2), incomplete: false, credit: true, text: "Sam did it" } })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    // No app route and no other chat can reach it.
    expect(await runGameCommand({ actorMemberId: f.a, command: { type: "setDayCompletion", gameId: f.gameId, date: f.date(2), incomplete: false, credit: true, text: "Did it" } })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    for (const dayIndex of [-1, DAYS]) expect(await f.count(f.a, dayIndex)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    // A player cannot touch the other player's day in either direction.
    expect(await f.uncount(f.a, 3)).toMatchObject({ ok: true, dayOutcome: { status: "marked_incomplete" } });
    expect(await f.scores()).toEqual([5, 6]);
    expect(await getPrisma().gameEntry.count({ where: { gameId: f.gameId, memberId: f.b, incomplete: true } })).toBe(0);
  });

  it("serializes both players correcting at once", async () => {
    const f = await settledGame([[2, 3], [4, 5]]);
    expect(await f.tickets()).toEqual([]);
    const results = await Promise.all([f.count(f.a, 2), f.count(f.b, 4)]);
    expect(results.map(result => result.ok && result.dayOutcome?.status)).toEqual(["credited", "credited"]);
    expect(await f.scores()).toEqual([6, 6]);
    expect(await f.tickets()).toEqual([]);
    // Each correction was decided from the other's result, so the trail is one chain.
    const [first, second] = await f.corrections();
    expect(first.before).toEqual([{ seat: 0, score: 5 }, { seat: 1, score: 5 }]);
    expect(second.before).toEqual(first.after);
    expect(second.after).toEqual([{ seat: 0, score: 6 }, { seat: 1, score: 6 }]);
    // The first one made a winner and a prize; the second took exactly that prize away again.
    expect(first.ticketsAdded).toHaveLength(1);
    expect(second.ticketsRemoved.map(ticket => ticket.id)).toEqual(first.ticketsAdded);
    // Both saw the result change, and the same retry afterwards changes nothing.
    expect(results.every(result => result.ok && typeof result.chatLine === "string")).toBe(true);
    expect((await Promise.all([f.count(f.a, 2), f.count(f.b, 4)])).map(result => result.ok && result.dayOutcome?.status)).toEqual(["already_complete", "already_complete"]);
    expect(await f.corrections()).toHaveLength(2);
  });

  it("leaves a rematch that is already live alone", async () => {
    const f = await settledGame([[2], []]), db = getPrisma();
    const rematchId = randomUUID();
    const created = await runGameCommand({ actorMemberId: f.b, command: { type: "createGame", gameId: rematchId, previousGameId: f.gameId, inviteeFirstName: "Maya",
      terms: { tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose a film" }] } } });
    if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture rematch failed");
    expect((await runGameCommand({ actorMemberId: f.a, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).ok).toBe(true);
    const rematch = () => db.game.findUniqueOrThrow({ where: { id: rematchId }, include: { players: true, tickets: true } });
    const before = await rematch();
    expect(before).toMatchObject({ status: "live", previousGameId: f.gameId, round: 2 });

    expect(await f.count(f.a, 2)).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
    expect(await f.scores()).toEqual([7, 7]);
    expect(await f.tickets()).toEqual([]);
    expect(await rematch()).toEqual(before);
    expect(await db.gameEntry.count({ where: { gameId: rematchId } })).toBe(0);
  });

  it("issues the both-win prize when the corrected game is one both players finished", async () => {
    const f = await settledGame([[], [5]], { bothGet: "Dinner out together" });
    const [prize] = await f.tickets();
    expect(prize).toMatchObject({ owedBySeats: [1], owedToSeats: [0] });
    const counted = await f.count(f.b, 5);
    expect(counted.ok && counted.chatLine).toMatch(/^Sam's check-in for .+ now counts\. That changes the result\. Both of you did every day\. You both get Dinner out together\.$/u);
    expect([await f.outcome(f.a), await f.outcome(f.b)]).toEqual(["perfect", "perfect"]);
    const tickets = await f.tickets();
    expect(tickets.map(ticket => [ticket.owedBySeats, ticket.owedToSeats]).sort()).toEqual([[[0], [1]], [[1], [0]]]);
    expect(new Set(tickets.map(ticket => ticket.stakeKey))).toEqual(new Set([tickets[0].stakeKey]));
    expect(tickets.some(ticket => ticket.id === prize.id || ticket.stakeKey === prize.stakeKey)).toBe(false);
    for (const viewer of [f.a, f.b]) expect((await readHome(viewer)).wallet.held.map(ticket => ticket.kind)).toEqual(["both_get"]);
    // Taking the day back makes it an ordinary win again, with the ordinary prize.
    expect(await f.uncount(f.b, 5)).toMatchObject({ ok: true, dayOutcome: { status: "marked_incomplete" } });
    expect((await f.tickets()).map(ticket => [ticket.stakeKey, ticket.owedBySeats, ticket.owedToSeats])).toEqual([[prize.stakeKey, [1], [0]]]);
  });

  it("never touches a prize that was already marked done", async () => {
    const f = await settledGame([[2], [4, 5]]);
    const [prize] = await f.tickets();
    expect(prize).toMatchObject({ owedBySeats: [1], owedToSeats: [0] });
    expect((await runGameCommand({ actorMemberId: f.a, command: { type: "redeem", ticketId: prize.id } })).ok).toBe(true);
    const done = (await f.tickets())[0];
    expect(done.status).toBe("redeemed");
    // Sam catches up to a tie: the prize Maya already received stays as it happened.
    expect(await f.count(f.b, 4)).toMatchObject({ ok: true });
    expect(await f.scores()).toEqual([6, 6]);
    expect(await f.tickets()).toEqual([done]);
    // Sam takes the day back: Maya won again and her prize was already given, so no second one appears.
    expect(await f.uncount(f.b, 4)).toMatchObject({ ok: true });
    expect(await f.tickets()).toEqual([done]);
    expect((await f.corrections()).map(event => [event.ticketsAdded, event.ticketsRemoved])).toEqual([[[], []], [[], []]]);
  });

  it("refuses to mark done a prize that a correction removed after the request had already found it", async () => {
    const f = await settledGame([[2], [4, 5]]), db = getPrisma();
    const [prize] = await f.tickets();
    // The exact interleaving: Maya's request has read the prize, then Sam's correction commits before her request takes the game lock.
    const redeemed = await runGameCommand({ actorMemberId: f.a, command: { type: "redeem", ticketId: prize.id },
      beforeMutationTx: async () => { expect(await f.count(f.b, 4)).toMatchObject({ ok: true, dayOutcome: { status: "credited" } }); } });
    expect(redeemed).toEqual({ ok: false, status: 403, error: { code: "TICKET_NOT_HELD", message: "That prize isn't yours to mark done." } });
    expect(await f.tickets()).toEqual([]);
    expect(await db.gameEvent.count({ where: { gameId: f.gameId, type: "redeemed" } })).toBe(0);
    expect((await f.corrections())[0].ticketsRemoved.map(ticket => ticket.id)).toEqual([prize.id]);
  });

  it("keeps a prize marked done at the same moment as a correction consistent, with no server error", async () => {
    for (let round = 0; round < 4; round += 1) {
      const f = await settledGame([[2], [4, 5]]), db = getPrisma();
      const [prize] = await f.tickets();
      // Maya marks her prize done while Sam's correction makes the game a tie, which would remove that prize.
      const [redeemed, counted] = await Promise.all([runGameCommand({ actorMemberId: f.a, command: { type: "redeem", ticketId: prize.id } }), f.count(f.b, 4)]);
      expect(counted).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
      const left = await f.tickets();
      const [correction] = await f.corrections();
      if (redeemed.ok) {
        // The prize was given first: it stays as it happened and the correction leaves it alone.
        expect(left.map(ticket => [ticket.id, ticket.status])).toEqual([[prize.id, "redeemed"]]);
        expect(correction.ticketsRemoved).toEqual([]);
      } else {
        // The correction came first: the prize is gone, and marking it done is an ordinary refusal.
        expect(redeemed).toEqual({ ok: false, status: 403, error: { code: "TICKET_NOT_HELD", message: "That prize isn't yours to mark done." } });
        expect(left).toEqual([]);
        expect(correction.ticketsRemoved.map(ticket => ticket.id)).toEqual([prize.id]);
        expect(await db.gameEvent.count({ where: { gameId: f.gameId, type: "redeemed" } })).toBe(0);
      }
    }
  });

  it("matches several identical legacy per-miss tickets by count, keeping done ones first", async () => {
    const f = await settledGame([[1, 2, 3], []], { perMiss: true });
    const issued = await f.tickets();
    expect(issued.map(ticket => [ticket.owedBySeats, ticket.owedToSeats, ticket.status])).toEqual(Array.from({ length: 3 }, () => [[0], [1], "open"]));
    // Sam marks the newest of the three done. It is the one that must survive every later change.
    const done = issued[2];
    expect((await runGameCommand({ actorMemberId: f.b, command: { type: "redeem", ticketId: done.id } })).ok).toBe(true);
    // One miss fewer: two are owed. The done one and the oldest open one stay; the other open one is removed.
    expect(await f.count(f.a, 1)).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
    expect((await f.tickets()).map(ticket => [ticket.id, ticket.status, ticket.createdAt])).toEqual([[issued[0].id, "open", issued[0].createdAt], [done.id, "redeemed", done.createdAt]]);
    // Two more days counted: one is owed, and it is the one already given. No open ticket is left.
    expect(await f.count(f.a, 2)).toMatchObject({ ok: true });
    expect(await f.count(f.a, 3)).toMatchObject({ ok: true });
    expect((await f.tickets()).map(ticket => ticket.id)).toEqual([done.id]);
    // Three misses again: only the missing two are issued.
    for (const day of [1, 2, 3]) expect(await f.uncount(f.a, day)).toMatchObject({ ok: true, dayOutcome: { status: "marked_incomplete" } });
    const again = await f.tickets();
    expect(again.map(ticket => ticket.status).sort()).toEqual(["open", "open", "redeemed"]);
    expect(again.filter(ticket => ticket.status === "open").every(ticket => !issued.some(first => first.id === ticket.id))).toBe(true);
    const trail = await f.corrections();
    expect(trail.map(event => [event.ticketsAdded.length, event.ticketsRemoved.map(ticket => ticket.id)])).toEqual([[0, [issued[1].id]], [0, [issued[0].id]], [0, []], [0, []], [1, []], [1, []]]);
    // The winner never changed, so nothing was said about the result.
    expect(await f.outcome(f.b)).toBe("won");
  });

  it("settles a game that has ended but was not settled yet, once, and then corrects it", async () => {
    const f = await settledGame([[2], [4]], { stillLive: true }), db = getPrisma();
    const settledEvents = () => db.gameEvent.findMany({ where: { gameId: f.gameId, type: "settled" } });
    const recaps = () => db.hostedLinqDelivery.count({ where: { source: "game_lifecycle", sourceRef: f.gameId, template: "game_recap" } });
    expect(await settledEvents()).toEqual([]);
    // No read came first: the correction itself finds the game over, settles it and then counts the day.
    const counted = await f.count(f.a, 2);
    expect(counted).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
    expect(counted.ok && counted.chatLine).toMatch(/That changes the result\. Maya won 7–6\.$/u);
    const row = await db.game.findUniqueOrThrow({ where: { id: f.gameId } });
    expect(row.status).toBe("settled");
    // The first settlement is the tie the posts decided; the correction is recorded on top of it.
    expect((await settledEvents()).map(event => event.payload)).toEqual([{ v: 1, scores: [{ seat: 0, score: 6 }, { seat: 1, score: 6 }], ticketIds: [] }]);
    expect((await f.corrections()).map(event => [event.before, event.after])).toEqual([[[{ seat: 0, score: 6 }, { seat: 1, score: 6 }], [{ seat: 0, score: 7 }, { seat: 1, score: 6 }]]]);
    expect(await recaps()).toBe(1);
    // A later correction is an ordinary one: no second settlement or recap, and the end time does not move.
    expect(await f.count(f.b, 4)).toMatchObject({ ok: true, dayOutcome: { status: "credited" } });
    expect(await settledEvents()).toHaveLength(1);
    expect(await recaps()).toBe(1);
    expect((await db.game.findUniqueOrThrow({ where: { id: f.gameId } })).settledAt).toEqual(row.settledAt);
    expect(await f.scores()).toEqual([7, 7]);
  });

  it("refuses when the stored result no longer matches the posts, so nobody else's score moves", async () => {
    const f = await settledGame([[2], []]), db = getPrisma();
    const samsPost = await db.gameEntry.findFirstOrThrow({ where: { gameId: f.gameId, memberId: f.b, dayIndex: 0 } });
    const listsDays = async () => (await readGameChatState(f.room, [f.a, f.b])).games.find(game => game.id === f.gameId)?.progress !== undefined;
    expect(await listsDays()).toBe(true);
    expect(await removeGamePostForReview(samsPost.id)).toBe(true);
    // Murph is no longer shown the days, so it is not told a correction is possible; a try is refused all the same.
    expect(await listsDays()).toBe(false);
    expect(await f.count(f.a, 2)).toEqual({ ok: false, status: 409, error: { code: "GAME_NOT_LIVE", message: "This game's result can't be changed anymore." } });
    expect(await f.scores()).toEqual([6, 7]);
    expect(await db.gameEntry.count({ where: { gameId: f.gameId, memberId: f.a, dayIndex: 2 } })).toBe(0);
    expect(await f.corrections()).toEqual([]);
  });
});
