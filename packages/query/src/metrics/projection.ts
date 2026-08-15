import { resolveMetricInputKey } from "@murphai/health-metrics";

import type { VaultReadModel } from "../read-model.ts";
import { summarizeDailySamples, type DailySampleSummary } from "../summaries.ts";
import {
  buildWearableSummaryBundle,
  buildWearableSummaryBundleFromDataset,
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
import { collectWearableDataset } from "../wearables/candidates.ts";
import { resolveWearablePublicSourceProvider } from "../wearables/origin.ts";
import type { WearableDataset, WearableMetricSuppressionEvidence } from "../wearables/types.ts";
import { formatProviderName } from "../wearables/provider-policy.ts";
import {
  extractMetricPoints,
  type MetricPoint,
  type MetricRowEvidence,
} from "./index.ts";

const METRIC_PROJECTION_LIMIT = 365;
const HEART_RATE_ZONE_MAX_DAILY_MINUTES = 24 * 60;

export interface MetricProjection {
  dailySampleSummaries: DailySampleSummary[];
  metricPoints: MetricPoint[];
  wearableMetricRows: MetricRowEvidence[];
}

export interface BuildMetricProjectionOptions {
  wearableDataset?: WearableDataset;
}

interface WearableMetricProjectionEvidence {
  rows: MetricRowEvidence[];
  suppressionEvidence: WearableMetricSuppressionEvidence[];
}

interface WearableMetricEvidenceResult {
  row: MetricRowEvidence;
  suppressionEvidence: WearableMetricSuppressionEvidence;
}

export function buildMetricProjection(
  vault: VaultReadModel,
  options: BuildMetricProjectionOptions = {},
): MetricProjection {
  const dailySampleSummaries = summarizeDailySamples(vault);
  const wearableMetricEvidence = resolveWearableMetricProjectionEvidence(vault, options);
  const wearableMetricRows = wearableMetricEvidence.rows;
  const metricPoints = extractMetricPoints({
    metricRows: wearableMetricRows,
    sampleSummaries: dailySampleSummaries,
    vault,
  });
  return {
    dailySampleSummaries,
    metricPoints: applyWearableSummaryMetricPrecedence(metricPoints, wearableMetricEvidence.suppressionEvidence),
    wearableMetricRows,
  };
}

export function buildWearableMetricEvidence(vault: VaultReadModel): MetricRowEvidence[] {
  return buildWearableMetricProjectionEvidenceFromBundle(buildWearableSummaryBundle(vault)).rows;
}

export function buildWearableMetricEvidenceFromBundle(bundle: WearableSummaryBundle): MetricRowEvidence[] {
  return buildWearableMetricProjectionEvidenceFromBundle(bundle).rows;
}

function resolveWearableMetricProjectionEvidence(
  vault: VaultReadModel,
  options: BuildMetricProjectionOptions,
): WearableMetricProjectionEvidence {
  const dataset = options.wearableDataset ?? collectWearableDataset(vault, {});
  return buildWearableMetricProjectionEvidenceFromBundle(
    buildWearableSummaryBundleFromDataset(dataset),
    dataset.metricSuppressionEvidence,
  );
}

function buildWearableMetricProjectionEvidenceFromBundle(
  bundle: WearableSummaryBundle,
  additionalSuppressionEvidence: readonly WearableMetricSuppressionEvidence[] = [],
): WearableMetricProjectionEvidence {
  const sleepSummaries = summarizeWearableSleepFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });
  const recoverySummaries = summarizeWearableRecoveryFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });
  const activitySummaries = summarizeWearableActivityFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });
  const bodyStateSummaries = summarizeWearableBodyStateFromBundle(bundle, { limit: METRIC_PROJECTION_LIMIT });

  const evidence = [
    ...sleepSummaries.flatMap((summary) => summaryMetricEvidence(summary, SLEEP_METRIC_EVIDENCE)),
    ...recoverySummaries.flatMap((summary) => summaryMetricEvidence(summary, RECOVERY_METRIC_EVIDENCE)),
    ...activitySummaries.flatMap((summary) => [
      ...summaryMetricEvidence(summary, ACTIVITY_METRIC_EVIDENCE),
      ...heartRateZoneMetricEvidence(summary),
    ]),
    ...bodyStateSummaries.flatMap((summary) => summaryMetricEvidence(summary, BODY_STATE_METRIC_EVIDENCE)),
  ];

  return {
    rows: evidence.map((entry) => entry.row),
    suppressionEvidence: [
      ...evidence.map((entry) => entry.suppressionEvidence),
      ...additionalSuppressionEvidence,
    ],
  };
}

