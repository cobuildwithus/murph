import { extractIsoDatePrefix } from "@murphai/contracts";

import {
  buildWearableSummaryBundleFromDataset,
  type ProjectedWearableActivitySummary,
  type ProjectedWearableBodyStateSummary,
  type ProjectedWearableRecoverySummary,
  type ProjectedWearableSleepSummary,
  type ProjectedWearableSourceHealthSummary,
  type ProjectedWearableSummaryBundle,
  type WearableMetricSummaryFilters,
  type WearableSummaryBundle,
  type WearableSummaryFilters,
} from "../wearables.ts";
import type {
  WearableActivitySessionAggregate,
  WearableCandidateSourceFamily,
  WearableDataset,
  WearableMetricCandidate,
  WearableResolvedMetric,
  WearableSleepWindowCandidate,
  WearableSourceHealthSummary,
} from "../wearables/types.ts";
import { formatProviderName } from "../wearables/provider-policy.ts";
import {
  normalizeWearableProviders,
} from "./provider-scope.ts";
import {
  parseJsonValue,
} from "./schema.ts";
import { projectPublicWearableSummaryBundle } from "./wearable-summary-public-json.ts";
import type {
  QueryWearableSummaryKind,
  QueryWearableSummaryRow,
  QueryWearableSummaryRowSet,
} from "./wearable-summary-store.ts";

export function composePublicWearableSummaryBundleFromStoredRows(
  stored: QueryWearableSummaryRowSet,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): ProjectedWearableSummaryBundle {
  if (stored.providerFilterWasProvided && stored.providers.length === 0) {
    return emptyProjectedWearableSummaryBundle();
  }

  return stored.providers.length === 1
    ? publicWearableSummaryBundleFromRows(stored.rows, filters)
    : composePublicWearableSummaryBundleFromProviderRows(stored.rows, filters);
}

function emptyProjectedWearableSummaryBundle(): ProjectedWearableSummaryBundle {
  return {
    activityDays: [],
    bodyStateDays: [],
    recoveryDays: [],
    sleepNights: [],
    sourceHealth: [],
  };
}

function publicWearableSummaryBundleFromRows(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): ProjectedWearableSummaryBundle {
  const bundle: ProjectedWearableSummaryBundle = {
    activityDays: [],
    bodyStateDays: [],
    recoveryDays: [],
    sleepNights: [],
    sourceHealth: [],
  };

  for (const row of rows) {
    switch (row.summaryKind) {
      case "source_health": {
        const summary = parseJsonValue<ProjectedWearableSourceHealthSummary | null>(row.summaryJson, null);
        if (summary && wearableSourceHealthMatchesDateFilters(summary, filters)) {
          bundle.sourceHealth.push(summary);
        }
        break;
      }
      default: {
        if (!wearableSummaryRowMatchesDateFilters(row.summaryDate, filters)) {
          break;
        }

        switch (row.summaryKind) {
          case "activity": {
            const summary = parseJsonValue<ProjectedWearableActivitySummary | null>(row.summaryJson, null);
            if (summary) bundle.activityDays.push(summary);
            break;
          }
          case "body_state": {
            const summary = parseJsonValue<ProjectedWearableBodyStateSummary | null>(row.summaryJson, null);
            if (summary) bundle.bodyStateDays.push(summary);
            break;
          }
          case "recovery": {
            const summary = parseJsonValue<ProjectedWearableRecoverySummary | null>(row.summaryJson, null);
            if (summary) bundle.recoveryDays.push(summary);
            break;
          }
          case "sleep": {
            const summary = parseJsonValue<ProjectedWearableSleepSummary | null>(row.summaryJson, null);
            if (summary) bundle.sleepNights.push(summary);
            break;
          }
        }
      }
    }
  }

  return bundle;
}

function composePublicWearableSummaryBundleFromProviderRows(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): ProjectedWearableSummaryBundle {
  const providerBundle = publicWearableSummaryBundleFromRows(rows, filters);
  const dataset = wearableDatasetFromProjectedBundle(providerBundle);
  const composed = buildWearableSummaryBundleFromDataset(dataset);

  return projectPublicWearableSummaryBundle(mergeStoredSourceHealthContext(composed, providerBundle.sourceHealth));
}

