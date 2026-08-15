import { formatTimeZoneDateTimeParts, isValidIanaTimeZone } from "@murphai/contracts";

import { collectLatestDate, collectSortedDatesDesc, daysBetweenIsoDates, latestIsoTimestamp, uniqueStrings } from "./shared.ts";
import { resolveWearablePublicSourceProvider } from "./origin.ts";
import { formatProviderName } from "./provider-policy.ts";
import { buildActivitySessionMetricCandidate, buildSleepWindowMetricCandidate } from "./candidates.ts";
import { buildCandidateExactKey } from "./dedupe.ts";
import {
  ACTIVITY_SESSION_WORKOUT_METRIC_SPECS,
  BODY_METRIC_KEYS,
  isActivitySummaryMetricCandidate,
  isSleepSummaryMetricCandidate,
  RECOVERY_METRIC_KEYS,
  type WearableActivityDay,
  type WearableActivitySessionAggregate,
  type WearableActivitySessionMetricValues,
  type WearableActivitySessionWorkoutMetricKey,
  type WearableBodyStateDay,
  type WearableDataset,
  type WearableMetricCandidate,
  type WearableMetricKey,
  type WearableRecoveryDay,
  type WearableResolvedMetric,
  type WearableSleepNight,
  type WearableSleepWindowCandidate,
  type WearableSourceHealth,
} from "./types.ts";

const UNAMBIGUOUS_SLEEP_FRESHNESS_METRICS = new Set<WearableMetricKey>([
  "awakeMinutes",
  "deepMinutes",
  "lightMinutes",
  "lowestHeartRate",
  "lowestSpo2",
  "remMinutes",
  "sleepConsistency",
  "sleepEfficiency",
  "sleepLatencyMinutes",
  "sleepPerformance",
  "sleepScore",
  "timeInBedMinutes",
  "totalSleepMinutes",
]);

const PROJECTED_WORKOUT_METRIC_KEYS = ACTIVITY_SESSION_WORKOUT_METRIC_SPECS.map(
  ({ metric }) => metric,
);

