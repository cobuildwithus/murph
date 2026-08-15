import type {
  EventSource,
  ExperimentFrontmatter,
  ExperimentOutcome,
  ExperimentOutcomeStatistic,
  ExperimentPrimaryOutcome,
  ExperimentProgressCardData,
  ExperimentRunScheduleIntent,
  ExperimentStatus,
  HealthCommonsExperimentOnboardingPositiveDisposition,
  MealNutrition,
  RegimenKind,
  RegimenStatus,
} from "@murphai/contracts"
import type {
  DocumentImportResult,
  ExperimentCreateResult,
  ExportPackResult,
  JournalEnsureResult,
  ListFilters,
  ListResult,
  ListEntity,
  MealAddResult,
  SamplesImportCsvResult,
  SavedEntitySnapshot,
  ShowResult,
  VaultInitResult,
  VaultValidateResult,
} from "@murphai/operator-config/vault-cli-contracts"
import type {
  AddCaptureRecordInput,
  CaptureAddResult,
} from "./capture.js"
import type { RawImportManifestResult } from "./document-meal-read.js"
import type {
  CommandContext,
  HealthEntityEnvelope,
  HealthCoreRuntimeMethods,
  HealthCoreServiceMethods,
  HealthListEnvelope,
  HealthListInput,
  HealthQueryServiceMethods,
  JsonObject,
  UpsertRecordResult,
} from "../health-cli-method-types.js"
import type {
  MemoryDocumentSnapshot,
} from "@murphai/query"
import type {
  QueryCanonicalEntity,
  QueryExperimentFollowupDueDecision,
  QueryExperimentProgressSummary,
  QueryMealNutritionDayTotal,
  QueryMealNutritionMetricTotal,
  QueryMealNutritionTotals,
  QueryPersonalPatternReport,
  QueryRuntimeModule as SharedQueryRuntimeModule,
  QueryWearableSleepPatternSummary,
} from "../query-runtime.js"

export type { CommandContext } from "../health-cli-method-types.js"

export interface ProjectAssessmentInput extends CommandContext {
  assessmentId: string
}

export interface StopRegimenInput extends CommandContext {
  regimenId: string
  group?: string
  stoppedOn?: string
}

export interface PrivateProtocolUpsertInput extends CommandContext {
  protocolId?: string
  slug?: string
  allowSlugRename?: boolean
  title?: string
  frontmatter?: JsonObject
  body?: string
}

export interface PrivateProtocolUpsertResult {
  vault: string
  protocolId: string
  lookupId: string
  slug: string
  path: string
  protocolRevisionId: string
  effectiveSpecHash: string
  created: boolean
}

type RegistryScheduleText = string

export interface RegimenSaveInput extends CommandContext {
  regimenId?: string
  slug?: string
  allowSlugRename?: boolean
  rejectExistingSlug?: boolean
  kind: RegimenKind
  status?: RegimenStatus
  startedOn?: string
  stoppedOn?: string
  schedule?: RegistryScheduleText
  brand?: string
  manufacturer?: string
  servingSize?: string
  note?: string
  substance?: string
  dose?: number
  unit?: string
  ingredientCompound?: string
  ingredientLabel?: string
  ingredientAmount?: number
  ingredientUnit?: string
  ingredientNote?: string
  ingredientActive?: boolean
  group?: string
  relatedGoalId?: string[]
  relatedConditionId?: string[]
  relatedRegimenId?: string[]
  title: string
}

export interface SupplementSaveInput extends CommandContext {
  regimenId?: string
  slug?: string
  status?: RegimenStatus
  startedOn?: string
  stoppedOn?: string
  schedule?: RegistryScheduleText
  group?: string
  substance?: string
  dose?: number
  doseUnit?: string
  brand?: string
  manufacturer?: string
  servingSize?: string
  ingredient?: string[]
  relatedGoalId?: string[]
  relatedConditionId?: string[]
  relatedRegimenId?: string[]
  title: string
}

export interface RegimenSaveResult extends UpsertRecordResult {
  regimenId: string
  entity: SavedEntitySnapshot
}

export interface SupplementSaveResult extends RegimenSaveResult {}

export interface PrivateProtocolListInput extends HealthListInput {
  commonsProtocol?: string
}

export interface PrivateProtocolSummaryResult {
  vault: string
  protocol: {
    id: string
    protocolId: string
    slug: string | null
    title: string
    status: string | null
    commonsProtocolRef: JsonObject | null
    effectiveSpec: JsonObject | null
    effectiveSpecHash: string | null
    protocolRevisionId: string | null
    updatedAt: string | null
    path: string
    tags: string[]
    summary: string | null
  }
}

export interface PrivateProtocolListResult {
  vault: string
  filters: {
    status?: string
    commonsProtocol?: string
    limit: number
  }
  protocols: PrivateProtocolSummaryResult["protocol"][]
  count: number
  nextCursor: string | null
}

export interface AssessmentProjectionResult {
  vault: string
  assessmentId: string
  proposal: JsonObject
}

export interface AssessmentImportResult {
  vault: string
  sourceFile: string
  rawFile: string
  manifestFile: string
  assessmentId: string
  lookupId: string
  ledgerFile?: string
}

export interface ProviderScaffoldResult {
  vault: string
  noun: "provider"
  payload: JsonObject
}

export interface ProviderUpsertResult {
  vault: string
  providerId: string
  lookupId: string
  path: string
  created: boolean
}

export interface ProviderListResult {
  vault: string
  filters: {
    status: string | null
    limit: number
  }
  items: ListEntity[]
  count: number
  nextCursor: string | null
}

export interface RecipeScaffoldResult {
  vault: string
  noun: "recipe"
  payload: JsonObject
}

