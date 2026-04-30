import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
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
  type AssistantConversationCaptureRef,
} from './conversation-ref.js'
import { isMissingFileError, resolveTimestamp } from './shared.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'

export const ASSISTANT_INPUT_EVENT_SCHEMA = 'murph.assistant-input-event.v1'
export const ASSISTANT_INPUT_EVENT_SCHEMA_VERSION = 1
export const ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH = 20_000
export const ASSISTANT_INPUT_EVENT_ATTACHMENT_DESCRIPTOR_MAX_COUNT = 32
const ASSISTANT_INPUT_EVENT_REPLY_TARGET_MAX_LENGTH = 512

export type AssistantInputConversationRef = AssistantConversationCaptureRef
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
const ASSISTANT_INPUT_EVENT_SAFE_FILE_NAME_PATTERN = /^[^/\\:?#[\]\r\n]{1,191}$/u

const assistantInputProjectionStatusValues = [
  'not_attempted',
  'pending',
  'succeeded',
  'failed',
  'quarantined',
] as const satisfies readonly AssistantInputProjectionStatus[]

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
    nextAttemptAfter: safeNullableAssistantInputTimestampSchema('nextAttemptAfter'),
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

const assistantInputEventRecordSchema = z
  .object({
    content: assistantInputContentSchema,
    conversation: assistantInputConversationRefSchema.nullable().default(null),
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
    sourceRef: assistantInputSourceRefSchema,
    storedAt: safeAssistantInputTimestampSchema('storedAt'),
    updatedAt: safeAssistantInputTimestampSchema('updatedAt'),
  })
  .strict()

const assistantInputProjectionUpdateSchema = z
  .object({
    captureId: safeAssistantInputTokenSchema('captureId').nullable().optional(),
    lastAttemptedAt: safeAssistantInputTimestampSchema(
      'lastAttemptedAt',
    ).nullable().optional(),
    nextAttemptAfter: safeAssistantInputTimestampSchema(
      'nextAttemptAfter',
    ).nullable().optional(),
    reasonCode: safeAssistantInputReasonCodeSchema().nullable().optional(),
    status: z.enum(assistantInputProjectionStatusValues),
    updatedAt: safeAssistantInputTimestampSchema('updatedAt')
      .nullable()
      .optional(),
  })
  .strict()

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
export type AssistantInputEventRecord = z.infer<
  typeof assistantInputEventRecordSchema
>

export interface UpsertAssistantInputEventInput {
  content?: z.input<typeof assistantInputContentSchema>
  conversation?: AssistantInputConversationRef | null
  occurredAt: string
  receivedAt?: string | null
  replyTarget?: z.input<typeof assistantInputReplyTargetSchema> | null
  sourceRef: AssistantInputSourceRef
}

export interface AssistantInputEventRecordParseFailure {
  error: unknown
  fileName: string
}

export function createAssistantInputEventId(input: {
  sourceRef: AssistantInputSourceRef
}): string {
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

export async function listAssistantInputEvents(input: {
  afterCursor?: AssistantInputCursor | null
  conversation?: AssistantInputConversationRef | null
  limit?: number
  onInvalidRecord?: ((failure: AssistantInputEventRecordParseFailure) => void) | null
  paths?: AssistantStatePaths
  skipInvalidRecords?: boolean
  source?: string | null
  vault?: string
}): Promise<{
  events: AssistantInputEventRecord[]
  nextCursor: AssistantInputCursor | null
}> {
  const { paths } = resolveAssistantInputContext(input)
  const limit = normalizeAssistantInputEventListLimit(input.limit)
  const onInvalidRecord = input.onInvalidRecord ?? null
  const skipInvalidRecords = input.skipInvalidRecords ?? false
  const directory = resolveAssistantInputEventsDirectory(paths)

  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    })
    const records: AssistantInputEventRecord[] = []

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
        records.push(parseAssistantInputEventFile(JSON.parse(raw)))
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
  const listed = await listAssistantInputEvents({
    limit: Number.MAX_SAFE_INTEGER,
    onInvalidRecord: input.onInvalidRecord,
    paths: input.paths,
    skipInvalidRecords: input.skipInvalidRecords,
    vault: input.vault,
  })

  return listed.events.at(-1)?.cursor ?? null
}

