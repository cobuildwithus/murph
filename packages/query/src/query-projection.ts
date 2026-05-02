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
import { summarizeDailySamples } from "./summaries.ts";
import { createBrowserVaultMetricPoints } from "./browser-replica/metric-points.ts";
import type { BrowserVaultMetricPoint } from "./browser-replica/shared.ts";
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

const QUERY_PROJECTION_SCHEMA_ID = "murph.query-projection.v2";
const QUERY_PROJECTION_SQLITE_VERSION = 2;
const DEFAULT_CANDIDATE_MULTIPLIER = 25;
const DEFAULT_MIN_CANDIDATES = 50;
const MAX_CANDIDATES = 1_000;

interface QueryProjectionLocation {
  absolutePath: string;
  dbPath: string;
}

interface QueryProjectionEntityRow {
  entity_json: string;
}

interface QueryProjectionSamplePointRow {
  sample_id: string;
  stream: string;
  status: string | null;
  occurred_at: string | null;
  date: string | null;
  path: string;
  title: string | null;
  tags_json: string;
  sample_json: string;
  experiment_slug: string | null;
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

function decodeQueryProjectionSamplePointRow(row: SqliteRow): QueryProjectionSamplePointRow {
  return {
    sample_id: expectString(row.sample_id, "query_sample_points.sample_id"),
    stream: expectString(row.stream, "query_sample_points.stream"),
    status: expectNullableString(row.status, "query_sample_points.status"),
    occurred_at: expectNullableString(row.occurred_at, "query_sample_points.occurred_at"),
    date: expectNullableString(row.date, "query_sample_points.date"),
    path: expectString(row.path, "query_sample_points.path"),
    title: expectNullableString(row.title, "query_sample_points.title"),
    tags_json: expectString(row.tags_json, "query_sample_points.tags_json"),
    sample_json: expectString(row.sample_json, "query_sample_points.sample_json"),
    experiment_slug: expectNullableString(
      row.experiment_slug,
      "query_sample_points.experiment_slug",
    ),
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

async function rebuildQueryProjectionWithManifest(
  vaultRoot: string,
  currentManifest: readonly QuerySourceManifestEntry[],
  location: QueryProjectionLocation = currentQueryProjectionLocation(vaultRoot),
): Promise<RebuildQueryProjectionResult> {
  await resetUnsupportedQueryProjection(location);
  const snapshot = await readVaultSourceStrict(vaultRoot);
  const projectedEntities = snapshot.entities.filter((entity) => entity.family !== "sample");
  const sampleEntities = snapshot.entities.filter((entity) => entity.family === "sample");
  const metricPoints = createBrowserVaultMetricPoints({
    metricRows: [],
    vault: { entities: snapshot.entities },
  });
  const searchDocuments = [
    ...materializeSearchDocuments(projectedEntities),
    ...materializeSampleSummarySearchDocuments(snapshot),
  ];
  const database = openQueryProjectionDatabase(location, { create: true });

  try {
    ensureQueryProjectionSchema(database);
    const builtAt = withImmediateTransaction(database, () => {
      database.exec(`
        DELETE FROM query_entities;
        DELETE FROM query_sample_points;
        DELETE FROM query_metric_points;
        DELETE FROM query_source_manifest;
        DELETE FROM query_search_document;
        DELETE FROM query_search_fts;
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
      const insertSamplePoint = database.prepare(`
        INSERT INTO query_sample_points (
          sample_id,
          sort_rank,
          stream,
          status,
          occurred_at,
          date,
          path,
          title,
          tags_json,
          sample_json,
          experiment_slug
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMetricPoint = database.prepare(`
        INSERT INTO query_metric_points (
          metric_point_id,
          sort_rank,
          metric_key,
          biomarker_key,
          observed_at,
          date,
          grain,
          statistic,
          unit,
          value,
          value_label,
          confidence,
          source_family,
          source_kind,
          source_label,
          source_id,
          record_ids_json,
          metric_point_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      const insertSearchFts = database.prepare(`
        INSERT INTO query_search_fts (
          record_id,
          title_text,
          body_text,
          tags_text,
          structured_text
        ) VALUES (?, ?, ?, ?, ?)
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

      sampleEntities.forEach((entity, index) => {
        insertSamplePoint.run(
          entity.entityId,
          index,
          entity.stream ?? "",
          entity.status,
          entity.occurredAt,
          entity.date,
          entity.path,
          entity.title,
          JSON.stringify(entity.tags),
          JSON.stringify(entity.attributes),
          entity.experimentSlug,
        );
      });

      metricPoints.forEach((point: BrowserVaultMetricPoint, index: number) => {
        insertMetricPoint.run(
          point.id,
          index,
          point.metricKey,
          point.biomarkerKey,
          point.observedAt,
          point.date,
          point.grain,
          point.statistic,
          point.unit,
          point.value,
          point.valueLabel,
          point.confidence,
          point.sourceFamily,
          point.sourceKind,
          point.sourceLabel,
          point.sourceMetricRowId,
          JSON.stringify(point.recordIds),
          JSON.stringify(point),
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
        insertSearchFts.run(
          document.recordId,
          document.titleText,
          document.bodyText,
          document.tagsText,
          document.structuredText,
        );
      });

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

function materializeSampleSummarySearchDocuments(
  snapshot: VaultSourceSnapshot,
): SearchDocument[] {
  const vault = createVaultReadModel({
    metadata: snapshot.metadata,
    vaultRoot: "",
    entities: snapshot.entities,
  });

  return materializeSummaryDocuments(summarizeDailySamples(vault));
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

  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
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
  } finally {
    database.close();
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
    const sampleRows = database.prepare(`
      SELECT
        sample_id,
        stream,
        status,
        occurred_at,
        date,
        path,
        title,
        tags_json,
        sample_json,
        experiment_slug
      FROM query_sample_points
      ORDER BY COALESCE(occurred_at, '') ASC, sample_id ASC
    `).all().map((row) => decodeQueryProjectionSamplePointRow(row));

    return {
      metadata: parseJsonValue<QueryRecordData | null>(readMeta(database, "metadata_json"), null),
      entities: [
        ...entityRows
          .map((row) => parseJsonValue<CanonicalEntity | null>(row.entity_json, null))
          .filter((entity): entity is CanonicalEntity => entity !== null),
        ...sampleRows.map(samplePointRowToEntity),
      ].sort(compareCanonicalEntities),
    };
  } finally {
    database.close();
  }
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
      JOIN query_search_document ON query_search_document.record_id = query_search_fts.record_id
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
    !tableExists(database, "query_sample_points") ||
    !tableExists(database, "query_metric_points") ||
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

    CREATE TABLE IF NOT EXISTS query_sample_points (
      sample_id TEXT PRIMARY KEY,
      sort_rank INTEGER NOT NULL,
      stream TEXT NOT NULL,
      status TEXT,
      occurred_at TEXT,
      date TEXT,
      path TEXT NOT NULL,
      title TEXT,
      tags_json TEXT NOT NULL,
      sample_json TEXT NOT NULL,
      experiment_slug TEXT
    );

    CREATE INDEX IF NOT EXISTS query_sample_points_stream_idx ON query_sample_points(stream);
    CREATE INDEX IF NOT EXISTS query_sample_points_date_idx ON query_sample_points(date);
    CREATE INDEX IF NOT EXISTS query_sample_points_occurred_at_idx ON query_sample_points(occurred_at);
    CREATE INDEX IF NOT EXISTS query_sample_points_experiment_idx ON query_sample_points(experiment_slug);

    CREATE TABLE IF NOT EXISTS query_metric_points (
      metric_point_id TEXT PRIMARY KEY,
      sort_rank INTEGER NOT NULL,
      metric_key TEXT NOT NULL,
      biomarker_key TEXT,
      observed_at TEXT NOT NULL,
      date TEXT NOT NULL,
      grain TEXT NOT NULL,
      statistic TEXT NOT NULL,
      unit TEXT,
      value REAL NOT NULL,
      value_label TEXT NOT NULL,
      confidence TEXT NOT NULL,
      source_family TEXT,
      source_kind TEXT,
      source_label TEXT,
      source_id TEXT NOT NULL,
      record_ids_json TEXT NOT NULL,
      metric_point_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS query_metric_points_metric_latest_idx ON query_metric_points(metric_key, date DESC, observed_at DESC);
    CREATE INDEX IF NOT EXISTS query_metric_points_biomarker_latest_idx ON query_metric_points(biomarker_key, date DESC, observed_at DESC);
    CREATE INDEX IF NOT EXISTS query_metric_points_source_idx ON query_metric_points(source_id);

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
      record_id UNINDEXED,
      title_text,
      body_text,
      tags_text,
      structured_text,
      tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-_'''
    );
  `);
}

function hasQueryProjectionTables(database: DatabaseSync): boolean {
  return (
    tableExists(database, "query_entities") &&
    tableExists(database, "query_sample_points") &&
    tableExists(database, "query_metric_points") &&
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

function samplePointRowToEntity(row: QueryProjectionSamplePointRow): CanonicalEntity {
  const tags = parseStringArray(row.tags_json);
  return {
    entityId: row.sample_id,
    primaryLookupId: row.sample_id,
    lookupIds: [row.sample_id],
    family: "sample",
    recordClass: "sample",
    kind: "sample",
    status: row.status,
    occurredAt: row.occurred_at,
    date: row.date,
    path: row.path,
    title: row.title,
    body: null,
    attributes: parseJsonValue<Record<string, unknown>>(row.sample_json, {}),
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: row.stream,
    experimentSlug: row.experiment_slug,
    tags,
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
