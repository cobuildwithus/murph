import { VaultCliError } from '../../vault-cli-errors.js'

import {
  readAssistantWebSearchApiKey,
  readRequiredAssistantWebSearchApiKey,
  resolveAssistantSearxngBaseUrl,
} from './config.js'
import { requestAssistantWebSearchJson } from './http.js'
import { parseAssistantWebSearchResults } from './results.js'
import {
  compactAssistantRecord,
  formatAssistantIsoDate,
  formatAssistantUsDate,
} from './shared.js'
import type {
  AssistantConfiguredWebSearchProvider,
  AssistantWebSearchFreshness,
  AssistantWebSearchProviderResponse,
  AssistantWebSearchRuntimeContext,
  NormalizedAssistantWebSearchRequest,
} from './types.js'

const BRAVE_WEB_SEARCH_BASE_URL = 'https://api.search.brave.com'
const EXA_SEARCH_BASE_URL = 'https://api.exa.ai'
const KAGI_SEARCH_BASE_URL = 'https://kagi.com/api/v0'
const PERPLEXITY_SEARCH_BASE_URL = 'https://api.perplexity.ai'
const SERPAPI_SEARCH_BASE_URL = 'https://serpapi.com'
const TAVILY_SEARCH_BASE_URL = 'https://api.tavily.com'
const BRAVE_WEB_RESULT_LIMIT = 20
const EXA_WEB_RESULT_LIMIT = 100
const PERPLEXITY_WEB_RESULT_LIMIT = 20
const SERPAPI_WEB_RESULT_LIMIT = 10
const TAVILY_WEB_RESULT_LIMIT = 20

export async function searchWithAssistantWebSearchProvider(input: {
  provider: AssistantConfiguredWebSearchProvider
  request: NormalizedAssistantWebSearchRequest
  runtime: AssistantWebSearchRuntimeContext
}): Promise<AssistantWebSearchProviderResponse> {
  switch (input.provider) {
    case 'brave':
      return await searchAssistantWebWithBrave(input.request, input.runtime)
    case 'exa':
      return await searchAssistantWebWithExa(input.request, input.runtime)
    case 'kagi':
      return await searchAssistantWebWithKagi(input.request, input.runtime)
    case 'perplexity':
      return await searchAssistantWebWithPerplexity(input.request, input.runtime)
    case 'serpapi':
      return await searchAssistantWebWithSerpApi(input.request, input.runtime)
    case 'searxng':
      return await searchAssistantWebWithSearxng(input.request, input.runtime)
    case 'tavily':
      return await searchAssistantWebWithTavily(input.request, input.runtime)
  }
}

async function searchAssistantWebWithBrave(
  request: NormalizedAssistantWebSearchRequest,
  runtime: AssistantWebSearchRuntimeContext,
): Promise<AssistantWebSearchProviderResponse> {
  const apiKey = readRequiredAssistantWebSearchApiKey(
    runtime.env.BRAVE_API_KEY,
    'brave',
    'BRAVE_API_KEY',
  )
  const url = new URL('/res/v1/web/search', `${BRAVE_WEB_SEARCH_BASE_URL}/`)
  url.searchParams.set('q', request.query)
  url.searchParams.set(
    'count',
    String(Math.min(request.count, BRAVE_WEB_RESULT_LIMIT)),
  )
  url.searchParams.set('spellcheck', 'false')

  if (request.country) {
    url.searchParams.set('country', request.country.toUpperCase())
  }

  if (request.language) {
    url.searchParams.set('search_lang', request.language)
  }

  const freshness = buildBraveFreshnessFilter(request)
  if (freshness) {
    url.searchParams.set('freshness', freshness)
  }

  const payload = await requestAssistantWebSearchJson({
    fetchImplementation: runtime.fetchImplementation,
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    method: 'GET',
    provider: 'brave',
    signal: request.signal,
    timeoutMs: runtime.timeoutMs,
    url: url.toString(),
  })

  return {
    results: parseAssistantWebSearchResults('brave', payload),
    warnings: buildAssistantWebSearchWarnings('brave', request),
  }
}

