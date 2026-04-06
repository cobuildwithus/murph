import {
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type { ResolvedAssistantFailoverRoute } from './failover.js'
import {
  compactAssistantProviderConfigInput,
} from './provider-config.js'
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

export type AssistantTurnRouteOverride = Pick<
  AssistantMessageInput,
  | 'apiKeyEnv'
  | 'approvalPolicy'
  | 'baseUrl'
  | 'codexCommand'
  | 'headers'
  | 'model'
  | 'oss'
  | 'profile'
  | 'provider'
  | 'providerName'
  | 'reasoningEffort'
  | 'sandbox'
>

export function resolveAssistantTurnRoutes(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): ResolvedAssistantFailoverRoute[] {
  return resolveAssistantExecutionPlan({
    backups: input.failoverRoutes,
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
): Promise<ResolvedAssistantFailoverRoute[]> {
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
      backups: input.failoverRoutes,
      boundaryDefaultTarget,
      defaults,
      override: compactAssistantProviderConfigInput(input),
    }).routes
  }
}

export function selectAssistantTurnRouteOverride(
  routes: readonly ResolvedAssistantFailoverRoute[],
  predicate: (route: ResolvedAssistantFailoverRoute) => boolean,
): {
  providerOverride: AssistantTurnRouteOverride | null
  route: ResolvedAssistantFailoverRoute | null
} {
  const selectedRoute = routes.find(predicate) ?? null
  if (!selectedRoute) {
    return {
      providerOverride: null,
      route: null,
    }
  }

  const primaryRoute = routes[0] ?? null
  if (primaryRoute === selectedRoute) {
    return {
      providerOverride: null,
      route: selectedRoute,
    }
  }

  return {
    providerOverride: {
      apiKeyEnv: selectedRoute.providerOptions.apiKeyEnv ?? null,
      approvalPolicy: selectedRoute.providerOptions.approvalPolicy ?? null,
      baseUrl: selectedRoute.providerOptions.baseUrl ?? null,
      codexCommand: selectedRoute.codexCommand ?? undefined,
      headers: selectedRoute.providerOptions.headers ?? null,
      model: selectedRoute.providerOptions.model ?? null,
      oss: selectedRoute.providerOptions.oss,
      profile: selectedRoute.providerOptions.profile ?? null,
      provider: selectedRoute.provider,
      providerName: selectedRoute.providerOptions.providerName ?? null,
      reasoningEffort: selectedRoute.providerOptions.reasoningEffort ?? null,
      sandbox: selectedRoute.providerOptions.sandbox ?? null,
    },
    route: selectedRoute,
  }
}
