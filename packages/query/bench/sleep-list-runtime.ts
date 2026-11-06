import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { CURRENT_VAULT_FORMAT_VERSION, extractIsoDatePrefix } from "@murphai/contracts";
import { withCanonicalWriteLock } from "@murphai/core";

import {
  summarizeWearableSleepRuntime,
} from "../src/query-projection.ts";
import { readFreshWearableSummaryRows } from "../src/projection/rebuild.ts";
import { currentQueryProjectionLocation } from "../src/projection/schema.ts";
import { composePublicWearableSummaryBundleFromStoredRows } from "../src/projection/wearable-summary-compose.ts";
import { readWearableSummaryRows } from "../src/projection/wearable-summary-store.ts";
import { summarizeWearableSleepFromBundle, type WearableSummaryFilters } from "../src/wearables.ts";

// Compares the public sleep-list reader with the original providers-only
// full-row read and composition (the oracle, computed before any variant) and
// the rejected sleep/source_health kind selection. The public variant must
// equal the oracle; kind-selection mismatches are diagnostic only. All inputs
// are synthetic; no provider or network I/O.
function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}
// At least the 14 days the bounded cases read; at most ten years of history.
const DAYS = boundedInteger("MURPH_SLEEP_LIST_BENCH_DAYS", 365, 14, 3650);
const WARM = boundedInteger("MURPH_SLEEP_LIST_BENCH_WARM", 7, 1, 50);
const STALE = 3;
const PROVIDERS = ["oura", "whoop", "garmin"];
const LAST = "2026-10-01";

type Variant = "full-rows" | "public" | "kinds-and-dates";
const VARIANTS: Variant[] = ["full-rows", "public", "kinds-and-dates"];
const CASES: Array<{ name: string; filters: WearableSummaryFilters }> = [
  { name: "all-providers-limit-14", filters: { limit: 14 } },
  { name: "all-providers-14-days", filters: { from: "2026-09-18", limit: 14, to: LAST } },
  { name: "oura-14-days", filters: { from: "2026-09-18", limit: 14, providers: ["oura"], to: LAST } },
  { name: "all-providers-date", filters: { date: "2026-09-30" } },
  { name: "datetime-shaped-range", filters: { from: "2026-09-18T05:00:00.000Z", to: "2026-10-01T23:00:00.000Z" } },
];

function isoDate(index: number): string {
  return new Date(Date.UTC(2026, 9, 1 - (DAYS - 1) + index)).toISOString().slice(0, 10);
}

function observation(
  date: string, provider: string, metric: string, unit: string, value: number,
  resourceType: string, occurredAt = `${date}T12:00:00.000Z`,
): Record<string, unknown> {
  return {
    dayKey: date,
    externalRef: { system: provider, resourceType, resourceId: `bench-${provider}-${date}-${metric}` },
    id: `evt_bench_${metric.replaceAll("-", "_")}_${provider}_${date.replaceAll("-", "")}`,
    kind: "observation", metric, observationGrain: "daily-summary",
    occurredAt, recordedAt: `${date}T12:05:00.000Z`,
    schemaVersion: "murph.event.v1", source: "device",
    title: `Synthetic ${metric}`, unit, value,
  };
}

function sleepEvent(date: string, provider: string, durationMinutes: number): Record<string, unknown> {
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

function historyDay(date: string, provider: string, index: number, offset: number): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const shifted = index + offset;
  if (shifted % 17 !== 0) {
    records.push(sleepEvent(date, provider, 400 + (shifted % 9) * 10));
    records.push(observation(date, provider, "sleep_score", "%", 70 + shifted % 25, "sleep", `${date}T10:30:00.000Z`));
    records.push(observation(date, provider, "respiratory_rate", "breaths/min", 13 + shifted % 4, "sleep", `${date}T10:30:00.000Z`));
  }
  // Shared sleep/recovery keys come from recovery-like resources, so composed
  // multi-provider sleep can see both the stored sleep and recovery selections.
  records.push(observation(date, provider, "hrv", "ms", 35 + shifted % 25, "recovery"));
  records.push(observation(date, provider, "resting_heart_rate", "bpm", 50 + shifted % 8, "recovery"));
  records.push(observation(date, provider, "spo2", "%", 95 + shifted % 4, "recovery"));
  records.push(observation(date, provider, "recovery_score", "%", 40 + shifted % 50, "recovery"));
  records.push(observation(date, provider, "steps", "count", 6500 + (shifted * 137) % 6000, "daily-summary"));
  if (provider === "garmin" && index % 3 === 0) {
    records.push(observation(date, provider, "weight", "kg", 78 + (index % 5) / 10, "body"));
  }
  return records;
}

