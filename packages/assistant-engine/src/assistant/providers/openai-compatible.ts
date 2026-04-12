import { createGateway, gateway, generateText, stepCountIs, type ToolSet } from 'ai'
import { openai } from '@ai-sdk/openai'
import {
  type AssistantModelSpec,
  resolveAssistantLanguageModel,
  type AssistantAiSdkToolEvent,
} from '../../model-harness.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
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
import {
  normalizeAssistantProviderOptionKey,
  normalizeNullableString,
} from '../shared.js'
import {
  createAssistantProviderToolProgressEvent,
} from '../provider-progress.js'
import {
  type AssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  shouldAssistantProviderUseGatewayWebSearch,
  shouldAssistantProviderUseMurphWebSearch,
  shouldAssistantProviderUseProviderWebSearch,
  supportsAssistantReasoningEffort,
} from '@murphai/operator-config/assistant/provider-config'
import { resolveAssistantModelSpecFromProviderConfig } from '../provider-config.js'
import type { AssistantProviderDefinition } from './types.js'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2
const OPENAI_COMPATIBLE_PROVIDER_MAX_TOOL_STEPS = 8
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500

export const openAiCompatibleProviderDefinition: AssistantProviderDefinition = {
  capabilities: {
    murphCommandSurface: 'bound-tools',
    requestFormat: 'messages',
    supportsModelDiscovery: true,
    supportsNativeResume: false,
    supportsReasoningEffort: false,
    supportsRichUserMessageContent: true,
    supportsZeroDataRetention: false,
    supportsToolRuntime: true,
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

    const resolvedRuntimeTarget = resolveAssistantProviderRuntimeTarget(providerConfig)
    const toolEvents: unknown[] = []
    let executedToolCount = 0
    const tools = resolveOpenAiCompatibleAiSdkTools({
      input,
      languageModelSpec,
      onToolEvent: (event) => {
        if (event.kind === 'started' && event.mode === 'apply') {
          executedToolCount += 1
        }

        const rawEvent = createOpenAiCompatibleToolRawEvent({
          event,
          sequence: toolEvents.length + 1,
        })
        toolEvents.push(rawEvent)

        const progressEvent = createOpenAiCompatibleToolProgressEvent({
          event,
          rawEvent,
          sequence: toolEvents.length,
        })
        if (progressEvent) {
          input.onEvent?.(progressEvent)
        }

        const updates = buildOpenAiCompatibleToolTraceUpdates(event)
        if (updates.length > 0) {
          input.onTraceEvent?.({
            providerSessionId: null,
            rawEvent,
            updates,
          })
        }
      },
      providerConfig,
    })

    try {
      const messages = buildAssistantProviderMessages(input)
      const providerOptions = resolveOpenAiCompatibleProviderOptions({
        providerConfig,
        resolvedRuntimeTarget,
        resumeProviderSessionId: input.resumeProviderSessionId,
      })

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
        ...(providerOptions
          ? {
              providerOptions,
            }
          : {}),
        system: normalizeNullableString(input.systemPrompt) ?? undefined,
        timeout: OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS,
      })

      return {
        metadata: {
          activityLabels: [],
          executedToolCount,
          rawToolEvents: toolEvents,
        },
        ok: true,
        result: {
          provider: providerConfig.provider,
          providerSessionId:
            resolvedRuntimeTarget.supportsNativeResume
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
          activityLabels: [],
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

function resolveOpenAiCompatibleAiSdkTools(input: {
  input: Parameters<AssistantProviderDefinition['executeTurn']>[0]
  languageModelSpec: AssistantModelSpec
  onToolEvent: (event: AssistantAiSdkToolEvent) => void
  providerConfig: AssistantProviderConfig
}): ToolSet | undefined {
  const murphTools = filterOpenAiCompatibleMurphAiSdkTools({
    tools:
      input.input.toolRuntime?.toolCatalog?.createAiSdkTools('apply', {
        onToolEvent: input.onToolEvent,
      }) ?? null,
    useMurphWebSearch: shouldAssistantProviderUseMurphWebSearch(
      input.providerConfig,
    ),
  })
  const nativeSearchTools = resolveOpenAiCompatibleNativeSearchTools({
    languageModelSpec: input.languageModelSpec,
    providerConfig: input.providerConfig,
  })
  const tools: ToolSet = {
    ...(murphTools ?? {}),
    ...(nativeSearchTools ?? {}),
  }

  return Object.keys(tools).length > 0 ? tools : undefined
}

function filterOpenAiCompatibleMurphAiSdkTools(input: {
  tools: ToolSet | null
  useMurphWebSearch: boolean
}): ToolSet | null {
  if (!input.tools) {
    return null
  }

  const filteredEntries = Object.entries(input.tools).filter(([name]) =>
    input.useMurphWebSearch ? true : name !== 'web.search',
  )

  return filteredEntries.length > 0 ? Object.fromEntries(filteredEntries) : null
}

function resolveOpenAiCompatibleNativeSearchTools(input: {
  languageModelSpec: AssistantModelSpec
  providerConfig: AssistantProviderConfig
}): ToolSet | null {
  if (shouldAssistantProviderUseProviderWebSearch(input.providerConfig)) {
    return {
      web_search: openai.tools.webSearch({}),
    } as ToolSet
  }

  if (shouldAssistantProviderUseGatewayWebSearch(input.providerConfig)) {
    return {
      perplexity_search: resolveOpenAiCompatibleGatewayProvider(
        input.languageModelSpec,
      ).tools.perplexitySearch(),
    } as ToolSet
  }

  return null
}

function resolveOpenAiCompatibleGatewayProvider(spec: AssistantModelSpec) {
  return spec.baseUrl || spec.headers || spec.apiKey
    ? createGateway({
        ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {}),
        ...(spec.headers ? { headers: spec.headers } : {}),
        ...(spec.apiKey ? { apiKey: spec.apiKey } : {}),
      })
    : gateway
}

function resolveOpenAiCompatibleProviderOptions(input: {
  providerConfig: AssistantProviderConfig
  resolvedRuntimeTarget: ReturnType<typeof resolveAssistantProviderRuntimeTarget>
  resumeProviderSessionId: string | null | undefined
}): Record<string, Record<string, boolean | string>> | undefined {
  const reasoningEffort = supportsAssistantReasoningEffort(input.providerConfig)
    ? normalizeNullableString(input.providerConfig.reasoningEffort)
    : null
  const normalizedResumeProviderSessionId = normalizeNullableString(
    input.resumeProviderSessionId,
  )
  const namespaces: Record<string, Record<string, boolean | string>> = {}

  switch (input.resolvedRuntimeTarget.executionDriver) {
    case 'openai-responses': {
      const openAiOptions: Record<string, boolean | string> = {
        store: false,
      }

      if (reasoningEffort) {
        openAiOptions.reasoningEffort = reasoningEffort
      }

      if (normalizedResumeProviderSessionId) {
        openAiOptions.previousResponseId = normalizedResumeProviderSessionId
      }

      namespaces.openai = openAiOptions
      break
    }
    case 'gateway': {
      const upstreamProviderNamespace =
        resolveOpenAiCompatibleGatewayProviderNamespace(input.providerConfig.model)

      if (upstreamProviderNamespace) {
        const upstreamOptions: Record<string, boolean | string> = {}

        if (reasoningEffort) {
          upstreamOptions.reasoningEffort = reasoningEffort
        }

        if (upstreamProviderNamespace === 'openai') {
          upstreamOptions.store = false

          if (normalizedResumeProviderSessionId) {
            upstreamOptions.previousResponseId = normalizedResumeProviderSessionId
          }
        }

        if (Object.keys(upstreamOptions).length > 0) {
          namespaces[upstreamProviderNamespace] = upstreamOptions
        }
      }

      if (input.providerConfig.zeroDataRetention === true) {
        namespaces.gateway = {
          zeroDataRetention: true,
        }
      }
      break
    }
    case 'openai-compatible':
    default: {
      if (reasoningEffort) {
        namespaces[normalizeAssistantProviderOptionKey(input.providerConfig.providerName)] = {
          reasoningEffort,
        }
      }
      break
    }
  }

  return Object.keys(namespaces).length > 0 ? namespaces : undefined
}

function resolveOpenAiCompatibleGatewayProviderNamespace(
  model: string | null | undefined,
): string | null {
  const normalizedModel = normalizeNullableString(model)
  if (!normalizedModel) {
    return null
  }

  const slashIndex = normalizedModel.indexOf('/')
  if (slashIndex <= 0) {
    return null
  }

  return normalizedModel.slice(0, slashIndex)
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

function createOpenAiCompatibleToolProgressEvent(input: {
  event: AssistantAiSdkToolEvent
  rawEvent: Record<string, unknown>
  sequence: number
}) {
  const label = normalizeNullableString(input.event.tool)
  const textLabel = label ?? 'tool'
  switch (input.event.kind) {
    case 'started':
      return createAssistantProviderToolProgressEvent({
        id: `tool-${input.sequence}`,
        label,
        rawEvent: input.rawEvent,
        state: 'running',
        text: `Running ${textLabel}.`,
      })
    case 'previewed':
      return createAssistantProviderToolProgressEvent({
        id: `tool-${input.sequence}`,
        label,
        rawEvent: input.rawEvent,
        safeText: label ? `planned ${label}` : null,
        state: 'completed',
        text: `Planned ${textLabel}.`,
      })
    case 'succeeded':
      return createAssistantProviderToolProgressEvent({
        id: `tool-${input.sequence}`,
        label,
        rawEvent: input.rawEvent,
        state: 'completed',
        text: `Finished ${textLabel}.`,
      })
    case 'failed':
      return createAssistantProviderToolProgressEvent({
        id: `tool-${input.sequence}`,
        label,
        rawEvent: input.rawEvent,
        safeText: label ? `${label} failed` : null,
        state: 'completed',
        text: `${textLabel} failed: ${input.event.errorMessage ?? 'Tool execution failed.'}`,
      })
  }
}
