import type { MetricPoint } from "@murphai/health-metrics";
import { withCanonicalWriteLock } from "@murphai/core";

import { buildMetricProjection } from "./metrics/projection.ts";
import { createVaultReadModel } from "./read-model.ts";
import { isDefaultProjectedQueryEntity } from "./query-visibility.ts";
import { readVaultSourceStrict } from "./vault-source.ts";
import type { QueryMetricPointFilters } from "./query-projection-types.ts";
import {
  normalizeMetricPointFilters,
  normalizeMetricPointLimit,
  projectMetricPointForQuery,
} from "./projection/metric-store.ts";

/** One canonical read for experiment analysis, without rebuilding the search cache. */
export async function readExperimentQuerySource(vaultRoot: string) {
  const snapshot = await withCanonicalWriteLock(vaultRoot, () => readVaultSourceStrict(vaultRoot));
  const rawModel = createVaultReadModel({ ...snapshot, vaultRoot });
  const readModel = createVaultReadModel({
    ...snapshot,
    vaultRoot,
    entities: snapshot.entities.filter(isDefaultProjectedQueryEntity),
  });
  let metricPoints: MetricPoint[] | undefined;

  return {
    readModel,
    listMetricPoints(filtersList: readonly QueryMetricPointFilters[]): MetricPoint[] {
      if (filtersList.length === 0) return [];
      // Reuse only within this read. A subsequent call rereads canonical writes.
      metricPoints ??= buildMetricProjection(rawModel).metricPoints.sort(compareMetricPoints);
      const selected = new Map<string, MetricPoint>();
      for (const input of filtersList) {
        const filters = normalizeMetricPointFilters(input);
        const limit = filters.limit === null ? Infinity : normalizeMetricPointLimit(filters.limit ?? 1_000);
        let count = 0;
        for (const point of metricPoints) {
          if (!matchesMetricPoint(point, filters)) continue;
          selected.set(point.id, point);
          if (++count >= limit) break;
        }
      }
      return [...selected.values()].map(projectMetricPointForQuery);
    },
  };
}

function matchesMetricPoint(point: MetricPoint, filters: QueryMetricPointFilters): boolean {
  return (!filters.metricKey || point.metricKey === filters.metricKey)
    && (!filters.biomarkerKey || point.biomarkerKey === filters.biomarkerKey)
    && (!filters.from || point.effectiveDate >= filters.from)
    && (!filters.to || point.effectiveDate <= filters.to);
}

function compareMetricPoints(left: MetricPoint, right: MetricPoint): number {
  // Match SQLite's binary ORDER BY, including the stable id tie-breaker.
  for (const [a, b] of [[right.effectiveDate, left.effectiveDate], [right.observedAt, left.observedAt], [left.id, right.id]]) {
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}
