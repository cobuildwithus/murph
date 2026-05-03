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
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  writeAssistantProviderResumeRouteId,
  writeAssistantSessionProviderSessionId,
  writeAssistantSessionThreadInstructionsFingerprint,
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

export type AssistantProviderResumeStateAction =
  | 'clear'
  | 'persist-from-provider-turn'
  | 'preserve-existing'

export function resolveAssistantResumeStateFromProviderTurn(input: {
  providerSessionId: string | null
  routeId: string
  threadInstructionsFingerprint?: string | null
}): AssistantSession['resumeState'] {
  return writeAssistantSessionThreadInstructionsFingerprint(
    writeAssistantProviderResumeRouteId(
      writeAssistantSessionProviderSessionId(null, input.providerSessionId),
      input.routeId,
    ),
    input.threadInstructionsFingerprint,
  )
}

export async function persistAssistantTurnAndSession(input: {
  assistantTranscriptText?: string | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  persistUserPromptToTranscript?: boolean
  providerResult: ExecutedAssistantProviderTurnResult
  providerResumeStateAction: AssistantProviderResumeStateAction
  session: AssistantSession
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantSession> {
  const state = createAssistantRuntimeStateService(input.input.vault)
  const persistUserPromptToTranscript = input.persistUserPromptToTranscript ?? true
  const assistantTranscriptText = input.assistantTranscriptText
    ?? input.providerResult.response

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
    providerSessionId: input.providerResult.providerSessionId,
    routeId: input.providerResult.route.routeId,
    sessionResumeState: input.session.resumeState,
    threadInstructionsFingerprint: input.providerResult.threadInstructionsFingerprint,
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

function resolveAssistantNextResumeState(input: {
  action: AssistantProviderResumeStateAction
  providerSessionId: string | null
  routeId: string
  sessionResumeState: AssistantSession['resumeState']
  threadInstructionsFingerprint?: string | null
}): AssistantSession['resumeState'] {
  switch (input.action) {
    case 'clear':
      return null
    case 'preserve-existing':
      return input.sessionResumeState
    case 'persist-from-provider-turn':
      return resolveAssistantResumeStateFromProviderTurn({
        providerSessionId: input.providerSessionId,
        routeId: input.routeId,
        threadInstructionsFingerprint: input.threadInstructionsFingerprint,
      })
  }
}
