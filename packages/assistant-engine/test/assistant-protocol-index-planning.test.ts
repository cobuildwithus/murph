import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import {
  ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV,
  ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV,
} from '@murphai/operator-config/assistant/current-delivery-route'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'

const runtimeMocks = vi.hoisted(() => ({
  listGeneratedAssistantProtocolIndexEntries: vi.fn(() => {
    throw new Error('generated artifacts unavailable')
  }),
}))

const planningMocks = vi.hoisted(() => ({
  readAssistantCliSurfaceBootstrapContext:
    vi.fn(async (): Promise<string | null> => 'bootstrap contract'),
  readAssistantContextSnapshotPrompt:
    vi.fn(async (): Promise<string | null> => null),
  resolveCodexAssistantTargetCapabilities: vi.fn(() => ({
    supportsNativeResume: false,
  })),
}))

vi.mock('@murphai/health-commons/runtime', () => ({
  listGeneratedAssistantProtocolIndexEntries:
    runtimeMocks.listGeneratedAssistantProtocolIndexEntries,
}))

vi.mock('../src/assistant/cli-surface-bootstrap.js', () => ({
  readAssistantCliSurfaceBootstrapContext:
    planningMocks.readAssistantCliSurfaceBootstrapContext,
}))

vi.mock('../src/assistant/codex-runtime.js', () => ({
  resolveCodexAssistantTargetCapabilities:
    planningMocks.resolveCodexAssistantTargetCapabilities,
}))

vi.mock('../src/assistant/context-snapshot.js', () => ({
  readAssistantContextSnapshotPrompt:
    planningMocks.readAssistantContextSnapshotPrompt,
}))

import {
  buildCodexTurnExecutionPlan,
  resolveAssistantRouteTurnPlan,
  type AssistantCodexTurnResolvedExecutionProfile,
} from '../src/assistant/codex-turn/planning.js'
import {
  buildAssistantSkillFileRef,
} from '../src/assistant-skill-assets.js'
import { appendAssistantTranscriptEntries } from '../src/assistant/store.js'
import type { AssistantActiveTurnProviderHistory } from '../src/assistant/active-turn-history.js'
import type { AssistantMessageInput } from '../src/assistant/service-contracts.js'
import type { AssistantTurnSharedPlan } from '../src/assistant/service-contracts.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexThreadIdentity } from '../src/assistant/codex-thread-route.js'

afterEach(() => {
  runtimeMocks.listGeneratedAssistantProtocolIndexEntries.mockReset()
  planningMocks.readAssistantCliSurfaceBootstrapContext.mockReset()
  planningMocks.readAssistantContextSnapshotPrompt.mockReset()
  planningMocks.resolveCodexAssistantTargetCapabilities.mockReset()
})

