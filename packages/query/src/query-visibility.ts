import type { CanonicalEntity } from "./canonical-entities.ts";
import { isDisplayGradeMetricSampleEntity } from "./metrics/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

function isDisplayGradeObservation(attributes: Record<string, unknown>): boolean {
  return (
    normalizedString(attributes.visibility) === "display" ||
    normalizedString(attributes.queryVisibility) === "default" ||
    attributes.canonicalFact === true
  );
}

function isDefaultHiddenMetricObservationEntity(entity: CanonicalEntity): boolean {
  if (entity.family !== "event" || entity.kind !== "observation") {
    return false;
  }

  const attributes = isRecord(entity.attributes) ? entity.attributes : {};
  const isMetricObservation =
    typeof attributes.metric === "string" &&
    typeof attributes.value === "number" &&
    Number.isFinite(attributes.value);

  return isMetricObservation && !isDisplayGradeObservation(attributes);
}

export function isDefaultProjectedQueryEntity(entity: CanonicalEntity): boolean {
  if (isDefaultHiddenMetricObservationEntity(entity)) {
    return false;
  }

  if (entity.family !== "sample") {
    return true;
  }

  return entity.kind === "metric_sample" && isDisplayGradeMetricSampleEntity(entity);
}

export function isSearchIndexedQueryEntity(entity: CanonicalEntity): boolean {
  return !isDefaultHiddenMetricObservationEntity(entity);
}
