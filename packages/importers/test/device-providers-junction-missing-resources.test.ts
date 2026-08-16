import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as coreRuntime from "@murphai/core";
import { resolveMetricInputKey } from "@murphai/health-metrics";
import { test } from "vitest";

import {
  importDeviceProviderSnapshot,
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
  assert.equal(heartAlert?.externalRef?.facet, "heart-rate-alert");
  assert.deepEqual(heartAlert?.tags, ["heart-rate-alert-irregular-rhythm"]);

  for (const part of evidence) {
    assert.equal(Array.isArray(part.content), false);
    const encoded = JSON.stringify(part.content);
    assert.match(encoded, /junction\.sparse_timeseries_record\.v1/u);
    assert.match(encoded, /"sourceInstanceId"/u);
    assert.doesNotMatch(encoded, /"groups"|"data"|"providerRowId"/u);
  }

  assert.equal(
    payload.evidenceParts?.some((part) => part.role === "provider-snapshot"),
    false,
  );
  const retainedEvidenceJson = JSON.stringify(payload.evidenceParts ?? []);
  assert.doesNotMatch(retainedEvidenceJson, /"groups"|"data"/u);
  assert.equal(payload.ingestReceipt?.rawArtifactCount, payload.evidenceParts?.length);
});

test("Junction sparse clinical imports retain a deterministic bounded prefix", () => {
  const records = Array.from({ length: 128 }, (_, index) => {
    const startAt = new Date(Date.parse("2026-02-01T00:00:00.000Z") + index * 60_000);
    return {
      end: new Date(startAt.getTime() + 30_000).toISOString(),
      id: `clinical-row-${String(index).padStart(3, "0")}`,
      start: startAt.toISOString(),
      timestamp: startAt.toISOString(),
      unit: "L",
      value: 3.5,
    };
  });
  const normalize = (data: readonly Record<string, unknown>[]) => normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      forced_expiratory_volume_1: grouped(
        "apple_health_kit",
        "phone",
        "iphone-1",
        data,
      ),
    },
  });

  const forward = normalize(records);
  const reversed = normalize([...records].reverse());
  const identities = (payload: DeviceBatchImportPayload) => (payload.events ?? [])
    .map((event) => event.externalRef?.resourceId)
    .sort();
  const overflow = forward.evidenceParts?.find((part) =>
    part.role.endsWith(":bounded-overflow")
  );

  assert.equal(forward.events?.length, 100);
  assert.equal(forward.evidenceParts?.length, 101);
  assert.deepEqual(identities(forward), identities(reversed));
  assert.deepEqual(overflow?.content, {
    schema: "junction.sparse_timeseries_overflow.v1",
    provider: "junction",
    resource: "forced_expiratory_volume_1",
    validatedRecordCount: 128,
    retainedRecordCount: 100,
    droppedRecordCount: 28,
    status: "bounded_overflow",
  });
  assert.equal(
    (forward.events ?? []).at(-1)?.occurredAt,
    "2026-02-01T01:39:00.000Z",
  );
  assert.doesNotMatch(JSON.stringify(forward.evidenceParts), /clinical-row-/u);
});