async function searchAssistantWebWithExa(
  request: NormalizedAssistantWebSearchRequest,
  runtime: AssistantWebSearchRuntimeContext,
): Promise<AssistantWebSearchProviderResponse> {
  const apiKey = readRequiredAssistantWebSearchApiKey(
    runtime.env.EXA_API_KEY,
    'exa',
    'EXA_API_KEY',
  )
  const effectiveDateRange = resolveAssistantWebSearchDateRange(request)
  const body = compactAssistantRecord({
    query: request.query,
    type: 'auto',
    numResults: Math.min(request.count, EXA_WEB_RESULT_LIMIT),
    userLocation: request.country?.toUpperCase(),
    includeDomains:
      request.domainFilter.length > 0 ? request.domainFilter : undefined,
    startPublishedDate: effectiveDateRange.dateAfter,
    endPublishedDate: effectiveDateRange.dateBefore,
    contents: {
      highlights: {
        maxCharacters: 1_200,
      },
      ...(request.freshness || request.dateAfter || request.dateBefore
        ? {
            maxAgeHours: 0,
          }
        : {}),
    },
  })

  const payload = await requestAssistantWebSearchJson({
    body,
    fetchImplementation: runtime.fetchImplementation,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    method: 'POST',
    provider: 'exa',
    signal: request.signal,
    timeoutMs: runtime.timeoutMs,
    url: new URL('/search', `${EXA_SEARCH_BASE_URL}/`).toString(),
  })

  return {
    results: parseAssistantWebSearchResults('exa', payload),
    warnings: buildAssistantWebSearchWarnings('exa', request),
  }
}

async function searchAssistantWebWithKagi(
  request: NormalizedAssistantWebSearchRequest,
  runtime: AssistantWebSearchRuntimeContext,
): Promise<AssistantWebSearchProviderResponse> {
  const apiKey =
    readAssistantWebSearchApiKey(runtime.env.KAGI_API_KEY) ??
    readAssistantWebSearchApiKey(runtime.env.KAGI_API_TOKEN)
  if (!apiKey) {
    throw new VaultCliError(
      'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      'web.search provider kagi requires KAGI_API_KEY or KAGI_API_TOKEN.',
    )
  }

  const url = new URL('/search', `${KAGI_SEARCH_BASE_URL}/`)
  url.searchParams.set('q', request.query)
  url.searchParams.set('limit', String(request.count))

  const payload = await requestAssistantWebSearchJson({
    fetchImplementation: runtime.fetchImplementation,
    headers: {
      Accept: 'application/json',
      Authorization: `Bot ${apiKey}`,
    },
    method: 'GET',
    provider: 'kagi',
    signal: request.signal,
    timeoutMs: runtime.timeoutMs,
    url: url.toString(),
  })

  return {
    results: parseAssistantWebSearchResults('kagi', payload),
    warnings: buildAssistantWebSearchWarnings('kagi', request),
  }
}

async function searchAssistantWebWithPerplexity(
  request: NormalizedAssistantWebSearchRequest,
  runtime: AssistantWebSearchRuntimeContext,
): Promise<AssistantWebSearchProviderResponse> {
  const apiKey = readRequiredAssistantWebSearchApiKey(
    runtime.env.PERPLEXITY_API_KEY,
    'perplexity',
    'PERPLEXITY_API_KEY',
  )
  const effectiveDateRange = resolveAssistantWebSearchDateRange(request)
  const body = compactAssistantRecord({
    query: request.query,
    max_results: Math.min(request.count, PERPLEXITY_WEB_RESULT_LIMIT),
    country: request.country,
    search_language_filter: request.language ? [request.language] : undefined,
    search_domain_filter:
      request.domainFilter.length > 0 ? request.domainFilter : undefined,
    search_recency_filter:
      request.dateAfter || request.dateBefore ? undefined : request.freshness,
    search_after_date_filter: effectiveDateRange.usDateAfter,
    search_before_date_filter: effectiveDateRange.usDateBefore,
  })

  const payload = await requestAssistantWebSearchJson({
    body,
    fetchImplementation: runtime.fetchImplementation,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    provider: 'perplexity',
    signal: request.signal,
    timeoutMs: runtime.timeoutMs,
    url: new URL('/search', `${PERPLEXITY_SEARCH_BASE_URL}/`).toString(),
  })

  return {
    results: parseAssistantWebSearchResults('perplexity', payload),
    warnings: buildAssistantWebSearchWarnings('perplexity', request),
  }
}

