import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildCodexResumeState,
} from '@murphai/operator-config/assistant/codex-resume-state'
import {
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  VENICE_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'
import type {
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from '../src/assistant/service-contracts.ts'

const runtimeState = vi.hoisted(() => ({
  sessionsSave: vi.fn(async (session: AssistantSession) => session),
  transcriptsAppend: vi.fn(async () => undefined),
  transcriptsList: vi.fn(async () => []),
  turnsAppendEvent: vi.fn(async () => undefined),
}))

vi.mock('../src/assistant/runtime-state-service.js', () => ({
  createAssistantRuntimeStateService: () => ({
    sessions: {
      save: runtimeState.sessionsSave,
    },
    transcripts: {
      append: runtimeState.transcriptsAppend,
      list: runtimeState.transcriptsList,
    },
    turns: {
      appendEvent: runtimeState.turnsAppendEvent,
    },
  }),
}))

import { createAssistantBinding } from '../src/assistant/bindings.ts'
import {
  resolveAssistantRouteResumeBinding,
} from '../src/assistant/codex-resume-binding.ts'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from '../src/assistant/codex-thread-route.ts'
import { resolveAssistantExecutionPlan } from '../src/assistant/execution-plan.ts'
import { resolveAssistantTurnRoute } from '../src/assistant/service-turn-routes.ts'
import {
  persistAssistantTurnAndSession,
  type AssistantProviderResumeStateAction,
} from '../src/assistant/turn-finalizer.ts'

beforeEach(() => {
  runtimeState.sessionsSave.mockClear()
  runtimeState.transcriptsAppend.mockClear()
  runtimeState.transcriptsList.mockClear()
  runtimeState.turnsAppendEvent.mockClear()
})

describe('automation model continuity', () => {
  it.each([
    {
      expectedModel: 'gpt-5.5',
      label: 'managed OpenAI on GPT-5.5',
      selectedModel: 'gpt-5.6-terra',
      selectedProvider: HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
    },
    {
      expectedModel: 'murph-custom-r7',
      label: 'custom inference on its opaque model',
      selectedModel: 'murph-custom-r7',
      selectedProvider: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
    },
  ])('keeps member-memory maintenance inside $label', ({
    expectedModel,
    selectedModel,
    selectedProvider,
  }) => {
    const route = resolveAssistantTurnRoute(
      createMemberMemoryInput(),
      null,
      resolvedSession(createGroupSession(
        requireTarget(selectedModel, 'low', selectedProvider),
        null,
      )),
    )

    expect(route.providerOptions).toMatchObject({
      model: expectedModel,
      modelProvider: selectedProvider,
      reasoningEffort: 'low',
    })
  })

  it('fails member-memory maintenance before unsupported Venice provider entry', () => {
    const veniceTarget = requireTarget(
      'gpt-5.6-terra',
      'low',
      VENICE_CODEX_MODEL_PROVIDER_ID,
    )

    expect(() => resolveAssistantTurnRoute(
      createMemberMemoryInput(),
      null,
      resolvedSession(createGroupSession(veniceTarget, null)),
    )).toThrow(expect.objectContaining({
      code: 'ASSISTANT_PROVIDER_UNSUPPORTED',
    }))
  })

  it.each([
    ['gpt-5.6-luna', 'high'],
    ['gpt-5.6-terra', 'low'],
    ['gpt-5.6-sol', 'low'],
  ] as const)(
    'applies the canonical %s reasoning default to model-only stored overrides',
    (model, reasoningEffort) => {
      const selectedTarget = requireTarget('gpt-5.6-sol', 'xhigh')
      const session = createGroupSession(selectedTarget, null)

      const route = resolveAssistantTurnRoute(
        createAutomationInput({ model }),
        null,
        resolvedSession(session),
      )

      expect(route.providerOptions).toMatchObject({
        model,
        reasoningEffort,
      })
    },
  )

  it('returns a Luna reminder reply to Sol on the same compatible provider thread', async () => {
    const solTarget = requireTarget('gpt-5.6-sol', 'low')
    const providerThreadId = 'provider-managed-thread'
    const session = createGroupSession(
      solTarget,
      createResumeState(solTarget, providerThreadId),
    )
    const turnInput = createAutomationInput({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    })
    const lunaRoute = resolveAssistantTurnRoute(
      turnInput,
      null,
      resolvedSession(session),
    )
    const reminderText = 'Burpee time. Twenty clean reps, then continue your day.'

    expect(lunaRoute.providerOptions).toMatchObject({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    })

    const saved = await persistAutomationTurn({
      route: lunaRoute,
      session,
      text: reminderText,
      threadId: providerThreadId,
      turnInput,
    })

    expect(runtimeState.transcriptsAppend).toHaveBeenCalledWith(
      session.sessionId,
      [
        {
          kind: 'assistant',
          text: reminderText,
        },
      ],
    )
    expect(saved.target).toEqual(solTarget)
    expect(saved.providerOptions).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
    })
    expect(saved.resumeState?.threadId).toBe(providerThreadId)
    expect(saved.codexResume?.threadId).toBe(providerThreadId)

    const replyRoute = resolveAssistantTurnRoute(
      {
        prompt: 'Done. That was brutal.',
        vault: '/vault',
      },
      null,
      resolvedSession(saved),
    )

    expect(replyRoute.providerOptions).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
    })
    expect(
      resolveAssistantRouteResumeBinding({
        route: replyRoute,
        sessionResumeState: saved.resumeState,
      })?.threadId,
    ).toBe(providerThreadId)
  })

  it('clears the old selected-model thread after an isolated lower-tier turn', async () => {
    const solTarget = requireTarget('gpt-5.6-sol', 'low')
    const session = createGroupSession(
      solTarget,
      createResumeState(solTarget, 'provider-sol-thread'),
    )
    const turnInput = createAutomationInput({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    })
    const lunaRoute = resolveAssistantTurnRoute(
      turnInput,
      null,
      resolvedSession(session),
    )

    const saved = await persistAutomationTurn({
      providerResumeStateAction: 'preserve-existing',
      route: lunaRoute,
      session,
      text: 'Isolated Luna reminder.',
      threadId: 'provider-isolated-luna-thread',
      turnInput,
    })

    expect(saved.target).toEqual(solTarget)
    expect(saved.resumeState).toBeNull()
    expect(saved.codexResume).toBeNull()
  })

  it('inherits member custom inference and preserves its compatible resume state', async () => {
    const customTarget = requireTarget(
      'glm-5.2',
      'low',
      HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
    )
    const providerThreadId = 'provider-custom-thread'
    const session = createGroupSession(
      customTarget,
      createResumeState(customTarget, providerThreadId),
    )
    const turnInput = createAutomationInput({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    })
    const route = resolveAssistantTurnRoute(
      turnInput,
      null,
      resolvedSession(session),
    )

    expect(route.providerOptions).toMatchObject({
      model: 'glm-5.2',
      modelProvider: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
      reasoningEffort: 'low',
    })

    const saved = await persistAutomationTurn({
      route,
      session,
      text: 'Custom inference reminder.',
      threadId: providerThreadId,
      turnInput,
    })

    expect(saved.target).toEqual(customTarget)
    expect(saved.resumeState?.threadId).toBe(providerThreadId)
    expect(
      resolveAssistantRouteResumeBinding({
        route,
        sessionResumeState: saved.resumeState,
      })?.threadId,
    ).toBe(providerThreadId)
  })

  it('keeps arbitrary custom model overrides turn-scoped and falls back through history', async () => {
    const customTarget = requireTarget(
      'glm-5.2',
      'low',
      HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
    )
    const session = createGroupSession(
      customTarget,
      createResumeState(customTarget, 'provider-custom-52-thread'),
    )
    const turnInput = createAutomationInput({
      model: 'glm-5.3',
      reasoningEffort: 'high',
    })
    const route = resolveAssistantTurnRoute(
      turnInput,
      null,
      resolvedSession(session),
    )

    expect(route.providerOptions).toMatchObject({
      model: 'glm-5.3',
      modelProvider: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
      reasoningEffort: 'low',
    })

    const saved = await persistAutomationTurn({
      route,
      session,
      text: 'Custom model reminder.',
      threadId: 'provider-custom-53-thread',
      turnInput,
    })

    expect(saved.target).toEqual(customTarget)
    expect(saved.resumeState).toBeNull()
    expect(saved.codexResume).toBeNull()
  })

  it('evaluates the automation preference after a current-turn provider transition', () => {
    const customTarget = requireTarget(
      'glm-5.2',
      'low',
      HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
    )
    const session = createGroupSession(customTarget, null)

    const route = resolveAssistantTurnRoute(
      {
        ...createAutomationInput({ model: 'gpt-5.6-luna' }),
        model: 'gpt-5.6-sol',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'low',
      },
      null,
      resolvedSession(session),
    )

    expect(route.providerOptions).toMatchObject({
      model: 'gpt-5.6-luna',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'high',
    })
  })

  it('preserves an explicit provider transition authored through the canonical contract', () => {
    const customTarget = requireTarget(
      'glm-5.2',
      'low',
      HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
    )
    const session = createGroupSession(customTarget, null)

    const route = resolveAssistantTurnRoute(
      createAutomationInput({
        model: 'gpt-5.6-luna',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
      }),
      null,
      resolvedSession(session),
    )

    expect(route.providerOptions).toMatchObject({
      model: 'gpt-5.6-luna',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'high',
    })
  })
})

