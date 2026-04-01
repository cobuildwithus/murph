import type { JsonObject } from '@murphai/contracts'
import { loadRuntimeModule } from './runtime-import.js'

interface IdFamilyDefinition {
  entityKind: string
  exactIds?: readonly string[]
  prefix?: string
  queryable: boolean
  lookupConstraint?: string
}

const ID_FAMILY_REGISTRY = Object.freeze<IdFamilyDefinition[]>([
  {
    entityKind: 'core',
    exactIds: ['core', 'current'],
    queryable: true,
  },
  {
    entityKind: 'audit',
    prefix: 'aud_',
    queryable: true,
  },
  {
    entityKind: 'event',
    prefix: 'evt_',
    queryable: true,
  },
  {
    entityKind: 'experiment',
    prefix: 'exp_',
    queryable: true,
  },
  {
    entityKind: 'food',
    prefix: 'food_',
    queryable: true,
  },
  {
    entityKind: 'recipe',
    prefix: 'rcp_',
    queryable: true,
  },
  {
    entityKind: 'provider',
    prefix: 'prov_',
    queryable: true,
  },
  {
    entityKind: 'sample',
    prefix: 'smp_',
    queryable: true,
  },
  {
    entityKind: 'workout_format',
    prefix: 'wfmt_',
    queryable: true,
  },
  {
    entityKind: 'journal',
    prefix: 'journal:',
    queryable: true,
  },
  {
    entityKind: 'meal',
    prefix: 'meal_',
    queryable: false,
    lookupConstraint:
      'Meal ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead.',
  },
  {
    entityKind: 'document',
    prefix: 'doc_',
    queryable: false,
    lookupConstraint:
      'Document ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead.',
  },
  {
    entityKind: 'transform',
    prefix: 'xfm_',
    queryable: false,
    lookupConstraint:
      'Transform ids identify an import batch, not a query-layer record. Use the returned lookupIds or `list --kind sample` instead.',
  },
  {
    entityKind: 'export_pack',
    prefix: 'pack_',
    queryable: false,
    lookupConstraint:
      'Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`.',
  },
])

export const ALL_VAULT_RECORD_TYPES = [
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

export type QueryVaultRecordType = typeof ALL_VAULT_RECORD_TYPES[number]
export type QueryEntityFamily = QueryVaultRecordType

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

export interface QueryVaultRecord {
  displayId: string
  primaryLookupId: string
  lookupIds: string[]
  recordType: QueryVaultRecordType
  recordClass: QueryRecordClass
  sourcePath: string
  sourceFile: string
  occurredAt: string | null
  date: string | null
  kind: string | null
  status?: string | null
  stream: string | null
  experimentSlug: string | null
  title: string | null
  tags: string[]
  data: JsonObject
  body: string | null
  frontmatter: JsonObject | null
  links: QueryEntityLink[]
  relatedIds?: string[]
}

export interface QueryVaultReadModel {
  format: string
  vaultRoot: string
  metadata: JsonObject | null
  entities: QueryCanonicalEntity[]
  coreDocument: QueryVaultRecord | null
  experiments: QueryVaultRecord[]
  journalEntries: QueryVaultRecord[]
  events: QueryVaultRecord[]
  samples: QueryVaultRecord[]
  audits: QueryVaultRecord[]
  assessments: QueryVaultRecord[]
  profileSnapshots: QueryVaultRecord[]
  currentProfile: QueryVaultRecord | null
  goals: QueryVaultRecord[]
  conditions: QueryVaultRecord[]
  allergies: QueryVaultRecord[]
  protocols: QueryVaultRecord[]
  history: QueryVaultRecord[]
  familyMembers: QueryVaultRecord[]
  geneticVariants: QueryVaultRecord[]
  foods: QueryVaultRecord[]
  recipes: QueryVaultRecord[]
  providers: QueryVaultRecord[]
  workoutFormats: QueryVaultRecord[]
  records: QueryVaultRecord[]
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

export interface QueryListRecordFilters {
  ids?: string[]
  recordTypes?: QueryVaultRecordType[]
  recordClasses?: QueryRecordClass[]
  kinds?: string[]
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
  recordType: QueryVaultRecordType
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
  recordTypes?: QueryVaultRecordType[]
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

export interface QueryRuntimeModule {
  ALL_VAULT_RECORD_TYPES: readonly QueryVaultRecordType[]
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
  listRecords(
    vault: QueryVaultReadModel,
    filters?: QueryListRecordFilters,
  ): QueryVaultRecord[]
  lookupEntityById(
    vault: QueryVaultReadModel,
    lookup: string,
  ): QueryCanonicalEntity | null
  lookupRecordById(
    vault: QueryVaultReadModel,
    lookup: string,
  ): QueryVaultRecord | null
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
  showSupplement(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showSupplementCompound(
    vaultRoot: string,
    lookup: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject | null>
}

function findIdFamily(id: string): IdFamilyDefinition | null {
  const normalizedId = id.trim()
  if (!normalizedId) {
    return null
  }

  for (const family of ID_FAMILY_REGISTRY) {
    if (family.exactIds?.includes(normalizedId)) {
      return family
    }

    if (family.prefix && normalizedId.startsWith(family.prefix)) {
      return family
    }
  }

  return null
}

export function inferQueryIdEntityKind(id: string): string {
  return findIdFamily(id)?.entityKind ?? 'entity'
}

export function isQueryableQueryLookupId(id: string): boolean {
  return findIdFamily(id)?.queryable ?? false
}

export function describeQueryLookupConstraint(id: string): string | null {
  return findIdFamily(id)?.lookupConstraint ?? null
}

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadRuntimeModule<QueryRuntimeModule>('@murphai/query')
}
