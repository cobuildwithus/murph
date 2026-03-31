import type { ConnectorRestartPolicy } from '@murph/inboxd'
import type { RuntimePaths } from '@murph/runtime-state'
import { z } from 'incur'
import type { AgentmailApiClient } from '../agentmail-runtime.js'
import { inboxPromotionStoreSchema } from '../inbox-cli-contracts.js'
import type {
  InboxAttachmentListResult,
  InboxAttachmentParseResult,
  InboxAttachmentReparseResult,
  InboxAttachmentShowResult,
  InboxAttachmentStatusResult,
  InboxBackfillResult,
  InboxBootstrapResult,
  InboxConnectorConfig,
  InboxDaemonState,
  InboxDoctorCheck,
  InboxDoctorResult,
  InboxInitResult,
  InboxListResult,
  InboxParseResult,
  InboxParserToolchainStatus,
  InboxPromoteDocumentResult,
  InboxPromoteExperimentNoteResult,
  InboxPromoteJournalResult,
  InboxPromoteMealResult,
  InboxPromotionEntry,
  InboxProvisionedMailbox,
  InboxRequeueResult,
  InboxRunResult,
  InboxRuntimeConfig,
  InboxSearchResult,
  InboxSetupResult,
  InboxShowResult,
  InboxSourceAddResult,
  InboxSourceListResult,
  InboxSourceRemoveResult,
} from '../inbox-cli-contracts.js'
import type { QueryRuntimeModule } from '../query-runtime.js'
import type { ImportersFactoryRuntimeModule } from '../usecases/types.js'

export interface RuntimeAttachmentRecord {
  attachmentId?: string | null
  ordinal: number
  externalId?: string | null
  kind: 'image' | 'audio' | 'video' | 'document' | 'other'
  mime?: string | null
  originalPath?: string | null
  storedPath?: string | null
  fileName?: string | null
  byteSize?: number | null
  sha256?: string | null
  extractedText?: string | null
  transcriptText?: string | null
  derivedPath?: string | null
  parserProviderId?: string | null
  parseState?: 'pending' | 'running' | 'succeeded' | 'failed' | null
}

export interface RuntimeCaptureRecord {
  captureId: string
  eventId: string
  source: string
  externalId: string
  accountId?: string | null
  thread: {
    id: string
    title?: string | null
    isDirect?: boolean
  }
  actor: {
    id?: string | null
    displayName?: string | null
    isSelf: boolean
  }
  occurredAt: string
  receivedAt?: string | null
  text: string | null
  attachments: RuntimeAttachmentRecord[]
  raw: Record<string, unknown>
  envelopePath: string
  createdAt: string
}

export interface RuntimeSearchHit {
  captureId: string
  source: string
  accountId?: string | null
  threadId: string
  threadTitle?: string | null
  occurredAt: string
  text: string | null
  snippet: string
  score: number
  envelopePath: string
}

