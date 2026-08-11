import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import {
  assistantSessionIdSchema,
  assistantTurnIdSchema,
} from '@murphai/operator-config/assistant-cli-contracts'
import { isoTimestampSchema } from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { resolveAssistantOpaqueStateFilePath } from './state-ids.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { ensureAssistantState } from './store/persistence.js'
import {
  ASSISTANT_INPUT_EVENT_SCHEMA,
  readAssistantInputEvent,
  type AssistantInputEventRecord,
} from './input-store.js'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store/paths.js'

export const ASSISTANT_ACCEPTED_TURN_INPUT_JOURNAL_SCHEMA =
  'murph.assistant-accepted-turn-input-journal.v1'
export const ASSISTANT_ACCEPTED_TURN_INPUT_MATERIALIZER_VERSION = 1

export const assistantActiveTurnInputAdmissionStateValues = [
  'current-turn-open',
  'passive-input-next-turn',
  'commit-started',
] as const

export const assistantAcceptedTurnInputSourceValues = [
  'assistant-input',
  'initial',
  'manual',
  'system',
] as const

export const assistantCodexContinuationKindValues = [
  'explicit-structured-history',
  'provider-state-optimization',
  'thread-start',
] as const

export const assistantAcceptedTurnInputPromptFallbackReasonValues = [
  'missing-transcript-ref',
  'missing-content-ref',
  'manual-input',
  'system-input',
] as const

const assistantAcceptedTurnInputTranscriptRefSchema = z
  .object({
    sessionId: assistantSessionIdSchema,
    entryIndex: z.number().int().nonnegative().nullable().default(null),
    entryCreatedAt: isoTimestampSchema.nullable().default(null),
    entryKind: z.enum(['user', 'assistant', 'error', 'status']).nullable().default(null),
  })
  .strict()

const assistantAcceptedTurnInputContentRefSchema = z
  .object({
    kind: z.enum([
      'transcript-entry',
      'assistant-runtime-artifact',
      'assistant-input-event',
      'provider-output',
      'manual',
      'system',
    ]),
    refId: z.string().min(1),
    version: z.string().min(1).nullable().default(null),
  })
  .strict()

const assistantAcceptedTurnInputPromptFallbackSchema = z
  .object({
    reason: z.enum(assistantAcceptedTurnInputPromptFallbackReasonValues),
    textLengthBucket: z.enum(['1-64', '65-256', '257-1024', '1025+']),
  })
  .strict()

export const assistantAcceptedTurnInputItemSchema = z
  .object({
    id: z.string().min(1),
    acceptedAt: isoTimestampSchema,
    source: z.enum(assistantAcceptedTurnInputSourceValues),
    captureIds: z.array(z.string().min(1)),
    transcriptRef: assistantAcceptedTurnInputTranscriptRefSchema.nullable(),
    contentRef: assistantAcceptedTurnInputContentRefSchema.nullable(),
    promptFallback: assistantAcceptedTurnInputPromptFallbackSchema.nullable(),
  })
  .strict()

const assistantCodexContinuationSchema = z.union([
  z
    .object({
      kind: z.literal('explicit-structured-history'),
    })
    .strict(),
  z.preprocess(
    (value) =>
      value &&
      typeof value === 'object' &&
      Reflect.get(value, 'kind') === 'provider-state-optimization'
        ? { kind: 'provider-state-optimization' }
        : value,
    z
      .object({
        kind: z.literal('provider-state-optimization'),
      })
      .strict(),
  ),
  z
    .object({
      kind: z.literal('thread-start'),
    })
    .strict(),
])

export const assistantAcceptedTurnInputProviderRequestSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    requestedAt: isoTimestampSchema,
    providerAttemptId: z.string().min(1).nullable().default(null),
    acceptedInputIds: z.array(z.string().min(1)),
    continuation: assistantCodexContinuationSchema,
  })
  .strict()

