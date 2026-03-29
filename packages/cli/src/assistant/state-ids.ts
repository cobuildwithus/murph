import { VaultCliError } from '../vault-cli-errors.js'
import { normalizeNullableString } from './shared.js'

const ASSISTANT_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,191}$/u

export function assertAssistantSessionId(value: string | null | undefined): string {
  return assertAssistantOpaqueId('session', value)
}

export function assertAssistantTurnId(value: string | null | undefined): string {
  return assertAssistantOpaqueId('turn', value)
}

export function assertAssistantOutboxIntentId(
  value: string | null | undefined,
): string {
  return assertAssistantOpaqueId('outbox intent', value)
}

export function assertAssistantTranscriptDistillationId(
  value: string | null | undefined,
): string {
  return assertAssistantOpaqueId('transcript distillation', value)
}

export function isValidAssistantOpaqueId(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeNullableString(value)
  return normalized !== null && ASSISTANT_OPAQUE_ID_PATTERN.test(normalized)
}

function assertAssistantOpaqueId(
  kind: string,
  value: string | null | undefined,
): string {
  const normalized = normalizeNullableString(value)
  if (normalized && ASSISTANT_OPAQUE_ID_PATTERN.test(normalized)) {
    return normalized
  }

  throw new VaultCliError(
    'ASSISTANT_INVALID_RUNTIME_ID',
    `Assistant ${kind} identifiers must be opaque runtime ids without path separators or traversal segments.`,
    {
      kind,
      value: typeof value === 'string' ? value : null,
    },
  )
}
