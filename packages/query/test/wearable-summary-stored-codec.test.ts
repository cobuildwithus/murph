import assert from "node:assert/strict";

import { test } from "vitest";

import { buildWearableSummaryBundleFromDataset, summarizeWearableMetricTrendFromBundle } from "../src/wearables.ts";
import {
  buildActivitySessionAggregates,
  buildActivitySessionDayRollups,
} from "../src/wearables/candidates.ts";
import type {
  WearableActivityDay,
  WearableActivitySessionAggregate,
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
  parseStoredWearableActivityMetricEvidence,
  parseStoredWearableActivitySessionEvidence,
  parseStoredWearableSummary,
  STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY,
  STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY,
  STORED_ACTIVITY_METRIC_EVIDENCE_KEY,
  STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
  STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY,
  STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
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

function activityAggregate(input: {
  activityTypes?: string[];
  date: string;
  durationMinutes: number;
  heartRateZones?: WearableActivitySessionAggregate["heartRateZones"];
  provider: string;
  sessionCount?: number;
  workoutMetricValues?: NonNullable<WearableActivitySessionAggregate["workoutMetricValues"]>;
}): WearableActivitySessionAggregate {
  const workoutMetricValues = input.workoutMetricValues ?? {};
  return {
    activityTypes: input.activityTypes ?? [],
    candidateId: `${input.provider}:activity-session-aggregate:${input.date}`,
    dataOrigin: null,
    date: input.date,
    heartRateZones: input.heartRateZones ?? [],
    paths: [`ledger/events/2026/${input.date.slice(0, 7)}.jsonl`],
    provider: input.provider,
    recordedAt: `${input.date}T08:11:23.000Z`,
    recordIds: [`evt_${input.provider}_activity_${input.date}`],
    sessionCount: input.sessionCount ?? 1,
    sessionMinutes: input.durationMinutes,
    workoutMetricKeys: Object.keys(workoutMetricValues),
    workoutMetricValues,
  };
}

function activitySessionCandidate(input: {
  activityType: string;
  dataOrigin?: WearableMetricCandidate["dataOrigin"];
  date: string;
  durationMinutes: number;
  endedAt?: string | null;
  externalRef?: WearableMetricCandidate["externalRef"];
  heartRateZones?: NonNullable<WearableMetricCandidate["heartRateZones"]>;
  id: string;
  provider: string;
  resourceId?: string;
  recordedAt: string;
  startedAt?: string | null;
  workoutMetricValues: NonNullable<WearableMetricCandidate["workoutMetricValues"]>;
}): WearableMetricCandidate {
  return {
    activityType: input.activityType,
    candidateId: input.id,
    dataOrigin: input.dataOrigin ?? null,
    date: input.date,
    externalRef: input.externalRef === undefined
      ? {
          facet: null,
          resourceId: input.resourceId ?? input.id,
          resourceType: "activity_session",
          system: input.provider,
          version: null,
        }
      : input.externalRef,
    heartRateZones: input.heartRateZones ?? [],
    metric: "sessionMinutes",
    occurredAt: input.startedAt ?? null,
    paths: [`ledger/events/2026/${input.date.slice(0, 7)}.jsonl`],
    provider: input.provider,
    recordedAt: input.recordedAt,
    recordIds: [input.id],
    sessionEndAt: input.endedAt ?? null,
    sessionStartAt: input.startedAt ?? null,
    sourceFamily: "event",
    sourceKind: "activity_session",
    title: `${input.provider} ${input.activityType}`,
    unit: "minutes",
    value: input.durationMinutes,
    workoutMetricKeys: Object.keys(input.workoutMetricValues),
    workoutMetricValues: input.workoutMetricValues,
  };
}

function buildDirectAndStoredActivity(
  date: string,
  activitySessionCandidates: WearableMetricCandidate[],
) {
  const dataset: WearableDataset = {
    activitySessionCandidates,
    activitySessionAggregates: buildActivitySessionAggregates(activitySessionCandidates),
    activitySessionDayRollups: buildActivitySessionDayRollups(activitySessionCandidates),
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  };
  const directBundle = buildWearableSummaryBundleFromDataset(dataset);
  const direct = directBundle.activityDays.find(
    (summary) => summary.date === date,
  );
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const storedBundle = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows,
  }, {});
  const stored = storedBundle.activityDays.find((summary) => summary.date === date);

  assert.ok(direct);
  assert.ok(stored);
  return { direct, directBundle, rows, stored, storedBundle };
}

function replaceStoredSummaryField(
  summaryJson: string,
  key: string,
  value: unknown,
): string {
  const summary = parseJsonValue<Record<string, unknown> | null>(summaryJson, null);
  assert.ok(summary);
  summary[key] = value;
  return JSON.stringify(summary);
}

function omitStoredSummaryField(
  summaryJson: string,
  key: string,
): string {
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
    activitySessionAggregates: [],
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

function activityOnlyDataset(
  metricCandidates: readonly WearableMetricCandidate[],
): WearableDataset {
  return {
    activitySessionAggregates: [],
    metricSuppressionEvidence: [],
    metricCandidates: [...metricCandidates],
    provenanceDiagnostics: [],
    rawMetricCandidates: [...metricCandidates],
    sleepWindows: [],
  };
}

function composeStoredDataset(dataset: WearableDataset) {
  return composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows: buildWearableSummaryProjectionFromDataset(dataset),
  }, {});
}

function safeResolvedMetricSnapshot(resolved: WearableResolvedMetric): object {
  const {
    paths: _paths,
    recordIds: _recordIds,
    ...selection
  } = resolved.selection;
  return {
    confidence: resolved.confidence,
    metric: resolved.metric,
    selection,
  };
}

type ActivityParityMetric =
  | "activityScore"
  | "dayStrain"
  | "floorsClimbed"
  | "maxHeartRate"
  | "percentRecorded"
  | "steps"
  | "totalCalories";

type ActivityParityDay = Pick<WearableActivityDay, ActivityParityMetric>;

function activityParityMetric(
  day: ActivityParityDay,
  metric: ActivityParityMetric,
): WearableResolvedMetric {
  return day[metric];
}

function requireJsonObject(value: unknown): Record<string, unknown> {
  if (!isJsonRecord(value)) {
    throw new Error("Expected a JSON object in the test fixture.");
  }
  return value;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("stored wearable summary codec round-trips summaries byte-exactly", () => {
  for (const providers of [["whoop"], ["whoop", "oura"]] as const) {
    const summaryGroups = bundleSummariesByKind(buildFixtureDataset(providers));

    for (const [summaryKind, summaries] of summaryGroups) {
      assert.ok(summaries.length > 0, `expected ${summaryKind} fixture summaries`);

      for (const summary of summaries) {
        const legacyJson = stringifyPublicWearableProjectionSummary(summary);
        const storedJson = stringifyStoredWearableProjectionSummary(summaryKind, summary);

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
        const storedActivity = stringifyStoredWearableProjectionSummary(summaryKind, summaries[0]!);
        // Populated envelopes compact to { confidence, selection } and
        // evidence-free envelopes collapse to null markers.
        assert.match(storedActivity, /"steps":\{"confidence":/u);
        assert.match(storedActivity, /"dayStrain":null/u);
        assert.doesNotMatch(storedActivity, /"candidates":/u);
      }
    }
  }
});

test("stored activity evidence preserves global resource-specificity ranking", () => {
  const date = "2026-06-03";
  const dataset = activityOnlyDataset([
    candidate({
      date,
      facet: "steps-generic",
      metric: "steps",
      provider: "garmin",
      recordedAt: `${date}T10:00:00.000Z`,
      resourceType: "measurement",
      sourceKind: "observation:steps",
      title: "private alpha title",
      unit: "count",
      value: 9_100,
    }),
    candidate({
      date,
      facet: "steps-summary",
      metric: "steps",
      provider: "oura",
      recordedAt: `${date}T09:00:00.000Z`,
      resourceType: "activity_summary",
      sourceKind: "observation:steps",
      title: "private beta title",
      unit: "count",
      value: 8_200,
    }),
  ]);

  const direct = buildWearableSummaryBundleFromDataset(dataset).activityDays[0];
  const stored = composeStoredDataset(dataset).activityDays[0];
  assert.ok(direct);
  assert.ok(stored);
  assert.equal(direct.steps.selection.provider, "oura");
  assert.equal(direct.steps.selection.title, "Oura Steps");
  assert.deepEqual(
    safeResolvedMetricSnapshot(stored.steps),
    safeResolvedMetricSnapshot(direct.steps),
  );
});

test("stored activity evidence preserves agreement that changes a provider-local winner", () => {
  const date = "2026-06-04";
  const dataset = activityOnlyDataset([
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      recordedAt: `${date}T10:00:00.000Z`,
      sourceKind: "observation:steps",
      unit: "count",
      value: 1_000,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      recordedAt: `${date}T09:00:00.000Z`,
      sourceKind: "observation:steps",
      suffix: ":agreeing",
      unit: "count",
      value: 5_000,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "apple-health-kit",
      recordedAt: `${date}T08:00:00.000Z`,
      sourceKind: "observation:steps",
      unit: "count",
      value: 5_000,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "oura",
      recordedAt: `${date}T07:00:00.000Z`,
      sourceKind: "observation:steps",
      unit: "count",
      value: 5_000,
    }),
  ]);

  const direct = buildWearableSummaryBundleFromDataset(dataset).activityDays[0];
  const stored = composeStoredDataset(dataset).activityDays[0];
  assert.ok(direct);
  assert.ok(stored);
  assert.equal(direct.steps.selection.value, 5_000);
  assert.deepEqual(
    safeResolvedMetricSnapshot(stored.steps),
    safeResolvedMetricSnapshot(direct.steps),
  );
});

