import os from 'node:os'
import path from 'node:path'
import { resolveRuntimePaths, type RuntimePaths } from '@healthybob/runtime-state'
import { z } from 'incur'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from './assistant-state.js'
import {
  createAgentmailApiClient,
  listAllAgentmailInboxes,
  matchesAgentmailHttpError,
  resolveAgentmailApiKey,
  resolveAgentmailBaseUrl,
  type AgentmailApiClient,
  type AgentmailInbox,
} from './agentmail-runtime.js'
import { ensureImessageMessagesDbReadable } from './imessage-readiness.js'
import {
  loadQueryRuntime,
  type QueryRuntimeModule,
} from './query-runtime.js'
import { loadRuntimeModule } from './runtime-import.js'
import {
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
  resolveTelegramFileBaseUrl,
} from './telegram-runtime.js'
import {
  probeLinqApi,
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from './linq-runtime.js'
import { SETUP_RUNTIME_ENV_NOTICE } from './setup-runtime-env.js'
import { VaultCliError } from './vault-cli-errors.js'
import type { ImportersFactoryRuntimeModule } from './usecases/types.js'
import { toVaultCliError } from './usecases/vault-usecase-helpers.js'
import {
  type InboxAttachmentListResult,
  type InboxAttachmentParseResult,
  type InboxAttachmentReparseResult,
  type InboxAttachmentShowResult,
  type InboxAttachmentStatusResult,
  type InboxDaemonState,
  inboxPromotionStoreSchema,
  type InboxBackfillResult,
  type InboxBootstrapResult,
  type InboxConnectorConfig,
  type InboxDoctorCheck,
  type InboxDoctorResult,
  type InboxInitResult,
  type InboxListResult,
  type InboxParseResult,
  type InboxParserToolchainStatus,
  type InboxPromotionEntry,
  type InboxProvisionedMailbox,
  type InboxPromoteExperimentNoteResult,
  type InboxPromoteMealResult,
  type InboxPromoteDocumentResult,
  type InboxPromoteJournalResult,
  type InboxRequeueResult,
  type InboxRunResult,
  type InboxRuntimeConfig,
  type InboxSearchResult,
  type InboxSetupResult,
  type InboxShowResult,
  type InboxSourceAddResult,
  type InboxSourceListResult,
  type InboxSourceRemoveResult,
} from './inbox-cli-contracts.js'
import {
  instantiateConnector,
} from './inbox-services/connectors.js'
import {
  buildDaemonState,
  createProcessSignalBridge,
  normalizeDaemonState,
  writeDaemonState,
} from './inbox-services/daemon.js'
import {
  createParserServiceContext,
  buildAttachmentParseStatus,
  isParseableAttachment,
  requireAttachmentParseJobs,
  requireAttachmentReparseSupport,
  summarizeParserDrain,
  toCliParserToolchain,
  toParserToolChecks,
  assertBootstrapStrictReady,
} from './inbox-services/parser.js'
import {
  documentCanonicalPromotionSpec,
  mealCanonicalPromotionSpec,
  persistPromotionEntry,
  promoteCanonicalAttachmentImport,
  readExperimentPromotionEntries,
  readPromotionsByCapture,
  requireExperimentPromotionCore,
  requireExperimentPromotionEntry,
  requireJournalPromotionCore,
  resolveAttachmentSha256,
  resolveExperimentPromotionTarget,
  withPromotionScope,
} from './inbox-services/promotions.js'
import {
  buildCaptureCursor,
  detailCapture,
  isStoredAudioAttachment,
  isStoredDocumentAttachment,
  isStoredImageAttachment,
  requireAttachmentRecord,
  requireCapture,
  resolveSourceFilter,
  summarizeCapture,
  toCliAttachment,
} from './inbox-services/query.js'
import {
  ensureConfigFile,
  ensureConnectorNamespaceAvailable,
  ensureDirectory,
  ensureInitialized,
  findConnector,
  readConfig,
  rebuildRuntime,
  sortConnectors,
  withInitializedInboxRuntime,
  writeConfig,
  requireConnector,
} from './inbox-services/state.js'
import {
  errorMessage,
  failCheck,
  fileExists,
  normalizeBackfillLimit,
  normalizeConnectorAccountId,
  normalizeLimit,
  normalizeNullableString,
  normalizeOptionalCommandLimit,
  occurredDayFromCapture,
  passCheck,
  relativeToVault,
  runtimeNamespaceAccountId,
  warnCheck,
} from './inbox-services/shared.js'

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
  phase?: 'backfill' | 'watch'
  source: string
  type:
    | 'capture.imported'
    | 'connector.backfill.finished'
    | 'connector.backfill.started'
    | 'connector.failed'
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
  }): Promise<{ close?(): Promise<void> | void; stop?(): Promise<void> | void } | (() => Promise<void> | void) | void>
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
    signal?: AbortSignal
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
    resetWebhookOnStart?: boolean
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
    webhookSecret?: string | null
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
    paddleocr: ParserToolRuntimeStatus
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
    tools?: Record<string, {
      command?: string | null
      modelPath?: string | null
    }>
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

interface CommandContext {
  vault: string
  requestId: string | null
}

export type InboxPaths = RuntimePaths

