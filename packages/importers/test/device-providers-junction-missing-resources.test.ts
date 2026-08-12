import assert from "node:assert/strict";
import { resolveMetricInputKey } from "@murphai/health-metrics";
import { test } from "vitest";

import {
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
  type DeviceBatchImportPayload,
} from "../src/index.ts";

const START = "2026-02-01T12:00:00.000Z";
const END = "2026-02-01T12:05:00.000Z";
const TIMESTAMP = "2026-02-01T12:02:00.000Z";

function grouped(
  provider: string,
  type: string,
  deviceId: string,
  data: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    groups: {
      [provider]: [{
        data,
        source: {
          device_id: deviceId,
          provider,
          type,
        },
      }],
    },
  };
}

function validSparseSnapshot(): Record<string, unknown> {
  return {
    accountId: "junction-account-sparse-1",
    importedAt: "2026-02-02T00:00:00.000Z",
    windowStart: "2026-02-01T00:00:00.000Z",
    windowEnd: "2026-02-02T00:00:00.000Z",
    timeseries: {
      body_mass_index: grouped("withings", "scale", "scale-1", [{
        end: END,
        id: "bmi-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "index",
        value: 23.4,
      }]),
      carbohydrates: grouped("cronometer", "nutrition_app", "crono-1", [{
        end: END,
        id: "carbs-1",
        start: START,
        unit: "g",
        value: 48,
      }]),
      fat: grouped("withings", "scale", "scale-1", [{
        id: "fat-1",
        timestamp: TIMESTAMP,
        unit: "%",
        value: 18.5,
      }]),
      forced_expiratory_volume_1: grouped("apple_health_kit", "phone", "iphone-1", [{
        end: END,
        id: "fev1-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "L",
        value: 3.52,
      }]),
      forced_vital_capacity: grouped("apple_health_kit", "phone", "iphone-1", [{
        end: END,
        id: "fvc-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "L",
        value: 4.31,
      }]),
      heart_rate_alert: grouped("apple_health_kit", "watch", "watch-1", [{
        end: END,
        id: "heart-alert-1",
        start: START,
        type: "irregular_rhythm",
        unit: "count",
        value: 1,
      }]),
      inhaler_usage: grouped("apple_health_kit", "phone", "iphone-1", [{
        end: END,
        id: "inhaler-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "count",
        value: 2,
      }]),
      insulin_injection: grouped("apple_health_kit", "phone", "iphone-1", [{
        bolus_purpose: "meal_correction",
        delivery_form: "rapid_acting",
        delivery_mode: "pump",
        end: END,
        id: "insulin-1",
        start: START,
        type: "insulin_lispro",
        unit: "unit",
        value: 4.5,
      }]),
      lean_body_mass: grouped("withings", "scale", "scale-1", [{
        end: END,
        id: "lean-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "kg",
        value: 61.2,
      }]),
      peak_expiratory_flow_rate: grouped("apple_health_kit", "phone", "iphone-1", [{
        end: END,
        id: "peak-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "L/min",
        value: 475,
      }]),
      sleep_apnea_alert: grouped("apple_health_kit", "watch", "watch-1", [{
        end: END,
        id: "apnea-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "count",
        value: 1,
      }]),
      waist_circumference: grouped("withings", "scale", "scale-1", [{
        end: END,
        id: "waist-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "cm",
        value: 82.4,
      }]),
    },
  };
}

