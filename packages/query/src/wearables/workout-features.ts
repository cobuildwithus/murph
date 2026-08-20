import { canonicalizeWearableProviderSlug } from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import type {
  WearableFilters,
  WearableWorkoutFeature,
  WearableWorkoutFeatureCandidate,
  WearableWorkoutSplitFeature,
} from "./types.ts";

const WORKOUT_FEATURE_RESOURCE_SUFFIX = "-workout-stream";
const WORKOUT_FEATURE_FACET = "workout-stream-feature";
const WORKOUT_SPLIT_FACET_PATTERN = /^workout-stream-split-(\d+)$/u;
const WORKOUT_SPORT_TAG_PREFIX = "workout-sport-";
const MAX_WORKOUT_FEATURES_PER_DAY = 32;
const MAX_WORKOUT_SPLITS = 64;

interface WorkoutFeatureGroup {
  date: string;
  overall: CanonicalEntity | null;
  provider: string;
  splits: Array<{ index: number; entity: CanonicalEntity }>;
}

export function collectJunctionWorkoutFeatures(
  entities: readonly CanonicalEntity[],
  filters: WearableFilters,
): WearableWorkoutFeatureCandidate[] {
  const providerSet = filters.providers
    ? new Set(filters.providers.map((provider) => canonicalizeWearableProviderSlug(provider)))
    : null;
  const groups = new Map<string, WorkoutFeatureGroup>();

  for (const entity of entities) {
    const ref = junctionWorkoutFeatureRef(entity);
    const provider = workoutFeatureProvider(entity);
    const date = entity.date;
    if (
      entity.family !== "event"
      || entity.kind !== "measurement"
      || !ref
      || !provider
      || !date
      || (filters.date && date !== filters.date)
      || (filters.from && date < filters.from)
      || (filters.to && date > filters.to)
      || (providerSet && !providerSet.has(provider))
    ) {
      continue;
    }

    const group = groups.get(ref.groupKey) ?? {
      date,
      overall: null,
      provider,
      splits: [],
    };
    if (ref.facet === WORKOUT_FEATURE_FACET) {
      group.date = date;
      group.overall = entity;
      group.provider = provider;
    } else {
      const splitIndex = Number(WORKOUT_SPLIT_FACET_PATTERN.exec(ref.facet)?.[1]);
      if (Number.isSafeInteger(splitIndex) && splitIndex >= 0) {
        group.splits.push({ index: splitIndex, entity });
      }
    }
    groups.set(ref.groupKey, group);
  }

  const candidates = [...groups.values()].flatMap((group) => {
    const feature = projectWorkoutFeature(group);
    return feature ? [{ date: group.date, feature }] : [];
  });
  candidates.sort(compareWorkoutFeatureCandidates);

  const perDay = new Map<string, number>();
  return candidates.filter((candidate) => {
    const count = perDay.get(candidate.date) ?? 0;
    if (count >= MAX_WORKOUT_FEATURES_PER_DAY) {
      return false;
    }
    perDay.set(candidate.date, count + 1);
    return true;
  });
}

export function compareWorkoutFeatures(
  left: WearableWorkoutFeature,
  right: WearableWorkoutFeature,
): number {
  return left.startedAt.localeCompare(right.startedAt)
    || left.provider.localeCompare(right.provider);
}

function compareWorkoutFeatureCandidates(
  left: WearableWorkoutFeatureCandidate,
  right: WearableWorkoutFeatureCandidate,
): number {
  return right.date.localeCompare(left.date)
    || compareWorkoutFeatures(left.feature, right.feature);
}

function junctionWorkoutFeatureRef(entity: CanonicalEntity): {
  facet: string;
  groupKey: string;
} | null {
  const externalRef = plainRecord(entity.attributes.externalRef);
  const system = stringValue(externalRef?.system)?.toLowerCase();
  const resourceType = stringValue(externalRef?.resourceType)
    ?.toLowerCase()
    .replaceAll("_", "-");
  const resourceId = stringValue(externalRef?.resourceId);
  const facet = stringValue(externalRef?.facet)?.toLowerCase().replaceAll("_", "-");
  if (
    system !== "junction"
    || !resourceType?.endsWith(WORKOUT_FEATURE_RESOURCE_SUFFIX)
    || !resourceId
    || !facet
    || (facet !== WORKOUT_FEATURE_FACET && !WORKOUT_SPLIT_FACET_PATTERN.test(facet))
  ) {
    return null;
  }
  return {
    facet,
    groupKey: JSON.stringify([resourceType, resourceId]),
  };
}