interface InboxServicesDependencies {
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

interface SourceAddInput extends CommandContext {
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

interface SourceRemoveInput extends CommandContext {
  connectorId: string
}

interface SourceSetEnabledInput extends CommandContext {
  connectorId: string
  enabled: boolean
}

interface InboxSourceSetEnabledResult {
  vault: string
  configPath: string
  connector: InboxConnectorConfig
  connectorCount: number
}

interface DoctorInput extends CommandContext {
  sourceId?: string | null
}

interface DoctorContext {
  input: DoctorInput
  paths: InboxPaths
  inboxd: InboxRuntimeModule
  checks: InboxDoctorCheck[]
  config: InboxRuntimeConfig | null
  databaseAvailable: boolean
  parserToolchain: InboxParserToolchainStatus | null
}

type DoctorTargetResolution =
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

interface InitInput extends CommandContext {
  rebuild?: boolean
}

interface SetupInput extends CommandContext {
  ffmpegCommand?: string
  paddleocrCommand?: string
  pdftotextCommand?: string
  whisperCommand?: string
  whisperModelPath?: string
}

interface BootstrapInput extends SetupInput {
  rebuild?: boolean
  strict?: boolean
}

interface ParseInput extends CommandContext {
  captureId?: string | null
  limit?: number
}

interface RequeueInput extends CommandContext {
  attachmentId?: string | null
  captureId?: string | null
  state?: 'failed' | 'running'
}

interface BackfillInput extends CommandContext {
  sourceId: string
  limit?: number
  parse?: boolean
}

interface ListInput extends CommandContext {
  afterCaptureId?: string | null
  afterOccurredAt?: string | null
  oldestFirst?: boolean
  sourceId?: string | null
  limit?: number
}

interface SearchInput extends ListInput {
  text: string
}

interface PromoteInput extends CommandContext {
  captureId: string
}

export interface InboxCliServices {
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

const IMESSAGE_MESSAGES_DB_RELATIVE_PATH = path.join(
  'Library',
  'Messages',
  'chat.db',
)
function createParserRuntimeUnavailableError(
  operation: string,
  cause: unknown,
): VaultCliError {
  const details =
    cause instanceof Error
      ? {
          cause: cause.message,
          packages: ['@healthybob/inboxd', '@healthybob/parsers'],
        }
      : {
          packages: ['@healthybob/inboxd', '@healthybob/parsers'],
        }

  return new VaultCliError(
    'runtime_unavailable',
    `packages/cli can describe ${operation}, but local execution is blocked until the integrating workspace builds and links @healthybob/inboxd and @healthybob/parsers.`,
    details,
  )
}

function normalizeOptionalLinqWebhookPath(
  value: string | null | undefined,
): string | undefined {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return undefined
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeOptionalLinqWebhookPort(
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new VaultCliError(
      'INBOX_LINQ_WEBHOOK_PORT_INVALID',
      'Linq webhook port must be an integer between 1 and 65535.',
    )
  }

  return value
}

function describeLinqConnectorEndpoint(
  connector: Pick<InboxConnectorConfig, 'options'>,
): {
  host: string
  path: string
  port: number
} {
  return {
    host: connector.options.linqWebhookHost ?? '0.0.0.0',
    path: connector.options.linqWebhookPath ?? '/linq-webhook',
    port: connector.options.linqWebhookPort ?? 8789,
  }
}

function instrumentConnectorForRunEvents(
  connector: PollConnector,
  onEvent?: ((event: InboxRunEvent) => void) | null,
): PollConnector {
  if (!onEvent) {
    return connector
  }

  const baseEvent = {
    connectorId: connector.id,
    source: connector.source,
  } as const

  return {
    ...connector,
    async backfill(cursor, emit) {
      onEvent({
        ...baseEvent,
        phase: 'backfill',
        type: 'connector.backfill.started',
      })

      let imported = 0
      let deduped = 0

      try {
        const nextCursor = await connector.backfill?.(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await emit(capture, checkpoint)
            if (persisted.deduped) {
              deduped += 1
            } else {
              imported += 1
            }
            return persisted
          },
        )

        onEvent({
          ...baseEvent,
          counts: {
            deduped,
            imported,
          },
          phase: 'backfill',
          type: 'connector.backfill.finished',
        })

        return nextCursor ?? null
      } catch (error) {
        onEvent({
          ...baseEvent,
          details: errorMessage(error),
          phase: 'backfill',
          type: 'connector.failed',
        })
        throw error
      }
    },
    async watch(cursor, emit, signal) {
      onEvent({
        ...baseEvent,
        phase: 'watch',
        type: 'connector.watch.started',
      })

      try {
        return await connector.watch?.(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await emit(capture, checkpoint)
            if (!persisted.deduped) {
              onEvent({
                ...baseEvent,
                capture,
                persisted,
                phase: 'watch',
                type: 'capture.imported',
              })
            }
            return persisted
          },
          signal,
        )
      } catch (error) {
        onEvent({
          ...baseEvent,
          details: errorMessage(error),
          phase: 'watch',
          type: 'connector.failed',
        })
        throw error
      }
    },
  }
}

export function createIntegratedInboxCliServices(
  dependencies: InboxServicesDependencies = {},
): InboxCliServices {
  const clock = dependencies.clock ?? (() => new Date())
  const getPid = dependencies.getPid ?? (() => process.pid)
  const getPlatform = dependencies.getPlatform ?? (() => process.platform)
  const getHomeDirectory = dependencies.getHomeDirectory ?? (() => os.homedir())
  const killProcess =
    dependencies.killProcess ??
    ((pid: number, signal?: NodeJS.Signals | number) => {
      process.kill(pid, signal)
    })
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds)
      }))
  const getEnvironment = dependencies.getEnvironment ?? (() => process.env)
  const loadCore =
    dependencies.loadCoreModule ??
    (() => loadRuntimeModule<CoreRuntimeModule>('@healthybob/core'))
  const loadImporters =
    dependencies.loadImportersModule ??
    (() => loadRuntimeModule<ImportersFactoryRuntimeModule>('@healthybob/importers'))
  const loadInbox =
    dependencies.loadInboxModule ??
    (() => loadRuntimeModule<InboxRuntimeModule>('@healthybob/inboxd'))
  const loadParsers =
    dependencies.loadParsersModule ??
    (() => loadRuntimeModule<ParsersRuntimeModule>('@healthybob/parsers'))
  const loadQuery =
    dependencies.loadQueryModule ??
    (() => loadQueryRuntime())

  const requireParsers = async (
    operation: string,
  ): Promise<ParsersRuntimeModule> => {
    try {
      return await loadParsers()
    } catch (error) {
      throw createParserRuntimeUnavailableError(operation, error)
    }
  }

  const loadConfiguredImessageDriver = async (
    config: InboxConnectorConfig,
  ): Promise<ImessageDriver> => {
    if (dependencies.loadImessageDriver) {
      return dependencies.loadImessageDriver(config)
    }

    const inboxd = await loadInbox()
    return inboxd.loadImessageKitDriver()
  }

  const loadConfiguredTelegramDriver = async (
    config: InboxConnectorConfig,
  ): Promise<TelegramDriver> => {
    if (dependencies.loadTelegramDriver) {
      return dependencies.loadTelegramDriver(config)
    }

    const inboxd = await loadInbox()
    const env = getEnvironment()
    const token = resolveTelegramBotToken(env)

    if (!token) {
      throw new VaultCliError(
        'INBOX_TELEGRAM_TOKEN_MISSING',
        `Telegram requires a bot token in TELEGRAM_BOT_TOKEN. ${SETUP_RUNTIME_ENV_NOTICE}`,
      )
    }

    return inboxd.createTelegramBotApiPollDriver({
      token,
      apiBaseUrl: resolveTelegramApiBaseUrl(env) ?? undefined,
      fileBaseUrl: resolveTelegramFileBaseUrl(env) ?? undefined,
    })
  }

  const createConfiguredAgentmailClient = (
    apiKey?: string | null,
  ): AgentmailApiClient => {
    const env = getEnvironment()
    const resolvedApiKey =
      normalizeNullableString(apiKey) ?? resolveAgentmailApiKey(env)

    if (!resolvedApiKey) {
      throw new VaultCliError(
        'INBOX_EMAIL_API_KEY_MISSING',
        `Email requires AGENTMAIL_API_KEY. ${SETUP_RUNTIME_ENV_NOTICE}`,
      )
    }

    const baseUrl = resolveAgentmailBaseUrl(env) ?? undefined

    return dependencies.createAgentmailClient
      ? dependencies.createAgentmailClient({
          apiKey: resolvedApiKey,
          baseUrl,
          env,
        })
      : createAgentmailApiClient(resolvedApiKey, {
          baseUrl,
        })
  }

  const loadConfiguredEmailDriver = async (
    config: InboxConnectorConfig,
  ): Promise<EmailDriver> => {
    if (dependencies.loadEmailDriver) {
      return dependencies.loadEmailDriver(config)
    }

    const inboxId = normalizeNullableString(config.accountId)
    if (!inboxId) {
      throw new VaultCliError(
        'INBOX_EMAIL_ACCOUNT_REQUIRED',
        'Email connectors require an AgentMail inbox id as the connector account.',
      )
    }

    const client = createConfiguredAgentmailClient()
    const inboxd = await loadInbox()
    return inboxd.createAgentmailApiPollDriver({
      apiKey: client.apiKey,
      inboxId,
      baseUrl: client.baseUrl,
    })
  }

  const enableAssistantAutoReplyChannel = async (
    vault: string,
    channel: InboxConnectorConfig['source'],
  ): Promise<boolean> => {
    const state = await readAssistantAutomationState(vault)
    const channels = [...new Set([...state.autoReplyChannels, channel])]
    const preferredChannels = [...new Set([...state.preferredChannels, channel])]
    const backlogChannels = [
      ...new Set([
        ...state.autoReplyBacklogChannels.filter((value) => channels.includes(value)),
        ...(channel === 'email' ? ['email'] : []),
      ]),
    ]
    const changed =
      channels.length !== state.autoReplyChannels.length ||
      channels.some((value, index) => state.autoReplyChannels[index] !== value) ||
      preferredChannels.length !== state.preferredChannels.length ||
      preferredChannels.some((value, index) => state.preferredChannels[index] !== value) ||
      backlogChannels.length !== state.autoReplyBacklogChannels.length ||
      backlogChannels.some((value, index) => state.autoReplyBacklogChannels[index] !== value)

    if (!changed) {
      return false
    }

    await saveAssistantAutomationState(vault, {
      version: 2,
      inboxScanCursor: state.inboxScanCursor,
      autoReplyScanCursor: null,
      autoReplyChannels: channels,
      preferredChannels,
      autoReplyBacklogChannels: backlogChannels,
      autoReplyPrimed: false,
      updatedAt: new Date().toISOString(),
    })

    return true
  }

  const toProvisionedMailbox = (
    inbox: AgentmailInbox,
  ): InboxProvisionedMailbox => ({
    inboxId: inbox.inbox_id,
    emailAddress: inbox.email,
    displayName: normalizeNullableString(inbox.display_name),
    clientId: normalizeNullableString(inbox.client_id),
    provider: 'agentmail',
  })

  const tryResolveAgentmailInboxAddress = async (input: {
    accountId: string
    emailAddress: string | null
  }): Promise<string | null> => {
    if (input.emailAddress) {
      return input.emailAddress
    }

    try {
      const inbox = await createConfiguredAgentmailClient().getInbox(input.accountId)
      return normalizeNullableString(inbox.email)
    } catch {
      return input.emailAddress
    }
  }

  const toRecoveredMailbox = (input: {
    accountId: string
    emailAddress: string | null
  }): InboxProvisionedMailbox | null => {
    const emailAddress = normalizeNullableString(input.emailAddress)
    if (!emailAddress) {
      return null
    }

    return {
      inboxId: input.accountId,
      emailAddress,
      displayName: null,
      clientId: null,
      provider: 'agentmail',
    }
  }

  const recoverForbiddenAgentmailProvision = async (input: {
    preferredAccountId?: string | null
    preferredEmailAddress?: string | null
  } = {}): Promise<{
    accountId: string
    emailAddress: string | null
    mailbox: InboxProvisionedMailbox | null
  }> => {
    const preferredAccountId = normalizeNullableString(input.preferredAccountId)
    const preferredEmailAddress = normalizeNullableString(input.preferredEmailAddress)

    if (preferredAccountId) {
      try {
        const inbox = await createConfiguredAgentmailClient().getInbox(preferredAccountId)
        return {
          accountId: inbox.inbox_id,
          emailAddress: normalizeNullableString(inbox.email),
          mailbox: toProvisionedMailbox(inbox),
        }
      } catch {
        return {
          accountId: preferredAccountId,
          emailAddress: preferredEmailAddress,
          mailbox: toRecoveredMailbox({
            accountId: preferredAccountId,
            emailAddress: preferredEmailAddress,
          }),
        }
      }
    }

    try {
      const inboxes = await listAllAgentmailInboxes(createConfiguredAgentmailClient())

      if (inboxes.length === 1) {
        const inbox = inboxes[0]!
        return {
          accountId: inbox.inbox_id,
          emailAddress: normalizeNullableString(inbox.email),
          mailbox: toProvisionedMailbox(inbox),
        }
      }

      if (inboxes.length > 1) {
        throw new VaultCliError(
          'INBOX_EMAIL_ACCOUNT_SELECTION_REQUIRED',
          'AgentMail rejected inbox creation for this API key, but multiple existing inboxes are available. Rerun with --account <inbox_id> to choose one, or use `healthybob onboard` to select an inbox interactively.',
          { inboxCount: inboxes.length },
        )
      }

      throw new VaultCliError(
        'INBOX_EMAIL_ACCOUNT_REQUIRED',
        'AgentMail rejected inbox creation for this API key and no existing inboxes were returned. Rerun with --account <inbox_id> for an existing inbox, or check whether this key can create inboxes.',
      )
    } catch (error) {
      if (
        matchesAgentmailHttpError(error, {
          status: 403,
          method: 'GET',
          path: '/inboxes',
        })
      ) {
        throw new VaultCliError(
          'INBOX_EMAIL_SCOPED_KEY_ACCOUNT_REQUIRED',
          'AgentMail rejected both inbox creation and inbox discovery for this API key. This key may be scoped to an existing inbox. Rerun with --account <inbox_id> (often the inbox email address), or use `healthybob onboard`.',
        )
      }

      if (error instanceof VaultCliError) {
        throw error
      }

      throw error
    }
  }

  const ensureConfiguredImessageReady = async (): Promise<void> => {
    await ensureImessageMessagesDbReadable(
      {
        homeDirectory: getHomeDirectory(),
        platform: getPlatform(),
        probeMessagesDb: dependencies.probeImessageMessagesDb,
      },
      {
        unavailableCode: 'INBOX_IMESSAGE_UNAVAILABLE',
        unavailableMessage: 'The iMessage inbox connector requires macOS.',
        permissionCode: 'INBOX_IMESSAGE_PERMISSION_REQUIRED',
        permissionMessage:
          'The iMessage inbox connector requires read access to ~/Library/Messages/chat.db. Grant Full Disk Access to the terminal or app running Healthy Bob, fully restart it, and retry.',
      },
    )
  }

  const journalPromotionEnabled =
    dependencies.enableJournalPromotion ?? dependencies.loadCoreModule === undefined

  const initInboxRuntime = async (input: InitInput): Promise<InboxInitResult> => {
    const paths = resolveRuntimePaths(input.vault)
    const inboxd = await loadInbox()
    await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

    const createdPaths: string[] = []
    await ensureDirectory(paths.runtimeRoot, createdPaths, paths.absoluteVaultRoot)
    await ensureDirectory(
      paths.inboxRuntimeRoot,
      createdPaths,
      paths.absoluteVaultRoot,
    )
    await ensureConfigFile(paths, createdPaths)

    if (!(await fileExists(paths.inboxDbPath))) {
      createdPaths.push(relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath))
    }

    const runtime = await inboxd.openInboxRuntime({
      vaultRoot: paths.absoluteVaultRoot,
    })
    runtime.close()

    let rebuiltCaptures = 0
    if (input.rebuild) {
      rebuiltCaptures = await rebuildRuntime(paths, inboxd)
    }

    return {
      vault: paths.absoluteVaultRoot,
      runtimeDirectory: relativeToVault(
        paths.absoluteVaultRoot,
        paths.inboxRuntimeRoot,
      ),
      databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
      configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
      createdPaths,
      rebuiltCaptures,
    }
  }

  const setupInboxToolchain = async (
    input: SetupInput,
  ): Promise<InboxSetupResult> => {
    const paths = resolveRuntimePaths(input.vault)
    const inboxd = await loadInbox()
    const parsers = await requireParsers('inbox parser setup')

    await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

    const written = await parsers.writeParserToolchainConfig({
      vaultRoot: paths.absoluteVaultRoot,
      tools: {
        ...(input.ffmpegCommand
          ? {
              ffmpeg: {
                command: input.ffmpegCommand,
              },
            }
          : {}),
        ...(input.pdftotextCommand
          ? {
              pdftotext: {
                command: input.pdftotextCommand,
              },
            }
          : {}),
        ...(input.whisperCommand || input.whisperModelPath
          ? {
              whisper: {
                ...(input.whisperCommand
                  ? {
                      command: input.whisperCommand,
                    }
                  : {}),
                ...(input.whisperModelPath
                  ? {
                      modelPath: input.whisperModelPath,
                    }
                  : {}),
              },
            }
          : {}),
        ...(input.paddleocrCommand
          ? {
              paddleocr: {
                command: input.paddleocrCommand,
              },
            }
          : {}),
      },
    })
    const doctor = await parsers.discoverParserToolchain({
      vaultRoot: paths.absoluteVaultRoot,
    })
    const parserToolchain = toCliParserToolchain(paths.absoluteVaultRoot, doctor)

    return {
      vault: paths.absoluteVaultRoot,
      configPath: relativeToVault(paths.absoluteVaultRoot, written.configPath),
      updatedAt: written.config.updatedAt,
      tools: parserToolchain.tools,
    }
  }

  const bootstrapInboxRuntime = async (
    input: BootstrapInput,
  ): Promise<InboxBootstrapResult> => {
    const initResult = await initInboxRuntime(input)
    const setupResult = await setupInboxToolchain(input)
    const doctorResult = await buildDoctorResult({
      vault: input.vault,
      requestId: input.requestId,
      sourceId: null,
    })

    if (input.strict) {
      assertBootstrapStrictReady(doctorResult)
    }

    return {
      vault: initResult.vault,
      init: {
        runtimeDirectory: initResult.runtimeDirectory,
        databasePath: initResult.databasePath,
        configPath: initResult.configPath,
        createdPaths: initResult.createdPaths,
        rebuiltCaptures: initResult.rebuiltCaptures,
      },
      setup: {
        configPath: setupResult.configPath,
        updatedAt: setupResult.updatedAt,
        tools: setupResult.tools,
      },
      doctor: {
        configPath: doctorResult.configPath,
        databasePath: doctorResult.databasePath,
        target: doctorResult.target,
        ok: doctorResult.ok,
        checks: doctorResult.checks,
        connectors: doctorResult.connectors,
        parserToolchain: doctorResult.parserToolchain,
      },
    }
  }

  const toDoctorCheckList = (
    checks: InboxDoctorCheck | InboxDoctorCheck[],
  ): InboxDoctorCheck[] => (Array.isArray(checks) ? checks : [checks])

  const runDoctorCheck = async <TResult>(
    context: DoctorContext,
    input: {
      run: () => Promise<TResult>
      onSuccess: (result: TResult) => InboxDoctorCheck | InboxDoctorCheck[]
      onError: (error: unknown) => InboxDoctorCheck | InboxDoctorCheck[]
    },
  ): Promise<TResult | null> => {
    try {
      const result = await input.run()
      context.checks.push(...toDoctorCheckList(input.onSuccess(result)))
      return result
    } catch (error) {
      context.checks.push(...toDoctorCheckList(input.onError(error)))
      return null
    }
  }

  const finalizeDoctorResult = async (
    context: DoctorContext,
    connector: InboxConnectorConfig | null = null,
  ): Promise<InboxDoctorResult> => {
    const configPath = context.config
      ? relativeToVault(
          context.paths.absoluteVaultRoot,
          context.paths.inboxConfigPath,
        )
      : (await fileExists(context.paths.inboxConfigPath))
        ? relativeToVault(
            context.paths.absoluteVaultRoot,
            context.paths.inboxConfigPath,
          )
        : null

    return {
      vault: context.paths.absoluteVaultRoot,
      configPath,
      databasePath: context.databaseAvailable
        ? relativeToVault(
            context.paths.absoluteVaultRoot,
            context.paths.inboxDbPath,
          )
        : null,
      target: connector?.id ?? context.input.sourceId ?? null,
      ok: context.checks.every((check) => check.status !== 'fail'),
      checks: context.checks,
      connectors: context.config?.connectors ?? [],
      parserToolchain: context.parserToolchain,
    }
  }

  const runVaultDoctorCheck = async (
    context: DoctorContext,
  ): Promise<boolean> => {
    const result = await runDoctorCheck(context, {
      run: () => context.inboxd.ensureInboxVault(context.paths.absoluteVaultRoot),
      onSuccess: () => passCheck('vault', 'Vault metadata is readable.'),
      onError: (error) =>
        failCheck('vault', 'Vault metadata could not be read.', {
          error: errorMessage(error),
        }),
    })

    return result !== null
  }

  const runConfigDoctorCheck = async (context: DoctorContext): Promise<void> => {
    const config = await runDoctorCheck(context, {
      run: () => readConfig(context.paths),
      onSuccess: () =>
        passCheck('config', 'Inbox runtime config parsed successfully.'),
      onError: (error) =>
        failCheck('config', 'Inbox runtime config is missing or invalid.', {
          error: errorMessage(error),
        }),
    })

    context.config = config
  }

  const runRuntimeDbDoctorCheck = async (
    context: DoctorContext,
  ): Promise<void> => {
    const runtime = await runDoctorCheck(context, {
      run: async () => {
        const runtime = await context.inboxd.openInboxRuntime({
          vaultRoot: context.paths.absoluteVaultRoot,
        })
        runtime.close()
        return runtime
      },
      onSuccess: () =>
        passCheck('runtime-db', 'Inbox runtime SQLite opened successfully.'),
      onError: (error) =>
        failCheck('runtime-db', 'Inbox runtime SQLite could not be opened.', {
          error: errorMessage(error),
        }),
    })

    context.databaseAvailable = runtime !== null
  }

  const runParserToolchainDoctorCheck = async (
    context: DoctorContext,
  ): Promise<void> => {
    const doctor = await runDoctorCheck(context, {
      run: async () => {
        const parsers = await loadParsers()
        return parsers.discoverParserToolchain({
          vaultRoot: context.paths.absoluteVaultRoot,
        })
      },
      onSuccess: (doctor) => toParserToolChecks(doctor.tools),
      onError: (error) =>
        warnCheck(
          'parser-runtime',
          'Parser toolchain discovery is unavailable in this workspace.',
          {
            error: errorMessage(error),
          },
        ),
    })

    if (doctor) {
      context.parserToolchain = toCliParserToolchain(
        context.paths.absoluteVaultRoot,
        doctor,
      )
    }
  }

  const runBaselineDoctorChecks = async (
    context: DoctorContext,
  ): Promise<boolean> => {
    if (!(await runVaultDoctorCheck(context))) {
      return false
    }

    await runConfigDoctorCheck(context)
    await runRuntimeDbDoctorCheck(context)
    await runParserToolchainDoctorCheck(context)
    return true
  }

  const resolveDoctorTarget = (
    context: DoctorContext,
  ): DoctorTargetResolution => {
    if (!context.config) {
      return {
        kind: 'missing',
      }
    }

    if (!context.input.sourceId) {
      context.checks.push(
        context.config.connectors.length > 0
          ? passCheck(
              'connectors',
              `Configured ${context.config.connectors.length} inbox source${context.config.connectors.length === 1 ? '' : 's'}.`,
            )
          : warnCheck(
              'connectors',
              'No inbox sources are configured yet.',
            ),
      )

      return {
        kind: 'all',
      }
    }

    const connector = findConnector(context.config, context.input.sourceId)
    if (!connector) {
      context.checks.push(
        failCheck(
          'connector',
          `Inbox source "${context.input.sourceId}" is not configured.`,
        ),
      )
      return {
        kind: 'missing',
      }
    }

    context.checks.push(
      passCheck(
        'connector',
        `Connector "${connector.id}" is configured and ${connector.enabled ? 'enabled' : 'disabled'}.`,
        {
          source: connector.source,
          accountId: connector.accountId ?? null,
        },
      ),
    )

    return {
      kind: 'connector',
      connector,
    }
  }

  const runRuntimeRebuildDoctorCheck = async (
    context: DoctorContext,
  ): Promise<void> => {
    if (!context.databaseAvailable) {
      return
    }

    await runDoctorCheck(context, {
      run: () => rebuildRuntime(context.paths, context.inboxd),
      onSuccess: () =>
        passCheck(
          'rebuild',
          'Runtime rebuild from vault envelopes completed successfully.',
        ),
      onError: (error) =>
        failCheck(
          'rebuild',
          'Runtime rebuild from vault envelopes failed.',
          { error: errorMessage(error) },
        ),
    })
  }

  const runImessageDoctorChecks = async (
    context: DoctorContext,
    connector: InboxConnectorConfig,
  ): Promise<void> => {
    if (getPlatform() !== 'darwin') {
      context.checks.push(
        failCheck(
          'platform',
          'The iMessage connector requires macOS.',
          { platform: getPlatform() },
        ),
      )
    } else {
      context.checks.push(passCheck('platform', 'Running on macOS.'))
    }

    const driver = await runDoctorCheck(context, {
      run: () => loadConfiguredImessageDriver(connector),
      onSuccess: () =>
        passCheck('driver-import', 'The iMessage driver imported successfully.'),
      onError: (error) =>
        failCheck(
          'driver-import',
          'The iMessage driver could not be imported.',
          { error: errorMessage(error) },
        ),
    })

    await runDoctorCheck(context, {
      run: () => ensureConfiguredImessageReady(),
      onSuccess: () =>
        passCheck('messages-db', 'The local Messages database is readable.', {
          path: IMESSAGE_MESSAGES_DB_RELATIVE_PATH.replace(/\\/g, '/'),
        }),
      onError: (error) =>
        failCheck(
          'messages-db',
          'The local Messages database could not be accessed.',
          { error: errorMessage(error) },
        ),
    })

    if (!driver) {
      return
    }

    await runDoctorCheck(context, {
      run: async () => {
        const chats = (await driver.listChats?.()) ?? []
        const messages = await driver.getMessages({
          limit: 1,
          cursor: null,
          includeOwnMessages: connector.options.includeOwnMessages ?? true,
        })

        return {
          chats,
          messages,
        }
      },
      onSuccess: ({ chats, messages }) =>
        chats.length > 0 || messages.length > 0
          ? passCheck(
              'probe',
              'The connector can list chats or fetch messages.',
              {
                chats: chats.length,
                messages: messages.length,
              },
            )
          : warnCheck(
              'probe',
              'The connector responded but returned no chats or messages.',
            ),
      onError: (error) =>
        failCheck(
          'probe',
          'The connector could not fetch chats or messages.',
          { error: errorMessage(error) },
        ),
    })
  }

  const runTelegramDoctorChecks = async (
    context: DoctorContext,
    connector: InboxConnectorConfig,
  ): Promise<void> => {
    context.checks.push(
      passCheck('platform', 'Telegram long polling is platform-agnostic.'),
    )

    const env = getEnvironment()
    const token = resolveTelegramBotToken(env)
    const usesInjectedTelegramDriver = Boolean(dependencies.loadTelegramDriver)
    if (!token && !usesInjectedTelegramDriver) {
      context.checks.push(
        failCheck(
          'token',
          `Telegram bot token is missing from TELEGRAM_BOT_TOKEN. ${SETUP_RUNTIME_ENV_NOTICE}`,
        ),
      )
    } else if (usesInjectedTelegramDriver) {
      context.checks.push(
        passCheck(
          'token',
          'Telegram driver configuration is delegated to the integrating workspace.',
        ),
      )
    } else {
      context.checks.push(
        passCheck(
          'token',
          'Telegram bot token was found in the local environment.',
        ),
      )
    }

    const driver =
      token || usesInjectedTelegramDriver
        ? await runDoctorCheck(context, {
            run: () => loadConfiguredTelegramDriver(connector),
            onSuccess: () =>
              passCheck(
                'driver-import',
                'The Telegram poll driver initialized successfully.',
              ),
            onError: (error) =>
              failCheck(
                'driver-import',
                'The Telegram poll driver could not be initialized.',
                { error: errorMessage(error) },
              ),
          })
        : null

    if (!driver) {
      return
    }

    await runDoctorCheck(context, {
      run: () => driver.getMe(),
      onSuccess: (bot) =>
        passCheck('probe', 'The Telegram bot token authenticated successfully.', {
          bot:
            typeof bot === 'object' && bot !== null && 'username' in bot
              ? (bot as { username?: unknown }).username ?? null
              : null,
        }),
      onError: (error) =>
        failCheck(
          'probe',
          'The Telegram bot token could not authenticate with getMe.',
          { error: errorMessage(error) },
        ),
    })

    if (!driver.getWebhookInfo) {
      return
    }

    await runDoctorCheck(context, {
      run: () => driver.getWebhookInfo!(),
      onSuccess: (webhook) => {
        const url = normalizeNullableString(webhook?.url)

        return url
          ? warnCheck(
              'webhook',
              'Telegram currently has an active webhook; the local poll connector will delete it on start.',
              { url },
            )
          : passCheck(
              'webhook',
              'No Telegram webhook is configured; local polling can run safely.',
            )
      },
      onError: (error) =>
        warnCheck(
          'webhook',
          'Telegram webhook status could not be read.',
          { error: errorMessage(error) },
        ),
    })
  }

  const runEmailDoctorChecks = async (
    context: DoctorContext,
    connector: InboxConnectorConfig,
  ): Promise<void> => {
    context.checks.push(
      passCheck('platform', 'Email polling is platform-agnostic.'),
    )

    const env = getEnvironment()
    const apiKey = resolveAgentmailApiKey(env)
    const usesInjectedEmailDriver = Boolean(dependencies.loadEmailDriver)

    if (!connector.accountId) {
      context.checks.push(
        failCheck(
          'account',
          'Email connectors require an AgentMail inbox id as the connector account.',
        ),
      )
    } else {
      context.checks.push(
        passCheck('account', 'AgentMail inbox id is configured for the connector.', {
          inboxId: connector.accountId,
          emailAddress: connector.options.emailAddress ?? null,
        }),
      )
    }

    if (!apiKey && !usesInjectedEmailDriver) {
      context.checks.push(
        failCheck(
          'token',
          `AgentMail API key is missing from AGENTMAIL_API_KEY. ${SETUP_RUNTIME_ENV_NOTICE}`,
        ),
      )
    } else if (usesInjectedEmailDriver) {
      context.checks.push(
        passCheck(
          'token',
          'Email driver configuration is delegated to the integrating workspace.',
        ),
      )
    } else {
      context.checks.push(
        passCheck('token', 'AgentMail API key was found in the local environment.'),
      )
    }

    const driver =
      connector.accountId && (apiKey || usesInjectedEmailDriver)
        ? await runDoctorCheck(context, {
            run: () => loadConfiguredEmailDriver(connector),
            onSuccess: () =>
              passCheck(
                'driver-import',
                'The AgentMail poll driver initialized successfully.',
              ),
            onError: (error) =>
              failCheck(
                'driver-import',
                'The AgentMail poll driver could not be initialized.',
                { error: errorMessage(error) },
              ),
          })
        : null

    if (!driver) {
      return
    }

    await runDoctorCheck(context, {
      run: () =>
        driver.listUnreadMessages({
          limit: 1,
        }),
      onSuccess: (messages) =>
        messages.length > 0
          ? passCheck(
              'probe',
              'The AgentMail inbox responded and returned unread messages.',
              { messages: messages.length },
            )
          : warnCheck(
              'probe',
              'The AgentMail inbox responded but returned no unread messages.',
            ),
      onError: (error) =>
        failCheck(
          'probe',
          'The AgentMail inbox could not be queried for unread messages.',
          { error: errorMessage(error) },
        ),
    })
  }

  const runLinqDoctorChecks = async (
    context: DoctorContext,
    connector: InboxConnectorConfig,
  ): Promise<void> => {
    context.checks.push(
      passCheck('platform', 'Linq webhook delivery is platform-agnostic.'),
    )

    const env = getEnvironment()
    const token = resolveLinqApiToken(env)
    if (!token) {
      context.checks.push(
        failCheck(
          'token',
          `Linq API token is missing from LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN. ${SETUP_RUNTIME_ENV_NOTICE}`,
        ),
      )
    } else {
      context.checks.push(
        passCheck('token', 'Linq API token was found in the local environment.'),
      )
    }

    const webhookSecret = resolveLinqWebhookSecret(env)
    context.checks.push(
      webhookSecret
        ? passCheck(
            'webhook-secret',
            'A Linq webhook signing secret was found in the local environment.',
          )
        : warnCheck(
            'webhook-secret',
            'No Linq webhook signing secret is configured; unsigned webhooks will be accepted until LINQ_WEBHOOK_SECRET or HEALTHYBOB_LINQ_WEBHOOK_SECRET is set.',
          ),
    )

    context.checks.push(
      passCheck(
        'webhook-listener',
        'The Linq webhook listener is configured for local watch mode.',
        describeLinqConnectorEndpoint(connector),
      ),
    )

    if (!token) {
      return
    }

    await runDoctorCheck(context, {
      run: () => probeLinqApi({ env }),
      onSuccess: (probe) =>
        probe.phoneNumbers.length > 0
          ? passCheck('probe', 'The Linq API token authenticated successfully.', {
              phoneNumbers: probe.phoneNumbers,
            })
          : warnCheck(
              'probe',
              'The Linq API token authenticated, but no phone numbers were returned.',
            ),
      onError: (error) =>
        failCheck(
          'probe',
          'The Linq API token could not authenticate with /phonenumbers.',
          { error: errorMessage(error) },
        ),
    })
  }

  const buildDoctorResult = async (
    input: DoctorInput,
  ): Promise<InboxDoctorResult> => {
    const context: DoctorContext = {
      input,
      paths: resolveRuntimePaths(input.vault),
      inboxd: await loadInbox(),
      checks: [],
      config: null,
      databaseAvailable: false,
      parserToolchain: null,
    }

    if (!(await runBaselineDoctorChecks(context))) {
      return finalizeDoctorResult(context)
    }

    const target = resolveDoctorTarget(context)
    if (target.kind !== 'connector') {
      return finalizeDoctorResult(context)
    }

    await runRuntimeRebuildDoctorCheck(context)

    if (target.connector.source === 'imessage') {
      await runImessageDoctorChecks(context, target.connector)
    }

    if (target.connector.source === 'telegram') {
      await runTelegramDoctorChecks(context, target.connector)
    }

    if (target.connector.source === 'email') {
      await runEmailDoctorChecks(context, target.connector)
    }

    if (target.connector.source === 'linq') {
      await runLinqDoctorChecks(context, target.connector)
    }

    return finalizeDoctorResult(context, target.connector)
  }

  const withInboxRuntime = async <TResult>(
    input: CommandContext,
    fn: (input: {
      paths: InboxPaths
      runtime: RuntimeStore
    }) => Promise<TResult>,
  ): Promise<TResult> =>
    withInitializedInboxRuntime(loadInbox, input.vault, fn)

  const withInboxRuntimePromotions = async <TResult>(
    input: CommandContext,
    fn: (input: {
      paths: InboxPaths
      runtime: RuntimeStore
      promotionsByCapture: Awaited<ReturnType<typeof readPromotionsByCapture>>
    }) => Promise<TResult>,
  ): Promise<TResult> =>
    withInboxRuntime(input, async ({ paths, runtime }) =>
      fn({
        paths,
        runtime,
        promotionsByCapture: await readPromotionsByCapture(paths),
      }),
    )

  const withInboxRuntimeConfigPromotions = async <TResult>(
    input: CommandContext,
    fn: (input: {
      paths: InboxPaths
      runtime: RuntimeStore
      config: InboxRuntimeConfig
      promotionsByCapture: Awaited<ReturnType<typeof readPromotionsByCapture>>
    }) => Promise<TResult>,
  ): Promise<TResult> =>
    withInboxRuntime(input, async ({ paths, runtime }) => {
      const [config, promotionsByCapture] = await Promise.all([
        readConfig(paths),
        readPromotionsByCapture(paths),
      ])

      return fn({
        paths,
        runtime,
        config,
        promotionsByCapture,
      })
    })

  const requireInboxAttachmentMatch = (
    runtime: RuntimeStore,
    attachmentId: string,
  ) => requireAttachmentRecord(runtime, attachmentId)

  const requireParseableInboxAttachmentMatch = (
    runtime: RuntimeStore,
    attachmentId: string,
  ) => {
    const match = requireInboxAttachmentMatch(runtime, attachmentId)
    if (!isParseableAttachment(match.attachment)) {
      throw new VaultCliError(
        'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
        `Attachment "${attachmentId}" is not supported by the current runtime parse queue.`,
      )
    }

    return match
  }

  const buildInboxAttachmentStatus = (input: {
    runtime: RuntimeStore
    attachmentId: string
    listAttachmentParseJobs: NonNullable<RuntimeStore['listAttachmentParseJobs']>
    match: ReturnType<typeof requireInboxAttachmentMatch>
  }) =>
    buildAttachmentParseStatus({
      runtime: input.runtime,
      listAttachmentParseJobs: input.listAttachmentParseJobs,
      captureId: input.match.capture.captureId,
      attachmentId: input.attachmentId,
      fallbackAttachment: input.match.attachment,
    })

  return {
    async bootstrap(input) {
      return bootstrapInboxRuntime(input)
    },

    async init(input) {
      return initInboxRuntime(input)
    },

    async sourceAdd(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const config = await readConfig(paths)

      if (config.connectors.some((connector) => connector.id === input.id)) {
        throw new VaultCliError(
          'INBOX_SOURCE_EXISTS',
          `Inbox source "${input.id}" is already configured.`,
        )
      }

      let provisionedMailbox: InboxProvisionedMailbox | null = null
      let reusedMailbox: InboxProvisionedMailbox | null = null
      let accountId = normalizeConnectorAccountId(input.source, input.account)
      let emailAddress = normalizeNullableString(input.address)
      const linqWebhookHost = normalizeNullableString(input.linqWebhookHost)
      const linqWebhookPath = normalizeOptionalLinqWebhookPath(input.linqWebhookPath)
      const linqWebhookPort = normalizeOptionalLinqWebhookPort(input.linqWebhookPort)

      if (input.source === 'email') {
        if (input.provision) {
          const client = createConfiguredAgentmailClient()
          try {
            const inbox = await client.createInbox({
              displayName: normalizeNullableString(input.emailDisplayName),
              username: normalizeNullableString(input.emailUsername),
              domain: normalizeNullableString(input.emailDomain),
              clientId: normalizeNullableString(input.emailClientId),
            })
            provisionedMailbox = toProvisionedMailbox(inbox)
            accountId = inbox.inbox_id
            emailAddress = inbox.email
          } catch (error) {
            if (
              !matchesAgentmailHttpError(error, {
                status: 403,
                method: 'POST',
                path: '/inboxes',
              })
            ) {
              throw error
            }

            const recovered = await recoverForbiddenAgentmailProvision({
              preferredAccountId: accountId,
              preferredEmailAddress: emailAddress,
            })
            accountId = recovered.accountId
            emailAddress = recovered.emailAddress
            reusedMailbox = recovered.mailbox
          }
        }

        if (!accountId) {
          throw new VaultCliError(
            'INBOX_EMAIL_ACCOUNT_REQUIRED',
            'Email connectors require --account with an existing AgentMail inbox id, or --provision to create one.',
          )
        }

        emailAddress = await tryResolveAgentmailInboxAddress({
          accountId,
          emailAddress,
        })
      }

      if (input.source === 'linq') {
        const nextEndpoint = {
          host: linqWebhookHost ?? '0.0.0.0',
          path: linqWebhookPath ?? '/linq-webhook',
          port: linqWebhookPort ?? 8789,
        }
        const conflictingConnector = config.connectors.find((connector) => {
          if (connector.source !== 'linq') {
            return false
          }

          const endpoint = describeLinqConnectorEndpoint(connector)
          return (
            endpoint.host === nextEndpoint.host &&
            endpoint.path === nextEndpoint.path &&
            endpoint.port === nextEndpoint.port
          )
        })

        if (conflictingConnector) {
          throw new VaultCliError(
            'INBOX_LINQ_WEBHOOK_CONFLICT',
            `Linq webhook endpoint ${nextEndpoint.host}:${nextEndpoint.port}${nextEndpoint.path} is already assigned to connector "${conflictingConnector.id}".`,
          )
        }
      }

      const connector: InboxConnectorConfig = {
        id: input.id,
        source: input.source,
        enabled: true,
        accountId,
        options: {
          includeOwnMessages:
            input.source === 'imessage' ? input.includeOwn ?? undefined : undefined,
          backfillLimit: normalizeBackfillLimit(input.backfillLimit),
          emailAddress: input.source === 'email' ? emailAddress : undefined,
          linqWebhookHost: input.source === 'linq' ? linqWebhookHost ?? undefined : undefined,
          linqWebhookPath: input.source === 'linq' ? linqWebhookPath ?? undefined : undefined,
          linqWebhookPort: input.source === 'linq' ? linqWebhookPort ?? undefined : undefined,
        },
      }
      ensureConnectorNamespaceAvailable(config, connector)

      config.connectors.push(connector)
      sortConnectors(config)
      await writeConfig(paths, config)

      if (input.enableAutoReply) {
        await enableAssistantAutoReplyChannel(paths.absoluteVaultRoot, connector.source)
      }

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connector,
        connectorCount: config.connectors.length,
        provisionedMailbox,
        reusedMailbox,
        autoReplyEnabled: input.enableAutoReply ? true : undefined,
      }
    },

    async sourceList(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const config = await readConfig(paths)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connectors: config.connectors,
      }
    },

    async sourceRemove(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const config = await readConfig(paths)
      const index = config.connectors.findIndex(
        (connector) => connector.id === input.connectorId,
      )

      if (index === -1) {
        throw new VaultCliError(
          'INBOX_SOURCE_NOT_FOUND',
          `Inbox source "${input.connectorId}" is not configured.`,
        )
      }

      config.connectors.splice(index, 1)
      await writeConfig(paths, config)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        removed: true,
        connectorId: input.connectorId,
        connectorCount: config.connectors.length,
      }
    },

    async sourceSetEnabled(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const config = await readConfig(paths)
      const connector = config.connectors.find(
        (candidate) => candidate.id === input.connectorId,
      )

      if (!connector) {
        throw new VaultCliError(
          'INBOX_SOURCE_NOT_FOUND',
          `Inbox source "${input.connectorId}" is not configured.`,
        )
      }

      connector.enabled = input.enabled
      await writeConfig(paths, config)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connector,
        connectorCount: config.connectors.length,
      }
    },

    async doctor(input) {
      return buildDoctorResult(input)
    },

    async setup(input) {
      return setupInboxToolchain(input)
    },

    async parse(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const inboxd = await loadInbox()
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })

      try {
        const parserService = await createParserServiceContext(
          paths.absoluteVaultRoot,
          runtime,
          await requireParsers('inbox parser queue drains'),
        )
        const results = await parserService.drain({
          captureId: input.captureId ?? undefined,
          maxJobs: normalizeOptionalCommandLimit(input.limit, 200),
        })
        const summary = summarizeParserDrain(paths.absoluteVaultRoot, results)

        return {
          vault: paths.absoluteVaultRoot,
          ...summary,
        }
      } finally {
        runtime.close()
      }
    },

    async requeue(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const inboxd = await loadInbox()
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })

      try {
        const state = input.state ?? 'failed'
        const count = runtime.requeueAttachmentParseJobs?.({
          attachmentId: input.attachmentId ?? undefined,
          captureId: input.captureId ?? undefined,
          state,
        })

        return {
          vault: paths.absoluteVaultRoot,
          count: count ?? 0,
          filters: {
            ...(input.captureId ? { captureId: input.captureId } : {}),
            ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
            state,
          },
        }
      } finally {
        runtime.close()
      }
    },

    async backfill(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const inboxd = await loadInbox()
      const config = await readConfig(paths)
      const connectorConfig = requireConnector(config, input.sourceId)
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })
      const pipeline = await inboxd.createInboxPipeline({
        vaultRoot: paths.absoluteVaultRoot,
        runtime,
      })
      const parserService = input.parse
        ? await createParserServiceContext(
            paths.absoluteVaultRoot,
            runtime,
            await requireParsers('historical inbox backfill parsing'),
          )
        : null

      try {
        const connector = await instantiateConnector({
          connector: connectorConfig,
          inputLimit: input.limit,
          loadImessageDriver: loadConfiguredImessageDriver,
          loadTelegramDriver: loadConfiguredTelegramDriver,
          loadEmailDriver: loadConfiguredEmailDriver,
          linqWebhookSecret: resolveLinqWebhookSecret(getEnvironment()),
          ensureImessageReady: ensureConfiguredImessageReady,
          loadInbox,
        })
        let importedCount = 0
        let dedupedCount = 0
        let parseResults: ParserRuntimeDrainResult[] = []
        const cursorAccountId = runtimeNamespaceAccountId(connectorConfig)
        let cursor = runtime.getCursor(connector.source, cursorAccountId)

        const nextCursor = await connector.backfill?.(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await pipeline.processCapture(capture)
            if (persisted.deduped) {
              dedupedCount += 1
            } else {
              importedCount += 1
              if (parserService && persisted.captureId) {
                parseResults = parseResults.concat(
                  await parserService.drain({
                    captureId: persisted.captureId,
                  }),
                )
              }
            }
            cursor =
              checkpoint === undefined ? buildCaptureCursor(capture) : checkpoint ?? null
            runtime.setCursor(
              connector.source,
              cursorAccountId ?? capture.accountId ?? null,
              cursor,
            )
            return persisted
          },
        )

        runtime.setCursor(
          connector.source,
          cursorAccountId,
          nextCursor ?? cursor ?? null,
        )
        await connector.close?.()

        return {
          vault: paths.absoluteVaultRoot,
          sourceId: connectorConfig.id,
          importedCount,
          dedupedCount,
          cursor: runtime.getCursor(connector.source, cursorAccountId) ?? null,
          parse: parserService
            ? summarizeParserDrain(paths.absoluteVaultRoot, parseResults)
            : undefined,
        }
      } finally {
        pipeline.close()
      }
    },

    async run(input, options) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const inboxd = await loadInbox()
      const parsers = await requireParsers('inbox daemon parser integration')
      const config = await readConfig(paths)
      const enabledConnectors = config.connectors.filter(
        (connector) => connector.enabled,
      )

      if (enabledConnectors.length === 0) {
        throw new VaultCliError(
          'INBOX_NO_ENABLED_SOURCES',
          'No enabled inbox sources are configured. Add a source first.',
        )
      }

      const existingState = await normalizeDaemonState(
        paths,
        {
          clock,
          getPid,
          killProcess: dependencies.killProcess,
        },
      )
      if (existingState.running && existingState.pid !== getPid()) {
        throw new VaultCliError(
          'INBOX_ALREADY_RUNNING',
          'Inbox daemon state already reports a running process. If a prior foreground run was suspended with Ctrl+Z, resume it with `fg` and stop it with Ctrl+C, or run `healthybob inbox stop`.',
          { pid: existingState.pid },
        )
      }

      const configured = await parsers.createConfiguredParserRegistry({
        vaultRoot: paths.absoluteVaultRoot,
      })
      const connectors = await Promise.all(
        enabledConnectors.map((connector) =>
          instantiateConnector({
            connector,
            loadImessageDriver: loadConfiguredImessageDriver,
            loadTelegramDriver: loadConfiguredTelegramDriver,
            loadEmailDriver: loadConfiguredEmailDriver,
            linqWebhookSecret: resolveLinqWebhookSecret(getEnvironment()),
            ensureImessageReady: ensureConfiguredImessageReady,
            loadInbox,
          }),
        ),
      )
      const instrumentedConnectors = connectors.map((connector) =>
        instrumentConnectorForRunEvents(connector, options?.onEvent),
      )

      const connectorIds = enabledConnectors.map((connector) => connector.id)
      const startedAt = clock().toISOString()
      const signalBridge = options?.signal
        ? { cleanup: () => {}, signal: options.signal }
            : createProcessSignalBridge()
      const runSignal = signalBridge.signal
      const shouldReportSignal = runSignal.aborted === false

      await writeDaemonState(
        paths,
        buildDaemonState(paths, {
          running: true,
          pid: getPid(),
          startedAt,
          status: 'running',
          connectorIds,
        }),
      )

      let reason: InboxRunResult['reason'] = 'completed'

      try {
        const runtime = await inboxd.openInboxRuntime({
          vaultRoot: paths.absoluteVaultRoot,
        })
        await parsers.runInboxDaemonWithParsers({
          vaultRoot: paths.absoluteVaultRoot,
          runtime,
          registry: configured.registry,
          ffmpeg: configured.ffmpeg,
          connectors: instrumentedConnectors,
          signal: runSignal,
          continueOnConnectorFailure: true,
        })
      } catch (error) {
        reason = runSignal.aborted ? 'signal' : 'error'
        await writeDaemonState(
          paths,
          buildDaemonState(paths, {
            pid: getPid(),
            startedAt,
            stoppedAt: clock().toISOString(),
            status: 'failed',
            connectorIds,
            message: errorMessage(error),
          }),
        )
        throw error
      } finally {
        signalBridge.cleanup()
      }

      if (runSignal.aborted) {
        reason = 'signal'
      }

      const stoppedAt = clock().toISOString()
      await writeDaemonState(
        paths,
        buildDaemonState(paths, {
          pid: getPid(),
          startedAt,
          stoppedAt,
          status: 'stopped',
          connectorIds,
          message:
            reason === 'signal' && shouldReportSignal
              ? 'Inbox daemon stopped by signal.'
              : null,
        }),
      )

      return {
        vault: paths.absoluteVaultRoot,
        sourceIds: enabledConnectors.map((connector) => connector.id),
        startedAt,
        stoppedAt,
        reason,
        statePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxStatePath),
      }
    },

    async status(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      return normalizeDaemonState(paths, {
        clock,
        getPid,
        killProcess: dependencies.killProcess,
      })
    },

    async stop(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const state = await normalizeDaemonState(paths, {
        clock,
        getPid,
        killProcess: dependencies.killProcess,
      })

      if (!state.running || !state.pid) {
        throw new VaultCliError(
          'INBOX_NOT_RUNNING',
          'Inbox daemon is not currently running.',
        )
      }

      // A suspended foreground inbox/assistant loop will ignore SIGTERM until it
      // is resumed, so continue it first before requesting shutdown.
      tryKillProcess(killProcess, state.pid, 'SIGCONT')
      tryKillProcess(killProcess, state.pid, 'SIGTERM')

      const stoppedGracefully = await waitForDaemonStop(paths, {
        clock,
        getPid,
        killProcess: dependencies.killProcess,
        sleep,
      })
      if (stoppedGracefully) {
        return stoppedGracefully
      }

      // Some live assistant loops trap SIGTERM but never unwind their event
      // loop. Escalate once so the state can recover instead of timing out.
      tryKillProcess(killProcess, state.pid, 'SIGKILL')
      const stoppedForcefully = await waitForDaemonStop(paths, {
        attempts: 10,
        clock,
        getPid,
        killProcess: dependencies.killProcess,
        sleep,
      })
      if (stoppedForcefully) {
        return stoppedForcefully
      }

      throw new VaultCliError(
        'INBOX_STOP_TIMEOUT',
        'Inbox daemon did not stop within the expected timeout.',
        { pid: state.pid },
      )
    },

    async list(input) {
      return withInboxRuntimeConfigPromotions(
        input,
        async ({ paths, runtime, config, promotionsByCapture }) => {
          const sourceFilter = resolveSourceFilter(config, input.sourceId ?? null)
          const limit = normalizeLimit(input.limit, 50, 200)
          const afterOccurredAt = normalizeNullableString(input.afterOccurredAt)
          const afterCaptureId = normalizeNullableString(input.afterCaptureId)
          const oldestFirst = input.oldestFirst ?? false
          const items = runtime.listCaptures({
            source: sourceFilter?.source,
            accountId: sourceFilter?.accountId,
            limit,
            afterOccurredAt,
            afterCaptureId,
            oldestFirst,
          })

          return {
            vault: paths.absoluteVaultRoot,
            filters: {
              sourceId: input.sourceId ?? null,
              limit,
              afterOccurredAt,
              afterCaptureId,
              oldestFirst,
            },
            items: items.map((capture) =>
              summarizeCapture(capture, promotionsByCapture.get(capture.captureId) ?? []),
            ),
          }
        },
      )
    },

    async listAttachments(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const capture = requireCapture(runtime, input.captureId)
        return {
          vault: paths.absoluteVaultRoot,
          captureId: capture.captureId,
          attachmentCount: capture.attachments.length,
          attachments: capture.attachments.map(toCliAttachment),
        }
      })
    },

    async showAttachment(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const match = requireInboxAttachmentMatch(runtime, input.attachmentId)
        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachment: toCliAttachment(match.attachment),
        }
      })
    },

    async showAttachmentStatus(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const match = requireInboxAttachmentMatch(runtime, input.attachmentId)
        const listAttachmentParseJobs = requireAttachmentParseJobs(
          runtime,
          'show status',
        )
        const status = buildInboxAttachmentStatus({
          runtime,
          attachmentId: input.attachmentId,
          listAttachmentParseJobs,
          match,
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachmentId: input.attachmentId,
          parseable: isParseableAttachment(match.attachment),
          ...status,
        }
      })
    },

    async parseAttachment(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const listAttachmentParseJobs = requireAttachmentParseJobs(runtime, 'parse')
        const match = requireParseableInboxAttachmentMatch(
          runtime,
          input.attachmentId,
        )

        const parserService = await createParserServiceContext(
          paths.absoluteVaultRoot,
          runtime,
          await requireParsers('attachment-level inbox parser drains'),
        )
        const results = await parserService.drain({
          attachmentId: input.attachmentId,
          maxJobs: 1,
        })
        const summary = summarizeParserDrain(paths.absoluteVaultRoot, results)
        const status = buildInboxAttachmentStatus({
          runtime,
          attachmentId: input.attachmentId,
          listAttachmentParseJobs,
          match,
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachmentId: input.attachmentId,
          parseable: true,
          attempted: summary.attempted,
          succeeded: summary.succeeded,
          failed: summary.failed,
          ...status,
          results: summary.results,
        }
      })
    },

    async reparseAttachment(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const {
          listAttachmentParseJobs,
          requeueAttachmentParseJobs,
        } = requireAttachmentReparseSupport(runtime)
        const match = requireParseableInboxAttachmentMatch(
          runtime,
          input.attachmentId,
        )

        const existingJobs = listAttachmentParseJobs({
          attachmentId: input.attachmentId,
          limit: 20,
        })
        if (existingJobs.length === 0) {
          throw new VaultCliError(
            'INBOX_ATTACHMENT_PARSE_MISSING',
            `Attachment "${input.attachmentId}" does not have a runtime parse job to requeue.`,
          )
        }

        const requeuedJobs = requeueAttachmentParseJobs({
          attachmentId: input.attachmentId,
        })
        const status = buildInboxAttachmentStatus({
          runtime,
          attachmentId: input.attachmentId,
          listAttachmentParseJobs,
          match,
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachmentId: input.attachmentId,
          parseable: true,
          requeuedJobs,
          ...status,
        }
      })
    },

    async show(input) {
      return withInboxRuntimePromotions(
        input,
        async ({ paths, runtime, promotionsByCapture }) => {
          const capture = requireCapture(runtime, input.captureId)
          return {
            vault: paths.absoluteVaultRoot,
            capture: detailCapture(
              capture,
              promotionsByCapture.get(capture.captureId) ?? [],
            ),
          }
        },
      )
    },

    async search(input) {
      return withInboxRuntimeConfigPromotions(
        input,
        async ({ paths, runtime, config, promotionsByCapture }) => {
          const sourceFilter = resolveSourceFilter(config, input.sourceId ?? null)
          const limit = normalizeLimit(input.limit, 20, 200)
          const hits = runtime.searchCaptures({
            text: input.text,
            source: sourceFilter?.source,
            accountId: sourceFilter?.accountId,
            limit,
          })

          return {
            vault: paths.absoluteVaultRoot,
            filters: {
              text: input.text,
              sourceId: input.sourceId ?? null,
              limit,
            },
            hits: hits.map((hit) => ({
              captureId: hit.captureId,
              source: hit.source,
              accountId: hit.accountId ?? null,
              threadId: hit.threadId,
              threadTitle: hit.threadTitle ?? null,
              occurredAt: hit.occurredAt,
              text: hit.text,
              snippet: hit.snippet,
              score: hit.score,
              envelopePath: hit.envelopePath,
              promotions: promotionsByCapture.get(hit.captureId) ?? [],
            })),
          }
        },
      )
    },

    async promoteMeal(input) {
      return promoteCanonicalAttachmentImport({
        input,
        target: 'meal',
        clock,
        loadInbox,
        prepare: async () => ({
          core: await loadCore(),
        }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(isStoredImageAttachment),
        missingAttachmentError: () =>
          new VaultCliError(
            'INBOX_PROMOTION_REQUIRES_PHOTO',
            'Meal promotion requires an image attachment on the inbox capture.',
          ),
        canonicalPromotionSpec: mealCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({
          paths,
          capture,
          attachment,
        }) => {
          const audioAttachment = capture.attachments.find(isStoredAudioAttachment)
          return {
            photoSha256: await resolveAttachmentSha256(
              paths.absoluteVaultRoot,
              attachment,
            ),
            audioSha256:
              audioAttachment && typeof audioAttachment.storedPath === 'string'
                ? await resolveAttachmentSha256(
                    paths.absoluteVaultRoot,
                    audioAttachment,
                  )
                : null,
          }
        },
        createPromotion: async ({ paths, capture, prepared, attachment }) => {
          const audioAttachment = capture.attachments.find(isStoredAudioAttachment)
          const result = await prepared.core.addMeal({
            vaultRoot: paths.absoluteVaultRoot,
            occurredAt: capture.occurredAt,
            note: capture.text ?? undefined,
            photoPath: path.join(paths.absoluteVaultRoot, attachment.storedPath),
            audioPath:
              typeof audioAttachment?.storedPath === 'string'
                ? path.join(paths.absoluteVaultRoot, audioAttachment.storedPath)
                : undefined,
            source: 'import',
          })

          return {
            lookupId: result.event.id,
            relatedId: result.mealId,
          }
        },
      })
    },

    async promoteDocument(input) {
      return promoteCanonicalAttachmentImport({
        input,
        target: 'document',
        clock,
        loadInbox,
        prepare: async () => ({
          importers: (await loadImporters()).createImporters(),
        }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(isStoredDocumentAttachment),
        missingAttachmentError: () =>
          new VaultCliError(
            'INBOX_PROMOTION_REQUIRES_DOCUMENT',
            'Document promotion requires a stored document attachment on the inbox capture.',
          ),
        canonicalPromotionSpec: documentCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({
          paths,
          attachment,
        }) => {
          return {
            documentSha256: await resolveAttachmentSha256(
              paths.absoluteVaultRoot,
              attachment,
            ),
            title: normalizeNullableString(attachment.fileName),
          }
        },
        createPromotion: async ({ paths, capture, prepared, attachment }) => {
          const title = normalizeNullableString(attachment.fileName) ?? undefined
          const note = normalizeNullableString(capture.text) ?? undefined
          const result = await prepared.importers.importDocument({
            filePath: path.join(paths.absoluteVaultRoot, attachment.storedPath),
            vaultRoot: paths.absoluteVaultRoot,
            occurredAt: capture.occurredAt,
            title,
            note,
            source: 'import',
          })

          return {
            lookupId: result.event.id,
            relatedId: result.documentId,
          }
        },
      })
    },

    async promoteJournal(input) {
      if (!journalPromotionEnabled) {
        throw unsupportedPromotion('journal')
      }

      return withPromotionScope({
        input,
        target: 'journal',
        loadInbox,
        prepare: async () => ({
          core: requireJournalPromotionCore(await loadCore()),
        }),
        deriveBeforePromotionStore: ({ capture }) => {
          const journalDate = occurredDayFromCapture(capture)

          return {
            journalDate,
            lookupId: `journal:${journalDate}`,
          }
        },
        run: async ({
          paths,
          capture,
          prepared,
          derived,
          promotionStore,
          existing,
        }) => {
          if (
            existing &&
            ((existing.lookupId && existing.lookupId !== derived.lookupId) ||
              (existing.relatedId && existing.relatedId !== capture.eventId))
          ) {
            throw new VaultCliError(
              'INBOX_PROMOTION_STATE_INVALID',
              'Local journal promotion state does not match the deterministic canonical journal target.',
            )
          }

          let result: Awaited<ReturnType<typeof prepared.core.promoteInboxJournal>>
          try {
            result = await prepared.core.promoteInboxJournal({
              vaultRoot: paths.absoluteVaultRoot,
              date: derived.journalDate,
              capture,
            })
          } catch (error) {
            throw toVaultCliError(error)
          }

          await persistPromotionEntry({
            paths,
            promotionStore,
            captureId: input.captureId,
            target: 'journal',
            lookupId: derived.lookupId,
            promotedAt: clock().toISOString(),
            relatedId: capture.eventId,
            note: capture.text ?? null,
          })

          return {
            vault: paths.absoluteVaultRoot,
            captureId: input.captureId,
            target: 'journal',
            lookupId: derived.lookupId,
            relatedId: capture.eventId,
            journalPath: result.journalPath,
            created: result.created,
            appended: result.appended,
            linked: result.linked,
          }
        },
      })
    },

    async promoteExperimentNote(input) {
      return withPromotionScope({
        input,
        target: 'experiment-note',
        loadInbox,
        prepare: async () => ({
          core: requireExperimentPromotionCore(await loadCore()),
          query: await loadQuery(),
        }),
        deriveBeforePromotionStore: () => undefined,
        run: async ({
          paths,
          capture,
          prepared,
          promotionStore,
          existing,
        }) => {
          const experimentEntries = await readExperimentPromotionEntries(
            paths.absoluteVaultRoot,
            prepared.query,
          )
          const target = existing
            ? requireExperimentPromotionEntry(
                experimentEntries,
                existing.lookupId,
                existing.relatedId,
                capture,
              )
            : resolveExperimentPromotionTarget(experimentEntries)

          let result: Awaited<ReturnType<typeof prepared.core.promoteInboxExperimentNote>>
          try {
            result = await prepared.core.promoteInboxExperimentNote({
              vaultRoot: paths.absoluteVaultRoot,
              relativePath: target.relativePath,
              capture,
            })
          } catch (error) {
            throw toVaultCliError(error)
          }

          await persistPromotionEntry({
            paths,
            promotionStore,
            captureId: input.captureId,
            target: 'experiment-note',
            lookupId: result.experimentId,
            promotedAt: clock().toISOString(),
            relatedId: capture.eventId,
            note: capture.text ?? null,
          })

          return {
            vault: paths.absoluteVaultRoot,
            captureId: input.captureId,
            target: 'experiment-note',
            lookupId: result.experimentId,
            relatedId: capture.eventId,
            experimentPath: result.experimentPath,
            experimentSlug: result.experimentSlug,
            appended: result.appended,
          }
        },
      })
    },
  }
}

function tryKillProcess(
  killProcess: (pid: number, signal?: NodeJS.Signals | number) => void,
  pid: number,
  signal: NodeJS.Signals | number,
): void {
  try {
    killProcess(pid, signal)
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code ?? '')
        : ''

    if (code === 'ESRCH') {
      return
    }

    throw error
  }
}

async function waitForDaemonStop(
  paths: InboxPaths,
  input: {
    attempts?: number
    clock: () => Date
    getPid: () => number
    killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
    sleep: (ms: number) => Promise<void>
  },
): Promise<InboxDaemonState | null> {
  const attempts = input.attempts ?? 50

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await input.sleep(100)
    const nextState = await normalizeDaemonState(paths, {
      clock: input.clock,
      getPid: input.getPid,
      killProcess: input.killProcess,
    })
    if (!nextState.running) {
      return nextState
    }
  }

  return null
}

function unsupportedPromotion(target: 'journal' | 'experiment-note'): VaultCliError {
  return new VaultCliError(
    'INBOX_PROMOTION_UNSUPPORTED',
    `Canonical ${target} promotion is not available yet through a safe shared runtime boundary.`,
  )
}
