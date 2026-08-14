import type {
  AttachmentParseJobRecord as SharedAttachmentParseJobRecord,
  InboxCaptureRecord as SharedInboxCaptureRecord,
  InboxPipeline as SharedInboxPipeline,
  InboxRuntimeStore as SharedInboxRuntimeStore,
  InboxSearchHit as SharedInboxSearchHit,
  IndexedAttachment as SharedIndexedAttachment,
  InboundCapture as SharedInboundCapture,
  PersistedCapture as SharedPersistedCapture,
  PollConnector as SharedPollConnector,
} from '@murphai/inboxd'
import type { ConnectorRestartPolicy } from '@murphai/inboxd/runtime'
import type { EventSource, MealNutrition } from '@murphai/contracts'
import type { RuntimePaths } from '@murphai/runtime-state/node'
import type * as z from '@murphai/contracts/zod-runtime'
import { inboxPromotionStoreSchema } from '@murphai/operator-config/inbox-cli-contracts'
import type {
  QueryEntityFamily,
  QueryVaultReadModel,
} from '@murphai/vault-usecases/runtime'
import type {
  InboxAttachmentListResult,
  InboxAttachmentShowResult,
  InboxAttachmentStatusResult,
  InboxBackfillResult,
  InboxBootstrapResult,
  InboxConnectorConfig,
  InboxDaemonState,
  InboxDoctorCheck,
  InboxDoctorResult,
  InboxEnvelopeRepairResult,
  InboxInitResult,
  InboxListResult,
  InboxParseResult,
  InboxParserAttemptCompactionResult,
  InboxParserToolchainStatus,
  InboxPromoteDocumentResult,
  InboxPromoteExperimentNoteResult,
  InboxPromoteJournalResult,
  InboxPromoteMealResult,
  InboxPreserveDocumentAttachmentsResult,
  InboxPromotionEntry,
  InboxRequeueResult,
  InboxRunResult,
  InboxRuntimeConfig,
  InboxSearchResult,
  InboxSetupResult,
  InboxShowResult,
  InboxSourceAddResult,
  InboxSourceListResult,
  InboxSourceRemoveResult,
} from '@murphai/operator-config/inbox-cli-contracts'

export type {
  InboxConnectorConfig,
  InboxRuntimeConfig,
} from '@murphai/operator-config/inbox-cli-contracts'

export type RuntimeAttachmentRecord = SharedIndexedAttachment
export type RuntimeCaptureRecord = SharedInboxCaptureRecord
export type RuntimeSearchHit = SharedInboxSearchHit
export type RuntimeAttachmentParseJobRecord = SharedAttachmentParseJobRecord

export type PromotionStore = z.infer<typeof inboxPromotionStoreSchema>
export type PromotionTarget = InboxPromotionEntry['target']
export type CanonicalPromotionLookupTarget = Extract<PromotionTarget, 'meal' | 'document'>

export interface CanonicalPromotionMatch {
  lookupId: string
  promotedAt: string
  relatedId: string
}

export interface CanonicalPromotionManifest {
  importId: string
  importedAt: string
  source: string | null
  artifacts: Array<{
    role: string
    sha256: string
  }>
  provenance: Record<string, unknown>
}

export interface CanonicalPromotionLookupSpec<
  TManifest extends CanonicalPromotionManifest,
  TContext,
> {
  target: CanonicalPromotionLookupTarget
  manifestDirectory: string
  manifestSchema: z.ZodType<TManifest>
  matchesManifest(manifest: TManifest, context: TContext): boolean
}

export type CanonicalAttachmentPromotionResult<
  TTarget extends CanonicalPromotionLookupTarget,
> = Extract<
  InboxPromoteMealResult | InboxPromoteDocumentResult,
  { target: TTarget }
>

export type RuntimeStore = Pick<
  SharedInboxRuntimeStore,
  | 'close'
  | 'getCursor'
  | 'setCursor'
  | 'claimNextAttachmentParseJob'
  | 'requeueAttachmentParseJobs'
  | 'completeAttachmentParseJob'
  | 'failAttachmentParseJob'
  | 'listCaptures'
  | 'searchCaptures'
  | 'listAttachmentParseJobs'
  | 'getCapture'
  | 'getAttachment'
