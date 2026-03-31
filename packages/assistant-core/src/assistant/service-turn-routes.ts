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
import type {
  AssistantMessageInput,
  ResolvedAssistantSession,
} from './service-contracts.js'
import { clampVaultBoundAssistantSandbox } from './service-result.js'

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
        sandbox: clampVaultBoundAssistantSandbox(input.sandbox),
      }),
    ),
  )
  const executionConfig = mergeAssistantProviderConfigsForProvider(
    provider,
    providerDefaults ? { provider, ...providerDefaults } : null,
    compactAssistantProviderConfigInput({ provider, ...input }),
  )
  return buildAssistantFailoverRoutes({
    backups: input.failoverRoutes ?? defaults?.failoverRoutes ?? null,
    codexCommand: executionConfig.codexCommand,
    defaults,
    provider,
    providerOptions,
  }).map((route) => ({
    ...route,
    providerOptions: serializeAssistantProviderSessionOptions({
      ...route.providerOptions,
      sandbox: clampVaultBoundAssistantSandbox(route.providerOptions.sandbox),
    }),
  }))
}
