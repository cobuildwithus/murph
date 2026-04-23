import { generateText, stepCountIs, tool, type ToolSet } from 'ai'
import {
  resolveAssistantLanguageModel,
  type AssistantModelSpec,
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
  normalizeAssistantUsageGatewayTags,
  type AssistantUsageAttribution,
} from '../usage-attribution.js'
import type { AssistantUsageCredentialSource } from '@murphai/runtime-state/node'
import {
  isAssistantOpenAICompatibleTargetConfig,
  normalizeAssistantGatewayOnlyProviders,
  resolveAssistantChatProviderFromConfig,
  shouldAssistantProviderUseGatewayWebSearch,
  shouldAssistantProviderUseMurphWebSearch,
  shouldAssistantProviderUseProviderWebSearch,
  supportsAssistantNativeResume,
  supportsAssistantReasoningEffort,
  type AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import { resolveAssistantModelSpecFromProviderConfig } from '../provider-config.js'
import {
  supportsAnyAssistantRichUserMessageContent,
  type AssistantProviderDefinition,
} from './types.js'
import { z } from 'zod/v4'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2
const OPENAI_COMPATIBLE_PROVIDER_MAX_TOOL_STEPS = 8
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500

type JsonPrimitive = boolean | number | string | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue | undefined }
interface GatewayProviderOptions extends JsonObject {
  only?: string[]
  tags?: string[]
  user?: string
  zeroDataRetention?: boolean
}

interface AssistantStripeBillingContext {
  credentialSource: AssistantUsageCredentialSource
  stripeCustomerId?: string | null
}

interface OpenAiCompatibleTargetIdentity {
  baseUrl?: string | null
  gatewayOnlyProviders?: readonly string[] | null
  presetId?: string | null
  providerName?: string | null
}

export const HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV =
  'HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED'
export const HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV =
  'HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY'
