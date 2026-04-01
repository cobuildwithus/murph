import { resolveAssistantCliAccessContext } from '../assistant-cli-access.js'
import { updateAssistantOnboardingSummary } from './onboarding.js'
import { resolveAssistantOperatorAuthority } from './operator-authority.js'
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
    message: {
      deliverResponse: input.deliverResponse,
      deliveryReplyToMessageId: input.deliveryReplyToMessageId,
      deliveryTarget: input.deliveryTarget,
      operatorAuthority: input.operatorAuthority,
      sourceThreadId: input.sourceThreadId,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
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
    operatorAuthority: resolveAssistantOperatorAuthority(input.operatorAuthority),
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}
