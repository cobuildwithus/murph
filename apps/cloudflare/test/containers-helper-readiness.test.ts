import { DatabaseSync } from "node:sqlite";
import { Container } from "@cloudflare/containers";
import { afterEach, describe, expect, it, vi } from "vitest";

const runnerPort = 8_080;
const productionStartToListenMs = 1_650;
const productionStickyProbeReleaseMs = 4_425;
const readyProbeResponseMs = 50;
const runnerPollIntervalMs = 250;
const boundedProbeTimeoutMs = 1_500;

interface ProbeStats {
  abortedProbeCount: number;
  healthyAtMs: number | null;
  inFlightProbeCount: number;
  maxInFlightProbeCount: number;
  onErrorCount: number;
  onStartCount: number;
  probeStartedAtMs: number[];
  settledProbeCount: number;
  startCount: number;
  stateTransitions: string[];
}

interface ProbeHarness {
  abortContext: ReturnType<typeof vi.fn>;
  crash(exitCode?: number): void;
  runner: Container;
  stats: ProbeStats;
}

describe("patched Cloudflare container readiness probes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["TimeoutError", "AbortError"])("returns HTTP 500 when a native wake fetch rejects with %s", async (name) => {
    const runner: Container = Object.create(Container.prototype);
    const nativeFetch = vi.fn(async () => {
      throw new DOMException("Synthetic wake transport cancellation", name);
    });
    const decrementInflight = vi.fn();
    Object.defineProperties(runner, {
      container: { value: { running: true, getTcpPort: () => ({ fetch: nativeFetch }) } },
      ctx: { value: { id: "synthetic-container" } },
      defaultPort: { value: runnerPort },
      decrementInflight: { value: decrementInflight },
      inflightRequests: { value: 0, writable: true },
      renewActivityTimeout: { value: vi.fn() },
      state: { value: { getState: async () => ({ status: "healthy" }) } },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // Exercise the installed, patched SDK rather than the runner's transport
      // double: the wrapper hides a thrown timeout inside an HTTP response.
      const response = await runner.containerFetch("http://container/internal/runtime-wake", {
        method: "POST",
      });
      expect(response.status).toBe(500);
      expect(response.headers.get("x-runtime-wake-accepted")).toBeNull();
      expect(nativeFetch).toHaveBeenCalledOnce();
      expect(decrementInflight).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("performs SDK readiness before a wake when a running shell has non-healthy cached status", async () => {
    const runner: Container = Object.create(Container.prototype);
    const nativeFetch = vi.fn(async () => {
      const response = new Response(null, { status: 204 });
      Object.defineProperty(response, "webSocket", { value: null });
      return response;
    });
    Object.defineProperties(runner, {
      container: { value: { running: true, getTcpPort: () => ({ fetch: nativeFetch }) } },
      defaultPort: { value: runnerPort },
      decrementInflight: { value: vi.fn() },
      inflightRequests: { value: 0, writable: true },
      renewActivityTimeout: { value: vi.fn() },
      state: { value: { getState: async () => ({ status: "running" }) } },
    });
    let releaseReadiness!: () => void;
    const readiness = vi.spyOn(runner, "startAndWaitForPorts").mockImplementation(
      () => new Promise<void>((resolve) => { releaseReadiness = resolve; }),
    );
    const wake = runner.containerFetch("http://container/internal/runtime-wake", { method: "POST" });
    await vi.waitFor(() => expect(readiness).toHaveBeenCalledOnce());
    expect(nativeFetch).not.toHaveBeenCalled();
    releaseReadiness();
    await expect(wake).resolves.toMatchObject({ status: 204 });
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("uses native destruction completion independently of cached SDK status", async () => {
    let finishNativeDestroy: () => void = () => { throw new Error("Destroy not started"); };
    const nativeDestroy = vi.fn(() => new Promise<void>((resolve) => {
      finishNativeDestroy = resolve;
    }));
    const runner: Container = Object.create(Container.prototype);
    Object.defineProperty(runner, "container", { value: { destroy: nativeDestroy } });
    const cachedStatus = vi.spyOn(runner, "getState")
      .mockRejectedValue(new Error("Cached state unavailable"));
    let completed = false;
    const destruction = runner.destroy().then(() => { completed = true; });
    await Promise.resolve();
    expect(nativeDestroy).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    finishNativeDestroy();
    await destruction;
    expect(completed).toBe(true);
    expect(cachedStatus).not.toHaveBeenCalled();
  });

  it("cuts the production-shaped sticky-probe path by more than two seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));

    const baseline = await runTimingVariant();
    vi.setSystemTime(new Date("2026-08-30T12:01:00.000Z"));
    const bounded = await runTimingVariant(boundedProbeTimeoutMs);

    expect(baseline.stats.healthyAtMs).toBe(4_475);
    expect(baseline.stats.abortedProbeCount).toBe(0);
    expect(baseline.stats.probeStartedAtMs).toEqual([0, 4_425]);

    expect(bounded.stats.healthyAtMs).toBe(1_850);
    expect(bounded.stats.abortedProbeCount).toBe(1);
    expect(bounded.stats.probeStartedAtMs).toEqual([
      0,
      1_750,
      1_800,
    ]);
    expect(
      (baseline.stats.healthyAtMs ?? 0) - (bounded.stats.healthyAtMs ?? 0),
    ).toBeGreaterThan(2_000);

    for (const result of [baseline, bounded]) {
      expect(result.stats.startCount).toBe(1);
      expect(result.stats.onStartCount).toBe(1);
      expect(result.stats.onErrorCount).toBe(0);
      expect(result.stats.maxInFlightProbeCount).toBe(1);
      expect(result.stats.inFlightProbeCount).toBe(0);
      expect(result.stats.settledProbeCount).toBe(
        result.stats.probeStartedAtMs.length,
      );
      expect(result.stats.stateTransitions).toEqual([
        "stopped",
        "running",
        "healthy",
      ]);
      await expect(result.runner.getState()).resolves.toMatchObject({
        status: "healthy",
      });
      expect(result.abortContext).not.toHaveBeenCalled();
    }
  });

  it("applies the bounded probe to the direct SDK start path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:01:30.000Z"));
    const harness = await createProbeHarness({
      listeningAtMs: productionStartToListenMs,
      stickyProbeReleaseMs: productionStickyProbeReleaseMs,
    });
    const started = harness.runner.start(undefined, {
      portProbeTimeoutMS: boundedProbeTimeoutMs,
      portToCheck: runnerPort,
      retries: 32,
      waitInterval: runnerPollIntervalMs,
    });

    await vi.advanceTimersByTimeAsync(8_000);
    await started;

    expect(harness.stats.probeStartedAtMs).toEqual([0, 1_750]);
    expect(harness.stats.abortedProbeCount).toBe(1);
    expect(harness.stats.maxInFlightProbeCount).toBe(1);
    expect(harness.stats.inFlightProbeCount).toBe(0);
    expect(harness.stats.startCount).toBe(1);
    expect(harness.stats.onStartCount).toBe(1);
    expect(harness.stats.onErrorCount).toBe(0);
    expect(harness.stats.stateTransitions).toEqual(["running"]);
    await expect(harness.runner.getState()).resolves.toMatchObject({
      status: "running",
    });
  });

  it("bounds a sticky port-confirmation probe after the initial start probe succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:01:40.000Z"));

    const runVariant = async (
      portProbeTimeoutMS?: number,
    ): Promise<ProbeHarness> => {
      const harness = await createProbeHarness({
        listeningAtMs: 0,
        stickyProbeNumbers: [2],
        stickyProbeReleaseMs: productionStickyProbeReleaseMs,
      });
      const readiness = harness.runner.startAndWaitForPorts({
        cancellationOptions: {
          instanceGetTimeoutMS: 8_000,
          ...(portProbeTimeoutMS === undefined ? {} : { portProbeTimeoutMS }),
          portReadyTimeoutMS: 8_000,
          waitInterval: runnerPollIntervalMs,
        },
        ports: runnerPort,
      });

      await vi.advanceTimersByTimeAsync(8_000);
      await readiness;
      return harness;
    };

    const baseline = await runVariant();
    vi.setSystemTime(new Date("2026-08-30T12:01:50.000Z"));
    const bounded = await runVariant(boundedProbeTimeoutMs);

    expect(baseline.stats.healthyAtMs).toBe(4_425);
    expect(baseline.stats.probeStartedAtMs).toEqual([0, 50]);
    expect(bounded.stats.healthyAtMs).toBe(1_850);
    expect(bounded.stats.probeStartedAtMs).toEqual([0, 50, 1_800]);
    expect(bounded.stats.abortedProbeCount).toBe(1);
    expect(bounded.stats.maxInFlightProbeCount).toBe(1);
    expect(bounded.stats.inFlightProbeCount).toBe(0);
    expect(bounded.stats.settledProbeCount).toBe(3);
    expect(bounded.stats.onStartCount).toBe(1);
    expect(bounded.stats.stateTransitions).toEqual([
      "stopped",
      "running",
      "healthy",
    ]);
  });

  it("removes each per-probe listener forwarded from the outer abort signal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:01:45.000Z"));
    const harness = await createProbeHarness({
      listeningAtMs: productionStartToListenMs,
      stickyProbeReleaseMs: productionStickyProbeReleaseMs,
    });
    const abortController = new AbortController();
    const addEventListener = vi.spyOn(
      abortController.signal,
      "addEventListener",
    );
    const removeEventListener = vi.spyOn(
      abortController.signal,
      "removeEventListener",
    );
    const readiness = harness.runner.startAndWaitForPorts({
      cancellationOptions: {
        abort: abortController.signal,
        instanceGetTimeoutMS: 8_000,
        portProbeTimeoutMS: boundedProbeTimeoutMs,
        portReadyTimeoutMS: 8_000,
        waitInterval: runnerPollIntervalMs,
      },
      ports: runnerPort,
    });

    await vi.advanceTimersByTimeAsync(8_000);
    await readiness;

    const forwardedListenerCount = addEventListener.mock.calls.filter(
      ([eventName, _listener, options]) =>
        eventName === "abort"
        && typeof options === "object"
        && options !== null
        && "once" in options
        && options.once === true,
    ).length;
    expect(forwardedListenerCount).toBeGreaterThan(2);
    expect(removeEventListener.mock.calls.filter(
      ([eventName]) => eventName === "abort",
    )).toHaveLength(forwardedListenerCount);
  });

  it("propagates caller abort without a retry or late healthy transition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:02:00.000Z"));
    const harness = await createProbeHarness({
      listeningAtMs: 10_000,
      stickyProbeReleaseMs: 10_000,
    });
    const abortController = new AbortController();
    const readiness = harness.runner.startAndWaitForPorts({
      cancellationOptions: {
        abort: abortController.signal,
        instanceGetTimeoutMS: 8_000,
        portProbeTimeoutMS: boundedProbeTimeoutMs,
        portReadyTimeoutMS: 8_000,
        waitInterval: runnerPollIntervalMs,
      },
      ports: runnerPort,
    });
    const rejection = expect(readiness).rejects.toThrow(
      "Aborted waiting for container to start",
    );

    setTimeout(() => abortController.abort(new DOMException("Timed out", "TimeoutError")), 200);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;

    expect(harness.stats.startCount).toBe(1);
    expect(harness.stats.probeStartedAtMs).toEqual([0]);
    expect(harness.stats.abortedProbeCount).toBe(1);
    expect(harness.stats.maxInFlightProbeCount).toBe(1);
    expect(harness.stats.inFlightProbeCount).toBe(0);
    expect(harness.stats.onStartCount).toBe(0);
    expect(harness.stats.stateTransitions).not.toContain("healthy");
    expect(harness.abortContext).not.toHaveBeenCalled();
  });

  it("preserves true-crash handling without publishing healthy state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:03:00.000Z"));
    const harness = await createProbeHarness({
      crashAtMs: 100,
      listeningAtMs: 10_000,
      stickyProbeReleaseMs: 10_000,
    });
    const readiness = harness.runner.startAndWaitForPorts({
      cancellationOptions: {
        instanceGetTimeoutMS: 8_000,
        portProbeTimeoutMS: boundedProbeTimeoutMs,
        portReadyTimeoutMS: 8_000,
        waitInterval: runnerPollIntervalMs,
      },
      ports: runnerPort,
    });
    const rejection = expect(readiness).rejects.toThrow(
      "container exited with unexpected exit code: 17",
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;

    expect(harness.stats.startCount).toBe(1);
    expect(harness.stats.onErrorCount).toBe(1);
    expect(harness.stats.onStartCount).toBe(0);
    expect(harness.stats.maxInFlightProbeCount).toBe(1);
    expect(harness.stats.inFlightProbeCount).toBe(0);
    expect(harness.stats.stateTransitions).not.toContain("healthy");
    await expect(harness.runner.getState()).resolves.toMatchObject({
      status: "stopped",
    });
    expect(harness.abortContext).not.toHaveBeenCalled();
  });
});

