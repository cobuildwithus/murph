import { resolveAssistantCliAccessContext } from '../assistant-cli-access.js'
import { resolveAssistantOperatorAuthority } from './operator-authority.js'
import { resolveAssistantConversationPolicy } from './conversation-policy.js'
import {
  hasAssistantSeenFirstContact,
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
    !(await hasAssistantSeenFirstContact({
      docIds: firstTurnCheckInStateDocIds,
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
