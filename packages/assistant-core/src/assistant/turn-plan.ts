import { resolveAssistantCliAccessContext } from '../assistant-cli-access.js'
import { resolveAssistantOperatorAuthority } from './operator-authority.js'
import { resolveAssistantConversationPolicy } from './conversation-policy.js'
import {
  hasAssistantSeenFirstContact,
  resolveAssistantFirstContactStateDocId,
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
  const firstTurnCheckInStateDocId =
    input.includeFirstTurnCheckIn === true
      ? resolveAssistantFirstContactStateDocId({
          audience: conversationPolicy.audience,
          binding: resolved.session.binding,
        })
      : null
  const firstTurnCheckInEligible =
    input.includeFirstTurnCheckIn === true &&
    !(await hasAssistantSeenFirstContact({
      docId: firstTurnCheckInStateDocId,
      vault: input.vault,
    }))
  return {
    allowSensitiveHealthContext: conversationPolicy.allowSensitiveHealthContext,
    cliAccess,
    conversationPolicy,
    firstTurnCheckInEligible,
    firstTurnCheckInStateDocId,
    operatorAuthority: resolveAssistantOperatorAuthority(input.operatorAuthority),
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}
