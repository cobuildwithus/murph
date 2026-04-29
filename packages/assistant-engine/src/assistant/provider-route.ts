import { createHash } from 'node:crypto'
import {
  type AssistantChatProvider,
  type AssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  isAssistantCodexTargetConfig,
  resolveAssistantChatProviderFromConfig,
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import { resolveAssistantProviderLabel } from './provider-registry.js'
import { normalizeNullableString } from './shared.js'

export interface ResolvedAssistantProviderRoute {
  codexCommand: string | null
  label: string
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
  routeId: string
}

export function buildAssistantPrimaryProviderRoute(
  providerConfig: AssistantProviderConfig,
): ResolvedAssistantProviderRoute {
  const provider = resolveAssistantChatProviderFromConfig(providerConfig)
  const providerOptions = serializeAssistantProviderSessionOptions(providerConfig)
  const codexCommand = isAssistantCodexTargetConfig(providerConfig)
    ? providerConfig.target.codexCommand
    : null

  return {
    routeId: hashAssistantProviderRoute({
      codexCommand,
      provider,
      providerOptions,
    }),
    label: buildAssistantProviderRouteLabel(providerConfig),
    provider,
    providerOptions,
    codexCommand,
  }
}

function buildAssistantProviderRouteLabel(
  providerConfig: AssistantProviderConfig,
): string {
  const providerLabel = resolveAssistantProviderLabel(providerConfig)

  const parts = [
    'primary',
    providerLabel,
    normalizeNullableString(providerConfig.target.model),
    normalizeNullableString(
      isAssistantCodexTargetConfig(providerConfig)
        ? providerConfig.target.profile
        : null,
    ),
  ].filter((value): value is string => value !== null)

  return parts.join(':') || resolveAssistantChatProviderFromConfig(providerConfig)
}

function hashAssistantProviderRoute(input: {
  codexCommand: string | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify(buildAssistantProviderRouteIdentity(input)),
    )
    .digest('hex')
    .slice(0, 16)
}

function buildAssistantProviderRouteIdentity(input: {
  codexCommand: string | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
}) {
  return {
    provider: input.provider,
    executionDriver: input.providerOptions.executionDriver,
    model: input.providerOptions.model,
    modelProvider: input.providerOptions.modelProvider ?? null,
    reasoningEffort: input.providerOptions.reasoningEffort,
    sandbox: input.providerOptions.sandbox,
    approvalPolicy: input.providerOptions.approvalPolicy,
    profile: input.providerOptions.profile,
    oss: input.providerOptions.oss,
    codexHome: input.providerOptions.codexHome ?? null,
    codexCommand: input.codexCommand,
    resumeKind: input.providerOptions.resumeKind,
  }
}
