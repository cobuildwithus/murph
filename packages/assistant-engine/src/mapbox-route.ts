/**
 * Shared Mapbox route estimation helper used by the CLI surface.
 *
 * Privacy posture:
 * - the access token stays in env only
 * - forward geocoding stays temporary and is not cached by this helper
 * - route geometry is only returned when explicitly requested
 * - elevation, when requested, is approximate and derived from bounded contour samples
 */

import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { z } from 'zod'

const MAPBOX_DIRECTIONS_API_VERSION = 'v5'
const MAPBOX_GEOCODING_API_VERSION = 'v6'
const DEFAULT_MAPBOX_TIMEOUT_MS = 10_000
const MAX_MAPBOX_TIMEOUT_MS = 30_000
const DEFAULT_ELEVATION_QUERY_RADIUS_METERS = 50
const DEFAULT_ELEVATION_SAMPLE_SPACING_METERS = 500
const DEFAULT_MAX_ELEVATION_SAMPLES = 16
const MAX_ELEVATION_SAMPLES = 24
const MAX_ROUTE_COORDINATES = 25
const MAX_ROUTE_WAYPOINTS = MAX_ROUTE_COORDINATES - 2
const coordinateLiteralPattern =
  /^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*$/u

export const mapboxRouteProfileValues = [
  'walking',
  'cycling',
  'driving',
  'driving-traffic',
] as const

export const mapboxRouteProfileSchema = z.enum(mapboxRouteProfileValues)

const longitudeSchema = z.number().gte(-180).lte(180)
const latitudeSchema = z.number().gte(-90).lte(90)
const coordinateTupleSchema = z.tuple([longitudeSchema, latitudeSchema])
const coordinatePointSchema = z.object({
  longitude: longitudeSchema,
  latitude: latitudeSchema,
  name: z.string().min(1).optional(),
})
const pointRoleSchema = z.enum(['origin', 'waypoint', 'destination'])
const pointSourceSchema = z.enum([
  'coordinates',
  'coordinate-literal',
  'geocoded-query',
])
const elevationSourceSchema = z.enum(['none', 'mapbox-terrain-v2-contour'])

export const mapboxRouteLocationInputSchema = z.union([
  z.string().min(1),
  coordinatePointSchema,
])

export const mapboxRouteEstimateInputSchema = z.object({
  origin: mapboxRouteLocationInputSchema,
  destination: mapboxRouteLocationInputSchema,
  waypoints: z.array(mapboxRouteLocationInputSchema).max(MAX_ROUTE_WAYPOINTS).optional(),
  profile: mapboxRouteProfileSchema.optional(),
  includeGeometry: z.boolean().optional(),
  includeElevation: z.boolean().optional(),
  country: z
    .array(z.string().regex(/^[A-Za-z]{2}$/u))
    .max(10)
    .optional(),
  language: z.string().min(1).max(10).optional(),
  elevationSampleSpacingMeters: z.number().positive().max(10_000).optional(),
  maxElevationSamples: z.number().int().positive().max(MAX_ELEVATION_SAMPLES).optional(),
})

const routeGeometrySchema = z
  .object({
    type: z.literal('LineString'),
    coordinates: z.array(coordinateTupleSchema).min(2),
  })
  .strict()

const resolvedPointSchema = z
  .object({
    role: pointRoleSchema,
    source: pointSourceSchema,
    displayName: z.string().min(1),
    longitude: longitudeSchema,
    latitude: latitudeSchema,
    routableLongitude: longitudeSchema,
    routableLatitude: latitudeSchema,
    accuracy: z.string().min(1).nullable(),
    matchType: z.string().min(1).nullable(),
    routablePointName: z.string().min(1).nullable(),
  })
  .strict()

const routeLegSchema = z
  .object({
    index: z.number().int().nonnegative(),
    distanceMeters: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    summary: z.string().min(1).nullable(),
  })
  .strict()

