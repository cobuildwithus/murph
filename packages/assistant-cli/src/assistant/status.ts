import { maybeGetAssistantStatusViaDaemon } from '../assistant-daemon-client.js'
import {
  getAssistantStatusLocal,
} from '@murphai/assistant-engine/assistant-status'
import type { AssistantStatusResult } from '@murphai/operator-config/assistant-cli-contracts'

export * from '@murphai/assistant-engine/assistant-status'
export type { AssistantStatusResult } from '@murphai/operator-config/assistant-cli-contracts'

export async function getAssistantStatus(
  input:
    | string
    | {
        limit?: number
        sessionId?: string | null
        vault: string
      },
): Promise<AssistantStatusResult> {
  const normalizedInput = typeof input === 'string' ? { vault: input } : input
  const remote = await maybeGetAssistantStatusViaDaemon({
    limit: normalizedInput.limit,
    sessionId: normalizedInput.sessionId ?? null,
    vault: normalizedInput.vault,
  })
  if (remote) {
    return remote
  }

  return getAssistantStatusLocal(input)
}
