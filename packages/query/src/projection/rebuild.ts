import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { isDefaultProjectedQueryEntity, isSearchIndexedQueryEntity } from "../query-visibility.ts";
import { createVaultReadModel } from "../read-model.ts";
import {
  materializeSampleSummarySearchDocuments as materializeSummaryDocuments,
  materializeSearchDocuments,
} from "../search-shared.ts";
import { buildMetricProjection } from "../metrics/projection.ts";
import {
  readVaultSourceStrict,
  type QuerySourceManifestEntry,
  type VaultSourceSnapshot,
} from "../vault-source.ts";
import type { RebuildQueryProjectionResult } from "../query-projection-types.ts";
import { insertQueryEntities } from "./entity-store.ts";
import { resetUnsupportedQueryProjection } from "./freshness.ts";
import {
  extractMetricTargetsFromCanonicalEntities,
  insertMetricPoints,
  insertMetricTargets,
} from "./metric-store.ts";
import { insertSearchDocuments } from "./search-store.ts";
import {
  QUERY_PROJECTION_SCHEMA_ID,
  currentQueryProjectionLocation,
  ensureQueryProjectionSchema,
  openQueryProjectionDatabase,
  writeMeta,
  type DatabaseSync,
  type QueryProjectionLocation,
} from "./schema.ts";
import {
  buildWearableSummaryProjection,
} from "./wearable-summary-projector.ts";
import {
  insertWearableSummaryRows,
} from "./wearable-summary-store.ts";

export async function rebuildQueryProjectionWithManifest(
  vaultRoot: string,
  currentManifest: readonly QuerySourceManifestEntry[],
  location: QueryProjectionLocation = currentQueryProjectionLocation(vaultRoot),
  readSource: (vaultRoot: string) => Promise<VaultSourceSnapshot> = readVaultSourceStrict,
): Promise<RebuildQueryProjectionResult> {
  await resetUnsupportedQueryProjection(location);
  const snapshot = await readSource(vaultRoot);
  const projectedEntities = snapshot.entities.filter(isDefaultProjectedQueryEntity);
  const snapshotReadModel = createVaultReadModel({
    metadata: snapshot.metadata,
    vaultRoot,
    entities: snapshot.entities,
  });
  const metricProjection = buildMetricProjection(snapshotReadModel);
  const dailySampleSummaries = metricProjection.dailySampleSummaries;
  const metricPoints = metricProjection.metricPoints;
  const metricTargets = extractMetricTargetsFromCanonicalEntities(snapshot.entities);
  const wearableSummaries = buildWearableSummaryProjection(snapshotReadModel);
  const searchableEntities = projectedEntities.filter(isSearchIndexedQueryEntity);
  const searchDocuments = [
    ...materializeSearchDocuments(searchableEntities),
    ...materializeSummaryDocuments(dailySampleSummaries),
  ];
  const database = openQueryProjectionDatabase(location, { create: true });

  try {
    ensureQueryProjectionSchema(database);
    const builtAt = withImmediateTransaction(database, () => {
      database.exec(`
        DELETE FROM query_entities;
        DELETE FROM query_metric_points;
        DELETE FROM query_metric_targets;
        DELETE FROM query_wearable_summaries;
        DELETE FROM query_source_manifest;
        DELETE FROM query_search_document;
      `);

      insertQueryEntities(database, projectedEntities);
      insertMetricPoints(database, metricPoints);
      insertMetricTargets(database, metricTargets);
      insertWearableSummaryRows(database, wearableSummaries);
      insertQuerySourceManifest(database, currentManifest);
      insertSearchDocuments(database, searchDocuments);

      const builtAt = new Date().toISOString();
      writeMeta(database, "schema_version", QUERY_PROJECTION_SCHEMA_ID);
      writeMeta(database, "built_at", builtAt);
      writeMeta(database, "metadata_json", JSON.stringify(snapshot.metadata ?? null));
      return builtAt;
    });

    return {
      dbPath: location.dbPath,
      exists: true,
      schemaVersion: QUERY_PROJECTION_SCHEMA_ID,
      builtAt,
      entityCount: projectedEntities.length,
      searchDocumentCount: searchDocuments.length,
      fresh: true,
      rebuilt: true,
    };
  } finally {
    database.close();
  }
}

function insertQuerySourceManifest(
  database: DatabaseSync,
  currentManifest: readonly QuerySourceManifestEntry[],
): void {
  const insertManifestEntry = database.prepare(`
    INSERT INTO query_source_manifest (
      relative_path,
      size_bytes,
      mtime_ms
    ) VALUES (?, ?, ?)
  `);

  currentManifest.forEach((entry) => {
    insertManifestEntry.run(entry.relativePath, entry.sizeBytes, entry.mtimeMs);
  });
}
