import type { CanonicalRecordClass } from "../canonical-entities.ts";
import type {
  ExperimentOutcome,
} from "@murphai/contracts";
import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_SCHEMA,
} from "@murphai/contracts/browser-vault";
import type {
  OverviewExperiment,
  OverviewExperimentSummary,
  OverviewJournalEntry,
  OverviewMetric,
  OverviewWeeklySampleSummary,
} from "../overview.ts";
import type { PersonalPatternReport } from "../personal-patterns.ts";
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
import type { BrowserVaultMetricBucketId } from "./metric-buckets.ts";

export {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_SCHEMA,
};
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
  "habitat",
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

export interface BrowserVaultLabResultReferenceRange {
  high?: number;
  low?: number;
  text?: string;
}

export type BrowserVaultLabSpecimenKind = "plasma" | "serum" | "whole_blood";

export interface BrowserVaultLabResultRow {
  analyte: string;
  biomarkerKey: string | null;
  comparator: MetricComparator | null;
  date: string;
  flag: string | null;
  id: string;
  labName: string | null;
  metricKey: string;
  normalizedUnit: string | null;
  normalizedValue: number | null;
  observedAt: string;
  referenceRange: BrowserVaultLabResultReferenceRange | null;
  rowSchema: "murph.browser-vault.lab-result-row.v1";
  sourceLabel: string | null;
  specimenKind: BrowserVaultLabSpecimenKind | null;
  textValue: string | null;
  unit: string | null;
  value: number | null;
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

export const BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA =
  "murph.browser-vault.experiment-run-card.v1";

export type BrowserVaultExperimentRunCardStatus =
  | "active"
  | "paused"
  | "finished"
  | "stopped";

export interface BrowserVaultExperimentRunCardMetric {
  baseline?: string;
  /** Used by the web display layer to preserve health-commons sentiment coloring. */
  biomarkerKey?: string;
  current: string;
  delta?: string;
  direction?: "down" | "neutral" | "up";
  label: string;
}

export interface BrowserVaultExperimentRunCardDailyCadence {
  cadence: string;
  completed: number;
  expected: number;
  label?: string;
}

export interface BrowserVaultExperimentRunCardSummary {
  completionPercent?: number;
  dailyCadence?: BrowserVaultExperimentRunCardDailyCadence;
  dateRange?: string;
  day?: number;
  metric?: BrowserVaultExperimentRunCardMetric;
  metrics: BrowserVaultExperimentRunCardMetric[];
}

export interface BrowserVaultExperimentRunCardLookupKeys {
  experimentIds: string[];
  protocolKeys: string[];
  slugs: string[];
}

/**
 * A bounded, rebuildable home-card projection. It is generated with the
 * replica and therefore shares the replica's single freshness/version owner.
 */
export interface BrowserVaultExperimentRunCard {
  id: string;
  lookupKeys: BrowserVaultExperimentRunCardLookupKeys;
  requiredMetricBuckets: BrowserVaultMetricBucketId[];
  runSummary: BrowserVaultExperimentRunCardSummary;
  schema: typeof BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA;
  slug: string | null;
  startedOn: string | null;
  status: BrowserVaultExperimentRunCardStatus;
  statusLabel: string;
  summary: string | null;
  summaryDetail: string | null;
  tags: string[];
  title: string;
}

export type BrowserVaultExperimentRunCardLookup =
  | string
  | {
      experimentId?: string;
      protocolKeys?: readonly string[];
      slug?: string;
    };

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
  /** Absent only on replicas produced before canonical outcome projection shipped. */
  experimentOutcomes?: ExperimentOutcome[];
  /** Absent only on legacy replicas produced before compact home cards shipped. */
  experimentRunCards?: BrowserVaultExperimentRunCard[];
  generatedAt: string;
  /** Absent only on legacy replicas produced before generation-aware freshness. */
  generation?: number;
  labResultRows: BrowserVaultLabResultRow[];
  metricGoalProgressRows: BrowserVaultMetricGoalProgressRow[];
  metricRows: BrowserVaultMetricRow[];
  metricSelectionRows: BrowserVaultMetricSelectionRow[];
  /** Absent only on replicas produced before Personal Patterns shipped. */
  personalPatterns?: PersonalPatternReport;
  policy: BrowserVaultReplicaPolicy;
  schema: typeof BROWSER_VAULT_REPLICA_SCHEMA;
  searchRows: BrowserVaultSearchRow[];
  source: BrowserVaultReplicaSource;
  sourceHealthRows: BrowserVaultSourceHealthRow[];
  timelineRows: BrowserVaultTimelineRow[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
  /** Absent only on legacy replicas produced before compact home state shipped. */
  hasLabBiomarkers?: boolean;
}

type BrowserVaultLegacyCompatibleCoreReplica = Pick<
  BrowserVaultReplica,
  | "assistantSummary"
  | "entities"
  | "experimentRunCards"
  | "generatedAt"
  | "generation"
  | "hasLabBiomarkers"
  | "personalPatterns"
  | "policy"
  | "schema"
  | "searchRows"
  | "source"
  | "timelineRows"
  | "weeklySampleSummaries"
>;

export type BrowserVaultCoreReplica = Omit<
  BrowserVaultLegacyCompatibleCoreReplica,
  "experimentRunCards" | "hasLabBiomarkers"
> & {
  experimentRunCards: BrowserVaultExperimentRunCard[];
  hasLabBiomarkers: boolean;
};

export type BrowserVaultMetricsReplica = BrowserVaultCoreReplica & Pick<
  BrowserVaultReplica,
  | "experimentOutcomes"
  | "metricGoalProgressRows"
  | "metricRows"
  | "metricSelectionRows"
  | "sourceHealthRows"
> & {
  experimentOutcomes: ExperimentOutcome[];
};

export type BrowserVaultMetricsIndexReplica = BrowserVaultCoreReplica & Pick<
  BrowserVaultReplica,
  | "experimentOutcomes"
  | "metricGoalProgressRows"
  | "metricSelectionRows"
  | "sourceHealthRows"
> & {
  experimentOutcomes: ExperimentOutcome[];
};

export type BrowserVaultLabsReplica = BrowserVaultCoreReplica & Pick<
  BrowserVaultReplica,
  "labResultRows"
>;

export interface CreateBrowserVaultReplicaInput {
  experimentOutcomes?: readonly ExperimentOutcome[];
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

export interface BrowserVaultLabResultFilters {
  biomarkerKey?: string;
  from?: string;
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

interface BrowserVaultCoreQueryAccess {
  entities: {
    get(idOrLookupId: string): BrowserVaultEntity | null;
    list(filters?: BrowserVaultEntityFilters): BrowserVaultEntity[];
  };
  experimentRunCards: {
    find(lookup: BrowserVaultExperimentRunCardLookup): BrowserVaultExperimentRunCard | null;
    get(experimentId: string): BrowserVaultExperimentRunCard | null;
    list(): BrowserVaultExperimentRunCard[];
  };
  search(query: string, filters?: BrowserVaultSearchFilters): BrowserVaultSearchRow[];
  timeline: {
    list(filters?: BrowserVaultTimelineFilters): BrowserVaultTimelineRow[];
  };
}

export type BrowserVaultMetricSeriesCoverage =
  | { bucketId: BrowserVaultMetricBucketId; status: "unloaded" }
  | { bucketId: BrowserVaultMetricBucketId | null; rowCount: 0; status: "loaded-empty" }
  | { bucketId: BrowserVaultMetricBucketId; rowCount: number; status: "loaded" };

interface BrowserVaultMetricsQueryAccess {
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
}

interface BrowserVaultLabsQueryAccess {
  labResults: {
    list(filters?: BrowserVaultLabResultFilters): BrowserVaultLabResultRow[];
  };
}

export interface BrowserVaultCoreQueryClient extends BrowserVaultCoreQueryAccess {
  capability: "core";
  replica: BrowserVaultCoreReplica;
}

export interface BrowserVaultMetricsQueryClient extends BrowserVaultCoreQueryAccess, BrowserVaultMetricsQueryAccess {
  capability: "core+metrics";
  replica: BrowserVaultMetricsReplica;
}

/** A route-scoped metrics client. Its replica intentionally has no metricRows field. */
export interface BrowserVaultInteractiveMetricsQueryClient extends BrowserVaultCoreQueryAccess, BrowserVaultMetricsQueryAccess {
  capability: "core+metrics-partial";
  loadedMetricBuckets: readonly BrowserVaultMetricBucketId[];
  metricCoverage: {
    get(metricKey: string): BrowserVaultMetricSeriesCoverage;
  };
  replica: BrowserVaultMetricsIndexReplica;
}

export interface BrowserVaultInteractiveQueryClient extends BrowserVaultCoreQueryAccess, BrowserVaultMetricsQueryAccess, BrowserVaultLabsQueryAccess {
  capability: "core+metrics-partial+labs";
  loadedMetricBuckets: readonly BrowserVaultMetricBucketId[];
  metricCoverage: BrowserVaultInteractiveMetricsQueryClient["metricCoverage"];
  replica: BrowserVaultMetricsIndexReplica & Pick<BrowserVaultReplica, "labResultRows">;
}

export interface BrowserVaultLabsQueryClient extends BrowserVaultCoreQueryAccess, BrowserVaultLabsQueryAccess {
  capability: "core+labs";
  replica: BrowserVaultLabsReplica;
}

export interface BrowserVaultQueryClient extends BrowserVaultCoreQueryAccess, BrowserVaultMetricsQueryAccess, BrowserVaultLabsQueryAccess {
  capability: "core+metrics+labs";
  replica: BrowserVaultReplica & {
    experimentOutcomes: ExperimentOutcome[];
    experimentRunCards: BrowserVaultExperimentRunCard[];
    hasLabBiomarkers: boolean;
  };
}

export type BrowserVaultCoreCapableQueryClient =
  | BrowserVaultCoreQueryClient
  | BrowserVaultInteractiveMetricsQueryClient
  | BrowserVaultInteractiveQueryClient
  | BrowserVaultMetricsQueryClient
  | BrowserVaultLabsQueryClient
  | BrowserVaultQueryClient;

export type BrowserVaultMetricsCapableQueryClient =
  | BrowserVaultMetricsQueryClient
  | BrowserVaultQueryClient;

export type BrowserVaultMetricSeriesCapableQueryClient =
  | BrowserVaultInteractiveMetricsQueryClient
  | BrowserVaultInteractiveQueryClient
  | BrowserVaultMetricsCapableQueryClient;

export type BrowserVaultLabsCapableQueryClient =
  | BrowserVaultLabsQueryClient
  | BrowserVaultInteractiveQueryClient
  | BrowserVaultQueryClient;

export interface BrowserVaultOverviewView {
  experimentSummary: OverviewExperimentSummary;
  metrics: OverviewMetric[];
  personalPatterns: PersonalPatternReport;
  recentJournals: OverviewJournalEntry[];
  trackedExperiments: OverviewExperiment[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
}
