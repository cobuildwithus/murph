import type { VaultReadModel } from "./model.ts";

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
import { buildWearableSourceHealth } from "./wearables/source-health.ts";
import { collectLatestDate, collectSortedDatesDesc, uniqueStrings } from "./wearables/shared.ts";
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
  WearableExternalRef,
  WearableFilters,
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricKey,
  WearableMetricSelection,
  WearableMetricValue,
  WearableRecoveryDay,
  WearableRecoverySummary,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSleepSummary,
  WearableSourceHealth,
  WearableSourceHealthSummary,
  WearableSummaryConfidence,
  WearableSummaryFilters,
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
  WearableExternalRef,
  WearableFilters,
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricSelection,
  WearableMetricValue,
  WearableRecoveryDay,
  WearableRecoverySummary,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSleepSummary,
  WearableSourceHealth,
  WearableSourceHealthSummary,
  WearableSummaryConfidence,
  WearableSummaryFilters,
} from "./wearables/types.ts";

export function listWearableActivityDays(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableActivityDay[] {
  return listWearableActivityDaysFromDataset(collectWearableDataset(vault, filters));
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
    const distanceKm = resolveMetric("distanceKm", selectMetricCandidates(dateCandidates, "distanceKm"), {
      metricFamily: "activity",
    });
    const activityScore = resolveMetric("activityScore", selectMetricCandidates(dateCandidates, "activityScore"), {
      metricFamily: "activity",
    });
    const dayStrain = resolveMetric("dayStrain", selectMetricCandidates(dateCandidates, "dayStrain"), {
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
      ["distanceKm", distanceKm],
      ["activityScore", activityScore],
      ["dayStrain", dayStrain],
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
      date,
      dayStrain,
      distanceKm,
      notes,
      sessionCount,
      sessionMinutes,
      steps,
      summaryConfidence,
    };
  });
}

export function listWearableSleepNights(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableSleepNight[] {
  return listWearableSleepNightsFromDataset(collectWearableDataset(vault, filters));
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
    const totalSleepMinutes = withSleepFallback(
      resolveMetric("totalSleepMinutes", selectMetricCandidates(dateCandidates, "totalSleepMinutes"), {
        metricFamily: "sleep",
      }),
      sessionMinutes,
      "Used the selected sleep session duration because no direct total-sleep metric was available.",
    );
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
  return listWearableRecoveryDaysFromDataset(collectWearableDataset(vault, filters));
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
  return listWearableBodyStateDaysFromDataset(collectWearableDataset(vault, filters));
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

function buildWearableSummaryBundleFromDataset(dataset: WearableDataset): {
  activityDays: WearableActivityDay[];
  bodyStateDays: WearableBodyStateDay[];
  recoveryDays: WearableRecoveryDay[];
  sleepNights: WearableSleepNight[];
  sourceHealth: WearableSourceHealth[];
} {
  const activityDays = listWearableActivityDaysFromDataset(dataset);
  const sleepNights = listWearableSleepNightsFromDataset(dataset);
  const recoveryDays = listWearableRecoveryDaysFromDataset(dataset);
  const bodyStateDays = listWearableBodyStateDaysFromDataset(dataset);

  return {
    activityDays,
    bodyStateDays,
    recoveryDays,
    sleepNights,
    sourceHealth: buildWearableSourceHealth({
      activityDays,
      bodyStateDays,
      dataset,
      recoveryDays,
      sleepNights,
    }),
  };
}

export function listWearableSourceHealth(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableSourceHealth[] {
  return buildWearableSummaryBundleFromDataset(collectWearableDataset(vault, filters)).sourceHealth;
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
  return applyWearableSummaryLimit(listWearableSleepNights(vault, filters), filters.limit);
}

export function summarizeWearableActivity(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableActivitySummary[] {
  return applyWearableSummaryLimit(listWearableActivityDays(vault, filters), filters.limit);
}

export function summarizeWearableRecovery(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableRecoverySummary[] {
  return applyWearableSummaryLimit(listWearableRecoveryDays(vault, filters), filters.limit);
}

export function summarizeWearableBodyState(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableBodyStateSummary[] {
  return applyWearableSummaryLimit(listWearableBodyStateDays(vault, filters), filters.limit);
}

export function summarizeWearableSourceHealth(
  vault: VaultReadModel,
  filters: WearableSummaryFilters = {},
): WearableSourceHealthSummary[] {
  return applyWearableSummaryLimit(listWearableSourceHealth(vault, filters), filters.limit);
}

export function summarizeWearableDay(
  vault: VaultReadModel,
  date: string,
  filters: Omit<WearableSummaryFilters, "date" | "from" | "to"> = {},
): WearableDaySummary | null {
  const normalizedDate = normalizeWearableSummaryDate(date);
  if (!normalizedDate) {
    return null;
  }

  const dayFilters: WearableFilters = {
    date: normalizedDate,
    providers: filters.providers,
  };
  const {
    activityDays,
    bodyStateDays,
    recoveryDays,
    sleepNights,
    sourceHealth,
  } = buildWearableSummaryBundleFromDataset(collectWearableDataset(vault, dayFilters));
  const sleep = sleepNights[0] ?? null;
  const activity = activityDays[0] ?? null;
  const recovery = recoveryDays[0] ?? null;
  const bodyState = bodyStateDays[0] ?? null;

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
