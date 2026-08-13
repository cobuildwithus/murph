import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import { assistantPreferenceCausalSeqSchema } from '@murphai/contracts'
import { createHostedMailboxAssistantInputIdFromBlindedIdentity } from '@murphai/hosted-execution/assistant-identifiers'
import {
  assertAssistantStatePathHasNoSymlinks,
  ensureAssistantStateDir,
  parseVersionedJsonStateEnvelope,
  writeAssistantStateVersionedJson,
} from '@murphai/runtime-state/node'
import type { AssistantStatePaths } from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isSameAssistantConversationCapture,
  type AssistantInputConversationRef,
} from './conversation-ref.js'
import {
  compareAssistantTimestampsAscending,
  isMissingFileError,
  resolveTimestamp,
} from './shared.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  ASSISTANT_DERIVED_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
  ASSISTANT_RAW_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
  normalizeAssistantAttachmentArtifactPath,
} from './attachment-artifact-paths.js'
import {
  retireHostedMailboxAssistantInputItemContentAtPaths,
} from './hosted-mailbox-input-items.js'

export const ASSISTANT_INPUT_EVENT_SCHEMA = 'murph.assistant-input-event.v1'
export const ASSISTANT_INPUT_EVENT_SCHEMA_VERSION = 1
export const ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH = 20_000
export const ASSISTANT_INPUT_EVENT_ATTACHMENT_DESCRIPTOR_MAX_COUNT = 32
const ASSISTANT_INPUT_EVENT_REPLY_TARGET_MAX_LENGTH = 8_192
const ASSISTANT_INPUT_EVENT_ARTIFACT_PATH_MAX_LENGTH = 1024
const ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_INLINE_FRAGMENT_MAX_COUNT = 16
const ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_TEXT_MAX_LENGTH = 6_000
const ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_LABEL_MAX_LENGTH = 191
const ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_ALLOWED_ROOT_MAX_LENGTH = 512
const ASSISTANT_INPUT_EVENT_SOURCE_METADATA_TEXT_MAX_LENGTH = 512

export type { AssistantInputConversationRef } from './conversation-ref.js'
export type AssistantInputProjectionStatus =
  | 'not_attempted'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'quarantined'
export interface AssistantInputCursor {
  createdAt: string | null
  inputId: string
  occurredAt: string
  sourceKind: AssistantInputSourceRef['kind']
  sourcePosition?: string | null
}
export type AssistantInputSourceRef =
  | {
      captureId: string
      kind: 'inbox-capture'
      source: string
      version: string | null
    }
  | {
      causalSeq?: string | null
      dedupeKey: string | null
      eventId: string
      itemId: string
      kind: 'hosted-mailbox'
      lane: 'conversation' | 'system'
      laneSeq: string
      payloadSchema: string
      payloadSource: 'inline' | 'sidecar'
      source: 'hosted-mailbox'
      wakeSchema: string
    }

const ASSISTANT_INPUT_RUNTIME_EVENT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u
const ASSISTANT_INPUT_EVENT_REASON_CODE_PATTERN =
  /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u
const ASSISTANT_INPUT_EVENT_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u
const ASSISTANT_INPUT_EVENT_SAFE_FILE_NAME_PATTERN = /^[^\u0000-\u001f\u007f/\\:?#[\]]{1,191}$/u

const assistantInputProjectionStatusValues = [
  'not_attempted',
  'pending',
  'succeeded',
  'failed',
  'quarantined',
] as const satisfies readonly AssistantInputProjectionStatus[]

const assistantInputAttachmentEvidenceStatusValues = [
  'not_attempted',
  'available',
  'partial',
  'failed',
] as const

const assistantInputAttachmentEvidenceSourceValues = [
  'local-inbox-import',
  'local-parser-drain',
  'hosted-inbox-projection',
  'manual',
] as const

const assistantInputAttachmentEvidenceItemKindValues = [
  'image',
  'audio',
  'video',
  'document',
  'other',
] as const

const assistantInputAttachmentEvidenceParseStateValues = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'unsupported',
] as const

const assistantInputAttachmentEvidenceFragmentKindValues = [
  'attachment_extracted_text',
  'attachment_transcript',
  'derived_plain_text',
  'derived_markdown',
  'derived_tables',
] as const

const assistantInputSourceRefSchema = z.discriminatedUnion('kind', [
  z
    .object({
      captureId: safeAssistantInputTokenSchema('captureId'),
      kind: z.literal('inbox-capture'),
      source: safeAssistantInputTokenSchema('source'),
      version: safeNullableAssistantInputTokenSchema('version'),
    })
    .strict(),
  z
    .object({
      causalSeq: assistantPreferenceCausalSeqSchema.nullable().optional(),
      dedupeKey: safeNullableAssistantInputTokenSchema('dedupeKey'),
      eventId: safeAssistantInputTokenSchema('eventId'),
      itemId: safeAssistantInputTokenSchema('itemId'),
      kind: z.literal('hosted-mailbox'),
      lane: z.enum(['conversation', 'system']),
      laneSeq: safeAssistantInputTokenSchema('laneSeq'),
      payloadSchema: safeAssistantInputTokenSchema('payloadSchema'),
      payloadSource: z.enum(['inline', 'sidecar']),
      source: z.literal('hosted-mailbox'),
      wakeSchema: safeAssistantInputTokenSchema('wakeSchema'),
    })
    .strict(),
])

const assistantInputConversationRefSchema = z
  .object({
    accountId: safeNullableAssistantInputTokenSchema('accountId'),
    actorId: safeNullableAssistantInputTokenSchema('actorId'),
    actorIsSelf: z.boolean(),
    source: safeNullableAssistantInputTokenSchema('source'),
    sessionId: safeNullableAssistantInputTokenSchema('sessionId').optional(),
    threadId: safeNullableAssistantInputTokenSchema('threadId'),
    threadIsDirect: z.boolean().nullable().default(null),
  })
  .strict()

const assistantInputCursorSchema = z
  .object({
    createdAt: safeNullableAssistantInputTimestampSchema('createdAt'),
    inputId: z
      .string()
      .refine((value) => isAssistantInputEventId(value), {
        message: 'inputId must be an assistant input event id.',
      }),
    occurredAt: safeAssistantInputTimestampSchema('occurredAt'),
    sourceKind: z.enum(['inbox-capture', 'hosted-mailbox']),
    sourcePosition: safeNullableAssistantInputPositionSchema('sourcePosition'),
  })
  .strict()

const assistantInputAttachmentDescriptorSchema = z
  .object({
    attachmentId: safeAttachmentTokenSchema('attachmentId'),
    contentType: safeAttachmentContentTypeSchema(),
    fileName: safeAttachmentFileNameSchema(),
    kind: safeAttachmentTokenSchema('kind'),
    sizeBytes: z.number().int().nonnegative().nullable().default(null),
  })
  .strict()

const assistantInputArtifactRefSchema = z
  .object({
    byteSize: z.number().int().nonnegative().nullable().default(null),
    kind: z.literal('vault-relative-file'),
    mediaType: safeAttachmentContentTypeSchema(),
    path: safeAssistantInputArtifactPathSchema(
      'attachmentEvidence.raw.path',
      ASSISTANT_RAW_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
    ),
    sha256: safeNullableAssistantInputSha256Schema(),
  })
  .strict()

