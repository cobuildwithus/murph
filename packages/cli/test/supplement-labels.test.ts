import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'

import {
  searchSupplementLabels,
  searchSupplementLabelsBatch,
} from '../src/supplement-labels.js'

const hostedRuntimeEnv = {
  MURPH_HOSTED_RUNTIME_PROCESS: '1',
}

const creatineLabel = {
  ingredients: ['Creatine Monohydrate'],
  supplementFacts: {
    servingSize: '1 scoop',
  },
}

const dailymedLabel = {
  otherIngredients: {
    ingredients: ['Milk Protein'],
  },
  supplementFacts: {
    servingSize: '1 bottle',
  },
}

describe('searchSupplementLabels', () => {
  it('calls the internal supplements API without local authorization headers or hosted web config', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      items: [
        {
          id: 'dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64',
          dataOrigin: 'dailymed',
          dataOriginId: '00446e6a-875c-4d46-9e13-a146c5fe7a64',
          name: 'JBA STANOMAX Caffe Latte',
          brand: 'Advanced Pharmaceutical Services',
          upc: null,
          offMarket: false,
          label: dailymedLabel,
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchSupplementLabels(
      {
        q: 'creatine',
        limit: 2,
        includeOffMarket: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result, {
      source: 'murph-data-api',
      query: 'creatine',
      limit: 2,
      includeOffMarket: true,
      items: [
        {
          id: 'dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64',
          dataOrigin: 'dailymed',
          dataOriginId: '00446e6a-875c-4d46-9e13-a146c5fe7a64',
          name: 'JBA STANOMAX Caffe Latte',
          brand: 'Advanced Pharmaceutical Services',
          upc: null,
          offMarket: false,
          label: dailymedLabel,
        },
      ],
    })
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.origin, 'http://murph-data-api.worker')
    assert.equal(requestUrl.pathname, '/api/supplements')
    assert.equal(requestUrl.searchParams.get('q'), 'creatine')
    assert.equal(requestUrl.searchParams.get('limit'), '2')
    assert.equal(requestUrl.searchParams.get('includeOffMarket'), 'true')
    const init = fetchMock.mock.calls[0]?.[1]
    const headers = init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : init?.headers
    assert.equal(
      headers && !Array.isArray(headers)
        ? Object.hasOwn(headers, 'authorization')
        : false,
      false,
    )
  })

  it('looks up all-digit DSLD ids through the exact id endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: '82118',
        dataOrigin: 'dsld',
        dataOriginId: '82118',
        name: 'Creatine Monohydrate',
        brand: 'Example Brand',
        upc: '123456789012',
        offMarket: false,
        label: creatineLabel,
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchSupplementLabels(
      {
        q: '82118',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result, {
      source: 'murph-data-api',
      query: '82118',
      limit: 5,
      includeOffMarket: false,
      items: [
        {
          id: '82118',
          dataOrigin: 'dsld',
          dataOriginId: '82118',
          name: 'Creatine Monohydrate',
          brand: 'Example Brand',
          upc: '123456789012',
          offMarket: false,
          label: creatineLabel,
        },
      ],
    })
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/supplements')
    assert.equal(requestUrl.searchParams.get('id'), '82118')
    assert.equal(requestUrl.searchParams.has('q'), false)
  })

  it('preserves off-market inclusion for exact DSLD id lookups', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: '82118',
        dataOrigin: 'dsld',
        dataOriginId: '82118',
        name: 'Legacy Creatine',
        brand: 'Example Brand',
        upc: null,
        offMarket: true,
        label: creatineLabel,
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    await searchSupplementLabels(
      {
        q: '82118',
        includeOffMarket: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.searchParams.get('id'), '82118')
    assert.equal(requestUrl.searchParams.get('includeOffMarket'), 'true')
  })

  it('looks up source-qualified external ids through the exact id endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: 'dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64',
        dataOrigin: 'dailymed',
        dataOriginId: '00446e6a-875c-4d46-9e13-a146c5fe7a64',
        name: 'JBA STANOMAX Caffe Latte',
        brand: 'Advanced Pharmaceutical Services',
        upc: null,
        offMarket: false,
        label: dailymedLabel,
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchSupplementLabels(
      {
        q: 'dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.id, 'dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64')
    assert.equal(result.items[0]?.dataOrigin, 'dailymed')
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/supplements')
    assert.equal(requestUrl.searchParams.get('id'), 'dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64')
    assert.equal(requestUrl.searchParams.has('q'), false)
  })

  it('falls back to text search when source-qualified external ids miss', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url) => {
      const requestUrl = new URL(String(_url))
      if (requestUrl.searchParams.has('id')) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          status: 404,
        })
      }

      return new Response(JSON.stringify({
        items: [
          {
            id: 'dailymed:00446e6a-875c-4d46-9e13-a146c5fe7a64',
            dataOrigin: 'dailymed',
            dataOriginId: '00446e6a-875c-4d46-9e13-a146c5fe7a64',
            name: 'JBA STANOMAX Caffe Latte',
            brand: 'Advanced Pharmaceutical Services',
            upc: null,
            offMarket: false,
            label: dailymedLabel,
          },
        ],
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchSupplementLabels(
      {
        q: 'dailymed:missing',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.dataOrigin, 'dailymed')
    assert.equal(fetchMock.mock.calls.length, 2)
    assert.equal(
      new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('id'),
      'dailymed:missing',
    )
    assert.equal(
      new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('q'),
      'dailymed:missing',
    )
  })

  it('keeps colon text with spaces on normal search', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      items: [],
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    await searchSupplementLabels(
      {
        q: 'brand: creatine',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.searchParams.get('q'), 'brand: creatine')
    assert.equal(requestUrl.searchParams.get('limit'), '5')
    assert.equal(requestUrl.searchParams.has('id'), false)
  })

  it('tolerates metadata-only search responses during deploy skew', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      items: [
        {
          id: '82118',
          dataOrigin: 'dsld',
          dataOriginId: '82118',
          name: 'Creatine Monohydrate',
          brand: null,
          upc: null,
          offMarket: false,
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchSupplementLabels(
      {
        q: 'creatine',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result.items, [
      {
        id: '82118',
        dataOrigin: 'dsld',
        dataOriginId: '82118',
        name: 'Creatine Monohydrate',
        brand: null,
        upc: null,
        offMarket: false,
      },
    ])
  })

  it('looks up GTIN-shaped UPC input through the exact UPC endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: '82118',
        dataOrigin: 'dsld',
        dataOriginId: '82118',
        name: 'Creatine Monohydrate',
        brand: null,
        upc: '123456789012',
        offMarket: false,
        label: creatineLabel,
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    await searchSupplementLabels(
      {
        q: '123-456-789012',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/supplements')
    assert.equal(requestUrl.searchParams.get('upc'), '123456789012')
    assert.equal(requestUrl.searchParams.has('q'), false)
  })

  it('falls back from DSLD id to UPC for all-digit GTIN input', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url) => {
      const requestUrl = new URL(String(_url))
      if (requestUrl.searchParams.has('id')) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          status: 404,
        })
      }

      return new Response(JSON.stringify({
        item: {
          id: '82118',
          dataOrigin: 'dsld',
          dataOriginId: '82118',
          name: 'Creatine Monohydrate',
          brand: null,
          upc: '123456789012',
          offMarket: false,
          label: creatineLabel,
        },
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchSupplementLabels(
      {
        q: '123456789012',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.upc, '123456789012')
    assert.equal(fetchMock.mock.calls.length, 2)
    assert.equal(
      new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('id'),
      '123456789012',
    )
    assert.equal(
      new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('upc'),
      '123456789012',
    )
  })

  it('returns an empty result for exact lookup misses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: 'not_found',
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 404,
    }))

    const result = await searchSupplementLabels(
      {
        q: '82118',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result.items, [])
  })

  it('fails explicitly outside hosted assistant runtime', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))

    await expect(
      searchSupplementLabels(
        {
          q: 'creatine',
        },
        {
          env: {},
          fetchImpl: fetchMock,
        },
      ),
    ).rejects.toMatchObject({
      code: 'supplement_labels_api_hosted_only',
      message: 'Supplement label search runs through the hosted Murph data API and is only available inside hosted assistant runtime.',
    })
    assert.equal(fetchMock.mock.calls.length, 0)
  })
})

