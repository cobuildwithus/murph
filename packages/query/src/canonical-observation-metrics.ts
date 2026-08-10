import { normalizeMetricKey } from "@murphai/health-metrics";

import type { CanonicalEntity } from "./canonical-entities.ts";
import { isDeletionSentinelObservation } from "./observation-sentinels.ts";
import { readVaultSourceStrict } from "./vault-source.ts";

export interface CanonicalObservationMetricEntryFilters {
  from?: string;
  limit?: number | null;
  metrics?: readonly string[];
  to?: string;
}

export interface CanonicalObservationMetricEntry {
  eventId: string;
  metric: string;
  occurredAt: string;
  source: string | null;
  unit: string;
  value: number;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function observationEntry(
  entity: CanonicalEntity,
  metricSet: ReadonlySet<string> | null,
  filters: CanonicalObservationMetricEntryFilters,
): CanonicalObservationMetricEntry | null {
  if (
    entity.family !== "event"
    || entity.kind !== "observation"
    || isDeletionSentinelObservation(entity)
  ) {
    return null;
  }

  const occurredAt = entity.occurredAt;
  const rawMetric = readString(entity.attributes.metric);
  const unit = readString(entity.attributes.unit);
  const value = entity.attributes.value;
  if (
    !occurredAt
    || !rawMetric
    || !unit
    || typeof value !== "number"
    || !Number.isFinite(value)
  ) {
    return null;
  }

  const metric = normalizeMetricKey(rawMetric);
  if (!metric || (metricSet && !metricSet.has(metric))) {
    return null;
  }

  const effectiveDate = readString(entity.attributes.dayKey)
    ?? entity.date
    ?? occurredAt.slice(0, 10);
  if (
    (filters.from && effectiveDate < filters.from)
    || (filters.to && effectiveDate > filters.to)
  ) {
    return null;
  }

  return {
    eventId: entity.entityId,
    metric,
    occurredAt,
    source: readString(entity.attributes.source),
    unit,
    value,
  };
}

export async function listCanonicalObservationMetricEntries(
  vaultRoot: string,
  filters: CanonicalObservationMetricEntryFilters = {},
): Promise<CanonicalObservationMetricEntry[]> {
  const snapshot = await readVaultSourceStrict(vaultRoot);
  const metrics = filters.metrics
    ?.map(normalizeMetricKey)
    .filter((metric) => metric.length > 0);
  const metricSet = metrics && metrics.length > 0 ? new Set(metrics) : null;
  const entries = snapshot.entities
    .map((entity) => observationEntry(entity, metricSet, filters))
    .filter((entry): entry is CanonicalObservationMetricEntry => entry !== null)
    .sort((left, right) => {
      const occurredAtOrder = right.occurredAt.localeCompare(left.occurredAt);
      return occurredAtOrder !== 0
        ? occurredAtOrder
        : left.eventId.localeCompare(right.eventId);
    });

  if (filters.limit === null) {
    return entries;
  }

  const limit = typeof filters.limit === "number" && Number.isSafeInteger(filters.limit)
    ? Math.max(1, Math.min(10_000, filters.limit))
    : 1_000;
  return entries.slice(0, limit);
}
