import {
  describeLookupConstraint as describeQueryLookupConstraint,
  inferIdEntityKind as inferQueryIdEntityKind,
  isQueryableLookupId as isQueryableQueryLookupId,
} from '@murph/query'
import { loadRuntimeModule } from './runtime-import.js'

type QueryModule = typeof import('@murph/query')

export type QueryRuntimeModule = Pick<
  QueryModule,
  | 'ALL_VAULT_RECORD_TYPES'
  | 'buildExportPack'
  | 'buildTimeline'
  | 'describeLookupConstraint'
  | 'getSqliteSearchStatus'
  | 'inferIdEntityKind'
  | 'isQueryableLookupId'
  | 'listEntities'
  | 'listRecords'
  | 'lookupEntityById'
  | 'lookupRecordById'
  | 'listSupplements'
  | 'readVault'
  | 'readVaultTolerant'
  | 'rebuildSqliteSearchIndex'
  | 'searchVaultRuntime'
  | 'showSupplement'
  | 'showSupplementCompound'
>

export type QueryVaultReadModel = Awaited<
  ReturnType<QueryRuntimeModule['readVault']>
>
export type QueryVaultRecord = NonNullable<
  ReturnType<QueryRuntimeModule['lookupRecordById']>
>
export type QueryVaultRecordType = QueryVaultRecord['recordType']
export type QueryCanonicalEntity = NonNullable<
  ReturnType<QueryRuntimeModule['lookupEntityById']>
>
export type QueryEntityFamily = QueryCanonicalEntity['family']
export type QueryListEntityFilters = NonNullable<
  Parameters<QueryRuntimeModule['listEntities']>[1]
>
export type QueryListRecordFilters = NonNullable<
  Parameters<QueryRuntimeModule['listRecords']>[1]
>
export type QuerySearchFilters = NonNullable<
  Parameters<QueryRuntimeModule['searchVaultRuntime']>[2]
>
export type QuerySearchOptions = NonNullable<
  Parameters<QueryRuntimeModule['searchVaultRuntime']>[3]
>
export type QuerySearchResult = Awaited<
  ReturnType<QueryRuntimeModule['searchVaultRuntime']>
>
export type QuerySqliteSearchStatus = ReturnType<
  QueryRuntimeModule['getSqliteSearchStatus']
>
export type QuerySqliteSearchRebuildResult = Awaited<
  ReturnType<QueryRuntimeModule['rebuildSqliteSearchIndex']>
>
export type QueryTimelineFilters = NonNullable<
  Parameters<QueryRuntimeModule['buildTimeline']>[1]
>
export type QueryTimelineEntry = ReturnType<
  QueryRuntimeModule['buildTimeline']
>[number]
export type QueryExportPackOptions = NonNullable<
  Parameters<QueryRuntimeModule['buildExportPack']>[1]
>
export type QueryExportPack = ReturnType<QueryRuntimeModule['buildExportPack']>

export {
  describeQueryLookupConstraint,
  inferQueryIdEntityKind,
  isQueryableQueryLookupId,
}

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadRuntimeModule<QueryRuntimeModule>('@murph/query')
}
