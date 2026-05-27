import type { WearableCanonicalMetricKey } from "@murphai/importers/device-providers/metric-catalog";
import type { DeviceProviderMetricFamily } from "@murphai/importers/device-providers/provider-descriptors";
import type { DeviceDataOrigin } from "@murphai/contracts";

export type WearableConfidenceLevel = "none" | "low" | "medium" | "high";
export type WearableCandidateSourceFamily = "canonical" | "event" | "sample" | "derived";

export interface WearableExternalRef {
  system: string | null;
  resourceType: string | null;
  resourceId: string | null;
  version: string | null;
  facet: string | null;
}

export interface WearableMetricCandidate {
  candidateId: string;
  dataOrigin?: DeviceDataOrigin | null;
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
  fallbackFromMetric: string | null;
  fallbackReason: string | null;
  occurredAt: string | null;
  paths: string[];
  provider: string | null;
  recordedAt: string | null;
  recordIds: string[];
  resolution: "direct" | "fallback" | "none";
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
  altitudeChangeMeters: WearableResolvedMetric;
  date: string;
  dayStrain: WearableResolvedMetric;
  distanceKm: WearableResolvedMetric;
  estimatedVo2Max: WearableResolvedMetric;
  maxHeartRate: WearableResolvedMetric;
  notes: string[];
  percentRecorded: WearableResolvedMetric;
  sessionCount: WearableResolvedMetric;
  sessionMinutes: WearableResolvedMetric;
  steps: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
  totalCalories: WearableResolvedMetric;
  totalElevationGainMeters: WearableResolvedMetric;
  workoutStrain: WearableResolvedMetric;
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
  provider: string | null;
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
  activity: WearableActivityDay | null;
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

export interface WearableMetricSummaryFilters extends WearableFilters {
  windowDays?: number;
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

export type WearableMetricSummaryKind = "activity" | "bodyState" | "recovery" | "sleep";

export interface WearableMetricWindowStats {
  average: number | null;
  count: number;
  from: string | null;
  max: number | null;
  min: number | null;
  to: string | null;
}

export interface WearableMetricTrendPoint {
  confidence: WearableConfidenceLevel;
  date: string;
  paths: string[];
  provider: string | null;
  recordedAt: string | null;
  recordIds: string[];
  unit: string | null;
  value: number;
}

export interface WearableMetricLatestSummary {
  confidence: WearableMetricConfidence;
  date: string | null;
  delta: number | null;
  max: number | null;
  metric: WearableMetricKey;
  min: number | null;
  notes: string[];
  paths: string[];
  percentChange: number | null;
  priorWindow: WearableMetricWindowStats;
  provider: string | null;
  recentWindow: WearableMetricWindowStats;
  recordedAt: string | null;
  recordIds: string[];
  requestedMetric: string;
  resolvedAlias: string | null;
  summaryKind: WearableMetricSummaryKind;
  unit: string | null;
  value: number | null;
  windowDays: number;
}

export interface WearableMetricTrendSummary extends WearableMetricLatestSummary {
  points: WearableMetricTrendPoint[];
}

export interface WearableLatestSummary {
  activity: WearableActivityDay | null;
  bodyState: WearableBodyStateDay | null;
  day: WearableDaySummary;
  latestDate: string;
  notes: string[];
  providers: string[];
  recovery: WearableRecoveryDay | null;
  sleep: WearableSleepNight | null;
  sourceHealth: WearableSourceHealth[];
}

export interface WearableDriftSummary {
  latest: WearableLatestSummary;
  notes: string[];
  signals: WearableMetricLatestSummary[];
  windowDays: number;
}

export type ProjectedWearableMetricSelection = Omit<WearableMetricSelection, "paths" | "recordIds"> & {
  paths: [];
  recordIds: [];
};

export type ProjectedWearableResolvedMetric = Omit<WearableResolvedMetric, "candidates" | "selection"> & {
  candidates: [];
  selection: ProjectedWearableMetricSelection;
};

type ProjectWearableSummaryMetrics<TSummary> = {
  [TKey in keyof TSummary]: TSummary[TKey] extends WearableResolvedMetric
    ? ProjectedWearableResolvedMetric
    : TSummary[TKey];
};

export type ProjectedWearableActivitySummary = ProjectWearableSummaryMetrics<WearableActivitySummary>;
export type ProjectedWearableSleepSummary = ProjectWearableSummaryMetrics<WearableSleepSummary>;
export type ProjectedWearableRecoverySummary = ProjectWearableSummaryMetrics<WearableRecoverySummary>;
export type ProjectedWearableBodyStateSummary = ProjectWearableSummaryMetrics<WearableBodyStateSummary>;
export type ProjectedWearableSourceHealthSummary = WearableSourceHealthSummary;

export interface ProjectedWearableDaySummary extends Omit<
  WearableDaySummary,
  "activity" | "bodyState" | "recovery" | "sleep" | "sourceHealth"
> {
  activity: ProjectedWearableActivitySummary | null;
  bodyState: ProjectedWearableBodyStateSummary | null;
  recovery: ProjectedWearableRecoverySummary | null;
  sleep: ProjectedWearableSleepSummary | null;
  sourceHealth: ProjectedWearableSourceHealthSummary[];
}

export type ProjectedWearableMetricLatestSummary = Omit<WearableMetricLatestSummary, "paths" | "recordIds"> & {
  paths: [];
  recordIds: [];
};

export type ProjectedWearableMetricTrendPoint = Omit<WearableMetricTrendPoint, "paths" | "recordIds"> & {
  paths: [];
  recordIds: [];
};

export interface ProjectedWearableMetricTrendSummary extends ProjectedWearableMetricLatestSummary {
  points: ProjectedWearableMetricTrendPoint[];
}

export interface ProjectedWearableLatestSummary extends Omit<
  WearableLatestSummary,
  "activity" | "bodyState" | "day" | "recovery" | "sleep" | "sourceHealth"
> {
  activity: ProjectedWearableActivitySummary | null;
  bodyState: ProjectedWearableBodyStateSummary | null;
  day: ProjectedWearableDaySummary;
  recovery: ProjectedWearableRecoverySummary | null;
  sleep: ProjectedWearableSleepSummary | null;
  sourceHealth: ProjectedWearableSourceHealthSummary[];
}

export interface ProjectedWearableDriftSummary extends Omit<WearableDriftSummary, "latest" | "signals"> {
  latest: ProjectedWearableLatestSummary;
  signals: ProjectedWearableMetricLatestSummary[];
}

export interface WearableSleepWindowCandidate {
  candidateId: string;
  dataOrigin?: DeviceDataOrigin | null;
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

export interface WearableActivitySessionAggregate {
  activityTypes: string[];
  candidateId: string;
  dataOrigin?: DeviceDataOrigin | null;
  date: string;
  paths: string[];
  provider: string;
  recordedAt: string | null;
  recordIds: string[];
  sessionCount: number;
  sessionMinutes: number;
}

export interface WearableDataset {
  activitySessionAggregates: readonly WearableActivitySessionAggregate[];
  metricCandidates: readonly WearableMetricCandidate[];
  provenanceDiagnostics: readonly WearableProvenanceDiagnostic[];
  rawMetricCandidates: readonly WearableMetricCandidate[];
  sleepWindows: readonly WearableSleepWindowCandidate[];
}

export interface WearableProvenanceDiagnostic {
  count: number;
  dates: string[];
  kind: "excluded" | "included";
  latestRecordedAt: string | null;
  missingFields: string[];
  provider: string | null;
}

export interface WearableMetricScorecard {
  agreementScore: number;
  metricPolicyScore: number;
  providerScore: number;
  recencyScore: number;
  resourceScore: number;
  sourceFamilyScore: number;
  total: number;
}

export interface WearableSleepWindowScorecard {
  agreementScore: number;
  durationScore: number;
  napPenalty: number;
  providerScore: number;
  recencyScore: number;
  total: number;
}

export type WearableMetricKey = WearableCanonicalMetricKey;

export type WearableMetricPolicyFamily = DeviceProviderMetricFamily | null;

export const SLEEP_METRIC_KEYS = new Set<WearableMetricKey>([
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

export const RECOVERY_METRIC_KEYS = new Set<WearableMetricKey>([
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

export const BODY_METRIC_KEYS = new Set<WearableMetricKey>([
  "bmi",
  "bodyFatPercentage",
  "temperature",
  "weightKg",
]);

export const ACTIVITY_METRIC_KEYS = new Set<WearableMetricKey>([
  "activeCalories",
  "activityScore",
  "altitudeChangeMeters",
  "dayStrain",
  "distanceKm",
  "estimatedVo2Max",
  "maxHeartRate",
  "percentRecorded",
  "sessionCount",
  "sessionMinutes",
  "steps",
  "totalCalories",
  "totalElevationGainMeters",
  "workoutStrain",
]);
