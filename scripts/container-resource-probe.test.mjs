import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const probe = new URL("./container-resource-probe.mjs", import.meta.url).href;

function run(source, env = {}) {
  return execFileSync(process.execPath, ["--import", probe, "--input-type=module", "-e", source], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_CONTAINER_PROBE_CGROUP: "0",
      MURPH_CONTAINER_PROBE_HTTP_HEARTBEAT: "0",
      ...env,
    },
  }).trim().split("\n").map((line) => JSON.parse(line));
}

test("preload emits once, preserves application output, and detects a blocked timer", () => {
  const rows = run(`
    await new Promise(resolve => setTimeout(resolve, 30));
    const until = performance.now() + 60;
    while (performance.now() < until) {}
    console.log(JSON.stringify({ benchmark: "workload", passed: true }));
  `);
  assert.deepEqual(rows.map((row) => row.benchmark), ["workload", "resources"]);
  const result = rows[1];
  assert.equal(result.cgroupEnabled, false);
  assert.equal(result.memoryPeakBytes, null);
  assert.equal(result.cpuStat, null);
  assert.equal(result.cpuStatDelta, null);
  assert.equal(result.httpHeartbeatEnabled, false);
  assert.ok(result.wallMs >= 90);
  assert.ok(result.processCpu.user + result.processCpu.system > 0);
  assert.ok(result.processMemory.rss > 0);
  assert.ok(result.timerLagMaxMs >= 40);
  assert.ok(result.eventLoopSamples > 0);
  assert.ok(result.eventLoopP95Ms <= result.eventLoopP99Ms);
});

test("missing cgroup files remain unavailable, while supplied counters retain their units", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "container-resource-probe-"));
  try {
    const env = { MURPH_CONTAINER_PROBE_CGROUP: "1", MURPH_CONTAINER_PROBE_CGROUP_ROOT: root };
    const missing = run("", env)[0];
    assert.equal(missing.memoryPeakBytes, null);
    assert.equal(missing.memoryMax, null);
    assert.equal(missing.memoryEvents, null);
    await Promise.all(Object.entries({
      "memory.peak": "4096",
      "memory.current": "2048",
      "memory.stat": "anon 1024\nfile 512\nkernel 256\n",
      "memory.events": "oom 0\noom_kill 0\n",
      "memory.max": "max",
      "cpu.max": "100000 100000",
      "cpu.stat": "usage_usec 100\nnr_throttled 2\nthrottled_usec 25\n",
      "memory.swap.max": "0",
      "pids.peak": "4",
    }).map(([name, value]) => writeFile(path.join(root, name), value)));
    const measured = run(`
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.MURPH_CONTAINER_PROBE_CGROUP_ROOT + "/cpu.stat",
        "usage_usec 175\\nnr_throttled 3\\nthrottled_usec 40\\n");
    `, env)[0];
    assert.equal(measured.memoryPeakBytes, 4096);
    assert.equal(measured.memoryCurrentBytes, 2048);
    assert.equal(measured.memoryAnonBytes, 1024);
    assert.equal(measured.memoryFileBytes, 512);
    assert.equal(measured.memoryKernelBytes, 256);
    assert.equal(measured.memoryMax, "max");
    assert.equal(measured.cpuMax, "100000 100000");
    assert.equal(measured.swapMax, "0");
    assert.equal(measured.pidsPeak, 4);
    assert.deepEqual(measured.memoryEvents, { oom: 0, oom_kill: 0 });
    assert.deepEqual(measured.cpuStatDelta, { usage_usec: 75, nr_throttled: 1, throttled_usec: 15 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a warmed independent HTTP heartbeat observes foreground blocking and exits naturally", () => {
  const rows = run(`
    await new Promise(resolve => setTimeout(resolve, 120));
    const until = performance.now() + 220;
    while (performance.now() < until) {}
    await new Promise(resolve => setTimeout(resolve, 30));
  `, { MURPH_CONTAINER_PROBE_HTTP_HEARTBEAT: "1" });
  assert.deepEqual(rows.map((row) => row.benchmark), ["resources", "http-heartbeat"]);
  const [resources, heartbeat] = rows;
  assert.equal(resources.httpHeartbeatEnabled, true);
  assert.equal(heartbeat.warmupSamples, 5);
  assert.equal(heartbeat.sampling, "completion-paced");
  assert.equal(heartbeat.pauseAfterResponseMs, 100);
  assert.ok(heartbeat.samples > 0);
  assert.ok(heartbeat.p50Ms <= heartbeat.p95Ms);
  assert.ok(heartbeat.p95Ms <= heartbeat.p99Ms);
  assert.ok(heartbeat.p99Ms <= heartbeat.maxMs);
  assert.ok(heartbeat.maxMs >= 80);
});

test("explicit process exit retains one resource snapshot without waiting for HTTP", () => {
  const rows = run("process.exit(0)");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].benchmark, "resources");
});
