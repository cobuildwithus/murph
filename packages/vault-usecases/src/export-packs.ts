import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { resolveVaultRelativePath } from './usecases/vault-usecase-helpers.js'

const EXPORT_PACK_ID_PATTERN = /^[A-Za-z0-9_-]+$/u

export interface MaterializedExportPackReceipt {
  manifestSha256: string
  packId: string
}

export async function readMaterializedExportPackReceipt(
  vaultRoot: string,
  packId: string,
): Promise<MaterializedExportPackReceipt> {
  const normalizedPackId = normalizeExportPackId(packId)
  const manifestPath = await resolveVaultRelativePath(
    vaultRoot,
    `exports/packs/${normalizedPackId}/manifest.json`,
  )
  const manifestBytes = await readFile(manifestPath)
  let manifest: unknown

  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'))
  } catch {
    throw new VaultCliError(
      'manifest_invalid',
      `Export pack "${normalizedPackId}" has an invalid manifest.`,
    )
  }

  if (
    typeof manifest !== 'object'
    || manifest === null
    || !('packId' in manifest)
    || manifest.packId !== normalizedPackId
  ) {
    throw new VaultCliError(
      'manifest_invalid',
      `Export pack "${normalizedPackId}" has a mismatched manifest.`,
    )
  }

  return {
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    packId: normalizedPackId,
  }
}

export async function retireMaterializedExportPack(
  vaultRoot: string,
  receipt: MaterializedExportPackReceipt,
): Promise<boolean> {
  const current = await readMaterializedExportPackReceipt(vaultRoot, receipt.packId)
  if (current.manifestSha256 !== receipt.manifestSha256) {
    return false
  }

  const packDirectory = await resolveVaultRelativePath(
    vaultRoot,
    path.posix.join('exports/packs', current.packId),
  )
  await rm(packDirectory, { force: true, recursive: true })
  return true
}

function normalizeExportPackId(packId: string): string {
  const normalized = packId.trim()
  if (!EXPORT_PACK_ID_PATTERN.test(normalized)) {
    throw new VaultCliError(
      'invalid_export_pack',
      'Export pack ids may contain only letters, numbers, underscores, and dashes.',
    )
  }
  return normalized
}
