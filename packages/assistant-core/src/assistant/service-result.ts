import {
  assistantCanonicalWriteBlockSchema,
  assistantAskResultSchema,
  type AssistantAskResult,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import { redactAssistantDisplayPath } from './store.js'
import { normalizeAssistantSessionSnapshot } from './provider-state.js'
import { redactAssistantSessionForDisplay } from './redaction.js'
import { isAssistantCanonicalWriteBlockedError } from './canonical-write-guard.js'

export function serializeAssistantSessionForResult(
  session: AssistantSession,
): AssistantSession {
  return redactAssistantSessionForDisplay(normalizeAssistantSessionSnapshot(session))
}

export function normalizeAssistantAskResultForReturn<T extends AssistantAskResult>(
  result: T,
): T {
  return assistantAskResultSchema.parse({
    ...result,
    session: serializeAssistantSessionForResult(result.session),
  }) as T
}

export function buildAssistantCanonicalWriteBlockedResult(input: {
  error: unknown
  prompt: string
  session: AssistantSession
  vault: string
}): AssistantAskResult | null {
  if (!isAssistantCanonicalWriteBlockedError(input.error)) {
    return null
  }

  const context =
    input.error.context &&
    typeof input.error.context === 'object' &&
    !Array.isArray(input.error.context)
      ? (input.error.context as Record<string, unknown>)
      : {}
  const blockedPaths = Array.isArray(context.paths)
    ? context.paths.filter((value): value is string => typeof value === 'string')
    : []

  return normalizeAssistantAskResultForReturn(assistantAskResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    status: 'blocked',
    prompt: input.prompt,
    response: '',
    session: serializeAssistantSessionForResult(input.session),
    delivery: null,
    deliveryDeferred: false,
    deliveryIntentId: null,
    deliveryError: null,
    blocked: assistantCanonicalWriteBlockSchema.parse({
      code: input.error.code,
      message: input.error.message,
      paths: blockedPaths,
      pathCount:
        typeof context.pathCount === 'number' && Number.isFinite(context.pathCount)
          ? Math.max(0, Math.trunc(context.pathCount))
          : blockedPaths.length,
      guardFailureReason:
        context.guardFailureReason === 'invalid_committed_payload' ||
        context.guardFailureReason === 'invalid_write_operation_metadata'
          ? context.guardFailureReason
          : null,
      guardFailurePath:
        typeof context.guardFailurePath === 'string' ? context.guardFailurePath : null,
      guardFailureMessage:
        typeof context.guardFailureMessage === 'string'
          ? context.guardFailureMessage
          : null,
      guardFailureCode:
        typeof context.guardFailureCode === 'string' ? context.guardFailureCode : null,
      guardFailureOperationId:
        typeof context.guardFailureOperationId === 'string'
          ? context.guardFailureOperationId
          : null,
      guardFailureTargetPath:
        typeof context.guardFailureTargetPath === 'string'
          ? context.guardFailureTargetPath
          : null,
      guardFailureActionKind:
        context.guardFailureActionKind === 'jsonl_append' ||
        context.guardFailureActionKind === 'text_write'
          ? context.guardFailureActionKind
          : null,
      providerErrorCode:
        typeof context.providerErrorCode === 'string' ? context.providerErrorCode : null,
      providerErrorMessage:
        typeof context.providerErrorMessage === 'string'
          ? context.providerErrorMessage
          : null,
    }),
  }))
}

export function buildBlockedAssistantTurnError(
  result: Pick<AssistantAskResult, 'blocked'>,
): { code: string; message: string } {
  return result.blocked
    ? {
        code: result.blocked.code,
        message: result.blocked.message,
      }
    : {
        code: 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED',
        message: 'Assistant turn was blocked by the canonical write guard.',
      }
}
