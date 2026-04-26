import { generateText, stepCountIs, tool, type ToolSet } from 'ai'
import {
  resolveAssistantLanguageModel,
  type AssistantModelSpec,
  type AssistantResponsesRequestDebugEvent,
  type AssistantAiSdkToolEvent,
} from '../model-harness.js'
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
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from '../provider-traces.js'
import {
  normalizeAssistantProviderOptionKey,
  normalizeNullableString,
} from '../shared.js'
import {
  isAssistantOpenAIBaseUrl,
  isAssistantVercelAIGatewayBaseUrl,
} from '@murphai/operator-config/assistant/shared'
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
    const languageModelSpec = attachOpenAiCompatibleResponsesRequestDebugObserver({
      languageModelSpec: applyOpenAiCompatibleGatewayPolicies({
        env: {
          ...process.env,
          ...(input.env ?? {}),
        },
        languageModelSpec: resolvedLanguageModelSpec,
        providerZeroDataRetention: providerConfig.policy.zeroDataRetention === true,
        providerTarget: providerConfig.target,
        usageAttribution,
      }),
      onTraceEvent: input.onTraceEvent,
    })

    const toolEvents: unknown[] = []
    let executedToolCount = 0
    const providerActionToolCallIds = new Set<string>()
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

    const usesResponsesApi =
      (languageModelSpec.executionDriver ?? 'openai-compatible') === 'responses'
    const resumeProviderSessionId =
      resolveOpenAiCompatibleEffectiveResumeProviderSessionId({
        providerConfig,
        resumeProviderSessionId: input.resumeProviderSessionId,
        usesResponsesApi,
      })
    const providerOptions = resolveOpenAiCompatibleProviderOptions({
      providerConfig,
      resumeProviderSessionId,
      usageAttribution,
      usesResponsesApi,
    })
    const providerInput =
      resumeProviderSessionId === normalizeNullableString(input.resumeProviderSessionId)
        ? input
        : {
            ...input,
            resumeProviderSessionId,
          }

    try {
      const messages = buildAssistantProviderMessages(providerInput)
      const result = await generateText({
        abortSignal: input.abortSignal,
        maxRetries: tools ? 0 : OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES,
        messages,
        model: resolveAssistantLanguageModel(languageModelSpec),
        onStepFinish: (stepResult) => {
          recordOpenAiCompatibleProviderActionResult(
            providerActionToolCallIds,
            stepResult,
          )
        },
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
      recordOpenAiCompatibleProviderActionResult(
        providerActionToolCallIds,
        result,
      )

      return {
        metadata: {
          activityLabels: [],
          executedToolCount,
          providerActionCount: providerActionToolCallIds.size,
          rawToolEvents: toolEvents,
        },
        ok: true,
        result: {
          provider: resolveAssistantChatProviderFromConfig(providerConfig),
          providerSessionId:
            shouldUseOpenAiCompatibleProviderState(providerConfig)
              ? (
                  normalizeOpenAiCompatibleResponsesProviderSessionId(
                    extractOpenAICompatibleProviderSessionId(result),
                  ) ?? resumeProviderSessionId
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
      const annotatedError = annotateOpenAiCompatibleProviderError(error, {
        languageModelSpec,
        providerConfig,
      })
      return {
        error: annotatedError,
        metadata: {
          activityLabels: [],
          executedToolCount,
          providerActionCount: providerActionToolCallIds.size,
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

function annotateOpenAiCompatibleProviderError(
  error: unknown,
  input: {
    languageModelSpec: AssistantModelSpec
    providerConfig: AssistantProviderConfig
  },
): unknown {
  const details = buildOpenAiCompatibleProviderFailureDetails({
    error,
    languageModelSpec: input.languageModelSpec,
    providerConfig: input.providerConfig,
  })

  if (error instanceof Error) {
    const annotated = error as Error & { details?: Record<string, unknown> }
    annotated.details = {
      ...readOpenAiCompatibleObjectProperty(annotated.details),
      ...details,
    }
    return annotated
  }

  return Object.assign(new Error('OpenAI-compatible provider execution failed.'), {
    cause: error,
    details,
  })
}

function buildOpenAiCompatibleProviderFailureDetails(input: {
  error: unknown
  languageModelSpec: AssistantModelSpec
  providerConfig: AssistantProviderConfig
}): JsonObject {
  const providerTarget: OpenAiCompatibleTargetIdentity = isAssistantOpenAICompatibleTargetConfig(input.providerConfig)
    ? input.providerConfig.target
    : {}
  const baseUrl = readOpenAiCompatibleUrlDetails(input.languageModelSpec.baseUrl)
  const requestUrl = readOpenAiCompatibleUrlDetails(
    readOpenAiCompatibleNestedStringProperty(input.error, ['url']),
  )
  const gatewayOnlyProviders = normalizeAssistantGatewayOnlyProviders(
    providerTarget.gatewayOnlyProviders,
  )
  const diagnostics = readOpenAiCompatibleErrorDiagnostics(input.error)

  return pruneOpenAiCompatibleJsonObject({
    assistantProviderAdapter: 'openai-compatible',
    assistantProviderBaseUrlConfigured:
      baseUrl.origin !== null || baseUrl.path !== null,
    assistantProviderBaseUrlOrigin: baseUrl.origin,
    assistantProviderBaseUrlPath: baseUrl.path,
    assistantProviderErrorBodyCode: diagnostics.bodyCode,
    assistantProviderErrorBodyMessage: diagnostics.bodyMessage,
    assistantProviderErrorBodyPresent: diagnostics.bodyPresent,
    assistantProviderErrorBodyType: diagnostics.bodyType,
    assistantProviderErrorCode: diagnostics.code,
    assistantProviderErrorMessage: diagnostics.message,
    assistantProviderErrorRetryable: diagnostics.retryable,
    assistantProviderErrorStatus: diagnostics.status,
    assistantProviderErrorStatusText: diagnostics.statusText,
    assistantProviderErrorType: diagnostics.type,
    assistantProviderExecutionDriver:
      input.languageModelSpec.executionDriver ?? 'openai-compatible',
    assistantProviderGatewayOnlyProviderCount: gatewayOnlyProviders?.length ?? 0,
    assistantProviderGatewayOnlyProviders:
      gatewayOnlyProviders && gatewayOnlyProviders.length > 0
        ? gatewayOnlyProviders.join(',')
        : null,
    assistantProviderGatewayTarget:
      isOpenAiCompatibleVercelAiGatewayTarget(providerTarget),
    assistantProviderModel: input.languageModelSpec.model,
    assistantProviderName: providerTarget.providerName ?? input.languageModelSpec.providerName ?? null,
    assistantProviderPresetId: providerTarget.presetId ?? null,
    assistantProviderRequestUrlOrigin: requestUrl.origin,
    assistantProviderRequestUrlPath: requestUrl.path,
    assistantProviderZeroDataRetention:
      input.providerConfig.policy.zeroDataRetention === true,
  })
}

function readOpenAiCompatibleErrorDiagnostics(error: unknown): {
  bodyCode: string | null
  bodyMessage: string | null
  bodyPresent: boolean
  bodyType: string | null
  code: string | null
  message: string | null
  retryable: boolean | null
  status: number | null
  statusText: string | null
  type: string | null
} {
  const bodyPayload = readOpenAiCompatibleErrorBodyPayload(error)
  const bodyError = readOpenAiCompatibleObjectProperty(bodyPayload?.error)
  const bodySource = bodyError ?? bodyPayload

  return {
    bodyCode: readOpenAiCompatibleStringProperty(bodySource, 'code'),
    bodyMessage: readOpenAiCompatibleStringProperty(bodySource, 'message'),
    bodyPresent: bodyPayload !== null || readOpenAiCompatibleNestedStringProperty(error, [
      'responseBody',
      'body',
    ]) !== null,
    bodyType: readOpenAiCompatibleStringProperty(bodySource, 'type'),
    code: readOpenAiCompatibleNestedStringProperty(error, ['code', 'errorCode']),
    message: normalizeOpenAiCompatibleDiagnosticString(
      error instanceof Error ? error.message : null,
    ),
    retryable: readOpenAiCompatibleNestedBooleanProperty(error, [
      'isRetryable',
      'retryable',
    ]),
    status: readOpenAiCompatibleNestedNumberProperty(error, [
      'statusCode',
      'status',
      'responseStatus',
    ]),
    statusText: readOpenAiCompatibleNestedStringProperty(error, [
      'statusText',
      'responseStatusText',
    ]),
    type: readOpenAiCompatibleNestedStringProperty(error, ['type', 'errorType']),
  }
}

function readOpenAiCompatibleErrorBodyPayload(
  error: unknown,
): Record<string, unknown> | null {
  const data = readOpenAiCompatibleNestedObjectProperty(error, ['data'])
  if (data) {
    return data
  }

  const responseBody = readOpenAiCompatibleNestedStringProperty(error, [
    'responseBody',
    'body',
  ])
  if (!responseBody) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(responseBody)
    return readOpenAiCompatibleObjectProperty(parsed)
  } catch {
    return null
  }
}

function readOpenAiCompatibleUrlDetails(value: string | null | undefined): {
  origin: string | null
  path: string | null
} {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return {
      origin: null,
      path: null,
    }
  }

  try {
    const url = new URL(normalized)
    return {
      origin: url.origin,
      path: url.pathname,
    }
  } catch {
    return {
      origin: null,
      path: null,
    }
  }
}

function readOpenAiCompatibleNestedStringProperty(
  value: unknown,
  keys: readonly string[],
): string | null {
  const found = readOpenAiCompatibleNestedProperty(value, keys)
  return normalizeOpenAiCompatibleDiagnosticString(found)
}

function readOpenAiCompatibleNestedNumberProperty(
  value: unknown,
  keys: readonly string[],
): number | null {
  const found = readOpenAiCompatibleNestedProperty(value, keys)
  return typeof found === 'number' && Number.isInteger(found) ? found : null
}

function readOpenAiCompatibleNestedBooleanProperty(
  value: unknown,
  keys: readonly string[],
): boolean | null {
  const found = readOpenAiCompatibleNestedProperty(value, keys)
  return typeof found === 'boolean' ? found : null
}

function readOpenAiCompatibleNestedObjectProperty(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  return readOpenAiCompatibleObjectProperty(
    readOpenAiCompatibleNestedProperty(value, keys),
  )
}

function readOpenAiCompatibleNestedProperty(
  value: unknown,
  keys: readonly string[],
  state: {
    depth: number
    visited: Set<object>
  } = {
    depth: 0,
    visited: new Set<object>(),
  },
): unknown {
  const record = readOpenAiCompatibleObjectProperty(value)
  if (!record || state.visited.has(record)) {
    return undefined
  }
  state.visited.add(record)

  for (const key of keys) {
    const property = record[key]
    if (property !== undefined && property !== null) {
      return property
    }
  }

  if (state.depth >= 3) {
    return undefined
  }

  for (const key of ['cause', 'error', 'response', 'data', 'details', 'context']) {
    const nested = readOpenAiCompatibleNestedProperty(record[key], keys, {
      depth: state.depth + 1,
      visited: state.visited,
    })
    if (nested !== undefined && nested !== null) {
      return nested
    }
  }

  return undefined
}

function readOpenAiCompatibleObjectProperty(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readOpenAiCompatibleStringProperty(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  return normalizeOpenAiCompatibleDiagnosticString(value?.[key])
}

function normalizeOpenAiCompatibleDiagnosticString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value
    .replace(/file:\/\/\/Users\/[^\s)"']+/gu, 'file://<REDACTED_PATH>')
    .replace(/\/Users\/[^\s)"']+/gu, '<REDACTED_PATH>')
    .replace(/\/home\/[^\s)"']+/gu, '<REDACTED_PATH>')
    .replace(/\/root\/[^\s)"']+/gu, '<REDACTED_PATH>')
    .replace(/\b[A-Za-z]:\\Users\\[^\s)"']+/gu, '<REDACTED_PATH>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu, 'Bearer [redacted]')
    .replace(/\+\d{8,15}\b/gu, '[redacted-phone]')
    .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/gu, '[redacted-email]')
    .replace(
      /\b((?:[A-Z][A-Z0-9_]*_)?(?:token|secret|password|passcode|api[_-]?key|cookie|set-cookie))\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/giu,
      '$1=[redacted]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted-token]')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

  if (!normalized) {
    return null
  }

  return normalized.length <= 320
    ? normalized
    : `${normalized.slice(0, 317).trimEnd()}...`
}

function pruneOpenAiCompatibleJsonObject(
  value: Record<string, JsonValue | undefined>,
): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonValue] =>
      entry[1] !== undefined && entry[1] !== null,
    ),
  )
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

function attachOpenAiCompatibleResponsesRequestDebugObserver(input: {
  languageModelSpec: AssistantModelSpec
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
}): AssistantModelSpec {
  if (
    !input.onTraceEvent ||
    (input.languageModelSpec.executionDriver ?? 'openai-compatible') !== 'responses'
  ) {
    return input.languageModelSpec
  }

  const existingPolicy = input.languageModelSpec.responsesRequestPolicy

  return {
    ...input.languageModelSpec,
    responsesRequestPolicy: {
      ...existingPolicy,
      debugObserver(event: AssistantResponsesRequestDebugEvent): void {
        existingPolicy?.debugObserver?.(event)
        input.onTraceEvent?.({
          providerSessionId: null,
          rawEvent: event,
          updates: [
            {
              kind: 'status',
              text: 'Hosted provider final Responses request summary captured.',
            },
          ],
        })
      },
    },
  }
}

function resolveOpenAiCompatibleAiSdkTools(input: {
  input: Parameters<AssistantProviderDefinition['executeTurn']>[0]
  languageModelSpec: AssistantModelSpec
  onToolEvent: (event: AssistantAiSdkToolEvent) => void
  providerConfig: AssistantProviderConfig
}) {
  const providerTarget = isAssistantOpenAICompatibleTargetConfig(input.providerConfig)
    ? input.providerConfig.target
    : {}
  const requestedProviderWebSearch =
    shouldAssistantProviderUseProviderWebSearch(input.providerConfig)
  const requestedGatewayWebSearch =
    shouldAssistantProviderUseGatewayWebSearch(input.providerConfig)
  const useNativeWebSearch =
    (requestedGatewayWebSearch &&
      isOpenAiCompatibleVercelAiGatewayTarget(providerTarget)) ||
    (requestedProviderWebSearch &&
      (isOpenAiCompatibleOpenAiWebSearchTarget(providerTarget) ||
        isOpenAiCompatibleVercelAiGatewayTarget(providerTarget)))
  const useMurphWebSearch =
    shouldAssistantProviderUseMurphWebSearch(input.providerConfig) ||
    ((requestedProviderWebSearch || requestedGatewayWebSearch) &&
      !useNativeWebSearch)
  const useMurphWebReadTools = input.providerConfig.policy.webSearch === 'murph'
  const murphTools = filterOpenAiCompatibleMurphAiSdkTools({
    tools:
      input.input.toolRuntime?.toolCatalog?.createAiSdkTools('apply', {
        onToolEvent: input.onToolEvent,
      }) ?? null,
    useMurphWebReadTools,
    useMurphWebSearch,
  })
  const tools = {
    ...remapOpenAiCompatibleToolNames(murphTools),
  }
  const nativeWebSearchTool =
    useNativeWebSearch && !useMurphWebSearch
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

function recordOpenAiCompatibleProviderActionResult(
  actionToolCallIds: Set<string>,
  result: {
    toolCalls?: ReadonlyArray<{
      providerExecuted?: boolean
      toolCallId?: string
    }>
    toolResults?: ReadonlyArray<{
      providerExecuted?: boolean
      toolCallId?: string
    }>
  },
): void {
  for (const toolCall of result.toolCalls ?? []) {
    recordOpenAiCompatibleProviderActionToolCall(actionToolCallIds, toolCall)
  }

  for (const toolResult of result.toolResults ?? []) {
    recordOpenAiCompatibleProviderActionToolCall(actionToolCallIds, toolResult)
  }
}

function recordOpenAiCompatibleProviderActionToolCall(
  actionToolCallIds: Set<string>,
  toolCall:
    | {
        providerExecuted?: boolean
        toolCallId?: string
      }
    | null
    | undefined,
): void {
  if (!toolCall || toolCall.providerExecuted !== true) {
    return
  }

  const toolCallId =
    typeof toolCall.toolCallId === 'string' &&
    toolCall.toolCallId.trim().length > 0
      ? toolCall.toolCallId
      : null
  if (!toolCallId) {
    return
  }

  actionToolCallIds.add(toolCallId)
}

function filterOpenAiCompatibleMurphAiSdkTools(input: {
  tools: ToolSet | null
  useMurphWebReadTools: boolean
  useMurphWebSearch: boolean
}): ToolSet | null {
  if (!input.tools) {
    return null
  }

  const filteredEntries = Object.entries(input.tools).filter(([name]) => {
    if (name === 'web.search') {
      return input.useMurphWebSearch
    }

    if (name === 'web.fetch' || name === 'web.pdf.read') {
      return input.useMurphWebReadTools
    }

    return true
  })

  return filteredEntries.length > 0 ? Object.fromEntries(filteredEntries) : null
}

function remapOpenAiCompatibleToolNames(tools: ToolSet | null): ToolSet {
  if (!tools) {
    return {}
  }

  const remapped: ToolSet = {}
  const aliases = resolveOpenAiCompatibleProviderVisibleToolAliases(
    Object.keys(tools),
  )

  for (const [name, definition] of Object.entries(tools)) {
    remapped[aliases[name] ?? resolveOpenAiCompatibleProviderVisibleToolName(name)] =
      definition
  }

  return remapped
}

export function resolveOpenAiCompatibleProviderVisibleToolAliases(
  toolNames: readonly string[],
): Record<string, string> {
  const aliases: Record<string, string> = {}
  const seenNames = new Set<string>()

  for (const name of toolNames) {
    const baseName = resolveOpenAiCompatibleProviderVisibleToolName(name)
    let nextName = baseName
    let suffix = 2

    while (seenNames.has(nextName)) {
      nextName = `${baseName}_${suffix}`
      suffix += 1
    }

    seenNames.add(nextName)
    aliases[name] = nextName
  }

  return aliases
}

export function resolveOpenAiCompatibleProviderVisibleToolName(name: string): string {
  return sanitizeOpenAiCompatibleToolName(name)
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

function normalizeOpenAiCompatibleResponsesProviderSessionId(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)
  return normalized?.startsWith('resp_') === true ? normalized : null
}

function resolveOpenAiCompatibleEffectiveResumeProviderSessionId(input: {
  providerConfig: AssistantProviderConfig
  resumeProviderSessionId: string | null | undefined
  usesResponsesApi: boolean
}): string | null {
  if (!input.usesResponsesApi) {
    return normalizeNullableString(input.resumeProviderSessionId)
  }

  if (!shouldUseOpenAiCompatibleProviderState(input.providerConfig)) {
    return null
  }

  return normalizeOpenAiCompatibleResponsesProviderSessionId(
    input.resumeProviderSessionId,
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
  const normalizedResumeProviderSessionId =
    resolveOpenAiCompatibleEffectiveResumeProviderSessionId(input)
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

export function isOpenAiCompatibleVercelAiGatewayTarget(
  target: OpenAiCompatibleTargetIdentity,
): boolean {
  return isVercelAiGatewayBaseUrl(target.baseUrl)
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
  return isAssistantVercelAIGatewayBaseUrl(value)
}

function isOpenAiCompatibleOpenAiWebSearchTarget(
  target: OpenAiCompatibleTargetIdentity,
): boolean {
  const normalizedBaseUrl = normalizeNullableString(target.baseUrl)
  if (normalizedBaseUrl) {
    return isAssistantOpenAIBaseUrl(normalizedBaseUrl)
  }

  const presetId = normalizeNullableString(target.presetId)
  const providerName = normalizeNullableString(target.providerName)?.toLowerCase()
  return presetId === 'openai' || providerName === 'openai'
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
