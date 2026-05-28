import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
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
  resolveAssistantCliSurfaceBootstrapContext: vi.fn(async () => 'bootstrap contract'),
  resolveAssistantVaultOverviewBlock: vi.fn(async () => null),
  resolveCodexAssistantTargetCapabilities: vi.fn(() => ({
    supportsNativeResume: false,
  })),
}))

vi.mock('@murphai/health-commons/runtime', () => ({
  listGeneratedAssistantProtocolIndexEntries:
    runtimeMocks.listGeneratedAssistantProtocolIndexEntries,
}))

vi.mock('../src/assistant/cli-surface-bootstrap.js', () => ({
  resolveAssistantCliSurfaceBootstrapContext:
    planningMocks.resolveAssistantCliSurfaceBootstrapContext,
}))

vi.mock('../src/assistant/codex-runtime.js', () => ({
  resolveCodexAssistantTargetCapabilities:
    planningMocks.resolveCodexAssistantTargetCapabilities,
}))

vi.mock('../src/assistant/vault-overview.js', () => ({
  resolveAssistantVaultOverviewBlock:
    planningMocks.resolveAssistantVaultOverviewBlock,
}))

import {
  resolveAssistantRouteTurnPlan,
  type AssistantCodexTurnResolvedExecutionProfile,
} from '../src/assistant/codex-turn/planning.js'
import {
  HOSTED_ASSISTANT_CODEX_RESUME_MAX_ROLLOUT_BYTES,
} from '../src/assistant/codex-resume-budget.js'
import { appendAssistantTranscriptEntries } from '../src/assistant/store.js'
import type { AssistantActiveTurnProviderHistory } from '../src/assistant/active-turn-history.js'
import type { AssistantMessageInput } from '../src/assistant/service-contracts.js'
import type { AssistantTurnSharedPlan } from '../src/assistant/service-contracts.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexThreadIdentity } from '../src/assistant/codex-thread-route.js'

afterEach(() => {
  runtimeMocks.listGeneratedAssistantProtocolIndexEntries.mockReset()
  planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockReset()
  planningMocks.resolveAssistantVaultOverviewBlock.mockReset()
  planningMocks.resolveCodexAssistantTargetCapabilities.mockReset()
})

