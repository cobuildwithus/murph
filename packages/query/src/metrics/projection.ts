import { resolveMetricInputKey } from "@murphai/health-metrics";

import type { VaultReadModel } from "../read-model.ts";
import { summarizeDailySamples, type DailySampleSummary } from "../summaries.ts";
import {
  buildWearableSummaryBundle,
  summarizeWearableActivityFromBundle,
  summarizeWearableBodyStateFromBundle,
  summarizeWearableRecoveryFromBundle,
  summarizeWearableSleepFromBundle,
  type WearableActivitySummary,
  type WearableBodyStateSummary,
  type WearableConfidenceLevel,
  type WearableRecoverySummary,
  type WearableResolvedMetric,
  type WearableSleepSummary,
  type WearableSummaryBundle,
} from "../wearables.ts";
import { formatProviderName } from "../wearables/provider-policy.ts";
import {
  extractMetricPoints,
  type MetricPoint,
  type MetricRowEvidence,
} from "./index.ts";

const METRIC_PROJECTION_LIMIT = 365;

export interface MetricProjection {
  dailySampleSummaries: DailySampleSummary[];
  metricPoints: MetricPoint[];
  wearableMetricRows: MetricRowEvidence[];
}

export interface BuildMetricProjectionOptions {
  wearableMetricRows?: readonly MetricRowEvidence[];
}

export function buildMetricProjection(
  vault: VaultReadModel,
  options: BuildMetricProjectionOptions = {},
): MetricProjection {
  const dailySampleSummaries = summarizeDailySamples(vault);
  const wearableMetricRows = options.wearableMetricRows
    ? [...options.wearableMetricRows]
    : buildWearableMetricEvidence(vault);
  const metricPoints = extractMetricPoints({
    metricRows: wearableMetricRows,
    sampleSummaries: dailySampleSummaries,
    vault,
  });
  return {
    dailySampleSummaries,
    metricPoints: applyWearableSummaryMetricPrecedence(metricPoints),
    wearableMetricRows,
  };
}

export function buildWearableMetricEvidence(vault: VaultReadModel): MetricRowEvidence[] {
  return buildWearableMetricEvidenceFromBundle(buildWearableSummaryBundle(vault));
}

export function buildWearableMetricEvidenceFromBundle(bundle: WearableSummaryBundle): MetricRowEvidence[] {
  const sleepSummaries = summarizeWearableSleepFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });
  const recoverySummaries = summarizeWearableRecoveryFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });
  const activitySummaries = summarizeWearableActivityFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });
  const bodyStateSummaries = summarizeWearableBodyStateFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });

  return [
    ...sleepSummaries.flatMap((summary) => summaryMetricEvidence(summary, SLEEP_METRIC_EVIDENCE)),
    ...recoverySummaries.flatMap((summary) => summaryMetricEvidence(summary, RECOVERY_METRIC_EVIDENCE)),
    ...activitySummaries.flatMap((summary) => summaryMetricEvidence(summary, ACTIVITY_METRIC_EVIDENCE)),
    ...bodyStateSummaries.flatMap((summary) => summaryMetricEvidence(summary, BODY_STATE_METRIC_EVIDENCE)),
  ];
}

type WearableSummaryBase = {
  date: string;
  summaryConfidence: {
    level: WearableConfidenceLevel;
  };
};

type WearableResolvedMetricField<TSummary> = Extract<{
  [K in keyof TSummary]: TSummary[K] extends WearableResolvedMetric ? K : never;
}[keyof TSummary], string>;

interface SummaryMetricEvidenceEntry<TField extends string> {
  metricKey: string;
  sourceKind: MetricRowEvidence["sourceKind"];
  summaryField: TField;
}

