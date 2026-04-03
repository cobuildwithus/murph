import type {
  AssistantSession,
} from '../assistant-cli-contracts.js'
import { normalizeAssistantProviderBinding } from './provider-state.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  resolveNextAssistantProviderBinding,
} from './provider-binding.js'
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
  const nextBinding = resolveNextAssistantProviderBinding({
    provider: input.providerResult.provider,
    providerSessionId: input.providerResult.providerSessionId,
    previousBinding: normalizeAssistantProviderBinding(
      input.session.providerBinding,
    ),
    providerOptions: input.providerResult.providerOptions,
    routeId: input.providerResult.route.routeId,
    providerState: null,
  })

  const savedSession = await state.sessions.save({
    ...input.session,
    provider: input.providerResult.provider,
    providerBinding: nextBinding,
    providerOptions: input.providerResult.providerOptions,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: input.session.turnCount + 1,
  })

  return savedSession
}