const elevationSummarySchema = z
  .object({
    approximate: z.literal(true),
    source: z.literal('mapbox-terrain-v2-contour'),
    sampleCount: z.number().int().positive(),
    resolvedSampleCount: z.number().int().positive(),
    sampleSpacingMeters: z.number().positive(),
    queryRadiusMeters: z.number().positive(),
    gainMeters: z.number(),
    lossMeters: z.number(),
    netChangeMeters: z.number(),
    minimumMeters: z.number(),
    maximumMeters: z.number(),
    startMeters: z.number(),
    endMeters: z.number(),
    notes: z.array(z.string().min(1)),
  })
  .strict()

const routeSummarySchema = z
  .object({
    distanceMeters: z.number().nonnegative(),
    distanceKilometers: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    durationMinutes: z.number().nonnegative(),
  })
  .strict()

const providerMetadataSchema = z
  .object({
    name: z.literal('mapbox'),
    directionsApiVersion: z.literal(MAPBOX_DIRECTIONS_API_VERSION),
    geocodingApiVersion: z.literal(MAPBOX_GEOCODING_API_VERSION),
    elevationSource: elevationSourceSchema,
  })
  .strict()

const routePrivacySchema = z
  .object({
    tokenSource: z.literal('env'),
    persistedByTool: z.literal(false),
    geocodingStorage: z.enum(['temporary', 'not-used']),
    geocodedPointCount: z.number().int().nonnegative(),
    geometryIncluded: z.boolean(),
  })
  .strict()

export const mapboxRouteEstimateResultSchema = z
  .object({
    provider: providerMetadataSchema,
    profile: mapboxRouteProfileSchema,
    summary: routeSummarySchema,
    points: z.array(resolvedPointSchema).min(2),
    legs: z.array(routeLegSchema),
    elevation: elevationSummarySchema.nullable(),
    geometry: routeGeometrySchema.nullable(),
    privacy: routePrivacySchema,
    warnings: z.array(z.string().min(1)),
  })
  .strict()

export type MapboxRouteLocationInput = z.infer<typeof mapboxRouteLocationInputSchema>
export type MapboxRouteEstimateInput = z.infer<typeof mapboxRouteEstimateInputSchema>
export type MapboxRouteEstimateResult = z.infer<typeof mapboxRouteEstimateResultSchema>
export type MapboxRouteProfile = z.infer<typeof mapboxRouteProfileSchema>

interface MapboxRouteDependencies {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

interface MapboxGeocodingResponse {
  features?: MapboxGeocodingFeature[]
}

interface MapboxGeocodingFeature {
  geometry?: {
    coordinates?: [number, number]
  }
  properties?: {
    feature_type?: string
    full_address?: string
    name?: string
    name_preferred?: string
    place_formatted?: string
    coordinates?: {
      accuracy?: string
      latitude?: number
      longitude?: number
      routable_points?: Array<{
        latitude?: number
        longitude?: number
        name?: string
      }>
    }
  }
}

interface MapboxDirectionsResponse {
  code?: string
  message?: string
  routes?: MapboxDirectionsRoute[]
}

interface MapboxDirectionsRoute {
  distance?: number
  duration?: number
  geometry?: {
    type?: string
    coordinates?: Array<[number, number]>
  }
  legs?: Array<{
    distance?: number
    duration?: number
    summary?: string
  }>
}

interface MapboxTilequeryResponse {
  features?: Array<{
    properties?: {
      ele?: number | string
      tilequery?: {
        distance?: number
      }
    }
  }>
}

interface ResolvedRoutePoint {
  accuracy: string | null
  displayName: string
  latitude: number
  longitude: number
  matchType: string | null
  role: z.infer<typeof pointRoleSchema>
  routableLatitude: number
  routableLongitude: number
  routablePointName: string | null
  source: z.infer<typeof pointSourceSchema>
}

interface ElevationSample {
  elevationMeters: number | null
  latitude: number
  longitude: number
}

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
  const resolvedPoints = await resolveRoutePoints({
    accessToken,
    country: input.country,
    destination: input.destination,
    fetchImpl,
    language: input.language,
    origin: input.origin,
    timeoutMs,
    waypoints: input.waypoints ?? [],
  })
  const directionsRoute = await requestDirections({
    accessToken,
    fetchImpl,
    points: resolvedPoints,
    profile: input.profile ?? 'walking',
    timeoutMs,
    wantsGeometry,
  })

