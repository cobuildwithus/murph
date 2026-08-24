import path from 'node:path'

import {
  VaultCliError,
  type VaultCliRepairInput,
} from '@murphai/operator-config/vault-cli-errors'
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
  repair?: VaultCliRepairInput | ((details: Record<string, unknown>) => VaultCliRepairInput)
}

function contractValidationRepair(
  details: Record<string, unknown>,
  hint: string,
): VaultCliRepairInput {
  const errors = Array.isArray(details.errors) ? details.errors : []

  return {
    stage: 'validation',
    hint,
    fields: errors.map((issue) => ({
      path: contractIssuePath(issue),
      code: 'contract_invalid',
      message: 'Value does not satisfy the record contract.',
    })),
  }
}

function contractIssuePath(issue: unknown): string | readonly PropertyKey[] {
  if (typeof issue !== 'string') {
    return '$'
  }

  const separatorIndex = issue.indexOf(':')
  const pathText = (separatorIndex >= 0 ? issue.slice(0, separatorIndex) : issue).trim()
  if (pathText === '$') {
    return '$'
  }

  if (!pathText.startsWith('$')) {
    return '$'
  }

  const segments: PropertyKey[] = []
  let remaining = pathText.slice(1)

  while (remaining.length > 0) {
    const propertyMatch = /^\.([A-Za-z_][A-Za-z0-9_-]*)/u.exec(remaining)
    if (propertyMatch?.[1]) {
      segments.push(propertyMatch[1])
      remaining = remaining.slice(propertyMatch[0].length)
      continue
    }

    const indexMatch = /^\[(\d+)\]/u.exec(remaining)
    if (indexMatch?.[1]) {
      const index = Number(indexMatch[1])
      if (!Number.isSafeInteger(index)) {
        return '$'
      }
      segments.push(index)
      remaining = remaining.slice(indexMatch[0].length)
      continue
    }

    return '$'
  }

  return segments.length > 0 ? segments : '$'
}

