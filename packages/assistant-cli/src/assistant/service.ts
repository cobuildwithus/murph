// Thin daemon-aware wrapper around the assistant-engine local assistant orchestration.
import {
  maybeOpenAssistantConversationViaDaemon,
  maybeSendAssistantMessageViaDaemon,
  maybeUpdateAssistantSessionOptionsViaDaemon,
} from '../assistant-daemon-client.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
  type AssistantMessageInput,
  type AssistantSessionResolutionFields,
} from '@murphai/assistant-engine/assistant-service'

export * from '@murphai/assistant-engine/assistant-service'

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
