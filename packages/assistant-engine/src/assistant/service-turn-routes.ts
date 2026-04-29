import {
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type { ResolvedAssistantProviderRoute } from './provider-route.js'
import {
  compactAssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import {
  buildResolveAssistantSessionInput,
} from './session-resolution.js'
import type {
  AssistantMessageInput,
  ResolvedAssistantSession,
} from './service-contracts.js'
import {
  isAssistantSessionNotFoundError,
  resolveAssistantSession,
} from './store.js'
import { resolveAssistantExecutionPlan } from './execution-plan.js'

export function resolveAssistantTurnRoutes(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): ResolvedAssistantProviderRoute[] {
  return resolveAssistantExecutionPlan({
    defaults,
    override: compactAssistantProviderConfigInput(input),
    resumeState: resolved.session.resumeState,
    sessionTarget: resolved.session.target,
  }).routes
}

export async function resolveAssistantTurnRoutesForMessage(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  boundaryDefaultTarget: AssistantModelTarget | null = null,
): Promise<ResolvedAssistantProviderRoute[]> {
  const sessionInput = buildResolveAssistantSessionInput(
    input,
    defaults,
    boundaryDefaultTarget,
  )

  try {
    const resolved = await resolveAssistantSession({
      ...sessionInput,
      createIfMissing: false,
    })
    return resolveAssistantTurnRoutes(input, defaults, resolved)
  } catch (error) {
    if (!isAssistantSessionNotFoundError(error)) {
      throw error
    }

    return resolveAssistantExecutionPlan({
      boundaryDefaultTarget,
      defaults,
      override: compactAssistantProviderConfigInput(input),
    }).routes
  }
}
