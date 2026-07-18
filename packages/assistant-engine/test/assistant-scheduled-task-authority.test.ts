import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { initializeVault, patchAutomation, upsertAutomation } from '@murphai/core'

import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  completePreparedOnboardingFollowup,
  prepareOnboardingFollowupScheduledTurn,
} from '../src/assistant/onboarding-followup-automation.js'
import {
  completeAssistantOnboarding,
  readAssistantOnboardingState,
} from '../src/assistant/onboarding-state.js'
import {
  executeScheduledOnboardingDynamicTool,
  MURPH_COMPLETE_ONBOARDING_TOOL,
  readScheduledOnboardingDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/scheduled-onboarding.js'
import {
  ASSISTANT_GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
  assertAssistantScheduledTaskSourceCurrent,
  resolveAssistantScheduledTaskAuthorityFromSource,
  type AssistantScheduledAutomationSource,
} from '../src/assistant/scheduled-task-authority.js'
import { upsertKnowledgePage } from '../src/knowledge.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })))
})

describe('scheduled task source authority', () => {
  it('recognizes only the exact reserved newsletter definition', () => {
    const source: AssistantScheduledAutomationSource = {
      activeUntil: null,
      assistantTargetOverride: null,
      automationId: 'automation_group_newsletter',
      continuityPolicy: 'fresh',
      instructions: 'Compose the weekly group newsletter.',
      schedule: { expression: '0 9 * * 1', kind: 'cron' },
      scheduledTask: null,
      slug: ASSISTANT_GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
      status: 'active',
      summary: null,
      supportKind: null,
      tags: ['assistant', 'scheduled'],
      title: 'Group newsletter',
      updatedAt: '2026-07-18T12:00:00.000Z',
    }

    expect(resolveAssistantScheduledTaskAuthorityFromSource(source)).toEqual({
      automationId: source.automationId,
      expectedUpdatedAt: source.updatedAt,
      kind: 'group_newsletter',
    })
    for (const mismatch of [
      { continuityPolicy: 'preserve' },
      { schedule: { kind: 'dailyLocal', localTime: '09:00' } },
      { supportKind: 'reminder' },
      { status: 'paused' },
      {
        scheduledTask: {
          kind: 'group_challenge',
          knowledgeSlug: 'newsletter-bypass',
          projectionScopeKey: 'steps-days.v0',
        },
      },
    ]) {
      expect(resolveAssistantScheduledTaskAuthorityFromSource({
        ...source,
        ...mismatch,
      })).toEqual({ kind: 'none' })
    }
  })

  it('mints group-challenge authority only for a bounded time schedule', () => {
    const source: AssistantScheduledAutomationSource = {
      activeUntil: '2026-07-20T12:00:00.000Z',
      assistantTargetOverride: null,
      automationId: 'automation_group_challenge',
      continuityPolicy: 'preserve',
      instructions: 'Compose the next challenge dispatch.',
      schedule: { kind: 'dailyLocal', localTime: '08:00' },
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: 'summer-steps',
        projectionScopeKey: 'steps-days.v0',
      },
      slug: 'summer-steps-dispatch',
      status: 'active',
      summary: null,
      supportKind: null,
      tags: [],
      title: 'Summer Steps dispatch',
      updatedAt: '2026-07-18T12:00:00.000Z',
    }

    expect(resolveAssistantScheduledTaskAuthorityFromSource(source)).toEqual({
      automationId: source.automationId,
      expectedUpdatedAt: source.updatedAt,
      kind: 'group_challenge',
      projectionScopeKey: 'steps-days.v0',
      slug: 'summer-steps',
    })
    expect(resolveAssistantScheduledTaskAuthorityFromSource({
      ...source,
      schedule: {
        after: '2026-07-18T12:00:00.000Z',
        kind: 'deviceActivity',
      },
    })).toEqual({ kind: 'none' })
  })

  it('rejects an otherwise-current source after activeUntil elapses', async () => {
    const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-scheduled-authority-'))
    tempRoots.push(vault)
    await initializeVault({
      createdAt: '2026-07-18T00:00:00.000Z',
      vaultRoot: vault,
    })
    const created = await upsertAutomation({
      activeUntil: '2026-07-19T00:00:00.000Z',
      continuityPolicy: 'fresh',
      instructions: 'Send one bounded scheduled note.',
      now: new Date('2026-07-18T00:00:00.000Z'),
      route: {
        channel: 'console',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: null,
        threadIsDirect: true,
      },
      schedule: { at: '2026-07-18T12:00:00.000Z', kind: 'at' },
      status: 'active',
      title: 'Bounded scheduled note',
      vaultRoot: vault,
    })
    const authority = {
      automationId: created.record.automationId,
      expectedUpdatedAt: created.record.updatedAt,
      kind: 'generic_notification',
    } as const

    vi.useFakeTimers()
    vi.setSystemTime('2026-07-18T23:59:59.999Z')
    await expect(assertAssistantScheduledTaskSourceCurrent({ authority, vault }))
      .resolves.toMatchObject({ kind: 'generic_notification' })

    vi.setSystemTime('2026-07-19T00:00:00.000Z')
    await expect(assertAssistantScheduledTaskSourceCurrent({ authority, vault }))
      .rejects.toMatchObject({ code: 'scheduled_task_source_changed' })
  })

  it('requires the exact bound challenge page to remain active', async () => {
    const vault = await createVault()
    await upsertKnowledgePage({
      body: '# Summer Steps\n\nCanonical challenge context.',
      pageType: 'challenge',
      slug: 'summer-steps',
      status: 'active',
      title: 'Summer Steps',
      vault,
    })
    const created = await upsertAutomation({
      activeUntil: '2026-07-20T12:00:00.000Z',
      continuityPolicy: 'preserve',
      instructions: 'Compose the next challenge dispatch.',
      now: new Date('2026-07-18T12:00:00.000Z'),
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'group-thread',
        threadIsDirect: false,
      },
      schedule: { kind: 'dailyLocal', localTime: '08:00' },
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: 'summer-steps',
        projectionScopeKey: 'steps-days.v0',
      },
      status: 'active',
      title: 'Summer Steps dispatch',
      vaultRoot: vault,
    })
    const authority = resolveAssistantScheduledTaskAuthorityFromSource(
      created.record,
    )
    if (authority.kind !== 'group_challenge') {
      throw new Error('Expected group-challenge authority.')
    }

    await expect(assertAssistantScheduledTaskSourceCurrent({ authority, vault }))
      .resolves.toMatchObject({ kind: 'group_challenge' })

    await upsertKnowledgePage({
      body: '# Other Challenge\n\nDifferent canonical challenge context.',
      pageType: 'challenge',
      slug: 'other-challenge',
      status: 'active',
      title: 'Other Challenge',
      vault,
    })
    await expect(assertAssistantScheduledTaskSourceCurrent({
      authority: {
        ...authority,
        slug: 'other-challenge',
      },
      vault,
    })).rejects.toMatchObject({ code: 'scheduled_task_source_changed' })

    await upsertKnowledgePage({
      body: '# Summer Steps\n\nCanonical challenge context.',
      pageType: 'challenge',
      slug: 'summer-steps',
      status: 'archived',
      title: 'Summer Steps',
      vault,
    })
    await expect(assertAssistantScheduledTaskSourceCurrent({ authority, vault }))
      .rejects.toMatchObject({ code: 'scheduled_challenge_not_active' })
  })
})

