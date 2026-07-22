import { createHash } from 'node:crypto'

import {
  HOSTED_EXECUTION_PHONE_CALL_RESULT_CONTEXT_MAX_UTF8_BYTES,
} from '@murphai/hosted-execution'

import { normalizeNullableString } from './shared.js'
import { appendAssistantConversationContextEntry } from './store.js'

const ASSISTANT_CONVERSATION_CONTEXT_TRANSCRIPT_PREFIX =
  '[murph.assistant-conversation-context.v1] '
const ASSISTANT_CONVERSATION_CONTEXT_KEY_HASH_LENGTH = 32
const ASSISTANT_CONVERSATION_CONTEXT_KEY_HASH_PATTERN = /^[a-f0-9]{32}$/u

export interface AssistantConversationContextInput {
  context: string
  idempotencyKey: string
  occurredAt: string
  sessionId: string
  vault: string
}

export interface AssistantConversationContextResult {
  appended: boolean
  session: Awaited<ReturnType<typeof appendAssistantConversationContextEntry>>['session']
}

export function buildAssistantConversationContextTranscriptText(input: {
  context: string
  idempotencyKey: string
}): string {
  const context = normalizeRequiredConversationContextValue(
    input.context,
    'assistant conversation context',
  )
  const idempotencyKey = normalizeRequiredConversationContextValue(
    input.idempotencyKey,
    'assistant conversation context idempotency key',
  )
  const keyHash = createHash('sha256')
    .update(idempotencyKey)
    .digest('hex')
    .slice(0, ASSISTANT_CONVERSATION_CONTEXT_KEY_HASH_LENGTH)
  return `${ASSISTANT_CONVERSATION_CONTEXT_TRANSCRIPT_PREFIX}${keyHash}\n${context}`
}

export function readAssistantConversationContextTranscriptText(
  text: string,
): string | null {
  if (!text.startsWith(ASSISTANT_CONVERSATION_CONTEXT_TRANSCRIPT_PREFIX)) {
    return null
  }
  const markerEnd = text.indexOf('\n')
  if (markerEnd < 0) {
    return null
  }
  const keyHash = text
    .slice(ASSISTANT_CONVERSATION_CONTEXT_TRANSCRIPT_PREFIX.length, markerEnd)
    .trim()
  if (!ASSISTANT_CONVERSATION_CONTEXT_KEY_HASH_PATTERN.test(keyHash)) {
    return null
  }
  const context = normalizeNullableString(text.slice(markerEnd + 1))
  return context
    ? truncateUtf8(context, HOSTED_EXECUTION_PHONE_CALL_RESULT_CONTEXT_MAX_UTF8_BYTES)
    : null
}

export async function recordAssistantConversationContextLocal(
  input: AssistantConversationContextInput,
): Promise<AssistantConversationContextResult> {
  const occurredAtMs = Date.parse(input.occurredAt)
  if (!Number.isFinite(occurredAtMs)) {
    throw new TypeError('Assistant conversation context occurredAt must be an ISO timestamp.')
  }
  return await appendAssistantConversationContextEntry({
    createdAt: new Date(occurredAtMs).toISOString(),
    sessionId: input.sessionId,
    text: buildAssistantConversationContextTranscriptText(input),
    vault: input.vault,
  })
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value
  }
  const codePoints = [...value]
  let low = 0
  let high = codePoints.length
  let best = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = codePoints.slice(0, middle).join('')
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

function normalizeRequiredConversationContextValue(
  value: string,
  label: string,
): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new TypeError(`${label} is required.`)
  }
  return normalized
}
