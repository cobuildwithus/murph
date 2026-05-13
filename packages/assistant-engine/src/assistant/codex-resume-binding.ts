import type {
  AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeCodexResumeState,
} from '@murphai/operator-config/assistant/codex-resume-state'
import { normalizeNullableString } from './shared.js'
import {
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from './codex-thread-route.js'

export function resolveAssistantCodexResumeThreadId(input: {
  resumeState: unknown
}): string | null {
  const resumeState = normalizeCodexResumeState(input.resumeState)
  if (!resumeState) {
    return null
  }

  return resumeState.threadId
}

export function resolveAssistantRouteResumeBinding(input: {
  route: CodexThreadIdentity
  sessionResumeState: unknown
}): AssistantSessionResumeState | null {
  const sessionResumeState = normalizeCodexResumeState(input.sessionResumeState)
  if (
    doesAssistantResumeBindingMatchRoute({
      resumeState: sessionResumeState,
      route: input.route,
    })
  ) {
    return sessionResumeState
  }

  return null
}

export function doesAssistantResumeBindingMatchRoute(input: {
  resumeState: unknown
  route: CodexThreadIdentity
}): boolean {
  const resumeState = normalizeCodexResumeState(input.resumeState)
  const storedRouteId = normalizeNullableString(
    resumeState?.routeFingerprint,
  )
  if (storedRouteId === null) {
    return false
  }

  // Minimal resume state stores only the Codex thread id plus the exact route
  // fingerprint that minted it. Cross-route guesses can resume the wrong
  // upstream thread after target changes, so exact matches are the only safe
  // contract.
  return storedRouteId === readCodexThreadRouteFingerprint(input.route)
}
