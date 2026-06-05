import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface VaultOverrideParseResult {
  argv: string[]
  explicit: boolean
  vault: string | null
}

export function extractVaultOverride(
  args: readonly string[],
): VaultOverrideParseResult {
  const argv: string[] = []
  let vault: string | null = null
  let explicit = false

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === '--') {
      argv.push(...args.slice(index))
      break
    }

    if (token === '--vault') {
      if (explicit) {
        throw new VaultCliError(
          'invalid_option',
          'Pass --vault only once.',
        )
      }

      const value = args[index + 1]
      if (value === undefined || value === '--') {
        throw new VaultCliError(
          'invalid_option',
          'Missing value for --vault.',
        )
      }

      vault = value
      explicit = true
      index += 1
      continue
    }

    if (token?.startsWith('--vault=')) {
      if (explicit) {
        throw new VaultCliError(
          'invalid_option',
          'Pass --vault only once.',
        )
      }

      const value = token.slice('--vault='.length)
      if (value.length === 0) {
        throw new VaultCliError(
          'invalid_option',
          'Missing value for --vault.',
        )
      }

      vault = value
      explicit = true
      continue
    }

    if (token !== undefined) {
      argv.push(token)
    }
  }

  return {
    argv,
    explicit,
    vault,
  }
}
