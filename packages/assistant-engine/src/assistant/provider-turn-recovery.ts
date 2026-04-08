import {
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  normalizeAssistantSessionSnapshot,
  readAssistantProviderSessionId,
  writeAssistantProviderResumeRouteId,
  writeAssistantSessionProviderSessionId,
} from './provider-state.js'

export async function recoverAssistantSessionAfterProviderFailure(input: {
  error: unknown
  routeId: string
  session: AssistantSession
  vault: string
}): Promise<AssistantSession | null> {
  if (!shouldRecoverAssistantSessionAfterProviderFailure(input.error)) {
    return null
  }

  const providerSessionId = extractRecoveredProviderSessionId(input.error)
  if (
    !providerSessionId ||
    readAssistantProviderSessionId(input.session) === providerSessionId
  ) {
    return null
  }

  try {
    const recoveredAt = new Date().toISOString()
    const recoveredSession = normalizeAssistantSessionSnapshot({
      ...input.session,
      resumeState: buildRecoveredProviderResumeState({
        providerSessionId,
        resumeState: input.session.resumeState,
        routeId: input.routeId,
      }),
      updatedAt: recoveredAt,
    })
    return await createAssistantRuntimeStateService(input.vault).sessions.save(
      recoveredSession,
    )
  } catch {
    return null
  }
}

export function attachRecoveredAssistantSession(
  error: unknown,
  session: AssistantSession | null,
): void {
  if (!session || !error || typeof error !== 'object') {
    return
  }

  const currentContext = readAssistantProviderErrorContext(error) ?? {}
  ;(error as { context?: Record<string, unknown> }).context = {
    ...currentContext,
    assistantSession: session,
  }
}

export function extractRecoveredAssistantSession(
  error: unknown,
): AssistantSession | null {
  const context = readAssistantProviderErrorContext(error)
  if (!context) {
    return null
  }

  const recovered = context.assistantSession
  if (!recovered || typeof recovered !== 'object') {
    return null
  }

  try {
    return normalizeAssistantSessionSnapshot(recovered as AssistantSession)
  } catch {
    return null
  }
}

export function extractRecoveredProviderSessionId(error: unknown): string | null {
  const context = readAssistantProviderErrorContext(error)
  const providerSessionId = context?.providerSessionId
  return (
    typeof providerSessionId === 'string' && providerSessionId.trim().length > 0
      ? providerSessionId.trim()
      : null
  )
}

export function isAssistantProviderConnectionLostError(
  error: unknown,
): boolean {
  const context = readAssistantProviderErrorContext(error)
  return Boolean(
    context &&
      (context.connectionLost === true ||
        context.recoverableConnectionLoss === true),
  )
}

export function isAssistantProviderStalledError(error: unknown): boolean {
  const context = readAssistantProviderErrorContext(error)
  return Boolean(context && context.providerStalled === true)
}

export function isAssistantProviderInterruptedError(error: unknown): boolean {
  const context = readAssistantProviderErrorContext(error)
  return Boolean(context && context.interrupted === true)
}

function shouldRecoverAssistantSessionAfterProviderFailure(
  error: unknown,
): boolean {
  return (
    isAssistantProviderConnectionLostError(error) ||
    isAssistantProviderInterruptedError(error)
  )
}

function buildRecoveredProviderResumeState(input: {
  providerSessionId: string
  resumeState: AssistantSession['resumeState']
  routeId: string
}) {
  const seededState = writeAssistantSessionProviderSessionId(
    input.resumeState,
    input.providerSessionId,
  )
  return writeAssistantProviderResumeRouteId(seededState, input.routeId) ?? seededState
}

function readAssistantProviderErrorContext(
  error: unknown,
): Record<string, unknown> | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeContext = (error as { context?: unknown }).context
  return (
    maybeContext &&
    typeof maybeContext === 'object' &&
    !Array.isArray(maybeContext)
      ? (maybeContext as Record<string, unknown>)
      : null
  )
}