export const assistantAcceptedTurnInputJournalSchema = z
  .object({
    schema: z.literal(ASSISTANT_ACCEPTED_TURN_INPUT_JOURNAL_SCHEMA),
    materializerVersion: z.literal(ASSISTANT_ACCEPTED_TURN_INPUT_MATERIALIZER_VERSION),
    turnId: assistantTurnIdSchema,
    sessionId: assistantSessionIdSchema,
    admissionState: z.enum(assistantActiveTurnInputAdmissionStateValues),
    inputIds: z.array(z.string().min(1)),
    inputs: z.array(assistantAcceptedTurnInputItemSchema),
    providerRequests: z.array(assistantAcceptedTurnInputProviderRequestSchema),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((journal, context) => {
    if (journal.inputIds.length !== journal.inputs.length) {
      context.addIssue({
        code: 'custom',
        message: 'inputIds must align one-to-one with inputs.',
        path: ['inputIds'],
      })
    }

    const seen = new Set<string>()
    const inputIndexes = new Map<string, number>()
    for (let index = 0; index < journal.inputs.length; index += 1) {
      const input = journal.inputs[index]
      if (!input) {
        continue
      }
      if (journal.inputIds[index] !== input.id) {
        context.addIssue({
          code: 'custom',
          message: 'inputIds must preserve input order.',
          path: ['inputIds', index],
        })
      }
      if (seen.has(input.id)) {
        context.addIssue({
          code: 'custom',
          message: 'accepted turn input ids must be unique.',
          path: ['inputs', index, 'id'],
        })
      }
      seen.add(input.id)
      inputIndexes.set(input.id, index)
      if (input.source === 'assistant-input') {
        if (
          input.contentRef?.kind !== 'assistant-input-event' ||
          input.contentRef.refId !== input.id ||
          input.contentRef.version !== ASSISTANT_INPUT_EVENT_SCHEMA
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'assistant-input accepted turn inputs must reference the matching assistant input event.',
            path: ['inputs', index, 'contentRef'],
          })
        }
      }
    }

    let previousProviderRequestOrdinal = -1
    let previousProviderRequestInputCount = -1
    for (let requestIndex = 0; requestIndex < journal.providerRequests.length; requestIndex += 1) {
      const request = journal.providerRequests[requestIndex]
      if (!request) {
        continue
      }
      if (request.ordinal <= previousProviderRequestOrdinal) {
        context.addIssue({
          code: 'custom',
          message: 'provider request ordinals must be strictly increasing.',
          path: ['providerRequests', requestIndex, 'ordinal'],
        })
      }
      previousProviderRequestOrdinal = request.ordinal
      if (request.acceptedInputIds.length < previousProviderRequestInputCount) {
        context.addIssue({
          code: 'custom',
          message:
            'provider request acceptedInputIds must be nondecreasing accepted-input prefixes.',
          path: ['providerRequests', requestIndex, 'acceptedInputIds'],
        })
      }
      previousProviderRequestInputCount = request.acceptedInputIds.length

      const requestInputIds = new Set<string>()
      let previousRequestInputIndex = -1
      for (let inputIndex = 0; inputIndex < request.acceptedInputIds.length; inputIndex += 1) {
        const inputId = request.acceptedInputIds[inputIndex]
        const acceptedInputIndex = inputIndexes.get(inputId)
        if (
          acceptedInputIndex === undefined ||
          requestInputIds.has(inputId) ||
          acceptedInputIndex <= previousRequestInputIndex ||
          journal.inputIds[inputIndex] !== inputId
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'provider request acceptedInputIds must be unique accepted journal inputs in accepted prefix order.',
            path: ['providerRequests', requestIndex, 'acceptedInputIds', inputIndex],
          })
        }
        requestInputIds.add(inputId)
        previousRequestInputIndex = acceptedInputIndex ?? previousRequestInputIndex
      }
    }
  })

export type AssistantActiveTurnInputAdmissionState =
  (typeof assistantActiveTurnInputAdmissionStateValues)[number]
export type AssistantAcceptedTurnInputSource =
  (typeof assistantAcceptedTurnInputSourceValues)[number]
export type AssistantAcceptedTurnInputJournal = z.infer<
  typeof assistantAcceptedTurnInputJournalSchema
>
export type AssistantAcceptedTurnInputItem = z.infer<
  typeof assistantAcceptedTurnInputItemSchema
>
export type AssistantAcceptedTurnInputProviderRequest = z.infer<
  typeof assistantAcceptedTurnInputProviderRequestSchema
>
export type AssistantCodexContinuation = z.infer<
  typeof assistantCodexContinuationSchema
>
export type AssistantAcceptedTurnInputPromptFallback = z.infer<
  typeof assistantAcceptedTurnInputPromptFallbackSchema
