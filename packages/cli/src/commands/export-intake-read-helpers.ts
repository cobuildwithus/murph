import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { rawImportManifestSchema } from '@murphai/contracts'
import { z } from 'incur'
import { firstString } from '@murphai/operator-config/command-helpers'
import {
  loadQueryRuntime as loadBaseQueryRuntime,
  type QueryRuntimeModule,
  type QueryCanonicalEntity as AssessmentEntity,
} from '@murphai/vault-usecases/runtime'
import {
  readMaterializedExportPackReceipt,
  retireMaterializedExportPack,
} from '@murphai/vault-usecases/export-packs'
import {
  materializeExportPack,
  resolveVaultRelativePath,
  toVaultCliFilesystemError,
} from '@murphai/vault-usecases/helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'

type JsonObject = Record<string, unknown>

interface StoredManifestRecovery {
  subject: string
  missingCode: string
  invalidCode: string
  publicFields: ReadonlySet<string>
}

const exportPackFileSchema = z
  .object({
    path: pathSchema,
    mediaType: z.string().min(1),
    role: z.string().min(1).optional(),
  })
  .passthrough()

const exportPackFiltersSchema = z.object({
  from: z.string().min(1).nullable(),
  to: z.string().min(1).nullable(),
  experimentSlug: z.string().min(1).nullable(),
})

const exportPackCountsSchema = z.object({
  recordCount: z.number().int().nonnegative(),
  experimentCount: z.number().int().nonnegative(),
  journalCount: z.number().int().nonnegative(),
  sampleSummaryCount: z.number().int().nonnegative(),
  assessmentCount: z.number().int().nonnegative(),
  healthEventCount: z.number().int().nonnegative(),
  bankPageCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
})

export const exportPackManifestSchema = z
  .object({
    format: z.string().min(1),
    packId: z.string().min(1),
    generatedAt: z.string().min(1),
    filters: exportPackFiltersSchema,
    manifest: exportPackCountsSchema,
    health: z.record(z.string(), z.unknown()).optional(),
    files: z.array(exportPackFileSchema),
  })
  .passthrough()

type ExportPackManifest = z.infer<typeof exportPackManifestSchema>
const EXPORTS_ROOT = 'exports/packs'
const LEGACY_RAW_MANIFEST_BASENAME = 'manifest.json'
const exportPackManifestRecovery: StoredManifestRecovery = {
  subject: 'export pack',
  missingCode: 'manifest_missing',
  invalidCode: 'manifest_invalid',
  publicFields: new Set([
    'format',
    'packId',
    'generatedAt',
    'filters',
    'manifest',
    'health',
    'files',
  ]),
}
const assessmentManifestRecovery: StoredManifestRecovery = {
  subject: 'assessment raw-import',
  missingCode: 'manifest_missing',
  invalidCode: 'manifest_invalid',
  publicFields: new Set([
    'schemaVersion',
    'importId',
    'importKind',
    'importedAt',
    'source',
    'owner',
    'rawDirectory',
    'artifacts',
    'provenance',
  ]),
}

let queryRuntimePromise: Promise<QueryRuntimeModule> | null = null

function compareNullableDatesDesc(left: string | null, right: string | null) {
  if (left === right) {
    return 0
  }

  if (!left) {
    return 1
  }

  if (!right) {
    return -1
  }

  return right.localeCompare(left)
}

function packDirectory(packId: string) {
  return path.posix.join(EXPORTS_ROOT, packId)
}

function exportPackNotFoundError() {
  return new VaultCliError(
    'not_found',
    'The requested export pack was not found.',
    {
      retryable: false,
      stage: 'read',
      issues: [{ code: 'custom', publicPath: ['id'] }],
    },
  )
}

async function storedExportPackDirectoryExists(
  vaultRoot: string,
  relativePackDirectory: string,
) {
  try {
    return (await stat(
      await resolveVaultRelativePath(vaultRoot, relativePackDirectory),
    )).isDirectory()
  } catch (error) {
    if (readErrorCode(error) === 'ENOENT' || readErrorCode(error) === 'ENOTDIR') {
      return false
    }

    throw toVaultCliFilesystemError(error, {
      message: 'The stored export pack directory could not be inspected.',
    })
  }
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}

