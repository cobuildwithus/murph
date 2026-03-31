// Thin daemon-aware wrapper around the local assistant orchestration.
import {
  maybeOpenAssistantConversationViaDaemon,
  maybeSendAssistantMessageViaDaemon,
  maybeUpdateAssistantSessionOptionsViaDaemon,
} from '../assistant-daemon-client.js'
import type { AssistantSession } from '../assistant-cli-contracts.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'

export { CURRENT_CODEX_PROMPT_VERSION } from './local-service.js'
export { buildResolveAssistantSessionInput } from './session-resolution.js'
export {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
export type {
  AssistantChatInput,
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'

export async function openAssistantConversation(
  input: AssistantSessionResolutionFields,
) {
  const remote = await maybeOpenAssistantConversationViaDaemon(input)
  if (remote) {
    return remote
  }

  return openAssistantConversationLocal(input)
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
) {
  const remote = await maybeSendAssistantMessageViaDaemon(input)
  if (remote) {
    return remote
  }

  return sendAssistantMessageLocal(input)
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: Partial<AssistantSession['providerOptions']>
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  const remote = await maybeUpdateAssistantSessionOptionsViaDaemon(input)
  if (remote) {
    return remote
  }

  return updateAssistantSessionOptionsLocal(input)
}
