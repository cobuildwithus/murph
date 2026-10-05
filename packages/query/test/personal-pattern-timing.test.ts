import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { initializeVault } from "@murphai/core";
import { withCliTiming, timeCliDispatch } from "@murphai/runtime-state/node/cli-timing";
import { normalizeCliTiming, type CliTiming } from "@murphai/runtime-state/cli-timing";
import { buildPersonalPatternReportRuntime } from "../src/query-projection.ts";

const expectedPhases = ["query-entity-read", "query-wearable-compose", "query-metric-read", "query-pattern-report"];
test("Patterns cold and fresh public reads report each post-freshness stage without changing the report", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-pattern-timing-"));
  try {
    await initializeVault({ vaultRoot: vault, timezone: "UTC", createdAt: "2026-01-01T00:00:00Z" });
    await mkdir(path.join(vault, "ledger/events/2026"), { recursive: true });
    await writeFile(path.join(vault, "ledger/events/2026/2026-01.jsonl"), Array.from({ length: 20 }, (_, index) => {
      const date = `2026-01-${String(index + 1).padStart(2, "0")}`;
      return JSON.stringify({ schemaVersion: "murph.event.v1", id: `evt_synthetic_timing_${index}`,
        kind: "observation", source: "device", dayKey: date, occurredAt: `${date}T07:00:00Z`,
        recordedAt: `${date}T08:00:00Z`, title: "Synthetic HRV", metric: "hrv", value: 50, unit: "ms",
        externalRef: { system: "oura", resourceType: "readiness", resourceId: `synthetic_${index}` } });
    }).join("\n") + "\n");
    const options = { asOf: "2026-01-21", windowDays: 30 };
    const results: Awaited<ReturnType<typeof buildPersonalPatternReportRuntime>>[] = [];
    for (const cold of [true, false]) {
      let timing: CliTiming | undefined;
      await withCliTiming(() => timeCliDispatch("wearables patterns", async () => {
        results.push(await buildPersonalPatternReportRuntime(vault, options));
      }), report => { timing = report; });
      assert.ok(timing);
      assert.deepEqual(normalizeCliTiming(timing), timing);
      assert.equal(timing.droppedSpans + timing.droppedCalls, 0);
      const phases = timing.commands[0]!.phases;
      assert.deepEqual(phases.filter(phase => expectedPhases.includes(phase.phase)).map(phase => [phase.phase, phase.count]),
        expectedPhases.map(phase => [phase, 1]));
      assert.equal(phases.some(phase => phase.phase === "query-rebuild"), cold);
      assert.ok(Buffer.byteLength(JSON.stringify(timing)) < 7500);
    }
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[0], await buildPersonalPatternReportRuntime(vault, options));
  } finally { await rm(vault, { recursive: true, force: true }); }
});
