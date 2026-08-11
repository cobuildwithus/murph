import type * as z from '@murphai/contracts/zod-runtime'
import {
  assistantPersistedSessionSchema,
  type AssistantSession,
  type AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeCodexResumeState,
} from '@murphai/operator-config/assistant/codex-resume-state'

type AssistantCodexResumeInput = {
  codexResume?: AssistantSessionResumeState | null
  resumeState?: AssistantSessionResumeState | null
}

export function readAssistantCodexResume(
  input: AssistantCodexResumeInput | AssistantSession | null | undefined,
): AssistantSessionResumeState | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  if ('codexResume' in input) {
    return normalizeCodexResumeState(input.codexResume)
  }

  if ('resumeState' in input) {
    return normalizeCodexResumeState(input.resumeState)
  }

  return null
}

export function serializeAssistantConversationForPersistence(
  session: AssistantSession,
): z.infer<typeof assistantPersistedSessionSchema> {
  const target = session.codexTarget ?? session.target
  if (!target) {
    throw new TypeError('Assistant conversation Codex target is required.')
  }

  return assistantPersistedSessionSchema.parse({
    schema: 'murph.assistant-conversation.v2',
    conversationId: session.conversationId ?? session.sessionId,
    alias: session.alias,
    binding: session.binding,
    codexTarget: target,
    codexResume: normalizeCodexResumeState(session.codexResume ?? session.resumeState),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastTurnAt: session.lastTurnAt,
    turnCount: session.turnCount,
  })
}
