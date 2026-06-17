import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'

import {
  searchFoodLabels,
  searchFoodLabelsBatch,
} from '../src/food-labels.js'

const hostedRuntimeEnv = {
  MURPH_HOSTED_RUNTIME_PROCESS: '1',
}

const yogurtLabel = {
  ingredients: 'Cultured grade A milk.',
  servingSize: 170,
  servingSizeUnit: 'g',
  labelNutrients: {
    calories: {
      value: 100,
    },
  },
}

const riceLabel = {
  servingSize: 45,
  servingSizeUnit: 'g',
  nutrients: [
    {
      name: 'Energy',
      value: 370,
      unit: 'kcal',
    },
  ],
}

const yogurtContaminants = {
  status: 'known_product_tests',
  murphConcernLevel: 'medium',
  alertCount: 1,
  alerts: [
    {
      contaminantKey: 'bpa',
      contaminantName: 'Bisphenol A (BPA)',
      concernLevel: 'medium',
      result: {
        operator: 'eq',
        value: 0.012,
        unit: 'ppm',
        basis: 'product_mass',
      },
      threshold: {
        value: 0.01,
        unit: 'ppm',
        basis: 'product_mass',
        authority: 'Example Authority',
        name: 'Bisphenol A (BPA)',
        url: null,
      },
      source: {
        key: 'plasticlist_bay_area_2024',
        name: 'PlasticList',
        url: 'https://plasticlist.org',
        reportTitle: 'Data on Plastic Chemicals in Bay Area Foods',
        reportDate: '2024-07-11',
      },
      testedProduct: {
        name: 'Plain Greek Yogurt',
        brand: 'Example Dairy',
        upc: '012345678905',
        sourceProductId: '79',
        matchMethod: 'manual_confirmed',
      },
    },
  ],
  observationCount: 1,
  observations: [
    {
      contaminantKey: 'bpa',
      contaminantName: 'Bisphenol A (BPA)',
      result: {
        operator: 'eq',
        value: 12,
        unit: 'ng/g',
        basis: 'product_mass',
      },
      normalizedResult: {
        value: 0.012,
        unit: 'ppm',
        basis: 'product_mass',
      },
      source: {
        key: 'plasticlist_bay_area_2024',
        name: 'PlasticList',
        url: 'https://plasticlist.org',
        reportTitle: 'Data on Plastic Chemicals in Bay Area Foods',
        reportDate: '2024-07-11',
      },
      testedProduct: {
        name: 'Plain Greek Yogurt',
        brand: 'Example Dairy',
        upc: '012345678905',
        sourceProductId: '79',
        matchMethod: 'manual_confirmed',
      },
    },
  ],
}

