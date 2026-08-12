import assert from "node:assert/strict";

import { test } from "vitest";

import { buildWearableSummaryBundleFromDataset, summarizeWearableMetricTrendFromBundle } from "../src/wearables.ts";
import {
  buildActivitySessionAggregates,
  buildActivitySessionDayRollups,
} from "../src/wearables/candidates.ts";
import type {
  WearableActivityMetricCandidateEvidence,
  WearableDataset,
  WearableMetricCandidate,
  WearableResolvedMetric,
  WearableSleepWindowCandidate,
} from "../src/wearables/types.ts";
import { composePublicWearableSummaryBundleFromStoredRows } from "../src/projection/wearable-summary-compose.ts";
import { buildWearableSummaryProjectionFromDataset } from "../src/projection/wearable-summary-projector.ts";
import { stringifyPublicWearableProjectionSummary } from "../src/projection/wearable-summary-public-json.ts";
import { parseJsonValue } from "../src/projection/schema.ts";
import {
  parseStoredWearableActivityRow,
  parseStoredWearableSummary,
  STORED_ACTIVITY_EVIDENCE_KEY,
  stringifyStoredWearableProjectionSummary,
  type StoredWearableMetricSummaryKind,
} from "../src/projection/wearable-summary-stored-codec.ts";

function candidate(input: {
  dataOrigin?: WearableMetricCandidate["dataOrigin"];
  date: string;
  occurredAt?: string | null;
  provider: string;
  metric: string;
  recordedAt?: string | null;
  resourceId?: string | null;
  resourceType?: string | null;
  sourceFamily?: WearableMetricCandidate["sourceFamily"];
  sourceKind?: string;
  system?: string;
  title?: string | null;
  value: number;
  unit?: string | null;
  facet: string;
  suffix?: string;
}): WearableMetricCandidate {
  return {
    candidateId: `${input.provider}:${input.facet}:${input.date}${input.suffix ?? ""}`,
    dataOrigin: input.dataOrigin,
    date: input.date,
    externalRef: {
      facet: input.facet,
      resourceId: input.resourceId === undefined
        ? `${input.facet}-${input.date}${input.suffix ?? ""}`
        : input.resourceId,
      resourceType: input.resourceType === undefined ? "daily_summary" : input.resourceType,
      system: input.system ?? input.provider,
      version: null,
    },
    metric: input.metric,
    occurredAt: input.occurredAt === undefined
      ? `${input.date}T07:00:00.000Z`
      : input.occurredAt,
    paths: [`ledger/events/2026/${input.date.slice(0, 7)}.jsonl`],
    provider: input.provider,
    recordedAt: input.recordedAt === undefined
      ? `${input.date}T08:11:23.000Z`
      : input.recordedAt,
    recordIds: [`evt_${input.provider}_${input.facet}_${input.date}${input.suffix ?? ""}`],
    sourceFamily: input.sourceFamily ?? "event",
    sourceKind: input.sourceKind ?? `observation:${input.facet}`,
    title: input.title === undefined ? `${input.provider} ${input.facet}` : input.title,
    unit: input.unit ?? null,
    value: input.value,
  };
}

function sleepWindow(
  provider: string,
  date: string,
  overrides: Partial<WearableSleepWindowCandidate> = {},
): WearableSleepWindowCandidate {
  return {
    candidateId: overrides.candidateId ?? `${provider}:sleep-window:${date}`,
    date,
    durationMinutes: overrides.durationMinutes ?? 432,
    endAt: overrides.endAt ?? `${date}T06:42:00.000Z`,
    dataOrigin: overrides.dataOrigin ?? null,
    externalRef: {
      facet: "sleep-window",
      resourceId: `sleep-${date}`,
      resourceType: "sleep",
      system: provider,
      version: null,
      ...overrides.externalRef,
    },
    nap: overrides.nap ?? false,
    occurredAt: overrides.occurredAt ?? `${date}T06:42:00.000Z`,
    paths: overrides.paths ?? [`ledger/events/2026/${date.slice(0, 7)}.jsonl`],
    provider,
    recordedAt: overrides.recordedAt ?? `${date}T07:01:00.000Z`,
    recordIds: overrides.recordIds ?? [`evt_${provider}_sleep_${date}`],
    sourceFamily: overrides.sourceFamily ?? "event",
    sourceKind: overrides.sourceKind ?? "sleep-window",
    startAt: overrides.startAt ?? `${date}T23:08:00.000Z`,
    title: overrides.title ?? `${provider} sleep`,
  };
}

function activitySession(input: {
  activityType: string;
  date: string;
  durationMinutes: number;
  endAt: string;
  id: string;
  provider: string;
  recordedAt: string;
  startAt: string;
  workoutMetricValues?: NonNullable<WearableMetricCandidate["workoutMetricValues"]>;
}): WearableMetricCandidate {
  const workoutMetricValues = input.workoutMetricValues ?? {};
  return {
    activityType: input.activityType,
    candidateId: input.id,
    dataOrigin: null,
    date: input.date,
    externalRef: {
      facet: null,
      resourceId: `${input.id}:private-resource`,
      resourceType: "activity_session",
      system: input.provider,
      version: null,
    },
    heartRateZones: [],
    metric: "sessionMinutes",
    occurredAt: input.startAt,
    paths: [`ledger/events/${input.id}.jsonl`],
    provider: input.provider,
    recordedAt: input.recordedAt,
    recordIds: [input.id],
    sessionEndAt: input.endAt,
    sessionStartAt: input.startAt,
    sourceFamily: "event",
    sourceKind: "activity_session",
    title: `${input.provider} ${input.activityType}`,
    unit: "minutes",
    value: input.durationMinutes,
    workoutMetricKeys: Object.keys(workoutMetricValues),
    workoutMetricValues,
  };
}

