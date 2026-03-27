import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  inferEntityKind,
  isQueryableRecordId,
} from './shared.js'

const ISO_TIMESTAMP_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
export function inferVaultLinkKind(
  id: string,
  options: {
    includeProviderIds?: boolean
  } = {},
) {
  const kind = inferEntityKind(id)

  if (kind === 'provider' && !options.includeProviderIds) {
    return 'entity'
  }

  return kind
}

export function isVaultQueryableRecordId(id: string) {
  return isQueryableRecordId(id)
}

export function normalizeOptionalText(value: string | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeIsoTimestamp(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  return ISO_TIMESTAMP_WITH_OFFSET_PATTERN.test(value) ? value : null
}

export function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return normalized.length > 0 ? uniqueStrings(normalized) : undefined
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
}

export function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)]
}

export function compactObject<TRecord extends Record<string, unknown>>(record: TRecord) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as TRecord
}

export async function resolveVaultRelativePath(
  vaultRoot: string,
  relativePath: string,
) {
  try {
    return await resolveVaultPathOnDisk(vaultRoot, relativePath)
  } catch (error) {
    throw toVaultRelativePathError(relativePath, error)
  }
}

interface VaultErrorMapping {
  code: string
  message?: string
  details?: Record<string, unknown> | ((details: Record<string, unknown>) => Record<string, unknown>)
}

export function toVaultCliError(
  error: unknown,
  mappings: Record<string, VaultErrorMapping> = {},
) {
  if (error instanceof VaultCliError || !isVaultLikeError(error)) {
    return error
  }

  const mapping = mappings[error.code]
  const mappedDetails =
    typeof mapping?.details === 'function'
      ? mapping.details(error.details ?? {})
      : mapping?.details

  return new VaultCliError(
    mapping?.code ?? 'vault_error',
    mapping?.message ?? error.message,
    {
      vaultCode: error.code,
      ...error.details,
      ...mappedDetails,
    },
  )
}

function toVaultRelativePathError(relativePath: string, error: unknown) {
  if (!isVaultLikeError(error)) {
    return error
  }

  if (error.code === 'VAULT_INVALID_PATH') {
    return new VaultCliError(
      'invalid_path',
      error.message.includes('escape the vault root')
        ? `Vault-relative path "${relativePath}" escapes the selected vault root.`
        : `Vault-relative path "${relativePath}" is invalid.`,
    )
  }

  if (error.code === 'VAULT_PATH_ESCAPE') {
    return new VaultCliError(
      'invalid_path',
      `Vault-relative path "${relativePath}" escapes the selected vault root.`,
    )
  }

  if (error.code === 'VAULT_PATH_SYMLINK') {
    return new VaultCliError(
      'invalid_path',
      `Vault-relative path "${relativePath}" may not traverse symbolic links inside the selected vault root.`,
    )
  }

  return error
}

interface VaultLikeError extends Error {
  code: string
  details?: Record<string, unknown>
}

function isVaultLikeError(error: unknown): error is VaultLikeError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      (error.name === 'VaultError' ||
        error.code.startsWith('VAULT_')),
  )
}

async function resolveVaultPathOnDisk(
  vaultRoot: string,
  relativePath: string,
): Promise<string> {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw createVaultError('VAULT_INVALID_PATH', 'Vault-relative path is invalid.')
  }

  const absoluteVaultRoot = path.resolve(vaultRoot)
  const absolutePath = path.resolve(absoluteVaultRoot, relativePath)
  const relativeToRoot = path.relative(absoluteVaultRoot, absolutePath)

  if (
    relativeToRoot === '' ||
    relativeToRoot === '.' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot === '..' ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw createVaultError(
      'VAULT_INVALID_PATH',
      'Vault-relative path may not escape the vault root.',
    )
  }

  let currentPath = absoluteVaultRoot
  for (const segment of relativeToRoot.split(path.sep)) {
    currentPath = path.join(currentPath, segment)
    try {
      const stats = await lstat(currentPath)
      if (stats.isSymbolicLink()) {
        throw createVaultError(
          'VAULT_PATH_SYMLINK',
          'Vault-relative path may not traverse symlinks inside the vault root.',
        )
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        break
      }
      throw error
    }
  }

  return absolutePath
}

function createVaultError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): VaultLikeError {
  const error = new Error(message) as VaultLikeError
  error.name = 'VaultError'
  error.code = code
  error.details = details
  return error
}
