import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { CONTRACT_SCHEMA_VERSION, eventRecordSchema, sampleRecordSchema } from "@murphai/contracts";
import { deterministicContractId, initializeVault } from "@murphai/core";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createDefaultImporterPort, createDeviceSyncService, SqliteDeviceSyncStore } from "../src/service.ts";

// Synthetic, opt-in diagnostic. Every file lives in a new disposable vault.
const historyRows = Number(process.env.MURPH_DEVICE_PASS_HISTORY_ROWS ?? 105_000);
const jobRows = Number(process.env.MURPH_DEVICE_PASS_JOB_ROWS ?? 80);
assert.ok(Number.isSafeInteger(historyRows) && historyRows >= 100 && historyRows <= 150_000);
assert.ok(Number.isSafeInteger(jobRows) && jobRows > 0 && jobRows <= 100 && jobRows % 2 === 0);
const now = "2026-04-22T12:00:00.000Z";
const root = await mkdtemp(path.join(os.tmpdir(), "device-pass-bench-"));
const stateDatabasePath = path.join(root, "device-sync.sqlite");

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2;
}

async function manifest(directory: string): Promise<string> {
  const rows: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const next = path.join(relative, item.name);
      if (item.isDirectory()) await visit(next);
      else if (item.isFile() && !item.name.startsWith("device-sync.sqlite")) {
        const bytes = await readFile(path.join(directory, next));
        rows.push(`${next}:${createHash("sha256").update(bytes).digest("hex")}`);
      }
    }
  }
  await visit("");
  return createHash("sha256").update(rows.sort().join("\n")).digest("hex");
}

