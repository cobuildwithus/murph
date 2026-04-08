import { afterEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  normalizeAssistantWebSearchRequest,
  readRequiredAssistantWebSearchApiKey,
  resolveConfiguredAssistantWebSearchProvider,
  resolveAssistantSearxngBaseUrl,
  resolveAssistantWebSearchProvider,
} from '../src/assistant/web-search/config.ts'
import { requestAssistantWebSearchJson } from '../src/assistant/web-search/http.ts'
import * as providers from '../src/assistant/web-search/providers.ts'
import {
  applyDomainFilterToAssistantSearchResults,
  dedupeAssistantWebSearchResults,
  normalizeAssistantDomainFilters,
  parseAssistantWebSearchResults,
} from '../src/assistant/web-search/results.ts'
import { searchAssistantWeb } from '../src/assistant/web-search/search.ts'
import {
  firstAssistantString,
  formatAssistantIsoDate,
  formatAssistantUsDate,
  readAssistantArray,
  readAssistantHostname,
  readAssistantNumberArray,
  readAssistantRecord,
  readAssistantStringArray,
} from '../src/assistant/web-search/shared.ts'
import type { AssistantWebSearchResult } from '../src/assistant/web-search/types.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('assistant web-search helpers', () => {
  it('normalizes request filters, clamps result counts, and warns when explicit dates override freshness', () => {
    const request = normalizeAssistantWebSearchRequest(
      {
        query: '  hydration science  ',
        count: 9,
        provider: 'brave',
        country: '  us  ',
        language: ' en ',
        freshness: 'week',
        dateAfter: ' 2026-04-01 ',
        domainFilter: [' Example.COM ', 'https://docs.example.com/guide', '.PubMed.gov', 'example.com'],
      },
      {
        MURPH_WEB_SEARCH_MAX_RESULTS: '3',
      },
    )

    expect(request).toMatchObject({
      query: 'hydration science',
      count: 3,
      provider: 'brave',
      country: 'us',
      language: 'en',
      freshness: 'week',
      dateAfter: '2026-04-01',
      dateBefore: null,
      domainFilter: ['example.com', 'docs.example.com', '.pubmed.gov'],
      warnings: ['Ignored freshness because explicit dateAfter/dateBefore filters were provided.'],
    })
  })

  it('rejects invalid queries and surfaces provider configuration errors', () => {
    expect(() =>
      normalizeAssistantWebSearchRequest(
        {
          query: '   ',
        },
        {},
      ),
    ).toThrowError(/requires a non-empty query string/u)

    expect(() =>
      resolveAssistantWebSearchProvider({
        requestedProvider: 'exa',
        env: {
          BRAVE_API_KEY: 'only-brave',
        },
      }),
    ).toThrowError(/provider exa is not configured/u)

    expect(() =>
      resolveAssistantWebSearchProvider({
        requestedProvider: null,
        env: {
          MURPH_WEB_SEARCH_PROVIDER: 'exa',
          BRAVE_API_KEY: 'only-brave',
        },
      }),
    ).toThrowError(/MURPH_WEB_SEARCH_PROVIDER is set to exa/u)

    expect(() =>
      readRequiredAssistantWebSearchApiKey(undefined, 'exa', 'EXA_API_KEY'),
    ).toThrowError(/requires EXA_API_KEY/u)
  })

  it('normalizes domain filters and applies domain matching rules for exact, subdomain, and dot-prefixed filters', () => {
    expect(
      normalizeAssistantDomainFilters([
        ' Example.com ',
        'https://docs.example.com/guide',
        '.PubMed.gov',
        'example.com',
      ]),
    ).toEqual(['example.com', 'docs.example.com', '.pubmed.gov'])

    expect(
      applyDomainFilterToAssistantSearchResults(
        [
          createSearchResult('https://example.com/article', 'Example'),
          createSearchResult('https://news.example.com/article', 'Example Subdomain'),
          createSearchResult('https://pubmed.gov/paper', 'PubMed Apex'),
          createSearchResult('https://www.pubmed.gov/paper', 'PubMed Subdomain'),
          createSearchResult('notaurl', 'Broken URL'),
        ],
        ['example.com', '.pubmed.gov'],
      ),
    ).toEqual([
      createSearchResult('https://example.com/article', 'Example'),
      createSearchResult('https://news.example.com/article', 'Example Subdomain'),
      createSearchResult('https://www.pubmed.gov/paper', 'PubMed Subdomain'),
    ])
  })

  it('parses provider payloads into normalized result shapes and drops incomplete results', () => {
    expect(
      parseAssistantWebSearchResults('brave', {
        web: {
          results: [
            {
              title: 'Hydration Research',
              url: 'https://news.example.com/hydration',
              description: 'Evidence summary',
            },
            {
              title: 'Sleep and Recovery',
              url: 'https://sleep.example.com/recovery',
              snippet: 'Snippet fallback',
              profile: {
                long_name: 'Sleep Example',
              },
              page_age: '2 days ago',
            },
            {
              title: '',
              url: 'https://missing-title.example.com',
            },
          ],
        },
      }),
    ).toEqual([
      {
        publishedAt: null,
        score: null,
        snippet: 'Evidence summary',
        source: 'news.example.com',
        title: 'Hydration Research',
        url: 'https://news.example.com/hydration',
      },
      {
        publishedAt: '2 days ago',
        score: null,
        snippet: 'Snippet fallback',
        source: 'Sleep Example',
        title: 'Sleep and Recovery',
        url: 'https://sleep.example.com/recovery',
      },
    ])

    expect(
      parseAssistantWebSearchResults('serpapi', {
        organic_results: [
          {
            title: 'Organic Result',
            link: 'https://organic.example.com/article',
            snippet: 'Organic snippet',
            position: 1,
          },
        ],
        news_results: [
          {
            title: 'News Result',
            link: 'https://news.example.com/story',
            source: 'Example News',
            date: '2026-04-08',
          },
          {
            title: 'Missing URL',
          },
        ],
      }),
    ).toEqual([
      {
        publishedAt: null,
        score: 1,
        snippet: 'Organic snippet',
        source: 'organic.example.com',
        title: 'Organic Result',
        url: 'https://organic.example.com/article',
      },
      {
        publishedAt: '2026-04-08',
        score: null,
        snippet: null,
        source: 'Example News',
        title: 'News Result',
        url: 'https://news.example.com/story',
      },
    ])
  })

  it('parses the remaining provider payload variants and normalizes searxng base URLs', () => {
    expect(
      parseAssistantWebSearchResults('exa', {
        results: [
          {
            title: 'Exa Result',
            url: 'https://exa.example.com/article',
            highlights: ['Exa highlight'],
            highlightScores: [0.9],
          },
        ],
      }),
    ).toEqual([
      createSearchResult('https://exa.example.com/article', 'Exa Result', {
        snippet: 'Exa highlight',
        source: 'exa.example.com',
        score: 0.9,
      }),
    ])

    expect(
      parseAssistantWebSearchResults('kagi', {
        data: [
          {
            name: 'Kagi Result',
            url: 'https://kagi.example.com/article',
            description: 'Kagi snippet',
            date: '2026-04-08',
            rank: 2,
          },
        ],
      }),
    ).toEqual([
      createSearchResult('https://kagi.example.com/article', 'Kagi Result', {
        snippet: 'Kagi snippet',
        source: 'kagi.example.com',
        publishedAt: '2026-04-08',
        score: 2,
      }),
    ])

    expect(
      parseAssistantWebSearchResults('perplexity', {
        results: [
          {
            name: 'Perplexity Result',
            link: 'https://perplexity.example.com/article',
            text: 'Perplexity snippet',
            publishedAt: '2026-04-08',
            score: 0.7,
          },
        ],
      }),
    ).toEqual([
      createSearchResult('https://perplexity.example.com/article', 'Perplexity Result', {
        snippet: 'Perplexity snippet',
        source: 'perplexity.example.com',
        publishedAt: '2026-04-08',
        score: 0.7,
      }),
    ])

    expect(
      parseAssistantWebSearchResults('searxng', {
        results: [
          {
            pretty_url: 'Searxng Result',
            url: 'https://searxng.example.com/article',
            content: 'Searxng snippet',
            engines: ['searxng-engine'],
            published_date: '2026-04-08',
            score: 0.4,
          },
        ],
      }),
    ).toEqual([
      createSearchResult('https://searxng.example.com/article', 'Searxng Result', {
        snippet: 'Searxng snippet',
        source: 'searxng-engine',
        publishedAt: '2026-04-08',
        score: 0.4,
      }),
    ])

    expect(
      parseAssistantWebSearchResults('tavily', {
        results: [
          {
            title: 'Tavily Result',
            link: 'https://tavily.example.com/article',
            content: 'Tavily snippet',
            source: 'Tavily Source',
            published_date: '2026-04-08',
            score: 0.8,
          },
        ],
      }),
    ).toEqual([
      createSearchResult('https://tavily.example.com/article', 'Tavily Result', {
        snippet: 'Tavily snippet',
        source: 'Tavily Source',
        publishedAt: '2026-04-08',
        score: 0.8,
      }),
    ])

    expect(
      resolveAssistantSearxngBaseUrl({
        SEARXNG_BASE_URL: 'https://search.example.com/custom///',
      }),
    ).toBe('https://search.example.com/custom')
    expect(
      resolveAssistantSearxngBaseUrl({
        SEARXNG_BASE_URL: 'not-a-url',
      }),
    ).toBeNull()
  })

  it('dedupes results by URL while preserving the first occurrence', () => {
    expect(
      dedupeAssistantWebSearchResults([
        createSearchResult('https://example.com/article', 'First'),
        createSearchResult('https://example.com/article', 'Second'),
        createSearchResult('https://other.example.com/article', 'Third'),
      ]),
    ).toEqual([
      createSearchResult('https://example.com/article', 'First'),
      createSearchResult('https://other.example.com/article', 'Third'),
    ])
  })

  it('filters and dedupes provider results in the end-to-end search flow without network calls', async () => {
    const providerSpy = vi
      .spyOn(providers, 'searchWithAssistantWebSearchProvider')
      .mockResolvedValue({
        results: [
          createSearchResult('https://example.com/a', 'Primary'),
          createSearchResult('https://example.com/a', 'Duplicate'),
          createSearchResult('https://sub.example.com/b', 'Subdomain'),
          createSearchResult('https://elsewhere.com/c', 'Unmatched'),
        ],
        warnings: ['Applied provider-specific fallback.'],
      })

    const response = await searchAssistantWeb(
      {
        query: '  hydration  ',
        count: 2,
        domainFilter: [' Example.com '],
        freshness: 'day',
        dateAfter: '2026-04-01',
      },
      {
        BRAVE_API_KEY: 'test-brave-key',
      },
    )

    expect(providerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'brave',
        request: expect.objectContaining({
          count: 2,
          domainFilter: ['example.com'],
          query: 'hydration',
        }),
      }),
    )
    expect(response).toEqual({
      provider: 'brave',
      query: 'hydration',
      resultCount: 2,
      results: [
        createSearchResult('https://example.com/a', 'Primary'),
        createSearchResult('https://sub.example.com/b', 'Subdomain'),
      ],
      filters: {
        country: null,
        language: null,
        freshness: 'day',
        dateAfter: '2026-04-01',
        dateBefore: null,
        domainFilter: ['example.com'],
      },
      warnings: [
        'Ignored freshness because explicit dateAfter/dateBefore filters were provided.',
        'Applied provider-specific fallback.',
      ],
    })
  })

  it('resolves the highest-priority configured provider unless an override is configured', () => {
    expect(
      resolveConfiguredAssistantWebSearchProvider({
        BRAVE_API_KEY: 'brave-key',
        SEARXNG_BASE_URL: 'https://search.example.com/',
        EXA_API_KEY: 'exa-key',
      }),
    ).toBe('searxng')

    expect(
      resolveConfiguredAssistantWebSearchProvider({
        BRAVE_API_KEY: 'brave-key',
        MURPH_WEB_SEARCH_PROVIDER: 'exa',
        EXA_API_KEY: 'exa-key',
      }),
    ).toBe('exa')
  })

  it('normalizes shared helper accessors, hostnames, and date formatting', () => {
    expect(readAssistantRecord({ count: 1 })).toEqual({ count: 1 })
    expect(readAssistantRecord(['not-a-record'])).toBeNull()
    expect(readAssistantArray(['a', 'b'])).toEqual(['a', 'b'])
    expect(readAssistantArray('not-an-array')).toEqual([])
    expect(readAssistantStringArray(['  one  ', '', 2, 'two'])).toEqual(['one', 'two'])
    expect(readAssistantNumberArray([1, Number.POSITIVE_INFINITY, '2', 3])).toEqual([1, 3])
    expect(firstAssistantString(null, '   ', ' value ')).toBe('value')
    expect(readAssistantHostname('https://Example.com/path')).toBe('example.com')
    expect(readAssistantHostname('not-a-url')).toBeNull()
    expect(formatAssistantIsoDate(new Date(Date.UTC(2026, 3, 8)))).toBe('2026-04-08')
    expect(formatAssistantUsDate('2026-04-08')).toBe('4/8/2026')
  })

  it('retries retryable HTTP failures and returns the eventual JSON payload', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Provider unavailable' }), {
          status: 503,
          headers: {
            'content-type': 'application/json',
            'retry-after': '0',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ title: 'Hydration' }] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }),
      )

    await expect(
      requestAssistantWebSearchJson({
        fetchImplementation,
        headers: {
          authorization: 'Bearer test-key',
        },
        method: 'POST',
        provider: 'brave',
        timeoutMs: 1_000,
        url: 'https://search.example.com/query',
        body: {
          q: 'hydration',
        },
      }),
    ).resolves.toEqual({
      results: [{ title: 'Hydration' }],
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      'https://search.example.com/query',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ q: 'hydration' }),
      }),
    )
  })

  it('surfaces non-retryable HTTP failures with raw response text when JSON parsing does not apply', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response('Bad request from provider', {
        status: 400,
        headers: {
          'content-type': 'text/plain',
        },
      }),
    )

    let thrown: unknown
    try {
      await requestAssistantWebSearchJson({
        fetchImplementation,
        headers: {},
        method: 'GET',
        provider: 'exa',
        timeoutMs: 1_000,
        url: 'https://search.example.com/query?q=hydration',
      })
    } catch (error) {
      thrown = error
    }

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(thrown).toBeInstanceOf(VaultCliError)
    expect(thrown).toMatchObject({
      code: 'WEB_SEARCH_REQUEST_FAILED',
      context: {
        method: 'GET',
        provider: 'exa',
        retryable: false,
        status: 400,
        url: 'https://search.example.com/query?q=hydration',
      },
      message: 'Bad request from provider',
    })
  })

  it('marks transport timeouts as retryable request failures with timeout context', async () => {
    vi.useFakeTimers()
    const fetchImplementation = vi.fn((_input: string, init: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new Error('aborted by timeout')),
          { once: true },
        )
      })
    })

    const requestPromise = requestAssistantWebSearchJson({
      fetchImplementation,
      headers: {},
      method: 'GET',
      provider: 'kagi',
      timeoutMs: 5,
      url: 'https://search.example.com/query?q=sleep',
    })
    const rejection = requestPromise.then(
      () => {
        throw new Error('Expected requestAssistantWebSearchJson to reject.')
      },
      (error) => error,
    )
    await vi.advanceTimersByTimeAsync(1_265)

    expect(await rejection).toMatchObject({
      code: 'WEB_SEARCH_REQUEST_FAILED',
      context: {
        method: 'GET',
        provider: 'kagi',
        retryable: true,
        timedOut: true,
        timeoutMs: 5,
        transportError: 'aborted by timeout',
        url: 'https://search.example.com/query?q=sleep',
      },
      message: 'web.search kagi request timed out after 5ms.',
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
  })
})

function createSearchResult(
  url: string,
  title: string,
  overrides: Partial<AssistantWebSearchResult> = {},
): AssistantWebSearchResult {
  return {
    publishedAt: null,
    score: null,
    snippet: null,
    source: null,
    title,
    url,
    ...overrides,
  }
}
