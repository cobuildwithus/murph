import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

// The watchdog imports exactly one symbol from hosted-execution.
vi.mock("@murphai/hosted-execution", () => ({
  emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
}));

import {
  startHostedContainerCpuWatchdog,
  type HostedContainerCpuWatchdogProcessApi,
} from "../src/container-cpu-watchdog.ts";

const WATCHDOG_INTERVAL_MS = 20_000;

interface FakeProcessState {
  cpuStatText: string | null;
  pidStats: Map<string, string | null>;
}

function createFakeProcessApi(state: FakeProcessState): HostedContainerCpuWatchdogProcessApi {
  return {
    async readFile(path) {
      if (path === "/sys/fs/cgroup/cpu.stat") {
        if (state.cpuStatText === null) {
          throw new Error("cpu.stat unavailable");
        }
        return state.cpuStatText;
      }
      const match = /^\/proc\/(\d+)\/stat$/u.exec(path);
      const statText = match ? state.pidStats.get(match[1] ?? "") : undefined;
      if (statText === undefined || statText === null) {
        // Mirrors a process exiting between readdir and read: normal churn
        // that must not mark the scan incomplete.
        throw Object.assign(new Error(`unreadable ${path}`), { code: "ENOENT" });
      }
      return statText;
    },
    async readdir(path) {
      if (path !== "/proc") {
        throw new Error(`unexpected readdir ${path}`);
      }
      return [...state.pidStats.keys(), "self", "sys"].map((name) => ({
        isDirectory: () => true,
        name,
      }));
    },
  };
}

function cpuStatText(input: {
  nrThrottled?: number;
  throttledUsec?: number;
  usageUsec: number;
}): string {
  return [
    `usage_usec ${input.usageUsec}`,
    "user_usec 0",
    "system_usec 0",
    "nr_periods 0",
    `nr_throttled ${input.nrThrottled ?? 0}`,
    `throttled_usec ${input.throttledUsec ?? 0}`,
    "",
  ].join("\n");
}

function pidStatText(input: {
  comm: string;
  pid: number;
  startTime?: string;
  totalTicks: number;
}): string {
  const tail = Array.from({ length: 38 }, () => "0");
  // The explicit `S` below is stat field 3, so tail[10]/tail[11] land at stat
  // fields 14 (utime) and 15 (stime); split the ticks across both. tail[18]
  // is stat field 22 (starttime), the pid-reuse discriminator.
  const utime = Math.floor(input.totalTicks / 2);
  const stime = input.totalTicks - utime;
  tail[10] = String(utime);
  tail[11] = String(stime);
  tail[18] = input.startTime ?? "5000";
  return `${input.pid} (${input.comm}) S ${tail.join(" ")}`;
}

function emitsWithLifecycleStage(lifecycleStage: string): Array<Record<string, unknown>> {
  return mocks.emitHostedExecutionStructuredLog.mock.calls
    .map(([entry]) => entry as Record<string, unknown>)
    .filter((entry) =>
      (entry.details as Record<string, unknown> | undefined)?.lifecycleStage
        === lifecycleStage,
    );
}

function watchdogEmits(): Array<Record<string, unknown>> {
  return emitsWithLifecycleStage("entrypoint-cpu-watchdog");
}

function startedEmits(): Array<Record<string, unknown>> {
  return emitsWithLifecycleStage("entrypoint-cpu-watchdog-started");
}

// Starts the watchdog and settles its immediate baseline seed at the current
// fake-timer timestamp so every test interval is a deterministic 20s.
async function startWatchdog(
  input: Parameters<typeof startHostedContainerCpuWatchdog>[0],
): Promise<() => void> {
  const stop = startHostedContainerCpuWatchdog(input);
  await vi.advanceTimersByTimeAsync(0);
  return stop;
}

