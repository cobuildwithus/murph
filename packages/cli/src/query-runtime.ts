import { loadRuntimeModule } from './runtime-import.js'

export interface QueryRuntimeModule {
  readVault(vaultRoot: string): Promise<unknown>
  searchVault(
    vault: unknown,
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
  ): {
    query: string
    total: number
    hits: unknown[]
  }
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
      includeDailySampleSummaries?: boolean
      limit?: number
    },
  ): unknown[]
}

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadRuntimeModule<QueryRuntimeModule>('@healthybob/query')
}
