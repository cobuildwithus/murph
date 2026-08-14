import * as z from '@murphai/contracts/zod-runtime'
import {
  isoTimestampSchema,
  pathSchema,
} from './vault-cli-contracts.js'
import { normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

export const inboxSourceValues = ['telegram', 'email', 'linq'] as const
export const inboxPromotionTargetValues = ['meal', 'document', 'journal', 'experiment-note'] as const
export const inboxCheckStatusValues = ['pass', 'warn', 'fail'] as const

export const inboxConnectorOptionsSchema = z.object({
  backfillLimit: z.number().int().positive().max(5000).optional(),
  emailAddress: z.string().min(1).nullable().optional(),
  linqWebhookHost: z.string().min(1).nullable().optional(),
  linqWebhookPath: z.string().min(1).nullable().optional(),
  linqWebhookPort: z.number().int().positive().max(65535).nullable().optional(),
})

export const inboxConnectorConfigSchema = z.object({
  id: z.string().min(1),
  source: z.enum(inboxSourceValues),
  enabled: z.boolean(),
  accountId: z.string().min(1).nullable(),
  options: inboxConnectorOptionsSchema,
})

export const inboxRuntimeConfigSchema = z.object({
  connectors: z.array(inboxConnectorConfigSchema),
})

export const inboxDoctorCheckSchema = z.object({
  name: z.string().min(1),
  status: z.enum(inboxCheckStatusValues),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const inboxParserToolStatusSchema = z.object({
  available: z.boolean(),
  command: z.string().min(1).nullable(),
  modelPath: z.string().min(1).nullable().optional(),
  source: z.enum(['config', 'env', 'system', 'missing']),
  reason: z.string().min(1),
})

export const inboxParserToolchainStatusSchema = z.object({
  configPath: pathSchema,
  discoveredAt: isoTimestampSchema,
  tools: z.object({
    ffmpeg: inboxParserToolStatusSchema,
    whisper: inboxParserToolStatusSchema.extend({
      modelPath: z.string().min(1).nullable(),
    }),
  }),
})

export const inboxPromotionEntrySchema = z.object({
  captureId: z.string().min(1),
  target: z.enum(inboxPromotionTargetValues),
  status: z.enum(['applied', 'unsupported']),
  promotedAt: isoTimestampSchema,
  lookupId: z.string().min(1).nullable(),
  relatedId: z.string().min(1).nullable(),
  captureEventId: z.string().min(1).nullable().optional(),
  note: z.string().min(1).nullable(),
})

export const inboxPromotionStoreSchema = z.object({
  entries: z.array(inboxPromotionEntrySchema),
})

export const inboxAttachmentSchema = z.object({
  attachmentId: z.string().min(1).nullable().optional(),
  ordinal: z.number().int().positive(),
  externalId: z.string().min(1).nullable().optional(),
  kind: z.enum(['image', 'audio', 'video', 'document', 'other']),
  mime: z.string().min(1).nullable().optional(),
  originalPath: pathSchema.nullable().optional(),
  storedPath: pathSchema.nullable().optional(),
  fileName: z.string().min(1).nullable().optional(),
  byteSize: z.number().int().nonnegative().nullable().optional(),
  sha256: z.string().min(1).nullable().optional(),
  extractedText: z.string().nullable().optional(),
  transcriptText: z.string().nullable().optional(),
  derivedPath: pathSchema.nullable().optional(),
  parserProviderId: z.string().min(1).nullable().optional(),
  parseState: z.enum(['pending', 'running', 'succeeded', 'failed']).nullable().optional(),
})

export const inboxAttachmentParseJobSchema = z.object({
  jobId: z.string().min(1),
  captureId: z.string().min(1),
  attachmentId: z.string().min(1),
  pipeline: z.literal('attachment_text'),
  state: z.enum(['pending', 'running', 'succeeded', 'failed']),
  attempts: z.number().int().nonnegative(),
  providerId: z.string().min(1).nullable().optional(),
  resultPath: pathSchema.nullable().optional(),
  errorCode: z.string().min(1).nullable().optional(),
  errorMessage: z.string().min(1).nullable().optional(),
  createdAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.nullable().optional(),
  finishedAt: isoTimestampSchema.nullable().optional(),
})

export const inboxCaptureSummarySchema = z.object({
  captureId: z.string().min(1),
  source: z.string().min(1),
  accountId: z.string().min(1).nullable(),
  externalId: z.string().min(1),
  threadId: z.string().min(1),
  threadTitle: z.string().min(1).nullable(),
  threadIsDirect: z.boolean(),
  actorId: z.string().min(1).nullable(),
  actorName: z.string().min(1).nullable(),
  actorIsSelf: z.boolean(),
  occurredAt: isoTimestampSchema,
  receivedAt: isoTimestampSchema.nullable(),
  text: z.string().nullable(),
  attachmentCount: z.number().int().nonnegative(),
  sourceDirectory: pathSchema,
  eventId: z.string().min(1),
  createdAt: isoTimestampSchema.optional(),
  promotions: z.array(inboxPromotionEntrySchema),
})

export const inboxCaptureDetailSchema = inboxCaptureSummarySchema.extend({
  createdAt: isoTimestampSchema,
  attachments: z.array(inboxAttachmentSchema),
})

export const inboxInitResultSchema = z.object({
  vault: pathSchema,
  runtimeDirectory: pathSchema,
  databasePath: pathSchema,
  configPath: pathSchema,
  createdPaths: z.array(pathSchema),
  rebuiltCaptures: z.number().int().nonnegative(),
})

export const inboxProvisionedMailboxSchema = z.object({
  inboxId: z.string().min(1),
  emailAddress: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  clientId: z.string().min(1).nullable(),
  provider: z.literal('agentmail'),
})

export const inboxSourceAddResultSchema = z.object({
  vault: pathSchema,
  configPath: pathSchema,
  connector: inboxConnectorConfigSchema,
  connectorCount: z.number().int().nonnegative(),
  provisionedMailbox: inboxProvisionedMailboxSchema.nullable().optional(),
  reusedMailbox: inboxProvisionedMailboxSchema.nullable().optional(),
  autoReplyEnabled: z.boolean().optional(),
})

export const inboxSourceRemoveResultSchema = z.object({
  vault: pathSchema,
  configPath: pathSchema,
  removed: z.boolean(),
  connectorId: z.string().min(1),
  connectorCount: z.number().int().nonnegative(),
})

export const inboxSourceListResultSchema = z.object({
  vault: pathSchema,
  configPath: pathSchema,
  connectors: z.array(inboxConnectorConfigSchema),
})

export const inboxDoctorResultSchema = z.object({
  vault: pathSchema,
  configPath: pathSchema.nullable(),
  databasePath: pathSchema.nullable(),
  target: z.string().min(1).nullable(),
  ok: z.boolean(),
  checks: z.array(inboxDoctorCheckSchema),
  connectors: z.array(inboxConnectorConfigSchema),
  parserToolchain: inboxParserToolchainStatusSchema.nullable().optional(),
})

export const inboxSetupResultSchema = z.object({
  vault: pathSchema,
  configPath: pathSchema,
  updatedAt: isoTimestampSchema,
  tools: inboxParserToolchainStatusSchema.shape.tools,
})

export const inboxBootstrapResultSchema = z.object({
  vault: pathSchema,
  init: inboxInitResultSchema.omit({
    vault: true,
  }),
  setup: inboxSetupResultSchema.omit({
    vault: true,
  }),
  doctor: inboxDoctorResultSchema.omit({
    vault: true,
  }),
})

export const inboxParseJobResultSchema = z.object({
  captureId: z.string().min(1),
  attachmentId: z.string().min(1),
  status: z.enum(['failed', 'succeeded']),
  providerId: z.string().min(1).nullable(),
  resultPath: pathSchema.nullable(),
  errorCode: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
})

export const inboxParseResultSchema = z.object({
  vault: pathSchema,
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(inboxParseJobResultSchema),
})

export const inboxRequeueResultSchema = z.object({
  vault: pathSchema,
  count: z.number().int().nonnegative(),
  filters: z.object({
    captureId: z.string().min(1).optional(),
    attachmentId: z.string().min(1).optional(),
    state: z.enum(['failed', 'running']).optional(),
  }),
})

export const inboxBackfillResultSchema = z.object({
  vault: pathSchema,
  sourceId: z.string().min(1),
  importedCount: z.number().int().nonnegative(),
  dedupedCount: z.number().int().nonnegative(),
  cursor: z.record(z.string(), z.unknown()).nullable(),
  parse: inboxParseResultSchema
    .omit({
      vault: true,
    })
    .optional(),
})

export const inboxDaemonStateSchema = z.object({
  running: z.boolean(),
  stale: z.boolean(),
  pid: z.number().int().positive().nullable(),
  startedAt: isoTimestampSchema.nullable(),
  stoppedAt: isoTimestampSchema.nullable(),
  status: z.enum(['idle', 'running', 'stopped', 'failed', 'stale']),
  connectorIds: z.array(z.string().min(1)),
  statePath: pathSchema,
  configPath: pathSchema,
  databasePath: pathSchema,
  failureCategory: z.string().min(1).nullable().optional(),
  failureCode: z.string().min(1).nullable().optional(),
  message: z.string().min(1).nullable(),
})

export const inboxRunResultSchema = z.object({
  vault: pathSchema,
  sourceIds: z.array(z.string().min(1)),
  startedAt: isoTimestampSchema,
  stoppedAt: isoTimestampSchema,
  reason: z.enum(['completed', 'signal', 'error']),
  statePath: pathSchema,
})

export const inboxListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    sourceId: z.string().min(1).nullable(),
    limit: z.number().int().positive().max(200),
    afterCreatedAt: isoTimestampSchema.nullable().optional(),
    afterOccurredAt: isoTimestampSchema.nullable(),
    afterCaptureId: z.string().min(1).nullable(),
    oldestFirst: z.boolean(),
  }),
  items: z.array(inboxCaptureSummarySchema),
})

