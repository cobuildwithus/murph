import type {
  PlannedWorkoutCsvSession,
  WorkoutCsvDistanceUnit,
  WorkoutCsvImportPlan,
  WorkoutCsvSource,
  WorkoutCsvWeightUnit,
} from '@murphai/importers'

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path, { basename, extname } from 'node:path'

import {
  ID_PREFIXES,
  type EventRecord,
  type JsonObject,
  type RawImportManifest,
  type WorkoutSession,
  type WorkoutSet,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { loadRuntimeModule } from '../runtime-import.js'
import { compactObject, toVaultCliError } from './vault-usecase-helpers.js'
import { buildStructuredWorkoutActivitySessionDraft } from './workout.js'

const DEFAULT_SOURCE = 'strong'
const DEFAULT_DELIMITER = ','
const RESULT_LIST_LIMIT = 10
const EXACT_RAW_CANDIDATE_LIMIT = 100
const PRIOR_RAW_BATCH_LIMIT = 100
const PRIOR_RAW_TOTAL_BYTES_LIMIT = 50 * 1024 * 1024
// This version orders importer mapping semantics, not the revisionless CSV.
// Bump it only when a corrected mapping must supersede prior canonical output.
const WORKOUT_CSV_MAPPING_REVISION = '2026-08-12T19:00:00.000Z'

interface WorkoutImportBatchResult {
  applied: boolean
  receivedCount: number
  createdCount: number
  skippedExistingCount: number
  supersededCount: number
  eventIds: string[]
  eventShardPaths: string[]
  auditPath: string | null
}

interface WorkoutImportCoreRuntime {
  applyCanonicalWriteBatch(input: {
    vaultRoot: string
    operationType: string
    summary: string
    audit: {
      action: string
      commandName: string
      summary: string
      targetIds?: string[]
    }
    rawContents: Array<{
      targetRelativePath: string
      content: string
      originalFileName: string
      mediaType: string
      allowExistingMatch?: boolean
    }>
  }): Promise<unknown>
  buildRawImportManifest(input: Record<string, unknown>): Record<string, unknown>
  importEventBatch(input: {
    vaultRoot: string
    decisions: JsonObject[]
    apply?: boolean
  }): Promise<WorkoutImportBatchResult>
  findEventsByRawRefs(input: {
    vaultRoot: string
    rawRefs: string[]
    system?: string
    resourceType?: string
  }): Promise<WorkoutRawRefMatch[][]>
  loadVault(input: { vaultRoot: string }): Promise<{
    metadata: { timezone: string }
  }>
  resolveRawAssetDirectory(input: {
    owner: {
      kind: string
      id: string
      partition?: string
    }
    occurredAt: string
  }): string
  resolveVaultPath(vaultRoot: string, relativePath: string): {
    absolutePath: string
  }
  parseRawImportManifest(value: unknown): RawImportManifest
  walkVaultFiles(
    vaultRoot: string,
    relativeDirectory: string,
    options?: { extension?: string },
  ): Promise<string[]>
}

interface WorkoutImportersRuntime {
  planWorkoutCsvImport(input: {
    text: string
    timeZone: string
    source?: WorkoutCsvSource
    delimiter?: string
    weightUnit?: WorkoutCsvWeightUnit
    distanceUnit?: WorkoutCsvDistanceUnit
  }): WorkoutCsvImportPlan
}

interface WorkoutImportStateRuntime {
  generateUlid(): string
}

interface PreparedRawWorkoutBatch {
  importId: string
  manifest: Record<string, unknown>
  manifestFile: string
  rawFile: string
}

interface ExactRawWorkoutFile {
  rawFile: string
  source?: WorkoutCsvSource
  delimiter?: string
  weightUnit?: WorkoutCsvWeightUnit | null
  distanceUnit?: WorkoutCsvDistanceUnit | null
  timeZone?: string
}

interface PriorRawWorkoutFile extends ExactRawWorkoutFile {
  text: string
}

interface WorkoutExternalIdentity {
  system: string
  resourceType: string
  resourceId: string
  facet?: string
}

interface WorkoutRawRefMatch {
  attachment: EventRecord
  latest: EventRecord
}

async function loadWorkoutImportCoreRuntime(): Promise<WorkoutImportCoreRuntime> {
  return loadRuntimeModule<WorkoutImportCoreRuntime>('@murphai/core')
}

async function loadWorkoutImportersRuntime(): Promise<WorkoutImportersRuntime> {
  return loadRuntimeModule<WorkoutImportersRuntime>('@murphai/importers')
}

async function loadWorkoutImportStateRuntime(): Promise<WorkoutImportStateRuntime> {
  return loadRuntimeModule<WorkoutImportStateRuntime>('@murphai/runtime-state')
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
  return `${stem.length > 0 ? stem : 'workout-import'}${ext || '.csv'}`
}

function eventRecordToImportPayload(record: EventRecord): JsonObject {
  const {
    schemaVersion: _schemaVersion,
    id: _id,
    dayKey: _dayKey,
    lifecycle: _lifecycle,
    ...payload
  } = record
  return structuredClone(payload)
}

function buildWorkoutEventDecisions(
  plan: WorkoutCsvImportPlan,
  rawFile: string,
  existingExternalRefs?: readonly WorkoutExternalIdentity[],
  mappingRevision = WORKOUT_CSV_MAPPING_REVISION,
  existingPayloads?: readonly (JsonObject | null | undefined)[],
): { decisions: JsonObject[], suppressedDeletedCount: number } {
  let suppressedDeletedCount = 0
  const decisions = plan.sessions.flatMap((session, index): JsonObject[] => {
    const existingPayload = existingPayloads?.[index]
    if (existingPayload === null) {
      suppressedDeletedCount += 1
      return []
    }
    if (existingPayload) {
      return [{
        action: 'upsert',
        payload: existingPayload,
      }]
    }
    const existingExternalRef = existingExternalRefs?.[index]
    const draft = buildStructuredWorkoutActivitySessionDraft({
      payload: compactObject({
        title: session.title,
        occurredAt: session.occurredAt,
        timeZone: plan.timeZone,
        source: 'import',
        activityType: 'strength-training',
        durationMinutes: session.durationMinutes,
        distanceKm: session.distanceKm,
        note: session.note,
        rawRefs: [rawFile],
        externalRef: {
          system: existingExternalRef?.system ?? sanitizePathSegment(plan.source, DEFAULT_SOURCE),
          resourceType: existingExternalRef?.resourceType ?? 'workout-session',
          resourceId: existingExternalRef?.resourceId ?? session.sourceWorkoutId,
          version: mappingRevision,
          ...(existingExternalRef?.facet ? { facet: existingExternalRef.facet } : {}),
        },
        workout: session.workout,
      }) as JsonObject,
      source: 'import',
    })

    const payload = {
      kind: 'activity_session',
      ...draft,
    } as JsonObject

    return [{
      action: 'upsert',
      payload,
    }]
  })
  return { decisions, suppressedDeletedCount }
}

function prepareRawWorkoutBatch(input: {
  core: WorkoutImportCoreRuntime
  file: string
  text: string
  plan: WorkoutCsvImportPlan
  importId: string
  importedAt: string
}): PreparedRawWorkoutBatch {
  const safeSource = sanitizePathSegment(input.plan.source, DEFAULT_SOURCE)
  const owner = {
    kind: 'workout_batch',
    id: input.importId,
    partition: safeSource,
  }
  const rawDirectory = input.core.resolveRawAssetDirectory({
    owner,
    occurredAt: input.importedAt,
  })
  const rawFile = path.posix.join(rawDirectory, sanitizeFileName(path.basename(input.file)))
  const manifestFile = path.posix.join(rawDirectory, 'manifest.json')
  const warnings = input.plan.warnings
  const manifest = input.core.buildRawImportManifest({
    importId: input.importId,
    importKind: 'workout_batch',
    importedAt: input.importedAt,
    owner,
    source: input.plan.source,
    rawDirectory,
    artifacts: [{
      role: 'source',
      relativePath: rawFile,
      originalFileName: path.basename(input.file),
      mediaType: 'text/csv',
      byteSize: new TextEncoder().encode(input.text).byteLength,
      sha256: createHash('sha256').update(input.text).digest('hex'),
    }],
    provenance: {
      sourceFileName: path.basename(input.file),
      delimiter: input.plan.delimiter,
      headers: input.plan.headers,
      rowCount: input.plan.rowCount,
      estimatedWorkouts: input.plan.estimatedWorkouts,
      repairedRowCount: input.plan.repairedRowCount,
      ignoredRowCount: input.plan.ignoredRowCount,
      skippedRowCount: input.plan.skippedRowCount,
      skipReasons: input.plan.skipReasons,
      timeZone: input.plan.timeZone,
      weightUnit: input.plan.weightUnit,
      distanceUnit: input.plan.distanceUnit,
      warnings,
    },
  })

  return {
    importId: input.importId,
    manifest,
    manifestFile,
    rawFile,
  }
}

async function storeRawWorkoutBatch(input: {
  core: WorkoutImportCoreRuntime
  vault: string
  sourceFile: string
  text: string
  batch: PreparedRawWorkoutBatch
}): Promise<void> {
  await input.core.applyCanonicalWriteBatch({
    vaultRoot: input.vault,
    operationType: 'workout_import_csv_raw',
    summary: `Store workout CSV ${path.basename(input.sourceFile)}`,
    audit: {
      action: 'workout_import_csv_raw',
      commandName: 'vaultUsecases.importWorkoutCsv',
      summary: `Stored workout CSV ${path.basename(input.sourceFile)} as immutable raw evidence.`,
      targetIds: [input.batch.importId],
    },
    rawContents: [{
      targetRelativePath: input.batch.rawFile,
      content: input.text,
      originalFileName: path.basename(input.sourceFile),
      mediaType: 'text/csv',
      allowExistingMatch: true,
    }, {
      targetRelativePath: input.batch.manifestFile,
      content: `${JSON.stringify(input.batch.manifest, null, 2)}\n`,
      originalFileName: 'manifest.json',
      mediaType: 'application/json',
      allowExistingMatch: true,
    }],
  })
}

async function loadWorkoutCsvPlan(input: {
  vault: string
  file: string
  source?: WorkoutCsvSource
  delimiter?: string
  weightUnit?: WorkoutCsvWeightUnit
  distanceUnit?: WorkoutCsvDistanceUnit
}): Promise<{
  text: string
  plan: WorkoutCsvImportPlan
  core: WorkoutImportCoreRuntime
  importers: WorkoutImportersRuntime
}> {
  const [text, core, importers] = await Promise.all([
    readFile(input.file, 'utf8'),
    loadWorkoutImportCoreRuntime(),
    loadWorkoutImportersRuntime(),
  ])
  const vault = await core.loadVault({ vaultRoot: input.vault })
  const plan = importers.planWorkoutCsvImport({
    text,
    timeZone: vault.metadata.timezone,
    source: input.source,
    delimiter: input.delimiter,
    weightUnit: input.weightUnit,
    distanceUnit: input.distanceUnit,
  })
  return { text, plan, core, importers }
}

function assertStructuredPlanImportable(plan: WorkoutCsvImportPlan): void {
  if (plan.requiresWeightUnit) {
    throw new VaultCliError(
      'invalid_option',
      'This workout CSV contains positive weights without unit metadata. Pass --weight-unit lb or --weight-unit kg; nothing was imported.',
    )
  }
  if (plan.requiresDistanceUnit) {
    throw new VaultCliError(
      'invalid_option',
      'This workout CSV contains positive distances without unit metadata. Pass --distance-unit m, --distance-unit km, or --distance-unit mi; nothing was imported.',
    )
  }
  if (plan.skippedRowCount > 0) {
    throw new VaultCliError(
      'invalid_payload',
      `${plan.skippedRowCount} workout CSV row(s) could not be mapped safely; nothing was imported. Run workout import inspect for aggregate reasons.`,
    )
  }
  if (plan.detectedSource === null || plan.sessions.length === 0) {
    throw new VaultCliError(
      'invalid_payload',
      'Workout CSV does not contain a supported structured workout export; nothing was imported.',
    )
  }
}

function assertSupportedWorkoutSource(plan: WorkoutCsvImportPlan): void {
  if (plan.detectedSource === null) {
    throw new VaultCliError(
      'invalid_payload',
      'Workout CSV does not contain a supported structured workout export; nothing was stored.',
    )
  }
}

function capList(values: readonly string[]): { values: string[], truncated: boolean } {
  return {
    values: values.slice(0, RESULT_LIST_LIMIT),
    truncated: values.length > RESULT_LIST_LIMIT,
  }
}

async function findExactRawWorkoutFiles(input: {
  core: WorkoutImportCoreRuntime
  vault: string
  text: string
}): Promise<ExactRawWorkoutFile[]> {
  const expectedBytes = new TextEncoder().encode(input.text).byteLength
  const expectedHash = createHash('sha256').update(input.text).digest('hex')
  const manifestFiles = (await input.core.walkVaultFiles(
    input.vault,
    'raw/workouts',
    { extension: '.json' },
  )).filter((relativePath) => path.posix.basename(relativePath) === 'manifest.json')
  const candidates = new Map<string, ExactRawWorkoutFile>()

  for (const manifestFile of manifestFiles) {
    const manifestPath = input.core.resolveVaultPath(input.vault, manifestFile).absolutePath
    const manifest = input.core.parseRawImportManifest(
      JSON.parse(await readFile(manifestPath, 'utf8')),
    )
    if (manifest.importKind !== 'workout_batch') {
      continue
    }
    const artifacts = manifest.artifacts.filter((artifact) =>
      artifact.role === 'source'
      && artifact.byteSize === expectedBytes
      && artifact.sha256 === expectedHash
      && artifact.relativePath.startsWith(`${manifest.rawDirectory}/`)
      && artifact.relativePath.startsWith('raw/workouts/'))
    for (const artifact of artifacts) {
      if (candidates.has(artifact.relativePath)) {
        continue
      }
      if (candidates.size >= EXACT_RAW_CANDIDATE_LIMIT) {
        throw new VaultCliError(
          'conflict',
          `Workout CSV matches more than ${EXACT_RAW_CANDIDATE_LIMIT} prior raw batches; nothing was imported.`,
        )
      }
      const absolutePath = input.core.resolveVaultPath(
        input.vault,
        artifact.relativePath,
      ).absolutePath
      let matches = false
      try {
        if ((await stat(absolutePath)).size === expectedBytes) {
          const existingHash = createHash('sha256').update(await readFile(absolutePath)).digest('hex')
          matches = existingHash === expectedHash
        }
      } catch {
        matches = false
      }
      if (matches) {
        const source = manifest.source === 'strong' || manifest.source === 'hevy'
          ? manifest.source
          : undefined
        const delimiter = manifest.provenance.delimiter
        const weightUnit = manifest.provenance.weightUnit
        const distanceUnit = manifest.provenance.distanceUnit
        const timeZone = manifest.provenance.timeZone
        candidates.set(artifact.relativePath, {
          rawFile: artifact.relativePath,
          ...(source ? { source } : {}),
          ...(typeof delimiter === 'string' && delimiter.length === 1 ? { delimiter } : {}),
          ...(weightUnit === null || weightUnit === 'lb' || weightUnit === 'kg'
            ? { weightUnit }
            : {}),
          ...(distanceUnit === null || distanceUnit === 'm' || distanceUnit === 'km' || distanceUnit === 'mi'
            ? { distanceUnit }
            : {}),
          ...(typeof timeZone === 'string' ? { timeZone } : {}),
        })
      }
    }
  }
  return [...candidates.values()].sort((left, right) => left.rawFile.localeCompare(right.rawFile))
}

async function findPriorRawWorkoutFiles(input: {
  core: WorkoutImportCoreRuntime
  vault: string
}): Promise<PriorRawWorkoutFile[]> {
  const manifestFiles = (await input.core.walkVaultFiles(
    input.vault,
    'raw/workouts',
    { extension: '.json' },
  )).filter((relativePath) => path.posix.basename(relativePath) === 'manifest.json')
  const candidates: PriorRawWorkoutFile[] = []
  let workoutBatchCount = 0
  let admittedBytes = 0

  for (const manifestFile of manifestFiles) {
    const manifestPath = input.core.resolveVaultPath(input.vault, manifestFile).absolutePath
    const manifest = input.core.parseRawImportManifest(
      JSON.parse(await readFile(manifestPath, 'utf8')),
    )
    if (manifest.importKind !== 'workout_batch') continue
    workoutBatchCount += 1
    if (workoutBatchCount > PRIOR_RAW_BATCH_LIMIT) {
      throw new VaultCliError(
        'conflict',
        `Workout history has more than ${PRIOR_RAW_BATCH_LIMIT} prior raw batches; nothing was imported.`,
      )
    }

    const source = manifest.source === 'strong' || manifest.source === 'hevy'
      ? manifest.source
      : undefined
    const delimiter = manifest.provenance.delimiter
    const weightUnit = manifest.provenance.weightUnit
    const distanceUnit = manifest.provenance.distanceUnit
    const timeZone = manifest.provenance.timeZone
    for (const artifact of manifest.artifacts) {
      if (
        artifact.role !== 'source'
        || !artifact.relativePath.startsWith(`${manifest.rawDirectory}/`)
        || !artifact.relativePath.startsWith('raw/workouts/')
      ) continue
      if (candidates.length >= PRIOR_RAW_BATCH_LIMIT) {
        throw new VaultCliError(
          'conflict',
          `Workout history has more than ${PRIOR_RAW_BATCH_LIMIT} prior source files; nothing was imported.`,
        )
      }
      admittedBytes += artifact.byteSize
      if (admittedBytes > PRIOR_RAW_TOTAL_BYTES_LIMIT) {
        throw new VaultCliError(
          'conflict',
          `Prior workout source files exceed the ${PRIOR_RAW_TOTAL_BYTES_LIMIT}-byte reconciliation limit; nothing was imported.`,
        )
      }
      const absolutePath = input.core.resolveVaultPath(input.vault, artifact.relativePath).absolutePath
      const text = await readFile(absolutePath, 'utf8')
      const byteSize = new TextEncoder().encode(text).byteLength
      const hash = createHash('sha256').update(text).digest('hex')
      if (byteSize !== artifact.byteSize || hash !== artifact.sha256) {
        throw new VaultCliError(
          'conflict',
          'Prior workout raw evidence does not match its manifest; nothing was imported.',
        )
      }
      candidates.push({
        rawFile: artifact.relativePath,
        text,
        ...(source ? { source } : {}),
        ...(typeof delimiter === 'string' && delimiter.length === 1 ? { delimiter } : {}),
        ...(weightUnit === null || weightUnit === 'lb' || weightUnit === 'kg'
          ? { weightUnit }
          : {}),
        ...(distanceUnit === null || distanceUnit === 'm' || distanceUnit === 'km' || distanceUnit === 'mi'
          ? { distanceUnit }
          : {}),
        ...(typeof timeZone === 'string' ? { timeZone } : {}),
      })
    }
  }

  return candidates.sort((left, right) => left.rawFile.localeCompare(right.rawFile))
}

function mappingFromAttachedEvents(
  plan: WorkoutCsvImportPlan,
  matches: readonly WorkoutRawRefMatch[],
): {
  externalRefs: WorkoutExternalIdentity[]
  matches: WorkoutRawRefMatch[]
  records: EventRecord[]
  canonicalSourceMatches: boolean
  currentMappingReplay: boolean
  latestSourceRevision?: string
} | undefined {
  if (matches.length !== plan.sessions.length) {
    return undefined
  }
  const validMatches = matches.every(({ attachment, latest }) => {
    const externalRef = attachment.externalRef
    return attachment.id === latest.id
      && attachment.kind === 'activity_session'
      && latest.kind === 'activity_session'
      && externalRef?.resourceType === 'workout-session'
  })
  if (!validMatches) return undefined

  const alignedMatches = new Array<WorkoutRawRefMatch>(plan.sessions.length)
  const unassignedMatches = new Set(matches)
  const unassignedSessionIndexes = new Set(plan.sessions.map((_session, index) => index))
  const indexesBySourceId = new Map<string, number[]>()
  plan.sessions.forEach((session, index) => {
    for (const sourceId of [session.sourceWorkoutId, session.workout.sourceWorkoutId]) {
      if (!sourceId) continue
      const indexes = indexesBySourceId.get(sourceId) ?? []
      indexes.push(index)
      indexesBySourceId.set(sourceId, indexes)
    }
  })
  for (const match of matches) {
    const sourceIds = [
      match.attachment.kind === 'activity_session'
        ? match.attachment.workout.sourceWorkoutId
        : undefined,
      match.attachment.externalRef?.resourceId,
    ].filter((sourceId): sourceId is string => typeof sourceId === 'string')
    const matchingIndexes = new Set(sourceIds.flatMap((sourceId) =>
      indexesBySourceId.get(sourceId) ?? []))
    if (matchingIndexes.size > 1) return undefined
    const matchingIndex = matchingIndexes.size === 1 ? [...matchingIndexes][0] : undefined
    if (matchingIndex === undefined) continue
    if (!unassignedSessionIndexes.has(matchingIndex)) return undefined
    alignedMatches[matchingIndex] = match
    unassignedMatches.delete(match)
    unassignedSessionIndexes.delete(matchingIndex)
  }

  const matchesByTitle = new Map<string, WorkoutRawRefMatch[]>()
  for (const match of unassignedMatches) {
    const titleMatches = matchesByTitle.get(match.attachment.title) ?? []
    titleMatches.push(match)
    matchesByTitle.set(match.attachment.title, titleMatches)
  }
  const sessionIndexesByTitle = new Map<string, number[]>()
  for (const index of unassignedSessionIndexes) {
    const title = plan.sessions[index]!.title
    const indexes = sessionIndexesByTitle.get(title) ?? []
    indexes.push(index)
    sessionIndexesByTitle.set(title, indexes)
  }
  for (const [title, sessionIndexes] of sessionIndexesByTitle) {
    const titleMatches = matchesByTitle.get(title)
    if (!titleMatches || titleMatches.length !== sessionIndexes.length) {
      return undefined
    }
    sessionIndexes.sort((left, right) =>
      plan.sessions[left]!.occurredAt.localeCompare(plan.sessions[right]!.occurredAt))
    titleMatches.sort((left, right) =>
      left.attachment.occurredAt.localeCompare(right.attachment.occurredAt)
        || left.attachment.id.localeCompare(right.attachment.id))
    sessionIndexes.forEach((sessionIndex, titleIndex) => {
      alignedMatches[sessionIndex] = titleMatches[titleIndex]!
    })
  }
  if (
    alignedMatches.some((match) => match === undefined)
    || new Set(alignedMatches.map((match) => match.latest.id)).size !== alignedMatches.length
  ) {
    return undefined
  }
  const alignedRecords = alignedMatches.map((match) => match.latest)
  const externalRefs = alignedMatches.map(({ attachment, latest }): WorkoutExternalIdentity => {
    const externalRef = latest.externalRef ?? attachment.externalRef!
    if (
      externalRef.resourceType !== 'workout-session'
    ) {
      throw new VaultCliError(
        'conflict',
        'Prior workout evidence lost its canonical workout identity; nothing was imported.',
      )
    }
    return {
      system: externalRef.system,
      resourceType: externalRef.resourceType,
      resourceId: externalRef.resourceId,
      ...(externalRef.facet ? { facet: externalRef.facet } : {}),
    }
  })
  const revisions = alignedMatches
    .map(({ attachment, latest }) => latest.externalRef?.version ?? attachment.externalRef?.version)
    .filter((revision): revision is string => typeof revision === 'string')
    .sort()
  return {
    externalRefs,
    matches: alignedMatches,
    records: alignedRecords,
    canonicalSourceMatches: alignedRecords.every(
      (record) => record.kind === 'activity_session'
        && record.workout?.sourceApp === plan.source,
    ),
    currentMappingReplay: alignedRecords.every(
      (record) => record.externalRef?.version === WORKOUT_CSV_MAPPING_REVISION,
    ),
    ...(revisions.at(-1) ? { latestSourceRevision: revisions.at(-1) } : {}),
  }
}

function comparableSourceSession(session: PlannedWorkoutCsvSession) {
  const {
    sourceApp: _sourceApp,
    sourceWorkoutId: _sourceWorkoutId,
    startedAt: _startedAt,
    endedAt: _endedAt,
    ...workout
  } = session.workout
  return {
    title: session.title,
    sourceEndTimeKey: session.sourceEndTimeKey,
    durationMinutes: session.durationMinutes,
    distanceKm: session.distanceKm,
    note: session.note,
    workout,
  }
}

async function resolvePriorSnapshotRecords(input: {
  core: WorkoutImportCoreRuntime
  importers: WorkoutImportersRuntime
  vault: string
  plan: WorkoutCsvImportPlan
  text: string
}): Promise<Array<EventRecord | null | undefined>> {
  const priorFiles = await findPriorRawWorkoutFiles(input)
  if (priorFiles.length === 0) return new Array(input.plan.sessions.length)
  const eventsByRawFile = await input.core.findEventsByRawRefs({
    vaultRoot: input.vault,
    rawRefs: priorFiles.map((candidate) => candidate.rawFile),
    resourceType: 'workout-session',
  })
  const currentIndexesByKey = new Map(
    input.plan.sessions.map((session, index) => [session.sourceSessionKey, index]),
  )
  const alignedRecords = new Array<EventRecord | undefined>(input.plan.sessions.length)
  let exactPartialEvidence = false

  for (const [candidateIndex, candidate] of priorFiles.entries()) {
    const matches = eventsByRawFile[candidateIndex] ?? []
    if (matches.length === 0) continue
    if (candidate.text === input.text) exactPartialEvidence = true
    const recordTimeZones = new Set(matches
      .map((match) => match.attachment.timeZone)
      .filter((timeZone): timeZone is string => typeof timeZone === 'string'))
    const timeZone = recordTimeZones.size === 1
      ? [...recordTimeZones][0]!
      : candidate.timeZone
    if (!timeZone) {
      throw new VaultCliError(
        'conflict',
        'Prior workout evidence does not prove one parsing timezone; nothing was imported.',
      )
    }
    let priorPlan: WorkoutCsvImportPlan
    try {
      priorPlan = input.importers.planWorkoutCsvImport({
        text: candidate.text,
        timeZone,
        source: candidate.source,
        delimiter: candidate.delimiter,
        weightUnit: candidate.weightUnit ?? undefined,
        distanceUnit: candidate.distanceUnit ?? undefined,
      })
    } catch {
      throw new VaultCliError(
        'conflict',
        'Prior workout raw evidence cannot be parsed safely for identity reconciliation; nothing was imported.',
      )
    }
    const hasCurrentOverlap = priorPlan.sessions.some((session) =>
      currentIndexesByKey.has(session.sourceSessionKey))
    if (!hasCurrentOverlap) continue
    let comparisonPlan: WorkoutCsvImportPlan
    try {
      comparisonPlan = input.importers.planWorkoutCsvImport({
        text: candidate.text,
        timeZone: input.plan.timeZone,
        source: input.plan.source,
        delimiter: candidate.delimiter,
        weightUnit: input.plan.weightUnit ?? undefined,
        distanceUnit: input.plan.distanceUnit ?? undefined,
      })
    } catch {
      throw new VaultCliError(
        'conflict',
        'Prior workout source sessions cannot be compared safely with the current export; nothing was imported.',
      )
    }
    const comparisonByKey = new Map(
      comparisonPlan.sessions.map((session) => [session.sourceSessionKey, session]),
    )
    for (const priorSession of priorPlan.sessions) {
      const currentIndex = currentIndexesByKey.get(priorSession.sourceSessionKey)
      if (currentIndex === undefined) continue
      const currentSession = input.plan.sessions[currentIndex]!
      const comparablePrior = comparisonByKey.get(priorSession.sourceSessionKey)
      if (
        !comparablePrior
        || JSON.stringify(comparableSourceSession(comparablePrior))
          !== JSON.stringify(comparableSourceSession(currentSession))
      ) {
        throw new VaultCliError(
          'conflict',
          'A prior workout source session changed without an ordered source revision; nothing was imported.',
        )
      }
    }
    const fullMapping = mappingFromAttachedEvents(priorPlan, matches)
    const partialMatchesByIndex = new Map<number, WorkoutRawRefMatch>()
    if (fullMapping) {
      fullMapping.matches.forEach((match, index) => partialMatchesByIndex.set(index, match))
    } else {
      const indexesBySourceId = new Map(
        priorPlan.sessions.map((session, index) => [session.sourceWorkoutId, index]),
      )
      const indexesByTitleAndTime = new Map(
        priorPlan.sessions.map((session, index) => [`${session.title}\0${session.occurredAt}`, index]),
      )
      for (const match of matches) {
        const record = match.attachment
        const matchingIndexes = new Set<number>()
        const nestedSourceId = record.kind === 'activity_session'
          ? record.workout.sourceWorkoutId
          : undefined
        const nestedIndex = nestedSourceId
          ? indexesBySourceId.get(nestedSourceId)
          : undefined
        const externalIndex = record.externalRef
          ? indexesBySourceId.get(record.externalRef.resourceId)
          : undefined
        const titleTimeIndex = indexesByTitleAndTime.get(`${record.title}\0${record.occurredAt}`)
        if (nestedIndex !== undefined) matchingIndexes.add(nestedIndex)
        if (externalIndex !== undefined) matchingIndexes.add(externalIndex)
        if (titleTimeIndex !== undefined) matchingIndexes.add(titleTimeIndex)
        const matchingIndex = matchingIndexes.size === 1 ? [...matchingIndexes][0] : undefined
        if (matchingIndex === undefined || partialMatchesByIndex.has(matchingIndex)) {
          throw new VaultCliError(
            'conflict',
            'Prior workout evidence has partial or ambiguous session attachments; nothing was imported.',
          )
        }
        partialMatchesByIndex.set(matchingIndex, match)
      }
    }
    priorPlan.sessions.forEach((session, priorIndex) => {
      const currentIndex = currentIndexesByKey.get(session.sourceSessionKey)
      if (currentIndex === undefined) return
      const match = partialMatchesByIndex.get(priorIndex)
      if (!match) return
      const record = match.latest
      const currentSession = input.plan.sessions[currentIndex]!
      if (
        record.kind !== 'activity_session'
        || record.workout.sourceApp !== input.plan.source
      ) {
        throw new VaultCliError(
          'conflict',
          'Prior workout sessions use a different provider dialect; correct the exact prior file first. Nothing was imported.',
        )
      }
      if (
        JSON.stringify(unitOwnedProjection(record.workout, record.distanceKm))
          !== JSON.stringify(unitOwnedProjection(currentSession.workout, currentSession.distanceKm))
      ) {
        throw new VaultCliError(
          'conflict',
          'Prior workout sessions use different unit-derived values; correct the exact prior file first. Nothing was imported.',
        )
      }
      const selected = alignedRecords[currentIndex]
      if (selected && selected.id !== record.id) {
        throw new VaultCliError(
          'conflict',
          'Prior workout snapshots map one source session to conflicting event identities; nothing was imported.',
        )
      }
      alignedRecords[currentIndex] = selected ?? record
    })
  }

  if (exactPartialEvidence && alignedRecords.some((record) => record === undefined)) {
    throw new VaultCliError(
      'conflict',
      'Exact prior workout snapshot cannot resolve every source session identity; nothing was imported.',
    )
  }

  return alignedRecords.map((record) =>
    record?.lifecycle?.state === 'deleted' ? null : record)
}

async function resolveExistingWorkoutEvidence(input: {
  core: WorkoutImportCoreRuntime
  vault: string
  text: string
  plan: WorkoutCsvImportPlan
}): Promise<{
  rawFile?: string
  externalRefs?: WorkoutExternalIdentity[]
  matches?: WorkoutRawRefMatch[]
  records?: EventRecord[]
  canonicalSourceMatches?: boolean
  currentMappingReplay?: boolean
  currentUnitsMatch?: boolean
  latestSourceRevision?: string
  originalTimeZone?: string
  originalSource?: WorkoutCsvSource
  originalDelimiter?: string
  originalWeightUnit?: WorkoutCsvWeightUnit | null
  originalDistanceUnit?: WorkoutCsvDistanceUnit | null
}> {
  const exactRawFiles = await findExactRawWorkoutFiles({
    core: input.core,
    vault: input.vault,
    text: input.text,
  })
  if (exactRawFiles.length === 0) {
    return {}
  }

  const eventsByRawFile = await input.core.findEventsByRawRefs({
    vaultRoot: input.vault,
    rawRefs: exactRawFiles.map((candidate) => candidate.rawFile),
    resourceType: 'workout-session',
  })
  let rawOnlyFile: string | undefined
  let foundAmbiguousCanonicalEvidence = false
  let selectedEvidence: {
    rawFile: string
    externalRefs: WorkoutExternalIdentity[]
    matches: WorkoutRawRefMatch[]
    records: EventRecord[]
    canonicalSourceMatches: boolean
    currentMappingReplay: boolean
    currentUnitsMatch: boolean
    latestSourceRevision?: string
    originalTimeZone?: string
    originalSource?: WorkoutCsvSource
    originalDelimiter?: string
    originalWeightUnit?: WorkoutCsvWeightUnit | null
    originalDistanceUnit?: WorkoutCsvDistanceUnit | null
  } | undefined
  for (const [index, candidate] of exactRawFiles.entries()) {
    const rawFile = candidate.rawFile
    const matches = eventsByRawFile[index] ?? []
    if (matches.length === 0) {
      rawOnlyFile = rawOnlyFile ?? rawFile
      continue
    }
    const mapping = mappingFromAttachedEvents(input.plan, matches)
    if (mapping) {
      const recordTimeZones = new Set(mapping.matches
        .map((match) => match.attachment.timeZone)
        .filter((timeZone): timeZone is string => typeof timeZone === 'string'))
      const recordTimeZone = recordTimeZones.size === 1 ? [...recordTimeZones][0] : undefined
      const originalTimeZone = recordTimeZone ?? candidate.timeZone
      const evidence = {
        rawFile,
        ...mapping,
        currentUnitsMatch:
          (candidate.weightUnit === undefined && candidate.distanceUnit === undefined)
          || (
            candidate.weightUnit === (input.plan.weightUnit ?? null)
            && candidate.distanceUnit === (input.plan.distanceUnit ?? null)
          ),
        ...(originalTimeZone ? { originalTimeZone } : {}),
        ...(candidate.source ? { originalSource: candidate.source } : {}),
        ...(candidate.delimiter ? { originalDelimiter: candidate.delimiter } : {}),
        ...(candidate.weightUnit !== undefined ? { originalWeightUnit: candidate.weightUnit } : {}),
        ...(candidate.distanceUnit !== undefined ? { originalDistanceUnit: candidate.distanceUnit } : {}),
      }
      if (
        selectedEvidence
        && selectedEvidence.records.map((record) => record.id).join('\0')
          !== evidence.records.map((record) => record.id).join('\0')
      ) {
        foundAmbiguousCanonicalEvidence = true
      } else {
        selectedEvidence = selectedEvidence ?? evidence
      }
      continue
    }
    rawOnlyFile = rawOnlyFile ?? rawFile
  }

  if (foundAmbiguousCanonicalEvidence) {
    throw new VaultCliError(
      'conflict',
      'Exact prior workout evidence has an ambiguous canonical event mapping; nothing was imported.',
    )
  }
  if (selectedEvidence) {
    return selectedEvidence
  }
  return {
    ...(rawOnlyFile ? { rawFile: rawOnlyFile } : {}),
  }
}

function correctionStructure(workout: WorkoutSession | undefined) {
  return workout?.exercises.map((exercise) => ({
    name: exercise.name,
    sourceExerciseId: exercise.sourceExerciseId,
    order: exercise.order,
    groupId: exercise.groupId,
    mode: exercise.mode,
    note: exercise.note,
    sets: exercise.sets.map((set) => ({
      order: set.order,
      type: set.type,
      note: set.note,
      reps: set.reps,
      durationSeconds: set.durationSeconds,
      rpe: set.rpe,
    })),
  }))
}

function unitOwnedProjection(
  workout: WorkoutSession | undefined,
  distanceKm: number | undefined,
) {
  return {
    distanceKm,
    exercises: workout?.exercises.map((exercise) => ({
      unitOverride: exercise.unitOverride,
      sets: exercise.sets.map((set) => ({
        weight: set.weight,
        weightUnit: set.weightUnit,
        distanceMeters: set.distanceMeters,
        bodyweightKg: set.bodyweightKg,
        assistanceKg: set.assistanceKg,
        addedWeightKg: set.addedWeightKg,
      })),
    })),
  }
}

function assertCorrectionStructure(
  session: PlannedWorkoutCsvSession,
  record: EventRecord,
): asserts record is EventRecord & { kind: 'activity_session', workout: WorkoutSession } {
  if (
    record.kind !== 'activity_session'
    || JSON.stringify(correctionStructure(record.workout))
      !== JSON.stringify(correctionStructure(session.workout))
  ) {
    throw new VaultCliError(
      'conflict',
      'Exact prior workout evidence overlaps edited exercise or set fields; nothing was imported.',
    )
  }
}

function replaceOptionalSetField<K extends keyof WorkoutSet>(
  set: WorkoutSet,
  key: K,
  value: WorkoutSet[K] | undefined,
): void {
  if (value === undefined) {
    delete set[key]
  } else {
    set[key] = value
  }
}

function correctedExternalRef(record: EventRecord, mappingRevision: string) {
  const externalRef = record.externalRef
  if (!externalRef) {
    throw new VaultCliError(
      'conflict',
      'Exact prior workout event has no authoritative external identity; nothing was imported.',
    )
  }
  return { ...externalRef, version: mappingRevision }
}

function eventRecordPayloadWithRevision(
  record: EventRecord,
  mappingRevision: string,
): JsonObject {
  const payload = eventRecordToImportPayload(record)
  payload.externalRef = correctedExternalRef(record, mappingRevision)
  return payload
}

function buildUnitCorrectionPayload(input: {
  record: EventRecord
  session: PlannedWorkoutCsvSession
  ownershipSessions: readonly PlannedWorkoutCsvSession[]
  mappingRevision: string
  correctWeight: boolean
  correctDistance: boolean
}): JsonObject {
  assertCorrectionStructure(input.session, input.record)
  const recordProjection = JSON.stringify(unitOwnedProjection(
    input.record.workout,
    input.record.distanceKm,
  ))
  if (!input.ownershipSessions.some((session) =>
    JSON.stringify(unitOwnedProjection(session.workout, session.distanceKm)) === recordProjection)) {
    throw new VaultCliError(
      'conflict',
      'Exact prior workout evidence overlaps edited load or distance fields; nothing was imported.',
    )
  }
  const payload = eventRecordToImportPayload(input.record)
  const workout = structuredClone(input.record.workout)
  workout.exercises.forEach((exercise, exerciseIndex) => {
    const plannedExercise = input.session.workout.exercises[exerciseIndex]!
    if (input.correctWeight) {
      exercise.unitOverride = plannedExercise.unitOverride
    }
    exercise.sets.forEach((set, setIndex) => {
      const plannedSet = plannedExercise.sets[setIndex]!
      if (input.correctWeight) {
        replaceOptionalSetField(set, 'weight', plannedSet.weight)
        replaceOptionalSetField(set, 'weightUnit', plannedSet.weightUnit)
        replaceOptionalSetField(set, 'bodyweightKg', plannedSet.bodyweightKg)
        replaceOptionalSetField(set, 'assistanceKg', plannedSet.assistanceKg)
        replaceOptionalSetField(set, 'addedWeightKg', plannedSet.addedWeightKg)
      }
      if (input.correctDistance) {
        replaceOptionalSetField(set, 'distanceMeters', plannedSet.distanceMeters)
      }
    })
  })
  payload.workout = workout
  if (input.correctDistance) {
    if (input.session.distanceKm === undefined) delete payload.distanceKm
    else payload.distanceKm = input.session.distanceKm
  }
  payload.externalRef = correctedExternalRef(input.record, input.mappingRevision)
  return payload
}

function buildUnitOwnershipPlans(input: {
  importers: WorkoutImportersRuntime
  text: string
  timeZone: string
  source: WorkoutCsvSource
  delimiter?: string
}): WorkoutCsvImportPlan[] {
  const plans: WorkoutCsvImportPlan[] = []
  const seen = new Set<string>()
  for (const weightUnit of [undefined, 'lb', 'kg'] as const) {
    for (const distanceUnit of [undefined, 'm', 'km', 'mi'] as const) {
      try {
        const plan = input.importers.planWorkoutCsvImport({
          text: input.text,
          timeZone: input.timeZone,
          source: input.source,
          delimiter: input.delimiter,
          weightUnit,
          distanceUnit,
        })
        if (!plan.importable) continue
        const key = JSON.stringify(plan.sessions.map((session) =>
          unitOwnedProjection(session.workout, session.distanceKm)))
        if (!seen.has(key)) {
          seen.add(key)
          plans.push(plan)
        }
      } catch {
        // Conflicting explicit/header unit combinations are not valid ownership candidates.
      }
    }
  }
  return plans
}

function canonicalCsvNote(session: PlannedWorkoutCsvSession): string {
  return session.note
    ?? session.workout.sessionNote
    ?? session.workout.routineName
    ?? session.title
}

function dialectOwnedStructure(workout: WorkoutSession | undefined) {
  return workout?.exercises.map((exercise) => ({
    name: exercise.name,
    order: exercise.order,
    note: exercise.note,
    sets: exercise.sets.map((set) => ({ order: set.order, type: set.type })),
  }))
}

function buildDialectCorrectionPayload(input: {
  record: EventRecord
  originalSession: PlannedWorkoutCsvSession
  correctedSession: PlannedWorkoutCsvSession
  mappingRevision: string
}): JsonObject {
  if (
    input.record.kind !== 'activity_session'
    || JSON.stringify(dialectOwnedStructure(input.record.workout))
      !== JSON.stringify(dialectOwnedStructure(input.originalSession.workout))
  ) {
    throw new VaultCliError(
      'conflict',
      'Exact prior workout evidence overlaps edited provider-owned fields; nothing was imported.',
    )
  }
  const payload = eventRecordToImportPayload(input.record)
  const workout = structuredClone(input.record.workout)
  workout.sourceApp = input.correctedSession.workout.sourceApp
  workout.sourceWorkoutId = input.correctedSession.workout.sourceWorkoutId
  workout.exercises.forEach((exercise, exerciseIndex) => {
    const correctedExercise = input.correctedSession.workout.exercises[exerciseIndex]!
    exercise.note = correctedExercise.note
    exercise.sets.forEach((set, setIndex) => {
      const correctedSet = correctedExercise.sets[setIndex]!
      set.order = correctedSet.order
      set.type = correctedSet.type
    })
  })
  const originalSessionNote = input.originalSession.workout.sessionNote
    ?? canonicalCsvNote(input.originalSession)
  const correctedSessionNote = input.correctedSession.workout.sessionNote
    ?? canonicalCsvNote(input.correctedSession)
  if (originalSessionNote !== correctedSessionNote) {
    if (workout.sessionNote !== originalSessionNote) {
      throw new VaultCliError(
        'conflict',
        'Exact prior workout evidence overlaps an edited session note; nothing was imported.',
      )
    }
    workout.sessionNote = correctedSessionNote
  }
  const originalNote = canonicalCsvNote(input.originalSession)
  const correctedNote = canonicalCsvNote(input.correctedSession)
  if (originalNote !== correctedNote) {
    if (input.record.note !== originalNote) {
      throw new VaultCliError(
        'conflict',
        'Exact prior workout evidence overlaps an edited workout note; nothing was imported.',
      )
    }
    payload.note = correctedNote
  }
  payload.workout = workout
  payload.externalRef = correctedExternalRef(input.record, input.mappingRevision)
  return payload
}

function mapBatchError(error: unknown): unknown {
  return toVaultCliError(error, {
    EVENT_BATCH_INVALID: { code: 'contract_invalid' },
    EVENT_SOURCE_REVISION_CONFLICT: { code: 'conflict' },
    EVENT_SOURCE_REVISION_UNORDERED: { code: 'conflict' },
    EVENT_KIND_MISMATCH: { code: 'conflict' },
  })
}

export async function inspectWorkoutCsvImport(input: {
  vault: string
  file: string
  source?: WorkoutCsvSource
  delimiter?: string
  weightUnit?: WorkoutCsvWeightUnit
  distanceUnit?: WorkoutCsvDistanceUnit
}) {
  const { plan } = await loadWorkoutCsvPlan(input)
  return {
    vault: input.vault,
    sourceFile: input.file,
    source: plan.source,
    detectedSource: plan.detectedSource,
    delimiter: plan.delimiter,
    timeZone: plan.timeZone,
    weightUnit: plan.weightUnit,
    distanceUnit: plan.distanceUnit,
    headers: plan.headers,
    rowCount: plan.rowCount,
    repairedRowCount: plan.repairedRowCount,
    ignoredRowCount: plan.ignoredRowCount,
    skippedRowCount: plan.skippedRowCount,
    skipReasons: plan.skipReasons,
    estimatedWorkouts: plan.estimatedWorkouts,
    requiresWeightUnit: plan.requiresWeightUnit,
    requiresDistanceUnit: plan.requiresDistanceUnit,
    importable: plan.importable,
    warnings: plan.warnings,
  }
}

export async function importWorkoutCsv(input: {
  vault: string
  file: string
  source?: WorkoutCsvSource
  delimiter?: string
  weightUnit?: WorkoutCsvWeightUnit
  distanceUnit?: WorkoutCsvDistanceUnit
  storeRawOnly?: boolean
  correctUnits?: boolean
}) {
  const loaded = await loadWorkoutCsvPlan(input)
  const { text, core, importers } = loaded
  let { plan } = loaded
  if (input.correctUnits && input.storeRawOnly) {
    throw new VaultCliError(
      'invalid_option',
      '--correct-units cannot be combined with --store-raw-only.',
    )
  }
  if (input.correctUnits && !input.weightUnit && !input.distanceUnit) {
    throw new VaultCliError(
      'invalid_option',
      '--correct-units requires --weight-unit and/or --distance-unit.',
    )
  }

  if (input.storeRawOnly) {
    assertSupportedWorkoutSource(plan)
    const { generateUlid } = await loadWorkoutImportStateRuntime()
    const batch = prepareRawWorkoutBatch({
      core,
      file: input.file,
      text,
      plan,
      importId: `${ID_PREFIXES.transform}_${generateUlid()}`,
      importedAt: new Date().toISOString(),
    })
    await storeRawWorkoutBatch({
      core,
      vault: input.vault,
      sourceFile: input.file,
      text,
      batch,
    })
    return {
      vault: input.vault,
      sourceFile: input.file,
      rawFile: batch.rawFile,
      manifestFile: batch.manifestFile,
      rawStored: true,
      source: plan.source,
      timeZone: plan.timeZone,
      weightUnit: plan.weightUnit,
      distanceUnit: plan.distanceUnit,
      parsedWorkoutCount: plan.sessions.length,
      receivedCount: 0,
      importedCount: 0,
      createdCount: 0,
      skippedExistingCount: 0,
      supersededCount: 0,
      repairedRowCount: plan.repairedRowCount,
      ignoredRowCount: plan.ignoredRowCount,
      skippedRowCount: plan.skippedRowCount,
      rawOnly: true,
      lookupIds: [],
      lookupIdsTruncated: false,
      ledgerFiles: [],
      ledgerFilesTruncated: false,
      warnings: plan.warnings,
    }
  }

  assertStructuredPlanImportable(plan)
  const existingEvidence = await resolveExistingWorkoutEvidence({
    core,
    vault: input.vault,
    text,
    plan,
  })
  const sourceDialectCorrection = existingEvidence.records !== undefined
    && existingEvidence.canonicalSourceMatches === false
  if (
    existingEvidence.currentMappingReplay
    && !existingEvidence.currentUnitsMatch
    && !input.correctUnits
  ) {
    throw new VaultCliError(
      'conflict',
      'This exact workout CSV was imported with different unit choices. Confirm the correction and rerun with --correct-units.',
    )
  }
  if (
    existingEvidence.currentMappingReplay
    && !input.correctUnits
    && !sourceDialectCorrection
  ) {
    return {
      vault: input.vault,
      sourceFile: input.file,
      rawFile: null,
      manifestFile: null,
      rawStored: false,
      source: plan.source,
      timeZone: plan.timeZone,
      weightUnit: plan.weightUnit,
      distanceUnit: plan.distanceUnit,
      parsedWorkoutCount: plan.sessions.length,
      receivedCount: plan.sessions.length,
      importedCount: 0,
      createdCount: 0,
      skippedExistingCount: plan.sessions.length,
      supersededCount: 0,
      repairedRowCount: plan.repairedRowCount,
      ignoredRowCount: plan.ignoredRowCount,
      skippedRowCount: plan.skippedRowCount,
      rawOnly: false,
      lookupIds: [],
      lookupIdsTruncated: false,
      ledgerFiles: [],
      ledgerFilesTruncated: false,
      warnings: plan.warnings,
    }
  }
  const requiresEvidenceCorrection = input.correctUnits || sourceDialectCorrection
  if (requiresEvidenceCorrection && !existingEvidence.rawFile) {
    throw new VaultCliError(
      'invalid_option',
      'Workout correction requires an exact previously imported workout CSV; nothing was imported.',
    )
  }
  let existingExternalRefs = existingEvidence.externalRefs
  let originalCorrectionPlan: WorkoutCsvImportPlan | undefined
  let correctedRecords: EventRecord[] | undefined
  let unitOwnershipPlans: WorkoutCsvImportPlan[] = []
  if (requiresEvidenceCorrection) {
    if (!existingEvidence.originalTimeZone || !existingEvidence.records || !existingEvidence.matches) {
      throw new VaultCliError(
        'conflict',
        'Exact prior workout evidence does not prove its original timezone; nothing was imported.',
      )
    }
    if (input.correctUnits && sourceDialectCorrection) {
      throw new VaultCliError(
        'invalid_option',
        'Correct the workout provider first, then run a separate --correct-units command; nothing was imported.',
      )
    }
    const originalSource = existingEvidence.originalSource
      ?? (sourceDialectCorrection ? undefined : plan.source)
    if (!originalSource) {
      throw new VaultCliError(
        'conflict',
        'Exact prior workout evidence does not prove its original provider; nothing was imported.',
      )
    }
    originalCorrectionPlan = importers.planWorkoutCsvImport({
      text,
      timeZone: existingEvidence.originalTimeZone,
      source: originalSource,
      delimiter: existingEvidence.originalDelimiter ?? input.delimiter,
      weightUnit: existingEvidence.originalWeightUnit ?? undefined,
      distanceUnit: existingEvidence.originalDistanceUnit ?? undefined,
    })
    if (input.correctUnits) {
      unitOwnershipPlans = buildUnitOwnershipPlans({
        importers,
        text,
        timeZone: existingEvidence.originalTimeZone,
        source: originalSource,
        delimiter: existingEvidence.originalDelimiter ?? input.delimiter,
      })
    }
    const correctionPlan = importers.planWorkoutCsvImport({
      text,
      timeZone: existingEvidence.originalTimeZone,
      source: input.source,
      delimiter: input.delimiter,
      weightUnit: input.weightUnit,
      distanceUnit: input.distanceUnit,
    })
    assertStructuredPlanImportable(correctionPlan)
    const correctedMapping = mappingFromAttachedEvents(
      correctionPlan,
      existingEvidence.matches,
    )
    if (!correctedMapping) {
      throw new VaultCliError(
        'conflict',
        'Exact prior workout evidence has an ambiguous correction mapping; nothing was imported.',
      )
    }
    plan = correctionPlan
    existingExternalRefs = correctedMapping.externalRefs
    correctedRecords = correctedMapping.records
  }
  const priorRevisionTimestamp = existingEvidence.latestSourceRevision
    ? Date.parse(existingEvidence.latestSourceRevision)
    : Number.NaN
  const mappingRevision = requiresEvidenceCorrection
    ? new Date(Math.max(
        Date.now(),
        Date.parse(WORKOUT_CSV_MAPPING_REVISION) + 1,
        Number.isFinite(priorRevisionTimestamp) ? priorRevisionTimestamp + 1 : 0,
      )).toISOString()
    : WORKOUT_CSV_MAPPING_REVISION
  const { generateUlid } = await loadWorkoutImportStateRuntime()
  const batch = prepareRawWorkoutBatch({
    core,
    file: input.file,
    text,
    plan,
    importId: `${ID_PREFIXES.transform}_${generateUlid()}`,
    importedAt: new Date().toISOString(),
  })
  const rawFile = existingEvidence.rawFile ?? batch.rawFile
  let existingPayloads: Array<JsonObject | null | undefined> | undefined
  if (requiresEvidenceCorrection) {
    const records = correctedRecords!
    const originalPlan = originalCorrectionPlan!
    const originalMapping = mappingFromAttachedEvents(originalPlan, existingEvidence.matches!)
    if (!originalMapping) {
      throw new VaultCliError(
        'conflict',
        'Exact prior workout evidence cannot prove its original session mapping; nothing was imported.',
      )
    }
    existingPayloads = records.map((record, index) => {
      if (record.lifecycle?.state === 'deleted') return null
      if (originalMapping.records[index]?.id !== record.id) {
        throw new VaultCliError(
          'conflict',
          'Exact prior workout evidence changes session ordering across correction dialects; nothing was imported.',
        )
      }
      if (sourceDialectCorrection) {
        return buildDialectCorrectionPayload({
          record,
          originalSession: originalPlan.sessions[index]!,
          correctedSession: plan.sessions[index]!,
          mappingRevision,
        })
      }
      return buildUnitCorrectionPayload({
        record,
        session: plan.sessions[index]!,
        ownershipSessions: unitOwnershipPlans.map((ownershipPlan) =>
          ownershipPlan.sessions[index]!),
        mappingRevision,
        correctWeight: input.weightUnit !== undefined,
        correctDistance: input.distanceUnit !== undefined,
      })
    })
  } else if (existingEvidence.records) {
    existingPayloads = existingEvidence.records.map((record) =>
      record.lifecycle?.state === 'deleted'
        ? null
        : eventRecordPayloadWithRevision(record, mappingRevision))
  } else {
    const priorRecords = await resolvePriorSnapshotRecords({
      core,
      importers,
      vault: input.vault,
      plan,
      text,
    })
    if (priorRecords.some((record) => record !== undefined)) {
      existingPayloads = priorRecords.map((record) =>
        record === null ? null : record ? eventRecordToImportPayload(record) : undefined)
    }
  }
  const { decisions, suppressedDeletedCount } = buildWorkoutEventDecisions(
    plan,
    rawFile,
    existingExternalRefs,
    mappingRevision,
    existingPayloads,
  )
  let preview: WorkoutImportBatchResult
  try {
    preview = await core.importEventBatch({
      vaultRoot: input.vault,
      decisions,
      apply: false,
    })
  } catch (error) {
    throw mapBatchError(error)
  }

  const previewChangedCount = preview.createdCount + preview.supersededCount
  if (previewChangedCount === 0) {
    const ledgers = capList(preview.eventShardPaths)
    return {
      vault: input.vault,
      sourceFile: input.file,
      rawFile: null,
      manifestFile: null,
      rawStored: false,
      source: plan.source,
      timeZone: plan.timeZone,
      weightUnit: plan.weightUnit,
      distanceUnit: plan.distanceUnit,
      parsedWorkoutCount: plan.sessions.length,
      receivedCount: preview.receivedCount + suppressedDeletedCount,
      importedCount: 0,
      createdCount: 0,
      skippedExistingCount: preview.skippedExistingCount + suppressedDeletedCount,
      supersededCount: 0,
      repairedRowCount: plan.repairedRowCount,
      ignoredRowCount: plan.ignoredRowCount,
      skippedRowCount: plan.skippedRowCount,
      rawOnly: false,
      lookupIds: [],
      lookupIdsTruncated: false,
      ledgerFiles: ledgers.values,
      ledgerFilesTruncated: ledgers.truncated,
      warnings: plan.warnings,
    }
  }

  const rawStored = existingEvidence.rawFile === undefined
  const manifestFile: string | null = rawStored ? batch.manifestFile : null

  if (rawStored) {
    await storeRawWorkoutBatch({
      core,
      vault: input.vault,
      sourceFile: input.file,
      text,
      batch,
    })
  }
  let applied: WorkoutImportBatchResult
  try {
    applied = await core.importEventBatch({
      vaultRoot: input.vault,
      decisions,
      apply: true,
    })
  } catch (error) {
    throw mapBatchError(error)
  }

  const lookupIds = capList(applied.eventIds)
  const ledgerFiles = capList(applied.eventShardPaths)
  return {
    vault: input.vault,
    sourceFile: input.file,
    rawFile,
    manifestFile,
    rawStored,
    source: plan.source,
    timeZone: plan.timeZone,
    weightUnit: plan.weightUnit,
    distanceUnit: plan.distanceUnit,
    parsedWorkoutCount: plan.sessions.length,
    receivedCount: applied.receivedCount + suppressedDeletedCount,
    importedCount: applied.createdCount + applied.supersededCount,
    createdCount: applied.createdCount,
    skippedExistingCount: applied.skippedExistingCount + suppressedDeletedCount,
    supersededCount: applied.supersededCount,
    repairedRowCount: plan.repairedRowCount,
    ignoredRowCount: plan.ignoredRowCount,
    skippedRowCount: plan.skippedRowCount,
    rawOnly: false,
    lookupIds: lookupIds.values,
    lookupIdsTruncated: lookupIds.truncated,
    ledgerFiles: ledgerFiles.values,
    ledgerFilesTruncated: ledgerFiles.truncated,
    warnings: plan.warnings,
  }
}
