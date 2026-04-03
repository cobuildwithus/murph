import path from 'node:path'
import {
  readMarkdownDocumentOutcome,
  walkRelativeFiles,
  type ParseFailure,
} from './health/loaders.ts'
import {
  asObject,
  compareNullableStrings,
  firstString,
  firstStringArray,
  type FrontmatterObject,
} from './health/shared.ts'

export const DERIVED_KNOWLEDGE_ROOT = 'derived/knowledge'
export const DERIVED_KNOWLEDGE_PAGES_ROOT = `${DERIVED_KNOWLEDGE_ROOT}/pages`
export const DERIVED_KNOWLEDGE_INDEX_PATH = `${DERIVED_KNOWLEDGE_ROOT}/index.md`
const DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 20
const MAX_KNOWLEDGE_SEARCH_LIMIT = 200

export interface DerivedKnowledgeNode {
  attributes: FrontmatterObject
  body: string
  compiledAt: string | null
  compiler: string | null
  mode: string | null
  pageType: string | null
  relativePath: string
  relatedSlugs: string[]
  slug: string
  sourcePaths: string[]
  status: string | null
  summary: string | null
  title: string
}

export interface DerivedKnowledgeGraph {
  bySlug: ReadonlyMap<string, DerivedKnowledgeNode>
  indexPath: string
  nodes: DerivedKnowledgeNode[]
  pagesRoot: string
}

export interface DerivedKnowledgeGraphIssue {
  lineNumber?: number
  parser: 'frontmatter' | 'json'
  reason: string
  relativePath: string
}

export interface DerivedKnowledgeGraphReadResult {
  graph: DerivedKnowledgeGraph
  issues: DerivedKnowledgeGraphIssue[]
}

export interface DerivedKnowledgeSearchFilters {
  limit?: number
  pageType?: string | null
  status?: string | null
}

export interface DerivedKnowledgeSearchHit {
  compiledAt: string | null
  matchedTerms: string[]
  pagePath: string
  pageType: string | null
  relatedSlugs: string[]
  score: number
  slug: string
  snippet: string
  sourcePaths: string[]
  status: string | null
  summary: string | null
  title: string
}

export interface DerivedKnowledgeSearchResult {
  format: 'murph.knowledge-search.v1'
  hits: DerivedKnowledgeSearchHit[]
  query: string
  total: number
}

interface DerivedKnowledgeNodeParseResult {
  issue?: DerivedKnowledgeGraphIssue
  node?: DerivedKnowledgeNode
}

interface DerivedKnowledgeSearchableDocument {
  bodyText: string
  compiledAt: string | null
  pagePath: string
  pageType: string | null
  relatedSlugs: string[]
  slug: string
  sourcePaths: string[]
  status: string | null
  structuredText: string
  summary: string | null
  summaryText: string
  title: string
  titleText: string
}

export async function readDerivedKnowledgeGraph(
  vaultRoot: string,
): Promise<DerivedKnowledgeGraph> {
  return (await readDerivedKnowledgeGraphWithIssues(vaultRoot)).graph
}

export async function readDerivedKnowledgeGraphWithIssues(
  vaultRoot: string,
): Promise<DerivedKnowledgeGraphReadResult> {
  const relativePaths = await walkRelativeFiles(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT, '.md')
  const nodes: DerivedKnowledgeNode[] = []
  const issues: DerivedKnowledgeGraphIssue[] = []

  for (const relativePath of relativePaths) {
    const outcome = await readMarkdownDocumentOutcome(vaultRoot, relativePath)
    if (!outcome.ok) {
      issues.push(parseFailureToIssue(outcome))
      continue
    }

    const parsed = toDerivedKnowledgeNode(
      outcome.document.relativePath,
      outcome.document.body,
      outcome.document.attributes,
    )
    if (parsed.issue) {
      issues.push(parsed.issue)
    }
    if (parsed.node) {
      nodes.push(parsed.node)
    }
  }

  nodes.sort((left, right) => {
    const pageTypeComparison = compareNullableStrings(left.pageType, right.pageType)
    if (pageTypeComparison !== 0) {
      return pageTypeComparison
    }

    const titleComparison = left.title.localeCompare(right.title)
    if (titleComparison !== 0) {
      return titleComparison
    }

    return left.slug.localeCompare(right.slug)
  })

  return {
    graph: {
      bySlug: new Map(nodes.map((node) => [node.slug, node])),
      indexPath: DERIVED_KNOWLEDGE_INDEX_PATH,
      nodes,
      pagesRoot: DERIVED_KNOWLEDGE_PAGES_ROOT,
    },
    issues,
  }
}

