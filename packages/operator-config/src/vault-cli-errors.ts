export type VaultCliErrorDetails = Record<string, unknown> | undefined

export class VaultCliError extends Error {
  readonly code: string
  readonly context: VaultCliErrorDetails
  override readonly message: string

  constructor(code: string, message: string, details?: VaultCliErrorDetails) {
    super(message)
    this.code = code
    this.name = 'VaultCliError'
    this.message = message
    this.context = details
  }
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

  return details.length > 0
    ? `${error.code} (${details.join(', ')})`
    : error.code
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