try {
  const fixture = process.env.MURPH_DEVICE_PASS_FIXTURE;
  if (fixture) {
    await cp(fixture, root, { recursive: true });
  } else {
    await initializeVault({ vaultRoot: root, createdAt: "2026-01-01T00:00:00.000Z", timezone: "UTC" });
    // Seed canonical families once. Job execution below still uses normal writes.
    const months = 6;
    for (let month = 0; month < months; month++) {
      const lines: string[] = [];
      const sampleLines: string[] = [];
      const start = Math.floor(month * historyRows / months);
      const end = Math.floor((month + 1) * historyRows / months);
      const year = 2025 + Math.floor((month + 5) / 12);
      const monthNumber = (month + 5) % 12 + 1;
      const shardName = `${year}-${String(monthNumber).padStart(2, "0")}.jsonl`;
      for (let index = start; index < end; index++) {
        const at = new Date(Date.UTC(year, monthNumber - 1, 1)
          + Math.floor((index - start) * 27 * 86_400_000 / (end - start))).toISOString();
        const family = index % 20 === 0 ? "sleep_session" : index % 20 === 1 ? "activity_session" : "observation";
        const base = {
          schemaVersion: CONTRACT_SCHEMA_VERSION.event,
          id: deterministicContractId("evt", `device-pass-history-${index}`),
          source: "device", occurredAt: at, recordedAt: at,
          dayKey: at.slice(0, 10), timeZone: "UTC",
          externalRef: { system: "junction", resourceType: family.replace("_", "-"), resourceId: `history-${index}`, version: at },
        };
        const record = family === "sleep_session"
          ? { ...base, kind: family, title: "Synthetic device sleep", startAt: at,
              endAt: new Date(Date.parse(at) + 480 * 60_000).toISOString(), durationMinutes: 480 }
          : family === "activity_session"
            ? { ...base, kind: family, title: "Synthetic device workout", activityType: "running",
                durationMinutes: 45, workout: { startedAt: at, exercises: [] } }
            : { ...base, kind: family, title: "Synthetic device sample observation",
                metric: "heart-rate", unit: "bpm", value: 60 + index % 40 };
        const parsed = eventRecordSchema.safeParse(record);
        assert.ok(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code }))));
        lines.push(JSON.stringify(parsed.data));
        if (index - start < Math.min(1_000, end - start)) {
          const sample = sampleRecordSchema.safeParse({
            schemaVersion: CONTRACT_SCHEMA_VERSION.sample,
            id: deterministicContractId("smp", `device-pass-sample-${index}`),
            stream: "heart_rate", recordedAt: at, dayKey: at.slice(0, 10),
            source: "device", quality: "raw", value: 60 + index % 40, unit: "bpm",
          });
          assert.ok(sample.success, sample.success ? undefined : JSON.stringify(sample.error.issues.map((issue) => ({ path: issue.path, code: issue.code }))));
          sampleLines.push(JSON.stringify(sample.data));
        }
      }
      for (const [directory, payload] of [
        ["ledger/events", lines], ["ledger/samples/heart_rate", sampleLines],
      ] as const) {
        const shard = path.join(root, directory, String(year), shardName);
        await mkdir(path.dirname(shard), { recursive: true });
        await writeFile(shard, `${payload.join("\n")}\n`);
      }
    }
    if (process.env.MURPH_DEVICE_PASS_SAVE_FIXTURE) {
      await cp(root, process.env.MURPH_DEVICE_PASS_SAVE_FIXTURE, { recursive: true });
    }
  }

  const base = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_synthetic_benchmark", clientUserIdSecret: "synthetic-benchmark-secret", environment: "sandbox", region: "us",
    summaryResources: [], timeseriesResources: [],
    fetchImpl: async () => { throw new Error("Benchmark must not call a network provider"); },
  });
  const provider = {
    ...base,
    jobExecutor: {
      executeJob: async (context: Parameters<NonNullable<typeof base.jobExecutor>["executeJob"]>[0], job: Parameters<NonNullable<typeof base.jobExecutor>["executeJob"]>[1]) => {
        const day = String(job.payload.windowStart).slice(0, 10);
        const pair = Math.round((Date.parse(`${day}T00:00:00.000Z`) - Date.UTC(2026, 2, 1)) / 86_400_000);
        const snapshot = {
          accountId: "synthetic-account", importedAt: now,
          timeseries: { blood_oxygen: { groups: { garmin: [{
            source: { provider: "garmin", type: "watch" },
            data: [{ timestamp: `${day}T07:15:00.000Z`, unit: "percent", value: 95 + pair % 4 }],
          }] } } },
        };
        const importStarted = performance.now();
        await context.importSnapshot(snapshot);
        latestImportMs = performance.now() - importStarted;
        return {};
      },
    },
  };
  let latestImportMs = 0;
  const store = new SqliteDeviceSyncStore(stateDatabasePath);
  const defaultImporter = createDefaultImporterPort();
  const importer = process.env.MURPH_DEVICE_PASS_NO_SCOPE === "1"
    ? {
        importDeviceProviderSnapshot: defaultImporter.importDeviceProviderSnapshot,
        resolveDeviceProviderSnapshotDefaultTimeZone: defaultImporter.resolveDeviceProviderSnapshotDefaultTimeZone,
      }
    : defaultImporter;
  const service = createDeviceSyncService({
    secret: "synthetic", config: { vaultRoot: root, stateDatabasePath, publicBaseUrl: "https://sync.example.test" },
    store, clock: { now: () => new Date(now) }, providers: [provider], importer,
  });
  try {
    const account = store.upsertAccount({
      provider: "junction", externalAccountId: "synthetic-account", displayName: "Synthetic Junction",
      scopes: [], status: "active", credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
      connectedAt: now, nextReconcileAt: null,
    });
    for (let ordinal = 0; ordinal < jobRows; ordinal++) {
      const kind = ordinal % 4 < 2 ? "resource" : "reconcile";
      const pair = Math.floor(ordinal / 2);
      store.enqueueJob({
        accountId: account.id, provider: "junction", kind,
        availableAt: now, priority: 100 - ordinal, dedupeKey: `synthetic-${ordinal}`,
        payload: {
          windowStart: new Date(Date.UTC(2026, 2, 1 + pair)).toISOString(),
          windowEnd: new Date(Date.UTC(2026, 2, 2 + pair)).toISOString(),
          ...(kind === "resource" ? { resource: "blood_oxygen" } : {}),
        },
      });
    }
    const profiler = new Session();
    profiler.connect();
    await profiler.post("Profiler.enable");
    await profiler.post("Profiler.start");
    const samples: Array<Record<string, number | string | boolean>> = [];
    let lastWall = performance.now();
    let lastCpu = process.cpuUsage();
    const passStarted = lastWall;
    const passCpu = lastCpu;
    const processed = await service.drainWorker(jobRows, account.id, { onProcessedJobRows: () => {
      const diagnostic = service.listJobTimingDiagnostics().at(-1)!;
      const currentWall = performance.now();
      const currentCpu = process.cpuUsage();
      const applied = diagnostic.snapshotImportOutcomes.applied > 0;
      samples.push({
        outcome: applied ? "applied" : diagnostic.snapshotImportOutcomes.noop > 0 ? "noop" : "other",
        kind: diagnostic.jobKind,
        wallMs: currentWall - lastWall,
        cpuMs: ((currentCpu.user - lastCpu.user) + (currentCpu.system - lastCpu.system)) / 1_000,
        importMs: latestImportMs,
        normalizeMs: diagnostic.snapshotNormalizationElapsedMs,
        coreMs: diagnostic.snapshotCanonicalCoreElapsedMs,
        identityMs: diagnostic.snapshotEventIdentityIndexElapsedMs,
        cacheHit: diagnostic.snapshotEventIdentityIndexCacheHitCount > 0,
        writeMs: diagnostic.snapshotCanonicalWriteElapsedMs,
        ingestMs: diagnostic.snapshotIngestInspectionElapsedMs,
      });
      latestImportMs = 0;
      lastWall = currentWall;
      lastCpu = currentCpu;
    } });
    const passWallMs = performance.now() - passStarted;
    const passUsed = process.cpuUsage(passCpu);
    const passCpuMs = (passUsed.user + passUsed.system) / 1_000;
    const { profile } = await profiler.post("Profiler.stop");
    profiler.disconnect();
    assert.equal(processed, jobRows);
    assert.equal(samples.filter((sample) => sample.outcome === "applied").length, jobRows / 2);
    assert.equal(samples.filter((sample) => sample.outcome === "noop").length, jobRows / 2);
    if (process.env.MURPH_DEVICE_PASS_PROFILE) await writeFile(process.env.MURPH_DEVICE_PASS_PROFILE, JSON.stringify(profile));
    const summary = Object.fromEntries(["applied", "noop"].map((outcome) => {
      const selected = samples.filter((sample) => sample.outcome === outcome);
      return [outcome, Object.fromEntries(["wallMs", "cpuMs", "importMs", "normalizeMs", "coreMs", "identityMs", "writeMs", "ingestMs"].map((key) => [key, median(selected.map((sample) => Number(sample[key])))]).concat([["cacheHits", selected.filter((sample) => sample.cacheHit).length]]))];
    }));
    console.log(JSON.stringify({ historyRows, jobRows, scope: process.env.MURPH_DEVICE_PASS_NO_SCOPE === "1" ? "off" : "on", summary,
      passWallMs, passCpuMs,
      maxRssKiB: process.resourceUsage().maxRSS, manifestSha256: await manifest(root),
      ...(process.env.MURPH_DEVICE_PASS_KEEP === "1" ? { temporaryVault: root } : {}) }));
  } finally {
    service.close(); store.close();
  }
} finally {
  if (process.env.MURPH_DEVICE_PASS_KEEP !== "1") await rm(root, { recursive: true, force: true });
}