export async function searchDerivedKnowledgeVault(
  vaultRoot: string,
  query: string,
  filters: DerivedKnowledgeSearchFilters = {},
): Promise<DerivedKnowledgeSearchResult> {
  const graph = await readDerivedKnowledgeGraph(vaultRoot)
  return searchDerivedKnowledgeGraph(graph, query, filters)
}

export function searchDerivedKnowledgeGraph(
  graph: DerivedKnowledgeGraph,
  query: string,
  filters: DerivedKnowledgeSearchFilters = {},
): DerivedKnowledgeSearchResult {
  const normalizedQuery = query.trim()
  const terms = tokenize(normalizedQuery)

  if (terms.length === 0) {
    return {
      format: 'murph.knowledge-search.v1',
      hits: [],
      query: normalizedQuery,
      total: 0,
    }
  }

  const pageType = normalizeKnowledgeSearchTag(filters.pageType)
  const status = normalizeKnowledgeSearchTag(filters.status)
  const hits = graph.nodes
    .filter((node) => matchesKnowledgeSearchFilter(node.pageType, pageType))
    .filter((node) => matchesKnowledgeSearchFilter(node.status, status))
    .map(materializeKnowledgeSearchDocument)
    .map((candidate) => scoreKnowledgeSearchDocument(candidate, normalizedQuery, terms))
    .filter((entry): entry is DerivedKnowledgeSearchHit => entry !== null)
    .sort(compareKnowledgeSearchHits)

  return {
    format: 'murph.knowledge-search.v1',
    hits: hits.slice(0, normalizeKnowledgeSearchLimit(filters.limit)),
    query: normalizedQuery,
    total: hits.length,
  }
}

function toDerivedKnowledgeNode(
  relativePath: string,
  body: string,
  attributes: FrontmatterObject,
): DerivedKnowledgeNodeParseResult {
  const source = asObject(attributes)
  if (!source) {
    return {}
  }

  const fileSlug = path.posix.basename(relativePath, '.md')
  const slug = firstString(source, ['slug']) ?? fileSlug
  if (!slug) {
    return {}
  }

  if (!isKnowledgeSlug(slug)) {
    return {
      issue: {
        parser: 'frontmatter',
        reason: `Invalid knowledge slug "${slug}".`,
        relativePath,
      },
    }
  }

  const title =
    firstString(source, ['title']) ??
    extractFirstHeading(body) ??
    humanizeSlug(slug)
  const frontmatterSourcePaths = orderedUniqueStrings(
    firstStringArray(source, ['sourcePaths', 'source_paths', 'sources']),
  )
  const bodySourcePaths = extractSourcePaths(body)
  const sourcePaths =
    bodySourcePaths.length > 0
      ? bodySourcePaths
      : frontmatterSourcePaths
  const frontmatterRelatedSlugs = orderedUniqueStrings(
    firstStringArray(source, ['relatedSlugs', 'related_slugs', 'related']),
  )
  const bodyRelatedSlugs = extractRelatedSlugs(body, slug)
  const relatedSlugs =
    bodyRelatedSlugs.length > 0
      ? bodyRelatedSlugs
      : frontmatterRelatedSlugs

  return {
    node: {
      attributes,
      body,
      compiledAt: firstString(source, ['compiledAt', 'compiled_at']),
      compiler: firstString(source, ['compiler']),
      mode: firstString(source, ['mode']),
      pageType: firstString(source, ['pageType', 'page_type', 'entityType', 'entity_type']),
      relativePath,
      relatedSlugs,
      slug,
      sourcePaths,
      status: firstString(source, ['status']),
      summary: firstString(source, ['summary']) ?? summarizeBody(body),
      title,
    },
  }
}

function parseFailureToIssue(failure: ParseFailure): DerivedKnowledgeGraphIssue {
  return {
    lineNumber: failure.lineNumber,
    parser: failure.parser,
    reason: failure.reason,
    relativePath: failure.relativePath,
  }
}

