import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import * as z from '@murphai/contracts/zod-runtime'
import {
  MAPBOX_DIRECTIONS_API_VERSION,
  type MapboxDirectionsResponse,
  type MapboxDirectionsRoute,
  type MapboxRouteGeometry,
  type MapboxRouteProfile,
  type ResolvedRoutePoint,
} from './mapbox-route-contracts.js'
import { fetchMapboxJson } from './mapbox-route-client.js'

const finiteNonnegativeNumberSchema = z.number().finite().nonnegative()
const mapboxDirectionsGeometrySchema = z
  .object({
    type: z.string(),
    coordinates: z.array(
      z.tuple([z.number().finite(), z.number().finite()]),
    ),
  })
  .passthrough()

const mapboxDirectionsLegSchema = z
  .object({
    distance: finiteNonnegativeNumberSchema,
    duration: finiteNonnegativeNumberSchema,
    summary: z.string().optional(),
  })
  .passthrough()

const mapboxDirectionsRouteSchema = z
  .object({
    distance: finiteNonnegativeNumberSchema,
    duration: finiteNonnegativeNumberSchema,
    geometry: mapboxDirectionsGeometrySchema.optional(),
    legs: z.array(mapboxDirectionsLegSchema).optional(),
  })
  .passthrough()

const mapboxDirectionsResponseSchema = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
    routes: z.array(mapboxDirectionsRouteSchema).optional(),
  })
  .passthrough()

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

  const parsedPayload = mapboxDirectionsResponseSchema.safeParse(
    await fetchMapboxJson<unknown>({
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      url,
      requestLabel: 'directions',
    }),
  )

  if (!parsedPayload.success) {
    throw new Error('Mapbox returned an invalid directions response.')
  }

  const payload: MapboxDirectionsResponse = parsedPayload.data

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