async function runTimingVariant(
  portProbeTimeoutMS?: number,
): Promise<ProbeHarness> {
  const harness = await createProbeHarness({
    listeningAtMs: productionStartToListenMs,
    stickyProbeReleaseMs: productionStickyProbeReleaseMs,
  });
  const readiness = harness.runner.startAndWaitForPorts({
    cancellationOptions: {
      instanceGetTimeoutMS: 8_000,
      ...(portProbeTimeoutMS === undefined ? {} : { portProbeTimeoutMS }),
      portReadyTimeoutMS: 8_000,
      waitInterval: runnerPollIntervalMs,
    },
    ports: runnerPort,
  });

  await vi.advanceTimersByTimeAsync(8_000);
  await readiness;
  return harness;
}

async function createProbeHarness(options: {
  crashAtMs?: number;
  listeningAtMs: number;
  stickyProbeNumbers?: readonly number[];
  stickyProbeReleaseMs: number;
}): Promise<ProbeHarness> {
  const startedAtMs = Date.now();
  const state = new Map<string, unknown>();
  const constructorOperations: Promise<unknown>[] = [];
  const stats: ProbeStats = {
    abortedProbeCount: 0,
    healthyAtMs: null,
    inFlightProbeCount: 0,
    maxInFlightProbeCount: 0,
    onErrorCount: 0,
    onStartCount: 0,
    probeStartedAtMs: [],
    settledProbeCount: 0,
    startCount: 0,
    stateTransitions: [],
  };
  let running = false;
  let crashScheduled = false;
  let rejectMonitor: (error: Error) => void = () => undefined;
  const monitor = new Promise<void>((_resolve, reject) => {
    rejectMonitor = reject;
  });
  // Workerd owns this RPC promise outside the Node event loop. Attach a test-only
  // observer so its intentional rejection is not reported as an unhandled Node promise
  // before the helper inspects it on the next readiness iteration.
  void monitor.catch(() => undefined);

  const elapsedMs = (): number => Date.now() - startedAtMs;
  const crash = (exitCode = 17): void => {
    running = false;
    rejectMonitor(new Error(`container exited with unexpected exit code: ${exitCode}`));
  };
  const containerBinding = {
    destroy: vi.fn(async () => {
      crash(137);
    }),
    get running() {
      return running;
    },
    getTcpPort: vi.fn((_port: number) => ({
      fetch: async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const probeStartedAtMs = elapsedMs();
        stats.probeStartedAtMs.push(probeStartedAtMs);
        const probeNumber = stats.probeStartedAtMs.length;
        stats.inFlightProbeCount += 1;
        stats.maxInFlightProbeCount = Math.max(
          stats.maxInFlightProbeCount,
          stats.inFlightProbeCount,
        );

        return await new Promise<Response>((resolve, reject) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const signal = init?.signal;
          const finish = (callback: () => void): void => {
            if (settled) {
              return;
            }
            settled = true;
            if (timer !== null) {
              clearTimeout(timer);
            }
            signal?.removeEventListener("abort", onAbort);
            stats.inFlightProbeCount -= 1;
            stats.settledProbeCount += 1;
            callback();
          };
          const onAbort = (): void => {
            stats.abortedProbeCount += 1;
            finish(() => reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("The operation was aborted", "AbortError"),
            ));
          };

          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });

          if (
            options.crashAtMs !== undefined
            && !crashScheduled
            && probeStartedAtMs < options.crashAtMs
          ) {
            crashScheduled = true;
            timer = setTimeout(() => {
              crash();
              finish(() => reject(new Error("the container is not listening")));
            }, options.crashAtMs - probeStartedAtMs);
            return;
          }

          const useStickyRelease = options.stickyProbeNumbers?.includes(
            probeNumber,
          ) ?? probeStartedAtMs < options.listeningAtMs;
          const completesAtMs = useStickyRelease
            ? options.stickyProbeReleaseMs
            : probeStartedAtMs + readyProbeResponseMs;
          timer = setTimeout(() => {
            finish(() => resolve(new Response(null, { status: 204 })));
          }, Math.max(0, completesAtMs - elapsedMs()));
        });
      },
    })),
    monitor: vi.fn(() => monitor),
    signal: vi.fn((_signal: number) => undefined),
    start: vi.fn((_config: unknown) => {
      running = true;
      stats.startCount += 1;
    }),
  };
  const storage = {
    delete: vi.fn(async (key: string) => {
      state.delete(key);
    }),
    get: vi.fn(async (key: string) => state.get(key)),
    kv: {
      get: vi.fn((key: string) => state.get(key)),
      put: vi.fn((key: string, value: unknown) => {
        state.set(key, value);
      }),
    },
    put: vi.fn(async (key: string, value: unknown) => {
      state.set(key, value);
      if (
        value
        && typeof value === "object"
        && "status" in value
        && typeof value.status === "string"
      ) {
        stats.stateTransitions.push(value.status);
        if (value.status === "healthy") {
          stats.healthyAtMs = elapsedMs();
        }
      }
    }),
    setAlarm: vi.fn(async (_atMs: number) => undefined),
    sql: {
      exec: vi.fn((_query: string, ..._values: readonly unknown[]) => []),
    },
    sync: vi.fn(async () => undefined),
  };
  const abortContext = vi.fn();
  const context = {
    abort: abortContext,
    blockConcurrencyWhile: vi.fn((operation: () => Promise<unknown>) => {
      const result = Promise.resolve().then(operation);
      constructorOperations.push(result);
      return result;
    }),
    container: containerBinding,
    storage,
  };

  class ProbeContainer extends Container {
    defaultPort = runnerPort;
    requiredPorts = [runnerPort];

    override onError(_error: unknown): void {
      stats.onErrorCount += 1;
    }

    override onStart(): void {
      stats.onStartCount += 1;
    }
  }

  const runner = new ProbeContainer(context as never, {});
  await Promise.all(constructorOperations);

  return {
    abortContext,
    crash,
    runner,
    stats,
  };
}