const SLEEP_METRIC_EVIDENCE = [
  { metricKey: "total-sleep-minutes", summaryField: "totalSleepMinutes", sourceKind: "sleep-summary" },
  { metricKey: "sleep-score", summaryField: "sleepScore", sourceKind: "sleep-summary" },
  { metricKey: "deep-sleep-minutes", summaryField: "deepMinutes", sourceKind: "sleep-summary" },
  { metricKey: "rem-sleep-minutes", summaryField: "remMinutes", sourceKind: "sleep-summary" },
  { metricKey: "hrv-rmssd", summaryField: "hrv", sourceKind: "sleep-summary" },
  { metricKey: "spo2", summaryField: "spo2", sourceKind: "sleep-summary" },
  { metricKey: "lowest-spo2", summaryField: "lowestSpo2", sourceKind: "sleep-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableSleepSummary>>[];

const RECOVERY_METRIC_EVIDENCE = [
  { metricKey: "readiness-score", summaryField: "readinessScore", sourceKind: "wearable-summary" },
  { metricKey: "resting-heart-rate", summaryField: "restingHeartRate", sourceKind: "wearable-summary" },
  { metricKey: "hrv-rmssd", summaryField: "hrv", sourceKind: "wearable-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableRecoverySummary>>[];

const ACTIVITY_METRIC_EVIDENCE = [
  { metricKey: "steps", summaryField: "steps", sourceKind: "activity-summary" },
  { metricKey: "activity-minutes", summaryField: "sessionMinutes", sourceKind: "activity-summary" },
  { metricKey: "estimated-vo2-max", summaryField: "estimatedVo2Max", sourceKind: "activity-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableActivitySummary>>[];

const BODY_STATE_METRIC_EVIDENCE = [
  { metricKey: "body-weight", summaryField: "weightKg", sourceKind: "wearable-summary" },
  { metricKey: "body-fat-percentage", summaryField: "bodyFatPercentage", sourceKind: "wearable-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableBodyStateSummary>>[];

const SUMMARY_METRIC_EVIDENCE_ENTRIES = [
  ...SLEEP_METRIC_EVIDENCE,
  ...RECOVERY_METRIC_EVIDENCE,
  ...ACTIVITY_METRIC_EVIDENCE,
  ...BODY_STATE_METRIC_EVIDENCE,
];

const WEARABLE_SUMMARY_METRIC_PRIORITIES = buildWearableSummaryMetricPriorities();

export function listWearableSummaryMetricEvidenceKeys(): string[] {
  return uniqueStrings(
    SUMMARY_METRIC_EVIDENCE_ENTRIES.map((entry) => resolveMetricInputKey(entry.metricKey)),
  ).sort();
}

function summaryMetricEvidence<TField extends string>(
  summary: WearableSummaryBase & Record<TField, WearableResolvedMetric>,
  entries: readonly SummaryMetricEvidenceEntry<TField>[],
): MetricRowEvidence[] {
  return entries.map((entry) =>
    metricEvidence(
      summary.date,
      entry.metricKey,
      summary[entry.summaryField],
      summary.summaryConfidence.level,
      entry.sourceKind,
    )
  );
}

function applyWearableSummaryMetricPrecedence(points: readonly MetricPoint[]): MetricPoint[] {
  const summaryResolvedByDay = new Map<string, MetricPoint>();

  for (const point of points) {
    if (isWearableSummaryMetricPoint(point)) {
      const dayKey = metricPointDayKey(point);
      const current = summaryResolvedByDay.get(dayKey);
      if (!current || compareWearableSummaryMetricPriority(point, current) < 0) {
        summaryResolvedByDay.set(dayKey, point);
      }
    }
  }

  return points.filter((point) => {
    const summaryPoint = summaryResolvedByDay.get(metricPointDayKey(point));
    if (!summaryPoint) {
      return true;
    }

    if (isWearableSummaryMetricPoint(point)) {
      return point.id === summaryPoint.id;
    }

    if (point.source.family !== "event" || point.source.kind !== "observation") {
      return true;
    }

    return !metricPointContributedToSummary(point, summaryPoint);
  });
}

function isWearableSummaryMetricPoint(point: MetricPoint): boolean {
  return point.source.family === "derived"
    && WEARABLE_SUMMARY_METRIC_PRIORITIES.has(summaryMetricPriorityKey(point));
}

// Suppression is by contribution: every record the resolver considered
// (winning AND losing candidates) is suppressed in favor of the resolved
// summary point, while manual/independent same-day entries — never
// candidates — survive as provenance-distinct facts (hiding them would
// violate the capture posture).
function metricPointContributedToSummary(point: MetricPoint, summaryPoint: MetricPoint): boolean {
  const contributingRecordIds = summaryPoint.context.contributingRecordIds;
  return Array.isArray(contributingRecordIds) && contributingRecordIds.includes(point.source.recordId);
}

function metricPointDayKey(point: MetricPoint): string {
  return `${point.metricKey}\0${point.effectiveDate}`;
}

function compareWearableSummaryMetricPriority(left: MetricPoint, right: MetricPoint): number {
  const leftPriority = WEARABLE_SUMMARY_METRIC_PRIORITIES.get(summaryMetricPriorityKey(left)) ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = WEARABLE_SUMMARY_METRIC_PRIORITIES.get(summaryMetricPriorityKey(right)) ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.id.localeCompare(right.id);
}

function summaryMetricPriorityKey(point: MetricPoint): string {
  return `${point.metricKey}\0${point.source.kind}`;
}

function buildWearableSummaryMetricPriorities(): Map<string, number> {
  const priorities = new Map<string, number>();

  for (const entry of SUMMARY_METRIC_EVIDENCE_ENTRIES) {
    const key = `${resolveMetricInputKey(entry.metricKey)}\0${entry.sourceKind}`;
    if (!priorities.has(key)) {
      priorities.set(key, priorities.size);
    }
  }

  return priorities;
}

function metricEvidence(
  date: string,
  metricKey: string,
  resolved: WearableResolvedMetric,
  confidence: WearableConfidenceLevel,
  sourceKind: MetricRowEvidence["sourceKind"],
): MetricRowEvidence {
  const selection = resolved.selection;
  const sourceCandidate = selectWearableSourceCandidate(resolved);
  const provider = selection.provider ?? sourceCandidate?.provider ?? null;
  const rawRefs = uniqueStrings([
    ...selection.paths,
    ...(sourceCandidate?.paths ?? []),
  ]);
  const syntheticRecordId = `${sourceKind}:${metricKey}:${date}`;
  // Every candidate the resolver considered counts as contributing — the
  // summary point is the resolved answer for ALL of them, so losing
  // multi-provider candidates suppress alongside the winner. (Candidates
  // are populated here because evidence is built from the in-memory bundle
  // at rebuild time; the stored codec strips them only on the read path.)
  // Manual/independent entries are never candidates and survive.
  const contributingRecordIds = uniqueStrings([
    ...selection.recordIds,
    ...(sourceCandidate?.recordIds ?? []),
    ...resolved.candidates.flatMap((candidate) => candidate.recordIds),
  ]);
  const recordIds = contributingRecordIds.length > 0 ? contributingRecordIds : [syntheticRecordId];

  return {
    confidence: resolved.confidence.level === "none" ? confidence : resolved.confidence.level,
    context: {
      candidateCount: resolved.confidence.candidateCount,
      conflictingProviders: resolved.confidence.conflictingProviders,
      contributingRecordIds,
      exactDuplicateCount: resolved.confidence.exactDuplicateCount,
      recordedAt: selection.recordedAt,
      sourceFamily: selection.sourceFamily ?? sourceCandidate?.sourceFamily ?? null,
      sourceKind: selection.sourceKind ?? sourceCandidate?.sourceKind ?? null,
      syntheticRecordId,
    },
    dataOrigin: sourceCandidate?.dataOrigin ?? null,
    date,
    externalRef: sourceCandidate?.externalRef ?? null,
    metricKey,
    provider,
    rawRefs,
    recordIds,
    sourceFamily: "derived",
    sourceKind,
    sourceLabel: provider ? formatProviderName(provider) : sourceCandidate?.title ?? "Wearable summary",
    unit: selection.unit ?? sourceCandidate?.unit ?? null,
    value: selection.value,
  };
}

function selectWearableSourceCandidate(resolved: WearableResolvedMetric): WearableResolvedMetric["candidates"][number] | null {
  const selectedRecordIds = new Set(resolved.selection.recordIds);
  return resolved.candidates.find((candidate) =>
    candidate.provider === resolved.selection.provider
      && candidate.recordIds.some((recordId) => selectedRecordIds.has(recordId))
  )
    ?? resolved.candidates.find((candidate) => candidate.provider === resolved.selection.provider)
    ?? resolved.candidates[0]
    ?? null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
