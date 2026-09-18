import { withCanonicalWriteLock } from "@murphai/core";
import { withImmediateTransaction } from "@murphai/runtime-state/node";
import { startCliPhase, timeCliPhase } from "@murphai/runtime-state/node/cli-timing";

import { isDefaultProjectedQueryEntity, isSearchIndexedQueryEntity } from "../query-visibility.ts";
import { createVaultReadModel } from "../read-model.ts";
import {
  materializeSampleSummarySearchDocuments as materializeSummaryDocuments,
  materializeSearchDocuments,
} from "../search-shared.ts";
import {
  buildMetricProjection,
} from "../metrics/projection.ts";
import {
  listCanonicalSourceManifest,
  readVaultSourceStrict,
  type QuerySourceManifestEntry,
  type VaultSourceSnapshot,
} from "../vault-source.ts";
import { collectWearableDataset } from "../wearables/candidates.ts";
import type { RebuildQueryProjectionResult } from "../query-projection-types.ts";
import type { WearableSummaryFilters } from "../wearables.ts";
import { insertQueryEntities } from "./entity-store.ts";
import {
  isWearableProjectionFresh,
  resetUnsupportedQueryProjection,
  writeWearableSourceManifest,
} from "./freshness.ts";
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
  buildWearableSummaryProjectionFromDataset,
} from "./wearable-summary-projector.ts";
import {
  insertWearableSummaryRows,
  readWearableSummaryRows,
  type QueryWearableSummaryRow,
  type QueryWearableSummaryRowSet,
} from "./wearable-summary-store.ts";

