import {
  prepareAssistantDirectCliEnv,
} from '../../assistant-cli-access.js'
import {
  executeCodexPrompt,
} from '../../assistant-codex.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
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
    requestFormat: 'flat-prompt',
    supportsModelDiscovery: false,
    supportsNativeResume: true,
    supportsReasoningEffort: true,
    supportsRichUserMessageContent: false,
    supportsToolRuntime: false,
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
        showThinkingTraces: input.showThinkingTraces ?? false,
      }),
      env: prepareAssistantDirectCliEnv(input.env),
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
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: true,
      result: {
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
      },
    }
  },
  resolveLabel(config) {
    return config.oss ? 'Codex OSS' : 'Codex CLI'
  },
  resolveStaticModels() {
    return DEFAULT_CODEX_MODELS
  },
}
