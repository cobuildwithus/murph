import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/src/lib/primitives";
import type { RuleEntry, RuleState } from "@/src/lib/game/rules";

const m = vi.hoisted(() => ({ replyAccess: vi.fn(), routes: vi.fn(), route: vi.fn(), claims: vi.fn(), previous: vi.fn(), blocks: vi.fn(), game: vi.fn(), report: vi.fn(), update: vi.fn(), send: vi.fn(), forget: vi.fn() }));
vi.mock("@/src/lib/apple-push/send", async original => ({ ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: m.send }));
vi.mock("@/src/lib/companion/push-route", async original => ({ ...await original<typeof import("@/src/lib/companion/push-route")>(), forgetCompanionPushRoute: m.forget }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ companionPushRoute: { findFirst: m.route }, gameEvent: { updateMany: m.update }, game: { findUnique: m.game }, gameBlock: { findMany: m.blocks }, gameReport: { findFirst: m.report } }) }));
vi.mock("@/src/lib/game/service", () => ({ canReadGameReply: m.replyAccess }));
import { claimGameReplyNotification, deliverGameReplyNotification } from "@/src/lib/game/reply-notification";
import { claimGamePostNotification, deliverGamePostNotification } from "@/src/lib/game/post-notification";

const target = { token: "ab".repeat(32), environment: "development", topic: "ai.withmurph.app.dev" };
const clock = new Date("2026-10-21T12:00:00Z");
const post = (memberId: string, extra: Partial<RuleEntry> = {}): RuleEntry => ({ id: `post-${memberId}`, memberId, dayIndex: 0, attempt: 1, kind: "photo", receivedAt: clock, withdrawnAt: null, mediaKeys: [], blurHash: null, ...extra });
function state(count = 2): RuleState {
  return { game: { id: "game-a", seats: count === 2 ? 2 : 10, createdBy: "p0", status: "live", lengthDays: 7, startsOn: null, inviteExpiresAt: null,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] } },
    players: Array.from({ length: count }, (_, seat) => ({ memberId: `p${seat}`, seat, timeZone: "America/New_York", dayOne: "2026-10-21", joinedAt: clock })), entries: [post("p0")] };
}
function stored(s: RuleState) {
  return { id: s.game.id, status: s.game.status, maxPlayers: s.game.seats, createdBy: s.game.createdBy, lengthDays: s.game.lengthDays, startsOn: null, inviteExpiresAt: null, devClockOffsetMs: 0n,
    terms: s.game.terms, invitees: s.game.invitees, entries: s.entries, players: s.players.map(player => ({ ...player, entries: s.entries.filter(entry => entry.memberId === player.memberId), dayOne: player.dayOne ? new Date(`${player.dayOne}T00:00:00Z`) : null })) };
}
const tx = { companionPushRoute: { findMany: m.routes }, gameEvent: { findMany: m.previous, createMany: m.claims }, gameBlock: { findMany: m.blocks } };
async function claim(s = state(), at = clock, actor = "p0") {
  m.game.mockResolvedValue(stored(s));
  m.routes.mockResolvedValue(s.players.filter(player => player.memberId !== actor).map(player => ({ userId: player.memberId, ...target, gameSessionId: "session-one" })));
  return claimGamePostNotification(tx, { state: s, clock: at, actor, entryId: `post-${actor}`, dayIndex: 0 });
}