export function buildWearableSourceHealth(input: {
  activityDays: readonly WearableActivityDay[];
  bodyStateDays: readonly WearableBodyStateDay[];
  dataset: WearableDataset;
  recoveryDays: readonly WearableRecoveryDay[];
  sleepNights: readonly WearableSleepNight[];
}): WearableSourceHealth[] {
  const providers = uniqueStrings([
    ...input.dataset.metricCandidates.map(resolvePublicSourceProvider),
    ...input.dataset.activitySessionAggregates.map(resolvePublicSourceProvider),
    ...input.dataset.sleepWindows.map(resolvePublicSourceProvider),
  ]);

  const latestDate = collectLatestDate([
    ...input.dataset.metricCandidates.map((candidate) => candidate.date),
    ...input.dataset.activitySessionAggregates.map((candidate) => candidate.date),
    ...input.dataset.sleepWindows.map((candidate) => candidate.date),
  ]);
  // SLEEP_METRIC_KEYS also contains generic HR/HRV/SpO2/respiratory metrics
  // because they can enrich a sleep summary. They are not sleep-freshness
  // evidence unless their own source identity is explicitly sleep-specific.
  const validMainSleepWindows = input.dataset.sleepWindows.filter(isValidNonNapSleepWindow);
  const sleepFreshnessMetricCandidates = input.dataset.metricCandidates.filter(
    isUnambiguousSleepFreshnessMetricCandidate,
  );
  const latestSleepDate = collectLatestDate([
    ...sleepFreshnessMetricCandidates.map((candidate) => candidate.date),
    ...validMainSleepWindows.map(sleepFreshnessWindowDate),
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
      day.activityMinutes,
      day.lowActivityMinutes,
      day.mediumActivityMinutes,
      day.highActivityMinutes,
      day.activeCalories,
      day.totalCalories,
      day.distanceKm,
      day.floorsClimbed,
      day.totalElevationGainMeters,
      day.altitudeChangeMeters,
      day.activityAverageHeartRate,
      day.activityScore,
      day.dayStrain,
      day.estimatedVo2Max,
      day.workoutStrain,
      day.averageHeartRate,
      day.walkingAverageHeartRate,
      day.lowestHeartRate,
      day.maxHeartRate,
      day.walkingAverageHeartRate,
      day.minimumHeartRate,
      day.lowActivityMinutes,
      day.mediumActivityMinutes,
      day.highActivityMinutes,
      day.percentRecorded,
      day.sessionMinutes,
      day.sessionCount,
    ]),
    ...input.sleepNights.flatMap((night) => [
      night.sessionMinutes,
      night.totalSleepMinutes,
      night.timeInBedMinutes,
      night.sleepEfficiency,
      night.sleepLatencyMinutes,
      night.awakeMinutes,
      night.lightMinutes,
      night.deepMinutes,
      night.remMinutes,
      night.sleepScore,
      night.sleepPerformance,
      night.sleepConsistency,
      night.averageHeartRate,
      night.lowestHeartRate,
      night.lowestSpo2,
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
      day.bodyWaterPercentage,
      day.boneMassPercentage,
      day.bmi,
      day.leanBodyMassKg,
      day.muscleMassPercentage,
      day.temperature,
      day.visceralFatIndex,
      day.waistCircumference,
    ]),
  ]);
  attributeSelectedActivityRollupMetricsToContributingProviders(
    input.activityDays,
    input.dataset.activitySessionDayRollups,
    selectedMetricsByProvider,
  );

  const conflictCountsByProvider = countConflictsByProvider([
    ...input.activityDays.flatMap((day) => [
      day.steps,
      day.activityMinutes,
      day.lowActivityMinutes,
      day.mediumActivityMinutes,
      day.highActivityMinutes,
      day.activeCalories,
      day.totalCalories,
      day.distanceKm,
      day.floorsClimbed,
      day.totalElevationGainMeters,
      day.altitudeChangeMeters,
      day.activityAverageHeartRate,
      day.activityScore,
      day.dayStrain,
      day.estimatedVo2Max,
      day.workoutStrain,
      day.averageHeartRate,
      day.walkingAverageHeartRate,
      day.lowestHeartRate,
      day.maxHeartRate,
      day.walkingAverageHeartRate,
      day.minimumHeartRate,
      day.lowActivityMinutes,
      day.mediumActivityMinutes,
      day.highActivityMinutes,
      day.percentRecorded,
      day.sessionMinutes,
      day.sessionCount,
    ]),
    ...input.sleepNights.flatMap((night) => [
      night.sessionMinutes,
      night.totalSleepMinutes,
      night.timeInBedMinutes,
      night.sleepEfficiency,
      night.sleepLatencyMinutes,
      night.awakeMinutes,
      night.lightMinutes,
      night.deepMinutes,
      night.remMinutes,
      night.sleepScore,
      night.sleepPerformance,
      night.sleepConsistency,
      night.averageHeartRate,
      night.lowestHeartRate,
      night.lowestSpo2,
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
      day.bodyWaterPercentage,
      day.boneMassPercentage,
      day.bmi,
      day.leanBodyMassKg,
      day.muscleMassPercentage,
      day.temperature,
      day.visceralFatIndex,
      day.waistCircumference,
    ]),
  ]);

  const includedProvenanceDiagnostics = input.dataset.provenanceDiagnostics.filter((diagnostic) => diagnostic.kind === "included");
  const excludedProvenanceDiagnostics = input.dataset.provenanceDiagnostics.filter((diagnostic) => diagnostic.kind === "excluded");

  const rows: WearableSourceHealth[] = providers
    .map((provider) => {
      const providerMetricCandidates = input.dataset.metricCandidates.filter(
        (candidate) => resolvePublicSourceProvider(candidate) === provider,
      );
      const providerActivitySessionAggregates = input.dataset.activitySessionAggregates.filter(
        (candidate) => resolvePublicSourceProvider(candidate) === provider,
      );
      const providerSleepWindows = input.dataset.sleepWindows.filter(
        (candidate) => resolvePublicSourceProvider(candidate) === provider,
      );
      const providerValidMainSleepWindows = validMainSleepWindows.filter(
        (candidate) => resolvePublicSourceProvider(candidate) === provider,
      );
      const providerSleepFreshnessMetricCandidates = sleepFreshnessMetricCandidates.filter(
        (candidate) => resolvePublicSourceProvider(candidate) === provider,
      );
      const providerProjectedWorkoutMetricKeys = uniqueStrings(
        providerActivitySessionAggregates.flatMap((aggregate) =>
          definedWorkoutMetricKeys(aggregate.workoutMetricValues)
        ),
      ).sort();
      const providerWorkoutMetricKeys = uniqueStrings(
        providerActivitySessionAggregates.flatMap((aggregate) => [
          ...aggregate.workoutMetricKeys,
          ...definedWorkoutMetricKeys(aggregate.workoutMetricValues),
        ]),
      ).sort();
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
        if (isActivitySummaryMetricCandidate(candidate)) {
          activityMetricDays.add(candidate.date);
        }
        if (isSleepSummaryMetricCandidate(candidate)) {
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
      const providerSleepDates = collectSortedDatesDesc([
        ...providerSleepFreshnessMetricCandidates.map((candidate) => candidate.date),
        ...providerValidMainSleepWindows.map(sleepFreshnessWindowDate),
      ]);
      const sleepStalenessVsNewestDays = latestSleepDate && providerSleepDates[0]
        ? daysBetweenIsoDates(providerSleepDates[0], latestSleepDate)
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

      if (providerWorkoutMetricKeys.length > 0) {
        notes.push(
          `${formatProviderName(provider)} has workout detail metrics on activity sessions (${providerWorkoutMetricKeys.join(", ")}); supported fields contribute to daily activity summaries, while unsupported details remain session-level evidence.`,
        );
      }

      const providerIncludedDiagnostics = includedProvenanceDiagnostics.filter((diagnostic) => diagnostic.provider === provider);
      notes.push(...providerIncludedDiagnostics.map((diagnostic) => formatIncludedWearableProvenanceNote(provider, diagnostic)));

      const metricsContributed = uniqueStrings([
        ...providerMetricCandidates.map((candidate) => candidate.metric),
        ...(providerActivitySessionAggregates.length > 0 ? ["sessionCount", "sessionMinutes"] : []),
        ...providerProjectedWorkoutMetricKeys,
        ...(providerSleepWindows.length > 0 ? ["sessionMinutes", "timeInBedMinutes"] : []),
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
        lastSleepDate: providerSleepDates[0] ?? null,
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
        sleepStalenessVsNewestDays,
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
    lastSleepDate: null,
    latestRecordedAt: latestIsoTimestamp(excludedProvenanceDiagnostics.map((diagnostic) => diagnostic.latestRecordedAt)),
    metricsContributed: [],
    notes: [formatExcludedWearableProvenanceNote(excludedProvenanceDiagnostics)],
    provider: "unknown",
    providerDisplayName: formatProviderName("unknown"),
    recoveryDays: 0,
    selectedMetrics: 0,
    sleepNights: 0,
    sleepStalenessVsNewestDays: null,
    stalenessVsNewestDays: null,
  });

  return rows.sort(compareSourceHealth);
}

function isUnambiguousSleepFreshnessMetricCandidate(
  candidate: WearableMetricCandidate,
): boolean {
  return (
    (
      isSleepSummaryMetricCandidate(candidate)
      && metricSetHas(UNAMBIGUOUS_SLEEP_FRESHNESS_METRICS, candidate.metric)
    )
    || candidate.sourceKind.toLowerCase().includes("sleep")
    || candidate.externalRef?.resourceType?.toLowerCase().includes("sleep") === true
  );
}

function isValidNonNapSleepWindow(
  window: WearableSleepWindowCandidate,
): boolean {
  if (window.nap || window.sleepType === "nap" || !(window.durationMinutes > 0)) {
    return false;
  }

  const startMs = Date.parse(window.startAt ?? "");
  const endMs = Date.parse(window.endAt ?? "");
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function sleepFreshnessWindowDate(window: WearableSleepWindowCandidate): string {
  if (
    typeof window.endAt === "string"
    && typeof window.timeZone === "string"
    && isValidIanaTimeZone(window.timeZone)
  ) {
    return formatTimeZoneDateTimeParts(window.endAt, window.timeZone).dayKey;
  }

  return window.date;
}

function metricSetHas(
  metrics: ReadonlySet<WearableMetricKey>,
  metric: string,
): metric is WearableMetricKey {
  return metrics.has(metric as WearableMetricKey);
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
      seen.set(exactKey, resolvePublicSourceProvider(candidate));
      continue;
    }

    counts.set(existingProvider, (counts.get(existingProvider) ?? 0) + 1);
  }

  return counts;
}

function resolvePublicSourceProvider(
  candidate: WearableMetricCandidate | WearableSleepNightCandidate | WearableActivitySessionAggregate,
): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: candidate.dataOrigin ?? null,
    externalRef: "externalRef" in candidate ? candidate.externalRef : null,
    provider: candidate.provider,
  }, {
    suppressJunctionSourceInstanceFallback: true,
  });
}