const assistantInputDerivedArtifactRefSchema = z.discriminatedUnion('kind', [
  z.object({
    allowedRoot: safeAssistantInputArtifactRootSchema(
      'attachmentEvidence.derived.allowedRoot',
      ASSISTANT_DERIVED_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
    ),
    kind: z.literal('parser-manifest'),
    manifestPath: safeAssistantInputArtifactPathSchema(
      'attachmentEvidence.derived.manifestPath',
      ASSISTANT_DERIVED_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
    ),
  }).strict(),
  z.object({
    allowedRoot: safeAssistantInputArtifactRootSchema(
      'attachmentEvidence.derived.allowedRoot',
      ASSISTANT_DERIVED_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
    ),
    kind: z.literal('parser-result'),
    resultPath: safeAssistantInputArtifactPathSchema(
      'attachmentEvidence.derived.resultPath',
      ASSISTANT_DERIVED_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
    ),
  }).strict(),
])

const assistantInputAttachmentEvidenceTextFragmentSchema = z
  .object({
    kind: z.enum(assistantInputAttachmentEvidenceFragmentKindValues),
    label: safeAssistantInputAttachmentEvidenceLabelSchema(
      'attachmentEvidence.inlineFragments.label',
    ),
    text: safeAssistantInputAttachmentEvidenceTextSchema(
      'attachmentEvidence.inlineFragments.text',
    ),
    truncated: z.boolean(),
  })
  .strict()

const assistantInputAttachmentEvidenceItemSchema = z
  .object({
    byteSize: z.number().int().nonnegative().nullable().default(null),
    derived: assistantInputDerivedArtifactRefSchema.nullable().default(null),
    descriptorAttachmentId: safeAttachmentTokenSchema(
      'attachmentEvidence.descriptorAttachmentId',
    ),
    fileName: safeAttachmentFileNameSchema(),
    inlineFragments: z
      .array(assistantInputAttachmentEvidenceTextFragmentSchema)
      .max(ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_INLINE_FRAGMENT_MAX_COUNT)
      .default([]),
    kind: z.enum(assistantInputAttachmentEvidenceItemKindValues),
    mime: safeAttachmentContentTypeSchema(),
    ordinal: z.number().int().positive(),
    parseState: z
      .enum(assistantInputAttachmentEvidenceParseStateValues)
      .nullable()
      .default(null),
    raw: assistantInputArtifactRefSchema.nullable().default(null),
    sourceAttachmentId: safeAttachmentTokenSchema(
      'attachmentEvidence.sourceAttachmentId',
    ),
  })
  .strict()

const assistantInputAttachmentEvidenceSchema = z
  .object({
    attachments: z
      .array(assistantInputAttachmentEvidenceItemSchema)
      .max(ASSISTANT_INPUT_EVENT_ATTACHMENT_DESCRIPTOR_MAX_COUNT)
      .default([]),
    optionalInboxCaptureId: safeNullableAssistantInputTokenSchema(
      'attachmentEvidence.optionalInboxCaptureId',
    ),
    reasonCode: safeNullableAssistantInputReasonCodeSchema(),
    source: z.enum(assistantInputAttachmentEvidenceSourceValues).nullable().default(null),
    status: z.enum(assistantInputAttachmentEvidenceStatusValues),
    updatedAt: safeNullableAssistantInputTimestampSchema('attachmentEvidence.updatedAt'),
  })
  .strict()
  .superRefine((value, context) => {
    assertUniqueAssistantInputAttachmentEvidenceField({
      context,
      fieldName: 'ordinal',
      values: value.attachments.map((attachment) => String(attachment.ordinal)),
    })
    assertUniqueAssistantInputAttachmentEvidenceField({
      context,
      fieldName: 'sourceAttachmentId',
      values: value.attachments.map((attachment) => attachment.sourceAttachmentId),
    })
    assertUniqueAssistantInputAttachmentEvidenceField({
      context,
      fieldName: 'descriptorAttachmentId',
      values: value.attachments.map((attachment) => attachment.descriptorAttachmentId),
    })
  })
  .superRefine(assertValidAssistantInputAttachmentEvidence)

const DEFAULT_ASSISTANT_INPUT_ATTACHMENT_EVIDENCE = {
  attachments: [],
  optionalInboxCaptureId: null,
  reasonCode: null,
  source: null,
  status: 'not_attempted',
  updatedAt: null,
} satisfies z.input<typeof assistantInputAttachmentEvidenceSchema>

const assistantInputContentSchema = z
  .object({
    attachmentDescriptors: z
      .array(assistantInputAttachmentDescriptorSchema)
      .max(ASSISTANT_INPUT_EVENT_ATTACHMENT_DESCRIPTOR_MAX_COUNT)
      .default([]),
    text: safeNullableAssistantInputTextSchema('text'),
    transcriptText: safeNullableAssistantInputTextSchema('transcriptText'),
    userMessageContent: z
      .array(
        z
          .object({
            text: safeAssistantInputTextSchema('userMessageContent.text'),
            type: z.literal('text'),
          })
          .strict(),
      )
      .max(16)
      .nullable()
      .default(null),
  })
  .strict()

const assistantInputProjectionSchema = z
  .object({
    captureId: safeNullableAssistantInputTokenSchema('captureId'),
    lastAttemptedAt: safeNullableAssistantInputTimestampSchema('lastAttemptedAt'),
    reasonCode: safeNullableAssistantInputReasonCodeSchema(),
    status: z.enum(assistantInputProjectionStatusValues),
    updatedAt: safeNullableAssistantInputTimestampSchema('updatedAt'),
  })
  .strict()
  .superRefine(assertValidAssistantInputProjection)

const assistantInputReplyTargetSchema = z
  .object({
    channel: safeNullableAssistantInputTokenSchema('channel'),
    messageId: privateNullableAssistantInputRouteScalarSchema('messageId'),
    threadId: privateNullableAssistantInputRouteScalarSchema('threadId'),
  })
  .strict()

const assistantInputTelegramSourceMetadataSchema = z
  .object({
    externalThreadRouteAuthorityPresent: z.boolean().optional(),
    kind: z.literal('telegram'),
    mediaGroupId: safeNullableAssistantInputTokenSchema(
      'sourceMetadata.mediaGroupId',
    ),
    replyContext: safeNullableAssistantInputMetadataTextSchema(
      'sourceMetadata.replyContext',
    ),
    // Presentation-only speaker label from trusted ingress or a current
    // server-owned membership lookup. It never supplies participant authority.
    senderDisplayName: safeAssistantInputMetadataTextSchema(
      'sourceMetadata.senderDisplayName',
    ).nullable().optional(),
    // Group (thread-container) inbound only: the sending participant's handle,
    // so the assistant can attribute messages and detect being addressed.
    senderHandle: privateAssistantInputRouteScalarSchema(
      'sourceMetadata.senderHandle',
    ).nullish(),
    // Display-only Telegram @username. Never attribution authority.
    senderUsername: safeAssistantInputTokenSchema(
      'sourceMetadata.senderUsername',
    ).nullish(),
  })
  .strict()