>

export type PersistedCapture = SharedPersistedCapture
export type PollConnector = SharedPollConnector
export type RuntimeCaptureRecordInput = SharedInboundCapture

export interface InboxRunEvent {
  capture?: RuntimeCaptureRecordInput
  connectorId: string
  counts?: {
    deduped: number
    imported: number
  }
  details?: string
  parser?: {
    captureIds: string[]
    failed: number
    processed: number
    succeeded: number
  }
  persisted?: PersistedCapture
  phase?: 'backfill' | 'startup' | 'watch'
  source: string
  type:
    | 'capture.imported'
    | 'connector.backfill.finished'
    | 'connector.backfill.started'
    | 'connector.failed'
    | 'parser.jobs.drained'
    | 'connector.skipped'
    | 'connector.watch.started'
}

export type InboxPipeline = SharedInboxPipeline

export interface TelegramDriver {
  getMe(signal?: AbortSignal): Promise<unknown>
  getMessages(input: {
    cursor?: Record<string, unknown> | null
    limit?: number
    includeOwnMessages?: boolean
    signal?: AbortSignal
  }): Promise<unknown[]>
  startWatching(input: {
    cursor?: Record<string, unknown> | null
    includeOwnMessages?: boolean
    signal: AbortSignal
    onMessage(message: unknown): Promise<void> | void
  }): Promise<
    | { close?(): Promise<void> | void; stop?(): Promise<void> | void }
    | (() => Promise<void> | void)
    | void
  >
  getFile(fileId: string, signal?: AbortSignal): Promise<unknown>
  downloadFile(filePath: string, signal?: AbortSignal): Promise<Uint8Array>
  deleteWebhook?(input?: { dropPendingUpdates?: boolean }, signal?: AbortSignal): Promise<void>
  getWebhookInfo?(signal?: AbortSignal): Promise<{ url?: string } | null>
}

export interface InboxRuntimeModule {
  ensureInboxVault(vaultRoot: string): Promise<void>
  openInboxRuntime(input: { vaultRoot: string }): Promise<RuntimeStore>
  createInboxPipeline(input: {
    vaultRoot: string
    runtime: RuntimeStore
  }): Promise<InboxPipeline>
  createTelegramPollConnector(input: {
    driver: TelegramDriver
    id?: string
    accountId?: string | null
    backfillLimit?: number
    downloadAttachments?: boolean
    transportMode?: 'take-over-webhook' | 'require-no-webhook'
  }): PollConnector
  createTelegramBotApiPollDriver(input: {
    token: string
    allowedUpdates?: string[] | null
    timeoutSeconds?: number
    batchSize?: number
    apiBaseUrl?: string
    fileBaseUrl?: string
  }): TelegramDriver
  rebuildRuntimeFromVault(input: {
    enqueueParserJobs: boolean
    vaultRoot: string
    runtime: RuntimeStore
  }): Promise<void>
  runInboxEnvelopeMigration(input: {
    apply?: boolean
    maxFiles?: number
    vaultRoot: string
  }): Promise<Omit<InboxEnvelopeRepairResult, 'vault'>>
  runInboxDaemon(input: {
    pipeline: InboxPipeline
    connectors: PollConnector[]
    signal: AbortSignal
    continueOnConnectorFailure?: boolean
    connectorRestartPolicy?: ConnectorRestartPolicy
  }): Promise<void>
  createParsedInboxPipeline(input: {
    vaultRoot: string
    runtime: RuntimeStore
    registry: unknown
    ffmpeg?: {
      commandCandidates?: string[]
      allowSystemLookup?: boolean
    }
    drainParsersOnDeduped?: boolean
    onParserDrain?: (results: ParserRuntimeDrainResult[]) => Promise<void> | void
  }): Promise<InboxPipeline>
  runPollConnectorBackfill(input: {
    connector: PollConnector
    pipeline: InboxPipeline
    accountId?: string | null
  }): Promise<{
    cursor: Record<string, unknown> | null
  }>
  runInboxDaemonWithParsers(input: {
    vaultRoot: string
    runtime: RuntimeStore
    registry: unknown
    ffmpeg?: {
      commandCandidates?: string[]
      allowSystemLookup?: boolean
    }
    connectors: PollConnector[]
    signal: AbortSignal
    continueOnConnectorFailure?: boolean
    connectorRestartPolicy?: ConnectorRestartPolicy
    onParserDrain?: (results: ParserRuntimeDrainResult[]) => Promise<void> | void
  }): Promise<void>
}

