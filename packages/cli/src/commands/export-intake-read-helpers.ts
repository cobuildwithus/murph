import type { Dirent } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { rawImportManifestSchema } from '@murphai/contracts'
import { z } from 'incur'
import { firstString } from '@murphai/assistant-core/command-helpers'
import {
  loadQueryRuntime as loadBaseQueryRuntime,
  type QueryRuntimeModule,
  type QueryVaultRecord as VaultRecord,
} from '@murphai/assistant-core/query-runtime'
import { materializeExportPack } from '@murphai/assistant-core/usecases/shared'
import { resolveVaultRelativePath } from '@murphai/assistant-core/usecases/vault-usecase-helpers'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
import { pathSchema } from '@murphai/assistant-core/vault-cli-contracts'

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
  profileSnapshotCount: z.number().int().nonnegative(),
  historyEventCount: z.number().int().nonnegative(),
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
  const record = query.lookupRecordById(readModel, assessmentId)

  if (!record || record.recordType !== 'assessment') {
    throw new VaultCliError(
      'not_found',
      `No assessment found for "${assessmentId}".`,
    )
  }

  return record
}

function resolveAssessmentRawFile(record: VaultRecord) {
  const rawFile = firstString(record.data, ['rawPath', 'sourcePath'])

  if (!rawFile) {
    throw new VaultCliError(
      'raw_missing',
      `Assessment "${record.displayId}" does not declare a raw artifact path.`,
    )
  }

  return rawFile
}

function resolveAssessmentManifestFile(record: VaultRecord) {
  return path.posix.join(path.posix.dirname(resolveAssessmentRawFile(record)), 'manifest.json')
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

  return filtered.slice(0, options.limit ?? 50)
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
  const absolutePackDirectory = await resolveVaultRelativePath(vaultRoot, relativePackDirectory)

  await rm(absolutePackDirectory, { recursive: true, force: true })

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
  const manifestFile = resolveAssessmentManifestFile(record)
  const manifest = await readJsonRelativeFile(
    vaultRoot,
    manifestFile,
    rawImportManifestSchema,
    'manifest_missing',
    'manifest_invalid',
  )

  return {
    vault: vaultRoot,
    entityId: record.displayId,
    lookupId: record.primaryLookupId,
    kind: 'assessment' as const,
    manifestFile,
    manifest,
  }
}

export async function showAssessmentRaw(vaultRoot: string, assessmentId: string) {
  const record = await loadAssessmentRecord(vaultRoot, assessmentId)
  const rawFile = resolveAssessmentRawFile(record)
  const absoluteRawPath = await resolveVaultRelativePath(vaultRoot, rawFile)
  let contents: string

  try {
    contents = await readFile(absoluteRawPath, 'utf8')
  } catch (error) {
    throw new VaultCliError(
      'raw_missing',
      `Raw assessment artifact "${rawFile}" is missing from the vault.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  let raw: unknown

  try {
    raw = JSON.parse(contents)
  } catch (error) {
    throw new VaultCliError(
      'raw_invalid',
      `Raw assessment artifact "${rawFile}" is not valid JSON.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  return {
    vault: vaultRoot,
    entityId: record.displayId,
    lookupId: record.primaryLookupId,
    kind: 'assessment' as const,
    rawFile,
    mediaType: 'application/json' as const,
    raw,
  }
}
