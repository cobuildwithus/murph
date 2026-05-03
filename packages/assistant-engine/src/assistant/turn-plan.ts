import { resolveAssistantCliAccessContext } from '../assistant-cli-access.js'
import { resolveAssistantOperatorAuthority } from './operator-authority.js'
import { resolveAssistantConversationPolicy } from './conversation-policy.js'
import {
  hasAssistantOnboardingBootstrapInjected,
  resolveAssistantOnboardingBootstrapStateDocIds,
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
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
  const onboardingBootstrapStateDocIds =
    includeOnboardingGuidance
      ? resolveAssistantOnboardingBootstrapStateDocIds({
          actorId: conversationPolicy.audience.actorId ?? resolved.session.binding.actorId,
          channel: conversationPolicy.audience.channel ?? resolved.session.binding.channel,
          identityId: conversationPolicy.audience.identityId ?? resolved.session.binding.identityId,
          threadId: conversationPolicy.audience.threadId ?? resolved.session.binding.threadId,
          threadIsDirect:
            conversationPolicy.audience.threadIsDirect ?? resolved.session.binding.threadIsDirect,
        })
      : []
  const onboardingGuidanceOpen =
    await resolveAssistantOnboardingGuidanceOpenForSession({
      includeOnboardingGuidance,
      onboardingBootstrapStateDocIds,
      sessionTurnCount: resolved.session.turnCount,
      vault: input.vault,
    })
  return {
    allowSensitiveHealthContext: conversationPolicy.allowSensitiveHealthContext,
    cliAccess,
    conversationPolicy,
    onboardingGuidanceOpen,
    firstContactStateDocIds,
    onboardingBootstrapStateDocIds,
    operatorAuthority: resolveAssistantOperatorAuthority(input.operatorAuthority),
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}

export async function resolveAssistantOnboardingGuidanceOpenForSession(input: {
  includeOnboardingGuidance: boolean
  onboardingBootstrapStateDocIds: readonly string[]
  sessionTurnCount: number
  vault: string
}): Promise<boolean> {
  if (!input.includeOnboardingGuidance) {
    return false
  }

  const onboardingBootstrapSeen =
    input.onboardingBootstrapStateDocIds.length > 0
      ? await hasAssistantOnboardingBootstrapInjected({
          docIds: input.onboardingBootstrapStateDocIds,
          vault: input.vault,
        })
      : false

  return resolveAssistantOnboardingGuidanceOpen({
    includeOnboardingGuidance: input.includeOnboardingGuidance,
    onboardingBootstrapMarkerResolvable:
      input.onboardingBootstrapStateDocIds.length > 0,
    onboardingBootstrapSeen,
    sessionTurnCount: input.sessionTurnCount,
  })
}

const ASSISTANT_ONBOARDING_BOOTSTRAP_TURN_LIMIT = 1

export function resolveAssistantOnboardingGuidanceOpen(input: {
  includeOnboardingGuidance: boolean
  onboardingBootstrapMarkerResolvable: boolean
  onboardingBootstrapSeen: boolean
  sessionTurnCount: number
}): boolean {
  if (!input.includeOnboardingGuidance) {
    return false
  }

  if (input.onboardingBootstrapSeen) {
    return false
  }

  const sessionTurnCount =
    Number.isFinite(input.sessionTurnCount) && input.sessionTurnCount > 0
      ? Math.trunc(input.sessionTurnCount)
      : 0

  return sessionTurnCount < ASSISTANT_ONBOARDING_BOOTSTRAP_TURN_LIMIT
}