// This suite exercises the installed patched SDK's SQL, scheduling, generic
// request accounting, and alarm owner. The adapter supplies storage/native I/O,
// not an imitation deadline or alarm algorithm.
describe("native container deadline schedules", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("runs a persisted deadline despite generic RPC activity and inflight requests", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    vi.setSystemTime(now);
    const database = new DatabaseSync(":memory:");
    let releaseRequest!: (response: Response) => void;
    const responsePending = new Promise<Response>((resolve) => { releaseRequest = resolve; });
    const callback = vi.fn(async () => { native.running = false; });
    const { native, runner } = await createNativeScheduleHarness(database, callback, () => responsePending);
    try {
      await runner.schedule(new Date(now + 600_000), "onActivityExpired", null);
      native.running = true;
      const request = runner.containerFetch("http://container/internal/runtime-wake");
      await vi.waitFor(() => expect(native.getTcpPort).toHaveBeenCalled());
      vi.setSystemTime(now + 600_000);
      runner.renewActivityTimeout();
      await runner.alarm();
      expect(callback).toHaveBeenCalledOnce();
      expect(await runner.listSchedules("onActivityExpired")).toEqual([]);
      const response = new Response(null, { status: 204 });
      Object.defineProperty(response, "webSocket", { value: null });
      releaseRequest(response);
      await expect(request).resolves.toMatchObject({ status: 204 });
      expect(await runner.listSchedules("onActivityExpired")).toEqual([]);
    } finally {
      releaseRequest(new Response(null, { status: 204 }));
      database.close();
    }
  });

  it("preserves a pre-armed recovery task when the SDK consumes a throwing callback", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    vi.setSystemTime(now);
    const database = new DatabaseSync(":memory:");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runner } = await createNativeScheduleHarness(database, async () => {
      runner.deleteSchedules("onActivityExpired");
      await runner.schedule(new Date(now + 60_000), "onActivityExpired", null);
      throw new Error("synthetic health/storage failure after prearming");
    });
    try {
      const original = await runner.schedule(new Date(now), "onActivityExpired", null);
      await runner.alarm();
      expect(await runner.getSchedule(original.taskId)).toBeUndefined();
      expect(await runner.listSchedules("onActivityExpired")).toMatchObject([{ time: (now + 60_000) / 1_000 }]);
    } finally { database.close(); }
  });

  it("keeps tasks through object replacement and uses the preceding callback name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    vi.setSystemTime(now);
    const database = new DatabaseSync(":memory:");
    try {
      const original = await createNativeScheduleHarness(database, async () => undefined);
      const task = await original.runner.schedule(new Date(now + 600_000), "onActivityExpired", null);
      vi.setSystemTime(now + 600_000);
      const callback = vi.fn(async () => undefined);
      const replacement = await createNativeScheduleHarness(database, callback);
      expect(await replacement.runner.listSchedules("onActivityExpired")).toEqual([task]);
      await replacement.runner.alarm();
      expect(callback).toHaveBeenCalledOnce();
      expect(await replacement.runner.listSchedules("onActivityExpired")).toEqual([]);
    } finally { database.close(); }
  });
});

