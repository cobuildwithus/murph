import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { experimentFrontmatterSchema } from '@healthybob/contracts'
import { resolveRuntimePaths, type RuntimePaths } from '@healthybob/runtime-state'
import { z } from 'incur'
import { loadRuntimeModule } from './runtime-import.js'
import { VaultCliError } from './vault-cli-errors.js'
import {
  type InboxAttachmentListResult,
  type InboxAttachmentParseResult,
  type InboxAttachmentReparseResult,
  type InboxAttachmentShowResult,
  type InboxAttachmentStatusResult,
  inboxDaemonStateSchema,
  inboxDoctorCheckSchema,
  inboxPromotionStoreSchema,
  inboxRuntimeConfigSchema,
  type InboxBackfillResult,
  type InboxBootstrapResult,
  type InboxConnectorConfig,
  type InboxDaemonState,
  type InboxDoctorCheck,
  type InboxDoctorResult,
  type InboxInitResult,
  type InboxListResult,
  type InboxParseResult,
  type InboxParserToolStatus,
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

interface RuntimeAttachmentRecord {
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

function hasStoredPath(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { storedPath: string } {
  return typeof attachment.storedPath === 'string' && attachment.storedPath.length > 0
}

function isStoredImageAttachment(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { kind: 'image'; storedPath: string } {
  return attachment.kind === 'image' && hasStoredPath(attachment)
}

function isStoredAudioAttachment(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { kind: 'audio'; storedPath: string } {
  return attachment.kind === 'audio' && hasStoredPath(attachment)
}

function isStoredDocumentAttachment(
  attachment: RuntimeAttachmentRecord,
): attachment is RuntimeAttachmentRecord & { kind: 'document'; storedPath: string } {
  return attachment.kind === 'document' && hasStoredPath(attachment)
}

interface RuntimeCaptureRecord {
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

interface RuntimeSearchHit {
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

interface RuntimeAttachmentParseJobRecord {
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

type ExperimentFrontmatter = z.infer<typeof experimentFrontmatterSchema>
type PromotionStore = z.infer<typeof inboxPromotionStoreSchema>
type PromotionTarget = InboxPromotionEntry['target']
type CanonicalPromotionLookupTarget = Extract<PromotionTarget, 'meal' | 'document'>

interface CanonicalPromotionMatch {
  lookupId: string
  promotedAt: string
  relatedId: string
}

interface CanonicalPromotionManifest {
  importId: string
  importedAt: string
  source: string | null
  artifacts: Array<{
    role: string
    sha256: string
  }>
  provenance: Record<string, unknown>
}

interface CanonicalPromotionLookupSpec<
  TManifest extends CanonicalPromotionManifest,
  TContext,
> {
  target: CanonicalPromotionLookupTarget
  manifestDirectory: string
  manifestSchema: z.ZodType<TManifest>
  matchesManifest(manifest: TManifest, context: TContext): boolean
}

interface PromotionMarkdownTargetSpec<TContext> {
  sectionHeading: string
  sectionStartMarker: string
  sectionEndMarker: string
  blockHeading(capture: RuntimeCaptureRecord, context: TContext): string
  blockExtraLines?(
    capture: RuntimeCaptureRecord,
    context: TContext,
  ): string[]
}

type CanonicalAttachmentPromotionResult<
  TTarget extends CanonicalPromotionLookupTarget,
> = Extract<
  InboxPromoteMealResult | InboxPromoteDocumentResult,
  { target: TTarget }
>

interface RuntimeStore {
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

interface PersistedCapture {
  captureId?: string
  deduped: boolean
}

interface PollConnector {
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

interface RuntimeCaptureRecordInput {
  source: string
  externalId: string
  accountId?: string | null
  occurredAt: string
  receivedAt?: string | null
}

interface InboxPipeline {
  runtime: RuntimeStore
  processCapture(input: RuntimeCaptureRecordInput): Promise<PersistedCapture>
  close(): void
}

interface ImessageDriver {
  getMessages(input: {
    cursor?: Record<string, unknown> | null
    limit?: number
    includeOwnMessages?: boolean
  }): Promise<unknown[]>
  listChats?(): Promise<unknown[]>
}

interface TelegramDriver {
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

interface InboxRuntimeModule {
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

interface ParserToolRuntimeStatus {
  available: boolean
  command: string | null
  modelPath?: string | null
  source: 'config' | 'env' | 'system' | 'missing'
  reason: string
}

interface ParserDoctorRuntimeReport {
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

interface ConfiguredParserRegistryRuntime {
  doctor: ParserDoctorRuntimeReport
  registry: unknown
  ffmpeg?: {
    commandCandidates?: string[]
    allowSystemLookup?: boolean
  }
}

interface ParserRuntimeDrainResult {
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

interface InboxParserServiceRuntime {
  drain(input?: {
    attachmentId?: string
    captureId?: string
    maxJobs?: number
  }): Promise<ParserRuntimeDrainResult[]>
}

interface ParsersRuntimeModule {
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

interface ImportersRuntimeModule {
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

interface CoreRuntimeModule {
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
  ensureJournalDay?(input: {
    vaultRoot: string
    date: string
  }): Promise<{
    created: boolean
    relativePath: string
    auditPath?: string
  }>
  parseFrontmatterDocument?(documentText: string): {
    attributes: Record<string, unknown>
    body: string
  }
  stringifyFrontmatterDocument?(input: {
    attributes?: Record<string, unknown>
    body?: string
  }): string
  acquireCanonicalWriteLock?(vaultRoot: string): Promise<{
    release(): Promise<void>
  }>
}

interface MarkdownPromotionCore {
  parseFrontmatterDocument: NonNullable<
    CoreRuntimeModule['parseFrontmatterDocument']
  >
  stringifyFrontmatterDocument: NonNullable<
    CoreRuntimeModule['stringifyFrontmatterDocument']
  >
  acquireCanonicalWriteLock: NonNullable<
    CoreRuntimeModule['acquireCanonicalWriteLock']
  >
}

interface JournalPromotionCore extends MarkdownPromotionCore {
  ensureJournalDay: NonNullable<CoreRuntimeModule['ensureJournalDay']>
}

interface PromotionScope<TPrepared, TDerived> {
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

type InboxPaths = RuntimePaths

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
  loadImessageDriver?: (config: InboxConnectorConfig) => Promise<ImessageDriver>
  loadTelegramDriver?: (config: InboxConnectorConfig) => Promise<TelegramDriver>
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
const CONFIG_VERSION = 1
const PROMOTION_STORE_VERSION = 1
const RAW_MEALS_DIRECTORY = path.posix.join('raw', 'meals')
const RAW_DOCUMENTS_DIRECTORY = path.posix.join('raw', 'documents')
const JOURNAL_PROMOTION_SECTION_START = '<!-- inbox-promotions:start -->'
const JOURNAL_PROMOTION_SECTION_END = '<!-- inbox-promotions:end -->'
const EXPERIMENT_NOTE_SECTION_START = '<!-- inbox-experiment-notes:start -->'
const EXPERIMENT_NOTE_SECTION_END = '<!-- inbox-experiment-notes:end -->'

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
        await access(path.join(getHomeDirectory(), IMESSAGE_MESSAGES_DB_RELATIVE_PATH))
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
        dependencies,
        clock,
        getPid,
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
            loadInbox,
          }),
        ),
      )

      const startedAt = clock().toISOString()
      const signalBridge = options?.signal
        ? { cleanup: () => {}, signal: options.signal }
            : createProcessSignalBridge()
      const runSignal = signalBridge.signal
      const shouldReportSignal = runSignal.aborted === false

      await writeDaemonState(paths, {
        running: true,
        stale: false,
        pid: getPid(),
        startedAt,
        stoppedAt: null,
        status: 'running',
        connectorIds: enabledConnectors.map((connector) => connector.id),
        statePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxStatePath),
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
        message: null,
      })

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
        await writeDaemonState(paths, {
          running: false,
          stale: false,
          pid: getPid(),
          startedAt,
          stoppedAt: clock().toISOString(),
          status: 'failed',
          connectorIds: enabledConnectors.map((connector) => connector.id),
          statePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxStatePath),
          configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
          databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
          message: errorMessage(error),
        })
        throw error
      } finally {
        signalBridge.cleanup()
      }

      if (runSignal.aborted) {
        reason = 'signal'
      }

      const stoppedAt = clock().toISOString()
      await writeDaemonState(paths, {
        running: false,
        stale: false,
        pid: getPid(),
        startedAt,
        stoppedAt,
        status: 'stopped',
        connectorIds: enabledConnectors.map((connector) => connector.id),
        statePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxStatePath),
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
        message:
          reason === 'signal' && shouldReportSignal
            ? 'Inbox daemon stopped by signal.'
            : null,
      })

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
      return normalizeDaemonState(paths, dependencies, clock, getPid)
    },

    async stop(input) {
      const paths = await ensureInitialized(loadInbox, input.vault)
      const state = await normalizeDaemonState(paths, dependencies, clock, getPid)

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
          dependencies,
          clock,
          getPid,
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
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const config = await readConfig(paths)
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
          const promotionsByCapture = await readPromotionsByCapture(paths)

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
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const capture = requireCapture(runtime, input.captureId)
          return {
            vault: paths.absoluteVaultRoot,
            captureId: capture.captureId,
            attachmentCount: capture.attachments.length,
            attachments: capture.attachments.map(toCliAttachment),
          }
        },
      )
    },

    async showAttachment(input) {
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const match = requireAttachmentRecord(runtime, input.attachmentId)
          return {
            vault: paths.absoluteVaultRoot,
            captureId: match.capture.captureId,
            attachment: toCliAttachment(match.attachment),
          }
        },
      )
    },

    async showAttachmentStatus(input) {
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const listAttachmentParseJobs = requireAttachmentParseJobs(
            runtime,
            'show status',
          )
          const match = requireAttachmentRecord(runtime, input.attachmentId)
          const status = buildAttachmentParseStatus({
            runtime,
            listAttachmentParseJobs,
            captureId: match.capture.captureId,
            attachmentId: input.attachmentId,
            fallbackAttachment: match.attachment,
          })

          return {
            vault: paths.absoluteVaultRoot,
            captureId: match.capture.captureId,
            attachmentId: input.attachmentId,
            parseable: isParseableAttachment(match.attachment),
            ...status,
          }
        },
      )
    },

    async parseAttachment(input) {
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const listAttachmentParseJobs = requireAttachmentParseJobs(runtime, 'parse')
          const match = requireAttachmentRecord(runtime, input.attachmentId)
          if (!isParseableAttachment(match.attachment)) {
            throw new VaultCliError(
              'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
              `Attachment "${input.attachmentId}" is not supported by the current runtime parse queue.`,
            )
          }

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
          const status = buildAttachmentParseStatus({
            runtime,
            listAttachmentParseJobs,
            captureId: match.capture.captureId,
            attachmentId: input.attachmentId,
            fallbackAttachment: match.attachment,
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
        },
      )
    },

    async reparseAttachment(input) {
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const {
            listAttachmentParseJobs,
            requeueAttachmentParseJobs,
          } = requireAttachmentReparseSupport(runtime)
          const match = requireAttachmentRecord(runtime, input.attachmentId)
          if (!isParseableAttachment(match.attachment)) {
            throw new VaultCliError(
              'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
              `Attachment "${input.attachmentId}" is not supported by the current runtime parse queue.`,
            )
          }

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
          const status = buildAttachmentParseStatus({
            runtime,
            listAttachmentParseJobs,
            captureId: match.capture.captureId,
            attachmentId: input.attachmentId,
            fallbackAttachment: match.attachment,
          })

          return {
            vault: paths.absoluteVaultRoot,
            captureId: match.capture.captureId,
            attachmentId: input.attachmentId,
            parseable: true,
            requeuedJobs,
            ...status,
          }
        },
      )
    },

    async show(input) {
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const capture = requireCapture(runtime, input.captureId)
          const promotionsByCapture = await readPromotionsByCapture(paths)
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
      return withInitializedInboxRuntime(
        loadInbox,
        input.vault,
        async ({ paths, runtime }) => {
          const config = await readConfig(paths)
          const sourceFilter = resolveSourceFilter(config, input.sourceId ?? null)
          const limit = normalizeLimit(input.limit, 20, 200)
          const hits = runtime.searchCaptures({
            text: input.text,
            source: sourceFilter?.source,
            accountId: sourceFilter?.accountId,
            limit,
          })
          const promotionsByCapture = await readPromotionsByCapture(paths)

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
          core: await loadCore(),
        }),
        deriveBeforePromotionStore: ({ capture, prepared }) => {
          const promotionCore = requireJournalPromotionCore(prepared.core)
          const journalDate = occurredDayFromCapture(capture)

          return {
            journalDate,
            lookupId: `journal:${journalDate}`,
            promotionCore,
          }
        },
        run: async ({
          paths,
          capture,
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

          return withCanonicalWriteLock(
            derived.promotionCore,
            paths.absoluteVaultRoot,
            async () => {
              const ensured = await derived.promotionCore.ensureJournalDay({
                vaultRoot: paths.absoluteVaultRoot,
                date: derived.journalDate,
              })
              const journalUpdate = await updatePromotionMarkdownDocument({
                core: derived.promotionCore,
                absoluteVaultRoot: paths.absoluteVaultRoot,
                relativePath: ensured.relativePath,
                capture,
                spec: journalPromotionMarkdownSpec,
                resolveUpdate: ({ attributes }) => {
                  const currentEventIds = frontmatterStringArray(
                    attributes.eventIds,
                  )

                  return {
                    context: undefined,
                    resolved: {
                      currentEventIds,
                    },
                    nextAttributes: {
                      ...attributes,
                      eventIds: uniqueStrings([
                        ...currentEventIds,
                        capture.eventId,
                      ]),
                    },
                  }
                },
              })

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
                journalPath: ensured.relativePath,
                created: ensured.created,
                appended: journalUpdate.appended,
                linked: !journalUpdate.resolved.currentEventIds.includes(
                  capture.eventId,
                ),
              }
            },
          )
        },
      })
    },

    async promoteExperimentNote(input) {
      return withPromotionScope({
        input,
        target: 'experiment-note',
        loadInbox,
        prepare: async () => ({
          core: await loadCore(),
        }),
        deriveBeforePromotionStore: ({ prepared }) => ({
          promotionCore: requireExperimentPromotionCore(prepared.core),
        }),
        run: async ({
          paths,
          capture,
          derived,
          promotionStore,
          existing,
        }) => {
          const experimentEntries = await readExperimentEntries(
            paths.absoluteVaultRoot,
            derived.promotionCore,
          )
          const target = existing
            ? requireExperimentPromotionEntry(
                experimentEntries,
                existing.lookupId,
                existing.relatedId,
                capture,
              )
            : resolveExperimentPromotionTarget(experimentEntries)

          return withCanonicalWriteLock(
            derived.promotionCore,
            paths.absoluteVaultRoot,
            async () => {
              const experimentUpdate = await updatePromotionMarkdownDocument({
                core: derived.promotionCore,
                absoluteVaultRoot: paths.absoluteVaultRoot,
                relativePath: target.relativePath,
                capture,
                spec: experimentPromotionMarkdownSpec,
                resolveUpdate: ({ attributes }) => {
                  const experimentAttributes =
                    validateExperimentFrontmatter(attributes)

                  return {
                    context: {
                      experimentSlug: experimentAttributes.slug,
                    },
                    resolved: experimentAttributes,
                    nextAttributes: experimentAttributes,
                  }
                },
              })

              await persistPromotionEntry({
                paths,
                promotionStore,
                captureId: input.captureId,
                target: 'experiment-note',
                lookupId: experimentUpdate.resolved.experimentId,
                promotedAt: clock().toISOString(),
                relatedId: capture.eventId,
                note: capture.text ?? null,
              })

              return {
                vault: paths.absoluteVaultRoot,
                captureId: input.captureId,
                target: 'experiment-note',
                lookupId: experimentUpdate.resolved.experimentId,
                relatedId: capture.eventId,
                experimentPath: target.relativePath,
                experimentSlug: experimentUpdate.resolved.slug,
                appended: experimentUpdate.appended,
              }
            },
          )
        },
      })
    },
  }
}