>
export type AssistantAcceptedTurnInputTranscriptRef = z.infer<
  typeof assistantAcceptedTurnInputTranscriptRefSchema
>
export type AssistantAcceptedTurnInputContentRef = z.infer<
  typeof assistantAcceptedTurnInputContentRefSchema
>

export interface AssistantAcceptedTurnInputItemInput {
  acceptedAt?: string
  captureIds?: readonly string[]
  contentRef?: z.input<typeof assistantAcceptedTurnInputContentRefSchema> | null
  id: string
  promptFallback?: AssistantAcceptedTurnInputPromptFallback | null
  promptFallbackReason?: AssistantAcceptedTurnInputPromptFallback['reason']
  promptFallbackText?: string | null
  source: AssistantAcceptedTurnInputSource
  transcriptRef?: z.input<typeof assistantAcceptedTurnInputTranscriptRefSchema> | null
}

export interface AssistantAcceptedTurnInputTranscriptRefUpdateInput {
  inputId: string
  transcriptRef: z.input<typeof assistantAcceptedTurnInputTranscriptRefSchema>
}

export function resolveAssistantAcceptedTurnInputReferenceAt(
  inputs: readonly AssistantAcceptedTurnInputItemInput[],
): string | null {
  let latestAtMs: number | null = null
  for (const input of inputs) {
    const acceptedAtMs = Date.parse(input.acceptedAt ?? '')
    if (
      Number.isFinite(acceptedAtMs)
      && (latestAtMs === null || acceptedAtMs > latestAtMs)
    ) {
      latestAtMs = acceptedAtMs
    }
  }
  return latestAtMs === null ? null : new Date(latestAtMs).toISOString()
}

export async function readAssistantAcceptedTurnInputJournal(
  vault: string,
  turnId: string,
): Promise<AssistantAcceptedTurnInputJournal | null> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  return readAssistantAcceptedTurnInputJournalAtPaths(paths, turnId)
}

export async function appendAssistantAcceptedTurnInputItems(input: {
  admissionState?: AssistantActiveTurnInputAdmissionState
  inputs: readonly AssistantAcceptedTurnInputItemInput[]
  now?: Date
  sessionId: string
  turnId: string
  vault: string
}): Promise<AssistantAcceptedTurnInputJournal> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const now = (input.now ?? new Date()).toISOString()
    const existing = await readAssistantAcceptedTurnInputJournalAtPaths(
      paths,
      input.turnId,
    )
    if (existing) {
      assertAssistantAcceptedTurnInputJournalAppendIdentity({
        existing,
        sessionId: input.sessionId,
      })
    }
    const base = existing ?? createEmptyAssistantAcceptedTurnInputJournal({
      admissionState: input.admissionState,
      createdAt: now,
      sessionId: input.sessionId,
      turnId: input.turnId,
    })
    const nextAdmissionState = input.admissionState ?? base.admissionState
    assertAssistantAcceptedTurnInputAdmissionStateTransition({
      existingAdmissionState: base.admissionState,
      nextAdmissionState,
    })
    const nextInputs = [...base.inputs]
    const existingIds = new Set(nextInputs.map((item) => item.id))
    let appendedInputCount = 0

    for (const item of input.inputs) {
      const parsed = parseAssistantAcceptedTurnInputItemInput({
        acceptedAt: now,
        input: item,
      })
      if (existingIds.has(parsed.id)) {
        continue
      }
      nextInputs.push(parsed)
      existingIds.add(parsed.id)
      appendedInputCount += 1
    }

    if (
      appendedInputCount > 0 &&
      nextAdmissionState !== 'current-turn-open'
    ) {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_ADMISSION_CLOSED',
        'Accepted turn input journal inputs cannot be appended after current-turn admission closes.',
      )
    }

    const updated = assistantAcceptedTurnInputJournalSchema.parse({
      ...base,
      admissionState: nextAdmissionState,
      inputIds: nextInputs.map((item) => item.id),
      inputs: nextInputs,
      updatedAt: now,
    })
    await writeAssistantAcceptedTurnInputJournalAtPaths(paths, updated)
    return updated
  })
}

export async function assertAssistantAcceptedTurnInputAssistantInputEventsExist(
  input: {
    journal: AssistantAcceptedTurnInputJournal
    vault: string
  },
): Promise<void> {
  await assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist({
    inputs: input.journal.inputs,
    vault: input.vault,
  })
}

