export function annotateRecoveredCodexThreadIdForDiagnostics(
  error: unknown,
): void {
  if (!shouldAnnotateRecoveredCodexThreadIdForDiagnostics(error)) {
    return
  }

  const codexThreadId = extractRecoveredCodexThreadId(error)
  if (!codexThreadId) {
    return
  }

  attachRecoveredCodexThreadId(error, codexThreadId)
}

export function extractRecoveredCodexThreadId(error: unknown): string | null {
  const context = readAssistantProviderErrorContext(error)
  const codexThreadId = context?.codexThreadId
  return (
    typeof codexThreadId === 'string' && codexThreadId.trim().length > 0
      ? codexThreadId.trim()
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

function shouldAnnotateRecoveredCodexThreadIdForDiagnostics(
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

function attachRecoveredCodexThreadId(
  error: unknown,
  codexThreadId: string,
): void {
  if (!error || typeof error !== 'object') {
    return
  }

  const currentContext = readAssistantProviderErrorContext(error) ?? {}
  ;(error as { context?: Record<string, unknown> }).context = {
    ...currentContext,
    recoveredCodexThreadId: codexThreadId,
  }
}
