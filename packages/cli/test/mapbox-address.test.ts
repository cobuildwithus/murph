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
  featureType?: 'address' | 'secondary_address'
  postalCode: string
  secondaryAddress?: string
  secondaryAddressMatch?: string
  state: string
  streetAddress: string
  streetMatch?: string
}) {
  const [addressNumber = '', ...streetParts] = input.streetAddress.split(' ')
  const streetName = streetParts.join(' ')
  const featureType = input.featureType ?? 'address'

  return {
    type: 'Feature',
    geometry: {
      coordinates: [-84.39, 33.75],
      type: 'Point',
    },
    properties: {
      feature_type: featureType,
      mapbox_id: 'example-provider-id',
      name: featureType === 'secondary_address'
        ? input.secondaryAddress
        : input.streetAddress,
      coordinates: {
        accuracy: 'rooftop',
        latitude: 33.75,
        longitude: -84.39,
      },
      context: {
        address: {
          address_number: addressNumber,
          street_name: streetName,
          name: input.streetAddress,
        },
        ...(input.secondaryAddress
          ? {
              secondary_address: {
                designator: 'Unit',
                identifier: input.secondaryAddress.replace(/^Unit\s+/u, ''),
                name: input.secondaryAddress,
              },
            }
          : {}),
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
        street: input.streetMatch ?? 'matched',
        ...(featureType === 'secondary_address'
          ? {
              secondary_address:
                input.secondaryAddressMatch ?? 'matched',
            }
          : {}),
        postcode: 'inferred',
        place: 'inferred',
        region: 'inferred',
        country: 'inferred',
        confidence: input.confidence ?? 'high',
      },
    },
  }
}

function dependencies(fetchImpl: typeof fetch) {
  return {
    env: {
      MAPBOX_ACCESS_TOKEN: 'test-token',
    },
    fetchImpl,
  }
}

describe('resolveMapboxAddress', () => {
  it('uses one temporary bounded lookup and returns one compact safe US mailing candidate', async () => {
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
      dependencies(fetchImpl),
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

    expect(result.recommendedCandidate).toEqual({
      addressLine1: '42 Example Lane',
      city: 'Sampleton',
      state: 'GA',
      postalCode: '30303',
    })
    expect(result.candidates).toEqual([result.recommendedCandidate])
    expect(JSON.stringify(result)).not.toContain('example-provider-id')
    expect(JSON.stringify(result)).not.toContain('longitude')
    expect(JSON.stringify(result)).not.toContain('latitude')
    expect(JSON.stringify(result)).not.toContain('match_code')
    expect(result.privacy).toEqual({
      tokenSource: 'env',
      persistedByTool: false,
      geocodingStorage: 'temporary',
      candidateCount: 1,
    })
    expect(result.warnings).toEqual([])
  })

  it('does not recommend one strong match while another weaker destination remains', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        features: [
          addressFeature({
            city: 'Sampleton',
            postalCode: '30303',
            state: 'GA',
            streetAddress: '42 Example Lane',
          }),
          addressFeature({
            city: 'Exampleville',
            confidence: 'medium',
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
      dependencies(fetchImpl),
    )

    expect(result.candidates).toHaveLength(2)
    expect(result.recommendedCandidate).toBeNull()
    expect(result.warnings).toEqual([
      'More than one mailing-address candidate was returned.',
    ])
  })

  it('does not auto-fill a plausible or extrapolated secondary address', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        features: [
          addressFeature({
            city: 'Sampleton',
            featureType: 'secondary_address',
            postalCode: '30303',
            secondaryAddress: 'Unit 400',
            secondaryAddressMatch: 'plausible',
            state: 'GA',
            streetAddress: '42 Example Lane',
          }),
        ],
      }),
    )

    const result = await resolveMapboxAddress(
      {
        query: '42 Example Lane Unit 400',
        country: ['US'],
      },
      dependencies(fetchImpl),
    )

    expect(result.candidates).toEqual([
      {
        addressLine1: '42 Example Lane',
        addressLine2: 'Unit 400',
        city: 'Sampleton',
        state: 'GA',
        postalCode: '30303',
      },
    ])
    expect(result.recommendedCandidate).toBeNull()
    expect(result.warnings).toEqual([
      'The mailing-address match was not strong enough to fill automatically.',
    ])
  })

  it('can recommend an exactly matched secondary address', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        features: [
          addressFeature({
            city: 'Sampleton',
            featureType: 'secondary_address',
            postalCode: '30303',
            secondaryAddress: 'Unit 400',
            secondaryAddressMatch: 'matched',
            state: 'GA',
            streetAddress: '42 Example Lane',
          }),
        ],
      }),
    )

    const result = await resolveMapboxAddress(
      {
        query: '42 Example Lane Unit 400',
        country: ['US'],
      },
      dependencies(fetchImpl),
    )

    expect(result.recommendedCandidate).toEqual({
      addressLine1: '42 Example Lane',
      addressLine2: 'Unit 400',
      city: 'Sampleton',
      state: 'GA',
      postalCode: '30303',
    })
  })

  it('does not recommend a complete result whose supplied street components did not match strongly', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        features: [
          addressFeature({
            city: 'Sampleton',
            confidence: 'medium',
            postalCode: '30303',
            state: 'GA',
            streetAddress: '42 Example Lane',
            streetMatch: 'plausible',
          }),
        ],
      }),
    )

    const result = await resolveMapboxAddress(
      {
        query: '42 Example Lane',
        country: ['US'],
      },
      dependencies(fetchImpl),
    )

    expect(result.recommendedCandidate).toBeNull()
    expect(result.warnings).toEqual([
      'The mailing-address match was not strong enough to fill automatically.',
    ])
  })

  it('does not recommend provider output that exceeds the physical-note address limits', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        features: [
          addressFeature({
            city: 'Sampleton',
            postalCode: '30303',
            state: 'GA',
            streetAddress: `42 ${'VeryLongStreetName'.repeat(5)}`,
          }),
        ],
      }),
    )

    const result = await resolveMapboxAddress(
      {
        query: '42 very long street',
        country: ['US'],
      },
      dependencies(fetchImpl),
    )

    expect(result.candidates[0]).toMatchObject({
      addressLine1: null,
      city: 'Sampleton',
      state: 'GA',
      postalCode: '30303',
    })
    expect(result.recommendedCandidate).toBeNull()
    expect(result.warnings).toEqual([
      'The mailing-address match did not include every required US mailing field.',
    ])
  })

  it('reports a bounded failure for a malformed provider response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        features: 'not-an-array',
      }),
    )

    await expect(
      resolveMapboxAddress(
        {
          query: '42 Example Lane',
          country: ['US'],
        },
        dependencies(fetchImpl),
      ),
    ).rejects.toMatchObject({
      code: 'route_mapbox_response_invalid',
      message: 'Mapbox returned an invalid address-resolution response.',
    })
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
