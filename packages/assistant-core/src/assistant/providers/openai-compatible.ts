import { generateText, stepCountIs } from 'ai'
import {
  resolveAssistantLanguageModel,
  type AssistantAiSdkToolEvent,
} from '../../model-harness.js'
import { VaultCliError } from '../../vault-cli-errors.js'
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
  extractOpenAICompatibleProviderSessionId,
} from './helpers.js'
import type { AssistantProviderTraceUpdate } from '../provider-traces.js'
import { normalizeNullableString } from '../shared.js'
import {
  resolveAssistantModelSpecFromProviderConfig,
  shouldUseAssistantOpenAIResponsesApi,
} from '../provider-config.js'
import type { AssistantProviderDefinition } from './types.js'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2
const OPENAI_COMPATIBLE_PROVIDER_MAX_TOOL_STEPS = 8
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500

export const openAiCompatibleProviderDefinition: AssistantProviderDefinition = {
  capabilities: {
    supportsModelDiscovery: true,
    supportsNativeResume: true,
    supportsReasoningEffort: false,
    supportsRichUserMessageContent: true,
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

    const usesOpenAIResponsesApi =
      shouldUseAssistantOpenAIResponsesApi(providerConfig)
    const toolEvents: unknown[] = []
    let executedToolCount = 0
    const tools = input.toolRuntime?.toolCatalog?.createAiSdkTools('apply', {
      onToolEvent: (event) => {
        if (event.kind === 'started' && event.mode === 'apply') {
          executedToolCount += 1
        }

        const rawEvent = createOpenAiCompatibleToolRawEvent({
          event,
          sequence: toolEvents.length + 1,
        })
        toolEvents.push(rawEvent)

        const updates = buildOpenAiCompatibleToolTraceUpdates(event)
        if (updates.length > 0) {
          input.onTraceEvent?.({
            providerSessionId: null,
            rawEvent,
            updates,
          })
        }
      },
    }) ?? null

    try {
      const messages = buildAssistantProviderMessages(input)
      const reasoningEffort = normalizeNullableString(providerConfig.reasoningEffort)
      const result = await generateText({
        abortSignal: input.abortSignal,
        maxRetries: tools ? 0 : OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES,
        messages,
        model: resolveAssistantLanguageModel(languageModelSpec),
        ...(tools
          ? {
              stopWhen: stepCountIs(OPENAI_COMPATIBLE_PROVIDER_MAX_TOOL_STEPS),
              tools,
            }
          : {}),
        ...(usesOpenAIResponsesApi
          ? {
              providerOptions: {
                openai: {
                  store: false,
                  ...(reasoningEffort
                    ? {
                        reasoningEffort,
                      }
                    : {}),
                  ...(normalizeNullableString(input.resumeProviderSessionId)
                    ? {
                        previousResponseId: normalizeNullableString(
                          input.resumeProviderSessionId,
                        )!,
                      }
                    : {}),
                },
              },
            }
          : {}),
        system: normalizeNullableString(input.systemPrompt) ?? undefined,
        timeout: OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS,
      })

      return {
        metadata: {
          executedToolCount,
          rawToolEvents: toolEvents,
        },
        ok: true,
        result: {
          provider: providerConfig.provider,
          providerSessionId:
            usesOpenAIResponsesApi
              ? (
                  extractOpenAICompatibleProviderSessionId(result) ??
                  normalizeNullableString(input.resumeProviderSessionId)
                )
              : null,
          response: result.text,
          stderr: '',
          stdout: '',
          rawEvents: toolEvents,
          usage: extractOpenAICompatibleAssistantProviderUsage({
            providerConfig,
            result,
          }),
        },
      }
    } catch (error) {
      return {
        error,
        metadata: {
          executedToolCount,
          rawToolEvents: toolEvents,
        },
        ok: false,
      }
    }
  },
  resolveLabel(config) {
    return buildAssistantProviderLabel(config)
  },
  resolveStaticModels() {
    return []
  },
}

function createOpenAiCompatibleToolRawEvent(input: {
  event: AssistantAiSdkToolEvent
  sequence: number
}): Record<string, unknown> {
  const rawEvent: Record<string, unknown> = {
    type: `assistant.tool.${input.event.kind}`,
    sequence: input.sequence,
    mode: input.event.mode,
    tool: input.event.tool,
  }

  if (input.event.kind === 'started' || input.event.kind === 'failed') {
    rawEvent.input = input.event.input
  }

  if (input.event.kind === 'failed') {
    rawEvent.errorCode = input.event.errorCode ?? null
    rawEvent.errorMessage = input.event.errorMessage ?? null
  }

  return rawEvent
}

function buildOpenAiCompatibleToolTraceUpdates(
  event: AssistantAiSdkToolEvent,
): AssistantProviderTraceUpdate[] {
  switch (event.kind) {
    case 'started':
      return [
        {
          kind: 'status',
          text: `Running ${event.tool}…`,
        },
      ]
    case 'previewed':
      return [
        {
          kind: 'status',
          text: `Planned ${event.tool}.`,
        },
      ]
    case 'succeeded':
      return [
        {
          kind: 'status',
          text: `Finished ${event.tool}.`,
        },
      ]
    case 'failed':
      return [
        {
          kind: 'error',
          text: `${event.tool} failed: ${event.errorMessage ?? 'Tool execution failed.'}`,
        },
      ]
  }
}
