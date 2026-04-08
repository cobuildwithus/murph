import type {
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";
import type { SearchFilters, SearchResult } from "./search-shared.ts";

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
export type {
  CanonicalEntity,
  CanonicalEntityFamily,
  CanonicalEntityLink,
  CanonicalEntityLinkType,
  CanonicalRecordClass,
} from "./canonical-entities.ts";
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
export type {
  SearchFilters,
  SearchCitation,
  SearchHit,
  SearchResult,
} from "./search-shared.ts";
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
  listSupplementCompounds,
  listSupplements,
  readSupplement,
  showSupplement,
  showSupplementCompound,
} from "./health/index.ts";
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
  knowledgeGetResultSchema,
  knowledgeIndexRebuildResultSchema,
  knowledgeLintProblemSchema,
  knowledgeLintResultSchema,
  knowledgeListResultSchema,
  knowledgeLogEntrySchema,
  knowledgeLogTailResultSchema,
  knowledgePageMetadataSchema,
  knowledgePageReferenceSchema,
  knowledgePageSchema,
  knowledgeSearchHitSchema,
  knowledgeSearchResultSchema,
  knowledgeUpsertResultSchema,
} from "./knowledge-contracts.ts";
export type {
  KnowledgeGetResult,
  KnowledgeIndexRebuildResult,
  KnowledgeLintProblem,
  KnowledgeLintResult,
  KnowledgeListResult,
  KnowledgeLogEntry,
  KnowledgeLogTailResult,
  KnowledgePage,
  KnowledgePageMetadata,
  KnowledgePageReference,
  KnowledgeSearchHit,
  KnowledgeSearchResult,
  KnowledgeUpsertResult,
} from "./knowledge-contracts.ts";
export {
  renderKnowledgePageBody,
  stripGeneratedKnowledgeSections,
  stripKnowledgeLeadingHeading,
} from "./knowledge-format.ts";
export * from "./automation.ts";
export * from "./health/index.ts";
export * from "./memory.ts";

export async function getQueryProjectionStatus(
  vaultRoot: string,
): Promise<QueryProjectionStatus> {
  const mod = await import("./query-projection.ts");
  return mod.getQueryProjectionStatus(vaultRoot);
}

export async function rebuildQueryProjection(
  vaultRoot: string,
): Promise<RebuildQueryProjectionResult> {
  const mod = await import("./query-projection.ts");
  return mod.rebuildQueryProjection(vaultRoot);
}

export async function searchVaultRuntime(
  vaultRoot: string,
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResult> {
  const mod = await import("./query-projection.ts");
  return mod.searchVaultRuntime(vaultRoot, query, filters);
}