test("stored activity evidence preserves Junction versus direct-provider ranking", () => {
  const date = "2026-06-05";
  const dataset = activityOnlyDataset([
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "oura",
      recordedAt: `${date}T08:00:00.000Z`,
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
      date,
      facet: "steps",
      metric: "steps",
      provider: "junction",
      recordedAt: `${date}T09:00:00.000Z`,
      resourceType: "junction-oura-activity",
      sourceKind: "observation:steps",
      suffix: ":junction",
      system: "junction",
      title: "private Junction title",
      unit: "count",
      value: 8_200,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      recordedAt: `${date}T07:00:00.000Z`,
      sourceKind: "observation:steps",
      unit: "count",
      value: 7_100,
    }),
  ]);

  const direct = buildWearableSummaryBundleFromDataset(dataset).activityDays[0];
  const stored = composeStoredDataset(dataset).activityDays[0];
  assert.ok(direct);
  assert.ok(stored);
  assert.equal(direct.steps.selection.provider, "oura");
  assert.equal(direct.steps.selection.title, "Oura Steps");
  assert.deepEqual(
    safeResolvedMetricSnapshot(stored.steps),
    safeResolvedMetricSnapshot(direct.steps),
  );
});

test("stored activity evidence preserves exact duplicate partitions", () => {
  const date = "2026-06-05";
  const sharedResourceId = "shared-safe-fixture-resource";
  const dataset = activityOnlyDataset([
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      resourceId: sharedResourceId,
      sourceKind: "observation:steps",
      suffix: ":first",
      unit: "count",
      value: 8_200,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      resourceId: sharedResourceId,
      sourceKind: "observation:steps",
      suffix: ":second",
      unit: "count",
      value: 8_200,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "oura",
      sourceKind: "observation:steps",
      unit: "count",
      value: 7_100,
    }),
  ]);

  const direct = buildWearableSummaryBundleFromDataset(dataset).activityDays[0];
  const stored = composeStoredDataset(dataset).activityDays[0];
  assert.ok(direct);
  assert.ok(stored);
  assert.equal(direct.steps.confidence.exactDuplicateCount, 1);
  assert.deepEqual(
    safeResolvedMetricSnapshot(stored.steps),
    safeResolvedMetricSnapshot(direct.steps),
  );
});

test("stored activity ranking evidence is private, strict, and hidden from public JSON", () => {
  const date = "2026-06-06";
  const dataset = activityOnlyDataset([
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "alpha",
      sourceKind: "observation:steps",
      title: "safe selected title",
      unit: "count",
      value: 8_200,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "alpha",
      resourceType: "private-resource-marker",
      sourceKind: "observation:steps",
      suffix: ":private-candidate-marker",
      title: "private-title-marker",
      unit: "count",
      value: 7_100,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "beta",
      sourceKind: "observation:steps",
      unit: "count",
      value: 8_100,
    }),
  ]);
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const storedPayload = rows.map((row) => row.summaryJson).join("\n");
  assert.doesNotMatch(
    storedPayload,
    /private-(?:candidate|resource|title)-marker/u,
  );

  const activityRow = rows.find((row) =>
    row.summaryKind === "activity"
    && row.providerScopeKey === "providers:alpha"
  );
  assert.ok(activityRow);
  const parsed = parseStoredWearableActivityMetricEvidence(activityRow.summaryJson);
  assert.equal(parsed.status, "valid");
  if (parsed.status !== "valid") {
    throw new Error("Expected valid activity metric evidence.");
  }
  assert.equal(parsed.evidence.length, 2);

  const publicPayload = stringifyPublicWearableProjectionSummary(
    JSON.parse(activityRow.summaryJson),
  );
  assert.doesNotMatch(
    publicPayload,
    /activityMetricRankingEvidence|activity-metric-(?:candidate|exact)/u,
  );

  const corruptions: Array<(evidence: Record<string, unknown>) => void> = [
    (evidence) => {
      evidence.resourceId = "forbidden-resource";
    },
    (evidence) => {
      evidence.candidateKey = "raw-candidate-id";
    },
    (evidence) => {
      evidence.exactKey = "raw-exact-id";
    },
    (evidence) => {
      evidence.date = "2026-02-30";
    },
    (evidence) => {
      evidence.occurredAt = date;
    },
    (evidence) => {
      evidence.recordedAt = "2026-02-30T08:00:00.000Z";
    },
    (evidence) => {
      evidence.provider = "Alpha";
    },
    (evidence) => {
      requireJsonObject(evidence.origin).sourceInstanceId = "forbidden-source-instance";
    },
  ];
  for (const corrupt of corruptions) {
    const stored = requireJsonObject(JSON.parse(activityRow.summaryJson));
    const evidence = stored[STORED_ACTIVITY_METRIC_EVIDENCE_KEY];
    assert.ok(Array.isArray(evidence));
    corrupt(requireJsonObject(evidence[0]));
    assert.deepEqual(
      parseStoredWearableActivityMetricEvidence(JSON.stringify(stored)),
      { status: "invalid" },
    );
  }

  const emptyStored = requireJsonObject(JSON.parse(activityRow.summaryJson));
  const emptySummary = parseStoredWearableSummary<Record<string, unknown>>(
    "activity",
    JSON.stringify(emptyStored),
  );
  assert.ok(emptySummary);
  assert.deepEqual(
    parseStoredWearableActivityMetricEvidence(
      stringifyStoredWearableProjectionSummary("activity", emptySummary, {
        activityMetricEvidence: [],
      }),
    ),
    { status: "valid", evidence: [] },
  );
});

test("compose rejects mixed current and legacy activity metric evidence for one date", () => {
  const date = "2026-06-07";
  const dataset = activityOnlyDataset([
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "alpha",
      sourceKind: "observation:steps",
      unit: "count",
      value: 8_200,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "beta",
      sourceKind: "observation:steps",
      unit: "count",
      value: 8_100,
    }),
  ]);
  let removedEvidence = false;
  const rows = buildWearableSummaryProjectionFromDataset(dataset).map((row) => {
    if (
      !removedEvidence
      && row.summaryKind === "activity"
      && row.summaryDate === date
    ) {
      removedEvidence = true;
      return {
        ...row,
        summaryJson: omitStoredSummaryField(
          omitStoredSummaryField(
            omitStoredSummaryField(
              row.summaryJson,
              STORED_ACTIVITY_METRIC_EVIDENCE_KEY,
            ),
            STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY,
          ),
          STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY,
        ),
      };
    }
    return row;
  });
  assert.equal(removedEvidence, true);

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: false,
      providers: [],
      rows,
    }, {}),
    /activity metric ranking evidence mixes current and legacy rows/u,
  );
});

test("compose rejects same-count nonselected metric evidence corruption", () => {
  const date = "2026-06-07";
  const rows = buildWearableSummaryProjectionFromDataset(activityOnlyDataset([
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      recordedAt: `${date}T09:00:00.000Z`,
      suffix: "-newer",
      unit: "count",
      value: 1_000,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      recordedAt: `${date}T08:00:00.000Z`,
      suffix: "-older",
      unit: "count",
      value: 5_000,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "apple_health",
      unit: "count",
      value: 5_000,
    }),
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "oura",
      unit: "count",
      value: 5_000,
    }),
  ]));
  const corruptedRows = rows.map((row) => {
    if (
      row.summaryKind !== "activity"
      || row.providerScopeKey !== "providers:garmin"
    ) {
      return row;
    }
    const stored = requireJsonObject(JSON.parse(row.summaryJson));
    const evidence = stored[STORED_ACTIVITY_METRIC_EVIDENCE_KEY];
    assert.ok(Array.isArray(evidence));
    const nonselected = evidence
      .map(requireJsonObject)
      .find((candidateEvidence) => candidateEvidence.value === 5_000);
    assert.ok(nonselected);
    nonselected.value = 6_000;
    return {
      ...row,
      summaryJson: JSON.stringify(stored),
    };
  });

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: false,
      providers: [],
      rows: corruptedRows,
    }, {}),
    /Stored activity metric ranking evidence is malformed/u,
  );
});