test("Junction missing-resource slice preserves sparse official facts and compact provenance", async () => {
  const snapshot = validSparseSnapshot();
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-sparse-1",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    snapshot,
  });

  const events = payload.events ?? [];
  const observations = events.filter((event) => event.kind === "observation");
  const insulin = events.find((event) => event.kind === "intervention_session");
  const evidence = payload.evidenceParts?.filter((part) =>
    part.role.startsWith("junction-timeseries-reading-")
  ) ?? [];

  assert.equal(events.length, 12);
  assert.equal(observations.length, 11);
  assert.equal(evidence.length, 12);
  assert.deepEqual(
    observations.map((event) => event.fields?.metric).sort(),
    [
      "bmi",
      "body-fat-percentage",
      "carbohydrates",
      "forced-expiratory-volume-1",
      "forced-vital-capacity",
      "heart-rate-alert",
      "inhaler-usage",
      "lean-body-mass",
      "peak-expiratory-flow-rate",
      "sleep-apnea-alert",
      "waist-circumference",
    ].sort(),
  );
  for (const event of observations) {
    const metric = event.fields?.metric;
    if (typeof metric === "string") {
      assert.equal(resolveMetricInputKey(metric), metric);
    } else {
      assert.fail("Sparse Junction observations require a metric string.");
    }
    assert.equal(event.fields?.observationGrain, "sample");
    assert.ok(event.externalRef?.resourceId);
    assert.ok(event.dataOrigin?.sourceProviderSlug);
    assert.ok(event.dataOrigin?.sourceType);
    assert.ok(event.dataOrigin?.sourceInstanceId);
  }

  assert.equal(insulin?.fields?.interventionType, "insulin-injection");
  assert.equal(insulin?.fields?.sessionStatus, "completed");
  assert.deepEqual(insulin?.fields?.fields, {
    "bolus-purpose": "meal_correction",
    "delivery-form": "rapid_acting",
    "delivery-mode": "pump",
    "dose-amount": 4.5,
    "dose-unit": "unit",
    "end-at": END,
    "insulin-type": "insulin_lispro",
    "start-at": START,
  });

  const heartAlert = observations.find((event) => event.fields?.metric === "heart-rate-alert");
  assert.equal(heartAlert?.externalRef?.facet, "irregular_rhythm");
  assert.deepEqual(heartAlert?.tags, ["heart-rate-alert-irregular-rhythm"]);

  for (const part of evidence) {
    assert.equal(Array.isArray(part.content), false);
    const encoded = JSON.stringify(part.content);
    assert.match(encoded, /junction\.sparse_timeseries_record\.v1/u);
    assert.match(encoded, /"sourceInstanceId"/u);
    assert.doesNotMatch(encoded, /"groups"|"data"/u);
  }

  assert.equal(
    payload.evidenceParts?.some((part) => part.role === "provider-snapshot"),
    false,
  );
  const retainedEvidenceJson = JSON.stringify(payload.evidenceParts ?? []);
  assert.doesNotMatch(retainedEvidenceJson, /"groups"|"data"/u);
  assert.equal(payload.ingestReceipt?.rawArtifactCount, payload.evidenceParts?.length);
});

test("Junction missing-resource slice rejects malformed values, units, intervals, and alert types", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      body_mass_index: grouped("withings", "scale", "scale-1", [{
        end: END,
        start: START,
        timestamp: TIMESTAMP,
        unit: "%",
        value: 23.4,
      }]),
      fat: grouped("withings", "scale", "scale-1", [{
        timestamp: TIMESTAMP,
        unit: "%",
        value: Number.POSITIVE_INFINITY,
      }]),
      forced_expiratory_volume_1: grouped("apple_health_kit", "phone", "iphone-1", [{
        end: END,
        start: START,
        timestamp: TIMESTAMP,
        unit: "L",
        value: 99,
      }]),
      heart_rate_alert: grouped("apple_health_kit", "watch", "watch-1", [{
        end: END,
        start: START,
        type: "ecg_diagnosis",
        unit: "count",
        value: 1,
      }]),
      inhaler_usage: grouped("apple_health_kit", "phone", "iphone-1", [{
        end: END,
        start: START,
        timestamp: TIMESTAMP,
        unit: "count",
        value: 1.5,
      }]),
      insulin_injection: grouped("apple_health_kit", "phone", "iphone-1", [{
        end: START,
        start: END,
        unit: "unit",
        value: 4,
      }]),
      waist_circumference: grouped("withings", "scale", "scale-1", [{
        end: END,
        start: START,
        timestamp: "not-a-timestamp",
        unit: "cm",
        value: 82,
      }]),
    },
  });

  assert.deepEqual(payload.events, []);
  assert.deepEqual(payload.evidenceParts, []);
});

test("Junction sparse identity is stable across duplicate replay and reordering while preserving distinct same-time rows", () => {
  const records = [
    { id: "fat-row-1", timestamp: TIMESTAMP, unit: "%", value: 18 },
    { id: "fat-row-1", timestamp: TIMESTAMP, unit: "%", value: 18 },
    { id: "fat-row-2", timestamp: TIMESTAMP, unit: "%", value: 18 },
    { id: "fat-row-2", timestamp: TIMESTAMP, unit: "%", value: 19 },
    { timestamp: TIMESTAMP, unit: "%", value: 19 },
    { timestamp: TIMESTAMP, unit: "%", value: 20 },
  ];
  const build = (orderedRecords: readonly Record<string, unknown>[]) => normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      fat: {
        groups: {
          withings: [{
            data: orderedRecords,
            source: { device_id: "scale-1", provider: "withings", type: "scale" },
          }],
          apple_health_kit: [{
            data: [{ timestamp: TIMESTAMP, unit: "%", value: 18 }],
            source: { device_id: "phone-1", provider: "apple_health_kit", type: "phone" },
          }],
        },
      },
    },
  });

  const first = build(records);
  const replay = build([...records].reverse());
  const identities = (payload: DeviceBatchImportPayload) => (payload.events ?? [])
    .map((event) => `${event.externalRef?.resourceId}:${event.externalRef?.facet}`)
    .sort();

  assert.equal(first.events?.length, 6);
  assert.deepEqual(identities(first), identities(replay));
  assert.equal(new Set(identities(first)).size, 6);
  assert.equal(first.evidenceParts?.length, 6);
  assert.equal(replay.evidenceParts?.length, 6);
});