function activityDataset(input: {
  metricCandidates?: readonly WearableMetricCandidate[];
  sessions: readonly WearableMetricCandidate[];
}): WearableDataset {
  const sessions = [...input.sessions];
  const metricCandidates = [...(input.metricCandidates ?? [])];
  return {
    activitySessionCandidates: sessions,
    activitySessionAggregates: buildActivitySessionAggregates(sessions),
    activitySessionDayRollups: buildActivitySessionDayRollups(sessions),
    metricSuppressionEvidence: [],
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows: [],
  };
}

function composeActivityRows(
  rows: ReturnType<typeof buildWearableSummaryProjectionFromDataset>,
  providers: readonly string[] = [],
) {
  return composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: providers.length > 0,
    providers: [...providers],
    rows: providers.length === 0
      ? rows
      : rows.filter((row) => providers.includes(JSON.parse(row.providerScopeJson)[0])),
  }, {});
}

function activityOnlyDataset(
  metricCandidates: readonly WearableMetricCandidate[],
): WearableDataset {
  return activityDataset({ metricCandidates, sessions: [] });
}

function composeStoredDataset(dataset: WearableDataset) {
  return composeActivityRows(buildWearableSummaryProjectionFromDataset(dataset));
}

function metricSnapshot(metric: WearableResolvedMetric) {
  const { paths: _paths, recordIds: _recordIds, ...selection } = metric.selection;
  return {
    confidence: metric.confidence,
    metric: metric.metric,
    selection,
  };
}

function stringifyFixtureStoredSummary(
  summaryKind: StoredWearableMetricSummaryKind,
  summary: object,
): string {
  if (summaryKind !== "activity") {
    return stringifyStoredWearableProjectionSummary(summaryKind, summary);
  }
  const date = (summary as { date?: unknown }).date;
  if (typeof date !== "string") {
    throw new TypeError("Expected an activity summary date.");
  }
  const evidence: WearableActivityMetricCandidateEvidence = {
    candidateKey: "activity-metric-candidate:0000000000",
    date,
    exactKey: "activity-metric-exact:0000000000",
    hasDayStrainFacet: false,
    metric: "steps",
    occurredAt: null,
    origin: {
      aggregatorProvider: null,
      sourceProviderSlug: null,
      sourceType: null,
    },
    provider: "fixture",
    publicProvider: "fixture",
    recordedAt: null,
    resourceClass: "generic",
    sourceFamily: "event",
    sourceKind: "observation:steps",
    unit: "count",
    value: 1,
  };
  return stringifyStoredWearableProjectionSummary(summaryKind, summary, {
    activityEvidence: {
      metricCandidates: [evidence],
      sessions: [],
    },
  });
}

function replaceStoredField(
  summaryJson: string,
  key: string,
  value: unknown,
): string {
  const summary = parseJsonValue<Record<string, unknown> | null>(summaryJson, null);
  assert.ok(summary);
  summary[key] = value;
  return JSON.stringify(summary);
}

function omitStoredField(summaryJson: string, key: string): string {
  const summary = parseJsonValue<Record<string, unknown> | null>(summaryJson, null);
  assert.ok(summary);
  delete summary[key];
  return JSON.stringify(summary);
}

function buildFixtureDataset(providers: readonly string[]): WearableDataset {
  const metricCandidates: WearableMetricCandidate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];

  for (const [providerIndex, provider] of providers.entries()) {
    for (const date of ["2026-05-01", "2026-05-02"]) {
      // Sparse activity day: most activity envelopes stay empty, steps has
      // a runner-up candidate plus an exact duplicate.
      metricCandidates.push(
        candidate({ date, facet: "steps", metric: "steps", provider, unit: "count", value: 8_000 + providerIndex * 900 }),
        candidate({ date, facet: "steps", metric: "steps", provider, suffix: ":dup", unit: "count", value: 8_000 + providerIndex * 900 }),
        candidate({ date, facet: "steps-watch", metric: "steps", provider, suffix: ":runner-up", unit: "count", value: 7_400 + providerIndex * 900 }),
        candidate({ date, facet: "active-calories", metric: "activeCalories", provider, unit: "kcal", value: 512.25 + providerIndex }),
      );

      // Mostly filled sleep night with a sleep window.
      sleepWindows.push(sleepWindow(provider, date));
      metricCandidates.push(
        candidate({ date, facet: "sleep-score", metric: "sleepScore", provider, unit: "score", value: 82 + providerIndex }),
        candidate({ date, facet: "sleep-hrv", metric: "hrv", provider, unit: "ms", value: 64.5 + providerIndex }),
        candidate({ date, facet: "asleep-minutes", metric: "totalSleepMinutes", provider, unit: "min", value: 421 + providerIndex }),
        candidate({ date, facet: "lowest-heart-rate", metric: "lowestHeartRate", provider, unit: "bpm", value: 47 + providerIndex }),
      );

      // Recovery day with no explicit resting heart rate, so the
      // restingHeartRate envelope resolves through the lowest sleep heart
      // rate fallback path.
      metricCandidates.push(
        candidate({ date, facet: "recovery-score", metric: "recoveryScore", provider, unit: "%", value: 61 + providerIndex }),
      );

      // Body state day.
      metricCandidates.push(
        candidate({ date, facet: "weight", metric: "weightKg", provider, unit: "kg", value: 81.4 + providerIndex }),
      );
    }
  }

  return {
    activitySessionCandidates: [],
    activitySessionAggregates: [],
    activitySessionDayRollups: [],
    metricSuppressionEvidence: [],
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows,
  };
}

