import type { VaultReadModel } from "./read-model.ts";
import { resolveWearableCanonicalMetricKey } from "@murphai/health-metrics";

import {
  buildActivitySessionMetricCandidate,
  buildActivitySessionWorkoutMetricCandidates,
  buildSleepWindowMetricCandidate,
  collectWearableDataset,
  groupActivitySessionAggregatesByDate,
  groupMetricCandidatesByDate,
  groupSleepWindowsByDate,
  resolveSelectedActivitySessionAggregate,
  resolveSelectedActivityTypes,
  resolveSelectedHeartRateZones,
  selectMetricCandidates,
} from "./wearables/candidates.ts";
import {
  buildSummaryHighlight,
  collectSummaryProviders,
  inferDaySummaryConfidence,
  summarizeMetricsConfidence,
} from "./wearables/confidence.ts";
import {
  formatMetricLabel,
  formatProviderName,
  inferDefaultMetricFamily,
  resolveMetricTolerance,
} from "./wearables/provider-policy.ts";
import { buildWearableSourceHealth } from "./wearables/source-health.ts";
import {
  buildWearableSleepPatternSummary,
  resolveWearableSleepPatternReadFilters,
  type WearableSleepPatternBuildContext,
} from "./wearables/sleep-pattern.ts";
import { resolveWearablePublicSourceProvider, wearableDataOriginKey } from "./wearables/origin.ts";
import {
  isAppleHealthKitSleepCandidate,
  sleepMetricAssociatedWithWindow,
  sleepMetricMatchesNonSelectedWindow,
  sleepMetricMatchesWindow,
  sleepWindowsRepresentSameWindow,
} from "./wearables/sleep-association.ts";
import {
  buildCandidateId,
  collectLatestDate,
  collectSortedDatesDesc,
  latestIsoTimestamp,
  uniqueStrings,
} from "./wearables/shared.ts";
import {
  resolveMetric,
  resolveSleepWindowSelection,
  withMetricFallback,
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
  WearableDailyCumulativeMetric,
  WearableDailyMaximumMetric,
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
  WearableSleepWindowCandidate,
  WearableSleepWindowEvidence,
  WearableSleepNight,
  WearableSleepPatternFilters,
  WearableSleepPatternSummary,
  WearableSleepReportingTimeZoneSource,
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
  ACTIVITY_BRANCH_SCOPED_METRIC_KEYS,
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
  WearableSleepPatternFilters,
  WearableSleepPatternSummary,
  WearableSleepReportingTimeZoneSource,
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
  const activitySessionDayRollupsByDate = groupActivitySessionAggregatesByDate(
    dataset.activitySessionDayRollups,
  );
  const dates = collectSortedDatesDesc([
    ...metricCandidatesByDate.keys(),
    ...activitySessionDayRollupsByDate.keys(),
  ]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const explicitDateCandidates = dateCandidates;
    const aggregates = activitySessionDayRollupsByDate.get(date) ?? [];
    const workoutMetricCandidates = aggregates.flatMap(buildActivitySessionWorkoutMetricCandidates);
    const steps = resolveMetric("steps", selectMetricCandidates(explicitDateCandidates, "steps"), { metricFamily: "activity" });
    const activeCalories = resolveDailyCumulativeMetric(
      "activeCalories",
      explicitDateCandidates,
      workoutMetricCandidates,
    );
    const totalCalories = resolveMetric("totalCalories", selectMetricCandidates(explicitDateCandidates, "totalCalories"), {
      metricFamily: "activity",
    });
    const distanceKm = resolveDailyCumulativeMetric(
      "distanceKm",
      explicitDateCandidates,
      workoutMetricCandidates,
    );
    const floorsClimbed = resolveMetric("floorsClimbed", selectMetricCandidates(explicitDateCandidates, "floorsClimbed"), {
      metricFamily: "activity",
    });
    const totalElevationGainMeters = resolveDailyCumulativeMetric(
      "totalElevationGainMeters",
      explicitDateCandidates,
      workoutMetricCandidates,
    );
    const altitudeChangeMeters = resolveMetric(
      "altitudeChangeMeters",
      selectMetricCandidates(explicitDateCandidates, "altitudeChangeMeters"),
      { metricFamily: "activity" },
    );
    const estimatedVo2Max = resolveMetric("estimatedVo2Max", selectMetricCandidates(explicitDateCandidates, "estimatedVo2Max"), {
      metricFamily: "cardio",
    });
    const activityScore = resolveMetric("activityScore", selectMetricCandidates(explicitDateCandidates, "activityScore"), {
      metricFamily: "activity",
    });
    const activityAverageHeartRate = resolveMetric(
      "activityAverageHeartRate",
      selectMetricCandidates(explicitDateCandidates, "activityAverageHeartRate"),
      { metricFamily: "activity" },
    );
    const walkingAverageHeartRate = resolveMetric(
      "walkingAverageHeartRate",
      selectMetricCandidates(explicitDateCandidates, "walkingAverageHeartRate"),
      { metricFamily: "activity" },
    );
    const minimumHeartRate = resolveMetric(
      "minimumHeartRate",
      selectMetricCandidates(explicitDateCandidates, "minimumHeartRate"),
      { metricFamily: "activity" },
    );
    const lowActivityMinutes = resolveMetric(
      "lowActivityMinutes",
      selectMetricCandidates(explicitDateCandidates, "lowActivityMinutes"),
      { metricFamily: "activity" },
    );
    const mediumActivityMinutes = resolveMetric(
      "mediumActivityMinutes",
      selectMetricCandidates(explicitDateCandidates, "mediumActivityMinutes"),
      { metricFamily: "activity" },
    );
    const highActivityMinutes = resolveMetric(
      "highActivityMinutes",
      selectMetricCandidates(explicitDateCandidates, "highActivityMinutes"),
      { metricFamily: "activity" },
    );
    const dayStrain = resolveMetric("dayStrain", selectMetricCandidates(explicitDateCandidates, "dayStrain"), {
      metricFamily: "activity",
    });
    const workoutStrain = resolveDailyMaximumMetric(
      "workoutStrain",
      selectMetricCandidates([...explicitDateCandidates, ...workoutMetricCandidates], "workoutStrain"),
    );
    const maxHeartRate = resolveDailyMaximumMetric(
      "maxHeartRate",
      selectMetricCandidates([...explicitDateCandidates, ...workoutMetricCandidates], "maxHeartRate"),
    );
    const percentRecorded = resolveMetric("percentRecorded", selectMetricCandidates(explicitDateCandidates, "percentRecorded"), {
      metricFamily: "activity",
    });
    const sessionMinutes = resolveMetric(
      "sessionMinutes",
      aggregates.map((aggregate) => buildActivitySessionMetricCandidate(aggregate, "sessionMinutes")),
      { metricFamily: "activity" },
    );
    const selectedActivitySessionAggregate = resolveSelectedActivitySessionAggregate(
      aggregates,
      sessionMinutes.selection,
    );
    const sessionCount = resolveMetric(
      "sessionCount",
      selectedActivitySessionAggregate
        ? [buildActivitySessionMetricCandidate(selectedActivitySessionAggregate, "sessionCount")]
        : [],
      { metricFamily: "activity" },
    );
    const activityTypes = resolveSelectedActivityTypes(aggregates, sessionMinutes.selection);
    const heartRateZones = resolveSelectedHeartRateZones(aggregates, sessionMinutes.selection);
    const summaryConfidence = summarizeMetricsConfidence([
      ["steps", steps],
      ["activeCalories", activeCalories],
      ["totalCalories", totalCalories],
      ["distanceKm", distanceKm],
      ["floorsClimbed", floorsClimbed],
      ["totalElevationGainMeters", totalElevationGainMeters],
      ["altitudeChangeMeters", altitudeChangeMeters],
      ["estimatedVo2Max", estimatedVo2Max],
      ["activityScore", activityScore],
      ["activityAverageHeartRate", activityAverageHeartRate],
      ["walkingAverageHeartRate", walkingAverageHeartRate],
      ["minimumHeartRate", minimumHeartRate],
      ["lowActivityMinutes", lowActivityMinutes],
      ["mediumActivityMinutes", mediumActivityMinutes],
      ["highActivityMinutes", highActivityMinutes],
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
      activityAverageHeartRate,
      activityScore,
      activeCalories,
      activityTypes,
      altitudeChangeMeters,
      date,
      dayStrain,
      distanceKm,
      estimatedVo2Max,
      floorsClimbed,
      heartRateZones,
      highActivityMinutes,
      lowActivityMinutes,
      maxHeartRate,
      mediumActivityMinutes,
      minimumHeartRate,
      notes,
      percentRecorded,
      sessionCount,
      sessionMinutes,
      steps,
      summaryConfidence,
      totalCalories,
      totalElevationGainMeters,
      workoutStrain,
      walkingAverageHeartRate,
    };
  });
}