function materializeKnowledgeSearchDocument(
  node: DerivedKnowledgeNode,
): DerivedKnowledgeSearchableDocument {
  return {
    bodyText: compactStrings([node.body]).join('\n').trim(),
    compiledAt: node.compiledAt,
    pagePath: node.relativePath,
    pageType: node.pageType,
    relatedSlugs: node.relatedSlugs,
    slug: node.slug,
    sourcePaths: node.sourcePaths,
    status: node.status,
    structuredText: compactStrings([
      node.slug,
      node.relativePath,
      node.pageType,
      node.status,
      ...node.sourcePaths,
      ...node.relatedSlugs,
    ]).join('\n'),
    summary: node.summary,
    summaryText: compactStrings([node.summary]).join(' ').trim(),
    title: node.title,
    titleText: compactStrings([
      node.title,
      node.pageType,
      node.status,
      node.slug,
    ]).join(' · '),
  }
}

function scoreKnowledgeSearchDocument(
  candidate: DerivedKnowledgeSearchableDocument,
  normalizedQuery: string,
  terms: readonly string[],
): DerivedKnowledgeSearchHit | null {
  const normalizedPhrase = normalizedQuery.toLowerCase()
  const matchedTerms = new Set<string>()
  let score = 0

  const titleLower = candidate.titleText.toLowerCase()
  const summaryLower = candidate.summaryText.toLowerCase()
  const bodyLower = candidate.bodyText.toLowerCase()
  const structuredLower = candidate.structuredText.toLowerCase()

  const titleMetrics = scoreText(titleLower, terms)
  const summaryMetrics = scoreText(summaryLower, terms)
  const bodyMetrics = scoreText(bodyLower, terms)
  const structuredMetrics = scoreText(structuredLower, terms)

  accumulateMatchedTerms(matchedTerms, titleMetrics.matchedTerms)
  accumulateMatchedTerms(matchedTerms, summaryMetrics.matchedTerms)
  accumulateMatchedTerms(matchedTerms, bodyMetrics.matchedTerms)
  accumulateMatchedTerms(matchedTerms, structuredMetrics.matchedTerms)

  if (titleLower.includes(normalizedPhrase)) {
    score += 12
  }
  if (summaryLower.includes(normalizedPhrase)) {
    score += 8
  }
  if (bodyLower.includes(normalizedPhrase)) {
    score += 6
  }
  if (structuredLower.includes(normalizedPhrase)) {
    score += 4
  }

  score += titleMetrics.count * 4.5
  score += summaryMetrics.count * 3.25
  score += bodyMetrics.count * 1.75
  score += structuredMetrics.count * 1

  const coverage = matchedTerms.size / terms.length
  score += coverage * 6

  if (matchedTerms.size === terms.length && terms.length > 1) {
    score += 3
  }

  if (score <= 0) {
    return null
  }

  return {
    compiledAt: candidate.compiledAt,
    matchedTerms: [...matchedTerms].sort(),
    pagePath: candidate.pagePath,
    pageType: candidate.pageType,
    relatedSlugs: candidate.relatedSlugs,
    score: Number(score.toFixed(4)),
    slug: candidate.slug,
    snippet: buildKnowledgeSnippet(candidate, terms),
    sourcePaths: candidate.sourcePaths,
    status: candidate.status,
    summary: candidate.summary,
    title: candidate.title,
  }
}

function compareKnowledgeSearchHits(
  left: DerivedKnowledgeSearchHit,
  right: DerivedKnowledgeSearchHit,
): number {
  if (left.score !== right.score) {
    return right.score - left.score
  }

  const leftDateLike = left.compiledAt ?? ''
  const rightDateLike = right.compiledAt ?? ''
  if (leftDateLike !== rightDateLike) {
    return rightDateLike.localeCompare(leftDateLike)
  }

  return left.slug.localeCompare(right.slug)
}

function buildKnowledgeSnippet(
  candidate: DerivedKnowledgeSearchableDocument,
  terms: readonly string[],
): string {
  for (const source of [
    candidate.summaryText,
    candidate.bodyText,
    candidate.titleText,
    candidate.structuredText,
  ]) {
    const snippet = findSnippet(source, terms)
    if (snippet) {
      return snippet
    }
  }

  return candidate.title || candidate.slug
}

