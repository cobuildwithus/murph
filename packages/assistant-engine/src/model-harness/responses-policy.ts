import type { AssistantModelSpec } from './model-spec.js'

export interface AssistantResponsesRequestPolicy {
  gatewayOnlyProviders?: readonly string[] | null
  gatewayReporting?: {
    tags?: readonly string[]
    user?: string | null
  }
  gatewayZeroDataRetention?: boolean
}

const OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD = 200_000
const ASSISTANT_RESPONSES_AUTO_COMPACTION_CONTEXT = Object.freeze([
  {
    type: 'compaction',
    compact_threshold: OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD,
  },
] as const)

type AssistantFetchInput = Parameters<typeof fetch>[0]
type AssistantFetchInit = Parameters<typeof fetch>[1]

export function createAssistantResponsesFetch(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return async (input: AssistantFetchInput, init?: AssistantFetchInit) => {
    const nextInit = await maybeMutateAssistantResponsesRequest(requestPolicy, input, init)
    return await baseFetch(input, nextInit)
  }
}

export async function maybeMutateAssistantResponsesRequest(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): Promise<AssistantFetchInit | undefined> {
  if (!shouldMutateAssistantResponsesRequest(input, init)) {
    return init
  }

  const body = await readAssistantFetchBody(input, init)
  if (!body) {
    return init
  }

  let payload: Record<string, unknown>

  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return init
  }

  const nextPayload = applyAssistantResponsesRequestPolicy(payload, requestPolicy)
  if (!nextPayload) {
    return init
  }

  return {
    ...init,
    body: JSON.stringify(nextPayload),
  }
}

export function applyAssistantResponsesRequestPolicy(
  payload: Record<string, unknown>,
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
): Record<string, unknown> | null {
  let nextPayload: Record<string, unknown> | null = null

  if (!('context_management' in payload)) {
    nextPayload = {
      ...payload,
      context_management: ASSISTANT_RESPONSES_AUTO_COMPACTION_CONTEXT,
    }
  }

  const gatewayOptions = resolveAssistantGatewayRequestOptions(requestPolicy)

  if (gatewayOptions) {
    const currentProviderOptions = nextPayload?.providerOptions ?? payload.providerOptions
    const nextProviderOptions = isAssistantPlainObject(currentProviderOptions)
      ? {
          ...currentProviderOptions,
        }
      : {}
    const currentGatewayOptions = isAssistantPlainObject(nextProviderOptions.gateway)
      ? {
          ...nextProviderOptions.gateway,
        }
      : {}
    const nextGatewayOptions = {
      ...currentGatewayOptions,
      ...gatewayOptions,
    }

    nextProviderOptions.gateway = nextGatewayOptions
    nextPayload = {
      ...(nextPayload ?? payload),
      providerOptions: nextProviderOptions,
    }
  }

  return nextPayload
}

export function resolveAssistantGatewayRequestOptions(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
): Record<string, unknown> | null {
  const gatewayOptions: Record<string, unknown> = {}

  if (requestPolicy?.gatewayZeroDataRetention === true) {
    gatewayOptions.zeroDataRetention = true
  }

  const only = normalizeGatewayProviderSlugs(
    requestPolicy?.gatewayOnlyProviders ?? [],
  )
  if (only.length > 0) {
    gatewayOptions.only = only
  }

  const reporting = requestPolicy?.gatewayReporting
  const user = normalizeGatewayReportingString(reporting?.user ?? null)
  const tags = normalizeGatewayReportingTags(reporting?.tags ?? [])

  if (user) {
    gatewayOptions.user = user
  }

  if (tags.length > 0) {
    gatewayOptions.tags = tags
  }

  return Object.keys(gatewayOptions).length > 0 ? gatewayOptions : null
}

export function shouldMutateAssistantResponsesRequest(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): boolean {
  const url = readAssistantFetchUrl(input)
  if (!url) {
    return false
  }

  const method = (
    init?.method ??
    (input instanceof Request ? input.method : 'POST')
  ).toUpperCase()

  if (method !== 'POST') {
    return false
  }

  try {
    return new URL(url).pathname.endsWith('/responses')
  } catch {
    return false
  }
}

export function resolveAssistantApiKey(spec: AssistantModelSpec): string | undefined {
  if (typeof spec.apiKey === 'string' && spec.apiKey.length > 0) {
    return spec.apiKey
  }

  if ('apiKeyEnvValue' in spec) {
    return typeof spec.apiKeyEnvValue === 'string' && spec.apiKeyEnvValue.length > 0
      ? spec.apiKeyEnvValue
      : undefined
  }

  if (typeof spec.apiKeyEnv === 'string' && spec.apiKeyEnv.length > 0) {
    const value = process.env[spec.apiKeyEnv]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return undefined
}

function normalizeGatewayProviderSlugs(providers: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalizedProviders: string[] = []

  for (const provider of providers) {
    const normalized = normalizeGatewayReportingString(provider)?.toLowerCase() ?? null
    if (
      !normalized ||
      !/^[a-z0-9][a-z0-9._-]*$/u.test(normalized) ||
      seen.has(normalized)
    ) {
      continue
    }

    seen.add(normalized)
    normalizedProviders.push(normalized)
  }

  return normalizedProviders
}

function normalizeGatewayReportingString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeGatewayReportingTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalizedTags: string[] = []

  for (const tag of tags) {
    const normalized = normalizeGatewayReportingString(tag)

    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    normalizedTags.push(normalized)
  }

  return normalizedTags
}

function readAssistantFetchUrl(
  input: AssistantFetchInput,
): string | null {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  if (input instanceof Request) {
    return input.url
  }

  return null
}

async function readAssistantFetchBody(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): Promise<string | null> {
  if (typeof init?.body === 'string') {
    return init.body
  }

  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return null
    }
  }

  return null
}

function isAssistantPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
