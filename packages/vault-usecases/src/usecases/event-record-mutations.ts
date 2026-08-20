import {
  normalizeIanaTimeZone,
  normalizeStrictIsoTimestamp,
} from '@murphai/contracts'
import {
  loadQueryRuntime,
  type QueryCanonicalEntity,
} from '../query-runtime.js'
import { loadTextInput } from '../json-input.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  applyRecordPatch,
  type JsonObject,
} from './record-mutations.js'
import {
  toEventUpsertVaultCliError,
  toVaultCliError,
} from './vault-usecase-helpers.js'

interface EventMutationCoreRuntime {
  upsertEvent(input: {
    vaultRoot: string
    payload: JsonObject
    allowSpecializedKindRewrite?: boolean
  }): Promise<{
    eventId: string
    ledgerFile: string
    created: boolean
  }>
  deleteEvent(input: {
    vaultRoot: string
    eventId: string
  }): Promise<{
    eventId: string
    kind: string
    retainedPaths: string[]
    deleted: true
  }>
  removeAutomaticMealPhoto(input: {
    vaultRoot: string
    eventId: string
  }): Promise<{
    eventId: string
    ledgerFile: string
    removedPhotoCount: number
  }>
  dedupeDeviceEventsByExternalRef(input: {
    vaultRoot: string
    apply?: boolean
  }): Promise<{
    applied: boolean
    scannedLiveDeviceEventCount: number
    duplicateGroupCount: number
    tombstonedEventCount: number
    tombstonedByKind: Record<string, number>
    skippedRevisedElsewhereCount: number
    shardPaths: string[]
    auditPath: string | null
  }>
  importEventBatch(input: {
    vaultRoot: string
    payloads: JsonObject[]
    rejectIfSourceRawRefAlreadyImported?: string
    apply?: boolean
  }): Promise<{
    applied: boolean
    receivedCount: number
    createdCount: number
    skippedExistingCount: number
    supersededCount: number
    eventShardPaths: string[]
    auditPath: string | null
  }>
}

interface EventRecordMutationLookupInput {
  vault: string
  lookup: string
  entityLabel: string
  expectedKinds?: readonly string[]
}

interface EditEventRecordInput extends EventRecordMutationLookupInput {
  inputFile?: string
  set?: string[]
  clear?: string[]
  dayKeyPolicy?: 'keep' | 'recompute'
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ensureExpectedEventKind(
  entity: QueryCanonicalEntity,
  entityLabel: string,
  expectedKinds: readonly string[] | undefined,
) {
  if (!expectedKinds || expectedKinds.length === 0) {
    return
  }

  if (entity.kind && expectedKinds.includes(entity.kind)) {
    return
  }

  throw new VaultCliError(
    'not_found',
    `No ${entityLabel} found for "${entity.entityId}".`,
  )
}

function eventRecordMatchesDirectLookup(
  record: QueryCanonicalEntity,
  lookup: string,
): boolean {
  const normalizedLookup = lookup.trim()
  const attributeId = isJsonObject(record.attributes) && typeof record.attributes.id === 'string'
    ? record.attributes.id.trim()
    : ''
  return normalizedLookup.length > 0 &&
    (
      normalizedLookup === record.entityId ||
      normalizedLookup === record.primaryLookupId ||
      (normalizedLookup.startsWith('evt_') && record.lookupIds.includes(normalizedLookup)) ||
      (attributeId.length > 0 && normalizedLookup === attributeId)
    )
}

async function requireEventRecord(
  input: EventRecordMutationLookupInput,
): Promise<QueryCanonicalEntity> {
  const query = await loadQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const record = query.lookupEntityById(readModel, input.lookup)

  if (!record || record.family !== 'event') {
    throw new VaultCliError(
      'not_found',
      `No ${input.entityLabel} found for "${input.lookup}".`,
    )
  }

  if (!eventRecordMatchesDirectLookup(record, input.lookup)) {
    throw new VaultCliError(
      'not_found',
      `No ${input.entityLabel} found for "${input.lookup}".`,
    )
  }

  ensureExpectedEventKind(record, input.entityLabel, input.expectedKinds)
  return record
}

function buildMutableEventPayload(record: QueryCanonicalEntity): JsonObject {
  const base = isJsonObject(record.attributes)
    ? structuredClone(record.attributes)
    : {}

  delete base.entityId
  delete base.eventIds
  delete base.lifecycle

  if (typeof base.id !== 'string' || base.id.trim().length === 0) {
    base.id = resolveCanonicalEventId(record)
  }

  if (typeof base.kind !== 'string' || base.kind.trim().length === 0) {
    if (record.kind) {
      base.kind = record.kind
    } else {
      delete base.kind
    }
  }

  if (
    typeof base.occurredAt !== 'string' ||
    base.occurredAt.trim().length === 0
  ) {
    if (record.occurredAt) {
      base.occurredAt = record.occurredAt
    } else {
      delete base.occurredAt
    }
  }

  if (typeof base.dayKey !== 'string' || base.dayKey.trim().length === 0) {
    if (record.date) {
      base.dayKey = record.date
    } else {
      delete base.dayKey
    }
  }

  if (typeof base.title !== 'string' || base.title.trim().length === 0) {
    if (record.title) {
      base.title = record.title
    } else {
      delete base.title
    }
  }

  return base
}

function resolveCanonicalEventId(record: QueryCanonicalEntity): string {
  const attributeId =
    typeof record.attributes.id === 'string' && record.attributes.id.trim().length > 0
      ? record.attributes.id.trim()
      : null
  if (attributeId) {
    return attributeId
  }

  const eventAlias = record.lookupIds.find(
    (lookupId) => typeof lookupId === 'string' && lookupId.startsWith('evt_'),
  )
  if (eventAlias) {
    return eventAlias
  }

  return record.primaryLookupId
}

function preserveCanonicalEventIdentity(
  original: JsonObject,
  patched: JsonObject,
): JsonObject {
  const next = structuredClone(patched)

  if (typeof original.id === 'string' && original.id.trim().length > 0) {
    next.id = original.id
  }

  if (typeof original.kind === 'string' && original.kind.trim().length > 0) {
    next.kind = original.kind
  }

  if (typeof original.mealId === 'string' && original.mealId.trim().length > 0) {
    next.mealId = original.mealId
  }

  if (typeof original.documentId === 'string' && original.documentId.trim().length > 0) {
    next.documentId = original.documentId
  }

  return next
}

function normalizeEventOccurredAt(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new VaultCliError(
      'invalid_timestamp',
      `Invalid ${fieldName}.`,
    )
  }