export const inboxShowResultSchema = z.object({
  vault: pathSchema,
  capture: inboxCaptureDetailSchema,
})

export const inboxSearchHitSchema = z.object({
  captureId: z.string().min(1),
  source: z.string().min(1),
  accountId: z.string().min(1).nullable(),
  threadId: z.string().min(1),
  threadTitle: z.string().min(1).nullable(),
  occurredAt: isoTimestampSchema,
  text: z.string().nullable(),
  snippet: z.string(),
  score: z.number(),
  sourceDirectory: pathSchema,
  promotions: z.array(inboxPromotionEntrySchema),
})

export const inboxSearchResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    text: z.string().min(1),
    sourceId: z.string().min(1).nullable(),
    limit: z.number().int().positive().max(200),
  }),
  hits: z.array(inboxSearchHitSchema),
})

export const inboxEnvelopeRepairResultSchema = z.object({
  vault: pathSchema,
  mode: z.enum(['dry-run', 'apply']),
  hasWork: z.boolean(),
  mutated: z.boolean(),
  hasMore: z.boolean(),
  scannedEnvelopeCount: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  candidateBytes: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  activeOperationCount: z.number().int().nonnegative(),
  missingLedgerCount: z.number().int().nonnegative(),
  mismatchCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  deletedBytes: z.number().int().nonnegative(),
})

