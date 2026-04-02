import {
  assistantProviderBindingSchema,
  assistantSessionProviderStateSchema,
  type AssistantSession,
  type AssistantProviderBinding,
  type AssistantSessionProviderState,
} from '../assistant-cli-contracts.js'
import { normalizeNullableString } from './shared.js'

export function readAssistantProviderResumeRouteId(input: {
  providerBinding?: AssistantProviderBinding | null
} | AssistantSession): string | null {
  const providerBinding = readAssistantProviderBinding(input)
  return normalizeNullableString(providerBinding?.providerState?.resumeRouteId) ?? null
}

export function readAssistantProviderSessionId(input: {
  providerBinding?: AssistantProviderBinding | null
} | AssistantSession): string | null {
  const providerBinding = readAssistantProviderBinding(input)
  return normalizeNullableString(providerBinding?.providerSessionId) ?? null
}

export function readAssistantProviderBinding(
  input:
    | {
        providerBinding?: AssistantProviderBinding | null
      }
    | AssistantSession
    | null
    | undefined,
): AssistantProviderBinding | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  return normalizeAssistantProviderBinding(
    'providerBinding' in input ? input.providerBinding : null,
  )
}

export function writeAssistantProviderResumeRouteId(
  providerBinding: AssistantProviderBinding | null | undefined,
  routeId: string | null | undefined,
): AssistantProviderBinding | null {
  const current = normalizeAssistantProviderBinding(providerBinding)
  if (!current) {
    return current
  }

  return assistantProviderBindingSchema.parse({
    ...current,
    providerState: writeAssistantSessionProviderStateResumeRouteId(
      current.providerState,
      routeId,
    ),
  })
}

export function writeAssistantProviderStateResumeRouteId(
  providerState: AssistantSessionProviderState | null | undefined,
  routeId: string | null | undefined,
): AssistantSessionProviderState | null {
  return writeAssistantSessionProviderStateResumeRouteId(providerState, routeId)
}

function writeAssistantSessionProviderStateResumeRouteId(
  providerState: AssistantSessionProviderState | null | undefined,
  routeId: string | null | undefined,
): AssistantSessionProviderState | null {
  const normalizedRouteId = normalizeNullableString(routeId)
  const current = normalizeAssistantSessionProviderState(providerState)

  if (!normalizedRouteId) {
    if (!current?.resumeRouteId) {
      return current
    }

    return assistantSessionProviderStateSchema.parse({
      ...current,
      resumeRouteId: null,
    })
  }

  return assistantSessionProviderStateSchema.parse({
    ...(current ?? {}),
    resumeRouteId: normalizedRouteId,
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
    providerState: normalizeAssistantSessionProviderState(value.providerState),
  })
}

export function normalizeAssistantSessionProviderState(
  value: AssistantSessionProviderState | null | undefined,
): AssistantSessionProviderState | null {
  if (!value) {
    return null
  }

  const resumeRouteId = normalizeNullableString(value.resumeRouteId)
  return resumeRouteId
    ? assistantSessionProviderStateSchema.parse({
        resumeRouteId,
      })
    : null
}

export function normalizeAssistantSessionSnapshot(
  session: AssistantSession,
): AssistantSession {
  const providerBinding = normalizeAssistantProviderBinding(
    session.providerBinding
      ? {
          ...session.providerBinding,
          providerSessionId:
            normalizeNullableString(session.providerBinding.providerSessionId) ?? null,
          providerState: normalizeAssistantSessionProviderState(
            session.providerBinding.providerState,
          ),
        }
      : null,
  )

  return {
    schema: 'murph.assistant-session.v3',
    sessionId: session.sessionId,
    provider: session.provider,
    providerOptions: session.providerOptions,
    providerBinding,
    alias: session.alias,
    binding: session.binding,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastTurnAt: session.lastTurnAt,
    turnCount: session.turnCount,
  }
}
