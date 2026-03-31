import type { AssistantChatProvider } from '../../assistant-cli-contracts.js'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfigInput,
} from '../provider-config.js'
import { codexCliProviderDefinition } from './codex-cli.js'
import { createCatalogModel } from './catalog.js'
import { openAiCompatibleProviderDefinition } from './openai-compatible.js'
import type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
  AssistantModelDiscoveryResult,
  AssistantProviderCapabilities,
  AssistantProviderDefinition,
  AssistantProviderTraits,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
} from './types.js'

const ASSISTANT_PROVIDER_DEFINITIONS: Readonly<Record<
  AssistantChatProvider,
  AssistantProviderDefinition
>> = Object.freeze({
  'codex-cli': codexCliProviderDefinition,
  'openai-compatible': openAiCompatibleProviderDefinition,
})

export function listAssistantProviderDefinitions(): readonly AssistantProviderDefinition[] {
  return Object.values(ASSISTANT_PROVIDER_DEFINITIONS)
}

export function listAssistantProviders(): readonly AssistantChatProvider[] {
  return Object.keys(ASSISTANT_PROVIDER_DEFINITIONS) as AssistantChatProvider[]
}

export function getAssistantProviderDefinition(
  provider: AssistantChatProvider,
): AssistantProviderDefinition {
  return ASSISTANT_PROVIDER_DEFINITIONS[provider]
}

function resolveAssistantProviderDefinition(
  provider: AssistantChatProvider,
): AssistantProviderDefinition {
  return getAssistantProviderDefinition(provider)
}

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return {
    ...resolveAssistantProviderDefinition(provider).capabilities,
  }
}

export function resolveAssistantProviderTraits(
  provider: AssistantChatProvider,
): AssistantProviderTraits {
  return {
    ...resolveAssistantProviderDefinition(provider).traits,
  }
}

export function resolveAssistantProviderLabel(
  input: AssistantProviderConfigInput | null | undefined,
): string {
  const normalized = normalizeAssistantProviderConfig(input)
  const definition = resolveAssistantProviderDefinition(normalized.provider)
  return definition.resolveLabel(normalized)
}

export async function discoverAssistantProviderModels(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  headers?: Record<string, string> | null
  provider: AssistantChatProvider
  providerName?: string | null
}): Promise<AssistantModelDiscoveryResult> {
  const normalized = normalizeAssistantProviderConfig(input)
  return resolveAssistantProviderDefinition(normalized.provider).discoverModels({
    config: normalized,
    env: input.env,
  })
}

export function resolveAssistantProviderStaticModels(
  input: AssistantProviderConfigInput | null | undefined,
): readonly AssistantCatalogModel[] {
  const normalized = normalizeAssistantProviderConfig(input)
  return resolveAssistantProviderDefinition(normalized.provider).resolveStaticModels(
    normalized,
  )
}

export async function executeAssistantProviderTurnWithDefinition(
  input: AssistantProviderTurnExecutionInput,
): Promise<AssistantProviderTurnExecutionResult> {
  return await resolveAssistantProviderDefinition(input.providerConfig.provider).executeTurn(
    input,
  )
}

export async function executeAssistantProviderTurn(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnExecutionResult> {
  const providerConfig = normalizeAssistantProviderConfig(input)

  return await executeAssistantProviderTurnWithDefinition({
    abortSignal: input.abortSignal,
    configOverrides: input.configOverrides,
    continuityContext: input.continuityContext,
    conversationMessages: input.conversationMessages,
    env: input.env,
    onEvent: input.onEvent,
    onTraceEvent: input.onTraceEvent,
    prompt: input.prompt,
    providerConfig,
    resumeProviderSessionId: input.resumeProviderSessionId,
    sessionContext: input.sessionContext,
    showThinkingTraces: input.showThinkingTraces,
    systemPrompt: input.systemPrompt,
    toolRuntime: input.toolRuntime,
    userPrompt: input.userPrompt,
    workingDirectory: input.workingDirectory,
  })
}

export function shouldUseAssistantLocalTranscriptContext(
  provider: AssistantChatProvider,
): boolean {
  return (
    resolveAssistantProviderDefinition(provider).traits.transcriptContextMode ===
    'local-transcript'
  )
}

export { createCatalogModel }
export { ASSISTANT_PROVIDER_DEFINITIONS }
export type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
  AssistantModelDiscoveryResult,
  AssistantProviderCapabilities,
  AssistantProviderDefinition,
  AssistantProviderTraits,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
} from './types.js'
