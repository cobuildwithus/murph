import assert from "node:assert/strict";
import { workoutSessionSchema } from "@murphai/contracts";
import { test } from "vitest";

import {
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
  resolveJunctionOrigin,
} from "../src/index.ts";

function assertWorkoutSessionsMatchContract(events: readonly { fields?: { workout?: unknown } }[]): void {
  for (const event of events) {
    if (event.fields?.workout === undefined) {
      continue;
    }

    const result = workoutSessionSchema.safeParse(event.fields.workout);
    assert.equal(
      result.success,
      true,
      result.success ? undefined : `workout contract paths: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
}

test("resolveJunctionOrigin accepts Junction attribution aliases", () => {
  const slugCases: Array<[string, Record<string, unknown>]> = [
    ["sourceProviderSlug", { sourceProviderSlug: "oura" }],
    ["source_provider_slug", { source_provider_slug: "oura" }],
    ["sourceProvider", { sourceProvider: "oura" }],
    ["source_provider", { source_provider: "oura" }],
    ["provider", { provider: "oura" }],
    ["providerSlug", { providerSlug: "oura" }],
    ["provider_slug", { provider_slug: "oura" }],
    ["source.provider", { source: { provider: "oura" } }],
    ["source.slug", { source: { slug: "oura" } }],
    ["source.provider_slug", { source: { provider_slug: "oura" } }],
    ["source.providerSlug", { source: { providerSlug: "oura" } }],
    ["provider.provider", { provider: { provider: "oura" } }],
    ["provider.name", { provider: { name: "oura" } }],
  ];

  for (const [label, record] of slugCases) {
    assert.equal(resolveJunctionOrigin(record).sourceProviderSlug, "oura", label);
  }
  assert.equal(
    resolveJunctionOrigin({
      provider: "junction",
      source: { provider: "oura" },
    }).sourceProviderSlug,
    "oura",
    "later real source provider is not masked by aggregator provider",
  );

  assert.equal(resolveJunctionOrigin({}, { groupedSourceSlug: "polar" }).sourceProviderSlug, "polar");
  assert.equal(resolveJunctionOrigin({ provider: { name: "Oura Ring" } }).sourceProviderSlug, undefined);

  const origin = resolveJunctionOrigin({
    source_type: "ring",
    source: {
      device_id: "raw-ring-device",
      app_id: "raw-oura-app",
    },
  }, {
    groupedSourceSlug: "oura",
  });

  assert.equal(origin.sourceProviderSlug, "oura");
  assert.equal(origin.sourceType, "ring");
  assert.match(origin.sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/u);
  assert.equal(origin.sourceInstanceId?.includes("raw-ring-device"), false);
  assert.equal(origin.sourceInstanceId?.includes("raw-oura-app"), false);

  const flatOrigin = resolveJunctionOrigin({
    sourceProviderSlug: "withings",
    sourceDeviceId: "raw-scale-device",
    source_app_id: "raw-withings-app",
  });
  assert.equal(flatOrigin.sourceProviderSlug, "withings");
  assert.match(flatOrigin.sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/u);
  assert.equal(flatOrigin.sourceInstanceId?.includes("raw-scale-device"), false);
  assert.equal(flatOrigin.sourceInstanceId?.includes("raw-withings-app"), false);
});

test("Junction snapshot adapter preserves aggregator identity and upstream source provenance", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_01",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-22T12:00:00.000Z",
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-22T23:59:59.000Z",
      connections: [
        {
          id: "source-oura",
          sourceProviderSlug: "oura",
          sourceName: "Oura Ring",
          sourceType: "ring",
          sourceDeviceId: "device-oura-ring-1",
          sourceAppId: "app-oura-cloud-1",
          originConfidence: "high",
        },
        {
          id: "source-withings",
          sourceProviderSlug: "withings",
          sourceName: "Withings",
          sourceType: "scale",
        },
        {
          id: "source-dexcom",
          sourceProviderSlug: "dexcom_v3",
          sourceName: "Dexcom",
          sourceType: "cgm",
        },
      ],
      summaries: {
        profile: {
          connectionId: "source-oura",
          displayName: "Oura profile",
        },
        activity: [
          {
            connectionId: "source-oura",
            observedAt: "2026-04-22T12:00:00Z",
            steps: 7200,
          },
          {
            connectionId: "source-withings",
            observedAt: "2026-04-22T12:00:00Z",
            steps: 7100,
          },
        ],
        sleep: [{
          connectionId: "source-oura",
          id: "sleep-a",
          observedAt: "2026-04-22T07:00:00+00:00",
          startAt: "2026-04-21T23:00:00+00:00",
          endAt: "2026-04-22T07:00:00+00:00",
          sleepScore: 88,
          totalSleepMinutes: 430,
        }],
        sleep_cycle: [{
          connectionId: "source-oura",
          observedAt: "2026-04-22T07:00:00+00:00",
          stage_count: 4,
        }],
        workouts: [{
          connectionId: "source-oura",
          id: "workout-a",
          startAt: "2026-04-22T10:00:00+00:00",
          endAt: "2026-04-22T10:45:00+00:00",
          activityType: "run",
          distanceKm: 7.2,
        }],
        body: [{
          connectionId: "source-withings",
          observedAt: "2026-04-22 17:00:00",
          timestampSemantics: "floating",
          timeZoneOffsetMinutes: null,
          weight_kg: 82.4,
        }],
        glucose: [{
          connectionId: "source-withings",
          observedAt: "2026-04-22T17:00:00Z",
          value: 101,
        }],
      },
      timeseries: {
        heartrate: [{
          connectionId: "source-oura",
          timestamp: "2026-04-22T07:15:00+00:00",
          value: 54,
        }],
        blood_oxygen: [{
          connectionId: "source-oura",
          timestamp: "2026-04-22 07:16:00",
          timestampSemantics: "floating",
          value: 97,
        }],
        glucose: [{
          connectionId: "source-dexcom",
          timestamp: "2026-04-22T07:16:00Z",
          value: 101,
        }],
      },
    },
  });

  assert.equal(payload.provider, "junction");
  assert.equal(payload.accountId, "junction-account-hash-1");
  assert.deepEqual(payload.provenance?.summaryResources, JUNCTION_DEFAULT_SUMMARY_RESOURCES);
  assert.deepEqual(payload.provenance?.timeseriesResources, [
    "heartrate",
    "blood_oxygen",
    "glucose",
  ]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-activity"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-heartrate"));
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role.includes("glucose")), true);

  const observations = payload.events ?? [];
  const samples = payload.samples ?? [];
  assert.ok(observations.length >= 5);
  assert.equal(samples.length, 0);
  assert.ok(observations.every((event) => event.externalRef?.system === "junction"));
  assert.ok(observations.every((event) => !event.externalRef?.resourceType.includes(":")));

  const stepEvents = observations.filter((event) => event.fields?.metric === "daily-steps");
  assert.deepEqual(stepEvents.map((event) => event.dataOrigin?.sourceProviderSlug).sort(), ["oura", "withings"]);
  const sourceInstanceId = stepEvents.find((event) => event.dataOrigin?.sourceProviderSlug === "oura")?.dataOrigin?.sourceInstanceId;
  assert.match(sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/);
  assert.equal(sourceInstanceId?.includes("device-oura-ring-1"), false);
  assert.equal(sourceInstanceId?.includes("app-oura-cloud-1"), false);
  assert.ok(stepEvents.every((event) => event.externalRef?.resourceType.startsWith("junction-")));
  assert.ok(stepEvents.every((event) => event.externalRef?.resourceType !== "oura"));

  const bodyEvent = observations.find((event) => event.fields?.metric === "weight");
  assert.equal(bodyEvent?.dataOrigin?.sourceProviderSlug, "withings");
  assert.equal(bodyEvent?.dataOrigin?.observedAtRaw, "2026-04-22 17:00:00");
  assert.equal(bodyEvent?.dataOrigin?.timeZoneOffsetMinutes, null);
  assert.equal(bodyEvent?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(bodyEvent?.occurredAt, "2026-04-22T23:59:59.000Z");
  assert.notEqual(bodyEvent?.occurredAt, "2026-04-22T17:00:00.000Z");

  const floatingSample = samples.find((sample) => sample.stream === "spo2");
  assert.equal(floatingSample, undefined);

  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-glucose"));

  const canonicalRecords = payload.canonicalWearableRecords ?? [];
  assert.ok(canonicalRecords.every((record) => record.source.provider === "junction"));
  assert.ok(canonicalRecords.every((record) => record.source.externalRef?.system === "junction"));
  assert.ok(canonicalRecords.every((record) => !record.source.externalRef?.resourceType.includes(":")));

  const canonicalStepRecords = canonicalRecords.filter((record) =>
    record.kind === "observation" && record.metric === "steps"
  );
  assert.equal(canonicalStepRecords.length, 2);
  assert.notEqual(canonicalStepRecords[0]?.source.dataSourceId, canonicalStepRecords[1]?.source.dataSourceId);
  assert.deepEqual(
    canonicalStepRecords.map((record) => record.source.origin?.sourceProviderSlug).sort(),
    ["oura", "withings"],
  );
});

test("Junction snapshot adapter keeps opt-in glucose timeseries wired to timestamp and source provenance", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    connections: [
      {
        id: "source-dexcom",
        sourceProviderSlug: "dexcom_v3",
        sourceName: "Dexcom",
        sourceType: "cgm",
      },
    ],
    timeseries: {
      glucose: [{
        connectionId: "source-dexcom",
        timestamp: "2026-04-22T07:16:00Z",
        value: 101,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-glucose"));
});

test("Junction raw receipt hashing treats Date snapshot fields like ISO strings", async () => {
  const dateSnapshot = {
    importedAt: new Date("2026-04-22T12:00:00.000Z"),
    windowStart: new Date("2026-04-22T00:00:00.000Z"),
    windowEnd: new Date("2026-04-22T23:59:59.000Z"),
    summaries: {
      activity: [{
        observedAt: "2026-04-22T12:00:00.000Z",
        steps: 7200,
      }],
    },
  };
  const stringSnapshot = {
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    summaries: {
      activity: [{
        observedAt: "2026-04-22T12:00:00.000Z",
        steps: 7200,
      }],
    },
  };

  const withDates = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_date_hash",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: dateSnapshot,
  });
  const withStrings = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_date_hash",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: stringSnapshot,
  });
  const dateReceipt = withDates.rawIngestReceipts?.[0];
  const stringReceipt = withStrings.rawIngestReceipts?.[0];

  assert.ok(dateReceipt);
  assert.ok(stringReceipt);
  assert.equal(dateReceipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
  assert.equal(dateReceipt.observedAt, "2026-04-22T12:00:00.000Z");
  assert.equal(dateReceipt.payloadHash, stringReceipt.payloadHash);
  assert.equal(dateReceipt.id, stringReceipt.id);
  assert.equal(Object.hasOwn(dateReceipt, "payload"), false);
});

test("Junction normalizer accepts real nested source provider fields on timeseries entries", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      heartrate: [{
        source: {
          provider: "oura",
          type: "ring",
          device_id: "ring-1",
          app_id: "oura-cloud",
        },
        timestamp: "2026-04-22T07:15:00Z",
        value: 54,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["heartrate"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-heartrate"));
});

test("Junction normalizer keeps grouped fallback source slugs when provider metadata is object-valued", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    connections: [{
      id: "source-oura",
      sourceProviderSlug: "oura",
      sourceType: "ring",
      sourceDeviceId: "raw-oura-ring",
    }],
    timeseries: {
      heartrate: {
        groups: {
          polar: [{
            provider: {
              id: "raw-provider-object",
            },
            source: {
              type: "watch",
              device_id: "raw-polar-watch",
            },
            data: [{
              connectionId: "source-oura",
              timestamp: "2026-04-22T12:45:00Z",
              value: 61,
            }],
          }],
        },
      },
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["heartrate"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-heartrate"));
});

test("Junction summary resource id stays stable when a same-id summary value changes", () => {
  const buildPayload = (steps: number) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [{
        id: "daily-activity-1",
        sourceProviderSlug: "oura",
        sourceType: "ring",
        observedAt: "2026-04-22T12:00:00Z",
        steps,
        activeCalories: 320,
      }],
    },
  });

  const firstPayload = buildPayload(7200);
  const secondPayload = buildPayload(8100);
  const firstStepEvent = firstPayload.events?.find((event) => event.fields?.metric === "daily-steps");
  const secondStepEvent = secondPayload.events?.find((event) => event.fields?.metric === "daily-steps");
  const firstCaloriesEvent = firstPayload.events?.find((event) => event.fields?.metric === "active-calories");

  assert.match(firstStepEvent?.externalRef?.resourceId ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.equal(secondStepEvent?.externalRef?.resourceId, firstStepEvent?.externalRef?.resourceId);
  assert.equal(firstCaloriesEvent?.externalRef?.resourceId, firstStepEvent?.externalRef?.resourceId);
  assert.equal(firstStepEvent?.externalRef?.facet, "daily-steps");
  assert.equal(firstCaloriesEvent?.externalRef?.facet, "active-calories");
});

test("Junction summary resource id changes for same-provider explicit ids from different source instances", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [
        {
          id: "daily-activity-1",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
        },
        {
          id: "daily-activity-1",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          sourceInstanceId: "source-bbbbbbbbbbbbbbbbbbbbbbbb",
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
        },
      ],
    },
  });

  const stepEvents = payload.events?.filter((event) => event.fields?.metric === "daily-steps") ?? [];
  const resourceIds = stepEvents.map((event) => event.externalRef?.resourceId);

  assert.equal(stepEvents.length, 2);
  assert.deepEqual(stepEvents.map((event) => event.externalRef?.resourceType), [
    "junction-oura-activity",
    "junction-oura-activity",
  ]);
  assert.match(resourceIds[0] ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.match(resourceIds[1] ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.notEqual(resourceIds[0], resourceIds[1]);
});

test("Junction summary resource id for explicit ids includes provider, source type, and source instance provenance", () => {
  const buildPayload = (summary: {
    sourceProviderSlug: string;
    sourceType: string;
    sourceInstanceId: string;
  }) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [{
        id: "daily-activity-1",
        sourceProviderSlug: summary.sourceProviderSlug,
        sourceType: summary.sourceType,
        sourceInstanceId: summary.sourceInstanceId,
        observedAt: "2026-04-22T12:00:00Z",
        steps: 7200,
      }],
    },
  }).events?.find((event) => event.fields?.metric === "daily-steps");

  const baseEvent = buildPayload({
    sourceProviderSlug: "oura",
    sourceType: "ring",
    sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const providerVariantEvent = buildPayload({
    sourceProviderSlug: "polar",
    sourceType: "ring",
    sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const sourceTypeVariantEvent = buildPayload({
    sourceProviderSlug: "oura",
    sourceType: "watch",
    sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const sourceInstanceVariantEvent = buildPayload({
    sourceProviderSlug: "oura",
    sourceType: "ring",
    sourceInstanceId: "source-bbbbbbbbbbbbbbbbbbbbbbbb",
  });

  assert.match(baseEvent?.externalRef?.resourceId ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.notEqual(providerVariantEvent?.externalRef?.resourceId, baseEvent?.externalRef?.resourceId);
  assert.notEqual(sourceTypeVariantEvent?.externalRef?.resourceId, baseEvent?.externalRef?.resourceId);
  assert.notEqual(sourceInstanceVariantEvent?.externalRef?.resourceId, baseEvent?.externalRef?.resourceId);
});

test("Junction timeseries observations keep stable refs when a same-key value changes", () => {
  const buildPayload = (value: number) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId: "ring-a",
        timestamp: "2026-04-22T07:16:00Z",
        value,
      }],
    },
  });

  const firstPayload = buildPayload(72);
  const correctedPayload = buildPayload(91);

  assert.equal(firstPayload.samples?.length ?? 0, 0);
  assert.equal(correctedPayload.samples?.length ?? 0, 0);
  assert.equal(firstPayload.events?.[0]?.fields?.metric, "daily-steps");
  assert.equal(firstPayload.events?.[0]?.fields?.value, 72);
  assert.equal(correctedPayload.events?.[0]?.fields?.metric, "daily-steps");
  assert.equal(correctedPayload.events?.[0]?.fields?.value, 91);
  assert.equal(firstPayload.events?.[0]?.externalRef?.resourceId, correctedPayload.events?.[0]?.externalRef?.resourceId);
  assert.ok(firstPayload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-steps"));
  assert.ok(correctedPayload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-steps"));
});

test("Junction timeseries source device changes keep distinct observation refs", () => {
  const buildPayload = (sourceDeviceId: string) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId,
        timestamp: "2026-04-22T07:16:00Z",
        value: 72,
      }],
    },
  });

  const firstPayload = buildPayload("ring-a");
  const secondPayload = buildPayload("ring-b");

  assert.equal(firstPayload.samples?.length ?? 0, 0);
  assert.equal(secondPayload.samples?.length ?? 0, 0);
  assert.equal(firstPayload.events?.[0]?.fields?.metric, "daily-steps");
  assert.equal(secondPayload.events?.[0]?.fields?.metric, "daily-steps");
  assert.notEqual(firstPayload.events?.[0]?.externalRef?.resourceId, secondPayload.events?.[0]?.externalRef?.resourceId);
  assert.ok(firstPayload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-steps"));
  assert.ok(secondPayload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-steps"));
});

test("Junction timeseries resource changes emit separate observation metrics", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId: "ring-a",
        timestamp: "2026-04-22T07:16:00Z",
        value: 72,
      }],
      heartrate: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId: "ring-a",
        timestamp: "2026-04-22T07:16:00Z",
        value: 54,
      }],
    },
  });

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.deepEqual(
    payload.events?.map((event) => event.fields?.metric).sort(),
    ["average-heart-rate", "daily-steps"],
  );
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-steps"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-heartrate"));
});

test("Junction normalizer flattens grouped timeseries payloads for activity and vitals", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    timeseries: {
      steps: {
        groups: {
          oura: [{
            data: [{
              end: "2026-04-22T14:57:24+00:00",
              start: "2026-04-22T14:30:52+00:00",
              unit: "count",
              value: 123,
            }],
            source: {
              provider: "oura",
              type: "ring",
              name: "Oura Ring",
              device_id: "device-oura-ring-1",
              app_id: "app-oura-cloud-1",
            },
          }],
        },
      },
      distance: {
        groups: {
          oura: [{
            data: [{
              end: "2026-04-22T14:57:24+00:00",
              start: "2026-04-22T14:30:52+00:00",
              unit: "m",
              value: 5.6,
            }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      },
      heartrate: {
        groups: {
          oura: [{
            data: [{
              timestamp: "2026-04-22T14:30:52+00:00",
              unit: "bpm",
              value: 70,
            }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      },
      hrv: {
        groups: {
          oura: [{
            data: [{
              timestamp: "2026-04-22T14:30:52+00:00",
              unit: "rmssd",
              value: 48,
            }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      },
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["steps", "distance", "heartrate", "hrv"]);

  const samples = payload.samples ?? [];
  const eventsByMetric = new Map(
    (payload.events ?? []).map((event) => [event.fields?.metric, event]),
  );
  const stepsEvent = eventsByMetric.get("daily-steps");
  const distanceEvent = payload.events?.find((event) => event.fields?.metric === "distance");
  const heartrateEvent = eventsByMetric.get("average-heart-rate");
  const hrvEvent = eventsByMetric.get("hrv");
  const rawTimeseriesArtifacts = JSON.stringify(
    payload.rawArtifacts?.filter((artifact) => artifact.role.startsWith("junction-timeseries-")),
  );

  assert.equal(samples.length, 0);
  assert.doesNotMatch(rawTimeseriesArtifacts, /Oura Ring|device-oura-ring-1|app-oura-cloud-1/u);
  assert.match(rawTimeseriesArtifacts, /"provider":"oura"/u);
  assert.match(rawTimeseriesArtifacts, /"type":"ring"/u);
  assert.equal(distanceEvent?.occurredAt, "2026-04-22T14:57:24.000Z");
  assert.equal(distanceEvent?.fields?.unit, "m");
  assert.equal(distanceEvent?.fields?.value, 5.6);
  assert.equal(distanceEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(stepsEvent?.fields?.unit, "count");
  assert.equal(stepsEvent?.fields?.value, 123);
  assert.equal(stepsEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(heartrateEvent?.fields?.unit, "bpm");
  assert.equal(heartrateEvent?.fields?.value, 70);
  assert.equal(hrvEvent?.fields?.unit, "ms");
  assert.equal(hrvEvent?.fields?.value, 48);
});

test("Junction normalizer maps respiratory rate unit aliases to observation units", async () => {
  const respiratoryRateUnits = [
    undefined,
    "bpm",
    "rpm",
    "breaths/min",
    "breaths/minute",
    "breaths per minute",
    "breaths_per_minute",
  ] as const;

  for (const unit of respiratoryRateUnits) {
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      connectionId: "conn-junction-garmin",
      sourceKind: "poll",
      deliveryMode: "scheduled_reconcile",
      normalizerVersion: "junction-normalizer.v1",
      snapshot: {
        importedAt: "2026-04-22T12:00:00.000Z",
        timeseries: {
          respiratory_rate: {
            groups: {
              garmin: [{
                data: [{
                  timestamp: "2026-04-22T07:15:00Z",
                  ...(unit === undefined ? {} : { unit }),
                  value: 14.8,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          },
        },
      },
    });

    const event = payload.events?.find((entry) => entry.fields?.metric === "respiratory-rate");
    const canonicalSample = payload.canonicalWearableRecords?.find((record) =>
      record.kind === "sample" && record.metric === "respiratoryRate"
    );
    const canonicalObservation = payload.canonicalWearableRecords?.find((record) =>
      record.kind === "observation" && record.metric === "respiratoryRate"
    );
    const rawRespiratoryRateArtifact = payload.rawArtifacts?.find((artifact) =>
      artifact.role === "junction-timeseries-respiratory-rate"
    );
    const rawRespiratoryRateArtifactText = JSON.stringify(rawRespiratoryRateArtifact?.content);

    assert.deepEqual(payload.provenance?.timeseriesResources, ["respiratory_rate"]);
    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(event?.fields?.unit, "breaths_per_minute");
    assert.equal(event?.fields?.value, 14.8);
    assert.equal(event?.dataOrigin?.sourceProviderSlug, "garmin");
    assert.equal(canonicalSample, undefined);
    assert.ok(canonicalObservation && canonicalObservation.kind === "observation");
    assert.equal(canonicalObservation.unit, "breaths_per_minute");
    assert.equal(canonicalObservation.value, 14.8);

    if (unit === undefined) {
      assert.doesNotMatch(rawRespiratoryRateArtifactText, /"unit":/u);
    } else {
      assert.match(rawRespiratoryRateArtifactText, new RegExp(`"unit":"${unit}"`, "u"));
    }
  }
});

test("Junction normalizer maps blood oxygen unit aliases to observation units", async () => {
  const bloodOxygenUnits = [
    undefined,
    "spo2",
    "sp_o2",
    "sp-o2",
    "blood_oxygen",
    "oxygen_saturation",
    "percent",
    "percentage",
    "spo2_percent",
  ] as const;

  for (const unit of bloodOxygenUnits) {
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      connectionId: "conn-junction-garmin",
      sourceKind: "poll",
      deliveryMode: "scheduled_reconcile",
      normalizerVersion: "junction-normalizer.v1",
      snapshot: {
        importedAt: "2026-04-22T12:00:00.000Z",
        timeseries: {
          blood_oxygen: {
            groups: {
              garmin: [{
                data: [{
                  timestamp: "2026-04-22T07:15:00Z",
                  ...(unit === undefined ? {} : { unit }),
                  value: 97.2,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          },
        },
      },
    });

    const event = payload.events?.find((entry) => entry.fields?.metric === "spo2");
    const canonicalSample = payload.canonicalWearableRecords?.find((record) =>
      record.kind === "sample" && record.metric === "spo2"
    );
    const canonicalObservation = payload.canonicalWearableRecords?.find((record) =>
      record.kind === "observation" && record.metric === "spo2"
    );

    assert.deepEqual(payload.provenance?.timeseriesResources, ["blood_oxygen"]);
    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(event?.fields?.unit, "%");
    assert.equal(event?.fields?.value, 97.2);
    assert.equal(event?.dataOrigin?.sourceProviderSlug, "garmin");
    assert.equal(canonicalSample, undefined);
    assert.ok(canonicalObservation && canonicalObservation.kind === "observation");
    assert.equal(canonicalObservation.unit, "%");
    assert.equal(canonicalObservation.value, 97.2);
  }
});

test("Junction snapshot import minimizes grouped source identifiers in raw receipts", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-22T12:00:00.000Z",
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-22T23:59:59.000Z",
      connections: [
        {
          id: "connection-oura-raw",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          name: "Connection Oura Ring",
          display_name: "Connection Display Oura Ring",
          sourceDeviceId: "connection-device-oura-ring-1",
          sourceAppId: "connection-app-oura-cloud-1",
        },
      ],
      summaries: {
        profile: {
          connectionId: "connection-oura-raw",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          displayName: "Profile Oura Ring",
        },
        activity: [{
          connectionId: "activity-connection-raw",
          providerConnectionId: "activity-provider-connection-raw",
          sourceId: "activity-source-raw",
          sourceInstanceId: "activity-source-instance-raw",
          sourceProviderSlug: "oura",
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
        }],
      },
      timeseries: {
        steps: {
          groups: {
            oura: [{
              data: [{
                end: "2026-04-22T14:57:24+00:00",
                start: "2026-04-22T14:30:52+00:00",
                unit: "count",
                value: 123,
                connection_id: "timeseries-connection-raw",
                source_id: "timeseries-source-raw",
                source_instance_id: "timeseries-source-instance-raw",
              }],
              source: {
                id: "nested-source-id-raw",
                uuid: "nested-source-uuid-raw",
                provider: "oura",
                type: "ring",
                name: "Timeseries Oura Ring",
                device_id: "timeseries-device-oura-ring-1",
                app_id: "timeseries-app-oura-cloud-1",
                providerDetails: "kept-non-identity-detail",
              },
              provider: {
                id: "nested-provider-id-raw",
                name: "Nested Provider Oura Ring",
                display_name: "Nested Provider Display Oura Ring",
              },
            }],
          },
        },
      },
    },
  });

  const rawReceipt = payload.rawIngestReceipts?.[0];
  assert.ok(rawReceipt);
  const rawReceiptArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === `wearable-raw-receipt:${rawReceipt.id}`
  );
  const rawReceiptText = JSON.stringify(rawReceipt);
  const rawReceiptArtifactText = JSON.stringify(rawReceiptArtifact?.content);
  const rawArtifactText = JSON.stringify(payload.rawArtifacts);

  assert.equal(Object.hasOwn(rawReceipt, "payload"), false);
  assert.equal(rawReceipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
  assert.ok(rawReceiptArtifact);
  assert.deepEqual(rawReceipt.rawArtifactRoles, [
    "junction-summary-profile",
    "junction-summary-activity",
    "junction-timeseries-steps",
  ]);
  assert.equal(rawReceipt.rawArtifactCount, 3);
  assert.equal(rawReceipt.rawArtifactRoles.some((role) => role.startsWith("wearable-raw-receipt:")), false);
  assert.equal(rawReceipt.rawArtifactRoles.some((role) => role.startsWith("wearable-canonical-records:")), false);
  assert.doesNotMatch(
    rawReceiptText,
    /Timeseries Oura Ring|timeseries-device-oura-ring-1|timeseries-app-oura-cloud-1|nested-source-id-raw|nested-source-uuid-raw|nested-provider-id-raw|Nested Provider Oura Ring|Nested Provider Display Oura Ring|Connection Oura Ring|Connection Display Oura Ring|connection-device-oura-ring-1|connection-app-oura-cloud-1|Profile Oura Ring|activity-connection-raw|activity-provider-connection-raw|activity-source-raw|activity-source-instance-raw|timeseries-connection-raw|timeseries-source-raw|timeseries-source-instance-raw|"sourceProviderSlug"|"sourceType"|"value":123/u,
  );
  assert.equal(rawReceiptArtifact?.content, rawReceipt);
  assert.doesNotMatch(
    rawReceiptArtifactText,
    /Timeseries Oura Ring|timeseries-device-oura-ring-1|timeseries-app-oura-cloud-1|nested-source-id-raw|nested-source-uuid-raw|nested-provider-id-raw|Nested Provider Oura Ring|Nested Provider Display Oura Ring|Connection Oura Ring|Connection Display Oura Ring|connection-device-oura-ring-1|connection-app-oura-cloud-1|Profile Oura Ring|activity-connection-raw|activity-provider-connection-raw|activity-source-raw|activity-source-instance-raw|timeseries-connection-raw|timeseries-source-raw|timeseries-source-instance-raw|"sourceProviderSlug"|"sourceType"|"value":123/u,
  );
  assert.doesNotMatch(
    rawArtifactText,
    /Timeseries Oura Ring|timeseries-device-oura-ring-1|timeseries-app-oura-cloud-1|nested-source-id-raw|nested-source-uuid-raw|nested-provider-id-raw|Nested Provider Oura Ring|Nested Provider Display Oura Ring|Connection Oura Ring|Connection Display Oura Ring|connection-device-oura-ring-1|connection-app-oura-cloud-1|Profile Oura Ring|activity-connection-raw|activity-provider-connection-raw|activity-source-raw|activity-source-instance-raw|timeseries-connection-raw|timeseries-source-raw|timeseries-source-instance-raw/u,
  );
  assert.match(rawReceiptText, /"provider":"junction"/u);
  assert.match(rawArtifactText, /"sourceProviderSlug":"oura"/u);
  assert.match(rawArtifactText, /"sourceType":"ring"/u);
  assert.match(rawArtifactText, /"value":123/u);
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("Junction importer keeps Libre +00:00 glucose timestamps raw-only until timezone conversion exists", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2023-09-27T12:00:00.000Z",
      windowStart: "2023-09-27T00:00:00.000Z",
      windowEnd: "2023-09-27T23:59:59.000Z",
      timeseries: {
        glucose: [
          {
            sourceProviderSlug: "freestyle_libre",
            timestamp: "2023-09-27T07:48:00+00:00",
            value: 101,
          },
          {
            sourceProviderSlug: "abbott_libreview",
            timestamp: "2023-09-27T07:48:00+00:00",
            value: 102,
          },
        ],
      },
    },
  });

  const glucoseSamples = payload.samples?.filter((sample) => sample.stream === "glucose") ?? [];
  const glucoseArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === "junction-timeseries-glucose"
  );
  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(glucoseSamples.length, 0);
  assert.deepEqual(payload.canonicalWearableRecords, []);
  assert.ok(glucoseArtifact);
  assert.deepEqual(glucoseArtifact.content, [
    {
      sourceProviderSlug: "freestyle_libre",
      timestamp: "2023-09-27T07:48:00+00:00",
      value: 101,
    },
    {
      sourceProviderSlug: "abbott_libreview",
      timestamp: "2023-09-27T07:48:00+00:00",
      value: 102,
    },
  ]);
  assert.equal(
    payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("wearable-canonical-records:")),
    false,
  );
});

test("Junction importer skips source-specific floating summary records instead of using window fallback", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2023-09-27T12:00:00.000Z",
      windowStart: "2023-09-27T00:00:00.000Z",
      windowEnd: "2023-09-27T23:59:59.000Z",
      summaries: {
        body: [
          {
            sourceProviderSlug: "freestyle_libre",
            observedAt: "2023-09-27T07:48:00+00:00",
            weight_kg: 82,
          },
          {
            sourceProviderSlug: "abbott_libreview",
            observedAt: "2023-09-27T07:48:00+00:00",
            weight_kg: 83,
          },
        ],
      },
    },
  });

  const bodyArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-body");
  assert.deepEqual(payload.provenance?.summaryResources, ["body"]);
  assert.deepEqual(payload.events, []);
  assert.deepEqual(payload.canonicalWearableRecords, []);
  assert.ok(bodyArtifact);
  assert.equal(
    payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("wearable-canonical-records:")),
    false,
  );
});

test("Junction normalizer does not use source-specific floating timestamps as window times", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2023-09-27T12:00:00.000Z",
    windowStart: "2023-09-27T00:00:00.000Z",
    windowEnd: "2023-09-27T23:59:59.000Z",
    timeseries: {
      weight: [{
        sourceProviderSlug: "abbott_libreview",
        timestamp: "2023-09-27T07:48:00+00:00",
        value: 82,
      }],
    },
  });

  assert.equal(payload.events?.some((event) => event.fields?.metric === "weight"), false);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["weight"]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-weight"));
});

test("Junction normalizer resolves nested source and provider slug origin fields", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    summaries: {
      activity: {
        source: {
          provider: "oura",
          type: "ring",
          device_id: "raw-ring-device",
          app_id: "raw-oura-app",
        },
        data: [{
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
        }],
      },
      body: [{
        provider_slug: "withings",
        source_type: "scale",
        observedAt: "2026-04-22T12:30:00Z",
        weight_kg: 82.4,
      }],
    },
    timeseries: {
      heartrate: {
        groups: {
          polar: [{
            provider: {
              id: "raw-provider-object",
            },
            source: {
              type: "watch",
              device_id: "raw-polar-watch",
            },
            data: [{
              timestamp: "2026-04-22T12:45:00Z",
              value: 61,
            }],
          }],
        },
      },
    },
  });

  const stepEvent = payload.events?.find((event) => event.fields?.metric === "daily-steps");
  assert.equal(stepEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(stepEvent?.dataOrigin?.sourceType, "ring");
  assert.match(stepEvent?.dataOrigin?.sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/u);
  assert.equal(stepEvent?.dataOrigin?.sourceInstanceId?.includes("raw-ring-device"), false);
  assert.equal(stepEvent?.dataOrigin?.sourceInstanceId?.includes("raw-oura-app"), false);

  const bodyEvent = payload.events?.find((event) => event.fields?.metric === "weight");
  assert.equal(bodyEvent?.dataOrigin?.sourceProviderSlug, "withings");
  assert.equal(bodyEvent?.dataOrigin?.sourceType, "scale");

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-heartrate"));
});

test("Junction normalizer defaults to the documented resource allowlist", () => {
  assert.deepEqual([...JUNCTION_DEFAULT_SUMMARY_RESOURCES], [
    "profile",
    "activity",
    "sleep",
    "sleep_cycle",
    "workouts",
    "body",
  ]);
  assert.deepEqual([...JUNCTION_DEFAULT_TIMESERIES_RESOURCES], [
    "steps",
    "distance",
    "calories_active",
    "heartrate",
    "hrv",
    "respiratory_rate",
    "blood_oxygen",
    "weight",
  ]);

  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: Object.fromEntries(JUNCTION_DEFAULT_SUMMARY_RESOURCES.map((resource) => [
      resource,
      {
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T12:00:00Z",
        steps: 1,
      },
    ])),
    timeseries: Object.fromEntries(JUNCTION_DEFAULT_TIMESERIES_RESOURCES.map((resource) => [
      resource,
      [{
        sourceProviderSlug: "oura",
        timestamp: "2026-04-22T12:00:00Z",
        value: 1,
      }],
    ])),
  });

  assert.equal(payload.provider, "junction");
  assert.deepEqual(payload.provenance?.summaryResources, JUNCTION_DEFAULT_SUMMARY_RESOURCES);
  assert.deepEqual(payload.provenance?.timeseriesResources, JUNCTION_DEFAULT_TIMESERIES_RESOURCES);
  assert.equal((JUNCTION_DEFAULT_TIMESERIES_RESOURCES as readonly string[]).includes("glucose"), false);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-profile"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-blood-oxygen"));
  assert.ok(payload.events?.every((event) => event.externalRef?.system === "junction"));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "weight"));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "active-calories"));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "distance"));
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("Junction normalizer canonicalizes documented resource aliases before allowlisting", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      hypnogram: [{
        sourceProviderSlug: "garmin",
        observedAt: "2026-04-22T07:00:00Z",
        stageCount: 5,
      }],
    },
    timeseries: {
      heart_rate: [{
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22T07:10:00Z",
        value: 61,
      }],
      body_weight: [{
        sourceProviderSlug: "withings",
        timestamp: "2026-04-22T07:15:00Z",
        body_weight: 82.1,
      }],
      calories_active: [{
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22T07:20:00Z",
        calories: 123,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["heartrate", "weight", "calories_active"]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.equal(payload.events?.some((event) => event.externalRef?.resourceType === "junction-garmin-hypnogram"), false);
  assert.ok(payload.events?.some((event) =>
    event.fields?.metric === "average-heart-rate" &&
    event.fields.value === 61
  ));
  assert.ok(payload.events?.some((event) =>
    event.fields?.metric === "weight" &&
    event.fields.value === 82.1 &&
    event.externalRef?.resourceType === "junction-withings-weight"
  ));
  assert.ok(payload.events?.some((event) =>
    event.fields?.metric === "active-calories" &&
    event.fields.value === 123 &&
    event.externalRef?.resourceType === "junction-garmin-calories-active"
  ));
});

test("Junction sleep_cycle normalizer emits structured sleep-stage samples", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-oura-1",
        source: {
          provider: "oura",
          type: "ring",
          device_id: "raw-oura-ring-1",
        },
        observedAt: "2026-05-20T10:00:00Z",
        stages: [
          {
            start: "2026-05-20T02:00:00+00:00",
            end: "2026-05-20T02:30:00+00:00",
            stage: "light",
          },
          {
            start_time: "2026-05-20T02:30:00+00:00",
            end_time: "2026-05-20T03:00:00+00:00",
            level: "REM",
          },
          {
            startAt: "2026-05-20T03:00:00+00:00",
            durationSeconds: 3600,
            sleep_stage: "slow_wave_sleep",
          },
          {
            startAt: "2026-05-20T04:00:00+00:00",
            durationMinutes: 15,
            value: "wake",
          },
          {
            endAt: "2026-05-20T04:30:00+00:00",
            durationMillis: 900000,
            name: "N3",
          },
        ],
      }],
      hypnogram: [{
        sourceProviderSlug: "garmin",
        observedAt: "2026-05-20T11:00:00Z",
        stages: [{
          startAt: "2026-05-20T05:00:00+00:00",
          endAt: "2026-05-20T05:20:00+00:00",
          stage: "core",
        }],
      }],
    },
  });
  const samples = payload.samples ?? [];
  const rawSleepCycleArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === "junction-summary-sleep-cycle"
  );
  const rawSleepCycleArtifactText = JSON.stringify(rawSleepCycleArtifact?.content);

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.equal(
    payload.rawArtifacts?.filter((artifact) => artifact.role === "junction-summary-sleep-cycle").length,
    1,
  );
  assert.equal(rawSleepCycleArtifact?.role, "junction-summary-sleep-cycle");
  assert.doesNotMatch(rawSleepCycleArtifactText, /raw-oura-ring-1/u);
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(samples.length, 6);
  assert.deepEqual(samples.map((sample) => sample.stream), [
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
  ]);
  assert.deepEqual(samples.map((sample) => sample.unit), ["stage", "stage", "stage", "stage", "stage", "stage"]);
  assert.deepEqual(samples.map((sample) => sample.sample.stage), ["light", "rem", "deep", "awake", "deep", "light"]);
  assert.deepEqual(samples.map((sample) => sample.sample.durationMinutes), [30, 30, 60, 15, 15, 20]);
  assert.equal(samples[0]?.sample.startAt, "2026-05-20T02:00:00.000Z");
  assert.equal(samples[0]?.sample.endAt, "2026-05-20T02:30:00.000Z");
  assert.equal(samples[2]?.sample.endAt, "2026-05-20T04:00:00.000Z");
  assert.equal(samples[4]?.sample.startAt, "2026-05-20T04:15:00.000Z");
  assert.equal(samples[4]?.sample.endAt, "2026-05-20T04:30:00.000Z");
  assert.ok(samples.every((sample) => sample.externalRef?.system === "junction"));
  assert.equal(samples.some((sample) => sample.externalRef?.resourceType.includes("hypnogram")), false);
  assert.deepEqual([...new Set(samples.map((sample) => sample.externalRef?.resourceType))].sort(), [
    "junction-garmin-sleep-cycle",
    "junction-oura-sleep-cycle",
  ]);
  assert.ok(samples.slice(0, 5).every((sample) => sample.dataOrigin?.sourceProviderSlug === "oura"));
  assert.ok(samples.slice(0, 5).every((sample) => sample.dataOrigin?.sourceType === "ring"));
  assert.equal(samples[5]?.dataOrigin?.sourceProviderSlug, "garmin");
});

test("Junction hypnogram alias emits canonical sleep-stage records", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-sleep-stage",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-05-20T12:00:00.000Z",
      summaries: {
        hypnogram: {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          data: [
            {
              start_time: "2026-05-20T01:00:00+00:00",
              end_time: "2026-05-20T01:12:00+00:00",
              value: "awake",
            },
            {
              start_time: "2026-05-20T01:12:00+00:00",
              end_time: "2026-05-20T01:42:00+00:00",
              stage: "deep",
            },
          ],
        },
      },
    },
  });

  const samples = payload.samples ?? [];
  const canonicalStageMetrics = (payload.canonicalWearableRecords ?? []).flatMap((record) =>
    record.kind === "sample" ? [record.metric] : []
  );
  const canonicalStageSources = (payload.canonicalWearableRecords ?? []).flatMap((record) =>
    record.kind === "sample" ? [record.source] : []
  );

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((sample) => sample.unit), ["stage", "stage"]);
  assert.deepEqual(samples.map((sample) => sample.sample.stage), ["awake", "deep"]);
  assert.deepEqual(samples.map((sample) => sample.sample.durationMinutes), [12, 30]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.equal(samples.some((sample) => sample.externalRef?.resourceType.includes("hypnogram")), false);
  assert.ok(samples.every((sample) => sample.externalRef?.system === "junction"));
  assert.ok(samples.every((sample) => sample.externalRef?.resourceType === "junction-garmin-sleep-cycle"));
  assert.ok(samples.every((sample) => sample.dataOrigin?.sourceProviderSlug === "garmin"));
  assert.ok(samples.every((sample) => sample.dataOrigin?.sourceType === "watch"));
  assert.deepEqual(canonicalStageMetrics.sort(), ["awakeMinutes", "deepMinutes"]);
  assert.ok(canonicalStageSources.every((source) => source.provider === "junction"));
  assert.ok(canonicalStageSources.every((source) => source.externalRef?.system === "junction"));
  assert.ok(canonicalStageSources.every((source) => source.origin?.sourceProviderSlug === "garmin"));
});

test("Junction normalizer merges canonical and alias resource payloads before import", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        sourceProviderSlug: "garmin",
        observedAt: "2026-04-22T07:00:00Z",
        stageCount: 4,
      }],
      hypnogram: [{
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T08:00:00Z",
        stageCount: 5,
      }],
    },
    timeseries: {
      weight: [{
        sourceProviderSlug: "withings",
        timestamp: "2026-04-22T07:15:00Z",
        value: 82,
      }],
      body_weight: [{
        sourceProviderSlug: "withings",
        timestamp: "2026-04-23T07:15:00Z",
        body_weight: 81.5,
      }],
      calories_active: [{
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22T07:20:00Z",
        unit: "calories",
        value: 123,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["weight", "calories_active"]);
  assert.equal(
    payload.rawArtifacts?.filter((artifact) => artifact.role === "junction-summary-sleep-cycle").length,
    1,
  );
  assert.equal(
    payload.rawArtifacts?.filter((artifact) => artifact.role === "junction-timeseries-weight").length,
    1,
  );
  assert.equal(payload.events?.filter((event) => event.fields?.metric === "weight").length, 2);
  const activeCalories = payload.events?.find((event) => event.fields?.metric === "active-calories");
  assert.equal(activeCalories?.fields?.unit, "kcal");
});

test("Junction normalizer does not inherit device attribution from non-unique provider slug fallback", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    connections: [
      {
        id: "source-oura-ring-a",
        sourceProviderSlug: "oura",
        sourceDeviceId: "device-a",
      },
      {
        id: "source-oura-ring-b",
        sourceProviderSlug: "oura",
        sourceDeviceId: "device-b",
      },
    ],
    summaries: {
      activity: [{
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T12:00:00Z",
        steps: 7200,
      }],
      profile: {
        sourceProviderSlug: "oura",
        displayName: "profile display name should not be retained",
      },
    },
  });

  const stepEvent = payload.events?.find((event) => event.fields?.metric === "daily-steps");
  assert.equal(stepEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(stepEvent?.dataOrigin?.sourceInstanceId, undefined);

  const profileArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-profile");
  assert.deepEqual(profileArtifact?.content, {
    sourceProviderSlug: "oura",
  });
});

test("Junction normalizer treats day-only timestamps as floating wall dates", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    summaries: {
      activity: [{
        sourceProviderSlug: "oura",
        day: "2026-04-22",
        steps: 7200,
      }],
    },
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        day: "2026-04-22",
        value: 72,
      }],
    },
  });

  const stepEvent = payload.events?.find((event) => event.fields?.metric === "daily-steps");
  assert.equal(stepEvent?.occurredAt, "2026-04-22T23:59:59.000Z");
  assert.equal(stepEvent?.dayKey, "2026-04-22");
  assert.equal(stepEvent?.dataOrigin?.observedAtRaw, "2026-04-22");
  assert.equal(stepEvent?.dataOrigin?.timestampSemantics, "floating");
  assert.notEqual(stepEvent?.occurredAt, "2026-04-22T00:00:00.000Z");

  const stepSample = payload.samples?.find((sample) => sample.stream === "steps");
  assert.equal(stepSample, undefined);
});

test("Junction normalizer only emits complete sleep and workout sessions", () => {
  const longProviderWorkoutId = `garmin-workout-${"x".repeat(220)}`;
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "sleep-doc",
          bedtime_start: "2026-05-20T02:00:00+00:00",
          bedtime_stop: "2026-05-20T10:00:00+00:00",
          duration: 28800,
          sleepScore: 82,
        },
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "sleep-incomplete",
          date: "2026-05-21T10:00:00+00:00",
          bedtime_start: "2026-05-21T02:00:00+00:00",
          sleepScore: 78,
        },
      ],
      workouts: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          provider_id: longProviderWorkoutId,
          time_start: "2026-05-20T12:00:00+00:00",
          time_end: "2026-05-20T12:30:00+00:00",
          moving_time: 1800,
          sport: {
            name: "Trail Run",
          },
          distance: 5000,
          calories: 320,
          average_hr: 145,
          max_hr: 175,
        },
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "workout-incomplete",
          observedAt: "2026-05-20T15:00:00+00:00",
          sport: {
            name: "Walk",
          },
          distance: 1000,
          calories: 90,
          average_hr: 101,
        },
      ],
    },
  });

  assertWorkoutSessionsMatchContract(payload.events ?? []);

  const sleepSessions = payload.events?.filter((event) => event.kind === "sleep_session") ?? [];
  assert.equal(sleepSessions.length, 1);
  assert.equal(sleepSessions[0]?.occurredAt, "2026-05-20T02:00:00.000Z");
  assert.equal(sleepSessions[0]?.fields?.startAt, "2026-05-20T02:00:00.000Z");
  assert.equal(sleepSessions[0]?.fields?.endAt, "2026-05-20T10:00:00.000Z");
  assert.equal(sleepSessions[0]?.fields?.durationMinutes, 480);

  const sleepScoreEvents = payload.events?.filter((event) => event.fields?.metric === "sleep-score") ?? [];
  assert.equal(sleepScoreEvents.length, 2);

  const workoutSessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  assert.equal(workoutSessions.length, 1);
  assert.equal(workoutSessions[0]?.fields?.activityType, "trail-run");
  assert.equal(workoutSessions[0]?.fields?.durationMinutes, 30);
  assert.equal(workoutSessions[0]?.fields?.distanceKm, 5);
  assert.equal("averageHeartRate" in (workoutSessions[0]?.fields ?? {}), false);
  assert.equal("maxHeartRate" in (workoutSessions[0]?.fields ?? {}), false);
  assert.equal("totalCalories" in (workoutSessions[0]?.fields ?? {}), false);
  assert.deepEqual(workoutSessions[0]?.fields?.workout, {
    sourceApp: "garmin",
    sourceWorkoutId: longProviderWorkoutId.slice(0, 200),
    startedAt: "2026-05-20T12:00:00.000Z",
    endedAt: "2026-05-20T12:30:00.000Z",
    sessionNote: "Trail Run",
    exercises: [],
  });

  const workoutMetrics = payload.events?.filter((event) => event.kind === "observation") ?? [];
  assert.ok(workoutMetrics.some((event) =>
    event.fields?.metric === "active-calories"
    && event.fields.value === 320
    && event.occurredAt === "2026-05-20T12:00:00.000Z"
  ));
  assert.ok(workoutMetrics.some((event) =>
    event.fields?.metric === "average-heart-rate"
    && event.fields.value === 145
    && event.fields.unit === "bpm"
    && event.occurredAt === "2026-05-20T12:00:00.000Z"
    && event.dataOrigin?.observedAtRaw === "2026-05-20T12:00:00+00:00"
    && event.externalRef?.resourceId === workoutSessions[0]?.externalRef?.resourceId
  ));
  assert.ok(workoutMetrics.some((event) =>
    event.fields?.metric === "max-heart-rate"
    && event.fields.value === 175
    && event.fields.unit === "bpm"
    && event.occurredAt === "2026-05-20T12:00:00.000Z"
  ));
  assert.ok(workoutMetrics.some((event) =>
    event.fields?.metric === "active-calories"
    && event.fields.value === 90
    && event.occurredAt === "2026-05-20T15:00:00.000Z"
  ));
  assert.ok(workoutMetrics.some((event) =>
    event.fields?.metric === "average-heart-rate"
    && event.fields.value === 101
    && event.occurredAt === "2026-05-20T15:00:00.000Z"
  ));

  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-workouts"));
});

test("Junction normalizer maps documented sleep summary scalar fields", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "sleep-documented-fields",
          bedtime_start: "2026-05-20T02:00:00+00:00",
          bedtime_stop: "2026-05-20T10:00:00+00:00",
          duration: 28800,
          total: 25200,
          deep: 5400,
          rem: 7200,
          light: 12600,
          awake: 1800,
          average_hrv: 42,
          hr_average: 54,
          respiratory_rate: 14.2,
        },
      ],
    },
  });

  const sleepSession = payload.events?.find((event) => event.kind === "sleep_session");
  assert.equal(sleepSession?.fields?.durationMinutes, 480);

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metricValue = (metric: string) =>
    observations.find((event) => event.fields?.metric === metric)?.fields?.value;

  assert.equal(metricValue("sleep-total-minutes"), 420);
  assert.equal(metricValue("sleep-deep-minutes"), 90);
  assert.equal(metricValue("sleep-rem-minutes"), 120);
  assert.equal(metricValue("sleep-light-minutes"), 210);
  assert.equal(metricValue("sleep-awake-minutes"), 30);
  assert.equal(metricValue("hrv"), 42);
  assert.equal(metricValue("average-heart-rate"), 54);
  assert.equal(metricValue("respiratory-rate"), 14.2);
  assert.ok(observations.every((event) => event.externalRef?.resourceType === "junction-garmin-sleep"));
});

test("Junction workout provider IDs drive stable summary external refs", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      workouts: [
        {
          source: { provider: "garmin" },
          provider_id: "provider-workout-stable",
          time_start: "2026-05-20T12:00:00+00:00",
          time_end: "2026-05-20T12:30:00+00:00",
          moving_time: 1800,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          provider_id: "provider-workout-stable",
          time_start: "2026-05-21T12:00:00+00:00",
          time_end: "2026-05-21T12:45:00+00:00",
          moving_time: 2700,
          sport: { name: "Run" },
        },
      ],
    },
  });

  assertWorkoutSessionsMatchContract(payload.events ?? []);

  const sessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.externalRef?.resourceId, sessions[1]?.externalRef?.resourceId);
});

test("Junction normalizer ignores aggregator provider and ambiguous type provenance fields", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [{
        provider: "junction",
        observedAt: "2026-04-22T12:00:00Z",
        steps: 7200,
      }],
      workouts: [{
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T12:00:00Z",
        type: "run",
        durationMinutes: 42,
        distanceKm: 7.2,
      }],
      profile: {
        provider: "junction",
        providerSlug: "oura",
        type: "profile",
        sourceProviderSlug: "junction",
        sourceType: "cloud-provider",
      },
    },
  });

  assert.equal(payload.events?.some((event) => event.externalRef?.resourceType === "junction-junction-activity"), false);

  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");
  assert.equal(workoutEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(workoutEvent?.dataOrigin?.sourceType, undefined);
  assert.equal(workoutEvent?.fields?.activityType, "run");
  assert.equal(workoutEvent?.externalRef?.resourceType, "junction-oura-workouts");

  const profileArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-profile");
  assert.deepEqual(profileArtifact?.content, {
    sourceProviderSlug: "oura",
    sourceType: "cloud-provider",
  });
});
