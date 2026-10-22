import type { GamePlayer } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  route: vi.fn(), claim: vi.fn(), update: vi.fn(), send: vi.fn(), forget: vi.fn(),
}));
vi.mock("@/src/lib/apple-push/send", async (original) => ({
  ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: m.send,
}));
vi.mock("@/src/lib/companion/push-route", async (original) => ({
  ...await original<typeof import("@/src/lib/companion/push-route")>(), forgetCompanionPushRoute: m.forget,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ companionPushRoute: { findFirst: m.route }, gameEvent: { updateMany: m.update } }),
}));

import { claimGamePostNotification, deliverGamePostNotification } from "@/src/lib/game/post-notification";
import type { RuleEntry } from "@/src/lib/game/rules";

const target = { token: "ab".repeat(32), environment: "development", topic: "ai.withmurph.app.dev" };
const route = { ...target, gameSessionId: "session-one" };
const clock = new Date("2026-10-21T12:00:00Z");
const players: GamePlayer[] = ["poster", "recipient"].map((memberId, seat) => ({
  gameId: "game-a", memberId, seat, timeZone: "America/New_York", dayOne: clock, joinedAt: clock,
}));
// Only the transaction methods used by this owner; the PostgreSQL suite proves
// real lock, unique-key and commit behavior through runGameCommand.
const tx = { companionPushRoute: { findFirst: m.route }, gameEvent: { createMany: m.claim } };
const claim = (overrides: Partial<Parameters<typeof claimGamePostNotification>[1]> = {}) =>
  claimGamePostNotification(tx, { gameId: "game-a", actor: "poster", players, clock, entries: [], dayIndex: 0, ...overrides });

describe("game daily post notifications", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    m.route.mockResolvedValue(route);
    m.claim.mockResolvedValue({ count: 1 });
    m.send.mockResolvedValue("sent");
    m.update.mockResolvedValue({ count: 1 });
  });

  it("claims only the other player's allowed address and sends a content-free game destination", async () => {
    const notification = await claim();
    expect(m.route).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "recipient", alertsAllowed: true, gameSessionId: { not: null }, member: { suspendedAt: null } },
      select: { environment: true, token: true, topic: true, gameSessionId: true },
    });
    await deliverGamePostNotification(notification);
    expect(m.send).toHaveBeenCalledExactlyOnceWith({
      collapseId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      data: { gameId: "game-a", notification: "game_post" },
      expiresAt: new Date("2026-10-22T07:00:00Z"),
      message: { kind: "alert", title: "New game check-in", body: expect.any(String) }, target,
    });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { payload: { v: 1, recipientMemberId: "recipient", day: "2026-10-21", outcome: "sent" } },
    }));
  });

  it("keeps one stable daily identity across posts, with independent games, recipients and 3am boundaries", async () => {
    const first = await claim({ clock: new Date("2026-10-21T06:59:59Z") });
    const sameDay = await claim({ clock: new Date("2026-10-21T01:00:00Z") });
    const nextDay = await claim({ clock: new Date("2026-10-21T07:00:00Z") });
    const otherGame = await claim({ gameId: "game-b", clock: new Date("2026-10-21T06:59:59Z") });
    const otherPlayer = await claim({ actor: "recipient", clock: new Date("2026-10-21T06:59:59Z") });
    expect(first?.commandKey).toBe(sameDay?.commandKey);
    expect(new Set([first?.commandKey, nextDay?.commandKey, otherGame?.commandKey, otherPlayer?.commandKey]).size).toBe(4);
    m.claim.mockResolvedValue({ count: 0 });
    await deliverGamePostNotification(await claim());
    expect(m.send).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "photo", attempt: 1, dayIndex: 0, memberId: "recipient", withdrawnAt: null, unlocked: true },
    { kind: "heart_rate", attempt: 1, dayIndex: 0, memberId: "recipient", withdrawnAt: null, unlocked: true },
    { kind: "photo", attempt: 1, dayIndex: 0, memberId: "recipient", withdrawnAt: clock, unlocked: true },
    { kind: "excuse", attempt: 0, dayIndex: 0, memberId: "recipient", withdrawnAt: null, unlocked: false },
    { kind: "photo", attempt: 1, dayIndex: 1, memberId: "recipient", withdrawnAt: null, unlocked: false },
    { kind: "photo", attempt: 1, dayIndex: 0, memberId: "poster", withdrawnAt: null, unlocked: false },
  ] satisfies (Omit<RuleEntry, "id" | "mediaKeys"> & { unlocked: boolean })[])(
    "matches the post-to-unlock state for the new entry's day: %j", async ({ unlocked, ...entry }) => {
      const notification = await claim({ entries: [{ ...entry, id: "entry-one", mediaKeys: [] }] });
      await deliverGamePostNotification(notification);
      expect(m.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        message: {
          kind: "alert", title: "New game check-in",
          body: unlocked ? "There's a new post in your game. Take a look." : "Someone posted. Share yours to see it.",
        },
      }));
    },
  );

  it("uses the recipient's frozen zone through daylight saving time", async () => {
    const notification = await claim({ clock: new Date("2026-11-01T07:30:00Z") });
    expect(notification?.day).toBe("2026-10-31");
    expect(notification?.request.expiresAt).toEqual(new Date("2026-11-01T08:00:00Z"));
  });

  it.each([null, target, { ...route, token: "invalid" }])("does not claim an unavailable, unenrolled or invalid push address", async (route) => {
    m.route.mockResolvedValue(route);
    expect(await claim()).toBeNull();
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("honors the feature gate and bounds the current 1v1 audience", async () => {
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "poster");
    expect(await claim()).toBeNull();
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    expect(await claim({ players: [...players, { ...players[0]!, memberId: "third" }] })).toBeNull();
    expect(m.route).not.toHaveBeenCalled();
  });

  it("revalidates route permission before sending and expires undelivered alerts", async () => {
    const notification = await claim();
    m.route.mockResolvedValue(null);
    await deliverGamePostNotification(notification);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.route).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        gameSessionId: "session-one",
        member: { suspendedAt: null, authRecords: { some: { model: "session", id: "session-one", expiresAt: { gt: clock } } } },
      }),
    }));
    expect(m.update.mock.calls[0]?.[0].data.payload.outcome).toBe("superseded");
    m.route.mockResolvedValue(target);
    vi.setSystemTime(new Date("2026-10-22T07:00:00Z"));
    await deliverGamePostNotification(notification);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("never releases an uncertain claim or fails a saved post when delivery or receipt storage fails", async () => {
    const notification = await claim();
    m.send.mockRejectedValue(new Error("synthetic uncertain delivery"));
    m.update.mockRejectedValue(new Error("synthetic database failure"));
    await expect(deliverGamePostNotification(notification)).resolves.toBeUndefined();
    expect(m.claim).toHaveBeenCalledTimes(1);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it("removes only the exact rejected device token", async () => {
    m.send.mockResolvedValue("unregistered");
    await deliverGamePostNotification(await claim());
    expect(m.forget).toHaveBeenCalledExactlyOnceWith("recipient", target.token);
  });
});
