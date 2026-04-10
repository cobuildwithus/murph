import {
  DEFAULT_ELEVATION_QUERY_RADIUS_METERS,
  MAX_ELEVATION_QUERY_FEATURES,
  type ElevationSample,
  elevationSummarySchema,
  type MapboxRouteElevationSummary,
  type MapboxRouteGeometry,
  type MapboxTilequeryResponse,
} from './mapbox-route-contracts.js'
import { fetchMapboxJson } from './mapbox-route-client.js'

export async function summarizeRouteElevation(input: {
  accessToken: string
  fetchImpl: typeof fetch
  geometry: MapboxRouteGeometry
  maxSamples: number
  sampleSpacingMeters: number
  timeoutMs: number
}): Promise<MapboxRouteElevationSummary | null> {
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

  return elevationSummarySchema.parse({
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
  })
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
  url.searchParams.set('limit', String(MAX_ELEVATION_QUERY_FEATURES))
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

  const elevations = (payload.features ?? [])
    .map((feature) => parseElevationValue(feature.properties?.ele))
    .filter((value): value is number => typeof value === 'number')

  return elevations.length > 0 ? Math.max(...elevations) : null
}

function parseElevationValue(value: number | string | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
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
