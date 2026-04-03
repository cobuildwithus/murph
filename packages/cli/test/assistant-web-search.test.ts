import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

import {
  createDefaultAssistantToolCatalog,
} from '@murphai/assistant-core/assistant-cli-tools'

const assistantWebSearchEnvKeys = [
  'BRAVE_API_KEY',
  'EXA_API_KEY',
  'KAGI_API_KEY',
  'KAGI_API_TOKEN',
  'MURPH_WEB_SEARCH_PROVIDER',
  'PERPLEXITY_API_KEY',
  'SEARXNG_BASE_URL',
  'SERPAPI_API_KEY',
  'TAVILY_API_KEY',
] as const

const originalAssistantWebSearchEnv = Object.fromEntries(
  assistantWebSearchEnvKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof assistantWebSearchEnvKeys)[number], string | undefined>

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
    },
    status: 200,
  })
}

async function executeWebSearchTool(input: Record<string, unknown>) {
  const catalog = createDefaultAssistantToolCatalog({
    vault: '/tmp/test-vault',
  })
  const results = await catalog.executeCalls({
    calls: [
      {
        tool: 'web.search',
        input,
      },
    ],
  })

  assert.equal(results[0]?.status, 'succeeded')
  return results[0]?.result
}

afterEach(() => {
  for (const key of assistantWebSearchEnvKeys) {
    const value = originalAssistantWebSearchEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  vi.unstubAllGlobals()
})

test('createDefaultAssistantToolCatalog exposes web.search only when a provider is configured', () => {
  delete process.env.BRAVE_API_KEY
  delete process.env.EXA_API_KEY
  delete process.env.KAGI_API_KEY
  delete process.env.KAGI_API_TOKEN
  delete process.env.MURPH_WEB_SEARCH_PROVIDER
  delete process.env.PERPLEXITY_API_KEY
  delete process.env.SEARXNG_BASE_URL
  delete process.env.SERPAPI_API_KEY
  delete process.env.TAVILY_API_KEY

  const withoutProvider = createDefaultAssistantToolCatalog({
    vault: '/tmp/test-vault',
  })
  assert.equal(withoutProvider.hasTool('web.search'), false)

  process.env.SEARXNG_BASE_URL = 'https://search.example/base///'

  const withProvider = createDefaultAssistantToolCatalog({
    vault: '/tmp/test-vault',
  })
  assert.equal(withProvider.hasTool('web.search'), true)
})

test('web.search preserves the public assistant tool behavior while using split internal modules', async () => {
  process.env.SEARXNG_BASE_URL = 'https://search.example/base///'

  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
    results: [
      {
        title: 'OpenAI Docs',
        url: 'https://docs.openai.com/guide',
        content: 'Primary result',
        engines: ['search-node'],
        score: 0.9,
      },
      {
        title: 'OpenAI Docs Duplicate',
        url: 'https://docs.openai.com/guide',
        content: 'Duplicate result',
        engines: ['search-node'],
        score: 0.8,
      },
      {
        title: 'Example Domain',
        url: 'https://example.com/reference',
        content: 'Secondary result',
        engines: ['search-node'],
        score: 0.5,
      },
      {
        title: 'Filtered Out',
        url: 'https://irrelevant.example.net/post',
        content: 'Should be filtered out',
        engines: ['search-node'],
        score: 0.1,
      },
    ],
  }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await executeWebSearchTool({
    query: ' OpenAI docs ',
    provider: 'searxng',
    freshness: 'week',
    domainFilter: [' docs.openai.com ', 'https://example.com'],
    count: 5,
  })

  assert.equal(fetchMock.mock.calls.length, 1)
  assert.equal(
    String(fetchMock.mock.calls[0]?.[0]),
    'https://search.example/search?q=OpenAI+docs&format=json&categories=general',
  )
  assert.deepEqual(result, {
    provider: 'searxng',
    query: 'OpenAI docs',
    resultCount: 2,
    results: [
      {
        title: 'OpenAI Docs',
        url: 'https://docs.openai.com/guide',
        snippet: 'Primary result',
        source: 'search-node',
        publishedAt: null,
        score: 0.9,
      },
      {
        title: 'Example Domain',
        url: 'https://example.com/reference',
        snippet: 'Secondary result',
        source: 'search-node',
        publishedAt: null,
        score: 0.5,
      },
    ],
    filters: {
      country: null,
      language: null,
      freshness: 'week',
      dateAfter: null,
      dateBefore: null,
      domainFilter: ['docs.openai.com', 'example.com'],
    },
    warnings: [
      'Applied domain filtering client-side after searxng returned results.',
      'searxng only exposes day, month, and year time ranges; week was not applied.',
    ],
  })
})

