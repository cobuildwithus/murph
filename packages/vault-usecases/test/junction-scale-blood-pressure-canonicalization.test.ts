import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as coreRuntime from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { listMetricPointsBatch } from "@murphai/query";
import { test } from "vitest";

test("Junction scale and blood-pressure readings survive as canonical vault metrics", async () => {
  const parentRoot = await mkdtemp(
    path.join(tmpdir(), "junction-scale-blood-pressure-"),
  );
  const vaultRoot = path.join(parentRoot, "vault");

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-08-08T00:00:00.000Z",
      timezone: "UTC",
      vaultRoot,
    });

    await importDeviceProviderSnapshot(
      {
        provider: "junction",
        sourceKind: "poll",
        deliveryMode: "scheduled_reconcile",
        vaultRoot,
        snapshot: {
          accountId: "junction-connected-device-account",
          importedAt: "2026-08-08T13:00:00.000Z",
          summaries: {
            body: [{
              provider_slug: "withings",
              source_type: "scale",
              observedAt: "2026-08-08T12:00:00.000Z",
              weight_kg: 82.5,
              body_fat_percentage: 16.2,
            }],
          },
          timeseries: {
            blood_pressure: [{
              sourceProviderSlug: "omron",
              timestamp: "2026-08-08T12:05:00.000Z",
              systolic: 121,
              diastolic: 79,
            }],
          },
        },
      },
      { corePort: coreRuntime },
    );

    const canonicalRecords = await coreRuntime.readJsonlRecords({
      vaultRoot,
      relativePath: "ledger/events/2026-08.jsonl",
    });
    assert.ok(canonicalRecords.some((record) =>
      record.kind === "observation"
      && record.metric === "weight"
      && record.value === 82.5
    ));
    assert.ok(canonicalRecords.some((record) =>
      record.kind === "measurement"
      && Array.isArray(record.measurements)
      && record.measurements.some((measurement) =>
        measurement.metric === "systolic-blood-pressure"
        && measurement.value === 121
        && measurement.unit === "mmHg"
      )
      && record.measurements.some((measurement) =>
        measurement.metric === "diastolic-blood-pressure"
        && measurement.value === 79
        && measurement.unit === "mmHg"
      )
    ));

    const points = await listMetricPointsBatch(vaultRoot, [
      { metricKey: "body-weight", limit: 1 },
      { metricKey: "systolic-blood-pressure", limit: 1 },
      { metricKey: "diastolic-blood-pressure", limit: 1 },
    ]);
    const bodyWeight = points.find((point) => point.metricKey === "body-weight");
    const systolic = points.find(
      (point) => point.metricKey === "systolic-blood-pressure",
    );
    const diastolic = points.find(
      (point) => point.metricKey === "diastolic-blood-pressure",
    );

    assert.equal(bodyWeight?.effectiveDate, "2026-08-08");
    assert.equal(bodyWeight?.canonicalValue, 82.5);
    assert.equal(bodyWeight?.canonicalUnit, "kg");
    assert.equal(systolic?.effectiveDate, "2026-08-08");
    assert.equal(systolic?.canonicalValue, 121);
    assert.equal(systolic?.canonicalUnit, "mmHg");
    assert.equal(diastolic?.effectiveDate, "2026-08-08");
    assert.equal(diastolic?.canonicalValue, 79);
    assert.equal(diastolic?.canonicalUnit, "mmHg");
    assert.equal(systolic?.source.recordId, diastolic?.source.recordId);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
