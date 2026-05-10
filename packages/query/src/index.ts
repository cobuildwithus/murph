import type {
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";
import type { SearchFilters, SearchResult } from "./search-shared.ts";

export {
  createVaultReadModel,
  entityRelationTargetIds,
  getExperiment,
  getProtocol,
  getVaultEntities,
  getJournalEntry,
  listEntities,
  listExperiments,
  listJournalEntries,
  listProtocols,
  lookupEntityById,
} from "./model.ts";
export {
  readVault,
  readVaultTolerant,
} from "./vault-reader.ts";
export {
  listCanonicalSourceManifest,
} from "./vault-source.ts";
export type {
  QuerySourceManifestEntry,
} from "./vault-source.ts";
export type {
  EntityFilter,
  ExperimentFilter,
  JournalFilter,
  ProtocolFilter,
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
  listAutomations,
  readAutomation,
  showAutomation,
} from "./automation.ts";
export type {
  AutomationListOptions,
  AutomationQueryRecord,
} from "./automation.ts";
export {
  describeLookupConstraint,
  ID_FAMILY_REGISTRY,
  inferIdEntityKind,
  isQueryableLookupId,
} from "./id-families.ts";
export {
  buildOverviewMetrics,
  isActiveOverviewExperimentStatus,
  buildOverviewWeeklyStats,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
} from "./overview.ts";
export type {
  OverviewExperiment,
  OverviewJournalEntry,
  OverviewMetric,
  OverviewWeeklyStat,
} from "./overview.ts";
export {
  analyzeExperimentOutcome,
  decideExperimentFollowupDue,
  summarizeExperimentProgress,
} from "./experiments.ts";
export {
  synthesizeLegacySessionAdherenceTargets,
} from "./experiment-adherence.ts";
export type {
  ExperimentAdherenceStatus,
  ExperimentCoverageStatus,
  ExperimentFollowupAction,
  ExperimentFollowupDueDecision,
  ExperimentFollowupKind,
  ExperimentFollowupReason,
  ExperimentMetricResult,
  ExperimentOutcomeConfidenceLevel,
  ExperimentOutcomeSummary,
  ExperimentProgressPhase,
  ExperimentProgressSummary,
  ExperimentRecommendationAction,
} from "./experiments.ts";
export {
  getProtocolSummary,
  isProtocolEntity,
  listProtocolSummaries,
  PROTOCOL_DIRECTORY,
  PROTOCOL_DOC_TYPE,
  PROTOCOL_FAMILY,
  readExperimentProtocolProjectionFields,
  summarizeProtocol,
} from "./protocols.ts";
export type {
  ExperimentProtocolProjectionFields,
  ProtocolSummary,
} from "./protocols.ts";
export type { DailySampleSummary, SampleWindowSummaryFilter } from "./summaries.ts";
export { summarizeDailySamples, summarizeSampleWindow } from "./summaries.ts";
export {
  readMealNutritionTotals,
  summarizeMealNutritionTotals,
} from "./meal-nutrition.ts";
export type {
  MealNutritionDayTotal,
  MealNutritionMetricTotal,
  MealNutritionTotals,
  MealNutritionTotalsOptions,
  MealNutritionTotalsResult,
} from "./meal-nutrition.ts";
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
  buildMetricSeries,
  createCustomMetricDefinition,
  formatMetricDisplayValue,
  listMetricDefinitions,
  normalizeMetricKey,
  normalizeMetricValue,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricGoalProgress,
  selectMetricSeries,
  selectMetricTrend,
  selectMetricValue,
  selectMetricWindowComparison,
  type GoalMetricTarget,
  type MetricDefinition,
  type MetricGoalProgress,
  type MetricGoalProgressStatus,
  type MetricPoint,
  type MetricSelection,
  type MetricSelectionPolicy,
  type MetricSeries,
  type MetricSeriesAggregation,
  type MetricSeriesDuplicatePolicy,
  type MetricSeriesPoint,
  type MetricTrend,
  type MetricWindowComparison,
  type MetricWindowSummary,
  type MetricSelectionWarning,
} from "@murphai/health-metrics";
export {
  buildMetricProjection,
  buildWearableMetricEvidence,
} from "./metrics/projection.ts";
export type {
  MetricProjection,
} from "./metrics/projection.ts";
export {
  extractMetricPoints,
  extractMetricPointsFromCanonicalEntities,
  extractMetricPointsFromMetricRows,
  type MetricRowEvidence,
} from "./metrics/index.ts";
export {
  type QueryProjectionStatus,
  type RebuildQueryProjectionResult,
} from "./query-projection-types.ts";
export {
  buildWearableAssistantSummary,
  collectCanonicalWearableDataset,
  explainWearableDrift,
  listWearableActivityDays,
  listWearableBodyStateDays,
  listWearableRecoveryDays,
  listWearableSleepNights,
  listWearableSourceHealth,
  summarizeWearableLatest,
  summarizeWearableActivity,
  summarizeWearableBodyState,
  summarizeWearableDay,
  summarizeWearableMetricLatest,
  summarizeWearableMetricTrend,
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
  WearableDriftSummary,
  WearableLatestSummary,
  WearableMetricCandidate,
  WearableMetricConfidence,
  WearableMetricKey,
  WearableMetricLatestSummary,
  WearableMetricSelection,
  WearableMetricSummaryFilters,
  WearableMetricSummaryKind,
  WearableMetricTrendPoint,
  WearableMetricTrendSummary,
  WearableMetricValue,
  WearableMetricWindowStats,
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
  ExportPackFile,
  ExportPackFilters,
  ExportPackHealthEventRecord,
  ExportPackHealthContext,
  ExportPackManifest,
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
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeGraphIssue,
  type DerivedKnowledgeGraphReadResult,
  type DerivedKnowledgeNode,
} from "./knowledge-graph.ts";
export {
  searchDerivedKnowledgeGraph,
  searchDerivedKnowledgeVault,
  type KnowledgeGraphSearchFilters,
} from "./knowledge-search.ts";
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
  knowledgeGraphSearchHitSchema,
  knowledgeGraphSearchResultSchema,
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
  KnowledgeGraphSearchHit,
  KnowledgeGraphSearchResult,
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

