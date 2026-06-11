import { createHash } from "node:crypto";

import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";

const HOSTED_CONTAINER_CPU_WATCHDOG_INTERVAL_MS = 20_000;
const HOSTED_CONTAINER_CPU_WATCHDOG_EMIT_THRESHOLD_CORES = 0.5;
const HOSTED_CONTAINER_CPU_WATCHDOG_TOP_PROCESS_COUNT = 3;
// Linux exports per-process utime/stime in USER_HZ ticks; USER_HZ is 100 on the
// linux/amd64 hosted runner image. Diagnostics-only conversion, not authority.
const HOSTED_CONTAINER_CPU_WATCHDOG_TICKS_PER_SECOND = 100;
// Expected infrastructure process names in the hosted runner image. comm is
// process-controlled content (script basenames via shebang, PR_SET_NAME), so
// anything outside this vocabulary is logged as a stable non-reversible digest
// instead of raw text, mirroring the entrypoint's commandLineDigest precedent.
const HOSTED_CONTAINER_CPU_WATCHDOG_KNOWN_COMMS = new Set([
  "bash",
  "codex",
  "ffmpeg",
  "ffprobe",
  "file",
  "git",
  "node",
  "npm",
  "npx",
  "pdfinfo",
  "pdftoppm",
  "pdftotext",
  "pnpm",
  "python",
  "python3",
  "sh",
  "tini",
]);

interface HostedContainerCpuWatchdogDirectoryEntryLike {
  isDirectory(): boolean;
  name: string;
}

// Structural subset of the entrypoint's HostedContainerProcessApi so the
// watchdog stays decoupled from the entrypoint module graph.
export interface HostedContainerCpuWatchdogProcessApi {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<HostedContainerCpuWatchdogDirectoryEntryLike[]>;
}

interface HostedContainerCpuWatchdogProcessSample {
  comm: string;
  cpuTicks: number;
}

interface HostedContainerCpuWatchdogSample {
  cgroupUsageUsec: number | null;
  nrThrottled: number | null;
  perPid: Map<number, HostedContainerCpuWatchdogProcessSample>;
  sampledAtMs: number;
  throttledUsec: number | null;
}

// Always-on CPU attribution sampler for the hosted runner container. Samples
// cgroup CPU totals plus per-process tick counters on a fixed interval and
// emits one structured log per interval whose CPU usage crosses the threshold,
// naming the top processes by kernel comm name only (never command lines), so
// production CPU burns are attributable to a specific process. Diagnostics
// only: sampling failures never affect the runner.
export function startHostedContainerCpuWatchdog(input: {
  processApi: HostedContainerCpuWatchdogProcessApi;
}): () => void {
  let previous: HostedContainerCpuWatchdogSample | null = null;
  let sampling = false;
  const tick = async () => {
    // Skip overlapping ticks if /proc reads stall instead of queueing them.
    if (sampling) {
      return;
    }
    sampling = true;
    try {
      const current = await readHostedContainerCpuWatchdogSample(input.processApi);
      if (previous) {
        emitHostedContainerCpuWatchdogReport({ current, previous });
      } else {
        // One-time liveness signal: steady-state watchdog silence is otherwise
        // ambiguous between "no burns" and "sampler broken on this platform",
        // and cgroupCpuStatAvailable reports whether the per-pid fallback
        // below is live or dead code in the real fleet.
        emitHostedExecutionStructuredLog({
          component: "container",
          details: {
            cgroupCpuStatAvailable: current.cgroupUsageUsec !== null,
            lifecycleStage: "entrypoint-cpu-watchdog-started",
            sampledProcessCount: current.perPid.size,
          },
          message: "Hosted container CPU watchdog started.",
          phase: "wake.running",
          userId: null,
        });
      }
      previous = current;
    } catch {
      // Diagnostics-only: sampling failures must never affect the runner.
    } finally {
      sampling = false;
    }
  };
  // Seed the baseline immediately: boot-time burns are a primary target, and
  // waiting for the first setInterval firing would bake the whole boot window
  // into a t≈20s baseline, making the first reportable interval start there.
  void tick();
  const interval = setInterval(() => {
    void tick();
  }, HOSTED_CONTAINER_CPU_WATCHDOG_INTERVAL_MS);
  // The watchdog must never hold the process open during shutdown drain.
  interval.unref();
  return () => {
    clearInterval(interval);
  };
}

