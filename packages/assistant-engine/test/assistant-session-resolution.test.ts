import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  parseAssistantSessionRecord,
  type AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'

const sessionResolutionMocks = vi.hoisted(() => ({
  reconcilePrivateCompletion: vi.fn(),
  resolveAssistantSession: vi.fn(),
}))

vi.mock('../src/assistant/store.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
    '../src/assistant/store.ts',
  )

  return {
    ...actual,
    resolveAssistantSession: sessionResolutionMocks.resolveAssistantSession,
  }
})

vi.mock('../src/assistant/private-completion-continuity.js', () => ({
  reconcileAssistantPrivateCompletionContinuityForSession:
    sessionResolutionMocks.reconcilePrivateCompletion,
}))

import {
  buildResolveAssistantSessionInput,
  resolveAssistantSessionForMessage,
  resolveAssistantSessionTarget,
} from '../src/assistant/session-resolution.ts'
import { resolveAssistantExecutionPlan } from '../src/assistant/execution-plan.ts'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
} from '../src/assistant/codex-thread-route.ts'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from '../src/assistant/service-contracts.ts'

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

sessionResolutionMocks.reconcilePrivateCompletion.mockImplementation(
  async ({ sessionId }: { sessionId: string }) => {
    const resolved = sessionResolutionMocks.resolveAssistantSession.mock.results
      .at(-1)?.value
    const value = await resolved
    if (value?.session.sessionId !== sessionId) {
      throw new Error('Expected the resolved session to match reconciliation.')
    }
    return value.session
  },
)

function createOperatorDefaults(
  overrides: Partial<AssistantOperatorDefaults> = {},
): AssistantOperatorDefaults {
  return {
    backend: null,
    identityId: null,
    selfDeliveryTargets: null,
    ...overrides,
  }
}

function expectAssistantTarget(
  target: AssistantModelTarget | null,
): AssistantModelTarget {
  if (!target) {
    throw new Error('Expected assistant model target.')
  }

  return target
}

function createCodexTarget(
  overrides: Partial<{
    approvalPolicy: 'never'
    modelProvider: string
    codexHome: string
    model: string
    oss: boolean
    profile: string
    reasoningEffort: 'high' | 'low' | 'medium'
    sandbox: 'danger-full-access' | 'read-only' | 'workspace-write'
  }> = {},
): AssistantModelTarget {
  return expectAssistantTarget(createAssistantModelTarget({
    provider: 'codex-cli',
    model: 'gpt-5-codex',
    ...overrides,
  }))
}

function createResolutionInput(
  overrides: Partial<AssistantSessionResolutionFields> = {},
): AssistantSessionResolutionFields {
  return {
    vault: '/tmp/assistant-session-resolution-vault',
    ...overrides,
  }
}

function createMessageInput(
  overrides: Partial<AssistantMessageInput> = {},
): AssistantMessageInput {
  return {
    prompt: 'Summarize the session state.',
    vault: '/tmp/assistant-session-resolution-vault',
    ...overrides,
  }
}

function createTestAssistantSession(input: {
  resumeState?: AssistantSessionResumeState | null
  sessionId?: string
  target: AssistantModelTarget
}) {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-session.v1',
    sessionId: input.sessionId ?? 'session-123',
    target: input.target,
    resumeState: input.resumeState ?? null,
    alias: 'conversation-alias',
    binding: {
      actorId: 'conversation-participant',
      channel: 'telegram',
      conversationKey: 'channel:telegram|actor:conversation-participant',
      delivery: null,
      identityId: 'default-identity',
      threadId: 'conversation-thread',
      threadIsDirect: true,
    },
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  })
}

function createResolvedAssistantSessionForTest(input: {
  resumeState?: AssistantSessionResumeState | null
  sessionId?: string
  target: AssistantModelTarget
}) {
  return {
    created: false,
    paths: {
      indexesDirectory: '/tmp/indexes',
      rootDirectory: '/tmp/root',
      sessionsDirectory: '/tmp/sessions',
      statusDirectory: '/tmp/status',
      transcriptsDirectory: '/tmp/transcripts',
    },
    session: createTestAssistantSession(input),
  }
}

function createResumeStateForTarget(
  target: AssistantModelTarget,
  threadId: string,
): AssistantSessionResumeState {
  const route = resolveAssistantExecutionPlan({
    defaults: null,
    sessionTarget: target,
  }).codexRoute
  return {
    routeFingerprint: readCodexThreadRouteFingerprint(route),
    threadId,
  }
}

