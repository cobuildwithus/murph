import { withCanonicalWriteLock } from "@murphai/core";
import { startCliPhase, timeCliPhase, timeCliPhaseSync } from "@murphai/runtime-state/node/cli-timing";
import {
  extractIsoDatePrefix,
  isValidIanaTimeZone,
} from "@murphai/contracts";
import {
  selectMetricGoalProgress,
  selectMetricValue,
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
  summarizeWearableMetricTrendFromBundle,
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
  readCanonicalEntityFamilySource,
  readVaultMetadataSource,
  readVaultSourceTolerant,
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
  readFreshQueryProjectionSections,
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
  publishQueryProjectionSections,
  readFreshWearableSummaryRows,
} from "./projection/rebuild.ts";
import {
  searchQueryProjection,
} from "./projection/search-store.ts";
import {
  QUERY_PROJECTION_SECTION_NAMES,
  currentQueryProjectionLocation,
  type QueryProjectionLocation,
  type QueryProjectionSection,
} from "./projection/schema.ts";
import {
  readWearableSummaryRows,
} from "./projection/wearable-summary-store.ts";
import { resolveWearableSleepPatternReadFilters } from "./wearables/sleep-pattern.ts";
import { createVaultReadModel } from "./read-model.ts";

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

/** Ordinary wearable readers skip the lock only when every section is fresh.
 * A matching wearable certificate alone is not permission to read unlocked: a
 * canonical writer that queried wearables mid-write has published them for
 * files it may still roll back. Otherwise the publisher validates, publishes
 * wearables only and captures under the lock. */
async function readFreshPublicWearableSummaryBundle(
  vaultRoot: string,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
) {
  const location = currentQueryProjectionLocation(vaultRoot);
  const status = await timeCliPhase("query-freshness", async () => {
    const manifest = await timeCliPhase("query-manifest", () => listCanonicalSourceManifest(vaultRoot));
    return timeCliPhase("query-status", () => readProjectionStatus(location, manifest));
  });
  if (status?.fresh) return readStoredPublicWearableSummaryBundle(location, filters);

  // This preflight and the focused owner's locked recheck are separate spans.
  const rows = await readFreshWearableSummaryRows(vaultRoot, { providers: filters.providers });
  return composePublicWearableSummaryBundleFromStoredRows(rows, filters);
}

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
  return await publishQueryProjectionSections(
    vaultRoot,
    QUERY_PROJECTION_SECTION_NAMES,
    async (location) => ({
      ...(await readProjectionStatus(location, await listCanonicalSourceManifest(vaultRoot))
        ?? emptyQueryProjectionStatus()),
      rebuilt: true,
    }),
    { force: true },
  );
}

export async function loadProjectedVaultSource(
  vaultRoot: string,
): Promise<VaultSourceSnapshot> {
  const location = await ensureFreshQueryProjectionSection(vaultRoot, "entities");
  return readStoredVaultSource(location);
}

export async function listCanonicalEntitiesRuntime(
  vaultRoot: string,
  filters: QueryCanonicalEntityFilters = {},
): Promise<import("./canonical-entities.ts").CanonicalEntity[]> {
  const location = await ensureFreshQueryProjectionSection(vaultRoot, "entities");
  return listStoredCanonicalEntities(location, filters);
}

/** An event list never publishes: it uses the entities section when that is
 * fresh and otherwise reads only the event sources, so a malformed record of
 * another family cannot fail it. Limits follow tag/experiment filters in the
 * usecase.
 */