describe('searchFoodLabels', () => {
  it('calls the internal foods API without local authorization headers or hosted web config', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      items: [
        {
          id: 'fdc:2259794',
          dataOrigin: 'usda_branded',
          dataOriginId: '2259794',
          name: 'Plain Greek Yogurt',
          brand: 'Example Dairy',
          upc: '012345678905',
          offMarket: false,
          label: yogurtLabel,
          contaminants: yogurtContaminants,
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchFoodLabels(
      {
        q: 'plain greek yogurt',
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
      query: 'plain greek yogurt',
      limit: 2,
      includeOffMarket: true,
      items: [
        {
          id: 'fdc:2259794',
          dataOrigin: 'usda_branded',
          dataOriginId: '2259794',
          name: 'Plain Greek Yogurt',
          brand: 'Example Dairy',
          upc: '012345678905',
          offMarket: false,
          label: yogurtLabel,
          contaminants: yogurtContaminants,
        },
      ],
    })
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.origin, 'http://murph-data-api.worker')
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('q'), 'plain greek yogurt')
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

  it('passes generic-only text searches to the foods API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      items: [
        {
          id: 'fdc:331960',
          dataOrigin: 'usda_foundation',
          dataOriginId: '331960',
          name: 'Chicken, breast, skinless, boneless, meat only, cooked, braised',
          brand: null,
          upc: null,
          offMarket: false,
          label: {
            servingSize: 100,
            servingSizeUnit: 'g',
          },
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchFoodLabels(
      {
        q: 'chicken breast cooked skinless',
        genericOnly: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.genericOnly, true)
    assert.equal(result.items[0]?.dataOrigin, 'usda_foundation')
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('q'), 'chicken breast cooked skinless')
    assert.equal(requestUrl.searchParams.get('genericOnly'), 'true')
  })

  it('does not send generic-only on source-qualified USDA FDC exact id lookups', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: 'fdc:169757',
        dataOrigin: 'usda_sr_legacy',
        dataOriginId: '169757',
        name: 'Rice, white, long-grain, raw',
        brand: null,
        upc: null,
        offMarket: false,
        label: riceLabel,
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchFoodLabels(
      {
        q: 'fdc:169757',
        genericOnly: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.id, 'fdc:169757')
    assert.equal(result.items[0]?.dataOrigin, 'usda_sr_legacy')
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('id'), 'fdc:169757')
    assert.equal(requestUrl.searchParams.has('q'), false)
    assert.equal(requestUrl.searchParams.has('genericOnly'), false)
  })

  it('falls back to text search when source-qualified FDC ids miss', async () => {
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
            id: 'fdc:2259794',
            dataOrigin: 'usda_branded',
            dataOriginId: '2259794',
            name: 'Plain Greek Yogurt',
            brand: 'Example Dairy',
            upc: '012345678905',
            offMarket: false,
            label: yogurtLabel,
          },
        ],
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchFoodLabels(
      {
        q: 'fdc:missing',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.dataOrigin, 'usda_branded')
    assert.equal(fetchMock.mock.calls.length, 2)
    assert.equal(
      new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('id'),
      'fdc:missing',
    )
    assert.equal(
      new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('q'),
      'fdc:missing',
    )
  })

  it('does not send generic-only on GTIN-shaped UPC exact lookups', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: 'fdc:2259794',
        dataOrigin: 'usda_branded',
        dataOriginId: '2259794',
        name: 'Plain Greek Yogurt',
        brand: 'Example Dairy',
        upc: '012345678905',
        offMarket: false,
        label: yogurtLabel,
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    await searchFoodLabels(
      {
        q: '01234-56789-05',
        genericOnly: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('upc'), '012345678905')
    assert.equal(requestUrl.searchParams.has('q'), false)
    assert.equal(requestUrl.searchParams.has('genericOnly'), false)
  })

  it('prefers exact UPC over prefixed FDC id for all-digit GTIN input', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url) => {
      const requestUrl = new URL(String(_url))

      if (requestUrl.searchParams.has('id')) {
        return new Response(JSON.stringify({
          item: {
            id: 'fdc:012345678905',
            dataOrigin: 'usda_sr_legacy',
            dataOriginId: '012345678905',
            name: 'Wrong numeric FDC id match',
            brand: null,
            upc: null,
            offMarket: false,
            label: riceLabel,
          },
        }), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          status: 200,
        })
      }

      return new Response(JSON.stringify({
        item: {
          id: 'fdc:2259794',
          dataOrigin: 'usda_branded',
          dataOriginId: '2259794',
          name: 'Plain Greek Yogurt',
          brand: 'Example Dairy',
          upc: '012345678905',
          offMarket: false,
          label: yogurtLabel,
        },
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchFoodLabels(
      {
        q: '012345678905',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.id, 'fdc:2259794')
    assert.equal(result.items[0]?.upc, '012345678905')
    assert.equal(fetchMock.mock.calls.length, 1)
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('upc'), '012345678905')
    assert.equal(requestUrl.searchParams.has('id'), false)
  })

  it('falls back from exact UPC to prefixed FDC id for all-digit GTIN input', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url) => {
      const requestUrl = new URL(String(_url))

      if (requestUrl.searchParams.has('upc')) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          status: 404,
        })
      }

      return new Response(JSON.stringify({
        item: {
          id: 'fdc:012345678905',
          dataOrigin: 'usda_sr_legacy',
          dataOriginId: '012345678905',
          name: 'Numeric FDC id match',
          brand: null,
          upc: null,
          offMarket: false,
          label: riceLabel,
        },
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchFoodLabels(
      {
        q: '012345678905',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.id, 'fdc:012345678905')
    assert.equal(fetchMock.mock.calls.length, 2)
    assert.equal(
      new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('upc'),
      '012345678905',
    )
    assert.equal(
      new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('id'),
      'fdc:012345678905',
    )
  })

  it('falls back from numeric exact misses to text search', async () => {
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
            id: 'fdc:365',
            dataOrigin: 'usda_branded',
            dataOriginId: '365',
            name: '365 Organic Blueberries',
            brand: '365 by Whole Foods Market',
            upc: null,
            offMarket: false,
            label: yogurtLabel,
          },
        ],
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchFoodLabels(
      {
        q: '365',
        genericOnly: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.name, '365 Organic Blueberries')
    assert.equal(fetchMock.mock.calls.length, 2)
    const exactUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(exactUrl.searchParams.get('id'), 'fdc:365')
    assert.equal(exactUrl.searchParams.has('genericOnly'), false)
    const fallbackUrl = new URL(String(fetchMock.mock.calls[1]?.[0]))
    assert.equal(fallbackUrl.searchParams.get('q'), '365')
    assert.equal(fallbackUrl.searchParams.get('genericOnly'), 'true')
  })

  it('falls back from GTIN exact misses to text search', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url) => {
      const requestUrl = new URL(String(_url))

      if (requestUrl.searchParams.has('upc') || requestUrl.searchParams.has('id')) {
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
            id: 'fdc:2259794',
            dataOrigin: 'usda_branded',
            dataOriginId: '2259794',
            name: 'Plain Greek Yogurt',
            brand: 'Example Dairy',
            upc: '012345678905',
            offMarket: false,
            label: yogurtLabel,
          },
        ],
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchFoodLabels(
      {
        q: '012345678905',
        genericOnly: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.id, 'fdc:2259794')
    assert.equal(fetchMock.mock.calls.length, 3)
    const upcUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(upcUrl.searchParams.get('upc'), '012345678905')
    assert.equal(upcUrl.searchParams.has('genericOnly'), false)
    const idUrl = new URL(String(fetchMock.mock.calls[1]?.[0]))
    assert.equal(idUrl.searchParams.get('id'), 'fdc:012345678905')
    assert.equal(idUrl.searchParams.has('genericOnly'), false)
    const fallbackUrl = new URL(String(fetchMock.mock.calls[2]?.[0]))
    assert.equal(fallbackUrl.searchParams.get('q'), '012345678905')
    assert.equal(fallbackUrl.searchParams.get('genericOnly'), 'true')
  })

  it('looks up unqualified USDA FDC ids through the prefixed exact id endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      item: {
        id: 'fdc:169757',
        dataOrigin: 'usda_sr_legacy',
        dataOriginId: '169757',
        name: 'Rice, white, long-grain, raw',
        brand: null,
        upc: null,
        offMarket: false,
        label: riceLabel,
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    const result = await searchFoodLabels(
      {
        q: '169757',
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.items[0]?.id, 'fdc:169757')
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('id'), 'fdc:169757')
    assert.equal(requestUrl.searchParams.has('q'), false)
  })

  it('fails explicitly outside hosted assistant runtime', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))

    await expect(
      searchFoodLabels(
        {
          q: 'plain greek yogurt',
        },
        {
          env: {},
          fetchImpl: fetchMock,
        },
      ),
    ).rejects.toMatchObject({
      code: 'food_labels_api_hosted_only',
      message: 'Food label search runs through the hosted Murph data API and is only available inside hosted assistant runtime.',
    })
    assert.equal(fetchMock.mock.calls.length, 0)
  })
})