export const inboxParserAttemptCompactionResultSchema = z.object({
  vault: pathSchema,
  mode: z.enum(['dry-run', 'apply']),
  mutated: z.boolean(),
  hasMore: z.boolean(),
  scannedAttemptCount: z.number().int().nonnegative(),
  eligibleAttemptCount: z.number().int().nonnegative(),
  compactedAttemptCount: z.number().int().nonnegative(),
  deletedFileCount: z.number().int().nonnegative(),
  reasons: z.object({
    already_compacted: z.number().int().nonnegative(),
    incomplete_legacy_attempt: z.number().int().nonnegative(),
    invalid_attempt_path: z.number().int().nonnegative(),
    invalid_legacy_artifact: z.number().int().nonnegative(),
    invalid_legacy_manifest: z.number().int().nonnegative(),
    legacy_path_mismatch: z.number().int().nonnegative(),
    result_mismatch: z.number().int().nonnegative(),
    unexpected_attempt_entry: z.number().int().nonnegative(),
    unsafe_filesystem_entry: z.number().int().nonnegative(),
  }),
})

export const inboxPromoteMealResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  target: z.literal('meal'),
  lookupId: z.string().min(1),
  relatedId: z.string().min(1),
  created: z.boolean(),
})

export const inboxPromoteDocumentResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  target: z.literal('document'),
  lookupId: z.string().min(1),
  relatedId: z.string().min(1),
  created: z.boolean(),
})

export const inboxPreservedDocumentSchema = z.object({
  attachmentId: z.string().min(1).nullable(),
  ordinal: z.number().int().positive(),
  lookupId: z.string().min(1),
  relatedId: z.string().min(1),
  created: z.boolean(),
})

export const inboxPreserveDocumentAttachmentsResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  preservedCount: z.number().int().nonnegative(),
  createdCount: z.number().int().nonnegative(),
  documents: z.array(inboxPreservedDocumentSchema),
})

export const inboxPromoteJournalResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  target: z.literal('journal'),
  lookupId: z.string().min(1),
  relatedId: z.string().min(1),
  journalPath: pathSchema,
  created: z.boolean(),
  appended: z.boolean(),
  linked: z.boolean(),
})

export const inboxPromoteExperimentNoteResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  target: z.literal('experiment-note'),
  lookupId: z.string().min(1),
  relatedId: z.string().min(1),
  experimentPath: pathSchema,
  experimentSlug: z.string().min(1),
  appended: z.boolean(),
})

export const inboxAttachmentListResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  attachmentCount: z.number().int().nonnegative(),
  attachments: z.array(inboxAttachmentSchema),
})

