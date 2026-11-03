import { normalizeNullableString as normalizeNullableText } from '../text/shared.js'

export { normalizeNullableString } from '../text/shared.js'

export function readAssistantEnvString(
  env: NodeJS.ProcessEnv | null | undefined,
  key: string | null | undefined,
): string | null {
  const normalizedKey = normalizeNullableText(key)
  if (!normalizedKey) {
    return null
  }

  const value = env?.[normalizedKey]
  return typeof value === 'string' ? normalizeNullableText(value) : null
}