export async function assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist(
  input: {
    inputs: readonly AssistantAcceptedTurnInputItemInput[]
    vault: string
  },
): Promise<void> {
  for (const item of input.inputs) {
    if (item.source !== 'assistant-input') {
      continue
    }
    const contentRef = item.contentRef
    if (
      contentRef?.kind !== 'assistant-input-event' ||
      contentRef.refId !== item.id ||
      contentRef.version !== ASSISTANT_INPUT_EVENT_SCHEMA
    ) {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_ASSISTANT_INPUT_REF',
        'Accepted assistant input must reference the matching assistant input event.',
      )
    }
    const event = await readAssistantInputEvent({
      inputId: contentRef.refId,
      vault: input.vault,
    })
    if (!event) {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_MISSING_ASSISTANT_INPUT_EVENT',
        'Accepted assistant input must resolve to a stored assistant input event before checkpointing.',
        {
          inputId: contentRef.refId,
        },
      )
    }
    assertAssistantAcceptedTurnInputEventMatchesRef({
      event,
      inputId: item.id,
    })
  }
}

export async function updateAssistantAcceptedTurnInputTranscriptRefs(input: {
  now?: Date
  refs: readonly AssistantAcceptedTurnInputTranscriptRefUpdateInput[]
  turnId: string
  vault: string
}): Promise<AssistantAcceptedTurnInputJournal | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const existing = await readAssistantAcceptedTurnInputJournalAtPaths(
      paths,
      input.turnId,
    )
    if (!existing) {
      return null
    }
    if (input.refs.length === 0) {
      return existing
    }
    if (existing.admissionState !== 'current-turn-open') {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_ADMISSION_CLOSED',
        'Accepted turn input transcript refs cannot be updated after current-turn admission closes.',
      )
    }

    const refsByInputId = new Map<string, AssistantAcceptedTurnInputTranscriptRef>()
    for (const refUpdate of input.refs) {
      if (refsByInputId.has(refUpdate.inputId)) {
        throw new VaultCliError(
          'ASSISTANT_TURN_INPUT_JOURNAL_DUPLICATE_REF_UPDATE',
          'Accepted turn input transcript ref updates must target each input id at most once.',
        )
      }
      const transcriptRef = assistantAcceptedTurnInputTranscriptRefSchema.parse(
        refUpdate.transcriptRef,
      )
      if (transcriptRef.sessionId !== existing.sessionId) {
        throw new VaultCliError(
          'ASSISTANT_TURN_INPUT_JOURNAL_IDENTITY_MISMATCH',
          'Accepted turn input transcript refs must use the journal session id.',
        )
      }
      assertAssistantAcceptedTurnInputTranscriptRefMaterialized(transcriptRef)
      refsByInputId.set(refUpdate.inputId, transcriptRef)
    }

    let appliedUpdateCount = 0
    const nextInputs = existing.inputs.map((item) => {
      const transcriptRef = refsByInputId.get(item.id)
      if (!transcriptRef) {
        return item
      }
      appliedUpdateCount += 1
      assertAssistantAcceptedTurnInputTranscriptRefNotOverwritten({
        existing: item.transcriptRef,
        next: transcriptRef,
      })
      return {
        ...item,
        transcriptRef,
      }
    })

    if (appliedUpdateCount !== refsByInputId.size) {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_INPUT_NOT_FOUND',
        'Accepted turn input transcript ref updates must target existing input ids.',
      )
    }

    const updated = assistantAcceptedTurnInputJournalSchema.parse({
      ...existing,
      inputs: nextInputs,
      updatedAt: (input.now ?? new Date()).toISOString(),
    })
    await writeAssistantAcceptedTurnInputJournalAtPaths(paths, updated)
    return updated
  })
}

function assertAssistantAcceptedTurnInputTranscriptRefMaterialized(
  transcriptRef: AssistantAcceptedTurnInputTranscriptRef,
): void {
  if (
    transcriptRef.entryCreatedAt === null ||
    transcriptRef.entryIndex === null ||
    transcriptRef.entryKind === null
  ) {
    throw new VaultCliError(
      'ASSISTANT_TURN_INPUT_JOURNAL_INCOMPLETE_TRANSCRIPT_REF',
      'Accepted turn input transcript ref updates must use persisted transcript entry coordinates.',
    )
  }
}

