import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  type AssistantTranscriptEntry,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  compactAssistantProviderConfigInput,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { buildCodexResumeState } from '@murphai/operator-config/assistant/codex-resume-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  readAssistantCodexResume,
} from './conversation-persistence.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  buildAssistantProviderTranscriptAuditEntries,
} from './transcript-audit.js'
import {
  readCodexThreadRouteFingerprint,
} from './codex-thread-route.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'

export const ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX =
  'murph.assistant-no-reply.v1 '
export const ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT =
  'I completed that turn without sending a user-visible reply.'
const ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_VERSION = 1

export function buildAssistantNoReplyTranscriptMarkerText(input: {
  deliveryContextOrdinal: number
  turnId: string
}): string {
  return [
    ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX,
    JSON.stringify({
      deliveryContextOrdinal: input.deliveryContextOrdinal,
      turnId: input.turnId,
      version: ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_VERSION,
    }),
    ' ',
    ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
  ].join('')
}

export function normalizeAssistantNoReplyDeliveryContextOrdinals(
  values: readonly number[] | null | undefined,
): number[] {
  const ordinals = new Set<number>()
  for (const value of values ?? []) {
    if (Number.isInteger(value) && value >= 0) {
      ordinals.add(value)
    }
  }
  return [...ordinals].sort((left, right) => left - right)
}

function normalizePendingComputerResumeRunId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function resolveAssistantPendingComputerResume(input: {
  providerResult: ExecutedAssistantProviderTurnResult
  session: AssistantSession
}): AssistantSession['pendingComputerResume'] {
  const pendingRunId = normalizePendingComputerResumeRunId(
    input.providerResult.pendingComputerResumeRunId,
  )
  if (pendingRunId) {
    return { runId: pendingRunId }
  }
  if (input.providerResult.computerResumeConsumed === true) {
    return null
  }
  return input.session.pendingComputerResume ?? null
}

export async function persistAssistantNoReplyTranscriptMarkers(input: {
  deliveryContextOrdinals: readonly number[] | null | undefined
  sessionId: string
  turnCreatedAt: string
  turnId: string
  vault: string
}): Promise<void> {
  const ordinals = normalizeAssistantNoReplyDeliveryContextOrdinals(
    input.deliveryContextOrdinals,
  )
  if (ordinals.length === 0) {
    return
  }

  const state = createAssistantRuntimeStateService(input.vault)
  const existingOrdinals = new Set<number>()
  for (const entry of await state.transcripts.list(input.sessionId)) {
    const marker = readAssistantNoReplyTranscriptMarker(entry)
    if (!marker) {
      continue
    }
    const matchesCurrentTurn =
      marker.turnId === input.turnId ||
      (marker.turnId === null && entry.createdAt === input.turnCreatedAt)
    if (matchesCurrentTurn) {
      existingOrdinals.add(marker.deliveryContextOrdinal)
    }
  }
  const entries = ordinals
    .filter((ordinal) => !existingOrdinals.has(ordinal))
    .map((ordinal) => ({
      createdAt: input.turnCreatedAt,
      kind: 'status' as const,
      text: buildAssistantNoReplyTranscriptMarkerText({
        deliveryContextOrdinal: ordinal,
        turnId: input.turnId,
      }),
    }))
  if (entries.length > 0) {
    await state.transcripts.append(input.sessionId, entries)
  }
}

function readAssistantNoReplyTranscriptMarker(
  entry: AssistantTranscriptEntry,
): { deliveryContextOrdinal: number; turnId: string | null } | null {
  if (
    entry.kind !== 'status' ||
    !entry.text.startsWith(ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX)
  ) {
    return null
  }

  const markerPayload = entry.text
    .slice(ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX.length)
    .trimStart()
  if (!markerPayload.startsWith('{')) {
    return {
      deliveryContextOrdinal: 0,
      turnId: null,
    }
  }

  const markerEnd = markerPayload.indexOf('}')
  if (markerEnd < 0) {
    return {
      deliveryContextOrdinal: 0,
      turnId: null,
    }
  }

  try {
    const parsed = JSON.parse(markerPayload.slice(0, markerEnd + 1)) as {
      deliveryContextOrdinal?: unknown
      turnId?: unknown
    }
    const ordinal = parsed.deliveryContextOrdinal
    return {
      deliveryContextOrdinal:
        typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal >= 0
          ? ordinal
          : 0,
      turnId:
        typeof parsed.turnId === 'string' && parsed.turnId.length > 0
          ? parsed.turnId
          : null,
    }
  } catch {
    return {
      deliveryContextOrdinal: 0,
      turnId: null,
    }
  }
}

export type AssistantProviderResumeStateAction =
  | 'clear'
  | 'persist-from-provider-turn'
  | 'preserve-existing'

export async function clearAssistantSessionCodexResumeState(input: {
  session: AssistantSession
  vault: string
}): Promise<AssistantSession> {
  const state = createAssistantRuntimeStateService(input.vault)
  const updatedAt = new Date().toISOString()
  return await state.sessions.save({
    ...input.session,
    codexResume: null,
    resumeState: null,
    updatedAt,
  })
}

export function resolveAssistantResumeStateFromProviderTurn(input: {
  assistantContractFingerprint?: string | null
  codexRolloutRelativePath?: string | null
  codexThreadId: string | null
  routeFingerprint: string
}): AssistantSession['resumeState'] {
  return buildCodexResumeState({
    assistantContractFingerprint: input.assistantContractFingerprint,
    rolloutRelativePath: input.codexRolloutRelativePath,
    routeFingerprint: input.routeFingerprint,
    threadId: input.codexThreadId,
  })
}

