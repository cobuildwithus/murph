import type { Errors } from 'incur'

import { redactSensitivePathSegments } from '@murphai/operator-config/text/shared'
import {
  createVaultCliRepair,
  VaultCliError,
  type VaultCliRepairField,
} from '@murphai/operator-config/vault-cli-errors'

export interface VaultCliErrorProjection {
  code: string
  message: string
  retryable: boolean
  exitCode?: number | undefined
  fieldErrors?: Errors.FieldError[] | undefined
  hint?: string | undefined
  stage?: string | undefined
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
  const fieldErrors = cliError.repair?.fields.map(toIncurFieldError)

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

function toIncurFieldError(field: VaultCliRepairField): Errors.FieldError {
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
      createVaultCliRepair({
        stage: 'filesystem',
        hint: 'Check the input path and retry the command.',
      }),
    )
  }

  if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return new VaultCliError(
      'permission_denied',
      'The command could not access a required file or directory.',
      undefined,
      createVaultCliRepair({
        stage: 'filesystem',
        hint: 'Check the file permissions before retrying.',
      }),
    )
  }

  if (nodeCode === 'EISDIR' || nodeCode === 'ENOTDIR') {
    return new VaultCliError(
      'invalid_path',
      'The command received the wrong kind of filesystem path.',
      undefined,
      createVaultCliRepair({
        stage: 'filesystem',
        hint: 'Check whether the option expects a file or a directory.',
      }),
    )
  }

  if (nodeCode === 'ENOSPC') {
    return new VaultCliError(
      'storage_unavailable',
      'The command could not write because storage is unavailable.',
      undefined,
      createVaultCliRepair({
        stage: 'filesystem',
        hint: 'Free storage space before retrying.',
      }),
    )
  }

  const zodIssues = readZodLikeIssues(error)
  if (zodIssues.length > 0) {
    return new VaultCliError(
      'invalid_payload',
      'Input failed validation.',
      undefined,
      createVaultCliRepair({
        stage: 'validation',
        fields: zodIssues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: validationMessageForCode(issue.code),
          expected: issue.expected,
        })),
      }),
    )
  }

  return new VaultCliError(
    'UNKNOWN',
    safeUnhandledErrorMessage(error),
    undefined,
    createVaultCliRepair({
      stage: 'command',
      hint: 'Check the command inputs and runtime status before retrying.',
    }),
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