function createAutomationInput(
  assistantTargetOverride: NonNullable<
    Parameters<typeof resolveAssistantTurnRoute>[0]['assistantTargetOverride']
  >,
): Parameters<typeof resolveAssistantTurnRoute>[0] {
  return {
    assistantTargetOverride,
    prompt: 'Send the scheduled reminder.',
    turnTrigger: 'automation-cron',
    vault: '/vault',
  }
}

function createMemberMemoryInput(): Parameters<
  typeof resolveAssistantTurnRoute
>[0] {
  return {
    ...createAutomationInput({
      model: 'gpt-5.6-sol',
      modelProvider: HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
      reasoningEffort: 'high',
    }),
    maintenanceProfile: 'member-memory',
  }
}

function createGroupSession(
  target: AssistantModelTarget,
  resumeState: AssistantSession['resumeState'],
): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-conversation.v2',
    alias: null,
    binding: createAssistantBinding({
      actorId: 'group-member',
      channel: 'linq',
      deliveryKind: 'thread',
      deliveryTarget: 'group-thread',
      identityId: 'linq-line',
      threadId: 'group-thread',
      threadIsDirect: false,
    }),
    codexResume: resumeState,
    codexTarget: target,
    conversationId: 'conversation-group',
    createdAt: '2026-08-07T00:00:00.000Z',
    lastTurnAt: '2026-08-07T00:30:00.000Z',
    turnCount: 3,
    updatedAt: '2026-08-07T00:30:00.000Z',
  })
}

