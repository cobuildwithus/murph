import { mkdtemp, rm } from 'node:fs/promises'
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
  buildAssistantCodexContractFingerprint,
} from '../src/assistant/codex-contract-fingerprint.js'
import {
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  buildAssistantSkillFileRef,
} from '../src/assistant-skill-assets.js'
import { appendAssistantTranscriptEntries } from '../src/assistant/store.js'
import {
  ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
  ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX,
} from '../src/assistant/turn-finalizer.js'
import type { AssistantMessageInput } from '../src/assistant/service-contracts.js'
import type { AssistantTurnSharedPlan } from '../src/assistant/service-contracts.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexThreadIdentity } from '../src/assistant/codex-thread-route.js'

afterEach(() => {
  runtimeMocks.listGeneratedAssistantProtocolIndexEntries.mockReset()
  planningMocks.readAssistantCliSurfaceBootstrapContext.mockReset()
  planningMocks.readAssistantContextSnapshotPrompt.mockReset()
  planningMocks.resolveCodexAssistantTargetCapabilities.mockReset()
})

describe('assistant protocol index planning', () => {
  it('does not expose per-turn route env in Codex execution plans', async () => {
    const plan = await buildCodexTurnExecutionPlan({
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

    const removedRouteEnvProperty = ['turnCli', 'Env'].join('')
    expect(Object.prototype.hasOwnProperty.call(plan, removedRouteEnvProperty)).toBe(false)
    expect(plan).not.toHaveProperty(removedRouteEnvProperty)
  })

  it('preserves no-reply execution hooks in Codex execution plans', async () => {
    const onCodexThreadHistoryUnsafe = vi.fn()
    const onFinishWithoutReplyAccepted = vi.fn()

    const plan = await buildCodexTurnExecutionPlan({
      allowFinishWithoutReply: true,
      input: createMessageInput(),
      onCodexThreadHistoryUnsafe,
      onFinishWithoutReplyAccepted,
      plan: createSharedPlan(),
      resolvedSession: createSession(),
      route: createRoute(),
      turnCreatedAt: '2026-05-04T00:00:00.000Z',
      turnId: 'turn-no-reply-hooks',
    })

    expect(plan.allowFinishWithoutReply).toBe(true)
    expect(plan.onCodexThreadHistoryUnsafe).toBe(onCodexThreadHistoryUnsafe)
    expect(plan.onFinishWithoutReplyAccepted).toBe(onFinishWithoutReplyAccepted)
  })

  it('resolves disabled native resume notification turns as isolated threads', async () => {
    const plan = await buildCodexTurnExecutionPlan({
      input: createMessageInput(),
      plan: createSharedPlan(),
      profile: {
        nativeResumePolicy: 'disabled',
        promptProfile: 'notification-decision',
        toolProfile: 'notification-turn',
      },
      resolvedSession: createSession(),
      route: createRoute(),
      turnCreatedAt: '2026-05-04T00:00:00.000Z',
      turnId: 'turn-isolated-notification',
    })

    expect(plan.profile).toEqual({
      promptProfile: 'notification-decision',
      threadScope: 'isolated-thread',
      toolProfile: 'notification-turn',
    })
  })

  it('resolves no dynamic tools and no non-evidence prompt context for maintenance turns', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(
      'Context snapshot: active condition hypertension.',
    )
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const promptTimeContext = {
      currentLocalDate: '2026-05-04',
      currentTimeZone: 'Asia/Kuala_Lumpur',
    }
    const executionContext = {
      hosted: {
        dynamicContextPrompts: ['Hosted dynamic prompt: device sync pending.'],
        memberId: 'member-maintenance-context',
        userEnvKeys: [],
      },
    }

    const maintenancePlan = await resolveAssistantRouteTurnPlan({
      executionContext,
      input: createMessageInput(),
      profile: {
        promptProfile: 'notification-decision',
        threadScope: 'isolated-thread',
        toolProfile: 'maintenance-turn',
      },
      promptTimeContext,
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })
    expect(maintenancePlan.dynamicTools).toEqual([])
    expect(maintenancePlan.systemPrompt).not.toContain('hypertension')
    expect(maintenancePlan.systemPrompt).not.toContain('device sync pending')
    expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()
    expect(maintenancePlan.systemPrompt).toContain('Maintenance execution rules:')
    expect(maintenancePlan.systemPrompt).not.toContain('Notification execution rules:')
    expect(maintenancePlan.systemPrompt).not.toContain('same full read and write tools')
    expect(maintenancePlan.systemPrompt).not.toContain('meals')
    expect(maintenancePlan.systemPrompt).not.toContain('Health Commons')

    const notificationPlan = await resolveAssistantRouteTurnPlan({
      executionContext,
      input: createMessageInput(),
      profile: {
        promptProfile: 'notification-decision',
        threadScope: 'session-thread',
        toolProfile: 'notification-turn',
      },
      promptTimeContext,
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })
    const notificationToolNames = notificationPlan.dynamicTools.map(
      (tool) => tool.name,
    )
    expect(notificationToolNames).toContain('generate_image')
    expect(notificationToolNames).toContain('attach_response_media')
    expect(notificationPlan.systemPrompt).toContain('hypertension')
    expect(notificationPlan.systemPrompt).toContain('device sync pending')
    expect(notificationPlan.systemPrompt).toContain('Notification execution rules:')
    expect(notificationPlan.systemPrompt).not.toContain('Maintenance execution rules:')
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
    expect(plan.systemPrompt).toContain('Execution and stop rules:')
    expect(plan.systemPrompt).not.toContain('Supported experiment protocols:')
  })

  it('injects Murph onboarding skill activation through route planning', async () => {
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

    const skillRef = buildAssistantSkillFileRef('murph-onboarding')

    expect(plan.onboardingGuidanceInjected).toBe(true)
    expect(plan.systemPrompt).toContain(skillRef)
    expect(plan.turnContextPrompt).not.toContain('Murph onboarding:')
    expect(plan.developerInstructions).toContain('Murph onboarding:')
    expect(plan.developerInstructions).toContain(
      `Read and follow \`${skillRef}\` when onboarding is open and you need the next unresolved onboarding step`,
    )
    expect(plan.developerInstructions).toContain(
      'Before ending a normal reply while onboarding is open, keep onboarding moving unless a skip condition applies',
    )
    expect(plan.developerInstructions).not.toContain(
      'roughly 5-6 short assistant messages',
    )
    expect(plan.turnContextPrompt).not.toContain('Natural first-run flow')
  })

  it('resumes Codex threads when the stored assistant contract matches', async () => {
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
    expect(initialPlan.developerInstructions).toContain('bootstrap contract')
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockClear()
    planningMocks.readAssistantContextSnapshotPrompt.mockClear()

    const turnContext = [
      'Conversation context:',
      'The assistant previously sent a reminder from another assistant run.',
    ].join('\n')
    const resumedSession = createSession({
      resumeState: {
        assistantContractFingerprint: initialPlan.assistantContractFingerprint,
        routeFingerprint: route.routeFingerprint ?? route.routeId,
        threadId: 'thread-resume',
      },
    })
    const resumedPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        turnContext,
      },
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: resumedSession,
      sharedPlan: createSharedPlan(),
    })

    expect(resumedPlan.resume?.codexThreadId).toBe('thread-resume')
    expect(resumedPlan.developerInstructions).toBeNull()
    expect(resumedPlan.sessionContext).toBeUndefined()
    expect(resumedPlan.turnContextPrompt).toContain(turnContext)
    expect(resumedPlan.resume?.prepareFreshThreadFallback).toEqual(expect.any(Function))
    expect(resumedPlan.planningDiagnostics).toMatchObject({
      shouldPrepareBootstrapContext: false,
    })
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
    expect(planningMocks.readAssistantContextSnapshotPrompt).toHaveBeenCalledTimes(1)
    expect(planningMocks.readAssistantContextSnapshotPrompt).toHaveBeenCalledWith({
      vaultRoot: '/vault',
    })

    const fallback = await resumedPlan.resume?.prepareFreshThreadFallback()

    expect(fallback?.developerInstructions).toContain(
      'bootstrap contract',
    )
    expect(fallback?.turnContextPrompt).toContain(turnContext)
    expect(fallback?.sessionContext).toEqual({
      binding: resumedSession.binding,
    })
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
    expect(planningMocks.readAssistantContextSnapshotPrompt).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh thread once for legacy resume state without an assistant contract fingerprint', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const route = createRoute()

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        resumeState: {
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'legacy-thread',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.resume).toBeNull()
    expect(plan.developerInstructions).toContain('bootstrap contract')
    expect(plan.assistantContractFingerprint).toEqual(expect.any(String))
  })

  it('keeps the assistant contract fingerprint stable across repeated identical plans', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const route = createRoute()
    const input = {
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    } satisfies Parameters<typeof resolveAssistantRouteTurnPlan>[0]

    const first = await resolveAssistantRouteTurnPlan(input)
    const second = await resolveAssistantRouteTurnPlan(input)

    expect(second.assistantContractFingerprint).toBe(
      first.assistantContractFingerprint,
    )
    expect(first.assistantContractFingerprint).toBe(
      buildAssistantCodexContractFingerprint({
        developerInstructions: first.developerInstructions,
        dynamicTools: resolveMurphDynamicTools({
          progressUpdatesAvailable: false,
          voiceMemoGenerationAvailable: false,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )
  })

  it('adds the reaction dynamic tool to the route contract for reply-capable channels', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const route = createRoute()
    const profile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const promptTimeContext = {
      currentLocalDate: '2026-05-04',
      currentTimeZone: 'Asia/Kuala_Lumpur',
    }
    const telegramReplyPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        deliveryReplyToMessageId: 'message-1',
      },
      profile,
      promptTimeContext,
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(telegramReplyPlan.assistantContractFingerprint).toBe(
      buildAssistantCodexContractFingerprint({
        developerInstructions: telegramReplyPlan.developerInstructions,
        dynamicTools: resolveMurphDynamicTools({
          allowMessageReactions: true,
          progressUpdatesAvailable: false,
          voiceMemoGenerationAvailable: false,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )

    const linqReplyPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        channel: 'linq',
        deliveryMessageReactionsAvailable: true,
        deliveryReplyToMessageId: 'linq-message-1',
        deliveryTarget: 'linq-chat-1',
      },
      profile,
      promptTimeContext,
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(linqReplyPlan.assistantContractFingerprint).toBe(
      buildAssistantCodexContractFingerprint({
        developerInstructions: linqReplyPlan.developerInstructions,
        dynamicTools: resolveMurphDynamicTools({
          allowMessageReactions: true,
          voiceMemoGenerationAvailable: false,
          progressUpdatesAvailable: false,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )

    const linqSmsReplyPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        channel: 'linq',
        deliveryMessageReactionsAvailable: false,
        deliveryReplyToMessageId: 'linq-message-1',
        deliveryTarget: 'linq-chat-1',
      },
      profile,
      promptTimeContext,
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(linqSmsReplyPlan.assistantContractFingerprint).toBe(
      buildAssistantCodexContractFingerprint({
        developerInstructions: linqSmsReplyPlan.developerInstructions,
        dynamicTools: resolveMurphDynamicTools({
          allowMessageReactions: false,
          voiceMemoGenerationAvailable: false,
          progressUpdatesAvailable: false,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )

    const telegramBusinessReplyPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        deliveryReplyToMessageId: 'message-1',
        deliveryTarget: '123:business:biz-123',
      },
      profile,
      promptTimeContext,
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(telegramBusinessReplyPlan.assistantContractFingerprint).toBe(
      buildAssistantCodexContractFingerprint({
        developerInstructions: telegramBusinessReplyPlan.developerInstructions,
        dynamicTools: resolveMurphDynamicTools({
          allowMessageReactions: false,
          voiceMemoGenerationAvailable: false,
          progressUpdatesAvailable: false,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )

    const telegramNoReplyPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile,
      promptTimeContext,
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(telegramNoReplyPlan.assistantContractFingerprint).toBe(
      buildAssistantCodexContractFingerprint({
        developerInstructions: telegramNoReplyPlan.developerInstructions,
        dynamicTools: resolveMurphDynamicTools({
          allowMessageReactions: false,
          voiceMemoGenerationAvailable: false,
          progressUpdatesAvailable: false,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )
    expect(telegramNoReplyPlan.assistantContractFingerprint).not.toBe(
      telegramReplyPlan.assistantContractFingerprint,
    )
  })

  it('keeps hosted computer tools in the auto-reply route contract', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const route = createRoute()
    const profile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          progressDeliveryDependencies: {},
          providerFetch: null,
          userEnvKeys: [],
        },
      },
      hostedToolContext: createHostedToolContext(),
      input: {
        ...createMessageInput(),
        channel: 'telegram',
        deliverResponse: true,
        turnTrigger: 'automation-auto-reply',
      },
      profile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.assistantContractFingerprint).toBe(
      buildAssistantCodexContractFingerprint({
        developerInstructions: plan.developerInstructions,
        dynamicTools: resolveMurphDynamicTools({
          computerToolsAvailable: true,
          progressUpdatesAvailable: false,
          voiceMemoGenerationAvailable: plan.voiceMemoDeliveryChannel !== null,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )
  })

  it('resumes Codex threads when only the per-turn date changes', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const route = createRoute()
    const oldPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-05',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        resumeState: {
          assistantContractFingerprint: oldPlan.assistantContractFingerprint,
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'thread-date-change',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.resume?.codexThreadId).toBe('thread-date-change')
    expect(plan.developerInstructions).toBeNull()
    expect(plan.turnContextPrompt).toBe(
      'Today\'s date for the user is May 5, 2026.',
    )
    expect(plan.assistantContractFingerprint).toBe(
      oldPlan.assistantContractFingerprint,
    )
  })

  it('starts a fresh thread when stable developer instructions change', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValueOnce('old bootstrap')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const route = createRoute()
    const oldPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValueOnce('new bootstrap')

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        resumeState: {
          assistantContractFingerprint: oldPlan.assistantContractFingerprint,
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'thread-old-contract',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.resume).toBeNull()
    expect(plan.developerInstructions).toContain('new bootstrap')
    expect(plan.assistantContractFingerprint).not.toBe(oldPlan.assistantContractFingerprint)
  })

  it('starts a fresh thread when thread-stable context changes', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const route = createRoute()
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const basePromptTimeContext = {
      currentLocalDate: '2026-05-04',
      currentTimeZone: 'Asia/Kuala_Lumpur',
    }

    const scenarios = [
      {
        expectedDeveloperText:
          "The user's canonical timezone for this vault is America/New_York.",
        name: 'timezone',
        newPromptTimeContext: {
          ...basePromptTimeContext,
          currentTimeZone: 'America/New_York',
        },
        newSharedPlan: createSharedPlan(),
        oldPromptTimeContext: basePromptTimeContext,
        oldSharedPlan: createSharedPlan(),
        unexpectedTurnText: 'America/New_York',
      },
      {
        expectedDeveloperText:
          'Current Murph product base URL for user-facing app links: https://new.example.test',
        name: 'product URL',
        newPromptTimeContext: basePromptTimeContext,
        newSharedPlan: createSharedPlan({
          cliAccess: {
            env: {
              HOSTED_WEB_BASE_URL: 'https://new.example.test',
            },
            rawCommand: 'vault-cli',
            setupCommand: 'murph',
          },
        }),
        oldPromptTimeContext: basePromptTimeContext,
        oldSharedPlan: createSharedPlan({
          cliAccess: {
            env: {
              HOSTED_WEB_BASE_URL: 'https://old.example.test',
            },
            rawCommand: 'vault-cli',
            setupCommand: 'murph',
          },
        }),
        unexpectedTurnText: 'https://new.example.test',
      },
      {
        expectedDeveloperText: 'Murph onboarding:',
        name: 'onboarding',
        newPromptTimeContext: basePromptTimeContext,
        newSharedPlan: createSharedPlan({
          onboardingGuidanceOpen: true,
        }),
        oldPromptTimeContext: basePromptTimeContext,
        oldSharedPlan: createSharedPlan({
          onboardingGuidanceOpen: false,
        }),
        unexpectedTurnText: 'Murph onboarding:',
      },
    ]

    for (const scenario of scenarios) {
      const oldPlan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: createMessageInput(),
        profile: executionProfile,
        promptTimeContext: scenario.oldPromptTimeContext,
        route,
        session: createSession(),
        sharedPlan: scenario.oldSharedPlan,
      })

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: createMessageInput(),
        profile: executionProfile,
        promptTimeContext: scenario.newPromptTimeContext,
        route,
        session: createSession({
          resumeState: {
            assistantContractFingerprint: oldPlan.assistantContractFingerprint,
            routeFingerprint: route.routeFingerprint ?? route.routeId,
            threadId: `thread-old-${scenario.name}`,
          },
        }),
        sharedPlan: scenario.newSharedPlan,
      })

      expect(plan.resume, scenario.name).toBeNull()
      expect(plan.developerInstructions, scenario.name).toContain(
        scenario.expectedDeveloperText,
      )
      expect(plan.turnContextPrompt, scenario.name).not.toContain(
        scenario.unexpectedTurnText,
      )
      expect(plan.assistantContractFingerprint, scenario.name).not.toBe(
        oldPlan.assistantContractFingerprint,
      )
    }
  })

  it('keeps native resume when only the assistant context snapshot changes', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValueOnce(
      'Old assistant context snapshot.',
    )
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const route = createRoute()
    const oldPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })

    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValueOnce(
      'Updated assistant context snapshot.',
    )
    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        resumeState: {
          assistantContractFingerprint: oldPlan.assistantContractFingerprint,
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'thread-old-snapshot',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.resume?.codexThreadId).toBe('thread-old-snapshot')
    expect(plan.developerInstructions).toBeNull()
    expect(plan.turnContextPrompt).toContain(
      'Updated assistant context snapshot.',
    )
    expect(plan.turnContextPrompt).not.toContain(
      'Old assistant context snapshot.',
    )
    expect(plan.assistantContractFingerprint).toBe(
      oldPlan.assistantContractFingerprint,
    )
  })

  it('starts a fresh thread when the dynamic tool contract changes', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const route = createRoute()
    const oldToolContractFingerprint = buildAssistantCodexContractFingerprint({
      developerInstructions: (await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: createMessageInput(),
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route,
        session: createSession(),
        sharedPlan: createSharedPlan(),
      })).developerInstructions,
      dynamicTools: resolveMurphDynamicTools({}).slice(0, 1),
      routeFingerprint: route.routeFingerprint ?? route.routeId,
    })

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        resumeState: {
          assistantContractFingerprint: oldToolContractFingerprint,
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'thread-old-tools',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(plan.resume).toBeNull()
    expect(plan.assistantContractFingerprint).not.toBe(oldToolContractFingerprint)
  })

  it('reads current assistant context snapshot on sensitive native resume', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValueOnce(
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
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockClear()
    planningMocks.readAssistantContextSnapshotPrompt.mockClear()
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValueOnce(
      'Current assistant context snapshot.',
    )
    const resumedSession = createSession({
      resumeState: {
        assistantContractFingerprint: initialPlan.assistantContractFingerprint,
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
      sharedPlan: createSharedPlan(),
    })

    expect(resumedPlan.resume?.codexThreadId).toBe('thread-sensitive-resume')
    expect(resumedPlan.developerInstructions).toBeNull()
    expect(resumedPlan.turnContextPrompt).toContain(
      'Current assistant context snapshot.',
    )
    expect(resumedPlan.turnContextPrompt).not.toContain('Cached assistant context snapshot.')
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
    expect(planningMocks.readAssistantContextSnapshotPrompt).toHaveBeenCalledTimes(1)

    planningMocks.readAssistantContextSnapshotPrompt.mockClear()
    const fallback = await resumedPlan.resume?.prepareFreshThreadFallback()

    expect(fallback?.developerInstructions).toContain('bootstrap contract')
    expect(fallback?.developerInstructions).not.toContain(
      'Current assistant context snapshot.',
    )
    expect(fallback?.turnContextPrompt).toContain(
      'Current assistant context snapshot.',
    )
    expect(
      planningMocks.readAssistantCliSurfaceBootstrapContext,
    ).toHaveBeenCalledTimes(1)
    expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()
  })

  it('plans native resume while preparing committed transcript fallback lazily', async () => {
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
          assistantContractFingerprint: initialPlan.assistantContractFingerprint,
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'thread-active-turn',
        },
      }),
      sharedPlan: createSharedPlan(),
    })

    expect(resumedPlan.resume?.codexThreadId).toBe('thread-active-turn')
    expect(resumedPlan.conversationHistoryMessages).toBeUndefined()
    expect(resumedPlan.codexContinuation).toEqual({
      kind: 'provider-state-optimization',
    })
    expect(resumedPlan.resume?.prepareFreshThreadFallback).toEqual(expect.any(Function))
  })

  it('replays bounded committed transcript messages when provider-native resume is unavailable', async () => {
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
        sharedPlan: createPrivateSharedPlan(),
      })

      expect(plan.resume).toBeNull()
      expect(plan.conversationHistoryMessages).toEqual([
        {
          content: 'Earlier welcome.',
          role: 'assistant',
        },
        ...Array.from({ length: 20 }, (_, index) => ({
          content: `Historical message ${index}`,
          role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        })),
      ])
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('replays explicit no-reply transcript markers as assistant history', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-no-reply-marker-'))
    const session = createSession({
      turnCount: 1,
    })

    try {
      await appendAssistantTranscriptEntries(vault, session.sessionId, [
        {
          kind: 'user',
          text: 'Log the medication, no need to reply.',
        },
        {
          kind: 'status',
          text: `${ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX}${ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT}`,
        },
      ])

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          vault,
        },
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route: createRoute(),
        session,
        sharedPlan: createPrivateSharedPlan(),
      })

      expect(plan.conversationHistoryMessages).toEqual([
        {
          content: 'Log the medication, no need to reply.',
          role: 'user',
        },
        {
          content: ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
          role: 'assistant',
        },
      ])
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('bounds committed transcript replay by message and aggregate bytes', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-transcript-bytes-'))
    const session = createSession({
      turnCount: 1,
    })

    try {
      await appendAssistantTranscriptEntries(
        vault,
        session.sessionId,
        Array.from({ length: 5 }, (_, index) => ({
          kind: 'user',
          text: `message-${index}: ${'x'.repeat(6_000)}`,
        })),
      )

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          vault,
        },
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route: createRoute(),
        session,
        sharedPlan: createPrivateSharedPlan(),
      })

      const history = plan.conversationHistoryMessages ?? []
      expect(history).toHaveLength(3)
      expect(history[0]?.content).toEqual(expect.stringMatching(/^message-2:/u))
      expect(history[2]?.content).toEqual(expect.stringMatching(/^message-4:/u))
      let totalBytes = 0
      for (const message of history) {
        const content = message.content
        if (typeof content !== 'string') {
          throw new Error('Expected text-only transcript fallback history.')
        }
        const byteLength = Buffer.byteLength(content, 'utf8')
        expect(byteLength).toBeLessThanOrEqual(4_000)
        totalBytes += byteLength
      }
      expect(totalBytes).toBeLessThanOrEqual(12_000)
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('does not replay an oversized committed current user prompt', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-current-prompt-'))
    const session = createSession({
      turnCount: 1,
    })
    const currentPrompt = `Current prompt: ${'x'.repeat(6_000)}`

    try {
      await appendAssistantTranscriptEntries(vault, session.sessionId, [
        {
          kind: 'assistant',
          text: 'Earlier answer.',
        },
        {
          kind: 'user',
          text: currentPrompt,
        },
      ])

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          prompt: currentPrompt,
          vault,
        },
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route: createRoute(),
        session,
        sharedPlan: createPrivateSharedPlan(),
      })

      expect(plan.conversationHistoryMessages).toEqual([
        {
          content: 'Earlier answer.',
          role: 'assistant',
        },
      ])
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('does not replay a persisted pre-provider prompt after active-turn input changes the current prompt', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-active-turn-current-'))
    const session = createSession({
      resumeState: {
        assistantContractFingerprint:
          '0000000000000000000000000000000000000000000000000000000000000000',
        routeFingerprint: 'route-test',
        threadId: 'thread-stale-contract',
      },
      turnCount: 1,
    })
    const originalPrompt =
      'Please inspect the Codex assistant contract migration and summarize the resume behavior.'
    const currentPrompt = [
      originalPrompt,
      '',
      'Late active-turn input: also account for the dynamic tool fingerprint.',
    ].join('\n')

    try {
      await appendAssistantTranscriptEntries(vault, session.sessionId, [
        {
          kind: 'assistant',
          text: 'Earlier answer.',
        },
        {
          kind: 'user',
          text: originalPrompt,
        },
      ])

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          prompt: currentPrompt,
          vault,
        },
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route: createRoute(),
        session,
        sharedPlan: createPrivateSharedPlan(),
      })

      expect(plan.resume).toBeNull()
      expect(plan.conversationHistoryMessages).toEqual([
        {
          content: 'Earlier answer.',
          role: 'assistant',
        },
      ])
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('replays committed transcript messages for session fresh threads', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-public-transcript-'))
    const session = createSession({
      turnCount: 1,
    })

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
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route: createRoute(),
        session,
        sharedPlan: createSharedPlan(),
      })

      expect(plan.resume).toBeNull()
      expect(plan.conversationHistoryMessages).toEqual([
        {
          content: 'Prior sensitive context.',
          role: 'user',
        },
        {
          content: 'Prior assistant context.',
          role: 'assistant',
        },
      ])
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

      expect(plan.resume).toBeNull()
      expect(plan.conversationHistoryMessages).toBeUndefined()
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('prepares committed transcript messages for stale native-resume fallback', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-resume-fallback-'))
    const route = createRoute()
    const initialPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        vault,
      },
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        turnCount: 1,
      }),
      sharedPlan: createPrivateSharedPlan(),
    })
    const session = createSession({
      resumeState: {
        assistantContractFingerprint: initialPlan.assistantContractFingerprint,
        routeFingerprint: route.routeFingerprint ?? route.routeId,
        threadId: 'thread-resume',
      },
      turnCount: 1,
    })

    try {
      await appendAssistantTranscriptEntries(vault, session.sessionId, [
        {
          kind: 'user',
          text: 'Earlier protocol context.',
        },
        {
          kind: 'assistant',
          text: 'Got it.',
        },
        {
          kind: 'user',
          text: 'What supported experiment protocols do we have?',
        },
      ])

      const plan = await resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          vault,
        },
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route,
        session,
        sharedPlan: createPrivateSharedPlan(),
      })

      expect(plan.resume?.codexThreadId).toBe('thread-resume')
      expect(plan.conversationHistoryMessages).toBeUndefined()
      await expect(plan.resume?.prepareFreshThreadFallback()).resolves.toMatchObject({
        conversationHistoryMessages: [
          {
            content: 'Earlier protocol context.',
            role: 'user',
          },
          {
            content: 'Got it.',
            role: 'assistant',
          },
        ],
      })
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('prepares committed transcript messages for notification fresh-thread fallback', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const vault = await mkdtemp(path.join(os.tmpdir(), 'assistant-route-plan-notification-public-'))
    const route = createRoute()
    const initialPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        vault,
      },
      profile: {
        promptProfile: 'notification-decision',
        threadScope: 'session-thread',
        toolProfile: 'notification-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        turnCount: 1,
      }),
      sharedPlan: createSharedPlan(),
    })
    const session = createSession({
      resumeState: {
        assistantContractFingerprint: initialPlan.assistantContractFingerprint,
        routeFingerprint: route.routeFingerprint ?? route.routeId,
        threadId: 'thread-resume',
      },
      turnCount: 1,
    })

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
        profile: {
          promptProfile: 'notification-decision',
          threadScope: 'session-thread',
          toolProfile: 'notification-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route,
        session,
        sharedPlan: createSharedPlan(),
      })

      expect(plan.resume?.codexThreadId).toBe('thread-resume')
      expect(plan.conversationHistoryMessages).toBeUndefined()
      await expect(plan.resume?.prepareFreshThreadFallback()).resolves.toMatchObject({
        conversationHistoryMessages: [
          {
            content: 'Prior sensitive context.',
            role: 'user',
          },
          {
            content: 'Prior assistant context.',
            role: 'assistant',
          },
        ],
      })
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('does not resume or replay transcript messages for isolated notification maintenance turns', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const vault = await mkdtemp(
      path.join(os.tmpdir(), 'assistant-route-plan-notification-isolated-'),
    )
    const route = createRoute()
    const initialPlan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        vault,
      },
      profile: {
        promptProfile: 'notification-decision',
        threadScope: 'session-thread',
        toolProfile: 'notification-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route,
      session: createSession({
        turnCount: 1,
      }),
      sharedPlan: createSharedPlan(),
    })
    const session = createSession({
      resumeState: {
        assistantContractFingerprint: initialPlan.assistantContractFingerprint,
        routeFingerprint: route.routeFingerprint ?? route.routeId,
        threadId: 'thread-resume',
      },
      turnCount: 1,
    })

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
        profile: {
          promptProfile: 'notification-decision',
          threadScope: 'isolated-thread',
          toolProfile: 'notification-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-05-04',
          currentTimeZone: 'Asia/Kuala_Lumpur',
        },
        route,
        session,
        sharedPlan: createSharedPlan(),
      })

      expect(plan.resume).toBeNull()
      expect(plan.conversationHistoryMessages).toBeUndefined()
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

    expect(plan.resume).toBeNull()
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

function createHostedToolContext(): AssistantHostedToolContext {
  return {
    computerToolsAvailable: true,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: vi.fn(async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: false,
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
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
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

function createPrivateSharedPlan(
  overrides: Partial<AssistantTurnSharedPlan> = {},
): AssistantTurnSharedPlan {
  return createSharedPlan(overrides)
}
