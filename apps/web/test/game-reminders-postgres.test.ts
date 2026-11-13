import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplePushRequest } from "@/src/lib/apple-push/send";

const m = vi.hoisted(() => ({ send: vi.fn(), beforeSend: vi.fn(), actor: "", current: vi.fn() }));
vi.mock("@/src/lib/apple-push/send", async original => ({
  ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: m.send,
}));
vi.mock("@/src/lib/game/push-delivery", async original => {
  const actual = await original<typeof import("@/src/lib/game/push-delivery")>();
  return { ...actual, deliverGamePush: async (...args: Parameters<typeof actual.deliverGamePush>) => {
    await m.beforeSend();
    return actual.deliverGamePush(...args);
  } };
});
vi.mock("@/src/lib/game/http/auth", () => ({
  requireGameMemberAuth: async () => ({ member: { id: m.actor }, sessionId: "synthetic-session" }),
  assertGameMemberAuthCurrentTx: m.current,
}));

import { getPrisma } from "@/src/lib/prisma";
import { sealGameText } from "@/src/lib/game/crypto";
import { sendDueGameReminders } from "@/src/lib/game/reminder-notification";
import { deliverGamePush } from "@/src/lib/game/push-delivery";
import { readGameReminders, readHome, runGameCommand } from "@/src/lib/game/service";
import { GET, PUT } from "../app/api/game/v1/me/reminders/route";
import { gameHttpError } from "@/src/lib/game/http/errors";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Reminder proof needs a loopback test database.");
const now = new Date("2026-11-06T19:00:00Z");
const members: string[] = [];
const db = getPrisma();
async function member(zone = "UTC", capable = true, sweepAt = now) {
  const prefix = `hbm_reminder_${randomUUID()}_`, shard = Math.floor(sweepAt.getTime() / 60_000) % 5;
  const [candidate] = await db.$queryRaw<Array<{ id: string }>>`SELECT ${prefix} || n::text AS id FROM generate_series(1, 1000) n
    WHERE mod(abs(hashtext(${prefix} || n::text)::bigint), 5) = ${shard} LIMIT 1`;
  const id = candidate!.id;
  members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "not_started" } });
  await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName: "Player", timeZone: "UTC" } });
  await db.gameProfile.update({ where: { memberId: id }, data: { timeZone: zone } });
  const sessionId = randomUUID();
  await db.hostedAuthRecord.create({ data: { id: sessionId, model: "session", memberId: id, payloadEncrypted: "unused",
    expiresAt: new Date("2027-01-01T00:00:00Z"), createdAt: now, updatedAt: now } });
  await db.companionPushRoute.create({ data: { userId: id, installationId: randomUUID(), token: "ab".repeat(32),
    topic: "ai.withmurph.app.dev", environment: "development", alertsAllowed: true, gameSessionId: sessionId, gameReminders: capable, updatedAt: now } });
  return id;
}
async function game(owner: string, task = "Walk", peer?: string, group = false) {
  const id = randomUUID();
  const words = { v: 1, versions: [{ n: 1, defaultTask: "Shared task", tasks: [{ seat: 0, text: task }, { seat: 1, text: "Peer private words" }], stakes: [] }] };
  const encrypted = await sealGameText({ field: "terms_words", memberId: owner, rowId: id, table: "game" }, JSON.stringify(words));
  await db.game.create({ data: { id, createdBy: owner, wordsOwnerMemberId: owner, status: "live", maxPlayers: group ? 10 : 2,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] }, termsWordsEncrypted: encrypted!,
    players: { create: [owner, ...(peer ? [peer] : [])].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: new Date("2026-11-06T00:00:00Z"), joinedAt: now })) } } });
  return id;
}
async function post(gameId: string, memberId: string) {
  return db.gameEntry.create({ data: { id: randomUUID(), gameId, memberId, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
}
const claims = () => db.gameEvent.findMany({ where: { type: "reminder_notification", game: { wordsOwnerMemberId: { in: members } } } });
const request = (body?: unknown) => new Request("https://backend.test/api/game/v1/me/reminders", {
  method: body ? "PUT" : "GET", ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
});
const preference = { minutes: 1140, push: true, text: false, offGameIds: [] as string[] };

describe.skipIf(!enabled)("game reminders PostgreSQL", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.resetAllMocks(); m.send.mockResolvedValue("sent");
  });
  afterEach(async () => {
    await cleanupGameFixtures(db, members);
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
    vi.useRealTimers(); vi.unstubAllEnvs();
  });

  it("reads defaults without creating a profile", async () => {
    m.actor = `hbm_reminder_${randomUUID()}`; members.push(m.actor);
    await db.hostedMember.create({ data: { id: m.actor } });
    expect(await (await GET(request())).json()).toEqual({ ok: true, ...preference, canText: false });
    expect(await db.gameProfile.findUnique({ where: { memberId: m.actor } })).toBeNull();
  });
  it("round trips whole preferences through the command, ignores foreign ids and preserves Home bytes", async () => {
    const owner = await member(), foreign = await member(); m.actor = owner;
    const first = await game(owner), second = await game(owner), other = await game(foreign);
    const home = await readHome(owner);
    const saved = { ...preference, minutes: 1200, push: false, offGameIds: [first, other, randomUUID()] };
    expect(await (await PUT(request(saved))).json()).toEqual({ ok: true, ...saved, canText: false, offGameIds: [first] });
    expect(await (await GET(request())).json()).toEqual({ ok: true, ...saved, canText: false, offGameIds: [first] });
    expect(m.current).toHaveBeenCalledOnce();
    expect(await readHome(owner)).toEqual(home);
    expect(await runGameCommand({ actorMemberId: owner, command: { type: "setReminders", ...preference, offGameIds: [second] } }))
      .toMatchObject({ ok: true, reminders: { offGameIds: [second] } });
    expect((await db.gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: other, memberId: foreign } } })).reminderOff).toBe(false);
  });
  it("refuses text, partial and invalid route bodies without writing", async () => {
    m.actor = await member();
    for (const body of [{ ...preference, text: true }, { ...preference, minutes: 1440 }, { minutes: 900 }]) {
      const response = await PUT(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    }
    expect(await readGameReminders(m.actor)).toEqual({ ...preference, canText: false });
    m.current.mockRejectedValueOnce(gameHttpError("UNAUTHENTICATED", 401, "Sign in."));
    expect((await PUT(request({ ...preference, push: false }))).status).toBe(401);
    expect((await readGameReminders(m.actor)).push).toBe(true);
  });
  it("sends once for two games with both own tasks and content-free claims", async () => {
    const owner = await member();
    await game(owner, "Walk"); await game(owner, "Read");
    await Promise.all([sendDueGameReminders(now), sendDueGameReminders(now)]);
    expect(m.send).toHaveBeenCalledOnce();
    const push = m.send.mock.calls[0]![0] as ApplePushRequest;
    expect(push.message).toMatchObject({ body: "Still time today." });
    expect(push.message.kind === "alert" && push.message.title?.split(", ").sort()).toEqual(["Read", "Walk"]);
    expect(push).toMatchObject({ sound: "default", expiresAt: new Date("2026-11-06T19:30:00Z"), data: { notification: "game_reminder" } });
    const receipts = await claims();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.payload).toEqual({ v: 1, recipientMemberId: owner, day: "2026-11-06", outcome: "sent" });
    expect(push.collapseId).toHaveLength(64);
    const other = await db.game.findFirstOrThrow({ where: { wordsOwnerMemberId: owner, id: { not: receipts[0]!.gameId } } });
    expect(await db.gameEvent.createMany({ skipDuplicates: true, data: [{ gameId: other.id, actor: "system", type: "reminder_notification",
      commandKey: receipts[0]!.commandKey, payload: { outcome: "claimed" } }] })).toEqual({ count: 0 });
    await sendDueGameReminders(now);
    expect(m.send).toHaveBeenCalledOnce();
  });
  it("rechecks posting after claiming and never releases the superseded claim", async () => {
    const owner = await member(), id = await game(owner);
    m.beforeSend.mockImplementationOnce(() => post(id, owner));
    await sendDueGameReminders(now);
    expect(m.send).not.toHaveBeenCalled();
    expect((await claims())[0]!.payload).toMatchObject({ outcome: "superseded" });
    await db.gameEntry.deleteMany({ where: { gameId: id } });
    await sendDueGameReminders(now);
    expect(m.send).not.toHaveBeenCalled();
  });
  it("builds the title and navigation from the surviving game", async () => {
    const owner = await member(), closed = await game(owner, "Walk"), surviving = await game(owner, "Read");
    m.beforeSend.mockImplementationOnce(() => db.game.update({ where: { id: closed }, data: { status: "settled" } }));
    await sendDueGameReminders(now);
    expect(m.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: { gameId: surviving, notification: "game_reminder" },
      message: { kind: "alert", title: "Read", body: "Still time today." } }));
  });
  it.each(["none", "outgoing", "incoming"])("uses a visible peer post only, block=%s", async block => {
    const owner = await member(), peer = await member("UTC", false), id = await game(owner, "Walk", peer);
    await post(id, peer);
    if (block !== "none") await db.gameBlock.create({ data: { blockerMemberId: block === "outgoing" ? owner : peer, blockedMemberId: block === "outgoing" ? peer : owner } });
    await sendDueGameReminders(now);
    expect(m.send.mock.calls[0]![0].message).toEqual({ kind: "alert", title: "Walk", body: block === "none" ? "They posted. Share yours to see it." : "Still time today." });
  });
  it("uses the effective task and a group seat override, capped at 120 characters", async () => {
    const owner = await member(), id = await game(owner, "Old task", undefined, true);
    const words = { v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "Old task" }], stakes: [] },
      { n: 2, defaultTask: "Group task", tasks: [{ seat: 0, text: "x".repeat(140) }], stakes: [] }] };
    const encrypted = await sealGameText({ field: "terms_words", memberId: owner, rowId: id, table: "game" }, JSON.stringify(words));
    await db.game.update({ where: { id }, data: { termsWordsEncrypted: encrypted!, terms: { v: 1, versions: [
      { n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }, { n: 2, fromDay: 0, schedule: { count: 7 }, stakes: [] },
    ] } } });
    await sendDueGameReminders(now);
    expect(m.send.mock.calls[0]![0].message.title).toBe("x".repeat(120));
  });
  it("uses profile zones for timing, frozen seat zones for play, and skips only the invalid zone", async () => {
    const bad = await member("invalid/zone"), local = await member("America/New_York"), due = await member("Europe/Warsaw");
    await game(bad); await game(local); await game(due);
    await db.gameProfile.update({ where: { memberId: due }, data: { reminderMinutes: 1200 } });
    await sendDueGameReminders(now);
    expect(m.send).toHaveBeenCalledOnce();
    expect((await claims())[0]!.payload).toMatchObject({ recipientMemberId: due });
  });
  it.each(["push", "game", "capability", "alerts", "session", "switch", "posted", "excused", "exhausted"])("does not claim when unavailable: %s", async reason => {
    const owner = await member(), id = await game(owner);
    if (reason === "push") await db.gameProfile.update({ where: { memberId: owner }, data: { reminderPush: false } });
    if (reason === "game") await db.gamePlayer.updateMany({ where: { gameId: id }, data: { reminderOff: true } });
    if (reason === "capability") await db.companionPushRoute.update({ where: { userId: owner }, data: { gameReminders: false } });
    if (reason === "alerts") await db.companionPushRoute.update({ where: { userId: owner }, data: { alertsAllowed: false } });
    if (reason === "session") await db.companionPushRoute.update({ where: { userId: owner }, data: { gameSessionId: null } });
    if (reason === "switch") vi.stubEnv("MURPH_GAME_ENABLED", "false");
    if (reason === "posted") await post(id, owner);
    if (reason === "excused") await db.gameEntry.create({ data: { id: randomUUID(), gameId: id, memberId: owner, dayIndex: 0, attempt: 0, kind: "excuse", receivedAt: now } });
    if (reason === "exhausted") for (const attempt of [1, 2]) await db.gameEntry.create({ data: { id: randomUUID(), gameId: id, memberId: owner, dayIndex: 0, attempt, kind: "words", receivedAt: now, withdrawnAt: now } });
    await sendDueGameReminders(now);
    expect(m.send).not.toHaveBeenCalled(); expect(await claims()).toHaveLength(0);
  });
  it.each(["capability", "push", "session", "abort"])("rechecks changed authority after claim: %s", async reason => {
    const owner = await member(); await game(owner); const controller = new AbortController();
    m.beforeSend.mockImplementationOnce(async () => {
      if (reason === "capability") await db.companionPushRoute.update({ where: { userId: owner }, data: { gameReminders: false } });
      if (reason === "push") await db.gameProfile.update({ where: { memberId: owner }, data: { reminderPush: false } });
      if (reason === "session") await db.hostedAuthRecord.deleteMany({ where: { memberId: owner } });
      if (reason === "abort") controller.abort();
    });
    await sendDueGameReminders(now, { signal: controller.signal });
    expect(m.send).not.toHaveBeenCalled();
    expect((await claims())[0]!.payload).toMatchObject({ outcome: "superseded" });
  });
  it("keeps the window half open and respects the real deadline and abort before claiming", async () => {
    const owner = await member("UTC", true, new Date("2026-11-06T19:29:59Z")); await game(owner);
    await sendDueGameReminders(new Date("2026-11-06T18:59:59Z"));
    await sendDueGameReminders(new Date("2026-11-06T19:30:00Z"));
    await sendDueGameReminders(now, { deadlineMs: Date.now() });
    await sendDueGameReminders(now, { signal: AbortSignal.abort() });
    expect(await claims()).toHaveLength(0);
    vi.setSystemTime(new Date("2026-11-06T19:29:59Z"));
    await sendDueGameReminders(new Date());
    expect(m.send).toHaveBeenCalledOnce();
  });
  it("sends nothing when the route loses capability during the content recheck", async () => {
    const owner = await member();
    const route = await db.companionPushRoute.findUniqueOrThrow({ where: { userId: owner } });
    const request = { target: { token: route.token, topic: route.topic, environment: route.environment }, collapseId: "reminder",
      expiresAt: new Date(now.getTime() + 60_000), data: {}, message: { kind: "alert", body: "Still time today." } } as ApplePushRequest;
    await expect(deliverGamePush({ memberId: owner, sessionId: route.gameSessionId!, request, requireGameReminders: true }, async () => {
      await db.companionPushRoute.update({ where: { userId: owner }, data: { gameReminders: false } });
      return true;
    })).resolves.toBe("superseded");
    expect(m.send).not.toHaveBeenCalled();
  });
  it("visits another minute's shard within the reminder window", async () => {
    const next = new Date("2026-11-06T19:01:00Z"), owner = await member("UTC", true, next);
    await game(owner);
    await sendDueGameReminders(now);
    expect(await claims()).toHaveLength(0);
    vi.setSystemTime(next);
    await sendDueGameReminders(next);
    expect(m.send).toHaveBeenCalledOnce();
  });
  it("pages members and keeps failed sends claimed", async () => {
    for (let index = 0; index < 7; index += 1) await game(await member());
    m.send.mockResolvedValue("failed");
    await sendDueGameReminders(now);
    expect(m.send).toHaveBeenCalledTimes(7);
    expect(await claims()).toHaveLength(7);
    expect((await claims()).every(claim => typeof claim.payload === "object" && claim.payload !== null && "outcome" in claim.payload && claim.payload.outcome === "failed")).toBe(true);
    await sendDueGameReminders(now);
    expect(m.send).toHaveBeenCalledTimes(7);
  });
});
