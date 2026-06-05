import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'

import { searchSupplementLabels } from '../src/supplement-labels.js'

describe('searchSupplementLabels', () => {
  it('requires the hosted web base URL', async () => {
    await expect(
      searchSupplementLabels(
        {
          q: 'creatine',
        },
        {
          env: {},
          fetchImpl: async () => new Response('unexpected'),
        },
      ),
    ).rejects.toMatchObject({
      code: 'supplement_labels_api_unconfigured',
    })
  })

  it('calls the hosted supplements API without local authorization headers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      items: [
        {
          id: '82118',
          name: 'Creatine Monohydrate',
          brand: 'Example Brand',
          upc: '123456789012',
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
        limit: 2,
        includeOffMarket: true,
      },
      {
        env: {
          HOSTED_WEB_BASE_URL: 'https://web.example.test',
        },
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
          id: '82118',
          name: 'Creatine Monohydrate',
          brand: 'Example Brand',
          upc: '123456789012',
          offMarket: false,
        },
      ],
    })
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.origin, 'https://web.example.test')
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
        name: 'Creatine Monohydrate',
        brand: 'Example Brand',
        upc: '123456789012',
        offMarket: false,
        label: {
          id: 82118,
        },
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
        env: {
          HOSTED_WEB_BASE_URL: 'https://web.example.test',
        },
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result, {
      source: 'murph-data-api',
      query: '82118',
      limit: 10,
      includeOffMarket: false,
      items: [
        {
          id: '82118',
          name: 'Creatine Monohydrate',
          brand: 'Example Brand',
          upc: '123456789012',
          offMarket: false,
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
        name: 'Legacy Creatine',
        brand: 'Example Brand',
        upc: null,
        offMarket: true,
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
        env: {
          HOSTED_WEB_BASE_URL: 'https://web.example.test',
        },
        fetchImpl: fetchMock,
      },
    )

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.searchParams.get('id'), '82118')
    assert.equal(requestUrl.searchParams.get('includeOffMarket'), 'true')
  })

  it('looks up GTIN-shaped UPC input through the exact UPC endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: '82118',
        name: 'Creatine Monohydrate',
        brand: null,
        upc: '123456789012',
        offMarket: false,
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
        env: {
          HOSTED_WEB_BASE_URL: 'https://web.example.test',
        },
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
          name: 'Creatine Monohydrate',
          brand: null,
          upc: '123456789012',
          offMarket: false,
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
        env: {
          HOSTED_WEB_BASE_URL: 'https://web.example.test',
        },
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
        env: {
          HOSTED_WEB_BASE_URL: 'https://web.example.test',
        },
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result.items, [])
  })
})
