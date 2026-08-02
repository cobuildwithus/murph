import { describe, expect, it, vi } from 'vitest'

import { resolveMapboxAddress } from '../src/mapbox-address.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  })
}

function addressFeature(input: {
  city: string
  confidence?: string
  postalCode: string
  state: string
  streetAddress: string
}) {
  const [addressNumber = '', ...streetParts] = input.streetAddress.split(' ')
  const streetName = streetParts.join(' ')

  return {
    type: 'Feature',
    properties: {
      feature_type: 'address',
      full_address: `${input.streetAddress}, ${input.city}, ${input.state} ${input.postalCode}, United States`,
      name: input.streetAddress,
      coordinates: {
        accuracy: 'rooftop',
      },
      context: {
        address: {
          address_number: addressNumber,
          street_name: streetName,
          name: input.streetAddress,
        },
        postcode: {
          name: input.postalCode,
        },
        place: {
          name: input.city,
        },
        region: {
          name: 'Example State',
          region_code: input.state,
        },
        country: {
          name: 'United States',
          country_code: 'US',
        },
      },
      match_code: {
        address_number: 'matched',
        street: 'matched',
        postcode: 'inferred',
        place: 'inferred',
        region: 'inferred',
        country: 'inferred',
        confidence: input.confidence ?? 'high',
      },
    },
  }
}

describe('resolveMapboxAddress', () => {
  it('uses one temporary bounded lookup and returns a unique safe US mailing candidate', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        type: 'FeatureCollection',
        features: [
          addressFeature({
            city: 'Sampleton',
            postalCode: '30303',
            state: 'GA',
            streetAddress: '42 Example Lane',
          }),
        ],
      }),
    )

    const result = await resolveMapboxAddress(
      {
        query: '42 Example Lane',
        country: ['US'],
      },
      {
        env: {
          MAPBOX_ACCESS_TOKEN: 'test-token',
        },
        fetchImpl,
      },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const requestUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(requestUrl.pathname).toBe('/search/geocode/v6/forward')
    expect(requestUrl.searchParams.get('q')).toBe('42 Example Lane')
    expect(requestUrl.searchParams.get('country')).toBe('us')
    expect(requestUrl.searchParams.get('types')).toBe(
      'address,secondary_address',
    )
    expect(requestUrl.searchParams.get('limit')).toBe('3')
    expect(requestUrl.searchParams.get('autocomplete')).toBe('false')
    expect(requestUrl.searchParams.get('permanent')).toBe('false')
    expect(requestUrl.searchParams.get('access_token')).toBe('test-token')

    expect(result.recommendedCandidate).toMatchObject({
      addressLine1: '42 Example Lane',
      addressLine2: null,
      city: 'Sampleton',
      state: 'GA',
      postalCode: '30303',
      countryCode: 'US',
      completeForUsMail: true,
      safeToAutofill: true,
      match: {
        confidence: 'high',
        addressNumber: 'matched',
        street: 'matched',
      },
    })
    expect(result.privacy).toEqual({
      tokenSource: 'env',
      persistedByTool: false,
      geocodingStorage: 'temporary',
      candidateCount: 1,
    })
    expect(result.warnings).toEqual([])
  })

  it('does not recommend an address when more than one strong match remains', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        type: 'FeatureCollection',
        features: [
          addressFeature({
            city: 'Sampleton',
            postalCode: '30303',
            state: 'GA',
            streetAddress: '42 Example Lane',
          }),
          addressFeature({
            city: 'Exampleville',
            postalCode: '10001',
            state: 'NY',
            streetAddress: '42 Example Lane',
          }),
        ],
      }),
    )

    const result = await resolveMapboxAddress(
      {
        query: '42 Example Lane',
        country: ['US'],
      },
      {
        env: {
          MAPBOX_ACCESS_TOKEN: 'test-token',
        },
        fetchImpl,
      },
    )

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every((candidate) => candidate.safeToAutofill)).toBe(
      true,
    )
    expect(result.recommendedCandidate).toBeNull()
    expect(result.warnings).toEqual([
      'More than one strong mailing-address match was returned.',
    ])
  })

  it('does not recommend a complete result whose supplied street components did not match strongly', async () => {
    const feature = addressFeature({
      city: 'Sampleton',
      confidence: 'medium',
      postalCode: '30303',
      state: 'GA',
      streetAddress: '42 Example Lane',
    })
    feature.properties.match_code.street = 'plausible'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        type: 'FeatureCollection',
        features: [feature],
      }),
    )

    const result = await resolveMapboxAddress(
      {
        query: '42 Example Lane',
        country: ['US'],
      },
      {
        env: {
          MAPBOX_ACCESS_TOKEN: 'test-token',
        },
        fetchImpl,
      },
    )

    expect(result.candidates[0]).toMatchObject({
      completeForUsMail: true,
      safeToAutofill: false,
    })
    expect(result.recommendedCandidate).toBeNull()
    expect(result.warnings).toEqual([
      'No unique strong mailing-address match was returned.',
    ])
  })

  it('fails closed when the shared Mapbox runtime token is unavailable', async () => {
    await expect(
      resolveMapboxAddress(
        {
          query: '42 Example Lane',
          country: ['US'],
        },
        {
          env: {},
          fetchImpl: vi.fn<typeof fetch>(),
        },
      ),
    ).rejects.toMatchObject({
      code: 'route_mapbox_token_missing',
    })
  })
})
