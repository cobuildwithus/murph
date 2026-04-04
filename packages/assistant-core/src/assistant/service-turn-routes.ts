import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '../assistant-backend.js'
import type { AssistantOperatorDefaults } from '../operator-config.js'
import {
  buildAssistantFailoverRoutes,
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import {
  compactAssistantProviderConfigInput,
  serializeAssistantProviderSessionOptions,
} from './provider-config.js'
import {
  buildResolveAssistantSessionInput,
  resolveAssistantSessionTarget,
} from './session-resolution.js'
import type {
  AssistantMessageInput,
  ResolvedAssistantSession,
} from './service-contracts.js'
import {
  isAssistantSessionNotFoundError,
  resolveAssistantSession,
} from './store.js'

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
  const target = resolvePrimaryAssistantTurnTarget({
    input,
    sessionTarget: resolved.session.target,
  })
  const executionConfig = assistantBackendTargetToProviderConfigInput(target)
  const providerOptions = serializeAssistantProviderSessionOptions(executionConfig)
  return normalizeAssistantTurnRoutes(buildAssistantFailoverRoutes({
    backups: input.failoverRoutes ?? defaults?.failoverRoutes ?? null,
    codexCommand: executionConfig.codexCommand,
    defaults,
    provider: target.adapter,
    providerOptions,
  }))
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

    const target = resolveAssistantSessionTarget({
      boundaryDefaultTarget,
      defaults,
      input,
    })
    const providerOptions = serializeAssistantProviderSessionOptions(
      assistantBackendTargetToProviderConfigInput(target),
    )

    return buildAssistantFailoverRoutes({
      backups: defaults?.failoverRoutes ?? null,
      codexCommand:
        target.adapter === 'codex-cli' ? target.codexCommand ?? null : null,
      defaults,
      provider: target.adapter,
      providerOptions,
    })
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
      provider: selectedRoute.provider ?? 'codex-cli',
      providerName: selectedRoute.providerOptions.providerName ?? null,
      reasoningEffort: selectedRoute.providerOptions.reasoningEffort ?? null,
      sandbox: selectedRoute.providerOptions.sandbox ?? null,
    },
    route: selectedRoute,
  }
}

function normalizeAssistantTurnRoutes(
  routes: readonly ResolvedAssistantFailoverRoute[],
): ResolvedAssistantFailoverRoute[] {
  return routes.map((route) => ({
    ...route,
    providerOptions: serializeAssistantProviderSessionOptions(route.providerOptions),
  }))
}

function resolvePrimaryAssistantTurnTarget(input: {
  input: AssistantMessageInput
  sessionTarget: AssistantModelTarget
}): AssistantModelTarget {
  const overrideConfig = compactAssistantProviderConfigInput(input.input)
  return (
    createAssistantModelTarget({
      ...assistantBackendTargetToProviderConfigInput(input.sessionTarget),
      ...(overrideConfig ?? {}),
    }) ?? input.sessionTarget
  )
}
