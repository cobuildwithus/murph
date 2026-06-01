import {
  type BrowserVaultEntity,
  type BrowserVaultEntityFilters,
  type BrowserVaultMetricFilters,
  type BrowserVaultMetricGoalProgressRow,
  type BrowserVaultMetricRow,
  type BrowserVaultMetricSelectionFilters,
  type BrowserVaultMetricSelectionRow,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
  type BrowserVaultSearchFilters,
  type BrowserVaultTimelineFilters,
  type BrowserVaultTimelineRow,
} from "./shared.ts";
import { metricRowMatchesFilters } from "./metric-points.ts";
import {
  normalizeMetricKey,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
} from "@murphai/health-metrics";

export function createBrowserVaultQueryClient(replica: BrowserVaultReplica): BrowserVaultQueryClient {
  const frozenReplica = deepFreezeBrowserVaultValue(replica);
  const byLookupId = new Map<string, BrowserVaultEntity>();
  const metricSelectionById = new Map<string, BrowserVaultMetricSelectionRow>();
  const metricSelectionsByMetricKey = new Map<string, BrowserVaultMetricSelectionRow[]>();
  const metricSelectionsByBiomarkerKey = new Map<string, BrowserVaultMetricSelectionRow[]>();

  for (const entity of frozenReplica.entities) {
    byLookupId.set(entity.id, entity);
    for (const lookupId of entity.lookupIds) {
      byLookupId.set(lookupId, entity);
    }
  }

  for (const selection of frozenReplica.metricSelectionRows) {
    metricSelectionById.set(selection.id, selection);
    appendMetricSelection(metricSelectionsByMetricKey, selection.metricKey, selection);
    if (selection.biomarkerKey) {
      appendMetricSelection(metricSelectionsByBiomarkerKey, selection.biomarkerKey, selection);
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
    metricGoals: {
      progress(filters = {}) {
        return frozenReplica.metricGoalProgressRows.filter((row) => matchesMetricGoalFilters(row, normalizeMetricGoalFilters(filters)));
      },
    },
    metrics: {
      latestRow(filters = {}) {
        const normalizedFilters = normalizeMetricFilters(filters);
        return sortMetricRowsAsc(frozenReplica.metricRows.filter((row) => metricRowMatchesFilters(row, normalizedFilters))).at(-1) ?? null;
      },
      list(filters = {}) {
        const normalizedFilters = normalizeMetricFilters(filters);
        return sortMetricRowsAsc(frozenReplica.metricRows.filter((row) => metricRowMatchesFilters(row, normalizedFilters)));
      },
      series(filters = {}) {
        const normalizedFilters = normalizeMetricFilters(filters);
        return sortMetricRowsAsc(frozenReplica.metricRows.filter((row) => metricRowMatchesFilters(row, normalizedFilters)));
      },
      seriesMany(filters) {
        return filters.map((filter) => {
          const normalizedFilters = normalizeMetricFilters(filter);
          return sortMetricRowsAsc(frozenReplica.metricRows.filter((row) => metricRowMatchesFilters(row, normalizedFilters)));
        });
      },
    },
    metricSelections: {
      get(idOrMetricKey) {
        const direct = metricSelectionById.get(idOrMetricKey);
        if (direct) return direct;
        const normalizedMetricKey = normalizeMetricFilterKey(idOrMetricKey);
        if (normalizedMetricKey) {
          return chooseDefaultMetricSelection(metricSelectionsByMetricKey.get(normalizedMetricKey) ?? [], normalizedMetricKey);
        }
        return chooseDefaultBiomarkerMetricSelection(metricSelectionsByBiomarkerKey.get(idOrMetricKey) ?? [], idOrMetricKey);
      },
      getByBiomarker(biomarkerKey) {
        return chooseDefaultBiomarkerMetricSelection(metricSelectionsByBiomarkerKey.get(biomarkerKey) ?? [], biomarkerKey);
      },
      list(filters = {}) {
        return frozenReplica.metricSelectionRows.filter((row) => matchesMetricSelectionFilters(row, normalizeMetricSelectionFilters(filters)));
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
  if (filters.ids && !filters.ids.some((id) => entity.lookupIds.includes(id) || entity.id === id)) return false;
  if (filters.families && !filters.families.includes(entity.family)) return false;
  if (filters.kinds && !filters.kinds.includes(entity.kind)) return false;
  if (filters.statuses && (!entity.status || !filters.statuses.includes(entity.status))) return false;
  if (filters.tags && !filters.tags.every((tag) => entity.tags.includes(tag))) return false;
  if (filters.from && (entity.date ?? "") < filters.from) return false;
  if (filters.to && (entity.date ?? "9999-12-31") > filters.to) return false;
  if (filters.text) {
    return normalizeSearch([entity.title, entity.bodyPreview, entity.tags.join(" ")].join(" "))
      .includes(normalizeSearch(filters.text));
  }
  return true;
}

function matchesMetricSelectionFilters(row: BrowserVaultMetricSelectionRow, filters: BrowserVaultMetricSelectionFilters): boolean {
  if (filters.metricKey && row.metricKey !== normalizeMetricFilterKey(filters.metricKey)) return false;
  if (filters.biomarkerKey && row.biomarkerKey !== filters.biomarkerKey) return false;
  return true;
}

function sortMetricRowsAsc(rows: readonly BrowserVaultMetricRow[]): BrowserVaultMetricRow[] {
  return rows.slice().sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.observedAt !== right.observedAt) return left.observedAt.localeCompare(right.observedAt);
    return left.id.localeCompare(right.id);
  });
}

function matchesMetricGoalFilters(
  row: BrowserVaultMetricGoalProgressRow,
  filters: { goalId?: string; metricKey?: string },
): boolean {
  if (filters.goalId && row.goalId !== filters.goalId) return false;
  if (filters.metricKey && row.metricKey !== normalizeMetricFilterKey(filters.metricKey)) return false;
  return true;
}

function normalizeMetricFilterKey(metricKey?: string): string | undefined {
  if (!metricKey) return undefined;
  return resolveMetricDefinition(metricKey)?.key ?? normalizeMetricKey(metricKey);
}

function normalizeMetricFilters(filters: BrowserVaultMetricFilters): BrowserVaultMetricFilters {
  const metricKey = normalizeMetricFilterKey(filters.metricKey);
  return {
    ...filters,
    ...(metricKey ? { metricKey } : {}),
  };
}

function normalizeMetricSelectionFilters(filters: BrowserVaultMetricSelectionFilters): BrowserVaultMetricSelectionFilters {
  const metricKey = normalizeMetricFilterKey(filters.metricKey);
  return {
    ...filters,
    ...(metricKey ? { metricKey } : {}),
  };
}

function normalizeMetricGoalFilters(filters: { goalId?: string; metricKey?: string }): { goalId?: string; metricKey?: string } {
  const metricKey = normalizeMetricFilterKey(filters.metricKey);
  return {
    ...filters,
    ...(metricKey ? { metricKey } : {}),
  };
}

function matchesTimelineFilters(row: BrowserVaultTimelineRow, filters: BrowserVaultTimelineFilters): boolean {
  if (filters.families && !filters.families.includes(row.family)) return false;
  if (filters.kinds && !filters.kinds.includes(row.kind)) return false;
  if (filters.tags && !filters.tags.every((tag) => row.tags.includes(tag))) return false;
  if (filters.from && row.date < filters.from) return false;
  if (filters.to && row.date > filters.to) return false;
  return true;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function deepFreezeBrowserVaultValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const nestedValue of Object.values(objectValue as Record<string, unknown>)) {
    deepFreezeBrowserVaultValue(nestedValue, seen);
  }
  return Object.freeze(objectValue) as T;
}