test("compose rejects truncated or semantically empty activity metric evidence", () => {
  const date = "2026-06-07";
  const rows = buildWearableSummaryProjectionFromDataset(activityOnlyDataset([
    candidate({
      date,
      facet: "steps",
      metric: "steps",
      provider: "garmin",
      sourceKind: "observation:steps",
      unit: "count",
      value: 8_200,
    }),
  ]));
  const rewriteMetricEvidence = (
    updateCount: boolean,
  ) => rows.map((row) => {
    if (row.summaryKind !== "activity") {
      return row;
    }
    const stored = requireJsonObject(JSON.parse(row.summaryJson));
    const evidence = stored[STORED_ACTIVITY_METRIC_EVIDENCE_KEY];
    assert.ok(Array.isArray(evidence));
    assert.equal(evidence.length, 1);
    stored[STORED_ACTIVITY_METRIC_EVIDENCE_KEY] = [];
    if (updateCount) {
      stored[STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY] = 0;
    }
    return {
      ...row,
      summaryJson: JSON.stringify(stored),
    };
  });

  for (const corruptedRows of [
    rewriteMetricEvidence(false),
    rewriteMetricEvidence(true),
  ]) {
    assert.throws(
      () => composePublicWearableSummaryBundleFromStoredRows({
        providerFilterWasProvided: true,
        providers: ["garmin"],
        rows: corruptedRows,
      }, {}),
      /Stored activity metric ranking evidence is malformed/u,
    );
  }
});

test("compose rejects incomplete cross-family current evidence pairs", () => {
  const date = "2026-06-07";
  const session = activitySessionCandidate({
    activityType: "Running",
    date,
    durationMinutes: 30,
    endedAt: `${date}T12:30:00.000Z`,
    id: "garmin-run",
    provider: "garmin",
    recordedAt: `${date}T12:31:00.000Z`,
    startedAt: `${date}T12:00:00.000Z`,
    workoutMetricValues: {},
  });
  const steps = candidate({
    date,
    facet: "steps",
    metric: "steps",
    provider: "garmin",
    sourceKind: "observation:steps",
    unit: "count",
    value: 8_200,
  });
  const currentRows = buildWearableSummaryProjectionFromDataset({
    activitySessionCandidates: [session],
    activitySessionAggregates: buildActivitySessionAggregates([session]),
    activitySessionDayRollups: buildActivitySessionDayRollups([session]),
    metricSuppressionEvidence: [],
    metricCandidates: [steps],
    provenanceDiagnostics: [],
    rawMetricCandidates: [steps],
    sleepWindows: [],
  });
  const rows = currentRows.map((row) => {
    if (row.summaryKind !== "activity") {
      return row;
    }
    return {
      ...row,
      summaryJson: omitStoredSummaryField(
        omitStoredSummaryField(
          omitStoredSummaryField(
            row.summaryJson,
            STORED_ACTIVITY_METRIC_EVIDENCE_KEY,
          ),
          STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY,
        ),
        STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY,
      ),
    };
  });
  const activityRow = rows.find((row) => row.summaryKind === "activity");
  assert.ok(activityRow);
  assert.equal(
    parseStoredWearableActivityMetricEvidence(activityRow.summaryJson).status,
    "absent",
  );
  assert.equal(
    parseStoredWearableActivitySessionEvidence(activityRow.summaryJson).status,
    "valid",
  );

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows,
    }, {}),
    /Stored activity metric ranking evidence is malformed/u,
  );

  const rowsWithoutSessionEvidence = currentRows.map((row) => {
    if (row.summaryKind !== "activity") {
      return row;
    }
    return {
      ...row,
      summaryJson: omitStoredSummaryField(
        omitStoredSummaryField(
          omitStoredSummaryField(
            row.summaryJson,
            STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
          ),
          STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
        ),
        STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY,
      ),
    };
  });
  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows: rowsWithoutSessionEvidence,
    }, {}),
    /Stored activity-session reconciliation evidence is malformed/u,
  );

  const rowsWithFalseZeroSessionEvidence = currentRows.map((row) => {
    if (row.summaryKind !== "activity") {
      return row;
    }
    return {
      ...row,
      summaryJson: replaceStoredSummaryField(
        omitStoredSummaryField(
          row.summaryJson,
          STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
        ),
        STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
        0,
      ),
    };
  });
  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows: rowsWithFalseZeroSessionEvidence,
    }, {}),
    /Stored activity-session reconciliation evidence is malformed/u,
  );
});

test("compose rejects truncated or same-length-corrupt session evidence", () => {
  const date = "2026-06-08";
  const sessions = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 30,
      endedAt: `${date}T12:30:00.000Z`,
      id: "garmin-run",
      provider: "garmin",
      recordedAt: `${date}T12:31:00.000Z`,
      startedAt: `${date}T12:00:00.000Z`,
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 20,
      endedAt: `${date}T18:20:00.000Z`,
      heartRateZones: [{ durationMinutes: 10, zone: 3 }],
      id: "garmin-strength",
      provider: "garmin",
      recordedAt: `${date}T18:21:00.000Z`,
      startedAt: `${date}T18:00:00.000Z`,
      workoutMetricValues: {},
    }),
  ];
  const rows = buildWearableSummaryProjectionFromDataset({
    activitySessionCandidates: sessions,
    activitySessionAggregates: buildActivitySessionAggregates(sessions),
    activitySessionDayRollups: buildActivitySessionDayRollups(sessions),
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  });
  const rewriteSessionEvidence = (
    mutate: (evidence: Record<string, unknown>[]) => void,
  ) => rows.map((row) => {
    if (row.summaryKind !== "activity") {
      return row;
    }
    const stored = requireJsonObject(JSON.parse(row.summaryJson));
    const rawEvidence = stored[STORED_ACTIVITY_SESSION_EVIDENCE_KEY];
    assert.ok(Array.isArray(rawEvidence));
    const evidence = rawEvidence.map(requireJsonObject);
    assert.equal(evidence.length, 2);
    mutate(evidence);
    stored[STORED_ACTIVITY_SESSION_EVIDENCE_KEY] = evidence;
    return {
      ...row,
      summaryJson: JSON.stringify(stored),
    };
  });

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows: rewriteSessionEvidence((evidence) => {
        evidence.pop();
      }),
    }, {}),
    /Stored activity-session reconciliation evidence is malformed/u,
  );
  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows: rewriteSessionEvidence((evidence) => {
        evidence[0]!.durationMinutes = 37;
      }),
    }, {}),
    /Stored activity-session reconciliation evidence is malformed/u,
  );
  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows: rewriteSessionEvidence((evidence) => {
        evidence[1]!.activityType = "Running";
        evidence[1]!.heartRateZones = [];
      }),
    }, {}),
    /Stored activity-session reconciliation evidence is malformed/u,
  );
});

test("current evidence fails closed for aggregate-only workout branches", () => {
  const date = "2026-06-08";
  const aggregates = [
    activityAggregate({
      activityTypes: ["running"],
      date,
      durationMinutes: 42,
      provider: "garmin",
      workoutMetricValues: {
        activeCalories: 410,
        distanceKm: 7.2,
        maxHeartRate: 171,
        totalElevationGainMeters: 85,
        workoutStrain: 12.4,
      },
    }),
    activityAggregate({
      activityTypes: ["walking"],
      date,
      durationMinutes: 24,
      provider: "oura",
      workoutMetricValues: {
        activeCalories: 180,
        distanceKm: 2.1,
        maxHeartRate: 132,
        totalElevationGainMeters: 14,
        workoutStrain: 6.8,
      },
    }),
  ];
  const dataset: WearableDataset = {
    activitySessionAggregates: aggregates,
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  };
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const activityRows = rows.filter((row) => row.summaryKind === "activity");
  assert.equal(activityRows.length, 2);
  for (const row of activityRows) {
    assert.deepEqual(
      parseStoredWearableActivityMetricEvidence(row.summaryJson),
      { status: "valid", evidence: [] },
    );
    assert.deepEqual(
      parseStoredWearableActivitySessionEvidence(row.summaryJson),
      { status: "valid", evidence: [] },
    );
  }

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: false,
      providers: [],
      rows,
    }, {}),
    /Stored activity-session reconciliation evidence is malformed/u,
  );
});

