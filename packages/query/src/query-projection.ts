import {
  isValidIanaTimeZone,
} from "@murphai/contracts";
import {
  selectMetricGoalProgress,
  selectMetricValue,
  resolveMetricDefinition,
  resolveWearableCanonicalMetricKey,
  type MetricGoalProgress,
  type MetricPoint,
  type MetricSelection,
} from "@murphai/health-metrics";

import type {
  QueryCanonicalEntityFilters,
  QueryMetricPointFilters,
  QueryMetricTargetRow,
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";
import { isDefaultProjectedQueryEntity } from "./query-visibility.ts";
import {
  explainWearableDriftFromBundle,
  summarizeWearableActivityFromBundle,
  summarizeWearableBodyStateFromBundle,
  summarizeWearableDayFromBundle,
  summarizeWearableLatestFromBundle,
  summarizeWearableMetricLatestFromBundle,
  summarizeWearableMetricLatestFromBundleAndPoints,
  summarizeWearableMetricTrendFromBundle,
  summarizeWearableMetricTrendFromBundleAndPoints,
  summarizeWearableRecoveryFromBundle,
  summarizeWearableSleepFromBundle,
  summarizeWearableSleepPatternFromBundle,
  summarizeWearableSourceHealthFromBundle,
  type ProjectedWearableActivitySummary,
  type ProjectedWearableBodyStateSummary,
  type ProjectedWearableDaySummary,
  type ProjectedWearableDriftSummary,
  type ProjectedWearableLatestSummary,
  type ProjectedWearableMetricLatestSummary,
  type ProjectedWearableMetricTrendSummary,
  type ProjectedWearableRecoverySummary,
  type ProjectedWearableSleepSummary,
  type ProjectedWearableSourceHealthSummary,
  type WearableMetricSummaryFilters,
  type WearableSleepPatternFilters,
  type WearableSleepPatternSummary,
  type WearableSummaryFilters,
} from "./wearables.ts";
import {
  listCanonicalSourceManifest,
  readVaultSourceStrict,
  readVaultSourceTolerant,
  type QuerySourceManifestEntry,
  type VaultSourceSnapshot,
} from "./vault-source.ts";
import type {
  SearchFilters,
  SearchResult,
} from "./search-shared.ts";
import {
  listStoredCanonicalEntities,
  readStoredVaultMetadata,
  readStoredVaultSource,
} from "./projection/entity-store.ts";
import {
  emptyQueryProjectionStatus,
  readProjectionStatus,
} from "./projection/freshness.ts";
import {
  composePublicWearableSummaryBundleFromStoredRows,
} from "./projection/wearable-summary-compose.ts";
import {
  listStoredMetricPoints,
  listStoredMetricPointsBatch,
  listStoredMetricTargets,
  metricPointFiltersForGoalTarget,
  normalizeMetricPointFilters,
} from "./projection/metric-store.ts";
import {
  buildWearableMetricEvidenceFromBundle,
} from "./metrics/projection.ts";
import {
  extractMetricPointsFromMetricRows,
} from "./metrics/index.ts";
import {
  rebuildQueryProjectionWithManifest,
} from "./projection/rebuild.ts";
import {
  searchQueryProjection,
} from "./projection/search-store.ts";
import {
  currentQueryProjectionLocation,
  type QueryProjectionLocation,
} from "./projection/schema.ts";
import {
  readWearableSummaryRows,
} from "./projection/wearable-summary-store.ts";
import { resolveWearableSleepPatternReadFilters } from "./wearables/sleep-pattern.ts";
import { createVaultReadModel } from "./read-model.ts";
import {
  buildPersonalPatternReportFromWearableBundleAndMetricPoints,
  type PersonalPatternReport,
} from "./personal-patterns.ts";

export type {
  QueryCanonicalEntityFilters,
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
  QueryMetricPointFilters,
  QueryMetricTargetRow,
} from "./query-projection-types.ts";

function readStoredPublicWearableSummaryBundle(
  location: QueryProjectionLocation,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
) {
  return composePublicWearableSummaryBundleFromStoredRows(
    readWearableSummaryRows(location, { providers: filters.providers }),
    filters,
  );
}

const pendingQueryProjectionRebuilds = new Map<string, Promise<void>>();

export async function getQueryProjectionStatus(
  vaultRoot: string,
): Promise<QueryProjectionStatus> {
  const currentManifest = await listCanonicalSourceManifest(vaultRoot);
  return (
    await readProjectionStatus(currentQueryProjectionLocation(vaultRoot), currentManifest)
  ) ?? emptyQueryProjectionStatus();
}

export async function rebuildQueryProjection(
  vaultRoot: string,
): Promise<RebuildQueryProjectionResult> {
  const currentManifest = await listCanonicalSourceManifest(vaultRoot);
  return rebuildQueryProjectionWithManifest(vaultRoot, currentManifest);
}

export async function loadProjectedVaultSource(
  vaultRoot: string,
): Promise<VaultSourceSnapshot> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return readStoredVaultSource(location);
}

