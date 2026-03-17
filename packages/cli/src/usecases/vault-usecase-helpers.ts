import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  inferEntityKind,
  isQueryableRecordId,
} from './shared.js'

const ISO_TIMESTAMP_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function inferVaultLinkKind(
  id: string,
  options: {
    includeProviderIds?: boolean
  } = {},
) {
  const kind = inferEntityKind(id)

  if (kind === 'provider' && !options.includeProviderIds) {
    return 'entity'
  }

  return kind
}

export function isVaultQueryableRecordId(id: string) {
  return isQueryableRecordId(id)
}

export function normalizeOptionalText(value: string | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeIsoTimestamp(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  return ISO_TIMESTAMP_WITH_OFFSET_PATTERN.test(value) ? value : null
}

export function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return normalized.length > 0 ? uniqueStrings(normalized) : undefined
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
}

export function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)]
}

export function compactObject(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  )
}

export function resolveVaultRelativePath(vaultRoot: string, relativePath: string) {
  const normalized = String(relativePath).trim().replace(/\\/g, '/')

  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    throw new VaultCliError(
      'invalid_path',
      `Vault-relative path "${relativePath}" is invalid.`,
    )
  }

  const absoluteRoot = path.resolve(vaultRoot)
  const absolutePath = path.resolve(absoluteRoot, normalized)
  const containment = path.relative(absoluteRoot, absolutePath)

  if (
    containment === '..' ||
    containment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containment)
  ) {
    throw new VaultCliError(
      'invalid_path',
      `Vault-relative path "${relativePath}" escapes the selected vault root.`,
    )
  }

  return absolutePath
}

export function generateContractId(prefix: string) {
  return `${prefix}_${generateUlid()}`
}

function generateUlid() {
  return `${encodeTime(Date.now(), 10)}${encodeRandom(16)}`
}

function encodeTime(value: number, length: number) {
  let remaining = value
  let output = ''

  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD_BASE32_ALPHABET[remaining % 32] + output
    remaining = Math.floor(remaining / 32)
  }

  return output
}

function encodeRandom(length: number) {
  return Array.from(randomBytes(length), (byte) =>
    CROCKFORD_BASE32_ALPHABET[byte % 32],
  ).join('')
}