function assertAssistantAcceptedTurnInputTranscriptRefNotOverwritten(input: {
  existing: AssistantAcceptedTurnInputTranscriptRef | null
  next: AssistantAcceptedTurnInputTranscriptRef
}): void {
  if (!input.existing || !isAssistantAcceptedTurnInputTranscriptRefMaterialized(input.existing)) {
    return
  }
  if (areAssistantAcceptedTurnInputTranscriptRefsEqual(input.existing, input.next)) {
    return
  }
  throw new VaultCliError(
    'ASSISTANT_TURN_INPUT_JOURNAL_TRANSCRIPT_REF_ALREADY_SET',
    'Accepted turn input transcript refs cannot overwrite existing persisted transcript entry coordinates.',
  )
}

function isAssistantAcceptedTurnInputTranscriptRefMaterialized(
  transcriptRef: AssistantAcceptedTurnInputTranscriptRef,
): boolean {
  return (
    transcriptRef.entryCreatedAt !== null &&
    transcriptRef.entryIndex !== null &&
    transcriptRef.entryKind !== null
  )
}

function areAssistantAcceptedTurnInputTranscriptRefsEqual(
  left: AssistantAcceptedTurnInputTranscriptRef,
  right: AssistantAcceptedTurnInputTranscriptRef,
): boolean {
  return (
    left.entryCreatedAt === right.entryCreatedAt &&
    left.entryIndex === right.entryIndex &&
    left.entryKind === right.entryKind &&
    left.sessionId === right.sessionId
  )
}

export async function updateAssistantAcceptedTurnInputAdmissionState(input: {
  admissionState: AssistantActiveTurnInputAdmissionState
  now?: Date
  turnId: string
  vault: string
}): Promise<AssistantAcceptedTurnInputJournal | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const existing = await readAssistantAcceptedTurnInputJournalAtPaths(
      paths,
      input.turnId,
    )
    if (!existing) {
      return null
    }
    assertAssistantAcceptedTurnInputAdmissionStateTransition({
      existingAdmissionState: existing.admissionState,
      nextAdmissionState: input.admissionState,
    })

    const updated = assistantAcceptedTurnInputJournalSchema.parse({
      ...existing,
      admissionState: input.admissionState,
      updatedAt: (input.now ?? new Date()).toISOString(),
    })
    await writeAssistantAcceptedTurnInputJournalAtPaths(paths, updated)
    return updated
  })
}

export async function recordAssistantAcceptedTurnInputProviderRequest(input: {
  acceptedInputIds?: readonly string[] | null
  continuation?: AssistantCodexContinuation
  now?: Date
  ordinal: number
  providerAttemptId?: string | null
  turnId: string
  vault: string
}): Promise<AssistantAcceptedTurnInputJournal | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const existing = await readAssistantAcceptedTurnInputJournalAtPaths(
      paths,
      input.turnId,
    )
    if (!existing) {
      return null
    }

    const acceptedInputIds = normalizeProviderRequestAcceptedInputIds({
      acceptedInputIds: input.acceptedInputIds,
      inputIds: existing.inputIds,
    })
    const requestedAt = (input.now ?? new Date()).toISOString()
    const providerRequest = assistantAcceptedTurnInputProviderRequestSchema.parse({
      acceptedInputIds,
      continuation: input.continuation ?? {
        kind: 'explicit-structured-history',
      },
      ordinal: input.ordinal,
      providerAttemptId: input.providerAttemptId ?? null,
      requestedAt,
    })
    assertAssistantAcceptedTurnInputProviderRequestOrdinal({
      existingProviderRequests: existing.providerRequests,
      ordinal: providerRequest.ordinal,
    })
    const updated = assistantAcceptedTurnInputJournalSchema.parse({
      ...existing,
      providerRequests: [...existing.providerRequests, providerRequest],
      updatedAt: requestedAt,
    })
    await writeAssistantAcceptedTurnInputJournalAtPaths(paths, updated)
    return updated
  })
}