async function ensureInitialized(
  loadInbox: () => Promise<InboxRuntimeModule>,
  vaultRoot: string,
): Promise<InboxPaths> {
  return ensureInitializedWithInbox(await loadInbox(), vaultRoot)
}

async function ensureInitializedWithInbox(
  inboxd: InboxRuntimeModule,
  vaultRoot: string,
): Promise<InboxPaths> {
  const paths = resolveRuntimePaths(vaultRoot)
  await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

  if (!(await fileExists(paths.inboxConfigPath))) {
    throw new VaultCliError(
      'INBOX_NOT_INITIALIZED',
      'Inbox runtime is not initialized. Run `vault-cli inbox init` first.',
    )
  }

  await readConfig(paths)
  return paths
}

async function withInitializedInboxRuntime<TResult>(
  loadInbox: () => Promise<InboxRuntimeModule>,
  vaultRoot: string,
  fn: (input: {
    paths: InboxPaths
    runtime: RuntimeStore
  }) => Promise<TResult>,
): Promise<TResult> {
  const inboxd = await loadInbox()
  const paths = await ensureInitializedWithInbox(inboxd, vaultRoot)
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    return await fn({ paths, runtime })
  } finally {
    runtime.close()
  }
}

async function ensureDirectory(
  absolutePath: string,
  createdPaths: string[],
  vaultRoot: string,
): Promise<void> {
  if (!(await fileExists(absolutePath))) {
    createdPaths.push(relativeToVault(vaultRoot, absolutePath))
  }
  await mkdir(absolutePath, { recursive: true })
}

