import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ids: vi.fn(), games: vi.fn(), entries: vi.fn(), tasks: vi.fn(), states: vi.fn(), open: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  $queryRaw: mocks.ids, game: { findMany: mocks.games }, gameEntry: { findMany: mocks.entries },
  gameProgressTaskMeasure: { findMany: mocks.tasks }, gameProgressMeasure: { findMany: mocks.states },
}) }));
vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({ openHostedUserSecureBoxStrings: mocks.open }));

import { openGameTexts } from "../src/lib/game/crypto";
import { openProgressMany } from "../src/lib/game/progress/crypto";
import { readFriendGameSeries } from "../src/lib/game/progress/friend-games";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ids.mockResolvedValue([{ id: "synthetic-game", windowed: true }]);
  mocks.games.mockResolvedValue([{
    id: "synthetic-game", wordsOwnerMemberId: "viewer",
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] },
    termsWordsEncrypted: JSON.stringify({ v: 1, versions: [{ n: 1, defaultTask: "18 squats each day", tasks: [], stakes: [] }] }),
    players: [{ memberId: "viewer", seat: 0, dayOne: new Date("2026-11-01T00:00:00Z") }],
  }]);
  mocks.entries.mockResolvedValue([{
    id: "synthetic-entry", gameId: "synthetic-game", memberId: "viewer", dayIndex: 2, attempt: 1,
    kind: "reps", payloadEncrypted: JSON.stringify({ exercise: "squats", count: 18, reps: [] }),
  }]);
  mocks.tasks.mockResolvedValue([]);
  mocks.states.mockResolvedValue([]);
  mocks.open.mockImplementation(async ({ entries }: { entries: { value: string }[] }) => entries.map(entry => entry.value));
});

const scope = { viewer: "viewer", period: { from: "2026-11-01", to: "2026-11-30" } };

describe("Friends series request cancellation", () => {
  it("passes the request signal through every decrypt batch and preserves a complete series", async () => {
    const signal = new AbortController().signal;
    const result = await readFriendGameSeries(["viewer"], undefined, scope, signal);
    expect(result.amounts.get("viewer")).toEqual([{ measureId: "squats.reps", date: "2026-11-03", amount: 18 }]);
    expect(mocks.open).toHaveBeenCalledTimes(3);
    expect(mocks.open.mock.calls.every(([input]) => input.signal === signal)).toBe(true);
  });

  it("rejects an already-cancelled request before querying", async () => {
    const controller = new AbortController();
    const reason = new Error("Synthetic request cancelled");
    controller.abort(reason);
    await expect(readFriendGameSeries(["viewer"], undefined, scope, controller.signal)).rejects.toBe(reason);
    expect(mocks.ids).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each(["ids", "games", "entries", "tasks", "states"] as const)("stops after cancellation during the %s read", async stage => {
    const controller = new AbortController();
    const reason = new Error("Synthetic request cancelled");
    const read = mocks[stage].getMockImplementation()!;
    mocks[stage].mockImplementationOnce(async (...args: unknown[]) => {
      const result = await read(...args);
      controller.abort(reason);
      return result;
    });
    await expect(readFriendGameSeries(["viewer"], undefined, scope, controller.signal)).rejects.toBe(reason);
    const next = { ids: mocks.games, games: mocks.entries, entries: mocks.open, tasks: mocks.states, states: null }[stage];
    if (next) expect(next).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledTimes(stage === "tasks" ? 1 : stage === "states" ? 2 : 0);
  });

  it.each([1, 2, 3])("rejects cancellation during decrypt batch %i without returning partial data", async batch => {
    const controller = new AbortController();
    const reason = new Error("Synthetic request cancelled");
    let opened = 0;
    mocks.open.mockImplementation(async ({ entries }: { entries: { value: string }[] }) => {
      if (++opened === batch) controller.abort(reason);
      return entries.map(entry => entry.value);
    });
    await expect(readFriendGameSeries(["viewer"], undefined, scope, controller.signal)).rejects.toBe(reason);
    expect(mocks.open).toHaveBeenCalledTimes(batch);
  });

  it("keeps abort rejection for empty decrypt batches", async () => {
    const controller = new AbortController();
    const reason = new Error("Synthetic request cancelled");
    controller.abort(reason);
    await expect(openGameTexts([], controller.signal)).rejects.toBe(reason);
    await expect(openProgressMany([], false, controller.signal)).rejects.toBe(reason);
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
