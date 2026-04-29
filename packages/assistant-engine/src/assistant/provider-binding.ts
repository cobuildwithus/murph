import type {
  AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from './shared.js'
import type { CodexThreadIdentity } from './provider-route.js'

export function resolveAssistantProviderResumeKey(input: {
  resumeState: AssistantSessionResumeState | null
}): string | null {
  if (!input.resumeState) {
    return null
  }

  return input.resumeState.providerSessionId
}

export function resolveAssistantRouteResumeBinding(input: {
  route: CodexThreadIdentity
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
  route: CodexThreadIdentity
}): boolean {
  const storedRouteId = normalizeNullableString(
    input.resumeState?.resumeRouteId,
  )
  if (storedRouteId === null) {
    return false
  }

  // Minimal resume state stores only the Codex thread id plus the exact route
  // fingerprint that minted it. Cross-route guesses can resume the wrong
  // upstream thread after target changes, so exact matches are the only safe
  // contract.
  return storedRouteId === input.route.routeId
}