async function seed(vaultRoot: string): Promise<void> {
  const metadata = `${JSON.stringify({
    createdAt: "2025-10-01T00:00:00.000Z", formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    timezone: "America/New_York", title: "Synthetic sleep-list benchmark",
    vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
  })}\n`;
  await writeFile(path.join(vaultRoot, "vault.json"), metadata, "utf8");
  const shards = new Map<string, string[]>();
  let eventCount = 0;
  for (let index = 0; index < DAYS; index += 1) {
    const date = isoDate(index);
    const relativePath = `ledger/events/${date.slice(0, 4)}/${date.slice(0, 7)}.jsonl`;
    const lines = shards.get(relativePath) ?? [];
    PROVIDERS.forEach((provider, offset) => {
      const records = historyDay(date, provider, index, offset * 5);
      lines.push(...records.map((record) => JSON.stringify(record)));
      eventCount += records.length;
    });
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
    fixture: "sleep-list-runtime-v1", days: DAYS, providers: PROVIDERS, eventCount,
    fixtureSha256: fixtureHash.digest("hex"),
  }));
}

async function read(variant: Variant, vaultRoot: string, filters: WearableSummaryFilters) {
  if (variant === "public") {
    return { items: await summarizeWearableSleepRuntime(vaultRoot, filters) };
  }
  const rows = await readFreshWearableSummaryRows(vaultRoot, variant === "full-rows"
    ? { providers: filters.providers }
    : {
      from: filters.date ?? filters.from,
      providers: filters.providers,
      summaryKinds: ["sleep", "source_health"] as const,
      to: filters.date ?? filters.to,
    });
  const bundle = composePublicWearableSummaryBundleFromStoredRows(rows, filters);
  return { items: summarizeWearableSleepFromBundle(bundle, filters) };
}

async function measure(variant: Variant, vaultRoot: string, filters: WearableSummaryFilters) {
  const start = performance.now();
  const { items } = await read(variant, vaultRoot, filters);
  const wallMs = performance.now() - start;
  const json = JSON.stringify(items);
  return {
    bytes: Buffer.byteLength(json), items: items.length, json,
    sha256: createHash("sha256").update(json).digest("hex"), wallMs,
  };
}

// Untimed: stored rows and decoded summary bytes a read materializes, via the
// existing store reader, for providers-only versus day-bounded selection.
function materialized(vaultRoot: string, filters: WearableSummaryFilters) {
  const day = (value: string | undefined) => value ? extractIsoDatePrefix(value) ?? value : undefined;
  const measureRows = (selection: Parameters<typeof readWearableSummaryRows>[1]) => {
    const { rows } = readWearableSummaryRows(currentQueryProjectionLocation(vaultRoot), selection);
    return { rows: rows.length, decodedBytes: rows.reduce((sum, row) => sum + Buffer.byteLength(row.summaryJson), 0) };
  };
  return {
    fullRows: measureRows({ providers: filters.providers }),
    dayBounded: measureRows({
      from: day(filters.date || filters.from), providers: filters.providers, to: day(filters.date || filters.to),
    }),
  };
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    n: sorted.length, minMs: sorted[0], medianMs: at(0.5), p90Ms: at(0.9), maxMs: sorted.at(-1),
  };
}

