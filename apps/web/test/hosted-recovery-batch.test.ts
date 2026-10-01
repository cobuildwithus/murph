import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runHostedRecoveryBatch } from "@/src/lib/hosted-orchestration/recovery-batch";

describe("bounded individual recovery jitter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("spreads 250 users across five seconds and keeps the same offsets on retry", async () => {
    const users = Array.from({ length: 250 }, (_, index) => ({
      userId: `synthetic-member-${index}`,
    }));
    async function record(items: typeof users) {
      const starts = new Map<string, number>();
      const start = performance.now();
      const batch = runHostedRecoveryBatch(items, async (item) => {
        starts.set(item.userId, performance.now() - start);
      }, true);
      expect(starts.size).toBe(0);
      await vi.runAllTimersAsync();
      await batch;
      return starts;
    }
    const first = await record(users);
    const retry = await record([...users].reverse());
    expect(first.size).toBe(250);
    expect(retry).toEqual(first);
    const times = [...first.values()];
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...times)).toBeLessThanOrEqual(5_000);
    expect(new Set(times).size).toBeGreaterThan(230);
    for (let second = 0; second < 5; second++) {
      const count = times.filter((time) => time >= second * 1_000 && time < (second + 1) * 1_000).length;
      expect(count).toBeGreaterThan(25);
      expect(count).toBeLessThan(80);
    }
  });

  it("caps slow work at five in flight and does not compound per-item delays", async () => {
    let active = 0;
    let peak = 0;
    let completed = 0;
    const startedAt = performance.now();
    const batch = runHostedRecoveryBatch(
      Array.from({ length: 250 }, (_, index) => ({ userId: `synthetic-slow-${index}` })),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        active--;
        completed++;
      },
      true,
    );
    await vi.runAllTimersAsync();
    await batch;
    expect(completed).toBe(250);
    expect(active).toBe(0);
    expect(peak).toBe(5);
    expect(performance.now() - startedAt).toBeLessThanOrEqual(15_000);
  });

  it("drains started siblings and preserves the first observed failure", async () => {
    const failure = new Error("synthetic recovery failure");
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    let settled = false;
    const batch = runHostedRecoveryBatch([
      { userId: "held" }, { userId: "fails" },
    ], async ({ userId }) => {
      started.push(userId);
      if (userId === "fails") throw failure;
      await held;
      throw new Error("later failure from the earlier slot");
    }, false);
    const observed = batch.catch((error: unknown) => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["held", "fails"]);
    expect(settled).toBe(false);
    release();
    expect(await observed).toBe(failure);
    expect(settled).toBe(true);
  });

  it("does no work or waiting for an empty batch", async () => {
    const worker = vi.fn();
    await runHostedRecoveryBatch([], worker, true);
    expect(worker).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
