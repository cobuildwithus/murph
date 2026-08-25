import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  foodLabelSearchItemSchema,
  searchFoodLabels,
  searchFoodLabelsBatch,
} from '../src/food-labels.js'

const hostedRuntimeEnv = {
  MURPH_DATA_API_KEY: 'signed-murph-data-api-credential',
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

const yogurtTestSample = {
  evidenceType: 'regulatory_laboratory',
  samplingContext: 'retail_surveillance',
  sourceSampleId: 'sample-79',
  sampleCount: 6,
  reportedUpc: '01234 56789 05',
  lotCode: 'LOT-2024-07',
  bestBy: '2024-08-31',
  packageSize: '170 g',
  collectedOn: '2024-07-01',
  testedOn: '2024-07-08',
  labName: 'Example Laboratory',
  testMethod: 'LC-MS/MS',
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
        upperValue: null,
        qualifier: 'estimated',
        detectionLimit: {
          value: 0.001,
          unit: 'ppm',
        },
        quantificationLimit: {
          value: 0.002,
          unit: 'ppm',
        },
        reportingLimit: null,
        uncertainty: {
          value: 0.0005,
          unit: 'ppm',
        },
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
      screeningPolicy: {
        id: 'adult_one_serving_per_day_v1',
        assumedBodyWeightKg: 70,
        assumedServingsPerDay: 1,
        servingGrams: 170,
        exposure: {
          value: 0.029,
          unit: 'ng/kg_bw/day',
          basis: 'oral_total_dietary_exposure',
        },
        ratio: 0.145,
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
      sample: yogurtTestSample,
    },
  ],
  observationCount: 6,
  observations: ['bpa', 'bps', 'bbp', 'dbp', 'dehp', 'dinp'].map((contaminantKey, index) => ({
    contaminantKey,
    contaminantName: contaminantKey.toUpperCase(),
    result: {
      operator: index === 0 ? 'range' : 'eq',
      value: 12 + index,
      upperValue: index === 0 ? 13 : null,
      qualifier: index === 0 ? 'estimated range' : null,
      detectionLimit: {
        value: 1,
        unit: 'ng/g',
      },
      quantificationLimit: null,
      reportingLimit: null,
      uncertainty: null,
      unit: 'ng/g',
      basis: 'product_mass',
    },
    normalizedResult: {
      value: (12 + index) / 1000,
      upperValue: index === 0 ? 0.013 : null,
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
    sample: yogurtTestSample,
  })),
}

const yogurtContaminantSummary = {
  status: 'known_product_tests',
  murphConcernLevel: 'medium',
  alertCount: 1,
  alertsTruncated: false,
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
        name: 'Example screening level',
      },
      screeningPolicy: {
        id: 'adult_one_serving_per_day_v1',
        assumedBodyWeightKg: 70,
        assumedServingsPerDay: 1,
        servingGrams: 170,
        exposure: {
          value: 0.029,
          unit: 'ng/kg_bw/day',
          basis: 'oral_total_dietary_exposure',
        },
        ratio: 0.145,
      },
      source: {
        name: 'Example Source',
        reportDate: '2024-07-11',
      },
    },
  ],
  observationCount: 6,
  observationsTruncated: true,
  observations: [
    {
      contaminantKey: 'bpa',
      contaminantName: 'Bisphenol A (BPA)',
      result: {
        operator: 'range',
        value: 12,
        upperValue: 13,
        unit: 'ng/g',
        basis: 'product_mass',
      },
      source: {
        name: 'Example Source',
        reportDate: '2024-07-11',
      },
    },
  ],
}