describe('searchSupplementLabelsBatch', () => {
  it('posts multiple hosted supplement label queries through the internal data API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      results: [
        {
          query: 'creatine',
          items: [
            {
              id: '82118',
              dataOrigin: 'dsld',
              dataOriginId: '82118',
              name: 'Creatine Monohydrate',
              brand: null,
              upc: null,
              offMarket: false,
              label: creatineLabel,
            },
          ],
        },
        {
          query: 'blueprint bryan johnson',
          items: [
            {
              id: 'dailymed:blueprint',
              dataOrigin: 'dailymed',
              dataOriginId: 'blueprint',
              name: 'Blueprint Essential Capsules',
              brand: 'Blueprint',
              upc: null,
              offMarket: false,
              label: dailymedLabel,
            },
          ],
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchSupplementLabelsBatch(
      {
        queries: [' creatine ', 'blueprint bryan johnson'],
        limit: 3,
        includeOffMarket: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result, {
      source: 'murph-data-api',
      queries: ['creatine', 'blueprint bryan johnson'],
      limit: 3,
      includeOffMarket: true,
      results: [
        {
          query: 'creatine',
          items: [
            {
              id: '82118',
              dataOrigin: 'dsld',
              dataOriginId: '82118',
              name: 'Creatine Monohydrate',
              brand: null,
              upc: null,
              offMarket: false,
              label: creatineLabel,
            },
          ],
        },
        {
          query: 'blueprint bryan johnson',
          items: [
            {
              id: 'dailymed:blueprint',
              dataOrigin: 'dailymed',
              dataOriginId: 'blueprint',
              name: 'Blueprint Essential Capsules',
              brand: 'Blueprint',
              upc: null,
              offMarket: false,
              label: dailymedLabel,
            },
          ],
        },
      ],
    })

    assert.equal(fetchMock.mock.calls.length, 1)
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.origin, 'http://murph-data-api.worker')
    assert.equal(requestUrl.pathname, '/api/supplements')
    assert.equal(requestUrl.search, '')
    const init = fetchMock.mock.calls[0]?.[1]
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      queries: ['creatine', 'blueprint bryan johnson'],
      limit: 3,
      includeOffMarket: true,
    })
    const headers = init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : init?.headers
    assert.equal(
      headers && !Array.isArray(headers)
        ? Object.hasOwn(headers, 'authorization')
        : false,
      false,
    )
    assert.equal(
      headers && !Array.isArray(headers)
        ? headers['content-type']
        : undefined,
      'application/json',
    )
  })

  it('uses one match per batch query by default', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      results: [
        {
          query: 'creatine',
          items: [],
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchSupplementLabelsBatch(
      {
        queries: ['creatine'],
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.limit, 5)
    const init = fetchMock.mock.calls[0]?.[1]
    assert.deepEqual(JSON.parse(String(init?.body)), {
      queries: ['creatine'],
      limit: 5,
      includeOffMarket: false,
    })
  })

  it('rejects oversized batch queries before calling the hosted API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))

    await expect(
      searchSupplementLabelsBatch(
        {
          queries: ['a'.repeat(257)],
        },
        {
          env: hostedRuntimeEnv,
          fetchImpl: fetchMock,
        },
      ),
    ).rejects.toMatchObject({
      name: 'ZodError',
    })
    assert.equal(fetchMock.mock.calls.length, 0)
  })

  it('fails explicitly outside hosted assistant runtime', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))

    await expect(
      searchSupplementLabelsBatch(
        {
          queries: ['creatine'],
        },
        {
          env: {},
          fetchImpl: fetchMock,
        },
      ),
    ).rejects.toMatchObject({
      code: 'supplement_labels_api_hosted_only',
      message: 'Supplement label search runs through the hosted Murph data API and is only available inside hosted assistant runtime.',
    })
    assert.equal(fetchMock.mock.calls.length, 0)
  })
})
