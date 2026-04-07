import type {
  DeviceAccountDisconnectResult,
  DeviceAccountListResult,
  DeviceAccountReconcileResult,
  DeviceAccountShowResult,
  DeviceConnectResult,
  DeviceDaemonStartResult,
  DeviceDaemonStatusResult,
  DeviceDaemonStopResult,
  DeviceProviderListResult,
} from "@murphai/operator-config/device-cli-contracts"
import type {
  DocumentImportResult,
  ExperimentCreateResult,
  ExportPackResult,
  JournalEnsureResult,
  ListFilters,
  ListResult,
  MealAddResult,
  ReadEntity,
  SamplesImportCsvResult,
  ShowResult,
  VaultInitResult,
  VaultValidateResult,
} from "@murphai/operator-config/vault-cli-contracts"
import type { RawImportManifestResult } from "./document-meal-read.js"
import type {
  CommandContext,
  HealthEntityEnvelope,
  HealthCoreRuntimeMethods,
  HealthCoreServiceMethods,
  HealthListEnvelope,
  HealthQueryRuntimeMethods,
  HealthQueryServiceMethods,
  JsonObject,
  UpsertRecordResult,
} from "../health-cli-method-types.js"
import type {
  QueryCanonicalEntity,
  QueryRuntimeModule as SharedQueryRuntimeModule,
  QueryWearableActivitySummary,
  QueryWearableBodyStateSummary,
  QueryWearableDaySummary,
  QueryWearableRecoverySummary,
  QueryWearableSleepSummary,
  QueryWearableSourceHealthSummary,
} from "../query-runtime.js"

export type { CommandContext } from "../health-cli-method-types.js"

export interface ProjectAssessmentInput extends CommandContext {
  assessmentId: string
}

