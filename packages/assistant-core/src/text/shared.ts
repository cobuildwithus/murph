export function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeNullableString(error.message) ?? String(error)
  }

  return String(error)
}

export function formatStructuredErrorMessage(error: unknown): string {
  const message = redactSensitivePathSegments(errorMessage(error))
  const lines: string[] = []
  const details = readStructuredErrorDetails(error)

  if (details.errors.length > 0) {
    lines.push('details:')
    lines.push(...details.errors.map((entry) => `- ${redactSensitivePathSegments(entry)}`))
  }

  if (lines.length === 0) {
    return message
  }

  return `${message}\n${lines.join('\n')}`
}

function readStructuredErrorDetails(error: unknown): {
  errors: string[]
} {
  const detailRecords = [] as Array<Record<string, unknown>>

  if (error && typeof error === 'object') {
    if ('details' in error && isPlainRecord(error.details)) {
      detailRecords.push(error.details)
    }

    if ('context' in error && isPlainRecord(error.context)) {
      detailRecords.push(error.context)
    }
  }

  return {
    errors: detailRecords.flatMap((record) => stringArrayFromUnknown(record.errors)),
  }
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const normalized = normalizeNullableString(
      typeof entry === 'string' ? entry : null,
    )
    return normalized ? [normalized] : []
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function redactSensitivePathSegments(value: string): string {
  return value
    .replace(/\/Users\/[^/\s]+/gu, '<HOME_DIR>')
    .replace(/\/home\/[^/\s]+/gu, '<HOME_DIR>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gu, '<HOME_DIR>')
}
