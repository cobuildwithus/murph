import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  ID_PREFIXES,
  type JsonObject,
  type WorkoutSession,
  type WorkoutSet,
  type WorkoutSetType,
} from '@murphai/contracts'
import { applyCanonicalWriteBatch, buildRawImportManifest, resolveRawAssetDirectory } from '@murphai/core'
import { parseDelimitedRows } from '@murphai/importers'
import { generateUlid } from '@murphai/runtime-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { compactObject, normalizeOptionalText, toEventUpsertVaultCliError } from './vault-usecase-helpers.js'
import { buildStructuredWorkoutActivitySessionDraft } from './workout.js'
import { loadWorkoutCoreRuntime } from './workout-core.js'

const DEFAULT_SOURCE = 'strong'
const DEFAULT_DELIMITER = ','

interface CsvInspection {
  sourceFile: string
  source: string
  detectedSource: string | null
  delimiter: string
  headers: string[]
  rowCount: number
  estimatedWorkouts: number
  importable: boolean
  warnings: string[]
  rows: string[][]
}

interface WorkoutCsvSessionExercise {
  name: string
  order: number
  groupId?: string
  mode?: WorkoutSession['exercises'][number]['mode']
  unitOverride?: 'lb' | 'kg'
  note?: string
  sets: WorkoutSet[]
}

interface WorkoutCsvSession {
  key: string
  title: string
  occurredAt?: string
  startedAt?: string
  endedAt?: string
  durationMinutes?: number
  distanceKm?: number
  note?: string
  rawRows: number[]
  exercises: WorkoutCsvSessionExercise[]
}

function normalizeHeaderName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return normalized.length > 0 ? normalized : fallback
}

function sanitizeFileName(fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const safeStem = stem.length > 0 ? stem : 'workout-import'
  return `${safeStem}${ext || '.csv'}`
}

function valueAt(row: readonly string[], index: number | undefined): string | undefined {
  if (index === undefined) {
    return undefined
  }

  const value = row[index]
  return typeof value === 'string' ? value.trim() : undefined
}

function findHeaderIndex(headers: readonly string[], aliases: readonly string[]): number | undefined {
  const normalizedHeaders = headers.map(normalizeHeaderName)

  for (const alias of aliases) {
    const aliasKey = normalizeHeaderName(alias)
    const index = normalizedHeaders.indexOf(aliasKey)
    if (index >= 0) {
      return index
    }
  }

  return undefined
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return undefined
  }

  const match = normalized.replace(/,/gu, '').match(/-?\d+(?:\.\d+)?/u)
  if (!match) {
    return undefined
  }

  const parsed = Number.parseFloat(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBooleanLike(value: string | undefined): boolean {
  const normalized = normalizeOptionalText(value)?.toLowerCase()
  return normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1'
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) {
    return undefined
  }

  return Math.round(parsed)
}

function normalizeLoadUnit(value: string | undefined): 'lb' | 'kg' | undefined {
  const normalized = normalizeOptionalText(value)?.toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (normalized.startsWith('lb') || normalized.startsWith('pound')) {
    return 'lb'
  }

  if (normalized.startsWith('kg') || normalized.startsWith('kilo')) {
    return 'kg'
  }

  return undefined
}

function parseWeight(value: string | undefined): { weight?: number; unit?: 'lb' | 'kg' } {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return {}
  }

  return {
    weight: parseOptionalNumber(normalized),
    unit: normalizeLoadUnit(normalized),
  }
}

function parseDistanceMeters(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalText(value)?.toLowerCase()
  if (!normalized) {
    return undefined
  }

  const amount = parseOptionalNumber(normalized)
  if (amount === undefined) {
    return undefined
  }

  if (normalized.includes('km')) {
    return amount * 1000
  }

  if (normalized.includes('mi')) {
    return amount * 1609.344
  }

  if (normalized.includes('m')) {
    return amount
  }

  return amount
}

function parseDistanceKm(value: string | undefined): number | undefined {
  const meters = parseDistanceMeters(value)
  return meters !== undefined ? meters / 1000 : undefined
}

