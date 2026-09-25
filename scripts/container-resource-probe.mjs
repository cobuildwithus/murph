import { readFileSync } from "node:fs";
import { Agent, createServer, get } from "node:http";
import { createHistogram, monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

// Local benchmark preload: node --import ./scripts/container-resource-probe.mjs workload.mjs
// MURPH_CONTAINER_PROBE_HTTP_HEARTBEAT=1 adds a warmed loopback HTTP worker.
// MURPH_CONTAINER_PROBE_CGROUP=0 disables cgroup reads; *_CGROUP_ROOT overrides /sys/fs/cgroup.
// Resource measurements start after optional HTTP warmup. CPU includes probe threads.
// Cgroup peaks/counters cover the whole container lifetime, including fixtures and
// page cache. They are not Node heap peaks. HTTP measures this Node loop, not Murph delivery.
// HTTP requests are completion-paced, with a 100-ms pause AFTER each response.
// Percentiles are sampled RTT with coordinated omission, not fixed-arrival or member latency.

function readCgroupSnapshot() {
  const enabled = process.env.MURPH_CONTAINER_PROBE_CGROUP !== "0";
  const root = process.env.MURPH_CONTAINER_PROBE_CGROUP_ROOT ?? "/sys/fs/cgroup";
  const file = (name) => {
    if (!enabled) return null;
    try { return readFileSync(`${root}/${name}`, "utf8").trim() || null; }
    catch { return null; }
  };
  const number = (value) => {
    if (value === null || !/^\d+$/u.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const fields = (name) => {
    const value = file(name);
    if (value === null) return null;
    return Object.fromEntries(value.split("\n").map((line) => {
      const [key, raw] = line.trim().split(/\s+/u);
      return [key, number(raw ?? null)];
    }));
  };
  const memory = fields("memory.stat");
  return {
    cgroupEnabled: enabled,
    memoryPeakBytes: number(file("memory.peak")),
    memoryCurrentBytes: number(file("memory.current")),
    memoryAnonBytes: memory?.anon ?? null,
    memoryFileBytes: memory?.file ?? null,
    memoryKernelBytes: memory?.kernel ?? null,
    cpuStat: fields("cpu.stat"),
    memoryEvents: fields("memory.events"),
    cpuMax: file("cpu.max"),
    memoryMax: file("memory.max"),
    swapMax: file("memory.swap.max"),
    pidsPeak: number(file("pids.peak")),
  };
}

function percentileMs(histogram, percentile) {
  return histogram.count > 0 ? histogram.percentile(percentile) / 1e6 : null;
}

async function heartbeatWorker() {
  const histogram = createHistogram();
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  let stopped = false;
  parentPort.on("message", () => { stopped = true; });
  const request = () => new Promise((resolve, reject) => {
    const req = get(workerData.url, { agent }, (response) => {
      response.resume();
      response.once("error", reject);
      response.once("end", () => response.statusCode === 200 ? resolve() : reject(new Error("HTTP status")));
    });
    req.once("error", reject);
  });
  try {
    let completed = 0;
    while (!stopped) {
      const started = performance.now();
      await request();
      completed += 1;
      if (completed > 5) histogram.record(Math.max(1, Math.round((performance.now() - started) * 1e6)));
      if (completed === 5) parentPort.postMessage({ ready: true });
      if (!stopped) await delay(100);
    }
    parentPort.postMessage({
      benchmark: "http-heartbeat",
      warmupSamples: 5,
      sampling: "completion-paced",
      pauseAfterResponseMs: 100,
      samples: histogram.count,
      p50Ms: percentileMs(histogram, 50),
      p95Ms: percentileMs(histogram, 95),
      p99Ms: percentileMs(histogram, 99),
      maxMs: histogram.count > 0 ? histogram.max / 1e6 : null,
    });
  } catch {
    // Do not include arbitrary exception messages or local addresses in output.
    parentPort.postMessage({ benchmark: "http-heartbeat-failure", errorCode: "HTTP_HEARTBEAT_FAILED" });
  } finally {
    agent.destroy();
    parentPort.close();
  }
}

async function startHeartbeat() {
  const server = createServer((_request, response) => response.end("ok"));
  // Accepted sockets must not keep an otherwise finished workload alive.
  server.on("connection", (socket) => socket.unref());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const worker = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: {
      containerResourceProbeHeartbeat: true,
      url: `http://127.0.0.1:${server.address().port}/health`,
    },
  });
  let result;
  let resolveFinished;
  const finished = new Promise((resolve) => { resolveFinished = resolve; });
  try {
    await new Promise((resolve, reject) => {
      worker.on("message", (message) => {
        if (message.ready) resolve();
        else {
          result = message;
          reject(new Error("HTTP heartbeat warmup failed"));
        }
      });
      worker.on("error", () => {
        result = { benchmark: "http-heartbeat-failure", errorCode: "HTTP_HEARTBEAT_WORKER_FAILED" };
        reject(new Error("HTTP heartbeat worker failed"));
      });
      worker.once("exit", () => {
        reject(new Error("HTTP heartbeat worker exited before warmup"));
        resolveFinished();
      });
    });
  } catch (error) {
    server.close();
    server.closeAllConnections();
    await worker.terminate();
    throw error;
  }
  server.unref();
  worker.unref();
  return async () => {
    worker.ref();
    worker.postMessage("stop");
    await finished;
    server.close();
    server.closeAllConnections();
    return result ?? { benchmark: "http-heartbeat-failure", errorCode: "HTTP_HEARTBEAT_NO_RESULT" };
  };
}

async function startProbe() {
  const httpHeartbeatEnabled = process.env.MURPH_CONTAINER_PROBE_HTTP_HEARTBEAT === "1";
  const stopHeartbeat = httpHeartbeatEnabled ? await startHeartbeat() : null;
  const cgroupStart = readCgroupSnapshot();
  const started = performance.now();
  const cpuStart = process.cpuUsage();
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let timerLagMaxMs = 0;
  let expected = started + 10;
  const sampleTimerLag = () => {
    const now = performance.now();
    timerLagMaxMs = Math.max(timerLagMaxMs, now - expected);
    expected = now + 10;
  };
  const timer = setInterval(sampleTimerLag, 10);
  timer.unref();
  let emitted = false;
  const emitResources = () => {
    if (emitted) return;
    emitted = true;
    sampleTimerLag();
    clearInterval(timer);
    loop.disable();
    const cgroup = readCgroupSnapshot();
    const cpuStatDelta = cgroup.cpuStat && cgroupStart.cpuStat
      ? Object.fromEntries(Object.entries(cgroup.cpuStat).map(([key, value]) => {
        const previous = cgroupStart.cpuStat[key];
        return [key, value !== null && previous != null && value >= previous ? value - previous : null];
      }))
      : null;
    console.log(JSON.stringify({
      benchmark: "resources",
      wallMs: performance.now() - started,
      processCpu: process.cpuUsage(cpuStart),
      ...cgroup,
      cpuStatDelta,
      processMemory: process.memoryUsage(),
      eventLoopSamples: loop.count,
      eventLoopP95Ms: percentileMs(loop, 95),
      eventLoopP99Ms: percentileMs(loop, 99),
      eventLoopMaxMs: loop.count > 0 ? loop.max / 1e6 : null,
      timerLagMaxMs,
      httpHeartbeatEnabled,
      node: process.version,
      arch: process.arch,
    }));
  };
  process.once("beforeExit", async () => {
    emitResources();
    if (stopHeartbeat) console.log(JSON.stringify(await stopHeartbeat()));
  });
  // Explicit process.exit() cannot flush HTTP; retain the synchronous resource snapshot.
  process.once("exit", emitResources);
}

if (!isMainThread && workerData?.containerResourceProbeHeartbeat === true) {
  await heartbeatWorker();
} else if (isMainThread) {
  await startProbe();
}
