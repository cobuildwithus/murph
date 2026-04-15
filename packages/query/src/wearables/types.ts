import type { DeviceProviderMetricFamily } from "@murphai/importers/device-providers/provider-descriptors";

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

export interface WearableSleepWindowCandidate {
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

export interface WearableActivitySessionAggregate {
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

export type WearableMetricKey =
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
  "dayStrain",
  "distanceKm",
  "sessionCount",
  "sessionMinutes",
  "steps",
]);
