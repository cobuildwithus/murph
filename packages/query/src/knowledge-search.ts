import {
  DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
  normalizeDerivedKnowledgeTag,
} from './knowledge-page-model.ts'
import type {
  DerivedKnowledgeGraph,
  DerivedKnowledgeNode,
  DerivedKnowledgeSearchFilters,
  DerivedKnowledgeSearchHit,
  DerivedKnowledgeSearchResult,
} from './knowledge-graph.ts'

const DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 20
const MAX_KNOWLEDGE_SEARCH_LIMIT = 200

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

interface DerivedKnowledgeSearchFieldScore {
  count: number
  matchedTerms: string[]
  phraseWeight: number
  termWeight: number
  text: string
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
      format: DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
      hits: [],
      query: normalizedQuery,
      total: 0,
    }
  }

  const pageType = normalizeDerivedKnowledgeTag(filters.pageType)
  const status = normalizeDerivedKnowledgeTag(filters.status)
  const hits = graph.nodes
    .filter((node) => matchesKnowledgeSearchFilter(node.pageType, pageType))
    .filter((node) => matchesKnowledgeSearchFilter(node.status, status))
    .map(materializeKnowledgeSearchDocument)
    .map((candidate) => scoreKnowledgeSearchDocument(candidate, normalizedQuery, terms))
    .filter((entry): entry is DerivedKnowledgeSearchHit => entry !== null)
    .sort(compareKnowledgeSearchHits)

  return {
    format: DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
    hits: hits.slice(0, normalizeKnowledgeSearchLimit(filters.limit)),
    query: normalizedQuery,
    total: hits.length,
  }
}

function materializeKnowledgeSearchDocument(
  node: DerivedKnowledgeNode,
): DerivedKnowledgeSearchableDocument {
  return {
    bodyText: joinCompactStrings([node.body], '\n'),
    compiledAt: node.compiledAt,
    pagePath: node.relativePath,
    pageType: node.pageType,
    relatedSlugs: node.relatedSlugs,
    slug: node.slug,
    sourcePaths: node.sourcePaths,
    status: node.status,
    structuredText: joinCompactStrings([
      node.slug,
      node.relativePath,
      node.pageType,
      node.status,
      ...node.sourcePaths,
      ...node.relatedSlugs,
    ], '\n'),
    summary: node.summary,
    summaryText: joinCompactStrings([node.summary], ' '),
    title: node.title,
    titleText: joinCompactStrings([
      node.title,
      node.pageType,
      node.status,
      node.slug,
    ], ' · '),
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
  const fieldScores = buildKnowledgeSearchFieldScores(candidate, terms)

  for (const fieldScore of fieldScores) {
    accumulateMatchedTerms(matchedTerms, fieldScore.matchedTerms)
  }

  for (const fieldScore of fieldScores) {
    if (fieldScore.text.includes(normalizedPhrase)) {
      score += fieldScore.phraseWeight
    }
  }

  for (const fieldScore of fieldScores) {
    score += fieldScore.count * fieldScore.termWeight
  }

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

function buildKnowledgeSearchFieldScores(
  candidate: DerivedKnowledgeSearchableDocument,
  terms: readonly string[],
): DerivedKnowledgeSearchFieldScore[] {
  return [
    {
      phraseWeight: 12,
      termWeight: 4.5,
      text: candidate.titleText.toLowerCase(),
    },
    {
      phraseWeight: 8,
      termWeight: 3.25,
      text: candidate.summaryText.toLowerCase(),
    },
    {
      phraseWeight: 6,
      termWeight: 1.75,
      text: candidate.bodyText.toLowerCase(),
    },
    {
      phraseWeight: 4,
      termWeight: 1,
      text: candidate.structuredText.toLowerCase(),
    },
  ].map((field) => {
    const metrics = scoreText(field.text, terms)

    return {
      ...field,
      count: metrics.count,
      matchedTerms: metrics.matchedTerms,
    }
  })
}

function matchesKnowledgeSearchFilter(
  value: string | null | undefined,
  filter: string | null,
): boolean {
  if (!filter) {
    return true
  }

  return normalizeDerivedKnowledgeTag(value) === filter
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

function joinCompactStrings(
  values: readonly (string | null | undefined)[],
  separator: string,
): string {
  return compactStrings(values).join(separator)
}

function compactStrings(values: readonly (string | null | undefined)[]): string[] {
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
}
