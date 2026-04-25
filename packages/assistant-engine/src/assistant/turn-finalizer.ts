import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  compactAssistantProviderConfigInput,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import {
  writeAssistantProviderResumeRouteId,
  writeAssistantSessionProviderSessionId,
} from './provider-state.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  buildAssistantProviderTranscriptAuditEntries,
} from './transcript-audit.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'

export function resolveAssistantResumeStateFromProviderTurn(input: {
  providerSessionId: string | null
  routeId: string
}): AssistantSession['resumeState'] {
  return writeAssistantProviderResumeRouteId(
    writeAssistantSessionProviderSessionId(null, input.providerSessionId),
    input.routeId,
  )
}

export async function persistAssistantTurnAndSession(input: {
  assistantTranscriptText?: string | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  persistUserPromptToTranscript?: boolean
  providerResult: ExecutedAssistantProviderTurnResult
  resumeStatePolicy?: 'clear' | 'update'
  session: AssistantSession
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantSession> {
  const state = createAssistantRuntimeStateService(input.input.vault)
  const persistUserPromptToTranscript = input.persistUserPromptToTranscript ?? true
  const assistantTranscriptText = input.assistantTranscriptText
    ?? input.providerResult.response
  const resumeStatePolicy = input.resumeStatePolicy ?? 'update'

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

  if (assistantTranscriptText !== null) {
    await state.transcripts.append(
      input.session.sessionId,
      [
        {
          kind: 'assistant',
          text: assistantTranscriptText,
        },
      ],
    )
  }

  const updatedAt = new Date().toISOString()
  const nextTarget =
    createAssistantModelTarget({
      ...assistantBackendTargetToProviderConfigInput(input.session.target),
      ...(compactAssistantProviderConfigInput(input.input) ?? {}),
    }) ?? input.session.target
  const nextProviderConfig = assistantBackendTargetToProviderConfigInput(nextTarget)
  const nextProviderOptions = serializeAssistantProviderSessionOptions(nextProviderConfig)
  const nextResumeState =
    resumeStatePolicy === 'clear'
      ? null
      : resolveAssistantResumeStateFromProviderTurn({
          providerSessionId: input.providerResult.providerSessionId,
          routeId: input.providerResult.route.routeId,
        })

  const savedSession = await state.sessions.save({
    ...input.session,
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
