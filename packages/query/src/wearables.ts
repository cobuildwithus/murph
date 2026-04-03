import { extractIsoDatePrefix } from "@murphai/contracts";

import type { CanonicalEntity } from "./canonical-entities.ts";
import type { VaultReadModel } from "./model.ts";

export type WearableConfidenceLevel = "none" | "low" | "medium" | "high";
export type WearableCandidateSourceFamily = "event" | "sample" | "derived";

export interface WearableExternalRef {
  system: string | null;
  resourceType: string | null;
  resourceId: string | null;
  version: string | null;
  facet: string | null;
}

export interface WearableMetricCandidate {
  candidateId: string;
  date: string;
  externalRef: WearableExternalRef | null;
  metric: string;
  occurredAt: string | null;
  paths: string[];
  provider: string;
  recordedAt: string | null;
  recordIds: string[];
  sourceFamily: WearableCandidateSourceFamily;
  sourceKind: string;
  title: string | null;
  unit: string | null;
  value: number;
}

export interface WearableMetricSelection {
  occurredAt: string | null;
  paths: string[];
  provider: string | null;
  recordedAt: string | null;
  recordIds: string[];
  sourceFamily: WearableCandidateSourceFamily | null;
  sourceKind: string | null;
  title: string | null;
  unit: string | null;
  value: number | null;
}

export interface WearableMetricConfidence {
  candidateCount: number;
  conflictingProviders: string[];
  exactDuplicateCount: number;
  level: WearableConfidenceLevel;
  reasons: string[];
}

export interface WearableResolvedMetric {
  candidates: WearableMetricCandidate[];
  confidence: WearableMetricConfidence;
  metric: string;
  selection: WearableMetricSelection;
}

export interface WearableSummaryConfidence {
  conflictingMetrics: string[];
  level: WearableConfidenceLevel;
  lowConfidenceMetrics: string[];
  notes: string[];
  selectedProviders: string[];
}

export interface WearableActivityDay {
  activityScore: WearableResolvedMetric;
  activeCalories: WearableResolvedMetric;
  activityTypes: string[];
  date: string;
  dayStrain: WearableResolvedMetric;
  distanceKm: WearableResolvedMetric;
  notes: string[];
  sessionCount: WearableResolvedMetric;
  sessionMinutes: WearableResolvedMetric;
  steps: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
}

export interface WearableSleepNight {
  averageHeartRate: WearableResolvedMetric;
  awakeMinutes: WearableResolvedMetric;
  date: string;
  deepMinutes: WearableResolvedMetric;
  hrv: WearableResolvedMetric;
  lightMinutes: WearableResolvedMetric;
  lowestHeartRate: WearableResolvedMetric;
  notes: string[];
  remMinutes: WearableResolvedMetric;
  respiratoryRate: WearableResolvedMetric;
  sessionMinutes: WearableResolvedMetric;
  sleepEfficiency: WearableResolvedMetric;
  sleepEndAt: string | null;
  sleepPerformance: WearableResolvedMetric;
  sleepScore: WearableResolvedMetric;
  sleepStartAt: string | null;
  sleepWindowProvider: string | null;
  sleepConsistency: WearableResolvedMetric;
  spo2: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
  timeInBedMinutes: WearableResolvedMetric;
  totalSleepMinutes: WearableResolvedMetric;
}

export interface WearableRecoveryDay {
  bodyBattery: WearableResolvedMetric;
  date: string;
  hrv: WearableResolvedMetric;
  notes: string[];
  readinessScore: WearableResolvedMetric;
  recoveryScore: WearableResolvedMetric;
  respiratoryRate: WearableResolvedMetric;
  restingHeartRate: WearableResolvedMetric;
  spo2: WearableResolvedMetric;
  stressLevel: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
  temperature: WearableResolvedMetric;
  temperatureDeviation: WearableResolvedMetric;
}

export interface WearableBodyStateDay {
  bmi: WearableResolvedMetric;
  bodyFatPercentage: WearableResolvedMetric;
  date: string;
  notes: string[];
  summaryConfidence: WearableSummaryConfidence;
  temperature: WearableResolvedMetric;
  weightKg: WearableResolvedMetric;
}

export interface WearableSourceHealth {
  activityDays: number;
  bodyStateDays: number;
  candidateMetrics: number;
  conflictCount: number;
  exactDuplicatesSuppressed: number;
  firstDate: string | null;
  lastDate: string | null;
  latestRecordedAt: string | null;
  metricsContributed: string[];
  notes: string[];
  provider: string;
  providerDisplayName: string;
  recoveryDays: number;
  selectedMetrics: number;
  sleepNights: number;
  stalenessVsNewestDays: number | null;
}

export interface WearableAssistantSummary {
  bodyState: WearableBodyStateDay | null;
  date: string | null;
  from: string | null;
  highlights: string[];
  latestDate: string | null;
  providers: string[];
  recovery: WearableRecoveryDay | null;
  sleep: WearableSleepNight | null;
  sourceHealth: WearableSourceHealth[];
  to: string | null;
  activity: WearableActivityDay | null;
}

export interface WearableFilters {
  date?: string;
  from?: string;
  providers?: string[];
  to?: string;
}

export interface WearableSummaryFilters extends WearableFilters {
  limit?: number;
}

export type WearableActivitySummary = WearableActivityDay;
export type WearableSleepSummary = WearableSleepNight;
export type WearableRecoverySummary = WearableRecoveryDay;
export type WearableBodyStateSummary = WearableBodyStateDay;
export type WearableSourceHealthSummary = WearableSourceHealth;
export type WearableMetricValue = WearableResolvedMetric;

export interface WearableDaySummary {
  activity: WearableActivityDay | null;
  bodyState: WearableBodyStateDay | null;
  date: string;
  notes: string[];
  providers: string[];
  recovery: WearableRecoveryDay | null;
  sleep: WearableSleepNight | null;
  sourceHealth: WearableSourceHealth[];
  summaryConfidence: WearableConfidenceLevel;
}

interface WearableSleepWindowCandidate {
  candidateId: string;
  date: string;
  durationMinutes: number;
  endAt: string | null;
  nap: boolean;
  occurredAt: string | null;
  paths: string[];
  provider: string;
  recordedAt: string | null;
  recordIds: string[];
  sourceFamily: WearableCandidateSourceFamily;
  sourceKind: string;
  startAt: string | null;
  title: string | null;
}

interface WearableActivitySessionAggregate {
  activityTypes: string[];
  candidateId: string;
  date: string;
  paths: string[];
  provider: string;
  recordedAt: string | null;
  recordIds: string[];
  sessionCount: number;
  sessionMinutes: number;
}

interface WearableDataset {
  activitySessionAggregates: readonly WearableActivitySessionAggregate[];
  metricCandidates: readonly WearableMetricCandidate[];
  rawMetricCandidates: readonly WearableMetricCandidate[];
  sleepWindows: readonly WearableSleepWindowCandidate[];
}

type WearableMetricKey =
  | "activeCalories"
  | "activityScore"
  | "averageHeartRate"
  | "awakeMinutes"
  | "bmi"
  | "bodyBattery"
  | "bodyFatPercentage"
  | "dayStrain"
  | "deepMinutes"
  | "distanceKm"
  | "hrv"
  | "lightMinutes"
  | "lowestHeartRate"
  | "readinessScore"
  | "recoveryScore"
  | "remMinutes"
  | "respiratoryRate"
  | "restingHeartRate"
  | "sessionCount"
  | "sessionMinutes"
  | "sleepConsistency"
  | "sleepEfficiency"
  | "sleepPerformance"
  | "sleepScore"
  | "spo2"
  | "steps"
  | "stressLevel"
  | "temperature"
  | "temperatureDeviation"
  | "timeInBedMinutes"
  | "totalSleepMinutes"
  | "weightKg";