export async function listMetricPoints(
  vaultRoot: string,
  filters: import("./query-projection.ts").QueryMetricPointFilters = {},
): Promise<import("@murphai/health-metrics").MetricPoint[]> {
  const mod = await import("./query-projection.ts");
  return mod.listMetricPointsRuntime(vaultRoot, filters);
}

export async function selectMetric(input: {
  biomarkerKey?: string;
  metricKey?: string;
  now?: string;
  vaultRoot: string;
}): Promise<import("@murphai/health-metrics").MetricSelection> {
  const mod = await import("./query-projection.ts");
  return mod.selectMetricRuntime(input);
}

export type {
  CalculateMurphAgeForVaultInput,
  CalculateMurphAgeFromVaultInputBundleInput,
} from "./murph-age.ts";
export {
  metricPointFiltersForMurphAgeInputBundle,
  metricPointFiltersForMurphAgeModel,
} from "./murph-age.ts";

export async function calculateMurphAgeForVault(
  input: import("./murph-age.ts").CalculateMurphAgeForVaultInput,
): Promise<import("@murphai/health-metrics").MurphAgeResult> {
  const mod = await import("./murph-age.ts");
  return mod.calculateMurphAgeForVault(input);
}

export async function calculateMurphAgeFromVaultInputBundle(
  input: import("./murph-age.ts").CalculateMurphAgeFromVaultInputBundleInput,
): Promise<import("@murphai/health-metrics").MurphAgeCalculatorOutput> {
  const mod = await import("./murph-age.ts");
  return mod.calculateMurphAgeFromVaultInputBundle(input);
}

export async function listMetricTargets(
  vaultRoot: string,
): Promise<import("./query-projection.ts").QueryMetricTargetRow[]> {
  const mod = await import("./query-projection.ts");
  return mod.listMetricTargetsRuntime(vaultRoot);
}

export async function selectMetricGoalProgressRuntime(input: {
  goalId: string;
  now?: string;
  targetId: string;
  vaultRoot: string;
}): Promise<import("@murphai/health-metrics").MetricGoalProgress | null> {
  const mod = await import("./query-projection.ts");
  return mod.selectMetricGoalProgressRuntime(input);
}

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

export * from "./scheduled-logs.ts";
