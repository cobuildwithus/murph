import assert from "node:assert/strict";

import { test } from "vitest";

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
      id: "obs_active_calories",
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
      metric: "activeCalories",
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
  assert.deepEqual(dataset.metricCandidates.map((candidate) => candidate.metric), ["activeCalories", "deepMinutes"]);
  assert.ok(dataset.metricCandidates.every((candidate) => candidate.sourceFamily === "canonical"));
  assert.equal(dataset.sleepWindows.length, 1);
  assert.equal(dataset.sleepWindows[0]?.nap, true);
  assert.equal(dataset.activitySessionAggregates.length, 1);
  assert.equal(dataset.activitySessionAggregates[0]?.sessionMinutes, 42);
  assert.equal(sourceFamilyScore("canonical"), 4);
});
