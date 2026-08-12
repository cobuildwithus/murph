import type {
  WearableCanonicalMetricKey,
  WearableProviderMetricFamily,
} from "@murphai/health-metrics";
import type { DeviceDataOrigin } from "@murphai/contracts";

export type WearableConfidenceLevel = "none" | "low" | "medium" | "high";
export type WearableCandidateSourceFamily = "canonical" | "event" | "sample" | "derived";
export type WearableSleepSessionType = "main_sleep" | "nap" | "unknown";

export interface WearableExternalRef {
  system: string | null;
  resourceType: string | null;
  resourceId: string | null;
  version: string | null;
  facet: string | null;
}

export interface WearableMetricCandidate {
  activityType?: string | null;
  candidateId: string;
  dataOrigin?: DeviceDataOrigin | null;
  date: string;
  externalRef: WearableExternalRef | null;
  metric: string;
  occurredAt: string | null;
  paths: string[];
  provider: string;
  /** Stored-reconciliation override for sanitized session timestamp evidence. */
  reconciliationDurationConsistent?: boolean;
  /** Internal exact-partition key used only while reconciling stored rows. */
  reconciliationExactKey?: string;
  recordedAt: string | null;
  recordIds: string[];
  sessionEndAt?: string | null;
  sessionStartAt?: string | null;
  sourceFamily: WearableCandidateSourceFamily;
  sourceKind: string;
  title: string | null;
  unit: string | null;
  value: number;
  heartRateZones?: WearableHeartRateZoneAggregate[];
  workoutMetricContributors?: WearableActivitySessionMetricContributors;
  workoutMetricKeys?: string[];
  workoutMetricValues?: WearableActivitySessionMetricValues;
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
  activityAverageHeartRate: WearableResolvedMetric;
  activityScore: WearableResolvedMetric;
  activeCalories: WearableResolvedMetric;
  activityMinutes: WearableResolvedMetric;
  activityTypes: string[];
  altitudeChangeMeters: WearableResolvedMetric;
  averageHeartRate: WearableResolvedMetric;
  date: string;
  dayStrain: WearableResolvedMetric;
  distanceKm: WearableResolvedMetric;
  estimatedVo2Max: WearableResolvedMetric;
  floorsClimbed: WearableResolvedMetric;
  heartRateZones: WearableHeartRateZoneAggregate[];
  highActivityMinutes: WearableResolvedMetric;
  lowActivityMinutes: WearableResolvedMetric;
  lowestHeartRate: WearableResolvedMetric;
  maxHeartRate: WearableResolvedMetric;
  mediumActivityMinutes: WearableResolvedMetric;
  notes: string[];
  percentRecorded: WearableResolvedMetric;
  sessionCount: WearableResolvedMetric;
  sessionMinutes: WearableResolvedMetric;
  steps: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
  totalCalories: WearableResolvedMetric;
  totalElevationGainMeters: WearableResolvedMetric;
  walkingAverageHeartRate: WearableResolvedMetric;
  workoutStrain: WearableResolvedMetric;
  walkingAverageHeartRate: WearableResolvedMetric;
}

/**
 * Projection-internal evidence used to reconcile provider-scoped stored rows.
 * This is deliberately not a field on WearableActivityDay or any projected
 * public summary.
 */
export interface WearableActivitySessionEvidence {
  activityType: string | null;
  date: string;
  durationMinutes: number;
  durationConsistent: boolean;
  endedAt: string | null;
  heartRateZones: WearableHeartRateZoneAggregate[];
  provider: string;
  /** Opaque stored-projection token; never part of a public activity summary. */
  reconciliationExactKey: string;
  /** Opaque stored-projection token; never the provider's raw resource ID. */
  reconciliationResourceKey: string | null;
  recordedAt: string | null;
  startedAt: string | null;
  workoutMetricKeys: string[];
  workoutMetricValues: WearableActivitySessionMetricValues;
}

export type WearableActivityMetricResourceClass =
  | "activity"
  | "cycle"
  | "generic"
  | "none";

/**
 * Projection-internal, privacy-safe activity candidate evidence. Opaque
 * candidate and exact-partition tokens retain ranking and dedupe semantics
 * without persisting provider resource or canonical record identifiers.
 */
