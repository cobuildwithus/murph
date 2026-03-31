import {
  normalizeIanaTimeZone,
  normalizeStrictIsoTimestamp,
} from '@murph/contracts'
import {
  loadQueryRuntime,
  type QueryVaultRecord,
} from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
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
  record: QueryVaultRecord,
  entityLabel: string,
  expectedKinds: readonly string[] | undefined,
) {
  if (!expectedKinds || expectedKinds.length === 0) {
    return
  }

  if (record.kind && expectedKinds.includes(record.kind)) {
    return
  }

  throw new VaultCliError(
    'not_found',
    `No ${entityLabel} found for "${record.displayId}".`,
  )
}

async function requireEventRecord(
  input: EventRecordMutationLookupInput,
): Promise<QueryVaultRecord> {
  const query = await loadQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const record = query.lookupRecordById(readModel, input.lookup)

  if (!record || record.recordType !== 'event') {
    throw new VaultCliError(
      'not_found',
      `No ${input.entityLabel} found for "${input.lookup}".`,
    )
  }

  ensureExpectedEventKind(record, input.entityLabel, input.expectedKinds)
  return record
}

function buildMutableEventPayload(record: QueryVaultRecord): JsonObject {
  const base = isJsonObject(record.data)
    ? structuredClone(record.data)
    : {}

  delete base.entityId
  delete base.eventIds
  delete base.lifecycle

  if (typeof base.id !== 'string' || base.id.trim().length === 0) {
    base.id = record.primaryLookupId
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
  return loadRuntimeModule<EventMutationCoreRuntime>('@murph/core')
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
  const core = await loadEventMutationCoreRuntime()

  try {
    const result = await core.upsertEvent({
      vaultRoot: input.vault,
      payload: patchedPayload,
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
  const eventId =
    typeof record.primaryLookupId === 'string' &&
    record.primaryLookupId.trim().length > 0
      ? record.primaryLookupId
      : input.lookup
  const core = await loadEventMutationCoreRuntime()

  try {
    const result = await core.deleteEvent({
      vaultRoot: input.vault,
      eventId,
    })

    return {
      vault: input.vault,
      entityId: record.displayId,
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