describe('scheduled onboarding source authority', () => {
  it('accepts only the bounded onboarding completion arguments', () => {
    expect(readScheduledOnboardingDynamicToolRequest({
      arguments: { reason: 'user_answered' },
      tool: MURPH_COMPLETE_ONBOARDING_TOOL.name,
    })).toEqual({
      kind: 'complete-onboarding',
      request: { reason: 'user_answered' },
    })
    for (const argumentsValue of [
      { automationId: 'model-selected', reason: 'user_answered' },
      { path: '.runtime/assistant/onboarding.json', reason: 'user_declined' },
      { reason: 'manual' },
    ]) {
      expect(readScheduledOnboardingDynamicToolRequest({
        arguments: argumentsValue,
        tool: MURPH_COMPLETE_ONBOARDING_TOOL.name,
      })).toMatchObject({
        kind: 'invalid-complete-onboarding-arguments',
      })
    }
  })

  it('completes through the exact prepared revision and rejects a stale one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-18T12:00:00.000Z')
    const request = readScheduledOnboardingDynamicToolRequest({
      arguments: { reason: 'user_answered' },
      tool: MURPH_COMPLETE_ONBOARDING_TOOL.name,
    })
    if (!request || request.kind !== 'complete-onboarding') {
      throw new Error('Expected a valid scheduled onboarding request.')
    }

    const successVault = await createVault()
    const successSource = await createOnboardingFollowupAutomation({
      activeUntil: '2026-07-19T00:00:00.000Z',
      vault: successVault,
    })
    const successPrepared = await prepareOnboardingFollowupScheduledTurn({
      automation: successSource,
      readDeviceAccounts: async () => [],
      vault: successVault,
    })
    if (
      successPrepared.kind !== 'continue' ||
      !('scheduledTaskAuthority' in successPrepared)
    ) {
      throw new Error('Expected exact onboarding follow-up authority.')
    }

    const completed = await executeScheduledOnboardingDynamicTool({
      authority: successPrepared.scheduledTaskAuthority,
      request,
      vaultRoot: successVault,
    })
    expect(completed.rpcResult.success).toBe(true)
    expect(readToolPayload(completed)).toMatchObject({
      completedReason: 'user_answered',
      status: 'completed',
    })
    await expect(readAssistantOnboardingState(successVault)).resolves
      .toMatchObject({
        completedReason: 'user_answered',
        status: 'completed',
      })

    const staleVault = await createVault()
    const staleSource = await createOnboardingFollowupAutomation({
      activeUntil: '2026-07-19T00:00:00.000Z',
      vault: staleVault,
    })
    const stalePrepared = await prepareOnboardingFollowupScheduledTurn({
      automation: staleSource,
      readDeviceAccounts: async () => [],
      vault: staleVault,
    })
    if (
      stalePrepared.kind !== 'continue' ||
      !('scheduledTaskAuthority' in stalePrepared)
    ) {
      throw new Error('Expected exact onboarding follow-up authority.')
    }
    await patchAutomation({
      instructions: `${staleSource.instructions}\nChanged after preparation.`,
      lookup: staleSource.automationId,
      now: new Date('2026-07-18T12:01:00.000Z'),
      vaultRoot: staleVault,
    })

    const rejected = await executeScheduledOnboardingDynamicTool({
      authority: stalePrepared.scheduledTaskAuthority,
      request,
      vaultRoot: staleVault,
    })
    expect(rejected.rpcResult.success).toBe(false)
    expect(readToolPayload(rejected)).toEqual({
      code: 'scheduled_onboarding_unauthorized',
    })
    await expect(readAssistantOnboardingState(staleVault)).resolves
      .toMatchObject({ status: 'open' })
  })

  it('does not prepare authority when activeUntil is omitted', async () => {
    const automation = buildOnboardingFollowupAutomation({ activeUntil: null })
    expect(Reflect.deleteProperty(automation, 'activeUntil')).toBe(true)

    await expect(prepareOnboardingFollowupScheduledTurn({
      automation,
      vault: 'unused-for-rejected-authority',
    })).resolves.toEqual({ kind: 'continue' })
  })

  it('does not prepare authority once activeUntil has elapsed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-19T00:00:00.000Z')

    await expect(prepareOnboardingFollowupScheduledTurn({
      automation: buildOnboardingFollowupAutomation({
        activeUntil: '2026-07-19T00:00:00.000Z',
      }),
      vault: 'unused-for-rejected-authority',
    })).resolves.toEqual({ kind: 'continue' })
  })

  it('rechecks activeUntil immediately before completing onboarding', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-18T23:59:59.999Z')
    const vault = await createVault()
    const created = await createOnboardingFollowupAutomation({
      activeUntil: '2026-07-19T00:00:00.000Z',
      vault,
    })
    const prepared = await prepareOnboardingFollowupScheduledTurn({
      automation: created,
      readDeviceAccounts: async () => [],
      vault,
    })
    expect(prepared).toMatchObject({
      kind: 'continue',
      scheduledTaskAuthority: {
        automationId: created.automationId,
        expectedUpdatedAt: created.updatedAt,
      },
    })

    vi.setSystemTime('2026-07-19T00:00:00.000Z')
    await expect(completePreparedOnboardingFollowup({
      automationId: created.automationId,
      expectedUpdatedAt: created.updatedAt,
      reason: 'user_answered',
      vault,
    })).rejects.toThrow('Scheduled onboarding authority is no longer current.')
    await expect(readAssistantOnboardingState(vault)).resolves.toMatchObject({
      status: 'open',
    })
  })

  it('returns the existing completion before looking up a stale source', async () => {
    const vault = await createVault()
    const completed = await completeAssistantOnboarding({
      completedAt: '2026-07-18T12:00:00.000Z',
      reason: 'user_answered',
      vault,
    })

    await expect(completePreparedOnboardingFollowup({
      automationId: 'missing-onboarding-followup',
      expectedUpdatedAt: '2026-07-18T11:00:00.000Z',
      reason: 'user_declined',
      vault,
    })).resolves.toEqual(completed)
  })
})