export async function listCanonicalEventEntitiesRuntime(
  vaultRoot: string,
  filters: Pick<QueryCanonicalEntityFilters, "kinds" | "from" | "to"> = {},
): Promise<import("./canonical-entities.ts").CanonicalEntity[]> {
  const location = currentQueryProjectionLocation(vaultRoot);
  const readFreshEntities = async () => {
    const fresh = await timeCliPhase("query-freshness", async () => {
      const manifest = await timeCliPhase("query-manifest", () => listCanonicalSourceManifest(vaultRoot));
      return timeCliPhase("query-status", () => readFreshQueryProjectionSections(location, manifest));
    });
    return fresh.has("entities")
      ? listStoredCanonicalEntities(location, { ...filters, family: "event", limit: null })
      : null;
  };
  const indexed = await readFreshEntities();
  if (indexed !== null) return indexed;

  // Do not join a pending reader: it may be waiting for our reentrant lock.
  const endWait = startCliPhase("query-wait");
  try {
    return await withCanonicalWriteLock(vaultRoot, async () => {
      endWait();
      // An entity reader may have published while this reader waited.
      const indexed = await readFreshEntities();
      if (indexed !== null) return indexed;
      // A kind filter scopes the source read itself; the filter below still
      // applies, so both paths return the same entities.
      const entities = await timeCliPhase("query-source-read", () =>
        readCanonicalEntityFamilySource(
          vaultRoot,
          "event",
          filters.kinds?.length ? { eventKinds: filters.kinds } : {},
        ));
      return entities.filter((entity) => {
        if (filters.kinds?.length && (entity.kind === null || !filters.kinds.includes(entity.kind))) return false;
        // Match the indexed COALESCE(date, substr(occurred_at, 1, 10)) predicate,
        // without changing source-owner ordering, lifecycle or visibility.
        const date = entity.date ?? entity.occurredAt?.slice(0, 10) ?? null;
        if (filters.from && (date === null || date < filters.from)) return false;
        if (filters.to && (date === null || date > filters.to)) return false;
        return true;
      });
    });
  } finally {
    endWait();
  }
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
  const location = await ensureFreshQueryProjectionSection(vaultRoot, "entities");
  return searchQueryProjection(location, query, filters);
}

export async function listMetricPointsRuntime(
  vaultRoot: string,
  filters: QueryMetricPointFilters = {},
): Promise<MetricPoint[]> {
  const location = await ensureFreshQueryProjectionSection(vaultRoot, "metrics");
  return listStoredMetricPoints(location, normalizeMetricPointFilters(filters));
}

export async function listMetricPointsBatchRuntime(
  vaultRoot: string,
  filtersList: readonly QueryMetricPointFilters[],
): Promise<MetricPoint[]> {
  if (filtersList.length === 0) {
    return [];
  }

  const location = await ensureFreshQueryProjectionSection(vaultRoot, "metrics");
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
  // These points are derived from the stored wearable rows, not from the
  // metric tables, so this reader needs the wearables section.
  const metricKeys = new Set(input.metricKeys);
  const rowSets = await timeCliPhase("query-freshness", () => publishQueryProjectionSections(
    vaultRoot,
    ["wearables"],
    (location) => input.providers.map((provider) => readWearableSummaryRows(location, { providers: [provider] })),
  ));
  return input.providers.map((provider, index) => {
    const bundle = composePublicWearableSummaryBundleFromStoredRows(rowSets[index]!, {
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
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, {
    date,
    providers: filters.providers,
  });
  return summarizeWearableDayFromBundle(bundle, date);
}

export async function summarizeWearableLatestRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableLatestSummary | null> {
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, filters);
  return summarizeWearableLatestFromBundle(bundle, filters);
}

export async function summarizeWearableMetricLatestRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableMetricLatestSummary | null> {
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, filters);
  return summarizeWearableMetricLatestFromBundle(bundle, metric, filters);
}

export async function summarizeWearableMetricTrendRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableMetricTrendSummary | null> {
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, filters);
  return summarizeWearableMetricTrendFromBundle(bundle, metric, filters);
}

export async function explainWearableDriftRuntime(
  vaultRoot: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableDriftSummary | null> {
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, filters);
  return explainWearableDriftFromBundle(bundle, filters);
}

export async function summarizeWearableSleepRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableSleepSummary[]> {
  // Prune only rows composition would discard by date; keep every summary kind,
  // because multi-provider sleep composition reads shared recovery/activity keys.
  const day = (value: string | undefined) => value ? extractIsoDatePrefix(value) ?? value : undefined;
  const rows = await readFreshWearableSummaryRows(vaultRoot, {
    from: day(filters.date || filters.from),
    providers: filters.providers,
    to: day(filters.date || filters.to),
  });
  const bundle = composePublicWearableSummaryBundleFromStoredRows(rows, filters);
  return summarizeWearableSleepFromBundle(bundle, filters);
}