async function readHostedContainerCpuWatchdogSample(
  processApi: HostedContainerCpuWatchdogProcessApi,
): Promise<HostedContainerCpuWatchdogSample> {
  const cpuStat = parseHostedContainerCgroupCpuStat(
    await readOptionalCpuWatchdogText(processApi, "/sys/fs/cgroup/cpu.stat"),
  );
  const perPid = new Map<number, HostedContainerCpuWatchdogProcessSample>();
  let processEntries: HostedContainerCpuWatchdogDirectoryEntryLike[] = [];
  try {
    processEntries = await processApi.readdir("/proc");
  } catch {
    // Tolerate an unreadable /proc; cgroup totals still report on their own.
  }
  for (const entry of processEntries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
      continue;
    }
    const stat = await readOptionalCpuWatchdogText(processApi, `/proc/${entry.name}/stat`);
    const parsed = stat === null ? null : parseHostedContainerProcPidStat(stat);
    if (parsed) {
      perPid.set(Number.parseInt(entry.name, 10), parsed);
    }
  }
  return {
    cgroupUsageUsec: cpuStat.usageUsec,
    nrThrottled: cpuStat.nrThrottled,
    perPid,
    sampledAtMs: Date.now(),
    throttledUsec: cpuStat.throttledUsec,
  };
}

