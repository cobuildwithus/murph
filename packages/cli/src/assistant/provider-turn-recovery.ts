import {
  assistantSessionSchema,
  type AssistantChatProvider,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import { saveAssistantSession } from './store.js'

export async function recoverAssistantSessionAfterProviderFailure(input: {
  codexPromptVersion?: string | null
  error: unknown
  provider: AssistantChatProvider
  providerOptions: AssistantSession['providerOptions']
  session: AssistantSession
  vault: string
}): Promise<AssistantSession | null> {
  if (!shouldRecoverAssistantSessionAfterProviderFailure(input.error)) {
    return null
  }

  const providerSessionId = extractRecoveredProviderSessionId(input.error)
  if (!providerSessionId || providerSessionId === input.session.providerSessionId) {
    return null
  }

  try {
    return await saveAssistantSession(input.vault, {
      ...input.session,
      provider: input.provider,
      providerSessionId,
      codexPromptVersion:
        input.provider === 'codex-cli'
          ? input.codexPromptVersion ?? input.session.codexPromptVersion ?? null
          : null,
      providerOptions: input.providerOptions,
      updatedAt: new Date().toISOString(),
    })
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

  try {
    return assistantSessionSchema.parse(context.assistantSession)
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

function readAssistantProviderErrorContext(
  error: unknown,
): Record<string, unknown> | null {
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return null
  }

  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null
  }

  return context as Record<string, unknown>
}