describe("startHostedContainerCpuWatchdog", () => {
  let stopWatchdog: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.emitHostedExecutionStructuredLog.mockReset();
  });

  afterEach(() => {
    stopWatchdog?.();
    stopWatchdog = null;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("attributes elevated CPU to the top processes by comm name", async () => {
    vi.stubEnv("HOSTED_LOG_FINGERPRINT_SECRET", "test-secret");
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map([
        ["1", pidStatText({ comm: "tini", pid: 1, totalTicks: 10 })],
        ["12", pidStatText({ comm: "node", pid: 12, totalTicks: 500 })],
        ["45", pidStatText({ comm: "codex (smoke)", pid: 45, totalTicks: 100 })],
      ]),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    expect(watchdogEmits()).toHaveLength(0);

    state.cpuStatText = cpuStatText({
      nrThrottled: 3,
      throttledUsec: 250_000,
      usageUsec: 16_000_000,
    });
    state.pidStats.set("12", pidStatText({ comm: "node", pid: 12, totalTicks: 700 }));
    state.pidStats.set("45", pidStatText({ comm: "codex (smoke)", pid: 45, totalTicks: 1_400 }));
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    const emits = watchdogEmits();
    expect(emits).toHaveLength(1);
    const details = emits[0]?.details as Record<string, unknown>;
    // 15,000,000 usec over 20s = 0.75 cores.
    expect(details.cpuCoresUsed).toBe(0.75);
    expect(details.cgroupUsageUsecDelta).toBe(15_000_000);
    expect(details.cgroupNrThrottledDelta).toBe(3);
    expect(details.cgroupThrottledUsecDelta).toBe(250_000);
    expect(details.intervalMs).toBe(WATCHDOG_INTERVAL_MS);
    // 1,500 total per-pid ticks = 0.75 cores fully attributed (no short-lived
    // process churn in this fixture, so it matches the cgroup figure).
    expect(details.attributedCpuCores).toBe(0.75);
    expect(details.topCpuProcesses).toEqual([
      // 1,300 ticks at 100 Hz over 20s = 0.65 cores. The comm parse keeps the
      // inner parens, and the non-allowlisted name is emitted as a stable
      // keyed HMAC label instead of raw process-controlled text:
      // hmac-sha256("test-secret", "codex (smoke)") truncated to 16 hex.
      { comm: "other:30d556de684e009a", cpuCores: 0.65, pid: 45 },
      // 200 ticks = 0.1 cores; allowlisted infrastructure comm passes through.
      { comm: "node", cpuCores: 0.1, pid: 12 },
    ]);
  });

  it("collapses unknown comms into one bucket without the fingerprint secret", async () => {
    const state: FakeProcessState = {
      cpuStatText: null,
      pidStats: new Map([
        ["45", pidStatText({ comm: "check_health.sh", pid: 45, totalTicks: 100 })],
      ]),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    state.pidStats.set(
      "45",
      pidStatText({ comm: "check_health.sh", pid: 45, totalTicks: 1_400 }),
    );
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    const emits = watchdogEmits();
    expect(emits).toHaveLength(1);
    // No keyed secret configured: no comm-derived identifier at all.
    expect((emits[0]?.details as Record<string, unknown>).topCpuProcesses).toEqual([
      { comm: "other", cpuCores: 0.65, pid: 45 },
    ]);
  });

  it("emits a one-time started signal reporting cgroup availability", async () => {
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map([
        ["12", pidStatText({ comm: "node", pid: 12, totalTicks: 100 })],
      ]),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    const started = startedEmits();
    expect(started).toHaveLength(1);
    expect(started[0]?.details).toMatchObject({
      cgroupCpuStatAvailable: true,
      sampledProcessCount: 1,
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS * 3);
    expect(startedEmits()).toHaveLength(1);
  });

  it("stays silent while CPU usage is below the threshold", async () => {
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map([
        ["12", pidStatText({ comm: "node", pid: 12, totalTicks: 500 })],
      ]),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    state.cpuStatText = cpuStatText({ usageUsec: 2_000_000 });
    state.pidStats.set("12", pidStatText({ comm: "node", pid: 12, totalTicks: 520 }));
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    expect(watchdogEmits()).toHaveLength(0);
  });

  it("falls back to per-process ticks when cgroup cpu.stat is unreadable", async () => {
    const state: FakeProcessState = {
      cpuStatText: null,
      pidStats: new Map([
        ["12", pidStatText({ comm: "node", pid: 12, totalTicks: 100 })],
        ["77", "not a valid stat line"],
      ]),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    // The started signal reports the fallback as live on this "platform".
    expect(startedEmits()[0]?.details).toMatchObject({ cgroupCpuStatAvailable: false });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    // 1,300 fresh ticks at 100 Hz over 20s = 0.65 cores from /proc alone.
    state.pidStats.set("12", pidStatText({ comm: "node", pid: 12, totalTicks: 1_400 }));
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    const emits = watchdogEmits();
    expect(emits).toHaveLength(1);
    const details = emits[0]?.details as Record<string, unknown>;
    expect(details.cgroupUsageUsecDelta).toBeNull();
    expect(details.cpuCoresUsed).toBe(0.65);
    expect(details.topCpuProcesses).toEqual([
      { comm: "node", cpuCores: 0.65, pid: 12 },
    ]);
  });

  it("stops sampling after the returned stop function runs", async () => {
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map(),
    };
    const processApi = createFakeProcessApi(state);
    const readdirSpy = vi.spyOn(processApi, "readdir");
    stopWatchdog = await startWatchdog({
      processApi,
    });

    // One readdir from the immediate baseline seed plus one interval tick.
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    expect(readdirSpy).toHaveBeenCalledTimes(2);

    stopWatchdog();
    stopWatchdog = null;
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS * 3);
    expect(readdirSpy).toHaveBeenCalledTimes(2);
  });

  it("clamps reused-pid tick regressions to zero instead of negative usage", async () => {
    const state: FakeProcessState = {
      cpuStatText: null,
      pidStats: new Map([
        ["12", pidStatText({ comm: "node", pid: 12, totalTicks: 2_000 })],
      ]),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    // Pid 12 was reused: the successor's cumulative ticks regressed from
    // 2,000 to 50. Without the clamp, the -1,950 delta would cancel pid 13's
    // real 1,400-tick (0.65-core) burn and suppress the report entirely.
    state.pidStats.set("12", pidStatText({ comm: "node", pid: 12, totalTicks: 50 }));
    state.pidStats.set("13", pidStatText({ comm: "node", pid: 13, totalTicks: 1_400 }));
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    const emits = watchdogEmits();
    expect(emits).toHaveLength(1);
    const details = emits[0]?.details as Record<string, unknown>;
    // 1,400 fresh ticks at 100 Hz over 20s = 0.7 cores; the reused pid
    // contributes exactly zero and is excluded from attribution.
    expect(details.cpuCoresUsed).toBe(0.7);
    expect(details.attributedCpuCores).toBe(0.7);
    expect(details.topCpuProcesses).toEqual([
      { comm: "node", cpuCores: 0.7, pid: 13 },
    ]);
  });

  it("attributes full ticks to a pid reused by a fresh process", async () => {
    const state: FakeProcessState = {
      cpuStatText: null,
      pidStats: new Map([
        ["12", pidStatText({ comm: "node", pid: 12, startTime: "100", totalTicks: 9_000 })],
      ]),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    // Same pid, new starttime: a fresh process whose 1,400 cumulative ticks
    // (0.7 cores) all landed inside the interval, even though it reports
    // fewer ticks than its predecessor did.
    state.pidStats.set(
      "12",
      pidStatText({ comm: "node", pid: 12, startTime: "2200", totalTicks: 1_400 }),
    );
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    const emits = watchdogEmits();
    expect(emits).toHaveLength(1);
    const details = emits[0]?.details as Record<string, unknown>;
    expect(details.cpuCoresUsed).toBe(0.7);
    expect(details.topCpuProcesses).toEqual([
      { comm: "node", cpuCores: 0.7, pid: 12 },
    ]);
  });

  it("never attributes lifetime ticks to pids missed by an incomplete scan", async () => {
    // Pid 12 has 30,000 lifetime ticks (300s of CPU): if the failed first
    // /proc scan were trusted as "complete and empty", the next interval
    // would attribute all of it (a false 15 cores) to this interval.
    let procReadable = false;
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map([
        ["12", pidStatText({ comm: "node", pid: 12, totalTicks: 30_000 })],
      ]),
    };
    const inner = createFakeProcessApi(state);
    const processApi: HostedContainerCpuWatchdogProcessApi = {
      readFile: (path, encoding) => inner.readFile(path, encoding),
      readdir: (path) =>
        procReadable ? inner.readdir(path) : Promise.reject(new Error("EACCES: /proc")),
    };
    stopWatchdog = await startWatchdog({ processApi });

    procReadable = true;
    state.cpuStatText = cpuStatText({ usageUsec: 16_000_000 });
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    const emits = watchdogEmits();
    expect(emits).toHaveLength(1);
    const details = emits[0]?.details as Record<string, unknown>;
    // The cgroup truth still reports, with the unknown-history pid excluded
    // from attribution rather than misreported.
    expect(details.cpuCoresUsed).toBe(0.75);
    expect(details.attributedCpuCores).toBe(0);
    expect(details.topCpuProcesses).toEqual([]);
  });

  it("stays silent in fallback mode after an incomplete scan", async () => {
    // The same missed-pid scenario without cgroup totals: with nothing
    // trustworthy to report, the interval must not produce a false alarm.
    let procReadable = false;
    const state: FakeProcessState = {
      cpuStatText: null,
      pidStats: new Map([
        ["12", pidStatText({ comm: "node", pid: 12, totalTicks: 30_000 })],
      ]),
    };
    const inner = createFakeProcessApi(state);
    const processApi: HostedContainerCpuWatchdogProcessApi = {
      readFile: (path, encoding) => inner.readFile(path, encoding),
      readdir: (path) =>
        procReadable ? inner.readdir(path) : Promise.reject(new Error("EACCES: /proc")),
    };
    stopWatchdog = await startWatchdog({ processApi });

    procReadable = true;
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    expect(watchdogEmits()).toHaveLength(0);
  });

  it("reports from cgroup totals alone when /proc is unreadable", async () => {
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map(),
    };
    const processApi = createFakeProcessApi(state);
    processApi.readdir = () => Promise.reject(new Error("EACCES: /proc"));
    stopWatchdog = await startWatchdog({
      processApi,
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    state.cpuStatText = cpuStatText({ usageUsec: 17_000_000 });
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    const emits = watchdogEmits();
    expect(emits).toHaveLength(1);
    const details = emits[0]?.details as Record<string, unknown>;
    // 16,000,000 usec over 20s = 0.8 cores from the cgroup counters alone;
    // none of it is per-pid attributable, and the gap is explicit.
    expect(details.cpuCoresUsed).toBe(0.8);
    expect(details.attributedCpuCores).toBe(0);
    expect(details.sampledProcessCount).toBe(0);
    expect(details.topCpuProcesses).toEqual([]);
  });

  it("skips overlapping ticks while a sample is still in flight", async () => {
    let cpuStatReads = 0;
    // Reassigned synchronously by the first read's promise executor.
    let releaseFirstRead: (text: string) => void = () => {};
    const processApi: HostedContainerCpuWatchdogProcessApi = {
      readFile(path) {
        if (path !== "/sys/fs/cgroup/cpu.stat") {
          return Promise.reject(new Error(`unexpected read ${path}`));
        }
        cpuStatReads += 1;
        if (cpuStatReads === 1) {
          return new Promise((resolve) => {
            releaseFirstRead = resolve;
          });
        }
        return Promise.resolve(cpuStatText({ usageUsec: 1_000_000 }));
      },
      readdir: () => Promise.resolve([]),
    };
    stopWatchdog = await startWatchdog({
      processApi,
    });

    // The first tick starts and stalls on the cgroup read.
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    expect(cpuStatReads).toBe(1);

    // The next interval fires while the sample is in flight and is skipped
    // rather than queued behind it.
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    expect(cpuStatReads).toBe(1);

    // Once the stalled read resolves, later ticks sample again.
    releaseFirstRead(cpuStatText({ usageUsec: 0 }));
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    expect(cpuStatReads).toBe(2);
  });

  it("skips the report when the wall clock did not advance between samples", async () => {
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map(),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    // Step the wall clock back so the next sample lands on the same
    // timestamp; without the intervalMs guard the 29M-usec delta below would
    // divide by zero and emit cpuCoresUsed: Infinity.
    vi.setSystemTime(Date.now() - WATCHDOG_INTERVAL_MS);
    state.cpuStatText = cpuStatText({ usageUsec: 30_000_000 });
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    expect(watchdogEmits()).toHaveLength(0);
  });

  it("swallows a throwing emit and keeps reporting on later intervals", async () => {
    const state: FakeProcessState = {
      cpuStatText: cpuStatText({ usageUsec: 1_000_000 }),
      pidStats: new Map(),
    };
    stopWatchdog = await startWatchdog({
      processApi: createFakeProcessApi(state),
    });
    mocks.emitHostedExecutionStructuredLog.mockImplementationOnce(() => {
      throw new Error("log sink unavailable");
    });

    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    state.cpuStatText = cpuStatText({ usageUsec: 21_000_000 });
    // This interval's emit throws inside the tick; an escaped rejection from
    // the interval callback would fail the test as an unhandled error.
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);
    state.cpuStatText = cpuStatText({ usageUsec: 41_000_000 });
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    // The throwing call is still recorded by the mock; the follow-up interval
    // proves the watchdog kept sampling and reporting after the failure.
    const emits = watchdogEmits();
    expect(emits).toHaveLength(2);
    expect((emits[1]?.details as Record<string, unknown>).cpuCoresUsed).toBe(1);
  });

  it("does not emit from a sample still in flight when stopped", async () => {
    let releaseRead: (text: string) => void = () => {};
    const processApi: HostedContainerCpuWatchdogProcessApi = {
      readFile: () =>
        new Promise((resolve) => {
          releaseRead = resolve;
        }),
      readdir: () => Promise.resolve([]),
    };
    stopWatchdog = await startWatchdog({ processApi });

    // The seed sample is still stalled on its cgroup read when stop runs.
    stopWatchdog();
    stopWatchdog = null;
    releaseRead(cpuStatText({ usageUsec: 1_000_000 }));
    await vi.advanceTimersByTimeAsync(WATCHDOG_INTERVAL_MS);

    // Even the one-time started signal is suppressed after stop.
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("unrefs the sampling interval so it never holds the process open", () => {
    vi.useRealTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      stopWatchdog = startHostedContainerCpuWatchdog({
        processApi: createFakeProcessApi({ cpuStatText: null, pidStats: new Map() }),
      });
      const interval = setIntervalSpy.mock.results[0]?.value as NodeJS.Timeout;
      expect(interval.hasRef()).toBe(false);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