function bundleSummariesByKind(
  dataset: WearableDataset,
): Array<[StoredWearableMetricSummaryKind, readonly object[]]> {
  const bundle = buildWearableSummaryBundleFromDataset(dataset);
  return [
    ["activity", bundle.activityDays],
    ["body_state", bundle.bodyStateDays],
    ["recovery", bundle.recoveryDays],
    ["sleep", bundle.sleepNights],
  ];
}

test("stored wearable summary codec round-trips summaries byte-exactly", () => {
  for (const providers of [["whoop"], ["whoop", "oura"]] as const) {
    const summaryGroups = bundleSummariesByKind(buildFixtureDataset(providers));

    for (const [summaryKind, summaries] of summaryGroups) {
      assert.ok(summaries.length > 0, `expected ${summaryKind} fixture summaries`);

      for (const summary of summaries) {
        const legacyJson = stringifyPublicWearableProjectionSummary(summary);
        const storedJson = stringifyFixtureStoredSummary(summaryKind, summary);

        const parsedStored = parseStoredWearableSummary(summaryKind, storedJson);
        assert.equal(JSON.stringify(parsedStored), legacyJson);

        const parsedLegacy = parseStoredWearableSummary(summaryKind, legacyJson);
        assert.equal(JSON.stringify(parsedLegacy), legacyJson);

        assert.ok(
          storedJson.length < legacyJson.length,
          `expected stored ${summaryKind} summary to be smaller than the public form`,
        );
      }

      if (summaryKind === "activity") {
        const storedActivity = stringifyFixtureStoredSummary(summaryKind, summaries[0]!);
        // Populated envelopes compact to { confidence, selection } and
        // evidence-free envelopes collapse to null markers.
        assert.match(storedActivity, /"steps":\{"confidence":/u);
        assert.match(storedActivity, /"dayStrain":null/u);
        assert.doesNotMatch(storedActivity, /"candidates":/u);
      }
    }
  }
});

test("stored activity rows require nonempty source evidence", () => {
  const summary = buildWearableSummaryBundleFromDataset(
    buildFixtureDataset(["whoop"]),
  ).activityDays[0];
  assert.ok(summary);
  assert.throws(
    () => stringifyStoredWearableProjectionSummary("activity", summary),
    /require source evidence/u,
  );
  assert.throws(
    () => stringifyStoredWearableProjectionSummary("activity", summary, {
      activityEvidence: {
        metricCandidates: [],
        sessions: [],
      },
    }),
    /require source evidence/u,
  );
  assert.doesNotThrow(() => stringifyFixtureStoredSummary("activity", summary));
});

test("stored activity candidates preserve non-associative ranking and exact-duplicate source health", () => {
  const cases = [
    {
      candidates: [
        candidate({
          date: "2026-06-03",
          facet: "steps-generic",
          metric: "steps",
          provider: "garmin",
          recordedAt: "2026-06-03T10:00:00.000Z",
          resourceType: "measurement",
          sourceKind: "observation:steps",
          title: "private alpha\n\ttitle",
          unit: "count",
          value: 9_100,
        }),
        candidate({
          date: "2026-06-03",
          facet: "steps-summary",
          metric: "steps",
          provider: "oura",
          recordedAt: "2026-06-03T09:00:00.000Z",
          resourceType: "activity_summary",
          sourceKind: "observation:steps",
          title: "private beta title",
          unit: "count",
          value: 8_200,
        }),
      ],
      expectedProvider: "oura",
      expectedValue: 8_200,
      name: "global resource specificity",
    },
    {
      candidates: [
        ...[["garmin", 1_000, "10"], ["garmin", 5_000, "09"], ["apple-health-kit", 5_000, "08"], ["oura", 5_000, "07"]]
          .map(([provider, value, hour], index) =>
            candidate({
              date: "2026-06-04",
              facet: "steps",
              metric: "steps",
              provider: String(provider),
              recordedAt: `2026-06-04T${String(hour)}:00:00.000Z`,
              sourceKind: "observation:steps",
              suffix: `:${index}`,
              unit: "count",
              value: Number(value),
            })
          ),
      ],
      expectedProvider: "garmin",
      expectedValue: 5_000,
      name: "cross-provider agreement changes the provider-local winner",
    },
    {
      candidates: [
        candidate({
          date: "2026-06-05",
          facet: "steps",
          metric: "steps",
          provider: "oura",
          recordedAt: "2026-06-05T08:00:00.000Z",
          sourceKind: "observation:steps",
          title: "private direct title",
          unit: "count",
          value: 8_200,
        }),
        candidate({
          dataOrigin: {
            aggregatorProvider: "junction",
            sourceProviderSlug: "oura",
            sourceType: "ring",
            version: 1,
          },
          date: "2026-06-05",
          facet: "steps",
          metric: "steps",
          provider: "junction",
          recordedAt: "2026-06-05T09:00:00.000Z",
          resourceType: "junction-oura-activity",
          sourceKind: "observation:steps",
          suffix: ":junction",
          system: "junction",
          title: "private Junction title",
          unit: "count",
          value: 8_200,
        }),
        candidate({
          date: "2026-06-05",
          facet: "steps",
          metric: "steps",
          provider: "garmin",
          recordedAt: "2026-06-05T07:00:00.000Z",
          sourceKind: "observation:steps",
          unit: "count",
          value: 7_100,
        }),
      ],
      expectedProvider: "oura",
      expectedValue: 8_200,
      name: "Junction and direct-provider evidence",
    },
    {
      candidates: [
        candidate({
          date: "2026-06-06",
          facet: "steps",
          metric: "steps",
          provider: "garmin",
          resourceId: "shared-fixture-resource",
          sourceKind: "observation:steps",
          suffix: ":first",
          unit: "count",
          value: 8_200,
        }),
        candidate({
          date: "2026-06-06",
          facet: "steps",
          metric: "steps",
          provider: "garmin",
          resourceId: "shared-fixture-resource",
          sourceKind: "observation:steps",
          suffix: ":second",
          unit: "count",
          value: 8_200,
        }),
        candidate({
          date: "2026-06-06",
          facet: "steps",
          metric: "steps",
          provider: "oura",
          sourceKind: "observation:steps",
          unit: "count",
          value: 7_100,
        }),
      ],
      expectedProvider: "garmin",
      expectedValue: 8_200,
      name: "exact duplicate partition",
    },
  ] as const;

  for (const scenario of cases) {
    const dataset = activityOnlyDataset(scenario.candidates);
    const directBundle = buildWearableSummaryBundleFromDataset(dataset);
    const storedBundle = composeStoredDataset(dataset);
    const direct = directBundle.activityDays[0];
    const stored = storedBundle.activityDays[0];
    assert.ok(direct);
    assert.ok(stored);
    assert.equal(direct.steps.selection.value, scenario.expectedValue, scenario.name);
    assert.equal(direct.steps.selection.provider, scenario.expectedProvider, scenario.name);
    assert.equal(stored.steps.selection.title, direct.steps.selection.title, scenario.name);
    assert.deepEqual(metricSnapshot(stored.steps), metricSnapshot(direct.steps), scenario.name);

    if (scenario.name === "exact duplicate partition") {
      assert.equal(direct.steps.confidence.exactDuplicateCount, 1);
      for (const provider of ["garmin", "oura"]) {
        const directHealth = directBundle.sourceHealth.find((health) => health.provider === provider);
        const storedHealth = storedBundle.sourceHealth.find((health) => health.provider === provider);
        assert.ok(directHealth);
        assert.ok(storedHealth);
        assert.equal(storedHealth.candidateMetrics, directHealth.candidateMetrics);
        assert.equal(storedHealth.exactDuplicatesSuppressed, directHealth.exactDuplicatesSuppressed);
        assert.equal(storedHealth.conflictCount, directHealth.conflictCount);
      }
    }
  }
});

test("stored activity composition matches direct numeric and provenance results for provider subsets", () => {
  const date = "2026-06-10";
  const explicitMetrics = (
    provider: string,
    values: readonly [number, number, number, number, number],
  ) => [
    candidate({ date, facet: "active-calories", metric: "activeCalories", provider, unit: "kcal", value: values[0] }),
    candidate({ date, facet: "distance", metric: "distanceKm", provider, unit: "km", value: values[1] }),
    candidate({ date, facet: "elevation", metric: "totalElevationGainMeters", provider, unit: "m", value: values[2] }),
    candidate({ date, facet: "max-heart-rate", metric: "maxHeartRate", provider, unit: "bpm", value: values[3] }),
    candidate({ date, facet: "workout-strain", metric: "workoutStrain", provider, unit: "strain", value: values[4] }),
  ];
  const activitySummaryFidelityMetrics = (
    provider: string,
    values: readonly [number, number, number, number, number, number, number],
  ) => [
    candidate({
      date,
      facet: "activity-minutes",
      metric: "activityMinutes",
      provider,
      resourceType: "activity_summary",
      unit: "minutes",
      value: values[0],
    }),
    candidate({
      date,
      facet: "low-activity-minutes",
      metric: "lowActivityMinutes",
      provider,
      resourceType: "activity_summary",
      unit: "minutes",
      value: values[1],
    }),
    candidate({
      date,
      facet: "medium-activity-minutes",
      metric: "mediumActivityMinutes",
      provider,
      resourceType: "activity_summary",
      unit: "minutes",
      value: values[2],
    }),
    candidate({
      date,
      facet: "high-activity-minutes",
      metric: "highActivityMinutes",
      provider,
      resourceType: "activity_summary",
      unit: "minutes",
      value: values[3],
    }),
    candidate({
      date,
      facet: "average-heart-rate",
      metric: "averageHeartRate",
      provider,
      resourceType: "activity_summary",
      unit: "bpm",
      value: values[4],
    }),
    candidate({
      date,
      facet: "walking-average-heart-rate",
      metric: "walkingAverageHeartRate",
      provider,
      resourceType: "activity_summary",
      unit: "bpm",
      value: values[5],
    }),
    candidate({
      date,
      facet: "lowest-heart-rate",
      metric: "lowestHeartRate",
      provider,
      resourceType: "activity_summary",
      unit: "bpm",
      value: values[6],
    }),
  ];
  const metricCandidates = [
    ...explicitMetrics("garmin", [800, 10, 200, 178, 15]),
    ...activitySummaryFidelityMetrics("garmin", [78, 60, 13, 5, 76, 101, 44]),
    ...explicitMetrics("oura", [700, 12, 250, 180, 12]),
    ...activitySummaryFidelityMetrics("oura", [72, 54, 12, 6, 74, 98, 43]),
  ];
  const run = {
    activityType: "Running",
    date,
    durationMinutes: 73,
    endAt: `${date}T13:13:00.000Z`,
    startAt: `${date}T12:00:00.000Z`,
    workoutMetricValues: {
      activeCalories: 731,
      distanceKm: 11.46,
      maxHeartRate: 176,
      totalElevationGainMeters: 241,
      workoutStrain: 13,
    },
  } as const;
  const sessions = [
    activitySession({
      ...run,
      id: "garmin-synthetic-run-id",
      provider: "garmin",
      recordedAt: `${date}T13:14:00.000Z`,
    }),
    activitySession({
      activityType: "Functional strength training",
      date,
      durationMinutes: 10,
      endAt: `${date}T18:10:00.000Z`,
      id: "oura-synthetic-strength-id",
      provider: "oura",
      recordedAt: `${date}T18:11:00.000Z`,
      startAt: `${date}T18:00:00.000Z`,
      workoutMetricValues: {
        activeCalories: 80,
        maxHeartRate: 172,
        workoutStrain: 6,
      },
    }),
    activitySession({
      ...run,
      id: "apple-synthetic-run-mirror-id",
      provider: "apple-health-kit",
      recordedAt: `${date}T13:15:00.000Z`,
    }),
  ];
  const rows = buildWearableSummaryProjectionFromDataset(
    activityDataset({ metricCandidates, sessions }),
  );
  const providerSubsets: readonly (readonly string[])[] = [
    [],
    ["garmin"],
    ["oura"],
    ["apple-health-kit"],
    ["garmin", "oura"],
    ["garmin", "apple-health-kit"],
    ["oura", "apple-health-kit"],
  ] as const;

  for (const providers of providerSubsets) {
    const directDataset = activityDataset({
      metricCandidates: providers.length === 0
        ? metricCandidates
        : metricCandidates.filter((item) => providers.includes(item.provider)),
      sessions: providers.length === 0
        ? sessions
        : sessions.filter((item) => providers.includes(item.provider)),
    });
    const direct = buildWearableSummaryBundleFromDataset(directDataset)
      .activityDays.find((day) => day.date === date);
    const stored = composeActivityRows(rows, providers)
      .activityDays.find((day) => day.date === date);
    assert.ok(direct);
    assert.ok(stored);

    for (const metric of [
      "sessionMinutes",
      "sessionCount",
      "activityMinutes",
      "lowActivityMinutes",
      "mediumActivityMinutes",
      "highActivityMinutes",
      "activeCalories",
      "distanceKm",
      "totalElevationGainMeters",
      "averageHeartRate",
      "walkingAverageHeartRate",
      "lowestHeartRate",
      "maxHeartRate",
      "workoutStrain",
    ] as const) {
      assert.deepEqual(
        metricSnapshot(stored[metric]),
        metricSnapshot(direct[metric]),
        `${providers.join(",") || "all"}: ${metric}`,
      );
    }
    if (providers.length === 0) {
      assert.equal(stored.sessionMinutes.selection.value, 83);
      assert.equal(stored.sessionCount.selection.value, 2);
    }
    if (providers.length === 1 && providers[0] === "garmin") {
      assert.equal(stored.activityMinutes.selection.value, 78);
      assert.equal(stored.lowActivityMinutes.selection.value, 60);
      assert.equal(stored.mediumActivityMinutes.selection.value, 13);
      assert.equal(stored.highActivityMinutes.selection.value, 5);
      assert.equal(stored.averageHeartRate.selection.value, 76);
      assert.equal(stored.walkingAverageHeartRate.selection.value, 101);
      assert.equal(stored.lowestHeartRate.selection.value, 44);
    }
  }
});

test("stored activity evidence is strict, strips private internals, and fails closed when absent", () => {
  const date = "2026-06-11";
  const dataset = activityDataset({
    metricCandidates: [
      candidate({
        date,
        facet: "steps",
        metric: "steps",
        provider: "alpha",
        resourceId: "private-resource-marker",
        sourceKind: "observation:steps",
        suffix: ":private-candidate-marker",
        title: "private-title-marker",
        unit: "count",
        value: 8_200,
      }),
    ],
    sessions: [
      activitySession({
        activityType: "Running",
        date,
        durationMinutes: 30,
        endAt: `${date}T12:30:00.000Z`,
        id: "private-session-marker",
        provider: "alpha",
        recordedAt: `${date}T12:31:00.000Z`,
        startAt: `${date}T12:00:00.000Z`,
      }),
    ],
  });
  const activityRow = buildWearableSummaryProjectionFromDataset(dataset).find((row) =>
    row.summaryKind === "activity"
  );
  assert.ok(activityRow);

  const parsedRow = parseStoredWearableActivityRow<Record<string, unknown>>(
    activityRow.summaryJson,
  );
  const metricEvidence = parsedRow?.metricCandidates;
  const sessionEvidence = parsedRow?.sessions;
  assert.equal(metricEvidence?.length, 1);
  assert.equal(Object.hasOwn(metricEvidence?.[0] ?? {}, "title"), false);
  assert.match(metricEvidence?.[0]?.candidateKey ?? "", /^activity-metric-candidate:\d{10}$/u);
  assert.match(metricEvidence?.[0]?.exactKey ?? "", /^activity-metric-exact:\d{10}$/u);
  assert.equal(sessionEvidence?.length, 1);
  assert.match(sessionEvidence?.[0]?.reconciliationExactKey ?? "", /^activity-session-exact:\d{10}$/u);
  assert.doesNotMatch(activityRow.summaryJson, /private-(?:candidate|resource|session)-marker/u);

  const publicJson = stringifyPublicWearableProjectionSummary(
    JSON.parse(activityRow.summaryJson),
  );
  assert.doesNotMatch(
    publicJson,
    /activityEvidence|private-title-marker/u,
  );

  const corruptions = [
    replaceStoredField(
      activityRow.summaryJson,
      STORED_ACTIVITY_EVIDENCE_KEY,
      {},
    ),
    omitStoredField(
      activityRow.summaryJson,
      STORED_ACTIVITY_EVIDENCE_KEY,
    ),
    replaceStoredField(
      activityRow.summaryJson,
      STORED_ACTIVITY_EVIDENCE_KEY,
      { metricCandidates: {}, sessions: sessionEvidence },
    ),
    replaceStoredField(
      activityRow.summaryJson,
      STORED_ACTIVITY_EVIDENCE_KEY,
      { metricCandidates: metricEvidence, sessions: {} },
    ),
  ];
  for (const summaryJson of corruptions) {
    assert.throws(
      () => composeActivityRows([{ ...activityRow, summaryJson }], ["alpha"]),
      /malformed; rebuild the query projection/u,
    );
  }

  const stored = parseJsonValue<Record<string, unknown> | null>(
    activityRow.summaryJson,
    null,
  );
  assert.ok(stored);
  const evidence = stored[STORED_ACTIVITY_EVIDENCE_KEY];
  assert.ok(evidence && typeof evidence === "object" && !Array.isArray(evidence));
  const metricCandidates = (evidence as Record<string, unknown>).metricCandidates;
  assert.ok(Array.isArray(metricCandidates));
  const firstEvidence = metricCandidates[0];
  assert.ok(firstEvidence && typeof firstEvidence === "object" && !Array.isArray(firstEvidence));
  assert.equal(Object.hasOwn(firstEvidence, "title"), false);
  (firstEvidence as Record<string, unknown>).title = "private-title-marker";
  assert.equal(
    parseStoredWearableActivityRow(JSON.stringify(stored)),
    null,
  );
});

test("compose preserves stored same-public provider conflict evidence", () => {
  const date = "2026-05-03";
  const dataset: WearableDataset = {
    activitySessionCandidates: [],
    activitySessionAggregates: [],
    activitySessionDayRollups: [],
    metricSuppressionEvidence: [],
    metricCandidates: [
      candidate({
        date,
        facet: "steps",
        metric: "steps",
        provider: "garmin",
        unit: "count",
        value: 8_000,
      }),
      candidate({
        dataOrigin: {
          aggregatorProvider: "junction",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          version: 1,
        },
        date,
        facet: "steps",
        metric: "steps",
        provider: "junction",
        resourceType: "junction-garmin-activity",
        suffix: ":junction",
        system: "junction",
        unit: "count",
        value: 9_000,
      }),
    ],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  };
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const composed = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows,
  }, {});
  const steps = composed.activityDays.find((summary) => summary.date === date)?.steps;

  assert.ok(steps);
  assert.deepEqual(steps.confidence.conflictingProviders, ["garmin"]);
  assert.equal(steps.confidence.level, "medium");
  assert.equal(
    steps.confidence.reasons.some((reason) =>
      reason === "Duplicate evidence from Garmin disagreed after source reconciliation."
    ),
    true,
  );
  assert.deepEqual(steps.candidates, []);
  assert.equal(
    composed.activityDays[0]?.summaryConfidence.conflictingMetrics.includes("steps"),
    true,
  );
  assert.equal(composed.sourceHealth.find((summary) => summary.provider === "garmin")?.conflictCount, 1);

  const garminRows = rows.filter((row) => row.providerScopeKey === "providers:garmin");
  const garminOnly = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: true,
    providers: ["garmin"],
    rows: garminRows,
  }, {});
  const garminOnlySteps = garminOnly.activityDays.find((summary) => summary.date === date)?.steps;

  assert.ok(garminOnlySteps);
  assert.deepEqual(garminOnlySteps.confidence.conflictingProviders, ["garmin"]);
  assert.equal(
    garminOnlySteps.confidence.reasons.some((reason) => reason.includes("Junction")),
    false,
  );
});