describe('assistant protocol index planning', () => {
  it('passes current explicit delivery routes through private provider env only for foreground turns', async () => {
    const foregroundPlan = await buildCodexTurnExecutionPlan({
      activeTurnHistory: null,
      input: {
        ...createMessageInput(),
        channel: 'linq',
        deliveryTarget: 'linq_chat_real',
      },
      plan: createSharedPlan(),
      resolvedSession: createSession(),
      route: createRoute(),
      turnCreatedAt: '2026-05-04T00:00:00.000Z',
      turnId: 'turn-test',
    })
    expect(
      foregroundPlan.memoryTurnEnv[ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV],
    ).toBe('linq')
    expect(
      foregroundPlan.memoryTurnEnv[ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV],
    ).toBe('linq_chat_real')

    const cronPlan = await buildCodexTurnExecutionPlan({
      activeTurnHistory: null,
      input: {
        ...createMessageInput(),
        channel: 'linq',
        deliveryTarget: 'linq_chat_real',
        turnTrigger: 'automation-cron',
      },
      plan: createSharedPlan(),
      resolvedSession: createSession(),
      route: createRoute(),
      turnCreatedAt: '2026-05-04T00:00:00.000Z',
      turnId: 'turn-test',
    })
    expect(
      cronPlan.memoryTurnEnv[ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV],
    ).toBeUndefined()
    expect(
      cronPlan.memoryTurnEnv[ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV],
    ).toBeUndefined()
  })

  it('soft-fails to an empty assistant protocol index when generated artifacts are unavailable', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }

    const plan = await resolveAssistantRouteTurnPlan({
      activeTurnHistory: {
        acceptedInputIds: [],
        messages: [
          {
            content: 'hello',
            role: 'user',
          },
        ],
        nonReplayableProviderWork: false,
      } satisfies AssistantActiveTurnProviderHistory,
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(runtimeMocks.listGeneratedAssistantProtocolIndexEntries).toHaveBeenCalledTimes(1)
    expect(plan.assistantCliContract).toBe('bootstrap contract')
    expect(plan.systemPrompt).toContain('Execution style:')
    expect(plan.systemPrompt).not.toContain('Supported experiment protocols:')
  })

  it('injects conversation onboarding skill activation through route planning', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan({
        onboardingGuidanceOpen: true,
      }),
    })

    const skillRef = buildAssistantSkillFileRef('conversation-onboarding')

    expect(plan.onboardingGuidanceInjected).toBe(true)
    expect(plan.systemPrompt).toContain(skillRef)
    expect(plan.turnContextPrompt).toContain('Conversation onboarding:')
    expect(plan.turnContextPrompt).toContain(
      `Before replying, read \`${skillRef}\``,
    )
    expect(plan.turnContextPrompt).not.toContain(
      'roughly 3-4 short assistant messages',
    )
    expect(plan.turnContextPrompt).not.toContain('Natural first-run flow')
  })

  it('resumes Codex threads without refreshing bootstrap developer instructions', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const route = createRoute()

    const initialPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(initialPlan.refreshThreadInstructions).toBe(true)
    expect(initialPlan.developerInstructions).toContain('bootstrap contract')
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockClear()
    planningMocks.readAssistantContextSnapshotPrompt.mockClear()

    const resumedSession = createSession({
      resumeState: {
        routeFingerprint: route.routeFingerprint ?? route.routeId,
        threadId: 'thread-resume',
      },
    })
    const resumedPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: resumedSession,
      sharedPlan: createSharedPlan(),
    })

    expect(resumedPlan.resumeCodexThreadId).toBe('thread-resume')
    expect(resumedPlan.refreshThreadInstructions).toBe(false)
    expect(resumedPlan.developerInstructions).toBeNull()
    expect(resumedPlan.sessionContext).toBeUndefined()
    expect(resumedPlan.freshThreadFallback).toBeUndefined()
    expect(resumedPlan.prepareFreshThreadFallback).toEqual(expect.any(Function))
    expect(resumedPlan.planningDiagnostics).toMatchObject({
      cliBootstrapElapsedMs: null,
      shouldPrepareAnyBootstrapContext: false,
      shouldPrepareBootstrapContext: false,
    })
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).not.toHaveBeenCalled()
    expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()

    const fallback = await resumedPlan.prepareFreshThreadFallback?.()

    expect(fallback?.developerInstructions).toContain(
      'bootstrap contract',
    )
    expect(fallback?.sessionContext).toEqual({
      binding: resumedSession.binding,
    })
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
    expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()
  })

  it('reads only the cached assistant context snapshot on sensitive native resume', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(
      'Cached assistant context snapshot.',
    )
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const route = createRoute()
    const resumedSession = createSession({
      resumeState: {
        routeFingerprint: route.routeFingerprint ?? route.routeId,
        threadId: 'thread-sensitive-resume',
      },
    })

    const resumedPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: resumedSession,
      sharedPlan: createSharedPlan({
        allowSensitiveHealthContext: true,
      }),
    })

    expect(resumedPlan.resumeCodexThreadId).toBe('thread-sensitive-resume')
    expect(resumedPlan.developerInstructions).toBeNull()
    expect(resumedPlan.turnContextPrompt).toContain(
      'Cached assistant context snapshot.',
    )
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).not.toHaveBeenCalled()
    expect(planningMocks.readAssistantContextSnapshotPrompt).toHaveBeenCalledTimes(1)

    planningMocks.readAssistantContextSnapshotPrompt.mockClear()
    const fallback = await resumedPlan.prepareFreshThreadFallback?.()

    expect(fallback?.developerInstructions).toContain('bootstrap contract')
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
    expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()
  })

  it('plans native resume while keeping active-turn history available for fallback', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const route = createRoute()
    const initialPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    const resumedPlan = await resolveAssistantRouteTurnPlan({
      activeTurnHistory: {
        acceptedInputIds: [],
        messages: [
          {
            content: 'initial user prompt',
            role: 'user',
          },
          {
            content: 'draft assistant response',
            role: 'assistant',
          },
        ],
        nonReplayableProviderWork: false,
      } satisfies AssistantActiveTurnProviderHistory,
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        resumeState: {
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'thread-active-turn',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(resumedPlan.resumeCodexThreadId).toBe('thread-active-turn')
    expect(resumedPlan.refreshThreadInstructions).toBe(false)
    expect(resumedPlan.activeTurnMessages).toEqual([
      {
        content: 'initial user prompt',
        role: 'user',
      },
      {
        content: 'draft assistant response',
        role: 'assistant',
      },
    ])
    expect(resumedPlan.codexContinuation).toEqual({
      kind: 'provider-state-optimization',
    })
    expect(resumedPlan.freshThreadFallback).toBeUndefined()
    expect(resumedPlan.prepareFreshThreadFallback).toEqual(expect.any(Function))
  })

  it('does not replay committed transcript messages when provider-native resume is unavailable', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-transcript-'))
    const session = createSession({
      turnCount: 1,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }

    try {
      await appendAssistantTranscriptEntries(vault, session.sessionId, [
        {
          kind: 'status',
          text: 'tool audit',
        },
        {
          kind: 'assistant',
          text: 'Earlier welcome.',
        },
      ])
      await appendAssistantTranscriptEntries(
        vault,
        session.sessionId,
        Array.from({ length: 20 }, (_, index) => ({
          kind: index % 2 === 0 ? 'user' : 'assistant',
          text: `Historical message ${index}`,
        })),
      )

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          vault,
        },
        profile: executionProfile,
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route: createRoute(),
        session,
        sharedPlan: createSharedPlan(),
      })

      expect(plan.resumeCodexThreadId).toBeNull()
      expect('conversationMessages' in plan).toBe(false)
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('does not replay committed transcript messages for isolated fresh threads', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-isolated-'))
    const session = createSession({
      turnCount: 1,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'isolated-thread',
      toolProfile: 'provider-turn',
    }

    try {
      await appendAssistantTranscriptEntries(vault, session.sessionId, [
        {
          kind: 'user',
          text: 'Prior sensitive context.',
        },
        {
          kind: 'assistant',
          text: 'Prior assistant context.',
        },
      ])

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          vault,
        },
        profile: executionProfile,
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route: createRoute(),
        session,
        sharedPlan: createSharedPlan(),
      })

      expect(plan.resumeCodexThreadId).toBeNull()
      expect('conversationMessages' in plan).toBe(false)
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('starts a fresh thread with bootstrap developer instructions when the route fingerprint changed', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const route = createRoute()

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        resumeState: {
          routeFingerprint: 'stale-route',
          threadId: 'thread-resume',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.resumeCodexThreadId).toBeNull()
    expect(plan.refreshThreadInstructions).toBe(true)
    expect(plan.developerInstructions).toContain('bootstrap contract')
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
  })
})

