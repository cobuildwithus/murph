import type { AssistantOperatorDefaults } from '../operator-config.js'
import {
  resolveAssistantProviderDefaults,
} from '../operator-config.js'
import {
  buildAssistantFailoverRoutes,
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import {
  compactAssistantProviderConfigInput,
  mergeAssistantProviderConfigs,
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
} from './provider-config.js'
import { buildResolveAssistantSessionInput } from './session-resolution.js'
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
  const provider = mergeAssistantProviderConfigs(
    defaults,
    { provider: resolved.session.provider, ...resolved.session.providerOptions },
    input,
  ).provider
  const providerDefaults = resolveAssistantProviderDefaults(defaults, provider)
  const providerOptions = serializeAssistantProviderSessionOptions(
    mergeAssistantProviderConfigsForProvider(
      provider,
      providerDefaults ? { provider, ...providerDefaults } : null,
      { provider, ...resolved.session.providerOptions },
      compactAssistantProviderConfigInput({
        provider,
        ...input,
      }),
    ),
  )
  const executionConfig = mergeAssistantProviderConfigsForProvider(
    provider,
    providerDefaults ? { provider, ...providerDefaults } : null,
    compactAssistantProviderConfigInput({ provider, ...input }),
  )
  return normalizeAssistantTurnRoutes(buildAssistantFailoverRoutes({
    backups: input.failoverRoutes ?? defaults?.failoverRoutes ?? null,
    codexCommand: executionConfig.codexCommand,
    defaults,
    provider,
    providerOptions,
  }))
}

export async function resolveAssistantTurnRoutesForMessage(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
): Promise<ResolvedAssistantFailoverRoute[]> {
  const sessionInput = buildResolveAssistantSessionInput(input, defaults)

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

    const provider = sessionInput.provider ?? 'codex-cli'
    const providerDefaults = resolveAssistantProviderDefaults(defaults, provider)
    const providerOptions = serializeAssistantProviderSessionOptions(
      mergeAssistantProviderConfigsForProvider(
        provider,
        providerDefaults ? { provider, ...providerDefaults } : null,
        compactAssistantProviderConfigInput({
          provider,
          ...input,
        }),
      ),
    )

    return buildAssistantFailoverRoutes({
      backups: defaults?.failoverRoutes ?? null,
      codexCommand: null,
      defaults,
      provider,
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