export interface RecipeUpsertResult {
  vault: string
  recipeId: string
  lookupId: string
  path: string
  created: boolean
}

export interface RecipeListResult {
  vault: string
  filters: {
    status: string | null
    limit: number
  }
  items: ListEntity[]
  count: number
  nextCursor: string | null
}

export interface FoodScaffoldResult {
  vault: string
  noun: "food"
  payload: JsonObject
}

export interface FoodUpsertResult {
  vault: string
  foodId: string
  lookupId: string
  path: string
  created: boolean
}

export interface FoodAddDailyResult {
  vault: string
  foodId: string
  lookupId: string
  path: string
  created: boolean
  time: string
  jobId: string
  jobName: string
  nextRunAt: string | null
}

export interface FoodListResult {
  vault: string
  filters: {
    status: string | null
    limit: number
  }
  items: ListEntity[]
  count: number
  nextCursor: string | null
}

export interface EventScaffoldResult {
  vault: string
  noun: "event"
  kind:
    | "note"
    | "symptom"
    | "observation"
    | "measurement"
    | "medication_intake"
    | "supplement_intake"
    | "activity_session"
    | "body_measurement"
    | "sleep_session"
    | "intervention_session"
    | "experiment_context"
  payload: JsonObject
}

export interface EventUpsertResult {
  vault: string
  eventId: string
  lookupId: string
  ledgerFile: string
  created: boolean
}

export interface EventListResult {
  vault: string
  filters: {
    kind: string | null
    from: string | null
    to: string | null
    tag: string[]
    experiment: string | null
    limit: number
  }
  items: ListEntity[]
  count: number
  nextCursor: string | null
}

export type MealNutritionMetricResult = QueryMealNutritionMetricTotal
export type MealNutritionTotals = QueryMealNutritionTotals
export type MealNutritionDayResult = QueryMealNutritionDayTotal

export interface MealNutritionTotalsResult {
  vault: string
  filters: {
    from: string | null
    to: string | null
  }
  mealCount: number
  totals: MealNutritionTotals
  days: MealNutritionDayResult[]
}

export interface SamplesAddResult {
  vault: string
  stream: string
  source: string
  quality: string
  addedCount: number
  lookupIds: string[]
  ledgerFiles: string[]
}

export interface ExperimentUpdateResult {
  vault: string
  experimentId: string
  lookupId: string
  slug: string
  experimentPath: string
  status: ExperimentStatus
  updated: boolean
}

export interface ExperimentLifecycleResult extends ExperimentUpdateResult {
  eventId: string
  ledgerFile: string
}

export interface ExperimentListResult {
  vault: string
  filters: {
    status: ExperimentStatus | null
    limit: number
  }
  items: ListEntity[]
  count: number
  nextCursor: string | null
}

export interface ExperimentLifecycleFrontmatterListResult {
  vault: string
  items: ExperimentFrontmatter[]
  yielded?: true
}

export interface ExperimentSessionLogResult {
  vault: string
  experimentId: string
  lookupId: string
  slug: string
  eventId: string
  ledgerFile: string
  created: boolean
  kind: "intervention_session"
  progress?: QueryExperimentProgressSummary
}

export interface ExperimentSessionAttachResult {
  vault: string
  eventId: string
  lookupId: string
  experimentId: string | null
  experimentSlug: string | null
  linked: boolean
  entity: ShowResult["entity"]
}

export interface ExperimentContextLogResult {
  vault: string
  experimentId: string
  lookupId: string
  slug: string
  eventId: string
  ledgerFile: string
  created: boolean
  kind: "note" | "supplement_intake" | "experiment_context"
}

export type ExperimentSessionStatus = "completed" | "partial" | "missed" | "skipped"

export type ExperimentContextLogKind =
  | "experiment_context"
  | "note"
  | "supplement_intake"

export type ExperimentContextSeverity =
  | "info"
  | "potential_confounder"
  | "safety"
  | "blocking"

export interface ExperimentProgressResult {
  vault: string
  experimentId: string
  lookupId: string
  slug: string
  asOf: string
  progress: QueryExperimentProgressSummary
}

export interface ExperimentProgressCardConfounder {
  date: string
  label: string
}

export interface ExperimentProgressCardResult {
  vault: string
  experimentId: string
  lookupId: string
  slug: string
  asOf: string
  card: ExperimentProgressCardData
  warnings: string[]
}

export interface ExperimentFollowupDueResult {
  experimentId: string
  lookupId: string
  slug: string
  kind: "missed-log" | "weekly-digest"
  date: string
  decision: QueryExperimentFollowupDueDecision
}

export interface ExperimentOutcomeResult {
  vault: string
  experimentId: string
  lookupId: string
  slug: string
  asOf: string
  outcome: ExperimentOutcome
  outcomePath?: string | null
  updatedExperiment?: boolean
}

export interface ExperimentPlanSummary {
  planId: string | null
  materialAdaptation: boolean
  needsPrivateProtocol: boolean
  reasons: string[]
  operations: string[]
}

export interface ExperimentPlanResult {
  vault: string
  plan: ExperimentPlanSummary
}

export interface ExperimentStartResult {
  vault: string
  plan: ExperimentPlanSummary
  protocol: {
    protocolId: string
    slug: string
    title: string
    protocolRevisionId: string
    effectiveSpecHash: string
    path: string
    created: boolean
  } | null
  experiment: {
    experimentId: string
    lookupId: string
    slug: string
    experimentPath: string
    status: ExperimentStatus
    created: boolean
    updated: boolean
  }
}

export interface JournalMutationResult {
  vault: string
  date: string
  lookupId: string
  journalPath: string
  created: boolean
  updated: boolean
}

export interface JournalLinkResult {
  vault: string
  date: string
  lookupId: string
  journalPath: string
  created: boolean
  changed: number
  eventIds: string[]
  sampleStreams: string[]
}

