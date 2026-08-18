const FAILED_ACTION_STATUSES = new Set(['error', 'errored', 'failed'])

export function isCodexActionStructurallyFailed(input: {
  item: Record<string, unknown> | null
  normalizedExitCode?: number | null
}): boolean {
  if (
    input.normalizedExitCode !== undefined
    && input.normalizedExitCode !== null
    && input.normalizedExitCode !== 0
  ) {
    return true
  }

  const item = input.item
  if (hasNonZeroStructuralInteger(item?.exitCode, item?.exit_code)) {
    return true
  }
  if (item?.success === false) {
    return true
  }

  const status = typeof item?.status === 'string'
    ? item.status.trim().toLowerCase()
    : null
  return status !== null && FAILED_ACTION_STATUSES.has(status)
}

function hasNonZeroStructuralInteger(...values: unknown[]): boolean {
  for (const value of values) {
    if (
      typeof value === 'number'
      && Number.isSafeInteger(value)
      && value !== 0
    ) {
      return true
    }
    if (typeof value === 'string' && /^-?\d+$/u.test(value.trim())) {
      const parsed = Number(value.trim())
      if (Number.isSafeInteger(parsed) && parsed !== 0) {
        return true
      }
    }
  }
  return false
}