test("compose rebuilt stored sleep rows drops zeroed Apple HealthKit summary in favor of WHOOP", () => {
  const date = "2026-07-07";
  const startAt = "2026-07-07T08:17:04.000Z";
  const endAt = "2026-07-07T14:02:56.000Z";
  const dataset: WearableDataset = {
    activitySessionCandidates: [],
    activitySessionAggregates: [],
    activitySessionDayRollups: [],
    metricSuppressionEvidence: [],
    metricCandidates: [
      candidate({ date, facet: "whoop-asleep", metric: "totalSleepMinutes", provider: "whoop", unit: "minutes", value: 327.3667 }),
      candidate({ date, facet: "whoop-efficiency", metric: "sleepEfficiency", provider: "whoop", unit: "%", value: 94.6511 }),
      candidate({ date, facet: "whoop-deep", metric: "deepMinutes", provider: "whoop", unit: "minutes", value: 141.6167 }),
      candidate({ date, facet: "whoop-rem", metric: "remMinutes", provider: "whoop", unit: "minutes", value: 91 }),
      candidate({ date, facet: "whoop-light", metric: "lightMinutes", provider: "whoop", unit: "minutes", value: 94.75 }),
      candidate({ date, facet: "whoop-awake", metric: "awakeMinutes", provider: "whoop", unit: "minutes", value: 18.5 }),
      candidate({ date, facet: "apple-asleep-zero", metric: "totalSleepMinutes", provider: "apple-health-kit", unit: "minutes", value: 0 }),
      candidate({ date, facet: "apple-efficiency-zero", metric: "sleepEfficiency", provider: "apple-health-kit", unit: "%", value: 0 }),
      candidate({ date, facet: "apple-deep-zero", metric: "deepMinutes", provider: "apple-health-kit", unit: "minutes", value: 0 }),
      candidate({ date, facet: "apple-rem-zero", metric: "remMinutes", provider: "apple-health-kit", unit: "minutes", value: 0 }),
      candidate({ date, facet: "apple-light-zero", metric: "lightMinutes", provider: "apple-health-kit", unit: "minutes", value: 0 }),
      candidate({ date, facet: "apple-awake", metric: "awakeMinutes", provider: "apple-health-kit", unit: "minutes", value: 18.5 }),
    ],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [
      sleepWindow("whoop", date, {
        durationMinutes: 346,
        endAt,
        startAt,
      }),
      sleepWindow("apple-health-kit", date, {
        durationMinutes: 346,
        endAt,
        startAt,
      }),
    ],
  };
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const composed = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows,
  }, {});
  const sleep = composed.sleepNights.find((summary) => summary.date === date);
  const trend = summarizeWearableMetricTrendFromBundle(composed, "totalSleepMinutes", { windowDays: 1 });

  assert.ok(sleep);
  assert.equal(sleep.sleepWindowProvider, "whoop");
  assert.equal(sleep.totalSleepMinutes.selection.provider, "whoop");
  assert.equal(sleep.totalSleepMinutes.selection.value, 327.3667);
  assert.equal(sleep.sleepEfficiency.selection.provider, "whoop");
  assert.equal(sleep.deepMinutes.selection.provider, "whoop");
  assert.equal(sleep.remMinutes.selection.provider, "whoop");
  assert.equal(sleep.lightMinutes.selection.provider, "whoop");
  assert.equal(trend?.provider, "whoop");
  assert.equal(trend?.points[0]?.value, 327.3667);
});