export interface JournalListResult {
  vault: string
  filters: {
    kind: string
    from?: string
    to?: string
    limit: number
  }
  items: ListEntity[]
  count: number
  nextCursor: string | null
}

export interface WearableDayFiltersResult {
  providers: string[]
}

export type WearablePublicDaySummary = JsonObject
export type WearablePublicSleepSummary = JsonObject
export type WearablePublicActivitySummary = JsonObject
export type WearablePublicBodyStateSummary = JsonObject
export type WearablePublicRecoverySummary = JsonObject
export type WearablePublicSourceHealthSummary = JsonObject
export type WearablePublicLatestSummary = JsonObject
export type WearablePublicMetricLatestSummary = JsonObject
export type WearablePublicMetricTrendSummary = JsonObject
export type WearablePublicDriftSummary = JsonObject
export type WearablePublicSleepPatternSummary = QueryWearableSleepPatternSummary

export interface WearableDayResult {
  date: string
  filters: WearableDayFiltersResult
  summary: WearablePublicDaySummary | null
}

export interface WearableListFiltersResult {
  date: string | null
  from: string | null
  to: string | null
  providers: string[]
  limit: number
}

export interface WearableListResult<TItem> {
  filters: WearableListFiltersResult
  items: TItem[]
  count: number
}

export type WearableSleepListResult = WearableListResult<WearablePublicSleepSummary>
export type WearableActivityListResult = WearableListResult<WearablePublicActivitySummary>
export type WearableBodyStateListResult = WearableListResult<WearablePublicBodyStateSummary>
export type WearableRecoveryListResult = WearableListResult<WearablePublicRecoverySummary>
export type WearableSourceListResult = WearableListResult<WearablePublicSourceHealthSummary>

export interface WearableLatestResult {
  filters: Omit<WearableListFiltersResult, "limit">
  summary: WearablePublicLatestSummary | null
}

export interface WearableMetricFiltersResult extends Omit<WearableListFiltersResult, "limit"> {
  metric: string
  windowDays: number
}

export interface WearableDriftFiltersResult extends Omit<WearableListFiltersResult, "limit"> {
  windowDays: number
}

export interface WearableMetricLatestResult {
  filters: WearableMetricFiltersResult
  summary: WearablePublicMetricLatestSummary | null
}

export interface WearableMetricTrendResult {
  filters: WearableMetricFiltersResult
  summary: WearablePublicMetricTrendSummary | null
}

export interface WearableDriftResult {
  filters: WearableDriftFiltersResult
  summary: WearablePublicDriftSummary | null
}

export interface WearableSleepPatternFiltersResult extends Omit<WearableListFiltersResult, "limit"> {
  timeZone: string | null
  windowDays: number
}

export interface WearableSleepPatternResult {
  filters: WearableSleepPatternFiltersResult
  summary: WearablePublicSleepPatternSummary
}

export interface PersonalPatternResult {
  filters: {
    date: string | null
    windowDays: number
  }
  report: QueryPersonalPatternReport
}

export interface VaultShowResult {
  vault: string
  formatVersion: number | null
  vaultId: string | null
  title: string | null
  timezone: string | null
  createdAt: string | null
  corePath: string | null
  coreTitle: string | null
  coreUpdatedAt: string | null
}

export interface VaultStatsResult {
  vault: string
  counts: {
    totalRecords: number
    experiments: number
    journalEntries: number
    events: number
    samples: number
    audits: number
    assessments: number
    goals: number
    conditions: number
    allergies: number
    protocols: number
    familyMembers: number
    geneticVariants: number
  }
  latest: {
    eventOccurredAt: string | null
    sampleOccurredAt: string | null
    journalDate: string | null
    experimentTitle: string | null
  }
}

export interface MemoryDocumentResult {
  vault: string
  document: MemoryDocumentSnapshot
}

export interface VaultUpdateResult {
  vault: string
  metadataFile: string
  corePath: string
  title: string
  timezone: string
  updatedAt: string
  updated: boolean
}

export interface VaultRepairResult {
  vault: string
  metadataFile: string
  title: string
  timezone: string
  createdDirectories: string[]
  updated: boolean
  auditPath: string | null
}

export interface StopRegimenResult {
  vault: string
  regimenId: string
  lookupId: string
  stoppedOn: string | null
  status: string
}

export interface SupplementCompoundSourceResult {
  supplementId: string
  supplementSlug: string
  supplementTitle: string | null
  brand: string | null
  manufacturer: string | null
  status: string | null
  label: string | null
  amount: number | null
  unit: string | null
  note: string | null
}

export interface SupplementCompoundTotalResult {
  unit: string | null
  totalAmount: number | null
  sourceCount: number
  incomplete: boolean
}

export interface SupplementCompoundRecordResult {
  compound: string
  lookupId: string
  totals: SupplementCompoundTotalResult[]
  supplementCount: number
  supplementIds: string[]
  sources: SupplementCompoundSourceResult[]
}

export interface SupplementCompoundFiltersResult {
  status: string
  limit?: number
}

export interface SupplementCompoundShowResult {
  vault: string
  filters: SupplementCompoundFiltersResult
  compound: SupplementCompoundRecordResult
}

export interface SupplementCompoundListResult {
  vault: string
  filters: SupplementCompoundFiltersResult
  items: SupplementCompoundRecordResult[]
  count: number
  nextCursor: string | null
}

export interface WearableStorageRepairInput extends CommandContext {
  apply?: boolean
  pruneDenseRaw?: boolean
  includeRecentDenseRaw?: boolean
  maxFiles?: number
  maxBytes?: number
}

export interface JunctionWorkoutHeartRateZoneRepairInput extends CommandContext {
  apply?: boolean
}