export async function summarizeWearableSleepPatternRuntime(
  vaultRoot: string,
  filters: WearableSleepPatternFilters = {},
): Promise<WearableSleepPatternSummary> {
  const location = currentQueryProjectionLocation(vaultRoot);
  const status = await timeCliPhase("query-freshness", async () => {
    const manifest = await timeCliPhase("query-manifest", () => listCanonicalSourceManifest(vaultRoot));
    return timeCliPhase("query-status", () => readProjectionStatus(location, manifest));
  });
  const captureSleepPatternInput = async () => {
    const metadata = filters.timeZone === undefined
      ? status?.fresh
        ? readStoredVaultMetadata(location)
        : await readVaultMetadataSource(vaultRoot)
      : null;
    const vaultTimeZone = typeof metadata?.timezone === "string"
      && isValidIanaTimeZone(metadata.timezone)
      ? metadata.timezone
      : undefined;
    const resolvedFilters = filters.timeZone === undefined && vaultTimeZone
      ? { ...filters, timeZone: vaultTimeZone }
      : filters;
    const readFilters = resolveWearableSleepPatternReadFilters(resolvedFilters);
    const rowFilters = { ...readFilters, summaryKinds: ["sleep", "source_health"] as const };
    const rows = status?.fresh
      ? readWearableSummaryRows(location, rowFilters)
      : await readFreshWearableSummaryRows(vaultRoot, rowFilters);
    return { rows, readFilters, resolvedFilters, vaultTimeZone };
  };

  // Stored metadata belongs to the entities section, so it is used only when
  // every section is fresh, which is also when the read may skip the lock.
  // Otherwise the vault metadata is read from source and captured with the
  // wearable rows under one reentrant lock, without publishing entities.
  const endWait = status?.fresh ? null : startCliPhase("query-wait");
  let captured: Awaited<ReturnType<typeof captureSleepPatternInput>>;
  try {
    captured = status?.fresh
      ? await captureSleepPatternInput()
      : await withCanonicalWriteLock(vaultRoot, () => {
        endWait?.();
        return captureSleepPatternInput();
      });
  } finally {
    endWait?.();
  }
  const { rows, readFilters, resolvedFilters, vaultTimeZone } = captured;
  const bundle = composePublicWearableSummaryBundleFromStoredRows(
    rows,
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

export async function summarizeWearableActivityRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableActivitySummary[]> {
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, filters);
  return summarizeWearableActivityFromBundle(bundle, filters);
}

export async function summarizeWearableBodyStateRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableBodyStateSummary[]> {
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, filters);
  return summarizeWearableBodyStateFromBundle(bundle, filters);
}

export async function summarizeWearableRecoveryRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableRecoverySummary[]> {
  const bundle = await readFreshPublicWearableSummaryBundle(vaultRoot, filters);
  return summarizeWearableRecoveryFromBundle(bundle, filters);
}

export async function summarizeWearableSourceHealthRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableSourceHealthSummary[]> {
  const rows = await readFreshWearableSummaryRows(vaultRoot, { providers: filters.providers });
  const bundle = composePublicWearableSummaryBundleFromStoredRows(rows, filters, {
    sourceHealthOnly: true,
  });
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
  const location = await ensureFreshQueryProjectionSection(vaultRoot, "metrics");
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

/** Entity and metric readers read unlocked once their own section is
 * certified for the current manifest. A stale one publishes that section
 * alone under the canonical write lock. */
async function ensureFreshQueryProjectionSection(
  vaultRoot: string,
  section: Exclude<QueryProjectionSection, "wearables">,
): Promise<QueryProjectionLocation> {
  const endFreshness = startCliPhase("query-freshness");
  try {
    const location = currentQueryProjectionLocation(vaultRoot);
    const manifest = await timeCliPhase("query-manifest", () => listCanonicalSourceManifest(vaultRoot));
    const fresh = await timeCliPhase("query-status", () => readFreshQueryProjectionSections(location, manifest));
    if (!fresh.has(section)) {
      await publishQueryProjectionSections(vaultRoot, [section], () => undefined);
    }
    return location;
  } finally {
    endFreshness();
  }
}
