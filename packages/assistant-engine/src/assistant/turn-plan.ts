import { resolveAssistantCliAccessContext } from '../assistant-cli-access.js'
import { resolveAssistantOperatorAuthority } from './operator-authority.js'
import { resolveAssistantConversationPolicy } from './conversation-policy.js'
import {
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
import { isAssistantOnboardingOpen } from './onboarding-state.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ResolvedAssistantSession,
} from './service-contracts.js'

export async function resolveAssistantTurnSharedPlan(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
): Promise<AssistantTurnSharedPlan> {
  const includeOnboardingGuidance = input.includeEarlySessionOnboarding === true
  const cliAccess = resolveAssistantCliAccessContext()
  const requestedWorkingDirectory = input.workingDirectory ?? input.vault
  const conversationPolicy = resolveAssistantConversationPolicy({
    message: {
      conversation: input.conversation,
      deliverResponse: input.deliverResponse,
      deliveryReplyToMessageId: input.deliveryReplyToMessageId,
      deliveryTarget: input.deliveryTarget,
      operatorAuthority: input.operatorAuthority,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
    },
    session: resolved.session,
  })
  const firstContactStateDocIds =
    includeOnboardingGuidance
      ? resolveAssistantFirstContactStateDocIds({
          actorId: conversationPolicy.audience.actorId ?? resolved.session.binding.actorId,
          channel: conversationPolicy.audience.channel ?? resolved.session.binding.channel,
          identityId: conversationPolicy.audience.identityId ?? resolved.session.binding.identityId,
          threadId: conversationPolicy.audience.threadId ?? resolved.session.binding.threadId,
          threadIsDirect:
            conversationPolicy.audience.threadIsDirect ?? resolved.session.binding.threadIsDirect,
        })
      : []
  const onboardingGuidanceOpen =
    await resolveAssistantOnboardingGuidanceOpenForVault({
      includeOnboardingGuidance,
      vault: input.vault,
    })
  return {
    allowSensitiveHealthContext: conversationPolicy.allowSensitiveHealthContext,
    cliAccess,
    conversationPolicy,
    onboardingGuidanceOpen,
    firstContactStateDocIds,
    operatorAuthority: resolveAssistantOperatorAuthority(input.operatorAuthority),
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}

export async function resolveAssistantOnboardingGuidanceOpenForVault(input: {
  includeOnboardingGuidance: boolean
  vault: string
}): Promise<boolean> {
  if (!input.includeOnboardingGuidance) {
    return false
  }

  return resolveAssistantOnboardingGuidanceOpen({
    includeOnboardingGuidance: input.includeOnboardingGuidance,
    onboardingOpen: await isAssistantOnboardingOpen(input.vault),
  })
}

export function resolveAssistantOnboardingGuidanceOpen(input: {
  includeOnboardingGuidance: boolean
  onboardingOpen: boolean
}): boolean {
  if (!input.includeOnboardingGuidance) {
    return false
  }

  return input.onboardingOpen
}
