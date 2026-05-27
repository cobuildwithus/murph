import type { CanonicalEntity } from "../canonical-entities.ts";
import { compareCanonicalEntities } from "../canonical-entities.ts";
import type { QueryRecordData } from "../query-record-data.ts";
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

function decodeQueryProjectionEntityRow(row: SqliteRow): QueryProjectionEntityRow {
  return {
    entity_json: expectString(row.entity_json, "query_entities.entity_json"),
  };
}
