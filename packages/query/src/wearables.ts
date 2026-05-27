import type { VaultReadModel } from "./read-model.ts";
import { resolveWearableCanonicalMetricKey } from "@murphai/importers/device-providers/metric-catalog";

import {
  buildActivitySessionMetricCandidate,
  buildSleepWindowMetricCandidate,
  collectWearableDataset,
  groupActivitySessionAggregatesByDate,
  groupMetricCandidatesByDate,
  groupSleepWindowsByDate,
  resolveSelectedActivityTypes,
  selectMetricCandidates,
} from "./wearables/candidates.ts";
import {
  buildSummaryHighlight,
  collectSummaryProviders,
  inferDaySummaryConfidence,
  summarizeMetricsConfidence,
} from "./wearables/confidence.ts";
import { formatMetricLabel, formatProviderName, inferDefaultMetricFamily } from "./wearables/provider-policy.ts";
import { buildWearableSourceHealth } from "./wearables/source-health.ts";
import { wearableDataOriginKey } from "./wearables/origin.ts";
import { buildCandidateId, collectLatestDate, collectSortedDatesDesc, latestIsoTimestamp, uniqueStrings } from "./wearables/shared.ts";
import {
  resolveMetric,
  resolveSleepWindowSelection,
  withSleepFallback,
} from "./wearables/selection.ts";
import {
  summarizeActivityNotes,
  summarizeBodyStateNotes,
  summarizeRecoveryNotes,
  summarizeSleepNotes,
} from "./wearables/summaries.ts";
import {
  projectWearableActivityDayPublicSources,
  projectWearableBodyStateDayPublicSources,
  projectWearableRecoveryDayPublicSources,
  projectWearableSleepNightPublicSources,
} from "./wearables/public-output.ts";

import type {
  WearableActivityDay,
  WearableActivitySummary,
  WearableAssistantSummary,
  WearableBodyStateDay,
  WearableBodyStateSummary,
  WearableCandidateSourceFamily,
  WearableConfidenceLevel,
  WearableDataset,
  WearableDaySummary,
  WearableDriftSummary,
  WearableExternalRef,
  WearableFilters,
  WearableLatestSummary,
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricKey,
  WearableMetricLatestSummary,
  WearableMetricSelection,
  WearableMetricSummaryFilters,
  WearableMetricSummaryKind,
  WearableMetricTrendPoint,
  WearableMetricTrendSummary,
  WearableMetricValue,
  WearableMetricWindowStats,
  WearableRecoveryDay,
  WearableRecoverySummary,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSleepSummary,
  WearableSourceHealth,
  WearableSourceHealthSummary,
  WearableSummaryConfidence,
  WearableSummaryFilters,
  ProjectedWearableActivitySummary,
  ProjectedWearableBodyStateSummary,
  ProjectedWearableDaySummary,
  ProjectedWearableDriftSummary,
  ProjectedWearableLatestSummary,
  ProjectedWearableMetricLatestSummary,
  ProjectedWearableMetricTrendSummary,
  ProjectedWearableRecoverySummary,
  ProjectedWearableSleepSummary,
  ProjectedWearableSourceHealthSummary,
} from "./wearables/types.ts";
import {
  ACTIVITY_METRIC_KEYS,
  BODY_METRIC_KEYS,
  RECOVERY_METRIC_KEYS,
  SLEEP_METRIC_KEYS,
} from "./wearables/types.ts";

export type {
  WearableActivityDay,
  WearableActivitySummary,
  WearableAssistantSummary,
  WearableBodyStateDay,
  WearableBodyStateSummary,
  WearableCandidateSourceFamily,
  WearableConfidenceLevel,
  WearableDaySummary,
  WearableDriftSummary,
  WearableExternalRef,
  WearableFilters,
  WearableLatestSummary,
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricKey,
  WearableMetricLatestSummary,
  WearableMetricSelection,
  WearableMetricSummaryFilters,
  WearableMetricSummaryKind,
  WearableMetricTrendPoint,
  WearableMetricTrendSummary,
  WearableMetricValue,
  WearableMetricWindowStats,
  WearableRecoveryDay,
  WearableRecoverySummary,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSleepSummary,
  WearableSourceHealth,
  WearableSourceHealthSummary,
  WearableSummaryConfidence,
  WearableSummaryFilters,
  ProjectedWearableActivitySummary,
  ProjectedWearableBodyStateSummary,
  ProjectedWearableDaySummary,
  ProjectedWearableDriftSummary,
  ProjectedWearableLatestSummary,
  ProjectedWearableMetricLatestSummary,
  ProjectedWearableMetricSelection,
  ProjectedWearableMetricTrendPoint,
  ProjectedWearableMetricTrendSummary,
  ProjectedWearableRecoverySummary,
  ProjectedWearableResolvedMetric,
  ProjectedWearableSleepSummary,
  ProjectedWearableSourceHealthSummary,
} from "./wearables/types.ts";

