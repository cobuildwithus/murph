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