describe("one daily game notifier", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(clock);
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    m.previous.mockResolvedValue([]); m.blocks.mockResolvedValue([]); m.report.mockResolvedValue(null);
    m.claims.mockImplementation(async ({ data }) => ({ count: data.length }));
    m.route.mockResolvedValue({ userId: "p1" }); m.send.mockResolvedValue("sent"); m.update.mockResolvedValue({ count: 1 });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("claims coinciding slots once and preserves pair copy", async () => {
    const notifications = await claim();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].claims.map(claim => claim.slot)).toEqual(["first", "completion"]);
    await deliverGamePostNotification(notifications[0]);
    expect(m.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: { gameId: "game-a", notification: "game_post" },
      message: { kind: "alert", title: "New game check-in", body: "Someone posted. Share yours to see it." } }));
  });
  it.each([null, clock])("tells a pair's first poster theirs develops, even after withdrawal %s", async withdrawnAt => {
    const s = state(); s.entries.push(post("p1", { withdrawnAt }));
    const [notification] = await claim(s); await deliverGamePostNotification(notification);
    expect(m.send.mock.calls[0][0].message).toEqual({ kind: "alert", title: "They're in too.", body: "Theirs develops when you open it." });
  });
  it("keeps group copy for a recipient who already posted", async () => {
    const s = state(3); s.entries.push(post("p1"));
    const n = (await claim(s)).find(n => n.memberId === "p1")!;
    await deliverGamePostNotification(n);
    expect(m.send.mock.calls[0][0].message).toEqual({ kind: "alert", title: "New game check-in", body: "There's a new post in your game. Take a look." });
  });
  it("claims first then completion and includes incomplete artifacts", async () => {
    const s = state(3); const first = (await claim(s)).find(n => n.memberId === "p2")!;
    expect(first.claims.map(claim => claim.slot)).toEqual(["first"]);
    m.previous.mockResolvedValue(first.claims);
    s.entries.push(post("p1", { incomplete: true }));
    const final = (await claim(s, clock, "p1")).find(n => n.memberId === "p2")!;
    expect(final.claims.map(claim => claim.slot)).toEqual(["completion"]);
    await deliverGamePostNotification(final);
    expect(m.send.mock.calls[0][0].message.body).toBe("Everyone's in but you.");
  });
  it("sends Everyone's in to a recipient who posted and combines both slots", async () => {
    const s = state(3); s.entries.push(post("p1"), post("p2"));
    const n = (await claim(s)).find(n => n.memberId === "p2")!;
    expect(n.claims).toHaveLength(2); await deliverGamePostNotification(n);
    expect(m.send.mock.calls[0][0].message.body).toBe("Everyone's in.");
  });
  it("treats a legacy receipt as both slots consumed and handles competing claims", async () => {
    const key = `game-post:${sha256Hex(JSON.stringify(["game-a", "p1", "2026-10-21"]))}`;
    m.previous.mockResolvedValue([{ commandKey: key }]); expect(await claim()).toEqual([]);
    m.previous.mockResolvedValue([]); m.claims.mockResolvedValue({ count: 0 }); expect(await claim()).toEqual([]);
  });
  it("keys real local 03:00 days independently of entry days and handles DST", async () => {
    const first = (await claim(state(), new Date("2026-10-21T06:59:59Z")))[0];
    const same = (await claim(state(), new Date("2026-10-21T01:00:00Z")))[0];
    const next = (await claim(state(), new Date("2026-10-21T07:00:00Z")))[0];
    expect(first.day).toBe("2026-10-20"); expect(first.claims).toEqual(same.claims); expect(next.claims).not.toEqual(first.claims);
    const dst = (await claim(state(), new Date("2026-11-01T07:30:00Z")))[0];
    expect(dst.day).toBe("2026-10-31"); expect(dst.request.expiresAt).toEqual(new Date("2026-11-01T08:00:00Z"));
  });
  it.each(["retake", "excuse", "withdrawn"])("does not claim for %s", async reason => {
    const s = state(); s.entries[0] = post("p0", reason === "retake" ? { attempt: 2 } : reason === "excuse" ? { kind: "excuse", attempt: 0 } : { withdrawnAt: clock });
    expect(await claim(s)).toEqual([]); expect(m.claims).not.toHaveBeenCalled();
  });
  it("excludes left and future-eligible peers and never names blocked activity", async () => {
    const s = state(4); s.players[2].leftAt = clock; s.players[3].joinedAt = new Date("2026-10-22T12:00:00Z");
    expect(await claim(s)).toHaveLength(1);
    m.blocks.mockResolvedValue([{ blockerMemberId: "p1", blockedMemberId: "p0" }]); expect(await claim(s)).toEqual([]);
    const group = state(3); group.entries.push(post("p2"));
    m.blocks.mockResolvedValue([{ blockerMemberId: "p1", blockedMemberId: "p2" }]);
    expect((await claim(group)).find(n => n.memberId === "p1")!.claims.map(c => c.slot)).toEqual(["first"]);
  });
  it("delivers the last post after the settling read", async () => {
    const s = state();
    const [notification] = await claim(s);
    s.game.status = "settled";
    m.game.mockResolvedValue(stored(s));
    await deliverGamePostNotification(notification);
    expect(m.send).toHaveBeenCalledOnce();
  });
  it.each(["withdrawn", "left", "blocked", "reported", "void", "route", "expired", "milestone"])("suppresses stale %s without releasing claims", async reason => {
    const s = state(3); s.entries.push(post("p2")); const n = (await claim(s)).find(n => n.memberId === "p1")!;
    if (reason === "withdrawn") s.entries[0].withdrawnAt = clock;
    if (reason === "left") s.players[1].leftAt = clock;
    if (reason === "blocked") m.blocks.mockResolvedValue([{ blockerMemberId: "p1", blockedMemberId: "p2" }]);
    if (reason === "reported") m.report.mockResolvedValue({ id: "report" });
    if (reason === "void") s.game.status = "void";
    if (reason === "route") m.route.mockResolvedValue(null);
    if (reason === "expired") vi.setSystemTime(n.request.expiresAt);
    if (reason === "milestone") s.entries.push(post("p1"));
    m.game.mockResolvedValue(stored(s)); await deliverGamePostNotification(n);
    expect(m.send).not.toHaveBeenCalled(); expect(m.update.mock.calls[0][0].data.payload.outcome).toBe("superseded");
  });
  it("revalidates session and exact token, preserves uncertain claims, and forgets only rejected tokens", async () => {
    const [n] = await claim(); m.send.mockRejectedValueOnce(new Error("uncertain")); await deliverGamePostNotification(n);
    expect(m.route.mock.calls[0][0].where).toMatchObject({ gameSessionId: "session-one", ...target, member: { authRecords: { some: { id: "session-one" } } } });
    expect(m.update.mock.calls[0][0].data.payload.outcome).toBe("failed");
    m.send.mockResolvedValue("unregistered"); await deliverGamePostNotification(n); expect(m.forget).toHaveBeenCalledExactlyOnceWith("p1", target.token);
  });
  it("honors the switch at claim and delivery, and refuses unenrolled routes", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "false"); expect(await claim()).toEqual([]);
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    const [notification] = await claim();
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    await deliverGamePostNotification(notification);
    expect(m.send).not.toHaveBeenCalled();
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    m.routes.mockResolvedValue([{ userId: "p1", ...target, gameSessionId: null }]);
    expect(await claimGamePostNotification(tx, { state: state(), clock, actor: "p0", entryId: "post-p0", dayIndex: 0 })).toEqual([]);
  });
});