export interface ExperimentMediaRepairInput extends CommandContext {
  apply?: boolean
}

export interface ExperimentMediaRepairResult {
  mode: "dry-run" | "apply"
  hasWork: boolean
  candidateCount: number
  candidateBytes: number
  candidateExamples: Array<{
    experimentSlug: string
    relativePath: string
    sizeBytes: number
  }>
  blockerCount: number
  blockersByCode: Record<string, number>
  blockerExamples: Array<{
    code: string
    relativePath?: string
    message: string
  }>
  mutated: boolean
  createdCaptureCount: number
  reusedCaptureCount: number
  deletedFileCount: number
  removedLegacyBytes: number
  rewrittenDocumentCount: number
  auditPaths: string[]
}

export interface JunctionWorkoutHeartRateZoneRepairResult {
  mode: "dry-run" | "apply"
  hasWork: boolean
  mutated: boolean
  scannedEventCount: number
  candidateCount: number
  unverifiedCandidateCount: number
  repairedCount: number
  touchedPathCount: number
  auditPath: string | null
}

export interface IntegrationIngestRepairInput extends CommandContext {
  apply?: boolean
  finalize?: boolean
  maxBundles?: number
  maxBytes?: number
}

export interface IntegrationIngestRepairResult {
  mode: "dry-run" | "apply"
  storedFormatVersion: number
  hasWork: boolean
  hasMore: boolean
  candidateBundleCount: number
  copiedBundleCount: number
  detachedBundleCount: number
  deletableFileCount: number
  sourceBytes: number
  journalBytes: number
  blockerCount: number
  blockersByCode: Record<string, number>
  blockerExamples: Array<{
    code: string
    relativePath?: string
    message: string
  }>
  mutated: boolean
  appendedBundleCount: number
  detachedEventRowCount: number
  deletedFileCount: number
  finalized: boolean
  auditPaths: string[]
}

export interface WearableStorageRepairResult {
  mode: "dry-run" | "apply"
  hasWork: boolean
  suspectedBytes: number
  legacyReceiptPayloadCount: number
  legacyCanonicalArtifactCount: number
  denseProviderSampleShardCount: number
  denseProviderRawTimeseriesCount: number
  retentionEligibleDenseProviderRawTimeseriesBytes: number
  retentionEligibleDenseProviderRawTimeseriesCount: number
  mutated: boolean
  hasMore: boolean
  bytesBefore: number
  bytesAfter: number
  bytesFreed: number
  compactedReceiptCount: number
  denseRawBytesAfter: number
  denseRawBytesBefore: number
  denseRawBytesFreed: number
  tombstonedCanonicalArtifactCount: number
  tombstonedDenseRawArtifactCount: number
  skippedCount: number
  touchedPathCount: number
}