export async function listCanonicalEntitiesRuntime(
  vaultRoot: string,
  filters: QueryCanonicalEntityFilters = {},
): Promise<import("./canonical-entities.ts").CanonicalEntity[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return listStoredCanonicalEntities(location, filters);
}

export async function loadProjectedVaultSourceTolerant(
  vaultRoot: string,
): Promise<VaultSourceSnapshot> {
  const snapshot = await readVaultSourceTolerant(vaultRoot);
  return {
    metadata: snapshot.metadata,
    entities: snapshot.entities.filter(isDefaultProjectedQueryEntity),
  };
}

export async function searchVaultRuntime(
  vaultRoot: string,
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResult> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return searchQueryProjection(location, query, filters);
}

export async function listMetricPointsRuntime(
  vaultRoot: string,
  filters: QueryMetricPointFilters = {},
): Promise<MetricPoint[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return listStoredMetricPoints(location, normalizeMetricPointFilters(filters));
}

export async function listMetricPointsBatchRuntime(
  vaultRoot: string,
  filtersList: readonly QueryMetricPointFilters[],
): Promise<MetricPoint[]> {
  if (filtersList.length === 0) {
    return [];
  }

  const location = await ensureFreshQueryProjection(vaultRoot);
  return listStoredMetricPointsBatch(
    location,
    filtersList.map(normalizeMetricPointFilters),
  );
}

export async function listMetricPointsByPublicSourceRuntime(
  vaultRoot: string,
  input: {
    from?: string;
    metricKeys: readonly string[];
    providers: readonly string[];
    to?: string;
  },
): Promise<Array<{ points: MetricPoint[]; provider: string }>> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const metricKeys = new Set(input.metricKeys);
  return input.providers.map((provider) => {
    const bundle = readStoredPublicWearableSummaryBundle(location, {
      ...(input.from ? { from: input.from } : {}),
      providers: [provider],
      ...(input.to ? { to: input.to } : {}),
    });
    const points = extractMetricPointsFromMetricRows(
      buildWearableMetricEvidenceFromBundle(bundle),
    ).filter((point) =>
      metricKeys.has(point.metricKey)
      && (input.from === undefined || point.effectiveDate >= input.from)
      && (input.to === undefined || point.effectiveDate <= input.to)
    );
    return { points, provider };
  });
}

export async function summarizeWearableDayRuntime(
  vaultRoot: string,
  date: string,
  filters: Omit<WearableSummaryFilters, "date" | "from" | "to"> = {},
): Promise<ProjectedWearableDaySummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, {
    date,
    providers: filters.providers,
  });
  return summarizeWearableDayFromBundle(bundle, date);
}

export async function summarizeWearableLatestRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableLatestSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  return summarizeWearableLatestFromBundle(bundle, filters);
}

export async function summarizeWearableMetricLatestRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableMetricLatestSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  const summary = summarizeWearableMetricLatestFromBundle(bundle, metric, filters);
  if (summary?.value !== null && summary !== null) {
    return summary;
  }

  const metricPoints = listStoredWearableFallbackMetricPoints(location, metric, filters);
  const fallback = summarizeWearableMetricLatestFromBundleAndPoints(
    bundle,
    metric,
    metricPoints,
    filters,
  );
  return fallback ? projectWearableMetricLatestSummary(fallback) : null;
}

export async function summarizeWearableMetricTrendRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableMetricTrendSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  const summary = summarizeWearableMetricTrendFromBundle(bundle, metric, filters);
  if (summary?.value !== null && summary !== null) {
    return summary;
  }

  const metricPoints = listStoredWearableFallbackMetricPoints(location, metric, filters);
  const fallback = summarizeWearableMetricTrendFromBundleAndPoints(
    bundle,
    metric,
    metricPoints,
    filters,
  );
  return fallback ? projectWearableMetricTrendSummary(fallback) : null;
}

function listStoredWearableFallbackMetricPoints(
  location: QueryProjectionLocation,
  metric: string,
  filters: WearableMetricSummaryFilters,
): MetricPoint[] {
  const wearableMetric = resolveWearableCanonicalMetricKey(metric);
  const metricKey = wearableMetric ? resolveMetricDefinition(wearableMetric)?.key : null;
  if (!metricKey) {
    return [];
  }

  const windowDays = Number.isInteger(filters.windowDays) && (filters.windowDays ?? 0) > 0
    ? filters.windowDays as number
    : 7;
  return listStoredMetricPoints(location, normalizeMetricPointFilters({
    from: filters.date ?? filters.from,
    limit: Math.min(10_000, Math.max(100, windowDays * 20)),
    metricKey,
    to: filters.date ?? filters.to,
  }));
}

function projectWearableMetricLatestSummary(
  summary: ReturnType<typeof summarizeWearableMetricLatestFromBundleAndPoints> & {},
): ProjectedWearableMetricLatestSummary {
  return {
    ...summary,
    paths: [],
    recordIds: [],
  };
}

function projectWearableMetricTrendSummary(
  summary: ReturnType<typeof summarizeWearableMetricTrendFromBundleAndPoints> & {},
): ProjectedWearableMetricTrendSummary {
  return {
    ...projectWearableMetricLatestSummary(summary),
    points: summary.points.map((point) => ({
      ...point,
      paths: [],
      recordIds: [],
    })),
  };
}

export async function explainWearableDriftRuntime(
  vaultRoot: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableDriftSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  return explainWearableDriftFromBundle(bundle, filters);
}

export async function summarizeWearableSleepRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableSleepSummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  return summarizeWearableSleepFromBundle(bundle, filters);
}

export async function summarizeWearableSleepPatternRuntime(
  vaultRoot: string,
  filters: WearableSleepPatternFilters = {},
): Promise<WearableSleepPatternSummary> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const metadata = filters.timeZone === undefined
    ? readStoredVaultMetadata(location)
    : null;
  const vaultTimeZone = typeof metadata?.timezone === "string"
    && isValidIanaTimeZone(metadata.timezone)
    ? metadata.timezone
    : undefined;
  const resolvedFilters = filters.timeZone === undefined && vaultTimeZone
    ? { ...filters, timeZone: vaultTimeZone }
    : filters;
  const readFilters = resolveWearableSleepPatternReadFilters(resolvedFilters);
  const bundle = composePublicWearableSummaryBundleFromStoredRows(
    readWearableSummaryRows(location, {
      ...readFilters,
      summaryKinds: ["sleep", "source_health"],
    }),
    readFilters,
    { retainSourceHealthOutsideDateFilters: true },
  );
  return summarizeWearableSleepPatternFromBundle(bundle, resolvedFilters, {
    reportingTimeZoneSource: filters.timeZone !== undefined
      ? "user_filter"
      : vaultTimeZone
        ? "vault_metadata"
        : undefined,
  });
}

export async function buildPersonalPatternReportRuntime(
  vaultRoot: string,
  options: { asOf?: Date | string; windowDays?: number } = {},
): Promise<PersonalPatternReport> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const snapshot = readStoredVaultSource(location);
  const vault = createVaultReadModel({
    entities: snapshot.entities,
    metadata: snapshot.metadata,
    vaultRoot,
  });
  const wearableBundle = readStoredPublicWearableSummaryBundle(location, {});
  const metricPoints = listStoredMetricPoints(
    location,
    normalizeMetricPointFilters({ limit: null }),
  );
  return buildPersonalPatternReportFromWearableBundleAndMetricPoints(
    vault,
    wearableBundle,
    metricPoints,
    options,
  );
}

