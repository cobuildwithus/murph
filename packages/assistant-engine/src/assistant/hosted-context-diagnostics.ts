import { createHmac } from 'node:crypto'
import {
  resolveAssistantConversationKey,
  type AssistantBindingInput,
} from './bindings.js'
import type {
  AssistantMessageInput,
} from './service-contracts.js'
import type { ResolvedAssistantSession } from './store.js'
import { normalizeNullableString } from './shared.js'

export const HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA =
  'murph.assistant-context-diagnostics.v1'

export const HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_TYPE =
  'assistant.context.diagnostics'

export type HostedAssistantContextTimingStage =
  | 'assistant-pre-provider-ready'
  | 'assistant-turn-lock-acquired'

type FingerprintPrimitive = boolean | number | string | null

export type HostedAssistantContextFingerprintDetails = Record<
  string,
  FingerprintPrimitive
>

export interface HostedAssistantContextFingerprintEnv {
  HOSTED_AI_USAGE_REPORTING_SECRET?: string | undefined
  HOSTED_LOG_FINGERPRINT_SECRET?: string | undefined
}

export interface HostedAssistantContextFingerprintInput
  extends AssistantBindingInput {
  env?: HostedAssistantContextFingerprintEnv | null
  sessionId?: string | null
}

export function buildHostedAssistantContextFingerprintDetails(
  input: HostedAssistantContextFingerprintInput,
): HostedAssistantContextFingerprintDetails {
  const secret = resolveHostedAssistantContextFingerprintSecret(input.env)
  const channel = normalizeNullableString(input.channel)
  const identityId = normalizeNullableString(input.identityId)
  const actorId = normalizeNullableString(input.actorId)
  const threadId = normalizeNullableString(input.threadId)
  const sessionId = normalizeNullableString(input.sessionId)
  const threadIsDirect =
    typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null
  const primaryConversationKey = resolveAssistantConversationKey({
    actorId,
    channel,
    identityId,
    threadId,
    threadIsDirect,
  })
  const actorFallbackConversationKey = resolveAssistantConversationKey({
    actorId,
    channel,
    identityId,
    threadId: null,
    threadIsDirect,
  })
  const details: HostedAssistantContextFingerprintDetails = {
    fingerprintReady: secret !== null,
    channel,
    threadIsDirect,
    actorPresent: actorId !== null,
    identityPresent: identityId !== null,
    threadPresent: threadId !== null,
    sessionPresent: sessionId !== null,
    primaryConversationScope: resolveHostedAssistantConversationScope(
      primaryConversationKey,
    ),
    actorFallbackConversationScope: resolveHostedAssistantConversationScope(
      actorFallbackConversationKey,
    ),
  }

  if (!secret) {
    return details
  }

  return {
    ...details,
    actorFingerprint: fingerprintHostedAssistantContextValue(
      secret,
      'actor',
      actorId,
    ),
    identityFingerprint: fingerprintHostedAssistantContextValue(
      secret,
      'identity',
      identityId,
    ),
    threadFingerprint: fingerprintHostedAssistantContextValue(
      secret,
      'thread',
      threadId,
    ),
    sessionFingerprint: fingerprintHostedAssistantContextValue(
      secret,
      'session',
      sessionId,
    ),
    primaryConversationFingerprint: fingerprintHostedAssistantContextValue(
      secret,
      'conversation',
      primaryConversationKey,
    ),
    actorFallbackConversationFingerprint: fingerprintHostedAssistantContextValue(
      secret,
      'conversation',
      actorFallbackConversationKey,
    ),
  }
}

export function fingerprintHostedAssistantContextValue(
  secret: string,
  field: string,
  value: string | null | undefined,
): string | null {
  const normalizedSecret = normalizeNullableString(secret)
  const normalizedField = normalizeHostedAssistantContextFingerprintField(field)
  const normalizedValue = normalizeNullableString(value)
  if (!normalizedSecret || !normalizedField || !normalizedValue) {
    return null
  }

  return `h1_${createHmac('sha256', normalizedSecret)
    .update(`${normalizedField}:${normalizedValue}`, 'utf8')
    .digest('hex')
    .slice(0, 24)}`
}