function createResumeState(
  target: AssistantModelTarget,
  threadId: string,
): AssistantSession['resumeState'] {
  const route = resolveAssistantExecutionPlan({
    defaults: null,
    sessionTarget: target,
  }).codexRoute
  return buildCodexResumeState({
    assistantContractFingerprint: 'a'.repeat(64),
    rolloutRelativePath: null,
    routeFingerprint: readCodexThreadRouteFingerprint(route),
    threadCompatibilityFingerprint:
      readCodexThreadCompatibilityFingerprint(route),
    threadId,
  })
}

function createProviderResult(input: {
  route: CodexThreadIdentity
  session: AssistantSession
  text: string
  threadId: string
}): ExecutedAssistantProviderTurnResult {
  return {
    acceptedNoReplyDeliveryContextOrdinals: [],
    additionalUsages: [],
    assistantContractFingerprint: 'b'.repeat(64),
    attemptCount: 1,
    codexContinuation: {
      kind: 'provider-state-optimization',
    },
    codexRolloutRelativePath: null,
    codexThreadId: input.threadId,
    provider: 'codex-cli',
    providerOptions: input.route.providerOptions,
    rawEvents: [],
    response: input.text,
    responseCard: null,
    responseDeliveryContextOrdinal: 0,
    responseMedia: [],
    route: input.route,
    session: input.session,
    stderr: '',
    stdout: '',
    transcriptResponse: input.text,
    usage: null,
    workingDirectory: '/vault',
  }
}

async function persistAutomationTurn(input: {
  providerResumeStateAction?: AssistantProviderResumeStateAction
  route: CodexThreadIdentity
  session: AssistantSession
  text: string
  threadId: string
  turnInput: Parameters<typeof resolveAssistantTurnRoute>[0]
}): Promise<AssistantSession> {
  return await persistAssistantTurnAndSession({
    assistantTranscriptText: input.text,
    input: input.turnInput,
    persistUserPromptToTranscript: false,
    plan: {
      persistUserPromptOnFailure: false,
    } as AssistantTurnSharedPlan,
    providerResult: createProviderResult(input),
    providerResumeStateAction:
      input.providerResumeStateAction ?? 'persist-from-provider-turn',
    session: input.session,
    turnCreatedAt: '2026-08-07T01:00:00.000Z',
    turnId: 'turn-automation-reminder',
  })
}

function resolvedSession(session: AssistantSession): Parameters<
  typeof resolveAssistantTurnRoute
>[2] {
  return { session } as Parameters<typeof resolveAssistantTurnRoute>[2]
}

function requireTarget(
  model: string,
  reasoningEffort: string,
  modelProvider = 'vercel-ai-gateway',
): AssistantModelTarget {
  const target = createAssistantModelTarget({
    model,
    modelProvider,
    provider: 'codex-cli',
    reasoningEffort,
  })
  if (!target) {
    throw new TypeError(`Expected a target for ${model}.`)
  }
  return target
}
