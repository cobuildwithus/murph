import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  MAPBOX_GEOCODING_API_VERSION,
  MAPBOX_SEARCH_BOX_API_VERSION,
  coordinatePointSchema,
  type MapboxGeocodingResponse,
  type MapboxLocationFeature,
  type MapboxRouteCoordinatePoint,
  type MapboxRouteLocationInput,
  type MapboxRoutePointRole,
  type MapboxRoutePointSource,
  type MapboxRouteProfile,
  MapboxRoutePointLookupMissError,
  type MapboxSearchBoxResponse,
  type ResolvedRoutePoint,
} from './mapbox-route-contracts.js'
import {
  createMapboxResponseInvalidError,
  fetchMapboxJson,
  type MapboxRequestStage,
} from './mapbox-route-client.js'

const coordinateLiteralPattern =
  /^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*$/u
const likelyAddressPattern =
  /^\s*\d+[A-Za-z0-9/\-]*\s+(?:[A-Za-z0-9.'-]+\s+){0,5}(?:st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|pde|parade|way|ter|terrace|hwy|highway|cct|circuit)\b/iu

export interface ResolveRoutePointsInput {
  accessToken: string
  country?: string[]
  destination: MapboxRouteLocationInput
  fetchImpl: typeof fetch
  language?: string
  origin: MapboxRouteLocationInput
  profile: MapboxRouteProfile
  timeoutMs: number
  waypoints: MapboxRouteLocationInput[]
}

interface RoutePointLookupOptions {
  accessToken: string
  country?: string[]
  fetchImpl: typeof fetch
  language?: string
  profile: MapboxRouteProfile
  proximity: MapboxRouteCoordinatePoint | null
  role: MapboxRoutePointRole
  timeoutMs: number
}

export async function resolveRoutePoints(
  input: ResolveRoutePointsInput,
): Promise<ResolvedRoutePoint[]> {
  const sources = [
    { role: 'origin' as const, value: input.origin },
    ...input.waypoints.map((value) => ({
      role: 'waypoint' as const,
      value,
    })),
    { role: 'destination' as const, value: input.destination },
  ]
  const resolvedPoints: ResolvedRoutePoint[] = []
  let proximity: MapboxRouteCoordinatePoint | null = null

  for (const { role, value } of sources) {
    const resolvedPoint = await resolveRoutePoint(value, {
      accessToken: input.accessToken,
      country: input.country,
      fetchImpl: input.fetchImpl,
      language: input.language,
      profile: input.profile,
      proximity,
      role,
      timeoutMs: input.timeoutMs,
    })

    resolvedPoints.push(resolvedPoint)
    proximity = {
      longitude: resolvedPoint.routableLongitude,
      latitude: resolvedPoint.routableLatitude,
      name: resolvedPoint.displayName,
    }
  }

  return resolvedPoints
}

function resolveRoutePoint(
  input: MapboxRouteLocationInput,
  options: RoutePointLookupOptions,
): Promise<ResolvedRoutePoint> {
  if (typeof input !== 'string') {
    return Promise.resolve(buildCoordinatePoint(input, options.role, 'coordinates'))
  }

  const coordinateLiteral = parseCoordinateLiteral(input)
  if (coordinateLiteral) {
    return Promise.resolve(
      buildCoordinatePoint(coordinateLiteral, options.role, 'coordinate-literal'),
    )
  }

  return resolveTextRoutePoint(input, options)
}

async function resolveTextRoutePoint(
  query: string,
  input: RoutePointLookupOptions,
): Promise<ResolvedRoutePoint> {
  const lookupOrder = looksLikeAddressQuery(query)
    ? [geocodeRoutePoint, searchBoxRoutePoint]
    : [searchBoxRoutePoint, geocodeRoutePoint]
  let firstMiss: MapboxRoutePointLookupMissError | null = null

  for (const lookup of lookupOrder) {
    try {
      return await lookup(query, input)
    } catch (error) {
      if (!(error instanceof MapboxRoutePointLookupMissError)) {
        throw error
      }

      firstMiss ??= error
    }
  }

  if (firstMiss) {
    throw new VaultCliError(
      'route_point_unresolved',
      `Mapbox could not resolve the ${input.role}.`,
      { retryable: false },
      {
        stage: `${input.role}-lookup`,
        hint: 'Make the location more specific or use longitude,latitude coordinates.',
      },
    )
  }

  throw createMapboxResponseInvalidError(routePointStage(input.role, 'search'))
}

function buildCoordinatePoint(
  input: MapboxRouteCoordinatePoint,
  role: MapboxRoutePointRole,
  source: MapboxRoutePointSource,
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
  input: RoutePointLookupOptions,
): Promise<ResolvedRoutePoint> {
  const url = new URL(
    `https://api.mapbox.com/search/geocode/${MAPBOX_GEOCODING_API_VERSION}/forward`,
  )
  url.searchParams.set('q', query)
  url.searchParams.set('access_token', input.accessToken)
  url.searchParams.set('limit', '1')
  url.searchParams.set('autocomplete', 'false')
  url.searchParams.set('permanent', 'false')

  if (input.profile === 'walking') {
    url.searchParams.set('entrances', 'true')
  }

  if (input.country && input.country.length > 0) {
    url.searchParams.set('country', input.country.join(','))
  }

  if (input.language) {
    url.searchParams.set('language', input.language)
  }

  const stage = routePointStage(input.role, 'geocoding')
  const payload = await fetchMapboxJson<MapboxGeocodingResponse>({
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    url,
    stage,
  })
  const feature = readFirstMapboxFeature(payload, stage)

  if (!feature) {
    throw new MapboxRoutePointLookupMissError(`Mapbox could not geocode the ${input.role}.`)
  }

  return buildResolvedFeaturePoint(feature, input, 'geocoded-query', stage)
}

async function searchBoxRoutePoint(
  query: string,
  input: RoutePointLookupOptions,
): Promise<ResolvedRoutePoint> {
  const url = new URL(
    `https://api.mapbox.com/search/searchbox/${MAPBOX_SEARCH_BOX_API_VERSION}/forward`,
  )
  url.searchParams.set('q', query)
  url.searchParams.set('access_token', input.accessToken)
  url.searchParams.set('limit', '1')

  if (input.country && input.country.length > 0) {
    url.searchParams.set('country', input.country.join(','))
  }

  if (input.language) {
    url.searchParams.set('language', input.language)
  }

  if (input.proximity) {
    url.searchParams.set(
      'proximity',
      `${input.proximity.longitude},${input.proximity.latitude}`,
    )
  }

  const stage = routePointStage(input.role, 'search')
  const payload = await fetchMapboxJson<MapboxSearchBoxResponse>({
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    url,
    stage,
  })
  const feature = readFirstMapboxFeature(payload, stage)

  if (!feature) {
    throw new MapboxRoutePointLookupMissError(
      `Mapbox could not find a temporary place match for the ${input.role}.`,
    )
  }

  return buildResolvedFeaturePoint(feature, input, 'search-box-query', stage)
}

function readFirstMapboxFeature(
  payload: MapboxGeocodingResponse | MapboxSearchBoxResponse,
  stage: MapboxRequestStage,
): MapboxLocationFeature | null {
  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload.features !== undefined && !Array.isArray(payload.features))
  ) {
    throw createMapboxResponseInvalidError(stage)
  }

  const feature = payload.features?.[0]
  if (feature !== undefined && (!feature || typeof feature !== 'object')) {
    throw createMapboxResponseInvalidError(stage)
  }

  return feature ?? null
}