export interface CoreWriteServices extends HealthCoreServiceMethods {
  init(
    input: CommandContext & {
      timezone?: string
    },
  ): Promise<VaultInitResult>
  validate(input: CommandContext): Promise<VaultValidateResult>
  addMeal(
    input: CommandContext & {
      photo?: string
      audio?: string
      note?: string
      occurredAt?: string
      source?: ImporterSource
      ingredients?: string[]
      nutrition?: MealNutrition
    },
  ): Promise<MealAddResult>
  addCapture(
    input: CommandContext & Omit<AddCaptureRecordInput, "vault">,
  ): Promise<CaptureAddResult>
  createExperiment(
    input: CommandContext & {
      slug: string
      title?: string
      hypothesis?: string
      startedOn?: string
      status?: ExperimentStatus
    },
  ): Promise<ExperimentCreateResult>
  planExperiment(
    input: CommandContext & {
      inputFile?: string
      payload?: JsonObject
    },
  ): Promise<ExperimentPlanResult>
  startExperiment(
    input: CommandContext & {
      inputFile?: string
      payload?: JsonObject
    },
  ): Promise<ExperimentStartResult>
  updateExperiment(
    input: CommandContext & {
      lookup: string
      title?: string
      hypothesis?: string
      startedOn?: string
      status?: ExperimentStatus
      body?: string
      tags?: readonly string[]
      commonsProtocolRef?: ExperimentFrontmatter['commonsProtocolRef'] | null
      protocolRef?: ExperimentFrontmatter['protocolRef'] | null
      effectiveProtocolSnapshot?: ExperimentFrontmatter['effectiveProtocolSnapshot'] | null
      runPlan?: ExperimentFrontmatter['runPlan'] | null
      analysisPlan?: ExperimentFrontmatter['analysisPlan'] | null
      onboarding?: ExperimentFrontmatter['onboarding'] | null
      assistantSupport?: ExperimentFrontmatter['assistantSupport'] | null
      outcome?: ExperimentFrontmatter['outcome'] | null
      outcomeRef?: ExperimentFrontmatter['outcomeRef'] | null
    },
  ): Promise<ExperimentUpdateResult>
  applyExperimentOnboarding(
    input: CommandContext & {
      lookup: string
      status?: ExperimentStatus
      protocolKey?: string
      pageRevisionId?: string
      runSpecRevisionId?: string
      testPlanId?: string
      baselineStart?: string
      baselineEnd?: string
      baselineDays?: number
      interventionStart?: string
      interventionEnd?: string
      interventionDays?: number
      modality?: string
      schedule?: ExperimentRunScheduleIntent
      scheduleInputFile?: string
      scheduleKind?: ExperimentRunScheduleIntent["kind"]
      scheduleCron?: string
      scheduleLocalTime?: string
      scheduleTimeZone?: string
      dose?: string
      sessionsPerWeek?: number
      targetSessions?: number
      minimumUsefulSessions?: number
      sessionField?: readonly string[]
      confounderField?: readonly string[]
      stopCondition?: readonly string[]
      primaryBiomarkerKey?: string
      primaryOutcomeKey?: string
      primaryOutcomeKind?: ExperimentPrimaryOutcome["kind"]
      primaryOutcomeLabel?: string
      primaryOutcomeSessionField?: string
      primaryOutcomeSourceMetricKey?: string
      primaryOutcomeUnit?: string
      comparisonStatistic?: ExperimentOutcomeStatistic
      secondaryBiomarkerKey?: readonly string[]
      desiredDirection?: "increase" | "decrease" | "stabilize"
      expectedDirection?: readonly string[]
      analysisAnchor?: readonly string[]
      plannedMeasurement?: readonly string[]
      analysisNote?: readonly string[]
      onboardingCompletedAt?: string
      setupAnswer?: readonly string[]
      safetyCautionLevel?: "low" | "moderate" | "high" | "unknown"
      safetyDisposition?: HealthCommonsExperimentOnboardingPositiveDisposition
      positiveQuestionId?: readonly string[]
      safetyNote?: readonly string[]
      contextNote?: readonly string[]
      reminderPolicy?: string
      reminderOptionId?: string
      remindersEnabled?: boolean
      checkInCadence?: "none" | "daily" | "every_3_days" | "weekly"
      notificationStyle?: "skip_by_default" | "send_scheduled_summary"
      missedLogFollowup?: "never" | "opt_in_only" | "default_on"
      weeklyDigestEnabled?: boolean
    },
  ): Promise<ExperimentUpdateResult>
  checkpointExperiment(
    input: CommandContext & {
      lookup: string
      occurredAt?: string
      title?: string
      note?: string
    },
  ): Promise<ExperimentLifecycleResult>
  checkpointExperimentJson(
    input: CommandContext & {
      inputFile: string
    },
  ): Promise<ExperimentLifecycleResult>
  stopExperiment(
    input: CommandContext & {
      lookup: string
      occurredAt?: string
      note?: string
    },
  ): Promise<ExperimentLifecycleResult>
  logExperimentSession(
    input: CommandContext & {
      lookup: string
      reminderIntentId?: string
      date?: string
      occurredAt?: string
      source?: EventSource
      title?: string
      note?: string
      interventionType?: string
      status?: ExperimentSessionStatus
      sessionStatus?: ExperimentSessionStatus
      durationMinutes?: number
      protocolId?: string
      timing?: string
      temperatureC?: number
      afterExercise?: boolean
      symptoms?: string[]
      confounders?: string[] | Record<string, string | number | boolean | null>
      fields?: Record<string, string | number | boolean | null>
    },
  ): Promise<ExperimentSessionLogResult>
  logExperimentSessionJson(
    input: CommandContext & {
      lookup: string
      inputFile: string
    },
  ): Promise<ExperimentSessionLogResult>
  attachExperimentSession(
    input: CommandContext & {
      lookup: string
      eventId: string
      replace?: boolean
      allowOutOfWindow?: boolean
    },
  ): Promise<ExperimentSessionAttachResult>
  detachExperimentSession(
    input: CommandContext & {
      eventId: string
    },
  ): Promise<ExperimentSessionAttachResult>
  logExperimentContext(
    input: CommandContext & {
      lookup: string
      kind?: ExperimentContextLogKind
      occurredAt?: string
      source?: EventSource
      title?: string
      note?: string
      contextType?: string
      severity?: ExperimentContextSeverity
      tags?: string[]
      supplementName?: string
      dose?: number
      unit?: string
    },
  ): Promise<ExperimentContextLogResult>
  logExperimentContextJson(
    input: CommandContext & {
      lookup: string
      inputFile: string
    },
  ): Promise<ExperimentContextLogResult>
  writeExperimentOutcome(
    input: CommandContext & {
      lookup: string
      asOf?: string
    },
  ): Promise<ExperimentOutcomeResult>
  ensureJournal(
    input: CommandContext & {
      date: string
    },
  ): Promise<JournalEnsureResult>
  appendJournal(
    input: CommandContext & {
      date: string
      text: string
    },
  ): Promise<JournalMutationResult>
  linkJournalEvents(
    input: CommandContext & {
      date: string
      eventIds: string[]
    },
  ): Promise<JournalLinkResult>
  unlinkJournalEvents(
    input: CommandContext & {
      date: string
      eventIds: string[]
    },
  ): Promise<JournalLinkResult>
  linkJournalStreams(
    input: CommandContext & {
      date: string
      sampleStreams: string[]
    },
  ): Promise<JournalLinkResult>
  unlinkJournalStreams(
    input: CommandContext & {
      date: string
      sampleStreams: string[]
    },
  ): Promise<JournalLinkResult>
  scaffoldProvider(input: CommandContext): Promise<ProviderScaffoldResult>
  upsertProvider(
    input: CommandContext & {
      inputFile: string
    },
  ): Promise<ProviderUpsertResult>
  scaffoldRecipe(input: CommandContext): Promise<RecipeScaffoldResult>
  upsertRecipe(
    input: CommandContext & {
      inputFile: string
    },
  ): Promise<RecipeUpsertResult>
  scaffoldFood(input: CommandContext): Promise<FoodScaffoldResult>
  upsertFood(
    input: CommandContext & {
      inputFile: string
    },
  ): Promise<FoodUpsertResult>
  renameFood(
    input: CommandContext & {
      lookup: string
      title: string
      slug?: string
    },
  ): Promise<FoodUpsertResult>
  editFood(
    input: CommandContext & {
      lookup: string
      inputFile?: string
      set?: string[]
      clear?: string[]
    },
  ): Promise<ShowResult>
  deleteFood(
    input: CommandContext & {
      lookup: string
    },
  ): Promise<{
    vault: string
    entityId: string
    lookupId: string
    kind: 'food'
    deleted: true
    retainedPaths: string[]
  }>
  addDailyFood(
    input: CommandContext & {
      title: string
      time: string
      note?: string
      slug?: string
    },
  ): Promise<FoodAddDailyResult>
  unscheduleDailyFood(
    input: CommandContext & {
      lookup: string
    },
  ): Promise<ShowResult>
  scaffoldEvent(
    input: CommandContext & {
      kind: string
    },
  ): Promise<EventScaffoldResult>
  upsertEvent(
    input: CommandContext & {
      inputFile: string
    },
  ): Promise<EventUpsertResult>
  addSamples(
    input: CommandContext & {
      inputFile: string
    },
  ): Promise<SamplesAddResult>
  updateVault(
    input: CommandContext & {
      title?: string
      timezone?: string
    },
  ): Promise<VaultUpdateResult>
  repairVault(input: CommandContext): Promise<VaultRepairResult>
  repairJunctionWorkoutHeartRateZones(
    input: JunctionWorkoutHeartRateZoneRepairInput,
  ): Promise<JunctionWorkoutHeartRateZoneRepairResult>
  repairExperimentMedia(input: ExperimentMediaRepairInput): Promise<ExperimentMediaRepairResult>
  repairIntegrationIngests(input: IntegrationIngestRepairInput): Promise<IntegrationIngestRepairResult>
  repairWearableStorage(input: WearableStorageRepairInput): Promise<WearableStorageRepairResult>
  projectAssessment(
    input: ProjectAssessmentInput,
  ): Promise<AssessmentProjectionResult>
  scaffoldRegimen(
    input: CommandContext,
  ): Promise<{
    vault: string
    noun: 'regimen'
    payload: JsonObject
  }>
  upsertRegimen(
    input: CommandContext & {
      input: string
    },
  ): Promise<UpsertRecordResult & { regimenId: string }>
  saveRegimen(input: RegimenSaveInput): Promise<RegimenSaveResult>
  saveSupplement(input: SupplementSaveInput): Promise<SupplementSaveResult>
  upsertPrivateProtocol(input: PrivateProtocolUpsertInput): Promise<PrivateProtocolUpsertResult>
  stopRegimen(input: StopRegimenInput): Promise<StopRegimenResult>
}