function resolveDailyCumulativeMetric(
  metric: WearableDailyCumulativeMetric,
  explicitDateCandidates: readonly WearableMetricCandidate[],
  workoutMetricCandidates: readonly WearableMetricCandidate[],
): WearableResolvedMetric {
  const explicitDaily = resolveMaximumKnownMetric(
    metric,
    selectMetricCandidates(explicitDateCandidates, metric),
    "explicit daily maximum",
  );
  const workoutRollup = resolveMetric(
    metric,
    selectMetricCandidates(workoutMetricCandidates, metric),
    { metricFamily: "activity" },
  );
  return resolveOverlappingDailyMetricBranches({
    explicit: explicitDaily,
    explicitLabel: "explicit daily total",
    metric,
    reducerLabel: "daily cumulative lower-bound",
    relationship: "these overlapping totals were not added",
    workout: workoutRollup,
    workoutLabel: "workout rollup",
  });
}

function formatDailyReducerValue(selection: WearableMetricSelection): string {
  if (selection.value === null) {
    return "unknown";
  }

  const unit = selection.unit ? ` ${selection.unit}` : "";
  return `${selection.value}${unit}`;
}

function resolveDailyMaximumMetric(
  metric: WearableDailyMaximumMetric,
  candidates: readonly WearableMetricCandidate[],
): WearableResolvedMetric {
  if (ACTIVITY_BRANCH_SCOPED_METRIC_KEYS.has(metric)) {
    const explicitMaximum = resolveMaximumKnownMetric(
      metric,
      candidates.filter((candidate) => !isActivitySessionRollupMetricCandidate(candidate)),
      "explicit daily maximum",
    );
    const workoutMaximum = resolveMaximumKnownMetric(
      metric,
      candidates.filter(isActivitySessionRollupMetricCandidate),
      "workout maximum",
    );
    return resolveOverlappingDailyMetricBranches({
      explicit: explicitMaximum,
      explicitLabel: "explicit daily maximum",
      metric,
      reducerLabel: "daily nested-maximum",
      relationship: "these nested maxima were not treated as disagreement",
      workout: workoutMaximum,
      workoutLabel: "workout maximum",
    });
  }

  return resolveMaximumKnownMetric(metric, candidates, "daily maximum");
}

