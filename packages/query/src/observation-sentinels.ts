import { normalizeMetricKey } from "@murphai/health-metrics";

import type { CanonicalEntity } from "./canonical-entities.ts";

export function isDeletionSentinelObservation(entity: CanonicalEntity, metric = readString(entity.attributes.metric)): boolean {
  const externalRef = readRecord(entity.attributes.externalRef);
  if (readString(entity.attributes.source) !== "device" || readString(externalRef?.facet)?.toLowerCase() !== "deleted") {
    return false;
  }
  return readBoolean(entity.attributes.deleted) === true
    || (metric !== null && normalizeMetricKey(metric) === "external-resource-deleted");
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
