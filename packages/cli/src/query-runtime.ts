import { loadRuntimeModule } from './runtime-import.js'

export interface QueryRuntimeModule {
  readVault(vaultRoot: string): Promise<unknown>
  searchVaultRuntime(
    vaultRoot: string,
    query: string,
    filters: {
      recordTypes?: string[]
      kinds?: string[]
      streams?: string[]
      experimentSlug?: string
      from?: string
      to?: string
      tags?: string[]
      limit?: number
    },
    options?: {
      backend?: 'auto' | 'scan' | 'sqlite'
    },
  ): Promise<{
    query: string
    total: number
    hits: unknown[]
  }>
  getSqliteSearchStatus(vaultRoot: string): {
    backend: 'sqlite'
    dbPath: string
    exists: boolean
    schemaVersion: string | null
    indexedAt: string | null
    documentCount: number
  }
  rebuildSqliteSearchIndex(vaultRoot: string): Promise<{
    backend: 'sqlite'
    dbPath: string
    exists: boolean
    schemaVersion: string | null
    indexedAt: string | null
    documentCount: number
    rebuilt: true
  }>
  buildTimeline(
    vault: unknown,
    filters: {
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
    },
  ): unknown[]
}

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadRuntimeModule<QueryRuntimeModule>('@healthybob/query')
}
