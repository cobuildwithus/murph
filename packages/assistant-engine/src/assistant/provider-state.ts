import { z } from 'zod'
import {
  assistantPersistedSessionSchema,
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildCodexResumeState,
  normalizeCodexResumeState,
  normalizeCodexRolloutRelativePath,
} from '@murphai/operator-config/assistant/codex-resume-state'
import { normalizeNullableString } from './shared.js'

export function readAssistantProviderResumeRouteId(input: {
  codexResume?: AssistantSessionResumeState | null
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeNullableString(resumeState?.routeFingerprint) ?? null
}

export function readAssistantCodexThreadId(input: {
  codexResume?: AssistantSessionResumeState | null
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeNullableString(resumeState?.threadId) ?? null
}

export function readAssistantCodexRolloutRelativePath(input: {
  codexResume?: AssistantSessionResumeState | null
  resumeState?: AssistantSessionResumeState | null
} | AssistantSession): string | null {
  const resumeState = readAssistantSessionResumeState(input)
  return normalizeCodexRolloutRelativePath(resumeState?.rolloutRelativePath)
}

export function readAssistantSessionResumeState(
  input:
    | {
        codexResume?: AssistantSessionResumeState | null
        resumeState?: AssistantSessionResumeState | null
      }
    | AssistantSession
    | null
    | undefined,
): AssistantSessionResumeState | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  if ('codexResume' in input) {
    return normalizeAssistantSessionResumeState(input.codexResume)
  }

  if ('resumeState' in input) {
    return normalizeAssistantSessionResumeState(input.resumeState)
  }

  return null
}

export function writeAssistantProviderResumeRouteId(
  resumeState: unknown,
  routeId: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  if (!current) {
    return null
  }

  return buildCodexResumeState({
    rolloutRelativePath: current.rolloutRelativePath,
    routeFingerprint: routeId,
    threadId: current.threadId,
  })
}

export function writeAssistantSessionCodexThreadId(
  resumeState: unknown,
  codexThreadId: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  return buildCodexResumeState({
    rolloutRelativePath: current?.rolloutRelativePath,
    routeFingerprint: current?.routeFingerprint,
    threadId: codexThreadId,
  })
}

export function writeAssistantSessionThreadInstructionsFingerprint(
  resumeState: unknown,
  _threadInstructionsFingerprint: string | null | undefined,
): AssistantSessionResumeState | null {
  return normalizeAssistantSessionResumeState(resumeState)
}

export function writeAssistantSessionCodexRolloutRelativePath(
  resumeState: unknown,
  codexRolloutRelativePath: string | null | undefined,
): AssistantSessionResumeState | null {
  const current = normalizeAssistantSessionResumeState(resumeState)
  if (!current) {
    return null
  }

  return buildCodexResumeState({
    rolloutRelativePath: codexRolloutRelativePath,
    routeFingerprint: current.routeFingerprint,
    threadId: current.threadId,
  })
}

export function normalizeAssistantSessionResumeState(
  value: unknown,
): AssistantSessionResumeState | null {
  return normalizeCodexResumeState(value)
}

export function normalizeAssistantSessionSnapshot(
  session: AssistantSession,
): AssistantSession {
  return parseAssistantSessionRecord(serializeAssistantSessionForPersistence(session))
}

export function serializeAssistantSessionForPersistence(
  session: AssistantSession,
): z.infer<typeof assistantPersistedSessionSchema> {
  const target = session.codexTarget ?? session.target
  if (!target) {
    throw new TypeError('Assistant conversation Codex target is required.')
  }

  const resumeState = normalizeAssistantSessionResumeState(
    session.codexResume ?? session.resumeState,
  )

  return assistantPersistedSessionSchema.parse({
    schema: 'murph.assistant-conversation.v2',
    conversationId: session.conversationId ?? session.sessionId,
    alias: session.alias,
    binding: session.binding,
    codexTarget: target,
    codexResume: resumeState,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastTurnAt: session.lastTurnAt,
    turnCount: session.turnCount,
  })
}