async function ensureConfigFile(
  paths: InboxPaths,
  createdPaths: string[],
): Promise<void> {
  if (await fileExists(paths.inboxConfigPath)) {
    return
  }

  const emptyConfig: InboxRuntimeConfig = {
    version: CONFIG_VERSION,
    connectors: [],
  }
  await writeJsonFile(paths.inboxConfigPath, emptyConfig)
  createdPaths.push(relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath))
}

async function readConfig(paths: InboxPaths): Promise<InboxRuntimeConfig> {
  return readJsonWithSchema(
    paths.inboxConfigPath,
    inboxRuntimeConfigSchema,
    'INBOX_CONFIG_INVALID',
    'Inbox runtime config is invalid.',
  )
}

async function writeConfig(
  paths: InboxPaths,
  config: InboxRuntimeConfig,
): Promise<void> {
  await writeJsonFile(paths.inboxConfigPath, inboxRuntimeConfigSchema.parse(config))
}

async function rebuildRuntime(
  paths: InboxPaths,
  inboxd: InboxRuntimeModule,
): Promise<number> {
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    await inboxd.rebuildRuntimeFromVault({
      vaultRoot: paths.absoluteVaultRoot,
      runtime,
    })

    return countRuntimeCaptures(runtime)
  } finally {
    runtime.close()
  }
}

function sortConnectors(config: InboxRuntimeConfig): void {
  config.connectors.sort((left, right) => left.id.localeCompare(right.id))
}

function findConnector(
  config: InboxRuntimeConfig,
  sourceId: string,
): InboxConnectorConfig | null {
  return config.connectors.find((connector) => connector.id === sourceId) ?? null
}

function requireConnector(
  config: InboxRuntimeConfig,
  sourceId: string,
): InboxConnectorConfig {
  const connector = findConnector(config, sourceId)
  if (!connector) {
    throw new VaultCliError(
      'INBOX_SOURCE_NOT_FOUND',
      `Inbox source "${sourceId}" is not configured.`,
    )
  }

  return connector
}

function ensureConnectorNamespaceAvailable(
  config: InboxRuntimeConfig,
  candidate: InboxConnectorConfig,
): void {
  const namespace = connectorNamespaceKey(candidate)
  const conflict = config.connectors.find(
    (connector) => connectorNamespaceKey(connector) === namespace,
  )
  if (!conflict) {
    return
  }

  throw new VaultCliError(
    'INBOX_SOURCE_NAMESPACE_EXISTS',
    `Inbox source "${candidate.id}" aliases the same runtime namespace as "${conflict.id}".`,
    {
      accountId: candidate.accountId ?? null,
      source: candidate.source,
    },
  )
}

async function instantiateConnector(input: {
  connector: InboxConnectorConfig
  inputLimit?: number
  loadInbox: () => Promise<InboxRuntimeModule>
  loadImessageDriver: (config: InboxConnectorConfig) => Promise<ImessageDriver>
  loadTelegramDriver: (config: InboxConnectorConfig) => Promise<TelegramDriver>
}) {
  const inboxd = await input.loadInbox()

  switch (input.connector.source) {
    case 'imessage': {
      const driver = await input.loadImessageDriver(input.connector)
      return inboxd.createImessageConnector({
        driver,
        id: input.connector.id,
        accountId: input.connector.accountId ?? 'self',
        includeOwnMessages:
          input.connector.options.includeOwnMessages ?? true,
        backfillLimit:
          normalizeBackfillLimit(input.inputLimit) ??
          input.connector.options.backfillLimit ??
          500,
      })
    }
    case 'telegram': {
      const driver = await input.loadTelegramDriver(input.connector)
      return inboxd.createTelegramPollConnector({
        driver,
        id: input.connector.id,
        accountId: input.connector.accountId ?? 'bot',
        backfillLimit:
          normalizeBackfillLimit(input.inputLimit) ??
          input.connector.options.backfillLimit ??
          500,
        downloadAttachments: true,
        resetWebhookOnStart: true,
      })
    }
  }
}

function buildCaptureCursor(capture: {
  occurredAt: string
  externalId: string
  receivedAt?: string | null
}): Record<string, unknown> {
  return {
    occurredAt: capture.occurredAt,
    externalId: capture.externalId,
    receivedAt: capture.receivedAt ?? null,
  }
}

function summarizeCapture(capture: RuntimeCaptureRecord, promotions: InboxPromotionEntry[]) {
  return {
    captureId: capture.captureId,
    source: capture.source,
    accountId: capture.accountId ?? null,
    externalId: capture.externalId,
    threadId: capture.thread.id,
    threadTitle: capture.thread.title ?? null,
    actorId: capture.actor.id ?? null,
    actorName: capture.actor.displayName ?? null,
    actorIsSelf: capture.actor.isSelf,
    occurredAt: capture.occurredAt,
    receivedAt: capture.receivedAt ?? null,
    text: capture.text,
    attachmentCount: capture.attachments.length,
    envelopePath: capture.envelopePath,
    eventId: capture.eventId,
    promotions,
  }
}

function detailCapture(capture: RuntimeCaptureRecord, promotions: InboxPromotionEntry[]) {
  return {
    ...summarizeCapture(capture, promotions),
    createdAt: capture.createdAt,
    threadIsDirect: capture.thread.isDirect ?? false,
    attachments: capture.attachments.map(toCliAttachment),
    raw: capture.raw,
  }
}

function toCliAttachment(attachment: RuntimeAttachmentRecord) {
  return {
    attachmentId: attachment.attachmentId ?? null,
    ordinal: attachment.ordinal,
    externalId: attachment.externalId ?? null,
    kind: attachment.kind,
    mime: attachment.mime ?? null,
    originalPath: attachment.originalPath ?? null,
    storedPath: attachment.storedPath ?? null,
    fileName: attachment.fileName ?? null,
    byteSize: attachment.byteSize ?? null,
    sha256: attachment.sha256 ?? null,
    extractedText: attachment.extractedText ?? null,
    transcriptText: attachment.transcriptText ?? null,
    derivedPath: attachment.derivedPath ?? null,
    parserProviderId: attachment.parserProviderId ?? null,
    parseState: attachment.parseState ?? null,
  }
}

function toCliAttachmentParseJob(job: RuntimeAttachmentParseJobRecord) {
  return {
    jobId: job.jobId,
    captureId: job.captureId,
    attachmentId: job.attachmentId,
    pipeline: job.pipeline,
    state: job.state,
    attempts: job.attempts,
    providerId: job.providerId ?? null,
    resultPath: job.resultPath ?? null,
    errorCode: job.errorCode ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  }
}

function requireCapture(
  runtime: RuntimeStore,
  captureId: string,
): RuntimeCaptureRecord {
  const capture = runtime.getCapture(captureId)
  if (!capture) {
    throw new VaultCliError(
      'INBOX_CAPTURE_NOT_FOUND',
      `Inbox capture "${captureId}" was not found.`,
    )
  }

  return capture
}

