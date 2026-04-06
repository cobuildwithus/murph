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

export const assistantWebSearchFreshnessValues = [
  'day',
  'week',
  'month',
  'year',
] as const

export type AssistantWebSearchProvider =
  typeof assistantWebSearchProviderValues[number]

export type AssistantConfiguredWebSearchProvider =
  Exclude<AssistantWebSearchProvider, 'auto'>

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

export interface NormalizedAssistantWebSearchRequest {
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

export interface AssistantWebSearchProviderResponse {
  results: AssistantWebSearchResult[]
  warnings: string[]
}

export interface AssistantWebSearchRuntimeContext {
  env: NodeJS.ProcessEnv
  fetchImplementation: AssistantWebSearchFetch
  timeoutMs: number
}

export type AssistantWebSearchFetch = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<Response>
