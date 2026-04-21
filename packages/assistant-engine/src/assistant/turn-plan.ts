import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantCliAccessContext } from '../assistant-cli-access.js'
import { resolveAssistantOperatorAuthority } from './operator-authority.js'
import { resolveAssistantConversationPolicy } from './conversation-policy.js'
import {
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ResolvedAssistantSession,
} from './service-contracts.js'
import { listAssistantSessions } from './store.js'

export async function resolveAssistantTurnSharedPlan(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
): Promise<AssistantTurnSharedPlan> {
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
  const firstTurnCheckInStateDocIds =
    input.includeFirstTurnCheckIn === true
      ? resolveAssistantFirstContactStateDocIds({
          actorId: conversationPolicy.audience.actorId ?? resolved.session.binding.actorId,
          channel: conversationPolicy.audience.channel ?? resolved.session.binding.channel,
          identityId: conversationPolicy.audience.identityId ?? resolved.session.binding.identityId,
          threadId: conversationPolicy.audience.threadId ?? resolved.session.binding.threadId,
          threadIsDirect:
            conversationPolicy.audience.threadIsDirect ?? resolved.session.binding.threadIsDirect,
        })
      : []
  const firstTurnCheckInEligible =
    input.includeFirstTurnCheckIn === true &&
    (await isAssistantFirstSessionForOnboarding({
      session: resolved.session,
      vault: input.vault,
    }))
  return {
    allowSensitiveHealthContext: conversationPolicy.allowSensitiveHealthContext,
    cliAccess,
    conversationPolicy,
    firstTurnCheckInEligible,
    firstTurnCheckInStateDocIds,
    operatorAuthority: resolveAssistantOperatorAuthority(input.operatorAuthority),
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}

export async function isAssistantFirstSessionForOnboarding(input: {
  session: AssistantSession
  vault: string
}): Promise<boolean> {
  const sessions = await listAssistantSessions(input.vault)
  if (sessions.length === 0) {
    return true
  }

  return sessions.every((session) =>
    session.sessionId === input.session.sessionId ||
    compareAssistantSessionCreationOrder(session, input.session) >= 0,
  )
}

function compareAssistantSessionCreationOrder(
  left: AssistantSession,
  right: AssistantSession,
): number {
  return left.createdAt.localeCompare(right.createdAt)
}
