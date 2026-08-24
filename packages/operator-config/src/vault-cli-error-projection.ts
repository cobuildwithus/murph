import { redactSensitivePathSegments } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const MAX_VALIDATION_FIELDS = 12
const MAX_VALIDATION_PATH_LENGTH = 160
const ZOD_ISSUE_CODE_PATTERN =
  /^(?:custom|invalid_(?:element|format|key|type|union|value)|not_multiple_of|too_(?:big|small)|unrecognized_keys)$/u
const ZOD_EXPECTED_PATTERN =
  /^(?:array|boolean|null|number|object|string|undefined)$/u
const ERROR_STAGE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u

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
 * VaultCliError context is the sole metadata source. Only established Zod
 * issue fields can become value-free field guidance.
 */
export function projectVaultCliError(error: unknown): VaultCliErrorProjection {
  if (error instanceof VaultCliError) {
    return projectKnownVaultCliError(error)
  }

  const fieldErrors =
    isUnknownRecord(error) && error.name === 'ZodError'
      ? createValidationFieldErrors(error)
      : undefined
  if (fieldErrors) {
    return {
      code: 'invalid_payload',
      message: 'Input failed validation.',
      retryable: false,
      fieldErrors,
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
  const contextStage = readSafeErrorStage(error.context?.stage)
  const stage = contextStage ?? (fieldErrors ? 'validation' : undefined)

  return {
    code: error.code,
    message: redactSensitivePathSegments(error.message),
    retryable,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(stage ? { stage } : {}),
  }
}

function readSafeErrorStage(value: unknown): string | undefined {
  return typeof value === 'string' && ERROR_STAGE_PATTERN.test(value)
    ? value
    : undefined
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
        !ZOD_ISSUE_CODE_PATTERN.test(issue.code) ||
        !Array.isArray(issue.path) ||
        !issue.path.every(isZodPathSegment)
      ) {
        return []
      }

      const expected =
        typeof issue.expected === 'string' &&
        ZOD_EXPECTED_PATTERN.test(issue.expected)
          ? issue.expected
          : undefined
      return [{
        code: issue.code,
        path: normalizeValidationPath(issue.path),
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

function isZodPathSegment(value: unknown): value is PropertyKey {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'symbol'
  )
}

function normalizeValidationPath(path: readonly PropertyKey[]): string {
  const normalized = path.map(normalizeValidationPathSegment).join('.') || '$'
  const codePoints = Array.from(normalized)
  return codePoints.length <= MAX_VALIDATION_PATH_LENGTH
    ? normalized
    : `${codePoints.slice(0, MAX_VALIDATION_PATH_LENGTH - 1).join('')}…`
}

function normalizeValidationPathSegment(segment: PropertyKey): string {
  if (
    typeof segment === 'number' &&
    Number.isSafeInteger(segment) &&
    segment >= 0
  ) {
    return String(segment)
  }

  if (typeof segment !== 'string') {
    return '<field>'
  }

  const trimmed = segment.trim()
  return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(trimmed)
    ? trimmed
    : '<field>'
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
    message: safeUnhandledErrorMessage(error),
    retryable: false,
    stage: 'command',
    hint: 'Check the command inputs and runtime status before retrying.',
  }
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
  if (!isUnknownRecord(error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}

function isUnknownRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}