function parseDurationSeconds(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return undefined
  }

  const colonParts = normalized.split(':').map((part) => part.trim())
  if (colonParts.length === 2 || colonParts.length === 3) {
    const numbers = colonParts.map((part) => Number.parseInt(part, 10))
    if (numbers.every((entry) => Number.isFinite(entry))) {
      if (numbers.length === 2) {
        const [minutes, seconds] = numbers
        return minutes! * 60 + seconds!
      }

      const [hours, minutes, seconds] = numbers
      return hours! * 3600 + minutes! * 60 + seconds!
    }
  }

  const amount = parseOptionalNumber(normalized)
  if (amount === undefined) {
    return undefined
  }

  if (normalized.includes('hour')) {
    return Math.round(amount * 3600)
  }

  if (normalized.includes('min')) {
    return Math.round(amount * 60)
  }

  return Math.round(amount)
}

function parseDurationMinutes(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return undefined
  }

  if (normalized.includes(':')) {
    const seconds = parseDurationSeconds(normalized)
    return seconds !== undefined ? Math.max(1, Math.round(seconds / 60)) : undefined
  }

  const amount = parseOptionalNumber(normalized)
  if (amount === undefined) {
    return undefined
  }

  if (normalized.includes('hour')) {
    return Math.max(1, Math.round(amount * 60))
  }

  if (normalized.includes('sec')) {
    return Math.max(1, Math.round(amount / 60))
  }

  return Math.max(1, Math.round(amount))
}

function normalizeSetType(value: string | undefined): WorkoutSetType | undefined {
  const normalized = normalizeOptionalText(value)?.toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (normalized.includes('warm')) {
    return 'warmup'
  }

  if (normalized.includes('drop')) {
    return 'dropset'
  }

  if (normalized.includes('fail')) {
    return 'failure'
  }

  return 'normal'
}

function normalizeTimestamp(dateValue: string | undefined, timeValue?: string | undefined): string | undefined {
  const dateText = normalizeOptionalText(dateValue)
  const timeText = normalizeOptionalText(timeValue)

  if (dateText && timeText) {
    const composite = `${dateText} ${timeText}`
    const parsed = new Date(composite)
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  if (dateText) {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(dateText)) {
      return `${dateText}T12:00:00.000Z`
    }

    const parsed = new Date(dateText)
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return undefined
}

function detectSource(headers: readonly string[]): string | null {
  const normalizedHeaders = new Set(headers.map(normalizeHeaderName))

  if (
    normalizedHeaders.has('exerciseimage')
    || normalizedHeaders.has('primarymuscles')
    || normalizedHeaders.has('secondarymuscles')
  ) {
    return 'hevy'
  }

  if (
    normalizedHeaders.has('workoutname')
    || normalizedHeaders.has('exercisename')
    || normalizedHeaders.has('setorder')
  ) {
    return 'strong'
  }

  return null
}

function inspectWorkoutCsv(input: {
  file: string
  source?: string
  delimiter?: string
  text: string
}): CsvInspection {
  const delimiter = input.delimiter ?? DEFAULT_DELIMITER
  const rows = parseDelimitedRows(input.text, delimiter)

  if (rows.length === 0) {
    throw new VaultCliError('invalid_payload', 'Workout CSV is empty.')
  }

  const headerRow = rows[0] ?? []
  const headers = headerRow.map((cell) => cell.trim())
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0))
  const detectedSource = detectSource(headers)
  const workoutNameIndex = findHeaderIndex(headers, ['workout name', 'workout', 'routine name', 'routine', 'name'])
  const dateIndex = findHeaderIndex(headers, ['date', 'workout date', 'session date', 'day'])
  const startTimeIndex = findHeaderIndex(headers, ['start time', 'start', 'started at', 'started'])

  const estimatedKeys = new Set<string>()
  for (const row of dataRows) {
    const workoutName = valueAt(row, workoutNameIndex) ?? 'workout'
    const occurredAt = normalizeTimestamp(valueAt(row, dateIndex), valueAt(row, startTimeIndex)) ?? `row-${estimatedKeys.size + 1}`
    estimatedKeys.add(`${occurredAt}::${workoutName}`)
  }

  const warnings: string[] = []
  if (headers.length === 0) {
    warnings.push('The CSV header row did not contain any recognizable columns.')
  }

  if (findHeaderIndex(headers, ['exercise name', 'exercise', 'movement']) === undefined) {
    warnings.push('No exercise column was detected; structured set import will be limited.')
  }

  return {
    sourceFile: input.file,
    source: input.source ?? detectedSource ?? DEFAULT_SOURCE,
    detectedSource,
    delimiter,
    headers,
    rowCount: dataRows.length,
    estimatedWorkouts: estimatedKeys.size,
    importable: dataRows.length > 0 && headers.length > 0,
    warnings,
    rows,
  }
}