export async function updateAssistantAcceptedTurnInputProviderRequest(input: {
  acceptedInputIds?: readonly string[] | null
  continuation: AssistantCodexContinuation
  now?: Date
  ordinal: number
  providerAttemptId?: string | null
  turnId: string
  vault: string
}): Promise<AssistantAcceptedTurnInputJournal | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const existing = await readAssistantAcceptedTurnInputJournalAtPaths(
      paths,
      input.turnId,
    )
    if (!existing) {
      return null
    }

    const requestIndex = existing.providerRequests.findIndex(
      (request) => request.ordinal === input.ordinal,
    )
    if (requestIndex < 0) {
      return null
    }

    const updatedAt = (input.now ?? new Date()).toISOString()
    const acceptedInputIds = Object.hasOwn(input, 'acceptedInputIds')
      ? normalizeProviderRequestAcceptedInputIds({
          acceptedInputIds: input.acceptedInputIds,
          inputIds: existing.inputIds,
        })
      : null
    const providerRequests = existing.providerRequests.map((request, index) =>
      index === requestIndex
        ? assistantAcceptedTurnInputProviderRequestSchema.parse({
            ...request,
            acceptedInputIds: acceptedInputIds ?? request.acceptedInputIds,
            continuation: input.continuation,
            providerAttemptId: Object.hasOwn(input, 'providerAttemptId')
              ? input.providerAttemptId ?? null
              : request.providerAttemptId,
          })
        : request,
    )
    const updated = assistantAcceptedTurnInputJournalSchema.parse({
      ...existing,
      providerRequests,
      updatedAt,
    })
    await writeAssistantAcceptedTurnInputJournalAtPaths(paths, updated)
    return updated
  })
}

export function resolveAssistantAcceptedTurnInputJournalPath(
  paths: AssistantStatePaths,
  turnId: string,
): string {
  return resolveAssistantOpaqueStateFilePath({
    directory: resolveAssistantAcceptedTurnInputJournalDirectory(paths),
    extension: '.json',
    kind: 'turn',
    value: turnId,
  })
}

function createEmptyAssistantAcceptedTurnInputJournal(input: {
  admissionState?: AssistantActiveTurnInputAdmissionState
  createdAt: string
  sessionId: string
  turnId: string
}): AssistantAcceptedTurnInputJournal {
  return assistantAcceptedTurnInputJournalSchema.parse({
    schema: ASSISTANT_ACCEPTED_TURN_INPUT_JOURNAL_SCHEMA,
    materializerVersion: ASSISTANT_ACCEPTED_TURN_INPUT_MATERIALIZER_VERSION,
    turnId: input.turnId,
    sessionId: input.sessionId,
    admissionState: input.admissionState ?? 'current-turn-open',
    inputIds: [],
    inputs: [],
    providerRequests: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
}

async function readAssistantAcceptedTurnInputJournalAtPaths(
  paths: AssistantStatePaths,
  turnId: string,
): Promise<AssistantAcceptedTurnInputJournal | null> {
  const journalPath = resolveAssistantAcceptedTurnInputJournalPath(paths, turnId)
  let raw: string
  try {
    raw = await readFile(journalPath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }

  return assistantAcceptedTurnInputJournalSchema.parse(JSON.parse(raw))
}

async function writeAssistantAcceptedTurnInputJournalAtPaths(
  paths: AssistantStatePaths,
  journal: AssistantAcceptedTurnInputJournal,
): Promise<void> {
  const journalPath = resolveAssistantAcceptedTurnInputJournalPath(
    paths,
    journal.turnId,
  )
  await ensureAssistantStateDirectory(path.dirname(journalPath))
  await writeJsonFileAtomic(
    journalPath,
    assistantAcceptedTurnInputJournalSchema.parse(journal),
  )
}

function parseAssistantAcceptedTurnInputItemInput(input: {
  acceptedAt: string
  input: AssistantAcceptedTurnInputItemInput
}): AssistantAcceptedTurnInputItem {
  return assistantAcceptedTurnInputItemSchema.parse({
    id: input.input.id,
    acceptedAt: input.input.acceptedAt ?? input.acceptedAt,
    source: input.input.source,
    captureIds: [...(input.input.captureIds ?? [])],
    transcriptRef: input.input.transcriptRef ?? null,
    contentRef: input.input.contentRef ?? null,
    promptFallback:
      input.input.promptFallback ??
      createAssistantAcceptedTurnInputPromptFallback({
        promptFallbackReason: input.input.promptFallbackReason,
        promptFallbackText: input.input.promptFallbackText,
    }),
  })
}

function assertAssistantAcceptedTurnInputJournalAppendIdentity(input: {
  existing: AssistantAcceptedTurnInputJournal
  sessionId: string
}): void {
  if (input.sessionId !== input.existing.sessionId) {
    throw new VaultCliError(
      'ASSISTANT_TURN_INPUT_JOURNAL_IDENTITY_MISMATCH',
      'Accepted turn input journal appends must use the original session id.',
    )
  }
}

function normalizeProviderRequestAcceptedInputIds(input: {
  acceptedInputIds?: readonly string[] | null
  inputIds: readonly string[]
}): string[] {
  const acceptedInputIds = input.acceptedInputIds
    ? [...input.acceptedInputIds]
    : [...input.inputIds]

  if (acceptedInputIds.length !== input.inputIds.length) {
    throw new VaultCliError(
      'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
      'Provider request input ids must match the current accepted journal snapshot.',
    )
  }

  for (let index = 0; index < acceptedInputIds.length; index += 1) {
    if (acceptedInputIds[index] !== input.inputIds[index]) {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
        'Provider request input ids must match the current accepted journal snapshot.',
      )
    }
  }

  return acceptedInputIds
}

function assertAssistantAcceptedTurnInputProviderRequestOrdinal(input: {
  existingProviderRequests: readonly AssistantAcceptedTurnInputProviderRequest[]
  ordinal: number
}): void {
  for (const request of input.existingProviderRequests) {
    if (request.ordinal >= input.ordinal) {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
        'Provider request ordinals must be appended in increasing order.',
      )
    }
  }
}

function assertAssistantAcceptedTurnInputEventMatchesRef(input: {
  event: AssistantInputEventRecord
  inputId: string
}): void {
  if (
    input.event.inputId === input.inputId &&
    input.event.schema === ASSISTANT_INPUT_EVENT_SCHEMA
  ) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_TURN_INPUT_JOURNAL_ASSISTANT_INPUT_EVENT_MISMATCH',
    'Accepted assistant input event ref must resolve to the matching assistant input event.',
    {
      inputId: input.inputId,
    },
  )
}

