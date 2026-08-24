import type { Errors } from 'incur'

import { redactSensitivePathSegments } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const MAX_CONTEXT_ISSUES = 12

export interface VaultCliErrorProjection {
  code: string
  message: string
  retryable: boolean
  exitCode?: number | undefined
  fieldErrors?: Errors.FieldError[] | undefined
}

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
  const fieldErrors = projectContextIssues(cliError.context?.issues)

  return {
    code: cliError.code,
    message: redactSensitivePathSegments(cliError.message),
    retryable,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fieldErrors && fieldErrors.length > 0 ? { fieldErrors } : {}),
  }
}

function classifyUnhandledCliError(error: unknown): VaultCliError {
  const nodeCode = readErrorCode(error)

  if (nodeCode === 'ENOENT') {
    return new VaultCliError(
      'not_found',
      'A required file or directory was not found.',
    )
  }

  if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return new VaultCliError(
      'permission_denied',
      'The command could not access a required file or directory.',
    )
  }

  if (nodeCode === 'EISDIR' || nodeCode === 'ENOTDIR') {
    return new VaultCliError(
      'invalid_path',
      'The command received the wrong kind of filesystem path.',
    )
  }

  if (nodeCode === 'ENOSPC') {
    return new VaultCliError(
      'storage_unavailable',
      'The command could not write because storage is unavailable.',
    )
  }

  const zodIssues = readZodLikeIssues(error)
  if (zodIssues.length > 0) {
    return new VaultCliError(
      'invalid_payload',
      'Input failed validation.',
      {
        issues: zodIssues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: validationMessageForCode(issue.code),
          expected: issue.expected,
        })),
      },
    )
  }

  return new VaultCliError(
    'UNKNOWN',
    'The command failed without a safe recoverable detail.',
  )
}

function projectContextIssues(value: unknown): Errors.FieldError[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.slice(0, MAX_CONTEXT_ISSUES).flatMap((issue): Errors.FieldError[] => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
      return []
    }
    const record = issue as Record<string, unknown>
    const missing = record.missing === true
    const code = readSafeIssueToken(record.code)
    const expected = readSafeIssueText(record.expected, 160) ?? ''
    const message =
      readSafeIssueText(record.message, 240) ??
      validationMessageForCode(code ?? undefined)

    return [{
      ...(code ? { code } : {}),
      ...(missing ? { missing: true } : {}),
      expected,
      message,
      path: normalizeIssuePath(record.path),
      received: missing ? 'missing' : 'invalid',
    }]
  })
}

function normalizeIssuePath(value: unknown): string {
  const segments = typeof value === 'string'
    ? value.split('.')
    : Array.isArray(value)
      ? value
      : []
  const normalized = segments.map((segment) => {
    if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0) {
      return String(segment)
    }
    if (typeof segment !== 'string') {
      return '<field>'
    }
    const trimmed = segment.trim()
    return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(trimmed) ? trimmed : '<field>'
  }).join('.')
  return normalized || '$'
}

function readSafeIssueToken(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(value)
    ? value
    : null
}

function readSafeIssueText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = redactSensitivePathSegments(value)
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (
    normalized.length === 0 ||
    /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer\s|token=)/iu.test(
      normalized,
    )
  ) {
    return null
  }
  const codePoints = Array.from(normalized)
  return codePoints.length <= maxLength
    ? normalized
    : `${codePoints.slice(0, Math.max(0, maxLength - 1)).join('')}…`
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}

interface ZodLikeIssue {
  code?: string | undefined
  expected?: string | undefined
  path: readonly PropertyKey[]
}

function readZodLikeIssues(error: unknown): ZodLikeIssue[] {
  if (!error || typeof error !== 'object' || !('issues' in error)) {
    return []
  }

  if (!Array.isArray(error.issues)) {
    return []
  }

  return error.issues.flatMap((issue): ZodLikeIssue[] => {
    if (!issue || typeof issue !== 'object') {
      return []
    }

    const path =
      'path' in issue && Array.isArray(issue.path)
        ? issue.path.filter(
            (segment: unknown): segment is PropertyKey =>
              typeof segment === 'string' ||
              typeof segment === 'number' ||
              typeof segment === 'symbol',
          )
        : []
    const code =
      'code' in issue && typeof issue.code === 'string'
        ? issue.code
        : undefined
    const expected =
      'expected' in issue && typeof issue.expected === 'string'
        ? safeExpectedType(issue.expected)
        : undefined

    return [{ path, ...(code ? { code } : {}), ...(expected ? { expected } : {}) }]
  })
}

function safeExpectedType(value: string): string | undefined {
  return /^[A-Za-z0-9_.| -]{1,80}$/u.test(value) ? value : undefined
}

function validationMessageForCode(code: string | undefined): string {
  switch (code) {
    case 'invalid_type':
      return 'Value does not match the required type.'
    case 'too_big':
      return 'Value exceeds the allowed maximum.'
    case 'too_small':
      return 'Value is below the allowed minimum.'
    case 'invalid_value':
    case 'invalid_enum_value':
      return 'Value is not one of the allowed options.'
    case 'unrecognized_keys':
      return 'Field is not supported.'
    default:
      return 'Value failed validation.'
  }
}
