import { VaultCliError } from './vault-cli-errors.js'

export const RUNTIME_PACKAGES = Object.freeze([
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
        };

  return new VaultCliError(
    'runtime_unavailable',
    `packages/cli can describe ${operation}, but local execution is blocked until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.`,
    details,
  )
}