type WearableSummaryBase = {
  date: string;
  summaryConfidence: {
    level: WearableConfidenceLevel;
  };
  timeZone?: string | null;
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
  { metricKey: "spo2", summaryField: "spo2", sourceKind: "sleep-summary" },
  { metricKey: "lowest-spo2", summaryField: "lowestSpo2", sourceKind: "sleep-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableSleepSummary>>[];

const RECOVERY_METRIC_EVIDENCE = [
  { metricKey: "readiness-score", summaryField: "readinessScore", sourceKind: "wearable-summary" },
  { metricKey: "resting-heart-rate", summaryField: "restingHeartRate", sourceKind: "wearable-summary" },
  // Recovery is the sole daily MetricPoint owner; sleep retains HRV in its
  // presentation summary without projecting a duplicate point.
  { metricKey: "hrv-rmssd", summaryField: "hrv", sourceKind: "wearable-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableRecoverySummary>>[];

const ACTIVITY_METRIC_EVIDENCE = [
  { metricKey: "steps", summaryField: "steps", sourceKind: "activity-summary" },
  { metricKey: "activity-minutes", summaryField: "activityMinutes", sourceKind: "activity-summary" },
  { metricKey: "low-activity-minutes", summaryField: "lowActivityMinutes", sourceKind: "activity-summary" },
  { metricKey: "medium-activity-minutes", summaryField: "mediumActivityMinutes", sourceKind: "activity-summary" },
  { metricKey: "high-activity-minutes", summaryField: "highActivityMinutes", sourceKind: "activity-summary" },
  { metricKey: "workout-minutes", summaryField: "sessionMinutes", sourceKind: "activity-summary" },
  { metricKey: "workout-count", summaryField: "sessionCount", sourceKind: "activity-summary" },
  { metricKey: "active-calories", summaryField: "activeCalories", sourceKind: "activity-summary" },
  { metricKey: "activity-score", summaryField: "activityScore", sourceKind: "activity-summary" },
  { metricKey: "activity-average-heart-rate", summaryField: "activityAverageHeartRate", sourceKind: "activity-summary" },
  { metricKey: "walking-average-heart-rate", summaryField: "walkingAverageHeartRate", sourceKind: "activity-summary" },
  { metricKey: "minimum-heart-rate", summaryField: "minimumHeartRate", sourceKind: "activity-summary" },
  { metricKey: "low-activity-minutes", summaryField: "lowActivityMinutes", sourceKind: "activity-summary" },
  { metricKey: "medium-activity-minutes", summaryField: "mediumActivityMinutes", sourceKind: "activity-summary" },
  { metricKey: "high-activity-minutes", summaryField: "highActivityMinutes", sourceKind: "activity-summary" },
  { metricKey: "day-strain", summaryField: "dayStrain", sourceKind: "activity-summary" },
  { metricKey: "distance-km", summaryField: "distanceKm", sourceKind: "activity-summary" },
  { metricKey: "elevation-gain-meters", summaryField: "totalElevationGainMeters", sourceKind: "activity-summary" },
  { metricKey: "estimated-vo2-max", summaryField: "estimatedVo2Max", sourceKind: "activity-summary" },
  { metricKey: "floors-climbed", summaryField: "floorsClimbed", sourceKind: "activity-summary" },
  { metricKey: "average-heart-rate", summaryField: "averageHeartRate", sourceKind: "activity-summary" },
  { metricKey: "walking-average-heart-rate", summaryField: "walkingAverageHeartRate", sourceKind: "activity-summary" },
  { metricKey: "lowest-heart-rate", summaryField: "lowestHeartRate", sourceKind: "activity-summary" },
  { metricKey: "max-heart-rate", summaryField: "maxHeartRate", sourceKind: "activity-summary" },
  { metricKey: "workout-strain", summaryField: "workoutStrain", sourceKind: "activity-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableActivitySummary>>[];

const BODY_STATE_METRIC_EVIDENCE = [
  { metricKey: "body-weight", summaryField: "weightKg", sourceKind: "wearable-summary" },
  { metricKey: "body-fat-percentage", summaryField: "bodyFatPercentage", sourceKind: "wearable-summary" },
  { metricKey: "body-water-percentage", summaryField: "bodyWaterPercentage", sourceKind: "wearable-summary" },
  { metricKey: "bone-mass-percentage", summaryField: "boneMassPercentage", sourceKind: "wearable-summary" },
  { metricKey: "muscle-mass-percentage", summaryField: "muscleMassPercentage", sourceKind: "wearable-summary" },
  { metricKey: "visceral-fat-index", summaryField: "visceralFatIndex", sourceKind: "wearable-summary" },
] as const satisfies readonly SummaryMetricEvidenceEntry<WearableResolvedMetricField<WearableBodyStateSummary>>[];

const SUMMARY_METRIC_EVIDENCE_ENTRIES = [
  ...SLEEP_METRIC_EVIDENCE,
  ...RECOVERY_METRIC_EVIDENCE,
  ...ACTIVITY_METRIC_EVIDENCE,
  ...BODY_STATE_METRIC_EVIDENCE,
];

export function listWearableSummaryMetricEvidenceKeys(): string[] {
  return uniqueStrings(
    SUMMARY_METRIC_EVIDENCE_ENTRIES.map((entry) => resolveMetricInputKey(entry.metricKey)),
  ).sort();
}

function summaryMetricEvidence<TField extends string>(
  summary: WearableSummaryBase & Record<TField, WearableResolvedMetric>,
  entries: readonly SummaryMetricEvidenceEntry<TField>[],
): WearableMetricEvidenceResult[] {
  return entries.map((entry) =>
    metricEvidence(
      summary.date,
      entry.metricKey,
      summary[entry.summaryField],
      summary.summaryConfidence.level,
      entry.sourceKind,
      summary.timeZone,
    )
  );
}

function heartRateZoneMetricEvidence(summary: WearableActivitySummary): WearableMetricEvidenceResult[] {
  return summary.heartRateZones.flatMap((zone) => {
    if (
      typeof zone.zone !== "number"
      || !Number.isInteger(zone.zone)
      || zone.zone < 0
      || zone.zone > 20
      || typeof zone.durationMinutes !== "number"
      || !Number.isFinite(zone.durationMinutes)
      || zone.durationMinutes < 0
      || zone.durationMinutes > HEART_RATE_ZONE_MAX_DAILY_MINUTES
    ) {
      return [];
    }

    const metricKey = `heart-rate-zone-${zone.zone}-minutes`;
    const sourceMetric = summary.sessionMinutes;
    const selection = sourceMetric.selection;
    const sourceCandidate = selectWearableSourceCandidate(sourceMetric);
    const provider = selection.provider ?? sourceCandidate?.provider ?? null;
    const publicProvider = sourceCandidate
      ? resolveWearablePublicSourceProvider(sourceCandidate, {
          suppressJunctionSourceInstanceFallback: true,
        })
      : provider
        ? resolveWearablePublicSourceProvider({ provider })
        : null;
    const rawRefs = uniqueStrings([
      ...selection.paths,
      ...(sourceCandidate?.paths ?? []),
    ]);
    const syntheticRecordId = `activity-summary:${metricKey}:${summary.date}`;
    const contributingRecordIds = uniqueStrings([
      ...selection.recordIds,
      ...(sourceCandidate?.recordIds ?? []),
    ]);
    const recordIds = contributingRecordIds.length > 0 ? contributingRecordIds : [syntheticRecordId];
    const suppressionRecordIds = uniqueStrings([
      ...contributingRecordIds,
      ...sourceMetric.candidates.flatMap((candidate) => candidate.recordIds),
    ]);
    const zoneLabel = sanitizeContextText(zone.label);

    return [{
      row: {
        confidence: sourceMetric.confidence.level === "none"
          ? summary.summaryConfidence.level
          : sourceMetric.confidence.level,
        context: {
          candidateCount: sourceMetric.confidence.candidateCount,
          conflictingProviders: sourceMetric.confidence.conflictingProviders,
          contributingRecordIds,
          exactDuplicateCount: sourceMetric.confidence.exactDuplicateCount,
          recordedAt: selection.recordedAt,
          sourceFamily: selection.sourceFamily ?? sourceCandidate?.sourceFamily ?? null,
          sourceKind: selection.sourceKind ?? sourceCandidate?.sourceKind ?? null,
          syntheticRecordId,
          ...(zoneLabel === null ? {} : { zoneLabel }),
          zone: zone.zone,
        },
        dataOrigin: sourceCandidate?.dataOrigin ?? null,
        date: summary.date,
        externalRef: sourceCandidate?.externalRef ?? null,
        metricKey,
        provider,
        rawRefs,
        recordIds,
        sourceFamily: "derived",
        sourceKind: "activity-summary",
        sourceLabel: publicProvider
          ? formatProviderName(publicProvider)
          : sourceCandidate?.title ?? "Wearable summary",
        unit: "minutes",
        value: zone.durationMinutes,
      },
      suppressionEvidence: {
        date: summary.date,
        metricKey,
        recordIds: suppressionRecordIds,
      },
    }];
  });
}

function applyWearableSummaryMetricPrecedence(
  points: readonly MetricPoint[],
  suppressionEvidence: readonly WearableMetricSuppressionEvidence[],
): MetricPoint[] {
  const suppressionIdsByDay = new Map<string, Set<string>>();

  for (const evidence of suppressionEvidence) {
    const dayKey = metricDayKey(resolveMetricInputKey(evidence.metricKey), evidence.date);
    const recordIds = suppressionIdsByDay.get(dayKey) ?? new Set<string>();
    for (const recordId of evidence.recordIds) {
      if (typeof recordId === "string") {
        recordIds.add(recordId);
      }
    }
    suppressionIdsByDay.set(dayKey, recordIds);
  }

  return points.filter((point) => {
    if (point.source.family !== "event" || point.source.kind !== "observation") {
      return true;
    }

    // Suppression uses resolver-candidate IDs, not public provenance IDs.
    // Losing provider candidates can suppress their raw observation point
    // without making the selected summary value advertise that losing
    // record as part of its provenance.
    return !suppressionIdsByDay.get(metricPointDayKey(point))?.has(point.source.recordId);
  });
}

function metricPointDayKey(point: MetricPoint): string {
  return metricDayKey(point.metricKey, point.effectiveDate);
}

function metricDayKey(metricKey: string, date: string): string {
  return `${metricKey}\0${date.slice(0, 10)}`;
}

function metricEvidence(
  date: string,
  metricKey: string,
  resolved: WearableResolvedMetric,
  confidence: WearableConfidenceLevel,
  sourceKind: MetricRowEvidence["sourceKind"],
  timeZone: string | null | undefined,
): WearableMetricEvidenceResult {
  const selection = resolved.selection;
  const sourceCandidate = selectWearableSourceCandidate(resolved);
  const provider = selection.provider ?? sourceCandidate?.provider ?? null;
  const publicProvider = sourceCandidate
    ? resolveWearablePublicSourceProvider(sourceCandidate, {
        suppressJunctionSourceInstanceFallback: true,
      })
    : provider
      ? resolveWearablePublicSourceProvider({ provider })
      : null;
  const rawRefs = uniqueStrings([
    ...selection.paths,
    ...(sourceCandidate?.paths ?? []),
  ]);
  const syntheticRecordId = `${sourceKind}:${metricKey}:${date}`;
  // Public provenance stays limited to the selected/source record IDs.
  // Suppression has its own internal ID list below so losing candidates can
  // suppress raw duplicates without corrupting anchored experiment evidence.
  const contributingRecordIds = uniqueStrings([
    ...selection.recordIds,
    ...(sourceCandidate?.recordIds ?? []),
  ]);
  const recordIds = contributingRecordIds.length > 0 ? contributingRecordIds : [syntheticRecordId];
  const suppressionRecordIds = uniqueStrings([
    ...contributingRecordIds,
    ...resolved.candidates.flatMap((candidate) => candidate.recordIds),
  ]);

  return {
    row: {
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
        timeZone: timeZone ?? undefined,
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
      sourceLabel: publicProvider
        ? formatProviderName(publicProvider)
        : sourceCandidate?.title ?? "Wearable summary",
      unit: selection.unit ?? sourceCandidate?.unit ?? null,
      value: selection.value,
    },
    suppressionEvidence: {
      date,
      metricKey,
      recordIds: suppressionRecordIds,
    },
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

function sanitizeContextText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(trimmed)
    ? trimmed
    : null;
}