function isActivitySessionRollupMetricCandidate(candidate: WearableMetricCandidate): boolean {
  return candidate.sourceKind === "activity-session-aggregate"
    || candidate.sourceKind === "activity-session-day-rollup";
}

function resolveOverlappingDailyMetricBranches(input: {
  explicit: WearableResolvedMetric;
  explicitLabel: string;
  metric: WearableDailyCumulativeMetric | WearableDailyMaximumMetric;
  reducerLabel: string;
  relationship: string;
  workout: WearableResolvedMetric;
  workoutLabel: string;
}): WearableResolvedMetric {
  const explicitValue = input.explicit.selection.value;
  const workoutValue = input.workout.selection.value;
  if (explicitValue === null && workoutValue === null) {
    return input.explicit;
  }

  const chooseWorkout =
    workoutValue !== null
    && (explicitValue === null || workoutValue > explicitValue);
  const selected = chooseWorkout ? input.workout : input.explicit;
  const other = chooseWorkout ? input.explicit : input.workout;
  const selectedLabel = chooseWorkout ? input.workoutLabel : input.explicitLabel;
  const otherLabel = chooseWorkout ? input.explicitLabel : input.workoutLabel;
  const reason = other.selection.value === null
    ? `Used the ${selectedLabel} as the only known ${formatMetricLabel(input.metric)} value for the day.`
    : selected.selection.value === other.selection.value
      ? `Applied the ${input.reducerLabel} reducer: selected the ${selectedLabel} (${formatDailyReducerValue(
          selected.selection,
        )}), which matched the ${otherLabel}; ${input.relationship}.`
      : `Applied the ${input.reducerLabel} reducer: selected the ${selectedLabel} (${formatDailyReducerValue(
          selected.selection,
        )}) over the ${otherLabel} (${formatDailyReducerValue(
          other.selection,
        )}); ${input.relationship}.`;

  return {
    candidates: [...input.explicit.candidates, ...input.workout.candidates],
    confidence: {
      ...selected.confidence,
      candidateCount:
        input.explicit.confidence.candidateCount
        + input.workout.confidence.candidateCount,
      exactDuplicateCount:
        input.explicit.confidence.exactDuplicateCount
        + input.workout.confidence.exactDuplicateCount,
      reasons: [reason, ...selected.confidence.reasons],
    },
    metric: input.metric,
    selection: selected.selection,
  };
}

