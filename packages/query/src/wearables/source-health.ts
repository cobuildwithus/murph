import { collectLatestDate, collectSortedDatesDesc, daysBetweenIsoDates, latestIsoTimestamp, uniqueStrings } from "./shared.ts";
import { formatProviderName } from "./provider-policy.ts";
import { buildActivitySessionMetricCandidate, buildSleepWindowMetricCandidate } from "./candidates.ts";
import { buildCandidateExactKey } from "./dedupe.ts";
import type {
  WearableActivityDay,
  WearableBodyStateDay,
  WearableDataset,
  WearableMetricCandidate,
  WearableMetricKey,
  WearableRecoveryDay,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSourceHealth,
} from "./types.ts";
import {
  ACTIVITY_METRIC_KEYS,
  BODY_METRIC_KEYS,
  RECOVERY_METRIC_KEYS,
  SLEEP_METRIC_KEYS,
} from "./types.ts";

export function buildWearableSourceHealth(input: {
  activityDays: readonly WearableActivityDay[];
  bodyStateDays: readonly WearableBodyStateDay[];
  dataset: WearableDataset;
  recoveryDays: readonly WearableRecoveryDay[];
  sleepNights: readonly WearableSleepNight[];
}): WearableSourceHealth[] {
  const providers = uniqueStrings([
    ...input.dataset.metricCandidates.map((candidate) => candidate.provider),
    ...input.dataset.activitySessionAggregates.map((candidate) => candidate.provider),
    ...input.dataset.sleepWindows.map((candidate) => candidate.provider),
  ]);

  const latestDate = collectLatestDate([
    ...input.dataset.metricCandidates.map((candidate) => candidate.date),
    ...input.dataset.activitySessionAggregates.map((candidate) => candidate.date),
    ...input.dataset.sleepWindows.map((candidate) => candidate.date),
  ]);

  const duplicateCountsByProvider = countExactDuplicatesByProvider([
    ...input.dataset.rawMetricCandidates,
    ...input.dataset.activitySessionAggregates.flatMap((aggregate) => [
      buildActivitySessionMetricCandidate(aggregate, "sessionMinutes"),
      buildActivitySessionMetricCandidate(aggregate, "sessionCount"),
    ]),
    ...input.dataset.sleepWindows.map((window) => buildSleepWindowMetricCandidate(window)),
  ]);

  const selectedMetricsByProvider = countSelectedMetricsByProvider([
    ...input.activityDays.flatMap((day) => [
      day.steps,
      day.activeCalories,
      day.distanceKm,
      day.activityScore,
      day.dayStrain,
      day.sessionMinutes,
      day.sessionCount,
    ]),
    ...input.sleepNights.flatMap((night) => [
      night.sessionMinutes,
      night.totalSleepMinutes,
      night.timeInBedMinutes,
      night.sleepEfficiency,
      night.awakeMinutes,
      night.lightMinutes,
      night.deepMinutes,
      night.remMinutes,
      night.sleepScore,
      night.sleepPerformance,
      night.sleepConsistency,
      night.averageHeartRate,
      night.lowestHeartRate,
      night.hrv,
      night.respiratoryRate,
      night.spo2,
    ]),
    ...input.recoveryDays.flatMap((day) => [
      day.recoveryScore,
      day.readinessScore,
      day.restingHeartRate,
      day.hrv,
      day.respiratoryRate,
      day.spo2,
      day.temperatureDeviation,
      day.temperature,
      day.bodyBattery,
      day.stressLevel,
    ]),
    ...input.bodyStateDays.flatMap((day) => [
      day.weightKg,
      day.bodyFatPercentage,
      day.bmi,
      day.temperature,
    ]),
  ]);

  const conflictCountsByProvider = countConflictsByProvider([
    ...input.activityDays.flatMap((day) => [
      day.steps,
      day.activeCalories,
      day.distanceKm,
      day.activityScore,
      day.dayStrain,
      day.sessionMinutes,
      day.sessionCount,
    ]),
    ...input.sleepNights.flatMap((night) => [
      night.sessionMinutes,
      night.totalSleepMinutes,
      night.timeInBedMinutes,
      night.sleepEfficiency,
      night.awakeMinutes,
      night.lightMinutes,
      night.deepMinutes,
      night.remMinutes,
      night.sleepScore,
      night.sleepPerformance,
      night.sleepConsistency,
      night.averageHeartRate,
      night.lowestHeartRate,
      night.hrv,
      night.respiratoryRate,
      night.spo2,
    ]),
    ...input.recoveryDays.flatMap((day) => [
      day.recoveryScore,
      day.readinessScore,
      day.restingHeartRate,
      day.hrv,
      day.respiratoryRate,
      day.spo2,
      day.temperatureDeviation,
      day.temperature,
      day.bodyBattery,
      day.stressLevel,
    ]),
    ...input.bodyStateDays.flatMap((day) => [
      day.weightKg,
      day.bodyFatPercentage,
      day.bmi,
      day.temperature,
    ]),
  ]);

  const includedProvenanceDiagnostics = input.dataset.provenanceDiagnostics.filter((diagnostic) => diagnostic.kind === "included");
  const excludedProvenanceDiagnostics = input.dataset.provenanceDiagnostics.filter((diagnostic) => diagnostic.kind === "excluded");

  const rows = providers
    .map((provider) => {
      const providerMetricCandidates = input.dataset.metricCandidates.filter((candidate) => candidate.provider === provider);
      const providerActivitySessionAggregates = input.dataset.activitySessionAggregates.filter(
        (candidate) => candidate.provider === provider,
      );
      const providerSleepWindows = input.dataset.sleepWindows.filter((candidate) => candidate.provider === provider);
      const providerDates = collectSortedDatesDesc([
        ...providerMetricCandidates.map((candidate) => candidate.date),
        ...providerActivitySessionAggregates.map((candidate) => candidate.date),
        ...providerSleepWindows.map((candidate) => candidate.date),
      ]);
      const activityMetricDays = new Set<string>();
      const sleepMetricDays = new Set<string>();
      const recoveryMetricDays = new Set<string>();
      const bodyMetricDays = new Set<string>();

      for (const candidate of providerMetricCandidates) {
        const metric = candidate.metric as WearableMetricKey;
        if (ACTIVITY_METRIC_KEYS.has(metric)) {
          activityMetricDays.add(candidate.date);
        }
        if (SLEEP_METRIC_KEYS.has(metric)) {
          sleepMetricDays.add(candidate.date);
        }
        if (RECOVERY_METRIC_KEYS.has(metric)) {
          recoveryMetricDays.add(candidate.date);
        }
        if (BODY_METRIC_KEYS.has(metric)) {
          bodyMetricDays.add(candidate.date);
        }
      }

      for (const aggregate of providerActivitySessionAggregates) {
        activityMetricDays.add(aggregate.date);
      }

      for (const window of providerSleepWindows) {
        sleepMetricDays.add(window.date);
      }

      const stalenessVsNewestDays = latestDate && providerDates[0]
        ? daysBetweenIsoDates(providerDates[0], latestDate)
        : null;
      const notes: string[] = [];

      if (stalenessVsNewestDays !== null && stalenessVsNewestDays > 0) {
        notes.push(
          `${formatProviderName(provider)} trails the newest wearable source by ${stalenessVsNewestDays} day${stalenessVsNewestDays === 1 ? "" : "s"}.`,
        );
      }

      if ((selectedMetricsByProvider.get(provider) ?? 0) === 0) {
        notes.push(
          `${formatProviderName(provider)} contributed candidate evidence but was not the preferred source for any selected metric in this filtered range.`,
        );
      }

      const providerIncludedDiagnostics = includedProvenanceDiagnostics.filter((diagnostic) => diagnostic.provider === provider);
      notes.push(...providerIncludedDiagnostics.map((diagnostic) => formatIncludedWearableProvenanceNote(provider, diagnostic)));

      const metricsContributed = uniqueStrings([
        ...providerMetricCandidates.map((candidate) => candidate.metric),
        ...(providerActivitySessionAggregates.length > 0 ? ["sessionCount", "sessionMinutes"] : []),
        ...(providerSleepWindows.length > 0 ? ["sessionMinutes", "timeInBedMinutes", "totalSleepMinutes"] : []),
      ]).sort();

      return {
        activityDays: activityMetricDays.size,
        bodyStateDays: bodyMetricDays.size,
        candidateMetrics:
          providerMetricCandidates.length + providerActivitySessionAggregates.length + providerSleepWindows.length,
        conflictCount: conflictCountsByProvider.get(provider) ?? 0,
        exactDuplicatesSuppressed: duplicateCountsByProvider.get(provider) ?? 0,
        firstDate: providerDates.at(-1) ?? null,
        lastDate: providerDates[0] ?? null,
        latestRecordedAt: latestIsoTimestamp([
          ...providerMetricCandidates.map((candidate) => candidate.recordedAt),
          ...providerActivitySessionAggregates.map((candidate) => candidate.recordedAt),
          ...providerSleepWindows.map((candidate) => candidate.recordedAt),
        ]),
        metricsContributed,
        notes,
        provider,
        providerDisplayName: formatProviderName(provider),
        recoveryDays: recoveryMetricDays.size,
        selectedMetrics: selectedMetricsByProvider.get(provider) ?? 0,
        sleepNights: sleepMetricDays.size,
        stalenessVsNewestDays,
      } satisfies WearableSourceHealth;
    })
    .sort(compareSourceHealth);

  if (excludedProvenanceDiagnostics.length === 0) {
    return rows;
  }

  const excludedDates = collectSortedDatesDesc(excludedProvenanceDiagnostics.flatMap((diagnostic) => diagnostic.dates));

  rows.push({
    activityDays: 0,
    bodyStateDays: 0,
    candidateMetrics: excludedProvenanceDiagnostics.reduce((total, diagnostic) => total + diagnostic.count, 0),
    conflictCount: 0,
    exactDuplicatesSuppressed: 0,
    firstDate: excludedDates.at(-1) ?? null,
    lastDate: excludedDates[0] ?? null,
    latestRecordedAt: latestIsoTimestamp(excludedProvenanceDiagnostics.map((diagnostic) => diagnostic.latestRecordedAt)),
    metricsContributed: [],
    notes: [formatExcludedWearableProvenanceNote(excludedProvenanceDiagnostics)],
    provider: "unknown",
    providerDisplayName: formatProviderName("unknown"),
    recoveryDays: 0,
    selectedMetrics: 0,
    sleepNights: 0,
    stalenessVsNewestDays: null,
  });

  return rows.sort(compareSourceHealth);
}

