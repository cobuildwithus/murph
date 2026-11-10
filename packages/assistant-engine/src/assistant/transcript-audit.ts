import type { AssistantTranscriptEntryInput } from './store/types.js'
import { sanitizeAssistantPortableStateString } from './redaction.js'
import { normalizeNullableString } from './shared.js'

const MAX_AUDIT_TEXT_LENGTH = 900
export const ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX =
  'murph.assistant-runtime-audit.v1 '

export function buildAssistantProviderTranscriptAuditEntries(input: {
  at?: string | null
  error?: unknown
  routeLabel?: string | null
}): AssistantTranscriptEntryInput[] {
  if (input.error === undefined || input.error === null) {
    return []
  }

  const message = sanitizeAuditText(errorToMessage(input.error))
  if (!message) {
    return []
  }

  const code = normalizeNullableString(readNestedString(input.error, ['code']))
  const routeLabel = sanitizeAuditText(input.routeLabel ?? null)
  const routePrefix = routeLabel ? `Provider route ${routeLabel}` : 'Provider route'
  const createdAt = normalizeNullableString(input.at)
  return [{
    kind: 'error',
    text: markAssistantAuditText(
      `${routePrefix} failed${code ? ` (${code})` : ''}: ${sentence(message)}`,
    ),
    ...(createdAt ? { createdAt } : {}),
  }]
}

function sanitizeAuditText(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  return sanitizeAssistantPortableStateString(value, MAX_AUDIT_TEXT_LENGTH)
}

function trimAuditText(value: string): string {
  return sanitizeAssistantPortableStateString(value, MAX_AUDIT_TEXT_LENGTH)
}

function markAssistantAuditText(value: string): string {
  return `${ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX}${trimAuditText(value)}`
}

function sentence(value: string): string {
  return /[.!?]\s*$/.test(value) ? value : `${value}.`
}

function errorToMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return readNestedString(error, ['message', 'errorMessage'])
}

function readNestedString(
  value: unknown,
  keys: readonly string[],
  state: {
    depth: number
    visited: Set<object>
  } = {
    depth: 0,
    visited: new Set<object>(),
  },
): string | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  if (state.visited.has(record) || state.depth > 4) {
    return null
  }
  state.visited.add(record)

  for (const key of keys) {
    const direct = readString(record, key)
    if (direct) {
      return direct
    }
  }

  for (const key of ['cause', 'error', 'details', 'context', 'data', 'response']) {
    const nested = readNestedString(record[key], keys, {
      depth: state.depth + 1,
      visited: state.visited,
    })
    if (nested) {
      return nested
    }
  }

  return null
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