test("compose preserves stored same-public sleep-window conflict evidence", () => {
  const date = "2026-05-04";
  const dataset: WearableDataset = {
    activitySessionCandidates: [],
    activitySessionAggregates: [],
    activitySessionDayRollups: [],
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [
      sleepWindow("garmin", date, {
        candidateId: "garmin:sleep-window:direct",
        durationMinutes: 480,
        title: "Garmin direct sleep",
      }),
      sleepWindow("junction", date, {
        candidateId: "junction:garmin:sleep-window",
        dataOrigin: {
          aggregatorProvider: "junction",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          version: 1,
        },
        durationMinutes: 420,
        externalRef: {
          facet: "sleep-window",
          resourceId: "junction-garmin-sleep-window",
          resourceType: "junction-garmin-sleep",
          system: "junction",
          version: null,
        },
        title: "Junction Garmin sleep",
      }),
    ],
  };
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const composed = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows,
  }, {});
  const sleep = composed.sleepNights.find((summary) => summary.date === date);

  assert.ok(sleep);
  assert.deepEqual(sleep.sessionMinutes.confidence.conflictingProviders, ["garmin"]);
  assert.deepEqual(sleep.timeInBedMinutes.confidence.conflictingProviders, ["garmin"]);
  assert.equal(sleep.sessionMinutes.confidence.level, "medium");
  assert.equal(
    sleep.sessionMinutes.confidence.reasons.some((reason) =>
      reason === "Duplicate evidence from Garmin disagreed after source reconciliation."
    ),
    true,
  );
  assert.equal(sleep.summaryConfidence.conflictingMetrics.includes("sessionMinutes"), true);
  assert.equal(sleep.summaryConfidence.conflictingMetrics.includes("timeInBedMinutes"), true);
  assert.equal(
    sleep.notes.some((note) =>
      note === "Duplicate sleep-window evidence from Garmin disagreed after source reconciliation."
    ),
    true,
  );
  assert.equal(composed.sourceHealth.find((summary) => summary.provider === "garmin")?.conflictCount, 2);
});