export function listWearableActivityDays(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableActivityDay[] {
  return listWearableActivityDaysFromDataset(collectWearableDataset(vault, filters))
    .map(projectWearableActivityDayPublicSources);
}

function listWearableActivityDaysFromDataset(dataset: WearableDataset): WearableActivityDay[] {
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => metricSetHas(ACTIVITY_METRIC_KEYS, candidate.metric)),
  );
  const activitySessionAggregatesByDate = groupActivitySessionAggregatesByDate(dataset.activitySessionAggregates);
  const dates = collectSortedDatesDesc([
    ...metricCandidatesByDate.keys(),
    ...activitySessionAggregatesByDate.keys(),
  ]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const aggregates = activitySessionAggregatesByDate.get(date) ?? [];
    const steps = resolveMetric("steps", selectMetricCandidates(dateCandidates, "steps"), { metricFamily: "activity" });
    const activeCalories = resolveMetric("activeCalories", selectMetricCandidates(dateCandidates, "activeCalories"), {
      metricFamily: "activity",
    });
    const totalCalories = resolveMetric("totalCalories", selectMetricCandidates(dateCandidates, "totalCalories"), {
      metricFamily: "activity",
    });
    const distanceKm = resolveMetric("distanceKm", selectMetricCandidates(dateCandidates, "distanceKm"), {
      metricFamily: "activity",
    });
    const totalElevationGainMeters = resolveMetric(
      "totalElevationGainMeters",
      selectMetricCandidates(dateCandidates, "totalElevationGainMeters"),
      { metricFamily: "activity" },
    );
    const altitudeChangeMeters = resolveMetric(
      "altitudeChangeMeters",
      selectMetricCandidates(dateCandidates, "altitudeChangeMeters"),
      { metricFamily: "activity" },
    );
    const estimatedVo2Max = resolveMetric("estimatedVo2Max", selectMetricCandidates(dateCandidates, "estimatedVo2Max"), {
      metricFamily: "cardio",
    });
    const activityScore = resolveMetric("activityScore", selectMetricCandidates(dateCandidates, "activityScore"), {
      metricFamily: "activity",
    });
    const dayStrain = resolveMetric("dayStrain", selectMetricCandidates(dateCandidates, "dayStrain"), {
      metricFamily: "activity",
    });
    const workoutStrain = resolveMetric("workoutStrain", selectMetricCandidates(dateCandidates, "workoutStrain"), {
      metricFamily: "activity",
    });
    const maxHeartRate = resolveMetric("maxHeartRate", selectMetricCandidates(dateCandidates, "maxHeartRate"), {
      metricFamily: "activity",
    });
    const percentRecorded = resolveMetric("percentRecorded", selectMetricCandidates(dateCandidates, "percentRecorded"), {
      metricFamily: "activity",
    });
    const sessionMinutes = resolveMetric(
      "sessionMinutes",
      aggregates.map((aggregate) => buildActivitySessionMetricCandidate(aggregate, "sessionMinutes")),
      { metricFamily: "activity" },
    );
    const sessionCount = resolveMetric(
      "sessionCount",
      aggregates.map((aggregate) => buildActivitySessionMetricCandidate(aggregate, "sessionCount")),
      { metricFamily: "activity" },
    );
    const activityTypes = resolveSelectedActivityTypes(aggregates, sessionMinutes.selection.provider);
    const summaryConfidence = summarizeMetricsConfidence([
      ["steps", steps],
      ["activeCalories", activeCalories],
      ["totalCalories", totalCalories],
      ["distanceKm", distanceKm],
      ["totalElevationGainMeters", totalElevationGainMeters],
      ["altitudeChangeMeters", altitudeChangeMeters],
      ["estimatedVo2Max", estimatedVo2Max],
      ["activityScore", activityScore],
      ["dayStrain", dayStrain],
      ["workoutStrain", workoutStrain],
      ["maxHeartRate", maxHeartRate],
      ["percentRecorded", percentRecorded],
      ["sessionMinutes", sessionMinutes],
      ["sessionCount", sessionCount],
    ], {
      missingSummaryNote: "No activity summary metrics were available for this date.",
    });
    const notes = summarizeActivityNotes({
      activityTypes,
      sessionCount,
      sessionMinutes,
      summaryConfidence,
    });

    return {
      activityScore,
      activeCalories,
      activityTypes,
      altitudeChangeMeters,
      date,
      dayStrain,
      distanceKm,
      estimatedVo2Max,
      maxHeartRate,
      notes,
      percentRecorded,
      sessionCount,
      sessionMinutes,
      steps,
      summaryConfidence,
      totalCalories,
      totalElevationGainMeters,
      workoutStrain,
    };
  });
}