const eventUpsertVaultErrorMappings: Record<string, VaultErrorMapping> = {
  EVENT_KIND_INVALID: {
    code: 'contract_invalid',
    repair: {
      stage: 'validation',
      hint: 'Choose a supported event kind and retry.',
      fields: [{
        path: 'kind',
        code: 'invalid_value',
        message: 'Use a supported event kind.',
      }],
    },
  },
  EVENT_OCCURRED_AT_MISSING: {
    code: 'invalid_timestamp',
    repair: {
      stage: 'validation',
      hint: 'Add an ISO 8601 occurredAt value and retry.',
      fields: [{
        path: 'occurredAt',
        code: 'missing',
        missing: true,
        message: 'An occurrence timestamp is required.',
        expected: 'ISO 8601 timestamp',
      }],
    },
  },
  EVENT_CONTRACT_INVALID: {
    code: 'contract_invalid',
    repair: (details) => contractValidationRepair(
      details,
      'Correct the listed event fields and retry.',
    ),
  },
  EVENT_ID_NOT_ALLOWED: {
    code: 'invalid_option',
    repair: {
      stage: 'validation',
      hint: 'Remove eventId; generic imports derive identity from externalRef.',
      fields: [{
        path: 'eventId',
        code: 'unsupported',
        message: 'Generic event imports do not accept a caller-provided event id.',
      }],
    },
  },
  EVENT_MISSING: {
    code: 'not_found',
  },
  EVENT_REVISION_CONFLICT: {
    code: 'conflict',
  },
  INVALID_TIMESTAMP: {
    code: 'invalid_timestamp',
    repair: {
      stage: 'validation',
      hint: 'Use an ISO 8601 occurrence timestamp and retry.',
      fields: [{
        path: 'occurredAt',
        code: 'invalid_value',
        message: 'Use an ISO 8601 timestamp.',
        expected: 'ISO 8601 timestamp',
      }],
    },
  },
  INVALID_INPUT: {
    code: 'contract_invalid',
    repair: {
      stage: 'validation',
      hint: 'Add a non-empty event title and retry.',
      fields: [{
        path: 'title',
        code: 'missing',
        missing: true,
        message: 'A non-empty event title is required.',
      }],
    },
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
  const mappedRepair =
    typeof mapping?.repair === 'function'
      ? mapping.repair(error.details ?? {})
      : mapping?.repair

  return new VaultCliError(
    mapping?.code ?? 'vault_error',
    mapping?.message ?? error.message,
    {
      vaultCode: error.code,
      ...error.details,
      ...mappedDetails,
    },
    mappedRepair,
  )
}

export function toEventUpsertVaultCliError(error: unknown) {
  return toVaultCliError(error, eventUpsertVaultErrorMappings)
}

export function toImporterInputFileVaultCliError(error: unknown) {
  if (error instanceof VaultCliError) {
    return error
  }

  const errorCode = readErrorCode(error)
  if (errorCode === 'ENOENT') {
    return new VaultCliError(
      'not_found',
      'The input file was not found.',
      undefined,
      {
        stage: 'input_file',
        hint: 'Choose an existing regular file with --file and retry.',
        fields: [{
          path: 'file',
          code: 'not_found',
          message: 'The selected input file does not exist.',
          expected: 'existing regular file',
        }],
      },
    )
  }

  if (errorCode === 'ERR_IMPORT_PATH_NOT_FILE' || errorCode === 'EISDIR' || errorCode === 'ENOTDIR') {
    return new VaultCliError(
      'invalid_path',
      'The input path is not a regular file.',
      undefined,
      {
        stage: 'input_file',
        hint: 'Choose a regular file, not a directory, with --file.',
        fields: [{
          path: 'file',
          code: 'invalid_type',
          message: 'The selected input path must be a regular file.',
          expected: 'regular file',
        }],
      },
    )
  }

  if (errorCode === 'EACCES' || errorCode === 'EPERM') {
    return new VaultCliError(
      'permission_denied',
      'The input file could not be read.',
      undefined,
      {
        stage: 'input_file',
        hint: 'Grant read access to the --file path and retry.',
        fields: [{
          path: 'file',
          code: 'permission_denied',
          message: 'The selected input file is not readable.',
          expected: 'readable regular file',
        }],
      },
    )
  }

  return error
}

export function toVaultCliFilesystemError(
  error: unknown,
  input: {
    stage: string
    message: string
    hint: string
    fieldPath?: string
  },
) {
  if (error instanceof VaultCliError) {
    return error
  }

  const errorCode = readErrorCode(error)
  const classification = (() => {
    if (errorCode === 'ENOENT') {
      return {
        code: 'not_found',
        fieldCode: 'not_found',
        fieldMessage: 'A required filesystem path does not exist.',
      }
    }
    if (errorCode === 'EACCES' || errorCode === 'EPERM' || errorCode === 'EROFS') {
      return {
        code: 'permission_denied',
        fieldCode: 'permission_denied',
        fieldMessage: 'The selected filesystem path is not writable.',
      }
    }
    if (errorCode === 'EISDIR' || errorCode === 'ENOTDIR' || errorCode === 'ELOOP') {
      return {
        code: 'invalid_path',
        fieldCode: 'invalid_type',
        fieldMessage: 'The selected filesystem path has the wrong type.',
      }
    }
    if (errorCode === 'ENOSPC' || errorCode === 'EDQUOT') {
      return {
        code: 'storage_unavailable',
        fieldCode: 'storage_unavailable',
        fieldMessage: 'The selected filesystem has no writable capacity.',
      }
    }
    return null
  })()

  if (!classification) {
    return error
  }

  return new VaultCliError(
    classification.code,
    input.message,
    { retryable: false },
    {
      stage: input.stage,
      hint: input.hint,
      fields: input.fieldPath
        ? [{
            path: input.fieldPath,
            code: classification.fieldCode,
            message: classification.fieldMessage,
          }]
        : [],
    },
  )
}

export function toAssessmentImportVaultCliError(error: unknown) {
  const inputFileError = toImporterInputFileVaultCliError(error)
  if (inputFileError !== error) {
    return inputFileError
  }

  return toVaultCliError(error, {
    ASSESSMENT_INVALID_JSON: {
      code: 'invalid_payload',
      repair: {
        stage: 'validation',
        hint: 'Provide one valid JSON object in the assessment file and retry.',
        fields: [{
          path: '$',
          code: 'invalid_json',
          message: 'The assessment file must contain one valid JSON object.',
        }],
      },
    },
    ASSESSMENT_RESPONSE_INVALID: {
      code: 'contract_invalid',
      repair: (details) => contractValidationRepair(
        details,
        'Correct the listed assessment fields and retry.',
      ),
    },
  })
}

export function toAssessmentProjectVaultCliError(error: unknown) {
  return toVaultCliError(error, {
    ASSESSMENT_RESPONSE_NOT_FOUND: {
      code: 'not_found',
      message: 'The requested assessment response was not found.',
      repair: {
        stage: 'lookup',
        hint: 'Run intake list and retry with an existing assessment id.',
        fields: [{
          path: 'id',
          code: 'not_found',
          message: 'No assessment response matches this id.',
        }],
      },
    },
    ASSESSMENT_RESPONSE_PROJECT_INVALID: {
      code: 'contract_invalid',
      repair: {
        stage: 'projection',
        hint: 'Inspect the assessment response before retrying projection.',
      },
    },
  })
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
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