  const geometry = wantsGeometry
    ? normalizeRouteGeometry(directionsRoute.geometry)
    : null
  let elevation: z.infer<typeof elevationSummarySchema> | null = null

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
      elevationSource: input.includeElevation ? 'mapbox-terrain-v2-contour' : 'none',
    },
    profile: input.profile ?? 'walking',
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
      geometryIncluded: Boolean(input.includeGeometry && geometry),
    },
    warnings,
  } satisfies MapboxRouteEstimateResult

  return mapboxRouteEstimateResultSchema.parse(result)
}

async function resolveRoutePoints(input: {
  accessToken: string
  country?: string[]
  destination: MapboxRouteLocationInput
  fetchImpl: typeof fetch
  language?: string
  origin: MapboxRouteLocationInput
  timeoutMs: number
  waypoints: MapboxRouteLocationInput[]
}): Promise<ResolvedRoutePoint[]> {
  const sources = [
    { role: 'origin' as const, value: input.origin },
    ...input.waypoints.map((value) => ({
      role: 'waypoint' as const,
      value,
    })),
    { role: 'destination' as const, value: input.destination },
  ]

  return await Promise.all(
    sources.map(async ({ role, value }) =>
      await resolveRoutePoint(value, {
        accessToken: input.accessToken,
        country: input.country,
        fetchImpl: input.fetchImpl,
        language: input.language,
        role,
        timeoutMs: input.timeoutMs,
      }),
    ),
  )
}

async function resolveRoutePoint(
  input: MapboxRouteLocationInput,
  options: {
    accessToken: string
    country?: string[]
    fetchImpl: typeof fetch
    language?: string
    role: z.infer<typeof pointRoleSchema>
    timeoutMs: number
  },
): Promise<ResolvedRoutePoint> {
  if (typeof input !== 'string') {
    return buildCoordinatePoint(input, options.role, 'coordinates')
  }

  const coordinateLiteral = parseCoordinateLiteral(input)
  if (coordinateLiteral) {
    return buildCoordinatePoint(coordinateLiteral, options.role, 'coordinate-literal')
  }

  return await geocodeRoutePoint(input, options)
}

function buildCoordinatePoint(
  input: z.infer<typeof coordinatePointSchema>,
  role: z.infer<typeof pointRoleSchema>,
  source: z.infer<typeof pointSourceSchema>,
): ResolvedRoutePoint {
  const displayName =
    normalizeNullableString(input.name) ??
    formatCoordinateLiteral(input.longitude, input.latitude)

  return {
    role,
    source,
    displayName,
    longitude: input.longitude,
    latitude: input.latitude,
    routableLongitude: input.longitude,
    routableLatitude: input.latitude,
    accuracy: null,
    matchType: null,
    routablePointName: null,
  }
}

