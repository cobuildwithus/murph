import type { CanonicalEntity } from "./canonical-entities.ts";
import { isDisplayGradeMetricSampleEntity } from "./metrics/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

export function isDisplayGradeObservation(attributes: Record<string, unknown>): boolean {
  return (
    normalizedString(attributes.visibility) === "display" ||
    normalizedString(attributes.queryVisibility) === "default" ||
    attributes.canonicalFact === true
  );
}

export function isDefaultProjectedEventRecord(input: {
  attributes: Record<string, unknown>;
  kind: string;
}): boolean {
  if (input.kind !== "observation") {
    return true;
  }

  const isMetricObservation =
    typeof input.attributes.metric === "string" &&
    typeof input.attributes.value === "number" &&
    Number.isFinite(input.attributes.value);

  return !isMetricObservation || isDisplayGradeObservation(input.attributes);
}

function isDefaultHiddenMetricObservationEntity(entity: CanonicalEntity): boolean {
  if (entity.family !== "event" || entity.kind !== "observation") {
    return false;
  }

  const attributes = isRecord(entity.attributes) ? entity.attributes : {};
  return !isDefaultProjectedEventRecord({ attributes, kind: entity.kind });
}

export function isDefaultProjectedQueryEntity(entity: CanonicalEntity): boolean {
  if (
    entity.family === "audit" ||
    isDefaultHiddenMetricObservationEntity(entity)
  ) {
    return false;
  }

  if (entity.family !== "sample") {
    return true;
  }

  return entity.kind === "metric_sample" && isDisplayGradeMetricSampleEntity(entity);
}

export function isSearchIndexedQueryEntity(entity: CanonicalEntity): boolean {
  return (
    entity.family !== "audit" &&
    !isDefaultHiddenMetricObservationEntity(entity)
  );
}
