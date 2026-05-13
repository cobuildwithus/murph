import {
  assistantAskResultSchema,
  parseAssistantSessionRecord,
  type AssistantAskResult,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  serializeAssistantConversationForPersistence,
} from './conversation-persistence.js'
import { redactAssistantSessionForDisplay } from './redaction.js'

export function serializeAssistantSessionForResult(
  session: AssistantSession,
): AssistantSession {
  return redactAssistantSessionForDisplay(
    parseAssistantSessionRecord(
      serializeAssistantConversationForPersistence(session),
    ),
  )
}

export function normalizeAssistantAskResultForReturn(
  result: Omit<AssistantAskResult, 'session'> & {
    session: AssistantSession
  },
): AssistantAskResult {
  return assistantAskResultSchema.parse({
    ...result,
    session: serializeAssistantSessionForResult(result.session),
  })
}
