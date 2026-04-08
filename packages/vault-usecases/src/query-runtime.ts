import {
  ALL_QUERY_ENTITY_FAMILIES as SHARED_QUERY_ENTITY_FAMILIES,
  type BuildExportPackOptions as SharedBuildExportPackOptions,
  type CanonicalEntity as SharedCanonicalEntity,
  type CanonicalEntityFamily as SharedCanonicalEntityFamily,
  type EntityFilter as SharedEntityFilter,
  type ExportPack as SharedExportPack,
  type ExportPackFile as SharedExportPackFile,
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
  type WearableDaySummary as WearableDaySummaryShape,
  type WearableRecoverySummary as WearableRecoverySummaryShape,
  type WearableSleepSummary as WearableSleepSummaryShape,
  type WearableSourceHealthSummary as WearableSourceHealthSummaryShape,
  type WearableSummaryFilters as WearableSummaryFiltersShape,
} from '@murphai/query'
import {
  describeLookupConstraint as describeSharedLookupConstraint,
  inferIdEntityKind as inferSharedIdEntityKind,
  isQueryableLookupId as isSharedQueryableLookupId,
} from '@murphai/query/id-families'
import { loadRuntimeModule } from './runtime-import.js'

export const ALL_QUERY_ENTITY_FAMILIES = SHARED_QUERY_ENTITY_FAMILIES

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

export type QueryWearableSummaryFilters = WearableSummaryFiltersShape
export type QueryWearableSleepSummary = WearableSleepSummaryShape
export type QueryWearableActivitySummary = WearableActivitySummaryShape
export type QueryWearableBodyStateSummary = WearableBodyStateSummaryShape
export type QueryWearableDaySummary = WearableDaySummaryShape
export type QueryWearableRecoverySummary = WearableRecoverySummaryShape
export type QueryWearableSourceHealthSummary = WearableSourceHealthSummaryShape

type SharedQueryRuntimeModule = typeof import('@murphai/query')

export type QueryRuntimeModule = Pick<
  SharedQueryRuntimeModule,
  | 'ALL_QUERY_ENTITY_FAMILIES'
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
  | 'summarizeWearableRecovery'
  | 'summarizeWearableSleep'
  | 'summarizeWearableSourceHealth'
>

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
