import type {
  AttachmentParseJobRecord as SharedAttachmentParseJobRecord,
  InboxCaptureRecord as SharedInboxCaptureRecord,
  InboxPipeline as SharedInboxPipeline,
  InboxRuntimeStore as SharedInboxRuntimeStore,
  InboxSearchHit as SharedInboxSearchHit,
  IndexedAttachment as SharedIndexedAttachment,
  InboundCapture as SharedInboundCapture,
  PersistedCapture as SharedPersistedCapture,
} from '@murphai/inboxd'
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
  InboxEnvelopeRepairResult,
  InboxInitResult,
  InboxListResult,
  InboxParserAttemptCompactionResult,
  InboxPromoteDocumentResult,
  InboxPromoteExperimentNoteResult,
  InboxPromoteJournalResult,
  InboxPromoteMealResult,
  InboxPreservedDocument,
  InboxPreserveDocumentAttachmentsResult,
  InboxPromotionEntry,
  InboxSearchResult,
  InboxShowResult,
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
export type RuntimeCaptureRecordInput = SharedInboundCapture

export type InboxPipeline = SharedInboxPipeline

export interface InboxRuntimeModule {
  ensureInboxVault(vaultRoot: string): Promise<void>
  openInboxRuntime(input: { vaultRoot: string }): Promise<RuntimeStore>
  rebuildRuntimeFromVault(input: {
    enqueueParserJobs: boolean
    vaultRoot: string
    runtime: RuntimeStore
  }): Promise<number>
  runInboxEnvelopeMigration(input: {
    apply?: boolean
    maxFiles?: number
    vaultRoot: string
  }): Promise<Omit<InboxEnvelopeRepairResult, 'vault'>>
}

export interface ParsersRuntimeModule {
  compactLegacyParserAttempts(input: {
    apply?: boolean
    maxAttempts?: number
    vaultRoot: string
  }): Promise<Omit<InboxParserAttemptCompactionResult, 'vault'>>
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
  listInboxDocumentDefaultPromotionCorrelations?(input: {
    vaultRoot: string
  }): Promise<Array<{
    attachmentId: string
    captureId: string
    documentId: string
    eventId: string
  }>>
  listLiveExactDocumentImportEvidence?(input: {
    sources: ReadonlyArray<{
      byteLength: number
      sha256: string
    }>
    vaultRoot: string
  }): Promise<Array<{
    byteLength: number
    sha256: string
    evidence: Array<{
      defaultPromotions: Array<{
        attachmentId: string
        captureId: string
        documentId: string
        eventId: string
      }>
      documentId: string
      manifestPath: string
      rawRef: string
    }> | null
  }>>
  recordInboxDocumentDefaultPromotion?(input: {
    attachmentId: string
    captureId: string
    documentId: string
    vaultRoot: string
  }): Promise<{
    created: boolean
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
  enableJournalPromotion?: boolean
  loadCoreModule?: () => Promise<CoreRuntimeModule>
  loadImportersModule?: () => Promise<ImportersFactoryRuntimeModule>
  loadInboxModule?: () => Promise<InboxRuntimeModule>
  loadParsersModule?: () => Promise<ParsersRuntimeModule>
  loadQueryModule?: () => Promise<QueryRuntimeModule>
}

export interface InitInput extends CommandContext {
  rebuild?: boolean
  rebuildParserJobs?: boolean
}

export interface ListInput extends CommandContext {
  afterCaptureId?: string | null
  afterCreatedAt?: string | null
  afterOccurredAt?: string | null
  oldestFirst?: boolean
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

export interface PreserveDocumentAttachmentInput extends CommandContext {
  file: string
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
  init(input: InitInput): Promise<InboxInitResult>
  repairEnvelopes(input: RepairInboxEnvelopesInput): Promise<InboxEnvelopeRepairResult>
  compactParserAttempts(
    input: CompactInboxParserAttemptsInput,
  ): Promise<InboxParserAttemptCompactionResult>
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
  preserveDocumentAttachment(
    input: PreserveDocumentAttachmentInput,
  ): Promise<InboxPreservedDocument>
  promoteMeal(input: PromoteInput): Promise<InboxPromoteMealResult>
  promoteDocument(input: PromoteInput): Promise<InboxPromoteDocumentResult>
  promoteJournal(input: PromoteInput): Promise<InboxPromoteJournalResult>
  promoteExperimentNote(
    input: PromoteInput,
  ): Promise<InboxPromoteExperimentNoteResult>
}

export interface InboxAppEnvironment {
  clock: () => Date
  loadCore: () => Promise<CoreRuntimeModule>
  loadImporters: () => Promise<ImportersFactoryRuntimeModule>
  loadInbox: () => Promise<InboxRuntimeModule>
  loadParsers: () => Promise<ParsersRuntimeModule>
  loadQuery: () => Promise<QueryRuntimeModule>
  requireParsers: (operation: string) => Promise<ParsersRuntimeModule>
  journalPromotionEnabled: boolean
}