function manifestValidationContext(
  error: unknown,
  publicFields: ReadonlySet<string>,
) {
  const issues =
    error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)
      ? error.issues
      : []

  return {
    retryable: false,
    stage: 'read',
    issues: issues.map((issue) => {
      const issueRecord = issue && typeof issue === 'object' ? issue : null
      const issueCode =
        issueRecord && 'code' in issueRecord && typeof issueRecord.code === 'string'
          ? safeValidationIssueCode(issueRecord.code)
          : 'custom'
      const issuePath =
        issueRecord && 'path' in issueRecord && Array.isArray(issueRecord.path)
          ? topLevelValidationPath(issueRecord.path, publicFields)
          : []
      const expected =
        issueRecord
        && 'expected' in issueRecord
        && typeof issueRecord.expected === 'string'
        && /^(?:array|boolean|null|number|object|string|undefined)$/u.test(issueRecord.expected)
          ? issueRecord.expected
          : undefined

      return {
        publicPath: issuePath,
        code: issueCode,
        ...(expected ? { expected } : {}),
      }
    }),
  }
}

function safeValidationIssueCode(code: string) {
  return /^(?:custom|invalid_(?:element|format|key|type|union|value)|not_multiple_of|too_(?:big|small)|unrecognized_keys)$/u.test(code)
    ? code
    : 'custom'
}

function topLevelValidationPath(
  pathSegments: readonly unknown[],
  publicFields: ReadonlySet<string>,
) {
  const topLevel = pathSegments[0]
  return typeof topLevel === 'string' && publicFields.has(topLevel)
    ? [topLevel]
    : []
}

async function readJsonRelativeFile<T>(
  vaultRoot: string,
  relativePath: string,
  schema: z.ZodType<T>,
  recovery: StoredManifestRecovery,
): Promise<T> {
  let absolutePath: string

  try {
    absolutePath = await resolveVaultRelativePath(vaultRoot, relativePath)
  } catch (error) {
    if (error instanceof VaultCliError && error.code === 'invalid_path') {
      throw new VaultCliError(
        'invalid_path',
        `The stored ${recovery.subject} manifest path is invalid.`,
        { retryable: false, stage: 'read' },
      )
    }

    throw error
  }

  let contents: string

  try {
    contents = await readFile(absolutePath, 'utf8')
  } catch (error) {
    if (readErrorCode(error) !== 'ENOENT' && readErrorCode(error) !== 'ENOTDIR') {
      throw toVaultCliFilesystemError(error, {
        message: `The stored ${recovery.subject} manifest could not be read.`,
      })
    }

    throw new VaultCliError(
      recovery.missingCode,
      `The stored ${recovery.subject} manifest is missing.`,
      { retryable: false, stage: 'read' },
    )
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new VaultCliError(
      recovery.invalidCode,
      `The stored ${recovery.subject} manifest is not valid JSON.`,
      {
        retryable: false,
        stage: 'read',
        issues: [{ code: 'invalid_format', publicPath: [] }],
      },
    )
  }

  try {
    return schema.parse(parsed)
  } catch (error) {
    throw new VaultCliError(
      recovery.invalidCode,
      `The stored ${recovery.subject} manifest does not match the expected JSON shape.`,
      manifestValidationContext(error, recovery.publicFields),
    )
  }
}

async function loadQueryRuntime() {
  if (!queryRuntimePromise) {
    queryRuntimePromise = loadBaseQueryRuntime()
  }

  return queryRuntimePromise
}

async function loadAssessmentRecord(vaultRoot: string, assessmentId: string) {
  const query = await loadQueryRuntime()
  const record = await query.resolveCanonicalEntityInFamily(
    vaultRoot,
    'assessment',
    assessmentId,
  )

  if (!record) {
    throw new VaultCliError(
      'not_found',
      'The requested assessment was not found.',
      {
        retryable: false,
        stage: 'read',
        issues: [{ code: 'custom', publicPath: ['id'] }],
      },
    )
  }

  return record
}

function resolveAssessmentRawFile(record: AssessmentEntity) {
  const rawFile = firstString(record.attributes, ['rawPath', 'sourcePath']) ?? record.path

  if (!rawFile) {
    throw new VaultCliError(
      'raw_missing',
      'The stored assessment does not declare a raw artifact path.',
      { retryable: false, stage: 'read' },
    )
  }

  return rawFile
}

function isRawManifestFileName(fileName: string) {
  return (
    fileName === LEGACY_RAW_MANIFEST_BASENAME
    || (fileName.startsWith('manifest.') && fileName.endsWith('.json'))
  )
}

