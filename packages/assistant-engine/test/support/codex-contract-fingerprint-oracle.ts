import { createHash } from 'node:crypto'

// Test-only identity oracle. Call with either the declarations actually emitted
// by thread/start or the original pre-adapter catalog to model a persisted
// pre-fix thread. No dependency on the production adapter/fingerprint builder.
export function fingerprintThreadDeclarations(input: {
  baseInstructions: string | null
  developerInstructions: string | null
  dynamicTools: unknown
  routeFingerprint: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    ...input,
    developerInstructions: input.developerInstructions?.trim() || null,
  }, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]))
  })).digest('hex')
}
