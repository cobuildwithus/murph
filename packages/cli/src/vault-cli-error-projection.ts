import type { Errors } from 'incur'

import { redactSensitivePathSegments } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

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
  if (error instanceof VaultCliError) {
    return projectStableVaultCliError(error)
  }

  const querySourceDetails = readQuerySourceDetails(error)
  if (querySourceDetails !== null) {
    return projectQuerySourceError(querySourceDetails)
  }

  const commonsArtifactError = readHealthCommonsProtocolArtifactError(error)
  if (commonsArtifactError !== null) {
    return projectHealthCommonsProtocolArtifactError(commonsArtifactError)
  }

  const nodeProjection = projectNodeError(error)
  if (nodeProjection !== null) {
    return nodeProjection
  }

  const fieldErrors = projectValidationIssues(readZodLikeIssues(error))
  if (fieldErrors.length > 0) {
    return {
      code: 'invalid_payload',
      message: 'Input failed validation.',
      retryable: false,
      fieldErrors,
      hint: 'Correct the invalid fields, then rerun the command.',
      stage: 'validation',
    }
  }

  return {
    code: 'UNKNOWN',
    message: safeUnhandledErrorMessage(error),
    retryable: false,
    hint: 'Check the command inputs and runtime status before retrying.',
    stage: 'command',
  }
}

function projectStableVaultCliError(
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
  const fieldErrors = projectValidationIssues(
    readZodLikeIssues({ issues: error.context?.issues }),
  )

  return {
    code: error.code,
    message: redactSensitivePathSegments(error.message),
    retryable,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(fieldErrors.length === 0
      ? {}
      : {
          fieldErrors,
          hint: 'Correct the invalid fields, then rerun the command.',
          stage: 'validation',
        }),
  }
}

function projectQuerySourceError(
  details: QuerySourceDetails,
): VaultCliErrorProjection {
  const location =
    details.lineNumber === undefined
      ? details.relativePath
      : `${details.relativePath}:${details.lineNumber}`

  if (details.issue === 'unsupported_format') {
    return {
      code: 'unsupported_format',
      message: `Canonical vault source ${details.relativePath} uses an unsupported format.`,
      retryable: false,
      hint:
        'Use a compatible Murph runtime or a supported Murph migration path, then rerun the command. Do not edit vault.json manually.',
      stage: 'query_source',
    }
  }

  return {
    code: 'query_source_invalid',
    message: `Canonical vault source ${location} could not be read.`,
    retryable: false,
    ...(details.field
      ? {
          fieldErrors: [
            {
              path: details.field,
              code: details.issue,
              expected: '',
              received:
                details.issue === 'missing_field' ? 'missing' : 'invalid',
              message: 'This canonical source field is invalid or missing.',
              ...(details.issue === 'missing_field' ? { missing: true } : {}),
            },
          ],
        }
      : {}),
    hint: `Repair ${location}, then rerun the command. Vault validation can identify additional source issues.`,
    stage: 'query_source',
  }
}

function projectHealthCommonsProtocolArtifactError(
  error: HealthCommonsProtocolArtifactDetails,
): VaultCliErrorProjection {
  const unavailable = error.category === 'unavailable'
  return {
    code: unavailable
      ? 'commons_protocol_artifact_unavailable'
      : 'commons_protocol_artifact_invalid',
    message: unavailable
      ? 'Health Commons protocol artifacts are unavailable.'
      : 'Health Commons protocol artifacts are invalid.',
    retryable: false,
    hint:
      'Stop protocol discovery, onboarding, planning, and starting a protocol until the packaged artifacts are restored or regenerated; then rerun the command. No protocol-backed run was created.',
    stage: error.artifact,
  }
}

function projectNodeError(error: unknown): VaultCliErrorProjection | null {
  switch (readErrorCode(error)) {
    case 'ENOENT':
      return {
        code: 'not_found',
        message: 'A required file or directory was not found.',
        retryable: false,
        hint: 'Check the input path and retry the command.',
        stage: 'filesystem',
      }
    case 'EACCES':
    case 'EPERM':
      return {
        code: 'permission_denied',
        message: 'The command could not access a required file or directory.',
        retryable: false,
        hint: 'Check the file permissions before retrying.',
        stage: 'filesystem',
      }
    case 'EISDIR':
    case 'ENOTDIR':
      return {
        code: 'invalid_path',
        message: 'The command received the wrong kind of filesystem path.',
        retryable: false,
        hint: 'Check whether the option expects a file or a directory.',
        stage: 'filesystem',
      }
    case 'ENOSPC':
      return {
        code: 'storage_unavailable',
        message: 'The command could not write because storage is unavailable.',
        retryable: false,
        hint: 'Free storage space before retrying.',
        stage: 'filesystem',
      }
    default:
      return null
  }
}

