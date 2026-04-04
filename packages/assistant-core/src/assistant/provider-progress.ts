export const assistantProviderProgressKindValues = [
  'command',
  'file',
  'message',
  'plan',
  'reasoning',
  'search',
  'status',
  'tool',
] as const

export type AssistantProviderProgressKind =
  (typeof assistantProviderProgressKindValues)[number]

export interface AssistantProviderProgressEvent {
  id: string | null
  kind: AssistantProviderProgressKind
  label?: string | null
  rawEvent: unknown
  safeLabel?: string | null
  safeText?: string | null
  state: 'completed' | 'running'
  text: string
}

export function summarizeAssistantProviderActivityLabels(
  input: readonly AssistantProviderProgressEvent[],
  maxLabels = 8,
): string[] {
  const deduped = new Set<string>()
  const limit = Number.isFinite(maxLabels)
    ? Math.max(0, Math.trunc(maxLabels))
    : 8

  for (const event of input) {
    if (deduped.size >= limit) {
      break
    }

    if (event.kind !== 'command' && event.kind !== 'tool') {
      continue
    }

    const label = normalizeActivityLabel(event.safeLabel ?? event.label ?? null)
    if (!label) {
      continue
    }

    deduped.add(label)
  }

  return [...deduped]
}

function normalizeActivityLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length > 0 ? normalized : null
}
