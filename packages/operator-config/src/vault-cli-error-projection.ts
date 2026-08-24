import { redactSensitivePathSegments } from './text/shared.js'
import {
  VaultCliError,
  type VaultCliRepairField,
} from './vault-cli-errors.js'

export interface VaultCliProjectedFieldError {
  code?: string | undefined
  missing?: boolean | undefined
  path: string
  expected: string
  received: 'missing' | 'invalid'
  message: string
}

export interface VaultCliErrorProjection {
  code: string
  message: string
  retryable: boolean
  exitCode?: number | undefined
  fieldErrors?: VaultCliProjectedFieldError[] | undefined
  hint?: string | undefined
  stage?: string | undefined
}

/**
 * Projects domain and unexpected failures into the privacy-safe CLI envelope.
 *
 * Rich repair details come only from the explicit {@link VaultCliError.repair}
 * allowlist. Arbitrary error context is never inspected for field guidance.
 */
export function projectVaultCliError(error: unknown): VaultCliErrorProjection {
  const cliError =
    error instanceof VaultCliError ? error : classifyUnhandledCliError(error)
  const retryable =
    typeof cliError.context?.retryable === 'boolean'
      ? cliError.context.retryable
      : false
  const exitCode =
    typeof cliError.context?.exitCode === 'number' &&
    Number.isSafeInteger(cliError.context.exitCode) &&
    cliError.context.exitCode > 0
      ? cliError.context.exitCode
      : undefined
  const fieldErrors = cliError.repair?.fields.map(toProjectedFieldError)

  return {
    code: cliError.code,
    message: redactSensitivePathSegments(cliError.message),
    retryable,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fieldErrors && fieldErrors.length > 0 ? { fieldErrors } : {}),
    ...(cliError.repair?.hint
      ? { hint: redactSensitivePathSegments(cliError.repair.hint) }
      : {}),
    ...(cliError.repair?.stage ? { stage: cliError.repair.stage } : {}),
  }
}

function toProjectedFieldError(
  field: VaultCliRepairField,
): VaultCliProjectedFieldError {
  return {
    ...(field.code ? { code: field.code } : {}),
    ...(field.missing === true ? { missing: true } : {}),
    path: field.path,
    expected: redactSensitivePathSegments(field.expected ?? ''),
    received: field.missing === true ? 'missing' : 'invalid',
    message: redactSensitivePathSegments(field.message),
  }
}

function classifyUnhandledCliError(error: unknown): VaultCliError {
  const nodeCode = readErrorCode(error)

  if (nodeCode === 'ENOENT') {
    return new VaultCliError(
      'not_found',
      'A required file or directory was not found.',
      undefined,
      {
        stage: 'filesystem',
        hint: 'Check the input path and retry the command.',
      },
    )
  }

  if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return new VaultCliError(
      'permission_denied',
      'The command could not access a required file or directory.',
      undefined,
      {
        stage: 'filesystem',
        hint: 'Check the file permissions before retrying.',
      },
    )
  }

  if (nodeCode === 'EISDIR' || nodeCode === 'ENOTDIR') {
    return new VaultCliError(
      'invalid_path',
      'The command received the wrong kind of filesystem path.',
      undefined,
      {
        stage: 'filesystem',
        hint: 'Check whether the option expects a file or a directory.',
      },
    )
  }

  if (nodeCode === 'ENOSPC') {
    return new VaultCliError(
      'storage_unavailable',
      'The command could not write because storage is unavailable.',
      undefined,
      {
        stage: 'filesystem',
        hint: 'Free storage space before retrying.',
      },
    )
  }

  return new VaultCliError(
    'UNKNOWN',
    safeUnhandledErrorMessage(error),
    undefined,
    {
      stage: 'command',
      hint: 'Check the command inputs and runtime status before retrying.',
    },
  )
}

function safeUnhandledErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'The command failed without a safe recoverable detail.'
  }

  const normalized = redactSensitivePathSegments(error.message)
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (
    normalized.length === 0 ||
    /^[\[{]/u.test(normalized) ||
    /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer\s|token=)/iu.test(
      normalized,
    )
  ) {
    return 'The command failed without a safe recoverable detail.'
  }

  const codePoints = Array.from(normalized)
  return codePoints.length <= 320
    ? normalized
    : `${codePoints.slice(0, 319).join('')}…`
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}