function resolveExerciseMode(exercise: WorkoutCsvSessionExercise): WorkoutCsvSessionExercise['mode'] {
  const sets = exercise.sets
  if (sets.some((set) => typeof set.assistanceKg === 'number')) {
    return 'assisted_bodyweight'
  }

  if (sets.some((set) => typeof set.addedWeightKg === 'number')) {
    return 'weighted_bodyweight'
  }

  if (sets.some((set) => typeof set.bodyweightKg === 'number')) {
    return 'bodyweight'
  }

  if (sets.some((set) => typeof set.distanceMeters === 'number') && sets.some((set) => typeof set.durationSeconds === 'number')) {
    return 'cardio'
  }

  if (sets.every((set) => typeof set.durationSeconds === 'number' && set.reps === undefined && set.weight === undefined)) {
    return 'duration'
  }

  return 'weight_reps'
}

function buildWorkoutSessionsFromCsv(headers: readonly string[], rows: readonly string[][]): WorkoutCsvSession[] {
  const workoutNameIndex = findHeaderIndex(headers, ['workout name', 'workout', 'routine name', 'routine', 'name'])
  const dateIndex = findHeaderIndex(headers, ['date', 'workout date', 'session date', 'day'])
  const startTimeIndex = findHeaderIndex(headers, ['start time', 'start', 'started at', 'started'])
  const endTimeIndex = findHeaderIndex(headers, ['end time', 'end', 'ended at', 'ended'])
  const durationIndex = findHeaderIndex(headers, ['duration minutes', 'duration min', 'duration'])
  const distanceIndex = findHeaderIndex(headers, ['distance', 'distance km'])
  const workoutNoteIndex = findHeaderIndex(headers, ['note', 'notes', 'workout note', 'session note'])
  const exerciseNameIndex = findHeaderIndex(headers, ['exercise name', 'exercise', 'movement'])
  const exerciseNoteIndex = findHeaderIndex(headers, ['exercise note', 'movement note'])
  const setOrderIndex = findHeaderIndex(headers, ['set order', 'set number', 'set'])
  const repsIndex = findHeaderIndex(headers, ['reps', 'rep'])
  const weightIndex = findHeaderIndex(headers, ['weight', 'load'])
  const weightUnitIndex = findHeaderIndex(headers, ['weight unit', 'load unit', 'unit'])
  const setTypeIndex = findHeaderIndex(headers, ['set type', 'type'])
  const groupIndex = findHeaderIndex(headers, ['group', 'group id', 'superset', 'circuit'])
  const rpeIndex = findHeaderIndex(headers, ['rpe'])
  const durationSecondsIndex = findHeaderIndex(headers, ['duration seconds', 'seconds', 'time'])
  const setDistanceIndex = findHeaderIndex(headers, ['set distance', 'distance meters', 'distance'])
  const bodyweightIndex = findHeaderIndex(headers, ['bodyweight', 'body weight'])
  const assistanceIndex = findHeaderIndex(headers, ['assistance', 'assisted weight'])
  const addedWeightIndex = findHeaderIndex(headers, ['added weight', 'extra weight'])
  const warmupIndex = findHeaderIndex(headers, ['warmup', 'warm up'])
  const dropsetIndex = findHeaderIndex(headers, ['dropset', 'drop set'])
  const failureIndex = findHeaderIndex(headers, ['failure'])

  const sessions = new Map<string, WorkoutCsvSession>()

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!row || row.every((cell) => cell.trim().length === 0)) {
      continue
    }

    const workoutName = valueAt(row, workoutNameIndex) ?? 'Workout'
    const occurredAt = normalizeTimestamp(valueAt(row, dateIndex), valueAt(row, startTimeIndex))
    const key = `${occurredAt ?? `row-${rowIndex + 1}`}::${workoutName}`
    let session = sessions.get(key)

    if (!session) {
      session = {
        key,
        title: workoutName,
        occurredAt,
        startedAt: occurredAt,
        endedAt: normalizeTimestamp(valueAt(row, dateIndex), valueAt(row, endTimeIndex)),
        durationMinutes: parseDurationMinutes(valueAt(row, durationIndex)),
        distanceKm: parseDistanceKm(valueAt(row, distanceIndex)),
        note: valueAt(row, workoutNoteIndex),
        rawRows: [],
        exercises: [],
      }
      sessions.set(key, session)
    }

    session.rawRows.push(rowIndex + 1)
    session.note = session.note ?? valueAt(row, workoutNoteIndex)
    session.durationMinutes = session.durationMinutes ?? parseDurationMinutes(valueAt(row, durationIndex))
    session.distanceKm = session.distanceKm ?? parseDistanceKm(valueAt(row, distanceIndex))
    session.endedAt = session.endedAt ?? normalizeTimestamp(valueAt(row, dateIndex), valueAt(row, endTimeIndex))

    const exerciseName = valueAt(row, exerciseNameIndex)
    if (!exerciseName) {
      continue
    }

    let exercise = session.exercises.find((entry) => entry.name === exerciseName)
    if (!exercise) {
      exercise = {
        name: exerciseName,
        order: session.exercises.length + 1,
        groupId: valueAt(row, groupIndex),
        note: valueAt(row, exerciseNoteIndex),
        sets: [],
      }
      session.exercises.push(exercise)
    }

    const parsedWeight = parseWeight(valueAt(row, weightIndex))
    const explicitWeightUnit = normalizeLoadUnit(valueAt(row, weightUnitIndex))
    const type = normalizeSetType(valueAt(row, setTypeIndex))
      ?? (parseBooleanLike(valueAt(row, warmupIndex))
        ? 'warmup'
        : parseBooleanLike(valueAt(row, dropsetIndex))
          ? 'dropset'
          : parseBooleanLike(valueAt(row, failureIndex))
            ? 'failure'
            : 'normal')
    const set: WorkoutSet = compactObject({
      order: parseOptionalInteger(valueAt(row, setOrderIndex)) ?? exercise.sets.length + 1,
      type,
      reps: parseOptionalInteger(valueAt(row, repsIndex)),
      weight: parsedWeight.weight,
      weightUnit: explicitWeightUnit ?? parsedWeight.unit,
      durationSeconds: parseDurationSeconds(valueAt(row, durationSecondsIndex)),
      distanceMeters: parseDistanceMeters(valueAt(row, setDistanceIndex)),
      rpe: parseOptionalNumber(valueAt(row, rpeIndex)),
      bodyweightKg: parseOptionalNumber(valueAt(row, bodyweightIndex)),
      assistanceKg: parseOptionalNumber(valueAt(row, assistanceIndex)),
      addedWeightKg: parseOptionalNumber(valueAt(row, addedWeightIndex)),
    }) as WorkoutSet

    if (
      set.reps === undefined
      && set.weight === undefined
      && set.durationSeconds === undefined
      && set.distanceMeters === undefined
      && set.rpe === undefined
      && set.bodyweightKg === undefined
      && set.assistanceKg === undefined
      && set.addedWeightKg === undefined
    ) {
      continue
    }

    exercise.sets.push(set)
    exercise.groupId = exercise.groupId ?? valueAt(row, groupIndex)
    exercise.note = exercise.note ?? valueAt(row, exerciseNoteIndex)
  }

  return [...sessions.values()].map((session) => ({
    ...session,
    durationMinutes:
      session.durationMinutes
      ?? (session.startedAt && session.endedAt
        ? Math.max(1, Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000))
        : undefined),
    exercises: session.exercises
      .map((exercise) => ({
        ...exercise,
        mode: resolveExerciseMode(exercise),
        unitOverride:
          exercise.sets.find((set) => set.weightUnit)?.weightUnit,
        sets: exercise.sets.slice().sort((left, right) => left.order - right.order),
      }))
      .filter((exercise) => exercise.sets.length > 0),
  }))
}

