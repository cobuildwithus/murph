import {
  summarizeActivityNotes,
  summarizeBodyStateNotes,
  summarizeRecoveryNotes,
} from "./summaries.ts";
import { summarizeMetricsConfidence } from "./confidence.ts";
import { resolveWearablePublicSourceProvider } from "./origin.ts";
import {
  formatMetricLabel,
  formatProviderName,
  resolveMetricTolerance,
} from "./provider-policy.ts";
import { normalizeLowercaseString, uniqueStrings } from "./shared.ts";
import type {
  WearableActivityDay,
  WearableBodyStateDay,
  WearableMetricCandidate,
  WearableMetricKey,
  WearableRecoveryDay,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSummaryConfidence,
} from "./types.ts";
import {
  ACTIVITY_BRANCH_SCOPED_METRIC_KEYS,
  ACTIVITY_METRIC_KEYS,
  BODY_METRIC_KEYS,
  isActivitySummaryMetricCandidate,
  RECOVERY_METRIC_KEYS,
  SLEEP_METRIC_KEYS,
} from "./types.ts";

export function projectWearableActivityDayPublicSources(day: WearableActivityDay): WearableActivityDay {
  const steps = projectWearableResolvedMetricPublicSources(day.steps);
  const activityMinutes = projectWearableResolvedMetricPublicSources(day.activityMinutes);
  const lowActivityMinutes = projectWearableResolvedMetricPublicSources(day.lowActivityMinutes);
  const mediumActivityMinutes = projectWearableResolvedMetricPublicSources(day.mediumActivityMinutes);
  const highActivityMinutes = projectWearableResolvedMetricPublicSources(day.highActivityMinutes);
  const activeCalories = projectWearableResolvedMetricPublicSources(day.activeCalories);
  const activityAverageHeartRate = projectWearableResolvedMetricPublicSources(day.activityAverageHeartRate);
  const totalCalories = projectWearableResolvedMetricPublicSources(day.totalCalories);
  const distanceKm = projectWearableResolvedMetricPublicSources(day.distanceKm);
  const floorsClimbed = projectWearableResolvedMetricPublicSources(day.floorsClimbed);
  const totalElevationGainMeters = projectWearableResolvedMetricPublicSources(day.totalElevationGainMeters);
  const altitudeChangeMeters = projectWearableResolvedMetricPublicSources(day.altitudeChangeMeters);
  const estimatedVo2Max = projectWearableResolvedMetricPublicSources(day.estimatedVo2Max);
  const activityScore = projectWearableResolvedMetricPublicSources(day.activityScore);
  const dayStrain = projectWearableResolvedMetricPublicSources(day.dayStrain);
  const workoutStrain = projectWearableResolvedMetricPublicSources(day.workoutStrain);
  const maxHeartRate = projectWearableResolvedMetricPublicSources(day.maxHeartRate);
  const averageHeartRate = projectWearableResolvedMetricPublicSources(day.averageHeartRate);
  const walkingAverageHeartRate = projectWearableResolvedMetricPublicSources(day.walkingAverageHeartRate);
  const lowestHeartRate = projectWearableResolvedMetricPublicSources(day.lowestHeartRate);
  const percentRecorded = projectWearableResolvedMetricPublicSources(day.percentRecorded);
  const sessionMinutes = projectWearableResolvedMetricPublicSources(day.sessionMinutes);
  const sessionCount = projectWearableResolvedMetricPublicSources(day.sessionCount);
  const metrics: ReadonlyArray<readonly [string, WearableResolvedMetric]> = [
    ["steps", steps],
    ["activityMinutes", activityMinutes],
    ["lowActivityMinutes", lowActivityMinutes],
    ["mediumActivityMinutes", mediumActivityMinutes],
    ["highActivityMinutes", highActivityMinutes],
    ["activeCalories", activeCalories],
    ["activityAverageHeartRate", activityAverageHeartRate],
    ["totalCalories", totalCalories],
    ["distanceKm", distanceKm],
    ["floorsClimbed", floorsClimbed],
    ["totalElevationGainMeters", totalElevationGainMeters],
    ["altitudeChangeMeters", altitudeChangeMeters],
    ["estimatedVo2Max", estimatedVo2Max],
    ["activityScore", activityScore],
    ["dayStrain", dayStrain],
    ["workoutStrain", workoutStrain],
    ["maxHeartRate", maxHeartRate],
    ["averageHeartRate", averageHeartRate],
    ["walkingAverageHeartRate", walkingAverageHeartRate],
    ["lowestHeartRate", lowestHeartRate],
    ["percentRecorded", percentRecorded],
    ["sessionMinutes", sessionMinutes],
    ["sessionCount", sessionCount],
  ];
  const summaryConfidence = rebuildPublicSummaryConfidence(
    metrics,
    day.summaryConfidence,
    "No activity summary metrics were available for this date.",
  );

  return {
    ...day,
    activityAverageHeartRate,
    activityScore,
    activeCalories,
    activityMinutes,
    altitudeChangeMeters,
    averageHeartRate,
    dayStrain,
    distanceKm,
    estimatedVo2Max,
    floorsClimbed,
    heartRateZones: (day.heartRateZones ?? []).map((zone) => ({ ...zone })),
    highActivityMinutes,
    lowActivityMinutes,
    lowestHeartRate,
    maxHeartRate,
    mediumActivityMinutes,
    notes: projectSummaryNotes({
      metrics: metrics.map(([, metric]) => metric),
      originalNotes: day.notes,
      originalSummaryConfidence: day.summaryConfidence,
      summaryConfidence,
      fallbackNotes: summarizeActivityNotes({
        activityTypes: day.activityTypes,
        sessionCount,
        sessionMinutes,
        summaryConfidence,
      }),
    }),
    percentRecorded,
    sessionCount,
    sessionMinutes,
    steps,
    summaryConfidence,
    totalCalories,
    totalElevationGainMeters,
    walkingAverageHeartRate,
    workoutStrain,
    walkingAverageHeartRate,
  };
}