const assistantInputLinqSourceMetadataSchema = z
  .object({
    affirmativeReaction: z.literal(true).optional(),
    editedSourceInputId: z
      .string()
      .regex(/^ain_[0-9a-f]{32}$/u)
      .optional(),
    editedTextPartIndex: z.number().int().min(0).max(2_147_483_647).optional(),
    externalThreadRouteAuthorityPresent: z.boolean().optional(),
    kind: z.literal('linq'),
    partCount: z.number().int().min(0).max(64),
    // Restore-only compatibility for snapshots written before route-transition
    // repair was removed. No current producer or consumer uses this value.
    previousHomeThreadId: privateNullableAssistantInputRouteScalarSchema(
      'sourceMetadata.previousHomeThreadId',
    ).optional(),
    reactionEligible: z.boolean().optional().default(false),
    replyToMessageId: safeNullableAssistantInputTokenSchema(
      'sourceMetadata.replyToMessageId',
    ),
    // Legacy presentation-only speaker-label compatibility. Automatic profile
    // and owner-contact resolution stays turn-local and is never persisted in
    // source metadata. This value never supplies participant authority.
    senderDisplayName: safeAssistantInputMetadataTextSchema(
      'sourceMetadata.senderDisplayName',
    ).nullable().optional(),
    // Group (thread-container) inbound only: the sending participant's handle,
    // so the assistant can attribute messages and detect being addressed.
    senderHandle: privateAssistantInputRouteScalarSchema(
      'sourceMetadata.senderHandle',
    ).nullish(),
    service: safeNullableAssistantInputTokenSchema('sourceMetadata.service'),
  })
  .strict()
  .transform(
    ({ previousHomeThreadId: _retiredPreviousHomeThreadId, ...metadata }) =>
      metadata,
  )

const assistantInputEmailSourceMetadataSchema = z
  .object({
    assistantStyleSettingsAuthorized: z.boolean().optional(),
    kind: z.literal('email'),
    promptReady: z.boolean(),
    promptUnavailableReason: safeNullableAssistantInputReasonCodeSchema(),
  })
  .strict()

const assistantInputSourceMetadataSchema = z
  .discriminatedUnion('kind', [
    assistantInputEmailSourceMetadataSchema,
    assistantInputLinqSourceMetadataSchema,
    assistantInputTelegramSourceMetadataSchema,
  ])
  .nullable()
  .default(null)

const assistantInputEventRecordSchema = z
  .object({
    attachmentEvidence: assistantInputAttachmentEvidenceSchema.default(
      DEFAULT_ASSISTANT_INPUT_ATTACHMENT_EVIDENCE,
    ),
    content: assistantInputContentSchema,
    conversation: assistantInputConversationRefSchema.nullable().default(null),
    contentRetiredAt: safeNullableAssistantInputTimestampSchema(
      'contentRetiredAt',
    ).optional(),
    cursor: assistantInputCursorSchema,
    idempotencyKey: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u),
    inputId: z
      .string()
      .refine((value) => isAssistantInputEventId(value), {
        message: 'inputId must be an assistant input event id.',
      }),
    occurredAt: safeAssistantInputTimestampSchema('occurredAt'),
    projection: assistantInputProjectionSchema,
    receivedAt: safeNullableAssistantInputTimestampSchema('receivedAt'),
    replyTarget: assistantInputReplyTargetSchema.nullable().default(null),
    schema: z.literal(ASSISTANT_INPUT_EVENT_SCHEMA),
    sourceMetadata: assistantInputSourceMetadataSchema,
    sourceRef: assistantInputSourceRefSchema,
    storedAt: safeAssistantInputTimestampSchema('storedAt'),
    updatedAt: safeAssistantInputTimestampSchema('updatedAt'),
  })
  .strict()

const assistantInputAttachmentEvidenceUpdateSchema =
  assistantInputAttachmentEvidenceSchema

const assistantInputProjectionUpdateSchema = z
  .object({
    captureId: safeAssistantInputTokenSchema('captureId').nullable().optional(),
    lastAttemptedAt: safeAssistantInputTimestampSchema(
      'lastAttemptedAt',
    ).nullable().optional(),
    reasonCode: safeAssistantInputReasonCodeSchema().nullable().optional(),
    status: z.enum(assistantInputProjectionStatusValues),
    updatedAt: safeAssistantInputTimestampSchema('updatedAt')
      .nullable()
      .optional(),
  })
  .strict()

export type AssistantInputAttachmentEvidence = z.infer<
  typeof assistantInputAttachmentEvidenceSchema
>
export type AssistantInputAttachmentEvidenceItem = z.infer<typeof assistantInputAttachmentEvidenceItemSchema>
export type AssistantInputAttachmentDescriptor = z.infer<
  typeof assistantInputAttachmentDescriptorSchema
>
export type AssistantInputContent = z.infer<typeof assistantInputContentSchema>
export type AssistantInputEventProjection = z.infer<
  typeof assistantInputProjectionSchema
>
export type AssistantInputReplyTarget = z.infer<
  typeof assistantInputReplyTargetSchema
>
export type AssistantInputSourceMetadata = z.infer<
  typeof assistantInputSourceMetadataSchema
>
export type AssistantInputEventRecord = z.infer<
  typeof assistantInputEventRecordSchema
>

export function resolveAssistantInputEventReferenceAt(
  event: Pick<AssistantInputEventRecord, 'occurredAt' | 'receivedAt'>,
): string {
  return event.receivedAt ?? event.occurredAt
}

export interface UpsertAssistantInputEventInput {
  content?: z.input<typeof assistantInputContentSchema>
  conversation?: AssistantInputConversationRef | null
  occurredAt: string
  receivedAt?: string | null
  replyTarget?: z.input<typeof assistantInputReplyTargetSchema> | null
  sourceMetadata?: z.input<typeof assistantInputSourceMetadataSchema> | null
  sourceRef: AssistantInputSourceRef
}

export interface AssistantInputEventRecordParseFailure {
  error: unknown
  fileName: string
}

export function createAssistantInputEventId(input: {
  sourceRef: AssistantInputSourceRef
}): string {
  if (input.sourceRef.kind === 'hosted-mailbox') {
    return createHostedMailboxAssistantInputIdFromBlindedIdentity({
      dedupeKey: input.sourceRef.dedupeKey,
      eventId: input.sourceRef.eventId,
      lane: input.sourceRef.lane,
    })
  }
  return `ain_${sha256Hex(stableStringify(assistantInputSourceRefIdentity(input.sourceRef))).slice(0, 32)}`
}

export function resolveAssistantInputEventsDirectory(
  paths: AssistantStatePaths,
): string {
  return path.join(paths.assistantStateRoot, 'input-events')
}

export function resolveAssistantInputEventPath(input: {
  inputId: string
  paths: AssistantStatePaths
}): string {
  return path.join(
    resolveAssistantInputEventsDirectory(input.paths),
    `${normalizeAssistantInputEventId(input.inputId)}.json`,
  )
}

export async function upsertAssistantInputEvent(input: {
  event: UpsertAssistantInputEventInput
  now?: Date
  paths?: AssistantStatePaths
  vault?: string
}): Promise<AssistantInputEventRecord> {
  const context = resolveAssistantInputContext(input)
  return withAssistantRuntimeWriteLock(context.vault, async () => {
    const paths = context.paths
    await ensureAssistantInputEventStore(paths)
    const next = buildAssistantInputEventRecord({
      event: input.event,
      now: input.now,
    })
    const existing = await readAssistantInputEventAtPaths({
      inputId: next.inputId,
      paths,
    })

    if (existing) {
      assertAssistantInputEventReplayCompatible({
        existing,
        next,
      })
      return existing
    }

    await writeAssistantStateVersionedJson({
      filePath: resolveAssistantInputEventPath({
        inputId: next.inputId,
        paths,
      }),
      schema: ASSISTANT_INPUT_EVENT_SCHEMA,
      schemaVersion: ASSISTANT_INPUT_EVENT_SCHEMA_VERSION,
      value: next,
    })
    return next
  })
}

export async function readAssistantInputEvent(input: {
  inputId: string
  paths?: AssistantStatePaths
  vault?: string
}): Promise<AssistantInputEventRecord | null> {
  const { paths } = resolveAssistantInputContext(input)
  return readAssistantInputEventAtPaths({
    inputId: input.inputId,
    paths,
  })
}

