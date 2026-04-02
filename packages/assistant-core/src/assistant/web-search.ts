import {
  fetchJsonResponse,
  readJsonErrorResponse,
  requestJsonWithRetry,
  type JsonFetchResponse,
} from '../http-json-retry.js'
import {
  waitForRetryDelay,
  type ResponseHeadersLike,
} from '../http-retry.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  errorMessage,
  normalizeNullableString,
} from './shared.js'

export const assistantWebSearchProviderValues = [
  'auto',
  'brave',
  'exa',
  'kagi',
  'perplexity',
  'serpapi',
  'searxng',
  'tavily',
] as const

const assistantConfiguredWebSearchProviderPreference = [
  'searxng',
  'brave',
  'exa',
  'kagi',
  'perplexity',
  'serpapi',
  'tavily',
] as const

export const assistantWebSearchFreshnessValues = [
  'day',
  'week',
  'month',
  'year',
] as const

export type AssistantWebSearchProvider =
  typeof assistantWebSearchProviderValues[number]

export type AssistantConfiguredWebSearchProvider =
  typeof assistantConfiguredWebSearchProviderPreference[number]

export type AssistantWebSearchFreshness =
  typeof assistantWebSearchFreshnessValues[number]

export interface AssistantWebSearchRequest {
  count?: number
  country?: string | null
  dateAfter?: string | null
  dateBefore?: string | null
  domainFilter?: readonly string[] | null
  freshness?: AssistantWebSearchFreshness | null
  language?: string | null
  provider?: AssistantWebSearchProvider | null
  query: string
  signal?: AbortSignal
}

export interface AssistantWebSearchResult {
  publishedAt: string | null
  score: number | null
  snippet: string | null
  source: string | null
  title: string
  url: string
}

export interface AssistantWebSearchResponse {
  filters: {
    country: string | null
    dateAfter: string | null
    dateBefore: string | null
    domainFilter: string[]
    freshness: AssistantWebSearchFreshness | null
    language: string | null
  }
  provider: AssistantConfiguredWebSearchProvider
  query: string
  resultCount: number
  results: AssistantWebSearchResult[]
  warnings: string[]
}

interface NormalizedAssistantWebSearchRequest {
  count: number
  country: string | null
  dateAfter: string | null
  dateBefore: string | null
  domainFilter: string[]
  freshness: AssistantWebSearchFreshness | null
  language: string | null
  provider: AssistantWebSearchProvider | null
  query: string
  signal?: AbortSignal
  warnings: string[]
}

interface AssistantWebSearchProviderResponse {
  results: AssistantWebSearchResult[]
  warnings: string[]
}

interface AssistantWebSearchRuntimeContext {
  env: NodeJS.ProcessEnv
  fetchImplementation: AssistantWebSearchFetch
  timeoutMs: number
}

type AssistantWebSearchFetch = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<Response>

const ASSISTANT_WEB_SEARCH_DEFAULT_MAX_RESULTS = 5
const ASSISTANT_WEB_SEARCH_MAX_RESULTS = 10
const ASSISTANT_WEB_SEARCH_DEFAULT_TIMEOUT_MS = 12_000
const ASSISTANT_WEB_SEARCH_MIN_TIMEOUT_MS = 1_000
const ASSISTANT_WEB_SEARCH_MAX_TIMEOUT_MS = 60_000
const ASSISTANT_WEB_SEARCH_HTTP_MAX_ATTEMPTS = 3
const ASSISTANT_WEB_SEARCH_HTTP_RETRY_DELAYS_MS = [250, 1_000, 2_500] as const
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

export function resolveConfiguredAssistantWebSearchProvider(
  env: NodeJS.ProcessEnv = process.env,
): AssistantConfiguredWebSearchProvider | null {
  const configuredProviders = listConfiguredAssistantWebSearchProviders(env)
  const envOverride = readAssistantWebSearchProviderOverride(env)

  if (envOverride && envOverride !== 'auto') {
    return configuredProviders.includes(envOverride) ? envOverride : null
  }

  return configuredProviders[0] ?? null
}