describe('assistant protocol index planning', () => {
  it('soft-fails to an empty assistant protocol index when generated artifacts are unavailable', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
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

  it('resumes Codex threads without refreshing bootstrap developer instructions', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
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
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockClear()
    planningMocks.resolveAssistantVaultOverviewBlock.mockClear()

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
    expect(resumedPlan.freshThreadFallback?.developerInstructions).toContain(
      'bootstrap contract',
    )
    expect(resumedPlan.freshThreadFallback?.sessionContext).toEqual({
      binding: resumedSession.binding,
    })
    expect(
      planningMocks.resolveAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized hosted Codex rollout resumes before model compaction', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const route = createRoute()
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'assistant-hosted-codex-home-'))
    const threadId = '00000000-0000-0000-0000-000000000001'
    const rolloutRelativePath = createRolloutRelativePath(threadId)
    const rolloutPath = path.join(codexHome, rolloutRelativePath)

    try {
      await mkdir(path.dirname(rolloutPath), { recursive: true })
      await writeFile(
        rolloutPath,
        'x'.repeat(HOSTED_ASSISTANT_CODEX_RESUME_MAX_ROLLOUT_BYTES + 1),
        'utf8',
      )

      const executionContext = createHostedExecutionContext()
      const plan = await resolveAssistantRouteTurnPlan({
        executionContext,
        input: {
          ...createMessageInput(),
          executionContext,
          turnTrigger: 'automation-auto-reply',
        },
        profile: executionProfile,
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route,
        session: createSession({
          resumeState: {
            rolloutRelativePath,
            routeFingerprint: route.routeFingerprint ?? route.routeId,
            threadId,
          },
        }),
        sharedPlan: createSharedPlan({
          cliEnv: {
            CODEX_HOME: codexHome,
          },
        }),
      })

      expect(plan.resumeCodexThreadId).toBeNull()
      expect(plan.refreshThreadInstructions).toBe(true)
      expect(plan.developerInstructions).toContain('inspect the one needed command')
      expect(plan.planningDiagnostics.nativeResumeRejectReason).toBe(
        'rollout-too-large',
      )
      expect(plan.planningDiagnostics.nativeResumeRolloutSizeBucket).toBe(
        '33-64kb',
      )
    } finally {
      await rm(codexHome, { force: true, recursive: true })
    }
  })

  it('allows hosted Codex rollout resumes when the saved rollout is bounded', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const route = createRoute()
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'assistant-hosted-codex-home-'))
    const threadId = '00000000-0000-0000-0000-000000000002'
    const rolloutRelativePath = createRolloutRelativePath(threadId)
    const rolloutPath = path.join(codexHome, rolloutRelativePath)

    try {
      await mkdir(path.dirname(rolloutPath), { recursive: true })
      await writeFile(rolloutPath, '{"type":"session"}\n', 'utf8')

      const executionContext = createHostedExecutionContext()
      const plan = await resolveAssistantRouteTurnPlan({
        executionContext,
        input: {
          ...createMessageInput(),
          executionContext,
          turnTrigger: 'automation-auto-reply',
        },
        profile: executionProfile,
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route,
        session: createSession({
          resumeState: {
            rolloutRelativePath,
            routeFingerprint: route.routeFingerprint ?? route.routeId,
            threadId,
          },
        }),
        sharedPlan: createSharedPlan({
          cliEnv: {
            CODEX_HOME: codexHome,
          },
        }),
      })

      expect(plan.resumeCodexThreadId).toBe(threadId)
      expect(plan.refreshThreadInstructions).toBe(false)
      expect(plan.developerInstructions).toBeNull()
      expect(plan.planningDiagnostics.nativeResumeRejectReason).toBeNull()
      expect(plan.planningDiagnostics.nativeResumeRolloutSizeBucket).toBe(
        '0-32kb',
      )
    } finally {
      await rm(codexHome, { force: true, recursive: true })
    }
  })

  it('rejects hosted Codex rollout resumes when the saved rollout belongs to a different thread', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const route = createRoute()
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'assistant-hosted-codex-home-'))
    const savedThreadId = '00000000-0000-0000-0000-000000000003'
    const differentThreadId = '00000000-0000-0000-0000-000000000004'
    const rolloutRelativePath = createRolloutRelativePath(differentThreadId)
    const rolloutPath = path.join(codexHome, rolloutRelativePath)

    try {
      await mkdir(path.dirname(rolloutPath), { recursive: true })
      await writeFile(rolloutPath, '{"type":"session"}\n', 'utf8')

      const executionContext = createHostedExecutionContext()
      const plan = await resolveAssistantRouteTurnPlan({
        executionContext,
        input: {
          ...createMessageInput(),
          executionContext,
          turnTrigger: 'automation-auto-reply',
        },
        profile: executionProfile,
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route,
        session: createSession({
          resumeState: {
            rolloutRelativePath,
            routeFingerprint: route.routeFingerprint ?? route.routeId,
            threadId: savedThreadId,
          },
        }),
        sharedPlan: createSharedPlan({
          cliEnv: {
            CODEX_HOME: codexHome,
          },
        }),
      })

      expect(plan.resumeCodexThreadId).toBeNull()
      expect(plan.refreshThreadInstructions).toBe(true)
      expect(plan.planningDiagnostics.nativeResumeRejectReason).toBe(
        'rollout-thread-mismatch',
      )
      expect(plan.planningDiagnostics.nativeResumeRolloutSizeBucket).toBeNull()
    } finally {
      await rm(codexHome, { force: true, recursive: true })
    }
  })

  it('plans native resume while keeping active-turn history available for fallback', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
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
  })

  it('does not replay committed transcript messages when provider-native resume is unavailable', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
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
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
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
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
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
      planningMocks.resolveAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
  })

  it('omits the generated CLI catalog from hosted bootstrap instructions', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const executionContext = createHostedExecutionContext()

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext,
      input: {
        ...createMessageInput(),
        executionContext,
        turnTrigger: 'automation-auto-reply',
      },
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.assistantCliContract).toBeNull()
    expect(plan.developerInstructions).not.toContain('bootstrap contract')
    expect(plan.developerInstructions).toContain('inspect the one needed command')
    expect(plan.developerInstructions).not.toContain('# First-session prep reminders')
    expect(Buffer.byteLength(plan.developerInstructions ?? '', 'utf8')).toBeLessThan(
      20_000,
    )
    expect(
      planningMocks.resolveAssistantCliSurfaceBootstrapContext,
    ).not.toHaveBeenCalled()
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

function createHostedExecutionContext(): NonNullable<AssistantMessageInput['executionContext']> {
  return {
    hosted: {
      memberId: 'member-test',
      userEnvKeys: [],
    },
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

function createSharedPlan(input?: {
  cliEnv?: NodeJS.ProcessEnv
}): AssistantTurnSharedPlan {
  return {
    allowSensitiveHealthContext: false,
    cliAccess: {
      env: input?.cliEnv ?? {},
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
  }
}

function createRolloutRelativePath(threadId: string): string {
  return `sessions/2026/05/04/rollout-2026-05-04T00-00-00-000Z-${threadId}.jsonl`
}
