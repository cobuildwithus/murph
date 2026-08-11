import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
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
import { materializeExportPack, resolveVaultRelativePath } from '@murphai/vault-usecases/helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'

type JsonObject = Record<string, unknown>

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

async function readJsonRelativeFile<T>(
  vaultRoot: string,
  relativePath: string,
  schema: z.ZodType<T>,
  missingCode: string,
  invalidCode: string,
): Promise<T> {
  const absolutePath = await resolveVaultRelativePath(vaultRoot, relativePath)
  let contents: string

  try {
    contents = await readFile(absolutePath, 'utf8')
  } catch (error) {
    throw new VaultCliError(
      missingCode,
      `Vault file "${relativePath}" is missing.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    throw new VaultCliError(
      invalidCode,
      `Vault file "${relativePath}" is not valid JSON.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  try {
    return schema.parse(parsed)
  } catch (error) {
    throw new VaultCliError(
      invalidCode,
      `Vault file "${relativePath}" does not match the expected JSON shape.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
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
  const readModel = await query.readVault(vaultRoot)
  const record = query.lookupEntityById(readModel, assessmentId)

  if (!record || record.family !== 'assessment') {
    throw new VaultCliError(
      'not_found',
      `No assessment found for "${assessmentId}".`,
    )
  }

  return record
}

function resolveAssessmentRawFile(record: AssessmentEntity) {
  const rawFile = firstString(record.attributes, ['rawPath', 'sourcePath']) ?? record.path

  if (!rawFile) {
    throw new VaultCliError(
      'raw_missing',
      `Assessment "${record.entityId}" does not declare a raw artifact path.`,
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
  const absoluteDirectory = await resolveVaultRelativePath(vaultRoot, rawDirectory)
  let entries: Dirent[]

  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    throw new VaultCliError(
      'manifest_missing',
      `Raw import directory "${rawDirectory}" is missing from the vault.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
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
      'manifest_missing',
      `Raw import directory "${rawDirectory}" does not contain a raw import manifest.`,
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
  const manifestFile = path.posix.join(packDirectory(packId), 'manifest.json')
  const manifest = await readJsonRelativeFile(
    vaultRoot,
    manifestFile,
    exportPackManifestSchema,
    'not_found',
    'manifest_invalid',
  )

  if (manifest.packId !== packId) {
    throw new VaultCliError(
      'manifest_invalid',
      `Manifest "${manifestFile}" declares pack id "${manifest.packId}" instead of "${packId}".`,
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
  const readModel = query.readVaultTolerant
    ? await query.readVaultTolerant(vaultRoot)
    : await query.readVault(vaultRoot)
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
    throw error
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
          'not_found',
          'manifest_invalid',
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

  await materializeExportPack(outDir, files)

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
  const receipt = await readMaterializedExportPackReceipt(vaultRoot, packId)
  const pruned = await retireMaterializedExportPack(vaultRoot, receipt)
  if (!pruned) {
    throw new VaultCliError(
      'export_pack_changed',
      `Export pack "${packId}" changed before it could be pruned.`,
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
    'manifest_missing',
    'manifest_invalid',
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
