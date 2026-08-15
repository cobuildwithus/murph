import {
  QUERY_DB_RELATIVE_PATH,
  applySqliteRuntimeMigrations,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
  resolveRuntimePaths,
  tableExists,
} from "@murphai/runtime-state/node";

import type { QueryProjectionStatus } from "../query-projection-types.ts";

export type DatabaseSync = import("node:sqlite").DatabaseSync;
export type SqliteRow = Record<string, unknown>;

export const QUERY_PROJECTION_SCHEMA_ID = "murph.query-projection";
// 16: Make recovery the sole daily HRV MetricPoint owner.
// 17: bounded sleep-window support evidence and range-indexed sleep reads.
// 18: Rebuild metric identities and canonical values after lab catalog alias changes.
// 19: Rebuild test-result identities after expanded lab-only alias curation.
// 20: Rebuild canonical workout-day rollups and split workout from activity minutes.
// 21: Rebuild stored body-state summaries after adding composition metric envelopes.
// 22: Rebuild activity summaries with independent intensity and daily heart-rate facts.
// 23: Rebuild body summaries and MetricPoints after sparse-body selection semantics.
export const QUERY_PROJECTION_SQLITE_VERSION = 23;

export interface QueryProjectionLocation {
  absolutePath: string;
  dbPath: string;
}

interface QueryProjectionMetaRow {
  value: string;
}

interface QueryProjectionCountRow {
  count: number;
}

export function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${field} to be a string.`);
  }
  return value;
}

export function expectNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return expectString(value, field);
}

export function expectNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`Expected ${field} to be a number.`);
  }
  return value;
}

export function expectEnumString<TValue extends string>(
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

export function parseJsonValue<TValue>(
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

export function openQueryProjectionDatabase(
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

export function hasCurrentQueryProjectionSchema(database: DatabaseSync): boolean {
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

export function currentQueryProjectionLocation(vaultRoot: string): QueryProjectionLocation {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absolutePath: runtimePaths.queryDbPath,
    dbPath: QUERY_DB_RELATIVE_PATH,
  };
}

export function emptyQueryProjectionStatus(): QueryProjectionStatus {
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

export function ensureQueryProjectionSchema(database: DatabaseSync): void {
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
    CREATE INDEX IF NOT EXISTS query_wearable_summaries_kind_date_idx
      ON query_wearable_summaries(summary_kind, summary_date DESC);

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

export function hasQueryProjectionTables(database: DatabaseSync): boolean {
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

export function assertQueryProjectionTables(
  database: DatabaseSync,
  location: QueryProjectionLocation,
): void {
  if (!hasQueryProjectionTables(database)) {
    throw new Error(
      `Query projection at ${location.dbPath} is missing required tables. Rebuild the projection and try again.`,
    );
  }
}

export function readMeta(database: DatabaseSync, key: string): string | null {
  const row = database.prepare("SELECT value FROM query_meta WHERE key = ?").get(key);
  return row ? decodeQueryProjectionMetaRow(row).value : null;
}

export function writeMeta(database: DatabaseSync, key: string, value: string): void {
  database.prepare(`
    INSERT INTO query_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function countRows(database: DatabaseSync, tableName: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get();

  return row ? decodeQueryProjectionCountRow(row).count : 0;
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
