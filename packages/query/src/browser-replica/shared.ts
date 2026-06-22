import type { CanonicalRecordClass } from "../canonical-entities.ts";
import type {
  OverviewExperiment,
  OverviewExperimentSummary,
  OverviewJournalEntry,
  OverviewMetric,
  OverviewWeeklySampleSummary,
} from "../overview.ts";
import type { VaultReadModel } from "../read-model.ts";
import type { TimelineEntry } from "../timeline.ts";
import type {
  MetricConfidence,
  MetricComparator,
  MetricGoalProgressStatus,
  MetricGrain,
  MetricPoint,
  MetricSelectionStatus,
  MetricStatistic,
} from "@murphai/health-metrics";

export const BROWSER_VAULT_REPLICA_SCHEMA = "murph.browser-vault-replica";
export const BROWSER_VAULT_REPLICA_POLICY_ID = "health-vault-browser";

export const BODY_PREVIEW_CHARS = 280;
export const METRIC_LOOKBACK_DAYS = 365;
export const RECENT_JOURNAL_LIMIT = 4;
export const TRACKED_EXPERIMENT_LIMIT = 24;
export const TIMELINE_LIMIT = 240;
export const SIGNAL_LIMIT = 30;
export const SOURCE_HEALTH_LIMIT = 24;
export const WEEKLY_SAMPLE_LOOKBACK_DAYS = 365;

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

export interface BrowserVaultSummaryConfidence {
  level: MetricConfidence;
}

export interface BrowserVaultMetricRow {
  biomarkerKey: string | null;
  comparator?: MetricComparator | null;
  confidence: MetricConfidence;
  context: Record<string, unknown>;
  date: string;
  grain: MetricGrain;
  id: string;
  metricKey: string;
  observedAt: string;
  pointIds: string[];
  recordIds: string[];
  rowSchema: "murph.browser-vault.metric-row.v1";
  sourceFamily: string | null;
  sourceKind: string | null;
  sourceLabel: string | null;
  statistic: MetricStatistic;
  unit: string | null;
  value: number | null;
  valueLabel: string | null;
}

export interface BrowserVaultMetricSelectionWarning {
  code: "COMPARATOR_VALUE" | "LOW_SAMPLE_COUNT" | "MIXED_SOURCES" | "SOURCE_STALE" | "UNIT_NOT_NORMALIZED" | "METHOD_CHANGED";
  message: string;
}

export interface BrowserVaultMetricSelectionRow {
  biomarkerKey: string | null;
  confidence: MetricConfidence;
  effectiveDate: string | null;
  id: string;
  metricKey: string;
  observedAt: string | null;
  pointIds: string[];
  recordIds: string[];
  selectedMetricRowId: string | null;
  selectionSchema: "murph.browser-vault.metric-selection.v1";
  sourceLabel: string | null;
  status: MetricSelectionStatus;
  unit: string | null;
  value: number | null;
  valueLabel: string | null;
  warnings: BrowserVaultMetricSelectionWarning[];
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

export interface BrowserVaultMetricGoalProgressRow {
  currentValue: number | null;
  currentValueLabel: string | null;
  deltaToTarget: number | null;
  goalId: string;
  metricKey: string;
  selectedPointIds: string[];
  status: MetricGoalProgressStatus;
  targetId: string;
  targetValueLabel: string;
  unit: string;
  warnings: BrowserVaultMetricSelectionWarning[];
}

export interface BrowserVaultReplica {
  assistantSummary: BrowserVaultAssistantSummary;
  entities: BrowserVaultEntity[];
  generatedAt: string;
  metricGoalProgressRows: BrowserVaultMetricGoalProgressRow[];
  metricRows: BrowserVaultMetricRow[];
  metricSelectionRows: BrowserVaultMetricSelectionRow[];
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
  metricPoints: readonly MetricPoint[];
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
  biomarkerKey?: string;
  from?: string;
  grain?: MetricGrain;
  metricKey?: string;
  to?: string;
}

export type BrowserVaultMetricSelectionFilters = Pick<BrowserVaultMetricFilters, "biomarkerKey" | "metricKey">;

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
  metricGoals: {
    progress(filters?: { goalId?: string; metricKey?: string }): BrowserVaultMetricGoalProgressRow[];
  };
  metrics: {
    latestRow(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow | null;
    list(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow[];
    series(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow[];
    seriesMany(filters: readonly BrowserVaultMetricFilters[]): BrowserVaultMetricRow[][];
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
  experimentSummary: OverviewExperimentSummary;
  metrics: OverviewMetric[];
  recentJournals: OverviewJournalEntry[];
  trackedExperiments: OverviewExperiment[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
}
