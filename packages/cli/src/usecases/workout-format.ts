import { readdir, readFile } from 'node:fs/promises'
import {
  deriveWorkoutFormatCompatibilityId,
  type ActivityStrengthExercise,
  ID_PREFIXES,
} from '@murph/contracts'
import {
  applyCanonicalWriteBatch,
  parseFrontmatterDocument,
  resolveVaultPathOnDisk,
  stringifyFrontmatterDocument,
} from '@murph/core'
import { generateUlid } from '@murph/runtime-state'
import { VaultCliError } from '../vault-cli-errors.js'
import { asListEnvelope } from './shared.js'
import {
  resolveWorkoutCapture,
  type AddWorkoutRecordInput,
  type ResolvedWorkoutCapture,
  addWorkoutRecord,
} from './workout.js'
import {
  compactObject,
  normalizeOptionalText,
} from './vault-usecase-helpers.js'

const WORKOUT_FORMATS_DIRECTORY = 'bank/workout-formats'
const WORKOUT_FORMAT_SCHEMA_VERSION = 'murph.frontmatter.workout-format.v1'
const WORKOUT_FORMAT_DOC_TYPE = 'workout_format'
const WORKOUT_FORMAT_ID_PREFIX = 'workout-format:'
const LOAD_UNITS = new Set(['lb', 'kg'])

type WorkoutFormatFrontmatter = NonNullable<
  Parameters<typeof stringifyFrontmatterDocument>[0]
>['attributes']

interface WorkoutFormatRecord {
  workoutFormatId: string
  title: string
  slug: string
  status: string
  text: string | null
  activityType: string
  durationMinutes: number
  distanceKm: number | null
  strengthExercises: ActivityStrengthExercise[] | null
  relativePath: string
  markdown: string
}

export interface SaveWorkoutFormatInput {
  vault: string
  name: string
  text: string
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
}

export async function saveWorkoutFormat(input: SaveWorkoutFormatInput) {
  const title = normalizeOptionalText(input.name)
  if (!title) {
    throw new VaultCliError('contract_invalid', 'Workout format name is required.')
  }

  const slug = slugifyWorkoutFormatName(title)
  if (!slug) {
    throw new VaultCliError(
      'contract_invalid',
      'Workout format name must include at least one letter or number.',
    )
  }

  const text = normalizeOptionalText(input.text)
  if (!text) {
    throw new VaultCliError('contract_invalid', 'Workout format text is required.')
  }

  const capture = validateWorkoutFormatDefaults({
    text,
    durationMinutes: input.durationMinutes,
    activityType: input.activityType,
    distanceKm: input.distanceKm,
  })

  const relativePath = formatWorkoutFormatPath(slug)
  const resolved = await resolveVaultPathOnDisk(input.vault, relativePath)
  const existingMarkdown = await readOptionalUtf8File(resolved.absolutePath)
  const existingRecord = existingMarkdown
    ? parseWorkoutFormatRecord(existingMarkdown, relativePath)
    : null
  const created = existingRecord === null
  const markdown = stringifyWorkoutFormatRecord({
    workoutFormatId: existingRecord?.workoutFormatId ?? createWorkoutFormatId(),
    title,
    slug,
    status: existingRecord?.status ?? 'active',
    text: capture.note,
    activityType: capture.activityType,
    durationMinutes: capture.durationMinutes,
    distanceKm: capture.distanceKm,
    strengthExercises: capture.strengthExercises,
    relativePath,
    markdown: existingMarkdown ?? '',
  })

  await applyCanonicalWriteBatch({
    vaultRoot: input.vault,
    operationType: 'workout_format_save',
    summary: `Save workout format ${slug}`,
    textWrites: [
      {
        relativePath,
        content: markdown,
        overwrite: true,
        allowExistingMatch: true,
      },
    ],
  })

  return {
    vault: input.vault,
    name: title,
    slug,
    path: relativePath,
    created,
  }
}

export async function showWorkoutFormat(
  vault: string,
  name: string,
) {
  const record = await resolveWorkoutFormat(vault, name)

  return {
    vault,
    entity: toWorkoutFormatEntity(record, {
      includeMarkdown: true,
    }),
  }
}

