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
  return {
    dailySampleSummaries,
    metricPoints: extractMetricPoints({
      metricRows: wearableMetricRows,
      sampleSummaries: dailySampleSummaries,
      vault,
    }),
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
    ...sleepSummaries.flatMap(sleepMetricEvidence),
    ...recoverySummaries.flatMap(recoveryMetricEvidence),
    ...activitySummaries.flatMap(activityMetricEvidence),
    ...bodyStateSummaries.flatMap(bodyStateMetricEvidence),
  ];
}

function sleepMetricEvidence(summary: WearableSleepSummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "total-sleep-minutes", summary.totalSleepMinutes, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "sleep-score", summary.sleepScore, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "deep-sleep-minutes", summary.deepMinutes, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "rem-sleep-minutes", summary.remMinutes, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "hrv-rmssd", summary.hrv, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "spo2", summary.spo2, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "lowest-spo2", summary.lowestSpo2, summary.summaryConfidence.level, "sleep-summary"),
  ];
}

function recoveryMetricEvidence(summary: WearableRecoverySummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "readiness-score", summary.readinessScore, summary.summaryConfidence.level, "wearable-summary"),
    metricEvidence(summary.date, "resting-heart-rate", summary.restingHeartRate, summary.summaryConfidence.level, "wearable-summary"),
    metricEvidence(summary.date, "hrv-rmssd", summary.hrv, summary.summaryConfidence.level, "wearable-summary"),
  ];
}

function activityMetricEvidence(summary: WearableActivitySummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "steps", summary.steps, summary.summaryConfidence.level, "activity-summary"),
    metricEvidence(summary.date, "activity-minutes", summary.sessionMinutes, summary.summaryConfidence.level, "activity-summary"),
    metricEvidence(summary.date, "estimated-vo2-max", summary.estimatedVo2Max, summary.summaryConfidence.level, "activity-summary"),
  ];
}

function bodyStateMetricEvidence(summary: WearableBodyStateSummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "body-weight", summary.weightKg, summary.summaryConfidence.level, "wearable-summary"),
    metricEvidence(summary.date, "body-fat-percentage", summary.bodyFatPercentage, summary.summaryConfidence.level, "wearable-summary"),
  ];
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
  const contributingRecordIds = uniqueStrings([
    ...selection.recordIds,
    ...(sourceCandidate?.recordIds ?? []),
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