  const normalized = normalizeStrictIsoTimestamp(value)
  if (!normalized) {
    throw new VaultCliError(
      'invalid_timestamp',
      `Invalid ${fieldName}.`,
    )
  }

  return normalized
}

function normalizeExplicitTimeZone(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new VaultCliError(
      'invalid_option',
      `Invalid ${fieldName}.`,
    )
  }

  const normalized = normalizeIanaTimeZone(value)
  if (!normalized) {
    throw new VaultCliError(
      'invalid_option',
      `Invalid ${fieldName}.`,
    )
  }

  return normalized
}

function normalizePatchedDayKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? trimmed : undefined
}

function applyTemporalEditPolicy(input: {
  original: JsonObject
  patched: JsonObject
  clearedFields: ReadonlySet<string>
  touchedTopLevelFields: ReadonlySet<string>
  dayKeyPolicy?: 'keep' | 'recompute'
}): JsonObject {
  const originalOccurredAt = normalizeEventOccurredAt(
    input.original.occurredAt,
    'saved occurredAt',
  )
  const nextOccurredAt = normalizeEventOccurredAt(
    input.patched.occurredAt,
    'occurredAt',
  )
  const originalTimeZone = normalizeExplicitTimeZone(
    input.original.timeZone,
    'saved timeZone',
  )
  const nextTimeZone = normalizeExplicitTimeZone(
    input.patched.timeZone,
    'timeZone',
  )
  const temporalFieldsChanged =
    nextOccurredAt !== originalOccurredAt ||
    nextTimeZone !== originalTimeZone
  const dayKeyTouched = input.touchedTopLevelFields.has('dayKey')
  const dayKeyCleared = input.clearedFields.has('dayKey')

  if (!temporalFieldsChanged) {
    if (input.dayKeyPolicy) {
      throw new VaultCliError(
        'invalid_option',
        '--day-key-policy is only valid when occurredAt or timeZone changes.',
      )
    }

    return input.patched
  }

  if (input.dayKeyPolicy && dayKeyTouched && !dayKeyCleared) {
    throw new VaultCliError(
      'invalid_payload',
      'Choose either --day-key-policy or an explicit dayKey patch, not both.',
    )
  }

  const nextRecord = structuredClone(input.patched)

  if (dayKeyTouched && !dayKeyCleared) {
    const patchedDayKey = normalizePatchedDayKey(input.patched.dayKey)

    if (!patchedDayKey) {
      throw new VaultCliError(
        'invalid_payload',
        'A direct dayKey patch must be a concrete YYYY-MM-DD value. Otherwise use --day-key-policy recompute with an explicit timeZone.',
      )
    }

    nextRecord.dayKey = patchedDayKey
    return nextRecord
  }

  if (!input.dayKeyPolicy && !dayKeyTouched) {
    throw new VaultCliError(
      'invalid_payload',
      'Editing occurredAt or timeZone requires an explicit local-day choice: pass --day-key-policy keep, pass --day-key-policy recompute, or patch dayKey directly.',
    )
  }

  if (input.dayKeyPolicy === 'keep') {
    if (typeof input.original.dayKey !== 'string' || input.original.dayKey.length === 0) {
      throw new VaultCliError(
        'invalid_payload',
        'Cannot keep dayKey because the saved record does not have one.',
      )
    }

    nextRecord.dayKey = input.original.dayKey
    return nextRecord
  }

  if (nextTimeZone === undefined) {
    throw new VaultCliError(
      'invalid_payload',
      'Cannot recompute dayKey without an explicit timeZone. Pass --set timeZone=Area/City and --day-key-policy recompute, or patch dayKey directly.',
    )
  }

  delete nextRecord.dayKey
  return nextRecord
}

