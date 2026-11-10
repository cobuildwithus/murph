import { withCanonicalWriteLock } from "@murphai/core";
import { startCliPhase, timeCliPhase, timeCliPhaseSync } from "@murphai/runtime-state/node/cli-timing";

import { isDefaultProjectedQueryEntity, isSearchIndexedQueryEntity } from "../query-visibility.ts";
import { createVaultReadModel } from "../read-model.ts";
import {
  materializeSampleSummarySearchDocuments as materializeSummaryDocuments,
  materializeSearchDocuments,
} from "../search-shared.ts";
import { summarizeDailySamples } from "../summaries.ts";
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
import { insertQueryEntities } from "./entity-store.ts";
import {
  encodeSourceManifest,
  readFreshQueryProjectionSections,
} from "./freshness.ts";
import {
  extractMetricTargetsFromCanonicalEntities,
  insertMetricPoints,
  insertMetricTargets,
} from "./metric-store.ts";
import { insertSearchDocuments } from "./search-store.ts";
import {
  currentQueryProjectionLocation,
  publishQueryProjectionSection,
  writeMeta,
  type QueryProjectionLocation,
  type QueryProjectionSection,
} from "./schema.ts";
import {
  buildWearableSummaryProjectionFromDataset,
} from "./wearable-summary-projector.ts";
import {
  insertWearableSummaryRows,
  readWearableSummaryRows,
  type QueryWearableSummaryRowSet,
  type ReadWearableSummaryRowsFilters,
} from "./wearable-summary-store.ts";

export interface PublishQueryProjectionSectionsOptions {
  /** Republish the requested sections even when their certificates match. */
  force?: boolean;
  location?: QueryProjectionLocation;
  readSource?: (vaultRoot: string) => Promise<VaultSourceSnapshot>;
}

/** The one owner of projection publication. Under the canonical write lock it
 * replaces the file of each requested section whose certificate is not the
 * current manifest, then runs `capture` before releasing the lock.
 *
 * Source files and their manifest must describe one committed state, so the
 * existing cross-process writer boundary is held through publication: a query
 * cannot expose a partially applied import or overwrite a newer view. A caller
 * that must read rows of exactly this generation reads them in `capture`. */
export async function publishQueryProjectionSections<T>(
  vaultRoot: string,
  sections: readonly QueryProjectionSection[],
  capture: (location: QueryProjectionLocation) => T | Promise<T>,
  options: PublishQueryProjectionSectionsOptions = {},
): Promise<T> {
  const location = options.location ?? currentQueryProjectionLocation(vaultRoot);
  // Do not join a pending publication: it may be waiting for our reentrant lock.
  const endWait = startCliPhase("query-wait");
  try {
    return await withCanonicalWriteLock(vaultRoot, async () => {
      endWait();
      const manifest = await timeCliPhase("query-manifest", () => listCanonicalSourceManifest(vaultRoot));
      const fresh = options.force
        ? new Set<QueryProjectionSection>()
        : await timeCliPhase("query-status", () => readFreshQueryProjectionSections(location, manifest));
      const stale = sections.filter((section) => !fresh.has(section));
      if (stale.length > 0) {
        await timeCliPhase("query-rebuild", () => publishSections({
          location,
          manifest,
          readSource: options.readSource ?? readProjectionSource,
          sections: new Set(stale),
          vaultRoot,
        }));
      }
      return await capture(location);
    });
  } finally {
    endWait();
  }
}

/** Capture committed wearable rows before the lock is released. Composition
 * owns only these rows, not a pending promise another lock owner could wait
 * behind. */
export async function readFreshWearableSummaryRows(
  vaultRoot: string,
  filters: ReadWearableSummaryRowsFilters,
): Promise<QueryWearableSummaryRowSet> {
  return await timeCliPhase("query-freshness", () => publishQueryProjectionSections(
    vaultRoot,
    ["wearables"],
    (location) => readWearableSummaryRows(location, filters),
  ));
}

/** No section stores audit records, so publication never parses them. */
function readProjectionSource(vaultRoot: string): Promise<VaultSourceSnapshot> {
  return readVaultSourceStrict(vaultRoot, { audits: false });
}

async function publishSections(input: {
  location: QueryProjectionLocation;
  manifest: readonly QuerySourceManifestEntry[];
  readSource: (vaultRoot: string) => Promise<VaultSourceSnapshot>;
  sections: ReadonlySet<QueryProjectionSection>;
  vaultRoot: string;
}): Promise<void> {
  const { location, sections, vaultRoot } = input;
  // One strict source read serves every section, and everything is validated
  // and derived before any stored row is touched: a malformed source or a
  // failed derivation leaves the previous projection in place.
  const snapshot = await timeCliPhase("query-source-read", () => input.readSource(vaultRoot));
  const readModel = createVaultReadModel({
    metadata: snapshot.metadata,
    vaultRoot,
    entities: snapshot.entities,
  });
  // Metrics and wearables derive from the same dataset; entities never need it.
  const wearableDataset = sections.has("metrics") || sections.has("wearables")
    ? timeCliPhaseSync("query-wearable-dataset", () => collectWearableDataset(readModel, {}))
    : undefined;
  const metrics = wearableDataset && sections.has("metrics")
    ? timeCliPhaseSync("query-metric-projection", () => {
      // Nested fixed subphases; the shared owner stays free of Node timing.
      const projection = buildMetricProjection(readModel, { startStep: startCliPhase, wearableDataset });
      return {
        dailySampleSummaries: projection.dailySampleSummaries,
        points: projection.metricPoints,
        targets: timeCliPhaseSync("query-metric-targets",
          () => extractMetricTargetsFromCanonicalEntities(snapshot.entities)),
      };
    })
    : null;
  const wearableRows = wearableDataset && sections.has("wearables")
    ? timeCliPhaseSync("query-wearable-summary", () => buildWearableSummaryProjectionFromDataset(wearableDataset))
    : null;
  const entities = sections.has("entities")
    ? timeCliPhaseSync("query-search-documents", () => {
      const projected = snapshot.entities.filter(isDefaultProjectedQueryEntity);
      return {
        projected,
        // Search indexes the daily sample summaries too. They come from the
        // samples alone, so an entities-only publication never runs the
        // metric pipeline to get them.
        searchDocuments: [
          ...materializeSearchDocuments(projected.filter(isSearchIndexedQueryEntity)),
          ...materializeSummaryDocuments(metrics?.dailySampleSummaries ?? summarizeDailySamples(readModel)),
        ],
      };
    })
    : null;

  // Each section is written as a new file and renamed into place, so one that
  // fails leaves its previous file, and any section already renamed stays valid
  // under its own certificate.
  timeCliPhaseSync("query-publication", () => {
    const certificate = encodeSourceManifest(input.manifest);
    if (entities) {
      publishQueryProjectionSection(location, "entities", certificate, (database) => {
        insertQueryEntities(database, entities.projected);
        insertSearchDocuments(database, entities.searchDocuments);
        writeMeta(database, "built_at", new Date().toISOString());
        writeMeta(database, "metadata_json", JSON.stringify(snapshot.metadata ?? null));
      });
    }
    if (metrics) {
      publishQueryProjectionSection(location, "metrics", certificate, (database) => {
        insertMetricPoints(database, metrics.points);
        insertMetricTargets(database, metrics.targets);
      });
    }
    if (wearableRows) {
      publishQueryProjectionSection(location, "wearables", certificate, (database) => {
        insertWearableSummaryRows(database, wearableRows);
      });
    }
  });
}