test("Junction metabolic intervals admit one exact source-local instant and preserve real offsets", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-11-02T00:00:00.000Z",
    timeseries: {
      carbohydrates: grouped("freestyle_libre", "cgm", "libre-1", [
        {
          end: "2026-01-15T08:05:00+00:00",
          id: "ordinary",
          start: "2026-01-15T08:00:00+00:00",
          unit: "g",
          value: 30,
        },
        {
          end: "2026-03-08T02:20:00+00:00",
          id: "spring-gap",
          start: "2026-03-08T02:15:00+00:00",
          unit: "g",
          value: 31,
        },
        {
          end: "2026-11-01T01:20:00+00:00",
          id: "fall-overlap",
          start: "2026-11-01T01:15:00+00:00",
          unit: "g",
          value: 32,
        },
        {
          end: "2026-11-01T01:20:00-04:00",
          id: "first-offset",
          start: "2026-11-01T01:15:00-04:00",
          unit: "g",
          value: 33,
        },
        {
          end: "2026-11-01T01:20:00-05:00",
          id: "second-offset",
          start: "2026-11-01T01:15:00-05:00",
          unit: "g",
          value: 34,
        },
        {
          end: "2026-01-15T08:35:00-05:00",
          id: "mixed-floating-and-offset",
          start: "2026-01-15T08:30:00+00:00",
          unit: "g",
          value: 35,
        },
      ]),
      insulin_injection: grouped("freestyle_libre", "cgm", "libre-1", [{
        end: "2026-01-15T09:05:00+00:00",
        id: "insulin-ordinary",
        start: "2026-01-15T09:00:00+00:00",
        type: "rapid_acting",
        unit: "unit",
        value: 4,
      }]),
    },
  }, { defaultTimeZone: "America/New_York" });

  const carbohydrates = (payload.events ?? []).filter((event) =>
    event.kind === "observation" && event.fields?.metric === "carbohydrates"
  );
  const insulin = (payload.events ?? []).filter((event) =>
    event.kind === "intervention_session"
  );

  assert.deepEqual(
    carbohydrates.map((event) => event.occurredAt).sort(),
    [
      "2026-01-15T13:00:00.000Z",
      "2026-11-01T05:15:00.000Z",
      "2026-11-01T06:15:00.000Z",
    ],
  );
  assert.deepEqual(insulin.map((event) => event.occurredAt), ["2026-01-15T14:00:00.000Z"]);
  assert.equal((payload.events ?? []).length, 4);
  assert.equal(
    carbohydrates.find((event) => event.occurredAt === "2026-01-15T13:00:00.000Z")
      ?.dataOrigin?.normalizerVersion,
    "junction-sparse-timeseries.floating-fallback.v2",
  );
  assert.equal(
    carbohydrates.find((event) => event.occurredAt === "2026-11-01T05:15:00.000Z")
      ?.dataOrigin?.normalizerVersion,
    "junction-sparse-timeseries.v1",
  );
  const fallbackEvidence = payload.evidenceParts?.find((part) =>
    JSON.stringify(part.content).includes("2026-01-15T08:00:00+00:00")
  );
  const fallbackEvidenceJson = JSON.stringify(fallbackEvidence?.content);
  assert.match(fallbackEvidenceJson, /"startAtRaw":"2026-01-15T08:00:00\+00:00"/u);
  assert.match(fallbackEvidenceJson, /"endAtRaw":"2026-01-15T08:05:00\+00:00"/u);
  assert.doesNotMatch(fallbackEvidenceJson, /"occurredAt"|"startAt"|"endAt"/u);
});

test("Junction id-less Libre metabolic identity ignores mutable vault timezone", () => {
  const normalize = (defaultTimeZone: string) => normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      carbohydrates: grouped("freestyle_libre", "cgm", "libre-1", [
        {
          end: "2026-01-15T08:05:00+00:00",
          start: "2026-01-15T08:00:00+00:00",
          unit: "g",
          value: 30,
        },
        {
          end: "2026-01-15T08:15:00+00:00",
          start: "2026-01-15T08:10:00+00:00",
          unit: "g",
          value: 30,
        },
        {
          end: "2026-01-15T08:25:00-05:00",
          start: "2026-01-15T08:20:00-05:00",
          unit: "g",
          value: 30,
        },
      ]),
      insulin_injection: grouped("freestyle_libre", "cgm", "libre-1", [{
        end: "2026-01-15T09:05:00+00:00",
        start: "2026-01-15T09:00:00+00:00",
        type: "rapid_acting",
        unit: "unit",
        value: 4,
      }]),
    },
  }, { defaultTimeZone });
  const summarize = (payload: DeviceBatchImportPayload) => (payload.events ?? [])
    .map((event) => ({
      id: event.externalRef?.resourceId,
      occurredAt: event.occurredAt,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));

  const eastern = summarize(normalize("America/New_York"));
  const central = summarize(normalize("America/Chicago"));

  assert.deepEqual(
    eastern.map((event) => event.id),
    central.map((event) => event.id),
  );
  assert.equal(new Set(eastern.map((event) => event.id)).size, 4);
  assert.notDeepEqual(
    eastern.map((event) => event.occurredAt),
    central.map((event) => event.occurredAt),
  );
  assert.equal(
    eastern.some((event) => event.occurredAt === "2026-01-15T13:20:00.000Z"),
    true,
  );
  assert.equal(
    central.some((event) => event.occurredAt === "2026-01-15T13:20:00.000Z"),
    true,
  );
});