async function resolveStoredRawManifestFile(
  vaultRoot: string,
  rawDirectory: string,
) {
  let absoluteDirectory: string

  try {
    absoluteDirectory = await resolveVaultRelativePath(vaultRoot, rawDirectory)
  } catch (error) {
    if (error instanceof VaultCliError && error.code === 'invalid_path') {
      throw new VaultCliError(
        'invalid_path',
        'The stored assessment raw artifact path is invalid.',
        { retryable: false, stage: 'read' },
      )
    }

    throw error
  }

  let entries: Dirent[]

  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (readErrorCode(error) !== 'ENOENT' && readErrorCode(error) !== 'ENOTDIR') {
      throw toVaultCliFilesystemError(error, {
        message: 'The stored assessment raw-import directory could not be read.',
      })
    }

    throw new VaultCliError(
      assessmentManifestRecovery.missingCode,
      'The stored assessment raw-import directory is missing.',
      { retryable: false, stage: 'read' },
    )
  }

  const manifestNames = entries
    .filter((entry) => entry.isFile() && isRawManifestFileName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const manifestName =
    manifestNames.find((name) => name === LEGACY_RAW_MANIFEST_BASENAME)
    ?? manifestNames.at(-1)

  if (!manifestName) {
    throw new VaultCliError(
      assessmentManifestRecovery.missingCode,
      'The stored assessment raw-import manifest is missing.',
      { retryable: false, stage: 'read' },
    )
  }

  return path.posix.join(rawDirectory, manifestName)
}

async function resolveAssessmentManifestFile(
  vaultRoot: string,
  record: AssessmentEntity,
) {
  return resolveStoredRawManifestFile(
    vaultRoot,
    path.posix.dirname(resolveAssessmentRawFile(record)),
  )
}

function toExportPackSummary(
  manifestFile: string,
  manifest: ExportPackManifest,
) {
  return {
    packId: manifest.packId,
    manifestFile,
    generatedAt: manifest.generatedAt,
    from: manifest.filters.from,
    to: manifest.filters.to,
    experiment: manifest.filters.experimentSlug,
    recordCount: manifest.manifest.recordCount,
    questionCount: manifest.manifest.questionCount,
    fileCount: manifest.manifest.fileCount,
  }
}

function matchesExportPackRange(
  manifest: ExportPackManifest,
  filters: {
    from?: string
    to?: string
    experiment?: string
  },
) {
  if (filters.experiment && manifest.filters.experimentSlug !== filters.experiment) {
    return false
  }

  const packFrom = manifest.filters.from
  const packTo = manifest.filters.to

  if (filters.from && packTo && packTo < filters.from) {
    return false
  }

  if (filters.to && packFrom && packFrom > filters.to) {
    return false
  }

  return true
}

async function readStoredExportPackManifest(vaultRoot: string, packId: string) {
  const relativePackDirectory = packDirectory(packId)
  const manifestFile = path.posix.join(relativePackDirectory, 'manifest.json')
  let manifest: ExportPackManifest

  try {
    manifest = await readJsonRelativeFile(
      vaultRoot,
      manifestFile,
      exportPackManifestSchema,
      exportPackManifestRecovery,
    )
  } catch (error) {
    if (
      error instanceof VaultCliError
      && error.code === exportPackManifestRecovery.missingCode
      && !(await storedExportPackDirectoryExists(vaultRoot, relativePackDirectory))
    ) {
      throw exportPackNotFoundError()
    }

    throw error
  }

  if (manifest.packId !== packId) {
    throw new VaultCliError(
      'manifest_invalid',
      'The stored export pack manifest does not match its directory.',
      {
        retryable: false,
        stage: 'read',
        issues: [{ code: 'custom', publicPath: ['packId'] }],
      },
    )
  }

  return {
    manifestFile,
    manifest,
  }
}

async function readStoredExportPackFiles(
  vaultRoot: string,
  manifest: ExportPackManifest,
) {
  return Promise.all(
    manifest.files.map(async (file) => ({
      path: file.path,
      contents: await readFile(await resolveVaultRelativePath(vaultRoot, file.path), 'utf8'),
    })),
  )
}

async function rebuildStoredExportPackFiles(
  vaultRoot: string,
  manifest: ExportPackManifest,
) {
  const query = await loadQueryRuntime()
  const [readModel, audits] = await Promise.all([
    query.readVaultTolerant
      ? query.readVaultTolerant(vaultRoot)
      : query.readVault(vaultRoot),
    query.readCanonicalEntityFamilySource(vaultRoot, 'audit'),
  ])
  readModel.entities = [...readModel.entities, ...audits].sort(
    query.compareCanonicalEntities,
  )
  const rebuilt = query.buildExportPack(readModel, {
    from: manifest.filters.from ?? undefined,
    to: manifest.filters.to ?? undefined,
    experimentSlug: manifest.filters.experimentSlug ?? undefined,
    packId: manifest.packId,
    generatedAt: manifest.generatedAt,
  })

  return rebuilt.files
}

async function loadFilesForMaterialization(
  vaultRoot: string,
  manifest: ExportPackManifest,
) {
  try {
    return {
      rebuilt: false,
      files: await readStoredExportPackFiles(vaultRoot, manifest),
    }
  } catch {
    return {
      rebuilt: true,
      files: await rebuildStoredExportPackFiles(vaultRoot, manifest),
    }
  }
}

