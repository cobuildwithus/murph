import type {
  DeviceAccountDisconnectResult,
  DeviceAccountListResult,
  DeviceAccountReconcileResult,
  DeviceAccountShowResult,
  DeviceConnectResult,
  DeviceProviderListResult,
} from "../device-cli-contracts.js"
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
} from "../vault-cli-contracts.js"
import type { RawImportManifestResult } from "./document.js"
import type {
  CommandContext,
  HealthCoreRuntimeMethods,
  HealthCoreServiceMethods,
  HealthQueryRuntimeMethods,
  HealthQueryServiceMethods,
  JsonObject,
} from "../health-cli-method-types.js"

export type { CommandContext } from "../health-cli-method-types.js"

export interface ProjectAssessmentInput extends CommandContext {
  assessmentId: string
}

export interface StopRegimenInput extends CommandContext {
  regimenId: string
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
    | "sleep_session"
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

export interface VaultShowResult {
  vault: string
  schemaVersion: string | null
  vaultId: string | null
  title: string | null
  timezone: string | null
  createdAt: string | null
  corePath: string | null
  coreTitle: string | null
  coreUpdatedAt: string | null
}

export interface VaultPathsResult {
  vault: string
  paths: JsonObject | null
  shards: JsonObject | null
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
    regimens: number
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

export interface StopRegimenResult {
  vault: string
  regimenId: string
  lookupId: string
  stoppedOn: string | null
  status: string
}

export interface CoreWriteServices extends HealthCoreServiceMethods {
  init(input: CommandContext): Promise<VaultInitResult>
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
  projectAssessment(
    input: ProjectAssessmentInput,
  ): Promise<AssessmentProjectionResult>
  rebuildCurrentProfile(
    input: CommandContext,
  ): Promise<RebuildCurrentProfileResult>
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
  showVaultPaths(input: CommandContext): Promise<VaultPathsResult>
  showVaultStats(input: CommandContext): Promise<VaultStatsResult>
  show(
    input: CommandContext & {
      id: string
    },
  ): Promise<ShowResult>
  list(
    input: CommandContext & ListFilters,
  ): Promise<ListResult>
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
    baseUrl?: string
  }): Promise<DeviceProviderListResult>
  connect(input: {
    provider: string
    baseUrl?: string
    returnTo?: string
    open?: boolean
  }): Promise<DeviceConnectResult>
  listAccounts(input: {
    baseUrl?: string
    provider?: string
  }): Promise<DeviceAccountListResult>
  showAccount(input: {
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountShowResult>
  reconcileAccount(input: {
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountReconcileResult>
  disconnectAccount(input: {
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountDisconnectResult>
}

export interface VaultCliServices {
  core: CoreWriteServices
  importers: ImporterServices
  query: QueryServices
  devices: DeviceSyncServices
}

export interface CoreRuntimeModule extends HealthCoreRuntimeMethods {
  REQUIRED_DIRECTORIES: readonly string[]
  initializeVault(input: {
    vaultRoot: string
  }): Promise<unknown>
  validateVault(input: {
    vaultRoot: string
  }): Promise<{
    valid: boolean
    issues?: Array<Record<string, unknown>>
  }>
  addMeal(input: {
    vaultRoot: string
    photoPath: string
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
    }
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
  stopRegimenItem(input: {
    vaultRoot: string
    regimenId: string
    stoppedOn?: string
  }): Promise<{
    record: {
      regimenId: string
      stoppedOn?: string | null
      status: string
    }
  }>
}

export interface ImportersRuntimeModule {
  createImporters(input?: {
    corePort?: CoreRuntimeModule
  }): {
    importDocument(input: {
      filePath: string
      vaultRoot: string
      title?: string
      occurredAt?: string
      note?: string
      source?: "manual" | "import" | "device" | "derived"
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
    importCsvSamples(input: {
      filePath: string
      vaultRoot: string
      stream: string
      tsColumn: string
      valueColumn: string
      unit: string
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
}

export type ImportersRuntime = ReturnType<ImportersRuntimeModule["createImporters"]>

export interface QueryRecord {
  id: string
  recordType: string
  sourcePath?: string | null
  occurredAt?: string | null
  kind?: string | null
  title?: string | null
  body?: string | null
  data: Record<string, unknown>
}

export interface QueryEntity {
  entityId: string
  family: string
  kind: string
  path: string
  title: string | null
  occurredAt: string | null
  body: string | null
  attributes: Record<string, unknown>
  relatedIds: string[]
}

export interface QueryRuntimeModule extends HealthQueryRuntimeMethods {
  readVault(vaultRoot: string): Promise<unknown>
  readVaultTolerant(vaultRoot: string): Promise<unknown>
  lookupEntityById(readModel: unknown, entityId: string): QueryEntity | null
  listEntities(
    readModel: unknown,
    filters?: Record<string, unknown>,
  ): QueryEntity[]
  lookupRecordById(readModel: unknown, recordId: string): QueryRecord | null
  listRecords(
    readModel: unknown,
    filters?: Record<string, unknown>,
  ): QueryRecord[]
  buildExportPack(
    readModel: unknown,
    options?: Record<string, unknown>,
  ): {
    packId: string
    files: Array<{
      path: string
      contents: string
    }>
  }
}

export interface IntegratedRuntime {
  core: CoreRuntimeModule
  query: QueryRuntimeModule
}
