export {
  ALL_QUERY_ENTITY_FAMILIES,
  createVaultReadModel,
  entityRelationTargetIds,
  getExperiment,
  getVaultEntities,
  getJournalEntry,
  listEntities,
  listExperiments,
  listJournalEntries,
  lookupEntityById,
  readVault,
  readVaultTolerant,
} from "./model.ts";
export type {
  EntityFilter,
  ExperimentFilter,
  JournalFilter,
  VaultEntitiesByFamily,
  VaultReadModel,
} from "./model.ts";
export type { CanonicalEntity, CanonicalEntityFamily, CanonicalRecordClass } from "./canonical-entities.ts";
export {
  describeLookupConstraint,
  ID_FAMILY_REGISTRY,
  inferIdEntityKind,
  isQueryableLookupId,
} from "./id-families.ts";
export {
  buildOverviewMetrics,
  buildOverviewWeeklyStats,
  summarizeCurrentOverviewProfile,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
} from "./overview.ts";
export type {
  OverviewExperiment,
  OverviewGoal,
  OverviewJournalEntry,
  OverviewMetric,
  OverviewProfile,
  OverviewWeeklyStat,
} from "./overview.ts";
export {
  searchVault,
  searchVaultSafe,
} from "./search.ts";
export type { SafeSearchHit, SafeSearchResult } from "./search.ts";
export {
  type QueryProjectionStatus,
  type RebuildQueryProjectionResult,
} from "./query-projection-types.ts";
export { summarizeDailySamples } from "./summaries.ts";
export {
  buildWearableAssistantSummary,
  listWearableActivityDays,
  listWearableBodyStateDays,
  listWearableRecoveryDays,
  listWearableSleepNights,
  listWearableSourceHealth,
  summarizeWearableActivity,
  summarizeWearableBodyState,
  summarizeWearableDay,
  summarizeWearableRecovery,
  summarizeWearableSleep,
  summarizeWearableSourceHealth,
} from "./wearables.ts";
export type {
  WearableActivityDay,
  WearableActivitySummary,
  WearableAssistantSummary,
  WearableBodyStateDay,
  WearableBodyStateSummary,
  WearableCandidateSourceFamily,
  WearableConfidenceLevel,
  WearableExternalRef,
  WearableFilters,
  WearableDaySummary,
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricSelection,
  WearableMetricValue,
  WearableRecoveryDay,
  WearableRecoverySummary,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSleepSummary,
  WearableSourceHealth,
  WearableSourceHealthSummary,
  WearableSummaryConfidence,
  WearableSummaryFilters,
} from "./wearables.ts";
export { buildTimeline } from "./timeline.ts";
export type { TimelineEntry, TimelineFilters } from "./timeline.ts";
export { buildExportPack } from "./export-pack.ts";
export type {
  BuildExportPackOptions,
  ExportPack,
  ExportPackAssessmentRecord,
  ExportPackBankPage,
  ExportPackCurrentProfile,
  ExportPackFile,
  ExportPackFilters,
  ExportPackHealthContext,
  ExportPackHistoryRecord,
  ExportPackManifest,
  ExportPackProfileSnapshotRecord,
  QuestionPack,
  QuestionPackContext,
  QuestionPackContextExperiment,
  QuestionPackContextJournal,
  QuestionPackInstructions,
  QuestionPackTimelineRecord,
} from "./export-pack.ts";
export {
  readHealthLibraryGraph,
  readHealthLibraryGraphWithIssues,
  type HealthLibraryEntityType,
  type HealthLibraryGraph,
  type HealthLibraryGraphIssue,
  type HealthLibraryGraphReadResult,
  type HealthLibraryNode,
} from "./health-library.ts";
export {
  DERIVED_KNOWLEDGE_INDEX_PATH,
  DERIVED_KNOWLEDGE_LOG_PATH,
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  DERIVED_KNOWLEDGE_ROOT,
  readDerivedKnowledgeGraph,
  readDerivedKnowledgeGraphWithIssues,
  renderDerivedKnowledgeIndex,
  searchDerivedKnowledgeGraph,
  searchDerivedKnowledgeVault,
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeGraphIssue,
  type DerivedKnowledgeGraphReadResult,
  type DerivedKnowledgeNode,
  type DerivedKnowledgeSearchFilters,
  type DerivedKnowledgeSearchHit,
  type DerivedKnowledgeSearchResult,
} from "./knowledge-graph.ts";
export {
  DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
  extractKnowledgeFirstHeading,
  extractKnowledgeRelatedSlugs,
  humanizeKnowledgeTag,
  normalizeKnowledgeSlug,
  normalizeKnowledgeTag,
  orderedUniqueStrings,
  sameKnowledgeStringSet,
  summarizeKnowledgeBody,
} from "./knowledge-model.ts";
export {
  renderKnowledgePageBody,
  stripGeneratedKnowledgeSections,
  stripKnowledgeLeadingHeading,
} from "./knowledge-format.ts";
export * from "./automation.ts";
export * from "./health/index.ts";
export * from "./memory.ts";

export async function getQueryProjectionStatus(
  ...args: Parameters<typeof import("./query-projection.ts").getQueryProjectionStatus>
): ReturnType<typeof import("./query-projection.ts").getQueryProjectionStatus> {
  const mod = await import("./query-projection.ts");
  return mod.getQueryProjectionStatus(...args);
}

export async function rebuildQueryProjection(
  ...args: Parameters<typeof import("./query-projection.ts").rebuildQueryProjection>
): ReturnType<typeof import("./query-projection.ts").rebuildQueryProjection> {
  const mod = await import("./query-projection.ts");
  return mod.rebuildQueryProjection(...args);
}

export async function searchVaultRuntime(
  ...args: Parameters<typeof import("./query-projection.ts").searchVaultRuntime>
): ReturnType<typeof import("./query-projection.ts").searchVaultRuntime> {
  const mod = await import("./query-projection.ts");
  return mod.searchVaultRuntime(...args);
}
