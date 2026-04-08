import assert from "node:assert/strict";

import { test } from "vitest";

import { buildWearableSourceHealth } from "../src/wearables/source-health.ts";
import type {
  WearableActivityDay,
  WearableDataset,
  WearableMetricCandidate,
  WearableResolvedMetric,
  WearableSleepWindowCandidate,
  WearableSourceHealth,
} from "../src/wearables/types.ts";

function makeResolvedMetric(
  metric: string,
  provider: string | null,
  value: number | null,
  conflictingProviders: string[] = [],
): WearableResolvedMetric {
  return {
    candidates: [],
    confidence: {
      candidateCount: value === null ? 0 : 1,
      conflictingProviders,
      exactDuplicateCount: 0,
      level: provider ? "high" : "none",
      reasons: [],
    },
    metric,
    selection: {
      fallbackFromMetric: null,
      fallbackReason: null,
      occurredAt: null,
      paths: [],
      provider,
      recordedAt: null,
      recordIds: [],
      resolution: provider ? "direct" : "none",
      sourceFamily: null,
      sourceKind: null,
      title: null,
      unit: null,
      value,
    },
  };
}

function makeActivityDay(date: string, provider: string, conflictingProviders: string[] = []): WearableActivityDay {
  const makeMetric = (metric: string, value: number) =>
    makeResolvedMetric(metric, provider, value, metric === "steps" ? conflictingProviders : []);

  return {
    activityScore: makeMetric("activityScore", 91),
    activeCalories: makeMetric("activeCalories", 315),
    activityTypes: ["Running"],
    date,
    dayStrain: makeMetric("dayStrain", 7.5),
    distanceKm: makeMetric("distanceKm", 5.2),
    notes: [],
    sessionCount: makeMetric("sessionCount", 1),
    sessionMinutes: makeMetric("sessionMinutes", 42),
    steps: makeMetric("steps", 6_200),
    summaryConfidence: {
      conflictingMetrics: [],
      level: "high",
      lowConfidenceMetrics: [],
      notes: [],
      selectedProviders: [provider],
    },
  };
}