function requireAttachmentRecord(
  runtime: RuntimeStore,
  attachmentId: string,
): {
  capture: RuntimeCaptureRecord
  attachment: RuntimeAttachmentRecord
} {
  for (const capture of listAllCaptures(runtime)) {
    const detailedCapture = runtime.getCapture(capture.captureId) ?? capture
    const attachment = detailedCapture.attachments.find(
      (candidate) => candidate.attachmentId === attachmentId,
    )
    if (attachment) {
      return {
        capture: detailedCapture,
        attachment,
      }
    }
  }

  throw new VaultCliError(
    'INBOX_ATTACHMENT_NOT_FOUND',
    `Inbox attachment "${attachmentId}" was not found.`,
  )
}

function requireAttachmentParseJobs(
  runtime: RuntimeStore,
  action: 'show status' | 'parse' | 'reparse',
): NonNullable<RuntimeStore['listAttachmentParseJobs']> {
  if (!runtime.listAttachmentParseJobs) {
    throw unsupportedAttachmentParse(action)
  }

  return runtime.listAttachmentParseJobs
}

function requireAttachmentReparseSupport(
  runtime: RuntimeStore,
): {
  listAttachmentParseJobs: NonNullable<RuntimeStore['listAttachmentParseJobs']>
  requeueAttachmentParseJobs: NonNullable<RuntimeStore['requeueAttachmentParseJobs']>
} {
  if (!runtime.listAttachmentParseJobs || !runtime.requeueAttachmentParseJobs) {
    throw unsupportedAttachmentParse('reparse')
  }

  return {
    listAttachmentParseJobs: runtime.listAttachmentParseJobs,
    requeueAttachmentParseJobs: runtime.requeueAttachmentParseJobs,
  }
}

function refreshAttachmentForCapture(
  runtime: RuntimeStore,
  captureId: string,
  attachmentId: string,
  fallbackAttachment: RuntimeAttachmentRecord,
): RuntimeAttachmentRecord {
  return (
    runtime
      .getCapture(captureId)
      ?.attachments.find(
        (attachment) => attachment.attachmentId === attachmentId,
      ) ?? fallbackAttachment
  )
}

function buildAttachmentParseStatus(input: {
  runtime: RuntimeStore
  listAttachmentParseJobs: NonNullable<RuntimeStore['listAttachmentParseJobs']>
  captureId: string
  attachmentId: string
  fallbackAttachment: RuntimeAttachmentRecord
}) {
  const jobs = input.listAttachmentParseJobs({
    attachmentId: input.attachmentId,
    limit: 20,
  })
  const attachment = refreshAttachmentForCapture(
    input.runtime,
    input.captureId,
    input.attachmentId,
    input.fallbackAttachment,
  )

  return {
    currentState: resolveAttachmentParseState(attachment, jobs),
    jobs: jobs.map(toCliAttachmentParseJob),
  }
}

function resolveSourceFilter(
  config: InboxRuntimeConfig,
  sourceId: string | null,
): { source: string; accountId: string | null } | null {
  if (!sourceId) {
    return null
  }

  const connector = requireConnector(config, sourceId)
  return {
    source: connector.source,
    accountId: runtimeNamespaceAccountId(connector),
  }
}

async function readPromotionsByCapture(
  paths: InboxPaths,
): Promise<Map<string, InboxPromotionEntry[]>> {
  const store = await readPromotionStore(paths)
  const byCapture = new Map<string, InboxPromotionEntry[]>()

  for (const entry of store.entries) {
    const entries = byCapture.get(entry.captureId) ?? []
    entries.push(entry)
    byCapture.set(entry.captureId, entries)
  }

  return byCapture
}

async function readPromotionStore(
  paths: InboxPaths,
): Promise<PromotionStore> {
  if (!(await fileExists(paths.inboxPromotionsPath))) {
    return {
      version: PROMOTION_STORE_VERSION,
      entries: [],
    } satisfies PromotionStore
  }

  return readJsonWithSchema(
    paths.inboxPromotionsPath,
    inboxPromotionStoreSchema,
    'INBOX_PROMOTIONS_INVALID',
    'Inbox promotion state is invalid.',
  )
}

async function writePromotionStore(
  paths: InboxPaths,
  store: PromotionStore,
): Promise<void> {
  await writeJsonFile(
    paths.inboxPromotionsPath,
    inboxPromotionStoreSchema.parse(store),
  )
}

function findAppliedPromotionEntry(
  store: PromotionStore,
  captureId: string,
  target: PromotionTarget,
): InboxPromotionEntry | undefined {
  return store.entries.find(
    (entry) =>
      entry.captureId === captureId &&
      entry.target === target &&
      entry.status === 'applied',
  )
}

function assertCanonicalPromotionStateMatches(
  existing: InboxPromotionEntry | undefined,
  canonicalPromotion: CanonicalPromotionMatch,
  target: CanonicalPromotionLookupTarget,
): void {
  if (
    existing &&
    existing.lookupId &&
    existing.relatedId &&
    (existing.lookupId !== canonicalPromotion.lookupId ||
      existing.relatedId !== canonicalPromotion.relatedId)
  ) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      `Local ${target} promotion state does not match the canonical vault record.`,
    )
  }
}

function throwMissingCanonicalPromotionState(
  existing: InboxPromotionEntry,
  target: CanonicalPromotionLookupTarget,
): never {
  if (!existing.lookupId || !existing.relatedId) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      `Stored ${target} promotion state is missing canonical ids.`,
    )
  }

  throw new VaultCliError(
    'INBOX_PROMOTION_CANONICAL_MISSING',
    `Local ${target} promotion state exists, but no canonical ${target} record could be verified.`,
  )
}

async function findCanonicalPromotionMatch<
  TManifest extends CanonicalPromotionManifest,
  TContext,
>(input: {
  capture: RuntimeCaptureRecord
  absoluteVaultRoot: string
  context: TContext
  spec: CanonicalPromotionLookupSpec<TManifest, TContext>
}): Promise<CanonicalPromotionMatch | null> {
  const note = normalizeNullableString(input.capture.text)
  const matches = (
    await Promise.all(
      (
        await listCanonicalManifestPaths(
          input.absoluteVaultRoot,
          input.spec.manifestDirectory,
        )
      ).map(
        async (manifestPath) => {
          const manifest = await readCanonicalManifest(
            input.absoluteVaultRoot,
            manifestPath,
            input.spec.manifestSchema,
          )
          if (!manifest) {
            return null
          }

          if (!input.spec.matchesManifest(manifest, input.context)) {
            return null
          }
          if (normalizeNullableString(manifest.source) !== 'import') {
            return null
          }

          const occurredAt = extractCanonicalString(
            manifest.provenance,
            'occurredAt',
          )
          if (occurredAt !== input.capture.occurredAt) {
            return null
          }

          if (
            normalizeNullableString(extractCanonicalString(manifest.provenance, 'note')) !==
            note
          ) {
            return null
          }

          const lookupId =
            normalizeNullableString(
              extractCanonicalString(manifest.provenance, 'lookupId'),
            ) ??
            normalizeNullableString(
              extractCanonicalString(manifest.provenance, 'eventId'),
            )
          if (!lookupId) {
            return null
          }

          return {
            lookupId,
            promotedAt: manifest.importedAt,
            relatedId: manifest.importId,
          }
        },
      ),
    )
  ).filter(
    (
      match,
    ): match is CanonicalPromotionMatch => match !== null,
  )

  if (matches.length === 0) {
    return null
  }

  if (matches.length > 1) {
    throw new VaultCliError(
      'INBOX_PROMOTION_DUPLICATE_CANONICAL',
      `Multiple canonical ${input.spec.target} records match this inbox capture.`,
      {
        captureId: input.capture.captureId,
        relatedIds: matches.map((match) => match.relatedId),
      },
    )
  }

  return matches[0]
}

function upsertPromotionEntry(
  store: PromotionStore,
  input: {
    captureId: string
    target: PromotionTarget
    lookupId: string
    note: string | null
    promotedAt: string
    relatedId: string
  },
): void {
  const existingIndex = store.entries.findIndex(
    (entry) => entry.captureId === input.captureId && entry.target === input.target,
  )
  const nextEntry = {
    captureId: input.captureId,
    target: input.target,
    status: 'applied',
    promotedAt: input.promotedAt,
    lookupId: input.lookupId,
    relatedId: input.relatedId,
    note: input.note,
  } satisfies InboxPromotionEntry

  if (existingIndex === -1) {
    store.entries.push(nextEntry)
    return
  }

  store.entries[existingIndex] = nextEntry
}

