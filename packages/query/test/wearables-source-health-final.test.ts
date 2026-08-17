import assert from "node:assert/strict";

import { test } from "vitest";

import { buildWearableSummaryBundleFromDataset } from "../src/wearables.ts";
import {
  buildActivitySessionAggregates,
  buildActivitySessionDayRollups,
} from "../src/wearables/candidates.ts";
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
    activityAverageHeartRate: makeMetric("activityAverageHeartRate", 112),
    activityScore: makeMetric("activityScore", 91),
    activeCalories: makeMetric("activeCalories", 315),
    activityMinutes: makeMetric("activityMinutes", 78),
    activityTypes: ["Running"],
    altitudeChangeMeters: makeMetric("altitudeChangeMeters", 33),
    averageHeartRate: makeMetric("averageHeartRate", 76),
    date,
    dayStrain: makeMetric("dayStrain", 7.5),
    distanceKm: makeMetric("distanceKm", 5.2),
    estimatedVo2Max: makeMetric("estimatedVo2Max", 48.6),
    floorsClimbed: makeMetric("floorsClimbed", 12),
    heartRateZones: [],
    highActivityMinutes: makeMetric("highActivityMinutes", 5),
    lowActivityMinutes: makeMetric("lowActivityMinutes", 60),
    lowestHeartRate: makeMetric("lowestHeartRate", 44),
    maxHeartRate: makeMetric("maxHeartRate", 168),
    mediumActivityMinutes: makeMetric("mediumActivityMinutes", 13),
    minimumHeartRate: makeMetric("minimumHeartRate", 51),
    notes: [],
    percentRecorded: makeMetric("percentRecorded", 99),
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
    totalCalories: makeMetric("totalCalories", 530),
    totalElevationGainMeters: makeMetric("totalElevationGainMeters", 42),
    walkingAverageHeartRate: makeMetric("walkingAverageHeartRate", 101),
    workoutFeatures: [],
    workoutStrain: makeMetric("workoutStrain", 11.1),
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
    dataOrigin: overrides.dataOrigin ?? null,
    date: overrides.date,
    durationMinutes: overrides.durationMinutes,
    endAt: overrides.endAt ?? null,
    externalRef: overrides.externalRef ?? null,
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
    activitySessionCandidates: overrides.activitySessionCandidates ?? [],
    activitySessionAggregates: overrides.activitySessionAggregates ?? [],
    activitySessionDayRollups: overrides.activitySessionDayRollups ?? [],
    metricSuppressionEvidence: overrides.metricSuppressionEvidence ?? [],
    metricCandidates: overrides.metricCandidates ?? [],
    provenanceDiagnostics: overrides.provenanceDiagnostics ?? [],
    rawMetricCandidates: overrides.rawMetricCandidates ?? [],
    sleepWindows: overrides.sleepWindows ?? [],
    workoutFeatures: overrides.workoutFeatures ?? [],
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
        heartRateZones: [],
        paths: ["/virtual/beta-activity-session.jsonl"],
        provider: "beta",
        recordedAt: "2026-04-03T08:10:00Z",
        recordIds: ["beta-activity-1"],
        sessionContributors: ["beta"],
        sessionCount: 1,
        sessionMinutes: 42,
        sourceKind: "activity-session-aggregate",
        workoutMetricContributors: {},
        workoutMetricKeys: ["activeCalories", "averageHeartRate"],
        workoutMetricValues: {},
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
  assert.equal(alpha?.selectedMetrics, 24);
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
  ]);
  assert.equal(beta?.metricsContributed.includes("activeCalories"), false);
  assert.equal(
    beta?.notes.some((note) => note.includes("workout detail metrics on activity sessions")),
    true,
  );
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

test("source health attributes each workout rollup field only to its real contributors", () => {
  const date = "2026-04-08";
  const activitySessionCandidates: WearableMetricCandidate[] = [
    {
      ...makeMetricCandidate({
        candidateId: "alpha-activity-session",
        date,
        metric: "sessionMinutes",
        occurredAt: `${date}T13:00:00Z`,
        provider: "alpha",
        recordedAt: `${date}T13:35:00Z`,
        sourceFamily: "event",
        sourceKind: "activity_session",
        unit: "minutes",
        value: 30,
      }),
      activityType: "Running",
      sessionEndAt: `${date}T13:30:00Z`,
      sessionStartAt: `${date}T13:00:00Z`,
      workoutMetricValues: {
        activeCalories: 210,
        maxHeartRate: 181,
        totalElevationGainMeters: 42,
        workoutStrain: 7,
      },
    },
    {
      ...makeMetricCandidate({
        candidateId: "beta-activity-session",
        date,
        metric: "sessionMinutes",
        occurredAt: `${date}T15:00:00Z`,
        provider: "beta",
        recordedAt: `${date}T15:50:00Z`,
        sourceFamily: "event",
        sourceKind: "activity_session",
        unit: "minutes",
        value: 45,
      }),
      activityType: "Strength",
      sessionEndAt: `${date}T15:45:00Z`,
      sessionStartAt: `${date}T15:00:00Z`,
      workoutMetricValues: {
        activeCalories: 160,
        distanceKm: 6.2,
        maxHeartRate: 174,
        workoutStrain: 10,
      },
    },
  ];
  const dataset = makeDataset({
    activitySessionCandidates,
    activitySessionAggregates: buildActivitySessionAggregates(activitySessionCandidates),
    activitySessionDayRollups: buildActivitySessionDayRollups(activitySessionCandidates),
  });
  const sourceHealth = buildWearableSummaryBundleFromDataset(dataset).sourceHealth;

  const byProvider = rowsByProvider(sourceHealth);
  assert.equal(byProvider.get("alpha")?.selectedMetrics, 5);
  assert.equal(byProvider.get("beta")?.selectedMetrics, 5);
  assert.deepEqual(byProvider.get("alpha")?.metricsContributed, [
    "activeCalories",
    "maxHeartRate",
    "sessionCount",
    "sessionMinutes",
    "totalElevationGainMeters",
    "workoutStrain",
  ]);
  assert.deepEqual(byProvider.get("beta")?.metricsContributed, [
    "activeCalories",
    "distanceKm",
    "maxHeartRate",
    "sessionCount",
    "sessionMinutes",
    "workoutStrain",
  ]);
  assert.equal(sourceHealth.every((row) => row.sleepNights === 0), true);
});