describe('foodLabelSearchItemSchema', () => {
  it('accepts regulatory presence findings without lab-measurement metadata', () => {
    const parsed = foodLabelSearchItemSchema.parse({
      id: 'fdc:2259794',
      dataOrigin: 'usda_branded',
      dataOriginId: '2259794',
      name: 'Example Supplement',
      brand: null,
      upc: null,
      offMarket: false,
      contaminants: {
        status: 'known_product_tests',
        murphConcernLevel: 'unknown',
        alertCount: 0,
        alerts: [],
        observationCount: 1,
        observations: [
          {
            contaminantKey: 'undeclared_drug',
            contaminantName: 'Undeclared active ingredient',
            result: {
              operator: 'detected',
              value: null,
              unit: 'presence',
              basis: 'regulatory_finding',
            },
            normalizedResult: null,
            source: {
              key: 'fda_health_fraud_products',
              name: 'FDA Health Fraud Product Database',
              url: 'https://www.fda.gov/consumers/health-fraud-scams/health-fraud-product-database',
              reportTitle: 'Health Fraud Product Database',
              reportDate: null,
            },
            testedProduct: {
              name: 'Example Supplement',
              brand: null,
              upc: null,
              sourceProductId: 'finding-1',
              matchMethod: 'manual_confirmed',
            },
            sample: {
              evidenceType: 'regulatory_finding',
              samplingContext: 'regulatory_enforcement_table',
              sourceSampleId: null,
              sampleCount: null,
              reportedUpc: null,
              lotCode: null,
              bestBy: null,
              packageSize: null,
              collectedOn: null,
              testedOn: null,
              labName: null,
              testMethod: null,
            },
          },
        ],
      },
    })

    assert.equal(
      parsed.contaminants?.observations[0]?.sample?.evidenceType,
      'regulatory_finding',
    )
  })

  it('keeps legacy contaminant payloads valid when additive test metadata is absent', () => {
    const parsed = foodLabelSearchItemSchema.parse({
      id: 'fdc:2259794',
      dataOrigin: 'usda_branded',
      dataOriginId: '2259794',
      name: 'Plain Greek Yogurt',
      brand: 'Example Dairy',
      upc: '012345678905',
      offMarket: false,
      contaminants: {
        status: 'known_product_tests',
        murphConcernLevel: 'none',
        alertCount: 0,
        alerts: [],
        observationCount: 1,
        observations: [
          {
            contaminantKey: 'lead',
            contaminantName: 'Lead',
            result: {
              operator: 'eq',
              value: 0.01,
              unit: 'ppm',
              basis: 'product_mass',
            },
            normalizedResult: null,
            source: {
              key: 'legacy_source',
              name: 'Legacy Source',
              url: null,
              reportTitle: null,
              reportDate: null,
            },
            testedProduct: {
              name: 'Plain Greek Yogurt',
              brand: 'Example Dairy',
              upc: '012345678905',
              sourceProductId: 'legacy-1',
              matchMethod: 'manual_confirmed',
            },
          },
        ],
      },
    })

    assert.equal(parsed.contaminants?.observations[0]?.sample, undefined)
    assert.equal(parsed.contaminants?.observations[0]?.result.upperValue, undefined)
  })
})

