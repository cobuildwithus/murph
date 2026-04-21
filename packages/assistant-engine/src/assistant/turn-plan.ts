import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
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
  const firstContactStateDocIds =
    input.includeEarlySessionOnboarding === true
      ? resolveAssistantFirstContactStateDocIds({
          actorId: conversationPolicy.audience.actorId ?? resolved.session.binding.actorId,
          channel: conversationPolicy.audience.channel ?? resolved.session.binding.channel,
          identityId: conversationPolicy.audience.identityId ?? resolved.session.binding.identityId,
          threadId: conversationPolicy.audience.threadId ?? resolved.session.binding.threadId,
          threadIsDirect:
            conversationPolicy.audience.threadIsDirect ?? resolved.session.binding.threadIsDirect,
        })
      : []
  const earlySessionOnboardingEligible =
    await resolveAssistantEarlySessionOnboardingEligible({
      firstContactStateDocIds,
      includeEarlySessionOnboarding: input.includeEarlySessionOnboarding === true,
      session: resolved.session,
      vault: input.vault,
    })
  return {
    allowSensitiveHealthContext: conversationPolicy.allowSensitiveHealthContext,
    cliAccess,
    conversationPolicy,
    earlySessionOnboardingEligible,
    firstContactStateDocIds,
    operatorAuthority: resolveAssistantOperatorAuthority(input.operatorAuthority),
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}

export async function resolveAssistantEarlySessionOnboardingEligible(input: {
  firstContactStateDocIds: readonly string[]
  includeEarlySessionOnboarding: boolean
  session: AssistantSession
  vault: string
}): Promise<boolean> {
  if (!input.includeEarlySessionOnboarding || input.session.turnCount !== 0) {
    return false
  }

  const firstContactAlreadySeen =
    input.firstContactStateDocIds.length > 0
      ? await hasAssistantSeenFirstContact({
          docIds: input.firstContactStateDocIds,
          vault: input.vault,
        })
      : false
  const isFirstSessionForOnboarding = firstContactAlreadySeen
    ? false
    : await isAssistantFirstSessionForOnboarding({
        session: input.session,
        vault: input.vault,
      })

  return resolveAssistantEarlySessionOnboardingEligibility({
    firstContactAlreadySeen,
    includeEarlySessionOnboarding: input.includeEarlySessionOnboarding,
    isFirstSessionForOnboarding,
    sessionTurnCount: input.session.turnCount,
  })
}

export function resolveAssistantEarlySessionOnboardingEligibility(input: {
  firstContactAlreadySeen: boolean
  includeEarlySessionOnboarding: boolean
  isFirstSessionForOnboarding: boolean
  sessionTurnCount: number
}): boolean {
  return (
    input.includeEarlySessionOnboarding &&
    input.sessionTurnCount === 0 &&
    !input.firstContactAlreadySeen &&
    input.isFirstSessionForOnboarding
  )
}

export function isAssistantSessionFreshForOnboarding(
  session: Pick<AssistantSession, 'turnCount'>,
): boolean {
  return session.turnCount === 0
}

export async function isAssistantFirstSessionForOnboarding(input: {
  session: AssistantSession
  vault: string
}): Promise<boolean> {
  const sessions = await listAssistantSessions(input.vault)
  if (sessions.length === 0) {
    return true
  }

  // Equal timestamps stay onboarding-eligible so imported/bootstrap-created sessions do not
  // lose onboarding based on an arbitrary secondary tie-break.
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