test("current metric-only rows verify every explicit activity metric envelope", () => {
  const date = "2026-06-09";
  const dataset = activityOnlyDataset([
    candidate({
      date,
      facet: "active-calories",
      metric: "activeCalories",
      provider: "garmin",
      unit: "kcal",
      value: 410,
    }),
    candidate({
      date,
      facet: "distance",
      metric: "distanceKm",
      provider: "garmin",
      unit: "km",
      value: 7.2,
    }),
    candidate({
      date,
      facet: "max-heart-rate",
      metric: "maxHeartRate",
      provider: "garmin",
      unit: "bpm",
      value: 171,
    }),
  ]);
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const activityRow = rows.find((row) => row.summaryKind === "activity");
  assert.ok(activityRow);
  assert.deepEqual(
    parseStoredWearableActivitySessionEvidence(activityRow.summaryJson),
    { status: "valid", evidence: [] },
  );

  const direct = buildWearableSummaryBundleFromDataset(dataset).activityDays[0];
  const composed = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: true,
    providers: ["garmin"],
    rows,
  }, {}).activityDays[0];
  assert.ok(direct);
  assert.ok(composed);
  for (const metric of [
    "activeCalories",
    "distanceKm",
    "maxHeartRate",
  ] as const) {
    assert.deepEqual(
      safeResolvedMetricSnapshot(composed[metric]),
      safeResolvedMetricSnapshot(direct[metric]),
      metric,
    );
  }

  const corruptedRows = rows.map((row) => {
    if (row.summaryKind !== "activity") {
      return row;
    }
    const stored = requireJsonObject(JSON.parse(row.summaryJson));
    const activeCalories = requireJsonObject(stored.activeCalories);
    const selection = requireJsonObject(activeCalories.selection);
    selection.value = 999;
    return {
      ...row,
      summaryJson: JSON.stringify(stored),
    };
  });
  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows: corruptedRows,
    }, {}),
    /Stored activity metric ranking evidence is malformed/u,
  );
});

test("stored activity ranking evidence matches direct global ranking under deterministic fuzz", () => {
  const metrics: readonly ActivityParityMetric[] = [
    "activityScore",
    "dayStrain",
    "floorsClimbed",
    "maxHeartRate",
    "percentRecorded",
    "steps",
    "totalCalories",
  ];
  const providers = ["apple-health-kit", "garmin", "oura"] as const;
  const resourceTypes = [null, "activity_summary", "cycle", "measurement"] as const;
  const sourceFamilies = ["canonical", "derived", "event", "sample"] as const;

  for (let seed = 1; seed <= 120; seed += 1) {
    let state = seed;
    const random = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const metric = metrics[Math.floor(random() * metrics.length)]!;
    const date = `2026-06-${String((seed % 28) + 1).padStart(2, "0")}`;
    const candidateCount = 3 + Math.floor(random() * 6);
    const metricCandidates: WearableMetricCandidate[] = [];

    for (let index = 0; index < candidateCount; index += 1) {
      const provider = providers[index % providers.length]!;
      const resourceType = resourceTypes[Math.floor(random() * resourceTypes.length)]!;
      const sourceFamily = sourceFamilies[Math.floor(random() * sourceFamilies.length)]!;
      const valueBucket = Math.floor(random() * 5);
      const recordedHour = String(6 + index).padStart(2, "0");
      const occurredHour = String(5 + index).padStart(2, "0");
      metricCandidates.push(candidate({
        date,
        facet: metric === "dayStrain" ? "day-strain" : `fuzz-${index}`,
        metric,
        occurredAt: `${date}T${occurredHour}:00:00.000Z`,
        provider,
        recordedAt: `${date}T${recordedHour}:00:00.000Z`,
        resourceType,
        sourceFamily,
        sourceKind: "observation:fuzz",
        suffix: `:seed-${seed}-${index}`,
        title: `private-fuzz-title-${seed}-${index}`,
        unit: "count",
        value: valueBucket * 100 + (index % 2 === 0 ? 0 : 0.25),
      }));
    }

    const dataset = activityOnlyDataset(metricCandidates);
    const directDay = buildWearableSummaryBundleFromDataset(dataset).activityDays[0];
    const storedDay = composeStoredDataset(dataset).activityDays[0];
    assert.ok(directDay);
    assert.ok(storedDay);
    const direct = activityParityMetric(directDay, metric);
    const stored = activityParityMetric(storedDay, metric);
    assert.deepEqual(
      safeResolvedMetricSnapshot(stored),
      safeResolvedMetricSnapshot(direct),
      `activity metric parity failed for seed ${seed} (${metric})`,
    );
    assert.doesNotMatch(stored.selection.title ?? "", /private-fuzz-title/u);
  }
});

test("compose preserves stored same-public provider conflict evidence", () => {
  const date = "2026-05-03";
  const dataset: WearableDataset = {
    activitySessionAggregates: [],
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

test("compose preserves stored activity aggregate-owned types and heart-rate zones", () => {
  const date = "2026-05-04";
  const session = activitySessionCandidate({
    activityType: "Running",
    date,
    durationMinutes: 45,
    endedAt: `${date}T12:45:00.000Z`,
    heartRateZones: [{
      durationMinutes: 18,
      label: "Zone 2",
      zone: 2,
    }],
    id: "garmin-run",
    provider: "garmin",
    recordedAt: `${date}T12:46:00.000Z`,
    startedAt: `${date}T12:00:00.000Z`,
    workoutMetricValues: {},
  });
  const dataset: WearableDataset = {
    activitySessionCandidates: [session],
    activitySessionAggregates: buildActivitySessionAggregates([session]),
    activitySessionDayRollups: buildActivitySessionDayRollups([session]),
    metricSuppressionEvidence: [],
    metricCandidates: [],
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
  const activity = composed.activityDays.find((summary) => summary.date === date);

  assert.ok(activity);
  assert.equal(activity.sessionMinutes.selection.value, 45);
  assert.equal(activity.sessionCount.selection.value, 1);
  assert.deepEqual(activity.activityTypes, ["Running"]);
  assert.deepEqual(activity.heartRateZones, [{
    durationMinutes: 18,
    label: "Zone 2",
    zone: 2,
  }]);
});

test("stored activity session evidence distinguishes legacy absence from invalid new rows", () => {
  const date = "2026-04-15";
  const session = activitySessionCandidate({
    activityType: "Running",
    date,
    durationMinutes: 40,
    endedAt: "2026-04-15T13:40:00.000Z",
    id: "garmin-run",
    provider: "garmin",
    recordedAt: "2026-04-15T13:41:00.000Z",
    startedAt: "2026-04-15T13:00:00.000Z",
    workoutMetricValues: {},
  });
  const rows = buildWearableSummaryProjectionFromDataset({
    activitySessionCandidates: [session],
    activitySessionAggregates: buildActivitySessionAggregates([session]),
    activitySessionDayRollups: buildActivitySessionDayRollups([session]),
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  });
  const activityRow = rows.find((row) => row.summaryKind === "activity");

  assert.ok(activityRow);
  const valid = parseStoredWearableActivitySessionEvidence(activityRow.summaryJson);
  assert.equal(valid.status, "valid");
  assert.equal(valid.status === "valid" ? valid.evidence.length : 0, 1);
  if (valid.status !== "valid") {
    assert.fail("expected valid stored session evidence");
  }
  const publicSummary = parseStoredWearableSummary<Record<string, unknown>>(
    "activity",
    activityRow.summaryJson,
  );
  assert.ok(publicSummary);
  const storeSessionEvidence = (
    evidence: typeof valid.evidence,
  ): string => stringifyStoredWearableProjectionSummary(
    "activity",
    publicSummary,
    { activitySessionEvidence: evidence },
  );
  const validSession = valid.evidence[0];
  assert.ok(validSession);
  const {
    durationConsistent: omittedDurationConsistency,
    ...sessionWithoutDurationConsistency
  } = validSession;
  const {
    reconciliationExactKey: omittedExactKey,
    ...sessionWithoutExactKey
  } = validSession;
  const {
    reconciliationResourceKey: omittedResourceKey,
    ...sessionWithoutResourceKey
  } = validSession;
  assert.equal(typeof omittedDurationConsistency, "boolean");
  assert.ok(omittedExactKey);
  assert.ok(omittedResourceKey);
  assert.deepEqual(
    parseStoredWearableActivitySessionEvidence(
      omitStoredSummaryField(
        omitStoredSummaryField(
          omitStoredSummaryField(
            activityRow.summaryJson,
            STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
          ),
          STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
        ),
        STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY,
      ),
    ),
    { status: "absent" },
  );
  assert.deepEqual(
    parseStoredWearableActivitySessionEvidence(
      replaceStoredSummaryField(
        replaceStoredSummaryField(
          activityRow.summaryJson,
          STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
          [],
        ),
        STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
        0,
      ),
    ),
    { status: "invalid", reason: "malformed" },
  );
  assert.deepEqual(
    parseStoredWearableActivitySessionEvidence(
      replaceStoredSummaryField(
        activityRow.summaryJson,
        STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
        [{ provider: "garmin" }],
      ),
    ),
    { status: "invalid", reason: "malformed" },
  );
  assert.equal(
    parseStoredWearableActivitySessionEvidence(
      storeSessionEvidence([
        { ...validSession, reconciliationResourceKey: null },
      ]),
    ).status,
    "valid",
  );
  assert.equal(
    parseStoredWearableActivitySessionEvidence(
      storeSessionEvidence([{ ...validSession, endedAt: null }]),
    ).status,
    "valid",
  );
  for (const malformedSession of [
    sessionWithoutDurationConsistency,
    sessionWithoutExactKey,
    sessionWithoutResourceKey,
    {
      ...validSession,
      reconciliationExactKey: "raw-provider-resource-id",
    },
    {
      ...validSession,
      reconciliationResourceKey: "raw-provider-resource-id",
    },
    {
      ...validSession,
      date: "not-a-date",
    },
    {
      ...validSession,
      date: "2026-99-99",
    },
    {
      ...validSession,
      recordedAt: "not-a-timestamp",
    },
    {
      ...validSession,
      startedAt: "not-a-timestamp",
    },
    {
      ...validSession,
      endedAt: "not-a-timestamp",
    },
    {
      ...validSession,
      startedAt: null,
    },
    {
      ...validSession,
      endedAt: "2026-04-15T12:59:59.000Z",
    },
  ]) {
    assert.deepEqual(
      parseStoredWearableActivitySessionEvidence(
        replaceStoredSummaryField(
          activityRow.summaryJson,
          STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
          [malformedSession],
        ),
      ),
      { status: "invalid", reason: "malformed" },
    );
  }
});

test("stored activity evidence parsers reject array and scalar summary roots", () => {
  for (const malformedSummaryJson of ["[]", JSON.stringify("scalar"), "42"]) {
    assert.deepEqual(
      parseStoredWearableActivityMetricEvidence(malformedSummaryJson),
      { status: "invalid" },
    );
    assert.deepEqual(
      parseStoredWearableActivitySessionEvidence(malformedSummaryJson),
      { status: "invalid", reason: "malformed" },
    );
  }
});

test("compose fails closed for empty stored session evidence on a single-provider read", () => {
  const date = "2026-04-15";
  const session = activitySessionCandidate({
    activityType: "Running",
    date,
    durationMinutes: 40,
    id: "garmin-run",
    provider: "garmin",
    recordedAt: "2026-04-15T13:41:00.000Z",
    workoutMetricValues: {},
  });
  const rows = buildWearableSummaryProjectionFromDataset({
    activitySessionCandidates: [session],
    activitySessionAggregates: buildActivitySessionAggregates([session]),
    activitySessionDayRollups: buildActivitySessionDayRollups([session]),
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  }).map((row) =>
    row.summaryKind === "activity"
      ? {
          ...row,
          summaryJson: replaceStoredSummaryField(
            replaceStoredSummaryField(
              row.summaryJson,
              STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
              [],
            ),
            STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
            0,
          ),
        }
      : row
  );

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: true,
      providers: ["garmin"],
      rows,
    }, {}),
    /Stored activity-session reconciliation evidence is malformed; rebuild the query projection/u,
  );
});

test("compose rejects one malformed provider instead of returning a partial mixed-provider total", () => {
  const date = "2026-04-15";
  const sessions = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 40,
      id: "garmin-run",
      provider: "garmin",
      recordedAt: "2026-04-15T13:41:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 20,
      id: "oura-strength",
      provider: "oura",
      recordedAt: "2026-04-15T18:21:00.000Z",
      workoutMetricValues: {},
    }),
  ];
  const rows = buildWearableSummaryProjectionFromDataset({
    activitySessionCandidates: sessions,
    activitySessionAggregates: buildActivitySessionAggregates(sessions),
    activitySessionDayRollups: buildActivitySessionDayRollups(sessions),
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  }).map((row) =>
    row.summaryKind === "activity"
    && row.providerScopeJson === JSON.stringify(["oura"])
      ? {
          ...row,
          summaryJson: replaceStoredSummaryField(
            row.summaryJson,
            STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
            [{ provider: "oura" }],
          ),
        }
      : row
  );

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: false,
      providers: [],
      rows,
    }, {}),
    /Stored activity-session reconciliation evidence is malformed; rebuild the query projection/u,
  );
});

