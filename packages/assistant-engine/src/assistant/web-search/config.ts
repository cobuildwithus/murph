import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeNullableString } from '../shared.js'

import { normalizeAssistantDomainFilters } from './results.js'
import {
  assistantWebSearchFreshnessValues,
  assistantWebSearchProviderValues,
  type AssistantConfiguredWebSearchProvider,
  type AssistantWebSearchFreshness,
  type AssistantWebSearchProvider,
  type AssistantWebSearchRequest,
  type AssistantWebSearchRuntimeContext,
  type NormalizedAssistantWebSearchRequest,
} from './types.js'

const assistantConfiguredWebSearchProviderPreference: readonly AssistantConfiguredWebSearchProvider[] = [
  'searxng',
  'brave',
  'exa',
  'kagi',
  'perplexity',
  'serpapi',
  'tavily',
]

const ASSISTANT_WEB_SEARCH_DEFAULT_MAX_RESULTS = 5
const ASSISTANT_WEB_SEARCH_MAX_RESULTS = 10
const ASSISTANT_WEB_SEARCH_DEFAULT_TIMEOUT_MS = 12_000
const ASSISTANT_WEB_SEARCH_MIN_TIMEOUT_MS = 1_000
const ASSISTANT_WEB_SEARCH_MAX_TIMEOUT_MS = 60_000

export function resolveConfiguredAssistantWebSearchProvider(
  env: NodeJS.ProcessEnv = process.env,
): AssistantConfiguredWebSearchProvider | null {
  const configuredProviders = listConfiguredAssistantWebSearchProviders(env)
  const envOverride = readAssistantWebSearchProviderOverride(env)

  if (envOverride && envOverride !== 'auto') {
    return configuredProviders.includes(envOverride) ? envOverride : null
  }

  return configuredProviders[0] ?? null
}

function listConfiguredAssistantWebSearchProviders(
  env: NodeJS.ProcessEnv,
): AssistantConfiguredWebSearchProvider[] {
  const configuredProviders: AssistantConfiguredWebSearchProvider[] = []

  for (const provider of assistantConfiguredWebSearchProviderPreference) {
    if (isAssistantWebSearchProviderConfigured(provider, env)) {
      configuredProviders.push(provider)
    }
  }

  return configuredProviders
}

function isAssistantWebSearchProviderConfigured(
  provider: AssistantConfiguredWebSearchProvider,
  env: NodeJS.ProcessEnv,
): boolean {
  switch (provider) {
    case 'brave':
      return readAssistantWebSearchApiKey(env.BRAVE_API_KEY) !== null
    case 'exa':
      return readAssistantWebSearchApiKey(env.EXA_API_KEY) !== null
    case 'kagi':
      return (
        readAssistantWebSearchApiKey(env.KAGI_API_KEY) !== null ||
        readAssistantWebSearchApiKey(env.KAGI_API_TOKEN) !== null
      )
    case 'perplexity':
      return readAssistantWebSearchApiKey(env.PERPLEXITY_API_KEY) !== null
    case 'serpapi':
      return readAssistantWebSearchApiKey(env.SERPAPI_API_KEY) !== null
    case 'searxng':
      return resolveAssistantSearxngBaseUrl(env) !== null
    case 'tavily':
      return readAssistantWebSearchApiKey(env.TAVILY_API_KEY) !== null
  }
}

export function normalizeAssistantWebSearchRequest(
  request: AssistantWebSearchRequest,
  env: NodeJS.ProcessEnv,
): NormalizedAssistantWebSearchRequest {
  const query = normalizeNullableString(request.query)
  if (!query) {
    throw new VaultCliError(
      'WEB_SEARCH_QUERY_INVALID',
      'web.search requires a non-empty query string.',
    )
  }

  const count = Math.max(
    1,
    Math.min(
      Math.trunc(request.count ?? resolveAssistantWebSearchMaxResults(env)),
      resolveAssistantWebSearchMaxResults(env),
      ASSISTANT_WEB_SEARCH_MAX_RESULTS,
    ),
  )
  const country = normalizeNullableString(request.country)
  const language = normalizeNullableString(request.language)
  const freshness = isAssistantWebSearchFreshness(request.freshness)
    ? request.freshness
    : null
  const dateAfter = normalizeNullableString(request.dateAfter)
  const dateBefore = normalizeNullableString(request.dateBefore)
  const warnings: string[] = []

  if ((dateAfter || dateBefore) && freshness) {
    warnings.push(
      'Ignored freshness because explicit dateAfter/dateBefore filters were provided.',
    )
  }

  return {
    query,
    count,
    provider: isAssistantWebSearchProvider(request.provider)
      ? request.provider
      : null,
    country,
    language,
    freshness,
    dateAfter,
    dateBefore,
    domainFilter: normalizeAssistantDomainFilters(request.domainFilter),
    signal: request.signal,
    warnings,
  }
}

