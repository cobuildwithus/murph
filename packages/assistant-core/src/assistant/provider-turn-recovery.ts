import {
  assistantProviderBindingSchema,
  type AssistantChatProvider,
  type AssistantProviderBinding,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  normalizeAssistantSessionSnapshot,
  writeAssistantProviderResumeRouteId,
} from './provider-state.js'

export async function recoverAssistantSessionAfterProviderFailure(input: {
  error: unknown
  provider: AssistantChatProvider
  providerOptions: AssistantSession['providerOptions']
  providerBinding: NonNullable<AssistantSession['providerBinding']>
  routeId: string
  session: AssistantSession
  vault: string
}): Promise<AssistantSession | null> {
  if (!shouldRecoverAssistantSessionAfterProviderFailure(input.error)) {
    return null
  }

  const providerSessionId = extractRecoveredProviderSessionId(input.error)
  const currentProviderBinding = input.session.providerBinding
  if (
    !providerSessionId ||
    (currentProviderBinding?.provider === input.provider &&
      currentProviderBinding.providerSessionId === providerSessionId)
  ) {
    return null
  }

  try {
    const recoveredAt = new Date().toISOString()
    const recoveredProviderBinding = assistantProviderBindingSchema.parse(
      buildRecoveredProviderBinding({
        provider: input.provider,
        providerBinding: input.providerBinding,
        providerOptions: input.providerOptions,
        providerSessionId,
        routeId: input.routeId,
      }),
    )
    const recoveredSession = normalizeAssistantSessionSnapshot({
      ...input.session,
      providerBinding: recoveredProviderBinding,
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

function buildRecoveredProviderBinding(input: {
  provider: AssistantChatProvider
  providerBinding: NonNullable<AssistantSession['providerBinding']>
  providerOptions: AssistantSession['providerOptions']
  providerSessionId: string
  routeId: string
}): AssistantProviderBinding {
  const seededBinding = assistantProviderBindingSchema.parse({
    ...input.providerBinding,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    providerOptions: input.providerOptions,
    providerState: null,
  })

  return (
    writeAssistantProviderResumeRouteId(seededBinding, input.routeId) ?? seededBinding
  )
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
