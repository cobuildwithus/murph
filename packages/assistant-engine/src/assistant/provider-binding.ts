import type {
  AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from './shared.js'
import type { ResolvedAssistantProviderRoute } from './provider-route.js'

export function resolveAssistantProviderResumeKey(input: {
  resumeState: AssistantSessionResumeState | null
}): string | null {
  if (!input.resumeState) {
    return null
  }

  return input.resumeState.providerSessionId
}

export function resolveAssistantRouteResumeBinding(input: {
  route: ResolvedAssistantProviderRoute
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
  route: ResolvedAssistantProviderRoute
}): boolean {
  const storedRouteId = normalizeNullableString(
    input.resumeState?.resumeRouteId,
  )
  if (storedRouteId === null) {
    return false
  }

  // Minimal resume state stores only the provider session id plus the exact
  // provider route id that minted it. Cross-route compatibility guesses can
  // resume the wrong upstream session across route changes, so exact matches are the
  // only safe contract.
  return storedRouteId === input.route.routeId
}
