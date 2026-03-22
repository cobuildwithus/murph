import os from 'node:os'
import path from 'node:path'
import { resolveRuntimePaths, type RuntimePaths } from '@healthybob/runtime-state'
import { z } from 'incur'
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
import { VaultCliError } from './vault-cli-errors.js'
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
  createTelegramBotApiPollDriver(input: {
    token: string
    allowedUpdates?: string[] | null
    timeoutSeconds?: number
    batchSize?: number
    apiBaseUrl?: string
    fileBaseUrl?: string
  }): TelegramDriver
  loadImessageKitDriver(): Promise<ImessageDriver>
  rebuildRuntimeFromVault(input: {
    vaultRoot: string
    runtime: RuntimeStore
  }): Promise<void>
  runInboxDaemon(input: {
    pipeline: InboxPipeline
    connectors: PollConnector[]
    signal: AbortSignal
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
      source?: 'manual' | 'import' | 'device' | 'derived'
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
  }
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
  loadImportersModule?: () => Promise<ImportersRuntimeModule>
  loadInboxModule?: () => Promise<InboxRuntimeModule>
  loadParsersModule?: () => Promise<ParsersRuntimeModule>
  loadQueryModule?: () => Promise<QueryRuntimeModule>
  loadImessageDriver?: (config: InboxConnectorConfig) => Promise<ImessageDriver>
  loadTelegramDriver?: (config: InboxConnectorConfig) => Promise<TelegramDriver>
  probeImessageMessagesDb?: (targetPath: string) => Promise<void>
  getEnvironment?: () => NodeJS.ProcessEnv
}

interface SourceAddInput extends CommandContext {
  source: InboxConnectorConfig['source']
  id: string
  account?: string | null
  includeOwn?: boolean
  backfillLimit?: number
}

interface SourceRemoveInput extends CommandContext {
  connectorId: string
}

interface DoctorInput extends CommandContext {
  sourceId?: string | null
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
  doctor(input: DoctorInput): Promise<InboxDoctorResult>
  setup(input: SetupInput): Promise<InboxSetupResult>
  parse(input: ParseInput): Promise<InboxParseResult>
  requeue(input: RequeueInput): Promise<InboxRequeueResult>
  backfill(input: BackfillInput): Promise<InboxBackfillResult>
  run(
    input: CommandContext,
    options?: {
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
    (() => loadRuntimeModule<ImportersRuntimeModule>('@healthybob/importers'))
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
        'Telegram requires a bot token in HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN.',
      )
    }

    return inboxd.createTelegramBotApiPollDriver({
      token,
      apiBaseUrl: resolveTelegramApiBaseUrl(env) ?? undefined,
      fileBaseUrl: resolveTelegramFileBaseUrl(env) ?? undefined,
    })
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

