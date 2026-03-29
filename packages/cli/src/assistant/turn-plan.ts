import { resolveAssistantCliAccessContext } from '../assistant-cli-access.js'
import { updateAssistantOnboardingSummary } from './onboarding.js'
import { resolveAssistantConversationPolicy } from './conversation-policy.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ResolvedAssistantSession,
} from './service-contracts.js'

export async function resolveAssistantTurnSharedPlan(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
): Promise<AssistantTurnSharedPlan> {
  const cliAccess = resolveAssistantCliAccessContext()
  const requestedWorkingDirectory = input.workingDirectory ?? input.vault
  const conversationPolicy = resolveAssistantConversationPolicy({
    conversation: input.conversation,
    message: {
      deliverResponse: input.deliverResponse,
      deliveryReplyToMessageId: input.deliveryReplyToMessageId,
      deliveryTarget: input.deliveryTarget,
      maxSessionAgeMs: input.maxSessionAgeMs,
      sourceThreadId: input.sourceThreadId,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
      turnTrigger: input.turnTrigger,
    },
    session: resolved.session,
  })
  return {
    allowSensitiveHealthContext: conversationPolicy.allowSensitiveHealthContext,
    cliAccess,
    conversationPolicy,
    onboardingSummary:
      input.enableFirstTurnOnboarding === true
        ? await updateAssistantOnboardingSummary({
            prompt: input.prompt,
            vault: input.vault,
          })
        : null,
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}
