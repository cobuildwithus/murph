import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  createDeviceBatchImportSession,
  importDeviceBatch,
  initializeVault,
  inspectCanonicalWriteLock,
  readEvent,
  type DeviceBatchImportTiming,
} from "../src/index.ts";

// Run in a disposable Docker container: its writable layer owns the synthetic
// vault. No provider credentials, remote calls, or production records are used.
const seedCount = Number(process.env.MURPH_BENCH_EVENTS ?? 8_000);
assert.ok(Number.isSafeInteger(seedCount) && seedCount >= 12 && seedCount <= 50_000);
const timeZones = (process.env.MURPH_BENCH_TIME_ZONES ?? "UTC").split(",");
const liveSignal = process.env.MURPH_BENCH_SIGNAL === "1"
  ? new AbortController().signal
  : undefined;
const abortAfterMs = Number(process.env.MURPH_BENCH_ABORT_AFTER_MS ?? 0);
assert.ok(Number.isSafeInteger(abortAfterMs) && abortAfterMs >= 0 && abortAfterMs <= 10_000);
console.log(JSON.stringify({ scenario: "module-ready", wallMs: performance.now() }));
const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "device-import-bench-"));
await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });

function observation(index: number, version: string, value = index) {
  return {
    kind: "observation" as const,
    occurredAt: new Date(Date.UTC(2025, 0, 1) + index * 60_000).toISOString(),
    recordedAt: version,
    timeZone: timeZones[index % timeZones.length],
    title: "Synthetic benchmark observation",
    externalRef: {
      system: "synthetic",
      resourceType: "metric",
      resourceId: `sample-${index}`,
      version,
    },
    fields: { metric: "synthetic-metric", unit: "count", value },
  };
}

const originalVersion = "2026-01-01T00:00:00.000Z";
const seedStarted = performance.now();
const seedCpu = process.cpuUsage();
// Construct large histories through admitted batches, preserving the normal
// 8,000-event scenario as one import. The ingest receipt caps each batch.
const seed: { events: Awaited<ReturnType<typeof importDeviceBatch>>["events"] } = { events: [] };
const seedBatchSize = 8_000;
const seedShardPaths = new Set<string>();
for (let offset = 0; offset < seedCount; offset += seedBatchSize) {
  const count = Math.min(seedBatchSize, seedCount - offset);
  const batch = await importDeviceBatch({
    vaultRoot,
    provider: "synthetic",
    importedAt: originalVersion,
    events: Array.from({ length: count }, (_, index) => observation(offset + index, originalVersion)),
  }, { signal: liveSignal });
  assert.equal(batch.events.length, count);
  seed.events.push(...batch.events);
  for (const shardPath of batch.eventShardPaths) seedShardPaths.add(shardPath);
}
const seedUsed = process.cpuUsage(seedCpu);
assert.equal(seed.events.length, seedCount);
console.log(JSON.stringify({
  scenario: "seed", seedCount, seedBatches: Math.ceil(seedCount / seedBatchSize), timeZones, wallMs: performance.now() - seedStarted,
  cpuMs: (seedUsed.user + seedUsed.system) / 1_000,
}));