async function createNativeScheduleHarness(
  database: DatabaseSync,
  onExpiry: () => Promise<void>,
  fetchResponse: () => Promise<Response> = async () => new Response(null, { status: 204 }),
) {
  const values = new Map<string, unknown>([["__CF_CONTAINER_STATE", { status: "healthy", lastChange: Date.now() }]]);
  const constructorOperations: Promise<unknown>[] = [];
  const native = {
    running: false,
    getTcpPort: vi.fn(() => ({ fetch: fetchResponse })),
  };
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => { values.set(key, value); },
    kv: { get: (key: string) => values.get(key), put: (key: string, value: unknown) => { values.set(key, value); } },
    setAlarm: vi.fn(async (_at: number) => undefined),
    deleteAlarm: vi.fn(async () => undefined),
    sync: async () => undefined,
    sql: {
      exec: (query: string, ...bindings: (string | number | boolean | null)[]) =>
        database.prepare(query).all(...bindings.map((value) => typeof value === "boolean" ? Number(value) : value)),
    },
  };
  class ScheduledContainer extends Container {
    override sleepAfter = "10m";
    override defaultPort = runnerPort;
    override async onActivityExpired(): Promise<void> { await onExpiry(); }
  }
  const runner = new ScheduledContainer({
    container: native,
    storage,
    blockConcurrencyWhile(operation: () => Promise<unknown>) {
      const promise = Promise.resolve().then(operation);
      constructorOperations.push(promise);
      return promise;
    },
  } as never, {});
  await Promise.all(constructorOperations);
  return { native, runner };
}
