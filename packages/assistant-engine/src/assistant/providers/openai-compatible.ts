import { generateText, stepCountIs, type ToolSet } from 'ai'
import {
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
import {
  supportsAnyAssistantRichUserMessageContent,
  type AssistantProviderDefinition,
} from './types.js'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2
const OPENAI_COMPATIBLE_PROVIDER_MAX_TOOL_STEPS = 8
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500

export const openAiCompatibleProviderDefinition: AssistantProviderDefinition = {
  capabilities: {
    murphCommandSurface: 'bound-tools',
    requestFormat: 'messages',
    supportedUserMessageContentTypes: ['text', 'image', 'file'],
    supportsModelDiscovery: true,
    supportsNativeResume: false,
    supportsReasoningEffort: false,
    supportsRichUserMessageContent: supportsAnyAssistantRichUserMessageContent([
      'text',
      'image',
      'file',
    ]),
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
      const usesResponsesApi =
        (languageModelSpec.executionDriver ?? 'openai-compatible') === 'responses'
      const providerOptions = resolveOpenAiCompatibleProviderOptions({
        providerConfig,
        resumeProviderSessionId: input.resumeProviderSessionId,
        usesResponsesApi,
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
  onToolEvent: (event: AssistantAiSdkToolEvent) => void
  providerConfig: AssistantProviderConfig
}): ToolSet | undefined {
  const requestedNativeWebSearch =
    shouldAssistantProviderUseProviderWebSearch(input.providerConfig) ||
    shouldAssistantProviderUseGatewayWebSearch(input.providerConfig)
  const murphTools = filterOpenAiCompatibleMurphAiSdkTools({
    tools:
      input.input.toolRuntime?.toolCatalog?.createAiSdkTools('apply', {
        onToolEvent: input.onToolEvent,
      }) ?? null,
    // The current AI SDK generateText stack still throws on provider-defined
    // tools before the provider adapter can handle them. Keep OpenAI-compatible
    // turns on Murph-owned search until that upstream path is safe.
    useMurphWebSearch:
      shouldAssistantProviderUseMurphWebSearch(input.providerConfig) ||
      requestedNativeWebSearch,
  })
  const tools: ToolSet = {
    ...remapOpenAiCompatibleToolNames(murphTools),
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

function remapOpenAiCompatibleToolNames(tools: ToolSet | null): ToolSet {
  if (!tools) {
    return {}
  }

  const remapped: ToolSet = {}
  const seenNames = new Set<string>()

  for (const [name, definition] of Object.entries(tools)) {
    const baseName = sanitizeOpenAiCompatibleToolName(name)
    let nextName = baseName
    let suffix = 2

    while (seenNames.has(nextName)) {
      nextName = `${baseName}_${suffix}`
      suffix += 1
    }

    seenNames.add(nextName)
    remapped[nextName] = definition
  }

  return remapped
}

function sanitizeOpenAiCompatibleToolName(name: string): string {
  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+/g, '')
    .replace(/_+$/g, '')

  return sanitized.length > 0 ? sanitized : 'tool'
}

function resolveOpenAiCompatibleProviderOptions(input: {
  providerConfig: AssistantProviderConfig
  resumeProviderSessionId: string | null | undefined
  usesResponsesApi: boolean
}): Record<string, Record<string, boolean | string>> | undefined {
  const reasoningEffort = supportsAssistantReasoningEffort(input.providerConfig)
    ? normalizeNullableString(input.providerConfig.reasoningEffort)
    : null
  const normalizedResumeProviderSessionId = normalizeNullableString(
    input.resumeProviderSessionId,
  )
  if (input.usesResponsesApi) {
    const openAiOptions: Record<string, boolean | string> = {
      store: false,
    }

    if (reasoningEffort) {
      openAiOptions.reasoningEffort = reasoningEffort
    }

    if (normalizedResumeProviderSessionId) {
      openAiOptions.previousResponseId = normalizedResumeProviderSessionId
    }

    return {
      openai: openAiOptions,
    }
  }

  if (!reasoningEffort) {
    return undefined
  }

  return {
    [normalizeAssistantProviderOptionKey(input.providerConfig.providerName)]: {
      reasoningEffort,
    },
  }
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
