import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { showExperimentProgress } from "../src/usecases/experiment-journal-vault.js";

// Synthetic, network-free proof through the actual progress usecase. Prints
// only timing, workload shape and semantic hashes; removes its own temp vault.
const count = Number(process.env.MURPH_BENCH_EVENTS ?? 8_000);
assert.ok(Number.isSafeInteger(count) && count >= 180 && count <= 50_000);
const root = await mkdtemp(path.join(os.tmpdir(), "experiment-progress-bench-"));
const date = (day: number) => new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);

try {
  await mkdir(path.join(root, "bank/experiments"), { recursive: true });
  await mkdir(path.join(root, "ledger/events/2026"), { recursive: true });
  await writeFile(path.join(root, "vault.json"), JSON.stringify({
    formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
    createdAt: "2026-01-01T00:00:00Z", title: "Synthetic benchmark", timezone: "UTC",
  }));
  await writeFile(path.join(root, "bank/experiments/synthetic.md"), `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01JNV4458HYPP53JDQCBP1QJFM
slug: synthetic
status: active
title: Synthetic experiment
startedOn: 2026-01-01
runPlan:
  baselineStart: 2026-01-01
  baselineEnd: 2026-01-07
  interventionStart: 2026-01-08
  interventionEnd: 2026-01-30
  targetSessions: 3
  minimumUsefulSessions: 2
analysisPlan:
  primaryBiomarkerKey: biomarker:sleep-efficiency
---
# Synthetic experiment
`);
  const shard = path.join(root, "ledger/events/2026/2026-01.jsonl");
  await writeFile(shard, Array.from({ length: count }, (_, i) => JSON.stringify({
    schemaVersion: "murph.event.v1", id: `evt_synthetic_bench_${i}`,
    kind: "observation", visibility: "display", dayKey: date(i % 180),
    occurredAt: `${date(i % 180)}T07:00:00Z`, recordedAt: `${date(i % 180)}T07:01:00Z`,
    source: "device", title: "Synthetic sleep efficiency", metric: "sleep-efficiency",
    value: 85 + i % 10, unit: "percent",
    externalRef: { system: "whoop", resourceType: "sleep", resourceId: `synthetic-${i}`, facet: "sleep_efficiency" },
  })).join("\n") + "\n");
  const hashes = new Set<string>();
  for (const stage of ["cold", "warm", "after-write"]) {
    if (stage === "after-write") {
      await appendFile(shard, JSON.stringify({
        schemaVersion: "murph.event.v1", id: "evt_synthetic_unrelated_note",
        kind: "note", occurredAt: "2026-07-01T12:00:00Z", recordedAt: "2026-07-01T12:00:00Z",
        source: "manual", title: "Synthetic unrelated note",
      }) + "\n");
    }
    const start = performance.now();
    const cpu = process.cpuUsage();
    const result = await showExperimentProgress({ vault: root, lookup: "synthetic", asOf: "2026-01-30" });
    const used = process.cpuUsage(cpu);
    const wallMs = performance.now() - start;
    const hash = createHash("sha256").update(JSON.stringify(result.progress)).digest("hex");
    hashes.add(hash);
    assert.ok(result.progress.signals.length > 0);
    console.log(JSON.stringify({ stage, events: count, days: 30, wallMs, cpuMs: (used.user + used.system) / 1_000, hash }));
  }
  assert.equal(hashes.size, 1, "an unrelated note must not change experiment results");
} finally {
  await rm(root, { recursive: true, force: true });
}