test("compose rejects mixed current and legacy session evidence for one activity date", () => {
  const date = "2026-04-15";
  const sessions = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 40,
      id: "garmin-run",
      provider: "garmin",
      recordedAt: "2026-04-15T13:41:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 20,
      id: "oura-strength",
      provider: "oura",
      recordedAt: "2026-04-15T18:21:00.000Z",
      workoutMetricValues: {},
    }),
  ];
  const rows = buildWearableSummaryProjectionFromDataset({
    activitySessionCandidates: sessions,
    activitySessionAggregates: buildActivitySessionAggregates(sessions),
    activitySessionDayRollups: buildActivitySessionDayRollups(sessions),
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  }).map((row) =>
    row.summaryKind === "activity"
    && row.providerScopeJson === JSON.stringify(["oura"])
      ? {
          ...row,
          summaryJson: omitStoredSummaryField(
            omitStoredSummaryField(
              omitStoredSummaryField(
                row.summaryJson,
                STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
              ),
              STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
            ),
            STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY,
          ),
        }
      : row
  );

  assert.throws(
    () => composePublicWearableSummaryBundleFromStoredRows({
      providerFilterWasProvided: false,
      providers: [],
      rows,
    }, {}),
    /Stored activity-session reconciliation evidence mixes current and legacy rows for one date/u,
  );
});

test("legacy multi-provider rows without internal evidence retain workout-owned metrics", () => {
  const date = "2026-04-15";
  const sessions = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 60,
      endedAt: "2026-04-15T13:00:00.000Z",
      id: "garmin-run",
      provider: "garmin",
      recordedAt: "2026-04-15T23:01:00.000Z",
      startedAt: "2026-04-15T12:00:00.000Z",
      workoutMetricValues: {
        activeCalories: 600,
        distanceKm: 10,
        maxHeartRate: 180,
        totalElevationGainMeters: 200,
        workoutStrain: 15,
      },
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 10,
      endedAt: "2026-04-15T18:10:00.000Z",
      id: "oura-strength",
      provider: "oura",
      recordedAt: "2026-04-15T18:11:00.000Z",
      startedAt: "2026-04-15T18:00:00.000Z",
      workoutMetricValues: {},
    }),
  ];
  const legacyRows = buildWearableSummaryProjectionFromDataset({
    activitySessionCandidates: sessions,
    activitySessionAggregates: buildActivitySessionAggregates(sessions),
    activitySessionDayRollups: buildActivitySessionDayRollups(sessions),
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  }).map((row) => {
    if (row.summaryKind !== "activity") {
      return row;
    }
    return {
      ...row,
      summaryJson: omitStoredSummaryField(
        omitStoredSummaryField(
          omitStoredSummaryField(
            omitStoredSummaryField(
              omitStoredSummaryField(
                omitStoredSummaryField(
                  row.summaryJson,
                  STORED_ACTIVITY_METRIC_EVIDENCE_KEY,
                ),
                STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY,
              ),
              STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY,
            ),
            STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
          ),
          STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
        ),
        STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY,
      ),
    };
  });
  const activityRows = legacyRows.filter((row) => row.summaryKind === "activity");

  assert.equal(activityRows.length, 2);
  assert.equal(
    activityRows.every((row) =>
      parseStoredWearableActivityMetricEvidence(row.summaryJson).status === "absent"
      && parseStoredWearableActivitySessionEvidence(row.summaryJson).status === "absent"
    ),
    true,
  );

  const composed = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows: legacyRows,
  }, {});
  const activity = composed.activityDays.find((summary) => summary.date === date);

  assert.ok(activity);
  assert.equal(activity.activeCalories.selection.value, 600);
  assert.equal(activity.distanceKm.selection.value, 10);
  assert.equal(activity.maxHeartRate.selection.value, 180);
  assert.equal(activity.totalElevationGainMeters.selection.value, 200);
  assert.equal(activity.workoutStrain.selection.value, 15);
});