export async function retireAssistantInputEventContent(input: {
  inputId: string
  now?: Date
  signal?: AbortSignal | null
  vault: string
}): Promise<{ retired: boolean; event: AssistantInputEventRecord | null }> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    input.signal?.throwIfAborted()
    await ensureAssistantInputEventStore(paths)
    const existing = await readAssistantInputEventAtPaths({
      inputId: input.inputId,
      paths,
    })
    input.signal?.throwIfAborted()
    if (!existing) {
      return { event: existing, retired: false }
    }
    // The mailbox sidecar carries one optional quoted-message field that is
    // intentionally absent from the input event. Clear it first under the same
    // write lock. If the later event write fails, the next pass can safely
    // retry; the inverse order could strand the quote behind contentRetiredAt.
    await retireHostedMailboxAssistantInputItemContentAtPaths({
      inputId: existing.inputId,
      paths,
      signal: input.signal,
    })
    if (existing.contentRetiredAt) {
      return { event: existing, retired: false }
    }

    const retiredAt = resolveTimestamp(input.now)
    const retired = assistantInputEventRecordSchema.parse({
      ...existing,
      attachmentEvidence: {
        ...existing.attachmentEvidence,
        attachments: existing.attachmentEvidence.attachments.map(
          (attachment) => ({
            ...attachment,
            derived: null,
            inlineFragments: [],
            raw: null,
          }),
        ),
      },
      content: redactAssistantInputContent(existing.content),
      contentRetiredAt: retiredAt,
      sourceMetadata: redactAssistantInputSourceMetadata(
        existing.sourceMetadata,
      ),
      updatedAt: retiredAt,
    })
    await writeAssistantStateVersionedJson({
      filePath: resolveAssistantInputEventPath({
        inputId: retired.inputId,
        paths,
      }),
      schema: ASSISTANT_INPUT_EVENT_SCHEMA,
      schemaVersion: ASSISTANT_INPUT_EVENT_SCHEMA_VERSION,
      value: retired,
    })
    input.signal?.throwIfAborted()
    return { event: retired, retired: true }
  }, input.signal)
}

export async function listAssistantInputEvents(input: {
  afterCursor?: AssistantInputCursor | null
  conversation?: AssistantInputConversationRef | null
  limit?: number
  onInvalidRecord?: ((failure: AssistantInputEventRecordParseFailure) => void) | null
  paths?: AssistantStatePaths
  signal?: AbortSignal | null
  skipInvalidRecords?: boolean
  source?: string | null
  vault?: string
}): Promise<{
  events: AssistantInputEventRecord[]
  nextCursor: AssistantInputCursor | null
}> {
  input.signal?.throwIfAborted()
  const { paths } = resolveAssistantInputContext(input)
  const limit = normalizeAssistantInputEventListLimit(input.limit)
  const onInvalidRecord = input.onInvalidRecord ?? null
  const skipInvalidRecords = input.skipInvalidRecords ?? false
  const directory = resolveAssistantInputEventsDirectory(paths)

  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    })
    input.signal?.throwIfAborted()
    const records: AssistantInputEventRecord[] = []

    for (const entry of entries) {
      input.signal?.throwIfAborted()
      if (!entry.name.endsWith('.json')) {
        continue
      }

      try {
        if (!entry.isFile()) {
          throw new TypeError(
            'Assistant input event entries must be regular JSON files.',
          )
        }
        const filePath = path.join(directory, entry.name)
        await assertAssistantStatePathHasNoSymlinks(filePath)
        input.signal?.throwIfAborted()
        const raw = await readFile(filePath, 'utf8')
        input.signal?.throwIfAborted()
        records.push(parseAssistantInputEventFile(JSON.parse(raw)))
      } catch (error) {
        input.signal?.throwIfAborted()
        if (!skipInvalidRecords) {
          throw error
        }
        onInvalidRecord?.({
          error,
          fileName: entry.name,
        })
      }
    }

    const filtered = records
      .filter((record) =>
        input.source ? record.sourceRef.source === input.source : true,
      )
      .filter((record) =>
        input.conversation
          ? record.conversation
            ? isSameAssistantConversationCapture(
                record.conversation,
                input.conversation,
              )
            : false
          : true,
      )
      .filter((record) =>
        input.afterCursor
          ? compareAssistantInputCursors(record.cursor, input.afterCursor) > 0
          : true,
      )
      .sort((left, right) =>
        compareAssistantInputCursors(left.cursor, right.cursor),
      )

    const events = filtered.slice(0, limit)
    const nextCursor = events[0]
      ? events[events.length - 1]!.cursor
      : input.afterCursor ?? null

    return {
      events,
      nextCursor,
    }
  } catch (error) {
    input.signal?.throwIfAborted()
    if (isMissingFileError(error)) {
      return {
        events: [],
        nextCursor: input.afterCursor ?? null,
      }
    }
    throw error
  }
}

export async function readLatestAssistantInputCursor(input: {
  onInvalidRecord?: ((failure: AssistantInputEventRecordParseFailure) => void) | null
  paths?: AssistantStatePaths
  skipInvalidRecords?: boolean
  vault?: string
}): Promise<AssistantInputCursor | null> {
  const { paths } = resolveAssistantInputContext(input)
  const onInvalidRecord = input.onInvalidRecord ?? null
  const skipInvalidRecords = input.skipInvalidRecords ?? false
  const directory = resolveAssistantInputEventsDirectory(paths)

  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    })
    let latest: AssistantInputCursor | null = null

    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) {
        continue
      }

      try {
        if (!entry.isFile()) {
          throw new TypeError(
            'Assistant input event entries must be regular JSON files.',
          )
        }
        const filePath = path.join(directory, entry.name)
        await assertAssistantStatePathHasNoSymlinks(filePath)
        const raw = await readFile(filePath, 'utf8')
        const record = parseAssistantInputEventFile(JSON.parse(raw))
        if (!latest || compareAssistantInputCursors(record.cursor, latest) > 0) {
          latest = record.cursor
        }
      } catch (error) {
        if (!skipInvalidRecords) {
          throw error
        }
        onInvalidRecord?.({
          error,
          fileName: entry.name,
        })
      }
    }

    return latest
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

export async function updateAssistantInputProjection(input: {
  inputId: string
  now?: Date
  paths?: AssistantStatePaths
  projection: z.input<typeof assistantInputProjectionUpdateSchema>
  vault?: string
}): Promise<AssistantInputEventRecord> {
  const context = resolveAssistantInputContext(input)
  return withAssistantRuntimeWriteLock(context.vault, async () => {
    const paths = context.paths
    const existing = await readAssistantInputEventAtPaths({
      inputId: input.inputId,
      paths,
    })
    if (!existing) {
      throw new VaultCliError(
        'ASSISTANT_INPUT_EVENT_NOT_FOUND',
        'Assistant input event projection cannot be updated because the input event does not exist.',
        {
          inputId: input.inputId,
        },
      )
    }

    const now = resolveTimestamp(input.now)
    const parsedProjection = assistantInputProjectionUpdateSchema.parse(
      input.projection,
    )
    const nextProjection = applyAssistantInputProjectionUpdate({
      existing: existing.projection,
      now,
      update: parsedProjection,
    })
    const updated = assistantInputEventRecordSchema.parse({
      ...existing,
      projection: nextProjection,
      updatedAt: now,
    })
    await writeAssistantStateVersionedJson({
      filePath: resolveAssistantInputEventPath({
        inputId: updated.inputId,
        paths,
      }),
      schema: ASSISTANT_INPUT_EVENT_SCHEMA,
      schemaVersion: ASSISTANT_INPUT_EVENT_SCHEMA_VERSION,
      value: updated,
    })
    return updated
  })
}

