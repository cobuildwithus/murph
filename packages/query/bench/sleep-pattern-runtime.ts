import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { withCanonicalWriteLock } from "@murphai/core";
import { timeCliDispatch, withCliTiming } from "@murphai/runtime-state/node/cli-timing";

import {
  rebuildQueryProjection,
  summarizeWearableSleepPatternRuntime,
} from "../src/query-projection.ts";

// Copy this file unchanged to base and head; use the same repository TS runner
// and dependency builds. All inputs are synthetic; no provider or network I/O.
// Setup, mutation and explicit global controls are outside measured reads.
const DAYS = 365;
const PROVIDERS = ["oura", "whoop", "garmin"];
const FILTERS = {
  from: "2026-09-04",
  now: "2026-10-01T13:00:00.000Z",
  providers: ["oura"],
  to: "2026-10-01",
};

function sleepEvent(date: string, provider: string, durationMinutes: number) {
  const endAt = `${date}T11:00:00.000Z`;
  const startAt = new Date(Date.parse(endAt) - durationMinutes * 60_000).toISOString();
  return {
    dayKey: date, durationMinutes, endAt,
    externalRef: { system: provider, resourceType: "sleep", resourceId: `bench-sleep-${provider}-${date}` },
    id: `evt_bench_sleep_${provider}_${date.replaceAll("-", "")}`,
    kind: "sleep_session", occurredAt: startAt, recordedAt: `${date}T11:05:00.000Z`,
    schemaVersion: "murph.event.v1", sleepType: "main_sleep", source: "device",
    startAt, title: "Synthetic provider sleep",
  };
}

function historyDay(date: string, provider: string, index: number): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  // Occasional missing nights plus variable durations, not a perfect clock.
  if (index % 17 !== 0) records.push(sleepEvent(date, provider, 420 + (index % 7) * 10));
  for (const [metric, unit, value] of [
    ["steps", "count", 6500 + (index * 137) % 6000],
    ["hrv", "ms", 35 + index % 25],
  ] as const) {
    records.push({
      dayKey: date,
      externalRef: { system: provider, resourceType: "daily-summary", resourceId: `bench-${provider}-${date}-${metric}` },
      id: `evt_bench_${metric}_${provider}_${date.replaceAll("-", "")}`,
      kind: "observation", metric, observationGrain: "daily-summary",
      occurredAt: `${date}T12:00:00.000Z`, recordedAt: `${date}T12:05:00.000Z`,
      schemaVersion: "murph.event.v1", source: "device",
      title: `Synthetic daily ${metric}`, unit, value,
    });
  }
  return records;
}

async function seedHistory(vaultRoot: string): Promise<void> {
  const metadata = `${JSON.stringify({
    createdAt: "2025-10-01T00:00:00.000Z", formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    timezone: "America/New_York", title: "Synthetic sleep-pattern benchmark",
    vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
  })}\n`;
  await writeFile(path.join(vaultRoot, "vault.json"), metadata, "utf8");
  const shards = new Map<string, string[]>();
  let eventCount = 0;
  for (let index = 0; index < DAYS; index += 1) {
    const date = new Date(Date.UTC(2026, 9, 1 - (DAYS - 1) + index)).toISOString().slice(0, 10);
    const relativePath = `ledger/events/${date.slice(0, 4)}/${date.slice(0, 7)}.jsonl`;
    const lines = shards.get(relativePath) ?? [];
    for (const provider of PROVIDERS) {
      const records = historyDay(date, provider, index);
      lines.push(...records.map((record) => JSON.stringify(record)));
      eventCount += records.length;
    }
    shards.set(relativePath, lines);
  }
  const fixtureHash = createHash("sha256").update(metadata);
  for (const [relativePath, lines] of shards) {
    const contents = `${lines.join("\n")}\n`;
    await mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
    await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
    fixtureHash.update(relativePath).update("\n").update(contents);
  }
  console.log(JSON.stringify({
    fixture: "sleep-pattern-runtime-v1", days: DAYS, providers: PROVIDERS,
    eventCount, fixtureSha256: fixtureHash.digest("hex"), filters: FILTERS,
  }));
}

async function measure(label: string, vaultRoot: string, expectedJson?: string): Promise<string> {
  globalThis.gc?.();
  let summary!: Awaited<ReturnType<typeof summarizeWearableSleepPatternRuntime>>;
  let timing: unknown = null;
  let phaseCounts: Record<string, number> = {};
  let droppedSpans = -1;
  const startCpu = process.cpuUsage();
  const start = performance.now();
  await withCliTiming(
    () => timeCliDispatch("wearables sleep pattern", async () => {
      summary = await summarizeWearableSleepPatternRuntime(vaultRoot, FILTERS);
    }),
    (report) => {
      timing = report;
      phaseCounts = Object.fromEntries(report.commands.flatMap((command) => command.phases)
        .map(({ phase, count }) => [phase, count]));
      droppedSpans = report.droppedSpans;
    },
  );
  const wallMs = performance.now() - start;
  const cpu = process.cpuUsage(startCpu);
  assert.equal(droppedSpans, 0);
  assert.ok(summary.validNightCount > 0);
  assert.deepEqual(summary.providers, ["oura"]);
  const json = JSON.stringify(summary);
  if (expectedJson !== undefined) assert.equal(json, expectedJson);
  console.log(JSON.stringify({
    label, wallMs, cpuMs: (cpu.user + cpu.system) / 1000,
    bytes: Buffer.byteLength(json), sha256: createHash("sha256").update(json).digest("hex"),
    phaseCounts, timing,
  }));
  return json;
}

const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-pattern-bench-"));
try {
  await seedHistory(vaultRoot);
  const cold = await measure("cold", vaultRoot);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    await measure(`warm-${iteration + 1}`, vaultRoot, cold);
  }
  // Exercise the unchanged public fresh-global path as a full-result control.
  await rebuildQueryProjection(vaultRoot);
  await measure("fresh-global-control", vaultRoot, cold);

  const mutation = `${JSON.stringify({
    ...sleepEvent("2026-10-01", "oura", 600),
    recordedAt: "2026-10-01T11:30:00.000Z", lifecycle: { revision: 2 },
  })}\n`;
  await withCanonicalWriteLock(vaultRoot, () => appendFile(
    path.join(vaultRoot, "ledger/events/2026/2026-10.jsonl"), mutation, "utf8",
  ));
  const stale = await measure("stale", vaultRoot);
  assert.notEqual(stale, cold, "The canonical sleep revision must change the full result.");
  await measure("stale-warm", vaultRoot, stale);
  await rebuildQueryProjection(vaultRoot);
  await measure("stale-global-control", vaultRoot, stale);
} finally {
  await rm(vaultRoot, { force: true, recursive: true });
}