export function projectWearableSleepNightPublicSources(night: WearableSleepNight): WearableSleepNight {
  const sourceMetrics = [
    night.averageHeartRate,
    night.awakeMinutes,
    night.deepMinutes,
    night.hrv,
    night.lightMinutes,
    night.lowestHeartRate,
    night.lowestSpo2,
    night.remMinutes,
    night.respiratoryRate,
    night.sessionMinutes,
    night.sleepConsistency,
    night.sleepEfficiency,
    night.sleepLatencyMinutes,
    night.sleepPerformance,
    night.sleepScore,
    night.spo2,
    night.timeInBedMinutes,
    night.totalSleepMinutes,
  ];
  const averageHeartRate = projectWearableResolvedMetricPublicSources(night.averageHeartRate);
  const awakeMinutes = projectWearableResolvedMetricPublicSources(night.awakeMinutes);
  const deepMinutes = projectWearableResolvedMetricPublicSources(night.deepMinutes);
  const hrv = projectWearableResolvedMetricPublicSources(night.hrv);
  const lightMinutes = projectWearableResolvedMetricPublicSources(night.lightMinutes);
  const lowestHeartRate = projectWearableResolvedMetricPublicSources(night.lowestHeartRate);
  const lowestSpo2 = projectWearableResolvedMetricPublicSources(night.lowestSpo2);
  const remMinutes = projectWearableResolvedMetricPublicSources(night.remMinutes);
  const respiratoryRate = projectWearableResolvedMetricPublicSources(night.respiratoryRate);
  const sessionMinutes = projectWearableResolvedMetricPublicSources(night.sessionMinutes);
  const sleepConsistency = projectWearableResolvedMetricPublicSources(night.sleepConsistency);
  const sleepEfficiency = projectWearableResolvedMetricPublicSources(night.sleepEfficiency);
  const sleepLatencyMinutes = projectWearableResolvedMetricPublicSources(night.sleepLatencyMinutes);
  const sleepPerformance = projectWearableResolvedMetricPublicSources(night.sleepPerformance);
  const sleepScore = projectWearableResolvedMetricPublicSources(night.sleepScore);
  const spo2 = projectWearableResolvedMetricPublicSources(night.spo2);
  const timeInBedMinutes = projectWearableResolvedMetricPublicSources(night.timeInBedMinutes);
  const totalSleepMinutes = projectWearableResolvedMetricPublicSources(night.totalSleepMinutes);
  const metrics: ReadonlyArray<readonly [string, WearableResolvedMetric]> = [
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
  ];
  const projectedMetrics = metrics.map(([, metric]) => metric);
  const rawSummaryConfidence = rebuildPublicSummaryConfidence(
    metrics,
    night.summaryConfidence,
    "No sleep metrics were available for this date.",
  );
  const sleepProviderTextEntries = buildMetricProviderTextProjectionEntries(sourceMetrics);
  const summaryConfidence = {
    ...rawSummaryConfidence,
    notes: rawSummaryConfidence.notes
      .filter((note) => !isSleepWindowSelectionNote(note))
      .map((note) => projectProviderTextPublicSources(note, sleepProviderTextEntries)),
  };

  return {
    ...night,
    averageHeartRate,
    awakeMinutes,
    deepMinutes,
    hrv,
    lightMinutes,
    lowestHeartRate,
    lowestSpo2,
    notes: projectSummaryNotes({
      metrics: projectedMetrics,
      originalNotes: night.notes,
      originalSummaryConfidence: night.summaryConfidence,
      summaryConfidence,
      filterOriginalNote: (note) => !isSleepWindowSelectionNote(note),
      projectOriginalNote: (note) => projectProviderTextPublicSources(note, sleepProviderTextEntries),
      fallbackNotes: buildPublicSleepWindowNotes(night, sessionMinutes.selection.provider),
    }),
    provider: sessionMinutes.selection.provider,
    remMinutes,
    respiratoryRate,
    sessionMinutes,
    sleepConsistency,
    sleepEfficiency,
    sleepLatencyMinutes,
    sleepPerformance,
    sleepScore,
    sleepWindowProvider: sessionMinutes.selection.provider,
    spo2,
    summaryConfidence,
    timeInBedMinutes,
    totalSleepMinutes,
  };
}