export async function updateAssistantInputAttachmentEvidence(input: {
  attachmentEvidence: z.input<typeof assistantInputAttachmentEvidenceUpdateSchema>
  inputId: string
  now?: Date
  paths?: AssistantStatePaths
  preserveUsefulEvidenceOnFailure?: boolean
  vault?: string
}): Promise<AssistantInputEventRecord> {
  const context = resolveAssistantInputContext(input)
  return withAssistantRuntimeWriteLock(context.vault, async () => {
    const paths = context.paths
    const existing = await readAssistantInputEventAtPaths({
      inputId: input.inputId,
      paths,
    })
    if (!existing) {
      throw new VaultCliError(
        'ASSISTANT_INPUT_EVENT_NOT_FOUND',
        'Assistant input event attachment evidence cannot be updated because the input event does not exist.',
        {
          inputId: input.inputId,
        },
      )
    }

    const now = resolveTimestamp(input.now)
    const parsedEvidence = assistantInputAttachmentEvidenceUpdateSchema.parse(
      input.attachmentEvidence,
    )
    if (
      input.preserveUsefulEvidenceOnFailure === true &&
      parsedEvidence.status === 'failed' &&
      isUsefulAssistantInputAttachmentEvidence(existing.attachmentEvidence)
    ) {
      return existing
    }
    const nextEvidence = applyAssistantInputAttachmentEvidenceUpdate({
      now,
      update: parsedEvidence,
    })
    const updated = assistantInputEventRecordSchema.parse({
      ...existing,
      attachmentEvidence: nextEvidence,
      updatedAt: now,
    })
    await writeAssistantStateVersionedJson({
      filePath: resolveAssistantInputEventPath({
        inputId: updated.inputId,
        paths,
      }),
      schema: ASSISTANT_INPUT_EVENT_SCHEMA,
      schemaVersion: ASSISTANT_INPUT_EVENT_SCHEMA_VERSION,
      value: updated,
    })
    return updated
  })
}

function isUsefulAssistantInputAttachmentEvidence(
  evidence: AssistantInputAttachmentEvidence,
): boolean {
  return evidence.status === 'available' || evidence.status === 'partial'
}

async function ensureAssistantInputEventStore(
  paths: AssistantStatePaths,
): Promise<void> {
  await ensureAssistantState(paths)
  await ensureAssistantStateDir(resolveAssistantInputEventsDirectory(paths))
}

async function readAssistantInputEventAtPaths(input: {
  inputId: string
  paths: AssistantStatePaths
}): Promise<AssistantInputEventRecord | null> {
  try {
    const expectedInputId = normalizeAssistantInputEventId(input.inputId)
    const filePath = resolveAssistantInputEventPath({
      inputId: expectedInputId,
      paths: input.paths,
    })
    await assertAssistantStatePathHasNoSymlinks(filePath)
    const raw = await readFile(filePath, 'utf8')
    const record = parseAssistantInputEventFile(JSON.parse(raw))
    if (record.inputId !== expectedInputId) {
      throw new TypeError(
        'assistant input event record inputId must match its storage path.',
      )
    }
    return record
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

function parseAssistantInputEventFile(value: unknown): AssistantInputEventRecord {
  return parseVersionedJsonStateEnvelope(value, {
    label: 'assistant input event record',
    parseValue: parseAssistantInputEventRecord,
    schema: ASSISTANT_INPUT_EVENT_SCHEMA,
    schemaVersion: ASSISTANT_INPUT_EVENT_SCHEMA_VERSION,
  })
}

function parseAssistantInputEventRecord(
  value: unknown,
): AssistantInputEventRecord {
  const record = assistantInputEventRecordSchema.parse(value)
  const expectedInputId = createAssistantInputEventId({
    sourceRef: record.sourceRef,
  })
  if (record.inputId !== expectedInputId) {
    throw new TypeError(
      'assistant input event record inputId must match its sourceRef.',
    )
  }
  if (record.cursor.inputId !== record.inputId) {
    throw new TypeError(
      'assistant input event record cursor inputId must match its inputId.',
    )
  }
  return record
}

function buildAssistantInputEventRecord(input: {
  event: UpsertAssistantInputEventInput
  now?: Date
}): AssistantInputEventRecord {
  const now = resolveTimestamp(input.now)
  const sourceRef = assistantInputSourceRefSchema.parse(input.event.sourceRef)
  const inputId = createAssistantInputEventId({
    sourceRef,
  })

  return assistantInputEventRecordSchema.parse({
    attachmentEvidence: DEFAULT_ASSISTANT_INPUT_ATTACHMENT_EVIDENCE,
    content: input.event.content ?? {},
    conversation: input.event.conversation ?? null,
    cursor: {
      createdAt: now,
      inputId,
      occurredAt: input.event.occurredAt,
      sourceKind: sourceRef.kind,
      sourcePosition: assistantInputSourcePosition(sourceRef),
    },
    idempotencyKey: `sha256:${sha256Hex(stableStringify(assistantInputSourceRefIdentity(sourceRef)))}`,
    inputId,
    occurredAt: input.event.occurredAt,
    projection: {
      captureId: null,
      lastAttemptedAt: null,
      reasonCode: null,
      status: 'not_attempted',
      updatedAt: null,
    },
    receivedAt: input.event.receivedAt ?? null,
    replyTarget: input.event.replyTarget ?? null,
    schema: ASSISTANT_INPUT_EVENT_SCHEMA,
    sourceMetadata: input.event.sourceMetadata ?? null,
    sourceRef,
    storedAt: now,
    updatedAt: now,
  })
}

function assertAssistantInputEventReplayCompatible(input: {
  existing: AssistantInputEventRecord
  next: AssistantInputEventRecord
}): void {
  const existingIdentity = assistantInputEventImmutableIdentity(input.existing)
  const nextIdentity = assistantInputEventImmutableIdentity(input.next)
  if (stableStringify(existingIdentity) === stableStringify(nextIdentity)) {
    return
  }
  if (
    input.existing.contentRetiredAt
    && stableStringify(existingIdentity)
      === stableStringify(
        assistantInputEventImmutableIdentity({
          ...input.next,
          content: redactAssistantInputContent(input.next.content),
          sourceMetadata: redactAssistantInputSourceMetadata(
            input.next.sourceMetadata,
          ),
        }),
      )
  ) {
    return
  }
  const replayCompatibilityIdentity =
    assistantInputEventReplayCompatibilityIdentity({
      existing: input.existing,
      next: input.next,
    })
  if (stableStringify(existingIdentity) === stableStringify(replayCompatibilityIdentity)) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_INPUT_EVENT_CONFLICT',
    'Assistant input event replay changed immutable input content for the same source reference.',
    {
      inputId: input.existing.inputId,
    },
  )
}

function redactAssistantInputContent(
  content: AssistantInputContent,
): AssistantInputContent {
  return {
    ...content,
    text: null,
    transcriptText: null,
    userMessageContent: null,
  }
}

function redactAssistantInputSourceMetadata(
  metadata: AssistantInputSourceMetadata,
): AssistantInputSourceMetadata {
  return metadata?.kind === 'telegram'
    ? {
        ...metadata,
        replyContext: null,
      }
    : metadata
}

function assistantInputEventReplayCompatibilityIdentity(input: {
  existing: AssistantInputEventRecord
  next: AssistantInputEventRecord
}): unknown {
  return {
    ...assistantInputEventImmutableIdentity(input.next),
    content: assistantInputContentReplayCompatibilitySnapshot({
      existing: input.existing.content,
      next: input.next.content,
    }),
  }
}

function assistantInputContentReplayCompatibilitySnapshot(input: {
  existing: AssistantInputContent
  next: AssistantInputContent
}): AssistantInputContent {
  const existingDescriptors = input.existing.attachmentDescriptors
  const nextDescriptors = input.next.attachmentDescriptors
  if (existingDescriptors.length !== nextDescriptors.length) {
    return input.next
  }

  return {
    ...input.next,
    attachmentDescriptors: nextDescriptors.map((descriptor, index) => {
      const existingDescriptor = existingDescriptors[index]
      if (existingDescriptor?.fileName !== null || descriptor.fileName === null) {
        return descriptor
      }
      return {
        ...descriptor,
        fileName: null,
      }
    }),
  }
}

function assistantInputEventImmutableIdentity(
  record: AssistantInputEventRecord,
): Record<string, unknown> {
  return {
    content: record.content,
    conversation: record.conversation,
    occurredAt: record.occurredAt,
    replyTarget: record.replyTarget,
    sourceMetadata: record.sourceMetadata,
    sourceRefIdentity: assistantInputSourceRefIdentity(record.sourceRef),
  }
}

function normalizeAssistantInputEventId(value: string): string {
  const normalized = value.trim()
  if (isAssistantInputEventId(normalized)) {
    return normalized
  }

  throw new VaultCliError(
    'ASSISTANT_INPUT_EVENT_INVALID_ID',
    'Assistant input event ids must be deterministic opaque ids.',
    {
      inputId: value,
    },
  )
}

function isAssistantInputEventId(value: string): boolean {
  return ASSISTANT_INPUT_RUNTIME_EVENT_ID_PATTERN.test(value)
}

function resolveAssistantInputContext(input: {
  paths?: AssistantStatePaths
  vault?: string
}): {
  paths: AssistantStatePaths
  vault: string
} {
  if (input.paths && input.vault) {
    const resolvedVault = path.resolve(input.vault)
    const resolvedPathsVault = path.resolve(input.paths.absoluteVaultRoot)
    if (resolvedVault !== resolvedPathsVault) {
      throw new VaultCliError(
        'ASSISTANT_INPUT_EVENT_CONTEXT_MISMATCH',
        'Assistant input event vault and paths must point at the same vault root.',
      )
    }
    assertAssistantInputPathsMatchVault(input.paths)
    return {
      paths: input.paths,
      vault: resolvedPathsVault,
    }
  }
  if (input.paths) {
    assertAssistantInputPathsMatchVault(input.paths)
    return {
      paths: input.paths,
      vault: path.resolve(input.paths.absoluteVaultRoot),
    }
  }
  if (input.vault) {
    const paths = resolveAssistantStatePaths(input.vault)
    return {
      paths,
      vault: path.resolve(paths.absoluteVaultRoot),
    }
  }
  throw new TypeError('vault or paths is required for assistant input events.')
}

function assertAssistantInputPathsMatchVault(paths: AssistantStatePaths): void {
  const expected = resolveAssistantStatePaths(paths.absoluteVaultRoot)
  if (
    path.resolve(paths.absoluteVaultRoot) !==
      path.resolve(expected.absoluteVaultRoot) ||
    path.resolve(paths.assistantStateRoot) !==
      path.resolve(expected.assistantStateRoot)
  ) {
    throw new VaultCliError(
      'ASSISTANT_INPUT_EVENT_CONTEXT_MISMATCH',
      'Assistant input event paths must match the resolved assistant state paths for the vault root.',
    )
  }
}

function normalizeAssistantInputEventListLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return 100
  }
  return Math.max(1, Math.trunc(limit))
}

