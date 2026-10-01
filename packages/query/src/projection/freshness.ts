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
  writeMeta,
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

    const hasGlobalTables = hasQueryProjectionTables(database);
    if (!hasGlobalTables && !hasCurrentQueryProjectionSchema(database)) return null;

    return {
      dbPath: location.dbPath,
      exists: true,
      schemaVersion: readMeta(database, "schema_version"),
      builtAt: readMeta(database, "built_at"),
      entityCount: hasGlobalTables ? countRows(database, "query_entities") : 0,
      searchDocumentCount: hasGlobalTables ? countRows(database, "query_search_document") : 0,
      fresh:
        hasGlobalTables &&
        hasCurrentQueryProjectionSchema(database) &&
        readMeta(database, "built_at") !== null &&
        sameSourceManifest(currentManifest, readStoredSourceManifest(database)) &&
        wearableSourceManifestMatches(database, currentManifest),
    };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

/** The same canonical manifest contract, independently certified for wearable
 * rows in the existing metadata owner. No timestamp or global freshness proxy. */
export async function isWearableProjectionFresh(
  location: QueryProjectionLocation,
  currentManifest: readonly QuerySourceManifestEntry[],
): Promise<boolean> {
  if (!(await hasLocalStatePath({ currentPath: location.absolutePath }))) return false;
  let database: DatabaseSync | undefined;
  try {
    database = openQueryProjectionDatabase(location, { create: false, readOnly: true });
    return hasCurrentQueryProjectionSchema(database)
      && wearableSourceManifestMatches(database, currentManifest);
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

/** Must be committed in the same transaction as the corresponding rows. */
export function writeWearableSourceManifest(
  database: DatabaseSync,
  currentManifest: readonly QuerySourceManifestEntry[],
): void {
  writeMeta(database, "wearable_source_manifest", encodeSourceManifest(currentManifest));
}

function wearableSourceManifestMatches(
  database: DatabaseSync,
  currentManifest: readonly QuerySourceManifestEntry[],
): boolean {
  return readMeta(database, "wearable_source_manifest") === encodeSourceManifest(currentManifest);
}

function encodeSourceManifest(manifest: readonly QuerySourceManifestEntry[]): string {
  return JSON.stringify(manifest.map(({ relativePath, sizeBytes, mtimeMs }) =>
    [relativePath, sizeBytes, mtimeMs]));
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