export interface ImporterServices {
  importDocument(
    input: CommandContext & {
      file: string
      title?: string
      occurredAt?: string
      note?: string
      source?: "manual" | "import" | "device" | "derived"
    },
  ): Promise<DocumentImportResult>
  importSamplesCsv(
    input: CommandContext & {
      file: string
      stream: string
      tsColumn: string
      valueColumn: string
      unit: string
    },
  ): Promise<SamplesImportCsvResult>
  importAssessmentResponse(
    input: CommandContext & {
      file: string
    },
  ): Promise<AssessmentImportResult>
}

export interface QueryServices extends HealthQueryServiceMethods {
  readMemoryDocument(input: CommandContext): Promise<MemoryDocumentResult>
  showRegimen(
    input: CommandContext & {
      id: string
    },
  ): Promise<HealthEntityEnvelope>
  listRegimens(
    input: HealthListInput,
  ): Promise<HealthListEnvelope>
  showPrivateProtocol(
    input: CommandContext & {
      id: string
    },
  ): Promise<PrivateProtocolSummaryResult>
  listPrivateProtocols(
    input: PrivateProtocolListInput,
  ): Promise<PrivateProtocolListResult>
  showSupplement(
    input: CommandContext & {
      id: string
    },
  ): Promise<HealthEntityEnvelope>
  listSupplements(
    input: CommandContext & {
      status?: string
      limit: number
    },
  ): Promise<HealthListEnvelope>
  showSupplementCompound(
    input: CommandContext & {
      compound: string
      status?: string
    },
  ): Promise<SupplementCompoundShowResult>
  listSupplementCompounds(
    input: CommandContext & {
      status?: string
      limit: number
    },
  ): Promise<SupplementCompoundListResult>
  showDocument(
    input: CommandContext & {
      id: string
    },
  ): Promise<ShowResult>
  listDocuments(
    input: CommandContext & {
      from?: string
      limit?: number
      to?: string
    },
  ): Promise<ListResult>
  showDocumentManifest(
    input: CommandContext & {
      id: string
    },
  ): Promise<RawImportManifestResult>
  showProvider(
    input: CommandContext & {
      lookup: string
    },
  ): Promise<ShowResult>
  listProviders(
    input: CommandContext & {
      status?: string
      limit: number
    },
  ): Promise<ProviderListResult>
  showRecipe(
    input: CommandContext & {
      lookup: string
    },
  ): Promise<ShowResult>
  listRecipes(
    input: CommandContext & {
      status?: string
      limit: number
    },
  ): Promise<RecipeListResult>
  showFood(
    input: CommandContext & {
      lookup: string
    },
  ): Promise<ShowResult>
  listFoods(
    input: CommandContext & {
      status?: string
      limit: number
    },
  ): Promise<FoodListResult>
  showMealNutritionTotals(
    input: CommandContext & {
      from?: string
      to?: string
    },
  ): Promise<MealNutritionTotalsResult>
  showEvent(
    input: CommandContext & {
      eventId: string
    },
  ): Promise<ShowResult>
  listEvents(
    input: CommandContext & {
      kind?: string
      from?: string
      to?: string
      tag?: string[]
      experiment?: string
      limit: number
    },
  ): Promise<EventListResult>
  showExperiment(
    input: CommandContext & {
      lookup: string
    },
  ): Promise<ShowResult>
  listExperiments(
    input: CommandContext & {
      status?: ExperimentStatus
      limit: number
    },
  ): Promise<ExperimentListResult>
  listExperimentLifecycleFrontmatter(
    input: CommandContext & {
      shouldYield?: (() => boolean) | null
    },
  ): Promise<ExperimentLifecycleFrontmatterListResult>
  showExperimentProgress(
    input: CommandContext & {
      lookup: string
      asOf?: string
    },
  ): Promise<ExperimentProgressResult>
  showExperimentProgressCard(
    input: CommandContext & {
      lookup: string
      asOf?: string
      confounders?: ReadonlyArray<ExperimentProgressCardConfounder>
    },
  ): Promise<ExperimentProgressCardResult>
  showExperimentFollowupDue(
    input: CommandContext & {
      lookup: string
      kind: "missed-log" | "weekly-digest"
      date?: string
    },
  ): Promise<ExperimentFollowupDueResult>
  analyzeExperimentOutcome(
    input: CommandContext & {
      lookup: string
      asOf?: string
    },
  ): Promise<ExperimentOutcomeResult>
  showJournal(
    input: CommandContext & {
      date: string
    },
  ): Promise<ShowResult>
  listJournals(
    input: CommandContext & {
      from?: string
      to?: string
      limit: number
    },
  ): Promise<ListResult>
  showVault(input: CommandContext): Promise<VaultShowResult>
  showVaultStats(input: CommandContext): Promise<VaultStatsResult>
  show(
    input: CommandContext & {
      id: string
    },
  ): Promise<ShowResult>
  list(
    input: CommandContext & ListFilters,
  ): Promise<ListResult>
  showWearableDay(
    input: CommandContext & {
      date: string
      providers?: string[]
    },
  ): Promise<WearableDayResult>
  showWearableLatest(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
    },
  ): Promise<WearableLatestResult>
  showWearableMetricLatest(
    input: CommandContext & {
      metric: string
      date?: string
      from?: string
      to?: string
      providers?: string[]
      windowDays?: number
    },
  ): Promise<WearableMetricLatestResult>
  showWearableMetricTrend(
    input: CommandContext & {
      metric: string
      date?: string
      from?: string
      to?: string
      providers?: string[]
      windowDays?: number
    },
  ): Promise<WearableMetricTrendResult>
  showWearableDrift(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      windowDays?: number
    },
  ): Promise<WearableDriftResult>
  showWearableSleepPattern(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      timeZone?: string
      windowDays?: number
    },
  ): Promise<WearableSleepPatternResult>
  showPersonalPatterns(
    input: CommandContext & {
      date?: string
      windowDays?: number
    },
  ): Promise<PersonalPatternResult>
  listWearableSleep(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    },
  ): Promise<WearableSleepListResult>
  listWearableActivity(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    },
  ): Promise<WearableActivityListResult>
  listWearableBodyState(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    },
  ): Promise<WearableBodyStateListResult>
  listWearableRecovery(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    },
  ): Promise<WearableRecoveryListResult>
  listWearableSources(
    input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    },
  ): Promise<WearableSourceListResult>
  exportPack(
    input: CommandContext & {
      from: string
      to: string
      experiment?: string
      out?: string
    },
  ): Promise<ExportPackResult>
}