test('web.search preserves brave query shaping and parsing through the public tool path', async () => {
  process.env.BRAVE_API_KEY = 'brave-key'

  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
    web: {
      results: [
        {
          title: 'Brave Result',
          url: 'https://news.example/item',
          description: 'Brave snippet',
          profile: {
            long_name: 'Example News',
          },
          page_age: '2026-02-10',
        },
      ],
    },
  }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await executeWebSearchTool({
    query: ' Murph update ',
    provider: 'brave',
    country: 'us',
    language: 'en',
    freshness: 'month',
    count: 2,
  })

  assert.equal(fetchMock.mock.calls.length, 1)
  assert.equal(
    String(fetchMock.mock.calls[0]?.[0]),
    'https://api.search.brave.com/res/v1/web/search?q=Murph+update&count=2&spellcheck=false&country=US&search_lang=en&freshness=pm',
  )
  assert.deepEqual(
    (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)
      ?.headers,
    {
      Accept: 'application/json',
      'X-Subscription-Token': 'brave-key',
    },
  )
  assert.deepEqual(result, {
    provider: 'brave',
    query: 'Murph update',
    resultCount: 1,
    results: [
      {
        title: 'Brave Result',
        url: 'https://news.example/item',
        snippet: 'Brave snippet',
        source: 'Example News',
        publishedAt: '2026-02-10',
        score: null,
      },
    ],
    filters: {
      country: 'us',
      language: 'en',
      freshness: 'month',
      dateAfter: null,
      dateBefore: null,
      domainFilter: [],
    },
    warnings: [],
  })
})

test('web.search preserves exa body shaping and parsed results through the public tool path', async () => {
  process.env.EXA_API_KEY = 'exa-key'

  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
    results: [
      {
        title: 'Exa Result',
        url: 'https://example.com/exa',
        highlights: ['Important highlight'],
        highlightScores: [0.7],
        publishedDate: '2026-02-20',
      },
    ],
  }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await executeWebSearchTool({
    query: ' Exa update ',
    provider: 'exa',
    country: 'au',
    dateAfter: '2026-02-01',
    dateBefore: '2026-03-01',
    domainFilter: ['https://example.com'],
    count: 3,
  })

  assert.equal(fetchMock.mock.calls.length, 1)
  assert.equal(
    String(fetchMock.mock.calls[0]?.[0]),
    'https://api.exa.ai/search',
  )
  const requestInit = fetchMock.mock.calls[0]?.[1] as {
    body?: string
    headers?: Record<string, string>
    method?: string
  } | undefined
  assert.equal(requestInit?.method, 'POST')
  assert.deepEqual(requestInit?.headers, {
    'content-type': 'application/json',
    'x-api-key': 'exa-key',
  })
  assert.deepEqual(JSON.parse(requestInit?.body ?? '{}'), {
    query: 'Exa update',
    type: 'auto',
    numResults: 3,
    userLocation: 'AU',
    includeDomains: ['example.com'],
    startPublishedDate: '2026-02-01',
    endPublishedDate: '2026-03-01',
    contents: {
      highlights: {
        maxCharacters: 1200,
      },
      maxAgeHours: 0,
    },
  })
  assert.deepEqual(result, {
    provider: 'exa',
    query: 'Exa update',
    resultCount: 1,
    results: [
      {
        title: 'Exa Result',
        url: 'https://example.com/exa',
        snippet: 'Important highlight',
        source: 'example.com',
        publishedAt: '2026-02-20',
        score: 0.7,
      },
    ],
    filters: {
      country: 'au',
      language: null,
      freshness: null,
      dateAfter: '2026-02-01',
      dateBefore: '2026-03-01',
      domainFilter: ['example.com'],
    },
    warnings: [],
  })
})
