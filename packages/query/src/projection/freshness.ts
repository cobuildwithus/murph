import { hasLocalStatePath } from "@murphai/runtime-state/node";

import type {
  QueryProjectionStatus,
} from "../query-projection-types.ts";
import type { QuerySourceManifestEntry } from "../vault-source.ts";
import {
  QUERY_PROJECTION_CERTIFICATE_KEY,
  QUERY_PROJECTION_SECTION_NAMES,
  countRows,
  emptyQueryProjectionStatus as emptySchemaQueryProjectionStatus,
  type DatabaseSync,
  isCurrentQueryProjectionSection,
  openQueryProjectionSection,
  queryProjectionSectionPath,
  readMeta,
  type QueryProjectionLocation,
  type QueryProjectionSection,
} from "./schema.ts";

export { emptySchemaQueryProjectionStatus as emptyQueryProjectionStatus };

/** Status of the whole projection. It exists once any section is published;
 * `fresh` means every section is certified for the current manifest, and the
 * counts and build time describe the entities section. Readers that need one
 * section ask for that one. */
export async function readProjectionStatus(
  location: QueryProjectionLocation,
  currentManifest: readonly QuerySourceManifestEntry[],
): Promise<QueryProjectionStatus | null> {
  const [fresh, schemaVersions, entities] = await Promise.all([
    readFreshQueryProjectionSections(location, currentManifest),
    Promise.all(QUERY_PROJECTION_SECTION_NAMES.map((section) =>
      readQueryProjectionSection(location, section, (database) => readMeta(database, "schema_version")))),
    readQueryProjectionSection(location, "entities", (database) => ({
      builtAt: readMeta(database, "built_at"),
      entityCount: countRows(database, "query_entities"),
      searchDocumentCount: countRows(database, "query_search_document"),
    })),
  ]);
  const schemaVersion = schemaVersions.find((version) => version !== null) ?? null;
  if (schemaVersion === null) return null;

  return {
    ...emptySchemaQueryProjectionStatus(),
    exists: true,
    schemaVersion,
    ...entities,
    fresh: fresh.size === QUERY_PROJECTION_SECTION_NAMES.length,
  };
}

/** The sections whose certificate is the current canonical manifest. A section
 * that was never published has no file, so it is never fresh, even for an
 * empty manifest. */
export async function readFreshQueryProjectionSections(
  location: QueryProjectionLocation,
  currentManifest: readonly QuerySourceManifestEntry[],
): Promise<ReadonlySet<QueryProjectionSection>> {
  const certificate = encodeSourceManifest(currentManifest);
  const fresh = await Promise.all(QUERY_PROJECTION_SECTION_NAMES.map((section) =>
    readQueryProjectionSection(location, section, (database) =>
      readMeta(database, QUERY_PROJECTION_CERTIFICATE_KEY) === certificate)));
  return new Set(QUERY_PROJECTION_SECTION_NAMES.filter((_section, index) => fresh[index] === true));
}

/** Committed with a section's rows as its certificate. */
export function encodeSourceManifest(manifest: readonly QuerySourceManifestEntry[]): string {
  return JSON.stringify(manifest.map(({ relativePath, sizeBytes, mtimeMs }) =>
    [relativePath, sizeBytes, mtimeMs]));
}

/** A section file that is missing, unreadable or written by another build
 * answers null, never an error: it is stale and the next publication replaces it. */
async function readQueryProjectionSection<T>(
  location: QueryProjectionLocation,
  section: QueryProjectionSection,
  read: (database: DatabaseSync) => T,
): Promise<T | null> {
  if (!(await hasLocalStatePath({ currentPath: queryProjectionSectionPath(location, section) }))) return null;
  let database: DatabaseSync | undefined;
  try {
    database = openQueryProjectionSection(location, section);
    return isCurrentQueryProjectionSection(database) ? read(database) : null;
  } catch {
    return null;
  } finally {
    database?.close();
  }
}