export interface VaultServices {
  core: CoreWriteServices
  importers: ImporterServices
  query: QueryServices
}

export interface CoreRuntimeModule extends HealthCoreRuntimeMethods {
  REQUIRED_DIRECTORIES: readonly string[]
  applyCanonicalWriteBatch(input: {
    vaultRoot: string
    operationType: string
    summary: string
    occurredAt?: string
    audit: {
      action: string
      commandName: string
      summary: string
      targetIds?: string[]
    }
    textWrites?: Array<{
      relativePath: string
      content: string
      overwrite?: boolean
      allowExistingMatch?: boolean
    }>
    jsonlAppends?: Array<{
      relativePath: string
      record: Record<string, unknown>
    }>
    deletes?: Array<{
      relativePath: string
    }>
  }): Promise<{
    textWrites: string[]
    jsonlAppends: string[]
    deletes: string[]
  }>
  initializeVault(input: {
    vaultRoot: string
    timezone?: string
  }): Promise<unknown>
  validateVault(input: {
    vaultRoot: string
  }): Promise<{
    valid: boolean
    issues?: Array<Record<string, unknown>>
  }>
  repairVault(input: {
    vaultRoot: string
  }): Promise<{
    metadataFile: string
    title: string
    timezone: string
    createdDirectories: string[]
    updated: boolean
    auditPath: string | null
  }>
  repairJunctionWorkoutHeartRateZones(input: {
    vaultRoot: string
    apply?: boolean
    now?: Date
  }): Promise<{
    mode: "dry-run" | "apply"
    hasWork: boolean
    mutated: boolean
    scannedEventCount: number
    candidateCount: number
    unverifiedCandidateCount: number
    repairedCount: number
    touchedPathCount: number
    touchedPaths: string[]
    auditPath: string | null
  }>
  repairExperimentMedia(input: {
    apply?: boolean
    vaultRoot: string
  }): Promise<ExperimentMediaRepairResult>
  runIntegrationIngestMigration(input: {
    vaultRoot: string
    apply?: boolean
    finalize?: boolean
    maxBundles?: number
    maxBytes?: number
  }): Promise<IntegrationIngestRepairResult>
  detectWearableStorageMigrationCandidates(input: {
    vaultRoot: string
    includeRecentDenseRaw?: boolean
    maxManifestBytes?: number
  }): Promise<{
    hasWork: boolean
    suspectedBytes: number
    legacyReceiptPayloadCount: number
    legacyCanonicalArtifactCount: number
    denseProviderSampleShardCount: number
    denseProviderRawTimeseriesCount: number
    retentionEligibleDenseProviderRawTimeseriesBytes: number
    retentionEligibleDenseProviderRawTimeseriesCount: number
  }>
  runWearableStorageMigrationPass(input: {
    vaultRoot: string
    maxFiles?: number
    maxBytes?: number
    deadlineMs?: number
    now?: Date
    pruneDenseRaw?: boolean
    includeRecentDenseRaw?: boolean
    validateAfter?: boolean
  }): Promise<{
    mutated: boolean
    hasMore: boolean
    bytesBefore: number
    bytesAfter: number
    bytesFreed: number
    compactedReceiptCount: number
    denseRawBytesAfter: number
    denseRawBytesBefore: number
    denseRawBytesFreed: number
    tombstonedCanonicalArtifactCount: number
    tombstonedDenseRawArtifactCount: number
    skippedCount: number
    touchedPaths: string[]
  }>
  addMeal(input: {
    vaultRoot: string
    photoPath?: string
    audioPath?: string
    note?: string
    occurredAt?: string
    source?: ImporterSource
    ingredients?: string[]
    nutrition?: MealNutrition
  }): Promise<{
    mealId: string
    event: {
      id: string
      occurredAt?: string | null
      note?: string | null
      source?: ImporterSource | null
      ingredients?: string[]
      nutrition?: MealNutrition
    }
    manifestPath: string
    photo: {
      relativePath: string
    } | null
    audio?: {
      relativePath: string
    } | null
  }>
  createExperiment(input: {
    vaultRoot: string
    slug: string
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: string
  }): Promise<{
    created?: boolean
    experiment: {
      id: string
      slug: string
      relativePath: string
    }
  }>
  ensureJournalDay(input: {
    vaultRoot: string
    date: string
  }): Promise<{
    relativePath: string
    created: boolean
  }>
  readAssessmentResponse(input: {
    vaultRoot: string
    assessmentId: string
  }): Promise<JsonObject>
  projectAssessmentResponse(input: {
    assessmentResponse: JsonObject
  }): Promise<JsonObject>
  upsertProtocol(input: Omit<PrivateProtocolUpsertInput, "vault" | "requestId"> & {
    vaultRoot: string
  }): Promise<{
    created: boolean
    record: {
      entity: JsonObject & {
        protocolId: string
        slug: string
        protocolRevisionId: string
        effectiveSpecHash: string
      }
      document: JsonObject & {
        relativePath: string
      }
    }
  }>
  stopRegimen(input: {
    vaultRoot: string
    group?: string
    regimenId: string
    stoppedOn?: string
  }): Promise<{
    record: {
      entity: {
        regimenId: string
        stoppedOn?: string | null
        status: string
      }
    }
  }>
}

