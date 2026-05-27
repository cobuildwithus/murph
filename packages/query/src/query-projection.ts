import { rm } from "node:fs/promises";

import {
  QUERY_DB_RELATIVE_PATH,
  applySqliteRuntimeMigrations,
  hasLocalStatePath,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
  resolveRuntimePaths,
  tableExists,
  withImmediateTransaction,
} from "@murphai/runtime-state/node";
import { extractIsoDatePrefix } from "@murphai/contracts";

import type { CanonicalEntity } from "./canonical-entities.ts";
import type { CanonicalEntityFamily } from "./canonical-entities.ts";
import { compareCanonicalEntities } from "./canonical-entities.ts";
import { isDenseProviderObservationEntity } from "./dense-provider-observation.ts";
import { ALL_QUERY_ENTITY_FAMILIES } from "./entity-families.ts";
import { createVaultReadModel } from "./read-model.ts";
import {
  filterSearchDocuments,
  materializeSampleSummarySearchDocuments as materializeSummaryDocuments,
  materializeSearchDocuments,
  normalizeSearchLimit,
  scoreSearchDocuments,
  tokenize,
  wantsSampleSearchDocuments,
  type SearchDocument,
  type SearchFilters,
  type SearchResult,
} from "./search-shared.ts";
import {
  normalizeMetricKey,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricGoalProgress,
  selectMetricValue,
  type GoalMetricTarget,
  type MetricGoalProgress,
  type MetricPoint,
  type MetricSelection,
} from "@murphai/health-metrics";
import {
  buildMetricProjection,
} from "./metrics/projection.ts";
import { isDisplayGradeMetricSampleEntity, parseGoalMetricTargets } from "./metrics/index.ts";
import {
  buildWearableSummaryBundle,
  explainWearableDriftFromBundle,
  summarizeWearableActivityFromBundle,
  summarizeWearableBodyStateFromBundle,
  summarizeWearableDayFromBundle,
  summarizeWearableLatestFromBundle,
  summarizeWearableMetricLatestFromBundle,
  summarizeWearableMetricTrendFromBundle,
  summarizeWearableRecoveryFromBundle,
  summarizeWearableSleepFromBundle,
  summarizeWearableSourceHealthFromBundle,
  type WearableActivitySummary,
  type WearableBodyStateSummary,
  type WearableDaySummary,
  type WearableDriftSummary,
  type WearableLatestSummary,
  type WearableMetricLatestSummary,
  type WearableMetricSummaryFilters,
  type WearableMetricTrendSummary,
  type WearableRecoverySummary,
  type WearableSleepSummary,
  type WearableSourceHealthSummary,
  type WearableSummaryBundle,
  type WearableSummaryFilters,
} from "./wearables.ts";
import {
  listCanonicalSourceManifest,
  readVaultSourceStrict,
  type QuerySourceManifestEntry,
  type VaultSourceSnapshot,
} from "./vault-source.ts";
import type { QueryRecordData } from "./query-record-data.ts";
import type {
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";

type DatabaseSync = import("node:sqlite").DatabaseSync;
type SqliteRow = Record<string, unknown>;

export type {
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";

const QUERY_PROJECTION_SCHEMA_ID = "murph.query-projection";
const QUERY_PROJECTION_SQLITE_VERSION = 4;
const DEFAULT_CANDIDATE_MULTIPLIER = 25;
const DEFAULT_MIN_CANDIDATES = 50;
const MAX_CANDIDATES = 1_000;
const WEARABLE_SUMMARY_PROJECTION_LIMIT = 365;
const MAX_WEARABLE_PROVIDER_SCOPE_COMBINATIONS = 64;

interface QueryProjectionLocation {
  absolutePath: string;
  dbPath: string;
}

interface QueryProjectionEntityRow {
  entity_json: string;
}

interface QueryProjectionSearchDocumentRow {
  record_id: string;
  alias_ids_json: string;
  record_type: SearchDocument["recordType"];
  kind: string | null;
  stream: string | null;
  title: string | null;
  occurred_at: string | null;
  date: string | null;
  experiment_slug: string | null;
  tags_json: string;
  path: string;
  title_text: string;
  body_text: string;
  tags_text: string;
  structured_text: string;
}

interface QueryProjectionMetaRow {
  value: string;
}

interface QueryProjectionCountRow {
  count: number;
}

const QUERY_WEARABLE_SUMMARY_KINDS = [
  "activity",
  "body_state",
  "recovery",
  "sleep",
  "source_health",
] as const;

type QueryWearableSummaryKind = typeof QUERY_WEARABLE_SUMMARY_KINDS[number];

interface QueryWearableSummaryRow {
  id: string;
  providerScopeJson: string;
  providerScopeKey: string;
  sortRank: number;
  summaryDate: string | null;
  summaryJson: string;
  summaryKind: QueryWearableSummaryKind;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${field} to be a string.`);
  }
  return value;
}

function expectNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return expectString(value, field);
}

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`Expected ${field} to be a number.`);
  }
  return value;
}

function expectEnumString<TValue extends string>(
  value: unknown,
  field: string,
  allowedValues: readonly TValue[],
): TValue {
  const parsed = expectString(value, field);
  if (!allowedValues.includes(parsed as TValue)) {
    throw new TypeError(`Expected ${field} to be one of: ${allowedValues.join(", ")}.`);
  }
  return parsed as TValue;
}

function decodeQueryProjectionEntityRow(row: SqliteRow): QueryProjectionEntityRow {
  return {
    entity_json: expectString(row.entity_json, "query_entities.entity_json"),
  };
}

function decodeQueryProjectionSearchDocumentRow(
  row: SqliteRow,
): QueryProjectionSearchDocumentRow {
  return {
    record_id: expectString(row.record_id, "query_search_document.record_id"),
    alias_ids_json: expectString(row.alias_ids_json, "query_search_document.alias_ids_json"),
    record_type: expectEnumString(
      row.record_type,
      "query_search_document.record_type",
      ALL_QUERY_ENTITY_FAMILIES,
    ) as CanonicalEntityFamily,
    kind: expectNullableString(row.kind, "query_search_document.kind"),
    stream: expectNullableString(row.stream, "query_search_document.stream"),
    title: expectNullableString(row.title, "query_search_document.title"),
    occurred_at: expectNullableString(row.occurred_at, "query_search_document.occurred_at"),
    date: expectNullableString(row.date, "query_search_document.date"),
    experiment_slug: expectNullableString(
      row.experiment_slug,
      "query_search_document.experiment_slug",
    ),
    tags_json: expectString(row.tags_json, "query_search_document.tags_json"),
    path: expectString(row.path, "query_search_document.path"),
    title_text: expectString(row.title_text, "query_search_document.title_text"),
    body_text: expectString(row.body_text, "query_search_document.body_text"),
    tags_text: expectString(row.tags_text, "query_search_document.tags_text"),
    structured_text: expectString(
      row.structured_text,
      "query_search_document.structured_text",
    ),
  };
}

function decodeQuerySourceManifestRow(row: SqliteRow): QuerySourceManifestEntry {
  return {
    relativePath: expectString(row.relativePath, "query_source_manifest.relativePath"),
    sizeBytes: expectNumber(row.sizeBytes, "query_source_manifest.sizeBytes"),
    mtimeMs: expectNumber(row.mtimeMs, "query_source_manifest.mtimeMs"),
  };
}

function decodeQueryProjectionMetaRow(row: SqliteRow): QueryProjectionMetaRow {
  return {
    value: expectString(row.value, "query_meta.value"),
  };
}

function decodeQueryProjectionCountRow(row: SqliteRow): QueryProjectionCountRow {
  return {
    count: expectNumber(row.count, "query_count.count"),
  };
}

function decodeQueryWearableSummaryRow(row: SqliteRow): QueryWearableSummaryRow {
  return {
    id: expectString(row.id, "query_wearable_summaries.id"),
    providerScopeJson: expectString(
      row.providerScopeJson,
      "query_wearable_summaries.provider_scope_json",
    ),
    providerScopeKey: expectString(
      row.providerScopeKey,
      "query_wearable_summaries.provider_scope_key",
    ),
    sortRank: expectNumber(row.sortRank, "query_wearable_summaries.sort_rank"),
    summaryDate: expectNullableString(
      row.summaryDate,
      "query_wearable_summaries.summary_date",
    ),
    summaryJson: expectString(row.summaryJson, "query_wearable_summaries.summary_json"),
    summaryKind: expectEnumString(
      row.summaryKind,
      "query_wearable_summaries.summary_kind",
      QUERY_WEARABLE_SUMMARY_KINDS,
    ),
  };
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
  const currentManifest = await listCanonicalSourceManifest(vaultRoot);
  return rebuildQueryProjectionWithManifest(vaultRoot, currentManifest);
}

export async function loadProjectedVaultSource(
  vaultRoot: string,
): Promise<VaultSourceSnapshot> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return readStoredVaultSource(location);
}

export async function searchVaultRuntime(
  vaultRoot: string,
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResult> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return searchQueryProjection(location, query, filters);
}

export interface QueryMetricPointFilters {
  biomarkerKey?: string;
  from?: string;
  limit?: number | null;
  metricKey?: string;
  to?: string;
}

export async function listMetricPointsRuntime(
  vaultRoot: string,
  filters: QueryMetricPointFilters = {},
): Promise<MetricPoint[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  return listStoredMetricPoints(location, normalizeMetricPointFilters(filters));
}

export async function summarizeWearableDayRuntime(
  vaultRoot: string,
  date: string,
  filters: Omit<WearableSummaryFilters, "date" | "from" | "to"> = {},
): Promise<WearableDaySummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, {
    date,
    providers: filters.providers,
  });
  return summarizeWearableDayFromBundle(bundle, date);
}

export async function summarizeWearableLatestRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<WearableLatestSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return summarizeWearableLatestFromBundle(bundle, filters);
}

export async function summarizeWearableMetricLatestRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<WearableMetricLatestSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return summarizeWearableMetricLatestFromBundle(bundle, metric, filters);
}

export async function summarizeWearableMetricTrendRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<WearableMetricTrendSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return summarizeWearableMetricTrendFromBundle(bundle, metric, filters);
}

export async function explainWearableDriftRuntime(
  vaultRoot: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<WearableDriftSummary | null> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return explainWearableDriftFromBundle(bundle, filters);
}

export async function summarizeWearableSleepRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<WearableSleepSummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return summarizeWearableSleepFromBundle(bundle, filters);
}

export async function summarizeWearableActivityRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<WearableActivitySummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return summarizeWearableActivityFromBundle(bundle, filters);
}

export async function summarizeWearableBodyStateRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<WearableBodyStateSummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return summarizeWearableBodyStateFromBundle(bundle, filters);
}

export async function summarizeWearableRecoveryRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<WearableRecoverySummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
  return summarizeWearableRecoveryFromBundle(bundle, filters);
}

export async function summarizeWearableSourceHealthRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<WearableSourceHealthSummary[]> {
  const location = await ensureFreshQueryProjection(vaultRoot);
  const bundle = readStoredWearableSummaryBundle(location, filters);
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

export interface QueryMetricTargetRow {
  goalId: string;
  id: string;
  target: GoalMetricTarget;
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


async function rebuildQueryProjectionWithManifest(
  vaultRoot: string,
  currentManifest: readonly QuerySourceManifestEntry[],
  location: QueryProjectionLocation = currentQueryProjectionLocation(vaultRoot),
): Promise<RebuildQueryProjectionResult> {
  await resetUnsupportedQueryProjection(location);
  const snapshot = await readVaultSourceStrict(vaultRoot);
  const projectedEntities = snapshot.entities.filter(isProjectedQueryEntity);
  const snapshotReadModel = createVaultReadModel({
    metadata: snapshot.metadata,
    vaultRoot,
    entities: snapshot.entities,
  });
  const metricProjection = buildMetricProjection(snapshotReadModel);
  const dailySampleSummaries = metricProjection.dailySampleSummaries;
  const metricPoints = metricProjection.metricPoints;
  const metricTargets = extractMetricTargetsFromCanonicalEntities(snapshot.entities);
  const wearableSummaries = buildWearableSummaryProjection(snapshotReadModel);
  const searchableEntities = projectedEntities.filter(isSearchIndexedQueryEntity);
  const searchDocuments = [
    ...materializeSearchDocuments(searchableEntities),
    ...materializeSummaryDocuments(dailySampleSummaries),
  ];
  const database = openQueryProjectionDatabase(location, { create: true });

  try {
    ensureQueryProjectionSchema(database);
    const builtAt = withImmediateTransaction(database, () => {
      database.exec(`
        DELETE FROM query_entities;
        DELETE FROM query_metric_points;
        DELETE FROM query_metric_targets;
        DELETE FROM query_wearable_summaries;
        DELETE FROM query_source_manifest;
        DELETE FROM query_search_document;
      `);

      const insertEntity = database.prepare(`
        INSERT INTO query_entities (
          entity_id,
          sort_rank,
          primary_lookup_id,
          family,
          record_class,
          kind,
          status,
          stream,
          experiment_slug,
          occurred_at,
          date,
          title,
          tags_json,
          entity_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertManifestEntry = database.prepare(`
        INSERT INTO query_source_manifest (
          relative_path,
          size_bytes,
          mtime_ms
        ) VALUES (?, ?, ?)
      `);
      const insertMetricPoint = database.prepare(`
        INSERT INTO query_metric_points (
          id,
          sort_rank,
          metric_key,
          biomarker_key,
          value,
          text_value,
          comparator,
          unit,
          canonical_value,
          canonical_unit,
          observed_at,
          effective_date,
          recorded_at,
          reported_at,
          grain,
          statistic,
          source_family,
          source_kind,
          source_record_id,
          source_result_index,
          source_path,
          confidence,
          provenance_json,
          context_json,
          metric_point_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMetricTarget = database.prepare(`
        INSERT INTO query_metric_targets (
          id,
          goal_id,
          metric_key,
          biomarker_key,
          comparator,
          target_value,
          target_unit,
          target_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertWearableSummary = database.prepare(`
        INSERT INTO query_wearable_summaries (
          id,
          provider_scope_key,
          provider_scope_json,
          summary_kind,
          summary_date,
          sort_rank,
          summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSearchDocument = database.prepare(`
        INSERT INTO query_search_document (
          record_id,
          alias_ids_json,
          record_type,
          kind,
          stream,
          title,
          occurred_at,
          date,
          experiment_slug,
          tags_json,
          path,
          title_text,
          body_text,
          tags_text,
          structured_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      projectedEntities.forEach((entity, index) => {
        insertEntity.run(
          entity.entityId,
          index,
          entity.primaryLookupId,
          entity.family,
          entity.recordClass,
          entity.kind,
          entity.status,
          entity.stream,
          entity.experimentSlug,
          entity.occurredAt,
          entity.date,
          entity.title,
          JSON.stringify(entity.tags),
          JSON.stringify(entity),
        );
      });

      metricPoints.forEach((point: MetricPoint, index: number) => {
        insertMetricPoint.run(
          point.id,
          index,
          point.metricKey,
          point.biomarkerKey,
          point.canonicalValue ?? point.value,
          point.textValue,
          point.comparator,
          point.canonicalUnit ?? point.unit,
          point.canonicalValue,
          point.canonicalUnit,
          point.observedAt,
          point.effectiveDate,
          point.recordedAt,
          point.reportedAt,
          point.grain,
          point.statistic,
          point.source.family,
          point.source.kind,
          point.source.recordId,
          point.source.resultIndex,
          point.source.path,
          point.confidence,
          JSON.stringify(point.provenance),
          JSON.stringify(point.context),
          JSON.stringify(point),
        );
      });

      metricTargets.forEach((entry) => {
        insertMetricTarget.run(
          entry.id,
          entry.goalId,
          entry.target.metricKey,
          entry.target.biomarkerKey ?? null,
          entry.target.comparator,
          entry.target.value,
          entry.target.unit,
          JSON.stringify(entry.target),
        );
      });

      wearableSummaries.forEach((row) => {
        insertWearableSummary.run(
          row.id,
          row.providerScopeKey,
          row.providerScopeJson,
          row.summaryKind,
          row.summaryDate,
          row.sortRank,
          row.summaryJson,
        );
      });

      currentManifest.forEach((entry) => {
        insertManifestEntry.run(entry.relativePath, entry.sizeBytes, entry.mtimeMs);
      });

      searchDocuments.forEach((document) => {
        insertSearchDocument.run(
          document.recordId,
          JSON.stringify(document.aliasIds),
          document.recordType,
          document.kind,
          document.stream,
          document.title,
          document.occurredAt,
          document.date,
          document.experimentSlug,
          JSON.stringify(document.tags),
          document.path,
          document.titleText,
          document.bodyText,
          document.tagsText,
          document.structuredText,
        );
      });

      database.exec("INSERT INTO query_search_fts(query_search_fts) VALUES ('rebuild');");

      const builtAt = new Date().toISOString();
      writeMeta(database, "schema_version", QUERY_PROJECTION_SCHEMA_ID);
      writeMeta(database, "built_at", builtAt);
      writeMeta(database, "metadata_json", JSON.stringify(snapshot.metadata ?? null));
      return builtAt;
    });

    return {
      dbPath: QUERY_DB_RELATIVE_PATH,
      exists: true,
      schemaVersion: QUERY_PROJECTION_SCHEMA_ID,
      builtAt,
      entityCount: projectedEntities.length,
      searchDocumentCount: searchDocuments.length,
      fresh: true,
      rebuilt: true,
    };
  } finally {
    database.close();
  }
}

function isProjectedQueryEntity(entity: CanonicalEntity): boolean {
  if (isDenseProviderObservationEntity(entity)) {
    return false;
  }

  if (entity.family !== "sample") {
    return true;
  }

  return entity.kind === "metric_sample" && isDisplayGradeMetricSampleEntity(entity);
}

function isSearchIndexedQueryEntity(entity: CanonicalEntity): boolean {
  return !isDenseProviderObservationEntity(entity);
}

interface WearableProviderScope {
  key: string;
  providers: string[];
}

function buildWearableSummaryProjection(vault: ReturnType<typeof createVaultReadModel>): QueryWearableSummaryRow[] {
  const allBundle = buildWearableSummaryBundle(vault);
  const providers = normalizeWearableProviderScope(allBundle.sourceHealth.map((entry) => entry.provider));
  const scopes = buildWearableProviderScopes(providers);

  return scopes.flatMap((scope) => {
    const bundle = scope.providers.length === 0
      ? allBundle
      : buildWearableSummaryBundle(vault, { providers: scope.providers });
    return materializeWearableSummaryRows(scope, bundle);
  });
}

function buildWearableProviderScopes(providers: readonly string[]): WearableProviderScope[] {
  const normalizedProviders = normalizeWearableProviderScope(providers);
  const scopes = new Map<string, WearableProviderScope>();
  const register = (scopeProviders: readonly string[]) => {
    const normalized = normalizeWearableProviderScope(scopeProviders);
    const key = wearableProviderScopeKey(normalized);
    scopes.set(key, { key, providers: normalized });
  };

  register([]);

  if (normalizedProviders.length === 0) {
    return [...scopes.values()];
  }

  if ((2 ** normalizedProviders.length) - 1 <= MAX_WEARABLE_PROVIDER_SCOPE_COMBINATIONS) {
    for (let mask = 1; mask < 2 ** normalizedProviders.length; mask += 1) {
      register(normalizedProviders.filter((_provider, index) => (mask & (1 << index)) !== 0));
    }
  } else {
    for (const provider of normalizedProviders) {
      register([provider]);
    }
  }

  return [...scopes.values()];
}

function materializeWearableSummaryRows(
  scope: WearableProviderScope,
  bundle: WearableSummaryBundle,
): QueryWearableSummaryRow[] {
  const rows: QueryWearableSummaryRow[] = [];
  const providerScopeJson = JSON.stringify(scope.providers);
  const push = <TSummary extends { date: string }>(
    summaryKind: Exclude<QueryWearableSummaryKind, "source_health">,
    summaries: readonly TSummary[],
  ) => {
    summaries.slice(0, WEARABLE_SUMMARY_PROJECTION_LIMIT).forEach((summary, index) => {
      rows.push({
        id: `${scope.key}:${summaryKind}:${summary.date}:${index}`,
        providerScopeJson,
        providerScopeKey: scope.key,
        sortRank: index,
        summaryDate: summary.date,
        summaryJson: JSON.stringify(summary),
        summaryKind,
      });
    });
  };

  push("activity", bundle.activityDays);
  push("body_state", bundle.bodyStateDays);
  push("recovery", bundle.recoveryDays);
  push("sleep", bundle.sleepNights);

  bundle.sourceHealth.forEach((summary, index) => {
    rows.push({
      id: `${scope.key}:source_health:${summary.provider}:${index}`,
      providerScopeJson,
      providerScopeKey: scope.key,
      sortRank: index,
      summaryDate: summary.lastDate ?? summary.firstDate,
      summaryJson: JSON.stringify(summary),
      summaryKind: "source_health",
    });
  });

  return rows;
}

function normalizeWearableProviderScope(providers: readonly string[] | undefined): string[] {
  return [...new Set(
    (providers ?? [])
      .map((provider) => provider.trim().toLowerCase())
      .filter((provider) => provider.length > 0),
  )].sort();
}

function wearableProviderScopeKey(providers: readonly string[]): string {
  const normalized = normalizeWearableProviderScope(providers);
  return normalized.length === 0 ? "all" : `providers:${normalized.join(",")}`;
}

async function resetUnsupportedQueryProjection(
  location: QueryProjectionLocation,
): Promise<void> {
  if (!(await hasLocalStatePath({ currentPath: location.absolutePath }))) {
    return;
  }

  let supportedProjection = false;

  try {
    const database = openSqliteRuntimeDatabase(location.absolutePath, {
      create: false,
      readOnly: true,
    });

    try {
      supportedProjection = hasCurrentQueryProjectionSchema(database);
    } finally {
      database.close();
    }
  } catch {
    supportedProjection = false;
  }

  if (supportedProjection) {
    return;
  }

  await Promise.all([
    rm(location.absolutePath, { force: true }),
    rm(`${location.absolutePath}-wal`, { force: true }),
    rm(`${location.absolutePath}-shm`, { force: true }),
  ]);
}

async function ensureFreshQueryProjection(
  vaultRoot: string,
): Promise<QueryProjectionLocation> {
  const location = currentQueryProjectionLocation(vaultRoot);
  const currentManifest = await listCanonicalSourceManifest(vaultRoot);
  const status = await readProjectionStatus(location, currentManifest);

  if (!status?.fresh) {
    await rebuildQueryProjectionWithManifest(vaultRoot, currentManifest, location);
  }

  return location;
}

async function readProjectionStatus(
  location: QueryProjectionLocation,
  currentManifest: readonly QuerySourceManifestEntry[],
): Promise<QueryProjectionStatus | null> {
  if (!(await hasLocalStatePath({ currentPath: location.absolutePath }))) {
    return null;
  }

  let database: DatabaseSync | undefined;

  try {
    database = openQueryProjectionDatabase(location, {
      create: false,
      readOnly: true,
    });

    if (!hasQueryProjectionTables(database)) {
      return null;
    }

    return {
      dbPath: location.dbPath,
      exists: true,
      schemaVersion: readMeta(database, "schema_version"),
      builtAt: readMeta(database, "built_at"),
      entityCount: countRows(database, "query_entities"),
      searchDocumentCount: countRows(database, "query_search_document"),
      fresh:
        hasCurrentQueryProjectionSchema(database) &&
        sameSourceManifest(currentManifest, readStoredSourceManifest(database)),
    };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

function readStoredVaultSource(
  location: QueryProjectionLocation,
): VaultSourceSnapshot {
  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    if (!hasQueryProjectionTables(database)) {
      throw new Error(
        `Query projection at ${location.dbPath} is missing required tables. Rebuild the projection and try again.`,
      );
    }

    const entityRows = database.prepare(`
      SELECT entity_json
      FROM query_entities
      ORDER BY sort_rank ASC
    `).all().map((row) => decodeQueryProjectionEntityRow(row));

    return {
      metadata: parseJsonValue<QueryRecordData | null>(readMeta(database, "metadata_json"), null),
      entities: entityRows
        .map((row) => parseJsonValue<CanonicalEntity | null>(row.entity_json, null))
        .filter((entity): entity is CanonicalEntity => entity !== null)
        .sort(compareCanonicalEntities),
    };
  } finally {
    database.close();
  }
}

function listStoredMetricPoints(
  location: QueryProjectionLocation,
  filters: QueryMetricPointFilters,
): MetricPoint[] {
  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    if (!hasQueryProjectionTables(database)) {
      throw new Error(
        `Query projection at ${location.dbPath} is missing required tables. Rebuild the projection and try again.`,
      );
    }

    const whereClauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (filters.metricKey) {
      whereClauses.push("metric_key = ?");
      parameters.push(filters.metricKey);
    }
    if (filters.biomarkerKey) {
      whereClauses.push("biomarker_key = ?");
      parameters.push(filters.biomarkerKey);
    }
    if (filters.from) {
      whereClauses.push("effective_date >= ?");
      parameters.push(filters.from);
    }
    if (filters.to) {
      whereClauses.push("effective_date <= ?");
      parameters.push(filters.to);
    }

    const limit = filters.limit === null ? null : normalizeMetricPointLimit(filters.limit ?? 1_000);
    const limitSql = limit === null ? "" : "LIMIT ?";
    if (limit !== null) {
      parameters.push(limit);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const rows = database.prepare(`
      SELECT metric_point_json
      FROM query_metric_points
      ${whereSql}
      ORDER BY effective_date DESC, observed_at DESC, id ASC
      ${limitSql}
    `).all(...parameters) as Array<{ metric_point_json: string }>;

    return rows
      .map((row) => parseJsonValue<MetricPoint | null>(row.metric_point_json, null))
      .filter((point): point is MetricPoint => point !== null);
  } finally {
    database.close();
  }
}

function readStoredWearableSummaryBundle(
  location: QueryProjectionLocation,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): WearableSummaryBundle {
  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    if (!hasQueryProjectionTables(database)) {
      throw new Error(
        `Query projection at ${location.dbPath} is missing required tables. Rebuild the projection and try again.`,
      );
    }

    const readRows = (scopeKey: string) => database.prepare(`
        SELECT
          id,
          provider_scope_key AS providerScopeKey,
          provider_scope_json AS providerScopeJson,
          summary_kind AS summaryKind,
          summary_date AS summaryDate,
          sort_rank AS sortRank,
          summary_json AS summaryJson
        FROM query_wearable_summaries
        WHERE provider_scope_key = ?
        ORDER BY summary_kind ASC, summary_date DESC, sort_rank ASC
      `).all(scopeKey).map(decodeQueryWearableSummaryRow);
    const providerScopeKey = wearableProviderScopeKey(normalizeWearableProviderScope(filters.providers));
    const scopedRows = readRows(providerScopeKey);
    const rows = scopedRows.length > 0 || providerScopeKey === "all"
      ? scopedRows
      : readRows("all");

    return wearableSummaryBundleFromRows(rows, filters);
  } finally {
    database.close();
  }
}

function wearableSummaryBundleFromRows(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): WearableSummaryBundle {
  const bundle: WearableSummaryBundle = {
    activityDays: [],
    bodyStateDays: [],
    recoveryDays: [],
    sleepNights: [],
    sourceHealth: [],
  };

  for (const row of rows) {
    if (!wearableSummaryRowMatchesDateFilters(row.summaryDate, filters)) {
      continue;
    }

    switch (row.summaryKind) {
      case "activity": {
        const summary = parseJsonValue<WearableActivitySummary | null>(row.summaryJson, null);
        if (summary) bundle.activityDays.push(summary);
        break;
      }
      case "body_state": {
        const summary = parseJsonValue<WearableBodyStateSummary | null>(row.summaryJson, null);
        if (summary) bundle.bodyStateDays.push(summary);
        break;
      }
      case "recovery": {
        const summary = parseJsonValue<WearableRecoverySummary | null>(row.summaryJson, null);
        if (summary) bundle.recoveryDays.push(summary);
        break;
      }
      case "sleep": {
        const summary = parseJsonValue<WearableSleepSummary | null>(row.summaryJson, null);
        if (summary) bundle.sleepNights.push(summary);
        break;
      }
      case "source_health": {
        const summary = parseJsonValue<WearableSourceHealthSummary | null>(row.summaryJson, null);
        if (summary && wearableSourceHealthMatchesDateFilters(summary, filters)) {
          bundle.sourceHealth.push(summary);
        }
        break;
      }
    }
  }

  return bundle;
}

function wearableSummaryRowMatchesDateFilters(
  summaryDate: string | null,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): boolean {
  const date = summaryDate ? extractIsoDatePrefix(summaryDate) ?? summaryDate : null;

  if (filters.date) {
    return date === (extractIsoDatePrefix(filters.date) ?? filters.date);
  }

  if (filters.from && date && date < (extractIsoDatePrefix(filters.from) ?? filters.from)) {
    return false;
  }

  if (filters.to && date && date > (extractIsoDatePrefix(filters.to) ?? filters.to)) {
    return false;
  }

  return true;
}

function wearableSourceHealthMatchesDateFilters(
  summary: WearableSourceHealthSummary,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): boolean {
  const firstDate = summary.firstDate;
  const lastDate = summary.lastDate;

  if (filters.date) {
    const date = extractIsoDatePrefix(filters.date) ?? filters.date;
    return firstDate === null || lastDate === null || (firstDate <= date && lastDate >= date);
  }

  if (filters.from) {
    const from = extractIsoDatePrefix(filters.from) ?? filters.from;
    if (lastDate !== null && lastDate < from) {
      return false;
    }
  }

  if (filters.to) {
    const to = extractIsoDatePrefix(filters.to) ?? filters.to;
    if (firstDate !== null && firstDate > to) {
      return false;
    }
  }

  return true;
}

function normalizeMetricPointLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    return 1_000;
  }
  return Math.min(value, 10_000);
}

function normalizeMetricPointFilters(filters: QueryMetricPointFilters): QueryMetricPointFilters {
  const definition = filters.metricKey
    ? resolveMetricDefinition(filters.metricKey)
    : filters.biomarkerKey
      ? resolveMetricDefinitionForBiomarker(filters.biomarkerKey)
      : null;
  return {
    ...filters,
    ...(filters.metricKey || definition ? {
      metricKey: definition?.key ?? (filters.metricKey ? normalizeMetricKey(filters.metricKey) : undefined),
    } : {}),
  };
}

function metricPointFiltersForGoalTarget(target: GoalMetricTarget, now: string | undefined): QueryMetricPointFilters {
  const filters: QueryMetricPointFilters = {
    limit: 10_000,
    metricKey: target.metricKey,
  };
  const range = metricTargetDateRange(target, now);
  if (range.from) filters.from = range.from;
  if (range.to) filters.to = range.to;
  if (filters.from || filters.to) filters.limit = null;
  return normalizeMetricPointFilters(filters);
}

function metricTargetDateRange(
  target: GoalMetricTarget,
  now: string | undefined,
): { from?: string; to?: string } {
  if (target.evaluation.kind !== "rolling-window") {
    return dateRange(target.startAt, target.targetAt);
  }

  const anchorDate = rollingWindowQueryAnchorDate(target, now);
  if (!anchorDate) {
    return dateRange(target.startAt, target.targetAt);
  }

  return dateRange(
    maxIsoDate(target.startAt, subtractIsoDays(anchorDate, target.evaluation.windowDays - 1)),
    minIsoDate(target.targetAt, anchorDate) ?? anchorDate,
  );
}

function dateRange(from: string | undefined, to: string | undefined): { from?: string; to?: string } {
  const range: { from?: string; to?: string } = {};
  if (from) range.from = from;
  if (to) range.to = to;
  return range;
}

function rollingWindowQueryAnchorDate(target: GoalMetricTarget, now: string | undefined): string | null {
  const nowDate = now?.slice(0, 10) ?? null;
  if (nowDate && target.targetAt) return minIsoDate(nowDate, target.targetAt) ?? nowDate;
  return nowDate ?? target.targetAt ?? null;
}

function maxIsoDate(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function minIsoDate(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function subtractIsoDays(value: string, days: number): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value.slice(0, 10);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function listStoredMetricTargets(location: QueryProjectionLocation): QueryMetricTargetRow[] {
  const database = openQueryProjectionDatabase(location, { create: false, readOnly: true });
  try {
    if (!hasQueryProjectionTables(database)) {
      throw new Error(`Query projection at ${location.dbPath} is missing required tables. Rebuild the projection and try again.`);
    }
    const rows = database.prepare(`
      SELECT id, goal_id AS goalId, target_json AS targetJson
      FROM query_metric_targets
      ORDER BY goal_id ASC, id ASC
    `).all() as Array<{ goalId: string; id: string; targetJson: string }>;
    return rows.flatMap((row) => {
      const target = parseJsonValue<GoalMetricTarget | null>(row.targetJson, null);
      return target ? [{ goalId: row.goalId, id: row.id, target }] : [];
    });
  } finally {
    database.close();
  }
}

function extractMetricTargetsFromCanonicalEntities(entities: readonly CanonicalEntity[]): QueryMetricTargetRow[] {
  return entities
    .filter((entity) => entity.family === "goal")
    .flatMap((entity) =>
      parseGoalMetricTargets(entity).map((target) => ({
        goalId: entity.entityId,
        id: `${entity.entityId}:${target.targetId}`,
        target,
      }))
    );
}


function searchQueryProjection(
  location: QueryProjectionLocation,
  query: string,
  filters: SearchFilters,
): SearchResult {
  const normalizedQuery = query.trim();
  const terms = tokenize(normalizedQuery);

  if (terms.length === 0) {
    return {
      format: "murph.search.v1",
      query: normalizedQuery,
      total: 0,
      hits: [],
    };
  }

  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    if (!hasQueryProjectionTables(database)) {
      throw new Error(
        `Query projection at ${location.dbPath} is missing required tables. Rebuild the projection and try again.`,
      );
    }

    const whereClauses: string[] = ["query_search_fts MATCH ?"];
    const parameters: Array<string | number> = [buildFtsQuery(terms)];
    const includeSamples = wantsSampleRows(filters);
    const sqlRecordTypes = filters.recordTypes?.filter(
      (recordType) => includeSamples || recordType !== "sample",
    );

    if (!includeSamples && !filters.recordTypes?.length) {
      whereClauses.push("query_search_document.record_type != 'sample'");
    }

    appendEqualityFilters(
      whereClauses,
      parameters,
      "record_type",
      sqlRecordTypes && sqlRecordTypes.length > 0 ? sqlRecordTypes : undefined,
    );
    appendEqualityFilters(whereClauses, parameters, "kind", filters.kinds);
    appendEqualityFilters(whereClauses, parameters, "stream", filters.streams);

    if (filters.experimentSlug) {
      whereClauses.push("query_search_document.experiment_slug = ?");
      parameters.push(filters.experimentSlug);
    }

    if (filters.from) {
      const from = extractIsoDatePrefix(filters.from) ?? filters.from;
      whereClauses.push(
        "substr(COALESCE(query_search_document.date, query_search_document.occurred_at), 1, 10) >= ?",
      );
      parameters.push(from);
    }

    if (filters.to) {
      const to = extractIsoDatePrefix(filters.to) ?? filters.to;
      whereClauses.push(
        "substr(COALESCE(query_search_document.date, query_search_document.occurred_at), 1, 10) <= ?",
      );
      parameters.push(to);
    }

    const candidateLimit = Math.max(
      DEFAULT_MIN_CANDIDATES,
      Math.min(
        MAX_CANDIDATES,
        normalizeSearchLimit(filters.limit) * DEFAULT_CANDIDATE_MULTIPLIER,
      ),
    );
    parameters.push(candidateLimit);

    const rows = database.prepare(`
      SELECT
        query_search_document.record_id,
        query_search_document.alias_ids_json,
        query_search_document.record_type,
        query_search_document.kind,
        query_search_document.stream,
        query_search_document.title,
        query_search_document.occurred_at,
        query_search_document.date,
        query_search_document.experiment_slug,
        query_search_document.tags_json,
        query_search_document.path,
        query_search_document.title_text,
        query_search_document.body_text,
        query_search_document.tags_text,
        query_search_document.structured_text
      FROM query_search_fts
      JOIN query_search_document ON query_search_document.rowid = query_search_fts.rowid
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY bm25(query_search_fts) ASC, query_search_document.record_id ASC
      LIMIT ?
    `).all(...parameters).map((row) => decodeQueryProjectionSearchDocumentRow(row));

    return scoreSearchDocuments(
      filterSearchDocuments(rows.map(mapRowToSearchDocument), filters),
      normalizedQuery,
      filters,
    );
  } finally {
    database.close();
  }
}

function openQueryProjectionDatabase(
  location: QueryProjectionLocation,
  options: { create?: boolean; readOnly?: boolean } = {},
): DatabaseSync {
  const database = openSqliteRuntimeDatabase(location.absolutePath, options);

  if (!(options.readOnly ?? false)) {
    applySqliteRuntimeMigrations(database, {
      migrations: [{
        version: QUERY_PROJECTION_SQLITE_VERSION,
        migrate(candidateDatabase) {
          ensureQueryProjectionSchema(candidateDatabase);
        },
      }],
      schemaVersion: QUERY_PROJECTION_SQLITE_VERSION,
      storeName: "query projection",
    });
  }

  return database;
}

function hasCurrentQueryProjectionSchema(database: DatabaseSync): boolean {
  if (
    !tableExists(database, "query_meta") ||
    !tableExists(database, "query_entities") ||
    !tableExists(database, "query_metric_points") ||
    !tableExists(database, "query_metric_targets") ||
    !tableExists(database, "query_wearable_summaries") ||
    !tableExists(database, "query_source_manifest") ||
    !tableExists(database, "query_search_document") ||
    !tableExists(database, "query_search_fts")
  ) {
    return false;
  }

  return (
    readMeta(database, "schema_version") === QUERY_PROJECTION_SCHEMA_ID &&
    readSqliteRuntimeUserVersion(database) === QUERY_PROJECTION_SQLITE_VERSION
  );
}

function currentQueryProjectionLocation(vaultRoot: string): QueryProjectionLocation {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absolutePath: runtimePaths.queryDbPath,
    dbPath: QUERY_DB_RELATIVE_PATH,
  };
}

function emptyQueryProjectionStatus(): QueryProjectionStatus {
  return {
    dbPath: QUERY_DB_RELATIVE_PATH,
    exists: false,
    schemaVersion: null,
    builtAt: null,
    entityCount: 0,
    searchDocumentCount: 0,
    fresh: false,
  };
}

function ensureQueryProjectionSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS query_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_entities (
      entity_id TEXT PRIMARY KEY,
      sort_rank INTEGER NOT NULL,
      primary_lookup_id TEXT NOT NULL,
      family TEXT NOT NULL,
      record_class TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT,
      stream TEXT,
      experiment_slug TEXT,
      occurred_at TEXT,
      date TEXT,
      title TEXT,
      tags_json TEXT NOT NULL,
      entity_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS query_entities_family_idx ON query_entities(family);
    CREATE INDEX IF NOT EXISTS query_entities_record_class_idx ON query_entities(record_class);
    CREATE INDEX IF NOT EXISTS query_entities_kind_idx ON query_entities(kind);
    CREATE INDEX IF NOT EXISTS query_entities_stream_idx ON query_entities(stream);
    CREATE INDEX IF NOT EXISTS query_entities_experiment_idx ON query_entities(experiment_slug);
    CREATE INDEX IF NOT EXISTS query_entities_date_idx ON query_entities(date);
    CREATE INDEX IF NOT EXISTS query_entities_occurred_at_idx ON query_entities(occurred_at);

    CREATE TABLE IF NOT EXISTS query_metric_points (
      id TEXT PRIMARY KEY,
      sort_rank INTEGER NOT NULL,
      metric_key TEXT NOT NULL,
      biomarker_key TEXT,
      value REAL,
      text_value TEXT,
      comparator TEXT,
      unit TEXT,
      canonical_value REAL,
      canonical_unit TEXT,
      observed_at TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      recorded_at TEXT,
      reported_at TEXT,
      grain TEXT NOT NULL,
      statistic TEXT NOT NULL,
      source_family TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_result_index INTEGER,
      source_path TEXT NOT NULL,
      confidence TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      metric_point_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS query_metric_points_metric_latest_idx ON query_metric_points(metric_key, effective_date DESC, observed_at DESC);
    CREATE INDEX IF NOT EXISTS query_metric_points_biomarker_latest_idx ON query_metric_points(biomarker_key, effective_date DESC, observed_at DESC);
    CREATE INDEX IF NOT EXISTS query_metric_points_source_idx ON query_metric_points(source_record_id);

    CREATE TABLE IF NOT EXISTS query_metric_targets (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      biomarker_key TEXT,
      comparator TEXT NOT NULL,
      target_value REAL NOT NULL,
      target_unit TEXT NOT NULL,
      target_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS query_metric_targets_goal_idx ON query_metric_targets(goal_id);
    CREATE INDEX IF NOT EXISTS query_metric_targets_metric_idx ON query_metric_targets(metric_key);
    CREATE INDEX IF NOT EXISTS query_metric_targets_biomarker_idx ON query_metric_targets(biomarker_key);

    CREATE TABLE IF NOT EXISTS query_wearable_summaries (
      id TEXT PRIMARY KEY,
      provider_scope_key TEXT NOT NULL,
      provider_scope_json TEXT NOT NULL,
      summary_kind TEXT NOT NULL,
      summary_date TEXT,
      sort_rank INTEGER NOT NULL,
      summary_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS query_wearable_summaries_scope_kind_date_idx
      ON query_wearable_summaries(provider_scope_key, summary_kind, summary_date DESC);

    CREATE TABLE IF NOT EXISTS query_source_manifest (
      relative_path TEXT PRIMARY KEY,
      size_bytes INTEGER NOT NULL,
      mtime_ms REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_search_document (
      record_id TEXT PRIMARY KEY,
      alias_ids_json TEXT NOT NULL,
      record_type TEXT NOT NULL,
      kind TEXT,
      stream TEXT,
      title TEXT,
      occurred_at TEXT,
      date TEXT,
      experiment_slug TEXT,
      tags_json TEXT NOT NULL,
      path TEXT NOT NULL,
      title_text TEXT NOT NULL,
      body_text TEXT NOT NULL,
      tags_text TEXT NOT NULL,
      structured_text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS query_search_document_record_type_idx ON query_search_document(record_type);
    CREATE INDEX IF NOT EXISTS query_search_document_kind_idx ON query_search_document(kind);
    CREATE INDEX IF NOT EXISTS query_search_document_stream_idx ON query_search_document(stream);
    CREATE INDEX IF NOT EXISTS query_search_document_experiment_idx ON query_search_document(experiment_slug);
    CREATE INDEX IF NOT EXISTS query_search_document_date_idx ON query_search_document(date);
    CREATE INDEX IF NOT EXISTS query_search_document_occurred_at_idx ON query_search_document(occurred_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS query_search_fts USING fts5(
      title_text,
      body_text,
      tags_text,
      structured_text,
      content = 'query_search_document',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-_'''
    );
  `);
}

function hasQueryProjectionTables(database: DatabaseSync): boolean {
  return (
    tableExists(database, "query_entities") &&
    tableExists(database, "query_metric_points") &&
    tableExists(database, "query_metric_targets") &&
    tableExists(database, "query_wearable_summaries") &&
    tableExists(database, "query_source_manifest") &&
    tableExists(database, "query_search_document") &&
    tableExists(database, "query_search_fts")
  );
}

function sameSourceManifest(
  currentManifest: readonly QuerySourceManifestEntry[],
  storedManifest: readonly QuerySourceManifestEntry[],
): boolean {
  if (currentManifest.length !== storedManifest.length) {
    return false;
  }

  for (let index = 0; index < currentManifest.length; index += 1) {
    const current = currentManifest[index];
    const stored = storedManifest[index];

    if (!stored) {
      return false;
    }

    if (
      current.relativePath !== stored.relativePath ||
      current.sizeBytes !== stored.sizeBytes ||
      current.mtimeMs !== stored.mtimeMs
    ) {
      return false;
    }
  }

  return true;
}

function readStoredSourceManifest(
  database: DatabaseSync,
): QuerySourceManifestEntry[] {
  return database.prepare(`
    SELECT
      relative_path AS relativePath,
      size_bytes AS sizeBytes,
      mtime_ms AS mtimeMs
    FROM query_source_manifest
    ORDER BY relative_path ASC
  `).all().map((row) => decodeQuerySourceManifestRow(row));
}

function appendEqualityFilters(
  whereClauses: string[],
  parameters: Array<string | number>,
  column: string,
  values: readonly string[] | undefined,
): void {
  if (!values || values.length === 0) {
    return;
  }

  const placeholders = values.map(() => "?").join(", ");
  whereClauses.push(`query_search_document.${column} IN (${placeholders})`);
  parameters.push(...values);
}

function mapRowToSearchDocument(
  row: QueryProjectionSearchDocumentRow,
): SearchDocument {
  return {
    recordId: row.record_id,
    aliasIds: parseStringArray(row.alias_ids_json),
    recordType: row.record_type,
    kind: row.kind,
    stream: row.stream,
    title: row.title,
    occurredAt: row.occurred_at,
    date: row.date,
    experimentSlug: row.experiment_slug,
    tags: parseStringArray(row.tags_json),
    path: row.path,
    titleText: row.title_text,
    bodyText: row.body_text,
    tagsText: row.tags_text,
    structuredText: row.structured_text,
  };
}

function parseStringArray(value: string): string[] {
  const parsed = parseJsonValue<unknown>(value, []);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseJsonValue<TValue>(
  value: string | null,
  fallback: TValue,
): TValue {
  if (value === null) {
    return fallback;
  }

  try {
    return JSON.parse(value) as TValue;
  } catch {
    return fallback;
  }
}

function buildFtsQuery(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" OR ");
}

function readMeta(database: DatabaseSync, key: string): string | null {
  const row = database.prepare("SELECT value FROM query_meta WHERE key = ?").get(key);
  return row ? decodeQueryProjectionMetaRow(row).value : null;
}

function writeMeta(database: DatabaseSync, key: string, value: string): void {
  database.prepare(`
    INSERT INTO query_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function countRows(database: DatabaseSync, tableName: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get();

  return row ? decodeQueryProjectionCountRow(row).count : 0;
}

const wantsSampleRows = wantsSampleSearchDocuments;
