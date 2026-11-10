import { rm } from "node:fs/promises";

import { hasLocalStatePath } from "@murphai/runtime-state/node";

import type {
  QueryProjectionStatus,
} from "../query-projection-types.ts";
import type { QuerySourceManifestEntry } from "../vault-source.ts";
import {
  QUERY_PROJECTION_SECTIONS,
  QUERY_PROJECTION_SECTION_NAMES,
  countRows,
  emptyQueryProjectionStatus as emptySchemaQueryProjectionStatus,
  type DatabaseSync,
  hasCurrentQueryProjectionSchema,
  hasQueryProjectionSectionTables,
  openQueryProjectionDatabase,
  readMeta,
  type QueryProjectionLocation,
  type QueryProjectionSection,
} from "./schema.ts";

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

/** Status of the whole projection. `fresh` means every section is certified
 * for the current manifest; readers that need one section ask for that one. */
export async function readProjectionStatus(
  location: QueryProjectionLocation,
  currentManifest: readonly QuerySourceManifestEntry[],
): Promise<QueryProjectionStatus | null> {
  return await readQueryProjection(location, (database) => {
    const hasEntities = hasQueryProjectionSectionTables(database, "entities");
    if (!hasEntities && !hasCurrentQueryProjectionSchema(database)) return null;

    return {
      dbPath: location.dbPath,
      exists: true,
      schemaVersion: readMeta(database, "schema_version"),
      builtAt: readMeta(database, "built_at"),
      entityCount: hasEntities ? countRows(database, "query_entities") : 0,
      searchDocumentCount: hasEntities ? countRows(database, "query_search_document") : 0,
      fresh: freshSections(database, currentManifest).size === QUERY_PROJECTION_SECTION_NAMES.length,
    };
  });
}

/** The sections whose certificate is the current canonical manifest. A section
 * that was never published has no certificate, so it is never fresh, even for
 * an empty manifest. */
export async function readFreshQueryProjectionSections(
  location: QueryProjectionLocation,
  currentManifest: readonly QuerySourceManifestEntry[],
): Promise<ReadonlySet<QueryProjectionSection>> {
  return await readQueryProjection(location, (database) => freshSections(database, currentManifest))
    ?? new Set();
}

/** Committed with a section's rows as its certificate. */
export function encodeSourceManifest(manifest: readonly QuerySourceManifestEntry[]): string {
  return JSON.stringify(manifest.map(({ relativePath, sizeBytes, mtimeMs }) =>
    [relativePath, sizeBytes, mtimeMs]));
}

function freshSections(
  database: DatabaseSync,
  currentManifest: readonly QuerySourceManifestEntry[],
): Set<QueryProjectionSection> {
  if (!hasCurrentQueryProjectionSchema(database)) return new Set();
  const certificate = encodeSourceManifest(currentManifest);
  return new Set(QUERY_PROJECTION_SECTION_NAMES.filter((section) =>
    hasQueryProjectionSectionTables(database, section)
    && readMeta(database, QUERY_PROJECTION_SECTIONS[section].certificateKey) === certificate));
}

/** A missing or unreadable store answers null, never an error. */
async function readQueryProjection<T>(
  location: QueryProjectionLocation,
  read: (database: DatabaseSync) => T,
): Promise<T | null> {
  if (!(await hasLocalStatePath({ currentPath: location.absolutePath }))) return null;
  let database: DatabaseSync | undefined;
  try {
    database = openQueryProjectionDatabase(location, { create: false, readOnly: true });
    return read(database);
  } catch {
    return null;
  } finally {
    database?.close();
  }
}