const PROVIDER_DISPLAY_NAMES = {
  garmin: "Garmin",
  oura: "Oura",
  whoop: "WHOOP",
} as const;

const METRIC_PROVIDER_PREFERENCES: Readonly<Partial<Record<WearableMetricKey, readonly string[]>>> = {
  activeCalories: ["garmin", "oura", "whoop"],
  activityScore: ["oura", "garmin", "whoop"],
  averageHeartRate: ["oura", "whoop", "garmin"],
  awakeMinutes: ["oura", "whoop", "garmin"],
  bmi: ["garmin", "oura", "whoop"],
  bodyBattery: ["garmin", "oura", "whoop"],
  bodyFatPercentage: ["garmin", "oura", "whoop"],
  dayStrain: ["whoop", "garmin", "oura"],
  deepMinutes: ["oura", "whoop", "garmin"],
  distanceKm: ["garmin", "oura", "whoop"],
  hrv: ["oura", "whoop", "garmin"],
  lightMinutes: ["oura", "whoop", "garmin"],
  lowestHeartRate: ["oura", "garmin", "whoop"],
  readinessScore: ["oura", "whoop", "garmin"],
  recoveryScore: ["whoop", "oura", "garmin"],
  remMinutes: ["oura", "whoop", "garmin"],
  respiratoryRate: ["oura", "whoop", "garmin"],
  restingHeartRate: ["whoop", "garmin", "oura"],
  sessionCount: ["garmin", "whoop", "oura"],
  sessionMinutes: ["oura", "garmin", "whoop"],
  sleepConsistency: ["whoop", "oura", "garmin"],
  sleepEfficiency: ["oura", "whoop", "garmin"],
  sleepPerformance: ["whoop", "oura", "garmin"],
  sleepScore: ["oura", "garmin", "whoop"],
  spo2: ["oura", "whoop", "garmin"],
  steps: ["garmin", "oura", "whoop"],
  stressLevel: ["garmin", "whoop", "oura"],
  temperature: ["whoop", "garmin", "oura"],
  temperatureDeviation: ["oura", "whoop", "garmin"],
  timeInBedMinutes: ["oura", "garmin", "whoop"],
  totalSleepMinutes: ["oura", "whoop", "garmin"],
  weightKg: ["garmin", "oura", "whoop"],
};

const SLEEP_METRIC_KEYS = new Set<WearableMetricKey>([
  "averageHeartRate",
  "awakeMinutes",
  "deepMinutes",
  "hrv",
  "lightMinutes",
  "lowestHeartRate",
  "remMinutes",
  "respiratoryRate",
  "sessionMinutes",
  "sleepConsistency",
  "sleepEfficiency",
  "sleepPerformance",
  "sleepScore",
  "spo2",
  "timeInBedMinutes",
  "totalSleepMinutes",
]);

const RECOVERY_METRIC_KEYS = new Set<WearableMetricKey>([
  "bodyBattery",
  "hrv",
  "readinessScore",
  "recoveryScore",
  "respiratoryRate",
  "restingHeartRate",
  "spo2",
  "stressLevel",
  "temperature",
  "temperatureDeviation",
]);

const BODY_METRIC_KEYS = new Set<WearableMetricKey>([
  "bmi",
  "bodyFatPercentage",
  "temperature",
  "weightKg",
]);

const ACTIVITY_METRIC_KEYS = new Set<WearableMetricKey>([
  "activeCalories",
  "activityScore",
  "dayStrain",
  "distanceKm",
  "sessionCount",
  "sessionMinutes",
  "steps",
]);