test("stored activity evidence composes distinct sessions and suppresses a cross-provider mirror", () => {
  const date = "2026-04-16";
  const runMetrics = {
    activeCalories: 600,
    distanceKm: 10,
    maxHeartRate: 180,
    totalElevationGainMeters: 200,
    workoutStrain: 12.5,
  };
  const activitySessionCandidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 60,
      endedAt: "2026-04-16T13:00:00.000Z",
      id: "garmin-run",
      provider: "garmin",
      recordedAt: "2026-04-16T13:01:00.000Z",
      startedAt: "2026-04-16T12:00:00.000Z",
      workoutMetricValues: runMetrics,
    }),
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 60,
      endedAt: "2026-04-16T13:00:00.000Z",
      id: "apple-run-mirror",
      provider: "apple-health-kit",
      recordedAt: "2026-04-16T13:02:00.000Z",
      startedAt: "2026-04-16T12:00:00.000Z",
      workoutMetricValues: runMetrics,
    }),
    activitySessionCandidate({
      activityType: "Functional strength training",
      date,
      durationMinutes: 15,
      endedAt: "2026-04-16T22:15:00.000Z",
      id: "oura-strength",
      provider: "oura",
      recordedAt: "2026-04-16T22:17:00.000Z",
      startedAt: "2026-04-16T22:00:00.000Z",
      workoutMetricValues: {
        activeCalories: 90,
        maxHeartRate: 172,
        workoutStrain: 6,
      },
    }),
  ];
  const dailyMetricCandidates = [
    candidate({
      date,
      facet: "daily-distance",
      metric: "distanceKm",
      provider: "garmin",
      unit: "km",
      value: 14.5,
    }),
    candidate({
      date,
      facet: "daily-active-calories",
      metric: "activeCalories",
      provider: "garmin",
      unit: "kcal",
      value: 0,
    }),
  ];
  const dataset: WearableDataset = {
    activitySessionCandidates,
    activitySessionAggregates: [],
    metricSuppressionEvidence: [],
    metricCandidates: dailyMetricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: dailyMetricCandidates,
    sleepWindows: [],
  };

  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const activityRows = rows.filter((row) => row.summaryKind === "activity");
  const composed = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows,
  }, {});
  const activity = composed.activityDays.find((summary) => summary.date === date);
  const garminActivityRows = activityRows.filter((row) =>
    row.providerScopeJson === JSON.stringify(["garmin"])
  );
  const direct = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: true,
    providers: ["garmin"],
    rows: garminActivityRows,
  }, {});

  assert.equal(activityRows.length, 3);
  assert.equal(
    activityRows.every((row) => row.summaryJson.includes(`"${STORED_ACTIVITY_SESSION_EVIDENCE_KEY}"`)),
    true,
  );
  assert.ok(activity);
  assert.equal(activity.sessionMinutes.selection.value, 75);
  assert.equal(activity.sessionCount.selection.value, 2);
  assert.equal(activity.sessionMinutes.selection.provider, "multiple");
  assert.equal(activity.activeCalories.selection.value, 690);
  assert.equal(activity.activeCalories.selection.provider, "multiple");
  assert.equal(activity.activeCalories.selection.sourceKind, "activity-session-day-rollup");
  assert.equal(activity.distanceKm.selection.value, 14.5);
  assert.equal(activity.distanceKm.selection.provider, "garmin");
  assert.equal(activity.distanceKm.selection.sourceKind, "observation:daily-distance");
  assert.equal(activity.totalElevationGainMeters.selection.value, 200);
  assert.equal(activity.maxHeartRate.selection.value, 180);
  assert.equal(activity.workoutStrain.selection.value, 12.5);
  assert.equal("activitySessions" in activity, false);
  assert.equal(STORED_ACTIVITY_SESSION_EVIDENCE_KEY in activity, false);
  assert.equal(JSON.stringify(composed).includes(STORED_ACTIVITY_SESSION_EVIDENCE_KEY), false);
  assert.equal(JSON.stringify(direct).includes(STORED_ACTIVITY_SESSION_EVIDENCE_KEY), false);
  assert.equal("activitySessions" in (direct.activityDays[0] ?? {}), false);
});

test("stored activity evidence applies one global overlap reduction like the live summary", () => {
  const date = "2026-02-14";
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 100,
      endedAt: "2026-02-14T13:20:00.000Z",
      id: "apple-leading-window",
      provider: "apple-health-kit",
      recordedAt: "2026-02-14T13:21:00.000Z",
      startedAt: "2026-02-14T11:40:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 100,
      endedAt: "2026-02-14T13:40:00.000Z",
      id: "garmin-middle-window",
      provider: "garmin",
      recordedAt: "2026-02-14T13:42:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 100,
      endedAt: "2026-02-14T14:00:00.000Z",
      id: "garmin-trailing-window",
      provider: "garmin",
      recordedAt: "2026-02-14T14:02:00.000Z",
      startedAt: "2026-02-14T12:20:00.000Z",
      workoutMetricValues: {},
    }),
  ];

  const { direct, directBundle, rows, stored, storedBundle } =
    buildDirectAndStoredActivity(date, candidates);

  assert.equal(direct.sessionMinutes.selection.value, 100);
  assert.equal(direct.sessionCount.selection.value, 1);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
  assert.equal(
    rows
      .filter((row) => row.summaryKind === "activity")
      .reduce(
        (total, row) => {
          const parsed = parseStoredWearableActivitySessionEvidence(row.summaryJson);
          return total + (parsed.status === "valid" ? parsed.evidence.length : 0);
        },
        0,
      ),
    3,
  );
  assert.equal(JSON.stringify(stored).includes(STORED_ACTIVITY_SESSION_EVIDENCE_KEY), false);
  assert.equal(directBundle.sourceHealth.every((summary) => summary.sleepNights === 0), true);
  assert.equal(storedBundle.sourceHealth.every((summary) => summary.sleepNights === 0), true);
});

test("stored activity evidence preserves duration-consistency preference and pause tolerance", () => {
  const date = "2026-02-14";
  const scenarios = [
    {
      candidates: [
        activitySessionCandidate({
          activityType: "Running",
          date,
          durationMinutes: 10,
          endedAt: "2026-02-14T13:00:00.000Z",
          id: "inconsistent-duration",
          provider: "garmin",
          recordedAt: "2026-02-14T13:01:00.000Z",
          startedAt: "2026-02-14T12:00:00.000Z",
          workoutMetricValues: {},
        }),
        activitySessionCandidate({
          activityType: "Run",
          date,
          durationMinutes: 50,
          endedAt: "2026-02-14T12:50:00.000Z",
          id: "consistent-duration",
          provider: "garmin",
          recordedAt: "2026-02-14T13:02:00.000Z",
          startedAt: "2026-02-14T12:00:00.000Z",
          workoutMetricValues: {},
        }),
      ],
      label: "inconsistent elapsed window",
    },
    {
      candidates: [
        activitySessionCandidate({
          activityType: "Running",
          date,
          durationMinutes: 50,
          endedAt: "2026-02-14T13:00:00.000Z",
          id: "plausibly-paused-duration",
          provider: "garmin",
          recordedAt: "2026-02-14T13:01:00.000Z",
          startedAt: "2026-02-14T12:00:00.000Z",
          workoutMetricValues: {},
        }),
        activitySessionCandidate({
          activityType: "Run",
          date,
          durationMinutes: 49,
          endedAt: "2026-02-14T12:49:00.000Z",
          id: "unpaused-duration",
          provider: "garmin",
          recordedAt: "2026-02-14T13:02:00.000Z",
          startedAt: "2026-02-14T12:00:00.000Z",
          workoutMetricValues: {},
        }),
      ],
      label: "plausible pause",
    },
  ] as const;

  for (const scenario of scenarios) {
    const { direct, stored } = buildDirectAndStoredActivity(date, [...scenario.candidates]);
    assert.equal(direct.sessionMinutes.selection.value, 50, scenario.label);
    assert.equal(direct.sessionCount.selection.value, 1, scenario.label);
    assert.equal(
      stored.sessionMinutes.selection.value,
      direct.sessionMinutes.selection.value,
      scenario.label,
    );
    assert.equal(
      stored.sessionCount.selection.value,
      direct.sessionCount.selection.value,
      scenario.label,
    );
  }
});

test("stored activity evidence keeps a duration-derived window coherent across merges", () => {
  const date = "2026-02-14";
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 60,
      id: "derived-window",
      provider: "garmin",
      recordedAt: "2026-02-14T13:01:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Run",
      date,
      durationMinutes: 50,
      endedAt: "2026-02-14T12:50:00.000Z",
      id: "shorter-explicit-window",
      provider: "garmin",
      recordedAt: "2026-02-14T13:02:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Outdoor Run",
      date,
      durationMinutes: 40,
      endedAt: "2026-02-14T12:40:00.000Z",
      id: "nested-after-merge",
      provider: "garmin",
      recordedAt: "2026-02-14T13:03:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
  ];

  const { direct, stored } = buildDirectAndStoredActivity(date, candidates);

  assert.equal(direct.sessionMinutes.selection.value, 100);
  assert.equal(direct.sessionCount.selection.value, 2);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
});