function assistantInputSourceRefIdentity(
  sourceRef: AssistantInputSourceRef,
): unknown {
  if (sourceRef.kind === 'inbox-capture') {
    return {
      captureId: sourceRef.captureId,
      kind: sourceRef.kind,
    }
  }
  return {
    identity: sourceRef.dedupeKey ?? sourceRef.eventId,
    kind: sourceRef.kind,
    lane: sourceRef.lane,
  }
}

function assistantInputSourcePosition(
  sourceRef: AssistantInputSourceRef,
): string | null {
  if (sourceRef.kind === 'inbox-capture') {
    return [
      'inbox-capture',
      sourceRef.source,
      sourceRef.captureId,
    ].join(':')
  }
  return [
    'hosted-mailbox',
    sourceRef.lane,
    normalizeAssistantInputLaneSeqForSort(sourceRef.laneSeq),
    sourceRef.itemId,
  ].join(':')
}

function normalizeAssistantInputLaneSeqForSort(laneSeq: string): string {
  return /^\d+$/u.test(laneSeq)
    ? laneSeq.padStart(39, '0')
    : laneSeq
}

function applyAssistantInputProjectionUpdate(input: {
  existing: AssistantInputEventProjection
  now: string
  update: z.infer<typeof assistantInputProjectionUpdateSchema>
}): AssistantInputEventProjection {
  if (input.existing.status === 'succeeded') {
    const nextCaptureId = input.update.captureId ?? input.existing.captureId
    if (
      input.update.status !== 'succeeded' ||
      nextCaptureId !== input.existing.captureId
    ) {
      throw new VaultCliError(
        'ASSISTANT_INPUT_PROJECTION_TERMINAL',
        'Assistant input projection success is terminal for the same capture id.',
      )
    }
  }

  const nextProjection: AssistantInputEventProjection = {
    captureId: null,
    lastAttemptedAt:
      input.update.lastAttemptedAt ?? input.existing.lastAttemptedAt,
    reasonCode: null,
    status: input.update.status,
    updatedAt: input.now,
  }

  if (input.update.status === 'succeeded') {
    nextProjection.captureId =
      input.update.captureId ?? input.existing.captureId
  }
  if (
    input.update.status === 'failed' ||
    input.update.status === 'quarantined'
  ) {
    nextProjection.reasonCode =
      input.update.reasonCode ?? input.existing.reasonCode
  }

  return assistantInputProjectionSchema.parse(nextProjection)
}

function applyAssistantInputAttachmentEvidenceUpdate(input: {
  now: string
  update: AssistantInputAttachmentEvidence
}): AssistantInputAttachmentEvidence {
  if (input.update.status === 'not_attempted') {
    return assistantInputAttachmentEvidenceSchema.parse(
      DEFAULT_ASSISTANT_INPUT_ATTACHMENT_EVIDENCE,
    )
  }

  return assistantInputAttachmentEvidenceSchema.parse({
    ...input.update,
    updatedAt: input.update.updatedAt ?? input.now,
  })
}

function assertValidAssistantInputProjection(
  projection: {
    captureId: string | null
    lastAttemptedAt: string | null
    reasonCode: string | null
    status: AssistantInputProjectionStatus
    updatedAt: string | null
  },
  context: z.RefinementCtx,
): void {
  if (projection.status === 'succeeded') {
    if (!projection.captureId) {
      context.addIssue({
        code: 'custom',
        message: 'succeeded projection status requires captureId.',
      })
    }
    if (projection.reasonCode !== null) {
      context.addIssue({
        code: 'custom',
        message: 'succeeded projection status must not include reasonCode.',
      })
    }
    return
  }

  if (projection.captureId !== null) {
    context.addIssue({
      code: 'custom',
      message: 'non-succeeded projection status must not include captureId.',
    })
  }

  if (
    projection.status === 'failed' ||
    projection.status === 'quarantined'
  ) {
    if (!projection.reasonCode) {
      context.addIssue({
        code: 'custom',
        message: 'failed or quarantined projection status requires reasonCode.',
      })
    }
    return
  }

  if (projection.reasonCode !== null) {
    context.addIssue({
      code: 'custom',
      message:
        'projection reasonCode is only valid for failed or quarantined status.',
    })
  }
}