export function listWearableSleepNights(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableSleepNight[] {
  return listWearableSleepNightsFromDataset(collectWearableDataset(vault, filters))
    .map(projectWearableSleepNightPublicSources);
}

const ASLEEP_STAGE_TOTAL_METRICS: readonly WearableMetricKey[] = [
  "deepMinutes",
  "lightMinutes",
  "remMinutes",
];

function buildDerivedTotalSleepCandidates(
  date: string,
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  return groupSleepStageCandidatesByDerivedSource(candidates)
    .flatMap((providerCandidates) => {
      const sourceCandidate = providerCandidates.find((candidate) => candidate.dataOrigin) ?? providerCandidates[0] ?? null;
      const provider = sourceCandidate?.provider ?? "unknown";
      const stageSelections = ASLEEP_STAGE_TOTAL_METRICS.map((metric) =>
        resolveMetric(metric, selectMetricCandidates(providerCandidates, metric), {
          metricFamily: "sleep",
        }).selection
      );

      if (stageSelections.some((selection) => selection.value === null)) {
        return [];
      }

      const sourceKey = wearableDataOriginKey(sourceCandidate?.dataOrigin);
      return [{
        candidateId: buildCandidateId([provider, sourceKey, date, "derived", "totalSleepMinutes", "stage-total"]),
        dataOrigin: sourceCandidate?.dataOrigin ?? null,
        date,
        externalRef: null,
        metric: "totalSleepMinutes",
        occurredAt: latestIsoTimestamp(stageSelections.map((selection) => selection.occurredAt)),
        paths: uniqueStrings(stageSelections.flatMap((selection) => selection.paths)),
        provider,
        recordedAt: latestIsoTimestamp(stageSelections.map((selection) => selection.recordedAt)),
        recordIds: uniqueStrings(stageSelections.flatMap((selection) => selection.recordIds)),
        sourceFamily: "derived",
        sourceKind: "sleep-stage-total",
        title: `${formatProviderName(provider)} total sleep from stages`,
        unit: "minutes",
        value: Number(
          stageSelections
            .reduce((sum, selection) => sum + (selection.value ?? 0), 0)
            .toFixed(4),
        ),
      }];
    });
}

function groupSleepStageCandidatesByDerivedSource(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[][] {
  const groups = new Map<string, WearableMetricCandidate[]>();

  for (const candidate of candidates) {
    const key = `${candidate.provider}:${wearableDataOriginKey(candidate.dataOrigin)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(candidate);
      continue;
    }

    groups.set(key, [candidate]);
  }

  return [...groups.values()];
}

function listWearableSleepNightsFromDataset(dataset: WearableDataset): WearableSleepNight[] {
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => metricSetHas(SLEEP_METRIC_KEYS, candidate.metric)),
  );
  const sleepWindowsByDate = groupSleepWindowsByDate(dataset.sleepWindows);
  const dates = collectSortedDatesDesc([
    ...metricCandidatesByDate.keys(),
    ...sleepWindowsByDate.keys(),
  ]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const sleepWindows = sleepWindowsByDate.get(date) ?? [];
    const windowSelection = resolveSleepWindowSelection(sleepWindows);
    const sessionMinutes = resolveMetric(
      "sessionMinutes",
      sleepWindows.map((window) => buildSleepWindowMetricCandidate(window)),
      { metricFamily: "sleep" },
    );
    const directTotalSleepMinutes = resolveMetric(
      "totalSleepMinutes",
      selectMetricCandidates(dateCandidates, "totalSleepMinutes"),
      {
        metricFamily: "sleep",
      },
    );
    const totalSleepMinutes =
      directTotalSleepMinutes.selection.value !== null
        ? directTotalSleepMinutes
        : resolveMetric("totalSleepMinutes", buildDerivedTotalSleepCandidates(date, dateCandidates), {
            metricFamily: "sleep",
          });
    const timeInBedMinutes = withSleepFallback(
      resolveMetric("timeInBedMinutes", selectMetricCandidates(dateCandidates, "timeInBedMinutes"), {
        metricFamily: "sleep",
      }),
      sessionMinutes,
      "Used the selected sleep session duration because no explicit time-in-bed metric was available.",
    );
    const sleepEfficiency = resolveMetric("sleepEfficiency", selectMetricCandidates(dateCandidates, "sleepEfficiency"), {
      metricFamily: "sleep",
    });
    const awakeMinutes = resolveMetric("awakeMinutes", selectMetricCandidates(dateCandidates, "awakeMinutes"), {
      metricFamily: "sleep",
    });
    const lightMinutes = resolveMetric("lightMinutes", selectMetricCandidates(dateCandidates, "lightMinutes"), {
      metricFamily: "sleep",
    });
    const deepMinutes = resolveMetric("deepMinutes", selectMetricCandidates(dateCandidates, "deepMinutes"), {
      metricFamily: "sleep",
    });
    const remMinutes = resolveMetric("remMinutes", selectMetricCandidates(dateCandidates, "remMinutes"), {
      metricFamily: "sleep",
    });
    const sleepScore = resolveMetric("sleepScore", selectMetricCandidates(dateCandidates, "sleepScore"), {
      metricFamily: "sleep",
    });
    const sleepPerformance = resolveMetric("sleepPerformance", selectMetricCandidates(dateCandidates, "sleepPerformance"), {
      metricFamily: "sleep",
    });
    const sleepConsistency = resolveMetric("sleepConsistency", selectMetricCandidates(dateCandidates, "sleepConsistency"), {
      metricFamily: "sleep",
    });
    const averageHeartRate = resolveMetric("averageHeartRate", selectMetricCandidates(dateCandidates, "averageHeartRate"), {
      metricFamily: "sleep",
    });
    const lowestHeartRate = resolveMetric("lowestHeartRate", selectMetricCandidates(dateCandidates, "lowestHeartRate"), {
      metricFamily: "sleep",
    });
    const hrv = resolveMetric("hrv", selectMetricCandidates(dateCandidates, "hrv"), {
      metricFamily: "sleep",
    });
    const respiratoryRate = resolveMetric("respiratoryRate", selectMetricCandidates(dateCandidates, "respiratoryRate"), {
      metricFamily: "sleep",
    });
    const spo2 = resolveMetric("spo2", selectMetricCandidates(dateCandidates, "spo2"), {
      metricFamily: "sleep",
    });
    const summaryConfidence = summarizeMetricsConfidence([
      ["sessionMinutes", sessionMinutes],
      ["totalSleepMinutes", totalSleepMinutes],
      ["timeInBedMinutes", timeInBedMinutes],
      ["sleepEfficiency", sleepEfficiency],
      ["sleepScore", sleepScore],
      ["sleepPerformance", sleepPerformance],
      ["sleepConsistency", sleepConsistency],
      ["averageHeartRate", averageHeartRate],
      ["lowestHeartRate", lowestHeartRate],
      ["hrv", hrv],
      ["respiratoryRate", respiratoryRate],
      ["spo2", spo2],
    ], {
      missingSummaryNote: "No sleep metrics were available for this date.",
      extraNotes: windowSelection.confidence.reasons,
    });
    const notes = summarizeSleepNotes({
      summaryConfidence,
      timeInBedMinutes,
      totalSleepMinutes,
      windowSelection,
    });

    return {
      averageHeartRate,
      awakeMinutes,
      date,
      deepMinutes,
      hrv,
      lightMinutes,
      lowestHeartRate,
      notes,
      provider: windowSelection.selection?.provider ?? null,
      remMinutes,
      respiratoryRate,
      sessionMinutes,
      sleepConsistency,
      sleepEfficiency,
      sleepEndAt: windowSelection.selection?.endAt ?? null,
      sleepPerformance,
      sleepScore,
      sleepStartAt: windowSelection.selection?.startAt ?? null,
      sleepWindowProvider: windowSelection.selection?.provider ?? null,
      spo2,
      summaryConfidence,
      timeInBedMinutes,
      totalSleepMinutes,
    };
  });
}

export function listWearableRecoveryDays(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableRecoveryDay[] {
  return listWearableRecoveryDaysFromDataset(collectWearableDataset(vault, filters))
    .map(projectWearableRecoveryDayPublicSources);
}

function listWearableRecoveryDaysFromDataset(dataset: WearableDataset): WearableRecoveryDay[] {
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => metricSetHas(RECOVERY_METRIC_KEYS, candidate.metric)),
  );
  const dates = collectSortedDatesDesc([...metricCandidatesByDate.keys()]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const recoveryScore = resolveMetric("recoveryScore", selectMetricCandidates(dateCandidates, "recoveryScore"), {
      metricFamily: "recovery",
    });
    const readinessScore = resolveMetric("readinessScore", selectMetricCandidates(dateCandidates, "readinessScore"), {
      metricFamily: "readiness",
    });
    const restingHeartRate = resolveMetric("restingHeartRate", selectMetricCandidates(dateCandidates, "restingHeartRate"), {
      metricFamily: "cardio",
    });
    const hrv = resolveMetric("hrv", selectMetricCandidates(dateCandidates, "hrv"), {
      metricFamily: "recovery",
    });
    const respiratoryRate = resolveMetric("respiratoryRate", selectMetricCandidates(dateCandidates, "respiratoryRate"), {
      metricFamily: "respiration",
    });
    const spo2 = resolveMetric("spo2", selectMetricCandidates(dateCandidates, "spo2"), {
      metricFamily: "blood_oxygen",
    });
    const temperatureDeviation = resolveMetric(
      "temperatureDeviation",
      selectMetricCandidates(dateCandidates, "temperatureDeviation"),
      { metricFamily: "temperature" },
    );
    const temperature = resolveMetric("temperature", selectMetricCandidates(dateCandidates, "temperature"), {
      metricFamily: "temperature",
    });
    const bodyBattery = resolveMetric("bodyBattery", selectMetricCandidates(dateCandidates, "bodyBattery"), {
      metricFamily: "recovery",
    });
    const stressLevel = resolveMetric("stressLevel", selectMetricCandidates(dateCandidates, "stressLevel"), {
      metricFamily: "recovery",
    });
    const summaryConfidence = summarizeMetricsConfidence([
      ["recoveryScore", recoveryScore],
      ["readinessScore", readinessScore],
      ["restingHeartRate", restingHeartRate],
      ["hrv", hrv],
      ["respiratoryRate", respiratoryRate],
      ["spo2", spo2],
      ["temperatureDeviation", temperatureDeviation],
      ["temperature", temperature],
      ["bodyBattery", bodyBattery],
      ["stressLevel", stressLevel],
    ], {
      missingSummaryNote: "No recovery metrics were available for this date.",
    });
    const notes = summarizeRecoveryNotes({
      readinessScore,
      recoveryScore,
      summaryConfidence,
    });

    return {
      bodyBattery,
      date,
      hrv,
      notes,
      readinessScore,
      recoveryScore,
      respiratoryRate,
      restingHeartRate,
      spo2,
      stressLevel,
      summaryConfidence,
      temperature,
      temperatureDeviation,
    };
  });
}

export function listWearableBodyStateDays(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableBodyStateDay[] {
  return listWearableBodyStateDaysFromDataset(collectWearableDataset(vault, filters))
    .map(projectWearableBodyStateDayPublicSources);
}

function listWearableBodyStateDaysFromDataset(dataset: WearableDataset): WearableBodyStateDay[] {
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => metricSetHas(BODY_METRIC_KEYS, candidate.metric)),
  );
  const dates = collectSortedDatesDesc([...metricCandidatesByDate.keys()]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const weightKg = resolveMetric("weightKg", selectMetricCandidates(dateCandidates, "weightKg"), {
      metricFamily: "body",
    });
    const bodyFatPercentage = resolveMetric("bodyFatPercentage", selectMetricCandidates(dateCandidates, "bodyFatPercentage"), {
      metricFamily: "body",
    });
    const bmi = resolveMetric("bmi", selectMetricCandidates(dateCandidates, "bmi"), {
      metricFamily: "body",
    });
    const temperature = resolveMetric("temperature", selectMetricCandidates(dateCandidates, "temperature"), {
      metricFamily: "temperature",
    });
    const summaryConfidence = summarizeMetricsConfidence([
      ["weightKg", weightKg],
      ["bodyFatPercentage", bodyFatPercentage],
      ["bmi", bmi],
      ["temperature", temperature],
    ], {
      missingSummaryNote: "No body-state metrics were available for this date.",
    });
    const notes = summarizeBodyStateNotes({
      bodyFatPercentage,
      summaryConfidence,
      weightKg,
    });

    return {
      bmi,
      bodyFatPercentage,
      date,
      notes,
      summaryConfidence,
      temperature,
      weightKg,
    };
  });
}

export interface WearableSummaryBundle {
  activityDays: WearableActivityDay[];
  bodyStateDays: WearableBodyStateDay[];
  recoveryDays: WearableRecoveryDay[];
  sleepNights: WearableSleepNight[];
  sourceHealth: WearableSourceHealth[];
}

export interface ProjectedWearableSummaryBundle {
  activityDays: ProjectedWearableActivitySummary[];
  bodyStateDays: ProjectedWearableBodyStateSummary[];
  recoveryDays: ProjectedWearableRecoverySummary[];
  sleepNights: ProjectedWearableSleepSummary[];
  sourceHealth: ProjectedWearableSourceHealthSummary[];
}

export function buildWearableSummaryBundleFromDataset(dataset: WearableDataset): WearableSummaryBundle {
  const activityDays = listWearableActivityDaysFromDataset(dataset);
  const sleepNights = listWearableSleepNightsFromDataset(dataset);
  const recoveryDays = listWearableRecoveryDaysFromDataset(dataset);
  const bodyStateDays = listWearableBodyStateDaysFromDataset(dataset);
  const publicActivityDays = activityDays.map(projectWearableActivityDayPublicSources);
  const publicSleepNights = sleepNights.map(projectWearableSleepNightPublicSources);
  const publicRecoveryDays = recoveryDays.map(projectWearableRecoveryDayPublicSources);
  const publicBodyStateDays = bodyStateDays.map(projectWearableBodyStateDayPublicSources);

  return {
    activityDays: publicActivityDays,
    bodyStateDays: publicBodyStateDays,
    recoveryDays: publicRecoveryDays,
    sleepNights: publicSleepNights,
    sourceHealth: buildWearableSourceHealth({
      activityDays: publicActivityDays,
      bodyStateDays: publicBodyStateDays,
      dataset,
      recoveryDays: publicRecoveryDays,
      sleepNights: publicSleepNights,
    }),
  };
}

export function buildWearableSummaryBundle(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableSummaryBundle {
  return buildWearableSummaryBundleFromDataset(collectWearableDataset(vault, filters));
}

interface WearableMetricObservation {
  date: string;
  notes: string[];
  resolved: WearableResolvedMetric;
  summaryKind: WearableMetricSummaryKind;
}

const DEFAULT_WEARABLE_METRIC_WINDOW_DAYS = 7;
const DEFAULT_WEARABLE_DRIFT_SIGNALS: ReadonlyArray<{
  metric: WearableMetricKey;
  summaryKind: WearableMetricSummaryKind;
}> = [
  { metric: "recoveryScore", summaryKind: "recovery" },
  { metric: "readinessScore", summaryKind: "recovery" },
  { metric: "restingHeartRate", summaryKind: "recovery" },
  { metric: "hrv", summaryKind: "recovery" },
  { metric: "temperatureDeviation", summaryKind: "recovery" },
  { metric: "estimatedVo2Max", summaryKind: "activity" },
  { metric: "sleepScore", summaryKind: "sleep" },
  { metric: "totalSleepMinutes", summaryKind: "sleep" },
  { metric: "sleepEfficiency", summaryKind: "sleep" },
  { metric: "weightKg", summaryKind: "bodyState" },
  { metric: "bodyFatPercentage", summaryKind: "bodyState" },
];
const WEARABLE_METRIC_ALIAS_FALLBACKS: Readonly<Record<string, WearableMetricKey>> = {
  "skin-temp": "temperatureDeviation",
  "skin-temperature": "temperatureDeviation",
  "session-count": "sessionCount",
  "session-minutes": "sessionMinutes",
  "workout-minutes": "sessionMinutes",
};

function resolveWearableMetricWindowDays(windowDays: number | undefined): number {
  return Number.isInteger(windowDays) && (windowDays ?? 0) > 0
    ? windowDays as number
    : DEFAULT_WEARABLE_METRIC_WINDOW_DAYS;
}

function emptyWearableMetricConfidence(): WearableMetricConfidence {
  return {
    candidateCount: 0,
    conflictingProviders: [],
    exactDuplicateCount: 0,
    level: "none",
    reasons: [],
  };
}

function emptyWearableMetricWindow(): WearableMetricWindowStats {
  return {
    average: null,
    count: 0,
    from: null,
    max: null,
    min: null,
    to: null,
  };
}

function normalizeWearableMetricQuery(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase().replace(/[\s_]+/gu, "-");
}

function resolveWearableMetricSummaryKind(metric: WearableMetricKey): WearableMetricSummaryKind {
  switch (inferDefaultMetricFamily(metric)) {
    case "activity":
      return "activity";
    case "body":
      return "bodyState";
    case "recovery":
      return "recovery";
    case "sleep":
    default:
      return "sleep";
  }
}

function resolveWearableRequestedSummaryKind(
  metric: WearableMetricKey,
  normalizedMetricRequest: string,
  summaryKind?: WearableMetricSummaryKind,
): WearableMetricSummaryKind {
  if (summaryKind) {
    return summaryKind;
  }

  if (
    metric === "sessionMinutes"
    && (normalizedMetricRequest === "duration" || normalizedMetricRequest === "session-minutes" || normalizedMetricRequest === "workout-minutes")
  ) {
    return "activity";
  }

  return resolveWearableMetricSummaryKind(metric);
}

function resolveWearableMetricRequest(
  requestedMetric: string,
  summaryKind?: WearableMetricSummaryKind,
): {
  metric: WearableMetricKey;
  requestedMetric: string;
  resolvedAlias: string | null;
  summaryKind: WearableMetricSummaryKind;
} | null {
  const normalized = normalizeWearableMetricQuery(requestedMetric);

  if (!normalized) {
    return null;
  }

  const metric =
    resolveWearableCanonicalMetricKey(requestedMetric)
    ?? resolveWearableCanonicalMetricKey(normalized)
    ?? WEARABLE_METRIC_ALIAS_FALLBACKS[normalized]
    ?? null;

  if (!metric) {
    return null;
  }

  const trimmed = requestedMetric.trim();

  return {
    metric,
    requestedMetric: trimmed,
    resolvedAlias: trimmed === metric ? null : normalized,
    summaryKind: resolveWearableRequestedSummaryKind(metric, normalized, summaryKind),
  };
}

function isWearableResolvedMetric(value: unknown): value is WearableResolvedMetric {
  return typeof value === "object" && value !== null && "metric" in value && "selection" in value && "confidence" in value;
}

function listWearableMetricObservations(
  bundle: WearableSummaryBundle,
  metric: WearableMetricKey,
  summaryKind: WearableMetricSummaryKind,
): WearableMetricObservation[] {
  const summaries =
    summaryKind === "activity"
      ? bundle.activityDays
      : summaryKind === "bodyState"
        ? bundle.bodyStateDays
        : summaryKind === "recovery"
          ? bundle.recoveryDays
          : bundle.sleepNights;

  return summaries.flatMap((summary) => {
    const resolved = Reflect.get(summary, metric);

    if (!isWearableResolvedMetric(resolved) || resolved.selection.value === null) {
      return [];
    }

    return [{
      date: summary.date,
      notes: [...summary.notes],
      resolved,
      summaryKind,
    }];
  });
}

function buildWearableMetricWindowStats(
  observations: readonly WearableMetricObservation[],
): WearableMetricWindowStats {
  if (observations.length === 0) {
    return emptyWearableMetricWindow();
  }

  const values = observations
    .map((observation) => observation.resolved.selection.value)
    .filter((value): value is number => value !== null);

  return {
    average: values.length > 0
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
      : null,
    count: values.length,
    from: observations.at(-1)?.date ?? null,
    max: values.length > 0 ? Math.max(...values) : null,
    min: values.length > 0 ? Math.min(...values) : null,
    to: observations[0]?.date ?? null,
  };
}

function buildWearableMetricTrendPoint(
  observation: WearableMetricObservation,
): WearableMetricTrendPoint {
  return {
    confidence: observation.resolved.confidence.level,
    date: observation.date,
    paths: [...observation.resolved.selection.paths],
    provider: observation.resolved.selection.provider,
    recordedAt: observation.resolved.selection.recordedAt,
    recordIds: [...observation.resolved.selection.recordIds],
    unit: observation.resolved.selection.unit,
    value: observation.resolved.selection.value ?? 0,
  };
}

function summarizeWearableMetricFromBundle(
  bundle: WearableSummaryBundle,
  requestedMetric: string,
  filters: WearableMetricSummaryFilters = {},
  summaryKind?: WearableMetricSummaryKind,
): WearableMetricLatestSummary | null {
  const resolvedRequest = resolveWearableMetricRequest(requestedMetric, summaryKind);

  if (!resolvedRequest) {
    return null;
  }

  const observations = listWearableMetricObservations(bundle, resolvedRequest.metric, resolvedRequest.summaryKind);
  const windowDays = resolveWearableMetricWindowDays(filters.windowDays);
  const recentObservations = observations.slice(0, windowDays);
  const priorObservations = observations.slice(windowDays, windowDays * 2);
  const latestObservation = observations[0] ?? null;
  const recentWindow = buildWearableMetricWindowStats(recentObservations);
  const priorWindow = buildWearableMetricWindowStats(priorObservations);
  const values = observations
    .map((observation) => observation.resolved.selection.value)
    .filter((value): value is number => value !== null);
  const delta =
    recentWindow.average !== null && priorWindow.average !== null
      ? Number((recentWindow.average - priorWindow.average).toFixed(4))
      : null;
  const percentChange =
    delta !== null && priorWindow.average !== null && priorWindow.average !== 0
      ? Number(((delta / priorWindow.average) * 100).toFixed(2))
      : null;
  const metricLabel = formatMetricLabel(resolvedRequest.metric).toLowerCase();
  const notes = uniqueStrings([
    ...(latestObservation?.notes ?? []),
    ...(latestObservation?.resolved.confidence.reasons ?? []),
    observations.length === 0
      ? `No ${metricLabel} observations were available for the selected wearable range.`
      : priorWindow.count > 0
        ? `Compared recent ${recentWindow.count} ${metricLabel} day${recentWindow.count === 1 ? "" : "s"} (${recentWindow.from ?? "unknown"} to ${recentWindow.to ?? "unknown"}) against prior ${priorWindow.count} day${priorWindow.count === 1 ? "" : "s"} (${priorWindow.from ?? "unknown"} to ${priorWindow.to ?? "unknown"}).`
        : `Not enough earlier ${metricLabel} days were available for a prior-window comparison.`,
  ]);

  return {
    confidence: latestObservation?.resolved.confidence ?? emptyWearableMetricConfidence(),
    date: latestObservation?.date ?? null,
    delta,
    max: values.length > 0 ? Math.max(...values) : null,
    metric: resolvedRequest.metric,
    min: values.length > 0 ? Math.min(...values) : null,
    notes,
    paths: [...(latestObservation?.resolved.selection.paths ?? [])],
    percentChange,
    priorWindow,
    provider: latestObservation?.resolved.selection.provider ?? null,
    recentWindow,
    recordedAt: latestObservation?.resolved.selection.recordedAt ?? null,
    recordIds: [...(latestObservation?.resolved.selection.recordIds ?? [])],
    requestedMetric: resolvedRequest.requestedMetric,
    resolvedAlias: resolvedRequest.resolvedAlias,
    summaryKind: resolvedRequest.summaryKind,
    unit: latestObservation?.resolved.selection.unit ?? null,
    value: latestObservation?.resolved.selection.value ?? null,
    windowDays,
  };
}

function collectWearableLatestDateMismatchNotes(
  latestDate: string,
  bundle: WearableSummaryBundle,
): string[] {
  return uniqueStrings([
    ...collectWearableLatestDateMismatchNote("sleep", latestDate, bundle.sleepNights[0]?.date),
    ...collectWearableLatestDateMismatchNote("recovery", latestDate, bundle.recoveryDays[0]?.date),
    ...collectWearableLatestDateMismatchNote("activity", latestDate, bundle.activityDays[0]?.date),
    ...collectWearableLatestDateMismatchNote("body-state", latestDate, bundle.bodyStateDays[0]?.date),
  ]);
}

function collectWearableLatestDateMismatchNote(
  summaryKind: string,
  latestDate: string,
  freshestSummaryDate: string | undefined,
): string[] {
  if (!freshestSummaryDate || freshestSummaryDate === latestDate) {
    return [];
  }

  return [
    `Latest ${summaryKind} summary date ${freshestSummaryDate} differs from the joined wearable latest day ${latestDate}.`,
  ];
}

function buildWearableLatestSummary(
  bundle: WearableSummaryBundle,
  filters: WearableFilters,
): WearableLatestSummary | null {
  const latestDate = bundle.sleepNights[0]?.date ?? collectLatestDate([
    bundle.recoveryDays[0]?.date,
    bundle.activityDays[0]?.date,
    bundle.bodyStateDays[0]?.date,
  ]);

  if (!latestDate) {
    return null;
  }

  const day = summarizeWearableDayFromBundle(bundle, latestDate);

  if (!day) {
    return null;
  }

  return {
    activity: day.activity,
    bodyState: day.bodyState,
    day,
    latestDate,
    notes: uniqueStrings([
      `Latest wearable summary is joined on local day ${latestDate}.`,
      ...day.notes,
      ...collectWearableLatestDateMismatchNotes(latestDate, bundle),
    ]),
    providers: uniqueStrings([
      ...day.providers,
      ...bundle.sourceHealth.map((entry) => entry.provider),
    ]).sort(),
    recovery: day.recovery,
    sleep: day.sleep,
    sourceHealth: bundle.sourceHealth,
  };
}

export function listWearableSourceHealth(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableSourceHealth[] {
  return buildWearableSummaryBundle(vault, filters).sourceHealth;
}

export function summarizeWearableLatest(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableLatestSummary | null {
  return buildWearableLatestSummary(
    buildWearableSummaryBundle(vault, filters),
    filters,
  );
}

export function summarizeWearableLatestFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableFilters,
): ProjectedWearableLatestSummary | null;
export function summarizeWearableLatestFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableFilters,
): WearableLatestSummary | null;
export function summarizeWearableLatestFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableFilters = {},
): WearableLatestSummary | null {
  return buildWearableLatestSummary(bundle, filters);
}

export function summarizeWearableMetricLatest(
  vault: VaultReadModel,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): WearableMetricLatestSummary | null {
  return summarizeWearableMetricFromBundle(
    buildWearableSummaryBundle(vault, filters),
    metric,
    filters,
  );
}

export function summarizeWearableMetricLatestFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  metric: string,
  filters?: WearableMetricSummaryFilters,
): ProjectedWearableMetricLatestSummary | null;
export function summarizeWearableMetricLatestFromBundle(
  bundle: WearableSummaryBundle,
  metric: string,
  filters?: WearableMetricSummaryFilters,
): WearableMetricLatestSummary | null;
export function summarizeWearableMetricLatestFromBundle(
  bundle: WearableSummaryBundle,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): WearableMetricLatestSummary | null {
  return summarizeWearableMetricFromBundle(bundle, metric, filters);
}

export function summarizeWearableMetricTrend(
  vault: VaultReadModel,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): WearableMetricTrendSummary | null {
  return summarizeWearableMetricTrendFromBundle(buildWearableSummaryBundle(vault, filters), metric, filters);
}

export function summarizeWearableMetricTrendFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  metric: string,
  filters?: WearableMetricSummaryFilters,
): ProjectedWearableMetricTrendSummary | null;
export function summarizeWearableMetricTrendFromBundle(
  bundle: WearableSummaryBundle,
  metric: string,
  filters?: WearableMetricSummaryFilters,
): WearableMetricTrendSummary | null;
export function summarizeWearableMetricTrendFromBundle(
  bundle: WearableSummaryBundle,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): WearableMetricTrendSummary | null {
  const metricSummary = summarizeWearableMetricFromBundle(bundle, metric, filters);

  if (!metricSummary) {
    return null;
  }

  const points = listWearableMetricObservations(bundle, metricSummary.metric, metricSummary.summaryKind)
    .slice(0, metricSummary.windowDays)
    .map(buildWearableMetricTrendPoint);

  return {
    ...metricSummary,
    points,
  };
}

export function explainWearableDrift(
  vault: VaultReadModel,
  filters: WearableMetricSummaryFilters = {},
): WearableDriftSummary | null {
  return explainWearableDriftFromBundle(buildWearableSummaryBundle(vault, filters), filters);
}

export function explainWearableDriftFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableMetricSummaryFilters,
): ProjectedWearableDriftSummary | null;
export function explainWearableDriftFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableMetricSummaryFilters,
): WearableDriftSummary | null;
export function explainWearableDriftFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableMetricSummaryFilters = {},
): WearableDriftSummary | null {
  const latest = buildWearableLatestSummary(bundle, filters);

  if (!latest) {
    return null;
  }

  const signals = DEFAULT_WEARABLE_DRIFT_SIGNALS
    .map((signal) => summarizeWearableMetricFromBundle(bundle, signal.metric, filters, signal.summaryKind))
    .filter((signal): signal is WearableMetricLatestSummary => signal !== null && signal.value !== null);
  const notes = uniqueStrings([
    ...latest.notes,
    `Compared recent and prior ${resolveWearableMetricWindowDays(filters.windowDays)}-day wearable windows across the default sleep, recovery, and body signals.`,
  ]);

  return {
    latest,
    notes,
    signals,
    windowDays: resolveWearableMetricWindowDays(filters.windowDays),
  };
}

export function buildWearableAssistantSummary(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableAssistantSummary {
  const {
    activityDays,
    bodyStateDays,
    recoveryDays,
    sleepNights,
    sourceHealth,
  } = buildWearableSummaryBundleFromDataset(collectWearableDataset(vault, filters));
  const latestDate = collectLatestDate([
    activityDays[0]?.date,
    sleepNights[0]?.date,
    recoveryDays[0]?.date,
    bodyStateDays[0]?.date,
  ]);
  const highlights: string[] = [];

  if (sleepNights[0]) {
    highlights.push(buildSummaryHighlight("sleep", sleepNights[0].date, sleepNights[0].summaryConfidence));
  }

  if (recoveryDays[0]) {
    highlights.push(buildSummaryHighlight("recovery", recoveryDays[0].date, recoveryDays[0].summaryConfidence));
  }

  if (activityDays[0]) {
    highlights.push(buildSummaryHighlight("activity", activityDays[0].date, activityDays[0].summaryConfidence));
  }

  const laggingProviders = sourceHealth.filter((entry) => (entry.stalenessVsNewestDays ?? 0) > 0);
  if (laggingProviders.length > 0) {
    highlights.push(
      `Source freshness differs across providers: ${laggingProviders.map((entry) => `${entry.providerDisplayName} +${entry.stalenessVsNewestDays}d`).join(", ")}.`,
    );
  }

  if (highlights.length === 0) {
    highlights.push("No wearable summaries were available for the selected range.");
  }

  return {
    activity: activityDays[0] ?? null,
    bodyState: bodyStateDays[0] ?? null,
    date: filters.date ?? null,
    from: filters.from ?? null,
    highlights,
    latestDate,
    providers: filters.providers ? uniqueStrings(filters.providers) : [],
    recovery: recoveryDays[0] ?? null,
    sleep: sleepNights[0] ?? null,
    sourceHealth,
    to: filters.to ?? null,
  };
}

export function summarizeWearableSleep(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableSleepSummary[] {
  return summarizeWearableSleepFromBundle(buildWearableSummaryBundle(vault, filters), filters);
}

export function summarizeWearableSleepFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableSummaryFilters,
): ProjectedWearableSleepSummary[];
export function summarizeWearableSleepFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableSummaryFilters,
): WearableSleepSummary[];
export function summarizeWearableSleepFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableSummaryFilters = {},
): WearableSleepSummary[] {
  return applyWearableSummaryLimit(bundle.sleepNights, filters.limit);
}

export function summarizeWearableActivity(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableActivitySummary[] {
  return summarizeWearableActivityFromBundle(buildWearableSummaryBundle(vault, filters), filters);
}

export function summarizeWearableActivityFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableSummaryFilters,
): ProjectedWearableActivitySummary[];
export function summarizeWearableActivityFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableSummaryFilters,
): WearableActivitySummary[];
export function summarizeWearableActivityFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableSummaryFilters = {},
): WearableActivitySummary[] {
  return applyWearableSummaryLimit(bundle.activityDays, filters.limit);
}

export function summarizeWearableRecovery(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableRecoverySummary[] {
  return summarizeWearableRecoveryFromBundle(buildWearableSummaryBundle(vault, filters), filters);
}

export function summarizeWearableRecoveryFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableSummaryFilters,
): ProjectedWearableRecoverySummary[];
export function summarizeWearableRecoveryFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableSummaryFilters,
): WearableRecoverySummary[];
export function summarizeWearableRecoveryFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableSummaryFilters = {},
): WearableRecoverySummary[] {
  return applyWearableSummaryLimit(bundle.recoveryDays, filters.limit);
}

export function summarizeWearableBodyState(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableBodyStateSummary[] {
  return summarizeWearableBodyStateFromBundle(buildWearableSummaryBundle(vault, filters), filters);
}

export function summarizeWearableBodyStateFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableSummaryFilters,
): ProjectedWearableBodyStateSummary[];
export function summarizeWearableBodyStateFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableSummaryFilters,
): WearableBodyStateSummary[];
export function summarizeWearableBodyStateFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableSummaryFilters = {},
): WearableBodyStateSummary[] {
  return applyWearableSummaryLimit(bundle.bodyStateDays, filters.limit);
}

export function summarizeWearableSourceHealth(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableSourceHealthSummary[] {
  return summarizeWearableSourceHealthFromBundle(buildWearableSummaryBundle(vault, filters), filters);
}

export function summarizeWearableSourceHealthFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableSummaryFilters,
): ProjectedWearableSourceHealthSummary[];
export function summarizeWearableSourceHealthFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableSummaryFilters,
): WearableSourceHealthSummary[];
export function summarizeWearableSourceHealthFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableSummaryFilters = {},
): WearableSourceHealthSummary[] {
  return applyWearableSummaryLimit(bundle.sourceHealth, filters.limit);
}

export function summarizeWearableDay(
  vault: VaultReadModel,
  date: string,
  filters: Omit<WearableSummaryFilters, "date" | "from" | "to"> = {},
): WearableDaySummary | null {
  return summarizeWearableDayFromBundle(
    buildWearableSummaryBundle(vault, {
      date,
      providers: filters.providers,
    }),
    date,
  );
}

export function summarizeWearableDayFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  date: string,
): ProjectedWearableDaySummary | null;
export function summarizeWearableDayFromBundle(
  bundle: WearableSummaryBundle,
  date: string,
): WearableDaySummary | null;
export function summarizeWearableDayFromBundle(
  bundle: WearableSummaryBundle,
  date: string,
): WearableDaySummary | null {
  const normalizedDate = normalizeWearableSummaryDate(date);
  if (!normalizedDate) {
    return null;
  }

  const sleep = bundle.sleepNights.find((summary) => summary.date === normalizedDate) ?? null;
  const activity = bundle.activityDays.find((summary) => summary.date === normalizedDate) ?? null;
  const recovery = bundle.recoveryDays.find((summary) => summary.date === normalizedDate) ?? null;
  const bodyState = bundle.bodyStateDays.find((summary) => summary.date === normalizedDate) ?? null;
  const sourceHealth = bundle.sourceHealth.filter((entry) =>
    entry.firstDate === null ||
    entry.lastDate === null ||
    (entry.firstDate <= normalizedDate && entry.lastDate >= normalizedDate)
  );

  if (!sleep && !activity && !recovery && !bodyState && sourceHealth.length === 0) {
    return null;
  }

  const providers = uniqueStrings([
    ...sourceHealth.map((entry) => entry.provider),
    ...collectSummaryProviders([sleep, activity, recovery, bodyState]),
  ]).sort();
  const notes = uniqueStrings([
    ...(sleep?.notes ?? []),
    ...(activity?.notes ?? []),
    ...(recovery?.notes ?? []),
    ...(bodyState?.notes ?? []),
    ...sourceHealth.flatMap((entry) => entry.notes),
  ]);
  const summaryConfidence = inferDaySummaryConfidence([sleep, activity, recovery, bodyState]);

  return {
    activity,
    bodyState,
    date: normalizedDate,
    notes,
    providers,
    recovery,
    sleep,
    sourceHealth,
    summaryConfidence,
  };
}

function normalizeWearableSummaryDate(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const date = trimmed.match(/^(\d{4}-\d{2}-\d{2})/u);
  return date?.[1] ?? trimmed;
}

function applyWearableSummaryLimit<T>(
  items: readonly T[],
  limit: number | undefined,
): T[] {
  if (!Number.isInteger(limit) || (limit ?? 0) <= 0) {
    return [...items];
  }

  return [...items].slice(0, limit);
}

function metricSetHas(
  metricSet: ReadonlySet<WearableMetricKey>,
  metric: string,
): metric is WearableMetricKey {
  return metricSet.has(metric as WearableMetricKey);
}
