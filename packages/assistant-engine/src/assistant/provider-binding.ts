import type {
  AssistantChatProvider,
  AssistantProviderBinding,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  readAssistantProviderResumeRouteId,
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