function resolveMaximumKnownMetric(
  metric: WearableDailyCumulativeMetric | WearableDailyMaximumMetric,
  candidates: readonly WearableMetricCandidate[],
  reducerLabel: string,
): WearableResolvedMetric {
  const resolved = resolveMetric(metric, candidates, { metricFamily: "activity" });
  const maximumValue = resolved.candidates.reduce<number | null>((maximum, candidate) =>
    maximum === null || candidate.value > maximum ? candidate.value : maximum, null);
  if (maximumValue === null) {
    return resolved;
  }

  const maximum = resolveMetric(
    metric,
    resolved.candidates.filter((candidate) => candidate.value === maximumValue),
    { metricFamily: "activity" },
  );
  const selectedProvider = maximum.selection.provider;
  const conflictingProviders = selectedProvider
    ? uniqueStrings(
        resolved.candidates
          .filter((candidate) => candidate.provider !== selectedProvider)
          .filter((candidate) =>
            Math.abs(candidate.value - maximumValue) > resolveMetricTolerance(metric)
          )
          .map((candidate) => candidate.provider),
      )
    : [];
  const selectedEvidence = maximum.selection.sourceKind
    ? `${formatProviderName(selectedProvider ?? "unknown")} ${maximum.selection.sourceKind}`
    : formatProviderName(selectedProvider ?? "unknown");
  const exactDuplicateReason = resolved.confidence.exactDuplicateCount > 0
    ? [
        `Suppressed ${resolved.confidence.exactDuplicateCount} exact duplicate candidate${
          resolved.confidence.exactDuplicateCount === 1 ? "" : "s"
        } before applying the ${reducerLabel} reducer.`,
      ]
    : [];
  const conflictReason = conflictingProviders.length > 0
    ? [`Conflicting values remained from ${conflictingProviders.map(formatProviderName).join(", ")}.`]
    : [];

  return {
    candidates: resolved.candidates,
    confidence: {
      ...resolved.confidence,
      conflictingProviders,
      reasons: [
        `Applied the ${reducerLabel} reducer across ${resolved.confidence.candidateCount} valid candidate${
          resolved.confidence.candidateCount === 1 ? "" : "s"
        } and selected ${selectedEvidence} at ${formatDailyReducerValue(maximum.selection)}.`,
        ...exactDuplicateReason,
        ...maximum.confidence.reasons,
        ...conflictReason,
      ],
    },
    metric,
    selection: maximum.selection,
  };
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
const MAX_SLEEP_WINDOW_EVIDENCE_PER_SUMMARY = 64;

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

function selectSleepWindowMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  selectedWindow: WearableSleepWindowCandidate | null,
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableMetricCandidate[] {
  if (!selectedWindow) {
    return [...candidates];
  }

  const anchored = candidates.filter((candidate) => sleepMetricMatchesWindow(candidate, selectedWindow));
  if (anchored.length > 0) {
    return anchored;
  }

  const timeAnchored = candidates.filter((candidate) => sleepMetricAssociatedWithWindow(candidate, selectedWindow));
  if (timeAnchored.length > 0) {
    return timeAnchored;
  }

  const nonSelectedWindowCandidates = candidates.filter((candidate) =>
    !sleepMetricMatchesNonSelectedWindow(candidate, selectedWindow, sleepWindows)
  );

  return nonSelectedWindowCandidates;
}

function selectSleepMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  metric: WearableMetricKey,
  selectedWindow: WearableSleepWindowCandidate | null,
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableMetricCandidate[] {
  return selectSleepWindowMetricCandidates(selectMetricCandidates(candidates, metric), selectedWindow, sleepWindows);
}

function selectPreferredSleepMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  metric: WearableMetricKey,
  selectedWindow: WearableSleepWindowCandidate | null,
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableMetricCandidate[] {
  return preferDirectSleepMetricCandidates(
    selectSleepMetricCandidates(candidates, metric, selectedWindow, sleepWindows),
  );
}

function preferDirectSleepMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  if (!candidates.some(isAppleHealthKitSleepCandidate)) {
    return [...candidates];
  }

  const directCandidates = candidates.filter((candidate) => !isAppleHealthKitSleepCandidate(candidate));
  return directCandidates.length > 0 ? directCandidates : [...candidates];
}

