import type {
  AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from './shared.js'
import type { ResolvedAssistantFailoverRoute } from './failover.js'

export function resolveAssistantProviderResumeKey(input: {
  resumeState: AssistantSessionResumeState | null
}): string | null {
  if (!input.resumeState) {
    return null
  }

  return input.resumeState.providerSessionId
}

export function resolveAssistantRouteResumeBinding(input: {
  route: ResolvedAssistantFailoverRoute
  sessionResumeState: AssistantSessionResumeState | null
}): AssistantSessionResumeState | null {
  if (
    doesAssistantResumeBindingMatchRoute({
      resumeState: input.sessionResumeState,
      route: input.route,
    })
  ) {
    return input.sessionResumeState
  }

  return null
}

export function doesAssistantResumeBindingMatchRoute(input: {
  resumeState: AssistantSessionResumeState | null
  route: ResolvedAssistantFailoverRoute
}): boolean {
  const storedRouteId = normalizeNullableString(
    input.resumeState?.resumeRouteId,
  )
  if (storedRouteId === null) {
    return false
  }

  // Minimal resume state stores only the provider session id plus the exact
  // failover route id that minted it. Cross-route compatibility guesses can
  // resume the wrong upstream session after failover, so exact matches are the
  // only safe contract.
  return storedRouteId === input.route.routeId
}