export interface RuntimeAttachmentParseJobRecord {
  jobId: string
  captureId: string
  attachmentId: string
  pipeline: 'attachment_text'
  state: 'pending' | 'running' | 'succeeded' | 'failed'
  attempts: number
  providerId?: string | null
  resultPath?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

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

export interface RuntimeStore {
  close(): void
  getCursor(source: string, accountId?: string | null): Record<string, unknown> | null
  setCursor(
    source: string,
    accountId: string | null | undefined,
    cursor: Record<string, unknown> | null,
  ): void
  listCaptures(filters?: {
    afterCaptureId?: string | null
    afterOccurredAt?: string | null
    source?: string
    accountId?: string | null
    limit?: number
    oldestFirst?: boolean
  }): RuntimeCaptureRecord[]
  searchCaptures(filters: {
    text: string
    source?: string
    accountId?: string | null
    limit?: number
  }): RuntimeSearchHit[]
  listAttachmentParseJobs?(filters?: {
    captureId?: string
    attachmentId?: string
    state?: 'pending' | 'running' | 'succeeded' | 'failed'
    limit?: number
  }): RuntimeAttachmentParseJobRecord[]
  requeueAttachmentParseJobs?(filters?: {
    captureId?: string
    attachmentId?: string
    state?: 'pending' | 'running' | 'succeeded' | 'failed'
  }): number
  getCapture(captureId: string): RuntimeCaptureRecord | null
}

export interface PersistedCapture {
  captureId?: string
  deduped: boolean
}

export interface PollConnector {
  id: string
  source: string
  accountId?: string | null
  kind: 'poll'
  capabilities: {
    backfill: boolean
    watch: boolean
    webhooks: boolean
    attachments: boolean
    ownMessages?: boolean
  }
  backfill?(
    cursor: Record<string, unknown> | null,
    emit: (
      capture: RuntimeCaptureRecordInput,
      checkpoint?: Record<string, unknown> | null,
    ) => Promise<PersistedCapture>,
  ): Promise<Record<string, unknown> | null>
  watch?(
    cursor: Record<string, unknown> | null,
    emit: (
      capture: RuntimeCaptureRecordInput,
      checkpoint?: Record<string, unknown> | null,
    ) => Promise<PersistedCapture>,
    signal: AbortSignal,
  ): Promise<void>
  close?(): Promise<void> | void
}

export interface RuntimeCaptureRecordInput {
  source: string
  externalId: string
  accountId?: string | null
  occurredAt: string
  receivedAt?: string | null
  thread?: {
    id: string
    title?: string | null
    isDirect?: boolean
  }
  actor?: {
    id?: string | null
    displayName?: string | null
    isSelf?: boolean
  }
  text?: string | null
  attachments?: Array<{
    kind: 'image' | 'audio' | 'video' | 'document' | 'other'
    fileName?: string | null
  }>
  raw?: Record<string, unknown>
}

export interface InboxRunEvent {
  capture?: RuntimeCaptureRecordInput
  connectorId: string
  counts?: {
    deduped: number
    imported: number
  }
  details?: string
  persisted?: PersistedCapture
  phase?: 'backfill' | 'startup' | 'watch'
  source: string
  type:
    | 'capture.imported'
    | 'connector.backfill.finished'
    | 'connector.backfill.started'
    | 'connector.failed'
    | 'connector.skipped'
    | 'connector.watch.started'
}

export interface InboxPipeline {
  runtime: RuntimeStore
  processCapture(input: RuntimeCaptureRecordInput): Promise<PersistedCapture>
  close(): void
}

export interface ImessageDriver {
  getMessages(input: {
    cursor?: Record<string, unknown> | null
    limit?: number
    includeOwnMessages?: boolean
  }): Promise<unknown[]>
  listChats?(): Promise<unknown[]>
}

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

export interface EmailDriver {
  inboxId: string
  listUnreadMessages(input?: {
    limit?: number
    signal?: AbortSignal
  }): Promise<unknown[]>
  getMessage?(input: {
    messageId: string
    signal?: AbortSignal
  }): Promise<unknown>
  markProcessed(input: {
    messageId: string
    signal?: AbortSignal
  }): Promise<void>
  downloadAttachment(input: {
    attachmentId: string
    messageId: string
    signal: AbortSignal
  }): Promise<Uint8Array | null>
  getThread?(input: {
    threadId: string
    signal?: AbortSignal
  }): Promise<unknown>
}

export interface InboxRuntimeModule {
  ensureInboxVault(vaultRoot: string): Promise<void>
  openInboxRuntime(input: { vaultRoot: string }): Promise<RuntimeStore>
  createInboxPipeline(input: {
    vaultRoot: string
    runtime: RuntimeStore
  }): Promise<InboxPipeline>
  createImessageConnector(input: {
    driver: ImessageDriver
    id?: string
    accountId?: string | null
    includeOwnMessages?: boolean
    backfillLimit?: number
  }): PollConnector
  createTelegramPollConnector(input: {
    driver: TelegramDriver
    id?: string
    accountId?: string | null
    backfillLimit?: number
    downloadAttachments?: boolean
    transportMode?: 'take-over-webhook' | 'require-no-webhook'
  }): PollConnector
  createEmailPollConnector(input: {
    driver: EmailDriver
    id?: string
    accountId?: string | null
    accountAddress?: string | null
    backfillLimit?: number
    pollIntervalMs?: number
  }): PollConnector
  createLinqWebhookConnector(input: {
    id?: string
    accountId?: string | null
    host?: string
    path?: string
    port?: number
    webhookSecret: string
    downloadAttachments?: boolean
  }): PollConnector
  createTelegramBotApiPollDriver(input: {
    token: string
    allowedUpdates?: string[] | null
    timeoutSeconds?: number
    batchSize?: number
    apiBaseUrl?: string
    fileBaseUrl?: string
  }): TelegramDriver
  createAgentmailApiPollDriver(input: {
    apiKey: string
    inboxId: string
    baseUrl?: string
  }): EmailDriver
  loadImessageKitDriver(): Promise<ImessageDriver>
  rebuildRuntimeFromVault(input: {
    vaultRoot: string
    runtime: RuntimeStore
  }): Promise<void>
  runInboxDaemon(input: {
    pipeline: InboxPipeline
    connectors: PollConnector[]
    signal: AbortSignal
    continueOnConnectorFailure?: boolean
    connectorRestartPolicy?: ConnectorRestartPolicy
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
    pdftotext: ParserToolRuntimeStatus
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
  manifestPath?: string
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
  createConfiguredParserRegistry(input: {
    vaultRoot: string
  }): Promise<ConfiguredParserRegistryRuntime>
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
  }): Promise<void>
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
  addMeal(input: {
    vaultRoot: string
    occurredAt?: string
    note?: string
    photoPath?: string
    audioPath?: string
    source?: string
  }): Promise<{
    mealId: string
    event: {
      id: string
    }
    manifestPath: string
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
  loadImessageDriver?: (config: InboxConnectorConfig) => Promise<ImessageDriver>
  loadTelegramDriver?: (config: InboxConnectorConfig) => Promise<TelegramDriver>
  loadEmailDriver?: (config: InboxConnectorConfig) => Promise<EmailDriver>
  createAgentmailClient?: (input: {
    apiKey: string
    baseUrl?: string
    env: NodeJS.ProcessEnv
  }) => AgentmailApiClient
  probeImessageMessagesDb?: (targetPath: string) => Promise<void>
  getEnvironment?: () => NodeJS.ProcessEnv
}

export interface SourceAddInput extends CommandContext {
  source: InboxConnectorConfig['source']
  id: string
  account?: string | null
  address?: string | null
  includeOwn?: boolean
  backfillLimit?: number
  provision?: boolean
  emailDisplayName?: string | null
  emailUsername?: string | null
  emailDomain?: string | null
  emailClientId?: string | null
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
}

export interface SetupInput extends CommandContext {
  ffmpegCommand?: string
  pdftotextCommand?: string
  whisperCommand?: string
  whisperModelPath?: string
}

export interface BootstrapInput extends SetupInput {
  rebuild?: boolean
  strict?: boolean
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
  afterOccurredAt?: string | null
  oldestFirst?: boolean
  sourceId?: string | null
  limit?: number
}

export interface SearchInput extends ListInput {
  text: string
}

export interface PromoteInput extends CommandContext {
  captureId: string
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
  parseAttachment(
    input: CommandContext & { attachmentId: string },
  ): Promise<InboxAttachmentParseResult>
  reparseAttachment(
    input: CommandContext & { attachmentId: string },
  ): Promise<InboxAttachmentReparseResult>
  show(input: CommandContext & { captureId: string }): Promise<InboxShowResult>
  search(input: SearchInput): Promise<InboxSearchResult>
  promoteMeal(input: PromoteInput): Promise<InboxPromoteMealResult>
  promoteDocument(input: PromoteInput): Promise<InboxPromoteDocumentResult>
  promoteJournal(input: PromoteInput): Promise<InboxPromoteJournalResult>
  promoteExperimentNote(
    input: PromoteInput,
  ): Promise<InboxPromoteExperimentNoteResult>
}

export type InboxCliServices = InboxServices

export interface RecoveredProvisionedMailbox {
  accountId: string
  emailAddress: string | null
  mailbox: InboxProvisionedMailbox | null
}

export interface ProvisionedMailboxResolution {
  accountId: string
  emailAddress: string | null
  provisionedMailbox: InboxProvisionedMailbox | null
  reusedMailbox: InboxProvisionedMailbox | null
}

export interface InboxAppEnvironment {
  clock: () => Date
  getPid: () => number
  getPlatform: () => NodeJS.Platform
  getHomeDirectory: () => string
  killProcess: (pid: number, signal?: NodeJS.Signals | number) => void
  sleep: (milliseconds: number) => Promise<void>
  getEnvironment: () => NodeJS.ProcessEnv
  usesInjectedEmailDriver: boolean
  usesInjectedTelegramDriver: boolean
  loadCore: () => Promise<CoreRuntimeModule>
  loadImporters: () => Promise<ImportersFactoryRuntimeModule>
  loadInbox: () => Promise<InboxRuntimeModule>
  loadParsers: () => Promise<ParsersRuntimeModule>
  loadQuery: () => Promise<QueryRuntimeModule>
  requireParsers: (operation: string) => Promise<ParsersRuntimeModule>
  loadConfiguredImessageDriver: (config: InboxConnectorConfig) => Promise<ImessageDriver>
  loadConfiguredTelegramDriver: (config: InboxConnectorConfig) => Promise<TelegramDriver>
  loadConfiguredEmailDriver: (config: InboxConnectorConfig) => Promise<EmailDriver>
  createConfiguredAgentmailClient: (apiKey?: string | null) => AgentmailApiClient
  enableAssistantAutoReplyChannel: (
    vault: string,
    channel: InboxConnectorConfig['source'],
  ) => Promise<boolean>
  provisionOrRecoverAgentmailInbox: (input: {
    displayName?: string | null
    username?: string | null
    domain?: string | null
    clientId?: string | null
    preferredAccountId?: string | null
    preferredEmailAddress?: string | null
  }) => Promise<ProvisionedMailboxResolution>
  tryResolveAgentmailInboxAddress: (input: {
    accountId: string
    emailAddress: string | null
  }) => Promise<string | null>
  ensureConfiguredImessageReady: () => Promise<void>
  journalPromotionEnabled: boolean
}
