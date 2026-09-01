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

  it("applies the bounded probe to the direct start path used by shell prewarm", async () => {
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