function formatIncludedWearableProvenanceNote(
  provider: string,
  diagnostic: WearableDataset["provenanceDiagnostics"][number],
): string {
  return `Included ${diagnostic.count} ${formatProviderName(provider)} record${diagnostic.count === 1 ? "" : "s"} with incomplete provenance (missing ${formatWearableProvenanceFields(diagnostic.missingFields)}).`;
}

function formatExcludedWearableProvenanceNote(
  diagnostics: readonly WearableDataset["provenanceDiagnostics"][number][],
): string {
  const count = diagnostics.reduce((total, diagnostic) => total + diagnostic.count, 0);
  const missingFields = uniqueStrings(diagnostics.flatMap((diagnostic) => diagnostic.missingFields)).sort();

  return `Excluded ${count} wearable record${count === 1 ? "" : "s"} from semantic wearables because provenance was incomplete and no provider could be derived from externalRef.system (missing ${formatWearableProvenanceFields(missingFields)}).`;
}

function formatWearableProvenanceFields(
  fields: readonly string[],
): string {
  return fields.join(", ");
}

function countExactDuplicatesByProvider(
  candidates: readonly WearableMetricCandidate[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Map<string, string>();

  for (const candidate of candidates) {
    const exactKey = buildCandidateExactKey(candidate);
    const existingProvider = seen.get(exactKey);
    if (!existingProvider) {
      seen.set(exactKey, candidate.provider);
      continue;
    }

    counts.set(existingProvider, (counts.get(existingProvider) ?? 0) + 1);
  }

  return counts;
}

function countSelectedMetricsByProvider(
  metrics: readonly WearableResolvedMetric[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const metric of metrics) {
    const provider = metric.selection.provider;
    if (!provider) {
      continue;
    }

    counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }

  return counts;
}

function countConflictsByProvider(
  metrics: readonly WearableResolvedMetric[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const metric of metrics) {
    const selectedProvider = metric.selection.provider;
    if (selectedProvider && metric.confidence.conflictingProviders.length > 0) {
      counts.set(selectedProvider, (counts.get(selectedProvider) ?? 0) + 1);
    }

    for (const provider of metric.confidence.conflictingProviders) {
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
  }

  return counts;
}

function compareSourceHealth(
  left: WearableSourceHealth,
  right: WearableSourceHealth,
): number {
  if ((left.lastDate ?? "") !== (right.lastDate ?? "")) {
    return (right.lastDate ?? "").localeCompare(left.lastDate ?? "");
  }

  return left.provider.localeCompare(right.provider);
}