export interface ParserToolRuntimeStatus {
  available: boolean
  command: string | null
  modelPath?: string | null
  source: 'config' | 'env' | 'system' | 'missing'
  reason: string
}

export interface ParserDoctorRuntimeReport {
  configPath: string
  discoveredAt: string
  tools: {
    ffmpeg: ParserToolRuntimeStatus
    whisper: ParserToolRuntimeStatus & {
      modelPath: string | null
    }
  }
}

export interface ConfiguredParserRegistryRuntime {
  doctor: ParserDoctorRuntimeReport
  registry: unknown
  ffmpeg?: {
    commandCandidates?: string[]
    allowSystemLookup?: boolean
  }
}

export interface ParserRuntimeDrainResult {
  status: 'failed' | 'succeeded'
  job: {
    attachmentId: string
    captureId: string
  }
  providerId?: string
  resultPath?: string
  errorCode?: string
  errorMessage?: string
}

export interface InboxParserServiceRuntime {
  drain(input?: {
    attachmentId?: string
    captureId?: string
    maxJobs?: number
  }): Promise<ParserRuntimeDrainResult[]>
}

export interface ParsersRuntimeModule {
  compactLegacyParserAttempts(input: {
    apply?: boolean
    maxAttempts?: number
    vaultRoot: string
  }): Promise<Omit<InboxParserAttemptCompactionResult, 'vault'>>
  createConfiguredParserRegistry(input: {
    vaultRoot: string
  }): Promise<ConfiguredParserRegistryRuntime>
  createInboxParserService(input: {
    vaultRoot: string
    runtime: RuntimeStore
    registry: unknown
    ffmpeg?: {
      commandCandidates?: string[]
      allowSystemLookup?: boolean
    }
  }): InboxParserServiceRuntime
  discoverParserToolchain(input: {
    vaultRoot: string
  }): Promise<ParserDoctorRuntimeReport>
  writeParserToolchainConfig(input: {
    vaultRoot: string
    tools?: Record<
      string,
      {
        command?: string | null
        modelPath?: string | null
      }
    >
  }): Promise<{
    config: {
      updatedAt: string
    }
    configPath: string
  }>
}

export interface CoreRuntimeModule {
  acquireCanonicalWriteLock?(input: string): Promise<{
    release(): Promise<void>
  }>
  withCanonicalWriteLockScope?<TResult>(
    vaultRoot: string,
    run: () => Promise<TResult>,
  ): Promise<TResult>
  addMeal(input: {
    vaultRoot: string
    occurredAt?: string
    note?: string
    photoPath?: string
    audioPath?: string
    source?: EventSource
    ingredients?: string[]
    nutrition?: MealNutrition
  }): Promise<{
    mealId: string
    event: {
      id: string
    }
    manifestPath: string
  }>
  importDocument?(input: {
    vaultRoot: string
    sourcePath: string
    title?: string
    occurredAt?: string
    note?: string
    source?: EventSource
  }): Promise<{
    documentId: string
    event: {
      id: string
    }
  }>
  promoteInboxJournal?(input: {
    vaultRoot: string
    date: string
    capture: RuntimeCaptureRecord
  }): Promise<{
    lookupId: string
    relatedId: string
    journalPath: string
    created: boolean
    appended: boolean
    linked: boolean
  }>
  promoteInboxExperimentNote?(input: {
    vaultRoot: string
    relativePath: string
    capture: RuntimeCaptureRecord
  }): Promise<{
    experimentId: string
    relatedId: string
    experimentPath: string
    experimentSlug: string
    appended: boolean
  }>
}

export interface ImportersRuntimeModule {
  importDocument(input: {
    filePath: string
    vaultRoot: string
    title?: string
    occurredAt?: string
    note?: string
    source?: string
  }): Promise<{
    documentId: string
    event: {
      id: string
    }
  }>
}

