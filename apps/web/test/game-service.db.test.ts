import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { GameCommand } from "../src/lib/game/contract";

vi.mock("server-only", () => ({}));

const TEST_DATABASE_ENV = "MURPH_GAME_TEST_DB_URL";
const testDatabaseUrl = process.env[TEST_DATABASE_ENV]?.trim() || null;

if (testDatabaseUrl) {
  if (!/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost)(?::\d+)?\/murph_test[\w-]*$/u.test(testDatabaseUrl)) {
    throw new Error(`${TEST_DATABASE_ENV} must point to a local, migrated murph_test* database.`);
  }
  process.env.DATABASE_URL = testDatabaseUrl;
}

const service = await import("../src/lib/game/service");
const { getPrisma } = await import("../src/lib/prisma");

const run = randomUUID().slice(0, 8);
const LEO = `hbm_gametest_leo_${run}`;
const AVA = `hbm_gametest_ava_${run}`;
const KAT = `hbm_gametest_kat_${run}`;
const EVERY_DAY = { days: [0, 1, 2, 3, 4, 5, 6] as Array<0 | 1 | 2 | 3 | 4 | 5 | 6> };

function command(actor: string, body: GameCommand, requestId: string = randomUUID()) {
  return service.runGameCommand({ actorMemberId: actor, request: { command: body, requestId, schemaVersion: 1 } });
}

async function ok(actor: string, body: GameCommand, requestId?: string) {
  const result = await command(actor, body, requestId);
  if (!result.ok) throw new Error(`${body.type} failed: ${result.error.code} ${result.error.message}`);
  return result.game;
}

async function errorCode(actor: string, body: GameCommand) {
  const result = await command(actor, body);
  return result.ok ? "OK" : result.error.code;
}

function photo(actor: string, gameId: string, name: string, text?: string): GameCommand {
  return {
    entryId: randomUUID(),
    gameId,
    kind: "photo",
    mediaKeys: [`${service.mediaKeyPrefixFor(actor)}${name}.jpg`],
    type: "post",
    ...(text ? { text } : {}),
  };
}

