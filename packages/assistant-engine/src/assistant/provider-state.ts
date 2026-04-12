import { z } from 'zod'
import {
  assistantPersistedSessionSchema,
  assistantProviderBindingSchema,
  assistantSessionResumeStateSchema,
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantProviderBinding,
  type AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import { assistantBackendTargetToProviderConfigInput } from '@murphai/operator-config/assistant-backend'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import { normalizeNullableString } from './shared.js'

export function readAssistantProviderResumeRouteId(input: {
  providerBinding?: AssistantProviderBinding | null
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeNullableString(resumeState?.resumeRouteId) ?? null
}

export function readAssistantProviderSessionId(input: {
  providerBinding?: AssistantProviderBinding | null
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeNullableString(resumeState?.providerSessionId) ?? null
}

export function readAssistantProviderBinding(
  input:
    | {
        providerBinding?: AssistantProviderBinding | null
        resumeState?: AssistantSessionResumeState | null
        target?: AssistantSession['target'] | null
      }
    | AssistantSession
    | null
    | undefined,
): AssistantProviderBinding | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  if ('providerBinding' in input && input.providerBinding) {
    return normalizeAssistantProviderBinding(input.providerBinding)
  }

  const target = 'target' in input ? input.target : null
  const resumeState =
    'resumeState' in input ? input.resumeState : 'resumeState' in (input as AssistantSession)
      ? (input as AssistantSession).resumeState
      : null
  if (!target) {
    return null
  }

  const normalizedResumeState = normalizeAssistantSessionResumeState(resumeState)
  if (!normalizedResumeState) {
    return null
  }
  const providerOptions = serializeAssistantProviderSessionOptions(
    assistantBackendTargetToProviderConfigInput(target),
  )

  return assistantProviderBindingSchema.parse({
    provider: target.adapter,
    providerOptions,
    providerSessionId: normalizedResumeState.providerSessionId,
    providerState:
      normalizedResumeState.resumeRouteId !== null
        ? {
            resumeRouteId: normalizedResumeState.resumeRouteId,
          }
        : null,
  })
}

export function readAssistantSessionResumeState(
  input:
    | {
        providerBinding?: AssistantProviderBinding | null
        resumeState?: AssistantSessionResumeState | null
      }
    | AssistantSession
    | null
    | undefined,
): AssistantSessionResumeState | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  if ('resumeState' in input) {
    const normalizedResumeState = normalizeAssistantSessionResumeState(input.resumeState)
    if (normalizedResumeState) {
      return normalizedResumeState
    }
  }

  return normalizeAssistantSessionResumeState(
    'providerBinding' in input && input.providerBinding
      ? {
          continuityFingerprint:
            input.providerBinding.providerOptions.continuityFingerprint ?? null,
          providerSessionId: input.providerBinding.providerSessionId,
          resumeRouteId: input.providerBinding.providerState?.resumeRouteId ?? null,
          resumeKind: input.providerBinding.providerOptions.resumeKind ?? null,
        }
      : null,
  )
}

export function writeAssistantProviderResumeRouteId(
  resumeState: AssistantSessionResumeState | null | undefined,
  routeId: string | null | undefined,
): AssistantSessionResumeState | null {
  return writeAssistantSessionResumeRouteId(resumeState, routeId)
}

export function writeAssistantProviderStateResumeRouteId(
  resumeState: AssistantSessionResumeState | null | undefined,
  routeId: string | null | undefined,
): AssistantSessionResumeState | null {
  return writeAssistantSessionResumeRouteId(resumeState, routeId)
}

export function writeAssistantSessionProviderSessionId(
  resumeState: AssistantSessionResumeState | null | undefined,
  providerSessionId: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  const normalizedProviderSessionId = normalizeNullableString(providerSessionId)
  const normalizedResumeRouteId = current?.resumeRouteId ?? null

  if (!normalizedProviderSessionId && !normalizedResumeRouteId) {
    return null
  }

  return assistantSessionResumeStateSchema.parse({
    continuityFingerprint: current?.continuityFingerprint ?? null,
    providerSessionId: normalizedProviderSessionId,
    resumeRouteId: normalizedResumeRouteId,
    resumeKind: current?.resumeKind ?? null,
  })
}

export function normalizeAssistantProviderBinding(
  value: AssistantProviderBinding | null | undefined,
): AssistantProviderBinding | null {
  if (!value) {
    return null
  }

  return assistantProviderBindingSchema.parse({
    ...value,
    providerSessionId: normalizeNullableString(value.providerSessionId) ?? null,
    providerState:
      value.providerState && normalizeNullableString(value.providerState.resumeRouteId)
        ? {
            resumeRouteId: normalizeNullableString(value.providerState.resumeRouteId),
          }
        : null,
  })
}

export function normalizeAssistantSessionResumeState(
  value: AssistantSessionResumeState | null | undefined,
): AssistantSessionResumeState | null {
  if (!value) {
    return null
  }

  const providerSessionId = normalizeNullableString(value.providerSessionId)
  const resumeRouteId = normalizeNullableString(value.resumeRouteId)

  return providerSessionId || resumeRouteId
    ? assistantSessionResumeStateSchema.parse({
        continuityFingerprint:
          normalizeNullableString(value.continuityFingerprint) ?? null,
        providerSessionId,
        resumeRouteId,
        resumeKind: normalizeNullableString(value.resumeKind) ?? null,
      })
    : null
}

export function normalizeAssistantSessionSnapshot(
  session: AssistantSession,
): AssistantSession {
  return parseAssistantSessionRecord(serializeAssistantSessionForPersistence(session))
}

export function serializeAssistantSessionForPersistence(
  session: AssistantSession,
): z.infer<typeof assistantPersistedSessionSchema> {
  const target = session.target
  if (!target) {
    throw new TypeError('Assistant session target is required.')
  }

  const bindingResumeState =
    session.providerBinding?.provider === target.adapter
      ? {
          continuityFingerprint:
            session.providerBinding.providerOptions.continuityFingerprint ?? null,
          providerSessionId: session.providerBinding.providerSessionId,
          resumeRouteId: session.providerBinding.providerState?.resumeRouteId ?? null,
          resumeKind: session.providerBinding.providerOptions.resumeKind ?? null,
        }
      : null
  const resumeState = normalizeAssistantSessionResumeState(
    session.resumeState ?? bindingResumeState,
  )

  return assistantPersistedSessionSchema.parse({
    schema: 'murph.assistant-session.v5',
    sessionId: session.sessionId,
    target,
    resumeState,
    alias: session.alias,
    binding: session.binding,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastTurnAt: session.lastTurnAt,
    turnCount: session.turnCount,
  })
}

function writeAssistantSessionResumeRouteId(
  resumeState: AssistantSessionResumeState | null | undefined,
  routeId: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  const normalizedRouteId = normalizeNullableString(routeId)
  const providerSessionId = current?.providerSessionId ?? null

  if (!providerSessionId && !normalizedRouteId) {
    return null
  }

  return assistantSessionResumeStateSchema.parse({
    continuityFingerprint: current?.continuityFingerprint ?? null,
    providerSessionId,
    resumeRouteId: normalizedRouteId,
    resumeKind: current?.resumeKind ?? null,
  })
}