function appendMetricSelection(
  map: Map<string, BrowserVaultMetricSelectionRow[]>,
  metricKey: string,
  selection: BrowserVaultMetricSelectionRow,
): void {
  const existing = map.get(metricKey) ?? [];
  existing.push(selection);
  map.set(metricKey, existing);
}

function chooseDefaultMetricSelection(rows: readonly BrowserVaultMetricSelectionRow[], metricKey: string): BrowserVaultMetricSelectionRow | null {
  if (rows.length === 0) return null;
  const definition = resolveMetricDefinition(metricKey);
  return rows.find((row) => row.biomarkerKey === definition?.biomarkerKey)
    ?? rows.find((row) => row.biomarkerKey === null)
    ?? rows[0]
    ?? null;
}

function chooseDefaultBiomarkerMetricSelection(
  rows: readonly BrowserVaultMetricSelectionRow[],
  biomarkerKey: string,
): BrowserVaultMetricSelectionRow | null {
  if (rows.length === 0) return null;
  const primaryMetricKey = resolveMetricDefinitionForBiomarker(biomarkerKey)?.key;
  if (primaryMetricKey) {
    const primarySelection = chooseDefaultMetricSelection(
      rows.filter((row) => row.metricKey === primaryMetricKey),
      primaryMetricKey,
    );
    if (primarySelection) return primarySelection;
  }

  return rows.find((row) => row.biomarkerKey === biomarkerKey && row.status !== "no_data")
    ?? rows.find((row) => row.biomarkerKey === biomarkerKey)
    ?? rows[0]
    ?? null;
}