export interface ImportersFactoryRuntimeModule {
  createImporters(input?: {
    corePort?: CoreRuntimeModule
  }): ImportersRuntimeModule
}

export interface QueryRuntimeModule {
  readVault(vaultRoot: string): Promise<QueryVaultReadModel>
  listEntities(
    readModel: QueryVaultReadModel,
    filters?: {
      families?: QueryEntityFamily[]
    },
  ): Array<{
    path: string
    entityId: string
    attributes: {
      slug?: string
      status?: string | null
    }
    experimentSlug?: string | null
    status?: string | null
  }>
}

export interface PromotionScope<TPrepared, TDerived> {
  input: PromoteInput
  paths: InboxPaths
  capture: RuntimeCaptureRecord
  prepared: TPrepared
  derived: TDerived
  promotionStore: PromotionStore
  existing: InboxPromotionEntry | undefined
}

export interface CommandContext {
  vault: string
  requestId: string | null
}

export type InboxPaths = RuntimePaths

export interface InboxServicesDependencies {
  clock?: () => Date
  getPid?: () => number
  getPlatform?: () => NodeJS.Platform
  getHomeDirectory?: () => string
  killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
  sleep?: (milliseconds: number) => Promise<void>
  enableJournalPromotion?: boolean
  loadCoreModule?: () => Promise<CoreRuntimeModule>
  loadImportersModule?: () => Promise<ImportersFactoryRuntimeModule>
  loadInboxModule?: () => Promise<InboxRuntimeModule>
  loadParsersModule?: () => Promise<ParsersRuntimeModule>
  loadQueryModule?: () => Promise<QueryRuntimeModule>
  loadTelegramDriver?: (config: InboxConnectorConfig) => Promise<TelegramDriver>
  enableAssistantAutoReplyChannel?: (
    vault: string,
    channel: InboxConnectorConfig['source'],
  ) => Promise<boolean>
  getEnvironment?: () => NodeJS.ProcessEnv
}

export interface SourceAddInput extends CommandContext {
  source: InboxConnectorConfig['source']
  id: string
  account?: string | null
  includeOwn?: boolean
  backfillLimit?: number
  linqWebhookHost?: string | null
  linqWebhookPath?: string | null
  linqWebhookPort?: number
  enableAutoReply?: boolean
}

export interface SourceRemoveInput extends CommandContext {
  connectorId: string
}

export interface SourceSetEnabledInput extends CommandContext {
  connectorId: string
  enabled: boolean
}

export interface InboxSourceSetEnabledResult {
  vault: string
  configPath: string
  connector: InboxConnectorConfig
  connectorCount: number
}

export interface DoctorInput extends CommandContext {
  sourceId?: string | null
}

export interface DoctorContext {
  input: DoctorInput
  paths: InboxPaths
  inboxd: InboxRuntimeModule
  checks: InboxDoctorCheck[]
  config: InboxRuntimeConfig | null
  databaseAvailable: boolean
  parserToolchain: InboxParserToolchainStatus | null
}

export type DoctorTargetResolution =
  | {
      kind: 'all'
      connectors: InboxConnectorConfig[]
    }
  | {
      kind: 'missing'
    }
  | {
      kind: 'connector'
      connector: InboxConnectorConfig
    }

export interface InitInput extends CommandContext {
  rebuild?: boolean
  rebuildParserJobs?: boolean
}

export interface SetupInput extends CommandContext {
  ffmpegCommand?: string
  whisperCommand?: string
  whisperModelPath?: string
}

export interface BootstrapInput extends SetupInput {
  rebuild?: boolean
}

export interface ParseInput extends CommandContext {
  captureId?: string | null
  limit?: number
}

export interface RequeueInput extends CommandContext {
  attachmentId?: string | null
  captureId?: string | null
  state?: 'failed' | 'running'
}

export interface BackfillInput extends CommandContext {
  sourceId: string
  limit?: number
  parse?: boolean
}

export interface ListInput extends CommandContext {
  afterCaptureId?: string | null
  afterCreatedAt?: string | null
  afterOccurredAt?: string | null
  oldestFirst?: boolean
  sourceId?: string | null
  limit?: number
}

