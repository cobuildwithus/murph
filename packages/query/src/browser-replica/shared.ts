import type { CanonicalRecordClass } from "../canonical-entities.ts";
import type {
  OverviewExperiment,
  OverviewJournalEntry,
  OverviewMetric,
  OverviewWeeklySampleSummary,
} from "../overview.ts";
import type { VaultReadModel } from "../read-model.ts";
import type { TimelineEntry } from "../timeline.ts";
import type { WearableConfidenceLevel } from "../wearables.ts";

export const BROWSER_VAULT_REPLICA_SCHEMA = "murph.browser-vault-replica.v1";
export const BROWSER_VAULT_REPLICA_POLICY_ID = "health-vault-browser-v1";

export const BODY_PREVIEW_CHARS = 280;
export const METRIC_LOOKBACK_DAYS = 365;
export const RECENT_JOURNAL_LIMIT = 4;
export const TRACKED_EXPERIMENT_LIMIT = 24;
export const TIMELINE_LIMIT = 240;
export const SIGNAL_LIMIT = 30;
export const SOURCE_HEALTH_LIMIT = 24;
export const WEEKLY_SAMPLE_LOOKBACK_DAYS = 365;
export const GLUCOSE_SAMPLE_STREAM = "glucose";
export const GLUCOSE_SAMPLE_UNIT = "mg_dL";

export const INCLUDED_FAMILIES = [
  "allergy",
  "assessment",
  "condition",
  "event",
  "experiment",
  "family",
  "genetics",
  "goal",
  "journal",
  "protocol",
  "regimen",
  "provider",
  "sample",
  "workout_format",
] as const;

export const EXCLUDED_FAMILIES = [
  "audit",
  "core",
  "food",
  "recipe",
] as const;

export type BrowserVaultEntityFamily = (typeof INCLUDED_FAMILIES)[number];
export type BrowserVaultMetricDomain = "activity" | "body_state" | "recovery" | "sleep";

export interface BrowserVaultReplicaPolicy {
  bodyPreviewChars: number;
  excludedFamilies: string[];
  id: typeof BROWSER_VAULT_REPLICA_POLICY_ID;
  includedFamilies: string[];
  metricLookbackDays: number;
}

export interface BrowserVaultReplicaSource {
  dataVersion: string;
  sourceBundleHash: string;
}

export interface BrowserVaultEntityLink {
  targetId: string;
  type: string;
}

export interface BrowserVaultEntity {
  attributes: Record<string, unknown>;
  bodyPreview: string | null;
  date: string | null;
  experimentSlug: string | null;
  family: string;
  id: string;
  kind: string;
  links: BrowserVaultEntityLink[];
  lookupIds: string[];
  occurredAt: string | null;
  recordClass: CanonicalRecordClass;
  status: string | null;
  stream: string | null;
  tags: string[];
  title: string | null;
}

export interface BrowserVaultMetricSelection {
  unit: string | null;
  value: number | null;
}

export interface BrowserVaultResolvedMetric {
  selection: BrowserVaultMetricSelection;
}

export interface BrowserVaultSummaryConfidence {
  level: WearableConfidenceLevel;
}

export interface BrowserVaultMetricRow {
  confidence: WearableConfidenceLevel;
  date: string;
  domain: BrowserVaultMetricDomain;
  id: string;
  metric: string;
  recordIds: string[];
  sourceFamily: string | null;
  sourceKind: string | null;
  unit: string | null;
  value: number | null;
}

export type BrowserVaultMetricPointStatus = "ready" | "stale";
export type BrowserVaultMetricPointGrain = "instant" | "event" | "day" | "week" | "month" | "window";
export type BrowserVaultMetricPointStatistic = "value" | "latest" | "mean" | "median" | "min" | "max" | "sum" | "count";

export interface BrowserVaultMetricPoint {
  biomarkerKey: string | null;
  confidence: WearableConfidenceLevel;
  date: string;
  grain: BrowserVaultMetricPointGrain;
  id: string;
  metricKey: string;
  observedAt: string;
  pointSchema: "murph.browser-vault.metric-point.v1";
  recordIds: string[];
  sourceFamily: string | null;
  sourceKind: string | null;
  sourceLabel: string | null;
  sourceMetricRowId: string;
  statistic: BrowserVaultMetricPointStatistic;
  unit: string | null;
  value: number;
  valueLabel: string;
}

export interface BrowserVaultMetricSelectionWarning {
  code: "LOW_SAMPLE_COUNT" | "MIXED_SOURCES" | "SOURCE_STALE" | "UNIT_NOT_NORMALIZED" | "METHOD_CHANGED";
  message: string;
}