export async function listAssistantInputProjectionAttempts(input: {
  afterCursor?: AssistantInputCursor | null
  limit?: number
  now?: Date
  onInvalidRecord?: ((failure: AssistantInputEventRecordParseFailure) => void) | null
  paths?: AssistantStatePaths
  skipInvalidRecords?: boolean
  vault?: string
}): Promise<{
  events: AssistantInputEventRecord[]
  nextCursor: AssistantInputCursor | null
}> {
  const now = resolveTimestamp(input.now)
  const limit = normalizeAssistantInputEventListLimit(input.limit)
  const listed = await listAssistantInputEvents({
    afterCursor: input.afterCursor,
    limit: Number.MAX_SAFE_INTEGER,
    onInvalidRecord: input.onInvalidRecord,
    paths: input.paths,
    skipInvalidRecords: input.skipInvalidRecords,
    vault: input.vault,
  })

  const events = listed.events
    .filter((event) =>
      isAssistantInputProjectionAttemptDue(event.projection, now),
    )
    .slice(0, limit)

  return {
    events,
    // Projection retry eligibility is ordered by retry time, not by event
    // cursor. Returning a cursor here can skip an older future-due record once
    // it becomes due, so this scan is intentionally non-paginated.
    nextCursor: null,
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
    const filePath = resolveAssistantInputEventPath({
      inputId: input.inputId,
      paths: input.paths,
    })
    await assertAssistantStatePathHasNoSymlinks(filePath)
    const raw = await readFile(filePath, 'utf8')
    return parseAssistantInputEventFile(JSON.parse(raw))
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
      nextAttemptAfter: null,
      reasonCode: null,
      status: 'not_attempted',
      updatedAt: null,
    },
    receivedAt: input.event.receivedAt ?? null,
    replyTarget: input.event.replyTarget ?? null,
    schema: ASSISTANT_INPUT_EVENT_SCHEMA,
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

  throw new VaultCliError(
    'ASSISTANT_INPUT_EVENT_CONFLICT',
    'Assistant input event replay changed immutable input content for the same source reference.',
    {
      inputId: input.existing.inputId,
    },
  )
}

function assistantInputEventImmutableIdentity(
  record: AssistantInputEventRecord,
): unknown {
  return {
    content: record.content,
    conversation: record.conversation,
    occurredAt: record.occurredAt,
    replyTarget: record.replyTarget,
    sourceRef: record.sourceRef,
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
    eventId: sourceRef.eventId,
    itemId: sourceRef.itemId,
    kind: sourceRef.kind,
    lane: sourceRef.lane,
    laneSeq: sourceRef.laneSeq,
  }
}

function assistantInputSourcePosition(
  sourceRef: AssistantInputSourceRef,
): string | null {
  if (sourceRef.kind !== 'hosted-mailbox') {
    return null
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
    nextAttemptAfter: Object.hasOwn(input.update, 'nextAttemptAfter')
      ? input.update.nextAttemptAfter ?? null
      : input.existing.nextAttemptAfter,
    reasonCode: null,
    status: input.update.status,
    updatedAt: input.now,
  }

  if (input.update.status === 'succeeded') {
    nextProjection.captureId =
      input.update.captureId ?? input.existing.captureId
    nextProjection.nextAttemptAfter = null
  }
  if (
    input.update.status === 'failed' ||
    input.update.status === 'quarantined'
  ) {
    nextProjection.reasonCode =
      input.update.reasonCode ?? input.existing.reasonCode
  }
  if (input.update.status === 'quarantined') {
    nextProjection.nextAttemptAfter = null
  }

  return assistantInputProjectionSchema.parse(nextProjection)
}

function isAssistantInputProjectionAttemptDue(
  projection: AssistantInputEventProjection,
  now: string,
): boolean {
  if (projection.status !== 'pending' && projection.status !== 'failed') {
    return false
  }
  return !projection.nextAttemptAfter || projection.nextAttemptAfter <= now
}

function assertValidAssistantInputProjection(
  projection: {
    captureId: string | null
    lastAttemptedAt: string | null
    nextAttemptAfter: string | null
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

function safeAttachmentTokenSchema(fieldName: string) {
  return safeNullableAssistantInputTokenSchema(fieldName)
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
  const lines = text.split(/\r?\n/u)
  const lowerText = text.toLowerCase()
  const forbiddenLinePatterns = [
    /^authorization\s*:/iu,
    /^cookie\s*:/iu,
    /^set-cookie\s*:/iu,
    /^x-api-key\s*:/iu,
  ]

  for (const line of lines) {
    if (forbiddenLinePatterns.some((pattern) => pattern.test(line))) {
      context.addIssue({
        code: 'custom',
        message: `${fieldName} must be minimized and must not contain auth headers.`,
      })
      return
    }
  }

  if (containsPathOrUrlToken(text)) {
    context.addIssue({
      code: 'custom',
      message: `${fieldName} must be minimized and must not contain paths or URLs.`,
    })
    return
  }

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

function containsPathOrUrlToken(text: string): boolean {
  return /(?:^|[\s("'=])(?:https?:\/\/|file:\/\/|[A-Za-z]:[\\/]|\/[^\s"'<>]+|~\/|\.\.\/|\.\.\\)/u.test(
    text,
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

function compareAssistantInputCursors(
  left: AssistantInputCursor,
  right: AssistantInputCursor,
): number {
  if (
    left.sourcePosition &&
    right.sourcePosition &&
    assistantInputCursorSourceLane(left) === assistantInputCursorSourceLane(right)
  ) {
    const positionOrder = left.sourcePosition.localeCompare(right.sourcePosition)
    if (positionOrder !== 0) {
      return positionOrder
    }
  }

  const useCreatedAt = Boolean(left.createdAt && right.createdAt)
  const leftTimestamp = useCreatedAt ? left.createdAt! : left.occurredAt
  const rightTimestamp = useCreatedAt ? right.createdAt! : right.occurredAt

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp)
  }

  return left.inputId.localeCompare(right.inputId)
}

function assistantInputCursorSourceLane(
  cursor: AssistantInputCursor,
): 'conversation' | 'system' | null {
  const match = /^hosted-mailbox:(conversation|system):/u.exec(
    cursor.sourcePosition ?? '',
  )
  return match ? match[1] as 'conversation' | 'system' : null
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
