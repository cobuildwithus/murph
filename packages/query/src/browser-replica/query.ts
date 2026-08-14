import {
  type BrowserVaultEntity,
  type BrowserVaultEntityFilters,
  type BrowserVaultExperimentRunCard,
  type BrowserVaultExperimentRunCardLookup,
  type BrowserVaultCoreQueryClient,
  type BrowserVaultCoreReplica,
  type BrowserVaultLabsQueryClient,
  type BrowserVaultLabsReplica,
  type BrowserVaultInteractiveMetricsQueryClient,
  type BrowserVaultInteractiveQueryClient,
  type BrowserVaultLabResultFilters,
  type BrowserVaultMetricFilters,
  type BrowserVaultMetricGoalProgressRow,
  type BrowserVaultMetricRow,
  type BrowserVaultMetricsQueryClient,
  type BrowserVaultMetricsReplica,
  type BrowserVaultMetricsIndexReplica,
  type BrowserVaultMetricSelectionFilters,
  type BrowserVaultMetricSelectionRow,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
  type BrowserVaultSearchFilters,
  type BrowserVaultTimelineFilters,
  type BrowserVaultTimelineRow,
} from "./shared.ts";
import {
  assembleBrowserVaultCoreReplica,
  assembleBrowserVaultLabsReplica,
  assembleBrowserVaultLoadedMetricRows,
  assembleBrowserVaultMetricsIndexReplica,
  assembleBrowserVaultMetricsReplica,
  assembleBrowserVaultReplicaShards,
  hasAllBrowserVaultMetricBuckets,
  type BrowserVaultCoreShard,
  type BrowserVaultLabsShard,
  type BrowserVaultMetricsShard,
  type BrowserVaultMetricBucketShard,
  type BrowserVaultReplicaShardSelection,
  type BrowserVaultReplicaShardSet,
  BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA,
} from "./shards.ts";
import {
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  canonicalizeBrowserVaultMetricKey,
  type BrowserVaultMetricBucketId,
} from "./metric-buckets.ts";
import {
  labResultRowMatchesFilters,
  sortBrowserVaultLabResultRows,
} from "./lab-results.ts";
import { metricRowMatchesFilters } from "./metric-points.ts";
import {
  normalizeMetricKey,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
} from "@murphai/health-metrics";

export function createBrowserVaultQueryClient(replica: BrowserVaultReplica): BrowserVaultQueryClient {
  return createBrowserVaultQueryClientAccess(deepFreezeBrowserVaultValue(
    normalizeBrowserVaultReplica(replica),
  ));
}

/** Internal producer path: the replica-under-construction must remain mutable. */
export function createBrowserVaultProjectionQueryClient(
  replica: BrowserVaultReplica,
): BrowserVaultQueryClient {
  return createBrowserVaultQueryClientAccess(normalizeBrowserVaultReplica(replica));
}

function normalizeBrowserVaultReplica(replica: BrowserVaultReplica): BrowserVaultQueryClient["replica"] {
  return {
    ...replica,
    experimentOutcomes: replica.experimentOutcomes ?? [],
    experimentRunCards: replica.experimentRunCards ?? [],
    hasLabBiomarkers: replica.hasLabBiomarkers ?? false,
  };
}

function createBrowserVaultQueryClientAccess(
  frozenReplica: BrowserVaultQueryClient["replica"],
): BrowserVaultQueryClient {
  return {
    capability: "core+metrics+labs",
    ...createCoreQueryAccess(frozenReplica),
    ...createMetricsQueryAccess(frozenReplica),
    ...createLabsQueryAccess(frozenReplica),
    replica: frozenReplica,
  };
}

export function createBrowserVaultCoreQueryClient(
  core: BrowserVaultCoreShard,
): BrowserVaultCoreQueryClient {
  const replica = deepFreezeBrowserVaultValue(assembleBrowserVaultCoreReplica(core));
  return {
    capability: "core",
    ...createCoreQueryAccess(replica),
    replica,
  };
}

export function createBrowserVaultMetricsQueryClient(
  core: BrowserVaultCoreShard,
  metrics: BrowserVaultMetricsShard,
  metricBuckets: Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>,
): BrowserVaultMetricsQueryClient {
  const replica = deepFreezeBrowserVaultValue(
    assembleBrowserVaultMetricsReplica(core, metrics, metricBuckets),
  );
  return {
    capability: "core+metrics",
    ...createCoreQueryAccess(replica),
    ...createMetricsQueryAccess(replica),
    replica,
  };
}

export class BrowserVaultMetricBucketUnavailableError extends Error {
  readonly bucketId: BrowserVaultMetricBucketId;
  readonly metricKey: string;

