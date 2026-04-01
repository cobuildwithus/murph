import {
  executeCodexPrompt,
} from '../../assistant-codex.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import {
  DEFAULT_CODEX_MODELS,
} from './catalog.js'
import {
  extractCodexAssistantProviderUsage,
  mergeCodexConfigOverrides,
  resolveAssistantProviderPrompt,
} from './helpers.js'
import type { AssistantProviderDefinition } from './types.js'

export const codexCliProviderDefinition: AssistantProviderDefinition = {
  capabilities: {
    supportsBoundTools: false,
    supportsHostToolRuntime: false,
    supportsDirectCliExecution: true,
    supportsModelDiscovery: false,
    supportsReasoningEffort: true,
  },
  traits: {
    resumeKeyMode: 'provider-session-id',
    sessionMode: 'stateful',
    transcriptContextMode: 'provider-session',
    workspaceMode: 'direct-cli',
  },
  async discoverModels() {
    return {
      models: [],
      status: 'unsupported',
      message: 'Codex model discovery is not available from the local CLI adapter.',
    }
  },
  async executeTurn(input) {
    const providerConfig = input.providerConfig
    if (providerConfig.provider !== 'codex-cli') {
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_UNSUPPORTED',
        'Codex CLI execution requires a Codex provider config.',
      )
    }

    const result = await executeCodexPrompt({
      abortSignal: input.abortSignal,
      approvalPolicy: providerConfig.approvalPolicy ?? undefined,
      codexCommand: providerConfig.codexCommand ?? undefined,
      configOverrides: mergeCodexConfigOverrides({
        configOverrides: input.configOverrides,
        showThinkingTraces: input.showThinkingTraces ?? false,
      }),
      env: input.env,
      model: providerConfig.model ?? undefined,
      onProgress: input.onEvent ?? undefined,
      onTraceEvent: input.onTraceEvent,
      oss: providerConfig.oss,
      profile: providerConfig.profile ?? undefined,
      prompt: resolveAssistantProviderPrompt(input),
      reasoningEffort: providerConfig.reasoningEffort ?? undefined,
      resumeSessionId: input.resumeProviderSessionId,
      sandbox: providerConfig.sandbox ?? undefined,
      workingDirectory: input.workingDirectory,
    })

    return {
      provider: providerConfig.provider,
      providerSessionId: result.sessionId,
      response: result.finalMessage,
      stderr: result.stderr,
      stdout: result.stdout,
      rawEvents: result.jsonEvents,
      usage: extractCodexAssistantProviderUsage({
        providerConfig,
        rawEvents: result.jsonEvents,
      }),
    }
  },
  resolveLabel(config) {
    return config.oss ? 'Codex OSS' : 'Codex CLI'
  },
  resolveStaticModels() {
    return DEFAULT_CODEX_MODELS
  },
}
