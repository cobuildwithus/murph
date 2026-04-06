import { normalizeNullableString } from './shared.js'

export function isAssistantUserFacingChannel(channel: string | null): boolean {
  const normalized = normalizeNullableString(channel)?.toLowerCase() ?? null
  return normalized !== null && normalized !== 'local' && normalized !== 'null'
}
