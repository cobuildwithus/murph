import assert from "node:assert/strict";
import { test } from "vitest";

import {
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
} from "../src/index.ts";

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
  assert.equal(samples.length, 3);
  assert.ok(observations.every((event) => event.externalRef?.system === "junction"));
  assert.ok(samples.every((sample) => sample.externalRef?.system === "junction"));
  assert.ok(observations.every((event) => !event.externalRef?.resourceType.includes(":")));
  assert.ok(samples.every((sample) => !sample.externalRef?.resourceType.includes(":")));

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
  assert.equal(floatingSample?.dataOrigin?.observedAtRaw, "2026-04-22 07:16:00");
  assert.equal(floatingSample?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(floatingSample?.recordedAt, "2026-04-22T23:59:59.000Z");

  const glucoseSample = samples.find((sample) => sample.stream === "glucose");
  assert.equal(glucoseSample?.unit, "mg_dL");
  assert.equal(glucoseSample?.dataOrigin?.sourceProviderSlug, "dexcom-v3");
  assert.equal(glucoseSample?.dataOrigin?.sourceType, "cgm");

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

  const glucoseSample = payload.samples?.find((sample) => sample.stream === "glucose");

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(glucoseSample?.unit, "mg_dL");
  assert.equal(glucoseSample?.dataOrigin?.sourceProviderSlug, "dexcom-v3");
  assert.equal(glucoseSample?.dataOrigin?.sourceType, "cgm");
  assert.equal(glucoseSample?.dataOrigin?.observedAtRaw, "2026-04-22T07:16:00Z");
  assert.equal(glucoseSample?.dataOrigin?.timestampSemantics, "utc");
  assert.equal(glucoseSample?.recordedAt, "2026-04-22T07:16:00.000Z");
});

test("Junction normalizer defaults to the PR3 resource allowlist", () => {
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
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-blood-oxygen"));
  assert.ok(payload.events?.every((event) => event.externalRef?.system === "junction"));
  assert.ok(payload.samples?.every((sample) => sample.externalRef?.system === "junction"));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "weight"));
  assert.equal(payload.samples?.some((sample) => sample.stream === "weight"), false);
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
  assert.equal(stepSample?.recordedAt, "2026-04-22T23:59:59.000Z");
  assert.equal(stepSample?.dataOrigin?.observedAtRaw, "2026-04-22");
  assert.equal(stepSample?.dataOrigin?.timestampSemantics, "floating");
  assert.notEqual(stepSample?.recordedAt, "2026-04-22T00:00:00.000Z");
});

test("Junction normalizer ignores ambiguous provider and type provenance fields", () => {
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
    sourceType: "cloud-provider",
  });
});
