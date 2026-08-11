import {
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
  resolveSystemTimeZone,
  toLocalDayKey,
} from '@murphai/contracts'
import { loadVault } from '@murphai/core'

export interface AssistantPromptTimeContext {
  currentLocalDate: string
  currentTimeZone: string
}

export async function resolveAssistantPromptTimeContext(
  vaultRoot: string,
): Promise<AssistantPromptTimeContext> {
  const fallbackTimeZone = resolveSystemTimeZone()
  let currentTimeZone = fallbackTimeZone

  try {
    const loadedVault = await loadVault({
      vaultRoot,
    })
    currentTimeZone =
      normalizeIanaTimeZone(loadedVault.metadata.timezone) ?? fallbackTimeZone
  } catch {
    // Prompt time context is best-effort and should not block the turn.
  }

  return {
    currentLocalDate: toLocalDayKey(new Date(), currentTimeZone),
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

function padTwo(value: number): string {
  return String(value).padStart(2, '0')
}
