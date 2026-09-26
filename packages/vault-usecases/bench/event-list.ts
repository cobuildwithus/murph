import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VaultServices } from "@murphai/vault-usecases/vault-services";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";

// Synthetic canonical evidence, not a mocked query/provider implementation.
// Node >=24.14.1 strips types; package imports resolve each checkout's built
// public entrypoints, including the production dynamic query loader and timing
// owner. Do not bundle or replace that loader for a benchmark-only code path.
// All measured reads use the unmodified public production service factory.
export const providers = ["garmin", "oura", "whoop"] as const;
const metrics = [
  ["steps", "count", 8000], ["resting-heart-rate", "bpm", 58],
  ["hrv-rmssd", "ms", 45], ["total-sleep-minutes", "minutes", 450],
  ["sleep-efficiency", "percent", 90], ["active-calories", "kcal", 500],
  ["weight", "kg", 75], ["spo2", "percent", 97],
] as const;
export const eventSelections = [
  { limit: 40 },
  { kind: "note", from: "2025-06-01", to: "2025-06-30", limit: 40 },
  { tag: ["synthetic", "review"], experiment: "synthetic-routine", limit: 3 },
  { kind: "observation", from: "2025-03-01", to: "2025-09-30", limit: 40 },
  { kind: "note", from: "2025-06-01", to: "2025-09-30",
    tag: ["review"], experiment: "synthetic-routine", limit: 7 },
];

export async function seedEventListBenchmark(vault: string): Promise<void> {
  const { initializeVault } = await import("@murphai/core");
  const { summarizeWearableSourceHealthRuntime } = await import("@murphai/query");
  await initializeVault({ vaultRoot: vault, timezone: "UTC" });
  const shards = new Map<string, string[]>();
  const append = (date: string, row: Record<string, unknown>) => {
    const month = date.slice(0, 7);
    const rows = shards.get(month) ?? [];
    rows.push(JSON.stringify({ schemaVersion: "murph.event.v1", source: "device",
      occurredAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T08:01:00.000Z`,
      dayKey: date, ...row }));
    shards.set(month, rows);
  };
  for (let day = 0; day < 365; day++) {
    const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
    for (const [providerIndex, provider] of providers.entries()) {
      for (const [metric, unit, base] of metrics) {
        append(date, {
          id: `evt_synthetic_${provider}_${day}_${metric}`, kind: "observation",
          title: `Synthetic ${provider} ${metric}`, metric, unit,
          value: metric === "spo2" ? base + (day % 2) * 0.2 + providerIndex * 0.1
            : base + (day % 3) + providerIndex,
          ...(metric === "resting-heart-rate" && day % 7 === 0 ? { visibility: "display" } : {}),
          externalRef: { system: provider, resourceType: "daily", resourceId: `synthetic-${day}`, facet: metric },
        });
      }
    }
    append(date, {
      id: `evt_synthetic_note_${day}`, kind: "note", source: "manual",
      occurredAt: `${date}T18:00:00.000Z`, title: "Synthetic daily note",
      note: "Synthetic routine context for event list benchmarking.",
      tags: day % 2 === 0 ? ["synthetic", "review"] : ["synthetic"],
      experimentSlug: day % 3 === 0 ? "synthetic-routine" : "synthetic-control",
    });
  }
  for (const [month, rows] of shards) {
    const file = path.join(vault, "ledger/events", month.slice(0, 4), `${month}.jsonl`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, rows.join("\n") + "\n");
  }
  const sources = await summarizeWearableSourceHealthRuntime(vault, { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual([...new Set(sources.map((source) => source.provider))].sort(), [...providers].sort(),
    "The real wearable projector must recognize all three synthetic providers");
}

async function runTrial(vault: string, scenario: string) {
  const scenarios = [
    ["cold", ["event"]], // Also the one-read case: every scenario has a new process.
    ["event-only-2", ["event", "event"]],
    ["event-only-3", ["event", "event", "event"]],
    ["event-only-repeated", Array<string>(20).fill("event")],
    ["event-then-global", ["event", "global", "event", "global"]],
    ["global-then-event", ["global", "event", "event", "event", "event"]],
    ["warm-global", ["global", "event", "event", "event"]],
  ] as const;
  const operations = scenarios.find(([name]) => name === scenario)?.[1];
  assert.ok(operations, "Expected a supported event-list scenario");
  // Only the disposable fixture's derived query files are removed. Canonical
  // files and their mtimes remain identical across revisions and all pairs.
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(path.join(vault, `.runtime/projections/query.sqlite${suffix}`), { force: true });
  }
  let services: VaultServices | undefined;
  const steps = [];
  let eventIndex = 0;
  for (const operation of operations) {
    let timing: CliTiming | undefined;
    const selection = eventSelections[eventIndex % eventSelections.length]!;
    const started = performance.now();
    const cpuStart = process.cpuUsage();
    // Workload imports and first-use initialization belong to this scenario's
    // first read, not excluded subprocess startup or an earlier scenario.
    const { withCliTiming } = await import("@murphai/runtime-state/node/cli-timing");
    const query = (services ??= (await import("@murphai/vault-usecases/vault-services"))
      .createIntegratedVaultServices()).query;
    const result = await withCliTiming(
      async () => operation === "event"
        ? query.listEvents({ vault, requestId: "synthetic-event-list-benchmark", ...selection })
        : query.list({ vault, requestId: "synthetic-event-list-benchmark", limit: 40 }),
      (report) => { timing = report; },
    );
    const cpu = process.cpuUsage(cpuStart);
    const wallMs = performance.now() - started;
    assert.ok(timing, "The production timing owner must publish a report");
    assert.equal(timing.droppedCalls + timing.droppedSpans, 0);
    assert.equal(timing.transportTruncated, false);
    const json = JSON.stringify(result); // Entire envelope: no field pruning or sorting.
    assert.equal(result.items.length, result.count);
    assert.ok(result.count > 0, "The selected fixture must not be vacuous");
    // Warm-global exposes an event-read subtotal, but the prewarming global
    // call is still timed, hashed and included in the whole-sequence totals.
    steps.push({ operation, setup: scenario === "warm-global" && operation === "global",
      wallMs, cpuMs: (cpu.user + cpu.system) / 1000,
      hash: createHash("sha256").update(json).digest("hex"),
      bytes: Buffer.byteLength(json), count: result.count,
      phases: timing.commands.flatMap((command) => command.phases),
    });
    if (operation === "event") eventIndex++;
  }
  return { scenario, steps,
    wallMs: steps.reduce((sum, step) => sum + step.wallMs, 0),
    cpuMs: steps.reduce((sum, step) => sum + step.cpuMs, 0),
    readWallMs: steps.filter((step) => !step.setup).reduce((sum, step) => sum + step.wallMs, 0),
    readCpuMs: steps.filter((step) => !step.setup).reduce((sum, step) => sum + step.cpuMs, 0),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, vault, scenario, ...extra] = process.argv.slice(2);
  assert.ok(vault && extra.length === 0 &&
    ((mode === "seed" && scenario === undefined) || (mode === "trial" && scenario)),
    "Usage: node event-list.ts seed VAULT | trial VAULT SCENARIO");
  if (mode === "seed") await seedEventListBenchmark(vault);
  else {
    assert.ok(scenario);
    console.log(JSON.stringify(await runTrial(vault, scenario)));
  }
}
