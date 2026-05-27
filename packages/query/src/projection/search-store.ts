import { extractIsoDatePrefix } from "@murphai/contracts";

import type { CanonicalEntityFamily } from "../canonical-entities.ts";
import { ALL_QUERY_ENTITY_FAMILIES } from "../entity-families.ts";
import {
  filterSearchDocuments,
  normalizeSearchLimit,
  scoreSearchDocuments,
  tokenize,
  wantsSampleSearchDocuments,
  type SearchDocument,
  type SearchFilters,
  type SearchResult,
} from "../search-shared.ts";
import {
  assertQueryProjectionTables,
  expectEnumString,
  expectNullableString,
  expectString,
  openQueryProjectionDatabase,
  parseJsonValue,
  type DatabaseSync,
  type QueryProjectionLocation,
  type SqliteRow,
} from "./schema.ts";

const DEFAULT_CANDIDATE_MULTIPLIER = 25;
const DEFAULT_MIN_CANDIDATES = 50;
const MAX_CANDIDATES = 1_000;

interface QueryProjectionSearchDocumentRow {
  alias_ids_json: string;
  body_text: string;
  date: string | null;
  experiment_slug: string | null;
  kind: string | null;
  occurred_at: string | null;
  path: string;
  record_id: string;
  record_type: SearchDocument["recordType"];
  stream: string | null;
  structured_text: string;
  tags_json: string;
  tags_text: string;
  title: string | null;
  title_text: string;
}

export function insertSearchDocuments(
  database: DatabaseSync,
  searchDocuments: readonly SearchDocument[],
): void {
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
}

export function searchQueryProjection(
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
    assertQueryProjectionTables(database, location);

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

function buildFtsQuery(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" OR ");
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

const wantsSampleRows = wantsSampleSearchDocuments;
