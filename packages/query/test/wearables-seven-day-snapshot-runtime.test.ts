import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { test } from "vitest";

import {
  rebuildQueryProjection,
  summarizeWearableSevenDaySnapshotRuntime,
} from "../src/query-projection.ts";

test("seven-day snapshot runtime uses vault-local dates and keeps Apple SDNN separate", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-seven-day-"));
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: "2026-08-01T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "America/Los_Angeles",
      title: "Seven-day snapshot fixture",
      vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
    })}\n`,
    "utf8",
  );
  const events = [
    observation({
      dayKey: "2026-08-24",
      id: "evt_steps_2026_08_24",
      metric: "steps",
      value: 8_000,
      unit: "count",
    }),
    observation({
      dayKey: "2026-08-26",
      id: "evt_steps_2026_08_26",
      metric: "steps",
      value: 10_000,
      unit: "count",
    }),
    observation({
      dataOrigin: {
        version: 1,
        aggregatorProvider: "junction",
        sourceProviderSlug: "apple-health-kit",
        sourceType: "healthkit",
        normalizerVersion: "junction-normalizer.v1",
      },
      dayKey: "2026-08-25",
      id: "evt_apple_hrv_2026_08_25",
      metric: "hrv",
      value: 66,
      unit: "ms",
    }),
  ];
  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-08.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );

  try {
    await rebuildQueryProjection(vaultRoot);
    const snapshot = await summarizeWearableSevenDaySnapshotRuntime(vaultRoot, {
      metricKeys: ["steps", "hrv-rmssd", "hrv-sdnn"],
      now: "2026-09-01T02:00:00.000Z",
    });

    assert.equal(snapshot.reportingTimeZone, "America/Los_Angeles");
    assert.equal(snapshot.reportingTimeZoneSource, "vault_metadata");
    assert.deepEqual(snapshot.days, [
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
    assert.deepEqual(
      snapshot.metrics.find((metric) => metric.metricKey === "steps")?.values,
      [8_000, null, 10_000, null, null, null, null],
    );
    assert.deepEqual(
      snapshot.metrics.find((metric) => metric.metricKey === "hrv-sdnn")?.values,
      [null, 66, null, null, null, null, null],
    );
    assert.deepEqual(
      snapshot.metrics.find((metric) => metric.metricKey === "hrv-rmssd")?.values,
      [null, null, null, null, null, null, null],
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

function observation(input: {
  dataOrigin?: Record<string, unknown>;
  dayKey: string;
  id: string;
  metric: string;
  unit: string;
  value: number;
}): Record<string, unknown> {
  return {
    dataOrigin: input.dataOrigin,
    dayKey: input.dayKey,
    externalRef: {
      resourceId: `${input.id}-resource`,
      resourceType: "daily-summary",
      system: "junction",
    },
    id: input.id,
    kind: "observation",
    metric: input.metric,
    observationGrain: "daily-summary",
    occurredAt: `${input.dayKey}T12:00:00.000Z`,
    recordedAt: `${input.dayKey}T12:05:00.000Z`,
    schemaVersion: "murph.event.v1",
    source: "device",
    title: input.metric,
    unit: input.unit,
    value: input.value,
  };
}