async function loadEventMutationCoreRuntime(): Promise<EventMutationCoreRuntime> {
  return loadRuntimeModule<EventMutationCoreRuntime>('@murphai/core')
}

export async function editEventRecord(input: EditEventRecordInput) {
  const record = await requireEventRecord(input)
  const payload = buildMutableEventPayload(record)
  const nextPayload = await applyRecordPatch({
    record: payload,
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    patchLabel: `${input.entityLabel} payload`,
  })
  const patchedPayload = preserveCanonicalEventIdentity(
    payload,
    applyTemporalEditPolicy({
      original: payload,
      patched: nextPayload.record,
      clearedFields: nextPayload.clearedFields,
      touchedTopLevelFields: nextPayload.touchedTopLevelFields,
      dayKeyPolicy: input.dayKeyPolicy,
    }),
  )
  // The public edit action is member-authored. Preserve provider attribution,
  // but never let an inherited or caller-supplied device source reclaim the
  // provider-owned reconciliation lane.
  const memberOwnedPayload = payload.source === 'device' || patchedPayload.source === 'device'
    ? { ...patchedPayload, source: 'manual' }
    : patchedPayload
  const core = await loadEventMutationCoreRuntime()

  try {
    const result = await core.upsertEvent({
      vaultRoot: input.vault,
      payload: memberOwnedPayload,
      allowSpecializedKindRewrite: true,
    })

    return {
      eventId: result.eventId,
      lookupId: result.eventId,
      ledgerFile: result.ledgerFile,
      created: result.created,
    }
  } catch (error) {
    throw toEventUpsertVaultCliError(error)
  }
}

export async function deleteEventRecord(
  input: EventRecordMutationLookupInput,
) {
  const record = await requireEventRecord(input)
  const eventId = resolveCanonicalEventId(record)
  const core = await loadEventMutationCoreRuntime()

  try {
    const result = await core.deleteEvent({
      vaultRoot: input.vault,
      eventId,
    })

    return {
      vault: input.vault,
      entityId: record.entityId,
      lookupId: record.primaryLookupId,
      kind: result.kind,
      deleted: true as const,
      retainedPaths: result.retainedPaths,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      EVENT_MISSING: {
        code: 'not_found',
        message: `No ${input.entityLabel} found for "${input.lookup}".`,
      },
      EVENT_CONTRACT_INVALID: {
        code: 'contract_invalid',
      },
    })
  }
}

export async function removeAutomaticMealPhotoEventRecord(
  input: EventRecordMutationLookupInput,
) {
  const record = await requireEventRecord(input)
  const eventId = resolveCanonicalEventId(record)
  const core = await loadEventMutationCoreRuntime()

  try {
    return await core.removeAutomaticMealPhoto({
      eventId,
      vaultRoot: input.vault,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      EVENT_MISSING: {
        code: 'not_found',
        message: `No ${input.entityLabel} found for "${input.lookup}".`,
      },
      MEAL_PHOTO_RETENTION_SOURCE_INVALID: {
        code: 'invalid_operation',
      },
    })
  }
}

const JSONL_FAILURE_REPORT_LIMIT = 20

const JSONL_FAILURE_MESSAGE_LIMIT = 3

function summarizeLineFailures(
  failures: ReadonlyArray<{ line: number | null, message: string }>,
): string {
  const summarized = failures
    .slice(0, JSONL_FAILURE_MESSAGE_LIMIT)
    .map((failure) => `line ${failure.line ?? '?'}: ${failure.message}`)
    .join('; ')
  const suffix = failures.length > JSONL_FAILURE_MESSAGE_LIMIT ? '; …' : ''

  return `First failures: ${summarized}${suffix}`
}

