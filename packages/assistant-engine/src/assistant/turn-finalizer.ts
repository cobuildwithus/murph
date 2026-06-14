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

export type AssistantProviderResumeStateAction =
  | 'clear'
  | 'persist-from-provider-turn'
  | 'preserve-existing'

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

  const assistantTranscriptEntries = [
    ...(input.precedingAssistantTranscriptTexts ?? []),
    ...(assistantTranscriptText !== null ? [assistantTranscriptText] : []),
  ].map((text) => ({
    kind: 'assistant' as const,
    text,
  }))
  if (assistantTranscriptEntries.length > 0) {
    await state.transcripts.append(
      input.session.sessionId,
      assistantTranscriptEntries,
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
    assistantContractFingerprint: input.providerResult.assistantContractFingerprint,
    codexRolloutRelativePath: input.providerResult.codexRolloutRelativePath,
    codexThreadId: input.providerResult.codexThreadId,
    routeFingerprint: readCodexThreadRouteFingerprint(input.providerResult.route),
    sessionResumeState: readAssistantCodexResume(input.session),
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
