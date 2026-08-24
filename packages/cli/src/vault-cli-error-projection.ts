import {
  projectVaultCliError as projectGenericVaultCliError,
  type VaultCliErrorProjection,
} from '@murphai/operator-config/vault-cli-error-projection'

export type {
  VaultCliErrorProjection,
  VaultCliProjectedFieldError,
} from '@murphai/operator-config/vault-cli-error-projection'

export function projectVaultCliError(error: unknown): VaultCliErrorProjection {
  const querySourceDetails = readQuerySourceDetails(error)
  if (querySourceDetails !== null) {
    return projectQuerySourceError(querySourceDetails)
  }

  const commonsArtifactError = readHealthCommonsProtocolArtifactError(error)
  if (commonsArtifactError !== null) {
    return projectHealthCommonsProtocolArtifactError(commonsArtifactError)
  }

  return projectGenericVaultCliError(error)
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

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}
