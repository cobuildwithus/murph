import { normalizeNullableString } from '../shared.js'

export function compactAssistantRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  )
}

export function readAssistantRecord(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function readAssistantArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function readAssistantStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => normalizeNullableString(typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => entry !== null)
}

export function readAssistantNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(readAssistantNumber)
    .filter((entry): entry is number => entry !== null)
}

export function readAssistantNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function firstAssistantString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized =
      typeof value === 'string' ? normalizeNullableString(value) : null
    if (normalized) {
      return normalized
    }
  }

  return null
}

export function formatAssistantIsoDate(value: Date): string {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatAssistantUsDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${Number(month)}/${Number(day)}/${year}`
}

export function readAssistantHostname(url: string): string | null {
  try {
    return normalizeNullableString(new URL(url).hostname.toLowerCase())
  } catch {
    return null
  }
}