export interface BrowserVaultMetricSelectionRow {
  biomarkerKey: string | null;
  confidence: WearableConfidenceLevel;
  date: string;
  id: string;
  metricKey: string;
  observedAt: string;
  pointIds: string[];
  recordIds: string[];
  selectionSchema: "murph.browser-vault.metric-selection.v1";
  sourceLabel: string | null;
  status: BrowserVaultMetricPointStatus;
  unit: string | null;
  value: number;
  valueLabel: string;
  warnings: BrowserVaultMetricSelectionWarning[];
}

export interface BrowserVaultMetricDayRow {
  attributes: Record<string, unknown>;
  confidence: WearableConfidenceLevel;
  date: string;
  domain: BrowserVaultMetricDomain;
  id: string;
  metricIds: string[];
  metrics: Record<string, BrowserVaultResolvedMetric>;
  notes: string[];
}

export interface BrowserVaultTimelineRow {
  date: string;
  entityId: string;
  entryType: TimelineEntry["entryType"];
  family: string;
  id: string;
  kind: string;
  occurredAt: string;
  stream: string | null;
  tags: string[];
  title: string;
}

export interface BrowserVaultSearchRow {
  date: string | null;
  entityId: string;
  family: string;
  id: string;
  kind: string;
  occurredAt: string | null;
  tags: string[];
  text: string;
  title: string | null;
}

export interface BrowserVaultSourceHealthRow {
  activityDays: number;
  bodyStateDays: number;
  conflictCount: number;
  firstDate: string | null;
  lastDate: string | null;
  latestRecordedAt: string | null;
  provider: string;
  providerDisplayName: string;
  recoveryDays: number;
  selectedMetrics: number;
  sleepNights: number;
  stalenessVsNewestDays: number | null;
}

export interface BrowserVaultAssistantSummary {
  highlights: string[];
  latestDate: string | null;
}

