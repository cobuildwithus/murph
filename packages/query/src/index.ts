import type { CanonicalEntity } from "./canonical-entities.ts";
import type {
  QueryCanonicalEntityFilters,
  QueryMetricPointFilters,
  QueryMetricTarget,
  QueryProjectionStatus,
  RebuildQueryProjectionResult,
} from "./query-projection-types.ts";
import type { SearchFilters, SearchResult } from "./search-shared.ts";
import type {
  ProjectedWearableActivitySummary,
  ProjectedWearableBodyStateSummary,
  ProjectedWearableDaySummary,
  ProjectedWearableDriftSummary,
  ProjectedWearableLatestSummary,
  ProjectedWearableMetricLatestSummary,
  ProjectedWearableMetricTrendSummary,
  ProjectedWearableRecoverySummary,
  ProjectedWearableSleepSummary,
  ProjectedWearableSourceHealthSummary,
  WearableMetricSummaryFilters,
  WearableSleepPatternFilters,
  WearableSleepPatternSummary,
  WearableSleepReportingTimeZoneSource,
  WearableSummaryFilters,
} from "./wearables.ts";

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
  readVaultRawTolerant,
  readVaultTolerant,
} from "./vault-reader.ts";
export {
  hashCanonicalQuerySources,
  isCanonicalQuerySourcePath,
  listCanonicalSourceManifest,
} from "./vault-source.ts";
export {
  listCanonicalObservationMetricEntries,
  type CanonicalObservationMetricEntry,
  type CanonicalObservationMetricEntryFilters,
} from "./canonical-observation-metrics.ts";
export type {
  CanonicalQuerySourceHash,
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
  compareDeviceActivityCoverageKeys,
  deviceActivityCoverageKeyIsAfterCursor,
  resolveNextDeviceActivityCoverageCursor,
} from "./device-activity-coverage.ts";
export type {
  DeviceActivityCoverageCursor,
  DeviceActivityCoverageKey,
} from "./device-activity-coverage.ts";
export {
  listAutomationPage,
  listAutomations,
  readAutomation,
  readAutomationByRelativePath,
  showAutomation,
} from "./automation.ts";
export type {
  AutomationListPageOptions,
  AutomationListPageResult,
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
  buildOverviewWeeklyStatsFromDailySampleSummaries,
  buildOverviewWeeklyStats,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
} from "./overview.ts";
export type {
  OverviewExperiment,
  OverviewJournalEntry,
  OverviewMetric,
  OverviewWeeklySampleSummary,
  OverviewWeeklyStat,
} from "./overview.ts";
export {
  buildSharedGroupWeeklyMembers,
} from "./group-weekly.ts";
export type {
  SharedGroupWeeklyMember,
  SharedGroupWeeklyStat,
} from "./group-weekly.ts";
export {
  analyzeExperimentOutcome,
  collectExperimentAdherenceCalendar,
  decideExperimentFollowupDue,
  summarizeExperimentProgress,
} from "./experiments.ts";
export {
  humanizeExperimentOutcomeKey,
  resolveExperimentMetricOutcome,
  resolveExperimentPrimaryOutcome,
  summarizeExperimentOutcomeEvidencePlan,
} from "./experiment-outcomes.ts";
export {
  isRegisteredExperimentMetricSource,
  resolveExperimentMetricIdentity,
} from "./experiment-metrics.ts";
export type {
  ExperimentOutcomeEvidenceOptions,
  ExperimentOutcomeEvidencePlanSummary,
  ExperimentOutcomeEvidenceRoleSummary,
  ResolvedExperimentMetricOutcome,
  ResolvedExperimentPrimaryOutcome,
  ResolvedExperimentStructuredReviewOutcome,
} from "./experiment-outcomes.ts";
export { buildExperimentProgressCard } from "./experiment-progress-card.ts";
export type {
  BuildExperimentProgressCardOptions,
  ExperimentProgressCardBiomarkerDirection,
  ExperimentProgressCardBuildResult,
  ExperimentProgressCardConfounderInput,
} from "./experiment-progress-card.ts";
export {
  resolveAdherenceObservationActivityKind,
  resolveExperimentAdherenceTargets,
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
  resolveMetricInputKey,
  assessExperimentPrimaryMetricCapture,
  experimentSessionMetricIsDeclared,
  resolveExperimentSessionMetricSpec,
  resolveExperimentSessionMetricSpecForBiomarker,
  validateExperimentSessionMetricValue,
  selectMetricGoalProgress,
  selectMetricSeries,
  selectMetricTrend,
  selectMetricValue,
  selectMetricWindowComparison,
  type GoalMetricTarget,
  type ExperimentPrimaryMetricCaptureAssessment,
  type ExperimentPrimaryMetricCaptureIssue,
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
  type QueryCanonicalEntityFilters,
  type QueryMetricPointFilters,
  type QueryMetricTarget,
  type QueryMetricTargetRow,
  type QueryProjectionStatus,
  type RebuildQueryProjectionResult,
} from "./query-projection-types.ts";
export type {
  ProjectedWearableActivitySummary,
  ProjectedWearableBodyStateSummary,
  ProjectedWearableDaySummary,
  ProjectedWearableDriftSummary,
  ProjectedWearableLatestSummary,
  ProjectedWearableMetricLatestSummary,
  ProjectedWearableMetricSelection,
  ProjectedWearableMetricTrendPoint,
  ProjectedWearableMetricTrendSummary,
  ProjectedWearableRecoverySummary,
  ProjectedWearableResolvedMetric,
  ProjectedWearableSleepSummary,
  ProjectedWearableSourceHealthSummary,
  ProjectedWearableSummaryBundle,
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
  WearableSleepPatternFilters,
  WearableSleepPatternSummary,
  WearableSleepReportingTimeZoneSource,
  WearableSleepSummary,
  WearableSourceHealth,
  WearableSourceHealthSummary,
  WearableSummaryBundle,
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
  filters: QueryMetricPointFilters = {},
): Promise<import("@murphai/health-metrics").MetricPoint[]> {
  const mod = await import("./query-projection.ts");
  return mod.listMetricPointsRuntime(vaultRoot, filters);
}