type OnboardingFollowupAutomationInput = Parameters<
  typeof prepareOnboardingFollowupScheduledTurn
>[0]['automation']

function buildOnboardingFollowupAutomation(input: {
  activeUntil: string | null
}): OnboardingFollowupAutomationInput {
  return {
    activeUntil: input.activeUntil,
    automationId: 'automation_onboarding_followup',
    continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
    instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
    schedule: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.schedule,
    scheduledTask: null,
    slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
    status: 'active',
    summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
    supportKind: null,
    tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
    title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    updatedAt: '2026-07-18T12:00:00.000Z',
  }
}

async function createVault(): Promise<string> {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-scheduled-authority-'))
  tempRoots.push(vault)
  await initializeVault({
    createdAt: '2026-07-18T00:00:00.000Z',
    vaultRoot: vault,
  })
  return vault
}

async function createOnboardingFollowupAutomation(input: {
  activeUntil: string | null
  vault: string
}) {
  const created = await upsertAutomation({
    activeUntil: input.activeUntil,
    continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
    instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
    now: new Date('2026-07-18T12:00:00.000Z'),
    route: {
      channel: 'console',
      deliverySource: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
      threadIsDirect: true,
    },
    schedule: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.schedule,
    slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
    status: 'active',
    summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
    tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
    title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    vaultRoot: input.vault,
  })
  return created.record
}

function readToolPayload(input: {
  rpcResult: { contentItems: Array<{ text: string }> }
}): unknown {
  const text = input.rpcResult.contentItems[0]?.text
  if (!text) {
    throw new Error('Expected tool result text.')
  }
  return JSON.parse(text) as unknown
}