export interface BrowserVaultReplica {
  assistantSummary: BrowserVaultAssistantSummary;
  entities: BrowserVaultEntity[];
  generatedAt: string;
  metricDayRows: BrowserVaultMetricDayRow[];
  metricRows: BrowserVaultMetricRow[];
  metricPoints?: BrowserVaultMetricPoint[];
  metricSelectionRows?: BrowserVaultMetricSelectionRow[];
  policy: BrowserVaultReplicaPolicy;
  schema: typeof BROWSER_VAULT_REPLICA_SCHEMA;
  searchRows: BrowserVaultSearchRow[];
  source: BrowserVaultReplicaSource;
  sourceHealthRows: BrowserVaultSourceHealthRow[];
  timelineRows: BrowserVaultTimelineRow[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
}

export interface CreateBrowserVaultReplicaInput {
  generatedAt?: string;
  sourceBundleHash: string;
  vault: VaultReadModel;
}

export interface BrowserVaultEntityFilters {
  families?: readonly string[];
  from?: string;
  ids?: readonly string[];
  kinds?: readonly string[];
  statuses?: readonly string[];
  tags?: readonly string[];
  text?: string;
  to?: string;
}

export interface BrowserVaultMetricFilters {
  domain?: BrowserVaultMetricDomain;
  from?: string;
  metric?: string;
  to?: string;
}

export interface BrowserVaultMetricPointFilters {
  biomarkerKey?: string;
  from?: string;
  metricKey?: string;
  to?: string;
}

export type BrowserVaultMetricSelectionFilters = Pick<BrowserVaultMetricPointFilters, "biomarkerKey" | "metricKey">;

export interface BrowserVaultTimelineFilters {
  families?: readonly string[];
  from?: string;
  kinds?: readonly string[];
  tags?: readonly string[];
  to?: string;
}

export interface BrowserVaultSearchFilters {
  families?: readonly string[];
}

export interface BrowserVaultQueryClient {
  entities: {
    get(idOrLookupId: string): BrowserVaultEntity | null;
    list(filters?: BrowserVaultEntityFilters): BrowserVaultEntity[];
  };
  metricDays: {
    list(filters?: BrowserVaultMetricFilters): BrowserVaultMetricDayRow[];
  };
  metrics: {
    latest(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow | null;
    list(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow[];
    series(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow[];
  };
  metricPoints: {
    latest(filters?: BrowserVaultMetricPointFilters): BrowserVaultMetricPoint | null;
    list(filters?: BrowserVaultMetricPointFilters): BrowserVaultMetricPoint[];
    series(filters?: BrowserVaultMetricPointFilters): BrowserVaultMetricPoint[];
  };
  metricSelections: {
    get(idOrMetricKey: string): BrowserVaultMetricSelectionRow | null;
    getByBiomarker(biomarkerKey: string): BrowserVaultMetricSelectionRow | null;
    list(filters?: BrowserVaultMetricSelectionFilters): BrowserVaultMetricSelectionRow[];
  };
  replica: BrowserVaultReplica;
  search(query: string, filters?: BrowserVaultSearchFilters): BrowserVaultSearchRow[];
  timeline: {
    list(filters?: BrowserVaultTimelineFilters): BrowserVaultTimelineRow[];
  };
}

export interface BrowserVaultOverviewView {
  metrics: OverviewMetric[];
  recentJournals: OverviewJournalEntry[];
  trackedExperiments: OverviewExperiment[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
}

export interface BrowserVaultSignalsView {
  activity: BrowserVaultActivitySummary[];
  assistantSummary: BrowserVaultAssistantSummary;
  bodyState: BrowserVaultBodyStateSummary[];
  recovery: BrowserVaultRecoverySummary[];
  sleep: BrowserVaultSleepSummary[];
  sourceHealth: BrowserVaultSourceHealthRow[];
}

export interface BrowserVaultActivitySummary {
  activityScore: BrowserVaultResolvedMetric;
  activeCalories: BrowserVaultResolvedMetric;
  activityTypes: string[];
  altitudeChangeMeters: BrowserVaultResolvedMetric;
  date: string;
  dayStrain: BrowserVaultResolvedMetric;
  distanceKm: BrowserVaultResolvedMetric;
  estimatedVo2Max: BrowserVaultResolvedMetric;
  maxHeartRate: BrowserVaultResolvedMetric;
  notes: string[];
  percentRecorded: BrowserVaultResolvedMetric;
  sessionCount: BrowserVaultResolvedMetric;
  sessionMinutes: BrowserVaultResolvedMetric;
  steps: BrowserVaultResolvedMetric;
  summaryConfidence: BrowserVaultSummaryConfidence;
  totalElevationGainMeters: BrowserVaultResolvedMetric;
  workoutStrain: BrowserVaultResolvedMetric;
}

export interface BrowserVaultSleepSummary {
  averageHeartRate: BrowserVaultResolvedMetric;
  awakeMinutes: BrowserVaultResolvedMetric;
  date: string;
  deepMinutes: BrowserVaultResolvedMetric;
  hrv: BrowserVaultResolvedMetric;
  lightMinutes: BrowserVaultResolvedMetric;
  lowestHeartRate: BrowserVaultResolvedMetric;
  notes: string[];
  remMinutes: BrowserVaultResolvedMetric;
  respiratoryRate: BrowserVaultResolvedMetric;
  sessionMinutes: BrowserVaultResolvedMetric;
  sleepConsistency: BrowserVaultResolvedMetric;
  sleepEfficiency: BrowserVaultResolvedMetric;
  sleepEndAt: string | null;
  sleepPerformance: BrowserVaultResolvedMetric;
  sleepScore: BrowserVaultResolvedMetric;
  sleepStartAt: string | null;
  sleepWindowProvider: string | null;
  spo2: BrowserVaultResolvedMetric;
  summaryConfidence: BrowserVaultSummaryConfidence;
  timeInBedMinutes: BrowserVaultResolvedMetric;
  totalSleepMinutes: BrowserVaultResolvedMetric;
}

export interface BrowserVaultRecoverySummary {
  bodyBattery: BrowserVaultResolvedMetric;
  date: string;
  hrv: BrowserVaultResolvedMetric;
  notes: string[];
  readinessScore: BrowserVaultResolvedMetric;
  recoveryScore: BrowserVaultResolvedMetric;
  respiratoryRate: BrowserVaultResolvedMetric;
  restingHeartRate: BrowserVaultResolvedMetric;
  spo2: BrowserVaultResolvedMetric;
  stressLevel: BrowserVaultResolvedMetric;
  summaryConfidence: BrowserVaultSummaryConfidence;
  temperature: BrowserVaultResolvedMetric;
  temperatureDeviation: BrowserVaultResolvedMetric;
}

export interface BrowserVaultBodyStateSummary {
  bmi: BrowserVaultResolvedMetric;
  bodyFatPercentage: BrowserVaultResolvedMetric;
  date: string;
  notes: string[];
  summaryConfidence: BrowserVaultSummaryConfidence;
  temperature: BrowserVaultResolvedMetric;
  weightKg: BrowserVaultResolvedMetric;
}
