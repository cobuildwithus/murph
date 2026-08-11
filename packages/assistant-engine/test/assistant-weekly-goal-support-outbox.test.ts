import { rm } from 'node:fs/promises'

import {
  initializeVault,
  upsertAutomation,
} from '@murphai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
} from '../src/assistant/onboarding-goal-checkin-automation.ts'
import {
  completeAssistantOnboarding,
  reopenAssistantOnboarding,
} from '../src/assistant/onboarding-state.ts'
import {
  resolveAssistantOutboxAutomationAuthorityError,
} from '../src/assistant/outbox/automation-authority.ts'
import {
  deliverAssistantOutboxMessage,
} from '../src/assistant/outbox.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  )
})

describe('weekly goal support outbox authority', () => {
  it('allows a current recurring occurrence and blocks it after onboarding authority is withdrawn', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-09T13:31:00.000Z'))
    const context = await createTempVaultContext(
      'assistant-weekly-goal-support-outbox-',
    )
    tempRoots.push(context.parentRoot)
    await initializeVault({ timezone: 'UTC', vaultRoot: context.vaultRoot })
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T18:15:00.000Z',
      reason: 'user_answered',
      vault: context.vaultRoot,
    })

    const automation = await upsertAutomation({
      activeUntil: null,
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Find one useful current goal-support gap.',
      now: new Date('2026-06-02T12:00:00.000Z'),
      route: {
        channel: 'telegram',
        deliveryTarget: 'telegram-chat',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        expression: '30 13 * * 2',
        kind: 'cron',
      },
      slug: 'onboarding-goal-checkin',
      status: 'active',
      summary: 'Weekly goal support check-in.',
      tags: [
        'assistant',
        'scheduled',
        'murph-managed',
        'goal-support',
      ],
      title: 'Weekly goal support check-in',
      vaultRoot: context.vaultRoot,
    })
    const queued = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'Want me to add that finite check-in package?',
      sessionId: 'session-weekly-goal-support',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-weekly-goal-support',
      vault: context.vaultRoot,
    })

    await expect(resolveAssistantOutboxAutomationAuthorityError({
      intent: queued.intent,
      vault: context.vaultRoot,
    })).resolves.toBeNull()

    await reopenAssistantOnboarding({
      reopenedAt: '2026-06-09T13:32:00.000Z',
      vault: context.vaultRoot,
    })
    await expect(resolveAssistantOutboxAutomationAuthorityError({
      intent: queued.intent,
      vault: context.vaultRoot,
    })).resolves.toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
  })
})