export interface SearchInput extends ListInput {
  text: string
}

export interface ShowInput extends CommandContext {
  captureId: string
}

export interface PromoteInput extends CommandContext {
  captureId: string
  note?: string
  occurredAt?: string
  source?: EventSource
  ingredients?: string[]
  nutrition?: MealNutrition
}

export interface RepairInboxEnvelopesInput extends CommandContext {
  apply: boolean
  maxFiles?: number
}

export interface CompactInboxParserAttemptsInput extends CommandContext {
  apply: boolean
  maxAttempts?: number
}

export interface InboxServices {
  bootstrap(input: BootstrapInput): Promise<InboxBootstrapResult>
  init(input: InitInput): Promise<InboxInitResult>
  sourceAdd(input: SourceAddInput): Promise<InboxSourceAddResult>
  sourceList(input: CommandContext): Promise<InboxSourceListResult>
  sourceRemove(input: SourceRemoveInput): Promise<InboxSourceRemoveResult>
  sourceSetEnabled(input: SourceSetEnabledInput): Promise<InboxSourceSetEnabledResult>
  doctor(input: DoctorInput): Promise<InboxDoctorResult>
  setup(input: SetupInput): Promise<InboxSetupResult>
  repairEnvelopes(input: RepairInboxEnvelopesInput): Promise<InboxEnvelopeRepairResult>
  compactParserAttempts(
    input: CompactInboxParserAttemptsInput,
  ): Promise<InboxParserAttemptCompactionResult>
  parse(input: ParseInput): Promise<InboxParseResult>
  requeue(input: RequeueInput): Promise<InboxRequeueResult>
  backfill(input: BackfillInput): Promise<InboxBackfillResult>
  run(
    input: CommandContext,
    options?: {
      onEvent?: (event: InboxRunEvent) => void
      signal?: AbortSignal
    },
  ): Promise<InboxRunResult>
  status(input: CommandContext): Promise<InboxDaemonState>
  stop(input: CommandContext): Promise<InboxDaemonState>
  list(input: ListInput): Promise<InboxListResult>
  listAttachments(
    input: CommandContext & { captureId: string },
  ): Promise<InboxAttachmentListResult>
  showAttachment(
    input: CommandContext & { attachmentId: string },
  ): Promise<InboxAttachmentShowResult>
  showAttachmentStatus(
    input: CommandContext & { attachmentId: string },
  ): Promise<InboxAttachmentStatusResult>
  show(input: ShowInput): Promise<InboxShowResult>
  search(input: SearchInput): Promise<InboxSearchResult>
  preserveDocumentAttachments(
    input: PromoteInput,
  ): Promise<InboxPreserveDocumentAttachmentsResult>
  promoteMeal(input: PromoteInput): Promise<InboxPromoteMealResult>
  promoteDocument(input: PromoteInput): Promise<InboxPromoteDocumentResult>
  promoteJournal(input: PromoteInput): Promise<InboxPromoteJournalResult>
  promoteExperimentNote(
    input: PromoteInput,
  ): Promise<InboxPromoteExperimentNoteResult>
}

export interface InboxAppEnvironment {
  clock: () => Date
  getPid: () => number
  getPlatform: () => NodeJS.Platform
  getHomeDirectory: () => string
  killProcess: (pid: number, signal?: NodeJS.Signals | number) => void
  sleep: (milliseconds: number) => Promise<void>
  getEnvironment: () => NodeJS.ProcessEnv
  usesInjectedTelegramDriver: boolean
  loadCore: () => Promise<CoreRuntimeModule>
  loadImporters: () => Promise<ImportersFactoryRuntimeModule>
  loadInbox: () => Promise<InboxRuntimeModule>
  loadParsers: () => Promise<ParsersRuntimeModule>
  loadQuery: () => Promise<QueryRuntimeModule>
  requireParsers: (operation: string) => Promise<ParsersRuntimeModule>
  loadConfiguredTelegramDriver: (config: InboxConnectorConfig) => Promise<TelegramDriver>
  enableAssistantAutoReplyChannel: (
    vault: string,
    channel: InboxConnectorConfig['source'],
  ) => Promise<boolean>
  journalPromotionEnabled: boolean
}
