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

describe('onboarding goal check-in automation', () => {
  it('builds one bounded member-owned choice point at a stable local daytime hour', () => {
    const seed = buildOnboardingGoalCheckinSeed({
      now: new Date('2026-03-02T12:00:00.000Z'),
      onboardingState: completedOnboardingState({
        // 00:30 local on March 1, before the US daylight-saving transition.
        completedAt: '2026-03-01T05:30:00.000Z',
      }),
      timeZone: 'America/New_York',
    })

    expect(seed).toMatchObject({
      // March 22 and 29 are EDT, so 13:30 local resolves to 17:30 UTC.
      activeUntil: '2026-03-29T17:30:00.000Z',
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      ownerScope: 'member',
      schedule: {
        at: '2026-03-22T17:30:00.000Z',
        kind: 'at',
      },
      slug: 'onboarding-goal-checkin',
      title: 'First health direction check-in',
    })
    expect(seed?.instructions).toContain('current private conversation')
    expect(seed?.instructions).toContain('normal Murph vault tools')
    expect(seed?.instructions).toContain('unclear, unshared')
    expect(seed?.instructions).toContain('keep learning for now')
    expect(seed?.instructions).toContain('Do not create, update, complete, or archive goals')
    expect(seed?.instructions).not.toContain('you are making a lot of progress')

    expect(
      resolveMurphManagedAutomationOwnerScope(
        MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      ),
    ).toBe('member')
  })

  it('does not seed open, declined, manual, or invalid-timezone onboarding', () => {
    expect(buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-02T12:00:00.000Z'),
      onboardingState: openOnboardingState(),
      timeZone: 'UTC',
    })).toBeNull()

    for (const reason of ['user_declined', 'manual'] as const) {
      expect(buildOnboardingGoalCheckinSeed({
        now: new Date('2026-06-02T12:00:00.000Z'),
        onboardingState: completedOnboardingState({ reason }),
        timeZone: 'UTC',
      })).toBeNull()
    }

    expect(buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-29T13:29:59.999Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'UTC',
    })).not.toBeNull()
    expect(buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-29T13:30:00.000Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'UTC',
    })).toMatchObject({
      activeUntil: '2026-07-13T13:30:00.000Z',
      schedule: {
        at: '2026-07-06T13:30:00.000Z',
        kind: 'at',
      },
    })

    expect(() => buildOnboardingGoalCheckinSeed({
      now: new Date('2026-06-02T12:00:00.000Z'),
      onboardingState: completedOnboardingState(),
      timeZone: 'not/a-timezone',
    })).toThrow('invalid vault timezone')
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
      activeUntil: '2026-03-29T17:30:00.000Z',
      route: defaultRoute,
      schedule: {
        at: '2026-03-22T17:30:00.000Z',
        kind: 'at',
      },
      slug: 'onboarding-goal-checkin',
      status: 'active',
      tags: expect.arrayContaining([
        'murph-managed',
        'murph-managed:onboarding-goal-checkin',
      ]),
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

  it('installs one stable catch-up for answered onboarding completed before rollout', async () => {
    const vaultRoot = await createVaultRoot('America/New_York')
    await completeAssistantOnboarding({
      completedAt: '2025-11-03T14:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    await expect(
      applyMurphManagedAutomations({
        defaultRoute,
        now: new Date('2026-07-01T16:00:00.000Z'),
        vaultRoot,
      }),
    ).resolves.toEqual({
      created: 6,
      skipped: 0,
      updated: 0,
    })
    await expect(
      showAutomation({
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        vaultRoot,
      }),
    ).resolves.toMatchObject({
      activeUntil: '2026-07-13T17:30:00.000Z',
      schedule: {
        at: '2026-07-06T17:30:00.000Z',
        kind: 'at',
      },
      status: 'active',
    })

    // Once installed, the canonical automation record anchors the catch-up.
    // A later maintenance pass must not move it to the next matching weekday.
    await expect(
      applyMurphManagedAutomations({
        defaultRoute,
        now: new Date('2026-07-07T16:00:00.000Z'),
        vaultRoot,
      }),
    ).resolves.toEqual({
      created: 0,
      skipped: 6,
      updated: 0,
    })
    await expect(
      showAutomation({
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        vaultRoot,
      }),
    ).resolves.toMatchObject({
      activeUntil: '2026-07-13T17:30:00.000Z',
      schedule: {
        at: '2026-07-06T17:30:00.000Z',
        kind: 'at',
      },
      status: 'active',
    })
  })

  it('does not reactivate a consumed legacy catch-up', async () => {
    const vaultRoot = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2025-11-03T14:00:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-07-01T12:00:00.000Z'),
      vaultRoot,
    })
    await patchAutomation({
      lookup: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      now: new Date('2026-07-06T14:00:00.000Z'),
      status: 'archived',
      vaultRoot,
    })

    await expect(
      applyMurphManagedAutomations({
        defaultRoute,
        now: new Date('2026-07-08T12:00:00.000Z'),
        vaultRoot,
      }),
    ).resolves.toEqual({
      created: 0,
      skipped: 6,
      updated: 0,
    })
    await expect(
      showAutomation({
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        vaultRoot,
      }),
    ).resolves.toMatchObject({
      status: 'archived',
    })
  })

  it('accepts the earliest valid local-calendar occurrence after answered onboarding', async () => {
    const vaultRoot = await createVaultRoot()
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T23:59:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })

    await expect(
      runOnboardingGoalCheckinAuthorityPrecondition({
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        occurrenceAt: '2026-06-22T13:30:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({ kind: 'continue' })
  })

  it('keeps unrelated managed automation setup alive when onboarding state is malformed', async () => {
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