const querySourceIssues = new Set([
  'document_path_mismatch',
  'frontmatter_contract_invalid',
  'frontmatter_invalid',
  'malformed_json',
  'metadata_invalid',
  'missing_field',
  'unsupported_format',
] as const)

type QuerySourceIssue =
  | 'document_path_mismatch'
  | 'frontmatter_contract_invalid'
  | 'frontmatter_invalid'
  | 'malformed_json'
  | 'metadata_invalid'
  | 'missing_field'
  | 'unsupported_format'

interface QuerySourceDetails {
  field?: string | undefined
  issue: QuerySourceIssue
  lineNumber?: number | undefined
  relativePath: string
}

function readQuerySourceDetails(error: unknown): QuerySourceDetails | null {
  if (
    !(error instanceof Error) ||
    readErrorCode(error) !== 'QUERY_SOURCE_INVALID' ||
    !('details' in error) ||
    !error.details ||
    typeof error.details !== 'object'
  ) {
    return null
  }

  const details = error.details
  if (
    !('querySource' in details) ||
    details.querySource !== true ||
    !('relativePath' in details) ||
    typeof details.relativePath !== 'string' ||
    !isSafeRelativePath(details.relativePath) ||
    !('issue' in details) ||
    typeof details.issue !== 'string' ||
    !isQuerySourceIssue(details.issue)
  ) {
    return null
  }

  const lineNumber =
    'lineNumber' in details &&
    Number.isSafeInteger(details.lineNumber) &&
    Number(details.lineNumber) > 0
      ? Number(details.lineNumber)
      : undefined
  const field =
    'field' in details &&
    typeof details.field === 'string' &&
    /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u.test(details.field)
      ? details.field
      : undefined

  return {
    relativePath: details.relativePath,
    issue: details.issue,
    ...(lineNumber === undefined ? {} : { lineNumber }),
    ...(field === undefined ? {} : { field }),
  }
}

function isQuerySourceIssue(value: string): value is QuerySourceIssue {
  return querySourceIssues.has(value as QuerySourceIssue)
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 160 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value) ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return false
  }

  return value
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

const healthCommonsProtocolArtifacts = new Set([
  'protocol_family_graph',
  'protocol_index',
  'protocol_run_specs',
] as const)

type HealthCommonsProtocolArtifact =
  | 'protocol_family_graph'
  | 'protocol_index'
  | 'protocol_run_specs'

interface HealthCommonsProtocolArtifactDetails {
  artifact: HealthCommonsProtocolArtifact
  category: 'invalid' | 'unavailable'
}

function readHealthCommonsProtocolArtifactError(
  error: unknown,
): HealthCommonsProtocolArtifactDetails | null {
  if (
    !(error instanceof Error) ||
    readErrorCode(error) !== 'HEALTH_COMMONS_PROTOCOL_ARTIFACT_FAILURE' ||
    !('artifact' in error) ||
    typeof error.artifact !== 'string' ||
    !healthCommonsProtocolArtifacts.has(
      error.artifact as HealthCommonsProtocolArtifact,
    ) ||
    !('category' in error) ||
    (error.category !== 'invalid' && error.category !== 'unavailable')
  ) {
    return null
  }

  return {
    artifact: error.artifact as HealthCommonsProtocolArtifact,
    category: error.category,
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
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}

interface ZodLikeIssue {
  code?: string | undefined
  expected?: string | undefined
  path: readonly (string | number)[]
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
            (segment: unknown): segment is string | number =>
              (typeof segment === 'string' &&
                /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u.test(segment)) ||
              (typeof segment === 'number' &&
                Number.isSafeInteger(segment) &&
                segment >= 0),
          )
        : []
    const code =
      'code' in issue &&
      typeof issue.code === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/u.test(issue.code)
        ? issue.code
        : undefined
    const expected =
      'expected' in issue && typeof issue.expected === 'string'
        ? safeExpectedType(issue.expected)
        : undefined

    return [{ path, ...(code ? { code } : {}), ...(expected ? { expected } : {}) }]
  })
}

function projectValidationIssues(
  issues: readonly ZodLikeIssue[],
): Errors.FieldError[] {
  const included = issues.slice(0, 12).map((issue): Errors.FieldError => {
    const missing = issue.code === 'missing_field' || issue.code?.endsWith('_missing')
    return {
      ...(issue.code ? { code: issue.code } : {}),
      path: issue.path.length === 0 ? '$' : issue.path.join('.'),
      expected: issue.expected ?? '',
      received: missing ? 'missing' : 'invalid',
      message: validationMessageForCode(issue.code),
      ...(missing ? { missing: true } : {}),
    }
  })

  if (issues.length > included.length) {
    included.push({
      code: 'issues_omitted',
      path: '$',
      expected: '',
      received: 'invalid',
      message: `${issues.length - included.length} additional validation ${issues.length - included.length === 1 ? 'issue was' : 'issues were'} omitted.`,
    })
  }

  return included
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
