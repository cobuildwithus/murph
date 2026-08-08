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
  doesAssistantResumeBindingMatchRoute,
} from './codex-resume-binding.js'
import {
  readAssistantCodexResume,
} from './conversation-persistence.js'
import { resolveAssistantExecutionPlan } from './execution-plan.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  buildAssistantProviderTranscriptAuditEntries,
} from './transcript-audit.js'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
} from './codex-thread-route.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'
import {
  compactAutomationAssistantTargetOverride,
} from './automation/target-override.js'
import type { AssistantCodexThreadScope } from './codex-turn/planning.js'
import { normalizeNullableString } from './shared.js'

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
  threadCompatibilityFingerprint?: string | null
}): AssistantSession['resumeState'] {
  return buildCodexResumeState({
    assistantContractFingerprint: input.assistantContractFingerprint,
    rolloutRelativePath: input.codexRolloutRelativePath,
    routeFingerprint: input.routeFingerprint,
    threadCompatibilityFingerprint: input.threadCompatibilityFingerprint,
    threadId: input.codexThreadId,
  })
}

export function resolveAssistantProviderResumeStateAction(input: {
  codexThreadId: string | null
  threadScope: AssistantCodexThreadScope
}): AssistantProviderResumeStateAction {
  if (input.threadScope === 'isolated-thread') {
    return 'preserve-existing'
  }

  return normalizeNullableString(input.codexThreadId)
    ? 'persist-from-provider-turn'
    : 'clear'
}

export async function applyAssistantSessionCodexResumeStateAction(input: {
  action: AssistantProviderResumeStateAction
  assistantContractFingerprint: string
  codexRolloutRelativePath: string | null
  codexThreadId: string | null
  routeFingerprint: string
  threadCompatibilityFingerprint?: string | null
  session: AssistantSession
  vault: string
}): Promise<AssistantSession> {
  switch (input.action) {
    case 'preserve-existing':
      return input.session
    case 'clear':
      return await clearAssistantSessionCodexResumeState({
        session: input.session,
        vault: input.vault,
      })
    case 'persist-from-provider-turn': {
      const resumeState = resolveAssistantResumeStateFromProviderTurn({
        assistantContractFingerprint: input.assistantContractFingerprint,
        codexRolloutRelativePath: input.codexRolloutRelativePath,
        codexThreadId: input.codexThreadId,
        routeFingerprint: input.routeFingerprint,
        threadCompatibilityFingerprint: input.threadCompatibilityFingerprint,
      })
      if (!resumeState) {
        return input.session
      }
      const state = createAssistantRuntimeStateService(input.vault)
      const updatedAt = new Date().toISOString()
      return await state.sessions.save({
        ...input.session,
        codexResume: resumeState,
        resumeState,
        updatedAt,
      })
    }
  }
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
  userContentReceivedAt?: string | null
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
          ...(input.userContentReceivedAt
            ? { contentReceivedAt: input.userContentReceivedAt }
            : {}),
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
  const turnCommittedConversationHistory =
    persistUserPromptToTranscript ||
    assistantTranscriptEntries.length > 0 ||
    noReplyMarkerDeliveryContextOrdinals.length > 0

  const updatedAt = new Date().toISOString()
  const hasTurnScopedTargetOverride =
    compactAutomationAssistantTargetOverride(
      input.input.assistantTargetOverride,
    ) !== null
  const shouldApplyProviderConfigToSession =
    input.providerResumeStateAction !== 'preserve-existing' &&
    !hasTurnScopedTargetOverride
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
  const resumeStateInput: AssistantNextResumeStateInput = {
    action: input.providerResumeStateAction,
    assistantContractFingerprint: input.providerResult.assistantContractFingerprint,
    codexRolloutRelativePath: input.providerResult.codexRolloutRelativePath,
    codexThreadId: input.providerResult.codexThreadId,
    routeFingerprint: readCodexThreadRouteFingerprint(input.providerResult.route),
    threadCompatibilityFingerprint:
      readCodexThreadCompatibilityFingerprint(input.providerResult.route),
    sessionResumeState: readAssistantCodexResume(input.session),
  }
  const nextResumeState = hasTurnScopedTargetOverride
    ? resolveAssistantTurnScopedOverrideResumeState({
        ...resumeStateInput,
        durableTarget: nextTarget,
        turnCommittedConversationHistory,
      })
    : resolveAssistantNextResumeState(resumeStateInput)

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
    turnCount: input.session.turnCount + 1,
  })

  return savedSession
}

type AssistantNextResumeStateInput = {
  action: AssistantProviderResumeStateAction
  assistantContractFingerprint?: string | null
  codexRolloutRelativePath?: string | null
  codexThreadId: string | null
  routeFingerprint: string
  threadCompatibilityFingerprint?: string | null
  sessionResumeState: AssistantSession['resumeState']
}

function resolveAssistantTurnScopedOverrideResumeState(
  input: AssistantNextResumeStateInput & {
    durableTarget: AssistantSession['target']
    turnCommittedConversationHistory: boolean
  },
): AssistantSession['resumeState'] {
  if (!input.turnCommittedConversationHistory) {
    return input.sessionResumeState
  }
  if (input.action !== 'persist-from-provider-turn') {
    return null
  }

  const candidate = resolveAssistantNextResumeState(input)
  if (!candidate) {
    return null
  }

  const durableRoute = resolveAssistantExecutionPlan({
    defaults: null,
    sessionTarget: input.durableTarget,
  }).codexRoute
  return doesAssistantResumeBindingMatchRoute({
    resumeState: candidate,
    route: durableRoute,
  })
    ? candidate
    : null
}

function resolveAssistantNextResumeState(
  input: AssistantNextResumeStateInput,
): AssistantSession['resumeState'] {
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
        threadCompatibilityFingerprint: input.threadCompatibilityFingerprint,
      })
  }
}
