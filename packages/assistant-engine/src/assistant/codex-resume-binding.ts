import type {
  AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeCodexResumeState,
} from '@murphai/operator-config/assistant/codex-resume-state'
import { normalizeNullableString } from './shared.js'
import {
  readCodexThreadCompatibilityFingerprint,
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

  const storedCompatibilityFingerprint = normalizeNullableString(
    resumeState?.threadCompatibilityFingerprint,
  )
  if (
    storedCompatibilityFingerprint !== null &&
    storedCompatibilityFingerprint ===
      readCodexThreadCompatibilityFingerprint(input.route)
  ) {
    return true
  }

  // Legacy resume state stores only the exact route that minted the thread.
  // Accept that proof once, then enrich the state before a model-only switch.
  return storedRouteId === readCodexThreadRouteFingerprint(input.route)
}

export function bindAssistantResumeStateToThreadCompatibility(input: {
  resumeState: unknown
  route: CodexThreadIdentity
}): AssistantSessionResumeState | null {
  const resumeState = normalizeCodexResumeState(input.resumeState)
  if (!resumeState) {
    return null
  }
  if (
    normalizeNullableString(resumeState.threadCompatibilityFingerprint) !== null ||
    normalizeNullableString(resumeState.routeFingerprint) !==
      readCodexThreadRouteFingerprint(input.route)
  ) {
    return resumeState
  }

  return {
    ...resumeState,
    threadCompatibilityFingerprint:
      readCodexThreadCompatibilityFingerprint(input.route),
  }
}
