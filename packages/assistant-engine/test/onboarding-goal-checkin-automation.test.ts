import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  initializeVault,
  patchAutomation,
  showAutomation,
  upsertAutomation,
} from '@murphai/core'
import { afterEach, describe, expect, it } from 'vitest'

import {
  applyMurphManagedAutomations,
  resolveMurphManagedAutomationOwnerScope,
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

describe('post-onboarding support-gap automation', () => {
  it('builds one bounded member-owned check three local days after completion', () => {
    const seed = buildOnboardingGoalCheckinSeed({
      now: new Date('2026-03-02T12:00:00.000Z'),
      onboardingState: completedOnboardingState({
        // 00:30 local on March 1, before the US daylight-saving transition.
        completedAt: '2026-03-01T05:30:00.000Z',
      }),
      timeZone: 'America/New_York',
    })

    expect(seed).toMatchObject({
      // March 4 is EST and March 8 is EDT.
      activeUntil: '2026-03-08T17:30:00.000Z',
      assistantTargetOverride: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
      },
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      ownerScope: 'member',
      schedule: {
        at: '2026-03-04T18:30:00.000Z',
        kind: 'at',
      },
      slug: 'onboarding-goal-checkin',
      title: 'Initial goal support check-in',
    })
    expect(seed?.instructions).toContain('about three days after answered onboarding')
    expect(seed?.instructions).toContain('This is not the first personal health read')
    expect(seed?.instructions).toContain('one exact finite package')
    expect(seed?.instructions).toContain('durable support boundaries')
    expect(seed?.instructions).toContain(
      'Do not create, update, complete, or archive goals',
    )
    expect(seed?.instructions).not.toContain('weekly support-gap check')

    expect(
      resolveMurphManagedAutomationOwnerScope(
        MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      ),
    ).toBe('member')
  })

  it('seeds answered onboarding only and rejects invalid timezones', () => {
    expect(buildOnboardingGoalCheckinSeed({
      onboardingState: openOnboardingState(),
      timeZone: 'UTC',
    })).toBeNull()

    for (const reason of ['user_declined', 'manual'] as const) {
      expect(buildOnboardingGoalCheckinSeed({
        onboardingState: completedOnboardingState({ reason }),
        timeZone: 'UTC',
      })).toBeNull()
    }

    expect(buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-02T12:00:00.000Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'UTC',
    })).toMatchObject({
      activeUntil: '2026-06-08T13:30:00.000Z',
      schedule: {
        at: '2026-06-04T13:30:00.000Z',
        kind: 'at',
      },
    })

    expect(() => buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-02T12:00:00.000Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'not/a-timezone',
    })).toThrow('invalid vault timezone')
  })

  it('uses one bounded daytime catch-up and does not offer stale rollout outreach', () => {
    expect(buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-04T15:00:00.000Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'UTC',
    })).toMatchObject({
      activeUntil: '2026-06-08T13:30:00.000Z',
      schedule: {
        at: '2026-06-05T13:30:00.000Z',
        kind: 'at',
      },
    })

    expect(buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-08T13:30:00.000Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'UTC',
    })).toBeNull()

    expect(buildOnboardingGoalCheckinSeed({
      now: new Date('2026-07-01T12:00:00.000Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'UTC',
    })).toBeNull()
  })

  it('installs the one-shot idempotently through the managed registry', async () => {
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
      activeUntil: '2026-03-08T17:30:00.000Z',
      route: defaultRoute,
      schedule: {
        at: '2026-03-04T18:30:00.000Z',
        kind: 'at',
      },
      status: 'active',
      tags: expect.arrayContaining([
        'goal-support',
        'murph-managed',
        'murph-managed:onboarding-goal-checkin',
      ]),
      title: 'Initial goal support check-in',
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

  it('keeps an installed catch-up and its original private route stable', async () => {
    const vaultRoot = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T18:15:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-04T15:00:00.000Z'),
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
      route: defaultRoute,
      schedule: {
        at: '2026-06-05T13:30:00.000Z',
        kind: 'at',
      },
    })

    const changedDefaultRoute = {
      ...defaultRoute,
      deliveryTarget: 'newer-telegram-thread',
    }
    await expect(applyMurphManagedAutomations({
      defaultRoute: changedDefaultRoute,
      now: new Date('2026-06-05T12:00:00.000Z'),
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
      route: defaultRoute,
      schedule: {
        at: '2026-06-05T13:30:00.000Z',
        kind: 'at',
      },
    })
  })

  it('retires a superseded active 21-day check instead of sending stale support', async () => {
    const vaultRoot = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T18:15:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    await upsertAutomation({
      activeUntil: '2026-06-29T13:30:00.000Z',
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Offer one low-pressure health direction choice.',
      now: new Date('2026-06-02T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        at: '2026-06-22T13:30:00.000Z',
        kind: 'at',
      },
      slug: 'onboarding-goal-checkin',
      status: 'active',
      summary: 'A one-time post-onboarding health direction choice.',
      tags: [
        'assistant',
        'scheduled',
        'murph-managed',
        'onboarding',
        'goal-checkin',
        'murph-managed:onboarding-goal-checkin',
      ],
      title: 'First health direction check-in',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-10T12:00:00.000Z'),
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
      activeUntil: '2026-06-08T13:30:00.000Z',
      schedule: {
        at: '2026-06-04T13:30:00.000Z',
        kind: 'at',
      },
      status: 'archived',
    })
  })

  it.each([
    { label: 'paused', status: 'paused' as const },
    { label: 'archived', status: 'archived' as const },
  ])('does not reactivate a $label support-gap one-shot', async ({ status }) => {
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
      now: new Date('2026-06-02T13:00:00.000Z'),
      status,
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-02T14:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 6,
      updated: 0,
    })
    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({ status })
  })

  it('accepts only answered onboarding inside the bounded occurrence window', async () => {
    const eligibleVault = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T00:00:00.000Z',
      reason: 'user_answered',
      vault: eligibleVault,
    })
    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      occurrenceAt: '2026-06-03T00:00:00.000Z',
      vault: eligibleVault,
    })).resolves.toEqual({ kind: 'continue' })
    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      occurrenceAt: '2026-06-02T23:59:59.999Z',
      vault: eligibleVault,
    })).resolves.toMatchObject({ kind: 'skip' })
    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      occurrenceAt: '2026-06-09T00:00:00.001Z',
      vault: eligibleVault,
    })).resolves.toMatchObject({ kind: 'skip' })

    for (const reason of ['user_declined', 'manual'] as const) {
      const ineligibleVault = await createVaultRoot()
      await completeAssistantOnboarding({
        completedAt: '2026-06-01T00:00:00.000Z',
        reason,
        vault: ineligibleVault,
      })
      await expect(runOnboardingGoalCheckinAuthorityPrecondition({
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        occurrenceAt: '2026-06-04T13:30:00.000Z',
        vault: ineligibleVault,
      })).resolves.toMatchObject({ kind: 'skip' })
    }

    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: 'automation_unrelated',
      occurrenceAt: '2026-06-04T13:30:00.000Z',
      vault: eligibleVault,
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

    await expect(runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      occurrenceAt: '2026-06-04T13:30:00.000Z',
      vault: vaultRoot,
    })).rejects.toMatchObject({
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