test("stored wearable summary codec round-trips conflict, duplicate, and fallback envelopes", () => {
  const conflicted = buildFixtureDataset(["whoop", "oura"]);
  const bundle = buildWearableSummaryBundleFromDataset(conflicted);

  const steps = bundle.activityDays[0]?.steps;
  assert.ok(steps);
  assert.ok(steps.confidence.conflictingProviders.length > 0, "expected a conflicting-provider envelope");

  const restingHeartRate = bundle.recoveryDays[0]?.restingHeartRate;
  assert.ok(restingHeartRate);
  assert.equal(restingHeartRate.selection.resolution, "fallback");

  for (const [summaryKind, summaries] of bundleSummariesByKind(conflicted)) {
    for (const summary of summaries) {
      const storedJson = stringifyFixtureStoredSummary(summaryKind, summary);
      assert.equal(
        JSON.stringify(parseStoredWearableSummary(summaryKind, storedJson)),
        stringifyPublicWearableProjectionSummary(summary),
      );
    }
  }
});

test("stored wearable summary codec fails open to the full envelope when bytes would change", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const doctored = JSON.parse(stringifyPublicWearableProjectionSummary(bundle.activityDays[0]));
  doctored.steps.selection.futureField = "not yet known to the codec";

  const storedJson = stringifyFixtureStoredSummary("activity", doctored);
  assert.ok(storedJson.includes('"futureField"'), "expected the unknown field to survive storage");
  assert.ok(storedJson.includes('"metric":"steps"'), "expected the unknown-shaped envelope to stay in full form");
  assert.equal(
    JSON.stringify(parseStoredWearableSummary("activity", storedJson)),
    stringifyPublicWearableProjectionSummary(doctored),
  );
});

