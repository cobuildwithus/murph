import { normalizeNullableString } from '../shared.js'

import {
  firstAssistantString,
  readAssistantArray,
  readAssistantHostname,
  readAssistantNumber,
  readAssistantNumberArray,
  readAssistantRecord,
  readAssistantStringArray,
} from './shared.js'
import type {
  AssistantConfiguredWebSearchProvider,
  AssistantWebSearchResult,
} from './types.js'

export function parseAssistantWebSearchResults(
  provider: AssistantConfiguredWebSearchProvider,
  payload: unknown,
): AssistantWebSearchResult[] {
  switch (provider) {
    case 'brave':
      return parseBraveAssistantWebSearchResults(payload)
    case 'exa':
      return parseExaAssistantWebSearchResults(payload)
    case 'kagi':
      return parseKagiAssistantWebSearchResults(payload)
    case 'perplexity':
      return parsePerplexityAssistantWebSearchResults(payload)
    case 'serpapi':
      return parseSerpApiAssistantWebSearchResults(payload)
    case 'searxng':
      return parseSearxngAssistantWebSearchResults(payload)
    case 'tavily':
      return parseTavilyAssistantWebSearchResults(payload)
  }
}

function parseBraveAssistantWebSearchResults(
  payload: unknown,
): AssistantWebSearchResult[] {
  const root = readAssistantRecord(payload)
  const web = readAssistantRecord(root?.web)
  return readAssistantArray(web?.results)
    .map(parseBraveAssistantWebSearchResult)
    .filter(isAssistantWebSearchResult)
}

function parseBraveAssistantWebSearchResult(
  value: unknown,
): AssistantWebSearchResult | null {
  const record = readAssistantRecord(value)
  if (!record) {
    return null
  }

  return createAssistantWebSearchResult({
    title: record.title,
    url: record.url,
    snippet: firstAssistantString(record.description, record.snippet),
    source:
      firstAssistantString(readAssistantRecord(record.profile)?.long_name) ??
      null,
    publishedAt: firstAssistantString(record.page_age, record.age),
    score: null,
  })
}

function parseExaAssistantWebSearchResults(
  payload: unknown,
): AssistantWebSearchResult[] {
  const root = readAssistantRecord(payload)
  return readAssistantArray(root?.results)
    .map(parseExaAssistantWebSearchResult)
    .filter(isAssistantWebSearchResult)
}

function parseExaAssistantWebSearchResult(
  value: unknown,
): AssistantWebSearchResult | null {
  const record = readAssistantRecord(value)
  if (!record) {
    return null
  }

  const highlights = readAssistantStringArray(record.highlights)
  const highlightScores = readAssistantNumberArray(record.highlightScores)

  return createAssistantWebSearchResult({
    title: record.title,
    url: record.url,
    snippet:
      firstAssistantString(highlights[0], record.summary, record.text) ?? null,
    source: null,
    publishedAt: firstAssistantString(record.publishedDate),
    score: highlightScores[0] ?? null,
  })
}

function parseKagiAssistantWebSearchResults(
  payload: unknown,
): AssistantWebSearchResult[] {
  const root = readAssistantRecord(payload)
  return readAssistantArray(root?.data)
    .map(parseKagiAssistantWebSearchResult)
    .filter(isAssistantWebSearchResult)
}

function parseKagiAssistantWebSearchResult(
  value: unknown,
): AssistantWebSearchResult | null {
  const record = readAssistantRecord(value)
  if (!record) {
    return null
  }

  return createAssistantWebSearchResult({
    title: firstAssistantString(record.title, record.name),
    url: record.url,
    snippet: firstAssistantString(record.snippet, record.description),
    source: null,
    publishedAt: firstAssistantString(record.date),
    score: readAssistantNumber(record.rank),
  })
}

function parsePerplexityAssistantWebSearchResults(
  payload: unknown,
): AssistantWebSearchResult[] {
  const root = readAssistantRecord(payload)
  return readAssistantArray(root?.results)
    .map(parsePerplexityAssistantWebSearchResult)
    .filter(isAssistantWebSearchResult)
}

function parsePerplexityAssistantWebSearchResult(
  value: unknown,
): AssistantWebSearchResult | null {
  const record = readAssistantRecord(value)
  if (!record) {
    return null
  }

  return createAssistantWebSearchResult({
    title: firstAssistantString(record.title, record.name),
    url: firstAssistantString(record.url, record.link),
    snippet: firstAssistantString(
      record.snippet,
      record.text,
      record.content,
      record.summary,
    ),
    source: firstAssistantString(record.source),
    publishedAt: firstAssistantString(
      record.date,
      record.published_date,
      record.publishedAt,
    ),
    score: readAssistantNumber(record.score),
  })
}

function parseSerpApiAssistantWebSearchResults(
  payload: unknown,
): AssistantWebSearchResult[] {
  const root = readAssistantRecord(payload)
  const organic = readAssistantArray(root?.organic_results)
  const news = readAssistantArray(root?.news_results)

  return [...organic, ...news]
    .map(parseSerpApiAssistantWebSearchResult)
    .filter(isAssistantWebSearchResult)
}