export async function searchAssistantWeb(
  request: AssistantWebSearchRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantWebSearchResponse> {
  const normalizedRequest = normalizeAssistantWebSearchRequest(request, env)
  const provider = resolveAssistantWebSearchProvider({
    env,
    requestedProvider: normalizedRequest.provider,
  })
  const runtime = createAssistantWebSearchRuntimeContext(env)

  const providerResponse = await searchWithAssistantWebSearchProvider({
    provider,
    request: normalizedRequest,
    runtime,
  })
  const filteredResults = applyDomainFilterToAssistantSearchResults(
    providerResponse.results,
    normalizedRequest.domainFilter,
  )
  const boundedResults = dedupeAssistantWebSearchResults(filteredResults).slice(
    0,
    normalizedRequest.count,
  )

  return {
    provider,
    query: normalizedRequest.query,
    resultCount: boundedResults.length,
    results: boundedResults,
    filters: {
      country: normalizedRequest.country,
      language: normalizedRequest.language,
      freshness: normalizedRequest.freshness,
      dateAfter: normalizedRequest.dateAfter,
      dateBefore: normalizedRequest.dateBefore,
      domainFilter: normalizedRequest.domainFilter,
    },
    warnings: [
      ...normalizedRequest.warnings,
      ...providerResponse.warnings,
    ],
  }
}

function listConfiguredAssistantWebSearchProviders(
  env: NodeJS.ProcessEnv,
): AssistantConfiguredWebSearchProvider[] {
  const configuredProviders: AssistantConfiguredWebSearchProvider[] = []

  for (const provider of assistantConfiguredWebSearchProviderPreference) {
    if (isAssistantWebSearchProviderConfigured(provider, env)) {
      configuredProviders.push(provider)
    }
  }

  return configuredProviders
}

function isAssistantWebSearchProviderConfigured(
  provider: AssistantConfiguredWebSearchProvider,
  env: NodeJS.ProcessEnv,
): boolean {
  switch (provider) {
    case 'brave':
      return readAssistantWebSearchApiKey(env.BRAVE_API_KEY) !== null
    case 'exa':
      return readAssistantWebSearchApiKey(env.EXA_API_KEY) !== null
    case 'kagi':
      return (
        readAssistantWebSearchApiKey(env.KAGI_API_KEY) !== null ||
        readAssistantWebSearchApiKey(env.KAGI_API_TOKEN) !== null
      )
    case 'perplexity':
      return readAssistantWebSearchApiKey(env.PERPLEXITY_API_KEY) !== null
    case 'serpapi':
      return readAssistantWebSearchApiKey(env.SERPAPI_API_KEY) !== null
    case 'searxng':
      return resolveAssistantSearxngBaseUrl(env) !== null
    case 'tavily':
      return readAssistantWebSearchApiKey(env.TAVILY_API_KEY) !== null
  }
}

function normalizeAssistantWebSearchRequest(
  request: AssistantWebSearchRequest,
  env: NodeJS.ProcessEnv,
): NormalizedAssistantWebSearchRequest {
  const query = normalizeNullableString(request.query)
  if (!query) {
    throw new VaultCliError(
      'WEB_SEARCH_QUERY_INVALID',
      'web.search requires a non-empty query string.',
    )
  }

  const count = Math.max(
    1,
    Math.min(
      Math.trunc(request.count ?? resolveAssistantWebSearchMaxResults(env)),
      resolveAssistantWebSearchMaxResults(env),
      ASSISTANT_WEB_SEARCH_MAX_RESULTS,
    ),
  )
  const country = normalizeNullableString(request.country)
  const language = normalizeNullableString(request.language)
  const freshness = isAssistantWebSearchFreshness(request.freshness)
    ? request.freshness
    : null
  const dateAfter = normalizeNullableString(request.dateAfter)
  const dateBefore = normalizeNullableString(request.dateBefore)
  const warnings: string[] = []

  if ((dateAfter || dateBefore) && freshness) {
    warnings.push(
      'Ignored freshness because explicit dateAfter/dateBefore filters were provided.',
    )
  }

  return {
    query,
    count,
    provider: isAssistantWebSearchProvider(request.provider)
      ? request.provider
      : null,
    country,
    language,
    freshness,
    dateAfter,
    dateBefore,
    domainFilter: normalizeAssistantDomainFilters(request.domainFilter),
    signal: request.signal,
    warnings,
  }
}

function resolveAssistantWebSearchProvider(input: {
  env: NodeJS.ProcessEnv
  requestedProvider: AssistantWebSearchProvider | null
}): AssistantConfiguredWebSearchProvider {
  if (input.requestedProvider && input.requestedProvider !== 'auto') {
    if (isAssistantWebSearchProviderConfigured(input.requestedProvider, input.env)) {
      return input.requestedProvider
    }

    throw new VaultCliError(
      'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      `web.search provider ${input.requestedProvider} is not configured in this runtime.`,
    )
  }

  const envOverride = readAssistantWebSearchProviderOverride(input.env)
  if (envOverride && envOverride !== 'auto') {
    if (isAssistantWebSearchProviderConfigured(envOverride, input.env)) {
      return envOverride
    }

    throw new VaultCliError(
      'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      `MURPH_WEB_SEARCH_PROVIDER is set to ${envOverride}, but that provider is not configured.`,
    )
  }

  const configuredProvider = resolveConfiguredAssistantWebSearchProvider(input.env)
  if (configuredProvider) {
    return configuredProvider
  }

  throw new VaultCliError(
    'WEB_SEARCH_UNAVAILABLE',
    'web.search is unavailable because no search provider is configured for this runtime.',
  )
}

function createAssistantWebSearchRuntimeContext(
  env: NodeJS.ProcessEnv,
): AssistantWebSearchRuntimeContext {
  const fetchImplementation: AssistantWebSearchFetch = async (input, init) =>
    await fetch(input, init)

  return {
    env,
    fetchImplementation,
    timeoutMs: resolveAssistantWebSearchTimeoutMs(env),
  }
}

async function searchWithAssistantWebSearchProvider(input: {
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
    results: parseBraveAssistantWebSearchResults(payload),
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
    results: parseExaAssistantWebSearchResults(payload),
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
    results: parseKagiAssistantWebSearchResults(payload),
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
    results: parsePerplexityAssistantWebSearchResults(payload),
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
    results: parseSerpApiAssistantWebSearchResults(payload),
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
    results: parseSearxngAssistantWebSearchResults(payload),
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
    results: parseTavilyAssistantWebSearchResults(payload),
    warnings: buildAssistantWebSearchWarnings('tavily', request),
  }
}

async function requestAssistantWebSearchJson(input: {
  body?: Record<string, unknown>
  fetchImplementation: AssistantWebSearchFetch
  headers: Record<string, string>
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  signal?: AbortSignal
  timeoutMs: number
  url: string
}): Promise<unknown> {
  return await requestJsonWithRetry<unknown, Response>({
    createHttpError: async (response) =>
      await createAssistantWebSearchHttpError({
        provider: input.provider,
        method: input.method,
        response,
        url: input.url,
      }),
    fetchResponse: () =>
      fetchAssistantWebSearchResponse({
        body: input.body,
        fetchImplementation: input.fetchImplementation,
        headers: input.headers,
        method: input.method,
        provider: input.provider,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        url: input.url,
      }),
    isRetryableError: isRetryableAssistantWebSearchError,
    maxAttempts: ASSISTANT_WEB_SEARCH_HTTP_MAX_ATTEMPTS,
    parseResponse: async (response) => (await response.json()) as unknown,
    signal: input.signal,
    waitForRetryDelay: waitForAssistantWebSearchRetryDelay,
  })
}

async function fetchAssistantWebSearchResponse(input: {
  body?: Record<string, unknown>
  fetchImplementation: AssistantWebSearchFetch
  headers: Record<string, string>
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  signal?: AbortSignal
  timeoutMs: number
  url: string
}): Promise<Response> {
  return await fetchJsonResponse({
    body: input.body ? JSON.stringify(input.body) : undefined,
    createTransportError: ({ error, timedOut }) =>
      new VaultCliError(
        'WEB_SEARCH_REQUEST_FAILED',
        timedOut
          ? `web.search ${input.provider} request timed out after ${input.timeoutMs}ms.`
          : `web.search ${input.provider} request failed before a response was returned.`,
        createAssistantWebSearchErrorContext({
          provider: input.provider,
          method: input.method,
          retryable: true,
          timedOut,
          timeoutMs: input.timeoutMs,
          transportError: errorMessage(error),
          url: input.url,
        }),
      ),
    fetchImplementation: input.fetchImplementation,
    headers: input.headers,
    method: input.method,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    url: input.url,
  })
}

function isRetryableAssistantWebSearchError(
  error: unknown,
): error is VaultCliError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'WEB_SEARCH_REQUEST_FAILED' &&
      'context' in error &&
      (error as { context?: { retryable?: unknown } }).context?.retryable === true,
  )
}