function buildResolvedFeaturePoint(
  feature: MapboxLocationFeature,
  input: RoutePointLookupOptions,
  source: Extract<MapboxRoutePointSource, 'geocoded-query' | 'search-box-query'>,
  stage: MapboxRequestStage,
): ResolvedRoutePoint {
  const featureCoordinates = readFeatureCoordinates(feature)
  if (!featureCoordinates) {
    throw createMapboxResponseInvalidError(stage)
  }

  const routablePoint = selectRoutablePoint(feature, input.profile)
  const displayName = readFeatureDisplayName(feature)
  const accuracy =
    normalizeNullableString(feature.properties?.coordinates?.accuracy) ?? null
  const matchType =
    normalizeNullableString(feature.properties?.feature_type) ?? null

  return {
    role: input.role,
    source,
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

function routePointStage(
  role: MapboxRoutePointRole,
  lookup: 'geocoding' | 'search',
): MapboxRequestStage {
  return `${role}-${lookup}`
}

function readFeatureCoordinates(
  feature: MapboxLocationFeature,
): MapboxRouteCoordinatePoint | null {
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

  return coordinatePointSchema.parse({
    longitude,
    latitude,
  })
}

function selectRoutablePoint(
  feature: MapboxLocationFeature,
  profile: MapboxRouteProfile,
): MapboxRouteCoordinatePoint | null {
  const routablePoints = feature.properties?.coordinates?.routable_points ?? []
  const preferredPointNames = profile === 'walking'
    ? ['entrance', 'default']
    : ['default', 'entrance']
  let selectedPoint = routablePoints[0]

  for (const preferredPointName of preferredPointNames) {
    const matchingPoint = routablePoints.find(
      (point) =>
        normalizeNullableString(point.name)?.toLowerCase() === preferredPointName,
    )
    if (matchingPoint) {
      selectedPoint = matchingPoint
      break
    }
  }

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

function readFeatureDisplayName(feature: MapboxLocationFeature): string {
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

function parseCoordinateLiteral(
  value: string,
): MapboxRouteCoordinatePoint | null {
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

function looksLikeAddressQuery(value: string): boolean {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return false
  }

  return likelyAddressPattern.test(normalized)
}