if (abortAfterMs > 0) {
  const before = await Promise.all([...seedShardPaths].map((shardPath) =>
    readFile(path.join(vaultRoot, shardPath))));
  const controller = new AbortController();
  const reason = new Error("Synthetic foreground preemption");
  const importSession = createDeviceBatchImportSession();
  const request = {
    vaultRoot,
    provider: "synthetic",
    importedAt: originalVersion,
    events: [observation(seedCount + 24, originalVersion)],
  };
  const started = performance.now();
  let abortedAt: number | undefined;
  const timer = setTimeout(() => {
    abortedAt = performance.now();
    controller.abort(reason);
  }, abortAfterMs);
  try {
    await assert.rejects(importDeviceBatch(request, {
      session: importSession,
      signal: controller.signal,
    }), (error) => error === reason);
  } finally {
    clearTimeout(timer);
  }
  const settledAt = performance.now();
  assert.ok(abortedAt !== undefined);
  assert.equal((await inspectCanonicalWriteLock(vaultRoot)).state, "unlocked");
  const after = await Promise.all([...seedShardPaths].map((shardPath) =>
    readFile(path.join(vaultRoot, shardPath))));
  assert.deepEqual(after, before);
  const resumed = await importDeviceBatch(request, { session: importSession, signal: liveSignal });
  const replay = await importDeviceBatch(request, { session: importSession, signal: liveSignal });
  assert.equal(resumed.applied, true);
  assert.equal(replay.applied, false);
  assert.equal(replay.events[0]?.id, resumed.events[0]?.id);
  console.log(JSON.stringify({
    scenario: "foreground-preemption", seedCount, abortAfterMs,
    requestedAbortDelayMs: abortedAt - started,
    settledAfterAbortMs: settledAt - abortedAt,
    wallMs: settledAt - started,
    lockReleased: true, unchangedSeedLedger: true, retryAndReplayPassed: true,
  }));
}

const profilePath = process.env.MURPH_BENCH_PROFILE;
const profiler = profilePath ? new Session() : null;
if (profiler) {
  profiler.connect();
  await profiler.post("Profiler.enable");
  await profiler.post("Profiler.start");
}
const session = createDeviceBatchImportSession();
const scenarios = ["new", "disjoint", "replay", "correction"] as const;
for (const scenario of scenarios) {
  const version = scenario === "correction"
    ? "2026-01-02T00:00:00.000Z"
    : originalVersion;
  const offset = scenario === "new" || scenario === "replay"
    ? seedCount
    : scenario === "disjoint" ? seedCount + 12 : 0;
  const started = performance.now();
  const cpu = process.cpuUsage();
  let timing: DeviceBatchImportTiming | undefined;
  const result = await importDeviceBatch({
    vaultRoot,
    provider: "synthetic",
    importedAt: version,
    events: Array.from({ length: 12 }, (_, index) => observation(offset + index, version,
      scenario === "correction" ? index + 100 : offset + index)),
  }, { session, signal: liveSignal, onTiming: (value) => { timing = value; } });
  const used = process.cpuUsage(cpu);
  assert.equal(result.applied, scenario !== "replay");
  assert.equal(result.events.length, 12);
  if (scenario === "correction") {
    assert.ok(result.events.every((event) => event.lifecycle?.revision === 2));
    assert.deepEqual(result.events.map((event) => event.id), seed.events.slice(0, 12).map((event) => event.id));
  }
  console.log(JSON.stringify({
    scenario, seedCount, liveSignal: liveSignal !== undefined, wallMs: performance.now() - started,
    cpuMs: (used.user + used.system) / 1_000,
    maxRssKiB: process.resourceUsage().maxRSS, timing,
    // Compare semantic results across builds, excluding generated IDs/receipts.
    semanticSha256: createHash("sha256").update(JSON.stringify(result.events.map((event) => {
      assert.ok(event.kind === "observation");
      return {
        kind: event.kind, occurredAt: event.occurredAt, timeZone: event.timeZone,
        title: event.title, metric: event.metric, unit: event.unit, value: event.value,
        externalRef: event.externalRef,
        revision: event.lifecycle?.revision, state: event.lifecycle?.state,
      };
    }))).digest("hex"),
  }));
}
if (profiler && profilePath) {
  const { profile } = await profiler.post("Profiler.stop");
  await writeFile(profilePath, JSON.stringify(profile));
  profiler.disconnect();
}
const firstSeed = seed.events[0];
assert.ok(firstSeed);
const persisted = await readEvent({ vaultRoot, eventId: firstSeed.id });
assert.ok(persisted.event.kind === "observation");
assert.equal(persisted.event.lifecycle?.revision, 2);
assert.equal(persisted.event.value, 100);
console.log(JSON.stringify({ scenario: "canonical-readback", passed: true }));