async function geocodeRoutePoint(
  query: string,
  input: {
    accessToken: string
    country?: string[]
    fetchImpl: typeof fetch
    language?: string
    role: z.infer<typeof pointRoleSchema>
    timeoutMs: number
  },
): Promise<ResolvedRoutePoint> {
  const url = new URL(
    `https://api.mapbox.com/search/geocode/${MAPBOX_GEOCODING_API_VERSION}/forward`,
  )
  url.searchParams.set('q', query)
  url.searchParams.set('access_token', input.accessToken)
  url.searchParams.set('limit', '1')
  url.searchParams.set('autocomplete', 'false')
  url.searchParams.set('permanent', 'false')

  if (input.country && input.country.length > 0) {
    url.searchParams.set('country', input.country.join(','))
  }

  if (input.language) {
    url.searchParams.set('language', input.language)
  }

  const payload = await fetchMapboxJson<MapboxGeocodingResponse>({
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    url,
    requestLabel: `${input.role} geocoding`,
  })
  const feature = payload.features?.[0]

  if (!feature) {
    throw new Error(`Mapbox could not geocode the ${input.role}.`)
  }

  const featureCoordinates = readFeatureCoordinates(feature)
  if (!featureCoordinates) {
    throw new Error(`Mapbox returned an unusable coordinate for the ${input.role}.`)
  }

  const routablePoint = selectRoutablePoint(feature)
  const displayName = readFeatureDisplayName(feature)
  const accuracy =
    normalizeNullableString(feature.properties?.coordinates?.accuracy) ?? null
  const matchType =
    normalizeNullableString(feature.properties?.feature_type) ?? null

  return {
    role: input.role,
    source: 'geocoded-query',
    displayName,
    longitude: featureCoordinates.longitude,
    latitude: featureCoordinates.latitude,
    routableLongitude: routablePoint?.longitude ?? featureCoordinates.longitude,
    routableLatitude: routablePoint?.latitude ?? featureCoordinates.latitude,
    accuracy,
    matchType,
    routablePointName: normalizeNullableString(routablePoint?.name) ?? null,
  }
}

function readFeatureCoordinates(
  feature: MapboxGeocodingFeature,
): z.infer<typeof coordinatePointSchema> | null {
  const propertiesCoordinates = feature.properties?.coordinates
  const longitude =
    typeof propertiesCoordinates?.longitude === 'number'
      ? propertiesCoordinates.longitude
      : feature.geometry?.coordinates?.[0]
  const latitude =
    typeof propertiesCoordinates?.latitude === 'number'
      ? propertiesCoordinates.latitude
      : feature.geometry?.coordinates?.[1]

  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return null
  }

  return {
    longitude,
    latitude,
  }
}

function selectRoutablePoint(
  feature: MapboxGeocodingFeature,
): z.infer<typeof coordinatePointSchema> | null {
  const routablePoints = feature.properties?.coordinates?.routable_points ?? []
  const selectedPoint =
    routablePoints.find(
      (point) =>
        normalizeNullableString(point.name)?.toLowerCase() === 'default',
    ) ?? routablePoints[0]

  if (
    !selectedPoint ||
    typeof selectedPoint.longitude !== 'number' ||
    typeof selectedPoint.latitude !== 'number'
  ) {
    return null
  }

  return {
    longitude: selectedPoint.longitude,
    latitude: selectedPoint.latitude,
    name: normalizeNullableString(selectedPoint.name) ?? undefined,
  }
}

function readFeatureDisplayName(feature: MapboxGeocodingFeature): string {
  const fullAddress = normalizeNullableString(feature.properties?.full_address)
  if (fullAddress) {
    return fullAddress
  }

  const preferredName =
    normalizeNullableString(feature.properties?.name_preferred) ??
    normalizeNullableString(feature.properties?.name)
  const placeFormatted = normalizeNullableString(feature.properties?.place_formatted)
  const composite = [preferredName, placeFormatted].filter(Boolean).join(', ')

  return composite || 'Resolved location'
}

async function requestDirections(input: {
  accessToken: string
  fetchImpl: typeof fetch
  points: ResolvedRoutePoint[]
  profile: MapboxRouteProfile
  timeoutMs: number
  wantsGeometry: boolean
}): Promise<MapboxDirectionsRoute> {
  const coordinatePath = input.points
    .map((point) => `${point.routableLongitude},${point.routableLatitude}`)
    .join(';')
  const url = new URL(
    `https://api.mapbox.com/directions/${MAPBOX_DIRECTIONS_API_VERSION}/mapbox/${input.profile}/${coordinatePath}`,
  )
  url.searchParams.set('access_token', input.accessToken)
  url.searchParams.set('alternatives', 'false')
  url.searchParams.set('steps', 'false')
  url.searchParams.set('overview', input.wantsGeometry ? 'full' : 'false')

  if (input.wantsGeometry) {
    url.searchParams.set('geometries', 'geojson')
  }

  const payload = await fetchMapboxJson<MapboxDirectionsResponse>({
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    url,
    requestLabel: 'directions',
  })

  if (payload.code !== 'Ok') {
    throw new Error(
      normalizeNullableString(payload.message) ??
        'Mapbox did not return a route for these points.',
    )
  }

  const route = payload.routes?.[0]
  if (!route) {
    throw new Error('Mapbox did not return a route for these points.')
  }

  return route
}

