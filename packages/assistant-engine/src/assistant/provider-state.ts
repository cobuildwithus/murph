import { z } from 'zod'
import {
  assistantPersistedSessionSchema,
  assistantSessionResumeStateSchema,
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantProviderBinding,
  type AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
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
          providerSessionId: input.providerBinding.providerSessionId,
          resumeRouteId: input.providerBinding.providerState?.resumeRouteId ?? null,
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

export function writeAssistantSessionProviderSessionId(
  resumeState: AssistantSessionResumeState | null | undefined,
  providerSessionId: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  const normalizedProviderSessionId = normalizeNullableString(providerSessionId)
  if (!normalizedProviderSessionId) {
    return null
  }

  return assistantSessionResumeStateSchema.parse({
    providerSessionId: normalizedProviderSessionId,
    resumeRouteId: current?.resumeRouteId ?? null,
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

  if (!providerSessionId) {
    return null
  }

  return assistantSessionResumeStateSchema.parse({
    providerSessionId,
    resumeRouteId,
  })
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
          providerSessionId: session.providerBinding.providerSessionId,
          resumeRouteId: session.providerBinding.providerState?.resumeRouteId ?? null,
        }
      : null
  const resumeState = normalizeAssistantSessionResumeState(
    session.resumeState ?? bindingResumeState,
  )

  return assistantPersistedSessionSchema.parse({
    schema: 'murph.assistant-session.v1',
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
  const providerSessionId = current?.providerSessionId ?? null
  if (!providerSessionId) {
    return null
  }

  return assistantSessionResumeStateSchema.parse({
    providerSessionId,
    resumeRouteId: normalizeNullableString(routeId),
  })
}
