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

export function createAssistantProviderToolProgressEvent(input: {
  id?: string | null
  label?: string | null
  rawEvent: unknown
  safeText?: string | null
  state: 'completed' | 'running'
  text: string
}): AssistantProviderProgressEvent | null {
  const safeLabel = normalizeActivityLabel(input.label)
  if (!safeLabel) {
    return null
  }

  return {
    id: input.id ?? null,
    kind: 'tool',
    label: input.label ?? safeLabel,
    rawEvent: input.rawEvent,
    safeLabel,
    safeText:
      normalizeActivityText(input.safeText) ??
      (input.state === 'running'
        ? `using ${safeLabel}`
        : `finished ${safeLabel}`),
    state: input.state,
    text: input.text,
  }
}

export function summarizeAssistantProviderActivityLabels(
  input: readonly AssistantProviderProgressEvent[],
  maxLabels = 8,
): string[] {
  return mergeAssistantProviderActivityLabels({
    events: input,
    maxLabels,
  })
}

export function mergeAssistantProviderActivityLabels(input: {
  events?: readonly AssistantProviderProgressEvent[] | null
  labels?: readonly string[] | null
  maxLabels?: number
}): string[] {
  const deduped = new Set<string>()
  const maxLabels = input.maxLabels
  const limit =
    typeof maxLabels === 'number' && Number.isFinite(maxLabels)
    ? Math.max(0, Math.trunc(maxLabels))
    : 8

  for (const label of input.labels ?? []) {
    if (deduped.size >= limit) {
      break
    }

    const normalized = normalizeActivityLabel(label)
    if (!normalized) {
      continue
    }

    deduped.add(normalized)
  }

  for (const event of input.events ?? []) {
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

function normalizeActivityText(value: string | null | undefined): string | null {
  return normalizeActivityLabel(value)
}
