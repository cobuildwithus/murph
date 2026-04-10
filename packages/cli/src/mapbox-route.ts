/**
 * Mapbox route estimation owned by the CLI surface.
 *
 * Privacy posture:
 * - the access token stays in env only
 * - temporary text lookup stays temporary and is not cached by this helper
 * - route geometry is only returned when explicitly requested
 * - elevation, when requested, is approximate and derived from bounded contour samples
 */

import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import {
  DEFAULT_ELEVATION_SAMPLE_SPACING_METERS,
  DEFAULT_MAX_ELEVATION_SAMPLES,
  MAPBOX_DIRECTIONS_API_VERSION,
  MAPBOX_GEOCODING_API_VERSION,
  MAPBOX_SEARCH_BOX_API_VERSION,
  mapboxRouteEstimateInputSchema,
  mapboxRouteEstimateResultSchema,
  type MapboxRouteDependencies,
  type MapboxRouteElevationSummary,
  type MapboxRouteEstimateInput,
  type MapboxRouteEstimateResult,
} from './mapbox-route-contracts.js'
import { readMapboxAccessToken, resolveMapboxTimeoutMs } from './mapbox-route-client.js'
import { normalizeRouteGeometry, requestDirections } from './mapbox-route-directions.js'
import { summarizeRouteElevation } from './mapbox-route-elevation.js'
import { resolveRoutePoints } from './mapbox-route-points.js'

export {
  mapboxRouteEstimateInputSchema,
  mapboxRouteEstimateResultSchema,
  mapboxRouteLocationInputSchema,
  mapboxRouteProfileSchema,
  mapboxRouteProfileValues,
  type MapboxRouteDependencies,
  type MapboxRouteEstimateInput,
  type MapboxRouteEstimateResult,
  type MapboxRouteLocationInput,
  type MapboxRouteProfile,
} from './mapbox-route-contracts.js'

export async function estimateMapboxRoute(
  rawInput: MapboxRouteEstimateInput,
  dependencies: MapboxRouteDependencies = {},
): Promise<MapboxRouteEstimateResult> {
  const input = mapboxRouteEstimateInputSchema.parse(rawInput)
  const env = dependencies.env ?? process.env
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const accessToken = readMapboxAccessToken(env)

  if (!accessToken) {
    throw new Error(
      'Mapbox routing is not configured. Set MAPBOX_ACCESS_TOKEN in the runtime environment before using route estimation.',
    )
  }

  const timeoutMs = resolveMapboxTimeoutMs(env)
  const wantsGeometry = Boolean(input.includeGeometry || input.includeElevation)
  const warnings: string[] = []
  const profile = input.profile ?? 'walking'
  const resolvedPoints = await resolveRoutePoints({
    accessToken,
    country: input.country,
    destination: input.destination,
    fetchImpl,
    language: input.language,
    origin: input.origin,
    profile,
    timeoutMs,
    waypoints: input.waypoints ?? [],
  })
  const directionsRoute = await requestDirections({
    accessToken,
    fetchImpl,
    points: resolvedPoints,
    profile,
    timeoutMs,
    wantsGeometry,
  })

  const geometry = wantsGeometry
    ? normalizeRouteGeometry(directionsRoute.geometry)
    : null
  let elevation: MapboxRouteElevationSummary | null = null

  if (input.includeElevation) {
    if (!geometry) {
      warnings.push('Elevation was requested but the routed geometry was unavailable.')
    } else {
      elevation = await summarizeRouteElevation({
        accessToken,
        fetchImpl,
        geometry,
        maxSamples: input.maxElevationSamples ?? DEFAULT_MAX_ELEVATION_SAMPLES,
        sampleSpacingMeters:
          input.elevationSampleSpacingMeters ??
          DEFAULT_ELEVATION_SAMPLE_SPACING_METERS,
        timeoutMs,
      })

      if (!elevation) {
        warnings.push(
          'Elevation is unavailable for this route. When returned, it is only an approximation based on sampled contour queries.',
        )
      }
    }
  }

  if (input.includeElevation) {
    warnings.push(
      'Elevation is approximate and based on sampled contour queries against Mapbox Terrain rather than a full-resolution trail profile.',
    )
  }

  const result = {
    provider: {
      name: 'mapbox',
      directionsApiVersion: MAPBOX_DIRECTIONS_API_VERSION,
      geocodingApiVersion: MAPBOX_GEOCODING_API_VERSION,
      searchBoxApiVersion: MAPBOX_SEARCH_BOX_API_VERSION,
      elevationSource: input.includeElevation ? 'mapbox-terrain-v2-contour' : 'none',
    },
    profile,
    summary: {
      distanceMeters: roundTo(directionsRoute.distance ?? 0, 1),
      distanceKilometers: roundTo((directionsRoute.distance ?? 0) / 1000, 3),
      durationSeconds: roundTo(directionsRoute.duration ?? 0, 1),
      durationMinutes: roundTo((directionsRoute.duration ?? 0) / 60, 1),
    },
    points: resolvedPoints,
    legs: (directionsRoute.legs ?? []).map((leg, index) => ({
      index,
      distanceMeters: roundTo(leg.distance ?? 0, 1),
      durationSeconds: roundTo(leg.duration ?? 0, 1),
      summary: normalizeNullableString(leg.summary) ?? null,
    })),
    elevation,
    geometry: input.includeGeometry ? geometry : null,
    privacy: {
      tokenSource: 'env',
      persistedByTool: false,
      geocodingStorage: resolvedPoints.some((point) => point.source === 'geocoded-query')
        ? 'temporary'
        : 'not-used',
      geocodedPointCount: resolvedPoints.filter((point) => point.source === 'geocoded-query').length,
      searchBoxStorage: resolvedPoints.some((point) => point.source === 'search-box-query')
        ? 'temporary'
        : 'not-used',
      searchBoxPointCount: resolvedPoints.filter((point) => point.source === 'search-box-query').length,
      geometryIncluded: Boolean(input.includeGeometry && geometry),
    },
    warnings,
  } satisfies MapboxRouteEstimateResult

  return mapboxRouteEstimateResultSchema.parse(result)
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
