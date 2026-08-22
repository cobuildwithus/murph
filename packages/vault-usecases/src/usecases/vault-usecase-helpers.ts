import path from 'node:path'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { loadRuntimeModule } from '../runtime-import.js'
import {
  inferEntityKind,
  isQueryableRecordId,
} from './shared.js'

const ISO_TIMESTAMP_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/

interface VaultPathRuntime {
  resolveVaultPathOnDisk(inputVaultRoot: string, relativePath: string): Promise<{
    absolutePath: string
  }>
}

async function loadVaultPathRuntime(): Promise<VaultPathRuntime> {
  return loadRuntimeModule<VaultPathRuntime>('@murphai/core')
}

function createVaultLikeError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const error = new Error(message) as Error & {
    code: string
    details: Record<string, unknown>
  }
  error.name = 'VaultError'
  error.code = code
  error.details = details
  return error
}

function normalizeRelativeVaultPath(value: unknown): string {
  const candidate = String(value ?? '').trim().replace(/\\/g, '/')

  if (!candidate) {
    throw createVaultLikeError('VAULT_INVALID_PATH', 'Vault-relative path is required.')
  }

  if (candidate.includes('\u0000')) {
    throw createVaultLikeError(
      'VAULT_INVALID_PATH',
      'Vault-relative path may not contain NUL bytes.',
      {
        relativePath: String(value ?? ''),
      },
    )
  }

  if (WINDOWS_DRIVE_PREFIX_PATTERN.test(candidate) || candidate.startsWith('/')) {
    throw createVaultLikeError(
      'VAULT_INVALID_PATH',
      'Vault-relative path must not be absolute.',
      {
        relativePath: String(value ?? ''),
      },
    )
  }

  const normalized = path.posix.normalize(candidate)

  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw createVaultLikeError(
      'VAULT_INVALID_PATH',
      'Vault-relative path may not escape the vault root.',
      {
        relativePath: String(value ?? ''),
        normalized,
      },
    )
  }

  return normalized
}
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

export function relativePathEntries(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (
      typeof entry !== 'object'
      || entry === null
      || Array.isArray(entry)
      || typeof entry.relativePath !== 'string'
    ) {
      return []
    }

    const relativePath = normalizeOptionalRelativePath(entry.relativePath)
    return relativePath ? [relativePath] : []
  })
}

export function relativePathStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const relativePath = normalizeOptionalRelativePath(entry)
    return relativePath ? [relativePath] : []
  })
}

export function mergeByRelativePath<TEntry extends { relativePath: string }>(
  existing: readonly TEntry[] | undefined,
  additions: readonly TEntry[],
) {
  const merged = new Map<string, TEntry>()

  for (const entry of existing ?? []) {
    merged.set(entry.relativePath, entry)
  }

  for (const entry of additions) {
    merged.set(entry.relativePath, entry)
  }

  return [...merged.values()]
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
    const { resolveVaultPathOnDisk } = await loadVaultPathRuntime()
    const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath)
    return resolved.absolutePath
  } catch (error) {
    throw toVaultRelativePathError(relativePath, error)
  }
}

export function normalizeOptionalRelativePath(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  try {
    return normalizeRelativeVaultPath(trimmed)
  } catch (error) {
    throw toVaultRelativePathError(trimmed, error)
  }
}

interface VaultErrorMapping {
  code: string
  message?: string
  details?: Record<string, unknown> | ((details: Record<string, unknown>) => Record<string, unknown>)
}

const eventUpsertVaultErrorMappings: Record<string, VaultErrorMapping> = {
  EVENT_KIND_INVALID: {
    code: 'contract_invalid',
  },
  EVENT_OCCURRED_AT_MISSING: {
    code: 'invalid_timestamp',
  },
  EVENT_CONTRACT_INVALID: {
    code: 'contract_invalid',
  },
  EVENT_MISSING: {
    code: 'not_found',
  },
  EVENT_REVISION_CONFLICT: {
    code: 'conflict',
  },
  INVALID_TIMESTAMP: {
    code: 'invalid_timestamp',
  },
  INVALID_INPUT: {
    code: 'contract_invalid',
  },
  CAPTURE_MEDIA_MISSING: {
    code: 'invalid_option',
  },
}

const vaultMetadataVaultErrorMappings: Record<string, VaultErrorMapping> = {
  VAULT_INVALID_METADATA: {
    code: 'invalid_metadata',
  },
  VAULT_UNSUPPORTED_FORMAT: {
    code: 'unsupported_format',
  },
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

export function toEventUpsertVaultCliError(error: unknown) {
  return toVaultCliError(error, eventUpsertVaultErrorMappings)
}

export function toVaultMetadataCliError(error: unknown) {
  return toVaultCliError(error, vaultMetadataVaultErrorMappings)
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
      error.name === 'VaultError',
  )
}