function normalizeRouteGeometry(
  geometry: MapboxDirectionsRoute['geometry'],
): z.infer<typeof routeGeometrySchema> | null {
  if (
    geometry?.type !== 'LineString' ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2
  ) {
    return null
  }

  const coordinates = geometry.coordinates.flatMap((point) => {
    if (
      Array.isArray(point) &&
      point.length >= 2 &&
      typeof point[0] === 'number' &&
      typeof point[1] === 'number'
    ) {
      return [[point[0], point[1]] as [number, number]]
    }

    return []
  })

  if (coordinates.length < 2) {
    return null
  }

  return {
    type: 'LineString',
    coordinates,
  }
}

async function summarizeRouteElevation(input: {
  accessToken: string
  fetchImpl: typeof fetch
  geometry: z.infer<typeof routeGeometrySchema>
  maxSamples: number
  sampleSpacingMeters: number
  timeoutMs: number
}): Promise<z.infer<typeof elevationSummarySchema> | null> {
  const totalDistanceMeters = measureLineDistanceMeters(input.geometry.coordinates)
  const sampleCount = resolveElevationSampleCount({
    maxSamples: input.maxSamples,
    sampleSpacingMeters: input.sampleSpacingMeters,
    totalDistanceMeters,
  })
  const sampledPoints = sampleLineCoordinates(input.geometry.coordinates, sampleCount)
  const elevations = await Promise.all(
    sampledPoints.map(async ([longitude, latitude]) => ({
      elevationMeters: await queryElevationAtPoint({
        accessToken: input.accessToken,
        fetchImpl: input.fetchImpl,
        latitude,
        longitude,
        timeoutMs: input.timeoutMs,
      }),
      latitude,
      longitude,
    })),
  )

  const knownSamples = elevations.filter(
    (sample): sample is ElevationSample & { elevationMeters: number } =>
      typeof sample.elevationMeters === 'number',
  )

  if (knownSamples.length < 2) {
    return null
  }

  let gainMeters = 0
  let lossMeters = 0
  let previousSample = knownSamples[0]

  for (const sample of knownSamples.slice(1)) {
    const delta = sample.elevationMeters - previousSample.elevationMeters
    if (delta > 0) {
      gainMeters += delta
    } else if (delta < 0) {
      lossMeters += Math.abs(delta)
    }
    previousSample = sample
  }

  const elevationValues = knownSamples.map((sample) => sample.elevationMeters)
  const notes = [
    'Approximate profile from Mapbox Terrain contour features sampled along the routed line.',
    'Contour-derived elevations are quantized and may understate short, steep changes.',
  ]

  if (knownSamples.length !== elevations.length) {
    notes.push('Some sampled points did not return nearby contour data, so the profile is partially interpolated from nearby samples only.')
  }

  return {
    approximate: true,
    source: 'mapbox-terrain-v2-contour',
    sampleCount: elevations.length,
    resolvedSampleCount: knownSamples.length,
    sampleSpacingMeters: roundTo(input.sampleSpacingMeters, 1),
    queryRadiusMeters: DEFAULT_ELEVATION_QUERY_RADIUS_METERS,
    gainMeters: roundTo(gainMeters, 1),
    lossMeters: roundTo(lossMeters, 1),
    netChangeMeters: roundTo(
      knownSamples[knownSamples.length - 1]!.elevationMeters - knownSamples[0]!.elevationMeters,
      1,
    ),
    minimumMeters: Math.min(...elevationValues),
    maximumMeters: Math.max(...elevationValues),
    startMeters: knownSamples[0]!.elevationMeters,
    endMeters: knownSamples[knownSamples.length - 1]!.elevationMeters,
    notes,
  }
}

