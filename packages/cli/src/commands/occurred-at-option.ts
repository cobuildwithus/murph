import {
  formatTimeZoneDateTimeParts,
  isStrictIsoDate,
  normalizeIanaTimeZone,
} from '@murphai/contracts'
import {
  isoTimestampSchema,
  localDateSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const LOCAL_NOON_HOUR = 12
const LOCAL_NOON_MINUTE = 0
const LOCAL_NOON_SECOND = 0
const MAX_TIMEZONE_RESOLUTION_ITERATIONS = 4

interface NormalizeOccurredAtOptionInput {
  vault: string
  occurredAt?: string
  timeZone?: string
}

interface LocalDateParts {
  year: number
  month: number
  day: number
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
  return resolveLocalDateAtVaultNoon(occurredAt, timeZone)
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

function resolveLocalDateAtVaultNoon(localDate: string, timeZone: string): string {
  const parts = parseLocalDateParts(localDate)
  const targetLocalMilliseconds = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    LOCAL_NOON_HOUR,
    LOCAL_NOON_MINUTE,
    LOCAL_NOON_SECOND,
    0,
  )

  let guessMilliseconds = targetLocalMilliseconds

  for (let iteration = 0; iteration < MAX_TIMEZONE_RESOLUTION_ITERATIONS; iteration += 1) {
    const observed = formatTimeZoneDateTimeParts(guessMilliseconds, timeZone)
    const observedLocalMilliseconds = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      0,
    )
    const deltaMilliseconds = observedLocalMilliseconds - targetLocalMilliseconds

    if (deltaMilliseconds === 0) {
      return new Date(guessMilliseconds).toISOString()
    }

    guessMilliseconds -= deltaMilliseconds
  }

  const resolved = formatTimeZoneDateTimeParts(guessMilliseconds, timeZone)
  if (
    resolved.year === parts.year &&
    resolved.month === parts.month &&
    resolved.day === parts.day &&
    resolved.hour === LOCAL_NOON_HOUR &&
    resolved.minute === LOCAL_NOON_MINUTE &&
    resolved.second === LOCAL_NOON_SECOND
  ) {
    return new Date(guessMilliseconds).toISOString()
  }

  throw new VaultCliError(
    'invalid_option',
    `Could not resolve --occurred-at date "${localDate}" in vault timezone "${timeZone}".`,
  )
}

function parseLocalDateParts(value: string): LocalDateParts {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value)
  if (!match?.groups) {
    throw new VaultCliError(
      'invalid_option',
      `Expected a YYYY-MM-DD date, received "${value}".`,
    )
  }

  return {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
  }
}
