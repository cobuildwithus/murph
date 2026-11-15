import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const RUNTIME_PACKAGES = Object.freeze([
  '@murphai/core',
  '@murphai/importers',
  '@murphai/query',
  'incur',
])

export function createRuntimeUnavailableError(
  operation: string,
  cause: unknown,
) {
  const details =
    cause instanceof Error
      ? {
          cause: cause.message,
          packages: [...RUNTIME_PACKAGES],
        }
      : {
          packages: [...RUNTIME_PACKAGES],
        }

  return new VaultCliError(
    'runtime_unavailable',
    `Local runtime for ${operation} is unavailable until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.`,
    details,
  )
}

export function toVaultCliFilesystemError(
  error: unknown,
  input: {
    message: string
    fieldPath?: 'file' | 'out' | 'vault'
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
        issueCode: 'custom',
      }
    }
    if (errorCode === 'EACCES' || errorCode === 'EPERM' || errorCode === 'EROFS') {
      return {
        code: 'permission_denied',
        issueCode: 'custom',
      }
    }
    if (
      errorCode === 'EEXIST'
      || errorCode === 'EISDIR'
      || errorCode === 'ENOTDIR'
      || errorCode === 'ELOOP'
    ) {
      return {
        code: 'invalid_path',
        issueCode: 'invalid_type',
      }
    }
    if (errorCode === 'ENOSPC' || errorCode === 'EDQUOT') {
      return {
        code: 'storage_unavailable',
        issueCode: 'custom',
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
    {
      retryable: false,
      stage: 'filesystem',
      issues: input.fieldPath
          ? [{
            publicPath: [input.fieldPath],
            code: classification.issueCode,
          }]
        : [],
    },
  )
}

export function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof error.code === 'string' ? error.code : null
}
