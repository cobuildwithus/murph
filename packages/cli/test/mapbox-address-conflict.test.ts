import { expect, it, vi } from 'vitest'

import { resolveMapboxAddress } from '../src/mapbox-address.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
  })
}

it('does not replace a supplied conflicting locality component automatically', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse({
      features: [
        {
          properties: {
            feature_type: 'address',
            full_address:
              '42 Example Lane, Correct City, GA 30303, United States',
            name: '42 Example Lane',
            coordinates: {
              accuracy: 'rooftop',
            },
            context: {
              address: {
                address_number: '42',
                street_name: 'Example Lane',
                name: '42 Example Lane',
              },
              postcode: {
                name: '30303',
              },
              place: {
                name: 'Correct City',
              },
              region: {
                name: 'Georgia',
                region_code: 'GA',
              },
              country: {
                name: 'United States',
                country_code: 'US',
              },
            },
            match_code: {
              address_number: 'matched',
              street: 'matched',
              postcode: 'matched',
              place: 'unmatched',
              region: 'matched',
              country: 'matched',
              confidence: 'high',
            },
          },
        },
      ],
    }),
  )

  const result = await resolveMapboxAddress(
    {
      query: '42 Example Lane, Wrong City, GA 30303',
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
    match: {
      place: 'unmatched',
    },
  })
  expect(result.recommendedCandidate).toBeNull()
  expect(result.warnings).toEqual([
    'The mailing-address match was not strong enough to fill automatically.',
  ])
})
