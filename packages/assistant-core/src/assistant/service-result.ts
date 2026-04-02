import { assistantAskResultSchema, type AssistantAskResult, type AssistantSession } from '../assistant-cli-contracts.js'
import { normalizeAssistantSessionSnapshot } from './provider-state.js'
import { redactAssistantSessionForDisplay } from './redaction.js'

export function serializeAssistantSessionForResult(
  session: AssistantSession,
): AssistantSession {
  return redactAssistantSessionForDisplay(normalizeAssistantSessionSnapshot(session))
}

export function normalizeAssistantAskResultForReturn<T extends AssistantAskResult>(
  result: T,
): T {
  return assistantAskResultSchema.parse({
    ...result,
    session: serializeAssistantSessionForResult(result.session),
  }) as T
}
