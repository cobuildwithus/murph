import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn().mockResolvedValue("sent"));
vi.mock("@/src/lib/apple-push/send", async (original) => ({
  ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: push,
}));

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
  readGameChatState,
  readInvitePreview,
  runGameCommand,
} from "@/src/lib/game/service";
import { parseStoredTerms } from "@/src/lib/game/rules";
import { toPrismaJsonObject } from "@/src/lib/device-sync/prisma-store/prisma-json";
import { addDays, gameLocalDate, weekdayOf } from "@/src/lib/game/time";
import { getPrisma } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error("The weekly game PostgreSQL proof requires a local DATABASE_URL.");
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const TERMS: GameTermsInput = {
  startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  stakes: [{ item: "Breakfast in bed", kind: "prize" }],
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

async function pushRoute(memberId: string, alertsAllowed = true): Promise<string> {
  const sessionId = randomUUID();
  const now = new Date();
  await getPrisma().hostedAuthRecord.create({ data: {
    model: "session", id: sessionId, memberId, payloadEncrypted: "synthetic-unused-by-delivery",
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), createdAt: now, updatedAt: now,
  } });
  await getPrisma().companionPushRoute.create({ data: {
    userId: memberId, installationId: randomUUID(), token: "ab".repeat(32),
    topic: "ai.withmurph.app.dev", environment: "development",
    alertsAllowed, gameSessionId: sessionId, updatedAt: now,
  } });
  return sessionId;
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

async function photo(actor: string, gameId: string, name: string, text?: string): Promise<Extract<GameCommand, { type: "post" }>> {
  return {
    entryId: randomUUID(),
    gameId,
    kind: "photo",
    mediaKeys: [await upload(actor, name)],
    type: "post",
    ...(text ? { text } : {}),
  };
}

/**
 * Challenger invites, invitee accepts; returns the game id and its invite token.
 * The invitee plays from New York like the challengers here, so Start now
 * starts today for both whatever hour the suite runs (zones are the rules' job).
 */
async function startGame(challenger: string, invitee: string, extra: Partial<Extract<GameCommand, { type: "createGame" }>> = {}) {
  const gameId = randomUUID();
  const created = await ok(challenger, { gameId, inviteeFirstName: "Friend", terms: TERMS, type: "createGame", ...extra });
  const token = created!.inviteToken!;
  await ok(invitee, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" });
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

  it("never opens locked payloads, keeps previews separate, and reveals data on recap", async () => {
    const poster = await member("Poster", "UTC");
    const viewer = await member("Viewer", "UTC");
    const { gameId } = await startGame(poster, viewer, { terms: { ...TERMS,
      startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) } });
    await devStartNow(gameId, poster);
    const data = { activity: "run" as const, distanceM: 2345, durationSec: 900 };
    const command = { ...await photo(poster, gameId, "private-route"), kind: "route" as const, data, blurHash: "synthetic-blur" };
    const posted = await ok(poster, command);
    expect(posted?.terms.checkInKind).toBe("any");
    expect(posted?.days[0].mine?.data).toEqual(data);
    const stored = await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: command.entryId } });
    expect(stored.payloadEncrypted).toBeTruthy();
    expect(stored.payloadEncrypted).not.toContain("distanceM");
    expect(stored.blurHash).toBe("synthetic-blur");
    const locked = await readGame(gameId, viewer);
    expect(locked?.days[0].others[0]).toEqual({ seat: 0, status: "locked", entry: null,
      postedAt: stored.receivedAt.toISOString(), blurHash: "synthetic-blur" });
    expect(await authorizeMediaRead(viewer, command.mediaKeys[0])).toBe(false);
    expect(JSON.stringify(await readHome(viewer))).not.toMatch(/distanceM|private-route/);
    const chat = await readGameChatState("synthetic-room", [poster, viewer]);
    expect(chat.games[0].terms).not.toHaveProperty("checkInKind");
    expect(JSON.stringify(chat)).not.toMatch(/distanceM|blurHash|synthetic-blur|payloadEncrypted/);

    // A poisoned envelope proves the locked viewer never asks crypto to open it.
    await getPrisma().gameEntry.update({ where: { id: command.entryId }, data: { payloadEncrypted: "cannot-open" } });
    expect((await readGame(gameId, viewer))?.days[0].others[0].status).toBe("locked");
    await expect(readGame(gameId, poster)).rejects.toThrow();
    await getPrisma().gameEntry.update({ where: { id: command.entryId }, data: { payloadEncrypted: stored.payloadEncrypted } });
    const recap = await devSettleNow(gameId, viewer);
    expect(recap.days[0].others[0].entry?.data).toEqual(data);
    expect(recap.days[0].others[0]).not.toHaveProperty("blurHash");
    expect(await authorizeMediaRead(viewer, command.mediaKeys[0])).toBe(true);
  });

  it("caps concurrent retries and retakes per recipient and game, then allows the next recipient day", async () => {
    const poster = await member("Poster", "America/New_York");
    const recipient = await member("Recipient", "America/New_York");
    for (const id of [poster, recipient]) {
      await pushRoute(id);
    }
    const { gameId } = await startGame(poster, recipient);
    await devStartNow(gameId, poster);
    const command = await photo(poster, gameId, "notification-first");
    push.mockClear();
    const results = await Promise.all([ok(poster, command), ok(poster, command)]);
    expect(results.every((result) => result?.id === gameId)).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0].data).toEqual({ gameId, notification: "game_post" });
    expect(push.mock.calls[0]?.[0].message.body).toBe("Someone posted. Share yours to see it.");
    expect(await authorizeMediaRead(recipient, command.mediaKeys[0]!)).toBe(false);
    await ok(poster, await photo(poster, gameId, "notification-retake"));
    expect(push).toHaveBeenCalledTimes(1);
    await ok(recipient, await photo(recipient, gameId, "notification-other-direction"));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1]?.[0].message.body).toBe("There's a new post in your game. Take a look.");
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect((await runGameCommand({
      actorMemberId: poster, command: await photo(poster, gameId, "notification-next-day"), now: tomorrow,
    })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(3);
    expect(push.mock.calls[2]?.[0].message.body).toBe("Someone posted. Share yours to see it.");
    const receipts = await getPrisma().gameEvent.findMany({ where: { gameId, type: "post_notification" } });
    expect(receipts).toHaveLength(3);
    expect(new Set(receipts.map((receipt) => receipt.commandKey)).size).toBe(3);

    const third = await member("Third", "America/New_York");
    const another = await startGame(third, recipient);
    await devStartNow(another.gameId, third);
    await ok(third, await photo(third, another.gameId, "notification-another-game"));
    expect(push).toHaveBeenCalledTimes(4);
  });

  it("never notifies for excuses, denied alerts or a rejected post, and preserves accepted posts after push failure", async () => {
    const poster = await member("Sender", "America/New_York");
    const recipient = await member("Receiver", "America/New_York");
    const sessionId = await pushRoute(recipient, false);
    const { gameId } = await startGame(poster, recipient);
    await devStartNow(gameId, poster);
    push.mockClear();
    await ok(poster, await photo(poster, gameId, "notification-denied"));
    expect(push).not.toHaveBeenCalled();
    await getPrisma().companionPushRoute.update({ where: { userId: recipient }, data: { alertsAllowed: true } });
    push.mockRejectedValueOnce(new Error("synthetic uncertain push"));
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const next = await photo(poster, gameId, "notification-provider-failure");
    expect((await runGameCommand({ actorMemberId: poster, command: next, now: tomorrow })).ok).toBe(true);
    expect((await runGameCommand({ actorMemberId: poster, command: next, now: tomorrow })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(await getPrisma().gameEntry.findUnique({ where: { id: next.entryId } })).not.toBeNull();
    expect(await getPrisma().gameEvent.findFirst({ where: { gameId, type: "post_notification" } })).toMatchObject({
      payload: { outcome: "failed" },
    });
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect((await runGameCommand({
      actorMemberId: poster, now: later,
      command: { type: "post", gameId, entryId: randomUUID(), kind: "excuse", mediaKeys: [], text: "Travel day" },
    })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    // Even a late address write after DELETE is inert once logout revokes its session.
    await getPrisma().hostedAuthRecord.delete({ where: { model_id: { model: "session", id: sessionId } } });
    expect((await runGameCommand({
      actorMemberId: poster, now: later, command: await photo(poster, gameId, "notification-after-signout"),
    })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("stores the agreed graph, rejects photos, and preserves private media and retries", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const stranger = await member("Sam", "UTC");
    const { gameId } = await startGame(leo, ava, { terms: { ...TERMS, checkInKind: "heart_rate" } });
    // A retained heart-rate-only game still enforces its stored requirement.
    const stored = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } });
    const terms = parseStoredTerms(stored.terms);
    terms.versions[0].checkInKind = "heart_rate";
    await getPrisma().game.update({ where: { id: gameId }, data: { terms: toPrismaJsonObject(terms) } });
    await pushRoute(leo);
    push.mockClear();
    await devStartNow(gameId, leo);
    expect((await readGame(gameId, leo))?.terms.checkInKind).toBe("heart_rate");
    const key = await upload(ava, "synthetic-graph");
    const graph: GameCommand = { type: "post", entryId: randomUUID(), gameId, kind: "heart_rate", mediaKeys: [key] };
    const accepted = await ok(ava, graph);
    expect(push).toHaveBeenCalledTimes(1);
    expect(accepted?.days[0]?.mine).toMatchObject({ kind: "heart_rate", data: null });
    await ok(ava, graph);
    expect(await getPrisma().gameEntry.count({ where: { gameId, memberId: ava } })).toBe(1);
    expect(await authorizeMediaRead(leo, key)).toBe(false);
    expect(await authorizeMediaRead(stranger, key)).toBe(false);
    expect(await errorCode(leo, await photo(leo, gameId, "synthetic-photo"))).toBe("INVALID_REQUEST");
    await ok(leo, { ...await photo(leo, gameId, "synthetic-own-graph"), kind: "heart_rate" });
    expect(await authorizeMediaRead(leo, key)).toBe(true);
    expect((await readGame(gameId, leo))?.days[0]?.others[0]?.entry).toMatchObject({ kind: "heart_rate", data: null });
    await ok(ava, { ...await photo(ava, gameId, "synthetic-retake"), kind: "heart_rate" });
    expect(await errorCode(ava, { ...graph, entryId: randomUUID() })).toBe("RETAKE_USED");
    expect(await authorizeMediaRead(leo, key)).toBe(false);
  });

  it("syncs canonical profile photos, preserves private overrides and scopes media to game participants", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const stranger = await member("Sam", "UTC");
    const canonical = await upload(ava, "canonical");
    const privatePhoto = await upload(leo, "private-contact");
    const missing = `${mediaKeyPrefixFor(ava)}${"0".repeat(64)}.jpg`;
    expect(await errorCode(ava, { type: "setProfile", photoKey: privatePhoto })).toBe("MEDIA_MISSING");
    expect(await errorCode(ava, { type: "setProfile", photoKey: missing })).toBe("MEDIA_MISSING");
    const saved = await run(ava, { type: "setProfile", photoKey: canonical });
    expect(saved).toMatchObject({ ok: true, profile: { memberId: ava, firstName: "Ava", timeZone: "Australia/Sydney" } });
    expect(await authorizeMediaRead(ava, canonical)).toBe(true);
    expect(await authorizeMediaRead(leo, canonical)).toBe(false);
    expect(await authorizeMediaRead(stranger, canonical)).toBe(false);
    const homePhoto = (await readHome(ava)).me.avatarUrl;
    expect(homePhoto).toContain(encodeURIComponent(canonical));
    await ok(ava, { firstName: "Ava", timeZone: "Australia/Sydney", type: "setProfile" });
    expect((await readHome(ava)).me.avatarUrl).toBe(homePhoto);

    const gameId = randomUUID();
    const created = await ok(leo, { gameId, inviteeFirstName: "Friend", inviteeLabel: { photoKey: privatePhoto }, terms: TERMS, type: "createGame" });
    const preview = await readInvitePreview(created!.inviteToken!);
    expect(preview).not.toHaveProperty("avatarUrl");
    expect(preview).not.toHaveProperty("profileAvatarUrl");
    const joined = await ok(ava, { type: "join", token: created!.inviteToken!, termsVersion: 1, timeZone: "Australia/Sydney" });
    expect(joined!.players[1]).toMatchObject({ avatarUrl: homePhoto, profileAvatarUrl: homePhoto });
    const opponentView = (await readGame(gameId, leo))!.players[1];
    expect(opponentView.avatarUrl).toContain(encodeURIComponent(privatePhoto));
    expect(opponentView.profileAvatarUrl).toBe(homePhoto);
    expect(await authorizeMediaRead(leo, canonical)).toBe(true);
    expect(await authorizeMediaRead(stranger, canonical)).toBe(false);
    expect(await authorizeMediaRead(ava, privatePhoto)).toBe(false);

    const replacement = await upload(ava, "replacement");
    await ok(ava, { type: "setProfile", photoKey: replacement });
    expect(await authorizeMediaRead(leo, canonical)).toBe(false);
    expect(await authorizeMediaRead(leo, replacement)).toBe(true);
    await Promise.all([
      ok(ava, { type: "setProfile", photoKey: null }),
      ok(ava, { type: "setProfile", firstName: "Avery" }),
    ]);
    expect((await readHome(ava)).me).toMatchObject({ firstName: "Avery", avatarUrl: null, timeZone: "Australia/Sydney" });
    expect(await authorizeMediaRead(leo, replacement)).toBe(false);
    const removed = (await readGame(gameId, leo))!.players[1];
    expect(removed.profileAvatarUrl).toBeNull();
    expect(removed.avatarUrl).toBe(opponentView.avatarUrl);
    expect((await getPrisma().gameContactLabel.findUnique({ where: { ownerMemberId_subjectMemberId: { ownerMemberId: leo, subjectMemberId: ava } } }))!.photoKey).toBe(privatePhoto);
  });

  it("requires initial name and time zone before a photo-only profile update", async () => {
    const id = `hbm_gametest_new_${randomUUID().slice(0, 8)}`;
    await getPrisma().hostedMember.create({ data: { billingStatus: "active", id } });
    memberIds.push(id);
    expect(await errorCode(id, { type: "setProfile", photoKey: null })).toBe("PROFILE_REQUIRED");
    expect(await getPrisma().gameProfile.findUnique({ where: { memberId: id } })).toBeNull();
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
    expect(preview).toMatchObject({ inviterFirstName: "Leo" });
    expect(preview).not.toHaveProperty("inviteeFirstName");
    expect(preview.terms.tasks[0].text).toBe("100 pushups");

    // Accept (from New York, so Start now below starts today for both); the
    // invite is single-use and a used invite shows only its status.
    const joined = await ok(ava, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" });
    expect(joined).toMatchObject({ status: "live" });
    expect(await errorCode(kat, { termsVersion: 1, timeZone: "Europe/London", token, type: "join" })).toBe("INVITE_USED");
    expect(await readInvitePreview(token)).toEqual({ status: "used" });
    const label = await getPrisma().gameContactLabel.findUnique({
      where: { ownerMemberId_subjectMemberId: { ownerMemberId: leo, subjectMemberId: ava } },
    });
    expect(label?.nameEncrypted && label.relationshipEncrypted).toBeTruthy();
    // Accepting again is a repeat, not an error.
    expect(await errorCode(ava, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" })).toBe("OK");

    await devStartNow(gameId, leo);

    // Post to unlock: Leo can't see Ava's photo, caption or file until he posts.
    const avaPost = await photo(ava, gameId, "ava-d0", "done");
    await ok(ava, avaPost);
    const avaKey = avaPost.type === "post" ? avaPost.mediaKeys[0] : "";
    let leoView = await readGame(gameId, leo);
    expect(leoView!.days[0].others[0]).toEqual({ blurHash: null, entry: null, postedAt: expect.any(String), seat: 1, status: "locked" });
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

  it("shows the relationship the viewer typed only to them, and keeps it across a rematch", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const relationshipOf = (view: Awaited<ReturnType<typeof readGame>>, memberSeat: number) =>
      view!.players.find((player) => player.seat === memberSeat)!.relationship;

    const gameId = randomUUID();
    const created = await ok(leo, { gameId, inviteeFirstName: "Ava", inviteeLabel: { relationship: "my partner" }, terms: TERMS, type: "createGame" });
    expect(created!.players.map((player) => player.relationship)).toEqual([null, "my partner"]);
    await ok(ava, { termsVersion: 1, timeZone: "UTC", token: created!.inviteToken!, type: "join" });

    // The challenger sees it for the invitee; the invitee has no label for the challenger.
    expect(relationshipOf(await readGame(gameId, leo), 1)).toBe("my partner");
    expect(relationshipOf(await readGame(gameId, leo), 0)).toBeNull();
    expect((await readGame(gameId, ava))!.players.map((player) => player.relationship)).toEqual([null, null]);
    // Nobody else ever sees it: Kat isn't in the game, and in her own game with Ava it isn't her label.
    expect(await readGame(gameId, kat)).toBeNull();
    const katsGame = await startGame(kat, ava);
    expect((await readGame(katsGame.gameId, kat))!.players.map((player) => player.relationship)).toEqual([null, null]);
    expect(JSON.stringify(await readHome(kat))).not.toContain("my partner");
    expect(JSON.stringify(await readHome(ava))).not.toContain("my partner");

    // A rematch typed without a relationship keeps the one Leo saved, before and after Ava accepts.
    await devSettleNow(gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", previousGameId: gameId, terms: TERMS, type: "createGame" });
    expect(relationshipOf(rematch, 1)).toBe("my partner");
    await ok(ava, { termsVersion: 1, timeZone: "UTC", token: rematch!.inviteToken!, type: "join" });
    expect(relationshipOf(await readGame(rematch!.id, leo), 1)).toBe("my partner");
  });

  it("addresses a rematch to the previous opponent, on their Home and nobody else's", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const first = await startGame(leo, ava);
    const photoKey = await upload(ava, "rematch-profile");
    await ok(ava, { type: "setProfile", photoKey });
    await devSettleNow(first.gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Babe", previousGameId: first.gameId, terms: TERMS, type: "createGame" });
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: rematch!.id } })).toMatchObject({ inviteeMemberId: ava });

    expect(rematch!.players[1].avatarUrl).toContain(encodeURIComponent(photoKey));
    expect(rematch!.players[1].profileAvatarUrl).toBe(rematch!.players[1].avatarUrl);
    const avaHome = await readHome(ava);
    const addressed = avaHome.games.find((game) => game.id === rematch!.id);
    expect(addressed).toMatchObject({ inviteToken: rematch!.inviteToken, round: 2, status: "invited" });
    // She sees herself by her own name, never the challenger's private one for her.
    expect(addressed!.players.map((player) => [player.firstName, player.isMe])).toEqual([["Leo", false], ["Ava", true]]);
    expect(addressed!.players[1].profileAvatarUrl).toBe(avaHome.me.avatarUrl);
    expect(JSON.stringify(addressed)).not.toContain("Babe");
    expect((await readHome(kat)).games.map((game) => game.id)).not.toContain(rematch!.id);
    expect(await readGame(rematch!.id, kat)).toBeNull();

    const accepted = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token: addressed!.inviteToken!, type: "join" });
    expect(accepted).toMatchObject({ inviteToken: rematch!.inviteToken, round: 2, status: "live" });
  });

  it("keeps a game's own invite token for its players after go-live, and never shows it to anyone else", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const kat = await member("Kat", "America/New_York");
    const { gameId, token } = await startGame(leo, ava);
    // Live: both players can recognize their own link; a third person can't read the game at all.
    expect((await readGame(gameId, leo))!.inviteToken).toBe(token);
    expect((await readGame(gameId, ava))!.inviteToken).toBe(token);
    expect(await readGame(gameId, kat)).toBeNull();
    expect(JSON.stringify(await readHome(kat))).not.toContain(token);
    // Settled: still theirs, and a spent token can't be accepted again.
    await devSettleNow(gameId, leo);
    expect((await readHome(leo)).games.find((game) => game.id === gameId)!.inviteToken).toBe(token);
    expect((await readGame(gameId, ava))!.inviteToken).toBe(token);
    expect(await errorCode(kat, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" })).toBe("INVITE_USED");
  });

  it.each(["prize", "dare"] as const)("issues a long-game %s ticket for fourteen days on the dev clock", async (kind) => {
    const holder = await member("Sam", "America/New_York");
    const debtor = await member("Maya", "America/New_York");
    const {gameId} = await startGame(holder, debtor, {terms:{...TERMS,lengthDays:75,stakes:[{kind,item:"Pick a film"}]}});
    await devStartNow(gameId,holder);
    await ok(holder,{type:"post",gameId,entryId:randomUUID(),kind:"words",mediaKeys:[],text:"Done today"});
    await devAdvanceDays(gameId,holder,44);
    const [ticket] = (await devSettleNow(gameId,holder)).tickets;
    const row = await getPrisma().game.findUniqueOrThrow({where:{id:gameId}});
    const offset = Number(row.devClockOffsetMs);
    expect(offset).toBeGreaterThan(44 * 86_400_000);
    expect(ticket).toMatchObject({kind,status:"open",youHold:true});
    expect(Math.abs(Date.parse(ticket.createdAt) - (Date.now() + offset))).toBeLessThan(10_000);
    expect(Date.parse(ticket.useBy) - Date.parse(ticket.createdAt)).toBe(14 * 86_400_000);
    expect((await readHome(holder)).wallet.held).toContainEqual(expect.objectContaining({id:ticket.id,status:"open"}));
    expect((await readHome(debtor)).wallet.owed).toContainEqual(expect.objectContaining({id:ticket.id,status:"open"}));
    expect((await readGameChatState("synthetic-room",[holder,debtor])).games.find((game) => game.id === gameId)?.result?.tickets).toContainEqual(expect.objectContaining({status:"open",count:1}));
    if (kind === "dare") {
      await ok(holder,{type:"redeem",ticketId:ticket.id});
      expect((await readHome(holder)).wallet.redeemed).toContainEqual(expect.objectContaining({id:ticket.id,status:"redeemed"}));
    } else {
      await getPrisma().game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(offset + 13 * 86_400_000)}});
      expect((await readHome(holder)).wallet.held).toContainEqual(expect.objectContaining({id:ticket.id,status:"open"}));
      await getPrisma().game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(offset + 14 * 86_400_000)}});
      expect((await readHome(holder)).wallet.held).toContainEqual(expect.objectContaining({id:ticket.id,status:"expired"}));
      expect(await errorCode(holder,{type:"redeem",ticketId:ticket.id})).toBe("TICKET_EXPIRED");
    }
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

    // The name Leo types for the invitee is his private label: the public preview never carries it.
    const created = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Babe", terms: { ...TERMS, startsOn }, type: "createGame" });
    expect(created!.startsOn).toBe(startsOn);
    const preview = await readInvitePreview(created!.inviteToken!);
    expect(preview).toMatchObject({ inviterFirstName: "Leo", startsOn, status: "open" });
    expect(preview).not.toHaveProperty("inviteeFirstName");
    expect(JSON.stringify(preview)).not.toContain("Babe");

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
    const { gameId, token } = await startGame(leo, ava, { terms: { ...TERMS, schedule: { days: [weekdayOf(today)] } } });
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
    // Past the invite's 7-day expiry, a link that was taken still reads as used.
    expect(await readInvitePreview(token)).toEqual({ status: "used" });
  });

  it("refuses a rematch of an older game once the same two people have a newer one", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const { gameId: first } = await startGame(leo, ava);
    await devSettleNow(first, leo);
    const rematchOf = (previousGameId: string): GameCommand => ({
      gameId: randomUUID(),
      inviteeFirstName: "Ava",
      previousGameId,
      terms: TERMS,
      type: "createGame",
    });

    // A rematch of the newest game works.
    const second = await ok(leo, rematchOf(first));
    expect(second).toMatchObject({ round: 2, status: "invited" });
    // While that rematch is open, or live, another one from round 1 could never be accepted.
    expect(await run(leo, rematchOf(first))).toMatchObject({
      error: { code: "ALREADY_IN_A_GAME", message: "You and Ava already have a game going." },
      ok: false,
    });
    await ok(ava, { termsVersion: 1, timeZone: "America/New_York", token: second!.inviteToken!, type: "join" });
    expect(await errorCode(ava, rematchOf(first))).toBe("ALREADY_IN_A_GAME");

    // Once round 2 has settled, round 1 is outdated; round 2 rematches fine.
    await devSettleNow(second!.id, leo);
    expect(await run(ava, rematchOf(first))).toMatchObject({
      error: { code: "REMATCH_OUTDATED", message: "There's a newer game with Leo." },
      ok: false,
    });
    expect(await ok(ava, rematchOf(second!.id))).toMatchObject({ round: 3, status: "invited" });
  });

  it("starts the round count over when someone new takes a rematch", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const first = await startGame(leo, ava);
    await devSettleNow(first.gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Kat", previousGameId: first.gameId, terms: TERMS, type: "createGame" });
    expect(rematch!.round).toBe(2);
    // Addressed to Ava while it's an invite.
    expect(await readGame(rematch!.id, ava)).toMatchObject({ status: "invited" });
    expect((await readHome(ava)).games.map((game) => game.id)).toContain(rematch!.id);
    const joined = await ok(kat, { termsVersion: 1, timeZone: "Europe/London", token: rematch!.inviteToken!, type: "join" });
    expect(joined!.round).toBe(1);
    // Once someone else takes it, Ava no longer sees Leo and Kat's game, live or settled.
    expect(await readGame(rematch!.id, ava)).toBeNull();
    expect((await readHome(ava)).games.map((game) => game.id)).not.toContain(rematch!.id);
    await devSettleNow(rematch!.id, leo);
    expect(await readGame(rematch!.id, ava)).toBeNull();
    expect(await readGame(rematch!.id, kat)).toMatchObject({ status: "settled" });
    expect(await readGame(rematch!.id, leo)).toMatchObject({ status: "settled" });
  });

  it("settles a finished game between the same two people that nobody opened before their next one", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const stale = await startGame(leo, ava);
    // Past the last day and grace, with no read since.
    await getPrisma().gamePlayer.updateMany({
      data: { dayOne: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
      where: { gameId: stale.gameId },
    });
    expect((await getPrisma().game.findUniqueOrThrow({ where: { id: stale.gameId } })).status).toBe("live");

    const next = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });
    const joined = await ok(ava, { termsVersion: 1, timeZone: "UTC", token: next!.inviteToken!, type: "join" });
    expect(joined!.status).toBe("live");
    expect((await getPrisma().game.findUniqueOrThrow({ where: { id: stale.gameId } })).status).toBe("settled");
  });

  it("lets one person play several live games, one per opponent, but not two with the same person", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    await startGame(leo, ava);
    await startGame(leo, kat);
    expect((await readHome(leo)).games.filter((game) => game.status === "live")).toHaveLength(2);

    // A second live game between Leo and Ava, from either side.
    const fromLeo = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });
    expect(await run(ava, { termsVersion: 1, timeZone: "UTC", token: fromLeo!.inviteToken!, type: "join" })).toMatchObject({
      error: { code: "ALREADY_IN_A_GAME", message: "You and Leo already have a game going." },
      ok: false,
      status: 409,
    });
    const fromAva = await ok(ava, { gameId: randomUUID(), inviteeFirstName: "Leo", terms: TERMS, type: "createGame" });
    expect(await run(leo, { termsVersion: 1, timeZone: "UTC", token: fromAva!.inviteToken!, type: "join" })).toMatchObject({
      error: { message: "You and Ava already have a game going." },
      ok: false,
    });
  });

  it("lets only one of two simultaneous accepts between the same two people go live", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const invites = await Promise.all([1, 2].map(() =>
      ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" })));

    const results = await Promise.all(invites.map((game) =>
      run(ava, { termsVersion: 1, timeZone: "UTC", token: game!.inviteToken!, type: "join" })));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.flatMap((result) => (result.ok ? [] : [result.error]))).toEqual([
      { code: "ALREADY_IN_A_GAME", message: "You and Leo already have a game going." },
    ]);
    const games = await getPrisma().game.findMany({ where: { id: { in: invites.map((game) => game!.id) } } });
    expect(games.filter((game) => game.status === "live")).toHaveLength(1);
  });

  it("orders Home: waiting on you today, other live games, invites, then results", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const ben = await member("Ben", "UTC");
    const settled = await startGame(leo, ben);
    await devSettleNow(settled.gameId, leo);
    const posted = await startGame(leo, kat);
    await devStartNow(posted.gameId, leo);
    await ok(leo, await photo(leo, posted.gameId, "done-today"));
    const waiting = await startGame(leo, ava);
    await devStartNow(waiting.gameId, leo);
    const invite = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ben", terms: TERMS, type: "createGame" });

    expect((await readHome(leo)).games.map((game) => game.id)).toEqual([waiting.gameId, posted.gameId, invite!.id, settled.gameId]);
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
