import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const coreMocks = vi.hoisted(() => ({
  listAutomations: vi.fn(),
  pauseAutomationsIfExactSnapshots: vi.fn(),
}))

vi.mock('@murphai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/core')>()
  return {
    ...actual,
    listAutomations: async (
      input: Parameters<typeof actual.listAutomations>[0],
    ) => await (
      coreMocks.listAutomations(input) ?? actual.listAutomations(input)
    ),
    pauseAutomationsIfExactSnapshots: async (
      input: Parameters<typeof actual.pauseAutomationsIfExactSnapshots>[0],
    ) => await (
      coreMocks.pauseAutomationsIfExactSnapshots(input) ??
        actual.pauseAutomationsIfExactSnapshots(input)
    ),
  }
})

import type { AutomationScheduledTask } from '@murphai/contracts'
import {
  initializeVault,
  showAutomation,
  upsertAutomation,
  type AutomationRecord,
} from '@murphai/core'

import {
  processDueAssistantCronJobsLocal,
  runAssistantCronJobNow,
} from '../src/assistant/cron.js'
import {
  assistantAutomationHasAmbiguousLinqAudience,
  ASSISTANT_GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
} from '../src/assistant/scheduled-task-authority.js'
import {
  pauseAmbiguousLinqAutomationsBeforeClaim,
} from '../src/assistant/ambiguous-linq-automation-cutover.js'

const tempRoots: string[] = []
const CREATED_AT = new Date('2026-07-18T12:00:00.000Z')
const PAUSED_AT = new Date('2026-07-18T13:00:00.000Z')

