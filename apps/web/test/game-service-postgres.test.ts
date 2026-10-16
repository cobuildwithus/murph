import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GameCommand, GameTermsInput } from "@/src/lib/game/contract";
import { putGameMedia } from "@/src/lib/game/media";
import {
  devAdvanceDays,
  devSettleNow,
  devStartNow,
  mediaKeyPrefixFor,
  authorizeMediaRead,
  readGame,
  readHome,
  readInvitePreview,
  runGameCommand,
} from "@/src/lib/game/service";
import { addDays, gameLocalDate, weekdayOf } from "@/src/lib/game/time";
import { getPrisma } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error("The weekly game PostgreSQL proof requires a local DATABASE_URL.");
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const TERMS: GameTermsInput = {
  schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  stakes: [{ item: "Breakfast in bed", kind: "winner_gets" }],
  tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
};
const memberIds: string[] = [];
let mediaDir = "";

async function member(firstName: string, timeZone: string): Promise<string> {
  const id = `hbm_gametest_${firstName.toLowerCase()}_${randomUUID().slice(0, 8)}`;
  await getPrisma().hostedMember.create({ data: { billingStatus: "active", id } });
  memberIds.push(id);
  await ok(id, { firstName, timeZone, type: "setProfile" });
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

async function errorCode(actor: string, command: GameCommand) {
  const result = await run(actor, command);
  return result.ok ? "OK" : result.error.code;
}

/** A real stored upload under the member's prefix, as POST /media stores it (distinct bytes per name). */
async function upload(memberId: string, name: string): Promise<string> {
  const bytes = new Uint8Array([...JPEG, ...new TextEncoder().encode(name)]);
  return putGameMedia({ bytes, contentType: "image/jpeg", prefix: mediaKeyPrefixFor(memberId) });
}

async function photo(actor: string, gameId: string, name: string, text?: string): Promise<GameCommand> {
  return {
    entryId: randomUUID(),
    gameId,
    kind: "photo",
    mediaKeys: [await upload(actor, name)],
    type: "post",
    ...(text ? { text } : {}),
  };
}

/** Challenger invites, invitee accepts; returns the game id and its invite token. */
async function startGame(challenger: string, invitee: string, extra: Partial<Extract<GameCommand, { type: "createGame" }>> = {}) {
  const gameId = randomUUID();
  const created = await ok(challenger, { gameId, inviteeFirstName: "Friend", terms: TERMS, type: "createGame", ...extra });
  const token = created!.inviteToken!;
  await ok(invitee, { termsVersion: 1, timeZone: "UTC", token, type: "join" });
  return { gameId, token };
}

describe.skipIf(!runPostgresProof)("weekly game service against PostgreSQL", () => {
  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "game-media-"));
    process.env.MURPH_GAME_MEDIA_DIR = mediaDir;
  });

  afterAll(async () => {
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
    delete process.env.MURPH_GAME_MEDIA_DIR;
    await rm(mediaDir, { force: true, recursive: true });
  });

  it("plays a full 1v1 game through the one write path", async () => {
    const leoNoProfile = `hbm_gametest_new_${randomUUID().slice(0, 8)}`;
    await getPrisma().hostedMember.create({ data: { billingStatus: "active", id: leoNoProfile } });
    memberIds.push(leoNoProfile);
    expect(await errorCode(leoNoProfile, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" }))
      .toBe("PROFILE_REQUIRED");
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");

    // Create; a retry with the same game id returns the same game.
    const gameId = randomUUID();
    const create: GameCommand = {
      gameId,
      inviteeFirstName: "Ava",
      inviteeLabel: { relationship: "girlfriend" },
      terms: TERMS,
      type: "createGame",
    };
    const created = await ok(leo, create);
    expect(created).toMatchObject({ round: 1, status: "invited" });
    expect(created!.players.map((player) => player.firstName)).toEqual(["Leo", "Ava"]);
    const token = created!.inviteToken!;
    expect((await ok(leo, create))!.inviteToken).toBe(token);

    const preview = await readInvitePreview(token);
    if (preview?.status !== "open") throw new Error("expected an open invite");
    expect(preview).toMatchObject({ inviteeFirstName: "Ava", inviterFirstName: "Leo" });
    expect(preview.terms.tasks[0].text).toBe("100 pushups");

    // Accept; the invite is single-use and a used invite shows only its status.
    const joined = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token, type: "join" });
    expect(joined).toMatchObject({ status: "live" });
    expect(await errorCode(kat, { termsVersion: 1, timeZone: "Europe/London", token, type: "join" })).toBe("INVITE_USED");
    expect(await readInvitePreview(token)).toEqual({ status: "used" });
    const label = await getPrisma().gameContactLabel.findUnique({
      where: { ownerMemberId_subjectMemberId: { ownerMemberId: leo, subjectMemberId: ava } },
    });
    expect(label?.nameEncrypted && label.relationshipEncrypted).toBeTruthy();
    // Accepting again is a repeat, not an error.
    expect(await errorCode(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token, type: "join" })).toBe("OK");

    await devStartNow(gameId, leo);

    // Post to unlock: Leo can't see Ava's photo, caption or file until he posts.
    const avaPost = await photo(ava, gameId, "ava-d0", "done");
    await ok(ava, avaPost);
    const avaKey = avaPost.type === "post" ? avaPost.mediaKeys[0] : "";
    let leoView = await readGame(gameId, leo);
    expect(leoView!.days[0].others[0]).toEqual({ entry: null, seat: 1, status: "locked" });
    expect(await authorizeMediaRead(leo, avaKey)).toBe(false);
    expect(await authorizeMediaRead(kat, avaKey)).toBe(false);
    // Nobody can post someone else's upload, or one that was never stored.
    expect(await errorCode(leo, { entryId: randomUUID(), gameId, kind: "photo", mediaKeys: [avaKey], type: "post" })).toBe("MEDIA_MISSING");
    const missingKey = `${mediaKeyPrefixFor(leo)}${"0".repeat(64)}.jpg`;
    expect(await errorCode(leo, { entryId: randomUUID(), gameId, kind: "photo", mediaKeys: [missingKey], type: "post" }))
      .toBe("MEDIA_MISSING");

    const firstShot = await photo(leo, gameId, "leo-d0-a");
    await ok(leo, firstShot);
    leoView = await readGame(gameId, leo);
    expect(leoView!.days[0].others[0]).toMatchObject({ entry: { text: "done" }, status: "posted" });
    expect(await authorizeMediaRead(leo, avaKey)).toBe(true);
    expect(leoView!.retakeAvailable).toBe(true);

    // Sending the same entry again changes nothing; one retake per day.
    await ok(leo, firstShot);
    await ok(leo, await photo(leo, gameId, "leo-d0-b"));
    expect(await errorCode(leo, await photo(leo, gameId, "leo-d0-c"))).toBe("RETAKE_USED");
    expect(await getPrisma().gameEntry.count({ where: { gameId, memberId: leo } })).toBe(2);

    // Withdraw takes back only your own post; a retry is fine.
    const avaEntryId = avaPost.type === "post" ? avaPost.entryId : "";
    expect(await errorCode(leo, { entryId: avaEntryId, gameId, type: "withdraw" })).toBe("GAME_NOT_FOUND");
    await ok(ava, { entryId: avaEntryId, gameId, type: "withdraw" });
    await ok(ava, { entryId: avaEntryId, gameId, type: "withdraw" });
    await ok(ava, await photo(ava, gameId, "ava-d0-b"));

    // Day 1: only Leo posts. Settle: Leo wins breakfast in bed.
    await devAdvanceDays(gameId, leo, 1);
    await ok(leo, await photo(leo, gameId, "leo-d1"));
    const settled = await devSettleNow(gameId, ava);
    expect(settled).toMatchObject({ result: { outcome: "lost", scores: [{ score: 2, seat: 0 }, { score: 1, seat: 1 }] }, status: "settled" });
    expect(settled.tickets).toEqual([expect.objectContaining({ owedByMemberId: ava, status: "open", what: "Breakfast in bed", youHold: false })]);
    // After settle every live post is visible; the replaced first shot is not.
    const day1Key = (await readGame(gameId, ava))!.days[1].others[0].entry!.mediaUrls[0];
    expect(day1Key).toContain(encodeURIComponent(mediaKeyPrefixFor(leo)));
    const firstShotKey = firstShot.type === "post" ? firstShot.mediaKeys[0] : "";
    expect(await authorizeMediaRead(ava, firstShotKey)).toBe(false);

    // Wallet and redeem: only the holder cashes in, once.
    const ticketId = settled.tickets[0].id;
    expect(await errorCode(ava, { ticketId, type: "redeem" })).toBe("TICKET_NOT_HELD");
    expect((await readHome(leo)).wallet.held.map((ticket) => ticket.what)).toEqual(["Breakfast in bed"]);
    await ok(leo, { ticketId, type: "redeem" });
    await ok(leo, { ticketId, type: "redeem" });
    const homeAfter = await readHome(leo);
    expect(homeAfter.wallet).toMatchObject({ held: [], redeemed: [expect.objectContaining({ id: ticketId })] });
    expect(homeAfter.me).toMatchObject({ firstName: "Leo", timeZone: "America/New_York" });

    // The history: one row per accepted change, none for repeats or rejections.
    const events = await getPrisma().gameEvent.findMany({ orderBy: { id: "asc" }, where: { gameId } });
    expect(events.map((event) => event.type)).toEqual([
      "created", "joined", "started", "started", "posted", "posted", "posted",
      "withdrew", "posted", "time_shifted", "posted", "time_shifted", "settled", "redeemed",
    ]);
    expect(JSON.stringify(events.map((event) => event.payload))).not.toMatch(/pushups|Breakfast|done|girlfriend/u);

    // Rematch with the same person: round 2; the name typed most recently wins.
    const rematch = await ok(leo, {
      gameId: randomUUID(),
      inviteeFirstName: "Ava B",
      previousGameId: gameId,
      terms: TERMS,
      type: "createGame",
    });
    expect(rematch).toMatchObject({ round: 2 });
    const rejoined = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token: rematch!.inviteToken!, type: "join" });
    expect(rejoined).toMatchObject({ round: 2, status: "live" });
    expect(rejoined!.players[0].firstName).toBe("Leo");
    expect((await readGame(rematch!.id, leo))!.players[1].firstName).toBe("Ava B");
  });

  it("keeps the challenger's latest name for someone, and their earlier words it didn't replace", async () => {
    const kat = await member("Kat", "Europe/London");
    const leo = await member("Leo", "America/New_York");
    const first = await startGame(kat, leo, { inviteeFirstName: "Anna", inviteeLabel: { relationship: "brother" } });
    expect((await readGame(first.gameId, kat))!.players[1].firstName).toBe("Anna");
    await devSettleNow(first.gameId, kat);
    const next = await startGame(kat, leo, { inviteeFirstName: "Leo", previousGameId: first.gameId });
    expect((await readGame(next.gameId, kat))!.players[1].firstName).toBe("Leo");
    const label = await getPrisma().gameContactLabel.findUniqueOrThrow({
      where: { ownerMemberId_subjectMemberId: { ownerMemberId: kat, subjectMemberId: leo } },
    });
    expect(label.relationshipEncrypted).toBeTruthy();
  });

  it("addresses a rematch to the previous opponent, on their Home and nobody else's", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const first = await startGame(leo, ava);
    await devSettleNow(first.gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Babe", previousGameId: first.gameId, terms: TERMS, type: "createGame" });
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: rematch!.id } })).toMatchObject({ inviteeMemberId: ava });

    const avaHome = await readHome(ava);
    const addressed = avaHome.games.find((game) => game.id === rematch!.id);
    expect(addressed).toMatchObject({ inviteToken: rematch!.inviteToken, round: 2, status: "invited" });
    // She sees herself by her own name, never the challenger's private one for her.
    expect(addressed!.players.map((player) => [player.firstName, player.isMe])).toEqual([["Leo", false], ["Ava", true]]);
    expect(JSON.stringify(addressed)).not.toContain("Babe");
    expect((await readHome(kat)).games.map((game) => game.id)).not.toContain(rematch!.id);
    expect(await readGame(rematch!.id, kat)).toBeNull();

    const accepted = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token: addressed!.inviteToken!, type: "join" });
    expect(accepted).toMatchObject({ inviteToken: null, round: 2, status: "live" });
  });

  it("lets a ticket expire 14 days after it's issued, refusing to redeem it then", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const { gameId } = await startGame(leo, ava);
    await devStartNow(gameId, leo);
    await ok(leo, await photo(leo, gameId, "only-leo"));
    const [ticket] = (await devSettleNow(gameId, leo)).tickets;
    expect(ticket).toMatchObject({ status: "open", youHold: true });
    expect(new Date(ticket.useBy).getTime() - new Date(ticket.createdAt).getTime()).toBe(14 * 24 * 60 * 60 * 1000);

    await getPrisma().gameTicket.update({
      data: { createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
      where: { id: ticket.id },
    });
    expect((await readHome(leo)).wallet.held).toEqual([expect.objectContaining({ id: ticket.id, status: "expired" })]);
    expect((await readHome(ava)).wallet.owed).toEqual([expect.objectContaining({ id: ticket.id, status: "expired" })]);
    const refused = await run(leo, { ticketId: ticket.id, type: "redeem" });
    expect(refused).toMatchObject({ error: { code: "TICKET_EXPIRED" }, ok: false, status: 410 });
    expect((await getPrisma().gameTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("open");
  });

  it("starts on the challenger's picked date, shown before and after accept", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const today = gameLocalDate(new Date(), "America/New_York");
    const startsOn = addDays(today, 3);
    expect(await errorCode(leo, {
      gameId: randomUUID(),
      inviteeFirstName: "Ava",
      terms: { ...TERMS, startsOn: today },
      type: "createGame",
    })).toBe("INVALID_REQUEST");

    const created = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: { ...TERMS, startsOn }, type: "createGame" });
    expect(created!.startsOn).toBe(startsOn);
    const preview = await readInvitePreview(created!.inviteToken!);
    expect(preview).toMatchObject({ startsOn, status: "open" });

    const joined = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token: created!.inviteToken!, type: "join" });
    expect(joined).toMatchObject({ startsOn, status: "live" });
    expect(joined!.days[0].localDate).toBe(startsOn);
    expect((await readGame(created!.id, leo))!.days[0].localDate).toBe(startsOn);
    const players = await getPrisma().gamePlayer.findMany({ where: { gameId: created!.id } });
    expect(players.map((player) => player.dayOne?.toISOString().slice(0, 10))).toEqual([startsOn, startsOn]);
  });

  it("time-travels by moving only the game's clock: posts keep their real dates, and passing the end settles", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "UTC");
    // Only today's weekday counts, so tomorrow is a day off.
    const today = gameLocalDate(new Date(), "America/New_York");
    const { gameId } = await startGame(leo, ava, { terms: { ...TERMS, schedule: { days: [weekdayOf(today)] } } });
    await devStartNow(gameId, leo);
    const shot = await photo(leo, gameId, "today");
    await ok(leo, shot);
    const before = await getPrisma().game.findUniqueOrThrow({ include: { players: true }, where: { id: gameId } });
    const [entry] = await getPrisma().gameEntry.findMany({ where: { gameId } });

    const advanced = await devAdvanceDays(gameId, leo, 1);
    expect(advanced.players.find((player) => player.isMe)!.dayIndex).toBe(1);
    expect(advanced.days[1].off).toBe(true);
    expect(advanced.days[0]).toMatchObject({ localDate: today, mine: { entryId: shot.type === "post" ? shot.entryId : "" } });
    const after = await getPrisma().game.findUniqueOrThrow({ include: { players: true }, where: { id: gameId } });
    expect(after.devClockOffsetMs).toBe(BigInt(24 * 60 * 60 * 1000));
    expect(after.startedAt).toEqual(before.startedAt);
    expect(after.players.map((player) => player.dayOne)).toEqual(before.players.map((player) => player.dayOne));
    expect((await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: entry.id } })).receivedAt).toEqual(entry.receivedAt);

    const ended = await devAdvanceDays(gameId, leo, 7);
    expect(ended.status).toBe("settled");
  });

  it("starts the round count over when someone new takes a rematch", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const first = await startGame(leo, ava);
    await devSettleNow(first.gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Kat", previousGameId: first.gameId, terms: TERMS, type: "createGame" });
    expect(rematch!.round).toBe(2);
    const joined = await ok(kat, { termsVersion: 1, timeZone: "Europe/London", token: rematch!.inviteToken!, type: "join" });
    expect(joined!.round).toBe(1);
  });

  it("settles a finished game nobody opened before its players join the next one", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const stale = await startGame(leo, ava);
    // Past the last day and grace, with no read and no timer since.
    await getPrisma().gamePlayer.updateMany({
      data: { dayOne: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
      where: { gameId: stale.gameId },
    });
    expect((await getPrisma().game.findUniqueOrThrow({ where: { id: stale.gameId } })).status).toBe("live");

    const next = await ok(kat, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });
    const joined = await ok(ava, { termsVersion: 1, timeZone: "UTC", token: next!.inviteToken!, type: "join" });
    expect(joined!.status).toBe("live");
    expect((await getPrisma().game.findUniqueOrThrow({ where: { id: stale.gameId } })).status).toBe("settled");
  });

  it("lets only one of two simultaneous joins put the same person in a game", async () => {
    const leo = await member("Leo", "America/New_York");
    const kat = await member("Kat", "Europe/London");
    const ava = await member("Ava", "Australia/Sydney");
    const fromLeo = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });
    const fromKat = await ok(kat, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });

    const results = await Promise.all([fromLeo, fromKat].map((game) =>
      run(ava, { termsVersion: 1, timeZone: "UTC", token: game!.inviteToken!, type: "join" })));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.flatMap((result) => (result.ok ? [] : [result.error]))).toEqual([
      { code: "ALREADY_IN_A_GAME", message: "You're already in a game." },
    ]);
    expect(await getPrisma().gamePlayer.count({ where: { activeMemberId: ava } })).toBe(1);
  });

  it("names whoever is busy, from the caller's side", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    await startGame(leo, ava);
    // Leo invites Kat while he's still playing Ava.
    const fromLeo = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Kat", terms: TERMS, type: "createGame" });
    const result = await run(kat, { termsVersion: 1, timeZone: "UTC", token: fromLeo!.inviteToken!, type: "join" });
    expect(result).toMatchObject({ error: { code: "ALREADY_IN_A_GAME", message: "Leo is in another game right now." }, ok: false });
    // Ava, mid-game herself, gets "you".
    const fromKat = await ok(kat, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });
    const own = await run(ava, { termsVersion: 1, timeZone: "UTC", token: fromKat!.inviteToken!, type: "join" });
    expect(own).toMatchObject({ error: { message: "You're already in a game." }, ok: false });
  });

  it("lands the same post sent twice at once exactly once", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const { gameId } = await startGame(leo, ava);
    await devStartNow(gameId, leo);
    const shot = await photo(leo, gameId, "twice");

    const results = await Promise.all([run(leo, shot), run(leo, shot)]);

    expect(results.every((result) => result.ok)).toBe(true);
    const entries = await getPrisma().gameEntry.findMany({ where: { gameId, memberId: leo } });
    // One post, not a post and a retake of itself.
    expect(entries.map((entry) => [entry.attempt, entry.withdrawnAt])).toEqual([[1, null]]);
    expect(await getPrisma().gameEvent.count({ where: { gameId, type: "posted" } })).toBe(1);
  });

  it("shows open games and the three latest settled ones at home", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const settledIds: string[] = [];
    for (let round = 0; round < 4; round += 1) {
      const { gameId } = await startGame(leo, ava);
      await devSettleNow(gameId, leo);
      settledIds.push(gameId);
    }
    const open = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });

    const home = await readHome(leo);
    expect(home.games.map((game) => game.id).sort()).toEqual([open!.id, ...settledIds.slice(1)].sort());
  });

  it("voids an unclaimed invite past its expiry on the next read and keeps it on Home for a week", async () => {
    const kat = await member("Kat", "Europe/London");
    const invite = async (expiredMsAgo: number) => {
      const gameId = randomUUID();
      await ok(kat, { gameId, inviteeFirstName: "Leo", terms: TERMS, type: "createGame" });
      await getPrisma().game.update({ data: { inviteExpiresAt: new Date(Date.now() - expiredMsAgo) }, where: { id: gameId } });
      return gameId;
    };
    const hour = 60 * 60 * 1000;
    const gameId = await invite(60_000);
    expect((await readHome(kat)).games.map((game) => [game.id, game.status])).toEqual([[gameId, "void"]]);
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ status: "void" });
    expect((await getPrisma().gameEvent.findMany({ orderBy: { id: "asc" }, where: { gameId } })).map((event) => [event.type, event.actor]))
      .toEqual([["created", kat], ["expired", "system"]]);

    // At most the three latest, and nothing older than a week.
    const [oneHour, twoHours] = [await invite(hour), await invite(2 * hour)];
    await invite(3 * hour);
    await invite(8 * 24 * hour);
    expect((await readHome(kat)).games.map((game) => game.id).sort()).toEqual([gameId, oneHour, twoHours].sort());
  });
});

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres") && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