async function waitForAssistantWebSearchRetryDelay(
  attempt: number,
  signal?: AbortSignal,
  headers?: ResponseHeadersLike | null,
): Promise<void> {
  await waitForRetryDelay({
    attempt,
    headers,
    retryDelaysMs: ASSISTANT_WEB_SEARCH_HTTP_RETRY_DELAYS_MS,
    signal,
  })
}

async function createAssistantWebSearchHttpError(input: {
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  response: JsonFetchResponse
  url: string
}): Promise<VaultCliError> {
  const { payload, rawText } = await readJsonErrorResponse(input.response)
  const retryable = shouldRetryAssistantWebSearchStatus(input.response.status)

  return new VaultCliError(
    'WEB_SEARCH_REQUEST_FAILED',
    extractAssistantWebSearchErrorMessage(payload, rawText) ??
      `web.search ${input.provider} request failed with HTTP ${input.response.status}.`,
    createAssistantWebSearchErrorContext({
      provider: input.provider,
      method: input.method,
      retryable,
      status: input.response.status,
      url: input.url,
    }),
  )
}

function shouldRetryAssistantWebSearchStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function createAssistantWebSearchErrorContext(input: {
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  retryable: boolean
  status?: number
  timedOut?: boolean
  timeoutMs?: number
  transportError?: string
  url: string
}): Record<string, unknown> {
  return compactAssistantRecord({
    provider: input.provider,
    method: input.method,
    retryable: input.retryable,
    status: input.status,
    timedOut: input.timedOut,
    timeoutMs: input.timeoutMs,
    transportError: input.transportError,
    url: input.url,
  })
}