function assertValidAssistantInputAttachmentEvidence(
  evidence: AssistantInputAttachmentEvidence,
  context: z.RefinementCtx,
): void {
  if (evidence.status === 'failed' && !evidence.reasonCode) {
    context.addIssue({
      code: 'custom',
      message: 'failed attachment evidence status requires reasonCode.',
      path: ['reasonCode'],
    })
  }

  if (evidence.status === 'not_attempted') {
    if (evidence.reasonCode !== null) {
      context.addIssue({
        code: 'custom',
        message: 'not_attempted attachment evidence must not include reasonCode.',
        path: ['reasonCode'],
      })
    }
    if (evidence.updatedAt !== null) {
      context.addIssue({
        code: 'custom',
        message: 'not_attempted attachment evidence must not include updatedAt.',
        path: ['updatedAt'],
      })
    }
    if (evidence.source !== null) {
      context.addIssue({
        code: 'custom',
        message: 'not_attempted attachment evidence must not include source.',
        path: ['source'],
      })
    }
    if (evidence.optionalInboxCaptureId !== null) {
      context.addIssue({
        code: 'custom',
        message: 'not_attempted attachment evidence must not include optionalInboxCaptureId.',
        path: ['optionalInboxCaptureId'],
      })
    }
    if (evidence.attachments.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'not_attempted attachment evidence must not include attachments.',
        path: ['attachments'],
      })
    }
  }
}

function safeAssistantInputTokenSchema(fieldName: string) {
  return z
    .string()
    .min(1)
    .max(192)
    .regex(ASSISTANT_INPUT_EVENT_SAFE_TOKEN_PATTERN)
    .superRefine((value, context) => {
      if (isUnsafeAssistantInputScalar(value)) {
        context.addIssue({
          code: 'custom',
          message: `${fieldName} must be an opaque token, not a path, URL, email, or raw payload.`,
        })
      }
    })
}

function safeNullableAssistantInputTokenSchema(
  fieldName: string,
) {
  return safeAssistantInputTokenSchema(fieldName).nullable().default(null)
}

function privateAssistantInputRouteScalarSchema(fieldName: string) {
  return z
    .string()
    .trim()
    .min(1)
    .max(ASSISTANT_INPUT_EVENT_REPLY_TARGET_MAX_LENGTH)
    .superRefine((value, context) => {
      if (hasControlCharacters(value)) {
        context.addIssue({
          code: 'custom',
          message: `${fieldName} must not contain control characters.`,
        })
        return
      }
      if (isUnsafeAssistantInputRouteScalar(value)) {
        context.addIssue({
          code: 'custom',
          message: `${fieldName} must be bounded route authority, not a path, URL, raw payload, or secret.`,
        })
      }
    })
}

function privateNullableAssistantInputRouteScalarSchema(fieldName: string) {
  return privateAssistantInputRouteScalarSchema(fieldName).nullable().default(null)
}

function safeAssistantInputTimestampSchema(
  fieldName: string,
) {
  return z
    .string()
    .min(1)
    .max(64)
    .datetime({ offset: true })
    .superRefine((value, context) => {
      if (isPathOrUrlLike(value)) {
        context.addIssue({
          code: 'custom',
          message: `${fieldName} must not contain paths or URLs.`,
        })
      }
    })
}

function safeNullableAssistantInputTimestampSchema(
  fieldName: string,
) {
  return safeAssistantInputTimestampSchema(fieldName).nullable().default(null)
}

function safeNullableAssistantInputPositionSchema(
  fieldName: string,
) {
  return z
    .string()
    .min(1)
    .max(320)
    .superRefine((value, context) => {
      if (isUnsafeAssistantInputScalar(value)) {
        context.addIssue({
          code: 'custom',
          message: `${fieldName} must not contain paths, URLs, emails, or raw payloads.`,
        })
      }
    })
    .nullable()
    .default(null)
}

function safeAssistantInputReasonCodeSchema() {
  return z
    .string()
    .min(1)
    .max(96)
    .regex(ASSISTANT_INPUT_EVENT_REASON_CODE_PATTERN)
}

function safeNullableAssistantInputReasonCodeSchema() {
  return safeAssistantInputReasonCodeSchema().nullable().default(null)
}

function safeNullableAssistantInputSha256Schema() {
  return z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable()
    .default(null)
}

function safeAssistantInputArtifactPathSchema(
  fieldName: string,
  allowedPrefixes: readonly string[],
) {
  return z
    .string()
    .min(1)
    .max(ASSISTANT_INPUT_EVENT_ARTIFACT_PATH_MAX_LENGTH)
    .transform((value) => normalizeAssistantAttachmentArtifactPath(value) ?? value)
    .superRefine((value, context) => {
      assertSafeAssistantInputArtifactPath(value, context, fieldName, allowedPrefixes)
    })
}

function safeAssistantInputArtifactRootSchema(
  fieldName: string,
  allowedPrefixes: readonly string[],
) {
  return z
    .string()
    .min(1)
    .max(ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_ALLOWED_ROOT_MAX_LENGTH)
    .transform((value) => normalizeAssistantAttachmentArtifactPath(value) ?? value)
    .superRefine((value, context) => {
      assertSafeAssistantInputArtifactPath(value, context, fieldName, allowedPrefixes)
    })
}

function safeAssistantInputAttachmentEvidenceLabelSchema(fieldName: string) {
  return z
    .string()
    .min(1)
    .max(ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_LABEL_MAX_LENGTH)
    .regex(ASSISTANT_INPUT_EVENT_SAFE_TOKEN_PATTERN)
    .superRefine((value, context) => {
      if (isUnsafeAssistantInputScalar(value)) {
        context.addIssue({
          code: 'custom',
          message: `${fieldName} must be an opaque label, not a path, URL, email, or raw payload.`,
        })
      }
    })
}

function safeAssistantInputAttachmentEvidenceTextSchema(fieldName: string) {
  return z
    .string()
    .min(1)
    .max(ASSISTANT_INPUT_EVENT_ATTACHMENT_EVIDENCE_TEXT_MAX_LENGTH, {
      message: `${fieldName} must be bounded prompt evidence.`,
    })
    .superRefine((value, context) => {
      assertSafeAssistantInputText(value, context, fieldName)
    })
}

function assertSafeAssistantInputArtifactPath(
  value: string,
  context: z.RefinementCtx,
  fieldName: string,
  allowedPrefixes: readonly string[],
): void {
  const normalized = normalizeAssistantAttachmentArtifactPath(value)
  if (!normalized || normalized !== value) {
    context.addIssue({
      code: 'custom',
      message: `${fieldName} must be a normalized vault-relative artifact path.`,
    })
    return
  }
  if (!allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    context.addIssue({
      code: 'custom',
      message: `${fieldName} must point to an allowed raw or derived vault artifact root.`,
    })
    return
  }
}

function safeAssistantInputTextSchema(fieldName: string) {
  return z
    .string()
    .max(ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH)
    .superRefine((value, context) => {
      assertSafeAssistantInputText(value, context, fieldName)
    })
}

