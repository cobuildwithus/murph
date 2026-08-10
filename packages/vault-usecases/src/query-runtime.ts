import type {
  BuildExportPackOptions as SharedBuildExportPackOptions,
  CanonicalEntity as SharedCanonicalEntity,
  CanonicalEntityFamily as SharedCanonicalEntityFamily,
  EntityFilter as SharedEntityFilter,
  ExportPack as SharedExportPack,
  ExportPackFile as SharedExportPackFile,
  MealNutritionDayTotal as SharedMealNutritionDayTotal,
  MealNutritionMetricTotal as SharedMealNutritionMetricTotal,
  MealNutritionTotals as SharedMealNutritionTotals,
  MealNutritionTotalsOptions as SharedMealNutritionTotalsOptions,
  MealNutritionTotalsResult as SharedMealNutritionTotalsResult,
  QueryMetricPointFilters as SharedQueryMetricPointFilters,
  QueryProjectionStatus as SharedQueryProjectionStatus,
  RebuildQueryProjectionResult as SharedQueryProjectionRebuildResult,
  SearchCitation as SharedSearchCitation,
  SearchFilters as SharedSearchFilters,
  SearchHit as SharedSearchHit,
  SearchResult as SharedSearchResult,
  TimelineEntry as SharedTimelineEntry,
  TimelineFilters as SharedTimelineFilters,
  VaultEntitiesByFamily as SharedVaultEntitiesByFamily,
  VaultReadModel as SharedVaultReadModel,
  ProjectedWearableActivitySummary as WearableActivitySummaryShape,
  ProjectedWearableBodyStateSummary as WearableBodyStateSummaryShape,
  ProjectedWearableDriftSummary as WearableDriftSummaryShape,
  ProjectedWearableDaySummary as WearableDaySummaryShape,
  ProjectedWearableLatestSummary as WearableLatestSummaryShape,
  ProjectedWearableRecoverySummary as WearableRecoverySummaryShape,
  ProjectedWearableSleepSummary as WearableSleepSummaryShape,
  WearableSleepPatternFilters as WearableSleepPatternFiltersShape,
  WearableSleepPatternSummary as WearableSleepPatternSummaryShape,
  ProjectedWearableMetricLatestSummary as WearableMetricLatestSummaryShape,
  WearableMetricSummaryFilters as WearableMetricSummaryFiltersShape,
  ProjectedWearableMetricTrendSummary as WearableMetricTrendSummaryShape,
  ProjectedWearableSourceHealthSummary as WearableSourceHealthSummaryShape,
  PersonalPatternReport as PersonalPatternReportShape,
  WearableSummaryFilters as WearableSummaryFiltersShape,
} from '@murphai/query'
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
export type QueryMetricPointFilters = SharedQueryMetricPointFilters
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

export type QueryWearableSummaryFilters = WearableSummaryFiltersShape
export type QueryWearableMetricSummaryFilters = WearableMetricSummaryFiltersShape
export type QueryWearableSleepSummary = WearableSleepSummaryShape
export type QueryWearableSleepPatternFilters = WearableSleepPatternFiltersShape
export type QueryWearableSleepPatternSummary = WearableSleepPatternSummaryShape
export type QueryWearableActivitySummary = WearableActivitySummaryShape
export type QueryWearableBodyStateSummary = WearableBodyStateSummaryShape
export type QueryWearableDaySummary = WearableDaySummaryShape
export type QueryWearableLatestSummary = WearableLatestSummaryShape
export type QueryWearableMetricLatestSummary = WearableMetricLatestSummaryShape
export type QueryWearableMetricTrendSummary = WearableMetricTrendSummaryShape
export type QueryWearableDriftSummary = WearableDriftSummaryShape
export type QueryWearableRecoverySummary = WearableRecoverySummaryShape
export type QueryWearableSourceHealthSummary = WearableSourceHealthSummaryShape
export type QueryPersonalPatternReport = PersonalPatternReportShape

type OwnerQueryRuntimeModule = typeof import('@murphai/query')

export type QueryRuntimeModule = OwnerQueryRuntimeModule
export type QueryExperimentProgressSummary =
  ReturnType<QueryRuntimeModule['summarizeExperimentProgress']>
export type QueryExperimentOutcomeSummary =
  ReturnType<QueryRuntimeModule['analyzeExperimentOutcome']>
export type QueryExperimentFollowupDueDecision =
  ReturnType<QueryRuntimeModule['decideExperimentFollowupDue']>
export type QueryExperimentMetricResult =
  QueryExperimentOutcomeSummary['metricResults'][number]
export type QueryExperimentMetricPeriodSummary =
  NonNullable<QueryExperimentMetricResult['baseline']>
export type QueryExperimentWindows = QueryExperimentProgressSummary['windows']

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadRuntimeModule<QueryRuntimeModule>('@murphai/query')
}
