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
} from './helpers.js'
import type { AssistantProviderTraceUpdate } from '../provider-traces.js'
import { normalizeNullableString } from '../shared.js'
import { resolveAssistantModelSpecFromProviderConfig } from '../provider-config.js'
import type { AssistantProviderDefinition } from './types.js'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2
const OPENAI_COMPATIBLE_PROVIDER_MAX_TOOL_STEPS = 8
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500
const OPENAI_COMPATIBLE_PROVIDER_TOOL_EXECUTION_STATE = Symbol(
  'openai-compatible-provider-tool-execution-state',
)

interface OpenAiCompatibleProviderToolExecutionState {
  executedToolCount: number
  rawEvents: unknown[]
}

export function attachOpenAiCompatibleProviderToolExecutionState(
  error: unknown,
  input: OpenAiCompatibleProviderToolExecutionState,
): unknown {
  if (error && typeof error === 'object') {
    Object.defineProperty(error, OPENAI_COMPATIBLE_PROVIDER_TOOL_EXECUTION_STATE, {
      configurable: true,
      enumerable: false,
      value: {
        executedToolCount: Math.max(0, input.executedToolCount),
        rawEvents: input.rawEvents,
      } satisfies OpenAiCompatibleProviderToolExecutionState,
      writable: true,
    })
  }

  return error
}

export function readOpenAiCompatibleProviderToolExecutionState(
  error: unknown,
): OpenAiCompatibleProviderToolExecutionState | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const value = (
    error as {
      [OPENAI_COMPATIBLE_PROVIDER_TOOL_EXECUTION_STATE]?: unknown
    }
  )[OPENAI_COMPATIBLE_PROVIDER_TOOL_EXECUTION_STATE]

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const state = value as {
    executedToolCount?: unknown
    rawEvents?: unknown
  }

  return {
    executedToolCount:
      typeof state.executedToolCount === 'number' && state.executedToolCount >= 0
        ? state.executedToolCount
        : 0,
    rawEvents: Array.isArray(state.rawEvents) ? state.rawEvents : [],
  }
}

export function didOpenAiCompatibleProviderExecuteTool(error: unknown): boolean {
  return (readOpenAiCompatibleProviderToolExecutionState(error)?.executedToolCount ?? 0) > 0
}

export const openAiCompatibleProviderDefinition: AssistantProviderDefinition = {
  capabilities: {
    supportsBoundTools: true,
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
      const result = await generateText({
        abortSignal: input.abortSignal,
        maxRetries: tools ? 0 : OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES,
        messages: buildAssistantProviderMessages(input),
        model: resolveAssistantLanguageModel(languageModelSpec),
        ...(tools
          ? {
              stopWhen: stepCountIs(OPENAI_COMPATIBLE_PROVIDER_MAX_TOOL_STEPS),
              tools,
            }
          : {}),
        system: normalizeNullableString(input.systemPrompt) ?? undefined,
        timeout: OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS,
      })

      return {
        provider: providerConfig.provider,
        providerSessionId: null,
        response: result.text,
        stderr: '',
        stdout: '',
        rawEvents: toolEvents,
        usage: extractOpenAICompatibleAssistantProviderUsage({
          providerConfig,
          result,
        }),
      }
    } catch (error) {
      throw attachOpenAiCompatibleProviderToolExecutionState(error, {
        executedToolCount,
        rawEvents: toolEvents,
      })
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
