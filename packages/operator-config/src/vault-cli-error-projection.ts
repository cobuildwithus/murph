import { redactSensitivePathSegments } from './text/shared.js'
import {
  createVaultCliRepair,
  VaultCliError,
  type VaultCliRepair,
  type VaultCliRepairField,
  type VaultCliRepairFieldInput,
} from './vault-cli-errors.js'

const ZOD_ISSUE_CODE_PATTERN =
  /^(?:custom|invalid_(?:element|format|key|type|union|value)|not_multiple_of|too_(?:big|small)|unrecognized_keys)$/u
const ZOD_EXPECTED_PATTERN =
  /^(?:array|boolean|null|number|object|string|undefined)$/u

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
 * Explicit repair guidance wins; otherwise only established Zod issue fields
 * can become value-free repair guidance.
 */
export function projectVaultCliError(error: unknown): VaultCliErrorProjection {
  const inferredRepair =
    error instanceof VaultCliError
      ? error.repair
        ? undefined
        : createValidationRepair(error.context)
      : isUnknownRecord(error) && error.name === 'ZodError'
        ? createValidationRepair(error)
        : undefined
  const cliError =
    error instanceof VaultCliError
      ? error
      : inferredRepair
        ? new VaultCliError('invalid_payload', 'Input failed validation.')
        : classifyUnhandledCliError(error)
  const repair = cliError.repair ?? inferredRepair
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
  const fieldErrors = repair?.fields.map(toProjectedFieldError)

  return {
    code: cliError.code,
    message: redactSensitivePathSegments(cliError.message),
    retryable,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fieldErrors && fieldErrors.length > 0 ? { fieldErrors } : {}),
    ...(repair?.hint
      ? { hint: redactSensitivePathSegments(repair.hint) }
      : {}),
    ...(repair?.stage ? { stage: repair.stage } : {}),
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

function createValidationRepair(details: unknown): VaultCliRepair | undefined {
  if (!isUnknownRecord(details) || !Array.isArray(details.issues)) {
    return undefined
  }

  const fields = details.issues.flatMap(
    (issue): VaultCliRepairFieldInput[] => {
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
        path: issue.path,
        code: issue.code,
        message: 'This field is invalid.',
        ...(expected ? { expected } : {}),
      }]
    },
  )

  return fields.length > 0
    ? createVaultCliRepair({ fields, stage: 'validation' })
    : undefined
}

function isZodPathSegment(value: unknown): value is PropertyKey {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'symbol'
  )
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
  if (!isUnknownRecord(error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}

function isUnknownRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}