afterEach(async () => {
  coreMocks.listAutomations.mockReset()
  coreMocks.pauseAutomationsIfExactSnapshots.mockReset()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

describe('temporary ambiguous Linq automation cutover', () => {
  it('atomically pauses every ambiguous unbound group source and preserves typed or exact-owned sources', async () => {
    const vault = await createVault()
    const ordinary = await createAutomation(vault, {
      instructions: 'Prepare an ordinary group check-in.',
      title: 'Ordinary group check-in',
    })
    const historicalChallenge = await createAutomation(vault, {
      activeUntil: '2026-07-30T00:00:00.000Z',
      instructions: 'Prepare the next historical challenge dispatch.',
      title: 'Historical challenge',
    })
    const freshDigest = await createAutomation(vault, {
      continuityPolicy: 'fresh',
      instructions: 'Prepare a self-contained health digest.',
      title: 'Fresh health digest',
    })
    const direct = await createAutomation(vault, {
      instructions: 'Prepare a personal check-in.',
      threadIsDirect: true,
      title: 'Direct check-in',
    })
    const typedNotification = await createAutomation(vault, {
      instructions: 'Prepare a typed group check-in.',
      scheduledTask: { kind: 'group_notification' },
      title: 'Typed group check-in',
    })
    const typedHealth = await createAutomation(vault, {
      continuityPolicy: 'fresh',
      instructions: 'Prepare a typed health digest.',
      scheduledTask: { kind: 'group_health_update' },
      title: 'Typed health digest',
    })
    const typedChallenge = await createAutomation(vault, {
      activeUntil: '2026-07-30T00:00:00.000Z',
      instructions: 'Prepare a typed challenge dispatch.',
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: 'summer-steps',
        projectionScopeKey: 'steps-days.v0',
      },
      title: 'Typed challenge',
    })
    const newsletter = await createAutomation(vault, {
      continuityPolicy: 'fresh',
      instructions: 'Prepare the exact managed newsletter.',
      schedule: { expression: '0 9 * * 1', kind: 'cron' },
      slug: ASSISTANT_GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
      title: 'Group newsletter',
    })

    expect(assistantAutomationHasAmbiguousLinqAudience(ordinary))
      .toBe(true)
    expect(assistantAutomationHasAmbiguousLinqAudience(direct))
      .toBe(false)
    expect(assistantAutomationHasAmbiguousLinqAudience(typedHealth))
      .toBe(false)
    expect(assistantAutomationHasAmbiguousLinqAudience(newsletter))
      .toBe(false)

    await expect(pauseAmbiguousLinqAutomationsBeforeClaim({
      now: PAUSED_AT,
      vault,
    })).resolves.toBeUndefined()

    for (const record of [ordinary, historicalChallenge, freshDigest]) {
      await expectStatus(vault, record, 'paused')
    }
    for (const record of [
      direct,
      typedNotification,
      typedHealth,
      typedChallenge,
      newsletter,
    ]) {
      await expectStatus(vault, record, 'active')
    }
  })

  it('does not apply the candidate cap to unrelated active automations', async () => {
    const vault = await createVault()
    const unrelated = await createAutomation(vault, {
      instructions: 'Prepare a personal check-in.',
      threadIsDirect: true,
      title: 'Direct check-in',
    })
    coreMocks.listAutomations.mockResolvedValueOnce({
      count: 4_097,
      items: createInventoryRecords(unrelated, 4_097),
    })

    await expect(pauseAmbiguousLinqAutomationsBeforeClaim({ vault }))
      .resolves.toBeUndefined()

    expect(coreMocks.listAutomations).toHaveBeenCalledWith({
      status: 'active',
      vaultRoot: vault,
    })
    expect(coreMocks.listAutomations.mock.calls[0]?.[0]).not.toHaveProperty(
      'limit',
    )
    await expectStatus(vault, unrelated, 'active')
  })

  it('fails closed when the structurally filtered candidate set exceeds the transition cap', async () => {
    const vault = await createVault()
    const ambiguous = await createAutomation(vault, {
      instructions: 'Prepare the scheduled group note.',
      title: 'Scheduled group note',
    })
    coreMocks.listAutomations.mockResolvedValueOnce({
      count: 4_097,
      items: createInventoryRecords(ambiguous, 4_097),
    })

    await expect(pauseAmbiguousLinqAutomationsBeforeClaim({ vault }))
      .rejects.toMatchObject({
        code: 'ASSISTANT_AMBIGUOUS_LINQ_AUTOMATION_CANDIDATE_LIMIT',
      })
    await expectStatus(vault, ambiguous, 'active')
  })

  it('fails closed when any exact snapshot changes before the atomic pause', async () => {
    const vault = await createVault()
    const ambiguous = await createAutomation(vault, {
      instructions: 'Prepare the scheduled group note.',
      title: 'Scheduled group note',
    })
    coreMocks.pauseAutomationsIfExactSnapshots.mockResolvedValueOnce({
      paused: false,
    })

    await expect(pauseAmbiguousLinqAutomationsBeforeClaim({ vault }))
      .rejects.toMatchObject({
        code: 'ASSISTANT_AMBIGUOUS_LINQ_AUTOMATION_PAUSE_RACED',
      })
    await expectStatus(vault, ambiguous, 'active')
  })

  it('pauses ambiguous records before due-job projection', async () => {
    const vault = await createVault()
    const ambiguous = await createAutomation(vault, {
      instructions: 'Prepare the scheduled group note.',
      title: 'Scheduled group note',
    })

    await expect(processDueAssistantCronJobsLocal({ vault })).resolves.toEqual({
      failed: 0,
      processed: 0,
      succeeded: 0,
    })
    await expectStatus(vault, ambiguous, 'paused')
  })

  it('denies a manual claim after preflight pauses the ambiguous source', async () => {
    const vault = await createVault()
    const ambiguous = await createAutomation(vault, {
      instructions: 'Prepare a manually requested group note.',
      title: 'Manual group note',
    })

    await expect(runAssistantCronJobNow({
      executionContext: {
        hosted: {
          memberId: 'member-group-cutover',
          resolveScheduledLinqRoute: async () => ({
            target: 'group-chat',
            threadIsDirect: false,
          }),
          userEnvKeys: [],
        },
      },
      job: ambiguous.automationId,
      vault,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_AMBIGUOUS_LINQ_AUTOMATION_RECREATION_REQUIRED',
    })
    await expectStatus(vault, ambiguous, 'paused')
  })
})

async function createVault(): Promise<string> {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-ambiguous-linq-'))
  tempRoots.push(vault)
  await initializeVault({
    createdAt: CREATED_AT.toISOString(),
    vaultRoot: vault,
  })
  return vault
}

function createInventoryRecords(
  template: AutomationRecord,
  count: number,
): AutomationRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    automationId: `${template.automationId}_${index}`,
    slug: `${template.slug}-${index}`,
  }))
}

async function createAutomation(
  vault: string,
  input: {
    activeUntil?: string | null
    continuityPolicy?: 'fresh' | 'preserve'
    instructions: string
    schedule?:
      | { expression: string; kind: 'cron' }
      | { kind: 'dailyLocal'; localTime: string }
    scheduledTask?: AutomationScheduledTask
    slug?: string
    threadIsDirect?: boolean
    title: string
  },
): Promise<AutomationRecord> {
  return (await upsertAutomation({
    ...(input.activeUntil === undefined
      ? {}
      : { activeUntil: input.activeUntil }),
    continuityPolicy: input.continuityPolicy ?? 'preserve',
    instructions: input.instructions,
    now: CREATED_AT,
    route: {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'group-chat',
      identityId: null,
      participantId: null,
      threadId: 'group-chat',
      threadIsDirect: input.threadIsDirect ?? false,
    },
    schedule: input.schedule ?? { kind: 'dailyLocal', localTime: '08:00' },
    ...(input.scheduledTask ? { scheduledTask: input.scheduledTask } : {}),
    ...(input.slug ? { slug: input.slug } : {}),
    status: 'active',
    title: input.title,
    vaultRoot: vault,
  })).record
}

async function expectStatus(
  vault: string,
  automation: AutomationRecord,
  status: 'active' | 'paused',
): Promise<void> {
  await expect(showAutomation({
    automationId: automation.automationId,
    vaultRoot: vault,
  })).resolves.toMatchObject({ status })
}
