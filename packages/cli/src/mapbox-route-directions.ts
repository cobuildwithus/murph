import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import {
  MAPBOX_DIRECTIONS_API_VERSION,
  type MapboxDirectionsResponse,
  type MapboxDirectionsRoute,
  type MapboxRouteGeometry,
  type MapboxRouteProfile,
  type ResolvedRoutePoint,
} from './mapbox-route-contracts.js'
import { fetchMapboxJson } from './mapbox-route-client.js'

export async function requestDirections(input: {
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

export function normalizeRouteGeometry(
  geometry: MapboxDirectionsRoute['geometry'],
): MapboxRouteGeometry | null {
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
