import { rm } from "node:fs/promises";

import { hasLocalStatePath } from "@murphai/runtime-state/node";

import type {
  QueryProjectionStatus,
} from "../query-projection-types.ts";
import type { QuerySourceManifestEntry } from "../vault-source.ts";
import {
  countRows,
  emptyQueryProjectionStatus as emptySchemaQueryProjectionStatus,
  expectNumber,
  expectString,
  type DatabaseSync,
  hasCurrentQueryProjectionSchema,
  hasQueryProjectionTables,
  openQueryProjectionDatabase,
  readMeta,
  type QueryProjectionLocation,
  type SqliteRow,
} from "./schema.ts";

interface QuerySourceManifestRow {
  mtimeMs: number;
  relativePath: string;
  sizeBytes: number;
}

export { emptySchemaQueryProjectionStatus as emptyQueryProjectionStatus };

export async function resetUnsupportedQueryProjection(
  location: QueryProjectionLocation,
): Promise<void> {
  if (!(await hasLocalStatePath({ currentPath: location.absolutePath }))) {
    return;
  }

  let supportedProjection = false;

  try {
    const database = openQueryProjectionDatabase(location, {
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

export async function readProjectionStatus(
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

function decodeQuerySourceManifestRow(row: SqliteRow): QuerySourceManifestRow {
  return {
    relativePath: expectString(row.relativePath, "query_source_manifest.relativePath"),
    sizeBytes: expectNumber(row.sizeBytes, "query_source_manifest.sizeBytes"),
    mtimeMs: expectNumber(row.mtimeMs, "query_source_manifest.mtimeMs"),
  };
}