describe("one reply push per post", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(clock);
    m.claims.mockResolvedValue({ count: 1 });
    m.routes.mockResolvedValue([{ userId: "owner", ...target, gameSessionId: "reply-session" }]);
    m.route.mockResolvedValue({ userId: "owner" }); m.replyAccess.mockResolvedValue(true); m.send.mockResolvedValue("sent");
  });
  afterEach(() => vi.useRealTimers());
  const input = { gameId: "game-reply", entryId: "post-reply", replyId: "reply-first", memberId: "owner", kind: "text" as const };
  it.each(["text", "voice"] as const)("sends content-free %s copy through the shared session and delivery checks", async kind => {
    const notification = await claimGameReplyNotification(tx, { ...input, kind });
    expect(notification).not.toBeNull();
    await deliverGameReplyNotification(notification!);
    expect(m.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: { gameId: "game-reply", notification: "game_reply" }, expiresAt: new Date(clock.getTime() + 24 * 60 * 60 * 1000),
      message: { kind: "alert", body: kind === "voice" ? "New voice note on your post." : "New note on your post." },
    }));
    expect(m.claims.mock.calls[0][0].data[0]).toEqual({ gameId: "game-reply", actor: "system", type: "reply_notification",
      commandKey: "game-reply-push:post-reply", payload: { entryId: "post-reply" } });
    expect(m.replyAccess).toHaveBeenCalledWith(input.gameId, input.replyId, input.memberId);
    expect(m.route.mock.calls[0][0].where).toMatchObject({ gameSessionId: "reply-session", alertsAllowed: true, member: { suspendedAt: null } });
  });
  it("never releases the post claim after delete, missing enrollment or uncertain failure", async () => {
    m.routes.mockResolvedValue([]);
    expect(await claimGameReplyNotification(tx, input)).toBeNull();
    expect(m.claims).toHaveBeenCalledTimes(1);
    m.claims.mockResolvedValue({ count: 0 });
    expect(await claimGameReplyNotification(tx, { ...input, replyId: "new-reply" })).toBeNull();
    expect(m.send).not.toHaveBeenCalled();
  });
  it("suppresses a reply when current read authorization denies it", async () => {
    const notification = await claimGameReplyNotification(tx, input);
    m.replyAccess.mockResolvedValue(false);
    await deliverGameReplyNotification(notification!);
    expect(m.send).not.toHaveBeenCalled();
  });
  it("suppresses revoked sessions and cleans up unregistered tokens", async () => {
    const notification = await claimGameReplyNotification(tx, input);
    m.route.mockResolvedValue(null); await deliverGameReplyNotification(notification!);
    expect(m.send).not.toHaveBeenCalled();
    m.route.mockResolvedValue({ userId: "owner" }); m.send.mockResolvedValue("unregistered");
    await deliverGameReplyNotification(notification!);
    expect(m.forget).toHaveBeenCalledWith("owner", target.token);
  });
});