test("parseStoredWearableSummary returns null for corrupt or non-object rows", () => {
  assert.equal(parseStoredWearableSummary("activity", '{"steps":'), null);
  assert.equal(parseStoredWearableSummary("sleep", "null"), null);
  assert.equal(parseStoredWearableSummary("recovery", "42"), null);
  assert.equal(parseStoredWearableSummary("body_state", '"not an object"'), null);
});

test("stored wearable summary codec stores unrecognized envelope shapes verbatim", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const doctored = JSON.parse(stringifyPublicWearableProjectionSummary(bundle.activityDays[0]));
  doctored.steps = 1234;
  doctored.activeCalories.confidence = "corrupt";

  const storedJson = stringifyFixtureStoredSummary("activity", doctored);
  assert.ok(storedJson.includes('"steps":1234'), "expected the non-object envelope to be stored verbatim");
  assert.ok(
    storedJson.includes('"metric":"activeCalories"'),
    "expected the non-object-confidence envelope to stay in full form",
  );
  assert.equal(
    JSON.stringify(parseStoredWearableSummary("activity", storedJson)),
    stringifyPublicWearableProjectionSummary(doctored),
  );
});

test("stored wearable summary codec fails open when a no-evidence envelope carries extra detail", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const doctored = JSON.parse(stringifyPublicWearableProjectionSummary(bundle.activityDays[0]));
  assert.equal(doctored.dayStrain.selection.resolution, "none");
  doctored.dayStrain.confidence.reasons = [...doctored.dayStrain.confidence.reasons, "non-canonical detail"];

  const storedJson = stringifyFixtureStoredSummary("activity", doctored);
  // The null marker would lose the extra reason, so the round-trip
  // verification must keep this envelope in full form.
  assert.doesNotMatch(storedJson, /"dayStrain":null/u);
  assert.ok(storedJson.includes('"metric":"dayStrain"'), "expected the envelope to stay in full form");
  assert.ok(storedJson.includes('"non-canonical detail"'), "expected the extra reason to survive storage");
  assert.equal(
    JSON.stringify(parseStoredWearableSummary("activity", storedJson)),
    stringifyPublicWearableProjectionSummary(doctored),
  );
});