function requirePromotionCapture(
  runtime: RuntimeStore,
  captureId: string,
): RuntimeCaptureRecord {
  const capture = runtime.getCapture(captureId)
  if (!capture) {
    throw new VaultCliError(
      'INBOX_CAPTURE_NOT_FOUND',
      `Inbox capture "${captureId}" was not found.`,
    )
  }

  return capture
}

async function persistPromotionEntry(input: {
  paths: InboxPaths
  promotionStore: PromotionStore
  captureId: string
  target: PromotionTarget
  lookupId: string
  promotedAt: string
  relatedId: string
  note: string | null
}): Promise<void> {
  upsertPromotionEntry(input.promotionStore, {
    captureId: input.captureId,
    target: input.target,
    lookupId: input.lookupId,
    note: input.note,
    promotedAt: input.promotedAt,
    relatedId: input.relatedId,
  })
  await writePromotionStore(input.paths, input.promotionStore)
}

async function reconcileCanonicalImportPromotion(input: {
  paths: InboxPaths
  promotionStore: PromotionStore
  existing: InboxPromotionEntry | undefined
  capture: RuntimeCaptureRecord
  clock: () => Date
  target: CanonicalPromotionLookupTarget
  canonicalPromotion: CanonicalPromotionMatch | null
  createPromotion(): Promise<{
    lookupId: string
    relatedId: string
  }>
}): Promise<{
  lookupId: string
  relatedId: string
  created: boolean
}> {
  if (input.canonicalPromotion) {
    assertCanonicalPromotionStateMatches(
      input.existing,
      input.canonicalPromotion,
      input.target,
    )
    await persistPromotionEntry({
      paths: input.paths,
      promotionStore: input.promotionStore,
      captureId: input.capture.captureId,
      target: input.target,
      lookupId: input.canonicalPromotion.lookupId,
      promotedAt: input.canonicalPromotion.promotedAt,
      relatedId: input.canonicalPromotion.relatedId,
      note: input.capture.text ?? null,
    })

    return {
      lookupId: input.canonicalPromotion.lookupId,
      relatedId: input.canonicalPromotion.relatedId,
      created: false,
    }
  }

  if (input.existing) {
    throwMissingCanonicalPromotionState(input.existing, input.target)
  }

  const createdPromotion = await input.createPromotion()
  await persistPromotionEntry({
    paths: input.paths,
    promotionStore: input.promotionStore,
    captureId: input.capture.captureId,
    target: input.target,
    lookupId: createdPromotion.lookupId,
    promotedAt: input.clock().toISOString(),
    relatedId: createdPromotion.relatedId,
    note: input.capture.text ?? null,
  })

  return {
    lookupId: createdPromotion.lookupId,
    relatedId: createdPromotion.relatedId,
    created: true,
  }
}

async function withPromotionScope<TPrepared, TDerived, TResult>(input: {
  input: PromoteInput
  target: PromotionTarget
  loadInbox: () => Promise<InboxRuntimeModule>
  prepare(paths: InboxPaths): Promise<TPrepared>
  deriveBeforePromotionStore(input: {
    paths: InboxPaths
    capture: RuntimeCaptureRecord
    prepared: TPrepared
  }): Promise<TDerived> | TDerived
  run(scope: PromotionScope<TPrepared, TDerived>): Promise<TResult>
}): Promise<TResult> {
  const paths = await ensureInitialized(input.loadInbox, input.input.vault)
  const inboxd = await input.loadInbox()
  const prepared = await input.prepare(paths)
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    const capture = requirePromotionCapture(runtime, input.input.captureId)
    const derived = await input.deriveBeforePromotionStore({
      paths,
      capture,
      prepared,
    })
    const promotionStore = await readPromotionStore(paths)
    const existing = findAppliedPromotionEntry(
      promotionStore,
      input.input.captureId,
      input.target,
    )

    return input.run({
      input: input.input,
      paths,
      capture,
      prepared,
      derived,
      promotionStore,
      existing,
    })
  } finally {
    runtime.close()
  }
}

async function promoteCanonicalAttachmentImport<
  TPrepared,
  TAttachment extends RuntimeAttachmentRecord & { storedPath: string },
  TManifest extends CanonicalPromotionManifest,
  TContext,
  TTarget extends CanonicalPromotionLookupTarget,
>(input: {
  input: PromoteInput
  target: TTarget
  clock: () => Date
  loadInbox: () => Promise<InboxRuntimeModule>
  prepare(paths: InboxPaths): Promise<TPrepared>
  findRequiredAttachment(
    capture: RuntimeCaptureRecord,
  ): TAttachment | undefined
  missingAttachmentError(): VaultCliError
  canonicalPromotionSpec: CanonicalPromotionLookupSpec<TManifest, TContext>
  buildCanonicalMatchContext(input: {
    paths: InboxPaths
    capture: RuntimeCaptureRecord
    prepared: TPrepared
    attachment: TAttachment
  }): Promise<TContext> | TContext
  createPromotion(input: {
    paths: InboxPaths
    capture: RuntimeCaptureRecord
    prepared: TPrepared
    attachment: TAttachment
  }): Promise<{
    lookupId: string
    relatedId: string
  }>
}): Promise<CanonicalAttachmentPromotionResult<TTarget>> {
  return withPromotionScope<TPrepared, undefined, CanonicalAttachmentPromotionResult<TTarget>>(
    {
      input: input.input,
      target: input.target,
      loadInbox: input.loadInbox,
      prepare: input.prepare,
      deriveBeforePromotionStore: () => undefined,
      run: async ({
        paths,
        capture,
        prepared,
        promotionStore,
        existing,
      }) => {
        const attachment = input.findRequiredAttachment(capture)
        if (!attachment) {
          throw input.missingAttachmentError()
        }

        const canonicalPromotion = await findCanonicalPromotionMatch({
          capture,
          absoluteVaultRoot: paths.absoluteVaultRoot,
          spec: input.canonicalPromotionSpec,
          context: await input.buildCanonicalMatchContext({
            paths,
            capture,
            prepared,
            attachment,
          }),
        })
        const promotion = await reconcileCanonicalImportPromotion({
          paths,
          promotionStore,
          existing,
          capture,
          clock: input.clock,
          target: input.target,
          canonicalPromotion,
          createPromotion: () =>
            input.createPromotion({
              paths,
              capture,
              prepared,
              attachment,
            }),
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: input.input.captureId,
          target: input.target,
          lookupId: promotion.lookupId,
          relatedId: promotion.relatedId,
          created: promotion.created,
        } as CanonicalAttachmentPromotionResult<TTarget>
      },
    },
  )
}

async function withCanonicalWriteLock<TResult>(
  core: Pick<MarkdownPromotionCore, 'acquireCanonicalWriteLock'>,
  vaultRoot: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const lock = await core.acquireCanonicalWriteLock(vaultRoot)

  try {
    return await run()
  } finally {
    await lock.release()
  }
}

async function normalizeDaemonState(
  paths: InboxPaths,
  dependencies: InboxServicesDependencies,
  clock: () => Date,
  getPid: () => number,
): Promise<InboxDaemonState> {
  if (!(await fileExists(paths.inboxStatePath))) {
    return idleState(paths)
  }

  const state = await readJsonWithSchema(
    paths.inboxStatePath,
    inboxDaemonStateSchema,
    'INBOX_STATE_INVALID',
    'Inbox daemon state is invalid.',
  )

  if (!state.running || !state.pid) {
    return state
  }

  if (state.pid === getPid()) {
    return state
  }

  if (isProcessAlive(state.pid, dependencies.killProcess)) {
    return state
  }

  const staleState: InboxDaemonState = {
    ...state,
    running: false,
    stale: true,
    status: 'stale',
    stoppedAt: state.stoppedAt ?? clock().toISOString(),
    message: 'Stale daemon state found; recorded PID is no longer running.',
  }
  await writeDaemonState(paths, staleState)
  return staleState
}

function idleState(paths: InboxPaths): InboxDaemonState {
  return {
    running: false,
    stale: false,
    pid: null,
    startedAt: null,
    stoppedAt: null,
    status: 'idle',
    connectorIds: [],
    statePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxStatePath),
    configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
    databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
    message: null,
  }
}

async function writeDaemonState(
  paths: InboxPaths,
  state: InboxDaemonState,
): Promise<void> {
  await writeJsonFile(paths.inboxStatePath, inboxDaemonStateSchema.parse(state))
}

