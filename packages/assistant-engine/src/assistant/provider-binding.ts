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

  // Minimal resume state stores only the provider session id plus the exact
  // failover route id that minted it. Cross-route compatibility guesses can
  // resume the wrong upstream session after failover, so exact matches are the
  // only safe contract.
  return storedRouteId === input.route.routeId
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
  routeId: string | null
}): AssistantSessionProviderState | null {
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