  constructor(metricKey: string, bucketId: BrowserVaultMetricBucketId) {
    super(`Browser vault metric bucket ${bucketId} is not loaded for ${metricKey}.`);
    this.name = "BrowserVaultMetricBucketUnavailableError";
    this.bucketId = bucketId;
    this.metricKey = metricKey;
  }
}

export function createBrowserVaultInteractiveMetricsQueryClient(
  core: BrowserVaultCoreShard,
  metrics: BrowserVaultMetricsShard,
  metricBuckets: Partial<Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>> = {},
): BrowserVaultInteractiveMetricsQueryClient {
  const replica = deepFreezeBrowserVaultValue(
    assembleBrowserVaultMetricsIndexReplica(core, metrics),
  );
  const loadedMetricBuckets = BROWSER_VAULT_METRIC_BUCKET_IDS.filter(
    (bucketId) => metricBuckets[bucketId] !== undefined,
  );
  const loadedRows = assembleBrowserVaultLoadedMetricRows(metrics, metricBuckets);
  const directoryByMetricKey = new Map(metrics.metricDirectory.map((entry) => [
    canonicalizeBrowserVaultMetricKey(entry.metricKey),
    entry,
  ]));
  const access = createMetricsQueryAccess(replica, loadedRows, (metricKey) => {
    const canonicalKey = canonicalizeBrowserVaultMetricKey(metricKey);
    const entry = directoryByMetricKey.get(canonicalKey);
    if (!entry) return;
    if (!metricBuckets[entry.bucketId]) {
      throw new BrowserVaultMetricBucketUnavailableError(canonicalKey, entry.bucketId);
    }
  });
  const loadedBucketSet = new Set(loadedMetricBuckets);
  return {
    capability: "core+metrics-partial",
    ...createCoreQueryAccess(replica),
    ...access,
    loadedMetricBuckets,
    metricCoverage: {
      get(metricKey: string) {
        const entry = directoryByMetricKey.get(canonicalizeBrowserVaultMetricKey(metricKey));
        if (!entry) return { bucketId: null, rowCount: 0, status: "loaded-empty" };
        if (!loadedBucketSet.has(entry.bucketId)) {
          return { bucketId: entry.bucketId, status: "unloaded" };
        }
        return entry.rowCount === 0
          ? { bucketId: entry.bucketId, rowCount: 0, status: "loaded-empty" }
          : { bucketId: entry.bucketId, rowCount: entry.rowCount, status: "loaded" };
      },
    },
    replica,
  };
}

export function createBrowserVaultInteractiveQueryClient(
  core: BrowserVaultCoreShard,
  metrics: BrowserVaultMetricsShard,
  labs: BrowserVaultLabsShard,
  metricBuckets: Partial<Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>> = {},
): BrowserVaultInteractiveQueryClient {
  const metricsClient = createBrowserVaultInteractiveMetricsQueryClient(
    core,
    metrics,
    metricBuckets,
  );
  const labsReplica = assembleBrowserVaultLabsReplica(core, labs);
  const replica = deepFreezeBrowserVaultValue({
    ...metricsClient.replica,
    labResultRows: labsReplica.labResultRows,
  });
  return {
    capability: "core+metrics-partial+labs",
    ...createCoreQueryAccess(replica),
    labResults: createLabsQueryAccess(labsReplica).labResults,
    loadedMetricBuckets: metricsClient.loadedMetricBuckets,
    metricCoverage: metricsClient.metricCoverage,
    metricGoals: metricsClient.metricGoals,
    metrics: metricsClient.metrics,
    metricSelections: metricsClient.metricSelections,
    replica,
  };
}

export function createBrowserVaultLabsQueryClient(
  core: BrowserVaultCoreShard,
  labs: BrowserVaultLabsShard,
): BrowserVaultLabsQueryClient {
  const replica = deepFreezeBrowserVaultValue(assembleBrowserVaultLabsReplica(core, labs));
  return {
    capability: "core+labs",
    ...createCoreQueryAccess(replica),
    ...createLabsQueryAccess(replica),
    replica,
  };
}

export interface BrowserVaultLoadedQueryClients {
  core: BrowserVaultCoreQueryClient;
  full: BrowserVaultQueryClient | null;
  interactiveMetrics: BrowserVaultInteractiveMetricsQueryClient | null;
  interactive: BrowserVaultInteractiveQueryClient | null;
  labs: BrowserVaultLabsQueryClient | null;
  metrics: BrowserVaultMetricsQueryClient | null;
}