export function projectWearableRecoveryDayPublicSources(day: WearableRecoveryDay): WearableRecoveryDay {
  const recoveryScore = projectWearableResolvedMetricPublicSources(day.recoveryScore);
  const readinessScore = projectWearableResolvedMetricPublicSources(day.readinessScore);
  const restingHeartRate = projectWearableResolvedMetricPublicSources(day.restingHeartRate);
  const hrv = projectWearableResolvedMetricPublicSources(day.hrv);
  const respiratoryRate = projectWearableResolvedMetricPublicSources(day.respiratoryRate);
  const spo2 = projectWearableResolvedMetricPublicSources(day.spo2);
  const temperatureDeviation = projectWearableResolvedMetricPublicSources(day.temperatureDeviation);
  const temperature = projectWearableResolvedMetricPublicSources(day.temperature);
  const bodyBattery = projectWearableResolvedMetricPublicSources(day.bodyBattery);
  const stressLevel = projectWearableResolvedMetricPublicSources(day.stressLevel);
  const metrics: ReadonlyArray<readonly [string, WearableResolvedMetric]> = [
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
  ];
  const summaryConfidence = rebuildPublicSummaryConfidence(
    metrics,
    day.summaryConfidence,
    "No recovery metrics were available for this date.",
  );

  return {
    ...day,
    bodyBattery,
    hrv,
    notes: projectSummaryNotes({
      metrics: metrics.map(([, metric]) => metric),
      originalNotes: day.notes,
      originalSummaryConfidence: day.summaryConfidence,
      summaryConfidence,
      fallbackNotes: summarizeRecoveryNotes({
        readinessScore,
        recoveryScore,
        summaryConfidence,
      }),
    }),
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
}

export function projectWearableBodyStateDayPublicSources(day: WearableBodyStateDay): WearableBodyStateDay {
  const weightKg = projectWearableResolvedMetricPublicSources(day.weightKg);
  const bodyFatPercentage = projectWearableResolvedMetricPublicSources(day.bodyFatPercentage);
  const bodyWaterPercentage = projectWearableResolvedMetricPublicSources(day.bodyWaterPercentage);
  const boneMassPercentage = projectWearableResolvedMetricPublicSources(day.boneMassPercentage);
  const bmi = projectWearableResolvedMetricPublicSources(day.bmi);
  const leanBodyMassKg = projectWearableResolvedMetricPublicSources(day.leanBodyMassKg);
  const muscleMassPercentage = projectWearableResolvedMetricPublicSources(day.muscleMassPercentage);
  const temperature = projectWearableResolvedMetricPublicSources(day.temperature);
  const visceralFatIndex = projectWearableResolvedMetricPublicSources(day.visceralFatIndex);
  const waistCircumference = projectWearableResolvedMetricPublicSources(day.waistCircumference);
  const metrics: ReadonlyArray<readonly [string, WearableResolvedMetric]> = [
    ["weightKg", weightKg],
    ["bodyFatPercentage", bodyFatPercentage],
    ["bodyWaterPercentage", bodyWaterPercentage],
    ["boneMassPercentage", boneMassPercentage],
    ["bmi", bmi],
    ["leanBodyMassKg", leanBodyMassKg],
    ["muscleMassPercentage", muscleMassPercentage],
    ["temperature", temperature],
    ["visceralFatIndex", visceralFatIndex],
    ["waistCircumference", waistCircumference],
  ];
  const summaryConfidence = rebuildPublicSummaryConfidence(
    metrics,
    day.summaryConfidence,
    "No body-state metrics were available for this date.",
  );

  return {
    ...day,
    bmi,
    bodyFatPercentage,
    bodyWaterPercentage,
    boneMassPercentage,
    notes: projectSummaryNotes({
      metrics: metrics.map(([, metric]) => metric),
      originalNotes: day.notes,
      originalSummaryConfidence: day.summaryConfidence,
      summaryConfidence,
      fallbackNotes: summarizeBodyStateNotes({
        bodyFatPercentage,
        summaryConfidence,
        weightKg,
      }),
    }),
    leanBodyMassKg,
    muscleMassPercentage,
    summaryConfidence,
    temperature,
    visceralFatIndex,
    waistCircumference,
    weightKg,
  };
}

function projectWearableResolvedMetricPublicSources(
  resolved: WearableResolvedMetric,
): WearableResolvedMetric {
  const selectedCandidate = selectMetricSelectionCandidate(resolved);
  const titleProjectionEntries = buildProviderTextProjectionEntries(resolved.candidates);
  const selectionTitleProjectionEntries = selectedCandidate
    ? buildProviderTextProjectionEntries([selectedCandidate])
    : titleProjectionEntries;
  const selectionProvider = resolved.selection.provider
    ? selectedCandidate
      ? resolvePublicSourceProvider(selectedCandidate)
      : resolveWearablePublicSourceProvider({ provider: resolved.selection.provider })
    : null;
  const confidenceCandidates = selectPublicConfidenceCandidates(resolved, selectedCandidate);
  const publicConflictingProviders = collectPublicConflictingProviders(
    resolved,
    confidenceCandidates,
    selectedCandidate,
    selectionProvider,
  );
  const sameSourceDisagreement = hasSamePublicSourceDisagreement(
    resolved,
    confidenceCandidates,
    selectedCandidate,
    selectionProvider,
  );
  const publicAgreeingProviders = collectPublicAgreeingProviders(resolved, confidenceCandidates);
  const conflictingProviders = uniqueStrings([
    ...publicConflictingProviders,
    ...(sameSourceDisagreement && selectionProvider ? [selectionProvider] : []),
  ]).sort();

  return {
    ...resolved,
    candidates: resolved.candidates.map((candidate) => {
      const {
        reconciliationDurationConsistent: _reconciliationDurationConsistent,
        reconciliationExactKey: _reconciliationExactKey,
        workoutMetricContributors: _workoutMetricContributors,
        ...publicCandidate
      } = candidate;
      return {
        ...publicCandidate,
        provider: resolvePublicSourceProvider(candidate),
        title: projectWearableMetricCandidateTitle(resolved.metric, candidate),
      };
    }),
    confidence: {
      ...resolved.confidence,
      conflictingProviders,
      level: projectPublicMetricConfidenceLevel(resolved.confidence.level, conflictingProviders.length > 0),
      reasons: projectMetricConfidenceReasons({
        candidates: resolved.candidates,
        publicAgreeingProviders,
        publicConflictingProviders,
        sameSourceDisagreement,
        selectedPublicProvider: selectionProvider,
        sourceReasons: resolved.confidence.reasons,
      }),
    },
    selection: {
      ...resolved.selection,
      provider: selectionProvider,
      title: selectedCandidate
        ? projectWearableMetricCandidateTitle(resolved.metric, selectedCandidate)
        : projectProviderTextPublicSources(resolved.selection.title, selectionTitleProjectionEntries),
    },
  };
}

function projectWearableMetricCandidateTitle(
  metric: string,
  candidate: WearableMetricCandidate,
): string | null {
  const activityMetric = isActivitySummaryMetricCandidate(candidate)
    ? [...ACTIVITY_METRIC_KEYS].find((key) => key === metric)
    : undefined;
  if (activityMetric && !isActivitySessionOwnedCandidate(candidate)) {
    return `${formatProviderName(resolvePublicSourceProvider(candidate))} ${formatMetricLabel(activityMetric)}`;
  }

  return projectProviderTextPublicSources(
    candidate.title,
    buildProviderTextProjectionEntries([candidate]),
  );
}

function isActivitySessionOwnedCandidate(
  candidate: WearableMetricCandidate,
): boolean {
  return candidate.sourceKind === "activity_session"
    || isActivitySessionRollupCandidate(candidate);
}

function rebuildPublicSummaryConfidence(
  metrics: ReadonlyArray<readonly [string, WearableResolvedMetric]>,
  original: WearableSummaryConfidence,
  missingSummaryNote: string,
): WearableSummaryConfidence {
  const extraNotes = original.notes.filter((note) => !isAutoSummaryConfidenceNote(note, missingSummaryNote));

  return summarizeMetricsConfidence(metrics, {
    extraNotes,
    missingSummaryNote,
  });
}

function projectSummaryNotes(input: {
  fallbackNotes?: readonly string[];
  filterOriginalNote?: (note: string) => boolean;
  metrics: readonly WearableResolvedMetric[];
  originalNotes: readonly string[];
  originalSummaryConfidence: WearableSummaryConfidence;
  projectOriginalNote?: (note: string) => string;
  summaryConfidence: WearableSummaryConfidence;
}): string[] {
  const originalSummaryNotes = new Set(input.originalSummaryConfidence.notes);
  const projectedOriginalNotes = input.originalNotes
    .filter((note) => !originalSummaryNotes.has(note))
    .filter((note) => input.filterOriginalNote?.(note) ?? true)
    .map((note) => input.projectOriginalNote?.(note) ?? note);

  return uniqueStrings([
    ...input.summaryConfidence.notes,
    ...(input.fallbackNotes ?? []),
    ...projectedOriginalNotes,
  ]);
}

function buildPublicSleepWindowNotes(
  night: WearableSleepNight,
  publicProvider: string | null,
): string[] {
  if (!publicProvider) {
    return [];
  }

  return [
    `Selected sleep window from ${formatProviderName(publicProvider)} spanning ${night.sleepStartAt ?? "unknown start"} to ${night.sleepEndAt ?? "unknown end"}.`,
  ];
}

function isSleepWindowSelectionNote(note: string): boolean {
  return /^Selected (?:sleep|nap) window from /iu.test(note)
    || /^Selected .*\b(?:sleep|nap) window recorded /iu.test(note);
}

interface ProviderTextProjectionEntry {
  publicLabel: string;
  sourceLabels: readonly string[];
}

function buildMetricProviderTextProjectionEntries(
  metrics: readonly WearableResolvedMetric[],
): ProviderTextProjectionEntry[] {
  return buildProviderTextProjectionEntries(metrics.flatMap((metric) => metric.candidates));
}

function buildProviderTextProjectionEntries(
  candidates: readonly WearableMetricCandidate[],
): ProviderTextProjectionEntry[] {
  const entries: ProviderTextProjectionEntry[] = [];

  for (const candidate of candidates) {
    const publicProvider = resolvePublicSourceProvider(candidate);
    const publicLabel = formatProviderName(publicProvider);
    const sourceLabels = uniqueStrings([
      ...providerTextLabels(candidate.provider),
      ...providerTextLabels(candidate.dataOrigin?.aggregatorProvider),
      ...providerTextLabels(candidate.dataOrigin?.sourceProviderSlug),
    ]).filter((label) => label !== publicLabel);

    if (sourceLabels.length > 0) {
      entries.push({ publicLabel, sourceLabels });
    }
  }

  return entries;
}

function projectProviderTextPublicSources(
  text: string,
  entries: readonly ProviderTextProjectionEntry[],
): string;
function projectProviderTextPublicSources(
  text: null,
  entries: readonly ProviderTextProjectionEntry[],
): null;
function projectProviderTextPublicSources(
  text: string | null,
  entries: readonly ProviderTextProjectionEntry[],
): string | null;
function projectProviderTextPublicSources(
  text: string | null,
  entries: readonly ProviderTextProjectionEntry[],
): string | null {
  if (!text || entries.length === 0) {
    return text;
  }

  let projected = text;
  const publicLabels = uniqueStrings(entries.map((entry) => entry.publicLabel));

  for (const entry of entries) {
    for (const sourceLabel of entry.sourceLabels) {
      projected = replaceProviderToken(projected, sourceLabel, entry.publicLabel);
    }
  }

  for (const publicLabel of publicLabels) {
    projected = collapseRepeatedProviderLabel(projected, publicLabel);
  }

  return projected;
}

function providerTextLabels(provider: unknown): string[] {
  const normalized = normalizeLowercaseString(provider);
  if (!normalized) {
    return [];
  }

  return uniqueStrings([
    formatProviderName(normalized),
    normalized,
    normalized.replace(/_/gu, "-"),
    normalized.replace(/-/gu, "_"),
  ]);
}

function replaceProviderToken(text: string, sourceLabel: string, publicLabel: string): string {
  if (sourceLabel.length === 0 || sourceLabel === publicLabel) {
    return text;
  }

  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(sourceLabel)}(?=$|[^A-Za-z0-9_-])`, "giu");
  return text.replace(pattern, (_match, prefix: string) => `${prefix}${publicLabel}`);
}

function collapseRepeatedProviderLabel(text: string, providerLabel: string): string {
  if (providerLabel.length === 0) {
    return text;
  }

  const escaped = escapeRegExp(providerLabel);
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_-])${escaped}(?:\\s+${escaped})+(?=$|[^A-Za-z0-9_-])`,
    "giu",
  );
  return text.replace(pattern, (_match, prefix: string) => `${prefix}${providerLabel}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function collectPublicConflictingProviders(
  resolved: WearableResolvedMetric,
  candidates: readonly WearableMetricCandidate[],
  selectedCandidate: WearableMetricCandidate | null,
  selectedPublicProvider: string | null,
): string[] {
  if (resolved.selection.value === null || !selectedPublicProvider) {
    return [];
  }

  const selectedValue = resolved.selection.value;
  return uniqueStrings(
    candidates
      .filter((candidate) => candidate.candidateId !== selectedCandidate?.candidateId)
      .filter((candidate) => resolvePublicSourceProvider(candidate) !== selectedPublicProvider)
      .filter((candidate) => !isWithinMetricTolerance(resolved.metric, selectedValue, candidate.value))
      .map(resolvePublicSourceProvider),
  ).sort();
}

function hasSamePublicSourceDisagreement(
  resolved: WearableResolvedMetric,
  candidates: readonly WearableMetricCandidate[],
  selectedCandidate: WearableMetricCandidate | null,
  selectedPublicProvider: string | null,
): boolean {
  if (resolved.selection.value === null || !selectedPublicProvider) {
    return false;
  }

  const selectedValue = resolved.selection.value;
  return candidates
    .filter((candidate) => candidate.candidateId !== selectedCandidate?.candidateId)
    .some((candidate) =>
      resolvePublicSourceProvider(candidate) === selectedPublicProvider
      && !isWithinMetricTolerance(resolved.metric, selectedValue, candidate.value)
    );
}

function collectPublicAgreeingProviders(
  resolved: WearableResolvedMetric,
  candidates: readonly WearableMetricCandidate[],
): string[] {
  if (resolved.selection.value === null) {
    return [];
  }

  const selectedValue = resolved.selection.value;
  return uniqueStrings(
    candidates
      .filter((candidate) => isWithinMetricTolerance(resolved.metric, selectedValue, candidate.value))
      .map(resolvePublicSourceProvider),
  ).sort();
}

function selectPublicConfidenceCandidates(
  resolved: WearableResolvedMetric,
  selectedCandidate: WearableMetricCandidate | null,
): readonly WearableMetricCandidate[] {
  if (
    !selectedCandidate
    || !isWearableMetricKey(resolved.metric)
    || !ACTIVITY_BRANCH_SCOPED_METRIC_KEYS.has(resolved.metric)
  ) {
    return resolved.candidates;
  }

  const selectedIsWorkoutRollup = isActivitySessionRollupCandidate(selectedCandidate);
  return resolved.candidates.filter((candidate) =>
    isActivitySessionRollupCandidate(candidate) === selectedIsWorkoutRollup
  );
}

function isActivitySessionRollupCandidate(candidate: WearableMetricCandidate): boolean {
  return candidate.sourceKind === "activity-session-aggregate"
    || candidate.sourceKind === "activity-session-day-rollup";
}

function projectMetricConfidenceReasons(input: {
  candidates: readonly WearableMetricCandidate[];
  publicAgreeingProviders: readonly string[];
  publicConflictingProviders: readonly string[];
  sameSourceDisagreement: boolean;
  selectedPublicProvider: string | null;
  sourceReasons: readonly string[];
}): string[] {
  const reasons = input.sourceReasons.flatMap((reason): string[] => {
    if (reason.startsWith("Conflicting values remained from ")) {
      const projectedConflictReasons: string[] = [];

      if (input.publicConflictingProviders.length > 0) {
        projectedConflictReasons.push(
          `Conflicting values remained from ${input.publicConflictingProviders.map(formatProviderName).join(", ")}.`,
        );
      }

      if (input.sameSourceDisagreement && input.selectedPublicProvider) {
        projectedConflictReasons.push(
          `Duplicate evidence from ${formatProviderName(input.selectedPublicProvider)} disagreed after source reconciliation.`,
        );
      }

      return projectedConflictReasons;
    }

    if (reason.startsWith("Providers agreed within tolerance: ")) {
      return input.publicAgreeingProviders.length > 1
        ? [`Providers agreed within tolerance: ${input.publicAgreeingProviders.map(formatProviderName).join(", ")}.`]
        : [];
    }

    return [projectMetricEvidenceReasonPublicProviders(reason, input.candidates)];
  });

  if (input.publicConflictingProviders.length > 0) {
    reasons.push(`Conflicting values remained from ${input.publicConflictingProviders.map(formatProviderName).join(", ")}.`);
  }

  if (input.sameSourceDisagreement && input.selectedPublicProvider) {
    reasons.push(
      `Duplicate evidence from ${formatProviderName(input.selectedPublicProvider)} disagreed after source reconciliation.`,
    );
  }

  return uniqueStrings(reasons);
}

function projectPublicMetricConfidenceLevel(
  level: WearableResolvedMetric["confidence"]["level"],
  hasPublicConflict: boolean,
): WearableResolvedMetric["confidence"]["level"] {
  if (!hasPublicConflict || level === "none" || level === "low") {
    return level;
  }

  return "medium";
}

function projectMetricEvidenceReasonPublicProviders(
  reason: string,
  candidates: readonly WearableMetricCandidate[],
): string {
  let projected = reason;
  const replacements = buildMetricEvidenceLabelReplacements(candidates);

  for (const replacement of replacements) {
    if (replacement.sourceLabel !== replacement.publicLabel) {
      projected = projected.replaceAll(replacement.sourceLabel, replacement.publicLabel);
    }
  }

  return projected;
}

function buildMetricEvidenceLabelReplacements(
  candidates: readonly WearableMetricCandidate[],
): Array<{ publicLabel: string; sourceLabel: string }> {
  const replacementGroups = new Map<string, {
    candidate: WearableMetricCandidate;
    publicProviders: Set<string>;
  }>();

  for (const candidate of candidates) {
    const sourceLabel = formatMetricEvidenceLabel(candidate, candidate.provider);
    const publicProvider = resolvePublicSourceProvider(candidate);
    const group = replacementGroups.get(sourceLabel);
    if (group) {
      group.publicProviders.add(publicProvider);
      continue;
    }

    replacementGroups.set(sourceLabel, {
      candidate,
      publicProviders: new Set([publicProvider]),
    });
  }

  return [...replacementGroups.entries()].map(([sourceLabel, group]) => {
    const publicProviders = [...group.publicProviders].sort();
    const publicLabel = publicProviders.length === 1
      ? formatMetricEvidenceLabel(group.candidate, publicProviders[0]!)
      : formatAmbiguousMetricEvidenceLabel(group.candidate, publicProviders);

    return {
      publicLabel,
      sourceLabel,
    };
  });
}

function formatMetricEvidenceLabel(candidate: WearableMetricCandidate, provider: string): string {
  const timestamp = candidate.recordedAt ?? candidate.occurredAt ?? "unknown time";
  return `${formatProviderName(provider)} ${candidate.sourceKind} recorded ${timestamp}`;
}

function formatAmbiguousMetricEvidenceLabel(
  candidate: WearableMetricCandidate,
  publicProviders: readonly string[],
): string {
  const timestamp = candidate.recordedAt ?? candidate.occurredAt ?? "unknown time";
  const providerLabel = publicProviders.map(formatProviderName).join("/");
  return `${providerLabel} ${candidate.sourceKind} recorded ${timestamp}`;
}

function selectMetricSelectionCandidate(resolved: WearableResolvedMetric): WearableMetricCandidate | null {
  const selectedRecordIds = new Set(resolved.selection.recordIds);

  return resolved.candidates.find((candidate) =>
    candidate.provider === resolved.selection.provider
    && candidate.recordIds.some((recordId) => selectedRecordIds.has(recordId))
  )
    ?? resolved.candidates.find((candidate) => candidate.recordIds.some((recordId) => selectedRecordIds.has(recordId)))
    ?? resolved.candidates.find((candidate) => candidate.provider === resolved.selection.provider)
    ?? resolved.candidates[0]
    ?? null;
}

function resolvePublicSourceProvider(candidate: WearableMetricCandidate): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: candidate.dataOrigin ?? null,
    externalRef: candidate.externalRef,
    provider: candidate.provider,
  }, {
    suppressJunctionSourceInstanceFallback: true,
  });
}

function isAutoSummaryConfidenceNote(note: string, missingSummaryNote: string): boolean {
  return note === missingSummaryNote
    || note.startsWith("Selected evidence came from ")
    || note.startsWith("Some metrics still conflict across providers:");
}

function isWithinMetricTolerance(metric: string, left: number, right: number): boolean {
  const tolerance = isWearableMetricKey(metric) ? resolveMetricTolerance(metric) : 0;
  return Math.abs(left - right) <= tolerance;
}

function isWearableMetricKey(metric: string): metric is WearableMetricKey {
  return ALL_WEARABLE_METRIC_KEYS.has(metric);
}

const ALL_WEARABLE_METRIC_KEYS: ReadonlySet<string> = new Set([
  ...ACTIVITY_METRIC_KEYS,
  ...BODY_METRIC_KEYS,
  ...RECOVERY_METRIC_KEYS,
  ...SLEEP_METRIC_KEYS,
]);