function mergeStoredSourceHealthContext(
  bundle: WearableSummaryBundle,
  storedSourceHealth: readonly ProjectedWearableSourceHealthSummary[],
): WearableSummaryBundle {
  if (storedSourceHealth.length === 0) {
    return bundle;
  }

  const diagnosticsByProvider = new Map<string, string[]>();
  for (const stored of storedSourceHealth) {
    const diagnosticNotes = stored.notes.filter(isStoredSourceHealthDiagnosticNote);
    if (diagnosticNotes.length === 0) {
      continue;
    }

    diagnosticsByProvider.set(
      stored.provider,
      uniqueStringValues([
        ...(diagnosticsByProvider.get(stored.provider) ?? []),
        ...diagnosticNotes,
      ]),
    );
  }

  const sourceHealth = bundle.sourceHealth.map((summary) => {
    const diagnosticNotes = diagnosticsByProvider.get(summary.provider);
    if (!diagnosticNotes || diagnosticNotes.length === 0) {
      return summary;
    }

    return {
      ...summary,
      notes: uniqueStringValues([...summary.notes, ...diagnosticNotes]),
    };
  });
  const composedProviders = new Set(sourceHealth.map((summary) => summary.provider));

  for (const summary of storedSourceHealth) {
    const diagnosticNotes = diagnosticsByProvider.get(summary.provider);
    if (composedProviders.has(summary.provider)) {
      continue;
    }

    if (!diagnosticNotes && !storedSourceHealthHasCoverageInterval(summary)) {
      continue;
    }

    sourceHealth.push(buildStoredSourceHealthCoverageRow(summary, diagnosticNotes ?? []));
    composedProviders.add(summary.provider);
  }

  return {
    ...bundle,
    sourceHealth: sourceHealth.sort(compareSourceHealthSummaries),
  };
}

function isStoredSourceHealthDiagnosticNote(note: string): boolean {
  return (
    note.startsWith("Included ") && note.includes("incomplete provenance")
  ) || (
    note.startsWith("Excluded ") && note.includes("provenance was incomplete")
  );
}

function storedSourceHealthHasCoverageInterval(summary: ProjectedWearableSourceHealthSummary): boolean {
  return summary.firstDate !== null || summary.lastDate !== null;
}

function buildStoredSourceHealthCoverageRow(
  summary: ProjectedWearableSourceHealthSummary,
  diagnosticNotes: readonly string[],
): WearableSourceHealthSummary {
  const hasDiagnostics = diagnosticNotes.length > 0;

  return {
    activityDays: 0,
    bodyStateDays: 0,
    candidateMetrics: hasDiagnostics ? summary.candidateMetrics : 0,
    conflictCount: 0,
    exactDuplicatesSuppressed: 0,
    firstDate: summary.firstDate,
    lastDate: summary.lastDate,
    latestRecordedAt: hasDiagnostics ? summary.latestRecordedAt : null,
    metricsContributed: [],
    notes: [...diagnosticNotes],
    provider: summary.provider,
    providerDisplayName: formatProviderName(summary.provider),
    recoveryDays: 0,
    selectedMetrics: 0,
    sleepNights: 0,
    stalenessVsNewestDays: null,
  };
}

function uniqueStringValues(values: readonly string[]): string[] {
  const uniqueValues = new Set<string>();

  for (const value of values) {
    if (value.length > 0) {
      uniqueValues.add(value);
    }
  }

  return [...uniqueValues];
}

function compareSourceHealthSummaries(
  left: WearableSourceHealthSummary,
  right: WearableSourceHealthSummary,
): number {
  if ((left.lastDate ?? "") !== (right.lastDate ?? "")) {
    return (right.lastDate ?? "").localeCompare(left.lastDate ?? "");
  }

  return left.provider.localeCompare(right.provider);
}

