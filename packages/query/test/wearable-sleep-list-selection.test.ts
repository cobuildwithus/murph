import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { withCanonicalWriteLock } from "@murphai/core";
import { afterEach, test, vi } from "vitest";

import { summarizeWearableSleepRuntime } from "../src/query-projection.ts";
import * as rebuild from "../src/projection/rebuild.ts";
import { currentQueryProjectionLocation } from "../src/projection/schema.ts";
import { composePublicWearableSummaryBundleFromStoredRows } from "../src/projection/wearable-summary-compose.ts";
import { readWearableSummaryRows } from "../src/projection/wearable-summary-store.ts";
import { summarizeWearableSleepFromBundle, type WearableSummaryFilters } from "../src/wearables.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const PROVIDERS = ["oura", "whoop", "garmin"];
const SHARD = "ledger/events/2026/2026-09.jsonl";

function event(date: string, provider: string, metric: string, value: number, resourceType: string) {
  return {
    dayKey: date,
    externalRef: { system: provider, resourceType, resourceId: `selection-${provider}-${date}-${metric}` },
    id: `evt_selection_${metric}_${provider}_${date.replaceAll("-", "")}`,
    kind: "observation", metric, observationGrain: "daily-summary",
    occurredAt: `${date}T12:00:00.000Z`, recordedAt: `${date}T12:05:00.000Z`,
    schemaVersion: "murph.event.v1", source: "device", title: `Synthetic ${metric}`, unit: null, value,
  };
}

function sleep(date: string, provider: string, minutes: number) {
  const endAt = `${date}T11:00:00.000Z`;
  const startAt = new Date(Date.parse(endAt) - minutes * 60_000).toISOString();
  return {
    dayKey: date, durationMinutes: minutes, endAt,
    externalRef: { system: provider, resourceType: "sleep", resourceId: `selection-sleep-${provider}-${date}` },
    id: `evt_selection_sleep_${provider}_${date.replaceAll("-", "")}`,
    kind: "sleep_session", occurredAt: startAt, recordedAt: `${date}T11:05:00.000Z`,
    schemaVersion: "murph.event.v1", sleepType: "main_sleep", source: "device", startAt, title: "Synthetic sleep",
  };
}

// Multi-provider history where recovery-resource hrv/spo2 share sleep metric
// keys, so composed sleep nights depend on non-sleep stored rows.
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-list-selection-"));
  roots.push(root);
  await writeFile(path.join(root, "vault.json"), `${JSON.stringify({
    createdAt: "2026-08-01T00:00:00.000Z", formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    timezone: "UTC", title: "Sleep list selection fixture", vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
  })}\n`, "utf8");
  const lines: string[] = [];
  for (let day = 1; day <= 30; day += 1) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    PROVIDERS.forEach((provider, index) => {
      if ((day + index) % 5 !== 0) lines.push(JSON.stringify(sleep(date, provider, 400 + ((day + index) % 7) * 10)));
      lines.push(JSON.stringify(event(date, provider, "hrv", 35 + ((day + index * 3) % 20), "recovery")));
      lines.push(JSON.stringify(event(date, provider, "spo2", 95 + ((day + index) % 4), "recovery")));
      lines.push(JSON.stringify(event(date, provider, "recovery_score", 40 + day + index, "recovery")));
      lines.push(JSON.stringify(event(date, provider, "steps", 7000 + day * 31 + index, "daily-summary")));
    });
  }
  await mkdir(path.dirname(path.join(root, SHARD)), { recursive: true });
  await writeFile(path.join(root, SHARD), `${lines.join("\n")}\n`, "utf8");
  return root;
}

// The original selection: every stored kind and date for the provider scope.
function fullRowOracle(root: string, filters: WearableSummaryFilters) {
  const rows = readWearableSummaryRows(currentQueryProjectionLocation(root), { providers: filters.providers });
  return summarizeWearableSleepFromBundle(composePublicWearableSummaryBundleFromStoredRows(rows, filters), filters);
}

const cases: WearableSummaryFilters[] = [
  {},
  { limit: 5 },
  { from: "2026-09-10", to: "2026-09-16" },
  { from: "2026-09-10", limit: 3, to: "2026-09-16" },
  { date: "2026-09-12" },
  { date: "2026-09-12", from: "2026-09-01", to: "2026-09-30" },
  { date: "2026-09-12T23:30:00.000Z" },
  { from: "2026-09-10T05:00:00.000Z", to: "2026-09-16T23:00:00.000Z" },
  { date: "", from: "2026-09-20", to: "" },
  { from: "2026-09-20", to: "2026-09-10" },
  { from: "2026-10-01" },
  { providers: ["oura"], from: "2026-09-10", to: "2026-09-16" },
  { providers: ["Oura", "WHOOP"], date: "2026-09-12" },
  { providers: [], from: "2026-09-10" },
  { providers: [" "], date: "2026-09-12" },
  { providers: ["unknown"], from: "2026-09-10" },
];

test("dated sleep list output equals the full-row composition across providers and date shapes", async () => {
  const root = await fixture();
  await summarizeWearableSleepRuntime(root); // publish wearables once
  for (const filters of cases) {
    const actual = await summarizeWearableSleepRuntime(root, filters);
    assert.equal(JSON.stringify(actual), JSON.stringify(fullRowOracle(root, filters)), JSON.stringify(filters));
  }
});

test("sleep list prunes stored rows by day only, never by summary kind", async () => {
  const root = await fixture();
  await summarizeWearableSleepRuntime(root);
  const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
  await summarizeWearableSleepRuntime(root, { date: "2026-09-12T23:30:00.000Z", providers: ["oura"] });
  await summarizeWearableSleepRuntime(root, { from: "2026-09-10T05:00:00.000Z", to: "2026-09-16" });
  await summarizeWearableSleepRuntime(root, { limit: 5 });
  assert.deepEqual(focused.mock.calls.map(([, filters]) => filters), [
    { from: "2026-09-12", providers: ["oura"], to: "2026-09-12" },
    { from: "2026-09-10", providers: undefined, to: "2026-09-16" },
    { from: undefined, providers: undefined, to: undefined },
  ]);

  // Guard: dropping non-sleep kinds would change composed multi-provider sleep.
  const filters = { from: "2026-09-10", to: "2026-09-16" };
  const sleepOnly = readWearableSummaryRows(currentQueryProjectionLocation(root), {
    ...filters, summaryKinds: ["sleep", "source_health"],
  });
  assert.notEqual(
    JSON.stringify(summarizeWearableSleepFromBundle(composePublicWearableSummaryBundleFromStoredRows(sleepOnly, filters), filters)),
    JSON.stringify(fullRowOracle(root, filters)),
  );
});

test("a stale dated sleep list rebuilds wearables and equals the full-row composition", async () => {
  const root = await fixture();
  const filters = { from: "2026-09-25", to: "2026-09-30" };
  const before = await summarizeWearableSleepRuntime(root, filters);
  await withCanonicalWriteLock(root, () => appendFile(path.join(root, SHARD), `${JSON.stringify({
    ...sleep("2026-09-30", "oura", 600), lifecycle: { revision: 2 }, recordedAt: "2026-09-30T11:30:00.000Z",
  })}\n`, "utf8"));
  const focused = vi.spyOn(rebuild, "readFreshWearableSummaryRows");
  const after = await summarizeWearableSleepRuntime(root, filters);
  assert.equal(focused.mock.calls.length, 1);
  assert.notEqual(JSON.stringify(after), JSON.stringify(before));
  assert.equal(JSON.stringify(after), JSON.stringify(fullRowOracle(root, filters)));
});
