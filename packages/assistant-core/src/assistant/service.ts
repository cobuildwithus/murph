// Local-only assistant orchestration surface for headless consumers.
import type { AssistantSession } from '../assistant-cli-contracts.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import {
  openAssistantConversationLocal,
  queueAssistantFirstContactWelcomeLocal,
  sendAssistantFirstContactWelcomeLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'
export {
  openAssistantConversationLocal,
  queueAssistantFirstContactWelcomeLocal,
  sendAssistantFirstContactWelcomeLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
export type {
  AssistantChatInput,
  AssistantExecutionContext,
  AssistantMessageInput,
  AssistantHostedExecutionContext,
  AssistantSessionResolutionFields,
} from './service-contracts.js'

export async function openAssistantConversation(
  input: AssistantSessionResolutionFields,
) {
  return openAssistantConversationLocal(input)
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
) {
  return sendAssistantMessageLocal(input)
}

export async function queueAssistantFirstContactWelcome(
  input: import('./first-contact-welcome-delivery.js').AssistantFirstContactWelcomeInput,
) {
  return queueAssistantFirstContactWelcomeLocal(input)
}

export async function sendAssistantFirstContactWelcome(
  input: import('./first-contact-welcome-delivery.js').AssistantFirstContactWelcomeInput,
) {
  return sendAssistantFirstContactWelcomeLocal(input)
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: Partial<AssistantSession['providerOptions']>
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  return updateAssistantSessionOptionsLocal(input)
}
