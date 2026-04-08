import {
  type JsonObject,
  type WorkoutFormatUpsertPayload,
  workoutFormatUpsertPayloadSchema,
} from '@murphai/contracts'
import {
  listWorkoutFormats as listCoreWorkoutFormats,
  readWorkoutFormat as readCoreWorkoutFormat,
  upsertWorkoutFormat,
  type WorkoutFormatRecord,
} from '@murphai/core'
import { loadJsonInputObject } from '../json-input.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { asListEnvelope } from './shared.js'
import {
  normalizeOptionalText,
  toVaultCliError,
} from './vault-usecase-helpers.js'
import {
  addWorkoutRecord,
  resolveWorkoutCapture,
  type AddWorkoutRecordInput,
} from './workout.js'
import {
  buildWorkoutSessionFromTemplate,
  buildWorkoutTemplateFromSummary,
} from './workout-model.js'


export interface SaveWorkoutFormatInput {
  vault: string
  name?: string
  text?: string
  inputFile?: string
  durationMinutes?: number
  activityType?: string
  distanceKm?: number
}

export interface LogWorkoutFormatInput {
  vault: string
  name: string
  occurredAt?: string
  source?: AddWorkoutRecordInput['source']
  durationMinutes?: number
  activityType?: string
  distanceKm?: number
  mediaPaths?: string[]
}

function requireTitle(value: string | undefined, label: string): string {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    throw new VaultCliError('contract_invalid', `${label} is required.`)
  }

  return normalized
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toWorkoutFormatEntity(record: WorkoutFormatRecord, includeMarkdown: boolean) {
  return {
    id: record.workoutFormatId,
    kind: 'workout_format',
    title: record.title,
    occurredAt: null,
    path: record.relativePath,
    markdown: includeMarkdown ? record.markdown : null,
    data: {
      workoutFormatId: record.workoutFormatId,
      slug: record.slug,
      title: record.title,
      status: record.status,
      summary: record.summary,
      activityType: record.activityType,
      durationMinutes: record.durationMinutes,
      distanceKm: record.distanceKm,
      template: record.template,
      tags: record.tags,
      note: record.note,
      text: record.templateText,
      templateText: record.templateText,
    },
    links: [],
  }
}

async function loadWorkoutFormats(vault: string): Promise<WorkoutFormatRecord[]> {
  try {
    return await listCoreWorkoutFormats(vault)
  } catch (error) {
    throw toWorkoutFormatCliError(error)
  }
}

async function resolveWorkoutFormat(vault: string, lookup: string): Promise<WorkoutFormatRecord> {
  const normalizedLookup = normalizeOptionalText(lookup)
  if (!normalizedLookup) {
    throw new VaultCliError('contract_invalid', 'Workout format lookup is required.')
  }

  if (/^wfmt_[0-9A-Za-z]+$/u.test(normalizedLookup)) {
    try {
      return await readCoreWorkoutFormat({
        vaultRoot: vault,
        workoutFormatId: normalizedLookup,
      })
    } catch (error) {
      throw toWorkoutFormatCliError(error)
    }
  }

  const records = await loadWorkoutFormats(vault)
  const slugMatch = records.find((record) => record.slug === normalizedLookup)
  if (slugMatch) {
    return slugMatch
  }

  const titleMatches = records.filter(
    (record) => normalizeOptionalText(record.title)?.toLowerCase() === normalizedLookup.toLowerCase(),
  )

  if (titleMatches.length > 1) {
    throw new VaultCliError(
      'command_failed',
      `Multiple workout formats match "${normalizedLookup}". Use the saved slug instead.`,
    )
  }

  if (titleMatches[0]) {
    return titleMatches[0]
  }

  throw new VaultCliError('not_found', `No workout format found for "${normalizedLookup}".`)
}

function formatSchemaIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'value'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

function toWorkoutFormatCliError(error: unknown) {
  if (error instanceof Error && error.message === 'workoutFormatId is required.') {
    return new VaultCliError(
      'contract_invalid',
      'Workout format document is missing workoutFormatId.',
    )
  }

  return toVaultCliError(error, {
    VAULT_INVALID_INPUT: { code: 'contract_invalid' },
    VAULT_INVALID_WORKOUT_FORMAT: { code: 'contract_invalid' },
    VAULT_WORKOUT_FORMAT_MISSING: { code: 'not_found' },
    VAULT_WORKOUT_FORMAT_CONFLICT: { code: 'command_failed' },
  })
}

