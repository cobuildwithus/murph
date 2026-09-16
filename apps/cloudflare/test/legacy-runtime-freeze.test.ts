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
  it("quiesces only new starts, waits for admitted launches and preserves checkpoint callbacks across eviction", async () => {
    const h = harness();
    const launchStarted = deferred();
    const finishLaunch = deferred();
    const finishInvocation = deferred();
    const launch = h.freeze.runAdmission(async () => {
      launchStarted.resolve();
      await finishLaunch.promise;
      h.freeze.track(finishInvocation.promise);
    });
    await launchStarted.promise;
    let quiesced = false;
    const closing = h.freeze.quiesce("migration-synthetic").then(() => { quiesced = true; });
    await expect(h.freeze.runAdmission(async () => {})).rejects.toThrow("frozen");
    await expect(h.freeze.run(async () => "checkpoint callback")).resolves.toBe("checkpoint callback");
    expect(quiesced).toBe(false);
    finishLaunch.resolve();
    await launch;
    await closing;
    expect(await h.freeze.observe()).toEqual({ phase: "quiescing", pendingOperations: 1 });
    const evicted = new LegacyRuntimeFreeze(h.state);
    await expect(evicted.runAdmission(async () => {})).rejects.toThrow("frozen");
    await expect(evicted.run(async () => "completion callback")).resolves.toBe("completion callback");
    await expect(evicted.quiesce("another-migration")).rejects.toThrow("identity changed");
    await expect(evicted.quiesce("migration-synthetic")).resolves.toBe(true);
    await expect(h.freeze.freeze({ stop: async () => {}, drained: async () => true })).rejects.toThrow("identity changed");
    finishInvocation.resolve();
    expect(await h.freeze.freeze({ migrationId: "migration-synthetic", stop: async () => {}, drained: async () => true })).toBe(true);
    await expect(h.freeze.run(async () => {})).rejects.toThrow("frozen");
  });

  it("does not acknowledge quiescence before durable closure and retries a failed write without reopening admission", async () => {
    const h = harness();
    const stored = deferred();
    const storeStarted = deferred();
    const originalPut = h.state.storage.put;
    h.state.storage.put = vi.fn(async (key, value) => {
      storeStarted.resolve();
      await stored.promise;
      await originalPut(key, value);
    });
    let acknowledgements = 0;
    const first = h.freeze.quiesce("migration-synthetic").then(() => { acknowledgements++; });
    await storeStarted.promise;
    const duplicate = h.freeze.quiesce("migration-synthetic").then(() => { acknowledgements++; });
    await expect(h.freeze.runAdmission(async () => {})).rejects.toThrow("frozen");
    expect(acknowledgements).toBe(0);
    stored.resolve();
    await Promise.all([first, duplicate]);
    expect(acknowledgements).toBe(2);

    const failed = harness();
    const retryPut = failed.state.storage.put;
    failed.state.storage.put = vi.fn().mockRejectedValueOnce(new Error("synthetic storage failure")).mockImplementation(retryPut);
    await expect(failed.freeze.quiesce("migration-synthetic")).rejects.toThrow("storage failure");
    await expect(failed.freeze.runAdmission(async () => {})).rejects.toThrow("frozen");
    await failed.freeze.quiesce("migration-synthetic");
    const evicted = new LegacyRuntimeFreeze(failed.state);
    await expect(evicted.runAdmission(async () => {})).rejects.toThrow("frozen");
  });

  it("checks readiness after admitted launches settle and reopens only an unpersisted rejected barrier", async () => {
    const h = harness();
    const launched = deferred();
    const release = deferred();
    const launch = h.freeze.runAdmission(async () => { launched.resolve(); await release.promise; });
    await launched.promise;
    const ready = vi.fn(async () => false);
    const first = h.freeze.quiesce("migration-synthetic", ready);
    const duplicate = h.freeze.quiesce("migration-synthetic", ready);
    await expect(h.freeze.runAdmission(async () => {})).rejects.toThrow("frozen");
    expect(ready).not.toHaveBeenCalled();
    release.resolve(); await launch;
    expect(await first).toBe(false);
    expect(await duplicate).toBe(false);
    expect(ready).toHaveBeenCalledTimes(1);
    await expect(h.freeze.runAdmission(async () => "live")).resolves.toBe("live");
    expect(await h.state.storage.get("runtime-migration-freeze:v1")).toBeUndefined();
    expect(await h.freeze.quiesce("migration-synthetic", async () => true)).toBe(true);
    const mustNotReopen = vi.fn(async () => false);
    expect(await h.freeze.quiesce("migration-synthetic", mustNotReopen)).toBe(true);
    expect(mustNotReopen).not.toHaveBeenCalled();
    await expect(h.freeze.runAdmission(async () => {})).rejects.toThrow("frozen");
  });

  it("preserves old completed freeze records and rejects member freeze before quiescence", async () => {
    const h = harness();
    await expect(h.freeze.freeze({ migrationId: "migration-synthetic", stop: async () => {}, drained: async () => true })).rejects.toThrow("requires completed quiescence");
    await h.state.storage.put("runtime-migration-freeze:v1", { schema: "murph.legacy-runtime-freeze.v1", phase: "frozen" });
    const evicted = new LegacyRuntimeFreeze(h.state);
    await expect(evicted.assertFrozen()).resolves.toBeUndefined();
    await expect(evicted.runAdmission(async () => {})).rejects.toThrow("frozen");
    await expect(evicted.quiesce("migration-synthetic")).rejects.toThrow("identity changed");
  });

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
