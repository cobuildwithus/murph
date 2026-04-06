import type { DatabaseSync } from "node:sqlite";
import { extractIsoDatePrefix } from "@murphai/contracts";
import {
  SEARCH_DB_RELATIVE_PATH,
  applySqliteRuntimeMigrations,
  hasLocalStatePathSync,
  openSqliteRuntimeDatabase,
  resolveRuntimePaths,
  tableExists,
  withImmediateTransaction,
} from "@murphai/runtime-state/node";

import { readVault } from "./model.ts";
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

const SEARCH_SCHEMA_VERSION = "murph.search.v1";
const SEARCH_SQLITE_SCHEMA_VERSION = 1;
const SQLITE_WAL_COMPANION_SUFFIXES = ["-shm", "-wal"] as const;
const DEFAULT_CANDIDATE_MULTIPLIER = 25;
const DEFAULT_MIN_CANDIDATES = 50;
const MAX_CANDIDATES = 1_000;

interface SearchDocumentRow {
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

interface SearchDatabaseLocation {
  absolutePath: string;
  dbPath: string;
}

interface ResolvedSqliteSearchStatus extends SqliteSearchStatus {
  absolutePath: string;
}

export type SearchBackend = "auto" | "scan" | "sqlite";

export interface SqliteSearchStatus {
  backend: "sqlite";
  dbPath: string;
  exists: boolean;
  schemaVersion: string | null;
  indexedAt: string | null;
  documentCount: number;
}

export interface RebuildSqliteSearchIndexResult extends SqliteSearchStatus {
  rebuilt: true;
}

export async function rebuildSqliteSearchIndex(
  vaultRoot: string,
): Promise<RebuildSqliteSearchIndexResult> {
  const vault = await readVault(vaultRoot);
  const indexedDocuments = materializeSearchDocuments(vault.entities).filter(
    (document) => document.recordType !== "sample",
  );
  const searchDatabase = currentSearchDatabaseLocation(vaultRoot);
  const database = openSearchDatabase(searchDatabase, { create: true });

  try {
    ensureSearchSchema(database);
    const indexedAt = withImmediateTransaction(database, () => {
      database.exec("DELETE FROM murph_search_document; DELETE FROM murph_search_fts;");

      const insertDocument = database.prepare(`
        INSERT INTO murph_search_document (
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
      const insertFts = database.prepare(`
        INSERT INTO murph_search_fts (
          record_id,
          title_text,
          body_text,
          tags_text,
          structured_text
        ) VALUES (?, ?, ?, ?, ?)
      `);

      for (const document of indexedDocuments) {
        insertDocument.run(
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
        insertFts.run(
          document.recordId,
          document.titleText,
          document.bodyText,
          document.tagsText,
          document.structuredText,
        );
      }

      const indexedAt = new Date().toISOString();
      writeMeta(database, "schema_version", SEARCH_SCHEMA_VERSION);
      writeMeta(database, "indexed_at", indexedAt);
      return indexedAt;
    });

    return {
      backend: "sqlite",
      dbPath: searchDatabase.dbPath,
      exists: true,
      schemaVersion: SEARCH_SCHEMA_VERSION,
      indexedAt,
      documentCount: indexedDocuments.length,
      rebuilt: true,
    };
  } finally {
    database.close();
  }
}

export function getSqliteSearchStatus(vaultRoot: string): SqliteSearchStatus {
  return resolveReadableSearchStatus(vaultRoot) ?? emptySearchStatus();
}

export async function searchVaultRuntime(
  vaultRoot: string,
  query: string,
  filters: SearchFilters = {},
  options: { backend?: SearchBackend } = {},
): Promise<SearchResult> {
  const backend = options.backend ?? "auto";

  if (backend === "scan") {
    const vault = await readVault(vaultRoot);
    return scoreSearchDocuments(materializeSearchDocuments(vault.entities), query, filters);
  }

  if (backend === "sqlite") {
    return searchVaultSqlite(vaultRoot, query, filters);
  }

  const status = resolveReadableSearchStatus(vaultRoot);
  if (status) {
    return searchVaultSqliteWithStatus(vaultRoot, query, filters, status);
  }

  const vault = await readVault(vaultRoot);
  return scoreSearchDocuments(materializeSearchDocuments(vault.entities), query, filters);
}

export async function searchVaultSqlite(
  vaultRoot: string,
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResult> {
  return searchVaultSqliteWithStatus(vaultRoot, query, filters);
}

async function searchVaultSqliteWithStatus(
  vaultRoot: string,
  query: string,
  filters: SearchFilters,
  status: ResolvedSqliteSearchStatus | null = resolveReadableSearchStatus(vaultRoot),
): Promise<SearchResult> {
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

  if (!status) {
    throw new Error(
      "SQLite search index is empty. Run `vault-cli search index rebuild --vault <path>` first or use `--backend scan`.",
    );
  }

  const database = openSearchDatabase(
    {
      absolutePath: status.absolutePath,
      dbPath: status.dbPath,
    },
    {
      create: false,
      readOnly: true,
    },
  );
  const sampleRequested = wantsSampleRows(filters);
  const sqlRecordTypes = filters.recordTypes?.filter(
    (recordType) => recordType !== "sample",
  );

  try {
    const whereClauses: string[] = ["murph_search_fts MATCH ?"];
    const parameters: Array<string | number> = [buildFtsQuery(terms)];

    appendEqualityFilters(
      whereClauses,
      parameters,
      "record_type",
      sqlRecordTypes && sqlRecordTypes.length > 0 ? sqlRecordTypes : undefined,
    );
    appendEqualityFilters(whereClauses, parameters, "kind", filters.kinds);
    appendEqualityFilters(whereClauses, parameters, "stream", filters.streams);

    if (filters.experimentSlug) {
      whereClauses.push("murph_search_document.experiment_slug = ?");
      parameters.push(filters.experimentSlug);
    }

    if (filters.from) {
      const from = extractIsoDatePrefix(filters.from) ?? filters.from;
      whereClauses.push(
        "substr(COALESCE(murph_search_document.date, murph_search_document.occurred_at), 1, 10) >= ?",
      );
      parameters.push(from);
    }

    if (filters.to) {
      const to = extractIsoDatePrefix(filters.to) ?? filters.to;
      whereClauses.push(
        "substr(COALESCE(murph_search_document.date, murph_search_document.occurred_at), 1, 10) <= ?",
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
        murph_search_document.record_id,
        murph_search_document.alias_ids_json,
        murph_search_document.record_type,
        murph_search_document.kind,
        murph_search_document.stream,
        murph_search_document.title,
        murph_search_document.occurred_at,
        murph_search_document.date,
        murph_search_document.experiment_slug,
        murph_search_document.tags_json,
        murph_search_document.path,
        murph_search_document.title_text,
        murph_search_document.body_text,
        murph_search_document.tags_text,
        murph_search_document.structured_text
      FROM murph_search_fts
      JOIN murph_search_document ON murph_search_document.record_id = murph_search_fts.record_id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY bm25(murph_search_fts) ASC, murph_search_document.record_id ASC
      LIMIT ?
    `).all(...parameters) as unknown as SearchDocumentRow[];

    const indexedDocuments = filterSearchDocuments(
      rows.map(mapRowToSearchDocument),
      filters,
    );

    if (!sampleRequested) {
      return scoreSearchDocuments(indexedDocuments, normalizedQuery, filters);
    }

    const vault = await readVault(vaultRoot);
    const sampleDocuments = filterSearchDocuments(
      materializeSearchDocuments(vault.samples),
      { ...filters, includeSamples: true },
    );
    const mergedDocuments = dedupeDocumentsByRecordId([
      ...indexedDocuments,
      ...sampleDocuments,
    ]);

    return scoreSearchDocuments(mergedDocuments, normalizedQuery, {
      ...filters,
      includeSamples: true,
    });
  } finally {
    database.close();
  }
}

function openSearchDatabase(
  location: SearchDatabaseLocation,
  options: { create?: boolean; readOnly?: boolean } = {},
): DatabaseSync {
  const database = openSqliteRuntimeDatabase(location.absolutePath, options);

  if (!(options.readOnly ?? false)) {
    applySqliteRuntimeMigrations(database, {
      migrations: [{
        version: SEARCH_SQLITE_SCHEMA_VERSION,
        migrate(candidateDatabase) {
          ensureSearchSchema(candidateDatabase);
        },
      }],
      schemaVersion: SEARCH_SQLITE_SCHEMA_VERSION,
      storeName: "search index",
    });
  }

  return database;
}

function emptySearchStatus(): SqliteSearchStatus {
  return {
    backend: "sqlite",
    dbPath: SEARCH_DB_RELATIVE_PATH,
    exists: false,
    schemaVersion: null,
    indexedAt: null,
    documentCount: 0,
  };
}

function resolveReadableSearchStatus(vaultRoot: string): ResolvedSqliteSearchStatus | null {
  return readSearchStatus(currentSearchDatabaseLocation(vaultRoot));
}

function readSearchStatus(location: SearchDatabaseLocation): ResolvedSqliteSearchStatus | null {
  if (!hasLocalStatePathSync({ currentPath: location.absolutePath })) {
    return null;
  }

  const database = openSearchDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    if (!hasIndexedSearchTables(database)) {
      return null;
    }

    const hasMeta = tableExists(database, "murph_search_meta");

    return {
      backend: "sqlite",
      absolutePath: location.absolutePath,
      dbPath: location.dbPath,
      exists: true,
      schemaVersion: hasMeta ? readMeta(database, "schema_version") : null,
      indexedAt: hasMeta ? readMeta(database, "indexed_at") : null,
      documentCount: countIndexedDocuments(database),
    };
  } finally {
    database.close();
  }
}

function currentSearchDatabaseLocation(vaultRoot: string): SearchDatabaseLocation {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absolutePath: runtimePaths.searchDbPath,
    dbPath: SEARCH_DB_RELATIVE_PATH,
  };
}

function ensureSearchSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS murph_search_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS murph_search_document (
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

    CREATE INDEX IF NOT EXISTS murph_search_document_record_type_idx ON murph_search_document(record_type);
    CREATE INDEX IF NOT EXISTS murph_search_document_kind_idx ON murph_search_document(kind);
    CREATE INDEX IF NOT EXISTS murph_search_document_stream_idx ON murph_search_document(stream);
    CREATE INDEX IF NOT EXISTS murph_search_document_experiment_idx ON murph_search_document(experiment_slug);
    CREATE INDEX IF NOT EXISTS murph_search_document_date_idx ON murph_search_document(date);
    CREATE INDEX IF NOT EXISTS murph_search_document_occurred_at_idx ON murph_search_document(occurred_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS murph_search_fts USING fts5(
      record_id UNINDEXED,
      title_text,
      body_text,
      tags_text,
      structured_text,
      tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-_'''
    );
  `);
}

function hasIndexedSearchTables(database: DatabaseSync): boolean {
  return (
    tableExists(database, "murph_search_document") &&
    tableExists(database, "murph_search_fts")
  );
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
  whereClauses.push(`murph_search_document.${column} IN (${placeholders})`);
  parameters.push(...values);
}

function mapRowToSearchDocument(row: SearchDocumentRow): SearchDocument {
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
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function buildFtsQuery(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" OR ");
}

function countIndexedDocuments(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM murph_search_document")
    .get() as { count: number } | undefined;

  return row?.count ?? 0;
}

function readMeta(database: DatabaseSync, key: string): string | null {
  const row = database.prepare("SELECT value FROM murph_search_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeMeta(database: DatabaseSync, key: string, value: string): void {
  database
    .prepare(`
      INSERT INTO murph_search_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(key, value);
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

function dedupeDocumentsByRecordId(
  documents: readonly SearchDocument[],
): SearchDocument[] {
  const seen = new Set<string>();
  const deduped: SearchDocument[] = [];

  for (const document of documents) {
    if (seen.has(document.recordId)) {
      continue;
    }

    seen.add(document.recordId);
    deduped.push(document);
  }

  return deduped;
}