export async function listWorkoutFormats(input: {
  vault: string
  limit: number
}) {
  const records = await loadWorkoutFormats(input.vault)
  const items = records.slice(0, input.limit).map((record) =>
    toWorkoutFormatEntity(record, {
      includeMarkdown: false,
    }),
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

  return addWorkoutRecord({
    vault: input.vault,
    text: requireWorkoutFormatTemplateText(record),
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
        : record.distanceKm ?? undefined,
    strengthExercises: record.strengthExercises,
    occurredAt: input.occurredAt,
    source: input.source,
  })
}

async function loadWorkoutFormats(vault: string): Promise<WorkoutFormatRecord[]> {
  const resolvedDirectory = await resolveVaultPathOnDisk(
    vault,
    WORKOUT_FORMATS_DIRECTORY,
  )
  const records: WorkoutFormatRecord[] = []

  try {
    const entries = await readdir(resolvedDirectory.absolutePath, {
      withFileTypes: true,
      encoding: 'utf8',
    })

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const relativePath = `${WORKOUT_FORMATS_DIRECTORY}/${entry.name}`
      const resolvedFile = await resolveVaultPathOnDisk(vault, relativePath)
      const markdown = await readFile(resolvedFile.absolutePath, 'utf8')
      records.push(parseWorkoutFormatRecord(markdown, relativePath))
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw error
  }

  return records.sort(
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.slug.localeCompare(right.slug),
  )
}

async function resolveWorkoutFormat(vault: string, lookup: string) {
  const normalizedLookup = normalizeOptionalText(lookup)
  if (!normalizedLookup) {
    throw new VaultCliError('contract_invalid', 'Workout format name is required.')
  }

  const records = await loadWorkoutFormats(vault)
  const directSlug = slugifyWorkoutFormatName(normalizedLookup)
  const slugMatch =
    records.find((record) => record.slug === normalizedLookup) ??
    records.find((record) => record.slug === directSlug)
  if (slugMatch) {
    return slugMatch
  }

  const titleMatches = records.filter(
    (record) => record.title.toLowerCase() === normalizedLookup.toLowerCase(),
  )
  if (titleMatches.length === 1) {
    return titleMatches[0]
  }

  if (titleMatches.length > 1) {
    throw new VaultCliError(
      'conflict',
      `Multiple workout formats match "${normalizedLookup}". Use the saved slug instead.`,
    )
  }

  throw new VaultCliError(
    'not_found',
    `Workout format "${normalizedLookup}" was not found.`,
  )
}

function parseWorkoutFormatRecord(
  markdown: string,
  relativePath: string,
): WorkoutFormatRecord {
  const parsed = parseFrontmatterDocument(markdown)
  const attributes = parsed.attributes as Record<string, unknown>
  const schemaVersion = normalizeOptionalText(String(attributes.schemaVersion ?? ''))
  const docType = normalizeOptionalText(String(attributes.docType ?? ''))

  if (schemaVersion !== WORKOUT_FORMAT_SCHEMA_VERSION) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout format document "${relativePath}" has an unexpected schemaVersion.`,
    )
  }

  if (docType !== WORKOUT_FORMAT_DOC_TYPE) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout format document "${relativePath}" has an unexpected docType.`,
    )
  }

  const title = requireWorkoutFormatString(attributes.title, 'title', relativePath)
  const slug = requireWorkoutFormatString(attributes.slug, 'slug', relativePath)
  const text = optionalWorkoutFormatString(attributes.templateText ?? attributes.text)
  const activityType =
    optionalWorkoutFormatString(attributes.activityType) ??
    optionalWorkoutFormatString(attributes.type)
  const durationMinutes = optionalWorkoutFormatPositiveInteger(
    attributes.durationMinutes,
    'durationMinutes',
    relativePath,
  )
  const distanceKm = optionalWorkoutFormatPositiveNumber(
    attributes.distanceKm,
    'distanceKm',
    relativePath,
  )
  const strengthExercises = optionalWorkoutFormatStrengthExercises(
    attributes.strengthExercises,
    relativePath,
  )
  const needsCompatibilityDefaults =
    activityType === null ||
    durationMinutes === null ||
    (distanceKm === null && strengthExercises === null)
  const capture = needsCompatibilityDefaults
    ? text
      ? validateWorkoutFormatDefaults({
          text,
          durationMinutes: durationMinutes ?? undefined,
          activityType: activityType ?? undefined,
          distanceKm: distanceKm ?? undefined,
          relativePath,
        })
      : null
    : null
  const resolvedActivityType = activityType ?? capture?.activityType
  const resolvedDurationMinutes = durationMinutes ?? capture?.durationMinutes

  if (!resolvedActivityType || resolvedDurationMinutes === undefined) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout format document "${relativePath}" is invalid.`,
    )
  }

  return {
    workoutFormatId:
      optionalWorkoutFormatString(attributes.workoutFormatId) ??
      deriveWorkoutFormatCompatibilityId(slug),
    title,
    slug,
    status: optionalWorkoutFormatString(attributes.status) ?? 'active',
    text,
    activityType: resolvedActivityType,
    durationMinutes: resolvedDurationMinutes,
    distanceKm: distanceKm ?? capture?.distanceKm ?? null,
    strengthExercises: strengthExercises ?? capture?.strengthExercises ?? null,
    relativePath,
    markdown,
  }
}

function stringifyWorkoutFormatRecord(record: WorkoutFormatRecord) {
  const text = requireWorkoutFormatTemplateText(record)
  const body = [
    `# ${record.title}`,
    '',
    `- Status: ${record.status}`,
    `- Activity type: ${record.activityType}`,
    `- Default duration: ${record.durationMinutes} min`,
    `- Default distance: ${record.distanceKm ?? 'none'}${
      record.distanceKm === null ? '' : ' km'
    }`,
    '',
    ...(record.strengthExercises?.length
      ? [
          '## Strength Exercises',
          '',
          ...record.strengthExercises.map((exercise) =>
            `- ${formatStrengthExerciseLine(exercise)}`,
          ),
          '',
        ]
      : []),
    '## Saved workout text',
    '',
    text,
    '',
  ].join('\n')

  return stringifyFrontmatterDocument({
    attributes: compactObject({
      schemaVersion: WORKOUT_FORMAT_SCHEMA_VERSION,
      docType: WORKOUT_FORMAT_DOC_TYPE,
      workoutFormatId: record.workoutFormatId,
      slug: record.slug,
      title: record.title,
      status: record.status,
      activityType: record.activityType,
      durationMinutes: record.durationMinutes,
      distanceKm: record.distanceKm ?? undefined,
      strengthExercises: record.strengthExercises ?? undefined,
      templateText: text,
    }) as WorkoutFormatFrontmatter,
    body,
  })
}