function toJsonlLineFailure(failure: unknown, lineNumbers: readonly number[]) {
  if (!isJsonObject(failure)) {
    return failure
  }

  const index = typeof failure.index === 'number' ? failure.index : -1

  return {
    line: lineNumbers[index] ?? null,
    message: String(failure.message ?? ''),
  }
}

export async function importEventRecordsFromJsonl(input: {
  vault: string
  inputFile: string
  rejectIfSourceRawRefAlreadyImported?: string
  apply?: boolean
}) {
  const raw = await loadTextInput(input.inputFile, 'events JSONL', {
    stdinHint: 'Pass --input @events.jsonl or pipe JSON Lines to --input -.',
  })
  const payloads: JsonObject[] = []
  const lineNumbers: number[] = []
  const parseFailures: Array<{ line: number, message: string }> = []

  raw.split('\n').forEach((lineText, lineIndex) => {
    const trimmed = lineText.trim()

    if (trimmed === '') {
      return
    }

    const line = lineIndex + 1
    let parsed: unknown

    try {
      parsed = JSON.parse(trimmed)
    } catch (error) {
      parseFailures.push({
        line,
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (!isJsonObject(parsed)) {
      parseFailures.push({
        line,
        message: 'Each JSONL line must contain one JSON object event payload.',
      })
      return
    }

    payloads.push(parsed)
    lineNumbers.push(line)
  })

  if (parseFailures.length > 0) {
    throw new VaultCliError(
      'invalid_payload',
      `${parseFailures.length} JSONL line(s) failed to parse; nothing was imported. ${summarizeLineFailures(parseFailures)}`,
      {
        failureCount: parseFailures.length,
        failures: parseFailures.slice(0, JSONL_FAILURE_REPORT_LIMIT),
      },
    )
  }

  if (payloads.length === 0) {
    throw new VaultCliError(
      'invalid_payload',
      'events JSONL input contained no event payloads.',
    )
  }

  const core = await loadEventMutationCoreRuntime()

  try {
    const result = await core.importEventBatch({
      vaultRoot: input.vault,
      payloads,
      rejectIfSourceRawRefAlreadyImported: input.rejectIfSourceRawRefAlreadyImported,
      apply: input.apply === true,
    })

    return {
      vault: input.vault,
      ...result,
    }
  } catch (error) {
    const mapped = toVaultCliError(error, {
      EVENT_BATCH_INVALID: {
        code: 'contract_invalid',
        details: (details) => ({
          ...details,
          failures: Array.isArray(details.failures)
            ? details.failures.map((failure) => toJsonlLineFailure(failure, lineNumbers))
            : details.failures,
        }),
      },
      EVENT_BATCH_SOURCE_ALREADY_IMPORTED: {
        code: 'conflict',
      },
      EVENT_BATCH_SOURCE_PARTIAL_CONFLICT: {
        code: 'conflict',
      },
      EVENT_BATCH_SOURCE_ROW_INVALID: {
        code: 'contract_invalid',
      },
      EVENT_BATCH_SOURCE_RAW_REF_MISSING: {
        code: 'not_found',
      },
      EVENT_BATCH_SOURCE_DOCUMENT_NOT_LIVE: {
        code: 'conflict',
      },
      RAW_MANIFEST_INVALID: {
        code: 'conflict',
      },
      RAW_REFERENCE_MISSING: {
        code: 'conflict',
      },
    })

    // The CLI error envelope only surfaces code/message, so fold the first
    // mapped line failures into the message itself instead of leaving them
    // buried in structured details the user never sees.
    if (
      mapped instanceof VaultCliError &&
      mapped.context?.vaultCode === 'EVENT_BATCH_INVALID' &&
      Array.isArray(mapped.context.failures)
    ) {
      throw new VaultCliError(
        mapped.code,
        `${mapped.message} ${summarizeLineFailures(mapped.context.failures as Array<{ line: number | null, message: string }>)}`,
        mapped.context,
      )
    }

    throw mapped
  }
}

export async function dedupeDeviceImportEventRecords(input: {
  vault: string
  apply?: boolean
}) {
  const core = await loadEventMutationCoreRuntime()

  try {
    const result = await core.dedupeDeviceEventsByExternalRef({
      vaultRoot: input.vault,
      apply: input.apply === true,
    })

    return {
      vault: input.vault,
      ...result,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      EVENT_CONTRACT_INVALID: {
        code: 'contract_invalid',
      },
    })
  }
}