function safeNullableAssistantInputTextSchema(
  fieldName: string,
) {
  return safeAssistantInputTextSchema(fieldName).nullable().default(null)
}

function safeAssistantInputMetadataTextSchema(fieldName: string) {
  return z
    .string()
    .max(ASSISTANT_INPUT_EVENT_SOURCE_METADATA_TEXT_MAX_LENGTH)
    .superRefine((value, context) => {
      assertSafeAssistantInputText(value, context, fieldName)
    })
}

function safeNullableAssistantInputMetadataTextSchema(
  fieldName: string,
) {
  return safeAssistantInputMetadataTextSchema(fieldName).nullable().default(null)
}

function safeAttachmentTokenSchema(fieldName: string) {
  return safeNullableAssistantInputTokenSchema(fieldName)
}

function assertUniqueAssistantInputAttachmentEvidenceField(input: {
  context: z.RefinementCtx
  fieldName: 'descriptorAttachmentId' | 'ordinal' | 'sourceAttachmentId'
  values: readonly (string | null)[]
}) {
  const seen = new Map<string, number>()
  input.values.forEach((value, index) => {
    if (value === null) {
      return
    }
    const firstIndex = seen.get(value)
    if (firstIndex === undefined) {
      seen.set(value, index)
      return
    }
    input.context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        `attachmentEvidence.attachments ${input.fieldName} values must be unique.`,
      path: ['attachments', index, input.fieldName],
    })
  })
}

function safeAttachmentFileNameSchema() {
  return z
    .string()
    .max(191)
    .regex(ASSISTANT_INPUT_EVENT_SAFE_FILE_NAME_PATTERN)
    .nullable()
    .default(null)
    .superRefine((value, context) => {
      if (value === null) {
        return
      }
      if (value === '.' || value === '..') {
        context.addIssue({
          code: 'custom',
          message: 'fileName must not be a path segment sentinel.',
        })
        return
      }
      if (isPathOrUrlLike(value)) {
        context.addIssue({
          code: 'custom',
          message: 'fileName must not contain paths or URLs.',
        })
      }
    })
}

function safeAttachmentContentTypeSchema() {
  return z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,126}$/u)
    .nullable()
    .default(null)
}

function assertSafeAssistantInputText(
  text: string,
  context: z.RefinementCtx,
  fieldName: string,
): void {
  const lowerText = text.toLowerCase()

  if (
    looksLikeRawEmailHeaders(text) ||
    lowerText.includes('-----begin private key-----') ||
    lowerText.includes('"authorization"') ||
    hasProviderRequestPayloadShape(text)
  ) {
    context.addIssue({
      code: 'custom',
      message:
        `${fieldName} must be prompt-ready content, not raw email, secrets, or provider request payloads.`,
    })
  }
}

function hasProviderRequestPayloadShape(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false
  }

  try {
    return jsonValueHasProviderRequestShape(JSON.parse(trimmed), 0)
  } catch {
    return false
  }
}

function jsonValueHasProviderRequestShape(value: unknown, depth: number): boolean {
  if (depth > 4 || value === null || typeof value !== 'object') {
    return false
  }

  if (Array.isArray(value)) {
    return value.some((item) => jsonValueHasProviderRequestShape(item, depth + 1))
  }

  const entries = Object.entries(value)
  const keys = new Set(entries.map(([key]) => key.toLowerCase()))
  if (
    keys.has('authorization') ||
    keys.has('cookie') ||
    keys.has('set-cookie') ||
    keys.has('headers')
  ) {
    return true
  }
  if (
    (keys.has('messages') || keys.has('input')) &&
    (keys.has('model') || keys.has('tools') || keys.has('tool_choice'))
  ) {
    return true
  }

  return entries.some(([, entryValue]) =>
    jsonValueHasProviderRequestShape(entryValue, depth + 1),
  )
}

function looksLikeRawEmailHeaders(text: string): boolean {
  const headerBlock = text.split(/\r?\n\r?\n/u, 1)[0] ?? ''
  const rawHeaderNames = new Set([
    'content-transfer-encoding',
    'content-type',
    'date',
    'dkim-signature',
    'from',
    'message-id',
    'mime-version',
    'received',
    'reply-to',
    'return-path',
    'subject',
    'to',
  ])
  let rawHeaderCount = 0
  for (const line of headerBlock.split(/\r?\n/u).slice(0, 80)) {
    const headerName = /^([A-Za-z][A-Za-z0-9-]{1,63})\s*:/u.exec(line)?.[1]
    if (!headerName) {
      continue
    }
    if (rawHeaderNames.has(headerName.toLowerCase())) {
      rawHeaderCount += 1
      if (rawHeaderCount >= 2) {
        return true
      }
    }
  }
  return false
}

function isUnsafeAssistantInputScalar(value: string): boolean {
  return (
    isPathOrUrlLike(value) ||
    value.includes('@') ||
    value.includes('{') ||
    value.includes('}') ||
    value.includes('"') ||
    value.toLowerCase().includes('authorization')
  )
}

function isUnsafeAssistantInputRouteScalar(value: string): boolean {
  const lowerValue = value.toLowerCase()
  return (
    isPathOrUrlLike(value) ||
    value.includes('{') ||
    value.includes('}') ||
    value.includes('"') ||
    lowerValue.includes('authorization') ||
    lowerValue.includes('set-cookie') ||
    lowerValue.includes('x-api-key')
  )
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value)
}

function isPathOrUrlLike(value: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith('/') ||
    value.startsWith('~/') ||
    value.includes('\\') ||
    value.includes('../') ||
    value.includes('/../') ||
    value.includes('?') ||
    value.includes('#')
  )
}

export function compareAssistantInputCursors(
  left: AssistantInputCursor,
  right: AssistantInputCursor,
): number {
  const leftSourceLane = left.sourcePosition
    ? assistantInputCursorSourceLane(left.sourcePosition)
    : null
  const rightSourceLane = right.sourcePosition
    ? assistantInputCursorSourceLane(right.sourcePosition)
    : null
  if (
    left.sourcePosition &&
    right.sourcePosition &&
    leftSourceLane &&
    leftSourceLane === rightSourceLane
  ) {
    const positionOrder = left.sourcePosition.localeCompare(right.sourcePosition)
    if (
      positionOrder !== 0 &&
      leftSourceLane.startsWith('hosted-mailbox:')
    ) {
      return positionOrder
    }
  }

  const leftTimestamp = left.createdAt ?? left.occurredAt
  const rightTimestamp = right.createdAt ?? right.occurredAt

  const timestampOrder = compareAssistantTimestampsAscending(
    leftTimestamp,
    rightTimestamp,
  )
  if (timestampOrder !== 0) {
    return timestampOrder
  }

  if (
    left.sourcePosition &&
    right.sourcePosition &&
    leftSourceLane &&
    leftSourceLane === rightSourceLane
  ) {
    const positionOrder = left.sourcePosition.localeCompare(right.sourcePosition)
    if (positionOrder !== 0) {
      return positionOrder
    }
  }

  if (left.sourceKind !== right.sourceKind) {
    return left.sourceKind.localeCompare(right.sourceKind)
  }

  return left.inputId.localeCompare(right.inputId)
}

function assistantInputCursorSourceLane(sourcePosition: string): string | null {
  const [source, lane] = sourcePosition.split(':', 3)
  return source && lane ? `${source}:${lane}` : null
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value))
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item))
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, stableJsonValue(entryValue)]),
    )
  }
  return value
}
