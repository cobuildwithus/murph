import type { JsonObject } from "../health-cli-method-types.js"
import type { QueryRecord, QueryRuntimeModule } from "./types.js"

const WORKOUT_FEATURE_RESOURCE_SUFFIX = "-workout-stream"
const WORKOUT_FEATURE_FACET = "workout-stream-feature"
const WORKOUT_SPLIT_FACET_PATTERN = /^workout-stream-split-(\d+)$/u
const WORKOUT_SPORT_TAG_PREFIX = "workout-sport-"

interface WorkoutFeatureFilters {
  date?: string
  from?: string
  to?: string
  providers?: readonly string[]
}

interface WorkoutFeatureGroup {
  dayKey: string
  overall: QueryRecord | null
  provider: string
  splits: Array<{ index: number; record: QueryRecord }>
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function junctionWorkoutFeatureRef(record: QueryRecord): {
  facet: string
  groupKey: string
} | null {
  const externalRef = plainRecord(record.attributes.externalRef)
  const system = stringValue(externalRef?.system)?.toLowerCase()
  const resourceType = stringValue(externalRef?.resourceType)?.toLowerCase().replaceAll("_", "-")
  const resourceId = stringValue(externalRef?.resourceId)
  const facet = stringValue(externalRef?.facet)?.toLowerCase().replaceAll("_", "-")
  if (
    system !== "junction"
    || !resourceType?.endsWith(WORKOUT_FEATURE_RESOURCE_SUFFIX)
    || !resourceId
    || !facet
  ) {
    return null
  }
  if (facet !== WORKOUT_FEATURE_FACET && !WORKOUT_SPLIT_FACET_PATTERN.test(facet)) {
    return null
  }

  return {
    facet,
    groupKey: JSON.stringify([resourceType, resourceId]),
  }
}

function workoutFeatureProvider(record: QueryRecord): string | null {
  const dataOrigin = plainRecord(record.attributes.dataOrigin)
  return stringValue(dataOrigin?.sourceProviderSlug)?.toLowerCase().replaceAll("_", "-") ?? null
}

function recordMatchesFilters(
  record: QueryRecord,
  provider: string,
  filters: WorkoutFeatureFilters,
): boolean {
  const dayKey = record.date
  if (!dayKey) {
    return false
  }
  if (filters.date && dayKey !== filters.date) {
    return false
  }
  if (filters.from && dayKey < filters.from) {
    return false
  }
  if (filters.to && dayKey > filters.to) {
    return false
  }
  return !filters.providers?.length || filters.providers.includes(provider)
}

function measurementMap(record: QueryRecord): Map<string, { unit: string; value: number }> {
  const measurements = Array.isArray(record.attributes.measurements)
    ? record.attributes.measurements
    : []
  const mapped = new Map<string, { unit: string; value: number }>()
  for (const rawMeasurement of measurements) {
    const measurement = plainRecord(rawMeasurement)
    const metric = stringValue(measurement?.metric)
    const unit = stringValue(measurement?.unit)
    const value = finiteNumber(measurement?.value)
    if (metric && unit && value !== null) {
      mapped.set(metric, { unit, value })
    }
  }
  return mapped
}

function copyMetric(
  output: JsonObject,
  measurements: ReadonlyMap<string, { unit: string; value: number }>,
  metric: string,
  outputKey: string,
): void {
  const measurement = measurements.get(metric)
  if (measurement) {
    output[outputKey] = measurement.value
  }
}

function workoutSport(record: QueryRecord): string | null {
  return record.tags.find((tag) => tag.startsWith(WORKOUT_SPORT_TAG_PREFIX))
    ?.slice(WORKOUT_SPORT_TAG_PREFIX.length) ?? null
}

function projectWorkoutSplit(
  index: number,
  record: QueryRecord,
): JsonObject {
  const measurements = measurementMap(record)
  const split: JsonObject = {
    endedAt: record.occurredAt,
    index,
  }
  copyMetric(split, measurements, "workout-split-distance", "distanceMeters")
  copyMetric(split, measurements, "workout-split-duration", "durationSeconds")
  copyMetric(split, measurements, "average-workout-split-heart-rate", "averageHeartRate")
  copyMetric(split, measurements, "average-workout-split-cadence", "averageCadence")
  copyMetric(split, measurements, "average-workout-split-power", "averagePower")
  const cadence = measurements.get("average-workout-split-cadence")
  if (cadence) {
    split.cadenceUnit = cadence.unit
  }
  return split
}

function projectWorkoutFeature(group: WorkoutFeatureGroup): JsonObject | null {
  if (!group.overall?.occurredAt) {
    return null
  }
  const measurements = measurementMap(group.overall)
  const feature: JsonObject = {
    provider: group.provider,
    splits: group.splits
      .sort((left, right) => left.index - right.index)
      .map(({ index, record }) => projectWorkoutSplit(index, record)),
    startedAt: group.overall.occurredAt,
  }
  const sport = workoutSport(group.overall)
  if (sport) {
    feature.activityType = sport
  }
  copyMetric(feature, measurements, "workout-minutes", "durationMinutes")
  copyMetric(feature, measurements, "workout-distance-km", "distanceKm")
  copyMetric(feature, measurements, "average-heart-rate", "averageHeartRate")
  copyMetric(feature, measurements, "max-heart-rate", "maxHeartRate")
  copyMetric(
    feature,
    measurements,
    "first-half-average-workout-heart-rate",
    "firstHalfAverageHeartRate",
  )
  copyMetric(
    feature,
    measurements,
    "second-half-average-workout-heart-rate",
    "secondHalfAverageHeartRate",
  )
  copyMetric(feature, measurements, "average-workout-cadence", "averageCadence")
  copyMetric(feature, measurements, "max-workout-cadence", "maxCadence")
  copyMetric(feature, measurements, "average-workout-power", "averagePower")
  copyMetric(feature, measurements, "max-workout-power", "maxPower")
  copyMetric(feature, measurements, "average-workout-speed", "averageSpeed")
  copyMetric(feature, measurements, "max-workout-speed", "maxSpeed")
  const cadence = measurements.get("average-workout-cadence")
  if (cadence) {
    feature.cadenceUnit = cadence.unit
  }
  return feature
}

export async function listJunctionWorkoutFeaturesByDay(
  query: QueryRuntimeModule,
  vault: string,
  filters: WorkoutFeatureFilters,
): Promise<Map<string, JsonObject[]>> {
  const readModel = await query.readVault(vault)
  const groups = new Map<string, WorkoutFeatureGroup>()
  const records = query.listEntities(readModel, {
    families: ["event"],
    kinds: ["measurement"],
    from: filters.from ?? filters.date,
    to: filters.to ?? filters.date,
  })

  for (const record of records) {
    const ref = junctionWorkoutFeatureRef(record)
    const provider = workoutFeatureProvider(record)
    const dayKey = record.date
    if (!ref || !provider || !dayKey || !recordMatchesFilters(record, provider, filters)) {
      continue
    }
    const group: WorkoutFeatureGroup = groups.get(ref.groupKey) ?? {
      dayKey,
      overall: null,
      provider,
      splits: [],
    }
    if (ref.facet === WORKOUT_FEATURE_FACET) {
      group.dayKey = dayKey
      group.overall = record
      group.provider = provider
    } else {
      const splitIndex = Number(WORKOUT_SPLIT_FACET_PATTERN.exec(ref.facet)?.[1])
      if (Number.isSafeInteger(splitIndex) && splitIndex >= 0) {
        group.splits.push({ index: splitIndex, record })
      }
    }
    groups.set(ref.groupKey, group)
  }

  const byDay = new Map<string, JsonObject[]>()
  for (const group of groups.values()) {
    const feature = projectWorkoutFeature(group)
    if (!feature) {
      continue
    }
    const features = byDay.get(group.dayKey) ?? []
    features.push(feature)
    byDay.set(group.dayKey, features)
  }
  for (const features of byDay.values()) {
    features.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)))
  }
  return byDay
}
