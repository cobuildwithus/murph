import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defaultAssistantVoiceOptionId,
  preferencesDocumentRelativePath,
  resolveAssistantVoiceOptionElevenLabsVoiceId,
} from '@murphai/contracts'
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
  scopeAssistantCliSurfaceContractForAssistant: (input: {
    contract: string | null
  }) => input.contract === null
    ? null
    : input.contract
        .split('\n')
        .filter((line) => !/^- `assistant style (?:show|set|reset)`/u.test(line))
        .join('\n'),
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
  buildCodexTurnAttemptPlan,
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

  it('preserves the no-reply hooks in Codex execution plans', async () => {
    const onFinishWithoutReplyAccepted = vi.fn()
    const onFinishWithoutReplyRecorded = vi.fn()

    const plan = await buildCodexTurnExecutionPlan({
      allowFinishWithoutReply: true,
      input: createMessageInput(),
      onFinishWithoutReplyAccepted,
      onFinishWithoutReplyRecorded,
      plan: createSharedPlan(),
      resolvedSession: createSession(),
      route: createRoute(),
      turnCreatedAt: '2026-05-04T00:00:00.000Z',
      turnId: 'turn-no-reply-hooks',
    })

    expect(plan.allowFinishWithoutReply).toBe(true)
    expect(plan.onFinishWithoutReplyAccepted).toBe(onFinishWithoutReplyAccepted)
    expect(plan.onFinishWithoutReplyRecorded).toBe(onFinishWithoutReplyRecorded)
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
    const preferenceContext = {
      assistantPersonality: {
        detail: 10,
        humor: 10,
        push: 10,
      },
      assistantTone: null,
      assistantVoice: null,
    }

    const maintenancePlan = await resolveAssistantRouteTurnPlan({
      executionContext,
      input: createMessageInput(),
      preferenceContext,
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
    expect(maintenancePlan.systemPrompt).toContain(
      'Never save medical or health details, credentials, identifiers of any kind',
    )
    expect(maintenancePlan.systemPrompt).toContain(
      'deduplication and update targeting only',
    )
    expect(maintenancePlan.systemPrompt).not.toContain('Notification execution rules:')
    expect(maintenancePlan.systemPrompt).not.toContain('same full read and write tools')
    expect(maintenancePlan.systemPrompt).not.toContain('meals')
    expect(maintenancePlan.systemPrompt).not.toContain('Health Commons')
    expect(maintenancePlan.systemPrompt).not.toContain(
      'Assistant personality preferences',
    )
    expect(maintenancePlan.systemPrompt).not.toContain('Humor 10/10')
    // Binding context becomes identity/actor/thread/delivery prompt lines at
    // the provider boundary; maintenance turns must never carry it.
    expect(maintenancePlan.sessionContext).toBeUndefined()

    const notificationPlan = await resolveAssistantRouteTurnPlan({
      executionContext,
      input: createMessageInput(),
      preferenceContext,
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
    expect(notificationToolNames).not.toContain('assistant_style')
    expect(notificationPlan.systemPrompt).toContain('hypertension')
    expect(notificationPlan.systemPrompt).toContain('device sync pending')
    expect(notificationPlan.systemPrompt).toContain('Notification execution rules:')
    expect(notificationPlan.systemPrompt).not.toContain('Maintenance execution rules:')
    expect(notificationPlan.systemPrompt).not.toContain(
      'Assistant personality preferences',
    )
    expect(notificationPlan.systemPrompt).not.toContain('Humor 10/10')
    expect(notificationPlan.sessionContext).toEqual({
      binding: expect.anything(),
    })

    const scheduledNewsletterPlan = await resolveAssistantRouteTurnPlan({
      executionContext,
      input: {
        ...createMessageInput(),
        scheduledAutomationAuthority: {
          automationId: 'automation_newsletter',
          occurrenceAt: '2026-07-12T13:00:00.000Z',
        },
      },
      preferenceContext,
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
    expect(scheduledNewsletterPlan.systemPrompt).not.toContain(
      'Trusted scheduled newsletter instructions',
    )
    expect(scheduledNewsletterPlan.systemPrompt).not.toContain(
      '## Compose each edition',
    )
    expect(scheduledNewsletterPlan.systemPrompt).toContain(
      'same vault read and write tools as an interactive Murph turn',
    )
    expect(scheduledNewsletterPlan.systemPrompt).toContain(
      'Scheduled turns do not own automation lifecycle',
    )

    const conversationNotificationPlan = await resolveAssistantRouteTurnPlan({
      executionContext,
      input: createMessageInput(),
      preferenceContext,
      profile: {
        promptProfile: 'conversation',
        threadScope: 'isolated-thread',
        toolProfile: 'notification-turn',
      },
      promptTimeContext,
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
    })
    expect(conversationNotificationPlan.systemPrompt).not.toContain(
      'Assistant personality preferences for this private conversation',
    )
    expect(conversationNotificationPlan.systemPrompt).not.toContain(
      'Humor 10/10',
    )
    expect(
      conversationNotificationPlan.dynamicTools.map((tool) => tool.name),
    ).not.toContain('assistant_style')
  })

  it('rejects notification execution for an unverified external audience', async () => {
    await expect(resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: {
        ...createMessageInput(),
        channel: 'telegram',
        threadIsDirect: null,
      },
      profile: {
        promptProfile: 'notification-decision',
        threadScope: 'session-thread',
        toolProfile: 'notification-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-12',
        currentTimeZone: 'America/New_York',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan({}, {
        channel: 'telegram',
        effectiveThreadIsDirect: null,
        threadId: 'external-thread',
        threadIsDirect: null,
      }),
    })).rejects.toThrow(
      'Cannot plan a provider turn for an unverified external audience.',
    )
  })

  it('soft-fails to an empty assistant protocol index when generated artifacts are unavailable', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(
      'PERSONAL_GROUP_CONTEXT_SNAPSHOT',
    )
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

  it.each([{
    effectiveThreadIsDirect: true,
    label: 'direct',
  }] as const)('injects Murph onboarding skill activation for a $label conversation through route planning', async ({
    effectiveThreadIsDirect,
  }) => {
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

    const sharedPlan = createSharedPlan({
      onboardingGuidanceOpen: true,
    })
    sharedPlan.conversationPolicy.audience.effectiveThreadIsDirect = effectiveThreadIsDirect

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
      sharedPlan,
    })

    const skillRef = buildAssistantSkillFileRef('murph-onboarding')

    expect(plan.onboardingGuidanceInjected).toBe(true)
    expect(plan.systemPrompt).toContain(skillRef)
    expect(plan.turnContextPrompt).not.toContain('Murph onboarding:')
    expect(plan.developerInstructions).toContain('Murph onboarding:')
    expect(plan.developerInstructions).toContain(
      `Read and follow \`${skillRef}\` before advancing, declining, or completing onboarding`,
    )
    expect(plan.developerInstructions).toContain(
      'That skill is the single owner of resume behavior, conversation order, first-value proof, support-loop setup, foundation checkpoints, persistence, defer and skip meaning, and completion.',
    )
    expect(plan.developerInstructions).not.toContain(
      'roughly 5-6 short assistant messages',
    )
    expect(plan.turnContextPrompt).not.toContain('Natural first-run flow')
  })

  it('does not inject personal onboarding guidance into a group conversation', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue([
      'Murph CLI Contract:',
      'assistant:',
      '- `assistant style show`: Show style settings.',
      '- `assistant style set`: Set style settings.',
      '- `assistant style reset`: Reset style settings.',
      '- `assistant onboarding resume-context`: Read onboarding context.',
    ].join('\n'))
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const executionProfile: AssistantCodexTurnResolvedExecutionProfile = {
      promptProfile: 'conversation',
      threadScope: 'session-thread',
      toolProfile: 'provider-turn',
    }
    const sharedPlan = createSharedPlan({
      onboardingGuidanceOpen: true,
    })
    sharedPlan.conversationPolicy.audience.effectiveThreadIsDirect = false

    const plan = await resolveAssistantRouteTurnPlan({
      executionContext: null,
      input: createMessageInput(),
      preferenceContext: {
        assistantPersonality: {
          detail: 7,
          humor: 9,
          push: 8,
        },
        assistantTone: null,
        assistantVoice: null,
      },
      profile: executionProfile,
      promptTimeContext: {
        currentLocalDate: '2026-05-04',
        currentTimeZone: 'Asia/Kuala_Lumpur',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan,
    })

    const skillRef = buildAssistantSkillFileRef('murph-onboarding')

    expect(plan.onboardingGuidanceInjected).toBe(false)
    expect(plan.systemPrompt).not.toContain(skillRef)
    expect(plan.developerInstructions).not.toContain('Murph onboarding:')
    expect(plan.developerInstructions).not.toContain(
      'Before ending a normal reply while onboarding is open, follow the onboarding skill unless a skip condition applies',
    )
    for (const privateStyleText of [
      'Assistant style settings:',
      'Humor',
      'Push',
      'Detail',
      '/settings?voice=true',
      'vault-cli assistant style',
      'murph.assistant_style',
    ]) {
      expect(plan.developerInstructions).not.toContain(privateStyleText)
    }
    expect(plan.developerInstructions).not.toContain('`assistant style show`')
    expect(plan.assistantCliContract).toBeNull()
    expect(plan.dynamicTools.map((tool) => tool.name)).not.toContain(
      'assistant_style',
    )
    expect(plan.developerInstructions).not.toContain('Humor 9/10')
    expect(plan.developerInstructions).not.toContain('Push 8/10')
    expect(plan.developerInstructions).not.toContain('Detail 7/10')
  })

  it('resolves assistant voice preferences into ElevenLabs planning ids', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const vault = await mkdtemp(
      path.join(os.tmpdir(), 'assistant-route-plan-preferences-'),
    )

    try {
      await expect(resolvePlannedElevenLabsVoiceId(vault)).resolves.toBe(
        resolveAssistantVoiceOptionElevenLabsVoiceId(defaultAssistantVoiceOptionId),
      )

      await writeAssistantPreferencesDocument(vault, {
        voice: 'classic',
      })
      await expect(resolvePlannedElevenLabsVoiceId(vault)).resolves.toBeNull()

      await writeAssistantPreferencesDocument(vault, {
        voice: 'warm',
      })
      await expect(resolvePlannedElevenLabsVoiceId(vault)).resolves.toBe(
        resolveAssistantVoiceOptionElevenLabsVoiceId('warm'),
      )

      await writeAssistantPreferencesDocument(vault, {
        voice: 'stale-roster-id',
      })
      await expect(resolvePlannedElevenLabsVoiceId(vault)).resolves.toBeNull()
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('reads sparse personality preferences and rotates the interactive thread contract', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const vault = await mkdtemp(
      path.join(os.tmpdir(), 'assistant-route-plan-personality-'),
    )
    const route = createRoute()
    const session = createSession()
    const privateTelegramAudience = {
      channel: 'telegram',
      effectiveThreadIsDirect: true,
      threadId: 'thread-test',
      threadIsDirect: true,
    } as const

    try {
      const initialExecutionPlan = await buildCodexTurnExecutionPlan({
        input: {
          ...createMessageInput(),
          vault,
        },
        plan: createSharedPlan({}, privateTelegramAudience),
        resolvedSession: session,
        route,
        turnCreatedAt: '2026-05-04T00:00:00.000Z',
        turnId: 'turn-personality-default',
      })
      expect(initialExecutionPlan.preferenceContext).toEqual({
        assistantPersonality: null,
        assistantTone: null,
        assistantVoice: null,
      })
      const initialAttemptPlan = await buildCodexTurnAttemptPlan({
        attemptCount: 1,
        executionPlan: initialExecutionPlan,
        session,
      })

      await writeAssistantPreferencesDocument(vault, {
        personality: {
          detail: 0,
          humor: 9,
        },
      })
      const resumedSession = createSession({
        resumeState: {
          assistantContractFingerprint:
            initialAttemptPlan.routePlan.assistantContractFingerprint,
          routeFingerprint: route.routeFingerprint ?? route.routeId,
          threadId: 'thread-before-personality-change',
        },
      })
      const updatedExecutionPlan = await buildCodexTurnExecutionPlan({
        input: {
          ...createMessageInput(),
          vault,
        },
        plan: createSharedPlan({}, privateTelegramAudience),
        resolvedSession: resumedSession,
        route,
        turnCreatedAt: '2026-05-04T00:01:00.000Z',
        turnId: 'turn-personality-updated',
      })
      expect(updatedExecutionPlan.preferenceContext).toEqual({
        assistantPersonality: {
          detail: 0,
          humor: 9,
        },
        assistantTone: null,
        assistantVoice: null,
      })
      const updatedAttemptPlan = await buildCodexTurnAttemptPlan({
        attemptCount: 1,
        executionPlan: updatedExecutionPlan,
        session: resumedSession,
      })

      expect(updatedAttemptPlan.routePlan.resume).toBeNull()
      expect(updatedAttemptPlan.routePlan.assistantContractFingerprint).not.toBe(
        initialAttemptPlan.routePlan.assistantContractFingerprint,
      )
      expect(updatedAttemptPlan.routePlan.developerInstructions).toContain(
        'Humor 9/10: use prominent, bold, dry humor',
      )
      expect(updatedAttemptPlan.routePlan.developerInstructions).toContain(
        'Detail 0/10: give the shortest complete answer',
      )
      expect(updatedAttemptPlan.routePlan.dynamicTools.map((tool) => tool.name)).toContain(
        'assistant_style',
      )
      expect(updatedAttemptPlan.routePlan.developerInstructions).not.toContain(
        'Push 3/10',
      )

      const groupSession = createSession()
      const groupExecutionPlan = await buildCodexTurnExecutionPlan({
        input: {
          ...createMessageInput(),
          threadIsDirect: false,
          vault,
        },
        plan: createSharedPlan({}, {
          channel: 'telegram',
          effectiveThreadIsDirect: false,
          threadId: 'thread-test',
          threadIsDirect: false,
        }),
        resolvedSession: groupSession,
        route,
        turnCreatedAt: '2026-05-04T00:02:00.000Z',
        turnId: 'turn-personality-group',
      })
      const groupAttemptPlan = await buildCodexTurnAttemptPlan({
        attemptCount: 1,
        executionPlan: groupExecutionPlan,
        session: groupSession,
      })
      expect(groupExecutionPlan.preferenceContext?.assistantPersonality).toEqual({
        detail: 0,
        humor: 9,
      })
      expect(groupAttemptPlan.routePlan.developerInstructions).not.toContain(
        'Assistant personality preferences for this private conversation',
      )
      expect(groupAttemptPlan.routePlan.developerInstructions).not.toContain(
        'Humor 9/10',
      )
      expect(groupAttemptPlan.routePlan.dynamicTools.map((tool) => tool.name)).not.toContain(
        'assistant_style',
      )

      const unknownExternalSession = createSession()
      const unknownExternalExecutionPlan = await buildCodexTurnExecutionPlan({
        input: {
          ...createMessageInput(),
          threadIsDirect: null,
          vault,
        },
        plan: createSharedPlan({}, {
          channel: 'telegram',
          effectiveThreadIsDirect: null,
          threadId: 'thread-test',
          threadIsDirect: null,
        }),
        resolvedSession: unknownExternalSession,
        route,
        turnCreatedAt: '2026-05-04T00:03:00.000Z',
        turnId: 'turn-personality-unknown-external',
      })
      await expect(buildCodexTurnAttemptPlan({
        attemptCount: 1,
        executionPlan: unknownExternalExecutionPlan,
        session: unknownExternalSession,
      })).rejects.toThrow(
        'Cannot plan a provider turn for an unverified external audience.',
      )
      expect(
        unknownExternalExecutionPlan.sharedPlan.conversationPolicy.audience
          .effectiveThreadIsDirect,
      ).toBeNull()
      const localSession = createSession()
      const localExecutionPlan = await buildCodexTurnExecutionPlan({
        input: {
          ...createMessageInput(),
          channel: null,
          threadId: null,
          threadIsDirect: null,
          vault,
        },
        plan: createSharedPlan(),
        resolvedSession: localSession,
        route,
        turnCreatedAt: '2026-05-04T00:04:00.000Z',
        turnId: 'turn-personality-local',
      })
      const localAttemptPlan = await buildCodexTurnAttemptPlan({
        attemptCount: 1,
        executionPlan: localExecutionPlan,
        session: localSession,
      })
      expect(
        localAttemptPlan.routePlan.developerInstructions,
      ).toContain('Humor 9/10: use prominent, bold, dry humor')
      expect(localAttemptPlan.routePlan.dynamicTools.map((tool) => tool.name)).toContain(
        'assistant_style',
      )
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
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
          assistantStyleSettingsAvailable: true,
          progressUpdatesAvailable: false,
          voiceMemoGenerationAvailable: false,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )
  })

  it('exposes private style settings to email turns only with exact-turn sender authority', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const sharedInput = {
      executionContext: null,
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
      session: createSession(),
      sharedPlan: createSharedPlan(),
    } satisfies Omit<Parameters<typeof resolveAssistantRouteTurnPlan>[0], 'input'>

    const unauthorized = await resolveAssistantRouteTurnPlan({
      ...sharedInput,
      input: {
        ...createMessageInput(),
        channel: 'email',
      },
    })
    const authorized = await resolveAssistantRouteTurnPlan({
      ...sharedInput,
      input: {
        ...createMessageInput(),
        assistantStyleSettingsAuthorized: true,
        channel: 'email',
      },
    })

    expect(unauthorized.dynamicTools.map((tool) => tool.name)).not.toContain(
      'assistant_style',
    )
    expect(authorized.dynamicTools.map((tool) => tool.name)).toContain(
      'assistant_style',
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
          assistantStyleSettingsAvailable: true,
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
          assistantStyleSettingsAvailable: true,
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
          assistantStyleSettingsAvailable: true,
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
          assistantStyleSettingsAvailable: true,
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
          assistantStyleSettingsAvailable: true,
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
          assistantStyleSettingsAvailable: true,
          computerToolsAvailable: true,
          progressUpdatesAvailable: false,
          voiceMemoGenerationAvailable: plan.voiceMemoDeliveryChannel !== null,
        }),
        routeFingerprint: route.routeFingerprint ?? route.routeId,
      }),
    )
  })

  it('derives a group-scoped prompt and tool surface from the audience', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('bootstrap contract')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue(null)
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext(),
      assistantConfigurationTool: { request: vi.fn() },
      connectedApps: { request: vi.fn() },
      familyPlanTool: { request: vi.fn() },
      groupTool: { request: vi.fn() },
      newsletterTool: { request: vi.fn() },
      planUsageTool: { read: vi.fn() },
      phoneCalls: { start: vi.fn() },
    }
    const plan = await resolveAssistantRouteTurnPlan({
      acceptedInputItems: [{ id: 'group-phone-request', source: 'manual' }],
      executionContext: {
        hosted: {
          memberId: 'member-group-container',
          progressDeliveryDependencies: {},
          providerFetch: null,
          userEnvKeys: [],
        },
      },
      hostedToolContext,
      input: {
        ...createMessageInput(),
        channel: 'linq',
        deliverResponse: true,
      },
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-12',
        currentTimeZone: 'America/New_York',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan({}, {
        channel: 'linq',
        effectiveThreadIsDirect: false,
        threadId: 'group-thread',
        threadIsDirect: false,
      }),
    })

    expect(plan.developerInstructions).toContain('Conversation scope: hosted group chat.')
    expect(plan.developerInstructions).not.toContain('bootstrap contract')
    expect(plan.developerInstructions).not.toContain('PERSONAL_GROUP_CONTEXT_SNAPSHOT')
    expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()
    expect(plan.developerInstructions).not.toContain('/settings?voice=true')
    expect(plan.developerInstructions).not.toContain('Hosted wearable connection links are available')
    expect(plan.developerInstructions).toContain(
      'Group automation writes are current-room-only',
    )
    expect(plan.developerInstructions).toContain(
      'never use saved personal/self targets',
    )
    expect(plan.developerInstructions).not.toContain(
      'explicit route flags',
    )
    expect(plan.dynamicTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'connected_apps_search',
        'connected_apps_execute',
        'group',
        'newsletter',
      ]),
    )
    for (const personalTool of [
      'computer_open',
      'assistant_configuration',
      'connected_apps_manage',
      'create_phone_call',
      'family_plan',
      'plan_usage',
      'send_vault_file',
    ]) {
      expect(plan.dynamicTools.map((tool) => tool.name)).not.toContain(personalTool)
    }
  })

  it('fails closed on personal prompt context and tools for an unverified external audience', async () => {
    planningMocks.readAssistantCliSurfaceBootstrapContext.mockResolvedValue('PERSONAL_CLI_CONTRACT')
    planningMocks.readAssistantContextSnapshotPrompt.mockResolvedValue('PERSONAL_CONTEXT_SNAPSHOT')
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: false,
    })
    const hostedToolContext: AssistantHostedToolContext = {
      ...createHostedToolContext(),
      connectedApps: { request: vi.fn() },
      familyPlanTool: { request: vi.fn() },
      groupTool: { request: vi.fn() },
      newsletterTool: { request: vi.fn() },
      phoneCalls: { start: vi.fn() },
    }
    await expect(resolveAssistantRouteTurnPlan({
      acceptedInputItems: [{ id: 'external-phone-request', source: 'manual' }],
      executionContext: {
        hosted: {
          dynamicContextPrompts: ['PERSONAL_HOSTED_CONTEXT'],
          memberId: 'member-hosted',
          progressDeliveryDependencies: {},
          providerFetch: null,
          userEnvKeys: [],
        },
      },
      hostedToolContext,
      input: {
        ...createMessageInput(),
        channel: 'telegram',
        deliverResponse: true,
      },
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-12',
        currentTimeZone: 'America/New_York',
      },
      route: createRoute(),
      session: createSession(),
      sharedPlan: createSharedPlan({
        onboardingGuidanceOpen: true,
      }, {
        channel: 'telegram',
        effectiveThreadIsDirect: null,
        threadId: 'external-thread',
        threadIsDirect: null,
      }),
    })).rejects.toThrow('Cannot plan a provider turn for an unverified external audience.')
    expect(planningMocks.readAssistantCliSurfaceBootstrapContext).not.toHaveBeenCalled()
    expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()
  })

  it('does not replay transcript, hidden turn, or binding context for an unverified external audience', async () => {
    planningMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportsNativeResume: true,
    })
    const vault = await mkdtemp(
      path.join(os.tmpdir(), 'assistant-route-plan-unverified-external-'),
    )
    const session = createSession({ turnCount: 1 })
    session.binding = {
      actorId: 'PRIVATE_ACTOR_ID',
      channel: 'telegram',
      conversationKey: 'PRIVATE_CONVERSATION_KEY',
      delivery: null,
      identityId: 'PRIVATE_IDENTITY_ID',
      threadId: 'external-thread',
      threadIsDirect: null,
    }

    try {
      await appendAssistantTranscriptEntries(vault, session.sessionId, [{
        kind: 'assistant',
        text: 'PRIVATE_TRANSCRIPT_MESSAGE',
      }])

      await expect(resolveAssistantRouteTurnPlan({
        executionContext: null,
        input: {
          ...createMessageInput(),
          channel: 'telegram',
          threadIsDirect: null,
          turnContext: 'PRIVATE_HIDDEN_TURN_CONTEXT',
          vault,
        },
        profile: {
          promptProfile: 'conversation',
          threadScope: 'session-thread',
          toolProfile: 'provider-turn',
        },
        promptTimeContext: {
          currentLocalDate: '2026-07-12',
          currentTimeZone: 'America/New_York',
        },
        route: createRoute(),
        session,
        sharedPlan: createSharedPlan({}, {
          actorId: 'PRIVATE_ACTOR_ID',
          channel: 'telegram',
          effectiveThreadIsDirect: null,
          identityId: 'PRIVATE_IDENTITY_ID',
          threadId: 'external-thread',
          threadIsDirect: null,
        }),
      })).rejects.toThrow('Cannot plan a provider turn for an unverified external audience.')
      expect(planningMocks.readAssistantCliSurfaceBootstrapContext).not.toHaveBeenCalled()
      expect(planningMocks.readAssistantContextSnapshotPrompt).not.toHaveBeenCalled()
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
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

  })

  it('plans native resume without preparing committed transcript replay', async () => {
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

  it('does not replay committed transcript messages for native resume', async () => {
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
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('does not replay committed transcript messages for notification native resume', async () => {
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

async function resolvePlannedElevenLabsVoiceId(vault: string): Promise<string | null> {
  const session = createSession()
  const route = createRoute()
  const executionPlan = await buildCodexTurnExecutionPlan({
    input: {
      ...createMessageInput(),
      vault,
    },
    plan: createSharedPlan(),
    resolvedSession: session,
    route,
    turnCreatedAt: '2026-05-04T00:00:00.000Z',
    turnId: 'turn-preferences',
  })
  const attemptPlan = await buildCodexTurnAttemptPlan({
    attemptCount: 1,
    executionPlan,
    session,
  })

  return attemptPlan.routePlan.assistantPreferredElevenLabsVoiceId ?? null
}

async function writeAssistantPreferencesDocument(
  vault: string,
  input: {
    personality?: {
      detail?: number
      humor?: number
      push?: number
    }
    voice?: string
  },
): Promise<void> {
  const preferencesPath = path.join(vault, preferencesDocumentRelativePath)
  await mkdir(path.dirname(preferencesPath), { recursive: true })
  await writeFile(
    preferencesPath,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-07-08T12:00:00.000Z',
      assistant: input,
      workoutUnitPreferences: {},
      wearablePreferences: {
        desiredProviders: [],
      },
    }),
    'utf8',
  )
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
  audienceOverrides: Partial<
    AssistantTurnSharedPlan['conversationPolicy']['audience']
  > = {},
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
        ...audienceOverrides,
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