function preferDirectSleepWindows(
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableSleepWindowCandidate[] {
  const directWindows = sleepWindows.filter((window) => !isAppleHealthKitSleepCandidate(window));
  if (directWindows.length === 0) {
    return [...sleepWindows];
  }

  return sleepWindows.filter((window) =>
    !isAppleHealthKitSleepCandidate(window) ||
    !directWindows.some((directWindow) => sleepWindowsRepresentSameWindow(window, directWindow))
  );
}

function buildDerivedTotalSleepCandidatesForWindow(
  date: string,
  candidates: readonly WearableMetricCandidate[],
  selectedWindow: WearableSleepWindowCandidate | null,
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableMetricCandidate[] {
  if (!selectedWindow) {
    return buildDerivedTotalSleepCandidates(date, candidates);
  }

  const anchoredCandidates = candidates.filter((candidate) => sleepMetricMatchesWindow(candidate, selectedWindow));
  const anchoredDerivedCandidates = anchoredCandidates.length > 0
    ? buildDerivedTotalSleepCandidates(date, anchoredCandidates)
    : [];

  return anchoredDerivedCandidates.length > 0
    ? anchoredDerivedCandidates
    : buildDerivedTotalSleepCandidates(
        date,
        candidates.filter((candidate) => !sleepMetricMatchesNonSelectedWindow(candidate, selectedWindow, sleepWindows)),
      );
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
    const rawSleepWindows = sleepWindowsByDate.get(date) ?? [];
    const sleepWindows = preferDirectSleepWindows(rawSleepWindows);
    const windowSelection = resolveSleepWindowSelection(sleepWindows);
    const selectedWindow = windowSelection.selection;
    const sleepWindowEvidence = buildBoundedSleepWindowEvidence(rawSleepWindows, selectedWindow);
    const sessionMinutes = resolveSessionMinutesForSleepWindows(selectedWindow, sleepWindows);
    const directTotalSleepMinutes = resolveMetric(
      "totalSleepMinutes",
      selectPreferredSleepMetricCandidates(dateCandidates, "totalSleepMinutes", selectedWindow, sleepWindows),
      {
        metricFamily: "sleep",
      },
    );
    const totalSleepMinutes =
      directTotalSleepMinutes.selection.value !== null
        ? directTotalSleepMinutes
        : resolveMetric("totalSleepMinutes", buildDerivedTotalSleepCandidatesForWindow(
            date,
            dateCandidates,
            selectedWindow,
            sleepWindows,
          ), {
            metricFamily: "sleep",
          });
    const timeInBedMinutes = withMetricFallback(
      resolveMetric("timeInBedMinutes", selectPreferredSleepMetricCandidates(dateCandidates, "timeInBedMinutes", selectedWindow, sleepWindows), {
        metricFamily: "sleep",
      }),
      sessionMinutes,
      "Used the selected sleep session duration because no explicit time-in-bed metric was available.",
    );
    const sleepEfficiency = resolveMetric("sleepEfficiency", selectPreferredSleepMetricCandidates(dateCandidates, "sleepEfficiency", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const sleepLatencyMinutes = resolveMetric("sleepLatencyMinutes", selectPreferredSleepMetricCandidates(dateCandidates, "sleepLatencyMinutes", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const awakeMinutes = resolveMetric("awakeMinutes", selectPreferredSleepMetricCandidates(dateCandidates, "awakeMinutes", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const lightMinutes = resolveMetric("lightMinutes", selectPreferredSleepMetricCandidates(dateCandidates, "lightMinutes", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const deepMinutes = resolveMetric("deepMinutes", selectPreferredSleepMetricCandidates(dateCandidates, "deepMinutes", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const remMinutes = resolveMetric("remMinutes", selectPreferredSleepMetricCandidates(dateCandidates, "remMinutes", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const sleepScore = resolveMetric("sleepScore", selectSleepMetricCandidates(dateCandidates, "sleepScore", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const sleepPerformance = resolveMetric("sleepPerformance", selectSleepMetricCandidates(dateCandidates, "sleepPerformance", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const sleepConsistency = resolveMetric("sleepConsistency", selectSleepMetricCandidates(dateCandidates, "sleepConsistency", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const averageHeartRate = resolveMetric("averageHeartRate", selectSleepMetricCandidates(dateCandidates, "averageHeartRate", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const lowestHeartRate = resolveMetric("lowestHeartRate", selectSleepMetricCandidates(dateCandidates, "lowestHeartRate", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const lowestSpo2 = resolveMetric("lowestSpo2", selectSleepMetricCandidates(dateCandidates, "lowestSpo2", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const hrv = resolveMetric("hrv", selectSleepMetricCandidates(dateCandidates, "hrv", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const respiratoryRate = resolveMetric("respiratoryRate", selectSleepMetricCandidates(dateCandidates, "respiratoryRate", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const spo2 = resolveMetric("spo2", selectSleepMetricCandidates(dateCandidates, "spo2", selectedWindow, sleepWindows), {
      metricFamily: "sleep",
    });
    const summaryConfidence = summarizeMetricsConfidence([
      ["sessionMinutes", sessionMinutes],
      ["totalSleepMinutes", totalSleepMinutes],
      ["timeInBedMinutes", timeInBedMinutes],
      ["sleepEfficiency", sleepEfficiency],
      ["sleepLatencyMinutes", sleepLatencyMinutes],
      ["sleepScore", sleepScore],
      ["sleepPerformance", sleepPerformance],
      ["sleepConsistency", sleepConsistency],
      ["averageHeartRate", averageHeartRate],
      ["lowestHeartRate", lowestHeartRate],
      ["lowestSpo2", lowestSpo2],
      ["hrv", hrv],
      ["respiratoryRate", respiratoryRate],
      ["spo2", spo2],
    ], {
      missingSummaryNote: "No sleep metrics were available for this date.",
      extraNotes: buildPublicSleepWindowConflictNotes(sleepWindows, selectedWindow),
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
      lowestSpo2,
      notes,
      provider: windowSelection.selection?.provider ?? null,
      remMinutes,
      respiratoryRate,
      sessionMinutes,
      sleepConsistency,
      sleepEfficiency,
      sleepEndAt: windowSelection.selection?.endAt ?? null,
      sleepLatencyMinutes,
      sleepPerformance,
      sleepScore,
      sleepStartAt: windowSelection.selection?.startAt ?? null,
      sleepType: windowSelection.selection?.sleepType ?? (windowSelection.selection?.nap ? "nap" : "unknown"),
      sleepWindowEvidence: sleepWindowEvidence.windows,
      sleepWindowEvidenceOmittedCount: sleepWindowEvidence.omittedCount,
      sleepWindowEvidenceOmittedExactDuplicateCount: sleepWindowEvidence.omittedExactDuplicateCount,
      sleepWindowProvider: windowSelection.selection?.provider ?? null,
      spo2,
      summaryConfidence,
      timeZone: windowSelection.selection?.timeZone ?? null,
      timeInBedMinutes,
      totalSleepMinutes,
    };
  });
}

function buildBoundedSleepWindowEvidence(
  windows: readonly WearableSleepWindowCandidate[],
  selectedWindow: WearableSleepWindowCandidate | null,
): {
  omittedCount: number;
  omittedExactDuplicateCount: number;
  windows: WearableSleepWindowEvidence[];
} {
  const ordered = [...windows].sort((left, right) => {
    const leftIsSelected = left.candidateId === selectedWindow?.candidateId;
    const rightIsSelected = right.candidateId === selectedWindow?.candidateId;
    if (leftIsSelected !== rightIsSelected) return leftIsSelected ? -1 : 1;
    return compareSleepWindowEvidence(left, right);
  });
  const retained = ordered.slice(0, MAX_SLEEP_WINDOW_EVIDENCE_PER_SUMMARY);
  const omitted = ordered.slice(MAX_SLEEP_WINDOW_EVIDENCE_PER_SUMMARY);

  return {
    omittedCount: omitted.length + ordered.reduce(
      (count, window) => count + (window.evidenceOmittedCount ?? 0),
      0,
    ),
    omittedExactDuplicateCount: omitted.reduce(
      (count, window) => count + (window.exactDuplicateCount ?? 0),
      ordered.reduce(
        (count, window) => count + (window.evidenceOmittedExactDuplicateCount ?? 0),
        0,
      ),
    ),
    windows: retained.map((window) => ({
      date: window.date,
      durationMinutes: window.durationMinutes,
      endAt: window.endAt,
      exactDuplicateCount: window.exactDuplicateCount ?? 0,
      provider: resolveSleepWindowPublicProvider(window),
      recordedAt: window.recordedAt,
      sleepType: window.sleepType ?? (window.nap ? "nap" : "unknown"),
      startAt: window.startAt,
      timeZone: window.timeZone ?? null,
    })),
  };
}

function compareSleepWindowEvidence(
  left: WearableSleepWindowCandidate,
  right: WearableSleepWindowCandidate,
): number {
  return (left.startAt ?? "").localeCompare(right.startAt ?? "")
    || (left.endAt ?? "").localeCompare(right.endAt ?? "")
    || resolveSleepWindowPublicProvider(left).localeCompare(resolveSleepWindowPublicProvider(right))
    || left.candidateId.localeCompare(right.candidateId);
}

function buildPublicSleepWindowConflictNotes(
  sleepWindows: readonly WearableSleepWindowCandidate[],
  selectedWindow: WearableSleepWindowCandidate | null,
): string[] {
  if (!selectedWindow) {
    return [];
  }

  const selectedPublicProvider = resolveSleepWindowPublicProvider(selectedWindow);
  const comparableSleepWindows = sleepWindows.filter((window) =>
    sleepWindowComparableToSelection(window, selectedWindow)
  );
  const conflictingPublicProviders = uniqueStrings(
    comparableSleepWindows
      .filter((window) => window.candidateId !== selectedWindow.candidateId)
      .filter((window) =>
        Math.abs(window.durationMinutes - selectedWindow.durationMinutes) > resolveMetricTolerance("sessionMinutes")
      )
      .map(resolveSleepWindowPublicProvider)
      .filter((provider) => provider !== selectedPublicProvider),
  ).sort();
  const samePublicProviderConflict = comparableSleepWindows
    .filter((window) => window.candidateId !== selectedWindow.candidateId)
    .some((window) =>
      resolveSleepWindowPublicProvider(window) === selectedPublicProvider
      && Math.abs(window.durationMinutes - selectedWindow.durationMinutes) > resolveMetricTolerance("sessionMinutes")
    );

  const notes: string[] = [];

  if (conflictingPublicProviders.length > 0) {
    notes.push(`Sleep windows differed across ${conflictingPublicProviders.map(formatProviderName).join(", ")}.`);
  }

  if (samePublicProviderConflict) {
    notes.push(`Duplicate sleep-window evidence from ${formatProviderName(selectedPublicProvider)} disagreed after source reconciliation.`);
  }

  return notes;
}

function resolveSessionMinutesForSleepWindows(
  selectedWindow: WearableSleepWindowCandidate | null,
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableResolvedMetric {
  const comparableSleepWindows = selectedWindow
    ? sleepWindows.filter((window) => sleepWindowComparableToSelection(window, selectedWindow))
    : sleepWindows;
  const windowCandidates = comparableSleepWindows.map((window) => buildSleepWindowMetricCandidate(window));

  if (!selectedWindow) {
    return resolveMetric("sessionMinutes", windowCandidates, { metricFamily: "sleep" });
  }

  const selectedSessionMinutes = resolveMetric(
    "sessionMinutes",
    [buildSleepWindowMetricCandidate(selectedWindow)],
    { metricFamily: "sleep" },
  );

  return attachSleepWindowConflictEvidence(selectedSessionMinutes, windowCandidates);
}

function sleepWindowComparableToSelection(
  candidate: WearableSleepWindowCandidate,
  selected: WearableSleepWindowCandidate,
): boolean {
  const candidateIsNap = candidate.sleepType === "nap" || candidate.nap;
  const selectedIsNap = selected.sleepType === "nap" || selected.nap;
  return candidateIsNap === selectedIsNap;
}

function attachSleepWindowConflictEvidence(
  resolved: WearableResolvedMetric,
  windowCandidates: readonly WearableMetricCandidate[],
): WearableResolvedMetric {
  if (resolved.selection.value === null) {
    return resolved;
  }

  const selectedRecordIds = new Set(resolved.selection.recordIds);
  const selectedCandidate = windowCandidates.find((candidate) =>
    candidate.recordIds.some((recordId) => selectedRecordIds.has(recordId))
  ) ?? windowCandidates.find((candidate) => candidate.provider === resolved.selection.provider)
    ?? null;
  const candidates = uniqueMetricCandidates([
    ...resolved.candidates,
    ...windowCandidates,
  ]);
  const conflictingProviders = selectedCandidate
    ? uniqueStrings(
        windowCandidates
          .filter((candidate) => candidate.candidateId !== selectedCandidate.candidateId)
          .filter((candidate) =>
            Math.abs(candidate.value - (resolved.selection.value ?? candidate.value)) > resolveMetricTolerance("sessionMinutes")
          )
          .map((candidate) => candidate.provider),
      ).sort()
    : [];
  const conflictReasons = conflictingProviders.length > 0
    ? [`Conflicting values remained from ${conflictingProviders.map(formatProviderName).join(", ")}.`]
    : [];

  return {
    ...resolved,
    candidates,
    confidence: {
      ...resolved.confidence,
      candidateCount: candidates.length,
      conflictingProviders,
      level: downgradeConfidenceForConflict(resolved.confidence.level, conflictingProviders.length > 0),
      reasons: uniqueStrings([
        ...resolved.confidence.reasons,
        ...conflictReasons,
      ]),
    },
  };
}

function uniqueMetricCandidates(candidates: readonly WearableMetricCandidate[]): WearableMetricCandidate[] {
  const seen = new Set<string>();
  const unique: WearableMetricCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) {
      continue;
    }

    seen.add(candidate.candidateId);
    unique.push(candidate);
  }

  return unique;
}

function downgradeConfidenceForConflict(
  level: WearableConfidenceLevel,
  hasConflict: boolean,
): WearableConfidenceLevel {
  if (!hasConflict || level === "none" || level === "low") {
    return level;
  }

  return "medium";
}

function resolveSleepWindowPublicProvider(window: WearableSleepWindowCandidate): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: window.dataOrigin ?? null,
    externalRef: window.externalRef,
    provider: window.provider,
  }, {
    suppressJunctionSourceInstanceFallback: true,
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
    dataset.metricCandidates.filter((candidate) =>
      metricSetHas(RECOVERY_METRIC_KEYS, candidate.metric) || candidate.metric === "lowestHeartRate"
    ),
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
    const restingHeartRate = withMetricFallback(
      resolveMetric("restingHeartRate", selectMetricCandidates(dateCandidates, "restingHeartRate"), {
        metricFamily: "cardio",
      }),
      resolveMetric("lowestHeartRate", selectMetricCandidates(dateCandidates, "lowestHeartRate"), {
        metricFamily: "sleep",
      }),
      "Used lowest sleep heart rate because no explicit resting heart rate metric was available.",
    );
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
    const leanBodyMassKg = resolveMetric("leanBodyMassKg", selectMetricCandidates(dateCandidates, "leanBodyMassKg"), {
      metricFamily: "body",
    });
    const temperature = resolveMetric("temperature", selectMetricCandidates(dateCandidates, "temperature"), {
      metricFamily: "temperature",
    });
    const waistCircumference = resolveMetric("waistCircumference", selectMetricCandidates(dateCandidates, "waistCircumference"), {
      metricFamily: "body",
    });
    const summaryConfidence = summarizeMetricsConfidence([
      ["weightKg", weightKg],
      ["bodyFatPercentage", bodyFatPercentage],
      ["bmi", bmi],
      ["leanBodyMassKg", leanBodyMassKg],
      ["temperature", temperature],
      ["waistCircumference", waistCircumference],
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
      leanBodyMassKg,
      notes,
      summaryConfidence,
      temperature,
      waistCircumference,
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
  { metric: "leanBodyMassKg", summaryKind: "bodyState" },
  { metric: "waistCircumference", summaryKind: "bodyState" },
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

export function summarizeWearableSleepPattern(
  vault: VaultReadModel,
  filters: WearableSleepPatternFilters = {},
): WearableSleepPatternSummary {
  return summarizeWearableSleepPatternFromBundle(
    buildWearableSummaryBundle(vault, resolveWearableSleepPatternReadFilters(filters)),
    filters,
  );
}

export function summarizeWearableSleepPatternFromBundle(
  bundle: ProjectedWearableSummaryBundle,
  filters?: WearableSleepPatternFilters,
  context?: WearableSleepPatternBuildContext,
): WearableSleepPatternSummary;
export function summarizeWearableSleepPatternFromBundle(
  bundle: WearableSummaryBundle,
  filters?: WearableSleepPatternFilters,
  context?: WearableSleepPatternBuildContext,
): WearableSleepPatternSummary;
export function summarizeWearableSleepPatternFromBundle(
  bundle: WearableSummaryBundle,
  filters: WearableSleepPatternFilters = {},
  context: WearableSleepPatternBuildContext = {},
): WearableSleepPatternSummary {
  return buildWearableSleepPatternSummary(bundle, filters, context);
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