export interface WearableActivityMetricCandidateEvidence {
  candidateKey: string;
  date: string;
  exactKey: string;
  hasDayStrainFacet: boolean;
  metric: WearableMetricKey;
  occurredAt: string | null;
  origin: {
    aggregatorProvider: string | null;
    sourceProviderSlug: string | null;
    sourceType: string | null;
  };
  provider: string;
  publicProvider: string;
  recordedAt: string | null;
  resourceClass: WearableActivityMetricResourceClass;
  sourceFamily: WearableCandidateSourceFamily;
  sourceKind: string;
  unit: string | null;
  value: number;
}

export interface WearableHeartRateZoneAggregate {
  durationMinutes: number;
  label?: string;
  maxHeartRate?: number;
  minHeartRate?: number;
  zone?: number;
}

export const ACTIVITY_SESSION_WORKOUT_METRIC_SPECS = [
  {
    dailyReducer: "lower-bound",
    metric: "activeCalories",
    reducer: "additive",
    unit: "kcal",
  },
  {
    dailyReducer: "lower-bound",
    metric: "distanceKm",
    reducer: "additive",
    unit: "km",
  },
  {
    dailyReducer: "lower-bound",
    metric: "totalElevationGainMeters",
    reducer: "additive",
    unit: "meter",
  },
  {
    dailyReducer: "nested-maximum",
    metric: "maxHeartRate",
    reducer: "maximum",
    unit: "bpm",
  },
  {
    dailyReducer: "maximum",
    metric: "workoutStrain",
    reducer: "maximum",
    unit: "strain",
  },
] as const satisfies readonly {
  dailyReducer: "lower-bound" | "maximum" | "nested-maximum";
  metric: WearableMetricKey;
  reducer: "additive" | "maximum";
  unit: string;
}[];

export type WearableActivitySessionWorkoutMetricKey =
  (typeof ACTIVITY_SESSION_WORKOUT_METRIC_SPECS)[number]["metric"];

export type WearableDailyCumulativeMetric = Extract<
  (typeof ACTIVITY_SESSION_WORKOUT_METRIC_SPECS)[number],
  { dailyReducer: "lower-bound" }
>["metric"];

export type WearableDailyMaximumMetric = Extract<
  (typeof ACTIVITY_SESSION_WORKOUT_METRIC_SPECS)[number],
  { reducer: "maximum" }
>["metric"];

export type WearableActivitySessionMetricValues = Partial<
  Record<WearableActivitySessionWorkoutMetricKey, number>
>;

export type WearableActivitySessionMetricContributors = Partial<
  Record<WearableActivitySessionWorkoutMetricKey, string[]>
>;

export interface WearableSleepNight {
  averageHeartRate: WearableResolvedMetric;
  awakeMinutes: WearableResolvedMetric;
  date: string;
  deepMinutes: WearableResolvedMetric;
  hrv: WearableResolvedMetric;
  lightMinutes: WearableResolvedMetric;
  lowestHeartRate: WearableResolvedMetric;
  lowestSpo2: WearableResolvedMetric;
  notes: string[];
  provider: string | null;
  remMinutes: WearableResolvedMetric;
  respiratoryRate: WearableResolvedMetric;
  sessionMinutes: WearableResolvedMetric;
  sleepLatencyMinutes: WearableResolvedMetric;
  sleepEfficiency: WearableResolvedMetric;
  sleepEndAt: string | null;
  sleepPerformance: WearableResolvedMetric;
  sleepScore: WearableResolvedMetric;
  sleepStartAt: string | null;
  sleepType: WearableSleepSessionType;
  sleepWindowEvidence?: WearableSleepWindowEvidence[];
  sleepWindowEvidenceOmittedCount?: number;
  sleepWindowEvidenceOmittedExactDuplicateCount?: number;
  sleepWindowProvider: string | null;
  sleepConsistency: WearableResolvedMetric;
  spo2: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
  timeZone: string | null;
  timeInBedMinutes: WearableResolvedMetric;
  totalSleepMinutes: WearableResolvedMetric;
}

