import path from 'node:path'
import {
  HOSTED_RUNTIME_PROCESS_ENV_MARKER,
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import { resolveAssistantOperatorAuthority } from './operator-authority.js'
import { resolveAssistantConversationPolicy } from './conversation-policy.js'
import {
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { isAssistantOnboardingOpen } from './onboarding-state.js'
import { normalizeNullableString } from './shared.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ResolvedAssistantSession,
} from './service-contracts.js'

export const HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY = '/proc/self/cwd'

export async function resolveAssistantTurnSharedPlan(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
): Promise<AssistantTurnSharedPlan> {
  const includeOnboardingGuidance = input.includeEarlySessionOnboarding === true
  const turnEnvironment = input.turnEnvironment ?? {}
  const cliAccess = resolveAssistantCliAccessContext(turnEnvironment.env)
  const requestedWorkingDirectory = resolveAssistantRequestedWorkingDirectory(
    input,
    {
      currentWorkingDirectory: turnEnvironment.currentWorkingDirectory,
      env: turnEnvironment.env,
    },
  )
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
    cliAccess,
    conversationPolicy,
    onboardingGuidanceOpen,
    firstContactStateDocIds,
    operatorAuthority: resolveAssistantOperatorAuthority(input.operatorAuthority),
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    requestedWorkingDirectory,
  }
}

export function resolveAssistantRequestedWorkingDirectory(
  input: AssistantMessageInput,
  options: {
    currentWorkingDirectory?: string | null
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
  } = {},
): string {
  const explicitWorkingDirectory = normalizeNullableString(input.workingDirectory)
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const currentWorkingDirectory =
    options.currentWorkingDirectory === undefined
      ? process.cwd()
      : options.currentWorkingDirectory
  const explicitWorkingDirectoryMatchesVault =
    explicitWorkingDirectory !== null
    && path.resolve(explicitWorkingDirectory) === path.resolve(input.vault)

  if (explicitWorkingDirectory && !explicitWorkingDirectoryMatchesVault) {
    return explicitWorkingDirectory
  }

  if (
    executionContext.hosted &&
    env[HOSTED_RUNTIME_PROCESS_ENV_MARKER]?.trim() === '1' &&
    platform === 'linux' &&
    currentWorkingDirectory !== null &&
    path.resolve(input.vault) === path.resolve(currentWorkingDirectory)
  ) {
    return HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY
  }

  return explicitWorkingDirectory ?? input.vault
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
