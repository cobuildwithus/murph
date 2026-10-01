import { redactSensitivePathSegments } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const MAX_VALIDATION_FIELDS = 12
const MAX_VALIDATION_PATH_LENGTH = 160
const MAX_ERROR_MESSAGE_LENGTH = 640
const MAX_ERROR_HINT_LENGTH = 320
const UNKNOWN_ERROR_MESSAGE =
  'The command failed without a safe recoverable detail.'
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
 * Projects domain and unexpected failures into the bounded CLI envelope.
 * VaultCliError context is the sole structured metadata source. An owner's
 * explicit publicPath takes precedence over an ordinary schema issue path.
 */
export function projectVaultCliError(error: unknown): VaultCliErrorProjection {
  if (error instanceof VaultCliError) {
    return projectKnownVaultCliError(error)
  }

  if (isUnknownRecord(error) && error.name === 'ZodError') {
    return {
      code: 'invalid_payload',
      message: 'Input failed validation.',
      retryable: false,
      stage: 'validation',
    }
  }

  return classifyUnhandledCliError(error)
}

function projectKnownVaultCliError(
  error: VaultCliError,
): VaultCliErrorProjection {
  const retryable =
    typeof error.context?.retryable === 'boolean'
      ? error.context.retryable
      : false
  const exitCode =
    typeof error.context?.exitCode === 'number' &&
    Number.isSafeInteger(error.context.exitCode) &&
    error.context.exitCode > 0
      ? error.context.exitCode
      : undefined
  const fieldErrors = createValidationFieldErrors(error.context)
  const stage = readKnownErrorStage(error.context?.stage)
    ?? (fieldErrors ? 'validation' : undefined)
  const hint = readBoundedDiagnosticString(
    error.context?.hint,
    MAX_ERROR_HINT_LENGTH,
  )

  return {
    code: error.code,
    message: boundedDiagnosticMessage(error),
    retryable,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(hint === undefined ? {} : { hint }),
    ...(stage === undefined ? {} : { stage }),
  }
}

function createValidationFieldErrors(
  details: unknown,
): VaultCliProjectedFieldError[] | undefined {
  if (!isUnknownRecord(details) || !Array.isArray(details.issues)) {
    return undefined
  }

  const fields = details.issues.flatMap(
    (issue): VaultCliProjectedFieldError[] => {
      if (
        !isUnknownRecord(issue) ||
        typeof issue.code !== 'string' ||
        !/^(?:custom|invalid_(?:element|format|key|type|union|value)|not_multiple_of|too_(?:big|small)|unrecognized_keys)$/u.test(issue.code)
      ) {
        return []
      }

      const path = resolveValidationPath(issue)
      if (path === null) {
        return []
      }

      const expected =
        typeof issue.expected === 'string' &&
        /^(?:array|boolean|null|number|object|string|undefined)$/u.test(issue.expected)
          ? issue.expected
          : undefined
      return [{
        code: issue.code,
        path: normalizeValidationPath(path),
        expected: expected ?? '',
        received: 'invalid',
        message: 'This field is invalid.',
      }]
    },
  )

  if (fields.length === 0) {
    return undefined
  }

  const boundedFields = fields.slice(0, MAX_VALIDATION_FIELDS)
  const omittedFieldCount = fields.length - boundedFields.length
  if (omittedFieldCount > 0) {
    boundedFields.push({
      path: '$',
      code: 'issues_omitted',
      expected: '',
      received: 'invalid',
      message: `${omittedFieldCount} additional validation ${omittedFieldCount === 1 ? 'issue was' : 'issues were'} omitted.`,
    })
  }

  return boundedFields
}

function resolveValidationPath(
  issue: Record<PropertyKey, unknown>,
): readonly (string | number)[] | null {
  if (issue.publicPath !== undefined) {
    return Array.isArray(issue.publicPath) &&
      issue.publicPath.every(isPublicPathSegment)
      ? issue.publicPath
      : null
  }

  return Array.isArray(issue.path) && issue.path.every(isPublicPathSegment)
    ? issue.path
    : null
}

function isPublicPathSegment(value: unknown): value is string | number {
  return (
    typeof value === 'string' &&
    /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(value)
  ) || (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  )
}

function normalizeValidationPath(path: readonly (string | number)[]): string {
  const normalized = path.join('.') || '$'
  const codePoints = Array.from(normalized)
  return codePoints.length <= MAX_VALIDATION_PATH_LENGTH
    ? normalized
    : `${codePoints.slice(0, MAX_VALIDATION_PATH_LENGTH - 1).join('')}…`
}

function readKnownErrorStage(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^(?:authorization|configuration|conflict|filesystem|integrity|persistence|read|render|response|transport|validation|write)$/u.test(value)
    ? value
    : undefined
}

function classifyUnhandledCliError(error: unknown): VaultCliErrorProjection {
  const nodeCode = readErrorCode(error)
  const message = boundedDiagnosticMessage(error)

  if (nodeCode === 'ENOENT') {
    return {
      code: 'not_found',
      message,
      retryable: false,
      stage: 'filesystem',
      hint: 'Check the input path and retry the command.',
    }
  }

  if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return {
      code: 'permission_denied',
      message,
      retryable: false,
      stage: 'filesystem',
      hint: 'Check the file permissions before retrying.',
    }
  }

  if (nodeCode === 'EISDIR' || nodeCode === 'ENOTDIR') {
    return {
      code: 'invalid_path',
      message,
      retryable: false,
      stage: 'filesystem',
      hint: 'Check whether the option expects a file or a directory.',
    }
  }

  if (nodeCode === 'ENOSPC') {
    return {
      code: 'storage_unavailable',
      message,
      retryable: false,
      stage: 'filesystem',
      hint: 'Free storage space before retrying.',
    }
  }

  if (nodeCode === 'VAULT_INVALID_INPUT') {
    return {
      code: nodeCode,
      message,
      retryable: false,
      stage: 'validation',
    }
  }

  return {
    code: readBoundedErrorCode(nodeCode) ?? 'UNKNOWN',
    message,
    retryable: false,
    stage: 'command',
  }
}

function boundedDiagnosticMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : isUnknownRecord(error) && typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : null

  return readBoundedDiagnosticString(message, MAX_ERROR_MESSAGE_LENGTH)
    ?? UNKNOWN_ERROR_MESSAGE
}

function readBoundedDiagnosticString(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = redactCredentialShapes(
    redactSensitivePathSegments(value.trim()),
  )
  if (normalized.length === 0) {
    return undefined
  }

  const codePoints = Array.from(normalized)
  return codePoints.length <= maximumLength
    ? normalized
    : `${codePoints.slice(0, maximumLength - 1).join('')}…`
}

function redactCredentialShapes(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, '$1 <REDACTED_CREDENTIAL>')
    .replace(
      /\b((?:api[-_ ]?key|access[-_ ]?token|authorization|password|secret)\s*[:=]\s*)[^\s,;]+/giu,
      '$1<REDACTED_CREDENTIAL>',
    )
}

function readBoundedErrorCode(value: string | null): string | undefined {
  return value !== null && /^[A-Za-z0-9_.:-]{1,96}$/u.test(value)
    ? value
    : undefined
}

function readErrorCode(error: unknown): string | null {
  if (!isUnknownRecord(error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}

function isUnknownRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}
