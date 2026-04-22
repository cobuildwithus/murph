import {
  type BuildExportPackOptions as SharedBuildExportPackOptions,
  type CanonicalEntity as SharedCanonicalEntity,
  type CanonicalEntityFamily as SharedCanonicalEntityFamily,
  type EntityFilter as SharedEntityFilter,
  type ExportPack as SharedExportPack,
  type ExportPackFile as SharedExportPackFile,
  type MealNutritionDayTotal as SharedMealNutritionDayTotal,
  type MealNutritionMetricTotal as SharedMealNutritionMetricTotal,
  type MealNutritionTotals as SharedMealNutritionTotals,
  type MealNutritionTotalsOptions as SharedMealNutritionTotalsOptions,
  type MealNutritionTotalsResult as SharedMealNutritionTotalsResult,
  type QueryProjectionStatus as SharedQueryProjectionStatus,
  type RebuildQueryProjectionResult as SharedQueryProjectionRebuildResult,
  type SearchCitation as SharedSearchCitation,
  type SearchFilters as SharedSearchFilters,
  type SearchHit as SharedSearchHit,
  type SearchResult as SharedSearchResult,
  type TimelineEntry as SharedTimelineEntry,
  type TimelineFilters as SharedTimelineFilters,
  type VaultEntitiesByFamily as SharedVaultEntitiesByFamily,
  type VaultReadModel as SharedVaultReadModel,
  type WearableActivitySummary as WearableActivitySummaryShape,
  type WearableBodyStateSummary as WearableBodyStateSummaryShape,
  type WearableDriftSummary as WearableDriftSummaryShape,
  type WearableDaySummary as WearableDaySummaryShape,
  type WearableLatestSummary as WearableLatestSummaryShape,
  type WearableRecoverySummary as WearableRecoverySummaryShape,
  type WearableSleepSummary as WearableSleepSummaryShape,
  type WearableMetricLatestSummary as WearableMetricLatestSummaryShape,
  type WearableMetricSummaryFilters as WearableMetricSummaryFiltersShape,
  type WearableMetricTrendSummary as WearableMetricTrendSummaryShape,
  type WearableSourceHealthSummary as WearableSourceHealthSummaryShape,
  type WearableSummaryFilters as WearableSummaryFiltersShape,
} from '@murphai/query'
import type { ExperimentStatus } from '@murphai/contracts'
import {
  describeLookupConstraint as describeSharedLookupConstraint,
  inferIdEntityKind as inferSharedIdEntityKind,
  isQueryableLookupId as isSharedQueryableLookupId,
} from '@murphai/query/id-families'
import { loadRuntimeModule } from './runtime-import.js'

export type QueryEntityFamily = SharedCanonicalEntityFamily
export type QueryCanonicalEntity = SharedCanonicalEntity
export type QueryEntity = QueryCanonicalEntity
export type QueryEntitiesByFamily = SharedVaultEntitiesByFamily
export type QueryVaultReadModel = SharedVaultReadModel
export type QueryListEntityFilters = SharedEntityFilter
export type QuerySearchCitation = SharedSearchCitation
export type QuerySearchHit = SharedSearchHit
export type QuerySearchFilters = SharedSearchFilters
export type QuerySearchResult = SharedSearchResult
export type QueryProjectionStatus = SharedQueryProjectionStatus
export type QueryProjectionRebuildResult = SharedQueryProjectionRebuildResult
export type QueryTimelineFilters = SharedTimelineFilters
export type QueryTimelineEntry = SharedTimelineEntry
export type QueryExportPackFile = SharedExportPackFile
export type QueryExportPackOptions = SharedBuildExportPackOptions
export type QueryExportPack = SharedExportPack
export type QueryMealNutritionMetricTotal = SharedMealNutritionMetricTotal
export type QueryMealNutritionTotals = SharedMealNutritionTotals
export type QueryMealNutritionDayTotal = SharedMealNutritionDayTotal
export type QueryMealNutritionTotalsOptions = SharedMealNutritionTotalsOptions
export type QueryMealNutritionTotalsResult = SharedMealNutritionTotalsResult
export interface QueryExperimentMetricResult {
  baselineDayCount: number
  baselineMean: number | null
  biomarkerKey: string
  completeness: "insufficient" | "partial" | "good"
  deltaAbs: number | null
  deltaPct: number | null
  expectedDirection: "increase" | "decrease" | "stabilize" | null
  interventionDayCount: number
  interventionMean: number | null
  label: string
  movedAsExpected: boolean | null
  unit: string | null
}
export interface QueryExperimentWindows {
  baselineEnd: string | null
  baselineStart: string | null
  interventionEnd: string | null
  interventionStart: string | null
}
export interface QueryExperimentProgressSummary {
  schema: "murph.experiment-progress.v1"
  asOf: string
  adherence: {
    completedSessions: number
    expectedSessionsByNow: number | null
    minimumUsefulSessions: number | null
    status: "not_started" | "behind" | "on_track" | "met_minimum" | "met_target" | "unknown"
    targetSessions: number | null
  }
  confounders: string[]
  dataCoverage: {
    baselineDaysAvailable: number
    interventionDaysAvailable: number
    primaryMetricDaysAvailable: number
    status:
      | "no_wearable_data"
      | "insufficient"
      | "partial"
      | "sufficient_for_progress"
      | "ready_for_review"
    wearableProviders: string[]
  }
  dayInRun: number | null
  experiment: {
    id: string
    slug: string
    status: ExperimentStatus
    title: string
  }
  phase: "planned" | "baseline" | "intervention" | "review_due" | "completed" | "paused" | "abandoned"
  protocolRef: Record<string, unknown> | null
  recommendation: {
    action: "skip" | "remind" | "summary" | "review"
    reason: string
    shouldNotifyUser: boolean
  }
  signals: QueryExperimentMetricResult[]
  windows: QueryExperimentWindows
}
export interface QueryExperimentOutcomeSummary {
  schema: "murph.experiment-outcome.v1"
  adherenceSummary: {
    completedSessions: number
    minimumUsefulSessions: number | null
    status: "not_started" | "behind" | "on_track" | "met_minimum" | "met_target" | "unknown"
    targetSessions: number | null
  }
  asOf: string
  conclusion: {
    caveats: string[]
    headline: string
    plainLanguage: string
  }
  confidence: {
    level: "low" | "medium" | "high"
    reasons: string[]
  }
  confounders: string[]
  experiment: {
    id: string
    slug: string
    status: ExperimentStatus
    title: string
  }
  metricResults: QueryExperimentMetricResult[]
  protocolRef: Record<string, unknown> | null
  windows: QueryExperimentWindows
}