async function searchAssistantWebWithSerpApi(
  request: NormalizedAssistantWebSearchRequest,
  runtime: AssistantWebSearchRuntimeContext,
): Promise<AssistantWebSearchProviderResponse> {
  const apiKey = readRequiredAssistantWebSearchApiKey(
    runtime.env.SERPAPI_API_KEY,
    'serpapi',
    'SERPAPI_API_KEY',
  )
  const url = new URL('/search', `${SERPAPI_SEARCH_BASE_URL}/`)
  url.searchParams.set('engine', 'google')
  url.searchParams.set('output', 'json')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('q', request.query)
  url.searchParams.set(
    'num',
    String(Math.min(request.count, SERPAPI_WEB_RESULT_LIMIT)),
  )

  if (request.country) {
    url.searchParams.set('gl', request.country.toLowerCase())
  }

  if (request.language) {
    url.searchParams.set('hl', request.language)
  }

  const payload = await requestAssistantWebSearchJson({
    fetchImplementation: runtime.fetchImplementation,
    headers: {
      Accept: 'application/json',
    },
    method: 'GET',
    provider: 'serpapi',
    signal: request.signal,
    timeoutMs: runtime.timeoutMs,
    url: url.toString(),
  })

  return {
    results: parseAssistantWebSearchResults('serpapi', payload),
    warnings: buildAssistantWebSearchWarnings('serpapi', request),
  }
}

