import type { CanonicalEntity } from "../canonical-entities.ts";
import { compareCanonicalEntities } from "../canonical-entities.ts";
import type { QueryRecordData } from "../query-record-data.ts";
import type { QueryCanonicalEntityFilters } from "../query-projection-types.ts";
import type { VaultSourceSnapshot } from "../vault-source.ts";
import {
  assertQueryProjectionTables,
  expectString,
  openQueryProjectionDatabase,
  parseJsonValue,
  readMeta,
  type DatabaseSync,
  type QueryProjectionLocation,
  type SqliteRow,
} from "./schema.ts";

interface QueryProjectionEntityRow {
  entity_json: string;
}

export function insertQueryEntities(
  database: DatabaseSync,
  projectedEntities: readonly CanonicalEntity[],
): void {
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
}

export function readStoredVaultSource(
  location: QueryProjectionLocation,
): VaultSourceSnapshot {
  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    assertQueryProjectionTables(database, location);

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

export function listStoredCanonicalEntities(
  location: QueryProjectionLocation,
  filters: QueryCanonicalEntityFilters,
): CanonicalEntity[] {
  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    assertQueryProjectionTables(database, location);
    return queryStoredCanonicalEntities(database, filters);
  } finally {
    database.close();
  }
}

function queryStoredCanonicalEntities(
  database: DatabaseSync,
  filters: QueryCanonicalEntityFilters,
): CanonicalEntity[] {
  const whereClauses: string[] = [];
  const parameters: Array<string | number> = [];

  if (filters.family) {
    whereClauses.push("family = ?");
    parameters.push(filters.family);
  }
  if (filters.kinds && filters.kinds.length > 0) {
    whereClauses.push(`kind IN (${filters.kinds.map(() => "?").join(", ")})`);
    parameters.push(...filters.kinds);
  }
  if (filters.from) {
    whereClauses.push("(date >= ? OR occurred_at >= ?)");
    parameters.push(filters.from, `${filters.from}T00:00:00.000Z`);
  }
  if (filters.to) {
    whereClauses.push("(date <= ? OR occurred_at <= ?)");
    parameters.push(filters.to, `${filters.to}T23:59:59.999Z`);
  }

  const limit = filters.limit === null ? null : normalizeCanonicalEntityLimit(filters.limit ?? 1_000);
  const limitSql = limit === null ? "" : "LIMIT ?";
  if (limit !== null) {
    parameters.push(limit);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const rows = database.prepare(`
    SELECT entity_json
    FROM query_entities
    ${whereSql}
    ORDER BY COALESCE(date, substr(occurred_at, 1, 10)) DESC, occurred_at DESC, sort_rank ASC
    ${limitSql}
  `).all(...parameters).map((row) => decodeQueryProjectionEntityRow(row));

  return rows
    .map((row) => parseJsonValue<CanonicalEntity | null>(row.entity_json, null))
    .filter((entity): entity is CanonicalEntity => entity !== null)
    .sort(compareCanonicalEntities);
}

function normalizeCanonicalEntityLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    return 1_000;
  }
  return Math.min(value, 10_000);
}

function decodeQueryProjectionEntityRow(row: SqliteRow): QueryProjectionEntityRow {
  return {
    entity_json: expectString(row.entity_json, "query_entities.entity_json"),
  };
}