export interface StopProtocolInput extends CommandContext {
  protocolId: string
  stoppedOn?: string
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

export interface RebuildCurrentProfileResult {
  vault: string
  profilePath: string
  snapshotId: string | null
  updated: boolean
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
  items: ReadEntity[]
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
  items: ReadEntity[]
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
  items: ReadEntity[]
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
    | "medication_intake"
    | "supplement_intake"
    | "activity_session"
    | "body_measurement"
    | "sleep_session"
    | "intervention_session"
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
  items: ReadEntity[]
  count: number
  nextCursor: string | null
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
  status: string
  updated: boolean
}

export interface ExperimentLifecycleResult extends ExperimentUpdateResult {
  eventId: string
  ledgerFile: string
}

export interface ExperimentListResult {
  vault: string
  filters: {
    status: string | null
    limit: number
  }
  items: ReadEntity[]
  count: number
  nextCursor: string | null
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
  items: ReadEntity[]
  count: number
  nextCursor: string | null
}

export interface WearableDayFiltersResult {
  providers: string[]
}

export interface WearableDayResult {
  vault: string
  date: string
  filters: WearableDayFiltersResult
  summary: QueryWearableDaySummary | null
}

export interface WearableListFiltersResult {
  date: string | null
  from: string | null
  to: string | null
  providers: string[]
  limit: number
}

export interface WearableListResult<TItem> {
  vault: string
  filters: WearableListFiltersResult
  items: TItem[]
  count: number
}

export type WearableSleepListResult = WearableListResult<QueryWearableSleepSummary>
export type WearableActivityListResult = WearableListResult<QueryWearableActivitySummary>
export type WearableBodyStateListResult = WearableListResult<QueryWearableBodyStateSummary>
export type WearableRecoveryListResult = WearableListResult<QueryWearableRecoverySummary>
export type WearableSourceListResult = WearableListResult<QueryWearableSourceHealthSummary>

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
    profileSnapshots: number
    goals: number
    conditions: number
    allergies: number
    protocols: number
    history: number
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

export interface VaultUpgradeResult {
  vault: string
  metadataFile: string
  title: string
  timezone: string
  fromFormatVersion: number
  toFormatVersion: number
  steps: Array<{
    description: string
    fromFormatVersion: number
    toFormatVersion: number
  }>
  affectedFiles: string[]
  rebuildableProjectionStores: string[]
  updated: boolean
  dryRun: boolean
  auditPath: string | null
}

export interface StopProtocolResult {
  vault: string
  protocolId: string
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

export interface CoreWriteServices extends HealthCoreServiceMethods {
  init(
    input: CommandContext & {
      timezone?: string
    },
  ): Promise<VaultInitResult>
  validate(input: CommandContext): Promise<VaultValidateResult>
  addMeal(
    input: CommandContext & {
      photo: string
      audio?: string
      note?: string
      occurredAt?: string
    },
  ): Promise<MealAddResult>
  createExperiment(
    input: CommandContext & {
      slug: string
      title?: string
      hypothesis?: string
      startedOn?: string
      status?: string
    },
  ): Promise<ExperimentCreateResult>
  updateExperiment(
    input: CommandContext & {
      inputFile: string
    },
  ): Promise<ExperimentUpdateResult>
  checkpointExperiment(
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
  addDailyFood(
    input: CommandContext & {
      title: string
      time: string
      note?: string
      slug?: string
    },
  ): Promise<FoodAddDailyResult>
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
  upgradeVault(
    input: CommandContext & {
      dryRun?: boolean
    },
  ): Promise<VaultUpgradeResult>
  projectAssessment(
    input: ProjectAssessmentInput,
  ): Promise<AssessmentProjectionResult>
  rebuildCurrentProfile(
    input: CommandContext,
  ): Promise<RebuildCurrentProfileResult>
  scaffoldSupplement(
    input: CommandContext,
  ): Promise<{
    vault: string
    noun: 'supplement'
    payload: JsonObject
  }>
  upsertSupplement(
    input: CommandContext & {
      input: string
    },
  ): Promise<UpsertRecordResult & { protocolId: string }>
  renameSupplement(
    input: CommandContext & {
      lookup: string
      title: string
      slug?: string
    },
  ): Promise<UpsertRecordResult & { protocolId: string }>
  stopProtocol(input: StopProtocolInput): Promise<StopProtocolResult>
  stopSupplement(input: StopProtocolInput): Promise<StopProtocolResult>
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
      status?: string
      limit: number
    },
  ): Promise<ExperimentListResult>
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

export interface DeviceSyncServices {
  listProviders(input: {
    vault?: string
    baseUrl?: string
  }): Promise<DeviceProviderListResult>
  connect(input: {
    vault?: string
    provider: string
    baseUrl?: string
    returnTo?: string
    open?: boolean
  }): Promise<DeviceConnectResult>
  listAccounts(input: {
    vault?: string
    baseUrl?: string
    provider?: string
  }): Promise<DeviceAccountListResult>
  showAccount(input: {
    vault?: string
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountShowResult>
  reconcileAccount(input: {
    vault?: string
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountReconcileResult>
  disconnectAccount(input: {
    vault?: string
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountDisconnectResult>
  daemonStatus(input: {
    vault: string
    baseUrl?: string
  }): Promise<DeviceDaemonStatusResult>
  daemonStart(input: {
    vault: string
    baseUrl?: string
  }): Promise<DeviceDaemonStartResult>
  daemonStop(input: {
    vault: string
    baseUrl?: string
  }): Promise<DeviceDaemonStopResult>
}

export interface VaultServices {
  core: CoreWriteServices
  importers: ImporterServices
  query: QueryServices
  devices: DeviceSyncServices
}

export interface CoreRuntimeModule extends HealthCoreRuntimeMethods {
  REQUIRED_DIRECTORIES: readonly string[]
  applyCanonicalWriteBatch(input: {
    vaultRoot: string
    operationType: string
    summary: string
    occurredAt?: string
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
  upgradeVault(input: {
    vaultRoot: string
    dryRun?: boolean
  }): Promise<{
    metadataFile: string
    title: string
    timezone: string
    fromFormatVersion: number
    toFormatVersion: number
    steps: Array<{
      description: string
      fromFormatVersion: number
      toFormatVersion: number
    }>
    affectedFiles: string[]
    rebuildableProjectionStores: string[]
    updated: boolean
    dryRun: boolean
    auditPath: string | null
  }>
  addMeal(input: {
    vaultRoot: string
    photoPath?: string
    audioPath?: string
    note?: string
    occurredAt?: string
  }): Promise<{
    mealId: string
    event: {
      id: string
      occurredAt?: string | null
      note?: string | null
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
  rebuildCurrentProfile(input: {
    vaultRoot: string
  }): Promise<{
    relativePath: string
    snapshot?: {
      id: string
    } | null
    updated: boolean
  }>
  stopProtocolItem(input: {
    vaultRoot: string
    protocolId: string
    stoppedOn?: string
  }): Promise<{
    record: {
      entity: {
        protocolId: string
        stoppedOn?: string | null
        status: string
      }
    }
  }>
}

interface QueryRuntimeSupplementMethods {
  listSupplements(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  showSupplement(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listSupplementCompounds(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<SupplementCompoundRecordResult[]>
  showSupplementCompound(
    vaultRoot: string,
    lookup: string,
    options?: Record<string, unknown>,
  ): Promise<SupplementCompoundRecordResult | null>
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
    source?: string
  }): Promise<{
    mealId: string
    event: {
      id: string
      occurredAt?: string | null
      note?: string | null
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
    count: number
    records: Array<{
      id: string
    }>
    transformId: string
    manifestPath: string
    shardPaths: string[]
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
    stream: string
  }>
}

export type ImportersFactoryRuntimeModule = Pick<ImportersRuntimeModule, "createImporters">

export type QueryEntity = QueryCanonicalEntity
export type QueryRecord = QueryCanonicalEntity

export type QueryRuntimeModule =
  SharedQueryRuntimeModule &
  HealthQueryRuntimeMethods &
  QueryRuntimeSupplementMethods

export interface IntegratedRuntime {
  core: CoreRuntimeModule
  query: QueryRuntimeModule
}