const VERCEL_STRIPE_CUSTOMER_ID_HEADER = 'stripe-customer-id'
const VERCEL_STRIPE_RESTRICTED_ACCESS_KEY_HEADER = 'stripe-restricted-access-key'

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
    if (!isAssistantOpenAICompatibleTargetConfig(providerConfig)) {
      return {
        models: [],
        status: 'unsupported',
        message: 'OpenAI-compatible model discovery requires an OpenAI-compatible provider config.',
      }
    }

    const normalizedBaseUrl = normalizeNullableString(providerConfig.target.baseUrl)
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
    if (!isAssistantOpenAICompatibleTargetConfig(providerConfig)) {
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_UNSUPPORTED',
        'OpenAI-compatible execution requires an OpenAI-compatible provider config.',
      )
    }

    const resolvedLanguageModelSpec = resolveAssistantModelSpecFromProviderConfig(
      providerConfig,
      {
        ...process.env,
        ...(input.env ?? {}),
      },
    )
    if (!resolvedLanguageModelSpec) {
      if (!providerConfig.target.baseUrl) {
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

    const usageAttribution = input.usageAttribution ?? null
    const languageModelSpec = applyOpenAiCompatibleGatewayPolicies({
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      languageModelSpec: resolvedLanguageModelSpec,
      providerZeroDataRetention: providerConfig.policy.zeroDataRetention === true,
      providerTarget: providerConfig.target,
      usageAttribution,
    })

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
      const usesResponsesApi =
        (languageModelSpec.executionDriver ?? 'openai-compatible') === 'responses'
      const providerOptions = resolveOpenAiCompatibleProviderOptions({
        providerConfig,
        resumeProviderSessionId: input.resumeProviderSessionId,
        usageAttribution,
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
          provider: resolveAssistantChatProviderFromConfig(providerConfig),
          providerSessionId:
            shouldUseOpenAiCompatibleProviderState(providerConfig)
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


function applyOpenAiCompatibleGatewayPolicies(input: {
  env: NodeJS.ProcessEnv
  languageModelSpec: AssistantModelSpec
  providerZeroDataRetention: boolean
  providerTarget: OpenAiCompatibleTargetIdentity
  usageAttribution: AssistantUsageAttribution | null
}): AssistantModelSpec {
  const billingHeaders = resolveOpenAiCompatibleVercelStripeBillingHeaders({
    billingContext: input.usageAttribution
      ? {
          credentialSource: input.usageAttribution.credentialSource,
          stripeCustomerId: input.usageAttribution.stripeCustomerId,
        }
      : null,
    env: input.env,
    providerTarget: input.providerTarget,
  })
  const gatewayOptions = resolveOpenAiCompatibleGatewayProviderOptions({
    providerZeroDataRetention: input.providerZeroDataRetention,
    providerTarget: input.providerTarget,
    usageAttribution: input.usageAttribution,
  })
  const sanitizedHeaders = stripVercelStripeBillingHeaders(input.languageModelSpec.headers)
  const nextHeaders = billingHeaders
    ? {
        ...(sanitizedHeaders ?? {}),
        ...billingHeaders,
      }
    : sanitizedHeaders

  if (
    !gatewayOptions ||
    (input.languageModelSpec.executionDriver ?? 'openai-compatible') !== 'responses'
  ) {
    return nextHeaders === input.languageModelSpec.headers
      ? input.languageModelSpec
      : {
          ...input.languageModelSpec,
          headers: nextHeaders,
        }
  }

  const existingPolicy = input.languageModelSpec.responsesRequestPolicy
  const existingReporting = existingPolicy?.gatewayReporting
  const user = typeof gatewayOptions.user === 'string'
    ? gatewayOptions.user
    : existingReporting?.user ?? null
  const tags = normalizeAssistantUsageGatewayTags([
    ...(existingReporting?.tags ?? []),
    ...(Array.isArray(gatewayOptions.tags) ? gatewayOptions.tags : []),
  ])
  const gatewayOnlyProviders = normalizeAssistantGatewayOnlyProviders(
    gatewayOptions.only,
  )

  return {
    ...input.languageModelSpec,
    ...(nextHeaders
      ? {
          headers: nextHeaders,
        }
      : {}),
    responsesRequestPolicy: {
      ...existingPolicy,
      ...(gatewayOptions.zeroDataRetention === true
        ? {
            gatewayZeroDataRetention: true,
          }
        : {}),
      ...(gatewayOnlyProviders
        ? {
            gatewayOnlyProviders,
          }
        : {}),
      ...(user || tags.length > 0
        ? {
            gatewayReporting: {
              ...(user ? { user } : {}),
              ...(tags.length > 0 ? { tags } : {}),
            },
          }
        : {}),
    },
  }
}

function resolveOpenAiCompatibleAiSdkTools(input: {
  input: Parameters<AssistantProviderDefinition['executeTurn']>[0]
  languageModelSpec: AssistantModelSpec
  onToolEvent: (event: AssistantAiSdkToolEvent) => void
  providerConfig: AssistantProviderConfig
}) {
  const useMurphWebSearch = shouldAssistantProviderUseMurphWebSearch(
    input.providerConfig,
  )
  const requestedNativeWebSearch =
    shouldAssistantProviderUseProviderWebSearch(input.providerConfig) ||
    shouldAssistantProviderUseGatewayWebSearch(input.providerConfig)
  const murphTools = filterOpenAiCompatibleMurphAiSdkTools({
    tools:
      input.input.toolRuntime?.toolCatalog?.createAiSdkTools('apply', {
        onToolEvent: input.onToolEvent,
      }) ?? null,
    useMurphWebSearch,
  })
  const tools = {
    ...remapOpenAiCompatibleToolNames(murphTools),
  }
  const nativeWebSearchTool =
    requestedNativeWebSearch && !useMurphWebSearch
      ? createOpenAiCompatibleNativeWebSearchTool({
          languageModelSpec: input.languageModelSpec,
        })
      : null

  if (nativeWebSearchTool) {
    tools.web_search = nativeWebSearchTool
  }

  return Object.keys(tools).length > 0 ? tools : undefined
}

function createOpenAiCompatibleNativeWebSearchTool(input: {
  languageModelSpec: AssistantModelSpec
}) {
  if (input.languageModelSpec.executionDriver !== 'responses') {
    return null
  }

  return tool({
    type: 'provider',
    id: 'openai.web_search',
    args: {},
    description: 'Native OpenAI web search tool',
    inputSchema: z.never(),
  })
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

export function shouldUseOpenAiCompatibleProviderState(
  providerConfig: AssistantProviderConfig,
): boolean {
  return (
    providerConfig.policy.zeroDataRetention !== true &&
    supportsAssistantNativeResume(providerConfig)
  )
}

export function resolveOpenAiCompatibleProviderOptions(input: {
  providerConfig: AssistantProviderConfig
  resumeProviderSessionId: string | null | undefined
  usageAttribution?: AssistantUsageAttribution | null
  usesResponsesApi: boolean
}): Record<string, JsonObject> | undefined {
  const providerOptions: Record<string, JsonObject> = {}
  const reasoningEffort = supportsAssistantReasoningEffort(input.providerConfig)
    ? normalizeNullableString(input.providerConfig.policy.reasoningEffort)
    : null
  const normalizedResumeProviderSessionId = normalizeNullableString(
    input.resumeProviderSessionId,
  )
  const gatewayOptions = resolveOpenAiCompatibleGatewayProviderOptions({
    providerZeroDataRetention: input.providerConfig.policy.zeroDataRetention === true,
    providerTarget: isAssistantOpenAICompatibleTargetConfig(input.providerConfig)
      ? input.providerConfig.target
      : {},
    usageAttribution: input.usageAttribution ?? null,
  })

  if (input.usesResponsesApi) {
    const providerStateEnabled = shouldUseOpenAiCompatibleProviderState(
      input.providerConfig,
    )
    const openAiOptions: JsonObject = {
      store: providerStateEnabled,
    }

    if (reasoningEffort) {
      openAiOptions.reasoningEffort = reasoningEffort
    }

    if (providerStateEnabled && normalizedResumeProviderSessionId) {
      openAiOptions.previousResponseId = normalizedResumeProviderSessionId
    }

    providerOptions.openai = openAiOptions
  } else if (reasoningEffort) {
    providerOptions[
      normalizeAssistantProviderOptionKey(
        isAssistantOpenAICompatibleTargetConfig(input.providerConfig)
          ? input.providerConfig.target.providerName
          : null,
      )
    ] = {
      reasoningEffort,
    }
  }

  if (gatewayOptions) {
    providerOptions.gateway = gatewayOptions
  }

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined
}

function resolveOpenAiCompatibleGatewayProviderOptions(input: {
  providerZeroDataRetention: boolean
  providerTarget: OpenAiCompatibleTargetIdentity
  usageAttribution?: AssistantUsageAttribution | null
}): GatewayProviderOptions | null {
  if (!isOpenAiCompatibleVercelAiGatewayTarget(input.providerTarget)) {
    return null
  }

  const gatewayOptions: GatewayProviderOptions = {}
  const gatewayOnlyProviders = normalizeAssistantGatewayOnlyProviders(
    input.providerTarget.gatewayOnlyProviders,
  )

  if (gatewayOnlyProviders) {
    gatewayOptions.only = [...gatewayOnlyProviders]
  }

  if (input.providerZeroDataRetention) {
    gatewayOptions.zeroDataRetention = true
  }

  const reportingUserId = normalizeNullableString(
    input.usageAttribution?.reportingUserId ?? null,
  )
  const gatewayTags = normalizeAssistantUsageGatewayTags(
    input.usageAttribution?.gatewayTags ?? [],
  )

  if (reportingUserId) {
    gatewayOptions.user = reportingUserId
  }

  if (gatewayTags.length > 0) {
    gatewayOptions.tags = gatewayTags
  }

  return Object.keys(gatewayOptions).length > 0 ? gatewayOptions : null
}

function isOpenAiCompatibleVercelAiGatewayConfig(
  providerConfig: AssistantProviderConfig,
): boolean {
  if (!isAssistantOpenAICompatibleTargetConfig(providerConfig)) {
    return false
  }

  return isOpenAiCompatibleVercelAiGatewayTarget(providerConfig.target)
}

export function isOpenAiCompatibleVercelAiGatewayTarget(
  target: OpenAiCompatibleTargetIdentity,
): boolean {
  const presetId = normalizeNullableString(target.presetId)
  const providerName = normalizeNullableString(target.providerName)
  return (
    presetId === 'vercel-ai-gateway' ||
    providerName?.toLowerCase() === 'vercel-ai-gateway' ||
    isVercelAiGatewayBaseUrl(target.baseUrl)
  )
}

export function resolveOpenAiCompatibleVercelStripeBillingHeaders(input: {
  billingContext: AssistantStripeBillingContext | null
  env: Readonly<Record<string, string | undefined>>
  providerTarget: OpenAiCompatibleTargetIdentity
}): Record<string, string> | null {
  if (
    !input.billingContext ||
    !isOpenAiCompatibleVercelAiGatewayTarget(input.providerTarget) ||
    input.billingContext.credentialSource !== 'platform' ||
    !readEnabledFlag(input.env[HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV])
  ) {
    return null
  }

  const restrictedAccessKey = normalizeVercelStripeRestrictedAccessKey(
    input.env[HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV],
  )
  const stripeCustomerId = normalizeStripeCustomerId(input.billingContext.stripeCustomerId)

  if (!restrictedAccessKey || !stripeCustomerId) {
    return null
  }

  return {
    [VERCEL_STRIPE_CUSTOMER_ID_HEADER]: stripeCustomerId,
    [VERCEL_STRIPE_RESTRICTED_ACCESS_KEY_HEADER]: restrictedAccessKey,
  }
}

function isVercelAiGatewayBaseUrl(value: string | null | undefined): boolean {
  const normalized = normalizeNullableString(value)

  if (!normalized) {
    return false
  }

  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'ai-gateway.vercel.sh'
  } catch {
    return false
  }
}

function normalizeStripeCustomerId(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value)

  return normalized?.startsWith('cus_') ? normalized : null
}

function normalizeVercelStripeRestrictedAccessKey(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)

  return normalized?.startsWith('rk_') ? normalized : null
}

function readEnabledFlag(value: string | null | undefined): boolean {
  const normalized = normalizeNullableString(value)

  return normalized === '1' || normalized?.toLowerCase() === 'true'
}

function stripVercelStripeBillingHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return headers
  }

  let removed = false
  const filteredEntries = Object.entries(headers).filter(([key]) => {
    const normalizedKey = key.toLowerCase()
    const keep =
      normalizedKey !== VERCEL_STRIPE_CUSTOMER_ID_HEADER &&
      normalizedKey !== VERCEL_STRIPE_RESTRICTED_ACCESS_KEY_HEADER

    if (!keep) {
      removed = true
    }

    return keep
  })

  if (!removed) {
    return headers
  }

  return filteredEntries.length > 0 ? Object.fromEntries(filteredEntries) : undefined
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
