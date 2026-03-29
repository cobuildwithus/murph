import { generateText } from 'ai'
import { VaultCliError } from '../../vault-cli-errors.js'
import { resolveAssistantLanguageModel } from '../../model-harness.js'
import {
  createCatalogModel,
  DEFAULT_OPENAI_COMPATIBLE_MODEL_CAPABILITIES,
  normalizeDiscoveredModelIds,
} from './catalog.js'
import {
  buildAssistantProviderLabel,
  buildAssistantProviderMessages,
  buildOpenAICompatibleDiscoveryHeaders,
  ensureTrailingSlash,
  extractOpenAICompatibleAssistantProviderUsage,
} from './helpers.js'
import { normalizeNullableString } from '../shared.js'
import { resolveAssistantModelSpecFromProviderConfig } from '../provider-config.js'
import type { AssistantProviderDefinition } from './types.js'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500

export const openAiCompatibleProviderDefinition: AssistantProviderDefinition = {
  capabilities: {
    supportsDirectCliExecution: false,
    supportsModelDiscovery: true,
    supportsReasoningEffort: false,
  },
  traits: {
    resumeKeyMode: 'none',
    sessionMode: 'stateless',
    transcriptContextMode: 'local-transcript',
    workspaceMode: 'none',
  },
  async discoverModels(input) {
    const providerConfig = input.config
    if (providerConfig.provider !== 'openai-compatible') {
      return {
        models: [],
        status: 'unsupported',
        message: 'OpenAI-compatible model discovery requires an OpenAI-compatible provider config.',
      }
    }

    const normalizedBaseUrl = normalizeNullableString(providerConfig.baseUrl)
    if (!normalizedBaseUrl) {
      return {
        models: [],
        status: 'unsupported',
        message: 'OpenAI-compatible model discovery requires a base URL.',
      }
    }

    try {
      const modelsUrl = new URL('models', ensureTrailingSlash(normalizedBaseUrl))
      const timeoutSignal =
        typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
          ? AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS)
          : undefined
      const response = await fetch(modelsUrl, {
        headers: buildOpenAICompatibleDiscoveryHeaders({
          config: providerConfig,
          env: input.env,
        }),
        signal: timeoutSignal,
      })

      if (response.status === 401 || response.status === 403) {
        return {
          models: [],
          status: 'unauthorized',
          message: 'The endpoint rejected the configured credentials while discovering models.',
        }
      }

      if (!response.ok) {
        return {
          models: [],
          status: 'unreachable',
          message: `The endpoint returned ${response.status} while discovering models.`,
        }
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: unknown }>
      }
      const models = normalizeDiscoveredModelIds(
        (payload.data ?? []).map((entry) =>
          typeof entry?.id === 'string' ? entry.id : null,
        ),
      ).map((model) =>
        createCatalogModel({
          id: model,
          description: `Discovered from ${buildAssistantProviderLabel(providerConfig)}.`,
          source: 'discovered',
          capabilities: DEFAULT_OPENAI_COMPATIBLE_MODEL_CAPABILITIES,
        }),
      )

      return {
        models,
        status: 'ok',
        message: null,
      }
    } catch (error) {
      return {
        models: [],
        status: 'unreachable',
        message:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Unable to reach the configured endpoint while discovering models.',
      }
    }
  },
  async executeTurn(input) {
    const providerConfig = input.providerConfig
    if (providerConfig.provider !== 'openai-compatible') {
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_UNSUPPORTED',
        'OpenAI-compatible execution requires an OpenAI-compatible provider config.',
      )
    }

    const languageModelSpec = resolveAssistantModelSpecFromProviderConfig(
      providerConfig,
      {
        ...process.env,
        ...(input.env ?? {}),
      },
    )
    if (!languageModelSpec) {
      if (!providerConfig.baseUrl) {
        throw new VaultCliError(
          'ASSISTANT_BASE_URL_REQUIRED',
          'The openai-compatible assistant provider requires a base URL.',
        )
      }
      throw new VaultCliError(
        'ASSISTANT_MODEL_REQUIRED',
        'The openai-compatible assistant provider requires a model id.',
      )
    }

    const result = await generateText({
      abortSignal: input.abortSignal,
      maxRetries: OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES,
      messages: buildAssistantProviderMessages(input),
      model: resolveAssistantLanguageModel(languageModelSpec),
      system: normalizeNullableString(input.systemPrompt) ?? undefined,
      timeout: OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS,
    })

    return {
      provider: providerConfig.provider,
      providerSessionId: null,
      response: result.text,
      stderr: '',
      stdout: '',
      rawEvents: [],
      usage: extractOpenAICompatibleAssistantProviderUsage({
        providerConfig,
        result,
      }),
    }
  },
  resolveLabel(config) {
    return buildAssistantProviderLabel(config)
  },
  resolveStaticModels() {
    return []
  },
}