export async function summarizeWearableActivityRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableActivitySummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  return summarizeWearableActivityFromBundle(bundle, filters);
}

export async function summarizeWearableBodyStateRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableBodyStateSummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  return summarizeWearableBodyStateFromBundle(bundle, filters);
}

export async function summarizeWearableRecoveryRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableRecoverySummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  return summarizeWearableRecoveryFromBundle(bundle, filters);
}

export async function summarizeWearableSourceHealthRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableSourceHealthSummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredPublicWearableSummaryBundle(location, filters);
  return summarizeWearableSourceHealthFromBundle(bundle, filters);
}

export async function selectMetricRuntime(input: {
  biomarkerKey?: string;
  metricKey?: string;
  now?: string;
  vaultRoot: string;
}): Promise<MetricSelection> {
  const filters = normalizeMetricPointFilters({
    biomarkerKey: input.biomarkerKey,
    metricKey: input.metricKey,
  });
  const points = await listMetricPointsRuntime(input.vaultRoot, filters);
  return selectMetricValue({
    biomarkerKey: filters.biomarkerKey,
    metricKey: filters.metricKey,
    now: input.now,
    points,
  });
}

export async function listMetricTargetsRuntime(vaultRoot: string): Promise<QueryMetricTargetRow[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return listStoredMetricTargets(location);
}

export async function selectMetricGoalProgressRuntime(input: {
  goalId: string;
  now?: string;
  targetId: string;
  vaultRoot: string;
}): Promise<MetricGoalProgress | null> {
  const targets = await listMetricTargetsRuntime(input.vaultRoot);
  const target = targets.find((entry) => entry.goalId === input.goalId && entry.target.targetId === input.targetId);
  if (!target) {
    return null;
  }

  const points = await listMetricPointsRuntime(
    input.vaultRoot,
    metricPointFiltersForGoalTarget(target.target, input.now),
  );
  return selectMetricGoalProgress({ goalId: target.goalId, now: input.now, points, target: target.target });
}

async function ensureFreshQueryProjection(
  vaultRoot: string,
  readSource: (vaultRoot: string) => Promise<VaultSourceSnapshot> = readVaultSourceStrict,
): Promise<QueryProjectionLocation> {
  const location = currentQueryProjectionLocation(vaultRoot);
  const currentManifest = await listCanonicalSourceManifest(vaultRoot);
  const status = await readProjectionStatus(location, currentManifest);

  if (!status?.fresh) {
    await rebuildQueryProjectionWithManifestOnce({
      currentManifest,
      location,
      readSource,
      vaultRoot,
    });
    const rebuiltStatus = await readProjectionStatus(location, currentManifest);

    if (!rebuiltStatus?.fresh) {
      const refreshedManifest = await listCanonicalSourceManifest(vaultRoot);
      const refreshedStatus = await readProjectionStatus(location, refreshedManifest);

      if (!refreshedStatus?.fresh) {
        await rebuildQueryProjectionWithManifestOnce({
          currentManifest: refreshedManifest,
          location,
          readSource,
          vaultRoot,
        });
      }
    }
  }

  return location;
}

async function rebuildQueryProjectionWithManifestOnce(input: {
  currentManifest: readonly QuerySourceManifestEntry[];
  location: QueryProjectionLocation;
  readSource: (vaultRoot: string) => Promise<VaultSourceSnapshot>;
  vaultRoot: string;
}): Promise<void> {
  const key = input.location.absolutePath;
  const pending = pendingQueryProjectionRebuilds.get(key);

  if (pending) {
    await pending;
    return;
  }

  const rebuild = rebuildQueryProjectionWithManifest(
    input.vaultRoot,
    input.currentManifest,
    input.location,
    input.readSource,
  ).then(() => undefined);

  pendingQueryProjectionRebuilds.set(key, rebuild);

  try {
    await rebuild;
  } finally {
    if (pendingQueryProjectionRebuilds.get(key) === rebuild) {
      pendingQueryProjectionRebuilds.delete(key);
    }
  }
}
