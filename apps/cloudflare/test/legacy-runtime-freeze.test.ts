import { describe, expect, it, vi } from "vitest";
import { LegacyRuntimeFreeze } from "../src/user-runner/legacy-runtime-freeze.ts";
import type { DurableObjectStateLike } from "../src/user-runner/types.ts";

function harness() {
  const values = new Map<string, unknown>();
  const state: DurableObjectStateLike = { waitUntil: vi.fn(), storage: {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => { values.set(key, value); },
    delete: async key => values.delete(key), getAlarm: async () => null, setAlarm: vi.fn(), deleteAlarm: vi.fn(),
  } };
  return { state, freeze: new LegacyRuntimeFreeze(state) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

describe("finite legacy runtime freeze", () => {
  it("blocks new work and waits for admitted RPCs and background writes before export", async () => {
    const h = harness();
    const started = deferred();
    const rpcDone = deferred();
    const backgroundDone = deferred();
    const work = h.freeze.run(async () => {
      started.resolve();
      await rpcDone.promise;
      h.freeze.track(backgroundDone.promise);
    });
    await started.promise;
    const stopped = deferred();
    const freezing = h.freeze.freeze({ stop: async () => stopped.resolve(), drained: async () => true });
    await stopped.promise;
    await expect(h.freeze.run(async () => {})).rejects.toThrow("frozen");
    await expect(h.freeze.assertFrozen()).rejects.toThrow("completed freeze");
    rpcDone.resolve();
    await work;
    await expect(h.freeze.assertFrozen()).rejects.toThrow("completed freeze");
    backgroundDone.resolve();
    expect(await freezing).toBe(true);
    await expect(h.freeze.assertFrozen()).resolves.toBeUndefined();
    expect(h.state.storage.deleteAlarm).toHaveBeenCalledTimes(1);
    const evicted = new LegacyRuntimeFreeze(h.state);
    await expect(evicted.run(async () => {})).rejects.toThrow("frozen");
    await expect(evicted.assertFrozen()).resolves.toBeUndefined();
  });

  it.each([false, true])("stops a target admitted while the first stop was in flight (uncertain final stop: %s)", async uncertain => {
    const h = harness();
    const started = deferred();
    const launch = deferred();
    const firstStopStarted = deferred();
    const firstStopDone = deferred();
    let target: string | null = null;
    const work = h.freeze.run(async () => {
      started.resolve();
      await launch.promise;
      target = "synthetic-reserved-slot";
    });
    await started.promise;
    const stop = vi.fn(async () => {
      if (stop.mock.calls.length === 1) {
        firstStopStarted.resolve();
        await firstStopDone.promise;
      } else if (uncertain) {
        throw new Error("synthetic final stop uncertain");
      } else {
        target = null;
      }
    });
    const freezing = h.freeze.freeze({ stop, drained: async () => true });
    const result = Promise.allSettled([freezing]);
    await firstStopStarted.promise;
    launch.resolve();
    await work;
    firstStopDone.resolve();
    await result;
    expect(stop).toHaveBeenCalledTimes(2);
    if (uncertain) {
      await expect(freezing).rejects.toThrow("final stop uncertain");
      await expect(h.freeze.assertFrozen()).rejects.toThrow("completed freeze");
      expect(h.state.storage.deleteAlarm).not.toHaveBeenCalled();
      const evicted = new LegacyRuntimeFreeze(h.state);
      expect(await evicted.freeze({ stop: async () => { target = null; }, drained: async () => true })).toBe(true);
    } else {
      expect(await freezing).toBe(true);
      await expect(h.freeze.assertFrozen()).resolves.toBeUndefined();
    }
    expect(target).toBeNull();
  });

  it("retains the closed barrier across uncertain stop and capability drains", async () => {
    const h = harness();
    await expect(h.freeze.freeze({ stop: async () => { throw new Error("synthetic uncertain stop"); }, drained: async () => true })).rejects.toThrow("uncertain stop");
    const evicted = new LegacyRuntimeFreeze(h.state);
    await expect(evicted.run(async () => {})).rejects.toThrow("frozen");
    expect(await evicted.freeze({ stop: async () => {}, drained: async () => false })).toBe(false);
    await expect(evicted.assertFrozen()).rejects.toThrow("completed freeze");
    expect(h.state.storage.deleteAlarm).not.toHaveBeenCalled();
    expect(await evicted.freeze({ stop: async () => {}, drained: async () => true })).toBe(true);
  });
});
