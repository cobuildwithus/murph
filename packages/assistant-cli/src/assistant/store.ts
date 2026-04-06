import {
  maybeGetAssistantSessionViaDaemon,
  maybeListAssistantSessionsViaDaemon,
} from '../assistant-daemon-client.js'
import {
  getAssistantSessionLocal,
  listAssistantSessionsLocal,
} from '@murphai/assistant-engine/assistant-store'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

export * from '@murphai/assistant-engine/assistant-store'
export type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

export async function listAssistantSessions(
  vault: string,
): Promise<AssistantSession[]> {
  const remote = await maybeListAssistantSessionsViaDaemon({ vault })
  if (remote !== null) {
    return remote
  }

  return listAssistantSessionsLocal(vault)
}

export async function getAssistantSession(
  vault: string,
  sessionId: string,
): Promise<AssistantSession> {
  const remote = await maybeGetAssistantSessionViaDaemon({
    sessionId,
    vault,
  })
  if (remote) {
    return remote
  }

  return getAssistantSessionLocal(vault, sessionId)
}
