import type { DatabaseSync } from "node:sqlite";
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
import {
  filterSearchDocuments,
  materializeSearchDocuments,
  normalizeSearchLimit,
  scoreSearchDocuments,
  tokenize,
  type SearchDocument,
  type SearchFilters,
  type SearchResult,
} from "./search-shared.ts";
import {
  listCanonicalSourceManifest,
  readVaultSourceStrict,
  type QueryRecordData,
  type QuerySourceManifestEntry,
  type VaultSourceSnapshot,
} from "./vault-source.ts";
import type {
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";

export type {
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";

const QUERY_PROJECTION_SCHEMA_ID = "murph.query-projection.v1";
const QUERY_PROJECTION_SQLITE_VERSION = 1;
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
  const searchDocuments = materializeSearchDocuments(snapshot.entities);
  const database = openQueryProjectionDatabase(location, { create: true });

  try {
    ensureQueryProjectionSchema(database);
    const builtAt = withImmediateTransaction(database, () => {
      database.exec(`
        DELETE FROM query_entities;
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

      snapshot.entities.forEach((entity, index) => {
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
      entityCount: snapshot.entities.length,
      searchDocumentCount: searchDocuments.length,
      fresh: true,
      rebuilt: true,
    };
  } finally {
    database.close();
  }
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
    `).all() as unknown as QueryProjectionEntityRow[];

    return {
      metadata: parseJsonValue<QueryRecordData | null>(readMeta(database, "metadata_json"), null),
      entities: entityRows
        .map((row) => parseJsonValue<CanonicalEntity | null>(row.entity_json, null))
        .filter((entity): entity is CanonicalEntity => entity !== null),
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
    `).all(...parameters) as unknown as QueryProjectionSearchDocumentRow[];

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
  `).all() as unknown as QuerySourceManifestEntry[];
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
  const row = database.prepare("SELECT value FROM query_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
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
    .get() as { count: number } | undefined;

  return row?.count ?? 0;
}

function wantsSampleRows(filters: SearchFilters): boolean {
  return (
    filters.includeSamples ??
    Boolean(
      filters.recordTypes?.includes("sample") ||
      (filters.streams && filters.streams.length > 0),
    )
  );
}
