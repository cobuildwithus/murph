export {
  getExperiment,
  getVaultEntities,
  getJournalEntry,
  listEntities,
  listExperiments,
  listJournalEntries,
  listRecords,
  lookupEntityById,
  lookupRecordById,
  readVault,
  readVaultTolerant,
} from "./model.js";
export type { CanonicalEntity, CanonicalEntityFamily } from "./canonical-entities.js";
export {
  describeLookupConstraint,
  ID_FAMILY_REGISTRY,
  inferIdEntityKind,
  isQueryableLookupId,
} from "./id-families.js";
export { searchVault } from "./search.js";
export {
  getSqliteSearchStatus,
  rebuildSqliteSearchIndex,
  searchVaultRuntime,
  searchVaultSqlite,
  type RebuildSqliteSearchIndexResult,
  type SearchBackend,
  type SqliteSearchStatus,
} from "./search-sqlite.js";
export { summarizeDailySamples } from "./summaries.js";
export { buildTimeline } from "./timeline.js";
export { buildExportPack } from "./export-pack.js";
export {
  readHealthLibraryGraph,
  type HealthLibraryEntityType,
  type HealthLibraryGraph,
  type HealthLibraryNode,
} from "./health-library.js";
export * from "./health/index.js";
