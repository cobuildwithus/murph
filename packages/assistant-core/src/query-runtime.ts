import type { JsonObject } from '@murphai/contracts'
import {
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

export const ALL_QUERY_ENTITY_FAMILIES = [
  'allergy',
  'assessment',
  'audit',
  'condition',
  'core',
  'current_profile',
  'event',
  'experiment',
  'family',
  'food',
  'genetics',
  'goal',
  'history',
  'journal',
  'profile_snapshot',
  'protocol',
  'provider',
  'recipe',
  'sample',
  'workout_format',
] as const

type QueryRecordClass = 'bank' | 'ledger' | 'sample' | 'snapshot'

export type QueryEntityFamily = typeof ALL_QUERY_ENTITY_FAMILIES[number]

export interface QueryEntityLink {
  type: string
  targetId: string
}

export interface QueryCanonicalEntity {
  entityId: string
  primaryLookupId: string
  lookupIds: string[]
  family: QueryEntityFamily
  recordClass: QueryRecordClass
  kind: string
  status: string | null
  occurredAt: string | null
  date: string | null
  path: string
  title: string | null
  body: string | null
  attributes: JsonObject
  frontmatter: JsonObject | null
  links: QueryEntityLink[]
  relatedIds: string[]
  stream: string | null
  experimentSlug: string | null
  tags: string[]
}

export type QueryEntity = QueryCanonicalEntity

export type QueryEntitiesByFamily = Partial<Record<QueryEntityFamily, QueryCanonicalEntity[]>>

export interface QueryVaultReadModel {
  format: string
  vaultRoot: string
  metadata: JsonObject | null
  entities: QueryCanonicalEntity[]
  byFamily: QueryEntitiesByFamily
  coreDocument: QueryCanonicalEntity | null
  experiments: QueryCanonicalEntity[]
  journalEntries: QueryCanonicalEntity[]
  events: QueryCanonicalEntity[]
  samples: QueryCanonicalEntity[]
  audits: QueryCanonicalEntity[]
  assessments: QueryCanonicalEntity[]
  profileSnapshots: QueryCanonicalEntity[]
  currentProfile: QueryCanonicalEntity | null
  goals: QueryCanonicalEntity[]
  conditions: QueryCanonicalEntity[]
  allergies: QueryCanonicalEntity[]
  protocols: QueryCanonicalEntity[]
  history: QueryCanonicalEntity[]
  familyMembers: QueryCanonicalEntity[]
  geneticVariants: QueryCanonicalEntity[]
  foods: QueryCanonicalEntity[]
  recipes: QueryCanonicalEntity[]
  providers: QueryCanonicalEntity[]
  workoutFormats: QueryCanonicalEntity[]
}

export interface QueryListEntityFilters {
  ids?: string[]
  families?: QueryEntityFamily[]
  recordClasses?: QueryRecordClass[]
  kinds?: string[]
  statuses?: string[]
  streams?: string[]
  experimentSlug?: string
  date?: string
  from?: string
  to?: string
  tags?: string[]
  text?: string
}

export interface QuerySearchCitation {
  path: string
  recordId: string
  aliasIds: string[]
}

export interface QuerySearchHit {
  recordId: string
  aliasIds: string[]
  recordType: QueryEntityFamily
  kind: string | null
  stream: string | null
  title: string | null
  occurredAt: string | null
  date: string | null
  experimentSlug: string | null
  tags: string[]
  path: string
  snippet: string
  score: number
  matchedTerms: string[]
  citation: QuerySearchCitation
}

export interface QuerySearchFilters {
  recordTypes?: QueryEntityFamily[]
  kinds?: string[]
  streams?: string[]
  experimentSlug?: string
  from?: string
  to?: string
  tags?: string[]
  limit?: number
  includeSamples?: boolean
}

export interface QuerySearchOptions {
  backend?: 'auto' | 'scan' | 'sqlite'
}

export interface QuerySearchResult {
  format: string
  query: string
  total: number
  hits: QuerySearchHit[]
}

export interface QuerySqliteSearchStatus {
  backend: 'sqlite'
  dbPath: string
  exists: boolean
  schemaVersion: string | null
  indexedAt: string | null
  documentCount: number
}

export interface QuerySqliteSearchRebuildResult extends QuerySqliteSearchStatus {
  rebuilt: true
}

export interface QueryTimelineFilters {
  from?: string
  to?: string
  experimentSlug?: string
  kinds?: string[]
  streams?: string[]
  includeJournal?: boolean
  includeEvents?: boolean
  includeAssessments?: boolean
  includeHistory?: boolean
  includeProfileSnapshots?: boolean
  includeDailySampleSummaries?: boolean
  limit?: number
}

export interface QueryTimelineEntry {
  id: string
  entryType:
    | 'assessment'
    | 'event'
    | 'history'
    | 'journal'
    | 'profile_snapshot'
    | 'sample_summary'
  occurredAt: string
  date: string
  title: string
  kind: string
  stream: string | null
  experimentSlug: string | null
  path: string | null
  relatedIds: string[]
  tags: string[]
  data: JsonObject
}

export interface QueryExportPackFile {
  path: string
  mediaType: 'application/json' | 'text/markdown'
  contents: string
}

export interface QueryExportPackOptions {
  from?: string
  to?: string
  experimentSlug?: string
  packId?: string
  generatedAt?: string
}

export interface QueryExportPack {
  format: string
  packId: string
  basePath: string
  generatedAt: string
  filters: {
    from: string | null
    to: string | null
    experimentSlug: string | null
  }
  manifest: JsonObject
  files: QueryExportPackFile[]
}

export type QueryWearableSummaryFilters = WearableSummaryFiltersShape
export type QueryWearableSleepSummary = WearableSleepSummaryShape
export type QueryWearableActivitySummary = WearableActivitySummaryShape
export type QueryWearableBodyStateSummary = WearableBodyStateSummaryShape
export type QueryWearableDaySummary = WearableDaySummaryShape
export type QueryWearableRecoverySummary = WearableRecoverySummaryShape
export type QueryWearableSourceHealthSummary = WearableSourceHealthSummaryShape

export interface QueryRuntimeModule {
  ALL_QUERY_ENTITY_FAMILIES: readonly QueryEntityFamily[]
  buildExportPack(
    vault: QueryVaultReadModel,
    options?: QueryExportPackOptions,
  ): QueryExportPack
  buildTimeline(
    vault: QueryVaultReadModel,
    filters?: QueryTimelineFilters,
  ): QueryTimelineEntry[]
  describeLookupConstraint(id: string): string | null
  getSqliteSearchStatus(vaultRoot: string): QuerySqliteSearchStatus
  inferIdEntityKind(id: string): string
  isQueryableLookupId(id: string): boolean
  listEntities(
    vault: QueryVaultReadModel,
    filters?: QueryListEntityFilters,
  ): QueryCanonicalEntity[]
  lookupEntityById(
    vault: QueryVaultReadModel,
    lookup: string,
  ): QueryCanonicalEntity | null
  listSupplements(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  readVault(vaultRoot: string): Promise<QueryVaultReadModel>
  readVaultTolerant(vaultRoot: string): Promise<QueryVaultReadModel>
  rebuildSqliteSearchIndex(
    vaultRoot: string,
  ): Promise<QuerySqliteSearchRebuildResult>
  searchVaultRuntime(
    vaultRoot: string,
    query: string,
    filters?: QuerySearchFilters,
    options?: QuerySearchOptions,
  ): Promise<QuerySearchResult>
  summarizeWearableSleep(
    vault: QueryVaultReadModel,
    filters?: QueryWearableSummaryFilters,
  ): QueryWearableSleepSummary[]
  summarizeWearableActivity(
    vault: QueryVaultReadModel,
    filters?: QueryWearableSummaryFilters,
  ): QueryWearableActivitySummary[]
  summarizeWearableBodyState(
    vault: QueryVaultReadModel,
    filters?: QueryWearableSummaryFilters,
  ): QueryWearableBodyStateSummary[]
  summarizeWearableDay(
    vault: QueryVaultReadModel,
    date: string,
    filters?: Omit<QueryWearableSummaryFilters, 'from' | 'to' | 'limit'>,
  ): QueryWearableDaySummary | null
  summarizeWearableRecovery(
    vault: QueryVaultReadModel,
    filters?: QueryWearableSummaryFilters,
  ): QueryWearableRecoverySummary[]
  summarizeWearableSourceHealth(
    vault: QueryVaultReadModel,
    filters?: QueryWearableSummaryFilters,
  ): QueryWearableSourceHealthSummary[]
  showSupplement(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showSupplementCompound(
    vaultRoot: string,
    lookup: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject | null>
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