export type QueryWearableSummaryFilters = WearableSummaryFiltersShape
export type QueryWearableMetricSummaryFilters = WearableMetricSummaryFiltersShape
export type QueryWearableSleepSummary = WearableSleepSummaryShape
export type QueryWearableActivitySummary = WearableActivitySummaryShape
export type QueryWearableBodyStateSummary = WearableBodyStateSummaryShape
export type QueryWearableDaySummary = WearableDaySummaryShape
export type QueryWearableLatestSummary = WearableLatestSummaryShape
export type QueryWearableMetricLatestSummary = WearableMetricLatestSummaryShape
export type QueryWearableMetricTrendSummary = WearableMetricTrendSummaryShape
export type QueryWearableDriftSummary = WearableDriftSummaryShape
export type QueryWearableRecoverySummary = WearableRecoverySummaryShape
export type QueryWearableSourceHealthSummary = WearableSourceHealthSummaryShape

type SharedQueryRuntimeModule = typeof import('@murphai/query')

type SharedQueryRuntimeBaseModule = Pick<
  SharedQueryRuntimeModule,
  | 'buildExportPack'
  | 'buildTimeline'
  | 'describeLookupConstraint'
  | 'getQueryProjectionStatus'
  | 'inferIdEntityKind'
  | 'isQueryableLookupId'
  | 'listEntities'
  | 'listSupplements'
  | 'lookupEntityById'
  | 'readVault'
  | 'readVaultTolerant'
  | 'rebuildQueryProjection'
  | 'searchVaultRuntime'
  | 'showSupplement'
  | 'showSupplementCompound'
  | 'summarizeWearableActivity'
  | 'summarizeWearableBodyState'
  | 'summarizeWearableDay'
  | 'summarizeWearableLatest'
  | 'summarizeWearableMetricLatest'
  | 'summarizeWearableMetricTrend'
  | 'summarizeWearableRecovery'
  | 'summarizeWearableSleep'
  | 'summarizeWearableSourceHealth'
  | 'explainWearableDrift'
>

export interface QueryRuntimeModule extends SharedQueryRuntimeBaseModule {
  analyzeExperimentOutcome(
    vault: QueryVaultReadModel,
    slug: string,
    options?: { asOf?: string },
  ): QueryExperimentOutcomeSummary
  readMealNutritionTotals(
    vaultRoot: string,
    options?: QueryMealNutritionTotalsOptions,
  ): Promise<QueryMealNutritionTotalsResult>
  summarizeExperimentProgress(
    vault: QueryVaultReadModel,
    slug: string,
    options?: { asOf?: string },
  ): QueryExperimentProgressSummary
}

export function inferQueryIdEntityKind(id: string): string {
  return inferSharedIdEntityKind(id)
}

export function isQueryableQueryLookupId(id: string): boolean {
  return isSharedQueryableLookupId(id)
}

export function describeQueryLookupConstraint(id: string): string | null {
  return describeSharedLookupConstraint(id)
}

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadRuntimeModule<QueryRuntimeModule>('@murphai/query')
}
