import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  buildActivitySessionAggregates,
  buildActivitySessionMetricCandidate,
  buildSleepStageAggregateCandidates,
  buildSleepWindowMetricCandidate,
  collectWearableDataset,
  createMetricCandidateBase,
  groupActivitySessionAggregatesByDate,
  groupMetricCandidatesByDate,
  groupSleepWindowsByDate,
  matchesDateFilters,
  resolveSelectedActivityTypes,
  selectMetricCandidates,
} from "../src/wearables/candidates.ts";
import type {
  WearableExternalRef,
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "../src/wearables/types.ts";

function makeEntity(
  overrides: Partial<CanonicalEntity> & Pick<CanonicalEntity, "entityId" | "family" | "kind" | "recordClass">,
): CanonicalEntity {
  return {
    entityId: overrides.entityId,
    primaryLookupId: overrides.primaryLookupId ?? overrides.entityId,
    lookupIds: overrides.lookupIds ?? [overrides.entityId],
    family: overrides.family,
    recordClass: overrides.recordClass,
    kind: overrides.kind,
    status: overrides.status ?? null,
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    path: overrides.path ?? `ledger/events/${overrides.entityId}.jsonl`,
    title: overrides.title ?? null,
    body: overrides.body ?? null,
    attributes: overrides.attributes ?? {},
    frontmatter: overrides.frontmatter ?? null,
    links: overrides.links ?? [],
    relatedIds: overrides.relatedIds ?? [],
    stream: overrides.stream ?? null,
    experimentSlug: overrides.experimentSlug ?? null,
    tags: overrides.tags ?? [],
  };
}

function makeWearableEntity(
  overrides: {
    entityId: string;
    family: CanonicalEntity["family"];
    kind: string;
    recordClass: CanonicalEntity["recordClass"];
    attributes?: Record<string, unknown>;
    date?: string | null;
    occurredAt?: string | null;
    path?: string;
    stream?: string | null;
    title?: string | null;
  },
): CanonicalEntity {
  return makeEntity({
    attributes: overrides.attributes ?? {},
    date: overrides.date ?? null,
    entityId: overrides.entityId,
    family: overrides.family,
    kind: overrides.kind,
    occurredAt: overrides.occurredAt ?? null,
    path: overrides.path,
    recordClass: overrides.recordClass,
    stream: overrides.stream ?? null,
    title: overrides.title ?? null,
  });
}

function makeVault(entities: readonly CanonicalEntity[]) {
  return createVaultReadModel({
    entities,
    metadata: null,
    vaultRoot: "/virtual/wearables-final",
  });
}

function makeExternalRef(overrides: Partial<WearableExternalRef> = {}): WearableExternalRef {
  return {
    facet: null,
    resourceId: null,
    resourceType: null,
    system: null,
    version: null,
    ...overrides,
  };
}

function makeMetricCandidate(
  overrides: Partial<WearableMetricCandidate> & Pick<
    WearableMetricCandidate,
    "candidateId" | "date" | "metric" | "provider" | "sourceFamily" | "sourceKind" | "unit" | "value"
  >,
): WearableMetricCandidate {
  return {
    candidateId: overrides.candidateId,
    date: overrides.date,
    externalRef: overrides.externalRef ?? null,
    metric: overrides.metric,
    occurredAt: overrides.occurredAt ?? null,
    paths: overrides.paths ?? [`/virtual/${overrides.candidateId}.jsonl`],
    provider: overrides.provider,
    recordedAt: overrides.recordedAt ?? null,
    recordIds: overrides.recordIds ?? [overrides.candidateId],
    sourceFamily: overrides.sourceFamily,
    sourceKind: overrides.sourceKind,
    title: overrides.title ?? null,
    unit: overrides.unit,
    value: overrides.value,
  };
}

function makeSleepWindowCandidate(
  overrides: Partial<WearableSleepWindowCandidate> & Pick<
    WearableSleepWindowCandidate,
    "candidateId" | "date" | "durationMinutes" | "provider" | "sourceFamily" | "sourceKind" | "nap"
  >,
): WearableSleepWindowCandidate {
  return {
    candidateId: overrides.candidateId,
    date: overrides.date,
    durationMinutes: overrides.durationMinutes,
    endAt: overrides.endAt ?? null,
    nap: overrides.nap,
    occurredAt: overrides.occurredAt ?? null,
    paths: overrides.paths ?? [`/virtual/${overrides.candidateId}.jsonl`],
    provider: overrides.provider,
    recordedAt: overrides.recordedAt ?? null,
    recordIds: overrides.recordIds ?? [overrides.candidateId],
    sourceFamily: overrides.sourceFamily,
    sourceKind: overrides.sourceKind,
    startAt: overrides.startAt ?? null,
    title: overrides.title ?? null,
  };
}

test("collectWearableDataset covers the candidate builders, provenance diagnostics, and provider filtering branches", () => {
  const sampleRowsData: Array<{
    durationMinutes?: number;
    endAt?: string;
    entityId: string;
    provider: string;
    recordedAt: string;
    resourceId?: string;
    resourceType: string;
    stage?: string;
    stream: string;
    title: string;
    unit?: string;
    value?: number;
  }> = [
    {
      entityId: "sample_oura_steps",
      provider: "oura",
      recordedAt: "2026-04-02T07:00:00Z",
      resourceType: "summary",
      stream: "steps",
      title: "Oura steps",
      value: 900,
    },
    {
      entityId: "sample_garmin_hrv",
      provider: "garmin",
      recordedAt: "2026-04-02T07:05:00Z",
      resourceId: "hrv-1",
      resourceType: "summary",
      stream: "hrv",
      title: "Garmin HRV",
      unit: "ms",
      value: 73,
    },
    {
      entityId: "sample_garmin_respiratory",
      provider: "garmin",
      recordedAt: "2026-04-02T07:10:00Z",
      resourceId: "resp-1",
      resourceType: "summary",
      stream: "respiratory_rate",
      title: "Garmin respiratory rate",
      value: 13,
    },
    {
      entityId: "sample_garmin_temperature",
      provider: "garmin",
      recordedAt: "2026-04-02T07:15:00Z",
      resourceId: "temp-1",
      resourceType: "summary",
      stream: "temperature",
      title: "Garmin temperature",
      value: 36.2,
    },
    {
      entityId: "sample_garmin_heart_rate",
      provider: "garmin",
      recordedAt: "2026-04-02T07:20:00Z",
      resourceId: "hr-1",
      resourceType: "summary",
      stream: "heart_rate",
      title: "Garmin heart rate",
      value: 59,
    },
    {
      entityId: "sample_garmin_unused",
      provider: "garmin",
      recordedAt: "2026-04-02T07:25:00Z",
      resourceId: "cadence-1",
      resourceType: "summary",
      stream: "cadence",
      title: "Garmin cadence",
      value: 96,
    },
    {
      entityId: "sample_oura_sleep_stage_light",
      provider: "oura",
      endAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:05:00Z",
      resourceId: "stage-1",
      resourceType: "sleep_stage",
      durationMinutes: 20,
      stage: "light",
      stream: "sleep_stage",
      title: "Light stage",
    },
    {
      entityId: "sample_oura_sleep_stage_deep",
      provider: "oura",
      endAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:06:00Z",
      resourceId: "stage-2",
      resourceType: "sleep_stage",
      durationMinutes: 30,
      stage: "deep",
      stream: "sleep_stage",
      title: "Deep stage",
    },
    {
      entityId: "sample_oura_sleep_stage_awake",
      provider: "oura",
      endAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:07:00Z",
      resourceId: "stage-3",
      resourceType: "sleep_stage",
      durationMinutes: 10,
      stage: "awake",
      stream: "sleep_stage",
      title: "Awake stage",
    },
    {
      entityId: "sample_oura_sleep_stage_rem",
      provider: "oura",
      endAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:08:00Z",
      resourceId: "stage-4",
      resourceType: "sleep_stage",
      durationMinutes: 15,
      stage: "rem",
      stream: "sleep_stage",
      title: "Rem stage",
    },
    {
      entityId: "sample_oura_sleep_stage_invalid",
      provider: "oura",
      endAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:09:00Z",
      resourceId: "stage-5",
      resourceType: "sleep_stage",
      durationMinutes: 5,
      stage: "dream",
      stream: "sleep_stage",
      title: "Dream stage",
    },
  ];

  const sampleRows = sampleRowsData.map((row) => makeWearableEntity({
    attributes: {
      ...(row.resourceId === undefined
        ? { externalRef: makeExternalRef({ resourceType: row.resourceType, system: row.provider }) }
        : {
            externalRef: makeExternalRef({
              resourceId: row.resourceId,
              resourceType: row.resourceType,
              system: row.provider,
            }),
          }),
      ...(row.endAt ? { endAt: row.endAt } : {}),
      ...(row.durationMinutes ? { durationMinutes: row.durationMinutes } : {}),
      ...(row.recordedAt ? { recordedAt: row.recordedAt } : {}),
      ...(row.stage ? { stage: row.stage } : {}),
      ...(row.unit ? { unit: row.unit } : {}),
      ...(row.value !== undefined ? { value: row.value } : {}),
    },
    entityId: row.entityId,
    family: "sample",
    kind: "sample",
    recordClass: "sample",
    stream: row.stream,
    title: row.title,
  }));

  const observationRowsData: Array<{
    entityId: string;
    metric: string;
    provider: string;
    recordedAt: string;
    resourceId?: string;
    value: number;
  }> = [
    { entityId: "obs_daily_steps", metric: "daily-steps", provider: "garmin", recordedAt: "2026-04-02T08:00:00Z", value: 1000 },
    { entityId: "obs_active_calories", metric: "active-calories", provider: "oura", recordedAt: "2026-04-01T08:05:00Z", value: 150 },
    { entityId: "obs_distance", metric: "distance", provider: "garmin", recordedAt: "2026-04-02T08:10:00Z", value: 1500 },
    {
      entityId: "obs_equivalent_walking_distance",
      metric: "equivalent-walking-distance",
      provider: "garmin",
      recordedAt: "2026-04-02T08:15:00Z",
      value: 500,
    },
    { entityId: "obs_activity_score", metric: "activity-score", provider: "garmin", recordedAt: "2026-04-02T08:20:00Z", value: 82 },
    { entityId: "obs_day_strain", metric: "day-strain", provider: "garmin", recordedAt: "2026-04-02T08:25:00Z", value: 14.3 },
    { entityId: "obs_sleep_efficiency", metric: "sleep-efficiency", provider: "garmin", recordedAt: "2026-04-02T08:30:00Z", value: 93 },
    { entityId: "obs_sleep_total", metric: "sleep-total-minutes", provider: "garmin", recordedAt: "2026-04-02T08:35:00Z", value: 445 },
    { entityId: "obs_time_in_bed", metric: "time-in-bed-minutes", provider: "garmin", recordedAt: "2026-04-02T08:40:00Z", value: 470 },
    { entityId: "obs_sleep_awake", metric: "sleep-awake-minutes", provider: "garmin", recordedAt: "2026-04-02T08:45:00Z", value: 25 },
    { entityId: "obs_sleep_light", metric: "sleep-light-minutes", provider: "garmin", recordedAt: "2026-04-02T08:50:00Z", value: 190 },
    { entityId: "obs_sleep_deep", metric: "sleep-deep-minutes", provider: "garmin", recordedAt: "2026-04-02T08:55:00Z", value: 70 },
    { entityId: "obs_sleep_rem", metric: "sleep-rem-minutes", provider: "garmin", recordedAt: "2026-04-02T09:00:00Z", value: 80 },
    { entityId: "obs_sleep_score", metric: "sleep-score", provider: "oura", recordedAt: "2026-04-02T09:05:00Z", value: 91 },
    { entityId: "obs_sleep_performance", metric: "sleep-performance", provider: "oura", recordedAt: "2026-04-02T09:10:00Z", value: 88 },
    { entityId: "obs_sleep_consistency", metric: "sleep-consistency", provider: "oura", recordedAt: "2026-04-02T09:15:00Z", value: 79 },
    { entityId: "obs_recovery_score", metric: "recovery-score", provider: "oura", recordedAt: "2026-04-02T09:20:00Z", value: 77 },
    { entityId: "obs_readiness_score", metric: "readiness-score", provider: "oura", recordedAt: "2026-04-02T09:25:00Z", value: 84 },
    { entityId: "obs_resting_heart_rate", metric: "resting-heart-rate", provider: "oura", recordedAt: "2026-04-02T09:30:00Z", value: 57 },
    { entityId: "obs_average_heart_rate", metric: "average-heart-rate", provider: "garmin", recordedAt: "2026-04-02T09:35:00Z", value: 61 },
    { entityId: "obs_lowest_heart_rate", metric: "lowest-heart-rate", provider: "garmin", recordedAt: "2026-04-02T09:40:00Z", value: 41 },
    { entityId: "obs_respiratory_rate", metric: "respiratory-rate", provider: "oura", recordedAt: "2026-04-02T09:45:00Z", value: 13 },
    { entityId: "obs_spo2", metric: "spo2", provider: "oura", recordedAt: "2026-04-02T09:50:00Z", value: 97 },
    { entityId: "obs_temperature_deviation", metric: "temperature-deviation", provider: "oura", recordedAt: "2026-04-02T09:55:00Z", value: -0.2 },
    { entityId: "obs_body_battery", metric: "body-battery", provider: "garmin", recordedAt: "2026-04-02T10:00:00Z", value: 74 },
    { entityId: "obs_stress_level", metric: "stress-level", provider: "garmin", recordedAt: "2026-04-02T10:05:00Z", value: 18 },
    { entityId: "obs_weight", metric: "weight", provider: "garmin", recordedAt: "2026-04-02T10:10:00Z", value: 72.4 },
    { entityId: "obs_body_fat", metric: "body-fat-percentage", provider: "garmin", recordedAt: "2026-04-02T10:15:00Z", value: 18.1 },
    { entityId: "obs_bmi", metric: "bmi", provider: "garmin", recordedAt: "2026-04-02T10:20:00Z", value: 22.3 },
  ];

  const observationRows = observationRowsData.map((row) => makeWearableEntity({
    attributes: {
      externalRef: makeExternalRef(
        row.entityId === "obs_active_calories"
          ? {
              resourceType: "summary",
              system: row.provider,
            }
          : {
              resourceId: row.entityId,
              resourceType: "summary",
              system: row.provider,
            },
      ),
      metric: row.metric,
      recordedAt: row.recordedAt,
      value: row.value,
    },
    entityId: row.entityId,
    family: "event",
    kind: "observation",
    recordClass: "ledger",
    title: row.metric,
  }));

  const excludedObservation = makeWearableEntity({
    attributes: {
      externalRef: makeExternalRef({
        resourceId: "missing-provider-1",
        resourceType: "summary",
      }),
      metric: "sleep-total-minutes",
      recordedAt: "2026-04-02T10:25:00Z",
      value: 480,
    },
    entityId: "obs_missing_provider",
    family: "event",
    kind: "observation",
    recordClass: "ledger",
    title: "Missing provider observation",
  });

  const activitySessions = [
    makeWearableEntity({
      attributes: {
        durationMinutes: 20,
        externalRef: makeExternalRef({
          resourceId: "run-1",
          resourceType: "activity_session",
          system: "garmin",
        }),
        recordedAt: "2026-04-02T06:10:00Z",
      },
      entityId: "event_garmin_run_1",
      family: "event",
      kind: "activity_session",
      occurredAt: "2026-04-02T06:00:00Z",
      recordClass: "ledger",
      title: "Garmin Running Session",
    }),
    makeWearableEntity({
      attributes: {
        durationMinutes: 15,
        externalRef: makeExternalRef({
          resourceId: "cycle-1",
          resourceType: "activity_session",
          system: "garmin",
        }),
        recordedAt: "2026-04-02T08:15:00Z",
      },
      entityId: "event_garmin_cycle_1",
      family: "event",
      kind: "activity_session",
      occurredAt: "2026-04-02T08:00:00Z",
      recordClass: "ledger",
      title: "Garmin Cycling Session",
    }),
    makeWearableEntity({
      attributes: {
        externalRef: makeExternalRef({
          resourceId: "broken-activity",
          resourceType: "activity_session",
          system: "garmin",
        }),
      },
      entityId: "event_garmin_activity_invalid",
      family: "event",
      kind: "activity_session",
      recordClass: "ledger",
      title: "Garmin invalid activity",
    }),
  ];

  const sleepSessions = [
    makeWearableEntity({
      attributes: {
        durationMinutes: 30,
        endAt: "2026-04-01T14:30:00Z",
        externalRef: makeExternalRef({
          resourceId: "nap-1",
          resourceType: "sleep_session",
          system: "oura",
        }),
        recordedAt: "2026-04-01T14:31:00Z",
        startAt: "2026-04-01T14:00:00Z",
        title: "Lunch nap",
      },
      entityId: "event_oura_nap",
      family: "event",
      kind: "sleep_session",
      occurredAt: "2026-04-01T14:00:00Z",
      recordClass: "ledger",
      title: null,
    }),
    makeWearableEntity({
      attributes: {
        durationMinutes: 420,
        externalRef: makeExternalRef({
          resourceId: "sleep-1",
          resourceType: "sleep_session",
          system: "oura",
        }),
        startAt: "2026-04-01T22:00:00Z",
      },
      entityId: "event_oura_sleep",
      family: "event",
      kind: "sleep_session",
      recordClass: "ledger",
      title: "Oura overnight sleep",
    }),
    makeWearableEntity({
      attributes: {
        externalRef: makeExternalRef({
          resourceId: "broken-sleep",
          resourceType: "sleep_session",
          system: "oura",
        }),
      },
      entityId: "event_oura_sleep_invalid",
      family: "event",
      kind: "sleep_session",
      recordClass: "ledger",
      title: "Broken sleep",
    }),
  ];

  const vault = makeVault([
    ...sampleRows,
    ...observationRows,
    excludedObservation,
    ...activitySessions,
    ...sleepSessions,
    makeWearableEntity({
      attributes: {
        externalRef: makeExternalRef({
          resourceId: "unknown-provider",
          resourceType: "summary",
        }),
        recordedAt: "2026-04-02T10:30:00Z",
        value: 480,
      },
      entityId: "obs_unknown_provider",
      family: "event",
      kind: "observation",
      recordClass: "ledger",
      title: "Unknown provider observation",
    }),
  ]);

  const dataset = collectWearableDataset(vault, { providers: [" OURA ", "garmin"] });

  assert.equal(dataset.provenanceDiagnostics.length, 2);
  const includedDiagnostic = dataset.provenanceDiagnostics.find((diagnostic) => diagnostic.kind === "included");
  const excludedDiagnostic = dataset.provenanceDiagnostics.find((diagnostic) => diagnostic.kind === "excluded");
  assert.equal(includedDiagnostic?.provider, "oura");
  assert.equal(includedDiagnostic?.count, 2);
  assert.deepEqual(includedDiagnostic?.dates, ["2026-04-02", "2026-04-01"]);
  assert.equal(includedDiagnostic?.latestRecordedAt, "2026-04-02T07:00:00Z");
  assert.equal(excludedDiagnostic?.provider, null);

  assert.equal(dataset.rawMetricCandidates.every((candidate) => candidate.provider === "oura" || candidate.provider === "garmin"), true);
  assert.equal(dataset.rawMetricCandidates.some((candidate) => candidate.metric === "temperature"), true);
  assert.equal(dataset.rawMetricCandidates.some((candidate) => candidate.metric === "averageHeartRate"), true);
  assert.equal(dataset.rawMetricCandidates.some((candidate) => candidate.metric === "steps"), true);
  assert.equal(dataset.rawMetricCandidates.some((candidate) => candidate.metric === "distanceKm"), true);
  assert.equal(dataset.rawMetricCandidates.some((candidate) => candidate.metric === "awakeMinutes"), true);
  assert.equal(dataset.rawMetricCandidates.some((candidate) => candidate.metric === "remMinutes"), true);

  assert.equal(dataset.metricCandidates.some((candidate) => candidate.sourceKind === "sleep-stage-aggregate"), true);
  assert.equal(dataset.metricCandidates.some((candidate) => candidate.metric === "awakeMinutes" && candidate.sourceKind === "sleep-stage-aggregate"), true);
  assert.equal(dataset.metricCandidates.some((candidate) => candidate.metric === "remMinutes" && candidate.sourceKind === "sleep-stage-aggregate"), true);
  assert.equal(dataset.metricCandidates.some((candidate) => candidate.metric === "distanceKm" && candidate.value === 1.5), true);
  assert.equal(dataset.metricCandidates.some((candidate) => candidate.metric === "steps" && candidate.value === 1000), true);
  assert.equal(dataset.metricCandidates.some((candidate) => candidate.metric === "sleepEfficiency" && candidate.unit === "%"), true);

  assert.equal(dataset.activitySessionAggregates.length, 1);
  assert.equal(dataset.activitySessionAggregates[0]?.sessionCount, 2);
  assert.equal(dataset.activitySessionAggregates[0]?.sessionMinutes, 35);
  assert.deepEqual(dataset.activitySessionAggregates[0]?.activityTypes, ["Cycling", "Running"]);

  assert.equal(dataset.sleepWindows.length, 2);
  assert.equal(dataset.sleepWindows.some((window) => window.nap), true);
  assert.equal(dataset.sleepWindows.some((window) => window.title === "Oura overnight sleep"), true);
  assert.equal(dataset.sleepWindows.some((window) => window.date === "2026-04-01"), true);

  assert.equal(selectMetricCandidates(dataset.metricCandidates, "distanceKm").length >= 2, true);
  assert.equal(matchesDateFilters("2026-04-02", { date: "2026-04-02" }), true);
  assert.equal(matchesDateFilters("2026-04-01", { from: "2026-04-02" }), false);
  assert.equal(matchesDateFilters("2026-04-03", { to: "2026-04-02" }), false);
});

test("exported helpers merge and group wearable candidates deterministically", () => {
  const activityCandidates = [
    makeMetricCandidate({
      candidateId: "oura:activity:1",
      date: "2026-04-02",
      metric: "sessionMinutes",
      provider: "oura",
      sourceFamily: "event",
      sourceKind: "activity_session",
      title: "Oura Running Session",
      unit: "minutes",
      value: 20,
    }),
    makeMetricCandidate({
      candidateId: "oura:activity:2",
      date: "2026-04-02",
      metric: "sessionMinutes",
      provider: "oura",
      sourceFamily: "event",
      sourceKind: "activity_session",
      title: "Oura Cycling Session",
      unit: "minutes",
      value: 15,
    }),
    makeMetricCandidate({
      candidateId: "garmin:activity:1",
      date: "2026-04-01",
      metric: "sessionMinutes",
      provider: "garmin",
      sourceFamily: "event",
      sourceKind: "activity_session",
      title: "Garmin Walking Session",
      unit: "minutes",
      value: 30,
    }),
  ];

  const activityAggregates = buildActivitySessionAggregates(activityCandidates);
  assert.equal(activityAggregates.length, 2);
  assert.equal(activityAggregates[0]?.provider, "oura");
  assert.equal(activityAggregates[1]?.provider, "garmin");
  assert.equal(activityAggregates[0]?.sessionCount, 2);
  assert.equal(activityAggregates[0]?.sessionMinutes, 35);
  assert.deepEqual(resolveSelectedActivityTypes(activityAggregates, "oura"), ["Cycling", "Running"]);
  assert.deepEqual(resolveSelectedActivityTypes(activityAggregates, null), []);

  const directMinutes = buildActivitySessionMetricCandidate(activityAggregates[0]!, "sessionMinutes");
  const directCount = buildActivitySessionMetricCandidate(activityAggregates[0]!, "sessionCount");
  assert.equal(directMinutes.title, "Oura activity sessions");
  assert.equal(directMinutes.value, 35);
  assert.equal(directCount.unit, "count");
  assert.equal(directCount.value, 2);

  const sleepStageCandidates = [
    makeMetricCandidate({
      candidateId: "oura:sleep-stage:1",
      date: "2026-04-02",
      metric: "lightMinutes",
      provider: "oura",
      sourceFamily: "sample",
      sourceKind: "sleep_stage:light",
      title: "Light stage",
      unit: "minutes",
      value: 20,
    }),
    makeMetricCandidate({
      candidateId: "oura:sleep-stage:2",
      date: "2026-04-02",
      metric: "lightMinutes",
      provider: "oura",
      sourceFamily: "sample",
      sourceKind: "sleep_stage:light",
      title: "Light stage",
      unit: "minutes",
      value: 15,
    }),
    makeMetricCandidate({
      candidateId: "oura:sleep-stage:3",
      date: "2026-04-02",
      metric: "deepMinutes",
      provider: "oura",
      sourceFamily: "sample",
      sourceKind: "sleep_stage:deep",
      title: "Deep stage",
      unit: "minutes",
      value: 30,
    }),
  ];

  const sleepStageAggregates = buildSleepStageAggregateCandidates(sleepStageCandidates);
  assert.equal(sleepStageAggregates.length, 2);
  assert.equal(sleepStageAggregates[0]?.title, "Oura sleep stages");
  assert.equal(sleepStageAggregates[0]?.sourceFamily, "derived");
  assert.equal(sleepStageAggregates[0]?.sourceKind, "sleep-stage-aggregate");
  assert.equal(sleepStageAggregates.some((candidate) => candidate.metric === "lightMinutes" && candidate.value === 35), true);
  assert.equal(sleepStageAggregates.some((candidate) => candidate.metric === "deepMinutes" && candidate.value === 30), true);

  const sleepWindow = makeSleepWindowCandidate({
    candidateId: "oura:sleep:1",
    date: "2026-04-02",
    durationMinutes: 450,
    endAt: "2026-04-03T06:00:00Z",
    nap: false,
    provider: "oura",
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: "2026-04-02T22:30:00Z",
    title: "Oura overnight sleep",
  });

  const sleepWindowMetric = buildSleepWindowMetricCandidate(sleepWindow);
  assert.equal(sleepWindowMetric.candidateId, "oura:sleep:1:sessionMinutes");
  assert.equal(sleepWindowMetric.metric, "sessionMinutes");
  assert.equal(sleepWindowMetric.unit, "minutes");
  assert.equal(sleepWindowMetric.value, 450);

  const metricGroup = groupMetricCandidatesByDate([
    directMinutes,
    directCount,
    ...sleepStageAggregates,
  ]);
  assert.equal(metricGroup.get("2026-04-02")?.length, 4);

  const aggregateGroup = groupActivitySessionAggregatesByDate(activityAggregates);
  assert.equal(aggregateGroup.get("2026-04-02")?.length, 1);
  assert.equal(aggregateGroup.get("2026-04-01")?.length, 1);

  const sleepGroup = groupSleepWindowsByDate([
    sleepWindow,
    makeSleepWindowCandidate({
      candidateId: "oura:sleep:2",
      date: "2026-04-01",
      durationMinutes: 30,
      nap: true,
      provider: "oura",
      sourceFamily: "event",
      sourceKind: "sleep_session",
      title: "Oura nap",
    }),
  ]);
  assert.equal(sleepGroup.get("2026-04-02")?.length, 1);
  assert.equal(sleepGroup.get("2026-04-01")?.length, 1);

  const fallbackBase = createMetricCandidateBase(
    makeWearableEntity({
      attributes: {
        externalRef: makeExternalRef({
          facet: "raw",
          resourceId: "base-1",
          resourceType: "summary",
          system: "oura",
        }),
        recordedAt: "2026-04-03T10:00:00Z",
        title: "Fallback title",
      },
      entityId: "evt_candidate_base",
      family: "event",
      kind: "observation",
      recordClass: "ledger",
      title: "Fallback title",
    }),
    "oura",
    makeExternalRef({
      facet: "raw",
      resourceId: "base-1",
      resourceType: "summary",
      system: "oura",
    }),
    "2026-04-03",
    "sample",
    "steps",
  );
  assert.equal(fallbackBase.title, "Fallback title");
  assert.equal(fallbackBase.candidateId.startsWith("oura:2026-04-03:sample:steps"), true);
});