export async function listCanonicalEntities(
  vaultRoot: string,
  filters: QueryCanonicalEntityFilters = {},
): Promise<CanonicalEntity[]> {
  const mod = await import("./query-projection.ts");
  return mod.listCanonicalEntitiesRuntime(vaultRoot, filters);
}

export async function listMetricPointsBatch(
  vaultRoot: string,
  filtersList: readonly QueryMetricPointFilters[],
): Promise<import("@murphai/health-metrics").MetricPoint[]> {
  const mod = await import("./query-projection.ts");
  return mod.listMetricPointsBatchRuntime(vaultRoot, filtersList);
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

export async function listMetricTargets(
  vaultRoot: string,
): Promise<QueryMetricTarget[]> {
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

export async function summarizeWearableDayRuntime(
  vaultRoot: string,
  date: string,
  filters: Omit<WearableSummaryFilters, "date" | "from" | "to"> = {},
): Promise<ProjectedWearableDaySummary | null> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableDayRuntime(vaultRoot, date, filters);
}

export async function summarizeWearableLatestRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableLatestSummary | null> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableLatestRuntime(vaultRoot, filters);
}

export async function summarizeWearableMetricLatestRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableMetricLatestSummary | null> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableMetricLatestRuntime(vaultRoot, metric, filters);
}

export async function summarizeWearableMetricTrendRuntime(
  vaultRoot: string,
  metric: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableMetricTrendSummary | null> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableMetricTrendRuntime(vaultRoot, metric, filters);
}

export async function explainWearableDriftRuntime(
  vaultRoot: string,
  filters: WearableMetricSummaryFilters = {},
): Promise<ProjectedWearableDriftSummary | null> {
  const mod = await import("./query-projection.ts");
  return mod.explainWearableDriftRuntime(vaultRoot, filters);
}

export async function summarizeWearableSleepRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableSleepSummary[]> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableSleepRuntime(vaultRoot, filters);
}

export async function summarizeWearableSleepPatternRuntime(
  vaultRoot: string,
  filters: WearableSleepPatternFilters = {},
): Promise<WearableSleepPatternSummary> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableSleepPatternRuntime(vaultRoot, filters);
}

export async function summarizeWearableActivityRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableActivitySummary[]> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableActivityRuntime(vaultRoot, filters);
}

export async function summarizeWearableBodyStateRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableBodyStateSummary[]> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableBodyStateRuntime(vaultRoot, filters);
}

export async function summarizeWearableRecoveryRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableRecoverySummary[]> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableRecoveryRuntime(vaultRoot, filters);
}

export async function summarizeWearableSourceHealthRuntime(
  vaultRoot: string,
  filters: WearableSummaryFilters = {},
): Promise<ProjectedWearableSourceHealthSummary[]> {
  const mod = await import("./query-projection.ts");
  return mod.summarizeWearableSourceHealthRuntime(vaultRoot, filters);
}

export * from "./scheduled-logs.ts";