function assertAssistantAcceptedTurnInputAdmissionStateTransition(input: {
  existingAdmissionState: AssistantActiveTurnInputAdmissionState
  nextAdmissionState: AssistantActiveTurnInputAdmissionState
}): void {
  if (
    resolveAssistantAcceptedTurnInputAdmissionStateRank(input.nextAdmissionState) <
    resolveAssistantAcceptedTurnInputAdmissionStateRank(input.existingAdmissionState)
  ) {
    throw new VaultCliError(
      'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_ADMISSION_TRANSITION',
      'Accepted turn input journal admission state cannot move backward.',
    )
  }
}

function resolveAssistantAcceptedTurnInputAdmissionStateRank(
  admissionState: AssistantActiveTurnInputAdmissionState,
): number {
  switch (admissionState) {
    case 'current-turn-open':
      return 0
    case 'passive-input-next-turn':
      return 1
    case 'commit-started':
      return 2
  }
}

function createAssistantAcceptedTurnInputPromptFallback(input: {
  promptFallbackReason?: AssistantAcceptedTurnInputPromptFallback['reason']
  promptFallbackText?: string | null
}): AssistantAcceptedTurnInputPromptFallback | null {
  if (typeof input.promptFallbackText !== 'string') {
    return null
  }

  const text = input.promptFallbackText.trim()
  if (!text) {
    return null
  }

  return assistantAcceptedTurnInputPromptFallbackSchema.parse({
    reason: input.promptFallbackReason ?? 'missing-content-ref',
    textLengthBucket: resolveAssistantAcceptedTurnInputTextLengthBucket(text.length),
  })
}

function resolveAssistantAcceptedTurnInputTextLengthBucket(
  textLength: number,
): AssistantAcceptedTurnInputPromptFallback['textLengthBucket'] {
  if (textLength <= 64) {
    return '1-64'
  }
  if (textLength <= 256) {
    return '65-256'
  }
  if (textLength <= 1024) {
    return '257-1024'
  }
  return '1025+'
}

function resolveAssistantAcceptedTurnInputJournalDirectory(
  paths: AssistantStatePaths,
): string {
  return path.join(paths.stateDirectory, 'accepted-turn-inputs')
}
