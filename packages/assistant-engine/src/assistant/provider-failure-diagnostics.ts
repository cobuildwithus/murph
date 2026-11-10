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

export function sanitizePublicCodexThreadDiagnostics(error: unknown): void {
  if (!error || typeof error !== 'object') {
    return
  }

  const currentContext = readAssistantProviderErrorContext(error)
  if (!currentContext) {
    return
  }

  const {
    codexThreadId,
    recoveredCodexThreadId,
    ...safeContext
  } = currentContext
  const codexThreadIdPresent =
    typeof codexThreadId === 'string' && codexThreadId.trim().length > 0
  ;(error as { context?: Record<string, unknown> }).context = {
    ...safeContext,
    ...('codexThreadId' in currentContext
      ? { codexThreadIdPresent }
      : {}),
  }
}
