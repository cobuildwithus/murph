import { createHash } from 'node:crypto'

import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'

import {
  normalizeAssistantExecutionContext,
  resolveAssistantExecutionDefaultTarget,
  resolveAssistantExecutionOperatorDefaults,
} from './execution-context.js'
import type {
  AssistantExecutionContext,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import { resolveAssistantSessionForMessage } from './session-resolution.js'
import { normalizeNullableString } from './shared.js'
import { appendAssistantConversationContextEntry } from './store.js'

const ASSISTANT_CONVERSATION_CONTEXT_TRANSCRIPT_PREFIX =
  '[murph.assistant-conversation-context.v1] '
const ASSISTANT_CONVERSATION_CONTEXT_KEY_HASH_LENGTH = 32
const ASSISTANT_CONVERSATION_CONTEXT_KEY_HASH_PATTERN = /^[a-f0-9]{32}$/u

export interface AssistantConversationContextInput
  extends AssistantSessionResolutionFields {
  context: string
  executionContext?: AssistantExecutionContext | null
  idempotencyKey: string
  occurredAt: string
}

export interface AssistantConversationContextResult {
  appended: boolean
  session: Awaited<ReturnType<typeof resolveAssistantSessionForMessage>>['session']
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
  return normalizeNullableString(text.slice(markerEnd + 1))
}

export async function recordAssistantConversationContextLocal(
  input: AssistantConversationContextInput,
): Promise<AssistantConversationContextResult> {
  if (input.threadIsDirect !== true) {
    throw new TypeError('Assistant conversation context requires a direct thread.')
  }
  const occurredAtMs = Date.parse(input.occurredAt)
  if (!Number.isFinite(occurredAtMs)) {
    throw new TypeError('Assistant conversation context occurredAt must be an ISO timestamp.')
  }
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const boundaryDefaultTarget = resolveAssistantExecutionDefaultTarget({
    executionContext,
    fallbackTarget: createDefaultLocalAssistantModelTarget(),
  })
  const defaults = resolveAssistantExecutionOperatorDefaults({
    defaults: await resolveAssistantOperatorDefaults(),
    executionContext,
  })
  const resolved = await resolveAssistantSessionForMessage({
    boundaryDefaultTarget,
    defaults,
    message: {
      ...input,
      deliverResponse: false,
      executionContext,
      prompt: input.context,
    },
  })
  if (resolved.session.binding.threadIsDirect !== true) {
    throw new TypeError('Assistant conversation context resolved outside a direct thread.')
  }
  return await appendAssistantConversationContextEntry({
    createdAt: new Date(occurredAtMs).toISOString(),
    sessionId: resolved.session.sessionId,
    text: buildAssistantConversationContextTranscriptText(input),
    vault: input.vault,
  })
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