test("sleep freshness ignores generic cardiorespiratory observations unless anchored to valid sleep", () => {
  const staleSleepWindow = makeSleepWindowCandidate({
    candidateId: "alpha:sleep:stale",
    date: "2026-04-01",
    durationMinutes: 480,
    endAt: "2026-04-01T07:00:00Z",
    nap: false,
    provider: "alpha",
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: "2026-03-31T23:00:00Z",
  });
  const genericCardiorespiratory = [
    ["averageHeartRate", "bpm", 61],
    ["hrv", "ms", 42],
    ["respiratoryRate", "breaths_per_minute", 15],
    ["spo2", "%", 98],
  ].map(([metric, unit, value], index) => makeMetricCandidate({
    candidateId: `alpha:${String(metric)}:fresh`,
    date: `2026-04-${String(7 + index).padStart(2, "0")}`,
    externalRef: {
      facet: null,
      resourceId: `daily-${String(metric)}`,
      resourceType: "daily-summary",
      system: "alpha",
      version: null,
    },
    metric: String(metric),
    occurredAt: `2026-04-${String(7 + index).padStart(2, "0")}T12:00:00Z`,
    provider: "alpha",
    sourceFamily: "event",
    sourceKind: `observation:${String(metric)}`,
    unit: String(unit),
    value: Number(value),
  }));
  const unambiguousSleepScore = makeMetricCandidate({
    candidateId: "beta:sleep-score:fresh",
    date: "2026-04-08",
    externalRef: {
      facet: null,
      resourceId: "sleep-score",
      resourceType: "daily-summary",
      system: "beta",
      version: null,
    },
    metric: "sleepScore",
    occurredAt: "2026-04-08T08:00:00Z",
    provider: "beta",
    sourceFamily: "event",
    sourceKind: "observation:sleep-score",
    unit: "%",
    value: 81,
  });

  const sourceHealth = rowsByProvider(buildWearableSourceHealth({
    activityDays: [],
    bodyStateDays: [],
    dataset: makeDataset({
      metricCandidates: [...genericCardiorespiratory, unambiguousSleepScore],
      rawMetricCandidates: [...genericCardiorespiratory, unambiguousSleepScore],
      sleepWindows: [staleSleepWindow],
    }),
    recoveryDays: [],
    sleepNights: [],
  }));

  assert.equal(sourceHealth.get("alpha")?.lastDate, "2026-04-10");
  assert.equal(sourceHealth.get("alpha")?.lastSleepDate, "2026-04-01");
  assert.equal(sourceHealth.get("alpha")?.sleepStalenessVsNewestDays, 7);
  assert.equal(sourceHealth.get("beta")?.lastSleepDate, "2026-04-08");
  assert.equal(sourceHealth.get("beta")?.sleepStalenessVsNewestDays, 0);
});

test("activity-owned lowest heart rate contributes activity without fabricating sleep freshness", () => {
  const activityLowestHeartRate = makeMetricCandidate({
    candidateId: "garmin:activity-lowest-heart-rate:1",
    date: "2026-04-08",
    externalRef: {
      facet: "lowest-heart-rate",
      resourceId: "activity-summary-1",
      resourceType: "junction-garmin-activity",
      system: "junction",
      version: null,
    },
    metric: "lowestHeartRate",
    occurredAt: "2026-04-08T12:00:00Z",
    provider: "garmin",
    recordedAt: "2026-04-08T12:05:00Z",
    sourceFamily: "event",
    sourceKind: "observation:lowest-heart-rate",
    unit: "bpm",
    value: 44,
  });
  const bundle = buildWearableSummaryBundleFromDataset(makeDataset({
    metricCandidates: [activityLowestHeartRate],
    rawMetricCandidates: [activityLowestHeartRate],
  }));
  const sourceHealth = rowsByProvider(bundle.sourceHealth).get("garmin");

  assert.equal(bundle.activityDays[0]?.lowestHeartRate.selection.value, 44);
  assert.equal(sourceHealth?.activityDays, 1);
  assert.equal(sourceHealth?.sleepNights, 0);
  assert.equal(sourceHealth?.lastSleepDate, null);
  assert.equal(sourceHealth?.sleepStalenessVsNewestDays, null);
});