export interface WearableSleepWindowEvidence {
  date: string;
  durationMinutes: number;
  endAt: string | null;
  exactDuplicateCount: number;
  provider: string;
  recordedAt: string | null;
  sleepType: WearableSleepSessionType;
  startAt: string | null;
  timeZone: string | null;
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
  bodyWaterPercentage: WearableResolvedMetric;
  boneMassPercentage: WearableResolvedMetric;
  date: string;
  leanBodyMassKg: WearableResolvedMetric;
  muscleMassPercentage: WearableResolvedMetric;
  notes: string[];
  summaryConfidence: WearableSummaryConfidence;
  temperature: WearableResolvedMetric;
  visceralFatIndex: WearableResolvedMetric;
  waistCircumference: WearableResolvedMetric;
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
  lastSleepDate: string | null;
  metricsContributed: string[];
  notes: string[];
  provider: string;
  providerDisplayName: string;
  recoveryDays: number;
  selectedMetrics: number;
  sleepNights: number;
  sleepStalenessVsNewestDays: number | null;
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

export interface WearableSleepPatternFilters extends WearableFilters {
  now?: string;
  timeZone?: string;
  windowDays?: number;
}

export interface WearableSleepClockPattern {
  count: number;
  medianLocalMinutes: number | null;
  medianLocalTime: string | null;
  standardDeviationMinutes: number | null;
}

export interface WearableSleepNumericPattern {
  average: number | null;
  count: number;
  median: number | null;
  standardDeviation: number | null;
}

export interface WearableSleepSourceFreshness {
  lastSleepEvidenceDate: string;
  provider: string;
  stalenessVsNewestDays: number;
  stalenessVsNowDays: number;
}

export type WearableSleepReportingTimeZoneSource =
  | "canonical"
  | "none"
  | "user_filter"
  | "vault_metadata";

export interface WearableSleepPatternSummary {
  allSourcesStale: boolean;
  asOfDate: string;
  asOfInstant: string;
  awakeMinutes: WearableSleepNumericPattern;
  bedtime: WearableSleepClockPattern;
  conflictingNightCount: number;
  coveragePercent: number;
  expectedNightCount: number;
  excludedNapOnlyDateCount: number;
  reportingTimeZoneFallbackNightCount: number;
  from: string;
  lateArrivingNightCount: number;
  latestRecordedAt: string | null;
  latestSleepEndAt: string | null;
  latestNightAgeDays: number | null;
  latestNightDate: string | null;
  midpoint: WearableSleepClockPattern;
  missingNightCount: number;
  notes: string[];
  overlappingNightCount: number;
  providerMix: boolean;
  providers: string[];
  reportingTimeZone: string | null;
  reportingTimeZoneSource: WearableSleepReportingTimeZoneSource;
  sameDateSessionSuppressedCount: number;
  sessionDurationMinutes: WearableSleepNumericPattern;
  sleepLatencyMinutes: WearableSleepNumericPattern;
  sourceFreshness: WearableSleepSourceFreshness[];
  staleAfterDays: number;
  suppressedExactDuplicateCount: number;
  timeZones: string[];
  timingTimeZoneMode: "per_night_canonical_with_reporting_fallback";
  timingOmittedNightCount: number;
  to: string;
  totalSleepMinutes: WearableSleepNumericPattern;
  unknownSleepTypeNightCount: number;
  validNightCount: number;
  wakeTime: WearableSleepClockPattern;
  weekdayWeekendMidpointDriftMinutes: number | null;
  weekdayWeekendMidpointSampleCounts: {
    weekday: number;
    weekend: number;
  };
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
  evidenceOmittedCount?: number;
  evidenceOmittedExactDuplicateCount?: number;
  exactDuplicateCount?: number;
  externalRef: WearableExternalRef | null;
  nap: boolean;
  occurredAt: string | null;
  paths: string[];
  provider: string;
  recordedAt: string | null;
  recordIds: string[];
  sourceFamily: WearableCandidateSourceFamily;
  sourceKind: string;
  startAt: string | null;
  sleepType?: WearableSleepSessionType;
  timeZone?: string | null;
  title: string | null;
}

export interface WearableActivitySessionAggregate {
  activityTypes: string[];
  candidateId: string;
  dataOrigin?: DeviceDataOrigin | null;
  date: string;
  heartRateZones: WearableHeartRateZoneAggregate[];
  paths: string[];
  provider: string;
  recordedAt: string | null;
  recordIds: string[];
  sessionContributors: string[];
  sessionCount: number;
  sessionMinutes: number;
  sourceKind: "activity-session-aggregate" | "activity-session-day-rollup";
  workoutMetricContributors: WearableActivitySessionMetricContributors;
  workoutMetricValues: WearableActivitySessionMetricValues;
  workoutMetricKeys: string[];
}

export interface WearableDataset {
  activitySessionCandidates: readonly WearableMetricCandidate[];
  activitySessionAggregates: readonly WearableActivitySessionAggregate[];
  activitySessionDayRollups: readonly WearableActivitySessionAggregate[];
  metricSuppressionEvidence: readonly WearableMetricSuppressionEvidence[];
  metricCandidates: readonly WearableMetricCandidate[];
  provenanceDiagnostics: readonly WearableProvenanceDiagnostic[];
  rawMetricCandidates: readonly WearableMetricCandidate[];
  sleepWindows: readonly WearableSleepWindowCandidate[];
}

export interface WearableMetricSuppressionEvidence {
  date: string;
  metricKey: string;
  recordIds: readonly string[];
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

export type WearableMetricPolicyFamily = WearableProviderMetricFamily | null;

export const SLEEP_METRIC_KEYS = new Set<WearableMetricKey>([
  "averageHeartRate",
  "awakeMinutes",
  "deepMinutes",
  "hrv",
  "lightMinutes",
  "lowestHeartRate",
  "lowestSpo2",
  "remMinutes",
  "respiratoryRate",
  "sessionMinutes",
  "sleepConsistency",
  "sleepEfficiency",
  "sleepLatencyMinutes",
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
  "bodyWaterPercentage",
  "boneMassPercentage",
  "leanBodyMassKg",
  "muscleMassPercentage",
  "temperature",
  "visceralFatIndex",
  "waistCircumference",
  "weightKg",
]);

export const ACTIVITY_METRIC_KEYS = new Set<WearableMetricKey>([
  "activeCalories",
  "activityMinutes",
  "activityScore",
  "altitudeChangeMeters",
  "averageHeartRate",
  "dayStrain",
  "distanceKm",
  "estimatedVo2Max",
  "floorsClimbed",
  "highActivityMinutes",
  "lowActivityMinutes",
  "lowestHeartRate",
  "maxHeartRate",
  "mediumActivityMinutes",
  "percentRecorded",
  "sessionCount",
  "sessionMinutes",
  "steps",
  "totalCalories",
  "totalElevationGainMeters",
  "walkingAverageHeartRate",
  "workoutStrain",
  "walkingAverageHeartRate",
]);

const ACTIVITY_SLEEP_SHARED_METRIC_KEYS: ReadonlySet<WearableMetricKey> = new Set([
  "averageHeartRate",
  "lowestHeartRate",
]);

export function isActivitySummaryMetricCandidate(candidate: WearableMetricCandidate): boolean {
  if (!ACTIVITY_METRIC_KEYS.has(candidate.metric as WearableMetricKey)) {
    return false;
  }

  return !ACTIVITY_SLEEP_SHARED_METRIC_KEYS.has(candidate.metric as WearableMetricKey)
    || isExplicitActivitySummaryResource(candidate);
}

export function isSleepSummaryMetricCandidate(candidate: WearableMetricCandidate): boolean {
  if (!SLEEP_METRIC_KEYS.has(candidate.metric as WearableMetricKey)) {
    return false;
  }

  return !ACTIVITY_SLEEP_SHARED_METRIC_KEYS.has(candidate.metric as WearableMetricKey)
    || !isExplicitActivitySummaryResource(candidate);
}

function isExplicitActivitySummaryResource(candidate: WearableMetricCandidate): boolean {
  const resourceType = candidate.externalRef?.resourceType?.trim().toLowerCase() ?? "";
  return resourceType === "cycle"
    || resourceType.includes("activity");
}

export const DAILY_CUMULATIVE_METRIC_KEYS: ReadonlySet<WearableMetricKey> = new Set(
  ACTIVITY_SESSION_WORKOUT_METRIC_SPECS
    .filter(({ dailyReducer }) => dailyReducer === "lower-bound")
    .map(({ metric }) => metric),
);

// Daily cumulative totals and maximum heart rate contain overlapping summary
// and session branches. Workout strain intentionally remains cross-branch
// conflict evidence even though its selected value also uses a maximum reducer.
export const ACTIVITY_BRANCH_SCOPED_METRIC_KEYS: ReadonlySet<WearableMetricKey> = new Set(
  ACTIVITY_SESSION_WORKOUT_METRIC_SPECS
    .filter(({ dailyReducer }) => dailyReducer !== "maximum")
    .map(({ metric }) => metric),
);
