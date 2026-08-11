import { string as zString } from 'zod/v4'

const offsetIsoTimestampSchema = zString().datetime({ offset: true })

export function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function isGatewayIsoTimestamp(value: string): boolean {
  return offsetIsoTimestampSchema.safeParse(value).success
}

export function parseGatewayTimestampMs(value: string): number {
  if (!isGatewayIsoTimestamp(value)) {
    return Number.NaN
  }

  return Date.parse(value)
}

export const isoTimestampSchema = zString()
  .min(1)
  .refine(isGatewayIsoTimestamp, {
    message: 'Expected an ISO timestamp with an explicit offset.',
  })
