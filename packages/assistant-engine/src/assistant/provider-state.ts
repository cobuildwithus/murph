import { z } from 'zod'
import {
  assistantPersistedSessionSchema,
  assistantSessionResumeStateSchema,
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from './shared.js'

const assistantThreadInstructionsFingerprintPattern =
  /^thread-instructions-v1:[a-f0-9]{64}:[a-f0-9]{64}$/u
const assistantCodexRolloutRelativePathPattern =
  /^sessions\/(\d{4})\/(\d{2})\/(\d{2})\/rollout-(\d{4})-(\d{2})-(\d{2})T[^/]+-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jsonl$/u

function normalizeAssistantCodexRolloutRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\\')
  ) {
    return null
  }

  const segments = normalized.split('/')
  if (segments.some((segment) =>
    segment.length === 0 || segment === '.' || segment === '..',
  )) {
    return null
  }

  const match = assistantCodexRolloutRelativePathPattern.exec(normalized)
  if (
    !match ||
    match[1] !== match[4] ||
    match[2] !== match[5] ||
    match[3] !== match[6]
  ) {
    return null
  }

  return normalized
}

function normalizeAssistantThreadInstructionsFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return assistantThreadInstructionsFingerprintPattern.test(normalized)
    ? normalized
    : null
}

export function readAssistantProviderResumeRouteId(input: {
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeNullableString(resumeState?.resumeRouteId) ?? null
}

export function readAssistantProviderSessionId(input: {
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeNullableString(resumeState?.providerSessionId) ?? null
}

export function readAssistantCodexRolloutRelativePath(input: {
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeAssistantCodexRolloutRelativePath(
    resumeState?.codexRolloutRelativePath,
  )
}

export function readAssistantSessionResumeState(
  input:
    | {
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

  return null
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
    ...(current?.codexRolloutRelativePath
      ? { codexRolloutRelativePath: current.codexRolloutRelativePath }
      : {}),
    providerSessionId: normalizedProviderSessionId,
    resumeRouteId: current?.resumeRouteId ?? null,
    ...(current?.threadInstructionsFingerprint
      ? { threadInstructionsFingerprint: current.threadInstructionsFingerprint }
      : {}),
  })
}

export function writeAssistantSessionThreadInstructionsFingerprint(
  resumeState: AssistantSessionResumeState | null | undefined,
  threadInstructionsFingerprint: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  if (!current) {
    return null
  }

  const normalizedThreadInstructionsFingerprint = normalizeAssistantThreadInstructionsFingerprint(
    threadInstructionsFingerprint,
  )

  return assistantSessionResumeStateSchema.parse({
    ...(current.codexRolloutRelativePath
      ? { codexRolloutRelativePath: current.codexRolloutRelativePath }
      : {}),
    providerSessionId: current.providerSessionId,
    resumeRouteId: current.resumeRouteId,
    ...(normalizedThreadInstructionsFingerprint
      ? { threadInstructionsFingerprint: normalizedThreadInstructionsFingerprint }
      : {}),
  })
}

export function writeAssistantSessionCodexRolloutRelativePath(
  resumeState: AssistantSessionResumeState | null | undefined,
  codexRolloutRelativePath: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  if (!current) {
    return null
  }

  const normalizedCodexRolloutRelativePath =
    normalizeAssistantCodexRolloutRelativePath(codexRolloutRelativePath)

  return assistantSessionResumeStateSchema.parse({
    ...(normalizedCodexRolloutRelativePath
      ? { codexRolloutRelativePath: normalizedCodexRolloutRelativePath }
      : {}),
    providerSessionId: current.providerSessionId,
    resumeRouteId: current.resumeRouteId,
    ...(current.threadInstructionsFingerprint
      ? { threadInstructionsFingerprint: current.threadInstructionsFingerprint }
      : {}),
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
  const codexRolloutRelativePath = normalizeAssistantCodexRolloutRelativePath(
    value.codexRolloutRelativePath,
  )
  const threadInstructionsFingerprint = normalizeAssistantThreadInstructionsFingerprint(
    value.threadInstructionsFingerprint,
  )

  if (!providerSessionId) {
    return null
  }

  return assistantSessionResumeStateSchema.parse({
    ...(codexRolloutRelativePath ? { codexRolloutRelativePath } : {}),
    providerSessionId,
    resumeRouteId,
    ...(threadInstructionsFingerprint
      ? { threadInstructionsFingerprint }
      : {}),
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

  const resumeState = normalizeAssistantSessionResumeState(session.resumeState)

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
    ...(current?.codexRolloutRelativePath
      ? { codexRolloutRelativePath: current.codexRolloutRelativePath }
      : {}),
    providerSessionId,
    resumeRouteId: normalizeNullableString(routeId),
    ...(current?.threadInstructionsFingerprint
      ? { threadInstructionsFingerprint: current.threadInstructionsFingerprint }
      : {}),
  })
}
