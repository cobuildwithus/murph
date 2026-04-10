import { describe, expect, it } from 'vitest'

import { estimateMapboxRoute } from '../src/mapbox-route.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function toUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input
  }

  if (typeof input === 'string') {
    return new URL(input)
  }

  return new URL(input.url)
}

describe('estimateMapboxRoute', () => {
  it('requires a configured Mapbox token', async () => {
    await expect(
      estimateMapboxRoute({
        origin: '123 Example St, Melbourne VIC',
        destination: 'St Kilda Beach',
      }, {
        env: {},
      }),
    ).rejects.toThrow(
      'Set MAPBOX_ACCESS_TOKEN in the runtime environment before using route estimation.',
    )
  })

  it('uses temporary geocoding and prefers entrances for walking queries', async () => {
    const requests: URL[] = []
    const directionsCoordinates: string[] = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      requests.push(url)

      if (url.pathname === '/search/geocode/v6/forward') {
        const query = url.searchParams.get('q')

        expect(url.searchParams.get('limit')).toBe('1')
        expect(url.searchParams.get('autocomplete')).toBe('false')
        expect(url.searchParams.get('permanent')).toBe('false')
        expect(url.searchParams.get('entrances')).toBe('true')

        if (query === '123 Example St, Melbourne VIC') {
          return jsonResponse({
            features: [
              {
                properties: {
                  feature_type: 'address',
                  full_address: '123 Example St, Melbourne VIC 3000, Australia',
                  coordinates: {
                    longitude: 144.96305,
                    latitude: -37.81355,
                    accuracy: 'rooftop',
                    routable_points: [
                      {
                        name: 'entrance',
                        longitude: 144.96325,
                        latitude: -37.81365,
                      },
                      {
                        name: 'default',
                        longitude: 144.9632,
                        latitude: -37.8136,
                      },
                    ],
                  },
                },
              },
            ],
          })
        }

        if (query === 'St Kilda Beach') {
          return jsonResponse({
            features: [
              {
                properties: {
                  feature_type: 'place',
                  full_address: 'St Kilda Beach, Victoria, Australia',
                  coordinates: {
                    longitude: 144.974,
                    latitude: -37.867,
                  },
                },
              },
            ],
          })
        }
      }

      if (url.pathname.startsWith('/directions/v5/mapbox/walking/')) {
        directionsCoordinates.push(
          url.pathname.replace('/directions/v5/mapbox/walking/', ''),
        )

        expect(url.searchParams.get('overview')).toBe('false')
        expect(url.searchParams.get('geometries')).toBeNull()

        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 6200.5,
              duration: 2340.2,
              legs: [
                {
                  distance: 6200.5,
                  duration: 2340.2,
                  summary: 'Example route',
                },
              ],
            },
          ],
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await estimateMapboxRoute({
      origin: '123 Example St, Melbourne VIC',
      destination: 'St Kilda Beach',
      profile: 'walking',
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(requests.map((request) => request.pathname)).toEqual([
      '/search/geocode/v6/forward',
      '/search/geocode/v6/forward',
      '/directions/v5/mapbox/walking/144.96325,-37.81365;144.974,-37.867',
    ])
    expect(directionsCoordinates).toEqual([
      '144.96325,-37.81365;144.974,-37.867',
    ])
    expect(result.summary.distanceMeters).toBe(6200.5)
    expect(result.summary.durationMinutes).toBe(39)
    expect(result.points[0]).toMatchObject({
      source: 'geocoded-query',
      displayName: '123 Example St, Melbourne VIC 3000, Australia',
      routableLongitude: 144.96325,
      routableLatitude: -37.81365,
      accuracy: 'rooftop',
      matchType: 'address',
      routablePointName: 'entrance',
    })
    expect(result.points[1]).toMatchObject({
      source: 'geocoded-query',
      displayName: 'St Kilda Beach, Victoria, Australia',
      routableLongitude: 144.974,
      routableLatitude: -37.867,
      matchType: 'place',
    })
    expect(result.geometry).toBeNull()
    expect(result.privacy).toEqual({
      tokenSource: 'env',
      persistedByTool: false,
      geocodingStorage: 'temporary',
      geocodedPointCount: 2,
      searchBoxStorage: 'not-used',
      searchBoxPointCount: 0,
      geometryIncluded: false,
    })
    expect(result.warnings).toEqual([])
  })

  it('skips geocoding for coordinate inputs and coordinate literals', async () => {
    const requests: URL[] = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      requests.push(url)

      expect(url.pathname).toBe(
        '/directions/v5/mapbox/cycling/144.9631,-37.8136;144.978,-37.864',
      )
      expect(url.searchParams.get('overview')).toBe('false')

      return jsonResponse({
        code: 'Ok',
        routes: [
          {
            distance: 8100,
            duration: 1100,
            legs: [
              {
                distance: 8100,
                duration: 1100,
                summary: 'Coordinate route',
              },
            ],
          },
        ],
      })
    }

    const result = await estimateMapboxRoute({
      origin: {
        longitude: 144.9631,
        latitude: -37.8136,
        name: 'Home',
      },
      destination: '144.978,-37.864',
      profile: 'cycling',
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(requests).toHaveLength(1)
    expect(result.points).toMatchObject([
      {
        source: 'coordinates',
        displayName: 'Home',
      },
      {
        source: 'coordinate-literal',
        displayName: '144.978000, -37.864000',
      },
    ])
    expect(result.privacy.geocodingStorage).toBe('not-used')
    expect(result.privacy.geocodedPointCount).toBe(0)
    expect(result.privacy.searchBoxStorage).toBe('not-used')
    expect(result.privacy.searchBoxPointCount).toBe(0)
  })

  it('summarizes approximate elevation from the highest returned terrain contour queries', async () => {
    let elevationCallCount = 0

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)

      if (url.pathname.startsWith('/directions/v5/mapbox/walking/')) {
        expect(url.searchParams.get('overview')).toBe('full')
        expect(url.searchParams.get('geometries')).toBe('geojson')

        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 2222,
              duration: 1800,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [0.01, 0],
                  [0.02, 0],
                ],
              },
            },
          ],
        })
      }

      if (url.pathname.startsWith('/v4/mapbox.mapbox-terrain-v2/tilequery/')) {
        elevationCallCount += 1
        expect(url.searchParams.get('limit')).toBe('50')
        const elevations = [
          [90, 100, '95'],
          [80, 120, '115'],
          [70, 110, '105'],
        ]
        return jsonResponse({
          features: elevations[elevationCallCount - 1]!.map((elevation) => ({
            properties: {
              ele: elevation,
            },
          })),
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await estimateMapboxRoute({
      origin: '0,0',
      destination: '0.02,0',
      includeElevation: true,
      elevationSampleSpacingMeters: 2000,
      maxElevationSamples: 3,
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(elevationCallCount).toBe(3)
    expect(result.geometry).toBeNull()
    expect(result.provider.elevationSource).toBe('mapbox-terrain-v2-contour')
    expect(result.elevation).toMatchObject({
      approximate: true,
      source: 'mapbox-terrain-v2-contour',
      sampleCount: 3,
      resolvedSampleCount: 3,
      gainMeters: 20,
      lossMeters: 10,
      netChangeMeters: 10,
      minimumMeters: 100,
      maximumMeters: 120,
      startMeters: 100,
      endMeters: 110,
      queryRadiusMeters: 50,
    })
    expect(result.warnings).toEqual([
      'Elevation is approximate and based on sampled contour queries against Mapbox Terrain rather than a full-resolution trail profile.',
    ])
  })

  it('warns when elevation sampling cannot resolve enough contour points', async () => {
    let elevationCallCount = 0

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)

      if (url.pathname.startsWith('/directions/v5/mapbox/walking/')) {
        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 1800,
              duration: 1200,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [0.01, 0],
                ],
              },
            },
          ],
        })
      }

      if (url.pathname.startsWith('/v4/mapbox.mapbox-terrain-v2/tilequery/')) {
        elevationCallCount += 1
        return jsonResponse({
          message: 'No nearby contour data',
        }, 404)
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await estimateMapboxRoute({
      origin: '0,0',
      destination: '0.01,0',
      includeElevation: true,
      maxElevationSamples: 2,
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(elevationCallCount).toBe(2)
    expect(result.elevation).toBeNull()
    expect(result.warnings).toEqual([
      'Elevation is unavailable for this route. When returned, it is only an approximation based on sampled contour queries.',
      'Elevation is approximate and based on sampled contour queries against Mapbox Terrain rather than a full-resolution trail profile.',
    ])
  })

  it('uses Search Box for walking POI-like queries and keeps the lookup temporary', async () => {
    const requests: URL[] = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      requests.push(url)
      const query = url.searchParams.get('q')

      if (url.pathname === '/search/searchbox/v1/forward' && query === 'Bogong Hut') {
        return jsonResponse({
          features: [
            {
              geometry: {
                coordinates: [146.872, -36.84],
              },
              properties: {
                feature_type: 'poi',
                name: 'Bogong Hut',
                place_formatted: 'Alpine National Park, Victoria, Australia',
                coordinates: {
                  routable_points: [
                    {
                      name: 'approach-track',
                      longitude: 146.8722,
                      latitude: -36.8398,
                    },
                  ],
                },
              },
            },
          ],
        })
      }

      if (url.pathname.startsWith('/directions/v5/mapbox/walking/')) {
        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 5400,
              duration: 4200,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [146.8722, -36.8398],
                  [146.88, -36.845],
                ],
              },
            },
          ],
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await estimateMapboxRoute({
      origin: 'Bogong Hut',
      destination: '146.88,-36.845',
      includeGeometry: true,
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(requests.map((request) => request.pathname)).toEqual([
      '/search/searchbox/v1/forward',
      '/directions/v5/mapbox/walking/146.8722,-36.8398;146.88,-36.845',
    ])
    expect(result.provider.searchBoxApiVersion).toBe('v1')
    expect(result.points[0]).toMatchObject({
      source: 'search-box-query',
      displayName: 'Bogong Hut, Alpine National Park, Victoria, Australia',
      longitude: 146.872,
      latitude: -36.84,
      routableLongitude: 146.8722,
      routableLatitude: -36.8398,
      matchType: 'poi',
      routablePointName: 'approach-track',
    })
    expect(result.privacy).toMatchObject({
      geocodingStorage: 'not-used',
      geocodedPointCount: 0,
      searchBoxStorage: 'temporary',
      searchBoxPointCount: 1,
      geometryIncluded: true,
    })
  })

  it('falls back to geometry coordinates, composite names, and the first routable point when geocoding metadata is sparse', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      const query = url.searchParams.get('q')

      if (url.pathname === '/search/geocode/v6/forward' && query === 'Foothill Base') {
        return jsonResponse({
          features: [
            {
              geometry: {
                coordinates: [144.95, -37.82],
              },
              properties: {
                name_preferred: 'Foothill Base',
                place_formatted: 'Victoria, Australia',
                coordinates: {
                  routable_points: [
                    {
                      name: 'approach-road',
                      longitude: 144.951,
                      latitude: -37.821,
                    },
                  ],
                },
              },
            },
          ],
        })
      }

      if (url.pathname === '/search/geocode/v6/forward' && query === 'Alpine Village') {
        return jsonResponse({
          features: [
            {
              properties: {
                full_address: 'Alpine Village, Victoria, Australia',
                coordinates: {
                  longitude: 144.98,
                  latitude: -37.84,
                },
              },
            },
          ],
        })
      }

      if (url.pathname.startsWith('/directions/v5/mapbox/walking/')) {
        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 5400,
              duration: 4200,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [144.951, -37.821],
                  [144.98, -37.84],
                ],
              },
            },
          ],
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await estimateMapboxRoute({
      origin: 'Foothill Base',
      destination: 'Alpine Village',
      includeGeometry: true,
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(result.points[0]).toMatchObject({
      displayName: 'Foothill Base, Victoria, Australia',
      longitude: 144.95,
      latitude: -37.82,
      routableLongitude: 144.951,
      routableLatitude: -37.821,
      routablePointName: 'approach-road',
    })
    expect(result.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [144.951, -37.821],
        [144.98, -37.84],
      ],
    })
    expect(result.privacy.geometryIncluded).toBe(true)
  })

  it('surfaces a clean no-result geocoding failure when temporary fallback also misses', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)

      if (url.pathname === '/search/geocode/v6/forward') {
        return jsonResponse({
          features: [],
        })
      }

      if (url.pathname === '/search/searchbox/v1/forward') {
        throw new Error(`Search Box should not be called for non-POI geocode misses: ${url}`)
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    await expect(
      estimateMapboxRoute({
        origin: 'Unknown address',
        destination: 'St Kilda Beach',
      }, {
        env: {
          MAPBOX_ACCESS_TOKEN: 'test-token',
        },
        fetchImpl,
      }),
    ).rejects.toThrow('Mapbox could not geocode the origin.')
  })

  it('surfaces a clean no-route failure when Mapbox returns no directions', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)

      if (url.pathname === '/directions/v5/mapbox/walking/144.9631,-37.8136;144.978,-37.864') {
        return jsonResponse({
          code: 'Ok',
          routes: [],
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    await expect(
      estimateMapboxRoute({
        origin: '144.9631,-37.8136',
        destination: '144.978,-37.864',
      }, {
        env: {
          MAPBOX_ACCESS_TOKEN: 'test-token',
        },
        fetchImpl,
      }),
    ).rejects.toThrow('Mapbox did not return a route for these points.')
  })
})