test("Junction Libre replays retain the canonical fallback-zone interpretation", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-junction-libre-canonical-time-"));
  const buildSnapshot = (input: {
    end: string;
    importedAt: string;
    insulinAmount: number;
  }) => ({
    accountId: "junction-account-libre-canonical-time",
    importedAt: input.importedAt,
    timeseries: {
      carbohydrates: grouped("freestyle_libre", "cgm", "libre-1", [{
        end: "2026-01-15T08:05:00+00:00",
        id: "carbohydrate-canonical-time",
        start: "2026-01-15T08:00:00+00:00",
        unit: "g",
        value: 30,
      }]),
      insulin_injection: grouped("freestyle_libre", "cgm", "libre-1", [{
        end: input.end,
        id: "insulin-canonical-time",
        start: "2026-01-15T09:00:00+00:00",
        type: "rapid_acting",
        unit: "unit",
        value: input.insulinAmount,
      }]),
    },
  });
  const importSnapshot = (snapshot: Record<string, unknown>) =>
    importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        snapshot,
        vaultRoot,
      },
      { corePort: coreRuntime },
    );
  const selectMetabolicEvents = (
    result: Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>,
  ) => ({
    carbohydrate: result.events.find((event) =>
      event.kind === "observation" && event.metric === "carbohydrates"
    ),
    insulin: result.events.find((event) =>
      event.kind === "intervention_session"
    ),
  });
  const readCanonicalEvent = async (
    event: Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>["events"][number] | undefined,
  ) => {
    const externalRef = event?.externalRef;
    assert.ok(externalRef);
    return coreRuntime.findEventByExternalRef({
      vaultRoot,
      system: externalRef.system,
      resourceType: externalRef.resourceType,
      resourceId: externalRef.resourceId,
      facet: externalRef.facet,
    });
  };

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      timezone: "America/New_York",
    });
    const first = selectMetabolicEvents(await importSnapshot(buildSnapshot({
      end: "2026-01-15T09:05:00+00:00",
      importedAt: "2026-02-01T00:00:00.000Z",
      insulinAmount: 4,
    })));

    assert.equal(first.carbohydrate?.occurredAt, "2026-01-15T13:00:00.000Z");
    assert.equal(first.carbohydrate?.timeZone, "America/New_York");
    assert.equal(first.insulin?.occurredAt, "2026-01-15T14:00:00.000Z");
    assert.equal(first.insulin?.timeZone, "America/New_York");

    await coreRuntime.updateVaultSummary({
      vaultRoot,
      timezone: "America/Chicago",
    });
    const replayResult = await importSnapshot(buildSnapshot({
      end: "2026-01-15T09:05:00+00:00",
      importedAt: "2026-02-02T00:00:00.000Z",
      insulinAmount: 4,
    }));
    const replay = {
      carbohydrate: await readCanonicalEvent(first.carbohydrate),
      insulin: await readCanonicalEvent(first.insulin),
    };

    assert.equal(replayResult.events.length, 0);
    assert.equal(replay.carbohydrate?.id, first.carbohydrate?.id);
    assert.equal(replay.carbohydrate?.occurredAt, first.carbohydrate?.occurredAt);
    assert.equal(replay.carbohydrate?.timeZone, first.carbohydrate?.timeZone);
    assert.equal(replay.insulin?.id, first.insulin?.id);
    assert.equal(replay.insulin?.occurredAt, first.insulin?.occurredAt);
    assert.equal(replay.insulin?.timeZone, first.insulin?.timeZone);
    assert.equal(replay.insulin?.lifecycle, undefined);

    const corrected = selectMetabolicEvents(await importSnapshot(buildSnapshot({
      end: "2026-01-15T09:20:00+00:00",
      importedAt: "2026-02-03T00:00:00.000Z",
      insulinAmount: 5,
    })));

    assert.equal(corrected.insulin?.id, first.insulin?.id);
    assert.equal(corrected.insulin?.occurredAt, first.insulin?.occurredAt);
    assert.equal(corrected.insulin?.timeZone, first.insulin?.timeZone);
    assert.equal(corrected.insulin?.lifecycle?.revision, 2);
    if (corrected.insulin?.kind !== "intervention_session") {
      assert.fail("expected corrected Libre insulin event");
    }
    assert.equal(corrected.insulin.fields?.["dose-amount"], 5);
    assert.equal(corrected.insulin.fields?.["start-at"], "2026-01-15T14:00:00.000Z");
    assert.equal(corrected.insulin.fields?.["end-at"], "2026-01-15T14:20:00.000Z");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction glucose summaries expose bounded population variability", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      glucose: grouped("dexcom", "cgm", "dexcom-1", [
        { timestamp: "2026-02-01T12:00:00.000Z", value: 5 },
        { timestamp: "2026-02-01T12:05:00.000Z", value: 7 },
      ]),
    },
  });

  const values = new Map(
    (payload.events ?? []).map((event) => [event.fields?.metric, event.fields?.value]),
  );
  assert.equal(values.get("glucose"), 108.1092);
  assert.equal(values.get("lowest-glucose"), 90.091);
  assert.equal(values.get("highest-glucose"), 126.1274);
  assert.equal(values.get("glucose-standard-deviation"), 18.0182);
  assert.equal(values.get("glucose-coefficient-of-variation"), 16.6667);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.evidenceParts?.length, 1);
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
        start: "not-a-timestamp",
        timestamp: TIMESTAMP,
        unit: "cm",
        value: 82,
      }]),
    },
  });

  assert.deepEqual(payload.events, []);
  assert.deepEqual(payload.evidenceParts, []);
});