async function searchAssistantWebWithSearxng(
  request: NormalizedAssistantWebSearchRequest,
  runtime: AssistantWebSearchRuntimeContext,
): Promise<AssistantWebSearchProviderResponse> {
  const baseUrl = resolveAssistantSearxngBaseUrl(runtime.env)
  if (!baseUrl) {
    throw new VaultCliError(
      'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      'web.search provider searxng requires SEARXNG_BASE_URL.',
    )
  }

  const url = new URL('/search', `${baseUrl}/`)
  url.searchParams.set('q', request.query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('categories', 'general')

  if (request.language) {
    url.searchParams.set('language', request.language)
  }

  const searxngTimeRange = mapAssistantSearxngTimeRange(request)
  if (searxngTimeRange) {
    url.searchParams.set('time_range', searxngTimeRange)
  }

  const payload = await requestAssistantWebSearchJson({
    fetchImplementation: runtime.fetchImplementation,
    headers: {
      Accept: 'application/json',
    },
    method: 'GET',
    provider: 'searxng',
    signal: request.signal,
    timeoutMs: runtime.timeoutMs,
    url: url.toString(),
  })

  return {
    results: parseAssistantWebSearchResults('searxng', payload),
    warnings: buildAssistantWebSearchWarnings('searxng', request),
  }
}

async function searchAssistantWebWithTavily(
  request: NormalizedAssistantWebSearchRequest,
  runtime: AssistantWebSearchRuntimeContext,
): Promise<AssistantWebSearchProviderResponse> {
  const apiKey = readRequiredAssistantWebSearchApiKey(
    runtime.env.TAVILY_API_KEY,
    'tavily',
    'TAVILY_API_KEY',
  )
  const effectiveDateRange = resolveAssistantWebSearchDateRange(request)
  const body = compactAssistantRecord({
    query: request.query,
    max_results: Math.min(request.count, TAVILY_WEB_RESULT_LIMIT),
    search_depth: 'basic',
    include_answer: false,
    include_raw_content: false,
    include_domains:
      request.domainFilter.length > 0 ? request.domainFilter : undefined,
    time_range:
      request.dateAfter || request.dateBefore ? undefined : request.freshness,
    start_date: effectiveDateRange.dateAfter,
    end_date: effectiveDateRange.dateBefore,
  })

  const payload = await requestAssistantWebSearchJson({
    body,
    fetchImplementation: runtime.fetchImplementation,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    provider: 'tavily',
    signal: request.signal,
    timeoutMs: runtime.timeoutMs,
    url: new URL('/search', `${TAVILY_SEARCH_BASE_URL}/`).toString(),
  })

  return {
    results: parseAssistantWebSearchResults('tavily', payload),
    warnings: buildAssistantWebSearchWarnings('tavily', request),
  }
}

function buildAssistantWebSearchWarnings(
  provider: AssistantConfiguredWebSearchProvider,
  request: NormalizedAssistantWebSearchRequest,
): string[] {
  const warnings: string[] = []
  const clientSideDomainFilterProviders: readonly AssistantConfiguredWebSearchProvider[] = [
    'brave',
    'kagi',
    'serpapi',
    'searxng',
  ]

  if (
    request.domainFilter.length > 0 &&
    clientSideDomainFilterProviders.includes(provider)
  ) {
    warnings.push(
      `Applied domain filtering client-side after ${provider} returned results.`,
    )
  }

  switch (provider) {
    case 'brave':
      return warnings
    case 'exa':
      if (request.language) {
        warnings.push('exa does not expose a direct language filter in this tool wrapper.')
      }
      return warnings
    case 'kagi':
      if (request.country) {
        warnings.push('kagi does not expose a direct country filter in this tool wrapper.')
      }
      if (request.language) {
        warnings.push('kagi does not expose a direct language filter in this tool wrapper.')
      }
      if (request.freshness || request.dateAfter || request.dateBefore) {
        warnings.push('kagi does not expose direct freshness or date-range filters in this tool wrapper.')
      }
      return warnings
    case 'perplexity':
      return warnings
    case 'serpapi':
      if (request.freshness || request.dateAfter || request.dateBefore) {
        warnings.push('serpapi date filtering is not enabled in this wrapper; the request used the broader Google search endpoint.')
      }
      return warnings
    case 'searxng':
      if (request.country) {
        warnings.push('searxng does not expose a direct country filter in this tool wrapper.')
      }
      if (request.dateAfter || request.dateBefore) {
        warnings.push('searxng does not expose exact date-range filters in this tool wrapper.')
      }
      if (request.freshness === 'week') {
        warnings.push('searxng only exposes day, month, and year time ranges; week was not applied.')
      }
      return warnings
    case 'tavily':
      if (request.country) {
        warnings.push('tavily does not expose a direct country filter in this tool wrapper.')
      }
      if (request.language) {
        warnings.push('tavily does not expose a direct language filter in this tool wrapper.')
      }
      return warnings
  }
}

function buildBraveFreshnessFilter(
  request: NormalizedAssistantWebSearchRequest,
): string | null {
  if (request.dateAfter || request.dateBefore) {
    return [
      request.dateAfter ?? '1970-01-01',
      request.dateBefore ?? formatAssistantIsoDate(new Date()),
    ].join('to')
  }

  switch (request.freshness) {
    case 'day':
      return 'pd'
    case 'week':
      return 'pw'
    case 'month':
      return 'pm'
    case 'year':
      return 'py'
    default:
      return null
  }
}

function mapAssistantSearxngTimeRange(
  request: NormalizedAssistantWebSearchRequest,
): 'day' | 'month' | 'year' | null {
  switch (request.freshness) {
    case 'day':
    case 'month':
    case 'year':
      return request.freshness
    default:
      return null
  }
}

function resolveAssistantWebSearchDateRange(
  request: NormalizedAssistantWebSearchRequest,
): {
  dateAfter: string | null
  dateBefore: string | null
  usDateAfter: string | null
  usDateBefore: string | null
} {
  const freshnessAfter =
    request.dateAfter || request.dateBefore
      ? null
      : resolveAssistantFreshnessStartDate(request.freshness)
  const dateAfter = request.dateAfter ?? freshnessAfter
  const dateBefore = request.dateBefore

  return {
    dateAfter,
    dateBefore,
    usDateAfter: dateAfter ? formatAssistantUsDate(dateAfter) : null,
    usDateBefore: dateBefore ? formatAssistantUsDate(dateBefore) : null,
  }
}

function resolveAssistantFreshnessStartDate(
  freshness: AssistantWebSearchFreshness | null,
  now: Date = new Date(),
): string | null {
  if (!freshness) {
    return null
  }

  const resolved = new Date(now.getTime())
  switch (freshness) {
    case 'day':
      resolved.setUTCDate(resolved.getUTCDate() - 1)
      break
    case 'week':
      resolved.setUTCDate(resolved.getUTCDate() - 7)
      break
    case 'month':
      resolved.setUTCMonth(resolved.getUTCMonth() - 1)
      break
    case 'year':
      resolved.setUTCFullYear(resolved.getUTCFullYear() - 1)
      break
  }

  return formatAssistantIsoDate(resolved)
}
