import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { VaultCliError } from './vault-cli-errors.js'

const ASSISTANT_INBOX_ARTIFACT_ROOT = path.posix.join('derived', 'inbox')
const ASSISTANT_CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u
const ASSISTANT_ARTIFACT_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

export interface AssistantInboxArtifactPath {
  captureId: string
  absoluteDirectory: string
  absolutePath: string
  relativeDirectory: string
  relativePath: string
}

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

export function normalizeAssistantCaptureId(candidateCaptureId: string): string {
  const trimmed = candidateCaptureId.trim()

  if (!trimmed || !ASSISTANT_CAPTURE_ID_PATTERN.test(trimmed)) {
    throw assistantPathOutsideVaultError(candidateCaptureId, 'capture id')
  }

  return trimmed
}

export async function resolveAssistantInboxArtifactPath(
  vaultRoot: string,
  captureId: string,
  fileName: string,
): Promise<AssistantInboxArtifactPath> {
  const normalizedCaptureId = normalizeAssistantCaptureId(captureId)
  const normalizedFileName = normalizeAssistantArtifactFileName(fileName)
  const relativeDirectory = path.posix.join(
    ASSISTANT_INBOX_ARTIFACT_ROOT,
    normalizedCaptureId,
    'assistant',
  )
  const relativePath = path.posix.join(relativeDirectory, normalizedFileName)
  const absoluteDirectory = await resolveAssistantVaultPath(vaultRoot, relativeDirectory)
  const absolutePath = await resolveAssistantVaultPath(
    vaultRoot,
    relativePath,
    'file path',
  )

  return {
    captureId: normalizedCaptureId,
    absoluteDirectory,
    absolutePath,
    relativeDirectory,
    relativePath,
  }
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
  pathLabel: 'path' | 'file path' | 'capture id',
): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_PATH_OUTSIDE_VAULT',
    `Assistant ${pathLabel} "${candidatePath}" resolves outside the vault root.`,
  )
}

function normalizeAssistantArtifactFileName(fileName: string): string {
  const trimmed = fileName.trim()

  if (
    !trimmed ||
    path.posix.basename(trimmed) !== trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    !ASSISTANT_ARTIFACT_FILE_NAME_PATTERN.test(trimmed)
  ) {
    throw assistantPathOutsideVaultError(fileName, 'file path')
  }

  return trimmed
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}