test("Junction body resources require canonical zoned timestamps and positive intervals", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      fat: grouped("withings", "scale", "scale-1", [
        { timestamp: "2026-02-01T07:02:00-05:00", unit: "%", value: 18.1 },
        { timestamp: "2026-02-01", unit: "%", value: 18.2 },
        { timestamp: "2026-02-01T12:02:00", unit: "%", value: 18.3 },
        { observedAt: TIMESTAMP, unit: "%", value: 18.4 },
        { timestamp: "2026-02-30T12:02:00Z", unit: "%", value: 18.5 },
      ]),
      waist_circumference: grouped("withings", "scale", "scale-1", [
        {
          end: "2026-02-01T07:05:00-05:00",
          start: "2026-02-01T07:00:00-05:00",
          unit: "cm",
          value: 82,
        },
        { end: END, start: END, unit: "cm", value: 83 },
        {
          end: "2026-02-01T12:05:00",
          start: "2026-02-01T12:00:00",
          unit: "cm",
          value: 84,
        },
        { timestamp: TIMESTAMP, unit: "cm", value: 85 },
      ]),
    },
  });

  assert.deepEqual(
    (payload.events ?? []).map((event) => [event.fields?.metric, event.fields?.value]),
    [
      ["body-fat-percentage", 18.1],
      ["waist-circumference", 82],
    ],
  );
});

test("Junction sparse identity collapses provider replay and rejects ambiguous id-less body rows", () => {
  const records = [
    { id: "fat-row-1", timestamp: TIMESTAMP, unit: "%", value: 18 },
    { id: "fat-row-1", timestamp: TIMESTAMP, unit: "%", value: 18 },
    { id: "fat-row-2", timestamp: TIMESTAMP, unit: "%", value: 18 },
    { timestamp: TIMESTAMP, unit: "%", value: 19 },
    { timestamp: TIMESTAMP, unit: "%", value: 20 },
  ];
  const build = (orderedRecords: readonly Record<string, unknown>[]) => normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      fat: grouped("withings", "scale", "scale-1", orderedRecords),
    },
  });

  const first = build(records);
  const replay = build([...records].reverse());
  const identities = (payload: DeviceBatchImportPayload) => (payload.events ?? [])
    .map((event) => `${event.externalRef?.resourceId}:${event.externalRef?.facet}`)
    .sort();

  assert.equal(first.events?.length, 2);
  assert.deepEqual(identities(first), identities(replay));
  assert.equal(new Set(identities(first)).size, 2);
  assert.equal(first.evidenceParts?.length, 2);
  assert.equal(replay.evidenceParts?.length, 2);
  assert.equal(
    new Set(
      (first.events ?? [])
        .filter((event) => event.fields?.value === 18)
        .map((event) => event.externalRef?.resourceId),
    ).size,
    2,
  );
});

