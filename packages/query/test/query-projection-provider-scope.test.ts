import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  rebuildQueryProjection,
  summarizeWearableActivityRuntime,
} from "../src/index.ts";

test("runtime wearable provider filters do not fall back to all-provider summaries", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-provider-scope-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl");

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    await writeFile(
      eventLedgerPath,
      Array.from({ length: 7 }, (_, index) => JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: `evt_provider_scope_steps_${index}`,
        kind: "observation",
        occurredAt: "2026-03-20T07:00:00Z",
        recordedAt: "2026-03-20T07:01:00Z",
        dayKey: "2026-03-20",
        source: "device",
        title: `Provider ${index} steps`,
        metric: "steps",
        value: 5000 + index,
        unit: "count",
        externalRef: {
          system: `wearable${index}`,
          resourceType: "daily_activity",
          resourceId: `daily-activity-2026-03-20-${index}`,
        },
      })).join("\n").concat("\n"),
    );
    await rebuildQueryProjection(vaultRoot);

    const absentProvider = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-03-20",
      providers: ["absent-provider"],
    });
    const nonMaterializedProviderPair = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-03-20",
      providers: ["wearable0", "wearable1"],
    });
    const normalizedSingleProvider = await summarizeWearableActivityRuntime(vaultRoot, {
      date: "2026-03-20",
      providers: [" WEARABLE0 ", "wearable0"],
    });

    assert.deepEqual(absentProvider, []);
    assert.deepEqual(nonMaterializedProviderPair, []);
    assert.equal(normalizedSingleProvider[0]?.steps.selection.provider, "wearable0");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
