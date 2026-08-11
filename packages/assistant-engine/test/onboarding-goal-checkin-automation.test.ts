import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  initializeVault,
  patchAutomation,
  showAutomation,
} from '@murphai/core'
import { afterEach, describe, expect, it } from 'vitest'

import {
  applyMurphManagedAutomations,
  resolveMurphManagedAutomationOwnerScope,
  type MurphManagedAutomationSeed,
} from '../src/assistant/managed-automations.ts'
import {
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
  buildOnboardingGoalCheckinSeed,
  runOnboardingGoalCheckinAuthorityPrecondition,
} from '../src/assistant/onboarding-goal-checkin-automation.ts'
import {
  completeAssistantOnboarding,
  resolveAssistantOnboardingStatePath,
} from '../src/assistant/onboarding-state.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

const defaultRoute = {
  channel: 'telegram',
  deliveryTarget: 'telegram-thread-1',
  identityId: null,
  participantId: null,
  threadId: null,
}

type OnboardingState = Awaited<ReturnType<typeof completeAssistantOnboarding>>

function completedOnboardingState(input: {
  completedAt?: string
  reason?: OnboardingState['completedReason']
} = {}): OnboardingState {
  const completedAt = input.completedAt ?? '2026-06-01T18:15:00.000Z'
  return {
    completedAt,
    completedReason: input.reason ?? 'user_answered',
    createdAt: '2026-06-01T18:00:00.000Z',
    schemaVersion: 'murph.assistant-onboarding.v1',
    status: 'completed',
    updatedAt: completedAt,
  }
}

function openOnboardingState(): OnboardingState {
  return {
    completedAt: null,
    completedReason: null,
    createdAt: '2026-06-01T18:00:00.000Z',
    schemaVersion: 'murph.assistant-onboarding.v1',
    status: 'open',
    updatedAt: '2026-06-01T18:00:00.000Z',
  }
}

function legacyGoalCheckinSeed(input: {
  activeUntil?: string
  scheduledAt?: string
} = {}): MurphManagedAutomationSeed {
  return {
    activeUntil: input.activeUntil ?? '2026-07-27T17:30:00.000Z',
    automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
    continuityPolicy: 'preserve',
    instructions: 'Offer one low-pressure health direction choice.',
    ownerScope: 'member',
    schedule: {
      at: input.scheduledAt ?? '2026-07-20T17:30:00.000Z',
      kind: 'at',
    },
    slug: 'onboarding-goal-checkin',
    summary: 'A one-time post-onboarding health direction choice.',
    tags: [
      'onboarding',
      'goal-checkin',
      'murph-managed:onboarding-goal-checkin',
    ],
    title: 'First health direction check-in',
  }
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  )
})

async function createVaultRoot(timezone = 'UTC'): Promise<string> {
  const context = await createTempVaultContext('murph-onboarding-goal-checkin-')
  tempRoots.push(context.parentRoot)
  await initializeVault({ timezone, vaultRoot: context.vaultRoot })
  return context.vaultRoot
}