test("Junction id-less body corrections retain one stable external identity", () => {
  const normalizeValue = (value: number) => normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      fat: grouped("withings", "scale", "scale-1", [{
        timestamp: TIMESTAMP,
        unit: "%",
        value,
      }]),
    },
  });
  const original = normalizeValue(19).events?.[0];
  const corrected = normalizeValue(20).events?.[0];

  assert.ok(original);
  assert.ok(corrected);
  assert.equal(corrected.externalRef?.resourceId, original.externalRef?.resourceId);
  assert.equal(corrected.fields?.value, 20);
});

test("Junction sparse provider-row identity excludes alert and intervention corrections", () => {
  const normalizeOne = (
    resource: "heart_rate_alert" | "insulin_injection",
    record: Record<string, unknown>,
  ) => normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      [resource]: grouped("apple_health_kit", "watch", "watch-1", [record]),
    },
  }).events?.[0];

  const highAlert = normalizeOne("heart_rate_alert", {
    end: END,
    id: "heart-alert-correction",
    start: START,
    type: "high",
    unit: "count",
    value: 1,
  });
  const lowAlert = normalizeOne("heart_rate_alert", {
    end: END,
    id: "heart-alert-correction",
    start: START,
    type: "low",
    unit: "count",
    value: 1,
  });
  const mealBolus = normalizeOne("insulin_injection", {
    bolus_purpose: "meal",
    delivery_form: "rapid_acting",
    delivery_mode: "pump",
    end: END,
    id: "insulin-correction",
    start: START,
    type: "insulin_lispro",
    unit: "unit",
    value: 4,
  });
  const correctionBolus = normalizeOne("insulin_injection", {
    bolus_purpose: "correction",
    delivery_form: "short_acting",
    delivery_mode: "pen",
    end: END,
    id: "insulin-correction",
    start: START,
    type: "regular_insulin",
    unit: "unit",
    value: 5,
  });

  assert.ok(highAlert);
  assert.ok(lowAlert);
  assert.equal(lowAlert.externalRef?.resourceId, highAlert.externalRef?.resourceId);
  assert.equal(highAlert.externalRef?.facet, "heart-rate-alert");
  assert.equal(lowAlert.externalRef?.facet, "heart-rate-alert");
  assert.notDeepEqual(lowAlert.tags, highAlert.tags);
  assert.ok(mealBolus);
  assert.ok(correctionBolus);
  assert.equal(correctionBolus.externalRef?.resourceId, mealBolus.externalRef?.resourceId);
  assert.equal(mealBolus.externalRef?.facet, "insulin-injection");
  assert.equal(correctionBolus.externalRef?.facet, "insulin-injection");
  assert.notDeepEqual(correctionBolus.fields, mealBolus.fields);
});

test("Junction sparse identity rejects conflicting bodies for one provider row deterministically", () => {
  const build = (orderedRecords: readonly Record<string, unknown>[]) => normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      fat: grouped("withings", "scale", "scale-1", orderedRecords),
    },
  });
  const records = [
    { id: "fat-row-conflict", timestamp: TIMESTAMP, unit: "%", value: 18 },
    { id: "fat-row-keep", timestamp: TIMESTAMP, unit: "%", value: 20 },
    { id: "fat-row-conflict", timestamp: TIMESTAMP, unit: "%", value: 19 },
  ];

  const forward = build(records);
  const reversed = build([...records].reverse());
  const summarize = (payload: DeviceBatchImportPayload) => (payload.events ?? [])
    .map((event) => ({
      resourceId: event.externalRef?.resourceId,
      value: event.fields?.value,
    }))
    .sort((left, right) => String(left.resourceId).localeCompare(String(right.resourceId)));

  assert.deepEqual(summarize(forward), summarize(reversed));
  assert.deepEqual((forward.events ?? []).map((event) => event.fields?.value), [20]);
  assert.deepEqual((reversed.events ?? []).map((event) => event.fields?.value), [20]);
  assert.equal(forward.evidenceParts?.length, 1);
  assert.equal(reversed.evidenceParts?.length, 1);
  assert.doesNotMatch(JSON.stringify(forward.evidenceParts), /fat-row-conflict/u);
  assert.doesNotMatch(JSON.stringify(reversed.evidenceParts), /fat-row-conflict/u);
});