function summarizeBody(body: string): string | null {
  const normalized = body
    .split('\n')
    .map((line) => line.replace(/^#+\s+/u, '').trim())
    .filter(Boolean)
    .join(' ')

  if (!normalized) {
    return null
  }

  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`
}

function extractRelatedSlugs(body: string, currentSlug: string): string[] {
  const matches = body.matchAll(/\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/gu)
  const relatedSlugs: string[] = []

  for (const match of matches) {
    const relatedSlug = match[1]?.trim()
    if (!relatedSlug || relatedSlug === currentSlug) {
      continue
    }

    relatedSlugs.push(relatedSlug)
  }

  return orderedUniqueStrings(relatedSlugs)
}

function extractSourcePaths(body: string): string[] {
  const sectionMatch = /(?:^|\n)##\s+Sources\s*\n([\s\S]*?)(?=\n##\s+|$)/iu.exec(body)
  if (!sectionMatch?.[1]) {
    return []
  }

  const sourcePaths: string[] = []
  for (const line of sectionMatch[1].split('\n')) {
    const match = /^[-*]\s+`([^`]+)`\s*$/u.exec(line.trim())
    if (!match?.[1]) {
      continue
    }

    sourcePaths.push(match[1].trim())
  }

  return orderedUniqueStrings(sourcePaths)
}

function extractFirstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = /^#\s+(.+?)\s*$/u.exec(line.trim())
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return null
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isKnowledgeSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
}

function orderedUniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const uniqueValues: string[] = []

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      uniqueValues.push(value)
    }
  }

  return uniqueValues
}

function normalizeKnowledgeSearchTag(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized || null
}

function matchesKnowledgeSearchFilter(
  value: string | null | undefined,
  filter: string | null,
): boolean {
  if (!filter) {
    return true
  }

  return normalizeKnowledgeSearchTag(value) === filter
}

function normalizeKnowledgeSearchLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_KNOWLEDGE_SEARCH_LIMIT
  }

  return Math.max(
    1,
    Math.min(MAX_KNOWLEDGE_SEARCH_LIMIT, Math.trunc(limit ?? DEFAULT_KNOWLEDGE_SEARCH_LIMIT)),
  )
}

function tokenize(value: string): string[] {
  const matches = value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
  return [...new Set(matches.filter((term) => term.length > 1))]
}

function scoreText(
  sourceText: string,
  terms: readonly string[],
): { count: number; matchedTerms: string[] } {
  let count = 0
  const matchedTerms: string[] = []

  for (const term of terms) {
    const occurrences = countOccurrences(sourceText, term)
    if (occurrences > 0) {
      count += occurrences
      matchedTerms.push(term)
    }
  }

  return {
    count,
    matchedTerms,
  }
}

function countOccurrences(sourceText: string, term: string): number {
  if (!sourceText || !term) {
    return 0
  }

  let occurrences = 0
  let startIndex = 0
  while (true) {
    const index = sourceText.indexOf(term, startIndex)
    if (index === -1) {
      return occurrences
    }

    occurrences += 1
    startIndex = index + term.length
  }
}

function accumulateMatchedTerms(target: Set<string>, terms: readonly string[]): void {
  for (const term of terms) {
    target.add(term)
  }
}

function findSnippet(sourceText: string, terms: readonly string[]): string | null {
  const normalizedSource = sourceText.replace(/\s+/gu, ' ').trim()
  if (!normalizedSource) {
    return null
  }

  const lowerSource = normalizedSource.toLowerCase()
  let bestIndex = -1
  for (const term of terms) {
    const index = lowerSource.indexOf(term)
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
    }
  }

  if (bestIndex === -1) {
    return normalizedSource.length <= 200
      ? normalizedSource
      : `${normalizedSource.slice(0, 197).trimEnd()}...`
  }

  const windowRadius = 90
  const start = Math.max(0, bestIndex - windowRadius)
  const end = Math.min(normalizedSource.length, bestIndex + windowRadius)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < normalizedSource.length ? '...' : ''
  return `${prefix}${normalizedSource.slice(start, end).trim()}${suffix}`
}

function compactStrings(values: readonly (string | null | undefined)[]): string[] {
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
}
