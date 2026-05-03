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
const staleThreadInstructionsFingerprint =
  `thread-instructions-v1:${'0'.repeat(64)}:${'1'.repeat(64)}`

vi.mock('@murphai/health-commons/runtime', () => ({
  listGeneratedAssistantProtocolIndexEntries:
    runtimeMocks.listGeneratedAssistantProtocolIndexEntries,
}))

vi.mock('../src/assistant/cli-surface-bootstrap.js', () => ({
  resolveAssistantCliSurfaceBootstrapContext:
    planningMocks.resolveAssistantCliSurfaceBootstrapContext,
}))

vi.mock('../src/assistant/provider-registry.js', () => ({
  resolveCodexAssistantTargetCapabilities:
    planningMocks.resolveCodexAssistantTargetCapabilities,
}))

vi.mock('../src/assistant/vault-overview.js', () => ({
  resolveAssistantVaultOverviewBlock:
    planningMocks.resolveAssistantVaultOverviewBlock,
}))

import {
  resolveAssistantRouteTurnPlan,
  type AssistantProviderTurnResolvedExecutionProfile,
} from '../src/assistant/provider-turn/planning.js'
import type { AssistantActiveTurnProviderHistory } from '../src/assistant/active-turn-history.js'
import type { AssistantMessageInput } from '../src/assistant/service-contracts.js'
import type { AssistantTurnSharedPlan } from '../src/assistant/service-contracts.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexThreadIdentity } from '../src/assistant/provider-route.js'

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
    const executionProfile: AssistantProviderTurnResolvedExecutionProfile = {
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

  it('skips resumed thread-instruction refresh when the fingerprint matches', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveAssistantVaultOverviewBlock.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantProviderTurnResolvedExecutionProfile = {
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

    expect(initialPlan.threadInstructionsFingerprint).toEqual(
      expect.stringContaining('thread-instructions-v1:'),
    )
    planningMocks.resolveAssistantVaultOverviewBlock.mockClear()

    const resumedPlan = await resolveAssistantRouteTurnPlan({
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
          providerSessionId: 'thread-resume',
          resumeRouteId: route.routeId,
          threadInstructionsFingerprint:
            initialPlan.threadInstructionsFingerprint,
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(resumedPlan.resumeProviderSessionId).toBe('thread-resume')
    expect(resumedPlan.refreshThreadInstructions).toBe(false)
    expect(resumedPlan.threadInstructionsFingerprint).toBe(
      initialPlan.threadInstructionsFingerprint,
    )
    expect(resumedPlan.sessionContext).toBeUndefined()
    expect(planningMocks.resolveAssistantVaultOverviewBlock).not.toHaveBeenCalled()
  })

  it('refreshes resumed thread instructions when the fingerprint changed', async () => {
    planningMocks.resolveAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const executionProfile: AssistantProviderTurnResolvedExecutionProfile = {
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
          providerSessionId: 'thread-resume',
          resumeRouteId: route.routeId,
          threadInstructionsFingerprint: staleThreadInstructionsFingerprint,
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.resumeProviderSessionId).toBe('thread-resume')
    expect(plan.refreshThreadInstructions).toBe(true)
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
    routeId: 'route-test',
  }
}

function createSession(input?: {
  resumeState?: AssistantSession['resumeState']
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
    resumeState: input?.resumeState ?? null,
    schema: 'murph.assistant-session.v1',
    sessionId: 'session-test',
    target,
    turnCount: 0,
    updatedAt: '2026-05-04T00:00:00.000Z',
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
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
    onboardingBootstrapStateDocIds: [],
    onboardingGuidanceOpen: false,
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/work',
  }
}