test("stored activity evidence retains stable identity through an overlap merge", () => {
  const date = "2026-02-14";
  const sharedResourceId = "shared-three-way-resource";
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 60,
      endedAt: "2026-02-14T13:00:00.000Z",
      externalRef: null,
      id: "identityless-preferred",
      provider: "apple-health-kit",
      recordedAt: "2026-02-14T13:01:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Run",
      date,
      durationMinutes: 50,
      endedAt: "2026-02-14T12:50:00.000Z",
      id: "stable-identity-window",
      provider: "garmin",
      recordedAt: "2026-02-14T13:02:00.000Z",
      resourceId: sharedResourceId,
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 50,
      id: "stable-identity-without-window",
      provider: "garmin",
      recordedAt: "2026-02-14T13:03:00.000Z",
      resourceId: sharedResourceId,
      workoutMetricValues: {},
    }),
  ];

  const { direct, stored } = buildDirectAndStoredActivity(date, candidates);

  assert.equal(direct.sessionMinutes.selection.value, 60);
  assert.equal(direct.sessionCount.selection.value, 1);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
});

test("stored activity evidence falls back from a reversed explicit end", () => {
  const date = "2026-02-14";
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 60,
      endedAt: "2026-02-14T11:59:00.000Z",
      id: "reversed-end",
      provider: "garmin",
      recordedAt: "2026-02-14T13:02:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Run",
      date,
      durationMinutes: 50,
      endedAt: "2026-02-14T12:50:00.000Z",
      id: "valid-end",
      provider: "garmin",
      recordedAt: "2026-02-14T13:01:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {},
    }),
  ];

  const { direct, stored } = buildDirectAndStoredActivity(date, candidates);

  assert.equal(direct.sessionMinutes.selection.value, 50);
  assert.equal(direct.sessionCount.selection.value, 1);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
});

test("stored activity evidence preserves stable resource identity without timestamps", () => {
  const date = "2026-02-14";
  const sharedResourceId = "shared-garmin-workout";
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 30,
      id: "garmin-direct-no-window",
      provider: "garmin",
      recordedAt: "2026-02-14T13:00:00.000Z",
      resourceId: sharedResourceId,
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Running",
      dataOrigin: {
        aggregatorProvider: "junction",
        originConfidence: "high",
        sourceInstanceId: "garmin-watch",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        version: 1,
      },
      date,
      durationMinutes: 30,
      id: "garmin-junction-no-window",
      provider: "junction",
      recordedAt: "2026-02-14T13:02:00.000Z",
      resourceId: sharedResourceId,
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 10,
      endedAt: "2026-02-14T18:10:00.000Z",
      id: "oura-strength",
      provider: "oura",
      recordedAt: "2026-02-14T18:11:00.000Z",
      startedAt: "2026-02-14T18:00:00.000Z",
      workoutMetricValues: {},
    }),
  ];

  const { direct, stored } = buildDirectAndStoredActivity(date, candidates);

  assert.equal(direct.sessionMinutes.selection.value, 40);
  assert.equal(direct.sessionCount.selection.value, 2);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
  assert.deepEqual(stored.activityTypes, direct.activityTypes);
  assert.equal(JSON.stringify(stored).includes("reconciliationDurationConsistent"), false);
  assert.equal(JSON.stringify(stored).includes("reconciliationResourceKey"), false);
  assert.equal(JSON.stringify(stored).includes("reconciliationExactKey"), false);
});

test("stored activity identity keeps endpoint-local ids partitioned by resource type and facet", () => {
  const date = "2026-02-14";
  const externalRef = (
    resourceType: string,
    resourceId: string,
    facet: string | null = null,
  ): NonNullable<WearableMetricCandidate["externalRef"]> => ({
    facet,
    resourceId,
    resourceType,
    system: "oura",
    version: null,
  });
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 30,
      externalRef: externalRef("session", "endpoint-local-id"),
      id: "oura-session-local-id",
      provider: "oura",
      recordedAt: "2026-02-14T13:01:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Cycling",
      date,
      durationMinutes: 45,
      externalRef: externalRef("workout", "endpoint-local-id"),
      id: "oura-workout-local-id",
      provider: "oura",
      recordedAt: "2026-02-14T13:02:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 20,
      externalRef: externalRef("workout", "faceted-local-id", "primary"),
      id: "oura-primary-facet",
      provider: "oura",
      recordedAt: "2026-02-14T18:01:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Swimming",
      date,
      durationMinutes: 25,
      externalRef: externalRef("workout", "faceted-local-id", "secondary"),
      id: "oura-secondary-facet",
      provider: "oura",
      recordedAt: "2026-02-14T18:02:00.000Z",
      workoutMetricValues: {},
    }),
  ];

  const { direct, stored } = buildDirectAndStoredActivity(date, candidates);

  assert.equal(direct.sessionMinutes.selection.value, 120);
  assert.equal(direct.sessionCount.selection.value, 4);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
  assert.deepEqual(stored.activityTypes, direct.activityTypes);
  assert.equal(JSON.stringify(stored).includes("reconciliationResourceKey"), false);
});

test("stored activity evidence preserves raw exact partitions without public identity leakage", () => {
  const date = "2026-02-14";
  const garminOrigin = (sourceInstanceId: string): NonNullable<WearableMetricCandidate["dataOrigin"]> => ({
    aggregatorProvider: "junction",
    originConfidence: "high",
    sourceInstanceId,
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    version: 1,
  });
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      dataOrigin: garminOrigin("watch-a"),
      date,
      durationMinutes: 30,
      externalRef: null,
      id: "garmin-origin-a-no-identity",
      provider: "junction",
      recordedAt: "2026-02-14T13:00:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Running",
      dataOrigin: garminOrigin("watch-b"),
      date,
      durationMinutes: 30,
      externalRef: null,
      id: "garmin-origin-b-no-identity",
      provider: "junction",
      recordedAt: "2026-02-14T13:01:00.000Z",
      workoutMetricValues: {},
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 10,
      endedAt: "2026-02-14T18:10:00.000Z",
      id: "oura-distinct-session",
      provider: "oura",
      recordedAt: "2026-02-14T18:11:00.000Z",
      startedAt: "2026-02-14T18:00:00.000Z",
      workoutMetricValues: {},
    }),
  ];

  const { direct, stored } = buildDirectAndStoredActivity(date, candidates);

  assert.equal(direct.sessionMinutes.selection.value, 70);
  assert.equal(direct.sessionCount.selection.value, 3);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
  assert.equal(JSON.stringify(stored).includes("reconciliationExactKey"), false);
});

test("stored activity evidence preserves field-level contributor provenance", () => {
  const date = "2026-02-14";
  const candidates = [
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 60,
      endedAt: "2026-02-14T13:00:00.000Z",
      id: "garmin-preferred-run",
      provider: "garmin",
      recordedAt: "2026-02-14T13:01:00.000Z",
      startedAt: "2026-02-14T12:00:00.000Z",
      workoutMetricValues: {
        activeCalories: 600,
      },
    }),
    activitySessionCandidate({
      activityType: "Running",
      date,
      durationMinutes: 55,
      endedAt: "2026-02-14T12:57:00.000Z",
      id: "apple-complementary-run",
      provider: "apple-health-kit",
      recordedAt: "2026-02-14T13:02:00.000Z",
      startedAt: "2026-02-14T12:02:00.000Z",
      workoutMetricValues: {
        distanceKm: 10,
        maxHeartRate: 190,
        totalElevationGainMeters: 200,
        workoutStrain: 15,
      },
    }),
    activitySessionCandidate({
      activityType: "Strength",
      date,
      durationMinutes: 15,
      endedAt: "2026-02-14T18:15:00.000Z",
      id: "oura-distinct-strength",
      provider: "oura",
      recordedAt: "2026-02-14T18:16:00.000Z",
      startedAt: "2026-02-14T18:00:00.000Z",
      workoutMetricValues: {
        activeCalories: 100,
        maxHeartRate: 175,
        workoutStrain: 8,
      },
    }),
  ];

  const { direct, directBundle, stored, storedBundle } =
    buildDirectAndStoredActivity(date, candidates);
  const sourceContributions = (
    sourceHealth: typeof directBundle.sourceHealth,
  ) => sourceHealth
    .map((summary) => ({
      candidateMetrics: summary.candidateMetrics,
      metricsContributed: summary.metricsContributed,
      provider: summary.provider,
      selectedMetrics: summary.selectedMetrics,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider));

  assert.equal(direct.sessionMinutes.selection.value, 75);
  assert.equal(stored.sessionMinutes.selection.value, direct.sessionMinutes.selection.value);
  assert.equal(stored.sessionCount.selection.value, direct.sessionCount.selection.value);
  assert.equal(stored.activeCalories.selection.provider, "multiple");
  assert.equal(stored.distanceKm.selection.provider, "apple-health-kit");
  assert.equal(stored.maxHeartRate.selection.provider, "apple-health-kit");
  assert.equal(stored.totalElevationGainMeters.selection.provider, "apple-health-kit");
  assert.equal(stored.workoutStrain.selection.provider, "apple-health-kit");
  assert.equal(directBundle.sourceHealth.length, 3);
  assert.equal(storedBundle.sourceHealth.length, 3);
  assert.equal(directBundle.sourceHealth.every((summary) => summary.candidateMetrics === 1), true);
  assert.equal(storedBundle.sourceHealth.every((summary) => summary.candidateMetrics === 1), true);
  assert.deepEqual(sourceContributions(storedBundle.sourceHealth), sourceContributions(directBundle.sourceHealth));
});