function toWorkoutFormatEntity(
  record: WorkoutFormatRecord,
  options: {
    includeMarkdown: boolean
  },
) {
  return {
    id: `${WORKOUT_FORMAT_ID_PREFIX}${record.slug}`,
    kind: 'workout_format',
    title: record.title,
    occurredAt: null,
    path: record.relativePath,
    markdown: options.includeMarkdown ? record.markdown : null,
    data: compactObject({
      workoutFormatId: record.workoutFormatId,
      slug: record.slug,
      text: record.text ?? undefined,
      templateText: record.text ?? undefined,
      type: record.activityType,
      activityType: record.activityType,
      durationMinutes: record.durationMinutes,
      distanceKm: record.distanceKm ?? undefined,
      strengthExercises: record.strengthExercises ?? undefined,
      status: record.status,
    }),
    links: [],
  }
}

function validateWorkoutFormatDefaults(
  input: {
    text: string
    durationMinutes?: number
    activityType?: string
    distanceKm?: number
    relativePath?: string
  },
): ResolvedWorkoutCapture {
  try {
    return resolveWorkoutCapture({
      text: input.text,
      durationMinutes: input.durationMinutes,
      activityType: input.activityType,
      distanceKm: input.distanceKm,
    })
  } catch (error) {
    if (!(error instanceof VaultCliError)) {
      throw error
    }

    const prefix =
      typeof input.relativePath === 'string' && input.relativePath.length > 0
        ? `Workout format document "${input.relativePath}" is invalid: `
        : 'Workout format defaults are invalid: '

    throw new VaultCliError(error.code, `${prefix}${error.message}`)
  }
}

function requireWorkoutFormatTemplateText(record: WorkoutFormatRecord) {
  if (record.text) {
    return record.text
  }

  throw new VaultCliError(
    'contract_invalid',
    `Workout format document "${record.relativePath}" is missing templateText.`,
  )
}