describe('searchFoodLabels', () => {
  it('calls the internal foods API with the hosted provider credential', async () => {
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
          contaminantSummary: yogurtContaminantSummary,
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
          contaminantSummary: yogurtContaminantSummary,
        },
      ],
    })
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.origin, 'http://murph-data-api.worker')
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('q'), 'plain greek yogurt')
    assert.equal(requestUrl.searchParams.get('limit'), '2')
    assert.equal(requestUrl.searchParams.get('includeOffMarket'), 'true')
    assert.equal(requestUrl.searchParams.get('nutritionOnly'), 'true')
    const init = fetchMock.mock.calls[0]?.[1]
    const headers = init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : init?.headers
    assert.equal(
      headers && !Array.isArray(headers)
        ? headers.authorization
        : undefined,
      'Bearer signed-murph-data-api-credential',
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
    assert.equal(requestUrl.searchParams.get('nutritionOnly'), 'true')
  })

  it('requests complete labels only when explicitly selected', async () => {
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
        fullLabel: true,
      },
      {
        env: hostedRuntimeEnv,
        fetchImpl: fetchMock,
      },
    )

    assert.equal(result.limit, 1)
    assert.deepEqual(result.items[0]?.contaminants, yogurtContaminants)
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.searchParams.get('limit'), '1')
    assert.equal(requestUrl.searchParams.has('nutritionOnly'), false)
  })

  it('passes source-qualified USDA FDC ids through the server search policy', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
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
    assert.equal(requestUrl.searchParams.get('q'), 'fdc:169757')
    assert.equal(requestUrl.searchParams.get('genericOnly'), 'true')
    assert.equal(requestUrl.searchParams.has('id'), false)
    assert.equal(requestUrl.searchParams.has('upc'), false)
  })

  it('passes GTIN-shaped searches through the server search policy', async () => {
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
        },
      ],
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
    assert.equal(requestUrl.searchParams.get('q'), '01234-56789-05')
    assert.equal(requestUrl.searchParams.get('genericOnly'), 'true')
    assert.equal(requestUrl.searchParams.has('id'), false)
    assert.equal(requestUrl.searchParams.has('upc'), false)
  })

  it('passes numeric USDA FDC ids through the server search policy', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
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
    }))

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
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    assert.equal(requestUrl.pathname, '/api/foods')
    assert.equal(requestUrl.searchParams.get('q'), '365')
    assert.equal(requestUrl.searchParams.get('genericOnly'), 'true')
    assert.equal(requestUrl.searchParams.has('id'), false)
    assert.equal(requestUrl.searchParams.has('upc'), false)
  })

  it.each([
    {
      code: 'food_labels_api_auth_failed',
      retryable: false,
      status: 401,
    },
    {
      code: 'food_labels_api_auth_failed',
      retryable: false,
      status: 403,
    },
    {
      code: 'food_labels_api_rate_limited',
      retryable: true,
      status: 429,
    },
    {
      code: 'food_labels_api_request_timed_out',
      retryable: true,
      status: 408,
    },
    {
      code: 'food_labels_api_response_failed',
      retryable: false,
      status: 422,
    },
    {
      code: 'food_labels_api_service_unavailable',
      retryable: true,
      status: 503,
    },
  ])(
    'classifies HTTP $status without exposing the provider body',
    async ({ code, retryable, status }) => {
      const providerBody = `private-provider-body-${status}`
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(
        JSON.stringify({ error: providerBody }),
        { status },
      ))

      const error = await searchFoodLabels(
        { q: 'private-food-query' },
        { env: hostedRuntimeEnv, fetchImpl: fetchMock },
      ).catch((cause: unknown) => cause)

      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, code)
      assert.equal(error.context?.failureStage, 'response')
      assert.equal(error.context?.retryable, retryable)
      assert.equal(error.context?.stage, 'response')
      assert.equal(error.context?.status, status)
      assert.match(error.message, new RegExp(`HTTP ${status}`, 'u'))
      assert.equal(error.context?.timedOut, status === 408 ? true : undefined)
      assert.equal('repair' in error, false)
      assert.doesNotMatch(
        JSON.stringify({
          context: error.context,
          message: error.message,
        }),
        /private-provider-body|private-food-query/u,
      )
    },
  )

  it('classifies generic network failures with bounded transport metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new TypeError('private network cause'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      })
    })

    const error = await searchFoodLabels(
      { q: 'private-network-query' },
      { env: hostedRuntimeEnv, fetchImpl: fetchMock },
    ).catch((cause: unknown) => cause)

    assert.ok(error instanceof VaultCliError)
    assert.equal(error.code, 'food_labels_api_request_failed')
    assert.equal(error.context?.failureStage, 'request')
    assert.equal(error.context?.retryable, true)
    assert.equal(error.context?.stage, 'transport')
    assert.equal(error.context?.transportErrorName, 'TypeError')
    assert.equal(error.context?.transportErrorCode, 'UND_ERR_CONNECT_TIMEOUT')
    assert.match(
      error.message,
      /Transport classification: name=TypeError, code=UND_ERR_CONNECT_TIMEOUT/u,
    )
    assert.equal('repair' in error, false)
    assert.doesNotMatch(
      JSON.stringify({ context: error.context, message: error.message }),
      /private network cause|private-network-query/u,
    )
  })

  it('classifies timeouts as retryable without exposing the transport cause', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const error = new Error('private timeout cause')
      error.name = 'TimeoutError'
      throw error
    })

    const error = await searchFoodLabels(
      { q: 'private-timeout-query' },
      { env: hostedRuntimeEnv, fetchImpl: fetchMock },
    ).catch((cause: unknown) => cause)

    assert.ok(error instanceof VaultCliError)
    assert.equal(error.code, 'food_labels_api_request_timed_out')
    assert.equal(error.context?.retryable, true)
    assert.equal(error.context?.stage, 'transport')
    assert.equal(error.context?.timedOut, true)
    assert.equal(error.context?.transportErrorName, 'TimeoutError')
    assert.equal('repair' in error, false)
    assert.doesNotMatch(error.message, /private timeout cause|private-timeout-query/u)
  })

  it('keeps request cancellation terminal with bounded transport metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error('private cancellation cause'), {
        code: 'ABORT_ERR',
        name: 'AbortError',
      })
    })

    const error = await searchFoodLabels(
      { q: 'private-cancelled-query' },
      { env: hostedRuntimeEnv, fetchImpl: fetchMock },
    ).catch((cause: unknown) => cause)

    assert.ok(error instanceof VaultCliError)
    assert.equal(error.code, 'food_labels_api_request_cancelled')
    assert.equal(error.context?.failureStage, 'request')
    assert.equal(error.context?.retryable, false)
    assert.equal(error.context?.stage, 'transport')
    assert.equal(error.context?.timedOut, false)
    assert.equal(error.context?.transportErrorName, 'AbortError')
    assert.equal(error.context?.transportErrorCode, 'ABORT_ERR')
    assert.equal('repair' in error, false)
    assert.match(
      error.message,
      /Transport classification: name=AbortError, code=ABORT_ERR/u,
    )
    assert.doesNotMatch(
      JSON.stringify({ context: error.context, message: error.message }),
      /private cancellation cause|private-cancelled-query/u,
    )
  })

  it('makes response-body transport timeouts retryable without exposing the cause', async () => {
    const response = new Response('{}', { status: 200 })
    const bodyError = Object.assign(new Error('private response body timeout'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    })
    vi.spyOn(response, 'json').mockRejectedValue(bodyError)
    const fetchMock = vi.fn<typeof fetch>(async () => response)

    const error = await searchFoodLabels(
      { q: 'private-response-body-query' },
      { env: hostedRuntimeEnv, fetchImpl: fetchMock },
    ).catch((cause: unknown) => cause)

    assert.ok(error instanceof VaultCliError)
    assert.equal(error.code, 'food_labels_api_response_body_timed_out')
    assert.equal(error.context?.failureStage, 'response_body')
    assert.equal(error.context?.retryable, true)
    assert.equal(error.context?.stage, 'response')
    assert.equal(error.context?.status, 200)
    assert.equal(error.context?.timedOut, true)
    assert.equal(error.context?.transportErrorName, 'AbortError')
    assert.equal(error.context?.transportErrorCode, 'ABORT_ERR')
    assert.equal('repair' in error, false)
    assert.doesNotMatch(
      JSON.stringify({ context: error.context, message: error.message }),
      /private response body timeout|private-response-body-query/u,
    )
  })

  it('keeps malformed JSON terminal and separate from body transport failures', async () => {
    const providerBody = 'private-malformed-json-sentinel'
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      `{${providerBody}`,
      {
        headers: { 'content-type': 'application/json' },
        status: 200,
      },
    ))

    const error = await searchFoodLabels(
      { q: 'private-malformed-json-query' },
      { env: hostedRuntimeEnv, fetchImpl: fetchMock },
    ).catch((cause: unknown) => cause)

    assert.ok(error instanceof VaultCliError)
    assert.equal(error.code, 'food_labels_api_invalid_response')
    assert.equal(error.context?.failureStage, 'response_validation')
    assert.equal(error.context?.retryable, false)
    assert.equal(error.context?.stage, 'response')
    assert.equal(error.context?.validationErrorName, 'SyntaxError')
    assert.match(error.message, /not valid JSON \(HTTP 200\)/u)
    assert.equal('repair' in error, false)
    assert.doesNotMatch(
      JSON.stringify({ context: error.context, message: error.message }),
      /private-malformed-json-sentinel|private-malformed-json-query/u,
    )
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
      context: {
        retryable: false,
        stage: 'configuration',
      },
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
      nutritionOnly: true,
    })
    const headers = init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : init?.headers
    assert.equal(
      headers && !Array.isArray(headers)
        ? headers.authorization
        : undefined,
      'Bearer signed-murph-data-api-credential',
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
      limit: 1,
      includeOffMarket: false,
      genericOnly: true,
      nutritionOnly: true,
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
      limit: 1,
      includeOffMarket: false,
      nutritionOnly: true,
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

  it('shares retryable response-body transport recovery with batch searches', async () => {
    const response = new Response('{}', { status: 200 })
    const bodyError = Object.assign(new TypeError('private batch body failure'), {
      code: 'UND_ERR_SOCKET',
    })
    vi.spyOn(response, 'json').mockRejectedValue(bodyError)
    const fetchMock = vi.fn<typeof fetch>(async () => response)

    const error = await searchFoodLabelsBatch(
      { queries: ['private-batch-query'] },
      { env: hostedRuntimeEnv, fetchImpl: fetchMock },
    ).catch((cause: unknown) => cause)

    assert.ok(error instanceof VaultCliError)
    assert.equal(error.code, 'food_labels_api_response_body_failed')
    assert.equal(error.context?.failureStage, 'response_body')
    assert.equal(error.context?.retryable, true)
    assert.equal(error.context?.stage, 'response')
    assert.equal(error.context?.timedOut, false)
    assert.equal(error.context?.transportErrorName, 'TypeError')
    assert.equal(error.context?.transportErrorCode, 'UND_ERR_SOCKET')
    assert.equal('repair' in error, false)
    assert.doesNotMatch(
      JSON.stringify({ context: error.context, message: error.message }),
      /private batch body failure|private-batch-query/u,
    )
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