type WearableSleepNightCandidate = WearableDataset["sleepWindows"][number];

function countSelectedMetricsByProvider(
  metrics: readonly WearableResolvedMetric[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const metric of metrics) {
    const provider = metric.selection.provider;
    if (
      !provider
      || metric.selection.sourceKind === "activity-session-day-rollup"
    ) {
      continue;
    }

    counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }

  return counts;
}

function attributeSelectedActivityRollupMetricsToContributingProviders(
  activityDays: readonly WearableActivityDay[],
  activitySessionDayRollups: readonly WearableActivitySessionAggregate[],
  counts: Map<string, number>,
): void {
  const rollupsByDate = new Map(
    activitySessionDayRollups.map((rollup) => [rollup.date, rollup]),
  );

  for (const day of activityDays) {
    const metrics = [
      day.activeCalories,
      day.distanceKm,
      day.totalElevationGainMeters,
      day.workoutStrain,
      day.maxHeartRate,
      day.sessionMinutes,
      day.sessionCount,
    ];

    for (const metric of metrics) {
      if (metric.selection.sourceKind !== "activity-session-day-rollup") {
        continue;
      }

      const rollup = rollupsByDate.get(day.date);
      let contributors: readonly string[] = [];
      if (rollup && (metric.metric === "sessionMinutes" || metric.metric === "sessionCount")) {
        contributors = rollup.sessionContributors;
      } else if (rollup) {
        for (const workoutMetric of PROJECTED_WORKOUT_METRIC_KEYS) {
          if (metric.metric === workoutMetric) {
            contributors = rollup.workoutMetricContributors?.[workoutMetric] ?? [];
            break;
          }
        }
      }
      const fallbackProvider = metric.selection.provider;
      const providers = contributors.length > 0
        ? contributors
        : fallbackProvider && fallbackProvider !== "multiple"
          ? [fallbackProvider]
          : [];

      for (const provider of uniqueStrings(providers)) {
        counts.set(provider, (counts.get(provider) ?? 0) + 1);
      }
    }
  }
}

function definedWorkoutMetricKeys(
  values: WearableActivitySessionMetricValues,
): WearableActivitySessionWorkoutMetricKey[] {
  return PROJECTED_WORKOUT_METRIC_KEYS.filter((metric) =>
    values[metric] !== undefined
  );
}

function countConflictsByProvider(
  metrics: readonly WearableResolvedMetric[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const metric of metrics) {
    const selectedProvider = metric.selection.provider;
    const conflictParticipants = metric.confidence.conflictingProviders.length > 0
      ? uniqueStrings([
          ...(selectedProvider ? [selectedProvider] : []),
          ...metric.confidence.conflictingProviders,
        ])
      : [];

    for (const provider of conflictParticipants) {
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
