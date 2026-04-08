import { afterEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { searchWithAssistantWebSearchProvider } from '../src/assistant/web-search/providers.ts'
import type {
  AssistantConfiguredWebSearchProvider,
  AssistantWebSearchFetch,
  AssistantWebSearchRuntimeContext,
  NormalizedAssistantWebSearchRequest,
} from '../src/assistant/web-search/types.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('assistant web-search providers', () => {
  it('shapes Brave requests with clamped counts, normalized filters, and date-based freshness ranges', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 8, 12, 0, 0)))

    const { response, requestInit, requestUrl } = await runProviderSearch({
      provider: 'brave',
      env: {
        BRAVE_API_KEY: 'brave-key',
      },
      payload: {
        web: {
          results: [
            {
              title: 'Hydration update',
              url: 'https://example.com/hydration',
              description: 'Fresh evidence',
            },
          ],
        },
      },
      request: createRequest({
        count: 99,
        country: 'us',
        dateAfter: '2026-04-01',
        domainFilter: ['example.com'],
        language: 'en',
      }),
    })

    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': 'brave-key',
      },
    })
    expect(requestUrl.origin).toBe('https://api.search.brave.com')
    expect(requestUrl.pathname).toBe('/res/v1/web/search')
    expect(requestUrl.searchParams.get('q')).toBe('hydration')
    expect(requestUrl.searchParams.get('count')).toBe('20')
    expect(requestUrl.searchParams.get('spellcheck')).toBe('false')
    expect(requestUrl.searchParams.get('country')).toBe('US')
    expect(requestUrl.searchParams.get('search_lang')).toBe('en')
    expect(requestUrl.searchParams.get('freshness')).toBe(
      '2026-04-01to2026-04-08',
    )
    expect(response).toMatchObject({
      warnings: ['Applied domain filtering client-side after brave returned results.'],
      results: [
        {
          title: 'Hydration update',
          url: 'https://example.com/hydration',
        },
      ],
    })
  })

  it.each([
    ['day', 'pd'],
    ['week', 'pw'],
    ['month', 'pm'],
    ['year', 'py'],
  ] as const)(
    'maps Brave freshness preset %s to %s when no explicit date range is provided',
    async (freshness, expectedFreshness) => {
      const { requestUrl, response } = await runProviderSearch({
        provider: 'brave',
        env: {
          BRAVE_API_KEY: 'brave-key',
        },
        payload: {
          web: {
            results: [],
          },
        },
        request: createRequest({
          freshness,
        }),
      })

      expect(requestUrl.searchParams.get('freshness')).toBe(expectedFreshness)
      expect(response.warnings).toEqual([])
    },
  )

  it('shapes Exa requests with freshness-derived dates, domain filters, and the language warning', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 8, 12, 0, 0)))

    const { response, requestBody, requestInit, requestUrl } =
      await runProviderSearch({
        provider: 'exa',
        env: {
          EXA_API_KEY: 'exa-key',
        },
        payload: {
          results: [
            {
              title: 'Exa result',
              url: 'https://example.com/exa',
              highlights: ['highlight'],
            },
          ],
        },
        request: createRequest({
          count: 250,
          country: 'au',
          domainFilter: ['example.com', 'docs.example.com'],
          freshness: 'month',
          language: 'en',
        }),
      })

    expect(requestInit).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'exa-key',
      },
    })
    expect(requestUrl.toString()).toBe('https://api.exa.ai/search')
    expect(requestBody).toEqual({
      query: 'hydration',
      type: 'auto',
      numResults: 100,
      userLocation: 'AU',
      includeDomains: ['example.com', 'docs.example.com'],
      startPublishedDate: '2026-03-08',
      endPublishedDate: null,
      contents: {
        highlights: {
          maxCharacters: 1_200,
        },
        maxAgeHours: 0,
      },
    })
    expect(response.warnings).toEqual([
      'exa does not expose a direct language filter in this tool wrapper.',
    ])
  })

  it('omits Exa optional filters when no country, domains, or date constraints are provided', async () => {
    const { requestBody, response } = await runProviderSearch({
      provider: 'exa',
      env: {
        EXA_API_KEY: 'exa-key',
      },
      payload: {
        results: [],
      },
      request: createRequest({
        count: 2,
      }),
    })

    expect(requestBody).toEqual({
      query: 'hydration',
      type: 'auto',
      numResults: 2,
      startPublishedDate: null,
      endPublishedDate: null,
      contents: {
        highlights: {
          maxCharacters: 1_200,
        },
      },
    })
    expect(response.warnings).toEqual([])
  })

  it('uses the Kagi token fallback and surfaces unsupported filter warnings', async () => {
    const { response, requestInit, requestUrl } = await runProviderSearch({
      provider: 'kagi',
      env: {
        KAGI_API_TOKEN: 'kagi-token',
      },
      payload: {
        data: [
          {
            name: 'Kagi result',
            url: 'https://example.com/kagi',
          },
        ],
      },
      request: createRequest({
        count: 7,
        country: 'us',
        domainFilter: ['example.com'],
        freshness: 'week',
        language: 'en',
      }),
    })

    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bot kagi-token',
      },
    })
    expect(requestUrl.toString()).toBe('https://kagi.com/search?q=hydration&limit=7')
    expect(response.warnings).toEqual([
      'Applied domain filtering client-side after kagi returned results.',
      'kagi does not expose a direct country filter in this tool wrapper.',
      'kagi does not expose a direct language filter in this tool wrapper.',
      'kagi does not expose direct freshness or date-range filters in this tool wrapper.',
    ])
  })

  it('prefers Kagi API keys over tokens when both are configured', async () => {
    const { requestInit } = await runProviderSearch({
      provider: 'kagi',
      env: {
        KAGI_API_KEY: 'kagi-key',
        KAGI_API_TOKEN: 'kagi-token',
      },
      payload: {
        data: [],
      },
      request: createRequest(),
    })

    expect(requestInit.headers?.Authorization).toBe('Bot kagi-key')
  })

  it('shapes Perplexity requests with explicit US date filters instead of recency', async () => {
    const { response, requestBody, requestInit, requestUrl } =
      await runProviderSearch({
        provider: 'perplexity',
        env: {
          PERPLEXITY_API_KEY: 'perplexity-key',
        },
        payload: {
          results: [
            {
              name: 'Perplexity result',
              link: 'https://example.com/perplexity',
            },
          ],
        },
        request: createRequest({
          count: 25,
          country: 'us',
          dateAfter: '2026-04-01',
          dateBefore: '2026-04-08',
          domainFilter: ['example.com'],
          freshness: 'week',
          language: 'en',
        }),
      })

    expect(requestInit).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer perplexity-key',
        'content-type': 'application/json',
      },
    })
    expect(requestUrl.toString()).toBe('https://api.perplexity.ai/search')
    expect(requestBody).toEqual({
      query: 'hydration',
      max_results: 20,
      country: 'us',
      search_language_filter: ['en'],
      search_domain_filter: ['example.com'],
      search_after_date_filter: '4/1/2026',
      search_before_date_filter: '4/8/2026',
    })
    expect(requestBody).not.toHaveProperty('search_recency_filter')
    expect(response.warnings).toEqual([])
  })

  it('uses Perplexity recency filters when explicit dates are not provided', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 8, 12, 0, 0)))

    const { requestBody } = await runProviderSearch({
      provider: 'perplexity',
      env: {
        PERPLEXITY_API_KEY: 'perplexity-key',
      },
      payload: {
        results: [],
      },
      request: createRequest({
        freshness: 'day',
      }),
    })

    expect(requestBody).toEqual({
      query: 'hydration',
      max_results: 5,
      country: null,
      search_recency_filter: 'day',
      search_after_date_filter: '4/7/2026',
      search_before_date_filter: null,
    })
  })

  it('shapes SerpApi requests with Google query params and warns about client-side filters', async () => {
    const { response, requestInit, requestUrl } = await runProviderSearch({
      provider: 'serpapi',
      env: {
        SERPAPI_API_KEY: 'serp-key',
      },
      payload: {
        organic_results: [
          {
            title: 'SerpApi result',
            link: 'https://example.com/serpapi',
          },
        ],
      },
      request: createRequest({
        count: 99,
        country: 'US',
        dateAfter: '2026-04-01',
        domainFilter: ['example.com'],
        language: 'en',
      }),
    })

    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    })
    expect(requestUrl.origin).toBe('https://serpapi.com')
    expect(requestUrl.pathname).toBe('/search')
    expect(requestUrl.searchParams.get('engine')).toBe('google')
    expect(requestUrl.searchParams.get('output')).toBe('json')
    expect(requestUrl.searchParams.get('api_key')).toBe('serp-key')
    expect(requestUrl.searchParams.get('q')).toBe('hydration')
    expect(requestUrl.searchParams.get('num')).toBe('10')
    expect(requestUrl.searchParams.get('gl')).toBe('us')
    expect(requestUrl.searchParams.get('hl')).toBe('en')
    expect(requestUrl.searchParams.get('tbs')).toBeNull()
    expect(response.warnings).toEqual([
      'Applied domain filtering client-side after serpapi returned results.',
      'serpapi date filtering is not enabled in this wrapper; the request used the broader Google search endpoint.',
    ])
  })

  it('normalizes Searxng base URLs, resolves requests against the origin path, and warns on unsupported filters', async () => {
    const { response, requestInit, requestUrl } = await runProviderSearch({
      provider: 'searxng',
      env: {
        SEARXNG_BASE_URL: 'https://search.example.com/custom///',
      },
      payload: {
        results: [
          {
            pretty_url: 'Searxng result',
            url: 'https://example.com/searxng',
          },
        ],
      },
      request: createRequest({
        country: 'us',
        dateAfter: '2026-04-01',
        domainFilter: ['example.com'],
        freshness: 'month',
        language: 'en',
      }),
    })

    expect(requestInit).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    })
    expect(requestUrl.toString()).toBe(
      'https://search.example.com/search?q=hydration&format=json&categories=general&language=en&time_range=month',
    )
    expect(response.warnings).toEqual([
      'Applied domain filtering client-side after searxng returned results.',
      'searxng does not expose a direct country filter in this tool wrapper.',
      'searxng does not expose exact date-range filters in this tool wrapper.',
    ])
  })

  it('does not send unsupported Searxng week time ranges and warns explicitly', async () => {
    const { response, requestUrl } = await runProviderSearch({
      provider: 'searxng',
      env: {
        SEARXNG_BASE_URL: 'https://search.example.com',
      },
      payload: {
        results: [],
      },
      request: createRequest({
        freshness: 'week',
      }),
    })

    expect(requestUrl.searchParams.get('time_range')).toBeNull()
    expect(response.warnings).toEqual([
      'searxng only exposes day, month, and year time ranges; week was not applied.',
    ])
  })

  it('shapes Tavily requests with explicit ISO date ranges and unsupported-filter warnings', async () => {
    const { response, requestBody, requestInit, requestUrl } =
      await runProviderSearch({
        provider: 'tavily',
        env: {
          TAVILY_API_KEY: 'tavily-key',
        },
        payload: {
          results: [
            {
              title: 'Tavily result',
              link: 'https://example.com/tavily',
            },
          ],
        },
        request: createRequest({
          count: 25,
          country: 'us',
          dateAfter: '2026-04-01',
          dateBefore: '2026-04-08',
          domainFilter: ['example.com'],
          freshness: 'week',
          language: 'en',
        }),
      })

    expect(requestInit).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer tavily-key',
        'content-type': 'application/json',
      },
    })
    expect(requestUrl.toString()).toBe('https://api.tavily.com/search')
    expect(requestBody).toEqual({
      query: 'hydration',
      max_results: 20,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      include_domains: ['example.com'],
      start_date: '2026-04-01',
      end_date: '2026-04-08',
    })
    expect(requestBody).not.toHaveProperty('time_range')
    expect(response.warnings).toEqual([
      'tavily does not expose a direct country filter in this tool wrapper.',
      'tavily does not expose a direct language filter in this tool wrapper.',
    ])
  })

  it('uses Tavily time ranges when no explicit dates are supplied', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 8, 12, 0, 0)))

    const { requestBody, response } = await runProviderSearch({
      provider: 'tavily',
      env: {
        TAVILY_API_KEY: 'tavily-key',
      },
      payload: {
        results: [],
      },
      request: createRequest({
        freshness: 'year',
      }),
    })

    expect(requestBody).toEqual({
      query: 'hydration',
      max_results: 5,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      time_range: 'year',
      start_date: '2025-04-08',
      end_date: null,
    })
    expect(response.warnings).toEqual([])
  })

  it('fails closed when provider credentials or Searxng base URL are missing', async () => {
    await expect(
      searchWithAssistantWebSearchProvider({
        provider: 'brave',
        request: createRequest(),
        runtime: createRuntimeContext({
          env: {},
          fetchImplementation: vi.fn<AssistantWebSearchFetch>(),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      message: 'web.search provider brave requires BRAVE_API_KEY.',
    } satisfies Partial<VaultCliError>)

    await expect(
      searchWithAssistantWebSearchProvider({
        provider: 'exa',
        request: createRequest(),
        runtime: createRuntimeContext({
          env: {},
          fetchImplementation: vi.fn<AssistantWebSearchFetch>(),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      message: 'web.search provider exa requires EXA_API_KEY.',
    } satisfies Partial<VaultCliError>)

    await expect(
      searchWithAssistantWebSearchProvider({
        provider: 'kagi',
        request: createRequest(),
        runtime: createRuntimeContext({
          env: {},
          fetchImplementation: vi.fn<AssistantWebSearchFetch>(),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      message: 'web.search provider kagi requires KAGI_API_KEY or KAGI_API_TOKEN.',
    } satisfies Partial<VaultCliError>)

    await expect(
      searchWithAssistantWebSearchProvider({
        provider: 'perplexity',
        request: createRequest(),
        runtime: createRuntimeContext({
          env: {},
          fetchImplementation: vi.fn<AssistantWebSearchFetch>(),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      message: 'web.search provider perplexity requires PERPLEXITY_API_KEY.',
    } satisfies Partial<VaultCliError>)

    await expect(
      searchWithAssistantWebSearchProvider({
        provider: 'serpapi',
        request: createRequest(),
        runtime: createRuntimeContext({
          env: {},
          fetchImplementation: vi.fn<AssistantWebSearchFetch>(),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      message: 'web.search provider serpapi requires SERPAPI_API_KEY.',
    } satisfies Partial<VaultCliError>)

    await expect(
      searchWithAssistantWebSearchProvider({
        provider: 'searxng',
        request: createRequest(),
        runtime: createRuntimeContext({
          env: {
            SEARXNG_BASE_URL: 'not-a-url',
          },
          fetchImplementation: vi.fn<AssistantWebSearchFetch>(),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      message: 'web.search provider searxng requires SEARXNG_BASE_URL.',
    } satisfies Partial<VaultCliError>)

    await expect(
      searchWithAssistantWebSearchProvider({
        provider: 'tavily',
        request: createRequest(),
        runtime: createRuntimeContext({
          env: {},
          fetchImplementation: vi.fn<AssistantWebSearchFetch>(),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      message: 'web.search provider tavily requires TAVILY_API_KEY.',
    } satisfies Partial<VaultCliError>)
  })
})

async function runProviderSearch(input: {
  provider: AssistantConfiguredWebSearchProvider
  env: NodeJS.ProcessEnv
  payload: unknown
  request: NormalizedAssistantWebSearchRequest
}): Promise<{
  requestBody: Record<string, unknown>
  requestInit: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  }
  requestUrl: URL
  response: Awaited<ReturnType<typeof searchWithAssistantWebSearchProvider>>
}> {
  const fetchImplementation = vi
    .fn<AssistantWebSearchFetch>()
    .mockResolvedValue(jsonResponse(input.payload))
  const runtime = createRuntimeContext({
    env: input.env,
    fetchImplementation,
  })
  const response = await searchWithAssistantWebSearchProvider({
    provider: input.provider,
    request: input.request,
    runtime,
  })

  expect(fetchImplementation).toHaveBeenCalledTimes(1)
  const [rawUrl, requestInit] = fetchImplementation.mock.calls[0]

  return {
    requestBody: parseRequestBody(requestInit?.body),
    requestInit,
    requestUrl: new URL(rawUrl),
    response,
  }
}

function createRuntimeContext(input: {
  env: NodeJS.ProcessEnv
  fetchImplementation: AssistantWebSearchFetch
}): AssistantWebSearchRuntimeContext {
  return {
    env: input.env,
    fetchImplementation: input.fetchImplementation,
    timeoutMs: 1_000,
  }
}

function createRequest(
  overrides: Partial<NormalizedAssistantWebSearchRequest> = {},
): NormalizedAssistantWebSearchRequest {
  return {
    count: 5,
    country: null,
    dateAfter: null,
    dateBefore: null,
    domainFilter: [],
    freshness: null,
    language: null,
    provider: null,
    query: 'hydration',
    warnings: [],
    ...overrides,
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function parseRequestBody(body: string | undefined): Record<string, unknown> {
  if (typeof body !== 'string') {
    return {}
  }

  const parsed = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected provider request body to be a JSON object.')
  }

  return parsed as Record<string, unknown>
}