describe('weekly goal support automation', () => {
  it('builds one recurring member-owned support audit at a stable local daytime hour', () => {
    const seed = buildOnboardingGoalCheckinSeed({
      now: new Date('2026-03-02T12:00:00.000Z'),
      onboardingState: completedOnboardingState({
        // March 1, 2026 is Sunday in the member's local timezone.
        completedAt: '2026-03-01T05:30:00.000Z',
      }),
      timeZone: 'America/New_York',
    })

    expect(seed).toMatchObject({
      activeUntil: null,
      assistantTargetOverride: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
      },
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      ownerScope: 'member',
      schedule: {
        expression: '30 13 * * 1',
        kind: 'cron',
      },
      slug: 'onboarding-goal-checkin',
      title: 'Weekly goal support check-in',
    })
    expect(seed?.instructions).toContain('weekly support-gap check')
    expect(seed?.instructions).toContain('one exact finite package')
    expect(seed?.instructions).toContain('meal notes or photos')
    expect(seed?.instructions).toContain('later clear yes')
    expect(seed?.instructions).toContain(
      'Do not create, update, complete, or archive goals',
    )

    expect(
      resolveMurphManagedAutomationOwnerScope(
        MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      ),
    ).toBe('member')
  })

  it('seeds answered and manual completion, but not open or declined onboarding', () => {
    expect(buildOnboardingGoalCheckinSeed({
      onboardingState: openOnboardingState(),
      timeZone: 'UTC',
    })).toBeNull()

    expect(buildOnboardingGoalCheckinSeed({
      onboardingState: completedOnboardingState({ reason: 'user_declined' }),
      timeZone: 'UTC',
    })).toBeNull()

    for (const reason of ['user_answered', 'manual'] as const) {
      expect(buildOnboardingGoalCheckinSeed({
        onboardingState: completedOnboardingState({ reason }),
        timeZone: 'UTC',
      })).toMatchObject({
        activeUntil: null,
        schedule: {
          expression: '30 13 * * 2',
          kind: 'cron',
        },
      })
    }

    expect(() => buildOnboardingGoalCheckinSeed({
      onboardingState: completedOnboardingState(),
      timeZone: 'not/a-timezone',
    })).toThrow('invalid vault timezone')
  })

  it('installs the recurring audit idempotently through the managed registry', async () => {
    const vaultRoot = await createVaultRoot('America/New_York')
    await completeAssistantOnboarding({
      completedAt: '2026-03-01T05:30:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-03-02T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 6,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      activeUntil: null,
      route: defaultRoute,
      schedule: {
        expression: '30 13 * * 1',
        kind: 'cron',
      },
      status: 'active',
      tags: expect.arrayContaining([
        'goal-support',
        'murph-managed',
        'murph-managed:onboarding-goal-checkin',
      ]),
      title: 'Weekly goal support check-in',
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-03-02T12:01:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 6,
      updated: 0,
    })
  })

  it('migrates an active legacy one-shot in place without rerouting it', async () => {
    const vaultRoot = await createVaultRoot('America/New_York')
    const legacyRoute = {
      ...defaultRoute,
      deliveryTarget: 'legacy-telegram-thread',
    }
    await completeAssistantOnboarding({
      completedAt: '2026-03-01T05:30:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute: legacyRoute,
      now: new Date('2026-07-01T12:00:00.000Z'),
      seeds: [legacyGoalCheckinSeed()],
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-07-02T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })
    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      activeUntil: null,
      route: legacyRoute,
      schedule: {
        expression: '30 13 * * 1',
        kind: 'cron',
      },
      status: 'active',
      title: 'Weekly goal support check-in',
    })
  })

  it('migrates a consumed legacy one-shot but preserves an explicit pre-run stop', async () => {
    const consumedVault = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T18:15:00.000Z',
      reason: 'user_answered',
      vault: consumedVault,
    })
    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-07-01T12:00:00.000Z'),
      seeds: [legacyGoalCheckinSeed()],
      vaultRoot: consumedVault,
    })
    await patchAutomation({
      lookup: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      now: new Date('2026-07-27T17:31:00.000Z'),
      status: 'archived',
      vaultRoot: consumedVault,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-07-28T12:00:00.000Z'),
      vaultRoot: consumedVault,
    })).resolves.toEqual({
      created: 5,
      skipped: 0,
      updated: 1,
    })
    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot: consumedVault,
    })).resolves.toMatchObject({
      activeUntil: null,
      schedule: expect.objectContaining({ kind: 'cron' }),
      status: 'active',
    })

    const stoppedVault = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T18:15:00.000Z',
      reason: 'user_answered',
      vault: stoppedVault,
    })
    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-07-01T12:00:00.000Z'),
      seeds: [legacyGoalCheckinSeed()],
      vaultRoot: stoppedVault,
    })
    await patchAutomation({
      lookup: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      now: new Date('2026-07-19T17:00:00.000Z'),
      status: 'archived',
      vaultRoot: stoppedVault,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-07-28T12:00:00.000Z'),
      vaultRoot: stoppedVault,
    })).resolves.toEqual({
      created: 5,
      skipped: 1,
      updated: 0,
    })
    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot: stoppedVault,
    })).resolves.toMatchObject({
      schedule: expect.objectContaining({ kind: 'at' }),
      status: 'archived',
    })
  })

  it('does not reactivate a paused recurring audit', async () => {
    const vaultRoot = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T18:15:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-02T12:00:00.000Z'),
      vaultRoot,
    })
    await patchAutomation({
      lookup: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      now: new Date('2026-06-03T12:00:00.000Z'),
      status: 'paused',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-04T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 6,
      updated: 0,
    })
    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      schedule: expect.objectContaining({ kind: 'cron' }),
      status: 'paused',
    })
  })

  it('accepts completed-onboarding authority and rejects stale or too-recent authority', async () => {
    for (const reason of ['user_answered', 'manual'] as const) {
      const vaultRoot = await createVaultRoot()
      await completeAssistantOnboarding({
        completedAt: '2026-06-01T00:00:00.000Z',
        reason,
        vault: vaultRoot,
      })
      await expect(runOnboardingGoalCheckinAuthorityPrecondition({
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        occurrenceAt: '2026-06-01T13:00:00.000Z',
        vault: vaultRoot,
      })).resolves.toEqual({ kind: 'continue' })
    }

    const tooRecentVault = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T00:00:00.000Z',
      reason: 'user_answered',
      vault: tooRecentVault,
    })
    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      occurrenceAt: '2026-06-01T11:59:59.999Z',
      vault: tooRecentVault,
    })).resolves.toMatchObject({ kind: 'skip' })

    const declinedVault = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T00:00:00.000Z',
      reason: 'user_declined',
      vault: declinedVault,
    })
    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      occurrenceAt: '2026-06-08T13:30:00.000Z',
      vault: declinedVault,
    })).resolves.toMatchObject({ kind: 'skip' })

    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: 'automation_unrelated',
      occurrenceAt: '2026-06-08T13:30:00.000Z',
      vault: declinedVault,
    })).resolves.toEqual({ kind: 'continue' })
  })

  it.each([
    {
      corrupt: async (statePath: string) => {
        await writeFile(statePath, '{not valid json', 'utf8')
      },
      reason: 'invalid-json',
    },
    {
      corrupt: async (statePath: string) => {
        await writeFile(statePath, '{}', 'utf8')
      },
      reason: 'invalid-schema',
    },
    {
      corrupt: async (statePath: string) => {
        await rm(statePath, { force: true })
        await mkdir(statePath)
      },
      reason: 'read-failed',
    },
  ])('makes $reason authority failures retryable', async ({ corrupt, reason }) => {
    const vaultRoot = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T00:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    await corrupt(resolveAssistantOnboardingStatePath(vaultRoot))

    await expect(
      runOnboardingGoalCheckinAuthorityPrecondition({
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        occurrenceAt: '2026-06-08T13:30:00.000Z',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
      context: {
        reason,
        retryable: true,
      },
    })
  })

  it('keeps unrelated managed setup alive when onboarding state is malformed', async () => {
    const vaultRoot = await createVaultRoot()
    const statePath = resolveAssistantOnboardingStatePath(vaultRoot)
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, '{not valid json', 'utf8')

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-02T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toMatchObject({
      created: 5,
      skipped: 0,
      updated: 0,
    })
    expect(result.onboardingGoalCheckinFailure).toMatchObject({
      reason: 'invalid-json',
    })
    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
  })
})