export async function showStoredExportPack(vaultRoot: string, packId: string) {
  const { manifestFile, manifest } = await readStoredExportPackManifest(vaultRoot, packId)

  return {
    vault: vaultRoot,
    packId: manifest.packId,
    basePath: packDirectory(manifest.packId),
    manifestFile,
    generatedAt: manifest.generatedAt,
    filters: {
      from: manifest.filters.from,
      to: manifest.filters.to,
      experiment: manifest.filters.experimentSlug,
    },
    counts: {
      records: manifest.manifest.recordCount,
      questions: manifest.manifest.questionCount,
      files: manifest.manifest.fileCount,
    },
    files: manifest.files.map((file) => ({
      path: file.path,
      mediaType: file.mediaType,
      role: file.role ?? null,
    })),
    manifest,
  }
}

export async function listStoredExportPacks(
  vaultRoot: string,
  options: {
    from?: string
    to?: string
    experiment?: string
    limit?: number
  } = {},
) {
  const exportsDirectory = await resolveVaultRelativePath(vaultRoot, EXPORTS_ROOT)
  let entries: Dirent[] = []

  try {
    entries = await readdir(exportsDirectory, { withFileTypes: true })
  } catch (error) {
    const errorCode =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code)
        : null
    if (errorCode === 'ENOENT') {
      return []
    }
    throw toVaultCliFilesystemError(error, {
      message: 'Stored export packs could not be listed.',
    })
  }

  const items = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestFile = path.posix.join(EXPORTS_ROOT, entry.name, 'manifest.json')
        const manifest = await readJsonRelativeFile(
          vaultRoot,
          manifestFile,
          exportPackManifestSchema,
          exportPackManifestRecovery,
        )

        return {
          manifest,
          summary: toExportPackSummary(manifestFile, manifest),
        }
      }),
  )

  const filtered = items
    .filter((item) =>
      matchesExportPackRange(item.manifest, {
        from: options.from,
        to: options.to,
        experiment: options.experiment,
      }),
    )
    .sort((left, right) => {
      const dateCompare = compareNullableDatesDesc(
        left.manifest.generatedAt,
        right.manifest.generatedAt,
      )

      if (dateCompare !== 0) {
        return dateCompare
      }

      return left.summary.packId.localeCompare(right.summary.packId)
    })
    .map((item) => item.summary)

  return filtered.slice(0, options.limit ?? 10)
}

export async function materializeStoredExportPack(input: {
  vault: string
  packId: string
  out?: string
}) {
  const { manifestFile, manifest } = await readStoredExportPackManifest(
    input.vault,
    input.packId,
  )
  const { rebuilt, files } = await loadFilesForMaterialization(input.vault, manifest)
  const outDir = input.out ?? input.vault

  try {
    await materializeExportPack(outDir, files)
  } catch (error) {
    throw toVaultCliFilesystemError(error, {
      message: 'The export pack could not be written to the output directory.',
      fieldPath: input.out ? 'out' : 'vault',
    })
  }

  return {
    vault: input.vault,
    packId: manifest.packId,
    manifestFile,
    outDir,
    rebuilt,
    files: files.map((file: { path: string }) => file.path),
  }
}

export async function pruneStoredExportPack(vaultRoot: string, packId: string) {
  const { manifest } = await readStoredExportPackManifest(vaultRoot, packId)
  const relativePackDirectory = packDirectory(packId)
  let receipt: Awaited<ReturnType<typeof readMaterializedExportPackReceipt>>
  let pruned: boolean
  try {
    receipt = await readMaterializedExportPackReceipt(vaultRoot, packId)
    pruned = await retireMaterializedExportPack(vaultRoot, receipt)
  } catch (error) {
    throw toVaultCliFilesystemError(error, {
      message: 'The stored export pack could not be pruned.',
    })
  }
  if (!pruned) {
    throw new VaultCliError(
      'export_pack_changed',
      `Export pack "${packId}" changed before it could be pruned.`,
      { retryable: false, stage: 'conflict' },
    )
  }

  return {
    vault: vaultRoot,
    packId,
    packDirectory: relativePackDirectory,
    fileCount: manifest.files.length,
    pruned: true as const,
  }
}

export async function showAssessmentManifest(vaultRoot: string, assessmentId: string) {
  const record = await loadAssessmentRecord(vaultRoot, assessmentId)
  const manifestFile = await resolveAssessmentManifestFile(vaultRoot, record)
  const manifest = await readJsonRelativeFile(
    vaultRoot,
    manifestFile,
    rawImportManifestSchema,
    assessmentManifestRecovery,
  )

  return {
    vault: vaultRoot,
    entityId: record.entityId,
    lookupId: record.primaryLookupId,
    kind: 'assessment' as const,
    manifestFile,
    manifest,
  }
}