function normalizeStructuredWorkoutFormatPayload(
  payload: JsonObject,
  fallbackName?: string,
): WorkoutFormatUpsertPayload {
  const candidate = {
    ...payload,
    title: valueAsString(payload.title) ?? fallbackName,
    activityType: valueAsString(payload.activityType) ?? 'strength-training',
  }

  const parsed = workoutFormatUpsertPayloadSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `Workout format payload is invalid. ${formatSchemaIssues(parsed.error.issues)}`,
    )
  }

  return parsed.data
}

export async function saveWorkoutFormat(input: SaveWorkoutFormatInput) {
  let payload: WorkoutFormatUpsertPayload

  if (typeof input.inputFile === 'string') {
    payload = normalizeStructuredWorkoutFormatPayload(
      await loadJsonInputObject(input.inputFile, 'workout format payload'),
      input.name,
    )
  } else {
    const title = requireTitle(input.name, 'Workout format name')
    const text = requireTitle(input.text, 'Workout format text')
    const capture = resolveWorkoutCapture({
      text,
      durationMinutes: input.durationMinutes,
      activityType: input.activityType,
      distanceKm: input.distanceKm,
    })
    const template = buildWorkoutTemplateFromSummary({
      note: capture.note,
      strengthExercises: capture.strengthExercises,
    })

    payload = {
      title,
      status: 'active',
      summary: undefined,
      activityType: capture.activityType,
      durationMinutes: capture.durationMinutes,
      distanceKm: capture.distanceKm ?? undefined,
      template,
      note: undefined,
      templateText: text,
    }
  }

  let result: Awaited<ReturnType<typeof upsertWorkoutFormat>>

  try {
    result = await upsertWorkoutFormat({
      vaultRoot: input.vault,
      workoutFormatId: payload.workoutFormatId,
      slug: payload.slug,
      title: payload.title,
      status: payload.status,
      summary: payload.summary,
      activityType: payload.activityType,
      durationMinutes: payload.durationMinutes,
      distanceKm: payload.distanceKm,
      template: payload.template,
      tags: payload.tags,
      note: payload.note,
      templateText: payload.templateText,
    })
  } catch (error) {
    throw toWorkoutFormatCliError(error)
  }

  return {
    vault: input.vault,
    name: result.record.title,
    slug: result.record.slug,
    path: result.record.relativePath,
    created: result.created,
  }
}

export async function showWorkoutFormat(vault: string, name: string) {
  const record = await resolveWorkoutFormat(vault, name)

  return {
    vault,
    entity: toWorkoutFormatEntity(record, true),
  }
}

export async function listWorkoutFormats(input: {
  vault: string
  limit: number
}) {
  const records = await loadWorkoutFormats(input.vault)
  const items = records.slice(0, input.limit).map((record) =>
    toWorkoutFormatEntity(record, false),
  )

  return asListEnvelope(
    input.vault,
    {
      limit: input.limit,
    },
    items,
  )
}

export async function logWorkoutFormat(input: LogWorkoutFormatInput) {
  const record = await resolveWorkoutFormat(input.vault, input.name)
  const templateNote =
    record.templateText
    ?? record.template.routineNote
    ?? record.title

  return addWorkoutRecord({
    vault: input.vault,
    workout: buildWorkoutSessionFromTemplate(record.template, {
      routineId: record.workoutFormatId,
      routineName: record.title,
    }),
    text: templateNote,
    durationMinutes:
      typeof input.durationMinutes === 'number'
        ? input.durationMinutes
        : record.durationMinutes,
    activityType:
      typeof input.activityType === 'string'
        ? input.activityType
        : record.activityType,
    distanceKm:
      typeof input.distanceKm === 'number'
        ? input.distanceKm
        : record.distanceKm,
    occurredAt: input.occurredAt,
    source: input.source,
    mediaPaths: input.mediaPaths,
  })
}