export function createBrowserVaultLoadedQueryClients(
  shards: BrowserVaultReplicaShardSelection,
): BrowserVaultLoadedQueryClients {
  return {
    core: createBrowserVaultCoreQueryClient(shards.core),
    full: shards.metrics && shards.labs && hasAllBrowserVaultMetricBuckets(shards.metricBuckets)
      ? createBrowserVaultQueryClient(
          assembleBrowserVaultReplicaShards(toShardSet(
            shards.core,
            shards.metrics,
            shards.labs,
            shards.metricBuckets,
          )),
        )
      : null,
    interactiveMetrics: shards.metrics
      ? createBrowserVaultInteractiveMetricsQueryClient(
          shards.core,
          shards.metrics,
          shards.metricBuckets,
        )
      : null,
    interactive: shards.metrics && shards.labs
      ? createBrowserVaultInteractiveQueryClient(
          shards.core,
          shards.metrics,
          shards.labs,
          shards.metricBuckets,
        )
      : null,
    labs: shards.labs ? createBrowserVaultLabsQueryClient(shards.core, shards.labs) : null,
    metrics: shards.metrics && hasAllBrowserVaultMetricBuckets(shards.metricBuckets)
      ? createBrowserVaultMetricsQueryClient(shards.core, shards.metrics, shards.metricBuckets)
      : null,
  };
}

type BrowserVaultCoreQueryAccess = Pick<
  BrowserVaultCoreQueryClient,
  "entities" | "experimentRunCards" | "search" | "timeline"
>;
type BrowserVaultMetricsQueryAccess = Pick<
  BrowserVaultMetricsQueryClient,
  "metricGoals" | "metrics" | "metricSelections"
>;
type BrowserVaultLabsQueryAccess = Pick<BrowserVaultLabsQueryClient, "labResults">;

function createCoreQueryAccess(replica: BrowserVaultCoreReplica): BrowserVaultCoreQueryAccess {
  const byLookupId = new Map<string, BrowserVaultEntity>();
  const experimentRunCardById = new Map<string, BrowserVaultExperimentRunCard>();

  for (const entity of replica.entities) {
    byLookupId.set(entity.id, entity);
    for (const lookupId of entity.lookupIds) {
      byLookupId.set(lookupId, entity);
    }
  }
  for (const card of replica.experimentRunCards) {
    experimentRunCardById.set(card.id, card);
  }

  return {
    entities: {
      get(idOrLookupId: string) {
        return byLookupId.get(idOrLookupId) ?? null;
      },
      list(filters: BrowserVaultEntityFilters = {}) {
        return replica.entities.filter((entity) => matchesEntityFilters(entity, filters));
      },
    },
    experimentRunCards: {
      find(lookup: BrowserVaultExperimentRunCardLookup) {
        return replica.experimentRunCards.find((card) =>
          matchesExperimentRunCardLookup(card, lookup)
        ) ?? null;
      },
      get(experimentId: string) {
        return experimentRunCardById.get(experimentId) ?? null;
      },
      list() {
        return replica.experimentRunCards.slice();
      },
    },
    search(query: string, filters: BrowserVaultSearchFilters = {}) {
      const normalizedQuery = normalizeSearch(query);
      const familySet = filters.families ? new Set(filters.families) : null;

      if (normalizedQuery.length === 0) return [];

      return replica.searchRows.filter((row) => {
        if (familySet && !familySet.has(row.family)) return false;
        return normalizeSearch(row.text).includes(normalizedQuery);
      });
    },
    timeline: {
      list(filters: BrowserVaultTimelineFilters = {}) {
        return replica.timelineRows.filter((row) => matchesTimelineFilters(row, filters));
      },
    },
  };
}

function matchesExperimentRunCardLookup(
  card: BrowserVaultExperimentRunCard,
  lookup: BrowserVaultExperimentRunCardLookup,
): boolean {
  if (typeof lookup === "string") {
    return card.lookupKeys.experimentIds.includes(lookup)
      || card.lookupKeys.slugs.includes(lookup)
      || card.lookupKeys.protocolKeys.includes(lookup);
  }
  if (
    lookup.experimentId
    && card.lookupKeys.experimentIds.includes(lookup.experimentId)
  ) return true;
  if (lookup.slug && card.lookupKeys.slugs.includes(lookup.slug)) return true;
  return lookup.protocolKeys?.some((key) => card.lookupKeys.protocolKeys.includes(key))
    ?? false;
}

