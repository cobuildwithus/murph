export type VaultCliErrorDetails = Record<string, unknown> | undefined

const MAX_REPAIR_FIELDS = 12
const MAX_REPAIR_PATH_LENGTH = 160
const MAX_REPAIR_CODE_LENGTH = 64
const MAX_REPAIR_MESSAGE_LENGTH = 240
const MAX_REPAIR_EXPECTED_LENGTH = 160
const MAX_REPAIR_HINT_LENGTH = 320
const MAX_REPAIR_STAGE_LENGTH = 64

export interface VaultCliRepairFieldInput {
  path: string | readonly PropertyKey[]
  code?: string | undefined
  message: string
  expected?: string | undefined
  missing?: boolean | undefined
}

export interface VaultCliRepairInput {
  fields?: readonly VaultCliRepairFieldInput[] | undefined
  hint?: string | undefined
  stage?: string | undefined
}

export interface VaultCliRepairField {
  path: string
  code?: string | undefined
  message: string
  expected?: string | undefined
  missing?: boolean | undefined
}

export interface VaultCliRepair {
  fields: readonly VaultCliRepairField[]
  hint?: string | undefined
  stage?: string | undefined
}

/**
 * Builds the only model-facing detail carried by {@link VaultCliError}.
 *
 * Callers must supply value-free field guidance. This helper bounds and
 * normalizes that explicit allowlist; it deliberately never inspects arbitrary
 * error context, causes, submitted payloads, or provider responses.
 */
export function createVaultCliRepair(input: VaultCliRepairInput): VaultCliRepair {
  const fields = (input.fields ?? [])
    .slice(0, MAX_REPAIR_FIELDS)
    .map(normalizeRepairField)
  const omittedFieldCount = Math.max(
    0,
    (input.fields?.length ?? 0) - fields.length,
  )

  if (omittedFieldCount > 0) {
    fields.push({
      path: '$',
      code: 'issues_omitted',
      message: `${omittedFieldCount} additional validation ${omittedFieldCount === 1 ? 'issue was' : 'issues were'} omitted.`,
    })
  }

  const hint = normalizeBoundedText(input.hint, MAX_REPAIR_HINT_LENGTH)
  const stage = normalizeRepairToken(input.stage, MAX_REPAIR_STAGE_LENGTH)

  return {
    fields,
    ...(hint === null ? {} : { hint }),
    ...(stage === null ? {} : { stage }),
  }
}

export class VaultCliError extends Error {
  readonly code: string
  readonly context: VaultCliErrorDetails
  readonly repair: VaultCliRepair | undefined
  override readonly message: string

  constructor(
    code: string,
    message: string,
    details?: VaultCliErrorDetails,
    repair?: VaultCliRepairInput,
  ) {
    super(message)
    this.code = code
    this.name = 'VaultCliError'
    this.message = message
    this.context = details
    this.repair = repair ? createVaultCliRepair(repair) : undefined
  }
}

function normalizeRepairField(input: VaultCliRepairFieldInput): VaultCliRepairField {
  const code = normalizeRepairToken(input.code, MAX_REPAIR_CODE_LENGTH)
  const expected = normalizeBoundedText(
    input.expected,
    MAX_REPAIR_EXPECTED_LENGTH,
  )

  return {
    path: normalizeRepairPath(input.path),
    ...(code === null ? {} : { code }),
    message:
      normalizeBoundedText(input.message, MAX_REPAIR_MESSAGE_LENGTH) ??
      'This field is invalid.',
    ...(expected === null ? {} : { expected }),
    ...(input.missing === true ? { missing: true } : {}),
  }
}

function normalizeRepairPath(path: VaultCliRepairFieldInput['path']): string {
  const normalized =
    typeof path === 'string'
      ? normalizeRepairPathString(path)
      : Array.from(path, normalizeRepairPathSegment).join('.')

  return truncateCodePoints(
    normalized.length > 0 ? normalized : '$',
    MAX_REPAIR_PATH_LENGTH,
  )
}

function normalizeRepairPathSegment(segment: PropertyKey): string {
  if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0) {
    return String(segment)
  }

  if (typeof segment !== 'string') {
    return '<field>'
  }

  const trimmed = segment.trim()
  return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(trimmed)
    ? trimmed
    : '<field>'
}

function normalizeRepairPathString(path: string): string {
  const trimmed = path.trim()
  if (
    trimmed === '$' ||
    /^(?:[A-Za-z_][A-Za-z0-9_-]*|\d+)(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|\d+))*$/u.test(
      trimmed,
    )
  ) {
    return trimmed
  }

  return '<field>'
}

function normalizeRepairToken(
  value: string | undefined,
  maxLength: number,
): string | null {
  const normalized = normalizeBoundedText(value, maxLength)
  if (normalized === null || !/^[A-Za-z0-9_.-]+$/u.test(normalized)) {
    return null
  }
  return normalized
}

function normalizeBoundedText(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (normalized.length === 0) {
    return null
  }

  return truncateCodePoints(normalized, maxLength)
}

function truncateCodePoints(value: string, maxLength: number): string {
  const codePoints = Array.from(value)
  if (codePoints.length <= maxLength) {
    return value
  }

  return `${codePoints.slice(0, Math.max(0, maxLength - 1)).join('')}…`
}

/**
 * Secret-safe one-line summary of a provider failure, for tool results and logs.
 *
 * Provider runtimes attach `status`, `failureStage`, `timedOut`, `elapsedMs`,
 * and `transportErrorName` to their errors, but callers that collapse a failure
 * into a short operator-facing string used to discard all of it, leaving a 401,
 * a 429, a DNS failure, and a timeout indistinguishable. Only these bounded
 * fields are read, so response bodies and credentials cannot reach the summary.
 */
export function describeVaultCliFailure(error: unknown): string | null {
  if (!(error instanceof VaultCliError)) {
    return null
  }

  const context = error.context ?? {}
  const details: string[] = []
  const status = readFiniteNumber(context.status)
  const failureStage = readNonEmptyString(context.failureStage)
  // A status already implies the http stage; the stage only adds information
  // when the request failed before any response arrived.
  if (status !== null) {
    details.push(`http ${status}`)
  } else if (failureStage !== null) {
    details.push(`stage=${failureStage}`)
  }
  if (context.timedOut === true) {
    details.push('timed out')
  }
  const transportErrorName = readNonEmptyString(context.transportErrorName)
  if (transportErrorName !== null) {
    details.push(transportErrorName)
  }
  const elapsedMs = readFiniteNumber(context.elapsedMs)
  if (elapsedMs !== null) {
    details.push(`${Math.round(elapsedMs)}ms`)
  }
  // Provider-reported detail. The code names the condition the status alone
  // cannot ("http 404" does not distinguish a missing voice from a bad route),
  // and the request id is what the provider's support asks for. Runtimes are
  // responsible for bounding these before attaching them.
  const providerErrorCode = readNonEmptyString(context.providerErrorCode)
  if (providerErrorCode !== null) {
    details.push(providerErrorCode)
  }
  const providerRequestId = readNonEmptyString(context.providerRequestId)
  if (providerRequestId !== null) {
    details.push(`request ${providerRequestId}`)
  }

  const summary = details.length > 0
    ? `${error.code} (${details.join(', ')})`
    : error.code
  const providerErrorMessage = readNonEmptyString(context.providerErrorMessage)
  return providerErrorMessage === null
    ? summary
    : `${summary}: ${providerErrorMessage}`
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