function workoutFeatureProvider(entity: CanonicalEntity): string | null {
  const dataOrigin = plainRecord(entity.attributes.dataOrigin);
  const provider = stringValue(dataOrigin?.sourceProviderSlug);
  return provider ? canonicalizeWearableProviderSlug(provider) : null;
}

function projectWorkoutFeature(group: WorkoutFeatureGroup): WearableWorkoutFeature | null {
  if (!group.overall?.occurredAt) {
    return null;
  }
  const measurements = measurementMap(group.overall);
  const feature: WearableWorkoutFeature & Record<string, unknown> = {
    provider: group.provider,
    splits: group.splits
      .sort((left, right) => left.index - right.index)
      .slice(0, MAX_WORKOUT_SPLITS)
      .flatMap(({ index, entity }) =>
        entity.occurredAt ? [projectWorkoutSplit(index, entity, entity.occurredAt)] : []
      ),
    startedAt: group.overall.occurredAt,
  };
  const sport = group.overall.tags.find((tag) => tag.startsWith(WORKOUT_SPORT_TAG_PREFIX))
    ?.slice(WORKOUT_SPORT_TAG_PREFIX.length);
  if (sport) feature.activityType = sport;
  copyMetric(feature, measurements, "workout-minutes", "durationMinutes");
  copyMetric(feature, measurements, "workout-distance-km", "distanceKm");
  copyMetric(feature, measurements, "average-heart-rate", "averageHeartRate");
  copyMetric(feature, measurements, "max-heart-rate", "maxHeartRate");
  copyMetric(feature, measurements, "first-half-average-workout-heart-rate", "firstHalfAverageHeartRate");
  copyMetric(feature, measurements, "second-half-average-workout-heart-rate", "secondHalfAverageHeartRate");
  copyMetric(feature, measurements, "average-workout-cadence", "averageCadence");
  copyMetric(feature, measurements, "max-workout-cadence", "maxCadence");
  copyMetric(feature, measurements, "average-workout-power", "averagePowerWatts");
  copyMetric(feature, measurements, "max-workout-power", "maxPowerWatts");
  copyMetric(feature, measurements, "average-workout-speed", "averageSpeedMps");
  copyMetric(feature, measurements, "max-workout-speed", "maxSpeedMps");
  const cadence = measurements.get("average-workout-cadence");
  if (cadence) feature.cadenceUnit = cadence.unit;
  return feature;
}

function projectWorkoutSplit(
  index: number,
  entity: CanonicalEntity,
  endedAt: string,
): WearableWorkoutSplitFeature {
  const measurements = measurementMap(entity);
  const split: WearableWorkoutSplitFeature & Record<string, unknown> = {
    endedAt,
    index,
  };
  copyMetric(split, measurements, "workout-split-distance", "distanceMeters");
  copyMetric(split, measurements, "workout-split-duration", "durationSeconds");
  copyMetric(split, measurements, "average-workout-split-heart-rate", "averageHeartRate");
  copyMetric(split, measurements, "average-workout-split-cadence", "averageCadence");
  copyMetric(split, measurements, "average-workout-split-power", "averagePowerWatts");
  const cadence = measurements.get("average-workout-split-cadence");
  if (cadence) split.cadenceUnit = cadence.unit;
  return split;
}

function measurementMap(
  entity: CanonicalEntity,
): Map<string, { unit: string; value: number }> {
  const measurements = Array.isArray(entity.attributes.measurements)
    ? entity.attributes.measurements
    : [];
  const mapped = new Map<string, { unit: string; value: number }>();
  for (const rawMeasurement of measurements) {
    const measurement = plainRecord(rawMeasurement);
    const metric = stringValue(measurement?.metric);
    const unit = stringValue(measurement?.unit);
    const value = finiteNumber(measurement?.value);
    if (metric && unit && value !== null) {
      mapped.set(metric, { unit, value });
    }
  }
  return mapped;
}

function copyMetric(
  output: Record<string, unknown>,
  measurements: ReadonlyMap<string, { unit: string; value: number }>,
  metric: string,
  outputKey: string,
): void {
  const measurement = measurements.get(metric);
  if (measurement) output[outputKey] = measurement.value;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
