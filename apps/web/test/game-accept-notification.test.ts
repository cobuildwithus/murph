import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ after: vi.fn(), routes: vi.fn(), route: vi.fn(), game: vi.fn(), block: vi.fn(), send: vi.fn(), forget: vi.fn() }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/src/lib/apple-push/send", async original => ({ ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: m.send }));
vi.mock("@/src/lib/companion/push-route", async original => ({ ...await original<typeof import("@/src/lib/companion/push-route")>(), forgetCompanionPushRoute: m.forget }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ companionPushRoute: { findFirst: m.route }, game: { findUnique: m.game }, gameBlock: { findFirst: m.block } }) }));
import { prepareGameAcceptNotification, deliverGameAcceptNotification, sendGameAcceptNotificationAfterResponse } from "@/src/lib/game/accept-notification";

const target = { token: "ab".repeat(32), environment: "development", topic: "ai.withmurph.app.dev" };
const clock = new Date("2026-11-11T12:00:00Z");
const tx = { companionPushRoute: { findMany: m.routes } };
const input = { gameId: "game-a", maxPlayers: 2, actor: "leo", clock,
  schedule: { players: [
    { memberId: "ava", timeZone: "America/New_York", dayOne: "2026-11-11" },
    { memberId: "leo", timeZone: "Pacific/Auckland", dayOne: "2026-11-11" },
  ] } };
const liveGame = () => ({ status: "live", players: [{ memberId: "ava", leftAt: null }, { memberId: "leo", leftAt: null }] });

describe("pair invite acceptance push", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(clock);
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    m.routes.mockResolvedValue([{ userId: "ava", ...target, gameSessionId: "session-ava" }]);
    m.route.mockResolvedValue({ userId: "ava" }); m.game.mockResolvedValue(liveGame());
    m.block.mockResolvedValue(null); m.send.mockResolvedValue("sent");
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each([
    ["2026-11-11T12:00:00Z", "2026-11-11", "today", "2026-11-12T08:00:00Z"],
    ["2026-11-11T12:00:00Z", "2026-11-12", "tomorrow", "2026-11-12T08:00:00Z"],
    ["2026-11-11T12:00:00Z", "2026-11-13", "Friday", "2026-11-12T08:00:00Z"],
    ["2026-11-11T12:00:00Z", "2026-11-17", "Tuesday", "2026-11-12T08:00:00Z"],
    ["2026-11-11T12:00:00Z", "2026-11-18", "Nov 18", "2026-11-12T08:00:00Z"],
    ["2026-11-11T12:00:00Z", "2026-11-23", "Nov 23", "2026-11-12T08:00:00Z"],
    // UTC is already tomorrow, while the recipient is still on November 11.
    ["2026-11-12T02:00:00Z", "2026-11-12", "tomorrow", "2026-11-12T08:00:00Z"],
    // 1am is calendar today even though it is still yesterday's game day.
    ["2026-11-12T06:00:00Z", "2026-11-12", "today", "2026-11-13T08:00:00Z"],
    // Day 1 comes from the schedule, even at 1am; the hour cannot predict it.
    ["2026-11-12T06:00:00Z", "2026-11-13", "tomorrow", "2026-11-13T08:00:00Z"],
    ["2026-11-01T05:30:00Z", "2026-11-01", "today", "2026-11-02T08:00:00Z"],
  ])("uses frozen-zone calendar wording at %s for Day 1 %s", async (at, dayOne, word, expiry) => {
    vi.setSystemTime(new Date(at));
    const notification = await prepareGameAcceptNotification(tx, { ...input, clock: new Date(at),
      schedule: { players: input.schedule.players.map(player => ({ ...player, dayOne })) } });
    expect(notification!.memberId).toBe("ava");
    await deliverGameAcceptNotification(notification!);
    expect(m.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: { gameId: "game-a", notification: "game_accepted" }, expiresAt: new Date(expiry), target,
      message: { kind: "alert", title: "They shook on it.", body: `Your game starts ${word}.` },
    }));
  });

  it("uses alerts without the reminders switch", async () => {
    const notification = await prepareGameAcceptNotification(tx, input);
    await deliverGameAcceptNotification(notification!);
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.routes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: {
      userId: { in: ["ava"] }, alertsAllowed: true, gameSessionId: { not: null }, member: { suspendedAt: null },
    } }));
    expect(m.route.mock.calls[0][0].where).toMatchObject({ ...target, alertsAllowed: true, gameSessionId: "session-ava", member: { suspendedAt: null, authRecords: { some: { id: "session-ava" } } } });
    expect(m.route.mock.calls[0][0].where).not.toHaveProperty("gameReminders");
  });

  it("prepares nothing for a group", async () => {
    expect(await prepareGameAcceptNotification(tx, { ...input, maxPlayers: 10 })).toBeNull();
    expect(m.routes).not.toHaveBeenCalled();
  });

  it.each(["missing", "invalid", "unenrolled"])("prepares nothing with a %s route", async reason => {
    m.routes.mockResolvedValue(reason === "missing" ? [] : [{ userId: "ava", ...target,
      token: reason === "invalid" ? "bad" : target.token, gameSessionId: reason === "unenrolled" ? null : "session-ava" }]);
    expect(await prepareGameAcceptNotification(tx, input)).toBeNull();
  });

  it.each(["missing", "settled", "void", "off", "left", "removed", "blocked", "route", "expired", "read-failed"])("sends nothing when the %s recheck fails", async reason => {
    const notification = await prepareGameAcceptNotification(tx, input);
    if (reason === "missing") m.game.mockResolvedValue(null);
    if (reason === "settled" || reason === "void") m.game.mockResolvedValue({ ...liveGame(), status: reason });
    if (reason === "off") vi.stubEnv("MURPH_GAME_ENABLED", "false");
    if (reason === "left") m.game.mockResolvedValue({ ...liveGame(), players: [{ memberId: "ava", leftAt: clock }] });
    if (reason === "removed") m.game.mockResolvedValue({ ...liveGame(), players: [{ memberId: "leo", leftAt: null }] });
    if (reason === "blocked") m.block.mockResolvedValue({ blockerMemberId: "ava" });
    if (reason === "route") m.route.mockResolvedValue(null);
    if (reason === "expired") vi.setSystemTime(notification!.request.expiresAt);
    if (reason === "read-failed") m.game.mockRejectedValue(new Error("unavailable"));
    await expect(deliverGameAcceptNotification(notification!)).resolves.toBeUndefined();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("defers delivery and never retries a failed send", async () => {
    const notification = await prepareGameAcceptNotification(tx, input);
    m.send.mockRejectedValueOnce(new Error("uncertain"));
    sendGameAcceptNotificationAfterResponse(notification);
    expect(m.send).not.toHaveBeenCalled();
    await expect(m.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(m.send).toHaveBeenCalledOnce();
  });

  it("falls back outside an HTTP response and cleans up an unregistered token", async () => {
    const notification = await prepareGameAcceptNotification(tx, input);
    m.after.mockImplementation(() => { throw new Error("no request context"); });
    m.send.mockResolvedValue("unregistered");
    expect(() => sendGameAcceptNotificationAfterResponse(notification)).not.toThrow();
    await vi.waitFor(() => expect(m.forget).toHaveBeenCalledExactlyOnceWith("ava", target.token));
  });
});
