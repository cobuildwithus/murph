import { Session } from "node:inspector/promises";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import type { HostedExecutionStructuredLogInput } from "@murphai/hosted-execution";

import { summarizeHostedContainerCpuProfile } from "./container-cpu-profile.ts";

const INTERVAL_MS = 10_000;
const SAMPLING_INTERVAL_US = 10_000;

// V8 samples independently of the JS event loop. A blocked main thread delays
// publication/rotation, but its stack samples remain in that longer window.
// No inspector port, raw profile file, or member-owned source is published.
export async function startHostedContainerCpuProfiler(input: {
  emit: (record: HostedExecutionStructuredLogInput) => void;
}): Promise<() => void> {
  const session = new Session();
  const delay = monitorEventLoopDelay({ resolution: 20 });
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const emit = (lifecycleStage: string, details: Record<string, unknown> = {}) => {
    input.emit({
      component: "container",
      details: { lifecycleStage, pid: process.pid, ...details },
      message: "Hosted container CPU profiler diagnostic.",
      phase: "wake.running",
      userId: null,
    });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    delay.disable();
    // Disconnecting our session stops its profiler, including on setup failure.
    session.disconnect();
  };
  try {
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: SAMPLING_INTERVAL_US });
    await session.post("Profiler.start");
    delay.enable();
  } catch {
    stop();
    emit("entrypoint-cpu-profiler-unavailable");
    return stop;
  }
  let windowStartedAt = Date.now();
  let windowStarted = performance.now();
  let cpu = process.cpuUsage();
  let utilization = performance.eventLoopUtilization();
  let lastEmitted = windowStarted;
  emit("entrypoint-cpu-profiler-started", {
    intervalMs: INTERVAL_MS,
    samplingIntervalUs: SAMPLING_INTERVAL_US,
  });
  const tick = async () => {
    try {
      const collectionStarted = performance.now();
      const { profile } = await session.post("Profiler.stop");
      if (stopped) return;
      const now = performance.now();
      const intervalMs = now - windowStarted;
      const cpuDelta = process.cpuUsage(cpu);
      const eventLoop = performance.eventLoopUtilization(utilization);
      const eventLoopMaxDelayMs = Math.max(0, delay.max / 1e6);
      const nodeCpuMs = (cpuDelta.user + cpuDelta.system) / 1000;
      const shouldEmit = nodeCpuMs >= 500 || eventLoopMaxDelayMs >= 100
        || now - lastEmitted >= 60_000;
      if (shouldEmit) {
        const summaryStarted = performance.now();
        const summary = summarizeHostedContainerCpuProfile(profile);
        const profileSummaryMs = performance.now() - summaryStarted;
        emit("entrypoint-cpu-profile", {
          ...summary,
          profileCollectionMs: Math.round(now - collectionStarted),
          profileSummaryMs: Math.round(profileSummaryMs),
          windowStartedAt: new Date(windowStartedAt).toISOString(),
          intervalMs: Math.round(intervalMs),
          nodeCpuMs: Math.round(nodeCpuMs),
          nodeCpuCores: Math.round(nodeCpuMs / intervalMs * 1000) / 1000,
          eventLoopMaxDelayMs: Math.round(eventLoopMaxDelayMs),
          eventLoopUtilization: Math.round(eventLoop.utilization * 1000) / 1000,
          heapUsedBytes: process.memoryUsage().heapUsed,
          rssBytes: process.memoryUsage().rss,
          samplingIntervalUs: SAMPLING_INTERVAL_US,
        });
        lastEmitted = now;
      }
      // Exclude summary/logging work from the next profile and counter window.
      delay.reset();
      await session.post("Profiler.start");
      if (stopped) return;
      windowStartedAt = Date.now();
      windowStarted = performance.now();
      cpu = process.cpuUsage();
      utilization = performance.eventLoopUtilization();
      timer = setTimeout(() => { void tick(); }, INTERVAL_MS);
      timer.unref();
    } catch {
      if (stopped) return;
      stop();
      emit("entrypoint-cpu-profiler-unavailable");
    }
  };
  timer = setTimeout(() => { void tick(); }, INTERVAL_MS);
  timer.unref();
  return stop;
}
