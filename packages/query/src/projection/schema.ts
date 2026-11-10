import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import {
  QUERY_PROJECTION_SECTION_RELATIVE_PATHS,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
  resolveRuntimePaths,
  withImmediateTransaction,
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
// 24: Store bounded per-workout stream features in wearable activity summaries.
// 25: Omit audit rows and unused indexes from rebuilt query stores.
// 26: Rebuild wearable provider rows after public query slug canonicalization.
// 27: Rebuild goal targets through the canonical target schema.
// 28: Independently certify wearable rows; older full rebuilders must reset them.
// 29: Rebuild sleep summaries and metrics with session classification and provider state.
// 30: Omit null biomarker index entries and clear obsolete rebuild payloads.
// 31: Pack JSON-heavy query rows in 8 KiB pages and omit unused date indexes.
// 32: Share identical metric payloads within each published generation.
// 33: Retire untouched legacy Junction oxygen analytics from default queries.
// 34: Share wearable JSON field dictionaries and pin search rowids for rebuild compaction.
// 35: Index allowlisted clinical-fact fields in private search.
// 36: Cluster metric points by metric and descending time without a sort index.
// 37: Rebuild device-first wearable selections and their daily metric provenance.
// 38: Certify entities, metrics and wearables separately; drop the manifest table.
// 39: One write-once SQLite file per section, replaced by rename.
export const QUERY_PROJECTION_SQLITE_VERSION = 39;

/** The absolute vault root whose projection section files are read or published. */
export interface QueryProjectionLocation {
  vaultRoot: string;
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

export function currentQueryProjectionLocation(vaultRoot: string): QueryProjectionLocation {
  return { vaultRoot: resolveRuntimePaths(vaultRoot).absoluteVaultRoot };
}

export function queryProjectionSectionPath(
  location: QueryProjectionLocation,
  section: QueryProjectionSection,
): string {
  return path.join(location.vaultRoot, QUERY_PROJECTION_SECTION_RELATIVE_PATHS[section]);
}

/** Open one published section read-only. A section file is never modified
 * after it is renamed into place, so an open handle is one whole generation. */
export function openQueryProjectionSection(
  location: QueryProjectionLocation,
  section: QueryProjectionSection,
): DatabaseSync {
  const sectionPath = queryProjectionSectionPath(location, section);
  if (!existsSync(sectionPath)) {
    throw new Error(
      `Query projection at ${QUERY_PROJECTION_SECTION_RELATIVE_PATHS[section]} is missing. Rebuild the projection and try again.`,
    );
  }
  return openSqliteRuntimeDatabase(sectionPath, { create: false, readOnly: true });
}

/** Whether this build wrote the open section file. */
export function isCurrentQueryProjectionSection(database: DatabaseSync): boolean {
  return readSqliteRuntimeUserVersion(database) === QUERY_PROJECTION_SQLITE_VERSION
    && readMeta(database, "schema_version") === QUERY_PROJECTION_SCHEMA_ID;
}

/** Write one section as a new file, then rename it over the published one.
 * Rows, certificate and version commit together in the new file, and a reader
 * opens either the previous whole file or this one. A failure leaves the
 * published file as it was. */
export function publishQueryProjectionSection(
  location: QueryProjectionLocation,
  section: QueryProjectionSection,
  certificate: string,
  insertRows: (database: DatabaseSync) => void,
): void {
  const sectionPath = queryProjectionSectionPath(location, section);
  const buildPath = `${sectionPath}.tmp`;
  // An interrupted publication leaves its build file behind.
  rmSync(buildPath, { force: true });
  // Nothing reads the build file before the rename, so its rollback journal
  // stays in memory and no sidecar file is written.
  const database = openSqliteRuntimeDatabase(buildPath, { journalMode: "MEMORY", pageSize: 8192 });
  try {
    withImmediateTransaction(database, () => {
      database.exec(`
        CREATE TABLE query_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ${QUERY_PROJECTION_SECTION_SCHEMA_SQL[section]}
        PRAGMA user_version = ${QUERY_PROJECTION_SQLITE_VERSION};
      `);
      insertRows(database);
      writeMeta(database, QUERY_PROJECTION_CERTIFICATE_KEY, certificate);
      writeMeta(database, "schema_version", QUERY_PROJECTION_SCHEMA_ID);
    });
  } finally {
    database.close();
  }
  renameSync(buildPath, sectionPath);
}

export function emptyQueryProjectionStatus(): QueryProjectionStatus {
  return {
    dbPath: QUERY_PROJECTION_SECTION_RELATIVE_PATHS.entities,
    exists: false,
    schemaVersion: null,
    builtAt: null,
    entityCount: 0,
    searchDocumentCount: 0,
    fresh: false,
  };
}

export type QueryProjectionSection = keyof typeof QUERY_PROJECTION_SECTION_RELATIVE_PATHS;

/** `query_meta` key holding the canonical source manifest a section file was built from. */
export const QUERY_PROJECTION_CERTIFICATE_KEY = "source_manifest";

/** The projection is three independently published sections, one file each. */
const QUERY_PROJECTION_SECTION_SCHEMA_SQL: Record<QueryProjectionSection, string> = {
  entities: `
    CREATE TABLE query_entities (
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

    CREATE INDEX query_entities_family_idx ON query_entities(family);
    CREATE INDEX query_entities_kind_idx ON query_entities(kind);

    CREATE TABLE query_search_document (
      rowid INTEGER PRIMARY KEY,
      record_id TEXT NOT NULL UNIQUE,
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

    CREATE INDEX query_search_document_record_type_idx ON query_search_document(record_type);
    CREATE INDEX query_search_document_kind_idx ON query_search_document(kind);
    CREATE INDEX query_search_document_stream_idx ON query_search_document(stream);
    CREATE INDEX query_search_document_experiment_idx ON query_search_document(experiment_slug);

    CREATE VIRTUAL TABLE query_search_fts USING fts5(
      title_text,
      body_text,
      tags_text,
      structured_text,
      content = 'query_search_document',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-_'''
    );
  `,
  metrics: `
    CREATE TABLE query_metric_payloads (
      payload_id INTEGER PRIMARY KEY,
      metric_point_json TEXT NOT NULL
    );

    CREATE TABLE query_metric_points (
      id TEXT NOT NULL,
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
      payload_id INTEGER NOT NULL REFERENCES query_metric_payloads(payload_id),
      PRIMARY KEY (metric_key, effective_date DESC, observed_at DESC, id)
    ) WITHOUT ROWID;

    CREATE INDEX query_metric_points_biomarker_latest_idx
      ON query_metric_points(biomarker_key, effective_date DESC, observed_at DESC)
      WHERE biomarker_key IS NOT NULL;

    CREATE TABLE query_metric_targets (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      biomarker_key TEXT,
      comparator TEXT NOT NULL,
      target_value REAL NOT NULL,
      target_unit TEXT NOT NULL,
      target_json TEXT NOT NULL
    );

    CREATE INDEX query_metric_targets_goal_idx ON query_metric_targets(goal_id);
    CREATE INDEX query_metric_targets_metric_idx ON query_metric_targets(metric_key);
    CREATE INDEX query_metric_targets_biomarker_idx ON query_metric_targets(biomarker_key);
  `,
  wearables: `
    CREATE TABLE query_wearable_summary_shapes (
      shape_id INTEGER PRIMARY KEY,
      keys_json TEXT NOT NULL
    );

    CREATE TABLE query_wearable_summaries (
      id TEXT PRIMARY KEY,
      provider_scope_key TEXT NOT NULL,
      provider_scope_json TEXT NOT NULL,
      summary_kind TEXT NOT NULL,
      summary_date TEXT,
      sort_rank INTEGER NOT NULL,
      summary_json TEXT NOT NULL
    );

    CREATE INDEX query_wearable_summaries_scope_kind_date_idx
      ON query_wearable_summaries(provider_scope_key, summary_kind, summary_date DESC);
    CREATE INDEX query_wearable_summaries_kind_date_idx
      ON query_wearable_summaries(summary_kind, summary_date DESC);
  `,
};

export const QUERY_PROJECTION_SECTION_NAMES = Object.keys(QUERY_PROJECTION_SECTION_SCHEMA_SQL) as QueryProjectionSection[];

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
