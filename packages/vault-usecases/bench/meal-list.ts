import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addMeal, initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { listMealRecords } from "../src/usecases/document-meal-read.js";

// Compare the previous full-projection read and the canonical event-family
// read on identical synthetic vaults. Fixture creation is outside timing.
const count = Number(process.env.MURPH_BENCH_EVENTS ?? 8_000);
assert.ok(Number.isSafeInteger(count) && count >= 100 && count <= 50_000);
const root = await mkdtemp(path.join(tmpdir(), "meal-list-bench-"));
const hashes = new Set<string>();
try {
  for (const mode of ["projection", "source"] as const) {
    const vault = path.join(root, mode);
    await initializeVault({ vaultRoot: vault, timezone: "UTC" });
    const shard = path.join(vault, "ledger/events/2026/2026-01.jsonl");
    await mkdir(path.dirname(shard), { recursive: true });
    await writeFile(shard, Array.from({ length: count }, (_, i) => JSON.stringify({
      schemaVersion: "murph.event.v1", id: `evt_synthetic_${i}`,
      kind: "observation", visibility: "display", dayKey: "2026-01-10",
      occurredAt: "2026-01-10T07:00:00Z", recordedAt: "2026-01-10T07:01:00Z",
      source: "device", title: "Synthetic observation", metric: "sleep-efficiency",
      value: 85, unit: "percent",
      externalRef: { system: "whoop", resourceType: "sleep", resourceId: `synthetic-${i}`, facet: "sleep_efficiency" },
    })).join("\n") + "\n");
    await addMeal({ vaultRoot: vault, occurredAt: "2026-04-10T12:00:00Z", note: "Synthetic lunch" });
    const filters = { vault, from: "2026-04-10", to: "2026-04-10", limit: 200 };
    for (const stage of ["cold", "warm", "after-write"]) {
      if (stage === "after-write") await appendFile(shard, JSON.stringify({
        schemaVersion: "murph.event.v1", id: "evt_synthetic_note", kind: "note",
        occurredAt: "2026-01-10T18:00:00Z", recordedAt: "2026-01-10T18:00:00Z",
        source: "manual", title: "Synthetic unrelated note",
      }) + "\n");
      const startedAt = performance.now();
      const cpuStart = process.cpuUsage();
      const result = mode === "source"
        ? (await listMealRecords(filters)).items.map((item) => ({ kind: item.kind, occurredAt: item.occurredAt }))
        : (await listCanonicalEntities(vault, { family: "event", kinds: ["meal"],
          from: filters.from, to: filters.to, limit: null }))
          .slice(0, filters.limit).map((item) => ({ kind: item.kind, occurredAt: item.occurredAt }));
      const wallMs = Math.round(performance.now() - startedAt);
      const cpu = process.cpuUsage(cpuStart);
      assert.equal(result.length, 1);
      const hash = createHash("sha256").update(JSON.stringify(result)).digest("hex");
      hashes.add(hash);
      console.log(JSON.stringify({ mode, stage, events: count, wallMs,
        cpuMs: Math.round((cpu.user + cpu.system) / 1_000), hash }));
    }
  }
  assert.equal(hashes.size, 1, "both paths preserve selected meal kind and local date");
} finally { await rm(root, { recursive: true, force: true }); }
