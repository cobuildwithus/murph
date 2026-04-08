import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  buildWearableAssistantSummary,
  listWearableActivityDays,
  listWearableBodyStateDays,
  listWearableRecoveryDays,
  listWearableSleepNights,
  listWearableSourceHealth,
  summarizeWearableActivity,
  summarizeWearableBodyState,
  summarizeWearableDay,
  summarizeWearableRecovery,
  summarizeWearableSleep,
} from "../src/wearables.ts";
import { buildWearableSourceHealth } from "../src/wearables/source-health.ts";
import {
  buildActivitySessionAggregates,
  buildActivitySessionMetricCandidate,
  buildSleepStageAggregateCandidates,
  buildSleepWindowMetricCandidate,
  collectWearableDataset,
  createMetricCandidateBase,
  matchesDateFilters,
  selectMetricCandidates,
} from "../src/wearables/candidates.ts";
import {
  buildSummaryHighlight,
  collectSummaryProviders,
  inferDaySummaryConfidence,
  summarizeMetricsConfidence,
} from "../src/wearables/confidence.ts";
import {
  buildCandidateExactKey,
  dedupeExactMetricCandidates,
  dedupeSleepWindowCandidates,
} from "../src/wearables/dedupe.ts";
import {
  compareWearableProviders,
  formatMetricLabel,
  formatMetricValue,
  formatProviderName,
  inferDefaultMetricFamily,
  isPreferredWearableProvider,
  resolveMetricTolerance,
  resolveWearableProviderPriority,
  resourceTypeScore,
  sourceFamilyScore,
} from "../src/wearables/provider-policy.ts";
import {
  emptyMetricSelection,
  resolveMetric,
  resolveSleepWindowSelection,
  withSleepFallback,
} from "../src/wearables/selection.ts";
import {
  buildCandidateId,
  ageInMilliseconds,
  collectLatestDate,
  collectSortedDatesDesc,
  compareIsoDesc,
  latestIsoTimestamp,
  metersToKilometers,
  normalizeActivityTypeFromTitle,
  normalizeLowercaseString,
  normalizeNullableString,
  normalizeUnit,
  readNumber,
  uniqueStrings,
} from "../src/wearables/shared.ts";
import {
  summarizeActivityNotes,
  summarizeBodyStateNotes,
  summarizeRecoveryNotes,
  summarizeSleepNotes,
} from "../src/wearables/summaries.ts";
import type {
  WearableCandidateSourceFamily,
  WearableConfidenceLevel,
  WearableExternalRef,
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricSelection,
  WearableResolvedMetric,
  WearableSleepWindowCandidate,
  WearableSummaryConfidence,
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

function makeVault(entities: readonly CanonicalEntity[]) {
  return createVaultReadModel({
    entities,
    vaultRoot: "/virtual/wearables-test",
    metadata: null,
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

function makeResolvedMetric(overrides: {
  metric: string;
  provider: string | null;
  value: number | null;
  level?: WearableConfidenceLevel;
  conflictingProviders?: string[];
  exactDuplicateCount?: number;
  reasons?: string[];
  resolution?: WearableMetricSelection["resolution"];
  fallbackFromMetric?: string | null;
  fallbackReason?: string | null;
  sourceFamily?: WearableCandidateSourceFamily | null;
  sourceKind?: string | null;
  unit?: string | null;
  title?: string | null;
  paths?: string[];
  recordIds?: string[];
  recordedAt?: string | null;
  occurredAt?: string | null;
}): WearableResolvedMetric {
  const selection = emptyMetricSelection();

  return {
    candidates: [],
    confidence: {
      candidateCount: overrides.value === null ? 0 : 1,
      conflictingProviders: overrides.conflictingProviders ?? [],
      exactDuplicateCount: overrides.exactDuplicateCount ?? 0,
      level: overrides.level ?? (overrides.value === null ? "none" : "high"),
      reasons: overrides.reasons ?? [],
    },
    metric: overrides.metric,
    selection: {
      ...selection,
      fallbackFromMetric: overrides.fallbackFromMetric ?? null,
      fallbackReason: overrides.fallbackReason ?? null,
      occurredAt: overrides.occurredAt ?? null,
      paths: overrides.paths ?? [],
      provider: overrides.provider,
      recordedAt: overrides.recordedAt ?? null,
      recordIds: overrides.recordIds ?? [],
      resolution: overrides.resolution ?? (overrides.value === null ? "none" : "direct"),
      sourceFamily: overrides.sourceFamily ?? null,
      sourceKind: overrides.sourceKind ?? null,
      title: overrides.title ?? null,
      unit: overrides.unit ?? null,
      value: overrides.value,
    },
  };
}

function makeSummaryConfidence(overrides: Partial<WearableSummaryConfidence> & {
  level: WearableConfidenceLevel;
}): WearableSummaryConfidence {
  return {
    conflictingMetrics: overrides.conflictingMetrics ?? [],
    level: overrides.level,
    lowConfidenceMetrics: overrides.lowConfidenceMetrics ?? [],
    notes: overrides.notes ?? [],
    selectedProviders: overrides.selectedProviders ?? [],
  };
}

test("shared and provider-policy helpers normalize and rank wearable evidence deterministically", () => {
  assert.equal(normalizeNullableString("  Garmin  "), "Garmin");
  assert.equal(normalizeNullableString("   "), null);
  assert.equal(normalizeLowercaseString(" Oura "), "oura");
  assert.equal(readNumber(42), 42);
  assert.equal(readNumber(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeUnit(" bpm "), "bpm");
  assert.equal(buildCandidateId([" garmin ", "", " 2026-04-01 "]), "garmin:2026-04-01");
  assert.deepEqual(uniqueStrings(["a", "", "a", "b"]), ["a", "b"]);
  assert.equal(latestIsoTimestamp([null, "2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z"]), "2026-04-02T00:00:00Z");
  assert.deepEqual(collectSortedDatesDesc(["2026-04-01", "2026-04-03", "2026-04-01"]), ["2026-04-03", "2026-04-01"]);
  assert.equal(collectLatestDate([null, "2026-04-01", "2026-04-03"]), "2026-04-03");
  assert.equal(compareIsoDesc("2026-04-02", "2026-04-01") < 0, true);
  assert.equal(normalizeActivityTypeFromTitle("Garmin Running Session"), "Running");
  assert.equal(normalizeActivityTypeFromTitle(null), null);
  assert.equal(metersToKilometers(1234), 1.234);
  assert.equal(ageInMilliseconds(null, new Date("2026-04-03T00:00:00Z")), null);
  assert.equal(ageInMilliseconds("not-a-date", new Date("2026-04-03T00:00:00Z")), null);
  assert.equal(ageInMilliseconds("2026-04-02T00:00:00Z", new Date("2026-04-03T00:00:00Z")), 86_400_000);
  assert.equal(ageInMilliseconds("2026-04-04T00:00:00Z", new Date("2026-04-03T00:00:00Z")), 0);

  assert.equal(formatProviderName("oura"), "Oura");
  assert.equal(formatProviderName("Example"), "Example");
  assert.equal(formatMetricLabel("sleepTotalMinutes"), "Sleep Total Minutes");
  assert.equal(formatMetricValue(14.4, "minutes"), "14 min");
  assert.equal(formatMetricValue(72.25, "kg"), "72.3 kg");
  assert.equal(formatMetricValue(88.4, "%"), "88%");
  assert.equal(formatMetricValue(7.6, "count"), "8");
  assert.equal(formatMetricValue(12.345, "km"), "12.35 km");
  assert.equal(formatMetricValue(12.5, "bpm"), "12.5 bpm");

  assert.equal(resolveWearableProviderPriority("steps", "unknown-provider"), 0);
  assert.equal(resolveWearableProviderPriority("steps", "oura") > 0, true);
  assert.equal(compareWearableProviders("steps", "beta", "alpha") > 0, true);
  assert.equal(isPreferredWearableProvider("steps", "alpha", ["beta", "alpha"]), true);
  assert.equal(isPreferredWearableProvider("steps", " ", ["beta", "alpha"]), false);

  assert.equal(inferDefaultMetricFamily("sleepScore"), "sleep");
  assert.equal(inferDefaultMetricFamily("recoveryScore"), "recovery");
  assert.equal(inferDefaultMetricFamily("bodyFatPercentage"), "body");
  assert.equal(inferDefaultMetricFamily("steps"), "activity");

  assert.equal(resourceTypeScore("sleepScore", "sleep_summary"), 4);
  assert.equal(resourceTypeScore("recoveryScore", "recovery_summary"), 4);
  assert.equal(resourceTypeScore("steps", "activity_summary"), 4);
  assert.equal(resourceTypeScore("bodyFatPercentage", "body_summary"), 4);
  assert.equal(resourceTypeScore("sleepScore", "summary"), 2);
  assert.equal(resourceTypeScore("steps", "mystery"), 1);
  assert.equal(resourceTypeScore("steps", null), 0);

  assert.equal(sourceFamilyScore("event"), 3);
  assert.equal(sourceFamilyScore("sample"), 2);
  assert.equal(sourceFamilyScore("derived"), 1);

  assert.equal(resolveMetricTolerance("steps"), 250);
  assert.equal(resolveMetricTolerance("activeCalories"), 25);
  assert.equal(resolveMetricTolerance("distanceKm"), 0.25);
  assert.equal(resolveMetricTolerance("sessionMinutes"), 5);
  assert.equal(resolveMetricTolerance("sessionCount"), 0);
  assert.equal(resolveMetricTolerance("activityScore"), 1);
  assert.equal(resolveMetricTolerance("averageHeartRate"), 1);
  assert.equal(resolveMetricTolerance("hrv"), 3);
  assert.equal(resolveMetricTolerance("temperature"), 0.2);
  assert.equal(resolveMetricTolerance("weightKg"), 0.2);
  assert.equal(resolveMetricTolerance("bmi"), 0.1);
  assert.equal(resolveMetricTolerance("dayStrain"), 0.5);
});

test("dedupe, selection, confidence, and summary helpers preserve deterministic branches", () => {
  const duplicateMetricA = makeMetricCandidate({
    candidateId: "beta:steps:1",
    date: "2026-04-01",
    externalRef: makeExternalRef({
      resourceId: "steps-1",
      resourceType: "summary",
      system: "beta",
    }),
    metric: "steps",
    occurredAt: "2026-04-01T08:00:00Z",
    paths: ["one.jsonl"],
    provider: "beta",
    recordedAt: "2026-04-01T08:05:00Z",
    recordIds: ["evt_beta_1"],
    sourceFamily: "sample",
    sourceKind: "steps",
    title: "Beta steps",
    unit: "count",
    value: 1000,
  });
  const duplicateMetricB = makeMetricCandidate({
    ...duplicateMetricA,
    candidateId: "beta:steps:2",
    paths: ["two.jsonl"],
    recordedAt: "2026-04-01T08:11:00Z",
    recordIds: ["evt_beta_2"],
  });
  const conflictingMetric = makeMetricCandidate({
    candidateId: "alpha:steps:1",
    date: "2026-04-01",
    externalRef: makeExternalRef({
      resourceId: "steps-2",
      resourceType: "summary",
      system: "alpha",
    }),
    metric: "steps",
    occurredAt: "2026-04-01T08:00:00Z",
    paths: ["three.jsonl"],
    provider: "alpha",
    recordedAt: "2026-04-01T08:02:00Z",
    recordIds: ["evt_alpha_1"],
    sourceFamily: "sample",
    sourceKind: "steps",
    title: "Alpha steps",
    unit: "count",
    value: 1300,
  });

  assert.equal(
    buildCandidateExactKey(duplicateMetricA),
    "beta|2026-04-01|steps|count|1000.0000|sample|steps|summary|steps-1||2026-04-01T08:00:00Z",
  );

  const dedupedMetrics = dedupeExactMetricCandidates([
    duplicateMetricA,
    duplicateMetricB,
    conflictingMetric,
  ]);
  assert.equal(dedupedMetrics.exactDuplicateCount, 1);
  assert.equal(dedupedMetrics.candidates.length, 2);
  assert.deepEqual(
    dedupedMetrics.candidates.find((candidate) => candidate.provider === "beta")?.paths,
    ["one.jsonl", "two.jsonl"],
  );
  assert.deepEqual(
    dedupedMetrics.candidates.find((candidate) => candidate.provider === "beta")?.recordIds,
    ["evt_beta_1", "evt_beta_2"],
  );
  assert.equal(
    dedupedMetrics.candidates.find((candidate) => candidate.provider === "beta")?.recordedAt,
    "2026-04-01T08:11:00Z",
  );

  const lowConfidence = resolveMetric("steps", [
    duplicateMetricA,
    duplicateMetricB,
    conflictingMetric,
  ], { metricFamily: "activity" });
  assert.equal(lowConfidence.selection.provider, "beta");
  assert.equal(lowConfidence.selection.value, 1000);
  assert.equal(lowConfidence.confidence.level, "low");
  assert.deepEqual(lowConfidence.confidence.conflictingProviders, ["alpha"]);
  assert.equal(
    lowConfidence.confidence.reasons.some((reason) => reason.includes("Suppressed 1 exact duplicate candidate.")),
    true,
  );
  assert.equal(
    lowConfidence.confidence.reasons.some((reason) => reason.includes("scored highest") && reason.includes("ahead of")),
    true,
  );
  assert.equal(
    lowConfidence.confidence.reasons.some((reason) => reason.includes("Conflicting values remained from alpha.")),
    true,
  );

  const withinTolerance = resolveMetric("steps", [
    makeMetricCandidate({
      candidateId: "beta:steps:low",
      date: "2026-04-01",
      externalRef: makeExternalRef({
        resourceId: "steps-3",
        resourceType: "summary",
        system: "beta",
      }),
      metric: "steps",
      occurredAt: "2026-04-01T09:00:00Z",
      paths: ["four.jsonl"],
      provider: "beta",
      recordedAt: "2026-04-01T09:05:00Z",
      recordIds: ["evt_beta_3"],
      sourceFamily: "sample",
      sourceKind: "steps",
      title: "Beta steps",
      unit: "count",
      value: 1000,
    }),
    makeMetricCandidate({
      candidateId: "alpha:steps:low",
      date: "2026-04-01",
      externalRef: makeExternalRef({
        resourceId: "steps-4",
        resourceType: "summary",
        system: "alpha",
      }),
      metric: "steps",
      occurredAt: "2026-04-01T09:00:00Z",
      paths: ["five.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-01T09:06:00Z",
      recordIds: ["evt_alpha_2"],
      sourceFamily: "sample",
      sourceKind: "steps",
      title: "Alpha steps",
      unit: "count",
      value: 1200,
    }),
  ], { metricFamily: "activity" });
  assert.equal(withinTolerance.confidence.level, "high");
  assert.equal(
    withinTolerance.confidence.reasons.some((reason) => reason.includes("Providers agreed within tolerance:")),
    true,
  );
  assert.equal(withinTolerance.confidence.conflictingProviders.length, 0);

  const empty = resolveMetric("steps", [], { metricFamily: "activity" });
  assert.deepEqual(empty.selection, emptyMetricSelection());
  assert.equal(empty.confidence.level, "none");

  const sleepWindow = makeSleepWindowCandidate({
    candidateId: "oura:sleep:1",
    date: "2026-04-01",
    durationMinutes: 450,
    endAt: "2026-04-02T06:00:00Z",
    nap: false,
    occurredAt: "2026-04-01T22:00:00Z",
    paths: ["sleep.jsonl"],
    provider: "oura",
    recordedAt: "2026-04-02T06:10:00Z",
    recordIds: ["evt_sleep"],
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: "2026-04-01T22:00:00Z",
    title: "Oura sleep window",
  });
  const sleepFallback = resolveMetric(
    "sessionMinutes",
    [buildSleepWindowMetricCandidate(sleepWindow)],
    { metricFamily: "sleep" },
  );
  const liftedFallback = withSleepFallback(
    resolveMetric("totalSleepMinutes", [], { metricFamily: "sleep" }),
    sleepFallback,
    "Used the selected sleep session duration because no direct total-sleep metric was available.",
  );
  assert.equal(liftedFallback.selection.resolution, "fallback");
  assert.equal(liftedFallback.selection.fallbackFromMetric, "sessionMinutes");
  assert.equal(liftedFallback.selection.fallbackReason, "Used the selected sleep session duration because no direct total-sleep metric was available.");
  assert.equal(
    liftedFallback.confidence.reasons[0],
    "Used the selected sleep session duration because no direct total-sleep metric was available.",
  );
  assert.equal(
    withSleepFallback(lowConfidence, sleepFallback, "Used the selected sleep session duration because no direct total-sleep metric was available."),
    lowConfidence,
  );

  const directNapSelection = resolveSleepWindowSelection([
    makeSleepWindowCandidate({
      candidateId: "oura:nap:1",
      date: "2026-04-01",
      durationMinutes: 30,
      endAt: "2026-04-01T14:30:00Z",
      nap: true,
      occurredAt: "2026-04-01T14:00:00Z",
      paths: ["nap.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-01T14:31:00Z",
      recordIds: ["evt_nap"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-01T14:00:00Z",
      title: "Oura nap",
    }),
  ]);
  assert.equal(directNapSelection.selection?.nap, true);
  assert.equal(
    directNapSelection.confidence.reasons[0]?.includes("nap penalty -6"),
    true,
  );

  const conflictedSleepSelection = resolveSleepWindowSelection([
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:1",
      date: "2026-04-01",
      durationMinutes: 480,
      endAt: "2026-04-02T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-01T22:00:00Z",
      paths: ["sleep-a.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-02T06:02:00Z",
      recordIds: ["evt_sleep_a"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-01T22:00:00Z",
      title: "Alpha overnight sleep",
    }),
    makeSleepWindowCandidate({
      candidateId: "beta:sleep:1",
      date: "2026-04-01",
      durationMinutes: 430,
      endAt: "2026-04-02T05:45:00Z",
      nap: false,
      occurredAt: "2026-04-01T21:45:00Z",
      paths: ["sleep-b.jsonl"],
      provider: "beta",
      recordedAt: "2026-04-02T05:50:00Z",
      recordIds: ["evt_sleep_b"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-01T21:45:00Z",
      title: "Beta overnight sleep",
    }),
  ]);
  assert.equal(
    conflictedSleepSelection.confidence.reasons.some((reason) =>
      reason.startsWith("Sleep windows differed across "),
    ),
    true,
  );

  const duplicateWindows = dedupeSleepWindowCandidates([
    makeSleepWindowCandidate({
      candidateId: "oura:sleep:2",
      date: "2026-04-01",
      durationMinutes: 450,
      endAt: "2026-04-02T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-01T22:00:00Z",
      paths: ["sleep-a.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-02T06:10:00Z",
      recordIds: ["evt_sleep_1"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-01T22:00:00Z",
      title: "Oura sleep window",
    }),
    makeSleepWindowCandidate({
      candidateId: "oura:sleep:3",
      date: "2026-04-01",
      durationMinutes: 450,
      endAt: "2026-04-02T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-01T22:00:00Z",
      paths: ["sleep-b.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-02T06:20:00Z",
      recordIds: ["evt_sleep_2"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-01T22:00:00Z",
      title: "Oura sleep window",
    }),
    makeSleepWindowCandidate({
      candidateId: "oura:nap:2",
      date: "2026-04-01",
      durationMinutes: 30,
      endAt: "2026-04-01T14:30:00Z",
      nap: true,
      occurredAt: "2026-04-01T14:00:00Z",
      paths: ["nap.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-01T14:31:00Z",
      recordIds: ["evt_nap_2"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-01T14:00:00Z",
      title: "Oura nap",
    }),
  ]);
  assert.equal(duplicateWindows.length, 2);
  assert.deepEqual(duplicateWindows[0]?.paths, ["sleep-a.jsonl", "sleep-b.jsonl"]);
  assert.equal(duplicateWindows[0]?.recordedAt, "2026-04-02T06:20:00Z");

  const sessionCandidates = [
    makeMetricCandidate({
      candidateId: "garmin:activity:1",
      date: "2026-04-02",
      externalRef: makeExternalRef({
        resourceId: "run-1",
        resourceType: "activity_session",
        system: "garmin",
      }),
      metric: "sessionMinutes",
      occurredAt: "2026-04-02T06:00:00Z",
      paths: ["activity-a.jsonl"],
      provider: "garmin",
      recordedAt: "2026-04-02T06:10:00Z",
      recordIds: ["evt_activity_1"],
      sourceFamily: "event",
      sourceKind: "activity_session",
      title: "Garmin Running Session",
      unit: "minutes",
      value: 20,
    }),
    makeMetricCandidate({
      candidateId: "garmin:activity:2",
      date: "2026-04-02",
      externalRef: makeExternalRef({
        resourceId: "cycle-1",
        resourceType: "activity_session",
        system: "garmin",
      }),
      metric: "sessionMinutes",
      occurredAt: "2026-04-02T08:00:00Z",
      paths: ["activity-b.jsonl"],
      provider: "garmin",
      recordedAt: "2026-04-02T08:15:00Z",
      recordIds: ["evt_activity_2"],
      sourceFamily: "event",
      sourceKind: "activity_session",
      title: "Garmin Cycling Session",
      unit: "minutes",
      value: 15,
    }),
    makeMetricCandidate({
      candidateId: "oura:activity:1",
      date: "2026-04-02",
      externalRef: makeExternalRef({
        resourceId: "row-1",
        resourceType: "activity_session",
        system: "oura",
      }),
      metric: "sessionMinutes",
      occurredAt: "2026-04-02T09:00:00Z",
      paths: ["activity-c.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-02T09:10:00Z",
      recordIds: ["evt_activity_3"],
      sourceFamily: "event",
      sourceKind: "activity_session",
      title: "Oura Rowing Session",
      unit: "minutes",
      value: 30,
    }),
  ];

  const activityAggregates = buildActivitySessionAggregates(sessionCandidates);
  assert.equal(activityAggregates.length, 2);
  assert.equal(activityAggregates[0]?.provider, "garmin");
  assert.equal(activityAggregates[0]?.sessionCount, 2);
  assert.equal(activityAggregates[0]?.sessionMinutes, 35);
  assert.deepEqual(activityAggregates[0]?.activityTypes, ["Cycling", "Running"]);
  assert.equal(
    buildActivitySessionMetricCandidate(activityAggregates[0]!, "sessionCount").value,
    2,
  );
  assert.equal(
    buildActivitySessionMetricCandidate(activityAggregates[0]!, "sessionMinutes").metric,
    "sessionMinutes",
  );
  assert.equal(selectMetricCandidates(sessionCandidates, "sessionMinutes").length, 3);
  assert.equal(matchesDateFilters("2026-04-02", { date: "2026-04-02" }), true);
  assert.equal(matchesDateFilters("2026-04-01", { from: "2026-04-02" }), false);
  assert.equal(matchesDateFilters("2026-04-03", { to: "2026-04-02" }), false);

  const sleepStageCandidates = [
    makeMetricCandidate({
      candidateId: "oura:sleep-stage:1",
      date: "2026-04-01",
      externalRef: makeExternalRef({
        system: "oura",
      }),
      metric: "lightMinutes",
      occurredAt: "2026-04-01T22:00:00Z",
      paths: ["sleep-stage-a.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-02T06:00:00Z",
      recordIds: ["evt_stage_1"],
      sourceFamily: "sample",
      sourceKind: "sleep_stage:light",
      title: "Light stage",
      unit: "minutes",
      value: 25,
    }),
    makeMetricCandidate({
      candidateId: "oura:sleep-stage:2",
      date: "2026-04-01",
      externalRef: makeExternalRef({
        system: "oura",
      }),
      metric: "lightMinutes",
      occurredAt: "2026-04-01T23:00:00Z",
      paths: ["sleep-stage-b.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-02T06:15:00Z",
      recordIds: ["evt_stage_2"],
      sourceFamily: "sample",
      sourceKind: "sleep_stage:light",
      title: "Light stage",
      unit: "minutes",
      value: 15,
    }),
    makeMetricCandidate({
      candidateId: "oura:sleep-stage:3",
      date: "2026-04-01",
      externalRef: makeExternalRef({
        system: "oura",
      }),
      metric: "deepMinutes",
      occurredAt: "2026-04-01T23:30:00Z",
      paths: ["sleep-stage-c.jsonl"],
      provider: "oura",
      recordedAt: "2026-04-02T06:20:00Z",
      recordIds: ["evt_stage_3"],
      sourceFamily: "sample",
      sourceKind: "sleep_stage:deep",
      title: "Deep stage",
      unit: "minutes",
      value: 20,
    }),
  ];

  const sleepStageAggregates = buildSleepStageAggregateCandidates(sleepStageCandidates);
  assert.equal(sleepStageAggregates.length, 2);
  assert.equal(sleepStageAggregates.every((candidate) => candidate.sourceKind === "sleep-stage-aggregate"), true);
  assert.equal(sleepStageAggregates.some((candidate) => candidate.title === "Oura sleep stages" && candidate.value === 40), true);
  assert.equal(sleepStageAggregates.some((candidate) => candidate.title === "Oura sleep stages" && candidate.value === 20), true);

  const candidateBase = createMetricCandidateBase(
    makeEntity({
      attributes: {
        recordedAt: "2026-04-01T10:00:00Z",
        title: "Fallback title",
      },
      entityId: "evt_candidate_base",
      family: "event",
      kind: "observation",
      path: "ledger/events/2026/evt_candidate_base.jsonl",
      recordClass: "ledger",
    }),
    "oura",
    makeExternalRef({
      resourceId: "base-1",
      resourceType: "summary",
      system: "oura",
    }),
    "2026-04-01",
    "sample",
    "steps",
  );
  assert.equal(candidateBase.title, "Fallback title");
  assert.equal(candidateBase.candidateId.startsWith("oura:2026-04-01:sample:steps"), true);

  const wearableVault = makeVault([
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        externalRef: makeExternalRef({
          system: "oura",
        }),
        value: 900,
      },
      entityId: "sample_oura_steps_1",
      family: "sample",
      kind: "sample",
      recordClass: "sample",
      stream: "steps",
      title: "Oura steps",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        externalRef: makeExternalRef({
          system: "oura",
        }),
        value: 900,
      },
      entityId: "sample_oura_steps_1_dup",
      family: "sample",
      kind: "sample",
      path: "samples/duplicate.jsonl",
      recordClass: "sample",
      stream: "steps",
      title: "Oura steps",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        durationMinutes: 430,
        endAt: "2026-04-02T05:30:00Z",
        externalRef: makeExternalRef({
          system: "oura",
        }),
        startAt: "2026-04-01T22:20:00Z",
      },
      entityId: "event_oura_sleep_1",
      family: "event",
      kind: "sleep_session",
      occurredAt: "2026-04-01T22:20:00Z",
      recordClass: "ledger",
      title: "Oura overnight sleep",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        durationMinutes: 25,
        externalRef: makeExternalRef({
          system: "oura",
        }),
        stage: "light",
      },
      entityId: "sample_oura_sleep_stage_1",
      family: "sample",
      kind: "sample",
      recordClass: "sample",
      stream: "sleep_stage",
      title: "Light stage",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        durationMinutes: 15,
        externalRef: makeExternalRef({
          system: "oura",
        }),
        stage: "light",
      },
      entityId: "sample_oura_sleep_stage_2",
      family: "sample",
      kind: "sample",
      recordClass: "sample",
      stream: "sleep_stage",
      title: "Light stage",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        externalRef: makeExternalRef({
          system: "oura",
        }),
        metric: "readiness-score",
        unit: "%",
        value: 84,
      },
      entityId: "event_oura_readiness_1",
      family: "event",
      kind: "observation",
      recordClass: "ledger",
      title: "Oura readiness",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        externalRef: makeExternalRef({
          system: "oura",
        }),
        metric: "weight",
        unit: "kg",
        value: 72.4,
      },
      entityId: "event_oura_weight_1",
      family: "event",
      kind: "observation",
      recordClass: "ledger",
      title: "Oura weight",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        externalRef: makeExternalRef({
          system: "oura",
        }),
        metric: "body-fat-percentage",
        unit: "%",
        value: 18.1,
      },
      entityId: "event_oura_body_fat_1",
      family: "event",
      kind: "observation",
      recordClass: "ledger",
      title: "Oura body fat",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-01",
        externalRef: makeExternalRef({
          resourceId: "sleep-total-unknown",
          resourceType: "sleep_summary",
        }),
        metric: "sleep-total-minutes",
        unit: "minutes",
        value: 999,
      },
      entityId: "event_missing_provider_1",
      family: "event",
      kind: "observation",
      recordClass: "ledger",
      title: "Missing provider sleep metric",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-02",
        durationMinutes: 20,
        externalRef: makeExternalRef({
          resourceId: "run-1",
          resourceType: "activity_session",
          system: "garmin",
        }),
      },
      entityId: "event_garmin_run_1",
      family: "event",
      kind: "activity_session",
      occurredAt: "2026-04-02T06:00:00Z",
      recordClass: "ledger",
      title: "Garmin Running Session",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-02",
        durationMinutes: 15,
        externalRef: makeExternalRef({
          resourceId: "cycle-1",
          resourceType: "activity_session",
          system: "garmin",
        }),
      },
      entityId: "event_garmin_cycle_1",
      family: "event",
      kind: "activity_session",
      occurredAt: "2026-04-02T08:00:00Z",
      recordClass: "ledger",
      title: "Garmin Cycling Session",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-02",
        durationMinutes: 480,
        endAt: "2026-04-02T06:00:00Z",
        externalRef: makeExternalRef({
          resourceId: "sleep-1",
          resourceType: "sleep_session",
          system: "garmin",
        }),
        startAt: "2026-04-01T22:00:00Z",
      },
      entityId: "event_garmin_sleep_1",
      family: "event",
      kind: "sleep_session",
      occurredAt: "2026-04-01T22:00:00Z",
      recordClass: "ledger",
      title: "Garmin overnight sleep",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-02",
        externalRef: makeExternalRef({
          resourceId: "sleep-summary-1",
          resourceType: "sleep_summary",
          system: "garmin",
        }),
        metric: "sleep-total-minutes",
        unit: "minutes",
        value: 480,
      },
      entityId: "event_garmin_sleep_total_1",
      family: "event",
      kind: "observation",
      recordClass: "ledger",
      title: "Garmin sleep total",
    }),
  ]);

  const dataset = collectWearableDataset(wearableVault, {});
  assert.equal(dataset.provenanceDiagnostics.length, 2);
  assert.equal(Array.isArray(dataset.rawMetricCandidates), true);
  assert.equal(dataset.metricCandidates.length > 0, true);
  assert.equal(dataset.metricCandidates.some((candidate) => candidate.sourceKind === "sleep-stage-aggregate"), true);
  assert.equal(dataset.activitySessionAggregates.length, 1);
  assert.equal(dataset.activitySessionAggregates[0]?.sessionCount, 2);
  assert.equal(dataset.activitySessionAggregates[0]?.sessionMinutes, 35);
  assert.deepEqual(dataset.activitySessionAggregates[0]?.activityTypes, ["Cycling", "Running"]);
  assert.equal(dataset.sleepWindows.length, 2);
  assert.equal(dataset.provenanceDiagnostics.some((diagnostic) => diagnostic.kind === "included"), true);
  assert.equal(dataset.provenanceDiagnostics.some((diagnostic) => diagnostic.kind === "excluded"), true);

  const filteredDataset = collectWearableDataset(wearableVault, { providers: ["garmin"] });
  assert.equal(filteredDataset.rawMetricCandidates.every((candidate) => candidate.provider === "garmin"), true);
  assert.equal(filteredDataset.activitySessionAggregates.every((aggregate) => aggregate.provider === "garmin"), true);
  assert.equal(filteredDataset.sleepWindows.every((window) => window.provider === "garmin"), true);

  const activityDays = listWearableActivityDays(wearableVault);
  const sleepNights = listWearableSleepNights(wearableVault);
  const recoveryDays = listWearableRecoveryDays(wearableVault);
  const bodyStateDays = listWearableBodyStateDays(wearableVault);
  const sourceHealth = listWearableSourceHealth(wearableVault);
  const assistant = buildWearableAssistantSummary(wearableVault);
  const filteredAssistant = buildWearableAssistantSummary(wearableVault, {
    providers: ["garmin", "oura", "garmin"],
  });
  const emptyAssistant = buildWearableAssistantSummary(makeVault([]));
  const daySummary = summarizeWearableDay(wearableVault, "2026-04-01");
  const noDaySummary = summarizeWearableDay(wearableVault, "   ");

  assert.equal(activityDays.length, 2);
  assert.equal(activityDays[0]?.date, "2026-04-02");
  assert.deepEqual(activityDays[0]?.activityTypes, ["Cycling", "Running"]);
  assert.equal(activityDays[1]?.steps.selection.value, 900);
  assert.equal(sleepNights.length, 2);
  assert.equal(sleepNights[0]?.date, "2026-04-02");
  assert.equal(
    sleepNights[0]?.notes.some((note) => note.includes("Selected sleep window from Garmin")),
    true,
  );
  assert.equal(recoveryDays.length, 1);
  assert.equal(recoveryDays[0]?.date, "2026-04-01");
  assert.equal(bodyStateDays.length, 1);
  assert.equal(bodyStateDays[0]?.date, "2026-04-01");
  assert.equal(sourceHealth.length, 3);
  assert.equal(sourceHealth[0]?.provider, "garmin");
  assert.equal(sourceHealth[1]?.provider, "oura");
  assert.equal(sourceHealth[2]?.provider, "unknown");
  assert.equal(
    sourceHealth[1]?.notes.some((note) => note.includes("Included") && note.includes("incomplete provenance")),
    true,
  );
  assert.equal(sourceHealth[2]?.notes[0]?.includes("Excluded 1 wearable record from semantic wearables"), true);

  const idleDataset = collectWearableDataset(makeVault([
    makeEntity({
      attributes: {
        dayKey: "2026-04-02",
        durationMinutes: 20,
        externalRef: makeExternalRef({
          resourceId: "run-2",
          resourceType: "activity_session",
          system: "garmin",
        }),
      },
      entityId: "event_garmin_run_2",
      family: "event",
      kind: "activity_session",
      occurredAt: "2026-04-02T06:30:00Z",
      recordClass: "ledger",
      title: "Garmin Running Session",
    }),
    makeEntity({
      attributes: {
        dayKey: "2026-04-02",
        durationMinutes: 15,
        externalRef: makeExternalRef({
          resourceId: "run-3",
          resourceType: "activity_session",
          system: "whoop",
        }),
      },
      entityId: "event_whoop_run_1",
      family: "event",
      kind: "activity_session",
      occurredAt: "2026-04-02T06:45:00Z",
      recordClass: "ledger",
      title: "Whoop Running Session",
    }),
  ]), {});
  const idleSourceHealth = buildWearableSourceHealth({
    activityDays: [],
    bodyStateDays: [],
    dataset: idleDataset,
    recoveryDays: [],
    sleepNights: [],
  });
  const idleWhoopSourceHealth = idleSourceHealth.find((row) => row.provider === "whoop");
  assert.equal(idleWhoopSourceHealth?.selectedMetrics, 0);
  assert.equal(idleWhoopSourceHealth?.candidateMetrics > 0, true);
  assert.equal(
    idleWhoopSourceHealth?.notes.some((note) => note.includes("was not the preferred source for any selected metric")),
    true,
  );
  assert.equal(assistant.latestDate, "2026-04-02");
  assert.deepEqual(assistant.providers, []);
  assert.deepEqual(filteredAssistant.providers, ["garmin", "oura"]);
  assert.equal(assistant.highlights.some((note) => note.includes("Sleep on 2026-04-02 is")), true);
  assert.equal(assistant.highlights.some((note) => note.includes("Recovery on 2026-04-01 is")), true);
  assert.equal(assistant.highlights.some((note) => note.includes("Activity on 2026-04-02 is")), true);
  assert.equal(
    assistant.highlights.some((note) => note.includes("Source freshness differs across providers:")),
    true,
  );
  assert.equal(emptyAssistant.highlights[0], "No wearable summaries were available for the selected range.");
  assert.equal(daySummary?.date, "2026-04-01");
  assert.deepEqual(daySummary?.providers, ["oura", "unknown"]);
  assert.equal(daySummary?.summaryConfidence, "high");
  assert.equal(
    daySummary?.notes.some((note) => note.includes("Excluded 1 wearable record from semantic wearables")),
    true,
  );
  assert.equal(noDaySummary, null);

  assert.equal(summarizeWearableActivity(wearableVault, { limit: 1 }).length, 1);
  assert.equal(summarizeWearableRecovery(wearableVault, { limit: 1 }).length, 1);
  assert.equal(summarizeWearableBodyState(wearableVault, { limit: 1 }).length, 1);
  assert.equal(summarizeWearableSleep(wearableVault, { limit: 1 }).length, 1);
  assert.equal(summarizeWearableSleep(wearableVault, { limit: 0 }).length, sleepNights.length);
});

test("confidence and summary helpers describe the selected evidence plainly", () => {
  const missingSummary = summarizeMetricsConfidence([
    ["steps", makeResolvedMetric({
      metric: "steps",
      provider: null,
      value: null,
    })],
  ], {
    missingSummaryNote: "No metrics were available.",
  });
  assert.equal(missingSummary.level, "none");
  assert.equal(missingSummary.notes[0], "No metrics were available.");

  const mediumSummary = summarizeMetricsConfidence([
    ["steps", makeResolvedMetric({
      conflictingProviders: ["garmin"],
      metric: "steps",
      provider: "oura",
      value: 900,
    })],
    ["sleepScore", makeResolvedMetric({
      metric: "sleepScore",
      provider: "oura",
      value: 92,
    })],
  ], {
    extraNotes: ["Extra note"],
    missingSummaryNote: "No metrics were available.",
  });
  assert.equal(mediumSummary.level, "medium");
  assert.equal(mediumSummary.selectedProviders[0], "oura");
  assert.equal(
    mediumSummary.notes.some((note) => note.includes("Selected evidence came from Oura.")),
    true,
  );
  assert.equal(
    mediumSummary.notes.some((note) => note.includes("Some metrics still conflict across providers: Steps.")),
    true,
  );
  assert.equal(mediumSummary.notes.includes("Extra note"), true);

  const lowSummary = summarizeMetricsConfidence([
    ["steps", makeResolvedMetric({
      level: "low",
      metric: "steps",
      provider: "garmin",
      value: 1000,
    })],
    ["sleepScore", makeResolvedMetric({
      metric: "sleepScore",
      provider: "oura",
      value: 92,
    })],
  ], {
    missingSummaryNote: "No metrics were available.",
  });
  assert.equal(lowSummary.level, "low");
  assert.deepEqual(lowSummary.lowConfidenceMetrics, ["steps"]);

  assert.deepEqual(collectSummaryProviders([
    null,
    { summaryConfidence: makeSummaryConfidence({ level: "high", selectedProviders: ["oura", "garmin"] }) },
    { summaryConfidence: makeSummaryConfidence({ level: "medium", selectedProviders: ["garmin", "whoop"] }) },
  ]), ["oura", "garmin", "whoop"]);

  assert.equal(
    buildSummaryHighlight("sleep", "2026-04-01", makeSummaryConfidence({ level: "none" })),
    "No sleep summary was available for 2026-04-01.",
  );
  assert.equal(
    buildSummaryHighlight("sleep", "2026-04-01", makeSummaryConfidence({ level: "high" })),
    "Sleep on 2026-04-01 is high-confidence and currently resolves to no provider.",
  );

  assert.equal(inferDaySummaryConfidence([null, null]), "none");
  assert.equal(
    inferDaySummaryConfidence([
      { summaryConfidence: makeSummaryConfidence({ level: "low" }) },
      { summaryConfidence: makeSummaryConfidence({ level: "high" }) },
    ]),
    "low",
  );
  assert.equal(
    inferDaySummaryConfidence([
      { summaryConfidence: makeSummaryConfidence({ level: "high" }) },
      { summaryConfidence: makeSummaryConfidence({ level: "high" }) },
    ]),
    "high",
  );
  assert.equal(
    inferDaySummaryConfidence([
      { summaryConfidence: makeSummaryConfidence({ level: "high" }) },
      { summaryConfidence: makeSummaryConfidence({ level: "medium" }) },
    ]),
    "medium",
  );

  const activityNotes = summarizeActivityNotes({
    activityTypes: ["Cycling", "Running"],
    sessionCount: makeResolvedMetric({
      metric: "sessionCount",
      provider: "garmin",
      value: 1,
    }),
    sessionMinutes: makeResolvedMetric({
      metric: "sessionMinutes",
      provider: "garmin",
      value: 35,
    }),
    summaryConfidence: makeSummaryConfidence({
      level: "high",
      notes: ["Shared note", "Shared note"],
    }),
  });
  assert.equal(activityNotes.includes("Shared note"), true);
  assert.equal(
    activityNotes.some((note) => note.includes("Selected 1 activity session covering 35 min.")),
    true,
  );
  assert.equal(activityNotes.some((note) => note.includes("Selected activity types: Cycling, Running.")), true);

  const sleepNotes = summarizeSleepNotes({
    summaryConfidence: makeSummaryConfidence({
      level: "high",
      notes: ["Shared note", "Shared note"],
    }),
    timeInBedMinutes: makeResolvedMetric({
      fallbackReason: "Used the selected sleep session duration because no explicit time-in-bed metric was available.",
      metric: "timeInBedMinutes",
      provider: "oura",
      resolution: "fallback",
      sourceFamily: "derived",
      sourceKind: "sleep-window",
      value: 450,
    }),
    totalSleepMinutes: makeResolvedMetric({
      fallbackReason: "Used the selected sleep session duration because no direct total-sleep metric was available.",
      metric: "totalSleepMinutes",
      provider: "oura",
      resolution: "fallback",
      sourceFamily: "derived",
      sourceKind: "sleep-window",
      value: 450,
    }),
    windowSelection: {
      confidence: {
        candidateCount: 1,
        conflictingProviders: [],
        exactDuplicateCount: 0,
        level: "high",
        reasons: [],
      },
      selection: makeSleepWindowCandidate({
        candidateId: "oura:sleep:summary",
        date: "2026-04-01",
        durationMinutes: 450,
        endAt: "2026-04-02T06:00:00Z",
        nap: false,
        occurredAt: "2026-04-01T22:00:00Z",
        provider: "oura",
        sourceFamily: "event",
        sourceKind: "sleep_session",
        startAt: "2026-04-01T22:00:00Z",
        title: "Oura sleep window",
      }),
    },
  });
  assert.equal(sleepNotes.includes("Shared note"), true);
  assert.equal(
    sleepNotes.some((note) => note.includes("Selected sleep window from Oura spanning 2026-04-01T22:00:00Z to 2026-04-02T06:00:00Z.")),
    true,
  );
  assert.equal(
    sleepNotes.some((note) => note.includes("Selected total sleep: 450 min.")),
    true,
  );
  assert.equal(
    sleepNotes.some((note) => note.includes("Used the selected sleep session duration because no direct total-sleep metric was available.")),
    true,
  );
  assert.equal(
    sleepNotes.some((note) => note.includes("Used the selected sleep session duration because no explicit time-in-bed metric was available.")),
    true,
  );

  const recoveryNotes = summarizeRecoveryNotes({
    readinessScore: makeResolvedMetric({
      metric: "readinessScore",
      provider: "oura",
      value: 84,
    }),
    recoveryScore: makeResolvedMetric({
      metric: "recoveryScore",
      provider: "oura",
      value: 78,
    }),
    summaryConfidence: makeSummaryConfidence({
      level: "high",
      notes: ["Shared note"],
    }),
  });
  assert.equal(recoveryNotes.some((note) => note.includes("Selected recovery score: 78%.")), true);
  assert.equal(recoveryNotes.some((note) => note.includes("Selected readiness score: 84%.")), true);

  const bodyStateNotes = summarizeBodyStateNotes({
    bodyFatPercentage: makeResolvedMetric({
      metric: "bodyFatPercentage",
      provider: "oura",
      value: 18.1,
    }),
    summaryConfidence: makeSummaryConfidence({
      level: "high",
      notes: ["Shared note"],
    }),
    weightKg: makeResolvedMetric({
      metric: "weightKg",
      provider: "oura",
      value: 72.4,
    }),
  });
  assert.equal(bodyStateNotes.some((note) => note.includes("Selected weight: 72.4 kg.")), true);
  assert.equal(
    bodyStateNotes.some((note) => note.includes("Selected body-fat percentage: 18%.")),
    true,
  );
});