function requireWorkoutFormatString(
  value: unknown,
  fieldName: string,
  relativePath: string,
) {
  const normalized = normalizeOptionalText(typeof value === 'string' ? value : undefined)
  if (!normalized) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout format document "${relativePath}" is missing ${fieldName}.`,
    )
  }

  return normalized
}

function optionalWorkoutFormatString(value: unknown) {
  return typeof value === 'string' ? normalizeOptionalText(value) : null
}

function optionalWorkoutFormatPositiveInteger(
  value: unknown,
  fieldName: string,
  relativePath: string,
) {
  if (value === undefined || value === null) {
    return null
  }

  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout format document "${relativePath}" has an invalid ${fieldName}.`,
    )
  }

  return Number(value)
}

function optionalWorkoutFormatPositiveNumber(
  value: unknown,
  fieldName: string,
  relativePath: string,
) {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout format document "${relativePath}" has an invalid ${fieldName}.`,
    )
  }

  return Number(value.toFixed(3))
}

function optionalWorkoutFormatStrengthExercises(
  value: unknown,
  relativePath: string,
) {
  if (value === undefined || value === null) {
    return null
  }

  if (!Array.isArray(value)) {
    throw new VaultCliError(
      'contract_invalid',
      `Workout format document "${relativePath}" has invalid strengthExercises.`,
    )
  }

  const exercises = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new VaultCliError(
        'contract_invalid',
        `Workout format document "${relativePath}" has invalid strengthExercises[${index}].`,
      )
    }

    const exercise = requireWorkoutFormatString(
      'exercise' in entry ? entry.exercise : undefined,
      `strengthExercises[${index}].exercise`,
      relativePath,
    )
    const setCount = optionalWorkoutFormatPositiveInteger(
      'setCount' in entry ? entry.setCount : undefined,
      `strengthExercises[${index}].setCount`,
      relativePath,
    )
    const repsPerSet = optionalWorkoutFormatPositiveInteger(
      'repsPerSet' in entry ? entry.repsPerSet : undefined,
      `strengthExercises[${index}].repsPerSet`,
      relativePath,
    )
    const load = 'load' in entry ? optionalWorkoutFormatPositiveNumber(
      entry.load,
      `strengthExercises[${index}].load`,
      relativePath,
    ) : null
    const loadUnit =
      'loadUnit' in entry && typeof entry.loadUnit === 'string' && LOAD_UNITS.has(entry.loadUnit)
        ? entry.loadUnit
        : null
    const loadDescription =
      'loadDescription' in entry
        ? optionalWorkoutFormatString(entry.loadDescription)
        : null

    if (setCount === null || repsPerSet === null) {
      throw new VaultCliError(
        'contract_invalid',
        `Workout format document "${relativePath}" has invalid strengthExercises[${index}].`,
      )
    }

    if ((load === null) !== (loadUnit === null)) {
      throw new VaultCliError(
        'contract_invalid',
        `Workout format document "${relativePath}" has invalid strengthExercises[${index}].`,
      )
    }

    return compactObject({
      exercise,
      setCount,
      repsPerSet,
      load: load ?? undefined,
      loadUnit: loadUnit ?? undefined,
      loadDescription: loadDescription ?? undefined,
    }) as ActivityStrengthExercise
  })

  return exercises.length > 0 ? exercises : null
}

function formatStrengthExerciseLine(exercise: ActivityStrengthExercise) {
  const parts = [
    `${exercise.exercise} — ${exercise.setCount} sets x ${exercise.repsPerSet} reps`,
  ]

  if (
    'load' in exercise &&
    exercise.load !== undefined &&
    exercise.loadUnit &&
    LOAD_UNITS.has(exercise.loadUnit)
  ) {
    parts.push(`load: ${exercise.load} ${exercise.loadUnit}`)
  }

  if (exercise.loadDescription) {
    parts.push(exercise.loadDescription)
  }

  return parts.join('; ')
}

function slugifyWorkoutFormatName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function formatWorkoutFormatPath(slug: string) {
  return `${WORKOUT_FORMATS_DIRECTORY}/${slug}.md`
}

function createWorkoutFormatId() {
  return `${ID_PREFIXES.workoutFormat}_${generateUlid()}`
}

async function readOptionalUtf8File(absolutePath: string) {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw error
  }
}

function isMissingPathError(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT',
  )
}