function createMessageInput(): AssistantMessageInput {
  return {
    allowBindingRebind: false,
    approvalPolicy: null,
    channel: 'telegram',
    codexHome: null,
    conversation: null,
    deliveryKind: null,
    deliveryReplyToMessageId: null,
    deliverResponse: false,
    executionContext: null,
    includeEarlySessionOnboarding: false,
    model: 'gpt-5.4',
    modelProvider: 'openai',
    oss: false,
    persistUserPromptOnFailure: false,
    prompt: 'What supported experiment protocols do we have?',
    provider: 'codex-cli',
    reasoningEffort: null,
    sandbox: null,
    sessionId: 'session-test',
    threadId: 'thread-test',
    threadIsDirect: true,
    vault: '/vault',
    workingDirectory: '/work',
  }
}

function createRoute(): CodexThreadIdentity {
  return {
    codexCommand: null,
    label: 'Primary',
    provider: 'codex-cli',
    providerOptions: serializeAssistantProviderSessionOptions(
      normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
    ),
    routeFingerprint: 'route-test',
    routeId: 'route-test',
  }
}

function createSession(input?: {
  resumeState?: AssistantSession['resumeState']
  turnCount?: number
}): AssistantSession {
  const target = createDefaultLocalAssistantModelTarget()
  if (!target) {
    throw new Error('Expected a default assistant model target.')
  }

  return {
    alias: null,
    binding: {
      actorId: null,
      channel: null,
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    },
    createdAt: '2026-05-04T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions: serializeAssistantProviderSessionOptions(
      normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
    ),
    codexResume: input?.resumeState ?? null,
    codexTarget: target,
    conversationId: 'session-test',
    resumeState: input?.resumeState ?? null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: 'session-test',
    target,
    turnCount: input?.turnCount ?? 0,
    updatedAt: '2026-05-04T00:00:00.000Z',
  }
}

function createSharedPlan(
  overrides: Partial<AssistantTurnSharedPlan> = {},
): AssistantTurnSharedPlan {
  return {
    allowSensitiveHealthContext: false,
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
      allowSensitiveHealthContext: false,
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: null,
        deliveryPolicy: 'not-requested',
        effectiveThreadIsDirect: null,
        explicitTarget: null,
        identityId: null,
        replyToMessageId: null,
        threadId: null,
        threadIsDirect: null,
      },
      operatorAuthority: 'direct-operator',
    },
    firstContactStateDocIds: [],
    onboardingGuidanceOpen: false,
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/work',
    ...overrides,
  }
}