describe.runIf(Boolean(testDatabaseUrl))("weekly game service against PostgreSQL", () => {
  beforeAll(async () => {
    await getPrisma().hostedMember.createMany({
      data: [LEO, AVA, KAT].map((id) => ({ billingStatus: "active", id })),
    });
  });

  afterAll(async () => {
    const prisma = getPrisma();
    const games = await prisma.game.findMany({ select: { circleId: true }, where: { createdBy: { in: [LEO, AVA, KAT] } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: [LEO, AVA, KAT] } } });
    const circleIds = games.flatMap((game) => (game.circleId ? [game.circleId] : []));
    await prisma.gameCircle.deleteMany({ where: { id: { in: circleIds } } });
    await prisma.$disconnect();
  });

  it("plays a full 1v1 game through the one write path", async () => {
    const terms = {
      schedule: EVERY_DAY,
      stakes: [{ item: "Breakfast in bed", kind: "winner_gets" as const }],
      tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
    };
    const gameId = randomUUID();
    expect(await errorCode(LEO, { gameId, inviteeFirstName: "Ava", terms, type: "createGame" })).toBe("PROFILE_REQUIRED");
    await ok(LEO, { firstName: "Leo", timeZone: "America/New_York", type: "setProfile" });
    await ok(AVA, { firstName: "Ava", timeZone: "Australia/Sydney", type: "setProfile" });
    await ok(KAT, { firstName: "Kat", timeZone: "Europe/London", type: "setProfile" });

    // Create; a retry with the same ids returns the same game.
    const createRequest = randomUUID();
    const created = await ok(LEO, { gameId, inviteeFirstName: "Ava", terms, type: "createGame" }, createRequest);
    expect(created).toMatchObject({ round: 1, status: "invited" });
    expect(created!.players.map((player) => player.firstName)).toEqual(["Leo", "Ava"]);
    const token = created!.inviteToken!;
    expect(token).toBeTruthy();
    expect((await ok(LEO, { gameId, inviteeFirstName: "Ava", terms, type: "createGame" }, createRequest))!.inviteToken).toBe(token);

    const preview = await service.readInvitePreview(token);
    expect(preview).toMatchObject({ gameId, inviteeFirstName: "Ava", inviterFirstName: "Leo", status: "open" });
    expect(preview!.terms.tasks[0].text).toBe("100 pushups");
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    expect(await service.readInvitePreview(token)).toBeNull();
    vi.unstubAllEnvs();
    const stakeKey = preview!.terms.stakes[0].key!;

    await ok(LEO, { relationship: "girlfriend", subject: { inviteToken: token }, type: "setLabel" });

    // Shake on it; the invite is single-use.
    const joined = await ok(AVA, { termsVersion: 1, timeZone: "Australia/Sydney", token, type: "join" });
    expect(joined).toMatchObject({ status: "live" });
    expect(joined!.players.every((player) => player.dayIndex === null)).toBe(true);
    expect(await errorCode(KAT, { termsVersion: 1, timeZone: "Europe/London", token, type: "join" })).toBe("INVITE_USED");
    expect((await service.readInvitePreview(token))!.status).toBe("used");
    const label = await getPrisma().gameContactLabel.findUnique({
      where: { ownerMemberId_subjectMemberId: { ownerMemberId: LEO, subjectMemberId: AVA } },
    });
    expect(label?.nameEncrypted && label.relationshipEncrypted).toBeTruthy();

    await service.devStartNow(gameId, LEO);

    // Post to unlock: Leo can't see Ava's photo, caption or file until he posts.
    await ok(AVA, photo(AVA, gameId, "ava-d0", "done"));
    const avaKey = `${service.mediaKeyPrefixFor(AVA)}ava-d0.jpg`;
    let leoView = await service.readGame(gameId, LEO);
    expect(leoView!.days[0].others[0]).toEqual({ entry: null, seat: 1, status: "locked" });
    expect(await service.authorizeMediaRead(LEO, avaKey)).toBe(false);
    expect(await service.authorizeMediaRead(KAT, avaKey)).toBe(false);

    const firstShot = photo(LEO, gameId, "leo-d0-a");
    const firstShotRequest = randomUUID();
    await ok(LEO, firstShot, firstShotRequest);
    leoView = await service.readGame(gameId, LEO);
    expect(leoView!.days[0].others[0]).toMatchObject({ entry: { text: "done" }, status: "posted" });
    expect(await service.authorizeMediaRead(LEO, avaKey)).toBe(true);
    expect(leoView!.retakeAvailable).toBe(true);

    // A retried request applies once; one retake per day.
    await ok(LEO, firstShot, firstShotRequest);
    await ok(LEO, photo(LEO, gameId, "leo-d0-b"));
    expect(await errorCode(LEO, photo(LEO, gameId, "leo-d0-c"))).toBe("RETAKE_USED");
    expect(await getPrisma().gameEntry.count({ where: { gameId, memberId: LEO } })).toBe(2);
    const deleteRequest = randomUUID();
    await ok(AVA, { gameId, type: "deleteToday" }, deleteRequest);
    await ok(AVA, { gameId, type: "deleteToday" });
    expect(await errorCode(AVA, photo(AVA, gameId, "ava-d0-b"))).toBe("OK");

    // One live game per person: Leo can invite, but nobody can join him.
    const second = await ok(LEO, { gameId: randomUUID(), inviteeFirstName: "Kat", terms, type: "createGame" });
    expect(await errorCode(KAT, { termsVersion: 1, timeZone: "Europe/London", token: second!.inviteToken!, type: "join" }))
      .toBe("ALREADY_IN_A_GAME");

    // Day 1: only Leo posts. Settle: Leo wins breakfast in bed.
    await service.devAdvanceDays(gameId, LEO, 1);
    await ok(LEO, photo(LEO, gameId, "leo-d1"));
    const settled = await service.devSettleNow(gameId, AVA);
    expect(settled).toMatchObject({ result: { outcome: "lost", scores: [{ score: 2, seat: 0 }, { score: 1, seat: 1 }] }, status: "settled" });
    expect(settled.tickets).toEqual([expect.objectContaining({ owedByMemberId: AVA, status: "open", what: "Breakfast in bed", youHold: false })]);
    // After settle every live post is visible; the replaced first shot is not.
    expect(await service.authorizeMediaRead(AVA, `${service.mediaKeyPrefixFor(LEO)}leo-d1.jpg`)).toBe(true);
    expect(await service.authorizeMediaRead(AVA, `${service.mediaKeyPrefixFor(LEO)}leo-d0-a.jpg`)).toBe(false);

    // Wallet and redeem: only the holder cashes in, once.
    const ticketId = settled.tickets[0].id;
    expect(await errorCode(AVA, { ticketId, type: "redeem" })).toBe("TICKET_NOT_HELD");
    const homeBefore = await service.readHome(LEO);
    expect(homeBefore.wallet.held.map((ticket) => ticket.what)).toEqual(["Breakfast in bed"]);
    await ok(LEO, { ticketId, type: "redeem" });
    await ok(LEO, { ticketId, type: "redeem" });
    const homeAfter = await service.readHome(LEO);
    expect(homeAfter.wallet).toMatchObject({ held: [], redeemed: [expect.objectContaining({ id: ticketId })] });
    expect(homeAfter.me).toMatchObject({ firstName: "Leo", timeZone: "America/New_York" });

    // Rematch: same circle, round 2, same stake key; the earlier label wins over the new typed name.
    const rematch = await ok(LEO, {
      gameId: randomUUID(),
      inviteeFirstName: "Ava B",
      previousGameId: gameId,
      terms: { ...terms, stakes: [{ ...terms.stakes[0], key: stakeKey }] },
      type: "createGame",
    });
    expect(rematch).toMatchObject({ round: 2 });
    expect(rematch!.terms.stakes[0].key).toBe(stakeKey);
    const rejoined = await ok(AVA, { termsVersion: 1, timeZone: "Australia/Sydney", token: rematch!.inviteToken!, type: "join" });
    expect(rejoined!.status).toBe("live");
    expect((await service.readGame(rematch!.id, LEO))!.players[1].firstName).toBe("Ava");
    expect(await errorCode(AVA, { gameId: rematch!.id, reason: "cancelled", type: "void" })).toBe("OK");
  });

  it("voids an unclaimed invite when the settle timer passes its expiry", async () => {
    const gameId = randomUUID();
    await ok(KAT, {
      gameId,
      inviteeFirstName: "Leo",
      terms: { schedule: { count: 3 }, stakes: [], tasks: [{ seat: 0, text: "Swim" }, { seat: 1, text: "Run" }] },
      type: "createGame",
    });
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await service.settleDueGames(later);
    const row = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } });
    expect(row).toMatchObject({ nextDueAt: null, status: "void", voidReason: "expired" });
  });
});