function isProcessAlive(
  pid: number,
  killProcess: InboxServicesDependencies['killProcess'],
): boolean {
  try {
    if (!killProcess) {
      process.kill(pid, 0)
    } else {
      killProcess(pid, 0)
    }
    return true
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code ?? '')
        : ''
    return code !== 'ESRCH'
  }
}

function createProcessSignalBridge(): {
  cleanup(): void
  signal: AbortSignal
} {
  const controller = new AbortController()
  const abort = () => {
    controller.abort()
    cleanup()
  }
  const cleanup = () => {
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
  }

  process.on('SIGINT', abort)
  process.on('SIGTERM', abort)
  return {
    cleanup,
    signal: controller.signal,
  }
}

async function readJsonWithSchema<T>(
  absolutePath: string,
  schema: z.ZodType<T>,
  code: string,
  message: string,
): Promise<T> {
  try {
    const raw = await readFile(absolutePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return schema.parse(parsed)
  } catch (error) {
    throw new VaultCliError(code, message, { error: errorMessage(error) })
  }
}

async function writeJsonFile(
  absolutePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function resolveTelegramBotToken(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeNullableString(env.HEALTHYBOB_TELEGRAM_BOT_TOKEN) ??
    normalizeNullableString(env.TELEGRAM_BOT_TOKEN)
  )
}

function resolveTelegramApiBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeNullableString(env.HEALTHYBOB_TELEGRAM_API_BASE_URL) ??
    normalizeNullableString(env.TELEGRAM_API_BASE_URL)
  )
}

function resolveTelegramFileBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeNullableString(env.HEALTHYBOB_TELEGRAM_FILE_BASE_URL) ??
    normalizeNullableString(env.TELEGRAM_FILE_BASE_URL)
  )
}

function runtimeNamespaceAccountId(
  connector: Pick<InboxConnectorConfig, 'accountId'>,
): string | null {
  return connector.accountId ?? null
}

function connectorNamespaceKey(
  connector: Pick<InboxConnectorConfig, 'source' | 'accountId'>,
): string {
  return `${connector.source}::${runtimeNamespaceAccountId(connector) ?? 'default'}`
}

function normalizeConnectorAccountId(
  source: InboxConnectorConfig['source'],
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)

  switch (source) {
    case 'imessage':
      return normalized ?? 'self'
    case 'telegram':
      return normalized ?? 'bot'
  }
}

function normalizeBackfillLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < 1 || value > 5000) {
    throw new VaultCliError(
      'INBOX_INVALID_LIMIT',
      'Backfill limit must be an integer between 1 and 5000.',
    )
  }

  return value
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new VaultCliError(
      'INBOX_INVALID_LIMIT',
      `Limit must be an integer between 1 and ${max}.`,
    )
  }

  return value
}

function relativeToVault(vaultRoot: string, absolutePath: string): string {
  const relativePath = path.relative(vaultRoot, absolutePath)
  return relativePath.length > 0 ? relativePath.replace(/\\/g, '/') : '.'
}

function normalizeOptionalCommandLimit(
  value: number | undefined,
  max: number,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new VaultCliError(
      'INBOX_INVALID_LIMIT',
      `Limit must be an integer between 1 and ${max}.`,
    )
  }

  return value
}

async function createParserServiceContext(
  vaultRoot: string,
  runtime: RuntimeStore,
  parsers: ParsersRuntimeModule,
): Promise<InboxParserServiceRuntime> {
  const configured = await parsers.createConfiguredParserRegistry({
    vaultRoot,
  })

  return parsers.createInboxParserService({
    vaultRoot,
    runtime,
    registry: configured.registry,
    ffmpeg: configured.ffmpeg,
  })
}

function summarizeParserDrain(
  vaultRoot: string,
  results: ParserRuntimeDrainResult[],
): NonNullable<InboxBackfillResult['parse']> {
  return {
    attempted: results.length,
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results: results.map((result) => ({
      captureId: result.job.captureId,
      attachmentId: result.job.attachmentId,
      status: result.status,
      providerId: result.providerId ?? null,
      manifestPath: result.manifestPath
        ? normalizeVaultPathOutput(vaultRoot, result.manifestPath)
        : null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
    })),
  }
}

function assertBootstrapStrictReady(doctor: InboxDoctorResult): void {
  const blockingChecks = doctor.checks.filter((check) => {
    if (check.status === 'fail') {
      return true
    }

    return check.name === 'parser-runtime'
  })
  const unavailableConfiguredTools = doctor.parserToolchain
    ? Object.entries(doctor.parserToolchain.tools).flatMap(([name, tool]) =>
        tool.source === 'config' && !tool.available
          ? [`${name}: ${tool.reason}`]
          : [],
      )
    : ['parser toolchain discovery did not return structured tool status']

  if (blockingChecks.length === 0 && unavailableConfiguredTools.length === 0) {
    return
  }

  throw new VaultCliError(
    'INBOX_BOOTSTRAP_STRICT_FAILED',
    'Inbox bootstrap strict readiness checks failed.',
    {
      blockingChecks: blockingChecks.map((check) => ({
        name: check.name,
        status: check.status,
        message: check.message,
      })),
      unavailableConfiguredTools,
    },
  )
}

function toCliParserToolchain(
  vaultRoot: string,
  doctor: ParserDoctorRuntimeReport,
): InboxParserToolchainStatus {
  return {
    configPath: relativeToVault(vaultRoot, doctor.configPath),
    discoveredAt: doctor.discoveredAt,
    tools: {
      ffmpeg: toCliParserToolStatus(doctor.tools.ffmpeg),
      pdftotext: toCliParserToolStatus(doctor.tools.pdftotext),
      whisper: {
        ...toCliParserToolStatus(doctor.tools.whisper),
        modelPath: redactSensitivePath(doctor.tools.whisper.modelPath),
      },
      paddleocr: toCliParserToolStatus(doctor.tools.paddleocr),
    },
  }
}

function toCliParserToolStatus(
  tool: ParserToolRuntimeStatus,
): InboxParserToolStatus {
  return {
    available: tool.available,
    command: redactSensitivePath(tool.command),
    modelPath:
      tool.modelPath === undefined ? undefined : redactSensitivePath(tool.modelPath),
    source: tool.source,
    reason: tool.reason,
  }
}

function toParserToolChecks(
  tools: ParserDoctorRuntimeReport['tools'],
): InboxDoctorCheck[] {
  return [
    toParserToolCheck('ffmpeg', tools.ffmpeg),
    toParserToolCheck('pdftotext', tools.pdftotext),
    toParserToolCheck('whisper', tools.whisper),
    toParserToolCheck('paddleocr', tools.paddleocr),
  ]
}

function toParserToolCheck(
  name: keyof ParserDoctorRuntimeReport['tools'],
  tool: ParserToolRuntimeStatus,
): InboxDoctorCheck {
  const details: Record<string, unknown> = {
    source: tool.source,
  }

  const command = redactSensitivePath(tool.command)
  if (command) {
    details.command = command
  }

  if (tool.modelPath !== undefined) {
    details.modelPath = redactSensitivePath(tool.modelPath)
  }

  return tool.available
    ? passCheck(`parser-${name}`, tool.reason, details)
    : warnCheck(`parser-${name}`, tool.reason, details)
}

function redactSensitivePath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (
    /^\/Users\/[^/]+/u.test(trimmed) ||
    /^\/home\/[^/]+/u.test(trimmed) ||
    /^[A-Za-z]:\\Users\\[^\\]+/u.test(trimmed)
  ) {
    return '<REDACTED_PATH>'
  }

  return trimmed
}

function normalizeVaultPathOutput(
  vaultRoot: string,
  filePath: string,
): string {
  return path.isAbsolute(filePath)
    ? relativeToVault(vaultRoot, filePath)
    : filePath.replace(/\\/g, '/')
}

function countRuntimeCaptures(runtime: RuntimeStore): number {
  let limit = 200

  while (true) {
    const count = runtime.listCaptures({ limit }).length
    if (count < limit) {
      return count
    }
    limit *= 2
  }
}

function listAllCaptures(runtime: RuntimeStore): RuntimeCaptureRecord[] {
  return runtime.listCaptures({ limit: countRuntimeCaptures(runtime) || 1 })
}

