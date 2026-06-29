import {
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type { CodexThreadIdentity } from './codex-thread-route.js'
import {
  compactAssistantProviderConfigInput,
  type AssistantProviderConfigInput,
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
import {
  automationAssistantTargetOverrideToProviderConfigInput,
} from './automation/target-override.js'

export function resolveAssistantTurnRoute(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): CodexThreadIdentity {
  return resolveAssistantExecutionPlan({
    defaults,
    override: resolveAssistantTurnRouteOverride(input),
    sessionTarget: resolved.session.target,
  }).codexRoute
}

export async function resolveAssistantTurnRouteForMessage(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  boundaryDefaultTarget: AssistantModelTarget | null = null,
): Promise<CodexThreadIdentity> {
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
    return resolveAssistantTurnRoute(input, defaults, resolved)
  } catch (error) {
    if (!isAssistantSessionNotFoundError(error)) {
      throw error
    }

    return resolveAssistantExecutionPlan({
      boundaryDefaultTarget,
      defaults,
      override: resolveAssistantTurnRouteOverride(input),
    }).codexRoute
  }
}

function resolveAssistantTurnRouteOverride(
  input: AssistantMessageInput,
): AssistantProviderConfigInput | null {
  const messageOverride = compactAssistantProviderConfigInput(input)
  const automationOverride =
    automationAssistantTargetOverrideToProviderConfigInput(
      input.assistantTargetOverride,
    )

  return compactAssistantProviderConfigInput({
    ...(messageOverride ?? {}),
    ...(automationOverride ?? {}),
  })
}