function resolveElevationSampleCount(input: {
  maxSamples: number
  sampleSpacingMeters: number
  totalDistanceMeters: number
}): number {
  if (input.totalDistanceMeters <= 0) {
    return 1
  }

  const desiredSamples = Math.ceil(input.totalDistanceMeters / input.sampleSpacingMeters) + 1
  return Math.max(2, Math.min(input.maxSamples, desiredSamples))
}

function sampleLineCoordinates(
  coordinates: ReadonlyArray<readonly [number, number]>,
  sampleCount: number,
): Array<[number, number]> {
  if (coordinates.length === 0) {
    return []
  }

  if (coordinates.length === 1 || sampleCount <= 1) {
    return [[coordinates[0]![0], coordinates[0]![1]]]
  }

  const cumulativeDistances = [0]
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulativeDistances.push(
      cumulativeDistances[index - 1]! +
        haversineMeters(coordinates[index - 1]!, coordinates[index]!),
    )
  }

  const totalDistanceMeters = cumulativeDistances[cumulativeDistances.length - 1]!
  if (totalDistanceMeters <= 0) {
    return [[coordinates[0]![0], coordinates[0]![1]]]
  }

  const samples: Array<[number, number]> = []
  let segmentIndex = 0

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const targetDistance =
      sampleCount === 1
        ? 0
        : (totalDistanceMeters * sampleIndex) / (sampleCount - 1)

    while (
      segmentIndex < cumulativeDistances.length - 2 &&
      cumulativeDistances[segmentIndex + 1]! < targetDistance
    ) {
      segmentIndex += 1
    }

    const start = coordinates[segmentIndex]!
    const end = coordinates[Math.min(segmentIndex + 1, coordinates.length - 1)]!
    const segmentStartDistance = cumulativeDistances[segmentIndex]!
    const segmentEndDistance =
      cumulativeDistances[Math.min(segmentIndex + 1, cumulativeDistances.length - 1)]!
    const ratio =
      segmentEndDistance > segmentStartDistance
        ? (targetDistance - segmentStartDistance) /
          (segmentEndDistance - segmentStartDistance)
        : 0
    samples.push(interpolateCoordinate(start, end, ratio))
  }

  return dedupeAdjacentCoordinates(samples)
}

function interpolateCoordinate(
  start: readonly [number, number],
  end: readonly [number, number],
  ratio: number,
): [number, number] {
  const safeRatio = Math.max(0, Math.min(1, ratio))
  return [
    start[0] + (end[0] - start[0]) * safeRatio,
    start[1] + (end[1] - start[1]) * safeRatio,
  ]
}

function dedupeAdjacentCoordinates(
  coordinates: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const deduped: Array<[number, number]> = []

  for (const coordinate of coordinates) {
    const previous = deduped[deduped.length - 1]
    if (previous && previous[0] === coordinate[0] && previous[1] === coordinate[1]) {
      continue
    }

    deduped.push([coordinate[0], coordinate[1]])
  }

  return deduped
}