export function resolveAssistantWebSearchProvider(input: {
  env: NodeJS.ProcessEnv
  requestedProvider: AssistantWebSearchProvider | null
}): AssistantConfiguredWebSearchProvider {
  if (input.requestedProvider && input.requestedProvider !== 'auto') {
    if (isAssistantWebSearchProviderConfigured(input.requestedProvider, input.env)) {
      return input.requestedProvider
    }

    throw new VaultCliError(
      'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      `web.search provider ${input.requestedProvider} is not configured in this runtime.`,
    )
  }

  const envOverride = readAssistantWebSearchProviderOverride(input.env)
  if (envOverride && envOverride !== 'auto') {
    if (isAssistantWebSearchProviderConfigured(envOverride, input.env)) {
      return envOverride
    }

    throw new VaultCliError(
      'WEB_SEARCH_PROVIDER_UNCONFIGURED',
      `MURPH_WEB_SEARCH_PROVIDER is set to ${envOverride}, but that provider is not configured.`,
    )
  }

  const configuredProvider = resolveConfiguredAssistantWebSearchProvider(input.env)
  if (configuredProvider) {
    return configuredProvider
  }

  throw new VaultCliError(
    'WEB_SEARCH_UNAVAILABLE',
    'web.search is unavailable because no search provider is configured for this runtime.',
  )
}

export function createAssistantWebSearchRuntimeContext(
  env: NodeJS.ProcessEnv,
): AssistantWebSearchRuntimeContext {
  return {
    env,
    fetchImplementation: async (input, init) => await fetch(input, init),
    timeoutMs: resolveAssistantWebSearchTimeoutMs(env),
  }
}

function readAssistantWebSearchProviderOverride(
  env: NodeJS.ProcessEnv,
): AssistantWebSearchProvider | null {
  const normalized = normalizeNullableString(env.MURPH_WEB_SEARCH_PROVIDER)
  return isAssistantWebSearchProvider(normalized) ? normalized : null
}

function resolveAssistantWebSearchMaxResults(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_SEARCH_MAX_RESULTS',
    fallback: ASSISTANT_WEB_SEARCH_DEFAULT_MAX_RESULTS,
    min: 1,
    max: ASSISTANT_WEB_SEARCH_MAX_RESULTS,
  })
}

function resolveAssistantWebSearchTimeoutMs(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_SEARCH_TIMEOUT_MS',
    fallback: ASSISTANT_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
    min: ASSISTANT_WEB_SEARCH_MIN_TIMEOUT_MS,
    max: ASSISTANT_WEB_SEARCH_MAX_TIMEOUT_MS,
  })
}

export function resolveAssistantSearxngBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  const normalized = normalizeNullableString(env.SEARXNG_BASE_URL)
  if (!normalized) {
    return null
  }

  try {
    const parsed = new URL(normalized)
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
    return parsed.toString().replace(/\/+$/u, '')
  } catch {
    return null
  }
}

export function readRequiredAssistantWebSearchApiKey(
  value: string | undefined,
  provider: AssistantConfiguredWebSearchProvider,
  envKey: string,
): string {
  const normalized = readAssistantWebSearchApiKey(value)
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'WEB_SEARCH_PROVIDER_UNCONFIGURED',
    `web.search provider ${provider} requires ${envKey}.`,
  )
}

export function readAssistantWebSearchApiKey(
  value: string | undefined,
): string | null {
  return normalizeNullableString(value)
}

function readAssistantBoundedIntegerEnv(input: {
  env: NodeJS.ProcessEnv
  fallback: number
  key: string
  max: number
  min: number
}): number {
  const raw = normalizeNullableString(input.env[input.key])
  if (!raw) {
    return input.fallback
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed)) {
    return input.fallback
  }

  return Math.min(Math.max(parsed, input.min), input.max)
}

function isAssistantWebSearchProvider(
  value: string | null | undefined,
): value is AssistantWebSearchProvider {
  return (
    typeof value === 'string' &&
    (assistantWebSearchProviderValues as readonly string[]).includes(value)
  )
}

function isAssistantWebSearchFreshness(
  value: string | null | undefined,
): value is AssistantWebSearchFreshness {
  return (
    typeof value === 'string' &&
    (assistantWebSearchFreshnessValues as readonly string[]).includes(value)
  )
}
