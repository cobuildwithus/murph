import type {
  CanonicalEntity as SharedCanonicalEntity,
  CanonicalEntityFamily as SharedCanonicalEntityFamily,
  MealNutrientDayTotal as SharedMealNutrientDayTotal,
  MealNutrientTotal as SharedMealNutrientTotal,
  MealNutritionDayTotal as SharedMealNutritionDayTotal,
  MealNutritionMetricTotal as SharedMealNutritionMetricTotal,
  MealNutritionTotals as SharedMealNutritionTotals,
  MealNutritionTotalsResult as SharedMealNutritionTotalsResult,
  QueryMetricPointFilters as SharedQueryMetricPointFilters,
  QueryProjectionStatus as SharedQueryProjectionStatus,
  VaultReadModel as SharedVaultReadModel,
  WearableSleepPatternSummary as WearableSleepPatternSummaryShape,
} from '@murphai/query'
import { loadRuntimeModule } from './runtime-import.js'

export type QueryEntityFamily = SharedCanonicalEntityFamily
export type QueryCanonicalEntity = SharedCanonicalEntity
export type QueryEntity = QueryCanonicalEntity
export type QueryVaultReadModel = SharedVaultReadModel
export type QueryProjectionStatus = SharedQueryProjectionStatus
export type QueryMetricPointFilters = SharedQueryMetricPointFilters
export type QueryMealNutrientTotal = SharedMealNutrientTotal
export type QueryMealNutrientDayTotal = SharedMealNutrientDayTotal
export type QueryMealNutritionMetricTotal = SharedMealNutritionMetricTotal
export type QueryMealNutritionTotals = SharedMealNutritionTotals
export type QueryMealNutritionDayTotal = SharedMealNutritionDayTotal
export type QueryMealNutritionTotalsResult = SharedMealNutritionTotalsResult

export type QueryWearableSleepPatternSummary = WearableSleepPatternSummaryShape

type OwnerQueryRuntimeModule = typeof import('@murphai/query')

export type QueryRuntimeModule = OwnerQueryRuntimeModule
export type QueryExperimentProgressSummary =
  ReturnType<QueryRuntimeModule['summarizeExperimentProgress']>
export type QueryExperimentOutcomeSummary =
  ReturnType<QueryRuntimeModule['analyzeExperimentOutcome']>
export type QueryExperimentFollowupDueDecision =
  ReturnType<QueryRuntimeModule['decideExperimentFollowupDue']>

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadRuntimeModule<QueryRuntimeModule>('@murphai/query')
}