async function queryElevationAtPoint(input: {
  accessToken: string
  fetchImpl: typeof fetch
  latitude: number
  longitude: number
  timeoutMs: number
}): Promise<number | null> {
  const url = new URL(
    `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/${input.longitude},${input.latitude}.json`,
  )
  url.searchParams.set('access_token', input.accessToken)
  url.searchParams.set('radius', String(DEFAULT_ELEVATION_QUERY_RADIUS_METERS))
  url.searchParams.set('limit', '10')
  url.searchParams.set('layers', 'contour')
  url.searchParams.set('geometry', 'linestring')

  const payload = await fetchMapboxJson<MapboxTilequeryResponse>({
    allowNotFound: true,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    url,
    requestLabel: 'terrain elevation',
  })

  if (!payload) {
    return null
  }

  const feature = payload.features?.find((candidate) => {
    const elevation = candidate.properties?.ele
    return typeof elevation === 'number' || typeof elevation === 'string'
  })
  const candidateElevation = feature?.properties?.ele

  if (typeof candidateElevation === 'number') {
    return candidateElevation
  }

  if (typeof candidateElevation === 'string') {
    const parsed = Number.parseFloat(candidateElevation)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

async function fetchMapboxJson<T>(input: {
  allowNotFound: true
  fetchImpl: typeof fetch
  requestLabel: string
  timeoutMs: number
  url: URL
}): Promise<T | null>
async function fetchMapboxJson<T>(input: {
  allowNotFound?: false | undefined
  fetchImpl: typeof fetch
  requestLabel: string
  timeoutMs: number
  url: URL
}): Promise<T>
async function fetchMapboxJson<T>(input: {
  allowNotFound?: boolean
  fetchImpl: typeof fetch
  requestLabel: string
  timeoutMs: number
  url: URL
}): Promise<T | null> {
  let response: Response

  try {
    response = await input.fetchImpl(input.url, {
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(input.timeoutMs),
    })
  } catch (error) {
    throw new Error(
      `Mapbox ${input.requestLabel} request failed: ${errorMessage(error)}.`,
    )
  }

  if (input.allowNotFound && response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(
      `Mapbox ${input.requestLabel} request failed (${await describeFailedMapboxResponse(response)}).`,
    )
  }

  return (await response.json()) as T
}

async function describeFailedMapboxResponse(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`

  try {
    const payload = (await response.json()) as {
      message?: unknown
    }
    const message =
      typeof payload.message === 'string'
        ? normalizeNullableString(payload.message)
        : null

    return message ? `${fallback}: ${message}` : fallback
  } catch {
    return fallback
  }
}

function parseCoordinateLiteral(
  value: string,
): z.infer<typeof coordinatePointSchema> | null {
  const match = coordinateLiteralPattern.exec(value)
  if (!match) {
    return null
  }

  const longitude = Number.parseFloat(match[1] ?? '')
  const latitude = Number.parseFloat(match[2] ?? '')

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null
  }

  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null
  }

  return {
    longitude,
    latitude,
  }
}

function formatCoordinateLiteral(longitude: number, latitude: number): string {
  return `${longitude.toFixed(6)}, ${latitude.toFixed(6)}`
}

function readMapboxAccessToken(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.MAPBOX_ACCESS_TOKEN)
}

function resolveMapboxTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = normalizeNullableString(env.MURPH_MAPBOX_TIMEOUT_MS)
  if (!configured) {
    return DEFAULT_MAPBOX_TIMEOUT_MS
  }

  const parsed = Number.parseInt(configured, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAPBOX_TIMEOUT_MS
  }

  return Math.min(parsed, MAX_MAPBOX_TIMEOUT_MS)
}

function measureLineDistanceMeters(
  coordinates: ReadonlyArray<readonly [number, number]>,
): number {
  let totalDistance = 0

  for (let index = 1; index < coordinates.length; index += 1) {
    totalDistance += haversineMeters(coordinates[index - 1]!, coordinates[index]!)
  }

  return totalDistance
}

function haversineMeters(
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const earthRadiusMeters = 6_371_000
  const startLatitudeRadians = toRadians(start[1])
  const endLatitudeRadians = toRadians(end[1])
  const deltaLatitudeRadians = toRadians(end[1] - start[1])
  const deltaLongitudeRadians = toRadians(end[0] - start[0])
  const haversineValue =
    Math.sin(deltaLatitudeRadians / 2) ** 2 +
    Math.cos(startLatitudeRadians) *
      Math.cos(endLatitudeRadians) *
      Math.sin(deltaLongitudeRadians / 2) ** 2
  const centralAngle =
    2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue))

  return earthRadiusMeters * centralAngle
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
