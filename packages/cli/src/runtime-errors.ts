import { VaultCliError } from './vault-cli-errors.js'

export const RUNTIME_PACKAGES = Object.freeze([
  '@murph/core',
  '@murph/importers',
  '@murph/query',
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
    `packages/cli can describe ${operation}, but local execution is blocked until the integrating workspace installs incur and links @murph/core, @murph/importers, and @murph/query.`,
    details,
  )
}
