import {
  isStrictIsoDate,
  normalizeIanaTimeZone,
  resolveLocalDateAtNoon,
} from '@murphai/contracts'
import {
  isoTimestampSchema,
  localDateSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

interface NormalizeOccurredAtOptionInput {
  vault: string
  occurredAt?: string
  timeZone?: string
}

export async function normalizeOccurredAtOption(
  input: NormalizeOccurredAtOptionInput,
): Promise<string | undefined> {
  if (typeof input.occurredAt !== 'string') {
    return undefined
  }

  const occurredAt = input.occurredAt.trim()
  if (occurredAt.length === 0) {
    return undefined
  }

  if (isoTimestampSchema.safeParse(occurredAt).success) {
    return occurredAt
  }

  if (!localDateSchema.safeParse(occurredAt).success || !isStrictIsoDate(occurredAt)) {
    throw new VaultCliError(
      'invalid_option',
      'Expected --occurred-at to be an ISO 8601 timestamp with an explicit offset or a YYYY-MM-DD date.',
    )
  }

  const timeZone = await resolveOccurredAtLocalDateTimeZone(input)
  try {
    return resolveLocalDateAtNoon(occurredAt, timeZone)
  } catch {
    throw new VaultCliError(
      'invalid_option',
      `Could not resolve --occurred-at date "${occurredAt}" in vault timezone "${timeZone}".`,
    )
  }
}

async function resolveOccurredAtLocalDateTimeZone(
  input: NormalizeOccurredAtOptionInput,
): Promise<string> {
  if (typeof input.timeZone === 'string') {
    const normalized = normalizeIanaTimeZone(input.timeZone)
    if (!normalized) {
      throw new VaultCliError(
        'invalid_option',
        `Invalid --time-zone "${input.timeZone}".`,
      )
    }
    return normalized
  }

  // Lazy import: this module registers on every command group that supports
  // --occurred-at, so a static @murphai/core import would put the entire core
  // write runtime (and its runtime-state subtree) on the read-only scoped hot
  // path. Only an actual date-without-offset normalization needs the vault.
  const { loadVault } = await import('@murphai/core')
  const vault = await loadVault({ vaultRoot: input.vault })
  return vault.metadata.timezone
}
