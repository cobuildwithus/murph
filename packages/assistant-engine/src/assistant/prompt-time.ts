import {
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
  toLocalDayKey,
} from '@murphai/contracts'
import { loadVault } from '@murphai/core'

export interface AssistantPromptTimeContext {
  canonicalTimeZoneAvailable?: boolean
  currentInstant?: string
  currentLocalDate: string
  currentTimeZone: string
}

export interface ResolvedAssistantPromptTimeContext
  extends AssistantPromptTimeContext {
  canonicalTimeZoneAvailable: boolean
  currentInstant: string
}

export async function resolveAssistantPromptTimeContext(
  vaultRoot: string,
): Promise<ResolvedAssistantPromptTimeContext> {
  const fallbackTimeZone = 'UTC'
  const currentInstant = new Date().toISOString()
  let currentTimeZone = fallbackTimeZone
  let canonicalTimeZoneAvailable = false

  try {
    const loadedVault = await loadVault({
      vaultRoot,
    })
    const canonicalTimeZone = normalizeIanaTimeZone(loadedVault.metadata.timezone)
    if (canonicalTimeZone) {
      currentTimeZone = canonicalTimeZone
      canonicalTimeZoneAvailable = true
    }
  } catch {
    // Prompt time context is best-effort and should not block the turn.
  }

  return {
    canonicalTimeZoneAvailable,
    currentInstant,
    currentLocalDate: toLocalDayKey(new Date(currentInstant), currentTimeZone),
    currentTimeZone,
  }
}

export function formatAssistantPromptInstant(
  value: string,
  timeZone: string,
): string {
  const normalizedTimeZone = normalizeIanaTimeZone(timeZone) ?? 'UTC'
  const parts = formatTimeZoneDateTimeParts(value, normalizedTimeZone)
  const utcInstant = new Date(value).toISOString()

  return `${parts.dayKey} ${padTwo(parts.hour)}:${padTwo(parts.minute)}:${padTwo(parts.second)} [UTC ${utcInstant}]`
}

export function formatAssistantPromptUtcInstant(value: string): string {
  return new Date(value).toISOString()
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0')
}