type ImporterSource = "manual" | "import" | "device" | "derived"

export interface ImportersRuntime {
  importDocument(input: {
    filePath: string
    vaultRoot: string
    title?: string
    occurredAt?: string
    note?: string
    source?: ImporterSource
  }): Promise<{
    raw: {
      relativePath: string
    }
    manifestPath: string
    documentId: string
    event: {
      id: string
    }
  }>
  addMeal(input: {
    photoPath?: string
    audioPath?: string
    vaultRoot: string
    occurredAt?: string
    note?: string
    source?: ImporterSource
    ingredients?: string[]
    nutrition?: MealNutrition
  }): Promise<{
    mealId: string
    event: {
      id: string
      occurredAt?: string | null
      note?: string | null
      source?: ImporterSource | null
      ingredients?: string[]
      nutrition?: MealNutrition
    }
    photo: {
      relativePath: string
    } | null
    audio?: {
      relativePath: string
    } | null
    manifestPath: string
  }>
  importCsvSamples(input: {
    filePath: string
    vaultRoot: string
    stream?: string
    tsColumn?: string
    valueColumn?: string
    unit?: string
    delimiter?: string
    metadataColumns?: string[]
    presetId?: string
    requestId?: string | null
    source?: string
  }): Promise<{
    importedCount: number
    imports: Array<{
      stream: string
      unit: string
      timeZone: string
      tsColumn: string
      valueColumn: string
      importedCount: number
      skippedCount: number
      skipReasons: Array<{
        count: number
        reason: string
      }>
      transformId: string | null
      manifestPath: string | null
      lookupIds: string[]
      ledgerFiles: string[]
    }>
    skippedCount: number
    lookupIds: string[]
    ledgerFiles: string[]
    metadataColumns: string[]
    timeZone: string
    tsColumn: string
  }>
  importAssessmentResponse(input: {
    filePath: string
    vaultRoot: string
    title?: string
    occurredAt?: string
    importedAt?: string
    source?: string
    requestId?: string | null
  }): Promise<{
    assessment: {
      id: string
    }
    manifestPath: string
    raw: {
      relativePath: string
    }
    ledgerPath: string
  }>
}

export interface ImportersRuntimeModule {
  createImporters(input?: {
    corePort?: CoreRuntimeModule
  }): ImportersRuntime
  prepareCsvSampleImport(input: {
    filePath: string
    vaultRoot: string
    stream?: string
    tsColumn?: string
    valueColumn?: string
    unit?: string
    delimiter?: string
    metadataColumns?: string[]
    presetId?: string
    requestId?: string | null
    source?: string
  }): Promise<{
    timeZone: string
    tsColumn: string
    metadataColumns?: string[]
    imports: Array<{
      stream: string
      valueColumn: string
    }>
  }>
}

export type ImportersFactoryRuntimeModule = Pick<
  ImportersRuntimeModule,
  "createImporters"
>

export type QueryEntity = QueryCanonicalEntity
export type QueryRecord = QueryCanonicalEntity

export type QueryRuntimeModule = SharedQueryRuntimeModule

export interface IntegratedRuntime {
  core: CoreRuntimeModule
  query: QueryRuntimeModule
}
