import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { VaultCliError } from './vault-cli-errors.js'

export async function resolveAssistantVaultPath(
  vaultRoot: string,
  candidatePath: string,
  pathLabel: 'path' | 'file path' = 'path',
): Promise<string> {
  const trimmed = candidatePath.trim()
  const absoluteVaultRoot = path.resolve(vaultRoot)
  const absolutePath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(absoluteVaultRoot, trimmed)
  const relativeToVault = path.relative(absoluteVaultRoot, absolutePath)

  if (
    relativeToVault === '..' ||
    relativeToVault.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToVault)
  ) {
    throw assistantPathOutsideVaultError(candidatePath, pathLabel)
  }

  await assertAssistantPathWithinVaultOnDisk(absoluteVaultRoot, absolutePath, candidatePath, pathLabel)
  return absolutePath
}

async function assertAssistantPathWithinVaultOnDisk(
  absoluteVaultRoot: string,
  absolutePath: string,
  originalPath: string,
  pathLabel: 'path' | 'file path',
): Promise<void> {
  const canonicalRoot = await realpath(absoluteVaultRoot)
  const relativeToVault = path.relative(absoluteVaultRoot, absolutePath)

  if (!relativeToVault) {
    return
  }

  const segments = relativeToVault.split(path.sep).filter(Boolean)
  let currentPath = canonicalRoot

  for (const segment of segments) {
    const nextPath = path.join(currentPath, segment)

    try {
      const stats = await lstat(nextPath)
      if (stats.isSymbolicLink()) {
        throw assistantPathOutsideVaultError(originalPath, pathLabel)
      }

      currentPath = await realpath(nextPath)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return
      }

      throw error
    }
  }
}

function assistantPathOutsideVaultError(
  candidatePath: string,
  pathLabel: 'path' | 'file path',
): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_PATH_OUTSIDE_VAULT',
    `Assistant ${pathLabel} "${candidatePath}" resolves outside the vault root.`,
  )
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}
