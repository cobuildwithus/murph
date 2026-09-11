import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { listAutomations } from "@murphai/query";

// Disposable synthetic archive history with one active and one paused record.
// Use the shared container resource probe for whole-container memory and CPU.
const count = Number(process.env.MURPH_AUTOMATION_BENCH_COUNT ?? 2_000);
assert.ok(Number.isSafeInteger(count) && count >= 2 && count <= 50_000);
const vault = await mkdtemp(path.join(tmpdir(), "murph-automation-bench-"));
try {
  const directory = path.join(vault, "bank/automations");
  await mkdir(directory, { recursive: true });
  for (let offset = 0; offset < count; offset += 16) {
    await Promise.all(Array.from({ length: Math.min(16, count - offset) }, (_, index) => {
      const id = String(offset + index).padStart(6, "0");
      const status = offset + index === 0 ? "active" : offset + index === 1 ? "paused" : "archived";
      return writeFile(path.join(directory, `${id}.md`), [
        "---",
        "schemaVersion: murph.frontmatter.automation.v1",
        "docType: automation",
        `automationId: auto_${id}`,
        `slug: synthetic-${id}`,
        `title: Synthetic ${id}`,
        `status: ${status}`,
        "schedule:",
        "  kind: every",
        "  everyMs: 60000",
        "route:",
        "  channel: telegram",
        "  threadIsDirect: true",
        "  participantId: synthetic-actor",
        "  threadId: synthetic-thread",
        "createdAt: 2026-01-01T00:00:00.000Z",
        "updatedAt: 2026-01-02T00:00:00.000Z",
        "---",
        "Synthetic optional follow-up instructions. ".repeat(32),
      ].join("\n"));
    }));
  }
  let firstSemanticHash: string | undefined;
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    const cpu = process.cpuUsage();
    const records = await listAutomations(vault, { status: ["active", "paused"] });
    const cpuUsed = process.cpuUsage(cpu);
    const wallMs = performance.now() - start;
    assert.deepEqual(records.map((record) => [record.automationId, record.status]), [
      ["auto_000000", "active"],
      ["auto_000001", "paused"],
    ]);
    const semanticHash = createHash("sha256").update(JSON.stringify(records)).digest("hex");
    firstSemanticHash ??= semanticHash;
    assert.equal(semanticHash, firstSemanticHash);
    console.log(JSON.stringify({
      benchmark: "automation",
      count, run, wallMs,
      cpuMs: (cpuUsed.user + cpuUsed.system) / 1_000,
      rssBytes: process.memoryUsage().rss,
      selected: records.length,
      semanticHash,
    }));
  }
} finally {
  await rm(vault, { recursive: true, force: true });
}