export async function rebuildQueryProjectionFromCanonicalSource(
  vaultRoot: string,
  location: QueryProjectionLocation = currentQueryProjectionLocation(vaultRoot),
  readSource: (vaultRoot: string) => Promise<VaultSourceSnapshot> = readVaultSourceStrict,
): Promise<RebuildQueryProjectionResult> {
  // Source files and their manifest must describe one committed state. Hold the
  // existing cross-process writer boundary through publication so a query cannot
  // expose a partially applied import, rollback data, or overwrite a newer view.
  return await withCanonicalWriteLock(vaultRoot, async () => {
    await resetUnsupportedQueryProjection(location);
    const currentManifest = await listCanonicalSourceManifest(vaultRoot);
    const snapshot = await timeCliPhase("query-source-read", () => readSource(vaultRoot));
    const projectedEntities = snapshot.entities.filter(isDefaultProjectedQueryEntity);
    const snapshotReadModel = createVaultReadModel({
      metadata: snapshot.metadata,
      vaultRoot,
      entities: snapshot.entities,
    });
    let wearableDataset: ReturnType<typeof collectWearableDataset>;
    const endDataset = startCliPhase("query-wearable-dataset");
    try {
      wearableDataset = collectWearableDataset(snapshotReadModel, {});
    } finally {
      endDataset();
    }
    let dailySampleSummaries: ReturnType<typeof buildMetricProjection>["dailySampleSummaries"];
    let metricPoints: ReturnType<typeof buildMetricProjection>["metricPoints"];
    let metricTargets: ReturnType<typeof extractMetricTargetsFromCanonicalEntities>;
    const endMetrics = startCliPhase("query-metric-projection");
    try {
      const metricProjection = buildMetricProjection(snapshotReadModel, {
        wearableDataset,
      });
      dailySampleSummaries = metricProjection.dailySampleSummaries;
      metricPoints = metricProjection.metricPoints;
      metricTargets = extractMetricTargetsFromCanonicalEntities(snapshot.entities);
    } finally {
      endMetrics();
    }
    // A preceding source-only read may have already published this exact
    // canonical generation. Global metrics still have their own derivation.
    let wearableSummaries: ReturnType<typeof buildWearableSummaryProjectionFromDataset> | null = null;
    if (!(await isWearableProjectionFresh(location, currentManifest))) {
      const endSummary = startCliPhase("query-wearable-summary");
      try {
        wearableSummaries = buildWearableSummaryProjectionFromDataset(wearableDataset);
      } finally {
        endSummary();
      }
    }
    let searchDocuments: ReturnType<typeof materializeSearchDocuments>;
    const endSearch = startCliPhase("query-search-documents");
    try {
      const searchableEntities = projectedEntities.filter(isSearchIndexedQueryEntity);
      searchDocuments = [
        ...materializeSearchDocuments(searchableEntities),
        ...materializeSummaryDocuments(dailySampleSummaries),
      ];
    } finally {
      endSearch();
    }
    // Include opening/schema setup and close, even when either throws.
    const endPublication = startCliPhase("query-publication");
    try {
      const database = openQueryProjectionDatabase(location, { create: true, wearableOnly: true });

      try {
        const builtAt = withImmediateTransaction(database, () => {
          // Schema promotion is atomic too: failed publication must not leave
          // empty global tables readable by a mixed-version in-flight reader.
          ensureQueryProjectionSchema(database);
          database.exec(`
            DELETE FROM query_entities;
            DELETE FROM query_metric_points;
            DELETE FROM query_metric_targets;
            DELETE FROM query_source_manifest;
            DELETE FROM query_search_document;
          `);

          insertQueryEntities(database, projectedEntities);
          insertMetricPoints(database, metricPoints);
          insertMetricTargets(database, metricTargets);
          if (wearableSummaries !== null) {
            replaceWearableProjection(database, wearableSummaries, currentManifest);
          }
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
    } finally {
      endPublication();
    }
  });
}

/** Capture committed stored rows under the existing cross-process reentrant
 * lock. A stale read publishes only wearables, never global query work. */
export async function readFreshWearableSummaryRows(
  vaultRoot: string,
  filters: Pick<WearableSummaryFilters, "providers">,
): Promise<QueryWearableSummaryRowSet> {
  const endFreshness = startCliPhase("query-freshness");
  const endWait = startCliPhase("query-wait");
  try {
    return await withCanonicalWriteLock(vaultRoot, async () => {
      endWait();
      const location = currentQueryProjectionLocation(vaultRoot);
      const manifest = await timeCliPhase("query-manifest", () => listCanonicalSourceManifest(vaultRoot));
      const fresh = await timeCliPhase("query-status", () => isWearableProjectionFresh(location, manifest));
      if (!fresh) {
        await timeCliPhase("query-rebuild", async () => {
          // Keep strict-source failures intact, including empty provider scopes.
          // Do not destroy an old projection before canonical validation succeeds.
          const snapshot = await timeCliPhase("query-source-read", () => readVaultSourceStrict(vaultRoot));
          let dataset: ReturnType<typeof collectWearableDataset>;
          const endDataset = startCliPhase("query-wearable-dataset");
          try {
            dataset = collectWearableDataset(createVaultReadModel({ ...snapshot, vaultRoot }), {});
          } finally {
            endDataset();
          }
          let rows: ReturnType<typeof buildWearableSummaryProjectionFromDataset>;
          const endSummary = startCliPhase("query-wearable-summary");
          try {
            rows = buildWearableSummaryProjectionFromDataset(dataset);
          } finally {
            endSummary();
          }
          await resetUnsupportedQueryProjection(location);
          const endPublication = startCliPhase("query-publication");
          try {
            const database = openQueryProjectionDatabase(location, { create: true, wearableOnly: true });
            try {
              withImmediateTransaction(database, () => {
                replaceWearableProjection(database, rows, manifest);
                writeMeta(database, "schema_version", QUERY_PROJECTION_SCHEMA_ID);
              });
            } finally {
              database.close();
            }
          } finally {
            endPublication();
          }
        });
      }
      // Capture before releasing the lock; composition owns only these rows,
      // not a pending promise that another lock owner could wait behind.
      return readWearableSummaryRows(location, filters);
    });
  } finally {
    endWait();
    endFreshness();
  }
}

function replaceWearableProjection(
  database: DatabaseSync,
  rows: readonly QueryWearableSummaryRow[],
  manifest: readonly QuerySourceManifestEntry[],
): void {
  database.exec("DELETE FROM query_wearable_summaries");
  insertWearableSummaryRows(database, rows);
  writeWearableSourceManifest(database, manifest);
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
