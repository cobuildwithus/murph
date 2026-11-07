import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type * as Core from "@murphai/core";
import type * as Query from "@murphai/query";
import type * as Timing from "@murphai/runtime-state/node/cli-timing";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";
import type { VaultServices } from "@murphai/vault-usecases/vault-services";

// Generated synthetic evidence only. One fixture serves deterministic proof and
// both benchmark sides; no canonical or summarization algorithm is copied here.
export const sleepNow = "2026-04-01T12:00:00.000Z";
export const sleepProviders = ["oura", "whoop", "garmin"] as const;
export function sleepDate(day: number): string {
  return new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
}
export function fingerprint(value: unknown) {
  const json = JSON.stringify(value);
  assert.ok(typeof json === "string");
  return { json, bytes: Buffer.byteLength(json), sha256: createHash("sha256").update(json).digest("hex") };
}

export async function seedSleepFixture(core: typeof Core, root: string, days = 90) {
  assert.ok(Number.isInteger(days) && days >= 3 && days <= 90);
  await core.initializeVault({ vaultRoot: root, timezone: "UTC", createdAt: "2026-01-01T00:00:00Z" });
  const shards = new Map<string, string[]>();
  let observations = 0;
  for (let day = 0; day < days; day += 1) {
    const date = sleepDate(day);
    const lines = shards.get(date.slice(0, 7)) ?? [];
    for (const [providerIndex, provider] of sleepProviders.entries()) {
      const resourceId = `synthetic_${provider}_${day}`;
      const common = {
        schemaVersion: "murph.event.v1", source: "device", dayKey: date,
        occurredAt: `${date}T07:00:00Z`, recordedAt: `${date}T08:00:00Z`,
        timeZone: "UTC", lifecycle: { revision: 1 },
      };
      lines.push(JSON.stringify({
        ...common, id: `evt_${resourceId}_window`, kind: "sleep_session", title: "Synthetic main sleep",
        startAt: `${sleepDate(day - 1)}T23:00:00Z`, endAt: `${date}T07:00:00Z`,
        durationMinutes: 480, sleepType: "main_sleep", sleepState: "confirmed",
        externalRef: { system: provider, resourceType: "sleep", resourceId },
      }));
      const total = 450 - providerIndex * 15 + day % 3 * 5;
      const metrics = [
        ["totalSleepMinutes", total, "minutes"], ["deepMinutes", 90, "minutes"],
        ["remMinutes", 110, "minutes"], ["lightMinutes", total - 200, "minutes"],
        ["awakeMinutes", 480 - total, "minutes"], ["hrv", 45 + day % 5, "ms"],
        ["steps", 8000 + day * 10 + providerIndex, "count"], ["weightKg", 75, "kg"],
      ] as const;
      for (const [metric, value, unit] of metrics) {
        lines.push(JSON.stringify({
          ...common, id: `evt_${resourceId}_${metric}`, kind: "observation",
          title: "Synthetic wearable observation", metric, value, unit,
          externalRef: { system: provider, resourceType: metric === "steps" || metric === "weightKg" ? "daily" : "sleep", resourceId, facet: metric },
        }));
        observations += 1;
      }
    }
    lines.push(JSON.stringify({
      schemaVersion: "murph.event.v1", id: `evt_synthetic_note_${day}`, kind: "note", source: "manual",
      title: `Synthetic sleep benchmark marker ${day}`, occurredAt: `${date}T12:00:00Z`, recordedAt: `${date}T12:00:00Z`,
    }));
    shards.set(date.slice(0, 7), lines);
  }
  await core.withCanonicalWriteLock(root, async () => {
    for (const [month, lines] of shards) {
      const file = path.join(root, `ledger/events/2026/${month}.jsonl`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, lines.join("\n") + "\n");
    }
  });
  return { days, providers: 3, observations, sessions: days * 3, notes: days,
    sourceSha256: fingerprint([...shards]).sha256, eventLedgers: shards.size };
}

export async function reviseSleepFixture(core: typeof Core, root: string, days: number, deleted = false) {
  const date = sleepDate(days - 1);
  const file = path.join(root, `ledger/events/2026/${date.slice(0, 7)}.jsonl`);
  await core.withCanonicalWriteLock(root, async () => {
    const lines: Record<string, unknown>[] = (await readFile(file, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const original = lines.find(row => row.id === `evt_synthetic_oura_${days - 1}_totalSleepMinutes`);
    assert.ok(original);
    await appendFile(file, JSON.stringify({ ...original, value: 410,
      recordedAt: sleepNow, lifecycle: { revision: deleted ? 3 : 2, ...(deleted ? { state: "deleted" } : {}) },
    }) + "\n");
  });
}

export async function readSleepProof(services: VaultServices, root: string, days: number, expectedLatest?: number) {
  const result = await services.query.listWearableSleep({
    vault: root, requestId: null, from: sleepDate(days - 7), to: sleepDate(days - 1), providers: ["oura"], limit: 7,
  });
  assert.equal(result.count, Math.min(days, 7), "A missing sleep result is not a speedup");
  assert.equal(result.items[0]?.date, sleepDate(days - 1));
  assert.ok(result.items.every(item => item.totalSleepMinutes && item.sleepStartAt));
  if (expectedLatest !== undefined) {
    const total = result.items[0]?.totalSleepMinutes;
    assert.ok(total && typeof total === "object" && !Array.isArray(total));
    assert.equal(total.value, expectedLatest, "The canonical correction must be reflected in the answer");
    assert.equal(total.provider, "oura");
    assert.equal(total.unit, "minutes");
  }
  return result;
}

export async function readGlobalProof(services: VaultServices, query: typeof Query, root: string, days: number) {
  const activity = await services.query.listWearableActivity({ vault: root, requestId: null, limit: 7 });
  const search = await query.searchVaultRuntime(root, "benchmark marker", { limit: 200 });
  const metrics = await query.listMetricPoints(root, { metricKey: "steps", limit: null });
  const sleepMetrics = await query.listMetricPoints(root, { metricKey: "total-sleep-minutes", limit: null });
  assert.equal(activity.count, Math.min(days, 7));
  assert.equal(search.total, days, "Global search must contain every synthetic note");
  assert.equal(search.hits.length, days);
  const dates = new Set(Array.from({ length: days }, (_, day) => sleepDate(day)));
  assert.deepEqual(new Set(metrics.map(point => point.effectiveDate)), dates, "Global steps must cover every fixture day");
  assert.deepEqual(new Set(sleepMetrics.map(point => point.effectiveDate)), dates, "Global sleep metrics must remain complete");
  return { activity, search, metrics, sleepMetrics };
}

export async function traceSleepRead<T>(timing: typeof Timing, command: string, run: () => Promise<T>) {
  let value!: T;
  let report: CliTiming | undefined;
  await timing.withCliTiming(() => timing.timeCliDispatch(command, async () => { value = await run(); }), result => { report = result; });
  assert.ok(report, "Missing timing report");
  assert.equal(report.droppedCalls, 0);
  assert.equal(report.droppedSpans, 0);
  assert.equal(report.commands.length, 1);
  assert.equal(report.commands[0]!.calls, 1);
  return { value, phases: Object.fromEntries(report.commands[0]!.phases.map(phase => [phase.phase, phase.count])) };
}