function isParseableAttachment(
  attachment: RuntimeAttachmentRecord,
): boolean {
  return (
    attachment.kind === 'audio' ||
    attachment.kind === 'document' ||
    attachment.kind === 'image' ||
    attachment.kind === 'video'
  )
}

function resolveAttachmentParseState(
  attachment: RuntimeAttachmentRecord,
  jobs: RuntimeAttachmentParseJobRecord[],
): 'pending' | 'running' | 'succeeded' | 'failed' | null {
  return attachment.parseState ?? jobs[0]?.state ?? null
}

function frontmatterStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function occurredDayFromCapture(capture: RuntimeCaptureRecord): string {
  const day = capture.occurredAt.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new VaultCliError(
      'INBOX_CAPTURE_OCCURRED_AT_INVALID',
      `Inbox capture "${capture.captureId}" has an invalid occurredAt timestamp.`,
      { occurredAt: capture.occurredAt },
    )
  }

  return day
}

function requireJournalPromotionCore(core: CoreRuntimeModule): JournalPromotionCore {
  if (
    !core.ensureJournalDay ||
    !core.parseFrontmatterDocument ||
    !core.stringifyFrontmatterDocument ||
    !core.acquireCanonicalWriteLock
  ) {
    throw unsupportedPromotion('journal')
  }

  return {
    ensureJournalDay: core.ensureJournalDay,
    parseFrontmatterDocument: core.parseFrontmatterDocument,
    stringifyFrontmatterDocument: core.stringifyFrontmatterDocument,
    acquireCanonicalWriteLock: core.acquireCanonicalWriteLock,
  }
}

function requireExperimentPromotionCore(
  core: CoreRuntimeModule,
): MarkdownPromotionCore {
  if (
    !core.parseFrontmatterDocument ||
    !core.stringifyFrontmatterDocument ||
    !core.acquireCanonicalWriteLock
  ) {
    throw unsupportedPromotion('experiment-note')
  }

  return {
    parseFrontmatterDocument: core.parseFrontmatterDocument,
    stringifyFrontmatterDocument: core.stringifyFrontmatterDocument,
    acquireCanonicalWriteLock: core.acquireCanonicalWriteLock,
  }
}

function upsertPromotionBody<TContext>(input: {
  body: string
  capture: RuntimeCaptureRecord
  context: TContext
  spec: PromotionMarkdownTargetSpec<TContext>
}): {
  body: string
  appended: boolean
} {
  const { body, capture, context, spec } = input
  const marker = `<!-- inbox-capture:${capture.captureId} -->`
  if (body.includes(marker)) {
    return {
      body,
      appended: false,
    }
  }

  const block = buildCapturePromotionBlock({
    capture,
    marker,
    context,
    spec,
  })
  return upsertMarkdownSectionBlock(body, block, spec)
}

function buildCapturePromotionBlock<TContext>(input: {
  capture: RuntimeCaptureRecord
  marker: string
  context: TContext
  spec: PromotionMarkdownTargetSpec<TContext>
}): string {
  const { capture, marker, context, spec } = input
  const lines = [
    marker,
    spec.blockHeading(capture, context),
    ...(spec.blockExtraLines?.(capture, context) ?? []),
    `Occurred at: ${capture.occurredAt}`,
    `Source: ${capture.source}`,
    `Thread: ${capture.thread.title ?? capture.thread.id}`,
    `Event: ${capture.eventId}`,
  ]

  const actorName = normalizeNullableString(capture.actor.displayName)
  const actorId = normalizeNullableString(capture.actor.id)
  if (actorName || actorId) {
    lines.push(`Actor: ${actorName ?? actorId ?? 'unknown'}`)
  }

  if (capture.attachments.length > 0) {
    lines.push('Attachments:')
    for (const attachment of capture.attachments) {
      const attachmentLabel =
        attachment.fileName ??
        attachment.storedPath ??
        attachment.originalPath ??
        attachment.externalId ??
        `attachment-${attachment.ordinal}`
      lines.push(
        `- ${attachment.attachmentId ?? `attachment-${attachment.ordinal}`} | ${attachment.kind} | ${attachmentLabel}`,
      )
    }
  }

  const text = normalizeNullableString(capture.text)
  if (text) {
    lines.push('', text)
  }

  return lines.join('\n')
}

function upsertMarkdownSectionBlock<TContext>(
  body: string,
  block: string,
  spec: PromotionMarkdownTargetSpec<TContext>,
): {
  body: string
  appended: boolean
} {
  const normalizedBody = body.replace(/\s*$/, '')

  if (
    normalizedBody.includes(spec.sectionStartMarker) &&
    normalizedBody.includes(spec.sectionEndMarker)
  ) {
    return {
      body: normalizedBody.replace(
        spec.sectionEndMarker,
        `${block}\n\n${spec.sectionEndMarker}`,
      ),
      appended: true,
    }
  }

  const separator = normalizedBody.length > 0 ? '\n\n' : ''
  return {
    body:
      `${normalizedBody}${separator}${spec.sectionHeading}\n\n` +
      `${spec.sectionStartMarker}\n\n${block}\n\n${spec.sectionEndMarker}\n`,
    appended: true,
  }
}

async function updatePromotionMarkdownDocument<TResolved, TContext>(input: {
  core: MarkdownPromotionCore
  absoluteVaultRoot: string
  relativePath: string
  capture: RuntimeCaptureRecord
  spec: PromotionMarkdownTargetSpec<TContext>
  resolveUpdate(input: {
    attributes: Record<string, unknown>
  }): {
    context: TContext
    resolved: TResolved
    nextAttributes: Record<string, unknown>
  }
}): Promise<{
  appended: boolean
  resolved: TResolved
}> {
  const absolutePath = path.join(input.absoluteVaultRoot, input.relativePath)
  const rawDocument = await readFile(absolutePath, 'utf8')
  const parsedDocument = input.core.parseFrontmatterDocument(rawDocument)
  const resolvedUpdate = input.resolveUpdate({
    attributes: parsedDocument.attributes,
  })
  const nextBody = upsertPromotionBody({
    body: parsedDocument.body,
    capture: input.capture,
    context: resolvedUpdate.context,
    spec: input.spec,
  })
  const nextDocument = input.core.stringifyFrontmatterDocument({
    attributes: resolvedUpdate.nextAttributes,
    body: nextBody.body,
  })

  if (nextDocument !== rawDocument) {
    await writeFile(absolutePath, nextDocument, 'utf8')
  }

  return {
    appended: nextBody.appended,
    resolved: resolvedUpdate.resolved,
  }
}

async function readExperimentEntries(
  vaultRoot: string,
  core: Pick<MarkdownPromotionCore, 'parseFrontmatterDocument'>,
): Promise<
  Array<{
    relativePath: string
    markdown: string
    body: string
    attributes: ExperimentFrontmatter
  }>
> {
  const experimentsRoot = path.join(vaultRoot, 'bank', 'experiments')
  const files = await safeReadMarkdownFiles(experimentsRoot)
  const entries: Array<{
    relativePath: string
    markdown: string
    body: string
    attributes: ExperimentFrontmatter
  }> = []

  for (const fileName of files) {
    const relativePath = path.posix.join('bank/experiments', fileName)
    const markdown = await readFile(path.join(vaultRoot, relativePath), 'utf8')
    const document = core.parseFrontmatterDocument(markdown)
    entries.push({
      relativePath,
      markdown,
      body: document.body,
      attributes: validateExperimentFrontmatter(document.attributes),
    })
  }

  return entries
}