describe('assistant session resolution', () => {
  it('prefers conversation identifiers over message fields and shapes Codex config', () => {
    const defaults = createOperatorDefaults({
      identityId: 'default-identity',
    })

    const result = buildResolveAssistantSessionInput(
      createResolutionInput({
        actorId: 'message-actor',
        alias: 'message-alias',
        allowBindingRebind: true,
        approvalPolicy: 'never',
        channel: 'sms',
        conversation: {
          alias: 'conversation-alias',
          channel: 'telegram',
          directness: 'group',
          identityId: 'conversation-identity',
          participantId: 'conversation-participant',
          sessionId: 'conversation-session',
          threadId: 'conversation-thread',
        },
        identityId: 'message-identity',
        maxSessionAgeMs: 90_000,
        model: 'gpt-5.6-terra',
        modelProvider: 'vercel-ai-gateway',
        provider: 'codex-cli',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        sessionId: 'message-session',
        threadId: 'message-thread',
        threadIsDirect: true,
      }),
      defaults,
    )

    expect(result).toEqual({
      vault: '/tmp/assistant-session-resolution-vault',
      sessionId: 'conversation-session',
      alias: 'conversation-alias',
      allowBindingRebind: true,
      channel: 'telegram',
      identityId: 'conversation-identity',
      actorId: 'conversation-participant',
      threadId: 'conversation-thread',
      threadIsDirect: true,
      target: createCodexTarget({
        approvalPolicy: 'never',
        model: 'gpt-5.6-terra',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      }),
      provider: 'codex-cli',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
      oss: false,
      profile: null,
      reasoningEffort: 'high',
      maxSessionAgeMs: 90_000,
    })
  })

  it('derives actor, thread, directness, and codex defaults when conversation fields are absent', () => {
    const result = buildResolveAssistantSessionInput(
      createResolutionInput({
        actorId: 'message-actor',
        allowBindingRebind: false,
        conversation: {
          directness: 'group',
        },
        model: 'gpt-5-codex',
        provider: 'codex-cli',
        threadId: 'source-thread',
      }),
      createOperatorDefaults({
        identityId: 'default-identity',
      }),
    )

    expect(result).toMatchObject({
      vault: '/tmp/assistant-session-resolution-vault',
      identityId: 'default-identity',
      actorId: 'message-actor',
      threadId: 'source-thread',
      threadIsDirect: false,
      provider: 'codex-cli',
      model: 'gpt-5-codex',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      profile: null,
      reasoningEffort: 'low',
      maxSessionAgeMs: null,
    })
    expect(result).not.toHaveProperty('allowBindingRebind')
    expect(result.target).toMatchObject({
      adapter: 'codex-cli',
      approvalPolicy: null,
      model: 'gpt-5-codex',
      reasoningEffort: 'low',
      sandbox: null,
    })
  })

  it('falls back to message channel when normalized conversation channel is empty', () => {
    const result = buildResolveAssistantSessionInput(
      createResolutionInput({
        bindingDeliveryTarget: 'telegram-thread-1',
        channel: 'telegram',
        conversation: {
          channel: null,
          directness: 'direct',
          threadId: 'telegram-thread-1',
        },
        provider: 'codex-cli',
      }),
      createOperatorDefaults({
        backend: createCodexTarget(),
      }),
    )

    expect(result).toMatchObject({
      bindingDeliveryTarget: 'telegram-thread-1',
      channel: 'telegram',
      threadId: 'telegram-thread-1',
      threadIsDirect: true,
    })
  })

  it('keeps binding delivery target separate from message explicit target', () => {
    const result = buildResolveAssistantSessionInput(
      createResolutionInput({
        actorId: 'hid_linq_actor',
        bindingDeliveryTarget: '+15550100001',
        channel: 'linq',
        deliveryKind: 'participant',
        identityId: 'hid_linq_identity',
        provider: 'codex-cli',
        threadIsDirect: true,
      }),
      createOperatorDefaults({
        backend: createCodexTarget(),
      }),
    )

    expect(result).toMatchObject({
      actorId: 'hid_linq_actor',
      bindingDeliveryTarget: '+15550100001',
      channel: 'linq',
      deliveryKind: 'participant',
      identityId: 'hid_linq_identity',
      threadIsDirect: true,
    })
    expect(result).not.toHaveProperty('deliveryTarget')
  })

  it('resolves targets from boundary defaults, operator defaults, and explicit overrides in order', () => {
    const boundaryDefaultTarget = createDefaultLocalAssistantModelTarget()
    const defaultsBackend = createCodexTarget({
      modelProvider: 'vercel-ai-gateway',
      model: 'gpt-5-default',
      reasoningEffort: 'low',
      sandbox: 'read-only',
    })

    expect(
      resolveAssistantSessionTarget({
        boundaryDefaultTarget,
        defaults: null,
        input: createResolutionInput(),
      }),
    ).toMatchObject({
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      model: null,
      oss: false,
      profile: null,
      reasoningEffort: 'low',
      sandbox: 'danger-full-access',
    })

    expect(
      resolveAssistantSessionTarget({
        boundaryDefaultTarget,
        defaults: createOperatorDefaults({
          backend: defaultsBackend,
        }),
        input: createResolutionInput(),
      }),
    ).toMatchObject({
      adapter: 'codex-cli',
      modelProvider: 'vercel-ai-gateway',
      model: 'gpt-5-default',
      reasoningEffort: 'low',
      sandbox: 'read-only',
    })

    expect(
      resolveAssistantSessionTarget({
        boundaryDefaultTarget,
        defaults: createOperatorDefaults({
          backend: defaultsBackend,
        }),
        input: createResolutionInput({
          model: 'gpt-5-codex-override',
          provider: 'codex-cli',
          sandbox: 'workspace-write',
        }),
      }),
    ).toEqual(createCodexTarget({
      model: 'gpt-5-codex-override',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
    }))
  })

  it('keeps provider-only overrides off durable state while using the session target', () => {
    const sessionTarget = createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'low',
    })

    const plan = resolveAssistantExecutionPlan({
      defaults: null,
      override: {
        provider: 'codex-cli',
      },
      sessionTarget,
    })

    expect(plan.primaryTarget).toMatchObject({
      adapter: 'codex-cli',
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'low',
    })
    expect(plan.codexRoute.providerOptions).toMatchObject({
      provider: 'codex-cli',
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'low',
    })

    expect(() =>
      resolveAssistantExecutionPlan({
        defaults: null,
        override: {
          provider: 'unsupported-provider',
        },
        sessionTarget,
      }),
    ).toThrowError(/Assistant runtime targets must use Codex App Server/u)
  })

  it('forwards the built message-resolution input into store resolution and returns its result', async () => {
    const defaults = createOperatorDefaults({
      backend: createCodexTarget({
        model: 'gpt-5-codex-default',
      }),
      identityId: 'default-identity',
    })
    const boundaryDefaultTarget = createDefaultLocalAssistantModelTarget()
    const message = createMessageInput({
      actorId: 'message-actor',
      conversation: {
        alias: 'conversation-alias',
        channel: 'telegram',
        directness: 'direct',
        identityId: null,
        participantId: 'conversation-participant',
        sessionId: null,
        threadId: 'conversation-thread',
      },
      maxSessionAgeMs: 45_000,
    })
    const resolvedSession = {
      created: false,
      paths: {
        indexesDirectory: '/tmp/indexes',
        rootDirectory: '/tmp/root',
        sessionsDirectory: '/tmp/sessions',
        statusDirectory: '/tmp/status',
        transcriptsDirectory: '/tmp/transcripts',
      },
      session: {
        alias: 'conversation-alias',
        binding: {
          actorId: 'conversation-participant',
          channel: 'telegram',
          conversationKey: 'channel:telegram|actor:conversation-participant',
          delivery: null,
          identityId: 'default-identity',
          threadId: 'conversation-thread',
          threadIsDirect: true,
        },
        createdAt: '2026-04-08T00:00:00.000Z',
        lastTurnAt: null,
        provider: 'codex-cli',
        providerOptions: {
          approvalPolicy: 'never',
          model: 'gpt-5-codex-default',
          oss: false,
          profile: null,
          reasoningEffort: 'medium',
          sandbox: 'danger-full-access',
        },
        resumeState: null,
        schema: 'murph.assistant-session.v1',
        sessionId: 'session-123',
        target: createDefaultLocalAssistantModelTarget(),
        turnCount: 0,
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
    }
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    await expect(
      resolveAssistantSessionForMessage({
        boundaryDefaultTarget,
        defaults,
        message,
      }),
    ).resolves.toMatchObject(resolvedSession)

    expect(sessionResolutionMocks.resolveAssistantSession).toHaveBeenCalledTimes(1)
    expect(sessionResolutionMocks.resolveAssistantSession).toHaveBeenCalledWith(
      buildResolveAssistantSessionInput(message, defaults, boundaryDefaultTarget),
    )
    expect(sessionResolutionMocks.reconcilePrivateCompletion).toHaveBeenCalledWith({
      sessionId: resolvedSession.session.sessionId,
      vault: message.vault,
    })
  })

  it('repairs hosted direct text from canonical conversation and accepted input authority', async () => {
    const target = createDefaultLocalAssistantModelTarget()
    const resolvedSession = createResolvedAssistantSessionForTest({ target })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: target,
      defaults: null,
      message: createMessageInput({
        acceptedTurnInput: {
          initialInputs: [{
            id: 'input-hosted-direct-text',
            source: 'assistant-input',
          }],
        },
        conversation: {
          alias: null,
          channel: 'linq',
          directness: 'direct',
          identityId: 'identity-hosted-direct-text',
          participantId: 'participant-hosted-direct-text',
          sessionId: null,
          threadId: 'thread-hosted-direct-text',
        },
        threadIsDirect: undefined,
        turnTrigger: 'automation-auto-reply',
        userMessageContent: null,
      }),
    })

    expect(sessionResolutionMocks.reconcilePrivateCompletion).toHaveBeenCalledWith({
      sessionId: resolvedSession.session.sessionId,
      vault: '/tmp/assistant-session-resolution-vault',
    })
  })

  it('does not repair direct system continuation work without accepted input', async () => {
    const target = createDefaultLocalAssistantModelTarget()
    const resolvedSession = createResolvedAssistantSessionForTest({ target })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: target,
      defaults: null,
      message: createMessageInput({
        conversation: {
          alias: null,
          channel: 'linq',
          directness: 'direct',
          identityId: 'identity-system-continuation',
          participantId: 'participant-system-continuation',
          sessionId: null,
          threadId: 'thread-system-continuation',
        },
        turnTrigger: 'automation-auto-reply',
        userMessageContent: null,
      }),
    })

    expect(sessionResolutionMocks.reconcilePrivateCompletion).not.toHaveBeenCalled()
  })

  it('repairs manual direct asks regardless of multimodal payload shape', async () => {
    const target = createDefaultLocalAssistantModelTarget()
    const resolvedSession = createResolvedAssistantSessionForTest({ target })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: target,
      defaults: null,
      message: createMessageInput({
        threadIsDirect: true,
        turnTrigger: 'manual-ask',
        userMessageContent: [{
          text: 'Inspect this image.',
          type: 'text',
        }],
      }),
    })

    expect(sessionResolutionMocks.reconcilePrivateCompletion).toHaveBeenCalledOnce()
  })

  it('projects a hosted model change while preserving native thread continuity', async () => {
    const previousTarget = createCodexTarget({
      model: 'gpt-5.4',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'medium',
    })
    const hostedDefaultTarget = createCodexTarget({
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'high',
    })
    const resolvedSession = createResolvedAssistantSessionForTest({
      target: previousTarget,
      resumeState: createResumeStateForTarget(previousTarget, 'thread_old'),
    })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    const result = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: hostedDefaultTarget,
      defaults: createOperatorDefaults({
        backend: hostedDefaultTarget,
      }),
      message: createMessageInput({
        executionContext: {
          hosted: {
            defaultTarget: hostedDefaultTarget,
            memberId: 'member-123',
            userEnvKeys: [],
          },
        },
      }),
    })

    expect(result).not.toBe(resolvedSession)
    expect(result.created).toBe(false)
    expect(result.paths).toBe(resolvedSession.paths)
    expect(result.session.sessionId).toBe(resolvedSession.session.sessionId)
    expect(result.session.target).toEqual(hostedDefaultTarget)
    expect(result.session.providerOptions.model).toBe('gpt-5.6-terra')
    expect(result.session.providerOptions.modelProvider).toBe('vercel-ai-gateway')
    expect(result.session.providerOptions.reasoningEffort).toBe('high')
    expect(result.session.resumeState).toMatchObject({
      routeFingerprint: readCodexThreadRouteFingerprint(
        resolveAssistantExecutionPlan({
          defaults: null,
          sessionTarget: previousTarget,
        }).codexRoute,
      ),
      threadCompatibilityFingerprint: readCodexThreadCompatibilityFingerprint(
        resolveAssistantExecutionPlan({
          defaults: null,
          sessionTarget: hostedDefaultTarget,
        }).codexRoute,
      ),
      threadId: 'thread_old',
    })
    expect(resolvedSession.session.target).toEqual(previousTarget)
    expect(resolvedSession.session.resumeState?.threadId).toBe('thread_old')
  })

  it('clears native resume when the model provider changes', async () => {
    const previousTarget = createCodexTarget({
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'low',
    })
    const nextTarget = createCodexTarget({
      model: 'gpt-5.6-terra',
      modelProvider: 'openai',
      reasoningEffort: 'low',
    })
    const resolvedSession = createResolvedAssistantSessionForTest({
      target: previousTarget,
      resumeState: createResumeStateForTarget(previousTarget, 'thread_old'),
    })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    const result = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: nextTarget,
      defaults: createOperatorDefaults({
        backend: nextTarget,
      }),
      message: createMessageInput({
        executionContext: {
          hosted: {
            defaultTarget: nextTarget,
            memberId: 'member-123',
            userEnvKeys: [],
          },
        },
      }),
    })

    expect(result.session.target).toEqual(nextTarget)
    expect(result.session.resumeState).toBeNull()
  })

  it('projects explicit message target overrides into hosted sessions before turn routing', async () => {
    const hostedDefaultTarget = createCodexTarget({
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'low',
    })
    const resolvedSession = createResolvedAssistantSessionForTest({
      target: hostedDefaultTarget,
      resumeState: createResumeStateForTarget(hostedDefaultTarget, 'thread_low'),
    })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    const result = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: hostedDefaultTarget,
      defaults: createOperatorDefaults({
        backend: hostedDefaultTarget,
      }),
      message: createMessageInput({
        executionContext: {
          hosted: {
            defaultTarget: hostedDefaultTarget,
            memberId: 'member-123',
            userEnvKeys: [],
          },
        },
        reasoningEffort: 'high',
      }),
    })

    expect(result.session.target).toEqual(createCodexTarget({
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'high',
    }))
    expect(result.session.providerOptions.reasoningEffort).toBe('high')
    expect(result.session.resumeState?.threadId).toBe('thread_low')
    expect(result.session.resumeState?.threadCompatibilityFingerprint).toEqual(
      readCodexThreadCompatibilityFingerprint(
        resolveAssistantExecutionPlan({
          defaults: null,
          sessionTarget: hostedDefaultTarget,
        }).codexRoute,
      ),
    )
    expect(resolvedSession.session.providerOptions.reasoningEffort).toBe('low')
  })

  it('merges explicit message target overrides over existing non-hosted session targets', async () => {
    const sessionTarget = createCodexTarget({
      codexHome: '/tmp/murph-session-resolution-codex-home',
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
    })
    const resolvedSession = createResolvedAssistantSessionForTest({
      target: sessionTarget,
      resumeState: createResumeStateForTarget(sessionTarget, 'thread_low'),
    })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    const result = await resolveAssistantSessionForMessage({
      defaults: null,
      message: createMessageInput({
        reasoningEffort: 'high',
      }),
    })

    expect(result.session.target).toEqual(createCodexTarget({
      codexHome: '/tmp/murph-session-resolution-codex-home',
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    }))
    expect(result.session.providerOptions).toMatchObject({
      codexHome: '/tmp/murph-session-resolution-codex-home',
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    })
    expect(result.session.resumeState?.threadId).toBe('thread_low')
    expect(resolvedSession.session.target).toEqual(sessionTarget)
    expect(resolvedSession.session.resumeState?.threadId).toBe('thread_low')
  })

  it('keeps hosted resume state when the hosted default continuity has not changed', async () => {
    const hostedDefaultTarget = createCodexTarget({
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'high',
    })
    const resumeState = {
      routeFingerprint: 'route-current',
      threadId: 'resp_current',
    }
    const resolvedSession = createResolvedAssistantSessionForTest({
      target: hostedDefaultTarget,
      resumeState,
    })
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    const result = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: hostedDefaultTarget,
      defaults: createOperatorDefaults({
        backend: hostedDefaultTarget,
      }),
      message: createMessageInput({
        executionContext: {
          hosted: {
            defaultTarget: hostedDefaultTarget,
            memberId: 'member-123',
            userEnvKeys: [],
          },
        },
      }),
    })

    expect(result.session.target).toEqual(hostedDefaultTarget)
    expect(result.session.resumeState).toEqual(resumeState)
  })
})
