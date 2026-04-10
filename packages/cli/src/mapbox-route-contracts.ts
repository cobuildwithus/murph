import { z } from 'zod'

export const MAPBOX_DIRECTIONS_API_VERSION = 'v5'
export const MAPBOX_GEOCODING_API_VERSION = 'v6'
export const MAPBOX_SEARCH_BOX_API_VERSION = 'v1'
export const DEFAULT_MAPBOX_TIMEOUT_MS = 10_000
export const MAX_MAPBOX_TIMEOUT_MS = 30_000
export const DEFAULT_ELEVATION_QUERY_RADIUS_METERS = 50
export const DEFAULT_ELEVATION_SAMPLE_SPACING_METERS = 500
export const DEFAULT_MAX_ELEVATION_SAMPLES = 16
export const MAX_ELEVATION_QUERY_FEATURES = 50
export const MAX_ELEVATION_SAMPLES = 24
export const MAX_ROUTE_COORDINATES = 25
export const MAX_ROUTE_WAYPOINTS = MAX_ROUTE_COORDINATES - 2

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

export const coordinatePointSchema = z.object({
  longitude: longitudeSchema,
  latitude: latitudeSchema,
  name: z.string().min(1).optional(),
})

export const pointRoleSchema = z.enum(['origin', 'waypoint', 'destination'])
export const pointSourceSchema = z.enum([
  'coordinates',
  'coordinate-literal',
  'geocoded-query',
  'search-box-query',
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

export const routeGeometrySchema = z
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

export const elevationSummarySchema = z
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
    searchBoxApiVersion: z.literal(MAPBOX_SEARCH_BOX_API_VERSION),
    elevationSource: elevationSourceSchema,
  })
  .strict()

const routePrivacySchema = z
  .object({
    tokenSource: z.literal('env'),
    persistedByTool: z.literal(false),
    geocodingStorage: z.enum(['temporary', 'not-used']),
    geocodedPointCount: z.number().int().nonnegative(),
    searchBoxStorage: z.enum(['temporary', 'not-used']),
    searchBoxPointCount: z.number().int().nonnegative(),
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

export type MapboxRouteCoordinatePoint = z.infer<typeof coordinatePointSchema>
export type MapboxRouteDependencies = {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}
export type MapboxRouteElevationSummary = z.infer<typeof elevationSummarySchema>
export type MapboxRouteEstimateInput = z.infer<typeof mapboxRouteEstimateInputSchema>
export type MapboxRouteEstimateResult = z.infer<typeof mapboxRouteEstimateResultSchema>
export type MapboxRouteGeometry = z.infer<typeof routeGeometrySchema>
export type MapboxRouteLocationInput = z.infer<typeof mapboxRouteLocationInputSchema>
export type MapboxRoutePointRole = z.infer<typeof pointRoleSchema>
export type MapboxRoutePointSource = z.infer<typeof pointSourceSchema>
export type MapboxRouteProfile = z.infer<typeof mapboxRouteProfileSchema>
export type ResolvedRoutePoint = z.infer<typeof resolvedPointSchema>

export interface MapboxGeocodingResponse {
  features?: MapboxLocationFeature[]
}

export interface MapboxSearchBoxResponse {
  features?: MapboxLocationFeature[]
}

export interface MapboxLocationFeature {
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

export interface MapboxDirectionsResponse {
  code?: string
  message?: string
  routes?: MapboxDirectionsRoute[]
}

export interface MapboxDirectionsRoute {
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

export interface MapboxTilequeryResponse {
  features?: Array<{
    properties?: {
      ele?: number | string
      tilequery?: {
        distance?: number
      }
    }
  }>
}

export interface ElevationSample {
  elevationMeters: number | null
  latitude: number
  longitude: number
}

export class MapboxRoutePointLookupMissError extends Error {}
