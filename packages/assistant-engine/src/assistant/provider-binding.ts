import type {
  AssistantChatProvider,
  AssistantProviderBinding,
  AssistantProviderSessionOptions,
  AssistantSessionProviderState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeAssistantProviderBinding,
  readAssistantProviderResumeRouteId,
  readAssistantProviderSessionId,
  writeAssistantProviderStateResumeRouteId,
} from './provider-state.js'
import type { ResolvedAssistantFailoverRoute } from './failover.js'
import { normalizeNullableString } from './shared.js'

export function resolveAssistantProviderResumeKey(input: {
  binding: AssistantProviderBinding | null
  provider: AssistantChatProvider
}): string | null {
  if (!input.binding || input.binding.provider !== input.provider) {
    return null
  }

  return input.binding.providerSessionId
}

export function resolveAssistantRouteResumeBinding(input: {
  route: ResolvedAssistantFailoverRoute
  sessionBinding: AssistantProviderBinding | null
}): AssistantProviderBinding | null {
  if (
    doesAssistantResumeBindingMatchRoute({
      binding: input.sessionBinding,
      route: input.route,
    })
  ) {
    return input.sessionBinding
  }

  return null
}

export function doesAssistantResumeBindingMatchRoute(input: {
  binding: AssistantProviderBinding | null
  route: ResolvedAssistantFailoverRoute
}): boolean {
  if (input.binding?.provider !== input.route.provider) {
    return false
  }

  const storedRouteId = readAssistantProviderResumeRouteId({
    providerBinding: input.binding,
  })
  if (storedRouteId === null) {
    return false
  }

  if (storedRouteId === input.route.routeId) {
    return true
  }

  return areAssistantProviderOptionsCompatible({
    current: input.route.providerOptions,
    stored: input.binding.providerOptions,
  })
}

export function resolveNextAssistantProviderBinding(input: {
  previousBinding: AssistantProviderBinding | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
  providerSessionId: string | null
  providerState: AssistantSessionProviderState | null
  routeId: string | null
}): AssistantProviderBinding {
  const previousBinding =
    input.previousBinding?.provider === input.provider
      ? input.previousBinding
      : null
  const nextProviderSessionId = resolveNextAssistantProviderSessionId({
    previousBinding,
    providerSessionId: input.providerSessionId,
    routeId: input.routeId,
  })

  return normalizeAssistantProviderBinding({
    provider: input.provider,
    providerOptions: input.providerOptions,
    providerSessionId: nextProviderSessionId,
    providerState: resolveNextAssistantProviderState({
      previousBinding,
      providerSessionId: nextProviderSessionId,
      providerState: input.providerState ?? null,
      routeId: input.routeId,
    }) as AssistantProviderBinding['providerState'],
  }) as AssistantProviderBinding
}

export function buildRecoveredAssistantProviderBindingSeed(input: {
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
}): AssistantProviderBinding {
  return normalizeAssistantProviderBinding({
    provider: input.provider,
    providerOptions: input.providerOptions,
    providerSessionId: null,
    providerState: null,
  }) as AssistantProviderBinding
}

function resolveNextAssistantProviderSessionId(input: {
  previousBinding: AssistantProviderBinding | null
  providerSessionId: string | null
  routeId: string | null
}): string | null {
  if (input.providerSessionId !== null) {
    return input.providerSessionId
  }

  if (
    input.previousBinding &&
    readAssistantProviderResumeRouteId({
      providerBinding: input.previousBinding,
    }) === input.routeId
  ) {
    return readAssistantProviderSessionId({
      providerBinding: input.previousBinding,
    })
  }

  return null
}

function resolveNextAssistantProviderState(input: {
  previousBinding: AssistantProviderBinding | null
  providerSessionId: string | null
  providerState: AssistantSessionProviderState | null
  routeId: string | null
}): AssistantSessionProviderState | null {
  void input.previousBinding
  void input.providerState

  if (input.providerSessionId === null) {
    return null
  }

  const previousProviderSessionId = input.previousBinding
    ? readAssistantProviderSessionId({
        providerBinding: input.previousBinding,
      })
    : null
  const previousResumeRouteId = input.previousBinding
    ? readAssistantProviderResumeRouteId({
        providerBinding: input.previousBinding,
      })
    : null

  if (
    previousProviderSessionId !== null &&
    previousProviderSessionId === input.providerSessionId &&
    previousResumeRouteId !== null
  ) {
    return writeAssistantProviderStateResumeRouteId(null, previousResumeRouteId)
  }

  return writeAssistantProviderStateResumeRouteId(null, input.routeId)
}

function areAssistantProviderOptionsCompatible(input: {
  current: AssistantProviderSessionOptions
  stored: AssistantProviderSessionOptions
}): boolean {
  return (
    nullableValuesMatch(input.stored.model, input.current.model) &&
    nullableValuesMatch(
      input.stored.reasoningEffort,
      input.current.reasoningEffort,
    ) &&
    nullableValuesMatch(input.stored.sandbox, input.current.sandbox) &&
    nullableValuesMatch(
      input.stored.approvalPolicy,
      input.current.approvalPolicy,
    ) &&
    nullableValuesMatch(input.stored.profile, input.current.profile) &&
    input.stored.oss === input.current.oss &&
    // Older Codex bindings often omitted codexHome, but that local state path
    // is not part of the remote provider identity we need to preserve on resume.
    nullableValuesCompatible(input.stored.codexHome, input.current.codexHome) &&
    nullableValuesMatch(input.stored.baseUrl, input.current.baseUrl) &&
    nullableValuesMatch(input.stored.apiKeyEnv, input.current.apiKeyEnv) &&
    nullableValuesMatch(
      input.stored.providerName,
      input.current.providerName,
    ) &&
    headersMatch(input.stored.headers, input.current.headers)
  )
}

function nullableValuesMatch(
  stored: string | null | undefined,
  current: string | null | undefined,
): boolean {
  return (
    (normalizeNullableString(stored) ?? null) ===
    (normalizeNullableString(current) ?? null)
  )
}

function nullableValuesCompatible(
  stored: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const normalizedStored = normalizeNullableString(stored)
  if (normalizedStored === null) {
    return true
  }

  return normalizedStored === (normalizeNullableString(current) ?? null)
}

function headersMatch(
  stored: Record<string, string> | null | undefined,
  current: Record<string, string> | null | undefined,
): boolean {
  return (
    serializeHeaders(stored) ===
    serializeHeaders(current)
  )
}

function serializeHeaders(
  value: Record<string, string> | null | undefined,
): string {
  if (!value || Object.keys(value).length === 0) {
    return '[]'
  }

  return JSON.stringify(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
}