export const inboxAttachmentShowResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  attachment: inboxAttachmentSchema,
})

export const inboxAttachmentStatusResultSchema = z.object({
  vault: pathSchema,
  captureId: z.string().min(1),
  attachmentId: z.string().min(1),
  parseable: z.boolean(),
  currentState: z.enum(['pending', 'running', 'succeeded', 'failed']).nullable(),
  jobs: z.array(inboxAttachmentParseJobSchema),
})

export type InboxConnectorConfig = z.infer<typeof inboxConnectorConfigSchema>
export type InboxRuntimeConfig = z.infer<typeof inboxRuntimeConfigSchema>
export type InboxSource = (typeof inboxSourceValues)[number]
export type InboxDoctorCheck = z.infer<typeof inboxDoctorCheckSchema>
export type InboxParserToolStatus = z.infer<typeof inboxParserToolStatusSchema>
export type InboxParserToolchainStatus = z.infer<typeof inboxParserToolchainStatusSchema>
export type InboxPromotionEntry = z.infer<typeof inboxPromotionEntrySchema>
export type InboxPromotionStore = z.infer<typeof inboxPromotionStoreSchema>
export type InboxInitResult = z.infer<typeof inboxInitResultSchema>
export type InboxProvisionedMailbox = z.infer<typeof inboxProvisionedMailboxSchema>
export type InboxSourceAddResult = z.infer<typeof inboxSourceAddResultSchema>
export type InboxSourceRemoveResult = z.infer<typeof inboxSourceRemoveResultSchema>
export type InboxSourceListResult = z.infer<typeof inboxSourceListResultSchema>
export type InboxDoctorResult = z.infer<typeof inboxDoctorResultSchema>
export type InboxSetupResult = z.infer<typeof inboxSetupResultSchema>
export type InboxBootstrapResult = z.infer<typeof inboxBootstrapResultSchema>
export type InboxBackfillResult = z.infer<typeof inboxBackfillResultSchema>
export type InboxDaemonState = z.infer<typeof inboxDaemonStateSchema>
export type InboxRunResult = z.infer<typeof inboxRunResultSchema>
export type InboxListResult = z.infer<typeof inboxListResultSchema>
export type InboxShowResult = z.infer<typeof inboxShowResultSchema>
export type InboxSearchResult = z.infer<typeof inboxSearchResultSchema>
export type InboxEnvelopeRepairResult = z.infer<typeof inboxEnvelopeRepairResultSchema>
export type InboxParserAttemptCompactionResult = z.infer<
  typeof inboxParserAttemptCompactionResultSchema
>
export type InboxParseJobResult = z.infer<typeof inboxParseJobResultSchema>
export type InboxParseResult = z.infer<typeof inboxParseResultSchema>
export type InboxRequeueResult = z.infer<typeof inboxRequeueResultSchema>
export type InboxPromoteMealResult = z.infer<typeof inboxPromoteMealResultSchema>

export function normalizeInboxConnectorAccountId(
  source: InboxSource,
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)

  switch (source) {
    case 'telegram':
      return normalized ?? 'bot'
    case 'email':
      return normalized
    case 'linq':
      return normalized ?? 'default'
    default: {
      throw new VaultCliError(
        'INBOX_SOURCE_UNSUPPORTED',
        `Inbox source "${source}" is not supported.`,
      )
    }
  }
}

export function normalizeInboxConnectorConfig(
  config: InboxConnectorConfig,
): InboxConnectorConfig {
  return {
    ...config,
    accountId: normalizeInboxConnectorAccountId(
      config.source,
      config.accountId,
    ),
  }
}

export function normalizeInboxRuntimeConfig(
  config: InboxRuntimeConfig,
): InboxRuntimeConfig {
  return {
    ...config,
    connectors: config.connectors.map(normalizeInboxConnectorConfig),
  }
}
export type InboxPromoteDocumentResult = z.infer<typeof inboxPromoteDocumentResultSchema>
export type InboxPreservedDocument = z.infer<typeof inboxPreservedDocumentSchema>
export type InboxPreserveDocumentAttachmentsResult = z.infer<
  typeof inboxPreserveDocumentAttachmentsResultSchema
>
export type InboxPromoteJournalResult = z.infer<typeof inboxPromoteJournalResultSchema>
export type InboxPromoteExperimentNoteResult = z.infer<
  typeof inboxPromoteExperimentNoteResultSchema
>
export type InboxAttachmentListResult = z.infer<typeof inboxAttachmentListResultSchema>
export type InboxAttachmentShowResult = z.infer<typeof inboxAttachmentShowResultSchema>
export type InboxAttachmentStatusResult = z.infer<typeof inboxAttachmentStatusResultSchema>
