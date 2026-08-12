import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path, { basename, extname } from 'node:path'

import { ID_PREFIXES, type JsonObject } from '@murphai/contracts'
import {
  type WorkoutCsvDistanceUnit,
  type WorkoutCsvImportPlan,
  type WorkoutCsvWeightUnit,
} from '@murphai/importers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { loadRuntimeModule } from '../runtime-import.js'
import { compactObject, toVaultCliError } from './vault-usecase-helpers.js'
import { buildStructuredWorkoutActivitySessionDraft } from './workout.js'

const DEFAULT_SOURCE = 'strong'
const DEFAULT_DELIMITER = ','
const RESULT_LIST_LIMIT = 10
const WORKOUT_CSV_SOURCE_REVISION = '1970-01-01T00:00:00.000Z'

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
}

interface WorkoutImportersRuntime {
  planWorkoutCsvImport(input: {
    text: string
    timeZone: string
    source?: string
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

function buildWorkoutEventDecisions(
  plan: WorkoutCsvImportPlan,
  rawFile: string,
): JsonObject[] {
  return plan.sessions.map((session) => {
    const draft = buildStructuredWorkoutActivitySessionDraft({
      payload: compactObject({
        title: session.title,
        occurredAt: session.occurredAt,
        timeZone: plan.timeZone,
        source: 'import',
        activityType: 'strength-training',
        durationMinutes: session.durationMinutes,
        note: session.note,
        rawRefs: [rawFile],
        externalRef: {
          system: sanitizePathSegment(plan.source, DEFAULT_SOURCE),
          resourceType: 'workout-session',
          resourceId: session.sourceWorkoutId,
          version: WORKOUT_CSV_SOURCE_REVISION,
        },
        workout: session.workout,
      }) as JsonObject,
      source: 'import',
    })

    const payload = {
      kind: 'activity_session',
      ...draft,
    } as JsonObject

    return {
      action: 'upsert',
      payload,
    }
  })
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
  source?: string
  delimiter?: string
  weightUnit?: WorkoutCsvWeightUnit
  distanceUnit?: WorkoutCsvDistanceUnit
}): Promise<{ text: string, plan: WorkoutCsvImportPlan, core: WorkoutImportCoreRuntime }> {
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
  return { text, plan, core }
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

function capList(values: readonly string[]): { values: string[], truncated: boolean } {
  return {
    values: values.slice(0, RESULT_LIST_LIMIT),
    truncated: values.length > RESULT_LIST_LIMIT,
  }
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
  source?: string
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
  source?: string
  delimiter?: string
  weightUnit?: WorkoutCsvWeightUnit
  distanceUnit?: WorkoutCsvDistanceUnit
  storeRawOnly?: boolean
}) {
  const { text, plan, core } = await loadWorkoutCsvPlan(input)
  const { generateUlid } = await loadWorkoutImportStateRuntime()
  const batch = prepareRawWorkoutBatch({
    core,
    file: input.file,
    text,
    plan,
    importId: `${ID_PREFIXES.transform}_${generateUlid()}`,
    importedAt: new Date().toISOString(),
  })

  if (input.storeRawOnly) {
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
  const decisions = buildWorkoutEventDecisions(plan, batch.rawFile)
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
      receivedCount: preview.receivedCount,
      importedCount: 0,
      createdCount: 0,
      skippedExistingCount: preview.skippedExistingCount,
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

  await storeRawWorkoutBatch({
    core,
    vault: input.vault,
    sourceFile: input.file,
    text,
    batch,
  })
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
    rawFile: batch.rawFile,
    manifestFile: batch.manifestFile,
    rawStored: true,
    source: plan.source,
    timeZone: plan.timeZone,
    weightUnit: plan.weightUnit,
    distanceUnit: plan.distanceUnit,
    parsedWorkoutCount: plan.sessions.length,
    receivedCount: applied.receivedCount,
    importedCount: applied.createdCount + applied.supersededCount,
    createdCount: applied.createdCount,
    skippedExistingCount: applied.skippedExistingCount,
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
