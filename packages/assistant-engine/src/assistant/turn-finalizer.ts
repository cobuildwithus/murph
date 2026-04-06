import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  assistantProviderBindingSchema,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import {
  compactAssistantProviderConfigInput,
  serializeAssistantProviderSessionOptions,
} from './provider-config.js'
import {
  writeAssistantProviderResumeRouteId,
  writeAssistantSessionProviderSessionId,
} from './provider-state.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'

export async function persistAssistantTurnAndSession(input: {
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  providerResult: ExecutedAssistantProviderTurnResult
  session: AssistantSession
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantSession> {
  const state = createAssistantRuntimeStateService(input.input.vault)

  if (!input.plan.persistUserPromptOnFailure) {
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

  await state.transcripts.append(
    input.session.sessionId,
    [
      {
        kind: 'assistant',
        text: input.providerResult.response,
      },
    ],
  )

  const updatedAt = new Date().toISOString()
  const nextTarget =
    createAssistantModelTarget({
      ...assistantBackendTargetToProviderConfigInput(input.session.target),
      ...(compactAssistantProviderConfigInput(input.input) ?? {}),
    }) ?? input.session.target
  const nextProviderConfig = assistantBackendTargetToProviderConfigInput(nextTarget)
  const nextProviderOptions = serializeAssistantProviderSessionOptions(nextProviderConfig)
  const nextResumeState = writeAssistantProviderResumeRouteId(
    writeAssistantSessionProviderSessionId(
      input.session.resumeState,
      input.providerResult.providerSessionId,
    ),
    input.providerResult.route.routeId,
  )
  const nextProviderBinding =
    nextResumeState &&
    (nextResumeState.providerSessionId !== null || nextResumeState.resumeRouteId !== null)
      ? assistantProviderBindingSchema.parse({
          provider: nextTarget.adapter,
          providerSessionId: nextResumeState.providerSessionId,
          providerState:
            nextResumeState.resumeRouteId !== null
              ? {
                  resumeRouteId: nextResumeState.resumeRouteId,
                }
              : null,
          providerOptions: nextProviderOptions,
        })
      : null

  const savedSession = await state.sessions.save({
    ...input.session,
    provider: nextTarget.adapter,
    providerOptions: nextProviderOptions,
    providerBinding: nextProviderBinding,
    target: nextTarget,
    resumeState: nextResumeState,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: input.session.turnCount + 1,
  })

  return savedSession
}
