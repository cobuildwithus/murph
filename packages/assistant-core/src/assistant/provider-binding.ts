import type {
  AssistantChatProvider,
  AssistantProviderBinding,
  AssistantProviderSessionOptions,
  AssistantSessionProviderState,
} from '../assistant-cli-contracts.js'
import {
  normalizeAssistantProviderBinding,
  readAssistantProviderResumeRouteId,
  readAssistantProviderSessionId,
  writeAssistantProviderStateResumeRouteId,
} from './provider-state.js'

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
  provider: AssistantChatProvider
  routeId: string
  sessionBinding: AssistantProviderBinding | null
}): AssistantProviderBinding | null {
  if (
    doesAssistantResumeBindingMatchRoute({
      binding: input.sessionBinding,
      provider: input.provider,
      routeId: input.routeId,
    })
  ) {
    return input.sessionBinding
  }

  return null
}

export function doesAssistantResumeBindingMatchRoute(input: {
  binding: AssistantProviderBinding | null
  provider: AssistantChatProvider
  routeId: string
}): boolean {
  if (input.binding?.provider !== input.provider) {
    return false
  }

  return (
    readAssistantProviderResumeRouteId({
      providerBinding: input.binding,
    }) === input.routeId
  )
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

  return writeAssistantProviderStateResumeRouteId(null, input.routeId)
}