export function listWearableActivityDays(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableActivityDay[] {
  const dataset = collectWearableDataset(vault, filters);
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => ACTIVITY_METRIC_KEYS.has(candidate.metric as WearableMetricKey)),
  );
  const activitySessionAggregatesByDate = groupActivitySessionAggregatesByDate(dataset.activitySessionAggregates);
  const dates = collectSortedDatesDesc([
    ...metricCandidatesByDate.keys(),
    ...activitySessionAggregatesByDate.keys(),
  ]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const aggregates = activitySessionAggregatesByDate.get(date) ?? [];
    const activityTypes = resolveSelectedActivityTypes(aggregates);
    const steps = resolveMetric("steps", selectMetricCandidates(dateCandidates, "steps"));
    const activeCalories = resolveMetric(
      "activeCalories",
      selectMetricCandidates(dateCandidates, "activeCalories"),
    );
    const distanceKm = resolveMetric("distanceKm", selectMetricCandidates(dateCandidates, "distanceKm"));
    const activityScore = resolveMetric(
      "activityScore",
      selectMetricCandidates(dateCandidates, "activityScore"),
    );
    const dayStrain = resolveMetric("dayStrain", selectMetricCandidates(dateCandidates, "dayStrain"));
    const sessionMinutes = resolveMetric(
      "sessionMinutes",
      aggregates.map((aggregate) => toAggregateMetricCandidate(aggregate, "sessionMinutes")),
    );
    const sessionCount = resolveMetric(
      "sessionCount",
      aggregates.map((aggregate) => toAggregateMetricCandidate(aggregate, "sessionCount")),
    );
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
      date,
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
  const dataset = collectWearableDataset(vault, filters);
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => SLEEP_METRIC_KEYS.has(candidate.metric as WearableMetricKey)),
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
      sleepWindows.map((window) => toSleepWindowMetricCandidate(window)),
    );
    const totalSleepMinutes = withSleepFallback(
      resolveMetric("totalSleepMinutes", selectMetricCandidates(dateCandidates, "totalSleepMinutes")),
      sessionMinutes,
      "Used the selected sleep session duration because no direct total-sleep metric was available.",
    );
    const timeInBedMinutes = withSleepFallback(
      resolveMetric("timeInBedMinutes", selectMetricCandidates(dateCandidates, "timeInBedMinutes")),
      sessionMinutes,
      "Used the selected sleep session duration because no explicit time-in-bed metric was available.",
    );
    const sleepEfficiency = resolveMetric(
      "sleepEfficiency",
      selectMetricCandidates(dateCandidates, "sleepEfficiency"),
    );
    const awakeMinutes = resolveMetric("awakeMinutes", selectMetricCandidates(dateCandidates, "awakeMinutes"));
    const lightMinutes = resolveMetric("lightMinutes", selectMetricCandidates(dateCandidates, "lightMinutes"));
    const deepMinutes = resolveMetric("deepMinutes", selectMetricCandidates(dateCandidates, "deepMinutes"));
    const remMinutes = resolveMetric("remMinutes", selectMetricCandidates(dateCandidates, "remMinutes"));
    const sleepScore = resolveMetric("sleepScore", selectMetricCandidates(dateCandidates, "sleepScore"));
    const sleepPerformance = resolveMetric(
      "sleepPerformance",
      selectMetricCandidates(dateCandidates, "sleepPerformance"),
    );
    const sleepConsistency = resolveMetric(
      "sleepConsistency",
      selectMetricCandidates(dateCandidates, "sleepConsistency"),
    );
    const averageHeartRate = resolveMetric(
      "averageHeartRate",
      selectMetricCandidates(dateCandidates, "averageHeartRate"),
    );
    const lowestHeartRate = resolveMetric(
      "lowestHeartRate",
      selectMetricCandidates(dateCandidates, "lowestHeartRate"),
    );
    const hrv = resolveMetric("hrv", selectMetricCandidates(dateCandidates, "hrv"));
    const respiratoryRate = resolveMetric(
      "respiratoryRate",
      selectMetricCandidates(dateCandidates, "respiratoryRate"),
    );
    const spo2 = resolveMetric("spo2", selectMetricCandidates(dateCandidates, "spo2"));
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
      date,
      summaryConfidence,
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
  const dataset = collectWearableDataset(vault, filters);
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => RECOVERY_METRIC_KEYS.has(candidate.metric as WearableMetricKey)),
  );
  const dates = collectSortedDatesDesc([...metricCandidatesByDate.keys()]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const recoveryScore = resolveMetric(
      "recoveryScore",
      selectMetricCandidates(dateCandidates, "recoveryScore"),
    );
    const readinessScore = resolveMetric(
      "readinessScore",
      selectMetricCandidates(dateCandidates, "readinessScore"),
    );
    const restingHeartRate = resolveMetric(
      "restingHeartRate",
      selectMetricCandidates(dateCandidates, "restingHeartRate"),
    );
    const hrv = resolveMetric("hrv", selectMetricCandidates(dateCandidates, "hrv"));
    const respiratoryRate = resolveMetric(
      "respiratoryRate",
      selectMetricCandidates(dateCandidates, "respiratoryRate"),
    );
    const spo2 = resolveMetric("spo2", selectMetricCandidates(dateCandidates, "spo2"));
    const temperatureDeviation = resolveMetric(
      "temperatureDeviation",
      selectMetricCandidates(dateCandidates, "temperatureDeviation"),
    );
    const temperature = resolveMetric(
      "temperature",
      selectMetricCandidates(dateCandidates, "temperature"),
    );
    const bodyBattery = resolveMetric(
      "bodyBattery",
      selectMetricCandidates(dateCandidates, "bodyBattery"),
    );
    const stressLevel = resolveMetric(
      "stressLevel",
      selectMetricCandidates(dateCandidates, "stressLevel"),
    );
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
      date,
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
  const dataset = collectWearableDataset(vault, filters);
  const metricCandidatesByDate = groupMetricCandidatesByDate(
    dataset.metricCandidates.filter((candidate) => BODY_METRIC_KEYS.has(candidate.metric as WearableMetricKey)),
  );
  const dates = collectSortedDatesDesc([...metricCandidatesByDate.keys()]);

  return dates.map((date) => {
    const dateCandidates = metricCandidatesByDate.get(date) ?? [];
    const weightKg = resolveMetric("weightKg", selectMetricCandidates(dateCandidates, "weightKg"));
    const bodyFatPercentage = resolveMetric(
      "bodyFatPercentage",
      selectMetricCandidates(dateCandidates, "bodyFatPercentage"),
    );
    const bmi = resolveMetric("bmi", selectMetricCandidates(dateCandidates, "bmi"));
    const temperature = resolveMetric(
      "temperature",
      selectMetricCandidates(dateCandidates, "temperature"),
    );
    const summaryConfidence = summarizeMetricsConfidence([
      ["weightKg", weightKg],
      ["bodyFatPercentage", bodyFatPercentage],
      ["bmi", bmi],
      ["temperature", temperature],
    ], {
      missingSummaryNote: "No body-state metrics were available for this date.",
    });
    const notes = summarizeBodyStateNotes({
      bmi,
      bodyFatPercentage,
      date,
      summaryConfidence,
      temperature,
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

export function listWearableSourceHealth(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableSourceHealth[] {
  const dataset = collectWearableDataset(vault, filters);
  const activityDays = listWearableActivityDays(vault, filters);
  const sleepNights = listWearableSleepNights(vault, filters);
  const recoveryDays = listWearableRecoveryDays(vault, filters);
  const bodyStateDays = listWearableBodyStateDays(vault, filters);

  const providers = uniqueStrings([
    ...dataset.metricCandidates.map((candidate) => candidate.provider),
    ...dataset.activitySessionAggregates.map((candidate) => candidate.provider),
    ...dataset.sleepWindows.map((candidate) => candidate.provider),
  ]);

  const latestDate = collectLatestDate([
    ...dataset.metricCandidates.map((candidate) => candidate.date),
    ...dataset.activitySessionAggregates.map((candidate) => candidate.date),
    ...dataset.sleepWindows.map((candidate) => candidate.date),
  ]);

  const duplicateCountsByProvider = countExactDuplicatesByProvider([
    ...dataset.rawMetricCandidates,
    ...dataset.activitySessionAggregates.flatMap((aggregate) => [
      toAggregateMetricCandidate(aggregate, "sessionMinutes"),
      toAggregateMetricCandidate(aggregate, "sessionCount"),
    ]),
    ...dataset.sleepWindows.map((window) => toSleepWindowMetricCandidate(window)),
  ]);

  const selectedMetricsByProvider = countSelectedMetricsByProvider([
    ...activityDays.flatMap((day) => [
      day.steps,
      day.activeCalories,
      day.distanceKm,
      day.activityScore,
      day.dayStrain,
      day.sessionMinutes,
      day.sessionCount,
    ]),
    ...sleepNights.flatMap((night) => [
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
    ...recoveryDays.flatMap((day) => [
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
    ...bodyStateDays.flatMap((day) => [
      day.weightKg,
      day.bodyFatPercentage,
      day.bmi,
      day.temperature,
    ]),
  ]);

  const conflictCountsByProvider = countConflictsByProvider([
    ...activityDays.flatMap((day) => [
      day.steps,
      day.activeCalories,
      day.distanceKm,
      day.activityScore,
      day.dayStrain,
      day.sessionMinutes,
      day.sessionCount,
    ]),
    ...sleepNights.flatMap((night) => [
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
    ...recoveryDays.flatMap((day) => [
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
    ...bodyStateDays.flatMap((day) => [
      day.weightKg,
      day.bodyFatPercentage,
      day.bmi,
      day.temperature,
    ]),
  ]);

  return providers
    .map((provider) => {
      const providerMetricCandidates = dataset.metricCandidates.filter((candidate) => candidate.provider === provider);
      const providerActivitySessionAggregates = dataset.activitySessionAggregates.filter(
        (candidate) => candidate.provider === provider,
      );
      const providerSleepWindows = dataset.sleepWindows.filter((candidate) => candidate.provider === provider);
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
        notes.push(`${formatProviderName(provider)} trails the newest wearable source by ${stalenessVsNewestDays} day${stalenessVsNewestDays === 1 ? "" : "s"}.`);
      }

      if ((selectedMetricsByProvider.get(provider) ?? 0) === 0) {
        notes.push(`${formatProviderName(provider)} contributed candidate evidence but was not the preferred source for any selected metric in this filtered range.`);
      }

      const metricsContributed = uniqueStrings([
        ...providerMetricCandidates.map((candidate) => candidate.metric),
        ...(providerActivitySessionAggregates.length > 0
          ? ["sessionCount", "sessionMinutes"]
          : []),
        ...(providerSleepWindows.length > 0
          ? ["sessionMinutes", "timeInBedMinutes", "totalSleepMinutes"]
          : []),
      ]).sort();

      return {
        activityDays: activityMetricDays.size,
        bodyStateDays: bodyMetricDays.size,
        candidateMetrics: providerMetricCandidates.length + providerActivitySessionAggregates.length + providerSleepWindows.length,
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
}

export function buildWearableAssistantSummary(
  vault: VaultReadModel,
  filters: WearableFilters = {},
): WearableAssistantSummary {
  const activityDays = listWearableActivityDays(vault, filters);
  const sleepNights = listWearableSleepNights(vault, filters);
  const recoveryDays = listWearableRecoveryDays(vault, filters);
  const bodyStateDays = listWearableBodyStateDays(vault, filters);
  const sourceHealth = listWearableSourceHealth(vault, filters);
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
    highlights.push(`Source freshness differs across providers: ${laggingProviders.map((entry) => `${entry.providerDisplayName} +${entry.stalenessVsNewestDays}d`).join(", ")}.`);
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
  const sleep = listWearableSleepNights(vault, dayFilters)[0] ?? null;
  const activity = listWearableActivityDays(vault, dayFilters)[0] ?? null;
  const recovery = listWearableRecoveryDays(vault, dayFilters)[0] ?? null;
  const bodyState = listWearableBodyStateDays(vault, dayFilters)[0] ?? null;
  const sourceHealth = listWearableSourceHealth(vault, dayFilters);

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

function collectWearableDataset(
  vault: VaultReadModel,
  filters: WearableFilters,
): WearableDataset {
  const rawMetricCandidates: WearableMetricCandidate[] = [];
  const activitySessions: WearableMetricCandidate[] = [];
  const sleepStageCandidates: WearableMetricCandidate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];
  const providerSet = filters.providers ? new Set(filters.providers.map((provider) => provider.trim().toLowerCase()).filter(Boolean)) : null;

  for (const entity of [...vault.events, ...vault.samples]) {
    const externalRef = readExternalRef(entity.attributes.externalRef);
    const provider = normalizeLowercaseString(externalRef?.system);

    if (!provider) {
      continue;
    }

    if (providerSet && !providerSet.has(provider)) {
      continue;
    }

    if (entity.family === "sample") {
      if (entity.stream === "sleep_stage") {
        const candidate = buildSleepStageCandidate(entity, provider, externalRef);

        if (candidate && matchesDateFilters(candidate.date, filters)) {
          sleepStageCandidates.push(candidate);
        }

        continue;
      }

      const candidates = buildSampleMetricCandidates(entity, provider, externalRef);
      for (const candidate of candidates) {
        if (matchesDateFilters(candidate.date, filters)) {
          rawMetricCandidates.push(candidate);
        }
      }

      continue;
    }

    if (entity.family !== "event") {
      continue;
    }

    if (entity.kind === "observation") {
      const candidates = buildObservationMetricCandidates(entity, provider, externalRef);
      for (const candidate of candidates) {
        if (matchesDateFilters(candidate.date, filters)) {
          rawMetricCandidates.push(candidate);
        }
      }
      continue;
    }

    if (entity.kind === "activity_session") {
      const candidate = buildActivitySessionCandidate(entity, provider, externalRef);
      if (candidate && matchesDateFilters(candidate.date, filters)) {
        activitySessions.push(candidate);
      }
      continue;
    }

    if (entity.kind === "sleep_session") {
      const candidate = buildSleepWindowCandidate(entity, provider, externalRef);
      if (candidate && matchesDateFilters(candidate.date, filters)) {
        sleepWindows.push(candidate);
      }
    }
  }

  const metricCandidates = [
    ...dedupeExactMetricCandidates(rawMetricCandidates).candidates,
    ...dedupeExactMetricCandidates(buildSleepStageAggregateCandidates(sleepStageCandidates)).candidates,
  ].sort(compareMetricCandidateByDateDesc);

  return {
    activitySessionAggregates: buildActivitySessionAggregates(activitySessions),
    metricCandidates,
    rawMetricCandidates,
    sleepWindows: dedupeSleepWindowCandidates(sleepWindows),
  };
}

function buildSampleMetricCandidates(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate[] {
  const value = readNumber(entity.attributes.value);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });

  if (value === null || !date) {
    return [];
  }

  const base = createMetricCandidateBase(entity, provider, externalRef, date, "sample", entity.stream ?? "sample");

  switch (entity.stream) {
    case "steps":
      return [
        {
          ...base,
          metric: "steps",
          unit: "count",
          value,
        },
      ];
    case "hrv":
      return [
        {
          ...base,
          metric: "hrv",
          unit: normalizeUnit(entity.attributes.unit) ?? "ms",
          value,
        },
      ];
    case "respiratory_rate":
      return [
        {
          ...base,
          metric: "respiratoryRate",
          unit: normalizeUnit(entity.attributes.unit) ?? "breaths_per_minute",
          value,
        },
      ];
    case "temperature":
      return [
        {
          ...base,
          metric: "temperature",
          unit: normalizeUnit(entity.attributes.unit) ?? "celsius",
          value,
        },
      ];
    case "heart_rate":
      return [
        {
          ...base,
          metric: "averageHeartRate",
          unit: normalizeUnit(entity.attributes.unit) ?? "bpm",
          value,
        },
      ];
    default:
      return [];
  }
}

function buildObservationMetricCandidates(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate[] {
  const rawMetric = normalizeLowercaseString(entity.attributes.metric);
  const rawValue = readNumber(entity.attributes.value);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });

  if (!rawMetric || rawValue === null || !date) {
    return [];
  }

  const mapped = mapObservationMetric(rawMetric, rawValue, normalizeUnit(entity.attributes.unit));
  if (!mapped) {
    return [];
  }

  const base = createMetricCandidateBase(entity, provider, externalRef, date, "event", `observation:${rawMetric}`);

  return [
    {
      ...base,
      metric: mapped.metric,
      unit: mapped.unit,
      value: mapped.value,
    },
  ];
}

function buildActivitySessionCandidate(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate | null {
  const durationMinutes = readNumber(entity.attributes.durationMinutes);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: false,
  });

  if (durationMinutes === null || !date) {
    return null;
  }

  return {
    ...createMetricCandidateBase(entity, provider, externalRef, date, "event", "activity_session"),
    metric: "sessionMinutes",
    unit: "minutes",
    value: durationMinutes,
  };
}

function buildSleepWindowCandidate(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableSleepWindowCandidate | null {
  const durationMinutes = readNumber(entity.attributes.durationMinutes);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });
  if (durationMinutes === null || !date) {
    return null;
  }

  const title = normalizeNullableString(entity.title) ?? normalizeNullableString(entity.attributes.title);

  return {
    candidateId: buildCandidateId([
      provider,
      date,
      "sleep-window",
      externalRef?.resourceType ?? "",
      externalRef?.resourceId ?? entity.entityId,
      normalizeNullableString(entity.attributes.startAt) ?? entity.occurredAt ?? "",
    ]),
    date,
    durationMinutes,
    endAt: normalizeNullableString(entity.attributes.endAt),
    nap: (title ?? "").toLowerCase().includes("nap"),
    occurredAt: entity.occurredAt ?? null,
    paths: [entity.path],
    provider,
    recordedAt: normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null,
    recordIds: [entity.entityId],
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: normalizeNullableString(entity.attributes.startAt) ?? entity.occurredAt ?? null,
    title,
  };
}

function buildSleepStageCandidate(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate | null {
  const stage = normalizeLowercaseString(entity.attributes.stage);
  const durationMinutes = readNumber(entity.attributes.durationMinutes);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });

  if (!stage || durationMinutes === null || !date) {
    return null;
  }

  const mappedMetric = mapSleepStageToMetric(stage);
  if (!mappedMetric) {
    return null;
  }

  return {
    ...createMetricCandidateBase(entity, provider, externalRef, date, "sample", `sleep_stage:${stage}`),
    metric: mappedMetric,
    unit: "minutes",
    value: durationMinutes,
  };
}

function buildActivitySessionAggregates(
  candidates: readonly WearableMetricCandidate[],
): WearableActivitySessionAggregate[] {
  const grouped = new Map<string, WearableActivitySessionAggregate>();

  for (const candidate of dedupeExactMetricCandidates(candidates).candidates) {
    const key = `${candidate.date}:${candidate.provider}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
      existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
      existing.sessionMinutes += candidate.value;
      existing.sessionCount += 1;
      const activityType = normalizeActivityTypeFromTitle(candidate.title);
      if (activityType && !existing.activityTypes.includes(activityType)) {
        existing.activityTypes.push(activityType);
        existing.activityTypes.sort();
      }
      existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
      continue;
    }

    grouped.set(key, {
      activityTypes: normalizeActivityTypeFromTitle(candidate.title)
        ? [normalizeActivityTypeFromTitle(candidate.title)!]
        : [],
      candidateId: buildCandidateId([candidate.provider, candidate.date, "activity-session-aggregate"]),
      date: candidate.date,
      paths: [...candidate.paths],
      provider: candidate.provider,
      recordedAt: candidate.recordedAt,
      recordIds: [...candidate.recordIds],
      sessionCount: 1,
      sessionMinutes: candidate.value,
    });
  }

  return [...grouped.values()].sort(compareAggregateByDateDesc);
}

function buildSleepStageAggregateCandidates(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  const grouped = new Map<string, WearableMetricCandidate>();

  for (const candidate of dedupeExactMetricCandidates(candidates).candidates) {
    const key = `${candidate.date}:${candidate.provider}:${candidate.metric}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
      existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
      existing.value += candidate.value;
      existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
      continue;
    }

    grouped.set(key, {
      ...candidate,
      candidateId: buildCandidateId([candidate.provider, candidate.date, candidate.metric, "sleep-stage-aggregate"]),
      externalRef: null,
      sourceFamily: "derived",
      sourceKind: "sleep-stage-aggregate",
      title: `${formatProviderName(candidate.provider)} sleep stages`,
      value: candidate.value,
    });
  }

  return [...grouped.values()].sort(compareMetricCandidateByDateDesc);
}

function selectMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  metric: WearableMetricKey,
): WearableMetricCandidate[] {
  return candidates.filter((candidate) => candidate.metric === metric);
}

function resolveMetric(
  metric: WearableMetricKey,
  candidates: readonly WearableMetricCandidate[],
): WearableResolvedMetric {
  const deduped = dedupeExactMetricCandidates(candidates);
  const sortedCandidates = [...deduped.candidates].sort((left, right) => compareCandidatesForMetric(metric, left, right));
  const selectionCandidate = sortedCandidates[0] ?? null;
  const conflictingProviders = selectionCandidate
    ? uniqueStrings(
        sortedCandidates
          .filter((candidate) => candidate.provider !== selectionCandidate.provider)
          .filter((candidate) => !isWithinMetricTolerance(metric, selectionCandidate.value, candidate.value))
          .map((candidate) => candidate.provider),
      )
    : [];
  const agreeingProviders = selectionCandidate
    ? uniqueStrings(
        sortedCandidates
          .filter((candidate) => isWithinMetricTolerance(metric, selectionCandidate.value, candidate.value))
          .map((candidate) => candidate.provider),
      )
    : [];
  const reasons: string[] = [];

  if (deduped.exactDuplicateCount > 0) {
    reasons.push(`Suppressed ${deduped.exactDuplicateCount} exact duplicate candidate${deduped.exactDuplicateCount === 1 ? "" : "s"}.`);
  }

  if (selectionCandidate && sortedCandidates.length > 1) {
    const preferredProviders = resolveProviderPreference(metric);
    const selectedRank = resolveProviderPriorityIndex(preferredProviders, selectionCandidate.provider);
    if (selectedRank === 0) {
      reasons.push(`Selected ${formatProviderName(selectionCandidate.provider)} because it is the preferred source for ${formatMetricLabel(metric)} when wearable providers overlap.`);
    }
  }

  if (agreeingProviders.length > 1) {
    reasons.push(`Providers agreed within tolerance: ${agreeingProviders.map(formatProviderName).join(", ")}.`);
  }

  if (conflictingProviders.length > 0) {
    reasons.push(`Conflicting values remained from ${conflictingProviders.map(formatProviderName).join(", ")}.`);
  }

  const confidenceLevel = inferMetricConfidenceLevel({
    candidateCount: sortedCandidates.length,
    conflictingProviders,
    selectionCandidate,
  });

  return {
    candidates: sortedCandidates,
    confidence: {
      candidateCount: sortedCandidates.length,
      conflictingProviders,
      exactDuplicateCount: deduped.exactDuplicateCount,
      level: confidenceLevel,
      reasons,
    },
    metric,
    selection: selectionCandidate
      ? {
          occurredAt: selectionCandidate.occurredAt,
          paths: selectionCandidate.paths,
          provider: selectionCandidate.provider,
          recordedAt: selectionCandidate.recordedAt,
          recordIds: selectionCandidate.recordIds,
          sourceFamily: selectionCandidate.sourceFamily,
          sourceKind: selectionCandidate.sourceKind,
          title: selectionCandidate.title,
          unit: selectionCandidate.unit,
          value: selectionCandidate.value,
        }
      : emptyMetricSelection(),
  };
}

function withSleepFallback(
  metric: WearableResolvedMetric,
  fallback: WearableResolvedMetric,
  reason: string,
): WearableResolvedMetric {
  if (metric.selection.value !== null || fallback.selection.value === null) {
    return metric;
  }

  return {
    candidates: [...fallback.candidates],
    confidence: {
      ...fallback.confidence,
      reasons: [reason, ...fallback.confidence.reasons],
    },
    metric: metric.metric,
    selection: {
      ...fallback.selection,
    },
  };
}

function resolveSleepWindowSelection(
  candidates: readonly WearableSleepWindowCandidate[],
): {
  confidence: WearableMetricConfidence;
  selection: WearableSleepWindowCandidate | null;
} {
  const sorted = [...candidates].sort(compareSleepWindows);
  const selection = sorted[0] ?? null;
  const conflictingProviders = selection
    ? uniqueStrings(
        sorted
          .filter((candidate) => candidate.provider !== selection.provider)
          .filter((candidate) => !isWithinMetricTolerance("sessionMinutes", candidate.durationMinutes, selection.durationMinutes))
          .map((candidate) => candidate.provider),
      )
    : [];
  const reasons: string[] = [];

  if (selection && sorted.length > 1) {
    const selectedRank = resolveProviderPriorityIndex(
      resolveProviderPreference("sessionMinutes"),
      selection.provider,
    );
    if (selectedRank === 0) {
      reasons.push(`Selected the ${formatProviderName(selection.provider)} sleep window because that provider is preferred for primary nightly sleep summaries.`);
    }
  }

  if (conflictingProviders.length > 0) {
    reasons.push(`Sleep windows differed across ${conflictingProviders.map(formatProviderName).join(", ")}.`);
  }

  return {
    confidence: {
      candidateCount: sorted.length,
      conflictingProviders,
      exactDuplicateCount: 0,
      level: inferMetricConfidenceLevel({
        candidateCount: sorted.length,
        conflictingProviders,
        selectionCandidate: selection
          ? {
              candidateId: selection.candidateId,
              date: selection.date,
              externalRef: null,
              metric: "sessionMinutes",
              occurredAt: selection.occurredAt,
              paths: selection.paths,
              provider: selection.provider,
              recordedAt: selection.recordedAt,
              recordIds: selection.recordIds,
              sourceFamily: selection.sourceFamily,
              sourceKind: selection.sourceKind,
              title: selection.title,
              unit: "minutes",
              value: selection.durationMinutes,
            }
          : null,
      }),
      reasons,
    },
    selection,
  };
}

function summarizeMetricsConfidence(
  metrics: ReadonlyArray<readonly [string, WearableResolvedMetric]>,
  options: {
    extraNotes?: readonly string[];
    missingSummaryNote: string;
  },
): WearableSummaryConfidence {
  const selectedProviders = uniqueStrings(
    metrics
      .map(([, metric]) => metric.selection.provider)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const selectedMetrics = metrics.filter(([, metric]) => metric.selection.value !== null);
  const conflictingMetrics = metrics
    .filter(([, metric]) => metric.confidence.conflictingProviders.length > 0)
    .map(([metric]) => metric);
  const lowConfidenceMetrics = metrics
    .filter(([, metric]) => metric.confidence.level === "low")
    .map(([metric]) => metric);
  const notes: string[] = [];

  if (selectedMetrics.length === 0) {
    notes.push(options.missingSummaryNote);
  } else if (selectedProviders.length > 0) {
    notes.push(`Selected evidence came from ${selectedProviders.map(formatProviderName).join(", ")}.`);
  }

  if (conflictingMetrics.length > 0) {
    notes.push(`Some metrics still conflict across providers: ${conflictingMetrics.map(formatMetricLabel).join(", ")}.`);
  }

  notes.push(...(options.extraNotes ?? []));

  const level: WearableConfidenceLevel = selectedMetrics.length === 0
    ? "none"
    : lowConfidenceMetrics.length > 0
      ? "low"
      : conflictingMetrics.length > 0
        ? "medium"
        : selectedMetrics.every(([, metric]) => metric.confidence.level === "high")
          ? "high"
          : "medium";

  return {
    conflictingMetrics,
    level,
    lowConfidenceMetrics,
    notes,
    selectedProviders,
  };
}

function summarizeActivityNotes(input: {
  activityTypes: string[];
  date: string;
  sessionCount: WearableResolvedMetric;
  sessionMinutes: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.sessionCount.selection.value !== null && input.sessionMinutes.selection.value !== null) {
    notes.push(`Selected ${formatMetricValue(input.sessionCount.selection.value, "count")} activity session${input.sessionCount.selection.value === 1 ? "" : "s"} covering ${formatMetricValue(input.sessionMinutes.selection.value, "minutes")}.`);
  }

  if (input.activityTypes.length > 0) {
    notes.push(`Selected activity types: ${input.activityTypes.join(", ")}.`);
  }

  return uniqueStrings(notes);
}

function summarizeSleepNotes(input: {
  date: string;
  summaryConfidence: WearableSummaryConfidence;
  totalSleepMinutes: WearableResolvedMetric;
  windowSelection: {
    confidence: WearableMetricConfidence;
    selection: WearableSleepWindowCandidate | null;
  };
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.windowSelection.selection) {
    notes.push(`Selected sleep window from ${formatProviderName(input.windowSelection.selection.provider)} spanning ${input.windowSelection.selection.startAt ?? "unknown start"} to ${input.windowSelection.selection.endAt ?? "unknown end"}.`);
  }

  if (input.totalSleepMinutes.selection.value !== null) {
    notes.push(`Selected total sleep: ${formatMetricValue(input.totalSleepMinutes.selection.value, "minutes")}.`);
  }

  return uniqueStrings(notes);
}

function summarizeRecoveryNotes(input: {
  date: string;
  readinessScore: WearableResolvedMetric;
  recoveryScore: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.recoveryScore.selection.value !== null) {
    notes.push(`Selected recovery score: ${formatMetricValue(input.recoveryScore.selection.value, "%")}.`);
  }

  if (input.readinessScore.selection.value !== null) {
    notes.push(`Selected readiness score: ${formatMetricValue(input.readinessScore.selection.value, "%")}.`);
  }

  return uniqueStrings(notes);
}

function summarizeBodyStateNotes(input: {
  bmi: WearableResolvedMetric;
  bodyFatPercentage: WearableResolvedMetric;
  date: string;
  summaryConfidence: WearableSummaryConfidence;
  temperature: WearableResolvedMetric;
  weightKg: WearableResolvedMetric;
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.weightKg.selection.value !== null) {
    notes.push(`Selected weight: ${formatMetricValue(input.weightKg.selection.value, "kg")}.`);
  }

  if (input.bodyFatPercentage.selection.value !== null) {
    notes.push(`Selected body-fat percentage: ${formatMetricValue(input.bodyFatPercentage.selection.value, "%")}.`);
  }

  return uniqueStrings(notes);
}

function createMetricCandidateBase(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
  date: string,
  sourceFamily: WearableCandidateSourceFamily,
  sourceKind: string,
): Omit<WearableMetricCandidate, "metric" | "unit" | "value"> {
  return {
    candidateId: buildCandidateId([
      provider,
      date,
      sourceFamily,
      sourceKind,
      externalRef?.resourceType ?? "",
      externalRef?.resourceId ?? entity.entityId,
      externalRef?.facet ?? "",
      normalizeNullableString(entity.occurredAt) ?? normalizeNullableString(entity.attributes.recordedAt) ?? "",
    ]),
    date,
    externalRef,
    occurredAt: entity.occurredAt ?? null,
    paths: [entity.path],
    provider,
    recordedAt: normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null,
    recordIds: [entity.entityId],
    sourceFamily,
    sourceKind,
    title: entity.title ?? normalizeNullableString(entity.attributes.title),
  };
}

function mapObservationMetric(
  metric: string,
  value: number,
  unit: string | null,
): { metric: WearableMetricKey; unit: string | null; value: number } | null {
  switch (metric) {
    case "daily-steps":
      return { metric: "steps", unit: "count", value };
    case "active-calories":
      return { metric: "activeCalories", unit: "kcal", value };
    case "distance":
    case "equivalent-walking-distance":
      return { metric: "distanceKm", unit: "km", value: metersToKilometers(value) };
    case "activity-score":
      return { metric: "activityScore", unit: unit ?? "%", value };
    case "day-strain":
      return { metric: "dayStrain", unit: unit ?? "whoop_strain", value };
    case "sleep-efficiency":
      return { metric: "sleepEfficiency", unit: unit ?? "%", value };
    case "sleep-total-minutes":
      return { metric: "totalSleepMinutes", unit: "minutes", value };
    case "time-in-bed-minutes":
      return { metric: "timeInBedMinutes", unit: "minutes", value };
    case "sleep-awake-minutes":
      return { metric: "awakeMinutes", unit: "minutes", value };
    case "sleep-light-minutes":
      return { metric: "lightMinutes", unit: "minutes", value };
    case "sleep-deep-minutes":
      return { metric: "deepMinutes", unit: "minutes", value };
    case "sleep-rem-minutes":
      return { metric: "remMinutes", unit: "minutes", value };
    case "sleep-score":
      return { metric: "sleepScore", unit: unit ?? "%", value };
    case "sleep-performance":
      return { metric: "sleepPerformance", unit: unit ?? "%", value };
    case "sleep-consistency":
      return { metric: "sleepConsistency", unit: unit ?? "%", value };
    case "recovery-score":
      return { metric: "recoveryScore", unit: unit ?? "%", value };
    case "readiness-score":
      return { metric: "readinessScore", unit: unit ?? "%", value };
    case "resting-heart-rate":
      return { metric: "restingHeartRate", unit: unit ?? "bpm", value };
    case "average-heart-rate":
      return { metric: "averageHeartRate", unit: unit ?? "bpm", value };
    case "lowest-heart-rate":
      return { metric: "lowestHeartRate", unit: unit ?? "bpm", value };
    case "respiratory-rate":
      return { metric: "respiratoryRate", unit: unit ?? "breaths_per_minute", value };
    case "spo2":
      return { metric: "spo2", unit: unit ?? "%", value };
    case "temperature-deviation":
      return { metric: "temperatureDeviation", unit: unit ?? "celsius", value };
    case "body-battery":
      return { metric: "bodyBattery", unit: unit ?? "score", value };
    case "stress-level":
      return { metric: "stressLevel", unit: unit ?? "score", value };
    case "weight":
      return { metric: "weightKg", unit: unit ?? "kg", value };
    case "body-fat-percentage":
      return { metric: "bodyFatPercentage", unit: unit ?? "%", value };
    case "bmi":
      return { metric: "bmi", unit: unit ?? "kg_m2", value };
    default:
      return null;
  }
}

function mapSleepStageToMetric(stage: string): WearableMetricKey | null {
  switch (stage.toLowerCase()) {
    case "awake":
      return "awakeMinutes";
    case "light":
      return "lightMinutes";
    case "deep":
      return "deepMinutes";
    case "rem":
      return "remMinutes";
    default:
      return null;
  }
}

function dedupeExactMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
): {
  candidates: WearableMetricCandidate[];
  exactDuplicateCount: number;
} {
  const deduped = new Map<string, WearableMetricCandidate>();
  let exactDuplicateCount = 0;

  for (const candidate of candidates) {
    const key = buildCandidateExactKey(candidate);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, { ...candidate, paths: [...candidate.paths], recordIds: [...candidate.recordIds] });
      continue;
    }

    exactDuplicateCount += 1;
    existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
    existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
    existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
  }

  return {
    candidates: [...deduped.values()],
    exactDuplicateCount,
  };
}

function dedupeSleepWindowCandidates(
  candidates: readonly WearableSleepWindowCandidate[],
): WearableSleepWindowCandidate[] {
  const deduped = new Map<string, WearableSleepWindowCandidate>();

  for (const candidate of candidates) {
    const key = [
      candidate.provider,
      candidate.date,
      candidate.startAt ?? "",
      candidate.endAt ?? "",
      candidate.durationMinutes,
      candidate.nap ? "nap" : "sleep",
    ].join("|");
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, {
        ...candidate,
        paths: [...candidate.paths],
        recordIds: [...candidate.recordIds],
      });
      continue;
    }

    existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
    existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
    existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
  }

  return [...deduped.values()].sort(compareSleepWindows);
}

function buildCandidateExactKey(candidate: WearableMetricCandidate): string {
  return [
    candidate.provider,
    candidate.date,
    candidate.metric,
    candidate.unit ?? "",
    candidate.value.toFixed(4),
    candidate.sourceFamily,
    candidate.sourceKind,
    candidate.externalRef?.resourceType ?? "",
    candidate.externalRef?.resourceId ?? "",
    candidate.externalRef?.facet ?? "",
    candidate.occurredAt ?? "",
  ].join("|");
}

function compareCandidatesForMetric(
  metric: WearableMetricKey,
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): number {
  const providerPreference = resolveProviderPreference(metric);
  const providerRankDifference = resolveProviderPriorityIndex(providerPreference, left.provider)
    - resolveProviderPriorityIndex(providerPreference, right.provider);
  if (providerRankDifference !== 0) {
    return providerRankDifference;
  }

  const rightResourceScore = resourceTypeScore(metric, right.externalRef?.resourceType);
  const leftResourceScore = resourceTypeScore(metric, left.externalRef?.resourceType);
  if (leftResourceScore !== rightResourceScore) {
    return rightResourceScore - leftResourceScore;
  }

  const sourceFamilyDifference = sourceFamilyScore(right.sourceFamily) - sourceFamilyScore(left.sourceFamily);
  if (sourceFamilyDifference !== 0) {
    return sourceFamilyDifference;
  }

  const timestampDifference = compareIsoDesc(left.recordedAt, right.recordedAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.candidateId.localeCompare(right.candidateId);
}

function compareSleepWindows(
  left: WearableSleepWindowCandidate,
  right: WearableSleepWindowCandidate,
): number {
  if (left.nap !== right.nap) {
    return left.nap ? 1 : -1;
  }

  const providerRankDifference = resolveProviderPriorityIndex(
    resolveProviderPreference("sessionMinutes"),
    left.provider,
  ) - resolveProviderPriorityIndex(resolveProviderPreference("sessionMinutes"), right.provider);
  if (providerRankDifference !== 0) {
    return providerRankDifference;
  }

  if (left.durationMinutes !== right.durationMinutes) {
    return right.durationMinutes - left.durationMinutes;
  }

  return compareIsoDesc(left.recordedAt, right.recordedAt);
}

function compareMetricCandidateByDateDesc(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return left.candidateId.localeCompare(right.candidateId);
}

function compareAggregateByDateDesc(
  left: WearableActivitySessionAggregate,
  right: WearableActivitySessionAggregate,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return left.provider.localeCompare(right.provider);
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

function sourceFamilyScore(family: WearableCandidateSourceFamily): number {
  switch (family) {
    case "event":
      return 3;
    case "sample":
      return 2;
    case "derived":
      return 1;
  }
}

function resourceTypeScore(
  metric: WearableMetricKey,
  resourceType: string | null | undefined,
): number {
  const normalized = normalizeLowercaseString(resourceType);
  if (!normalized) {
    return 0;
  }

  if (SLEEP_METRIC_KEYS.has(metric) && normalized.includes("sleep")) {
    return 4;
  }

  if (RECOVERY_METRIC_KEYS.has(metric) && (normalized.includes("recovery") || normalized.includes("readiness"))) {
    return 4;
  }

  if (ACTIVITY_METRIC_KEYS.has(metric) && (normalized.includes("activity") || normalized.includes("cycle") || normalized.includes("summary"))) {
    return 4;
  }

  if (BODY_METRIC_KEYS.has(metric) && (normalized.includes("body") || normalized.includes("summary"))) {
    return 4;
  }

  return normalized.includes("summary") ? 2 : 1;
}

function resolveProviderPreference(metric: WearableMetricKey): readonly string[] {
  return METRIC_PROVIDER_PREFERENCES[metric] ?? ["garmin", "oura", "whoop"];
}

function resolveProviderPriorityIndex(
  priorities: readonly string[],
  provider: string,
): number {
  const index = priorities.indexOf(provider);
  return index === -1 ? priorities.length + 1 : index;
}

function inferMetricConfidenceLevel(input: {
  candidateCount: number;
  conflictingProviders: string[];
  selectionCandidate: WearableMetricCandidate | null;
}): WearableConfidenceLevel {
  if (!input.selectionCandidate) {
    return "none";
  }

  if (input.candidateCount === 1) {
    return "high";
  }

  if (input.conflictingProviders.length === 0) {
    return "high";
  }

  const selectedRank = resolveProviderPriorityIndex(
    resolveProviderPreference(input.selectionCandidate.metric as WearableMetricKey),
    input.selectionCandidate.provider,
  );

  return selectedRank === 0 ? "medium" : "low";
}

function isWithinMetricTolerance(
  metric: WearableMetricKey,
  left: number,
  right: number,
): boolean {
  return Math.abs(left - right) <= resolveMetricTolerance(metric);
}

function resolveMetricTolerance(metric: WearableMetricKey): number {
  switch (metric) {
    case "steps":
      return 250;
    case "activeCalories":
      return 25;
    case "distanceKm":
      return 0.25;
    case "sessionMinutes":
    case "totalSleepMinutes":
    case "timeInBedMinutes":
    case "awakeMinutes":
    case "lightMinutes":
    case "deepMinutes":
    case "remMinutes":
      return 5;
    case "sessionCount":
      return 0;
    case "activityScore":
    case "sleepEfficiency":
    case "sleepScore":
    case "sleepPerformance":
    case "sleepConsistency":
    case "recoveryScore":
    case "readinessScore":
    case "bodyBattery":
    case "stressLevel":
    case "spo2":
    case "bodyFatPercentage":
      return 1;
    case "averageHeartRate":
    case "lowestHeartRate":
    case "restingHeartRate":
    case "respiratoryRate":
      return 1;
    case "hrv":
      return 3;
    case "temperature":
    case "temperatureDeviation":
      return 0.2;
    case "weightKg":
      return 0.2;
    case "bmi":
      return 0.1;
    case "dayStrain":
      return 0.5;
  }
}

function deriveWearableDate(
  entity: CanonicalEntity,
  externalRef: WearableExternalRef | null,
  options: {
    preferSleepEndAt: boolean;
  },
): string | null {
  const dayKey = normalizeNullableString(entity.attributes.dayKey);
  if (dayKey) {
    return dayKey;
  }

  const resourceType = normalizeLowercaseString(externalRef?.resourceType);
  const startAt = normalizeNullableString(entity.attributes.startAt);
  const endAt = normalizeNullableString(entity.attributes.endAt);
  const recordedAt = normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null;
  const candidates = options.preferSleepEndAt || resourceType?.includes("sleep")
    ? [endAt, recordedAt, entity.occurredAt, startAt, entity.date]
    : [entity.date, recordedAt, entity.occurredAt, endAt, startAt];

  for (const candidate of candidates) {
    const date = extractIsoDatePrefix(candidate);
    if (date) {
      return date;
    }
  }

  return null;
}

function readExternalRef(value: unknown): WearableExternalRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const system = normalizeLowercaseString(record.system);
  const resourceType = normalizeLowercaseString(record.resourceType);
  const resourceId = normalizeNullableString(record.resourceId);

  if (!system || !resourceType || !resourceId) {
    return null;
  }

  return {
    system,
    resourceType,
    resourceId,
    version: normalizeNullableString(record.version),
    facet: normalizeNullableString(record.facet),
  };
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeUnit(value: unknown): string | null {
  return normalizeNullableString(value);
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeLowercaseString(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeActivityTypeFromTitle(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/^(garmin|oura|whoop)\s+/iu, "")
    .replace(/\s+session$/iu, "")
    .trim() || null;
}

function formatProviderName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_DISPLAY_NAMES[normalized as keyof typeof PROVIDER_DISPLAY_NAMES] ?? provider;
}

function formatMetricLabel(metric: string): string {
  return metric
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === "minutes") {
    return `${Math.round(value)} min`;
  }

  if (unit === "kg") {
    return `${value.toFixed(1)} kg`;
  }

  if (unit === "%") {
    return `${Math.round(value)}%`;
  }

  if (unit === "count") {
    return `${Math.round(value)}`;
  }

  if (unit === "km") {
    return `${value.toFixed(2)} km`;
  }

  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))} ${unit}`;
}

function emptyMetricSelection(): WearableMetricSelection {
  return {
    occurredAt: null,
    paths: [],
    provider: null,
    recordedAt: null,
    recordIds: [],
    sourceFamily: null,
    sourceKind: null,
    title: null,
    unit: null,
    value: null,
  };
}

function toAggregateMetricCandidate(
  aggregate: WearableActivitySessionAggregate,
  metric: "sessionMinutes" | "sessionCount",
): WearableMetricCandidate {
  return {
    candidateId: `${aggregate.candidateId}:${metric}`,
    date: aggregate.date,
    externalRef: null,
    metric,
    occurredAt: null,
    paths: [...aggregate.paths],
    provider: aggregate.provider,
    recordedAt: aggregate.recordedAt,
    recordIds: [...aggregate.recordIds],
    sourceFamily: "derived",
    sourceKind: "activity-session-aggregate",
    title: `${formatProviderName(aggregate.provider)} activity sessions`,
    unit: metric === "sessionMinutes" ? "minutes" : "count",
    value: metric === "sessionMinutes" ? aggregate.sessionMinutes : aggregate.sessionCount,
  };
}

function toSleepWindowMetricCandidate(
  window: WearableSleepWindowCandidate,
): WearableMetricCandidate {
  return {
    candidateId: `${window.candidateId}:sessionMinutes`,
    date: window.date,
    externalRef: null,
    metric: "sessionMinutes",
    occurredAt: window.occurredAt,
    paths: [...window.paths],
    provider: window.provider,
    recordedAt: window.recordedAt,
    recordIds: [...window.recordIds],
    sourceFamily: "derived",
    sourceKind: "sleep-window",
    title: window.title,
    unit: "minutes",
    value: window.durationMinutes,
  };
}

function resolveSelectedActivityTypes(
  aggregates: readonly WearableActivitySessionAggregate[],
): string[] {
  if (aggregates.length === 0) {
    return [];
  }

  const sessionMetric = resolveMetric(
    "sessionMinutes",
    aggregates.map((aggregate) => toAggregateMetricCandidate(aggregate, "sessionMinutes")),
  );
  const selectedProvider = sessionMetric.selection.provider;
  if (!selectedProvider) {
    return [];
  }

  const selected = aggregates.find((aggregate) => aggregate.provider === selectedProvider);
  return selected?.activityTypes ?? [];
}

function groupMetricCandidatesByDate(
  candidates: readonly WearableMetricCandidate[],
): Map<string, WearableMetricCandidate[]> {
  const grouped = new Map<string, WearableMetricCandidate[]>();

  for (const candidate of candidates) {
    const existing = grouped.get(candidate.date);
    if (existing) {
      existing.push(candidate);
      continue;
    }

    grouped.set(candidate.date, [candidate]);
  }

  return grouped;
}

function groupActivitySessionAggregatesByDate(
  aggregates: readonly WearableActivitySessionAggregate[],
): Map<string, WearableActivitySessionAggregate[]> {
  const grouped = new Map<string, WearableActivitySessionAggregate[]>();

  for (const aggregate of aggregates) {
    const existing = grouped.get(aggregate.date);
    if (existing) {
      existing.push(aggregate);
      continue;
    }

    grouped.set(aggregate.date, [aggregate]);
  }

  return grouped;
}

function groupSleepWindowsByDate(
  windows: readonly WearableSleepWindowCandidate[],
): Map<string, WearableSleepWindowCandidate[]> {
  const grouped = new Map<string, WearableSleepWindowCandidate[]>();

  for (const window of windows) {
    const existing = grouped.get(window.date);
    if (existing) {
      existing.push(window);
      continue;
    }

    grouped.set(window.date, [window]);
  }

  return grouped;
}

function buildSummaryHighlight(
  category: string,
  date: string,
  confidence: WearableSummaryConfidence,
): string {
  if (confidence.level === "none") {
    return `No ${category} summary was available for ${date}.`;
  }

  const providers = confidence.selectedProviders.length > 0
    ? confidence.selectedProviders.map(formatProviderName).join(", ")
    : "no provider";

  return `${formatMetricLabel(category)} on ${date} is ${confidence.level}-confidence and currently resolves to ${providers}.`;
}

function collectSortedDatesDesc(values: readonly string[]): string[] {
  return uniqueStrings(values).sort((left, right) => right.localeCompare(left));
}

function collectLatestDate(values: readonly (string | null | undefined)[]): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
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

function latestIsoTimestamp(values: readonly (string | null | undefined)[]): string | null {
  const normalized = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  if (normalized.length === 0) {
    return null;
  }

  return normalized.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function compareIsoDesc(
  left: string | null,
  right: string | null,
): number {
  return (right ?? "").localeCompare(left ?? "");
}

function buildCandidateId(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0).join(":");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function metersToKilometers(value: number): number {
  return Number((value / 1000).toFixed(4));
}

function normalizeWearableSummaryDate(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return extractIsoDatePrefix(trimmed) ?? trimmed;
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

function collectSummaryProviders(
  summaries: readonly ({ summaryConfidence: WearableSummaryConfidence } | null)[],
): string[] {
  return uniqueStrings(
    summaries.flatMap((summary) => summary?.summaryConfidence.selectedProviders ?? []),
  );
}

function inferDaySummaryConfidence(
  summaries: readonly ({ summaryConfidence: WearableSummaryConfidence } | null)[],
): WearableConfidenceLevel {
  const available = summaries.filter(
    (summary): summary is { summaryConfidence: WearableSummaryConfidence } => summary !== null,
  );

  if (available.length === 0) {
    return "none";
  }

  if (available.some((summary) => summary.summaryConfidence.level === "low")) {
    return "low";
  }

  if (available.every((summary) => summary.summaryConfidence.level === "high")) {
    return "high";
  }

  return "medium";
}

function matchesDateFilters(
  date: string,
  filters: WearableFilters,
): boolean {
  if (filters.date && date !== filters.date) {
    return false;
  }

  if (filters.from && date < filters.from) {
    return false;
  }

  if (filters.to && date > filters.to) {
    return false;
  }

  return true;
}

function daysBetweenIsoDates(
  earlier: string,
  later: string,
): number | null {
  const earlierDate = Date.parse(`${earlier}T00:00:00Z`);
  const laterDate = Date.parse(`${later}T00:00:00Z`);

  if (!Number.isFinite(earlierDate) || !Number.isFinite(laterDate)) {
    return null;
  }

  return Math.max(0, Math.round((laterDate - earlierDate) / 86_400_000));
}
