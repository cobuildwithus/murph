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
})