function createMetricsQueryAccess(
  replica: BrowserVaultMetricsReplica | BrowserVaultMetricsIndexReplica,
  metricRows?: readonly BrowserVaultMetricRow[],
  requireMetricLoaded?: (metricKey: string) => void,
): BrowserVaultMetricsQueryAccess {
  const metricSelectionById = new Map<string, BrowserVaultMetricSelectionRow>();
  const metricSelectionsByMetricKey = new Map<string, BrowserVaultMetricSelectionRow[]>();
  const metricSelectionsByBiomarkerKey = new Map<string, BrowserVaultMetricSelectionRow[]>();
  const resolvedMetricRows = metricRows
    ?? ("metricRows" in replica ? replica.metricRows : []);
  const sortedMetricRows = sortMetricRowsAsc(resolvedMetricRows);
  const metricRowsByMetricKey = new Map<string, BrowserVaultMetricRow[]>();
  const metricRowsByBiomarkerKey = new Map<string, BrowserVaultMetricRow[]>();

  for (const row of sortedMetricRows) {
    appendMetricRow(metricRowsByMetricKey, row.metricKey, row);
    if (row.biomarkerKey) appendMetricRow(metricRowsByBiomarkerKey, row.biomarkerKey, row);
  }

  for (const selection of replica.metricSelectionRows) {
    metricSelectionById.set(selection.id, selection);
    appendMetricSelection(metricSelectionsByMetricKey, selection.metricKey, selection);
    if (selection.biomarkerKey) {
      appendMetricSelection(metricSelectionsByBiomarkerKey, selection.biomarkerKey, selection);
    }
  }

  return {
    metricGoals: {
      progress(filters: { goalId?: string; metricKey?: string } = {}) {
        return replica.metricGoalProgressRows.filter((row) => matchesMetricGoalFilters(row, normalizeMetricGoalFilters(filters)));
      },
    },
    metrics: {
      latestRow(filters: BrowserVaultMetricFilters = {}) {
        const normalizedFilters = normalizeMetricFilters(filters);
        return matchingMetricRows(normalizedFilters).at(-1) ?? null;
      },
      list(filters: BrowserVaultMetricFilters = {}) {
        const normalizedFilters = normalizeMetricFilters(filters);
        return matchingMetricRows(normalizedFilters);
      },
      series(filters: BrowserVaultMetricFilters = {}) {
        const normalizedFilters = normalizeMetricFilters(filters);
        return matchingMetricRows(normalizedFilters);
      },
      seriesMany(filters: readonly BrowserVaultMetricFilters[]) {
        return filters.map((filter) => matchingMetricRows(normalizeMetricFilters(filter)));
      },
    },
    metricSelections: {
      get(idOrMetricKey: string) {
        const direct = metricSelectionById.get(idOrMetricKey);
        if (direct) return direct;
        const normalizedMetricKey = normalizeMetricFilterKey(idOrMetricKey);
        if (normalizedMetricKey) {
          return chooseDefaultMetricSelection(metricSelectionsByMetricKey.get(normalizedMetricKey) ?? [], normalizedMetricKey);
        }
        return chooseDefaultBiomarkerMetricSelection(metricSelectionsByBiomarkerKey.get(idOrMetricKey) ?? [], idOrMetricKey);
      },
      getByBiomarker(biomarkerKey: string) {
        return chooseDefaultBiomarkerMetricSelection(metricSelectionsByBiomarkerKey.get(biomarkerKey) ?? [], biomarkerKey);
      },
      list(filters: BrowserVaultMetricSelectionFilters = {}) {
        return replica.metricSelectionRows.filter((row) => matchesMetricSelectionFilters(row, normalizeMetricSelectionFilters(filters)));
      },
    },
  };

  function matchingMetricRows(filters: BrowserVaultMetricFilters): BrowserVaultMetricRow[] {
    if (requireMetricLoaded) {
      if (!filters.metricKey) {
        throw new TypeError("A metricKey is required when querying partially loaded browser vault metrics.");
      }
      requireMetricLoaded(filters.metricKey);
    }
    const candidates = filters.metricKey
      ? metricRowsByMetricKey.get(filters.metricKey) ?? []
      : filters.biomarkerKey
        ? metricRowsByBiomarkerKey.get(filters.biomarkerKey) ?? []
        : sortedMetricRows;
    return candidates.filter((row) => metricRowMatchesFilters(row, filters));
  }
}

function createLabsQueryAccess(replica: BrowserVaultLabsReplica): BrowserVaultLabsQueryAccess {
  return {
    labResults: {
      list(filters: BrowserVaultLabResultFilters = {}) {
        return sortBrowserVaultLabResultRows(
          replica.labResultRows.filter((row) => labResultRowMatchesFilters(row, filters)),
        );
      },
    },
  };
}

function toShardSet(
  core: BrowserVaultCoreShard,
  metrics: BrowserVaultMetricsShard,
  labs: BrowserVaultLabsShard,
  metricBuckets: Record<BrowserVaultMetricBucketId, BrowserVaultMetricBucketShard>,
): BrowserVaultReplicaShardSet {
  return {
    core,
    labs,
    metricBuckets,
    metrics,
    schema: BROWSER_VAULT_REPLICA_SHARD_SET_SCHEMA,
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

function appendMetricRow(
  map: Map<string, BrowserVaultMetricRow[]>,
  key: string,
  row: BrowserVaultMetricRow,
): void {
  const existing = map.get(key) ?? [];
  existing.push(row);
  map.set(key, existing);
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