function parseSerpApiAssistantWebSearchResult(
  value: unknown,
): AssistantWebSearchResult | null {
  const record = readAssistantRecord(value)
  if (!record) {
    return null
  }

  return createAssistantWebSearchResult({
    title: firstAssistantString(record.title, record.name),
    url: firstAssistantString(record.link, record.url),
    snippet: firstAssistantString(record.snippet, record.description),
    source: firstAssistantString(record.source),
    publishedAt: firstAssistantString(record.date),
    score: readAssistantNumber(record.position),
  })
}

function parseSearxngAssistantWebSearchResults(
  payload: unknown,
): AssistantWebSearchResult[] {
  const root = readAssistantRecord(payload)
  return readAssistantArray(root?.results)
    .map(parseSearxngAssistantWebSearchResult)
    .filter(isAssistantWebSearchResult)
}

function parseSearxngAssistantWebSearchResult(
  value: unknown,
): AssistantWebSearchResult | null {
  const record = readAssistantRecord(value)
  if (!record) {
    return null
  }

  const engines = readAssistantStringArray(record.engines)

  return createAssistantWebSearchResult({
    title: firstAssistantString(record.title, record.pretty_url),
    url: record.url,
    snippet: firstAssistantString(record.content, record.snippet),
    source: firstAssistantString(engines[0]),
    publishedAt: firstAssistantString(
      record.publishedDate,
      record.published_date,
    ),
    score: readAssistantNumber(record.score),
  })
}

function parseTavilyAssistantWebSearchResults(
  payload: unknown,
): AssistantWebSearchResult[] {
  const root = readAssistantRecord(payload)
  return readAssistantArray(root?.results)
    .map(parseTavilyAssistantWebSearchResult)
    .filter(isAssistantWebSearchResult)
}

function parseTavilyAssistantWebSearchResult(
  value: unknown,
): AssistantWebSearchResult | null {
  const record = readAssistantRecord(value)
  if (!record) {
    return null
  }

  return createAssistantWebSearchResult({
    title: record.title,
    url: firstAssistantString(record.url, record.link),
    snippet: firstAssistantString(record.content, record.snippet),
    source: firstAssistantString(record.source),
    publishedAt: firstAssistantString(
      record.published_date,
      record.publishedAt,
      record.date,
    ),
    score: readAssistantNumber(record.score),
  })
}

function createAssistantWebSearchResult(input: {
  publishedAt: unknown
  score: number | null
  snippet: unknown
  source: unknown
  title: unknown
  url: unknown
}): AssistantWebSearchResult | null {
  const title = firstAssistantString(input.title)
  const url = firstAssistantString(input.url)
  if (!title || !url) {
    return null
  }

  return {
    title,
    url,
    snippet: firstAssistantString(input.snippet),
    source: firstAssistantString(input.source) ?? readAssistantHostname(url),
    publishedAt: firstAssistantString(input.publishedAt),
    score: input.score,
  }
}

export function dedupeAssistantWebSearchResults(
  results: readonly AssistantWebSearchResult[],
): AssistantWebSearchResult[] {
  const seen = new Set<string>()
  const deduped: AssistantWebSearchResult[] = []

  for (const result of results) {
    if (seen.has(result.url)) {
      continue
    }

    seen.add(result.url)
    deduped.push(result)
  }

  return deduped
}

export function applyDomainFilterToAssistantSearchResults(
  results: readonly AssistantWebSearchResult[],
  domainFilter: readonly string[],
): AssistantWebSearchResult[] {
  if (domainFilter.length === 0) {
    return [...results]
  }

  return results.filter((result) =>
    assistantWebSearchResultMatchesDomainFilter(result, domainFilter),
  )
}

function assistantWebSearchResultMatchesDomainFilter(
  result: AssistantWebSearchResult,
  domainFilter: readonly string[],
): boolean {
  const hostname = readAssistantHostname(result.url)
  if (!hostname) {
    return false
  }

  return domainFilter.some((candidate) => {
    if (candidate.startsWith('.')) {
      return hostname.endsWith(candidate)
    }

    return hostname === candidate || hostname.endsWith(`.${candidate}`)
  })
}

export function normalizeAssistantDomainFilters(
  value: readonly string[] | null | undefined,
): string[] {
  if (!value || value.length === 0) {
    return []
  }

  const normalized = value
    .map(normalizeAssistantDomainFilter)
    .filter((entry): entry is string => entry !== null)

  return Array.from(new Set(normalized))
}

function normalizeAssistantDomainFilter(value: string): string | null {
  const normalized = normalizeNullableString(value)?.toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized.startsWith('.')) {
    return normalized
  }

  try {
    const parsed = new URL(
      normalized.includes('://') ? normalized : `https://${normalized}`,
    )
    return normalizeNullableString(parsed.hostname.toLowerCase())
  } catch {
    return normalized
  }
}

function isAssistantWebSearchResult(
  value: AssistantWebSearchResult | null,
): value is AssistantWebSearchResult {
  return value !== null
}
