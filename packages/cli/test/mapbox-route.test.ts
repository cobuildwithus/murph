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

  it('uses address geocoding, free-text Search Box, and walking entrance preference together', async () => {
    const requests: URL[] = []
    const directionsCoordinates: string[] = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      const query = url.searchParams.get('q')
      requests.push(url)

      if (url.pathname === '/search/geocode/v6/forward') {
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

        throw new Error(`Unexpected geocoding request: ${url}`)
      }

      if (url.pathname === '/search/searchbox/v1/forward') {
        expect(url.searchParams.get('limit')).toBe('1')
        expect(url.searchParams.get('proximity')).toBe('144.96325,-37.81365')

        if (query === 'St Kilda Beach') {
          return jsonResponse({
            features: [
              {
                geometry: {
                  coordinates: [144.974, -37.867],
                },
                properties: {
                  feature_type: 'poi',
                  name: 'St Kilda Beach',
                  place_formatted: 'Victoria, Australia',
                },
              },
            ],
          })
        }

        throw new Error(`Unexpected Search Box request: ${url}`)
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
      '/search/searchbox/v1/forward',
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
      source: 'search-box-query',
      displayName: 'St Kilda Beach, Victoria, Australia',
      routableLongitude: 144.974,
      routableLatitude: -37.867,
      matchType: 'poi',
    })
    expect(result.geometry).toBeNull()
    expect(result.privacy).toEqual({
      tokenSource: 'env',
      persistedByTool: false,
      geocodingStorage: 'temporary',
      geocodedPointCount: 1,
      searchBoxStorage: 'temporary',
      searchBoxPointCount: 1,
      geometryIncluded: false,
    })
    expect(result.warnings).toEqual([])
  })

  it('propagates the last resolved point as Search Box proximity for later park and trailhead lookups', async () => {
    const requests: Array<{ pathname: string; query: string | null; proximity: string | null }> = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      const query = url.searchParams.get('q')
      requests.push({
        pathname: url.pathname,
        query,
        proximity: url.searchParams.get('proximity'),
      })

      if (url.pathname === '/search/geocode/v6/forward' && query === '123 Example St, Melbourne VIC') {
        return jsonResponse({
          features: [
            {
              properties: {
                feature_type: 'address',
                full_address: '123 Example St, Melbourne VIC 3000, Australia',
                coordinates: {
                  longitude: 144.96305,
                  latitude: -37.81355,
                  routable_points: [
                    {
                      name: 'entrance',
                      longitude: 144.96325,
                      latitude: -37.81365,
                    },
                  ],
                },
              },
            },
          ],
        })
      }

      if (url.pathname === '/search/searchbox/v1/forward' && query === 'Albert Park') {
        expect(url.searchParams.get('proximity')).toBe('144.96325,-37.81365')

        return jsonResponse({
          features: [
            {
              geometry: {
                coordinates: [144.984, -37.846],
              },
              properties: {
                feature_type: 'poi',
                name: 'Albert Park',
                place_formatted: 'Victoria, Australia',
                coordinates: {
                  routable_points: [
                    {
                      name: 'park-entry',
                      longitude: 144.9844,
                      latitude: -37.8457,
                    },
                  ],
                },
              },
            },
          ],
        })
      }

      if (
        url.pathname === '/search/searchbox/v1/forward' &&
        query === 'Mountain Creek Trailhead'
      ) {
        expect(url.searchParams.get('proximity')).toBe('144.9844,-37.8457')

        return jsonResponse({
          features: [
            {
              geometry: {
                coordinates: [144.991, -37.851],
              },
              properties: {
                feature_type: 'poi',
                name: 'Mountain Creek Trailhead',
                place_formatted: 'Victoria, Australia',
                coordinates: {
                  routable_points: [
                    {
                      name: 'trail-parking',
                      longitude: 144.9913,
                      latitude: -37.8508,
                    },
                  ],
                },
              },
            },
          ],
        })
      }

      if (
        url.pathname ===
        '/directions/v5/mapbox/walking/144.96325,-37.81365;144.9844,-37.8457;144.9913,-37.8508'
      ) {
        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 6100,
              duration: 4800,
              legs: [
                {
                  distance: 4100,
                  duration: 3000,
                  summary: 'Origin to park',
                },
                {
                  distance: 2000,
                  duration: 1800,
                  summary: 'Park to trailhead',
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
      waypoints: ['Albert Park'],
      destination: 'Mountain Creek Trailhead',
      profile: 'walking',
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(requests).toEqual([
      {
        pathname: '/search/geocode/v6/forward',
        query: '123 Example St, Melbourne VIC',
        proximity: null,
      },
      {
        pathname: '/search/searchbox/v1/forward',
        query: 'Albert Park',
        proximity: '144.96325,-37.81365',
      },
      {
        pathname: '/search/searchbox/v1/forward',
        query: 'Mountain Creek Trailhead',
        proximity: '144.9844,-37.8457',
      },
      {
        pathname: '/directions/v5/mapbox/walking/144.96325,-37.81365;144.9844,-37.8457;144.9913,-37.8508',
        query: null,
        proximity: null,
      },
    ])
    expect(result.points).toMatchObject([
      {
        role: 'origin',
        source: 'geocoded-query',
        routableLongitude: 144.96325,
        routableLatitude: -37.81365,
      },
      {
        role: 'waypoint',
        source: 'search-box-query',
        displayName: 'Albert Park, Victoria, Australia',
        routableLongitude: 144.9844,
        routableLatitude: -37.8457,
        matchType: 'poi',
      },
      {
        role: 'destination',
        source: 'search-box-query',
        displayName: 'Mountain Creek Trailhead, Victoria, Australia',
        routableLongitude: 144.9913,
        routableLatitude: -37.8508,
        matchType: 'poi',
      },
    ])
    expect(result.privacy).toMatchObject({
      geocodedPointCount: 1,
      searchBoxPointCount: 2,
    })
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

  it('uses coordinate inputs as Search Box proximity for the next resolved text point', async () => {
    const requests: Array<{ pathname: string; query: string | null; proximity: string | null }> = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      requests.push({
        pathname: url.pathname,
        query: url.searchParams.get('q'),
        proximity: url.searchParams.get('proximity'),
      })

      if (url.pathname === '/search/searchbox/v1/forward' && url.searchParams.get('q') === 'Bogong Hut') {
        expect(url.searchParams.get('proximity')).toBe('144.9631,-37.8136')

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

      if (url.pathname.startsWith('/directions/v5/mapbox/cycling/')) {
        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 5400,
              duration: 4200,
              legs: [
                {
                  distance: 5400,
                  duration: 4200,
                  summary: 'Coordinate to POI route',
                },
              ],
            },
          ],
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await estimateMapboxRoute({
      origin: {
        longitude: 144.9631,
        latitude: -37.8136,
        name: 'Home',
      },
      destination: 'Bogong Hut',
      profile: 'cycling',
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(requests).toEqual([
      {
        pathname: '/search/searchbox/v1/forward',
        query: 'Bogong Hut',
        proximity: '144.9631,-37.8136',
      },
      {
        pathname: '/directions/v5/mapbox/cycling/144.9631,-37.8136;146.8722,-36.8398',
        query: null,
        proximity: null,
      },
    ])
    expect(result.points).toMatchObject([
      {
        source: 'coordinates',
        displayName: 'Home',
      },
      {
        source: 'search-box-query',
        displayName: 'Bogong Hut, Alpine National Park, Victoria, Australia',
        routableLongitude: 146.8722,
        routableLatitude: -36.8398,
        matchType: 'poi',
        routablePointName: 'approach-track',
      },
    ])
    expect(result.privacy).toMatchObject({
      geocodingStorage: 'not-used',
      geocodedPointCount: 0,
      searchBoxStorage: 'temporary',
      searchBoxPointCount: 1,
    })
  })

  it('treats numeric-named POIs as free-text Search Box queries instead of addresses', async () => {
    const requests: URL[] = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      requests.push(url)

      if (url.pathname === '/search/geocode/v6/forward') {
        throw new Error(`Geocoding should not run for numeric POI names: ${url}`)
      }

      if (url.pathname === '/search/searchbox/v1/forward' && url.searchParams.get('q') === '12 Apostles') {
        expect(url.searchParams.get('proximity')).toBe('144.9631,-37.8136')

        return jsonResponse({
          features: [
            {
              geometry: {
                coordinates: [143.105, -38.665],
              },
              properties: {
                feature_type: 'poi',
                name: '12 Apostles',
                place_formatted: 'Victoria, Australia',
              },
            },
          ],
        })
      }

      if (url.pathname.startsWith('/directions/v5/mapbox/driving/')) {
        return jsonResponse({
          code: 'Ok',
          routes: [
            {
              distance: 265000,
              duration: 12400,
              legs: [
                {
                  distance: 265000,
                  duration: 12400,
                  summary: 'Numeric POI route',
                },
              ],
            },
          ],
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await estimateMapboxRoute({
      origin: '144.9631,-37.8136',
      destination: '12 Apostles',
      profile: 'driving',
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(requests.map((request) => request.pathname)).toEqual([
      '/search/searchbox/v1/forward',
      '/directions/v5/mapbox/driving/144.9631,-37.8136;143.105,-38.665',
    ])
    expect(result.points[1]).toMatchObject({
      source: 'search-box-query',
      displayName: '12 Apostles, Victoria, Australia',
      matchType: 'poi',
    })
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

  it('uses Search Box for free-text POI queries even outside the walking profile', async () => {
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

      if (url.pathname.startsWith('/directions/v5/mapbox/cycling/')) {
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
      profile: 'cycling',
      includeGeometry: true,
    }, {
      env: {
        MAPBOX_ACCESS_TOKEN: 'test-token',
      },
      fetchImpl,
    })

    expect(requests.map((request) => request.pathname)).toEqual([
      '/search/searchbox/v1/forward',
      '/directions/v5/mapbox/cycling/146.8722,-36.8398;146.88,-36.845',
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

  it('falls back from Search Box to geocoding for unresolved free-text queries', async () => {
    const requests: Array<{ pathname: string; query: string | null; proximity: string | null }> = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      const query = url.searchParams.get('q')
      requests.push({
        pathname: url.pathname,
        query,
        proximity: url.searchParams.get('proximity'),
      })

      if (url.pathname === '/search/searchbox/v1/forward') {
        if (query === 'Foothill Base') {
          expect(url.searchParams.get('proximity')).toBeNull()
        }

        if (query === 'Alpine Village') {
          expect(url.searchParams.get('proximity')).toBe('144.951,-37.821')
        }

        return jsonResponse({
          features: [],
        })
      }

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

    expect(requests).toEqual([
      {
        pathname: '/search/searchbox/v1/forward',
        query: 'Foothill Base',
        proximity: null,
      },
      {
        pathname: '/search/geocode/v6/forward',
        query: 'Foothill Base',
        proximity: null,
      },
      {
        pathname: '/search/searchbox/v1/forward',
        query: 'Alpine Village',
        proximity: '144.951,-37.821',
      },
      {
        pathname: '/search/geocode/v6/forward',
        query: 'Alpine Village',
        proximity: null,
      },
      {
        pathname: '/directions/v5/mapbox/walking/144.951,-37.821;144.98,-37.84',
        query: null,
        proximity: null,
      },
    ])
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

  it('falls back from address geocoding to Search Box before surfacing a clean miss', async () => {
    const requests: Array<{ pathname: string; query: string | null }> = []

    const fetchImpl: typeof fetch = async (input) => {
      const url = toUrl(input)
      requests.push({
        pathname: url.pathname,
        query: url.searchParams.get('q'),
      })

      if (
        url.pathname === '/search/geocode/v6/forward' ||
        url.pathname === '/search/searchbox/v1/forward'
      ) {
        return jsonResponse({
          features: [],
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    await expect(
      estimateMapboxRoute({
        origin: '404 Missing Road',
        destination: '144.978,-37.864',
      }, {
        env: {
          MAPBOX_ACCESS_TOKEN: 'test-token',
        },
        fetchImpl,
      }),
    ).rejects.toThrow('Mapbox could not geocode the origin.')

    expect(requests).toEqual([
      {
        pathname: '/search/geocode/v6/forward',
        query: '404 Missing Road',
      },
      {
        pathname: '/search/searchbox/v1/forward',
        query: '404 Missing Road',
      },
    ])
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