test("compose rebuilt stored sleep rows drops zeroed Apple HealthKit summary in favor of WHOOP", () => {
  const date = "2026-07-07";
  const startAt = "2026-07-07T08:17:04.000Z";
  const endAt = "2026-07-07T14:02:56.000Z";
  const dataset: WearableDataset = {
    activitySessionAggregates: [],
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

test("stored sleep-window evidence does not create activity source coverage", () => {
  const date = "2026-07-07";
  const dataset: WearableDataset = {
    activitySessionAggregates: [],
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [
      sleepWindow("garmin", date),
      sleepWindow("oura", date),
    ],
  };
  const direct = buildWearableSummaryBundleFromDataset(dataset);
  const stored = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows: buildWearableSummaryProjectionFromDataset(dataset),
  }, {});

  assert.equal(direct.sleepNights.length, 1);
  assert.equal(stored.sleepNights.length, 1);
  assert.equal(direct.sourceHealth.every((summary) => summary.activityDays === 0), true);
  assert.equal(stored.sourceHealth.every((summary) => summary.activityDays === 0), true);
});

test("compose preserves non-selected provider same-public conflict evidence", () => {
  const date = "2026-05-03";
  const dataset: WearableDataset = {
    activitySessionAggregates: [],
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
        date,
        facet: "steps",
        metric: "steps",
        provider: "oura",
        suffix: ":direct",
        unit: "count",
        value: 8_050,
      }),
      candidate({
        dataOrigin: {
          aggregatorProvider: "junction",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          version: 1,
        },
        date,
        facet: "steps",
        metric: "steps",
        provider: "junction",
        resourceType: "junction-oura-activity",
        suffix: ":junction",
        system: "junction",
        unit: "count",
        value: 8_500,
      }),
    ],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  };
  const rows = buildWearableSummaryProjectionFromDataset(dataset);
  const direct = buildWearableSummaryBundleFromDataset(dataset);
  const composed = composePublicWearableSummaryBundleFromStoredRows({
    providerFilterWasProvided: false,
    providers: [],
    rows,
  }, {});
  const activity = composed.activityDays.find((summary) => summary.date === date);

  assert.ok(activity);
  const directActivity = direct.activityDays.find((summary) => summary.date === date);
  assert.ok(directActivity);
  assert.deepEqual(
    safeResolvedMetricSnapshot(activity.steps),
    safeResolvedMetricSnapshot(directActivity.steps),
  );
  assert.equal(activity.steps.selection.provider, "garmin");
  assert.deepEqual(activity.steps.confidence.conflictingProviders, ["oura"]);
  assert.equal(activity.steps.confidence.level, "medium");
  assert.equal(
    activity.steps.confidence.reasons.some((reason) =>
      reason === "Duplicate evidence from Oura disagreed after source reconciliation."
    ),
    false,
  );
  assert.equal(activity.summaryConfidence.conflictingMetrics.includes("steps"), true);
  assert.equal(composed.sourceHealth.find((summary) => summary.provider === "garmin")?.conflictCount, 1);
  assert.equal(composed.sourceHealth.find((summary) => summary.provider === "oura")?.conflictCount, 1);
});

test("compose recomputes source health and summary notes after stored conflicts are merged", () => {
  const date = "2026-05-03";
  const dataset: WearableDataset = {
    activitySessionAggregates: [],
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
      candidate({
        date,
        facet: "active-calories",
        metric: "activeCalories",
        provider: "garmin",
        unit: "kcal",
        value: 500,
      }),
      candidate({
        date,
        facet: "active-calories",
        metric: "activeCalories",
        provider: "oura",
        suffix: ":oura",
        unit: "kcal",
        value: 650,
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
  const activity = composed.activityDays.find((summary) => summary.date === date);
  const garminSourceHealth = composed.sourceHealth.find((summary) => summary.provider === "garmin");
  const ouraSourceHealth = composed.sourceHealth.find((summary) => summary.provider === "oura");

  assert.ok(activity);
  assert.deepEqual(activity.steps.confidence.conflictingProviders, ["garmin"]);
  assert.equal(activity.activeCalories.selection.provider, "oura");
  assert.deepEqual(activity.activeCalories.confidence.conflictingProviders, ["garmin"]);
  assert.equal(garminSourceHealth?.conflictCount, 2);
  assert.equal(ouraSourceHealth?.conflictCount, 1);

  const conflictNotes = activity.summaryConfidence.notes.filter((note) =>
    note.startsWith("Some metrics still conflict across providers:")
  );
  assert.equal(conflictNotes.length, 1);
  assert.equal(conflictNotes[0]?.includes("Steps"), true);
  assert.match(conflictNotes[0] ?? "", /active calories/iu);
});

test("compose preserves stored same-public sleep-window conflict evidence", () => {
  const date = "2026-05-04";
  const dataset: WearableDataset = {
    activitySessionAggregates: [],
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
      const storedJson = stringifyStoredWearableProjectionSummary(summaryKind, summary);
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

  const storedJson = stringifyStoredWearableProjectionSummary("activity", doctored);
  assert.ok(storedJson.includes('"futureField"'), "expected the unknown field to survive storage");
  assert.ok(storedJson.includes('"metric":"steps"'), "expected the unknown-shaped envelope to stay in full form");
  assert.equal(
    JSON.stringify(parseStoredWearableSummary("activity", storedJson)),
    stringifyPublicWearableProjectionSummary(doctored),
  );
});

test("compose output from compact stored rows matches legacy full-form rows", () => {
  const rows = buildWearableSummaryProjectionFromDataset(buildFixtureDataset(["whoop", "oura"]));
  assert.ok(rows.length > 0);

  const legacyRows = rows.map((row) => {
    if (row.summaryKind === "source_health") {
      return row;
    }

    const stored = JSON.parse(row.summaryJson);
    const expanded = parseStoredWearableSummary<Record<string, unknown>>(
      row.summaryKind,
      row.summaryJson,
    );
    assert.ok(expanded);
    for (const evidenceKey of [
      STORED_ACTIVITY_METRIC_EVIDENCE_KEY,
      STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY,
      STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY,
      STORED_ACTIVITY_SESSION_EVIDENCE_KEY,
      STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
      STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY,
    ]) {
      if (Object.hasOwn(stored, evidenceKey)) {
        expanded[evidenceKey] = stored[evidenceKey];
      }
    }
    return {
      ...row,
      summaryJson: JSON.stringify(expanded),
    };
  });
  assert.ok(
    legacyRows.some((legacyRow, index) => legacyRow.summaryJson !== rows[index]?.summaryJson),
    "expected compact rows to differ from legacy rows on disk",
  );

  const scopes = [
    { providerFilterWasProvided: true, providers: ["whoop"] },
    { providerFilterWasProvided: true, providers: ["oura", "whoop"] },
  ];
  const filterSets = [{}, { date: "2026-05-01" }, { from: "2026-05-02", to: "2026-05-02" }];

  for (const scope of scopes) {
    const scopeKeys = new Set(scope.providers.map((provider) => `providers:${provider}`));
    const scopedRows = rows.filter((row) => scopeKeys.has(row.providerScopeKey));
    const scopedLegacyRows = legacyRows.filter((row) => scopeKeys.has(row.providerScopeKey));
    assert.ok(scopedRows.length > 0);

    for (const filters of filterSets) {
      const composed = composePublicWearableSummaryBundleFromStoredRows(
        { ...scope, rows: scopedRows },
        filters,
      );
      const legacyComposed = composePublicWearableSummaryBundleFromStoredRows(
        { ...scope, rows: scopedLegacyRows },
        filters,
      );

      assert.equal(JSON.stringify(composed), JSON.stringify(legacyComposed));
      if (filters === filterSets[0]) {
        assert.ok(
          composed.activityDays.length + composed.sleepNights.length + composed.recoveryDays.length > 0,
          "expected the unfiltered compose to return summaries",
        );
      }
    }
  }
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

  const storedJson = stringifyStoredWearableProjectionSummary("activity", doctored);
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

  const storedJson = stringifyStoredWearableProjectionSummary("activity", doctored);
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
  const storedJson = stringifyStoredWearableProjectionSummary("activity", bundle.activityDays[0]!);

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
  const storedJson = stringifyStoredWearableProjectionSummary("activity", summary);
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
