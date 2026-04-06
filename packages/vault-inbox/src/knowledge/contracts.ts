export interface KnowledgePageReference {
  compiledAt: string | null
  librarySlugs: string[]
  pagePath: string
  pageType: string | null
  relatedSlugs: string[]
  slug: string
  sourcePaths: string[]
  status: string | null
  summary: string | null
  title: string
}

export interface KnowledgePageMetadata extends KnowledgePageReference {}

export interface KnowledgePage extends KnowledgePageMetadata {
  body: string
  markdown: string
}

export interface KnowledgeUpsertResult {
  vault: string
  indexPath: string
  page: KnowledgePageMetadata
  bodyLength: number
  savedAt: string
}

export interface KnowledgeListResult {
  pageCount: number
  pageType: string | null
  pages: KnowledgePageMetadata[]
  status: string | null
  vault: string
}

export interface KnowledgeSearchHit extends KnowledgePageReference {
  matchedTerms: string[]
  score: number
  snippet: string
}

export interface KnowledgeLogEntry {
  action: string
  block: string
  occurredAt: string
  title: string
}

export interface KnowledgeLogTailResult {
  count: number
  entries: KnowledgeLogEntry[]
  limit: number
  logPath: string
  vault: string
}

export interface KnowledgeSearchResult {
  format: 'murph.knowledge-search.v1'
  hits: KnowledgeSearchHit[]
  pageType: string | null
  query: string
  status: string | null
  total: number
  vault: string
}

export interface KnowledgeGetResult {
  page: KnowledgePage
  vault: string
}

export interface KnowledgeIndexRebuildResult {
  indexPath: string
  pageCount: number
  pageTypes: string[]
  rebuilt: true
  vault: string
}

export interface KnowledgeLintProblem {
  code: string
  message: string
  pagePath: string
  slug: string | null
  severity: 'error' | 'warning'
}

export interface KnowledgeLintResult {
  ok: boolean
  pageCount: number
  problemCount: number
  problems: KnowledgeLintProblem[]
  vault: string
}