let revision = 1;
// The reference vault repeats the same revision (`advance` false).
async function makeStale(vaultRoot: string, advance = true): Promise<void> {
  if (advance) revision += 1;
  const mutation = `${JSON.stringify({
    ...sleepEvent(LAST, "oura", 500 + revision), lifecycle: { revision },
    recordedAt: `${LAST}T11:${String(10 + revision).padStart(2, "0")}:00.000Z`,
  })}\n`;
  await withCanonicalWriteLock(vaultRoot, () => appendFile(
    path.join(vaultRoot, `ledger/events/${LAST.slice(0, 4)}/${LAST.slice(0, 7)}.jsonl`), mutation, "utf8",
  ));
}

// Public must equal the oracle; the rejected kind selection is diagnostic.
const diagnostics: Array<Record<string, unknown>> = [];
function check(name: string, phase: string, variant: Variant, actual: string, oracle: string): void {
  if (actual === oracle) return;
  if (variant === "public") assert.fail(`public sleep list differs from the full-row oracle: ${name} ${phase}`);
  if (!diagnostics.some((entry) => entry.case === name && entry.phase === phase && entry.variant === variant)) {
    diagnostics.push({ case: name, phase, variant });
  }
}

const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-list-bench-"));
// Identical canonical history; stale oracles are read here, before the measured
// vault's stale read, so every oracle precedes every variant it judges.
const referenceRoot = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-list-reference-"));
try {
  await seed(vaultRoot);
  await cp(vaultRoot, referenceRoot, { recursive: true });
  await summarizeWearableSleepRuntime(vaultRoot, {}); // initial wearable publication
  for (const { name, filters } of CASES) {
    const oracle = (await measure("full-rows", vaultRoot, filters)).json;
    console.log(JSON.stringify({ case: name, phase: "materialization", ...materialized(vaultRoot, filters) }));
    const samples = new Map<Variant, number[]>(VARIANTS.map((variant) => [variant, []]));
    const shapes = new Map<Variant, Record<string, unknown>>();
    for (let iteration = -2; iteration < WARM; iteration += 1) {
      // Rotate start variant each iteration so warmup/host drift is shared.
      const order = VARIANTS.map((_, index) => VARIANTS[(index + iteration + 2) % VARIANTS.length]!);
      for (const variant of order) {
        const result = await measure(variant, vaultRoot, filters);
        check(name, "fresh", variant, result.json, oracle);
        if (iteration >= 0) samples.get(variant)!.push(result.wallMs);
        shapes.set(variant, { bytes: result.bytes, items: result.items, sha256: result.sha256 });
      }
    }
    for (const variant of VARIANTS) {
      console.log(JSON.stringify({ case: name, phase: "fresh-warm", variant, ...shapes.get(variant), ...stats(samples.get(variant)!) }));
    }

    // Stale: each variant pays one wearable rebuild after a canonical revision.
    const staleSamples = new Map<Variant, number[]>(VARIANTS.map((variant) => [variant, []]));
    for (let iteration = 0; iteration < STALE; iteration += 1) {
      for (const variant of VARIANTS.map((_, index) => VARIANTS[(index + iteration) % VARIANTS.length]!)) {
        await makeStale(vaultRoot);
        await makeStale(referenceRoot, false);
        const staleOracle = (await measure("full-rows", referenceRoot, filters)).json;
        const result = await measure(variant, vaultRoot, filters);
        check(name, "stale", variant, result.json, staleOracle);
        staleSamples.get(variant)!.push(result.wallMs);
      }
    }
    for (const variant of VARIANTS) {
      console.log(JSON.stringify({ case: name, phase: "stale", variant, ...stats(staleSamples.get(variant)!) }));
    }
  }
  console.log(JSON.stringify({ publicOracleMismatches: 0, rejectedKindSelectionDiagnostics: diagnostics }));
} finally {
  await Promise.all([vaultRoot, referenceRoot].map((root) => rm(root, { force: true, recursive: true })));
}
