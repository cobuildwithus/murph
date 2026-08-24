import { redactSensitivePathSegments } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const MAX_VALIDATION_FIELDS = 12
const MAX_VALIDATION_PATH_LENGTH = 160
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
 * Projects domain and unexpected failures into the privacy-safe CLI envelope.
 * VaultCliError context is the sole metadata source. Only an owner's explicit
 * publicPath can become value-free field guidance.
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

  return {
    code: error.code,
    message: redactSensitivePathSegments(error.message),
    retryable,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fieldErrors ? { fieldErrors } : {}),
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
        !/^(?:custom|invalid_(?:element|format|key|type|union|value)|not_multiple_of|too_(?:big|small)|unrecognized_keys)$/u.test(issue.code) ||
        !Array.isArray(issue.publicPath) ||
        !issue.publicPath.every(isPublicPathSegment)
      ) {
        return []
      }

      const expected =
        typeof issue.expected === 'string' &&
        /^(?:array|boolean|null|number|object|string|undefined)$/u.test(issue.expected)
          ? issue.expected
          : undefined
      return [{
        code: issue.code,
        path: normalizeValidationPath(issue.publicPath),
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

  if (nodeCode === 'ENOENT') {
    return {
      code: 'not_found',
      message: 'A required file or directory was not found.',
      retryable: false,
      stage: 'filesystem',
      hint: 'Check the input path and retry the command.',
    }
  }

  if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return {
      code: 'permission_denied',
      message: 'The command could not access a required file or directory.',
      retryable: false,
      stage: 'filesystem',
      hint: 'Check the file permissions before retrying.',
    }
  }

  if (nodeCode === 'EISDIR' || nodeCode === 'ENOTDIR') {
    return {
      code: 'invalid_path',
      message: 'The command received the wrong kind of filesystem path.',
      retryable: false,
      stage: 'filesystem',
      hint: 'Check whether the option expects a file or a directory.',
    }
  }

  if (nodeCode === 'ENOSPC') {
    return {
      code: 'storage_unavailable',
      message: 'The command could not write because storage is unavailable.',
      retryable: false,
      stage: 'filesystem',
      hint: 'Free storage space before retrying.',
    }
  }

  return {
    code: 'UNKNOWN',
    message: UNKNOWN_ERROR_MESSAGE,
    retryable: false,
    stage: 'command',
  }
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