function wearableDatasetFromProjectedBundle(bundle: ProjectedWearableSummaryBundle): WearableDataset {
  const metricCandidates: WearableMetricCandidate[] = [];
  const activitySessionAggregates: WearableActivitySessionAggregate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];

  for (const summary of bundle.activityDays) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "activity",
      activityResolvedMetrics(summary),
    ));
    const aggregate = projectedActivitySessionAggregate(summary);
    if (aggregate) {
      activitySessionAggregates.push(aggregate);
    }
  }

  for (const summary of bundle.sleepNights) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "sleep",
      sleepResolvedMetrics(summary),
    ));
    const window = projectedSleepWindow(summary);
    if (window) {
      sleepWindows.push(window);
    }
  }

  for (const summary of bundle.recoveryDays) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "recovery",
      recoveryResolvedMetrics(summary),
    ));
  }

  for (const summary of bundle.bodyStateDays) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "body_state",
      bodyStateResolvedMetrics(summary),
    ));
  }

  return {
    activitySessionAggregates,
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows,
  };
}

function projectedMetricCandidatesFromResolvedMetrics(
  date: string,
  summaryKind: Exclude<QueryWearableSummaryKind, "source_health">,
  metrics: readonly WearableResolvedMetric[],
): WearableMetricCandidate[] {
  return metrics
    .map((metric) => projectedMetricCandidateFromResolvedMetric(date, summaryKind, metric))
    .filter((candidate): candidate is WearableMetricCandidate => candidate !== null);
}

function projectedMetricCandidateFromResolvedMetric(
  date: string,
  summaryKind: Exclude<QueryWearableSummaryKind, "source_health">,
  resolved: WearableResolvedMetric,
): WearableMetricCandidate | null {
  const selection = resolved.selection;
  if (
    selection.resolution !== "direct" ||
    selection.value === null ||
    !Number.isFinite(selection.value) ||
    !selection.provider
  ) {
    return null;
  }

  const provider = normalizeWearableProviders([selection.provider])[0];
  if (!provider) {
    return null;
  }

  return {
    candidateId: `projected:${summaryKind}:${provider}:${date}:${resolved.metric}`,
    dataOrigin: null,
    date,
    externalRef: null,
    metric: resolved.metric,
    occurredAt: selection.occurredAt,
    paths: [],
    provider,
    recordedAt: selection.recordedAt,
    recordIds: [],
    sourceFamily: projectedSourceFamily(selection.sourceFamily),
    sourceKind: selection.sourceKind ?? `projected-${summaryKind}`,
    title: selection.title,
    unit: selection.unit,
    value: selection.value,
  };
}

function projectedActivitySessionAggregate(
  summary: ProjectedWearableActivitySummary,
): WearableActivitySessionAggregate | null {
  const sessionMinutes = summary.sessionMinutes.selection.value;
  const sessionCount = summary.sessionCount.selection.value;
  const provider = normalizeWearableProviders([
    summary.sessionMinutes.selection.provider ?? summary.sessionCount.selection.provider ?? "",
  ])[0];

  if (
    !provider ||
    sessionMinutes === null ||
    sessionCount === null ||
    !Number.isFinite(sessionMinutes) ||
    !Number.isFinite(sessionCount)
  ) {
    return null;
  }

  return {
    activityTypes: [...summary.activityTypes],
    candidateId: `projected:activity-session:${provider}:${summary.date}`,
    dataOrigin: null,
    date: summary.date,
    paths: [],
    provider,
    recordedAt: latestNullableIso([
      summary.sessionMinutes.selection.recordedAt,
      summary.sessionCount.selection.recordedAt,
    ]),
    recordIds: [],
    sessionCount,
    sessionMinutes,
    workoutMetricKeys: [],
  };
}

function projectedSleepWindow(summary: ProjectedWearableSleepSummary): WearableSleepWindowCandidate | null {
  const provider = normalizeWearableProviders([
    summary.sleepWindowProvider ?? summary.sessionMinutes.selection.provider ?? "",
  ])[0];
  const durationMinutes = summary.sessionMinutes.selection.value;

  if (
    !provider ||
    summary.sessionMinutes.selection.sourceKind !== "sleep-window" ||
    durationMinutes === null ||
    !Number.isFinite(durationMinutes)
  ) {
    return null;
  }

  return {
    candidateId: `projected:sleep-window:${provider}:${summary.date}`,
    dataOrigin: null,
    date: summary.date,
    durationMinutes,
    endAt: summary.sleepEndAt,
    externalRef: null,
    nap: false,
    occurredAt: summary.sessionMinutes.selection.occurredAt,
    paths: [],
    provider,
    recordedAt: summary.sessionMinutes.selection.recordedAt,
    recordIds: [],
    sourceFamily: "derived",
    sourceKind: "projected-sleep-window",
    startAt: summary.sleepStartAt,
    title: `${provider} sleep summary`,
  };
}