test("Junction sparse provider-row corrections revise one canonical event and exact replay no-ops", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-junction-sparse-row-revision-"));
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-02-01T00:00:00.000Z",
      timezone: "UTC",
    });
    const buildSnapshot = (input: {
      importedAt: string;
      timestamp: string;
      value: number;
    }) => ({
      accountId: "junction-account-sparse-revision",
      importedAt: input.importedAt,
      timeseries: {
        fat: grouped("withings", "scale", "scale-1", [{
          id: "fat-row-revision",
          timestamp: input.timestamp,
          unit: "%",
          value: input.value,
        }]),
      },
    });
    const importSnapshot = (snapshot: Record<string, unknown>) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        {
          provider: "junction",
          snapshot,
          vaultRoot,
        },
        { corePort: coreRuntime },
      );

    const first = await importSnapshot(buildSnapshot({
      importedAt: "2026-02-02T00:00:00.000Z",
      timestamp: "2026-02-01T12:02:00.000Z",
      value: 18,
    }));
    const correctedSnapshot = buildSnapshot({
      importedAt: "2026-02-03T00:00:00.000Z",
      timestamp: "2026-02-01T12:03:00.000Z",
      value: 19,
    });
    const corrected = await importSnapshot(correctedSnapshot);
    const replay = await importSnapshot(correctedSnapshot);
    const firstEvent = first.events.find((event) =>
      event.kind === "observation" && event.metric === "body-fat-percentage"
    );
    const correctedEvent = corrected.events.find((event) =>
      event.kind === "observation" && event.metric === "body-fat-percentage"
    );

    assert.ok(firstEvent);
    assert.ok(correctedEvent);
    if (correctedEvent.kind !== "observation") {
      assert.fail("expected corrected Junction sparse event to remain an observation");
    }
    assert.equal(correctedEvent.id, firstEvent.id);
    assert.equal(correctedEvent.lifecycle?.revision, 2);
    assert.equal(correctedEvent.value, 19);
    assert.equal(correctedEvent.occurredAt, "2026-02-01T12:03:00.000Z");
    assert.equal(correctedEvent.externalRef?.resourceId, firstEvent.externalRef?.resourceId);
    assert.equal(correctedEvent.externalRef?.facet, "body-fat-percentage");
    assert.equal(replay.applied, false);
    assert.equal(replay.ingestId, null);
    assert.equal(replay.persistedEvidencePartCount, 0);

    const buildIdlessSnapshot = (input: { importedAt: string; value: number }) => ({
      accountId: "junction-account-sparse-idless-revision",
      importedAt: input.importedAt,
      timeseries: {
        fat: grouped("withings", "scale", "scale-1", [{
          timestamp: "2026-02-01T14:02:00.000Z",
          unit: "%",
          value: input.value,
        }]),
      },
    });
    const idlessFirst = await importSnapshot(buildIdlessSnapshot({
      importedAt: "2026-02-04T00:00:00.000Z",
      value: 20,
    }));
    const idlessCorrected = await importSnapshot(buildIdlessSnapshot({
      importedAt: "2026-02-05T00:00:00.000Z",
      value: 21,
    }));
    const idlessFirstEvent = idlessFirst.events.find((event) =>
      event.kind === "observation" && event.metric === "body-fat-percentage"
    );
    const idlessCorrectedEvent = idlessCorrected.events.find((event) =>
      event.kind === "observation" && event.metric === "body-fat-percentage"
    );

    assert.ok(idlessFirstEvent);
    assert.ok(idlessCorrectedEvent);
    if (idlessCorrectedEvent.kind !== "observation") {
      assert.fail("expected corrected id-less Junction body event to remain an observation");
    }
    assert.equal(idlessCorrectedEvent.id, idlessFirstEvent.id);
    assert.equal(idlessCorrectedEvent.lifecycle?.revision, 2);
    assert.equal(idlessCorrectedEvent.value, 21);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