function makeMetricCandidate(overrides: Partial<WearableMetricCandidate> & Pick<
  WearableMetricCandidate,
  "candidateId" | "date" | "metric" | "provider" | "sourceFamily" | "sourceKind" | "unit" | "value"
>): WearableMetricCandidate {
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
    "candidateId" | "date" | "durationMinutes" | "nap" | "provider" | "sourceFamily" | "sourceKind"
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

function makeDataset(overrides: Partial<WearableDataset>): WearableDataset {
  return {
    activitySessionAggregates: overrides.activitySessionAggregates ?? [],
    metricCandidates: overrides.metricCandidates ?? [],
    provenanceDiagnostics: overrides.provenanceDiagnostics ?? [],
    rawMetricCandidates: overrides.rawMetricCandidates ?? [],
    sleepWindows: overrides.sleepWindows ?? [],
  };
}

function rowsByProvider(rows: WearableSourceHealth[]): Map<string, WearableSourceHealth> {
  return new Map(rows.map((row) => [row.provider, row]));
}

test("buildWearableSourceHealth aggregates duplicates, conflicts, staleness, and provenance notes", () => {
  const alphaRawMetric = makeMetricCandidate({
    candidateId: "alpha:steps:1",
    date: "2026-04-01",
    externalRef: {
      facet: null,
      resourceId: "steps-1",
      resourceType: "summary",
      system: "alpha",
      version: null,
    },
    metric: "steps",
    occurredAt: "2026-04-01T07:00:00Z",
    provider: "alpha",
    recordedAt: "2026-04-01T07:05:00Z",
    sourceFamily: "event",
    sourceKind: "observation",
    title: "Alpha steps",
    unit: "count",
    value: 6200,
  });

  const alphaDuplicateMetric = makeMetricCandidate({
    ...alphaRawMetric,
    candidateId: "alpha:steps:2",
    paths: ["/virtual/alpha-steps-2.jsonl"],
    recordIds: ["alpha-event-2"],
    recordedAt: "2026-04-01T07:12:00Z",
  });

  const dataset = makeDataset({
    activitySessionAggregates: [
      {
        activityTypes: ["Running"],
        candidateId: "beta:2026-04-03:activity-session-aggregate",
        date: "2026-04-03",
        paths: ["/virtual/beta-activity-session.jsonl"],
        provider: "beta",
        recordedAt: "2026-04-03T08:10:00Z",
        recordIds: ["beta-activity-1"],
        sessionCount: 1,
        sessionMinutes: 42,
      },
    ],
    metricCandidates: [alphaRawMetric],
    provenanceDiagnostics: [
      {
        count: 1,
        dates: ["2026-04-01"],
        kind: "included",
        latestRecordedAt: "2026-04-01T07:05:00Z",
        missingFields: ["resourceId"],
        provider: "alpha",
      },
      {
        count: 2,
        dates: ["2026-04-01"],
        kind: "included",
        latestRecordedAt: "2026-04-01T07:12:00Z",
        missingFields: ["resourceType", "resourceId"],
        provider: "alpha",
      },
      {
        count: 1,
        dates: ["2026-03-28"],
        kind: "excluded",
        latestRecordedAt: "2026-03-28T10:00:00Z",
        missingFields: ["resourceType"],
        provider: null,
      },
      {
        count: 2,
        dates: ["2026-03-30"],
        kind: "excluded",
        latestRecordedAt: "2026-03-30T10:05:00Z",
        missingFields: ["resourceId", "resourceType"],
        provider: null,
      },
    ],
    rawMetricCandidates: [alphaRawMetric, alphaDuplicateMetric],
    sleepWindows: [
      makeSleepWindowCandidate({
        candidateId: "beta:sleep-window:1",
        date: "2026-04-03",
        durationMinutes: 480,
        endAt: "2026-04-03T06:00:00Z",
        nap: false,
        provider: "beta",
        recordedAt: "2026-04-03T06:00:00Z",
        sourceFamily: "event",
        sourceKind: "sleep_session",
        startAt: "2026-04-02T22:00:00Z",
        title: "Beta sleep session",
      }),
    ],
  });

  const sourceHealth = buildWearableSourceHealth({
    activityDays: [makeActivityDay("2026-04-01", "alpha", ["beta"])],
    bodyStateDays: [],
    dataset,
    recoveryDays: [],
    sleepNights: [],
  });

  const byProvider = rowsByProvider(sourceHealth);
  const alpha = byProvider.get("alpha");
  const beta = byProvider.get("beta");
  const unknown = byProvider.get("unknown");

  assert.deepEqual(sourceHealth.map((row) => row.provider), ["beta", "alpha", "unknown"]);
  assert.equal(alpha?.candidateMetrics, 1);
  assert.equal(alpha?.exactDuplicatesSuppressed, 1);
  assert.equal(alpha?.activityDays, 1);
  assert.equal(alpha?.selectedMetrics, 7);
  assert.equal(alpha?.conflictCount, 1);
  assert.equal(alpha?.stalenessVsNewestDays, 2);
  assert.deepEqual(alpha?.metricsContributed, ["steps"]);
  assert.equal(
    alpha?.notes.some((note) => note.includes("alpha trails the newest wearable source by 2 days.")),
    true,
  );
  assert.equal(
    alpha?.notes.some((note) => note.includes("Included 1 alpha record with incomplete provenance")),
    true,
  );
  assert.equal(
    alpha?.notes.some((note) => note.includes("Included 2 alpha records with incomplete provenance")),
    true,
  );
  assert.equal(
    alpha?.notes.some((note) => note.includes("missing resourceType, resourceId")),
    true,
  );

  assert.equal(beta?.candidateMetrics, 2);
  assert.equal(beta?.exactDuplicatesSuppressed, 0);
  assert.equal(beta?.selectedMetrics, 0);
  assert.equal(beta?.conflictCount, 1);
  assert.equal(beta?.stalenessVsNewestDays, 0);
  assert.deepEqual(beta?.metricsContributed, [
    "sessionCount",
    "sessionMinutes",
    "timeInBedMinutes",
    "totalSleepMinutes",
  ]);
  assert.equal(
    beta?.notes.some((note) => note.includes("contributed candidate evidence but was not the preferred source")),
    true,
  );

  assert.equal(unknown?.candidateMetrics, 3);
  assert.deepEqual(unknown?.metricsContributed, []);
  assert.equal(unknown?.stalenessVsNewestDays, null);
  assert.equal(
    unknown?.notes[0]?.includes(
      "Excluded 3 wearable records from semantic wearables because provenance was incomplete and no provider could be derived from externalRef.system",
    ),
    true,
  );
  assert.equal(unknown?.notes[0]?.includes("missing resourceId, resourceType"), true);
});

test("buildWearableSourceHealth sorts equal-date providers alphabetically and returns rows directly when no provenance is excluded", () => {
  const alphaMetric = makeMetricCandidate({
    candidateId: "alpha:recovery-score:1",
    date: "2026-04-05",
    externalRef: {
      facet: null,
      resourceId: "recovery-1",
      resourceType: "summary",
      system: "alpha",
      version: null,
    },
    metric: "recoveryScore",
    occurredAt: "2026-04-05T07:00:00Z",
    provider: "alpha",
    recordedAt: "2026-04-05T07:05:00Z",
    sourceFamily: "event",
    sourceKind: "observation",
    title: "Alpha recovery",
    unit: "%",
    value: 82,
  });

  const betaMetric = makeMetricCandidate({
    candidateId: "beta:recovery-score:1",
    date: "2026-04-05",
    externalRef: {
      facet: null,
      resourceId: "recovery-2",
      resourceType: "summary",
      system: "beta",
      version: null,
    },
    metric: "recoveryScore",
    occurredAt: "2026-04-05T08:00:00Z",
    provider: "beta",
    recordedAt: "2026-04-05T08:03:00Z",
    sourceFamily: "event",
    sourceKind: "observation",
    title: "Beta recovery",
    unit: "%",
    value: 79,
  });

  const sourceHealth = buildWearableSourceHealth({
    activityDays: [],
    bodyStateDays: [],
    dataset: makeDataset({
      metricCandidates: [alphaMetric, betaMetric],
      rawMetricCandidates: [alphaMetric, betaMetric],
    }),
    recoveryDays: [],
    sleepNights: [],
  });

  assert.deepEqual(sourceHealth.map((row) => row.provider), ["alpha", "beta"]);
  assert.equal(sourceHealth[0]?.stalenessVsNewestDays, 0);
  assert.equal(sourceHealth[1]?.stalenessVsNewestDays, 0);
  assert.equal(
    sourceHealth[0]?.notes.some((note) => note.includes("contributed candidate evidence but was not the preferred source")),
    true,
  );
  assert.equal(
    sourceHealth[1]?.notes.some((note) => note.includes("contributed candidate evidence but was not the preferred source")),
    true,
  );
});