export function resolveHostedAssistantContextFingerprintSecret(
  env: HostedAssistantContextFingerprintEnv | null | undefined = process.env,
): string | null {
  return (
    normalizeNullableString(env?.HOSTED_LOG_FINGERPRINT_SECRET)
    ?? normalizeNullableString(env?.HOSTED_AI_USAGE_REPORTING_SECRET)
  )
}

export async function emitHostedAssistantContextSessionResolvedTrace(input: {
  message: Pick<
    AssistantMessageInput,
    | 'actorId'
    | 'channel'
    | 'executionContext'
    | 'identityId'
    | 'onTraceEvent'
    | 'threadId'
    | 'threadIsDirect'
  >
  resolved: ResolvedAssistantSession
  source: 'assistant-message' | 'assistant-notification'
}): Promise<void> {
  const onTraceEvent = input.message.onTraceEvent
  if (!onTraceEvent || input.message.executionContext?.hosted == null) {
    return
  }

  const binding = input.resolved.session.binding

  try {
    onTraceEvent({
      codexThreadId: null,
      rawEvent: {
        schema: HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA,
        type: HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_TYPE,
        stage: 'assistant-session-resolved',
        source: input.source,
        sessionResolutionCreated: input.resolved.created,
        sessionTurnCount: input.resolved.session.turnCount,
        ...buildHostedAssistantSessionResolutionDiagnosticDetails(
          input.resolved,
        ),
        ...buildHostedAssistantContextFingerprintDetails({
          actorId: binding.actorId ?? input.message.actorId ?? null,
          channel: binding.channel ?? input.message.channel ?? null,
          identityId: binding.identityId ?? input.message.identityId ?? null,
          threadId: binding.threadId ?? input.message.threadId ?? null,
          threadIsDirect:
            binding.threadIsDirect ?? input.message.threadIsDirect ?? null,
          sessionId: input.resolved.session.sessionId,
        }),
      },
      updates: [],
    })
  } catch {
    // Diagnostic trace hooks must not block the assistant turn.
  }
}

export function emitHostedAssistantContextTimingTrace(input: {
  message: Pick<
    AssistantMessageInput,
    | 'executionContext'
    | 'onTraceEvent'
  >
  preProviderAdmissionCount?: number | null
  preProviderSetupMs?: number | null
  providerRequestOrdinal?: number | null
  stage: HostedAssistantContextTimingStage
  turnLockWaitMs?: number | null
}): void {
  const onTraceEvent = input.message.onTraceEvent
  if (!onTraceEvent || input.message.executionContext?.hosted == null) {
    return
  }

  try {
    onTraceEvent({
      codexThreadId: null,
      rawEvent: {
        schema: HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA,
        type: HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_TYPE,
        stage: input.stage,
        preProviderAdmissionCount: input.preProviderAdmissionCount ?? null,
        preProviderSetupMs: input.preProviderSetupMs ?? null,
        providerRequestOrdinal: input.providerRequestOrdinal ?? null,
        turnLockWaitMs: input.turnLockWaitMs ?? null,
      },
      updates: [],
    })
  } catch {
    // Diagnostic trace hooks must not block the assistant turn.
  }
}

function buildHostedAssistantSessionResolutionDiagnosticDetails(
  resolved: ResolvedAssistantSession,
): HostedAssistantContextFingerprintDetails {
  const diagnostics = resolved.resolutionDiagnostics
  if (!diagnostics) {
    return {}
  }

  return {
    actorFallbackConversationIndexed:
      diagnostics.actorFallbackConversationIndexed,
    conversationLookupIndexedCandidateCount:
      diagnostics.conversationLookupIndexedCandidateCount,
    conversationLookupKeyCount: diagnostics.conversationLookupKeyCount,
    conversationLookupMatchedScope: diagnostics.conversationLookupMatchedScope,
    primaryConversationIndexed: diagnostics.primaryConversationIndexed,
    sessionResolutionLookupSource:
      diagnostics.sessionResolutionLookupSource,
  }
}

function resolveHostedAssistantConversationScope(
  conversationKey: string | null,
): 'actor' | 'none' | 'thread' {
  if (!conversationKey) {
    return 'none'
  }

  if (conversationKey.includes('|thread:')) {
    return 'thread'
  }

  if (conversationKey.includes('|actor:')) {
    return 'actor'
  }

  return 'none'
}

function normalizeHostedAssistantContextFingerprintField(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null
  return normalized && /^[a-z0-9_.-]{1,64}$/u.test(normalized)
    ? normalized
    : null
}