function extractAssistantWebSearchErrorMessage(
  payload: unknown,
  rawText: string | null,
): string | null {
  const record = readAssistantRecord(payload)
  if (record) {
    return (
      firstAssistantString(
        record.message,
        record.error,
        record.detail,
      ) ?? normalizeNullableString(rawText)
    )
  }

  return normalizeNullableString(rawText)
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

function dedupeAssistantWebSearchResults(
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

function applyDomainFilterToAssistantSearchResults(
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

function normalizeAssistantDomainFilters(
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

function readAssistantHostname(url: string): string | null {
  try {
    return normalizeNullableString(new URL(url).hostname.toLowerCase())
  } catch {
    return null
  }
}

function readAssistantWebSearchProviderOverride(
  env: NodeJS.ProcessEnv,
): AssistantWebSearchProvider | null {
  const normalized = normalizeNullableString(env.MURPH_WEB_SEARCH_PROVIDER)
  return isAssistantWebSearchProvider(normalized) ? normalized : null
}

function resolveAssistantWebSearchMaxResults(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_SEARCH_MAX_RESULTS',
    fallback: ASSISTANT_WEB_SEARCH_DEFAULT_MAX_RESULTS,
    min: 1,
    max: ASSISTANT_WEB_SEARCH_MAX_RESULTS,
  })
}

function resolveAssistantWebSearchTimeoutMs(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_SEARCH_TIMEOUT_MS',
    fallback: ASSISTANT_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
    min: ASSISTANT_WEB_SEARCH_MIN_TIMEOUT_MS,
    max: ASSISTANT_WEB_SEARCH_MAX_TIMEOUT_MS,
  })
}

function resolveAssistantSearxngBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  const normalized = normalizeNullableString(env.SEARXNG_BASE_URL)
  if (!normalized) {
    return null
  }

  try {
    const parsed = new URL(normalized)
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
    return parsed.toString().replace(/\/+$/u, '')
  } catch {
    return null
  }
}

function readRequiredAssistantWebSearchApiKey(
  value: string | undefined,
  provider: AssistantConfiguredWebSearchProvider,
  envKey: string,
): string {
  const normalized = readAssistantWebSearchApiKey(value)
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'WEB_SEARCH_PROVIDER_UNCONFIGURED',
    `web.search provider ${provider} requires ${envKey}.`,
  )
}

function readAssistantWebSearchApiKey(
  value: string | undefined,
): string | null {
  return normalizeNullableString(value)
}

function readAssistantBoundedIntegerEnv(input: {
  env: NodeJS.ProcessEnv
  fallback: number
  key: string
  max: number
  min: number
}): number {
  const raw = normalizeNullableString(input.env[input.key])
  if (!raw) {
    return input.fallback
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed)) {
    return input.fallback
  }

  return Math.min(Math.max(parsed, input.min), input.max)
}

function compactAssistantRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  )
}

function readAssistantRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readAssistantArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readAssistantStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => normalizeNullableString(typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => entry !== null)
}

function readAssistantNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(readAssistantNumber)
    .filter((entry): entry is number => entry !== null)
}

function readAssistantNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function firstAssistantString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized =
      typeof value === 'string' ? normalizeNullableString(value) : null
    if (normalized) {
      return normalized
    }
  }

  return null
}

function formatAssistantIsoDate(value: Date): string {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatAssistantUsDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${Number(month)}/${Number(day)}/${year}`
}

function isAssistantWebSearchProvider(
  value: string | null | undefined,
): value is AssistantWebSearchProvider {
  return (
    typeof value === 'string' &&
    (assistantWebSearchProviderValues as readonly string[]).includes(value)
  )
}

function isAssistantWebSearchFreshness(
  value: string | null | undefined,
): value is AssistantWebSearchFreshness {
  return (
    typeof value === 'string' &&
    (assistantWebSearchFreshnessValues as readonly string[]).includes(value)
  )
}

function isAssistantWebSearchResult(
  value: AssistantWebSearchResult | null,
): value is AssistantWebSearchResult {
  return value !== null
}
