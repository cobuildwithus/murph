import assert from "node:assert/strict";

import { test } from "vitest";

import { canonicalizeDeviceBatchPayload } from "@murphai/importers";
import type { CanonicalWearableRecord } from "@murphai/importers/device-providers/canonical-wearable-records";

import { collectCanonicalWearableDataset } from "../src/wearables/canonical-records.ts";
import { sourceFamilyScore } from "../src/wearables/provider-policy.ts";

test("collectCanonicalWearableDataset keeps canonical candidates and suppresses tombstoned resources", () => {
  const records: CanonicalWearableRecord[] = [
    {
      id: "obs_steps",
      kind: "observation",
      schemaVersion: "wearable.canonical_record.v1",
      dayKey: "2026-04-20",
      observedAt: "2026-04-20T12:00:00.000Z",
      source: {
        provider: "oura",
        dataSourceId: "wearable_source_oura",
        providerResourceType: "daily_activity",
        providerResourceId: "activity-1",
        normalizerVersion: "test-normalizer.v1",
        rawArtifactRoles: ["daily-activity"],
      },
      metric: "steps",
      unit: "count",
      value: 12000,
    },
    {
      id: "obs_total_calories",
      kind: "observation",
      schemaVersion: "wearable.canonical_record.v1",
      dayKey: "2026-04-20",
      observedAt: "2026-04-20T12:00:00.000Z",
      source: {
        provider: "oura",
        dataSourceId: "wearable_source_oura",
        providerResourceType: "daily_activity",
        providerResourceId: "activity-2",
        normalizerVersion: "test-normalizer.v1",
        rawArtifactRoles: ["daily-activity"],
      },
      metric: "totalCalories",
      unit: "kcal",
      value: 510,
    },
    {
      id: "sample_deep",
      kind: "sample",
      schemaVersion: "wearable.canonical_record.v1",
      dayKey: "2026-04-20",
      observedAt: "2026-04-20T12:00:00.000Z",
      source: {
        provider: "oura",
        dataSourceId: "wearable_source_oura",
        providerResourceType: "sleep_stage",
        providerResourceId: "sleep-1",
        normalizerVersion: "test-normalizer.v1",
        rawArtifactRoles: ["sleep-stage"],
      },
      metric: "deepMinutes",
      unit: "minutes",
      value: 95,
    },
    {
      id: "sleep_window",
      kind: "session",
      schemaVersion: "wearable.canonical_record.v1",
      dayKey: "2026-04-20",
      observedAt: "2026-04-20T12:00:00.000Z",
      source: {
        provider: "oura",
        dataSourceId: "wearable_source_oura",
        providerResourceType: "sleep",
        providerResourceId: "sleep-1",
        normalizerVersion: "test-normalizer.v1",
        rawArtifactRoles: ["sleep"],
      },
      sessionKind: "sleep_session",
      durationMinutes: 480,
      startAt: "2026-04-19T22:00:00.000Z",
      endAt: "2026-04-20T06:00:00.000Z",
      title: "Afternoon nap",
    },
    {
      id: "activity_session",
      kind: "session",
      schemaVersion: "wearable.canonical_record.v1",
      dayKey: "2026-04-20",
      observedAt: "2026-04-20T12:00:00.000Z",
      source: {
        provider: "strava",
        dataSourceId: "wearable_source_strava",
        providerResourceType: "activity",
        providerResourceId: "run-1",
        normalizerVersion: "test-normalizer.v1",
        rawArtifactRoles: ["activity"],
      },
      sessionKind: "activity_session",
      durationMinutes: 42,
      title: "Run",
    },
    {
      id: "tombstone_steps",
      kind: "tombstone",
      schemaVersion: "wearable.canonical_record.v1",
      dayKey: "2026-04-20",
      observedAt: "2026-04-20T12:05:00.000Z",
      source: {
        provider: "oura",
        dataSourceId: "wearable_source_oura",
        normalizerVersion: "test-normalizer.v1",
        rawArtifactRoles: ["daily-activity"],
      },
      providerResourceType: "daily_activity",
      providerResourceId: "activity-1",
      deletedAt: "2026-04-20T12:05:00.000Z",
    },
  ];

  const dataset = collectCanonicalWearableDataset(records);

  assert.equal(dataset.metricCandidates.length, 2);
  assert.deepEqual(dataset.metricCandidates.map((candidate) => candidate.metric), ["totalCalories", "deepMinutes"]);
  assert.ok(dataset.metricCandidates.every((candidate) => candidate.sourceFamily === "canonical"));
  assert.equal(dataset.sleepWindows.length, 1);
  assert.equal(dataset.sleepWindows[0]?.nap, true);
  assert.equal(dataset.activitySessionAggregates.length, 1);
  assert.equal(dataset.activitySessionAggregates[0]?.sessionMinutes, 42);
  assert.equal(sourceFamilyScore("canonical"), 4);
});

test("collectCanonicalWearableDataset surfaces WHOOP metrics from normalized canonical records", () => {
  const records = canonicalizeDeviceBatchPayload({
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-04-20T12:00:00.000Z",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "energy-burned",
          unit: "kJ",
          value: 418.4,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "max-heart-rate",
          unit: "bpm",
          value: 168,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "workout-strain",
          unit: "whoop_strain",
          value: 11.1,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "percent-recorded",
          unit: "%",
          value: 99,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "altitude-gain",
          unit: "meter",
          value: 42,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "altitude-change",
          unit: "meter",
          value: 33,
        },
      },
    ],
  });

  const dataset = collectCanonicalWearableDataset(records);
  const observations = dataset.metricCandidates
    .map((candidate) => ({
      metric: candidate.metric,
      sourceFamily: candidate.sourceFamily,
      unit: candidate.unit,
      value: candidate.value,
    }))
    .sort((left, right) => left.metric.localeCompare(right.metric));

  assert.deepEqual(observations, [
    {
      metric: "altitudeChangeMeters",
      sourceFamily: "canonical",
      unit: "meter",
      value: 33,
    },
    {
      metric: "maxHeartRate",
      sourceFamily: "canonical",
      unit: "bpm",
      value: 168,
    },
    {
      metric: "percentRecorded",
      sourceFamily: "canonical",
      unit: "%",
      value: 99,
    },
    {
      metric: "totalCalories",
      sourceFamily: "canonical",
      unit: "kcal",
      value: 100,
    },
    {
      metric: "totalElevationGainMeters",
      sourceFamily: "canonical",
      unit: "meter",
      value: 42,
    },
    {
      metric: "workoutStrain",
      sourceFamily: "canonical",
      unit: "whoop_strain",
      value: 11.1,
    },
  ]);
});