test("stored wearable summary codec decode discriminates and survives tampered envelope objects", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const storedJson = stringifyFixtureStoredSummary("activity", bundle.activityDays[0]!);

  const reparseSteps = (steps: unknown): unknown => {
    const tampered = JSON.parse(storedJson);
    tampered.steps = steps;
    const parsed = parseStoredWearableSummary<Record<string, unknown>>("activity", JSON.stringify(tampered));
    assert.ok(parsed);
    return parsed.steps;
  };

  // Any key beyond { confidence, selection } means "not the compact form":
  // the object must pass through untouched instead of being rebuilt.
  assert.deepEqual(
    reparseSteps({ confidence: {}, selection: {}, extra: 1 }),
    { confidence: {}, selection: {}, extra: 1 },
  );

  // Shapes the writer cannot produce fail closed: they pass through
  // untouched instead of being synthesized into high-confidence direct
  // selections. The writer always emits both keys as plain objects, so a
  // missing or non-object part means corruption or tampering.
  assert.deepEqual(reparseSteps({}), {});
  assert.deepEqual(
    reparseSteps({ confidence: 5, selection: "corrupt" }),
    { confidence: 5, selection: "corrupt" },
  );
  assert.deepEqual(reparseSteps({ selection: { value: 7 } }), { selection: { value: 7 } });

  // A genuine writer-shaped compact envelope (both keys, both plain
  // objects) still rebuilds with the documented defaults.
  assert.deepEqual(reparseSteps({ confidence: {}, selection: { value: 7 } }), {
    candidates: [],
    confidence: {
      candidateCount: 1,
      conflictingProviders: [],
      exactDuplicateCount: 0,
      level: "high",
      reasons: [],
    },
    metric: "steps",
    selection: {
      occurredAt: null,
      paths: [],
      provider: null,
      recordedAt: null,
      recordIds: [],
      resolution: "direct",
      sourceFamily: null,
      sourceKind: null,
      title: null,
      fallbackFromMetric: null,
      fallbackReason: null,
      unit: null,
      value: 7,
    },
  });

  // Arrays in the summary cell are corrupt rows, not summaries.
  assert.equal(parseStoredWearableSummary("activity", "[]"), null);
});

test("null-marker envelopes decode to fresh objects on every parse", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const summary = bundle.activityDays[0]!;
  const legacyJson = stringifyPublicWearableProjectionSummary(summary);
  const storedJson = stringifyFixtureStoredSummary("activity", summary);
  assert.match(storedJson, /"dayStrain":null/u);

  const first = parseStoredWearableSummary<{ dayStrain: { selection: { resolution: string } } }>(
    "activity",
    storedJson,
  );
  assert.ok(first);
  assert.equal(first.dayStrain.selection.resolution, "none");
  first.dayStrain.selection.resolution = "mutated by a careless caller";

  // The codec memoizes empty envelopes by their JSON; a later parse must not
  // see another caller's mutation.
  assert.equal(JSON.stringify(parseStoredWearableSummary("activity", storedJson)), legacyJson);
});