export async function persistAssistantTurnAndSession(input: {
  assistantTranscriptText?: string | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  persistUserPromptToTranscript?: boolean
  // Final answers completed before a steered message in the same turn; each
  // is persisted as its own assistant transcript entry ahead of the final.
  precedingAssistantTranscriptTexts?: readonly string[]
  providerResult: ExecutedAssistantProviderTurnResult
  providerResumeStateAction: AssistantProviderResumeStateAction
  session: AssistantSession
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantSession> {
  const state = createAssistantRuntimeStateService(input.input.vault)
  const persistUserPromptToTranscript = input.persistUserPromptToTranscript ?? true
  const assistantTranscriptText =
    input.assistantTranscriptText === undefined
      ? input.providerResult.response
      : input.assistantTranscriptText

  if (!input.plan.persistUserPromptOnFailure && persistUserPromptToTranscript) {
    await state.transcripts.append(
      input.session.sessionId,
      [
        {
          kind: 'user',
          text: input.input.prompt,
          createdAt: input.turnCreatedAt,
        },
      ],
    )
    await state.turns.appendEvent({
      turnId: input.turnId,
      kind: 'user.persisted',
      detail: 'user prompt persisted after provider completion',
      at: input.turnCreatedAt,
    })
  }

  const auditEntries = buildAssistantProviderTranscriptAuditEntries({
    rawToolEvents: input.providerResult.rawEvents,
    routeLabel: input.providerResult.route.label,
  })
  if (auditEntries.length > 0) {
    await state.transcripts.append(input.session.sessionId, auditEntries)
  }

  const assistantTranscriptEntries = [
    ...(input.precedingAssistantTranscriptTexts ?? []).map((text) => ({
      kind: 'assistant' as const,
      text,
    })),
    ...(assistantTranscriptText !== null
      ? [{
          kind: 'assistant' as const,
          text: assistantTranscriptText,
        }]
      : []),
  ]
  if (assistantTranscriptEntries.length > 0) {
    await state.transcripts.append(
      input.session.sessionId,
      assistantTranscriptEntries,
    )
  }
  const acceptedNoReplyDeliveryContextOrdinals =
    normalizeAssistantNoReplyDeliveryContextOrdinals(
      input.providerResult.acceptedNoReplyDeliveryContextOrdinals,
    )
  const noReplyMarkerDeliveryContextOrdinals =
    acceptedNoReplyDeliveryContextOrdinals.length > 0
      ? acceptedNoReplyDeliveryContextOrdinals
      : (
          assistantTranscriptText === null &&
          input.providerResult.finalAction?.kind === 'none'
            ? [0]
            : []
        )
  await persistAssistantNoReplyTranscriptMarkers({
    deliveryContextOrdinals: noReplyMarkerDeliveryContextOrdinals,
    sessionId: input.session.sessionId,
    turnCreatedAt: input.turnCreatedAt,
    turnId: input.turnId,
    vault: input.input.vault,
  })

  const updatedAt = new Date().toISOString()
  const shouldApplyProviderConfigToSession =
    input.providerResumeStateAction !== 'preserve-existing'
  const nextTarget = shouldApplyProviderConfigToSession
    ? createAssistantModelTarget({
        ...assistantBackendTargetToProviderConfigInput(input.session.target),
        ...(compactAssistantProviderConfigInput(input.input) ?? {}),
      }) ?? input.session.target
    : input.session.target
  if (nextTarget.adapter !== 'codex-cli') {
    throw new VaultCliError(
      'ASSISTANT_PROVIDER_UNSUPPORTED',
      'Assistant turn finalization only supports Codex app-server targets.',
    )
  }
  const nextProviderOptions = shouldApplyProviderConfigToSession
    ? serializeAssistantProviderSessionOptions(
        assistantBackendTargetToProviderConfigInput(nextTarget),
      )
    : input.session.providerOptions
  const nextResumeState = resolveAssistantNextResumeState({
    action: input.providerResumeStateAction,
    assistantContractFingerprint: input.providerResult.assistantContractFingerprint,
    codexRolloutRelativePath: input.providerResult.codexRolloutRelativePath,
    codexThreadId: input.providerResult.codexThreadId,
    routeFingerprint: readCodexThreadRouteFingerprint(input.providerResult.route),
    sessionResumeState: readAssistantCodexResume(input.session),
  })
  const pendingComputerResume = resolveAssistantPendingComputerResume({
    providerResult: input.providerResult,
    session: input.session,
  })

  const savedSession = await state.sessions.save({
    ...input.session,
    codexResume: nextResumeState,
    codexTarget: nextTarget,
    provider: nextTarget.adapter,
    providerOptions: nextProviderOptions,
    target: nextTarget,
    resumeState: nextResumeState,
    updatedAt,
    lastTurnAt: updatedAt,
    pendingComputerResume,
    turnCount: input.session.turnCount + 1,
  })

  return savedSession
}

function resolveAssistantNextResumeState(input: {
  action: AssistantProviderResumeStateAction
  assistantContractFingerprint?: string | null
  codexRolloutRelativePath?: string | null
  codexThreadId: string | null
  routeFingerprint: string
  sessionResumeState: AssistantSession['resumeState']
}): AssistantSession['resumeState'] {
  switch (input.action) {
    case 'clear':
      return null
    case 'preserve-existing':
      return input.sessionResumeState
    case 'persist-from-provider-turn':
      return resolveAssistantResumeStateFromProviderTurn({
        assistantContractFingerprint: input.assistantContractFingerprint,
        codexRolloutRelativePath: input.codexRolloutRelativePath,
        codexThreadId: input.codexThreadId,
        routeFingerprint: input.routeFingerprint,
      })
  }
}