  const buildDoctorResult = async (
    input: DoctorInput,
  ): Promise<InboxDoctorResult> => {
    const paths = resolveRuntimePaths(input.vault)
    const inboxd = await loadInbox()
    const checks: InboxDoctorCheck[] = []
    let config: InboxRuntimeConfig | null = null
    let databaseAvailable = false
    let parserToolchain: InboxParserToolchainStatus | null = null

    try {
      await inboxd.ensureInboxVault(paths.absoluteVaultRoot)
      checks.push(passCheck('vault', 'Vault metadata is readable.'))
    } catch (error) {
      checks.push(
        failCheck('vault', 'Vault metadata could not be read.', {
          error: errorMessage(error),
        }),
      )
      return {
        vault: paths.absoluteVaultRoot,
        configPath: null,
        databasePath: null,
        target: input.sourceId ?? null,
        ok: false,
        checks,
        connectors: [],
        parserToolchain: null,
      }
    }

    try {
      config = await readConfig(paths)
      checks.push(passCheck('config', 'Inbox runtime config parsed successfully.'))
    } catch (error) {
      checks.push(
        failCheck('config', 'Inbox runtime config is missing or invalid.', {
          error: errorMessage(error),
        }),
      )
    }

    try {
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })
      runtime.close()
      databaseAvailable = true
      checks.push(passCheck('runtime-db', 'Inbox runtime SQLite opened successfully.'))
    } catch (error) {
      checks.push(
        failCheck('runtime-db', 'Inbox runtime SQLite could not be opened.', {
          error: errorMessage(error),
        }),
      )
    }

    try {
      const parsers = await loadParsers()
      const doctor = await parsers.discoverParserToolchain({
        vaultRoot: paths.absoluteVaultRoot,
      })
      parserToolchain = toCliParserToolchain(paths.absoluteVaultRoot, doctor)
      checks.push(...toParserToolChecks(doctor.tools))
    } catch (error) {
      checks.push(
        warnCheck(
          'parser-runtime',
          'Parser toolchain discovery is unavailable in this workspace.',
          {
            error: errorMessage(error),
          },
        ),
      )
    }

    if (!config) {
      return {
        vault: paths.absoluteVaultRoot,
        configPath: (await fileExists(paths.inboxConfigPath))
          ? relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath)
          : null,
        databasePath: databaseAvailable
          ? relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath)
          : null,
        target: input.sourceId ?? null,
        ok: checks.every((check) => check.status !== 'fail'),
        checks,
        connectors: [],
        parserToolchain,
      }
    }

    if (!input.sourceId) {
      checks.push(
        config.connectors.length > 0
          ? passCheck(
              'connectors',
              `Configured ${config.connectors.length} inbox source${config.connectors.length === 1 ? '' : 's'}.`,
            )
          : warnCheck(
              'connectors',
              'No inbox sources are configured yet.',
            ),
      )

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        databasePath: databaseAvailable
          ? relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath)
          : null,
        target: null,
        ok: checks.every((check) => check.status !== 'fail'),
        checks,
        connectors: config.connectors,
        parserToolchain,
      }
    }

    const connector = findConnector(config, input.sourceId)
    if (!connector) {
      checks.push(
        failCheck(
          'connector',
          `Inbox source "${input.sourceId}" is not configured.`,
        ),
      )
      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        databasePath: databaseAvailable
          ? relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath)
          : null,
        target: input.sourceId,
        ok: false,
        checks,
        connectors: config.connectors,
        parserToolchain,
      }
    }

    checks.push(
      passCheck(
        'connector',
        `Connector "${connector.id}" is configured and ${connector.enabled ? 'enabled' : 'disabled'}.`,
        {
          source: connector.source,
          accountId: connector.accountId ?? null,
        },
      ),
    )

    if (databaseAvailable) {
      try {
        await rebuildRuntime(paths, inboxd)
        checks.push(
          passCheck(
            'rebuild',
            'Runtime rebuild from vault envelopes completed successfully.',
          ),
        )
      } catch (error) {
        checks.push(
          failCheck(
            'rebuild',
            'Runtime rebuild from vault envelopes failed.',
            { error: errorMessage(error) },
          ),
        )
      }
    }

    if (connector.source === 'imessage') {
      if (getPlatform() !== 'darwin') {
        checks.push(
          failCheck(
            'platform',
            'The iMessage connector requires macOS.',
            { platform: getPlatform() },
          ),
        )
      } else {
        checks.push(passCheck('platform', 'Running on macOS.'))
      }

      let driver: ImessageDriver | null = null
      try {
        driver = await loadConfiguredImessageDriver(connector)
        checks.push(passCheck('driver-import', 'The iMessage driver imported successfully.'))
      } catch (error) {
        checks.push(
          failCheck(
            'driver-import',
            'The iMessage driver could not be imported.',
            { error: errorMessage(error) },
          ),
        )
      }

      try {
        await ensureConfiguredImessageReady()
        checks.push(
          passCheck(
            'messages-db',
            'The local Messages database is readable.',
            {
              path: IMESSAGE_MESSAGES_DB_RELATIVE_PATH.replace(/\\/g, '/'),
            },
          ),
        )
      } catch (error) {
        checks.push(
          failCheck(
            'messages-db',
            'The local Messages database could not be accessed.',
            { error: errorMessage(error) },
          ),
        )
      }

      if (driver) {
        try {
          const chats = (await driver.listChats?.()) ?? []
          const messages = await driver.getMessages({
            limit: 1,
            cursor: null,
            includeOwnMessages:
              connector.options.includeOwnMessages ?? true,
          })

          if (chats.length > 0 || messages.length > 0) {
            checks.push(
              passCheck(
                'probe',
                'The connector can list chats or fetch messages.',
                {
                  chats: chats.length,
                  messages: messages.length,
                },
              ),
            )
          } else {
            checks.push(
              warnCheck(
                'probe',
                'The connector responded but returned no chats or messages.',
              ),
            )
          }
        } catch (error) {
          checks.push(
            failCheck(
              'probe',
              'The connector could not fetch chats or messages.',
              { error: errorMessage(error) },
            ),
          )
        }
      }
    }

    if (connector.source === 'telegram') {
      checks.push(passCheck('platform', 'Telegram long polling is platform-agnostic.'))

      const env = getEnvironment()
      const token = resolveTelegramBotToken(env)
      const usesInjectedTelegramDriver = Boolean(dependencies.loadTelegramDriver)
      if (!token && !usesInjectedTelegramDriver) {
        checks.push(
          failCheck(
            'token',
            'Telegram bot token is missing from HEALTHYBOB_TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_TOKEN.',
          ),
        )
      } else if (usesInjectedTelegramDriver) {
        checks.push(
          passCheck(
            'token',
            'Telegram driver configuration is delegated to the integrating workspace.',
          ),
        )
      } else {
        checks.push(
          passCheck('token', 'Telegram bot token was found in the local environment.'),
        )
      }

      let driver: TelegramDriver | null = null
      if (token || usesInjectedTelegramDriver) {
        try {
          driver = await loadConfiguredTelegramDriver(connector)
          checks.push(passCheck('driver-import', 'The Telegram poll driver initialized successfully.'))
        } catch (error) {
          checks.push(
            failCheck(
              'driver-import',
              'The Telegram poll driver could not be initialized.',
              { error: errorMessage(error) },
            ),
          )
        }
      }

      if (driver) {
        try {
          const bot = await driver.getMe()
          checks.push(
            passCheck('probe', 'The Telegram bot token authenticated successfully.', {
              bot: typeof bot === 'object' && bot !== null && 'username' in bot ? (bot as { username?: unknown }).username ?? null : null,
            }),
          )
        } catch (error) {
          checks.push(
            failCheck(
              'probe',
              'The Telegram bot token could not authenticate with getMe.',
              { error: errorMessage(error) },
            ),
          )
        }

        if (driver.getWebhookInfo) {
          try {
            const webhook = await driver.getWebhookInfo()
            const url = normalizeNullableString(webhook?.url)

            if (url) {
              checks.push(
                warnCheck(
                  'webhook',
                  'Telegram currently has an active webhook; the local poll connector will delete it on start.',
                  { url },
                ),
              )
            } else {
              checks.push(
                passCheck('webhook', 'No Telegram webhook is configured; local polling can run safely.'),
              )
            }
          } catch (error) {
            checks.push(
              warnCheck(
                'webhook',
                'Telegram webhook status could not be read.',
                { error: errorMessage(error) },
              ),
            )
          }
        }
      }
    }

    return {
      vault: paths.absoluteVaultRoot,
      configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
      databasePath: databaseAvailable
        ? relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath)
        : null,
      target: connector.id,
      ok: checks.every((check) => check.status !== 'fail'),
      checks,
      connectors: config.connectors,
      parserToolchain,
    }
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

      const connector: InboxConnectorConfig = {
        id: input.id,
        source: input.source,
        enabled: true,
        accountId: normalizeConnectorAccountId(input.source, input.account),
        options: {
          includeOwnMessages: input.includeOwn ?? undefined,
          backfillLimit: normalizeBackfillLimit(input.backfillLimit),
        },
      }
      ensureConnectorNamespaceAvailable(config, connector)

      config.connectors.push(connector)
      sortConnectors(config)
      await writeConfig(paths, config)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connector,
        connectorCount: config.connectors.length,
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
          'Inbox daemon state already reports a running process.',
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
            ensureImessageReady: ensureConfiguredImessageReady,
            loadInbox,
          }),
        ),
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
          connectors,
          signal: runSignal,
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

      killProcess(state.pid, 'SIGTERM')

      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100)
        const nextState = await normalizeDaemonState(
          paths,
          {
            clock,
            getPid,
            killProcess: dependencies.killProcess,
          },
        )
        if (!nextState.running) {
          return nextState
        }
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

function unsupportedPromotion(target: 'journal' | 'experiment-note'): VaultCliError {
  return new VaultCliError(
    'INBOX_PROMOTION_UNSUPPORTED',
    `Canonical ${target} promotion is not available yet through a safe shared runtime boundary.`,
  )
}