describe('searchFoodLabelsBatch', () => {
  it('posts multiple hosted food label queries through the internal data API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      results: [
        {
          query: 'plain greek yogurt',
          items: [
            {
              id: 'fdc:2259794',
              dataOrigin: 'usda_branded',
              dataOriginId: '2259794',
              name: 'Plain Greek Yogurt',
              brand: 'Example Dairy',
              upc: '012345678905',
              offMarket: false,
              label: yogurtLabel,
            },
          ],
        },
        {
          query: 'white rice',
          items: [
            {
              id: 'fdc:169757',
              dataOrigin: 'usda_sr_legacy',
              dataOriginId: '169757',
              name: 'Rice, white, long-grain, raw',
              brand: null,
              upc: null,
              offMarket: false,
              label: riceLabel,
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

    const result = await searchFoodLabelsBatch(
      {
        queries: [' plain greek yogurt ', 'white rice'],
        limit: 3,
        includeOffMarket: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result.queries, ['plain greek yogurt', 'white rice'])
    assert.equal(result.source, 'murph-data-api')
    assert.equal(result.limit, 3)
    assert.equal(result.includeOffMarket, true)
    assert.equal(result.results[0]?.items[0]?.id, 'fdc:2259794')
    assert.equal(result.results[1]?.items[0]?.id, 'fdc:169757')

    assert.equal(fetchMock.mock.calls.length, 1)
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.origin, 'http://murph-data-api.worker')
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.search, '')
    const init = fetchMock.mock.calls[0]?.[1]
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      queries: ['plain greek yogurt', 'white rice'],
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

  it('passes generic-only batch searches to the foods API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      results: [
        {
          query: 'chicken breast',
          items: [
            {
              id: 'fdc:331960',
              dataOrigin: 'usda_foundation',
              dataOriginId: '331960',
              name: 'Chicken, breast, skinless, boneless, meat only, cooked, braised',
              brand: null,
              upc: null,
              offMarket: false,
              label: {},
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

    const result = await searchFoodLabelsBatch(
      {
        queries: ['chicken breast'],
        genericOnly: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.genericOnly, true)
    assert.equal(result.results[0]?.items[0]?.dataOrigin, 'usda_foundation')
    const init = fetchMock.mock.calls[0]?.[1]
    assert.deepEqual(JSON.parse(String(init?.body)), {
      queries: ['chicken breast'],
      limit: 5,
      includeOffMarket: false,
      genericOnly: true,
    })
  })

  it('accepts the shared fifty-query batch cap', async () => {
    const queries = Array.from({ length: 50 }, (_value, index) => `food ${index + 1}`)
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { queries: string[] }

      return new Response(JSON.stringify({
        results: body.queries.map((query) => ({
          query,
          items: [],
        })),
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })

    const result = await searchFoodLabelsBatch(
      {
        queries,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.deepEqual(result.queries, queries)
    assert.equal(result.results.length, 50)
    const init = fetchMock.mock.calls[0]?.[1]
    assert.deepEqual(JSON.parse(String(init?.body)), {
      queries,
      limit: 5,
      includeOffMarket: false,
    })
  })

  it('rejects more than fifty batch queries before calling the hosted API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))

    await expect(
      searchFoodLabelsBatch(
        {
          queries: Array.from({ length: 51 }, (_value, index) => `food ${index + 1}`),
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
      searchFoodLabelsBatch(
        {
          queries: ['plain greek yogurt'],
        },
        {
          env: {},
          fetchImpl: fetchMock,
        },
      ),
    ).rejects.toMatchObject({
      code: 'food_labels_api_hosted_only',
      message: 'Food label search runs through the hosted Murph data API and is only available inside hosted assistant runtime.',
    })
    assert.equal(fetchMock.mock.calls.length, 0)
  })
})