async function readOptionalCpuWatchdogText(
  processApi: HostedContainerCpuWatchdogProcessApi,
  filePath: string,
): Promise<string | null> {
  try {
    return await processApi.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseHostedContainerCgroupCpuStat(text: string | null): {
  nrThrottled: number | null;
  throttledUsec: number | null;
  usageUsec: number | null;
} {
  const values = new Map<string, number>();
  for (const line of (text ?? "").split("\n")) {
    const [key, raw] = line.trim().split(/\s+/u);
    if (!key || raw === undefined) {
      continue;
    }
    const value = Number.parseInt(raw, 10);
    if (Number.isSafeInteger(value) && value >= 0) {
      values.set(key, value);
    }
  }
  return {
    nrThrottled: values.get("nr_throttled") ?? null,
    throttledUsec: values.get("throttled_usec") ?? null,
    usageUsec: values.get("usage_usec") ?? null,
  };
}

// Parses `pid (comm) state ppid ... utime stime ...`. Only the comm name (the
// kernel-truncated executable name, never arguments or paths) is retained, so
// watchdog logs stay free of command-line content.
function parseHostedContainerProcPidStat(
  text: string,
): HostedContainerCpuWatchdogProcessSample | null {
  const commStart = text.indexOf("(");
  const commEnd = text.lastIndexOf(")");
  if (commStart === -1 || commEnd <= commStart) {
    return null;
  }
  const comm = text.slice(commStart + 1, commEnd);
  const rest = text.slice(commEnd + 1).trim().split(/\s+/u);
  // rest[0] is stat field 3 (state); utime/stime are stat fields 14 and 15.
  const utime = Number.parseInt(rest[11] ?? "", 10);
  const stime = Number.parseInt(rest[12] ?? "", 10);
  if (!Number.isSafeInteger(utime) || !Number.isSafeInteger(stime)) {
    return null;
  }
  return { comm, cpuTicks: utime + stime };
}

function emitHostedContainerCpuWatchdogReport(input: {
  current: HostedContainerCpuWatchdogSample;
  previous: HostedContainerCpuWatchdogSample;
}): void {
  const intervalMs = input.current.sampledAtMs - input.previous.sampledAtMs;
  if (intervalMs <= 0) {
    return;
  }
  const intervalSeconds = intervalMs / 1000;
  const topCpuProcesses: Array<{ comm: string; cpuCores: number; pid: number }> = [];
  let perPidTicksDelta = 0;
  for (const [pid, current] of input.current.perPid) {
    // A reused pid can report fewer cumulative ticks than its predecessor;
    // clamp to zero instead of letting it cancel real usage. A pid with no
    // previous sample started inside the interval, so its full cumulative
    // ticks are attributable to this interval.
    const deltaTicks = Math.max(
      0,
      current.cpuTicks - (input.previous.perPid.get(pid)?.cpuTicks ?? 0),
    );
    perPidTicksDelta += deltaTicks;
    if (deltaTicks > 0) {
      topCpuProcesses.push({
        comm: redactHostedContainerCpuWatchdogComm(current.comm),
        cpuCores: roundHostedContainerCpuCores(
          deltaTicks / HOSTED_CONTAINER_CPU_WATCHDOG_TICKS_PER_SECOND / intervalSeconds,
        ),
        pid,
      });
    }
  }
  const cgroupUsageUsecDelta =
    input.current.cgroupUsageUsec !== null && input.previous.cgroupUsageUsec !== null
      ? Math.max(0, input.current.cgroupUsageUsec - input.previous.cgroupUsageUsec)
      : null;
  const cpuCoresUsed = cgroupUsageUsecDelta !== null
    ? cgroupUsageUsecDelta / (intervalMs * 1000)
    : perPidTicksDelta / HOSTED_CONTAINER_CPU_WATCHDOG_TICKS_PER_SECOND / intervalSeconds;
  if (cpuCoresUsed < HOSTED_CONTAINER_CPU_WATCHDOG_EMIT_THRESHOLD_CORES) {
    return;
  }
  topCpuProcesses.sort((left, right) => right.cpuCores - left.cpuCores);
  emitHostedExecutionStructuredLog({
    component: "container",
    details: {
      // Processes that start and exit within one interval burn cgroup CPU but
      // appear in neither sample; the gap between cpuCoresUsed and this
      // per-pid-attributed total exposes that churn instead of hiding it.
      attributedCpuCores: roundHostedContainerCpuCores(
        perPidTicksDelta / HOSTED_CONTAINER_CPU_WATCHDOG_TICKS_PER_SECOND / intervalSeconds,
      ),
      cgroupNrThrottledDelta: subtractOptionalCpuWatchdogCounters(
        input.current.nrThrottled,
        input.previous.nrThrottled,
      ),
      cgroupThrottledUsecDelta: subtractOptionalCpuWatchdogCounters(
        input.current.throttledUsec,
        input.previous.throttledUsec,
      ),
      cgroupUsageUsecDelta,
      cpuCoresUsed: roundHostedContainerCpuCores(cpuCoresUsed),
      intervalMs,
      lifecycleStage: "entrypoint-cpu-watchdog",
      sampledProcessCount: input.current.perPid.size,
      topCpuProcesses: topCpuProcesses.slice(
        0,
        HOSTED_CONTAINER_CPU_WATCHDOG_TOP_PROCESS_COUNT,
      ),
    },
    message: "Hosted container CPU watchdog observed elevated CPU usage.",
    phase: "wake.running",
    userId: null,
  });
}

function redactHostedContainerCpuWatchdogComm(comm: string): string {
  if (HOSTED_CONTAINER_CPU_WATCHDOG_KNOWN_COMMS.has(comm)) {
    return comm;
  }
  return `other:${createHash("sha256").update(comm).digest("hex").slice(0, 8)}`;
}

function subtractOptionalCpuWatchdogCounters(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null) {
    return null;
  }
  return Math.max(0, current - previous);
}

function roundHostedContainerCpuCores(value: number): number {
  return Math.round(value * 1000) / 1000;
}