function validateExperimentFrontmatter(value: unknown): ExperimentFrontmatter {
  const result = experimentFrontmatterSchema.safeParse(value)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      'Experiment frontmatter is invalid.',
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

function resolveExperimentPromotionTarget(
  entries: Array<{
    relativePath: string
    attributes: ExperimentFrontmatter
  }>,
) {
  const openEntries = entries.filter(
    (entry) =>
      entry.attributes.status !== 'completed' &&
      entry.attributes.status !== 'abandoned',
  )

  if (openEntries.length === 1) {
    return openEntries[0]
  }

  if (entries.length === 1) {
    return entries[0]
  }

  const candidates = openEntries.length > 0 ? openEntries : entries
  if (candidates.length === 0) {
    throw new VaultCliError(
      'INBOX_EXPERIMENT_TARGET_MISSING',
      'Experiment-note promotion requires at least one experiment document in bank/experiments.',
    )
  }

  throw new VaultCliError(
    'INBOX_EXPERIMENT_TARGET_AMBIGUOUS',
    'Experiment-note promotion needs exactly one unambiguous experiment target.',
    {
      candidates: candidates.map((entry) => ({
        experimentId: entry.attributes.experimentId,
        slug: entry.attributes.slug,
        status: entry.attributes.status,
      })),
    },
  )
}

function requireExperimentPromotionEntry(
  entries: Array<{
    relativePath: string
    attributes: ExperimentFrontmatter
  }>,
  lookupId: string | null,
  relatedId: string | null,
  capture: RuntimeCaptureRecord,
) {
  if (!lookupId || !relatedId) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      'Stored experiment-note promotion state is missing canonical ids.',
    )
  }

  if (relatedId !== capture.eventId) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      'Stored experiment-note promotion state does not match the capture event.',
    )
  }

  const existing = entries.find(
    (entry) =>
      entry.attributes.experimentId === lookupId ||
      entry.attributes.slug === lookupId,
  )
  if (!existing) {
    throw new VaultCliError(
      'INBOX_PROMOTION_CANONICAL_MISSING',
      'Local experiment-note promotion state exists, but the target experiment could not be verified.',
      {
        captureId: capture.captureId,
        lookupId,
      },
    )
  }

  return existing
}

async function listCanonicalManifestPaths(
  absoluteVaultRoot: string,
  manifestDirectory: string,
): Promise<string[]> {
  return walkRelativeFiles(absoluteVaultRoot, manifestDirectory, 'manifest.json')
}

async function walkRelativeFiles(
  absoluteVaultRoot: string,
  relativeDirectory: string,
  fileName: string,
): Promise<string[]> {
  const absoluteDirectory = path.join(absoluteVaultRoot, relativeDirectory)
  if (!(await fileExists(absoluteDirectory))) {
    return []
  }

  const matches: string[] = []
  const stack = [absoluteDirectory]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absoluteEntry = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absoluteEntry)
        continue
      }
      if (entry.isFile() && entry.name === fileName) {
        matches.push(relativeToVault(absoluteVaultRoot, absoluteEntry))
      }
    }
  }

  return matches.sort((left, right) => left.localeCompare(right))
}

async function safeReadMarkdownFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      String((error as { code?: string }).code) === 'ENOENT'
    ) {
      return []
    }

    throw error
  }
}

async function readCanonicalManifest<TManifest>(
  absoluteVaultRoot: string,
  relativePath: string,
  schema: z.ZodType<TManifest>,
): Promise<TManifest | null> {
  try {
    const raw = await readFile(path.join(absoluteVaultRoot, relativePath), 'utf8')
    return schema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

function extractCanonicalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

async function resolveAttachmentSha256(
  absoluteVaultRoot: string,
  attachment: RuntimeAttachmentRecord & { storedPath?: string | null },
): Promise<string> {
  if (typeof attachment.sha256 === 'string' && attachment.sha256.length > 0) {
    return attachment.sha256
  }
  if (!attachment.storedPath) {
    throw new VaultCliError(
      'INBOX_ATTACHMENT_HASH_MISSING',
      'Attachment hash could not be resolved from the stored inbox artifact.',
    )
  }

  const content = await readFile(
    path.join(absoluteVaultRoot, attachment.storedPath),
  )
  return createHash('sha256').update(content).digest('hex')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function passCheck(
  name: string,
  message: string,
  details?: Record<string, unknown>,
): InboxDoctorCheck {
  return inboxDoctorCheckSchema.parse({
    name,
    status: 'pass',
    message,
    details,
  })
}

function warnCheck(
  name: string,
  message: string,
  details?: Record<string, unknown>,
): InboxDoctorCheck {
  return inboxDoctorCheckSchema.parse({
    name,
    status: 'warn',
    message,
    details,
  })
}

function failCheck(
  name: string,
  message: string,
  details?: Record<string, unknown>,
): InboxDoctorCheck {
  return inboxDoctorCheckSchema.parse({
    name,
    status: 'fail',
    message,
    details,
  })
}

function unsupportedPromotion(target: 'journal' | 'experiment-note'): VaultCliError {
  return new VaultCliError(
    'INBOX_PROMOTION_UNSUPPORTED',
    `Canonical ${target} promotion is not available yet through a safe shared runtime boundary.`,
  )
}

function unsupportedAttachmentParse(
  action: 'show status' | 'parse' | 'reparse',
): VaultCliError {
  return new VaultCliError(
    'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
    `Attachment parse ${action} is not available through the current inbox runtime boundary.`,
  )
}

const canonicalMealManifestSchema = z.object({
  importId: z.string().min(1),
  importKind: z.literal('meal'),
  importedAt: z.string().min(1),
  source: z.string().nullable(),
  artifacts: z.array(
    z.object({
      role: z.string().min(1),
      sha256: z.string().min(1),
    }),
  ),
  provenance: z.record(z.string(), z.unknown()),
})

const canonicalDocumentManifestSchema = z.object({
  importId: z.string().min(1),
  importKind: z.literal('document'),
  importedAt: z.string().min(1),
  source: z.string().nullable(),
  artifacts: z.array(
    z.object({
      role: z.string().min(1),
      sha256: z.string().min(1),
    }),
  ),
  provenance: z.record(z.string(), z.unknown()),
})

type CanonicalMealManifest = z.infer<typeof canonicalMealManifestSchema>
type CanonicalDocumentManifest = z.infer<typeof canonicalDocumentManifestSchema>

const mealCanonicalPromotionSpec = {
  target: 'meal',
  manifestDirectory: RAW_MEALS_DIRECTORY,
  manifestSchema: canonicalMealManifestSchema,
  matchesManifest(
    manifest: CanonicalMealManifest,
    context: {
      photoSha256: string
      audioSha256: string | null
    },
  ): boolean {
    const manifestPhoto = manifest.artifacts.find(
      (artifact) => artifact.role === 'photo',
    )
    const manifestAudio = manifest.artifacts.find(
      (artifact) => artifact.role === 'audio',
    )
    if (!manifestPhoto || manifestPhoto.sha256 !== context.photoSha256) {
      return false
    }

    return (manifestAudio?.sha256 ?? null) === context.audioSha256
  },
} satisfies CanonicalPromotionLookupSpec<
  CanonicalMealManifest,
  {
    photoSha256: string
    audioSha256: string | null
  }
>

const documentCanonicalPromotionSpec = {
  target: 'document',
  manifestDirectory: RAW_DOCUMENTS_DIRECTORY,
  manifestSchema: canonicalDocumentManifestSchema,
  matchesManifest(
    manifest: CanonicalDocumentManifest,
    context: {
      documentSha256: string
      title: string | null
    },
  ): boolean {
    const manifestDocument = manifest.artifacts.find(
      (artifact) => artifact.role === 'source_document',
    )
    if (!manifestDocument || manifestDocument.sha256 !== context.documentSha256) {
      return false
    }

    return (
      normalizeNullableString(extractCanonicalString(manifest.provenance, 'title')) ===
      context.title
    )
  },
} satisfies CanonicalPromotionLookupSpec<
  CanonicalDocumentManifest,
  {
    documentSha256: string
    title: string | null
  }
>

const journalPromotionMarkdownSpec = {
  sectionHeading: '## Inbox Captures',
  sectionStartMarker: JOURNAL_PROMOTION_SECTION_START,
  sectionEndMarker: JOURNAL_PROMOTION_SECTION_END,
  blockHeading(capture: RuntimeCaptureRecord): string {
    return `### Inbox Capture ${capture.captureId}`
  },
} satisfies PromotionMarkdownTargetSpec<undefined>

const experimentPromotionMarkdownSpec = {
  sectionHeading: '## Inbox Experiment Notes',
  sectionStartMarker: EXPERIMENT_NOTE_SECTION_START,
  sectionEndMarker: EXPERIMENT_NOTE_SECTION_END,
  blockHeading(capture: RuntimeCaptureRecord): string {
    return `### Inbox Note ${capture.captureId}`
  },
  blockExtraLines(
    _capture: RuntimeCaptureRecord,
    context: {
      experimentSlug: string
    },
  ): string[] {
    return [`Experiment: ${context.experimentSlug}`]
  },
} satisfies PromotionMarkdownTargetSpec<{
  experimentSlug: string
}>
