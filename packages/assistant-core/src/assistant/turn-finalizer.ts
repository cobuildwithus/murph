import type {
  AssistantSession,
} from '../assistant-cli-contracts.js'
import { readAssistantProviderBinding, writeAssistantCodexPromptVersion } from './provider-state.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  hashAssistantProviderWorkingDirectory,
  resolveNextAssistantProviderBinding,
} from './provider-binding.js'
import {
  maybeRefreshAssistantTranscriptDistillation,
} from './transcript-distillation.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'

export async function persistAssistantTurnAndSession(input: {
  currentCodexPromptVersion: string
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
  const previousBinding = readAssistantProviderBinding(input.session)
  const workspaceKey = hashAssistantProviderWorkingDirectory(
    input.providerResult.workingDirectory,
  )
  let nextBinding = resolveNextAssistantProviderBinding({
    provider: input.providerResult.provider,
    providerSessionId: input.providerResult.providerSessionId,
    previousBinding,
    providerOptions: input.providerResult.providerOptions,
    routeId: input.providerResult.route.routeId,
    workspaceKey,
    providerState: null,
  })

  if (input.providerResult.provider === 'codex-cli') {
    nextBinding =
      writeAssistantCodexPromptVersion(
        nextBinding,
        input.currentCodexPromptVersion,
      ) ?? nextBinding
  }

  const savedSession = await state.sessions.save({
    ...input.session,
    provider: input.providerResult.provider,
    providerBinding: nextBinding,
    providerOptions: input.providerResult.providerOptions,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: input.session.turnCount + 1,
  })
  const transcript = await state.transcripts.list(input.session.sessionId)
  const distillation = await maybeRefreshAssistantTranscriptDistillation({
    sessionId: input.session.sessionId,
    transcript,
    vault: input.input.vault,
  })

  if (distillation.created && distillation.distillation) {
    await state.turns.appendEvent({
      turnId: input.turnId,
      kind: 'provider.context.refreshed',
      detail: 'append-only transcript distillation refreshed',
      metadata: {
        distillationId: distillation.distillation.distillationId,
        endEntryOffset: String(distillation.distillation.endEntryOffset),
      },
      at: distillation.distillation.createdAt,
    })
    await state.diagnostics.recordEvent({
      component: 'assistant',
      kind: 'turn.context.refreshed',
      message: 'Assistant transcript distillation refreshed for an older session history window.',
      sessionId: input.session.sessionId,
      turnId: input.turnId,
      data: {
        distillationId: distillation.distillation.distillationId,
        endEntryOffset: distillation.distillation.endEntryOffset,
      },
    })
  }

  return savedSession
}