export async function inspectWorkoutCsvImport(input: {
  vault: string
  file: string
  source?: string
  delimiter?: string
}) {
  const text = await readFile(input.file, 'utf8')
  const inspection = inspectWorkoutCsv({
    file: input.file,
    source: input.source,
    delimiter: input.delimiter,
    text,
  })

  return {
    vault: input.vault,
    sourceFile: input.file,
    source: inspection.source,
    detectedSource: inspection.detectedSource,
    delimiter: inspection.delimiter,
    headers: inspection.headers,
    rowCount: inspection.rowCount,
    estimatedWorkouts: inspection.estimatedWorkouts,
    importable: inspection.importable,
    warnings: inspection.warnings,
  }
}

export async function importWorkoutCsv(input: {
  vault: string
  file: string
  source?: string
  delimiter?: string
  storeRawOnly?: boolean
}) {
  const text = await readFile(input.file, 'utf8')
  const inspection = inspectWorkoutCsv({
    file: input.file,
    source: input.source,
    delimiter: input.delimiter,
    text,
  })
  const importId = `${ID_PREFIXES.transform}_${generateUlid()}`
  const importedAt = new Date().toISOString()
  const safeSource = sanitizePathSegment(inspection.source, DEFAULT_SOURCE)
  const rawDirectory = resolveRawAssetDirectory({
    owner: {
      kind: 'workout_batch',
      id: importId,
      partition: safeSource,
    },
    occurredAt: importedAt,
  })
  const safeFileName = sanitizeFileName(path.basename(input.file))
  const rawFile = path.posix.join(rawDirectory, safeFileName)
  const manifestFile = path.posix.join(rawDirectory, 'manifest.json')

  const sessions = buildWorkoutSessionsFromCsv(inspection.headers, inspection.rows)
  const warnings = [...inspection.warnings]

  if (sessions.length === 0 && !input.storeRawOnly) {
    warnings.push('No structured workouts were detected; only the raw CSV was stored.')
  }

  const manifest = buildRawImportManifest({
    importId,
    importKind: 'workout_batch',
    importedAt,
    owner: {
      kind: 'workout_batch',
      id: importId,
      partition: safeSource,
    },
    source: inspection.source,
    rawDirectory,
    artifacts: [{
      role: 'source',
      relativePath: rawFile,
      originalFileName: path.basename(input.file),
      mediaType: 'text/csv',
      byteSize: new TextEncoder().encode(text).byteLength,
      sha256: createHash('sha256').update(text).digest('hex'),
    }],
    provenance: {
      sourceFileName: path.basename(input.file),
      delimiter: inspection.delimiter,
      headers: inspection.headers,
      rowCount: inspection.rowCount,
      estimatedWorkouts: inspection.estimatedWorkouts,
      warnings,
    },
  })

  await applyCanonicalWriteBatch({
    vaultRoot: input.vault,
    operationType: 'workout_import_csv',
    summary: `Import workout CSV ${path.basename(input.file)}`,
    rawContents: [{
      targetRelativePath: rawFile,
      content: text,
      originalFileName: path.basename(input.file),
      mediaType: 'text/csv',
      allowExistingMatch: true,
    }, {
      targetRelativePath: manifestFile,
      content: `${JSON.stringify(manifest, null, 2)}\n`,
      originalFileName: 'manifest.json',
      mediaType: 'application/json',
      allowExistingMatch: true,
    }],
  })

  const lookupIds: string[] = []
  const ledgerFiles = new Set<string>()

  if (!input.storeRawOnly) {
    const core = await loadWorkoutCoreRuntime()

    for (const session of sessions) {
      if (session.exercises.length === 0) {
        continue
      }

      const workout: WorkoutSession = {
        sourceApp: inspection.source,
        sourceWorkoutId: session.key.slice(0, 200),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        routineName: session.title,
        sessionNote: session.note,
        exercises: session.exercises.map((exercise) => ({
          name: exercise.name,
          order: exercise.order,
          groupId: exercise.groupId,
          mode: exercise.mode,
          unitOverride: exercise.unitOverride,
          note: exercise.note,
          sets: exercise.sets,
        })),
      }

      const draft = buildStructuredWorkoutActivitySessionDraft({
        payload: compactObject({
          title: session.title,
          occurredAt: session.occurredAt,
          source: 'import',
          activityType: 'strength-training',
          durationMinutes: session.durationMinutes,
          distanceKm: session.distanceKm,
          note: session.note,
          rawRefs: [rawFile],
          externalRef: {
            system: safeSource,
            resourceType: 'workout-session',
            resourceId: session.key.slice(0, 200),
          },
          workout,
        }) as JsonObject,
        source: 'import',
      })

      try {
        const result = await core.addActivitySession({
          vaultRoot: input.vault,
          draft,
        })
        lookupIds.push(result.eventId)
        ledgerFiles.add(result.ledgerFile)
      } catch (error) {
        throw toEventUpsertVaultCliError(error)
      }
    }
  }

  return {
    vault: input.vault,
    sourceFile: input.file,
    rawFile,
    manifestFile,
    source: inspection.source,
    importedCount: lookupIds.length,
    rawOnly: input.storeRawOnly === true || lookupIds.length === 0,
    lookupIds,
    ledgerFiles: [...ledgerFiles],
    warnings,
  }
}