function activityResolvedMetrics(summary: ProjectedWearableActivitySummary): WearableResolvedMetric[] {
  return [
    summary.activityScore,
    summary.activeCalories,
    summary.altitudeChangeMeters,
    summary.dayStrain,
    summary.distanceKm,
    summary.estimatedVo2Max,
    summary.floorsClimbed,
    summary.maxHeartRate,
    summary.percentRecorded,
    summary.sessionCount,
    summary.sessionMinutes,
    summary.steps,
    summary.totalCalories,
    summary.totalElevationGainMeters,
    summary.workoutStrain,
  ];
}

function sleepResolvedMetrics(summary: ProjectedWearableSleepSummary): WearableResolvedMetric[] {
  return [
    summary.averageHeartRate,
    summary.awakeMinutes,
    summary.deepMinutes,
    summary.hrv,
    summary.lightMinutes,
    summary.lowestHeartRate,
    summary.lowestSpo2,
    summary.remMinutes,
    summary.respiratoryRate,
    summary.sessionMinutes,
    summary.sleepConsistency,
    summary.sleepEfficiency,
    summary.sleepPerformance,
    summary.sleepScore,
    summary.spo2,
    summary.timeInBedMinutes,
    summary.totalSleepMinutes,
  ];
}

function recoveryResolvedMetrics(summary: ProjectedWearableRecoverySummary): WearableResolvedMetric[] {
  return [
    summary.bodyBattery,
    summary.hrv,
    summary.readinessScore,
    summary.recoveryScore,
    summary.respiratoryRate,
    summary.restingHeartRate,
    summary.spo2,
    summary.stressLevel,
    summary.temperature,
    summary.temperatureDeviation,
  ];
}

function bodyStateResolvedMetrics(summary: ProjectedWearableBodyStateSummary): WearableResolvedMetric[] {
  return [
    summary.bmi,
    summary.bodyFatPercentage,
    summary.leanBodyMassKg,
    summary.temperature,
    summary.waistCircumference,
    summary.weightKg,
  ];
}

function projectedSourceFamily(sourceFamily: WearableCandidateSourceFamily | null): WearableCandidateSourceFamily {
  return sourceFamily ?? "derived";
}

function latestNullableIso(values: readonly (string | null)[]): string | null {
  return values
    .filter((value): value is string => value !== null && value.length > 0)
    .sort()
    .at(-1) ?? null;
}

function wearableSummaryRowMatchesDateFilters(
  summaryDate: string | null,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): boolean {
  const date = summaryDate ? extractIsoDatePrefix(summaryDate) ?? summaryDate : null;

  if (filters.date) {
    return date === (extractIsoDatePrefix(filters.date) ?? filters.date);
  }

  if (filters.from && date && date < (extractIsoDatePrefix(filters.from) ?? filters.from)) {
    return false;
  }

  if (filters.to && date && date > (extractIsoDatePrefix(filters.to) ?? filters.to)) {
    return false;
  }

  return true;
}

function wearableSourceHealthMatchesDateFilters(
  summary: WearableSourceHealthSummary,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): boolean {
  const firstDate = summary.firstDate;
  const lastDate = summary.lastDate;

  if (filters.date) {
    const date = extractIsoDatePrefix(filters.date) ?? filters.date;
    return firstDate === null || lastDate === null || (firstDate <= date && lastDate >= date);
  }

  if (filters.from) {
    const from = extractIsoDatePrefix(filters.from) ?? filters.from;
    if (lastDate !== null && lastDate < from) {
      return false;
    }
  }

  if (filters.to) {
    const to = extractIsoDatePrefix(filters.to) ?? filters.to;
    if (firstDate !== null && firstDate > to) {
      return false;
    }
  }

  return true;
}
