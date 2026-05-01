import {
  type BrowserVaultEntity,
  type BrowserVaultEntityFilters,
  type BrowserVaultMetricDayRow,
  type BrowserVaultMetricFilters,
  type BrowserVaultMetricRow,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
  type BrowserVaultSearchFilters,
  type BrowserVaultTimelineFilters,
  type BrowserVaultTimelineRow,
} from "./shared.ts";

export function createBrowserVaultQueryClient(replica: BrowserVaultReplica): BrowserVaultQueryClient {
  const frozenReplica = deepFreezeBrowserVaultValue(replica);
  const byLookupId = new Map<string, BrowserVaultEntity>();

  for (const entity of frozenReplica.entities) {
    byLookupId.set(entity.id, entity);
    for (const lookupId of entity.lookupIds) {
      byLookupId.set(lookupId, entity);
    }
  }

  return {
    entities: {
      get(idOrLookupId) {
        return byLookupId.get(idOrLookupId) ?? null;
      },
      list(filters = {}) {
        return frozenReplica.entities.filter((entity) => matchesEntityFilters(entity, filters));
      },
    },
    metricDays: {
      list(filters = {}) {
        return frozenReplica.metricDayRows.filter((row) => matchesMetricDayFilters(row, filters));
      },
    },
    metrics: {
      latest(filters = {}) {
        return frozenReplica.metricRows.find((row) => matchesMetricFilters(row, filters)) ?? null;
      },
      list(filters = {}) {
        return frozenReplica.metricRows.filter((row) => matchesMetricFilters(row, filters));
      },
      series(filters = {}) {
        return frozenReplica.metricRows.filter((row) => matchesMetricFilters(row, filters)).slice().reverse();
      },
    },
    replica: frozenReplica,
    search(query, filters = {}) {
      const normalizedQuery = normalizeSearch(query);
      const familySet = filters.families ? new Set(filters.families) : null;

      if (normalizedQuery.length === 0) {
        return [];
      }

      return frozenReplica.searchRows.filter((row) => {
        if (familySet && !familySet.has(row.family)) {
          return false;
        }

        return normalizeSearch(row.text).includes(normalizedQuery);
      });
    },
    timeline: {
      list(filters = {}) {
        return frozenReplica.timelineRows.filter((row) => matchesTimelineFilters(row, filters));
      },
    },
  };
}

function matchesEntityFilters(entity: BrowserVaultEntity, filters: BrowserVaultEntityFilters): boolean {
  if (filters.ids && !filters.ids.some((id) => entity.lookupIds.includes(id) || entity.id === id)) {
    return false;
  }
  if (filters.families && !filters.families.includes(entity.family)) {
    return false;
  }
  if (filters.kinds && !filters.kinds.includes(entity.kind)) {
    return false;
  }
  if (filters.statuses && (!entity.status || !filters.statuses.includes(entity.status))) {
    return false;
  }
  if (filters.tags && !filters.tags.every((tag) => entity.tags.includes(tag))) {
    return false;
  }
  if (filters.from && (entity.date ?? "") < filters.from) {
    return false;
  }
  if (filters.to && (entity.date ?? "9999-12-31") > filters.to) {
    return false;
  }
  if (filters.text) {
    return normalizeSearch([entity.title, entity.bodyPreview, entity.tags.join(" ")].join(" "))
      .includes(normalizeSearch(filters.text));
  }

  return true;
}

function matchesMetricFilters(row: BrowserVaultMetricRow, filters: BrowserVaultMetricFilters): boolean {
  if (filters.domain && row.domain !== filters.domain) {
    return false;
  }
  if (filters.metric && row.metric !== filters.metric) {
    return false;
  }
  if (filters.from && row.date < filters.from) {
    return false;
  }
  if (filters.to && row.date > filters.to) {
    return false;
  }

  return true;
}

function matchesMetricDayFilters(row: BrowserVaultMetricDayRow, filters: BrowserVaultMetricFilters): boolean {
  if (filters.domain && row.domain !== filters.domain) {
    return false;
  }
  if (filters.metric && !Object.hasOwn(row.metrics, filters.metric)) {
    return false;
  }
  if (filters.from && row.date < filters.from) {
    return false;
  }
  if (filters.to && row.date > filters.to) {
    return false;
  }

  return true;
}

function matchesTimelineFilters(row: BrowserVaultTimelineRow, filters: BrowserVaultTimelineFilters): boolean {
  if (filters.families && !filters.families.includes(row.family)) {
    return false;
  }
  if (filters.kinds && !filters.kinds.includes(row.kind)) {
    return false;
  }
  if (filters.tags && !filters.tags.every((tag) => row.tags.includes(tag))) {
    return false;
  }
  if (filters.from && row.date < filters.from) {
    return false;
  }
  if (filters.to && row.date > filters.to) {
    return false;
  }

  return true;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function deepFreezeBrowserVaultValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return value;
  }

  seen.add(objectValue);

  for (const nestedValue of Object.values(objectValue as Record<string, unknown>)) {
    deepFreezeBrowserVaultValue(nestedValue, seen);
  }

  return Object.freeze(objectValue) as T;
}
