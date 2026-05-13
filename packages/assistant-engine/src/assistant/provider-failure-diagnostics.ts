export function annotateRecoveredCodexThreadIdForDiagnostics(
  error: unknown,
): void {
  if (!shouldAnnotateRecoveredCodexThreadIdForDiagnostics(error)) {
    sanitizePublicCodexThreadDiagnostics(error, {
      recoveredCodexThreadIdPresent: false,
    })
    return
  }

  const codexThreadId = extractRecoveredCodexThreadId(error)
  if (!codexThreadId) {
    sanitizePublicCodexThreadDiagnostics(error, {
      recoveredCodexThreadIdPresent: false,
    })
    return
  }

  sanitizePublicCodexThreadDiagnostics(error, {
    recoveredCodexThreadIdPresent: true,
  })
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

function sanitizePublicCodexThreadDiagnostics(
  error: unknown,
  options: {
    recoveredCodexThreadIdPresent: boolean
  },
): void {
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
  const previousRecoveredCodexThreadIdPresent =
    typeof recoveredCodexThreadId === 'string' &&
    recoveredCodexThreadId.trim().length > 0

  ;(error as { context?: Record<string, unknown> }).context = {
    ...safeContext,
    ...('codexThreadId' in currentContext
      ? { codexThreadIdPresent }
      : {}),
    ...(options.recoveredCodexThreadIdPresent ||
      previousRecoveredCodexThreadIdPresent
      ? { recoveredCodexThreadIdPresent: true }
      : {}),
  }
}
