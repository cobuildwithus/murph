import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import {
  initializeVault,
  parseAutomationAvailabilityConflictBlock,
  patchAutomation,
  showAutomation,
  shouldSkipAutomationOccurrenceForAvailability,
  splitAutomationAvailabilityConflictBlock,
  upsertAutomation,
} from '@murphai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listMurphDynamicToolNames,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  refreshReminderAvailability,
} from '../src/assistant/reminder-availability-maintenance.js'
import {
  getAssistantCronJob,
} from '../src/assistant/cron.js'
import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'
import { createTempVaultContext } from './test-helpers.js'

const tempRoots: string[] = []
const REMINDER_AUTOMATION_ID = 'automation_01K5A7B9C2D4E6F8G0H1J3K5MN'
const BASE_INSTRUCTIONS = [
  'Send one flexible reminder.',
  'Availability conflict policy: skip-when-busy',
  'Availability source policy: calendar-only',
  'Availability calendar account: googlecalendar / calendar-account',
].join('\n')
const DIRECT_ROUTE = {
  channel: 'linq',
  deliveryTarget: 'direct-thread',
  identityId: null,
  participantId: null,
  threadId: null,
  threadIsDirect: true,
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  )
})

describe('reminder availability maintenance', () => {
  it('has no model-facing maintenance tool', () => {
    expect(listMurphDynamicToolNames()).not.toContain('murph.maintenance')
  })

  it('refreshes one exact account and persists only normalized busy timestamps', async () => {
    const vaultRoot = await createVaultRoot()
    await createReminder({ vaultRoot })
    const connectedRequest = vi.fn(async () => ({
      result: {
        data: {
          items: [
            {
              description: 'Untrusted private notes',
              end: { dateTime: '2026-07-30T15:00:00.000Z' },
              start: { dateTime: '2026-07-30T14:00:00.000Z' },
              summary: 'Private meeting title',
            },
          ],
        },
      },
    }))

    await expect(refreshReminderAvailability({
      connectedApps: { request: connectedRequest },
      now: new Date('2026-07-30T00:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      attempted: 1,
      failed: 0,
      nextRefreshAt: '2026-07-30T23:00:00.000Z',
      refreshed: 1,
    })
    expect(connectedRequest).toHaveBeenCalledWith({
      input: {
        account: 'calendar-account',
        arguments: {
          calendarId: 'primary',
          maxResults: 256,
          orderBy: 'startTime',
          showDeleted: false,
          singleEvents: true,
          timeMax: '2026-08-06T00:00:00.000Z',
          timeMin: '2026-07-30T00:00:00.000Z',
        },
        toolSlug: 'GOOGLECALENDAR_EVENTS_LIST',
      },
      operation: 'execute',
    }, {
      signal: null,
    })

    const stored = await requireReminder(vaultRoot)
    expect(stored.instructions).not.toContain('Private meeting title')
    expect(stored.instructions).not.toContain('Untrusted private notes')
    const { block } = splitAutomationAvailabilityConflictBlock(
      stored.instructions,
    )
    expect(block).not.toBeNull()
    expect(parseAutomationAvailabilityConflictBlock(block ?? '')).toEqual({
      busyIntervals: [{
        end: '2026-07-30T15:00:00.000Z',
        start: '2026-07-30T14:00:00.000Z',
      }],
      expiresAt: '2026-08-06T00:00:00.000Z',
      generatedAt: '2026-07-30T00:00:00.000Z',
    })
  })

  it('refreshes an empty freshness lease before its 24-hour delivery limit', async () => {
    const vaultRoot = await createVaultRoot()
    await createReminder({ vaultRoot })
    const connectedRequest = vi.fn(async () => ({
      result: { data: { items: [] } },
    }))

    await refreshReminderAvailability({
      connectedApps: { request: connectedRequest },
      now: new Date('2026-07-30T00:00:00.000Z'),
      vaultRoot,
    })
    await expect(refreshReminderAvailability({
      connectedApps: { request: connectedRequest },
      now: new Date('2026-07-30T22:59:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      attempted: 0,
      failed: 0,
      nextRefreshAt: '2026-07-30T23:00:00.000Z',
      refreshed: 0,
    })
    await expect(refreshReminderAvailability({
      connectedApps: { request: connectedRequest },
      now: new Date('2026-07-30T23:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      attempted: 1,
      failed: 0,
      nextRefreshAt: '2026-07-31T22:00:00.000Z',
      refreshed: 1,
    })

    expect(connectedRequest).toHaveBeenCalledTimes(2)
    const stored = await requireReminder(vaultRoot)
    const { block } = splitAutomationAvailabilityConflictBlock(
      stored.instructions,
    )
    expect(parseAutomationAvailabilityConflictBlock(block ?? '')).toMatchObject({
      busyIntervals: [],
      generatedAt: '2026-07-30T23:00:00.000Z',
    })
  })

  it('preserves an every schedule cadence across availability-only refreshes', async () => {
    const vaultRoot = await createVaultRoot()
    await createReminder({
      schedule: { everyMs: 48 * 60 * 60 * 1_000, kind: 'every' },
      vaultRoot,
    })

    await expect(
      getAssistantCronJob(vaultRoot, REMINDER_AUTOMATION_ID),
    ).resolves.toMatchObject({
      state: { nextRunAt: '2026-07-31T12:00:00.000Z' },
    })

    await refreshReminderAvailability({
      connectedApps: {
        request: vi.fn(async () => ({ result: { data: { items: [] } } })),
      },
      now: new Date('2026-07-30T00:00:00.000Z'),
      vaultRoot,
    })

    await expect(
      getAssistantCronJob(vaultRoot, REMINDER_AUTOMATION_ID),
    ).resolves.toMatchObject({
      state: { nextRunAt: '2026-07-31T12:00:00.000Z' },
    })
  })

  it('keeps a weekly weekend conflict covered with deterministic pre-expiry wakes', async () => {
    const vaultRoot = await createVaultRoot()
    await createReminder({
      schedule: { expression: '0 15 * * 0', kind: 'cron' },
      vaultRoot,
    })
    const connectedRequest = vi.fn(async () => ({
      result: {
        data: {
          items: [{
            end: { dateTime: '2026-08-02T16:00:00.000Z' },
            start: { dateTime: '2026-08-02T15:00:00.000Z' },
          }],
        },
      },
    }))

    for (const [now, nextRefreshAt] of [
      ['2026-07-31T03:00:00.000Z', '2026-08-01T02:00:00.000Z'],
      ['2026-08-01T02:00:00.000Z', '2026-08-02T01:00:00.000Z'],
      ['2026-08-02T01:00:00.000Z', '2026-08-03T00:00:00.000Z'],
    ] as const) {
      await expect(refreshReminderAvailability({
        connectedApps: { request: connectedRequest },
        now: new Date(now),
        vaultRoot,
      })).resolves.toEqual({
        attempted: 1,
        failed: 0,
        nextRefreshAt,
        refreshed: 1,
      })
    }

    const reminder = await requireReminder(vaultRoot)
    expect(shouldSkipAutomationOccurrenceForAvailability({
      instructions: reminder.instructions,
      occurrenceAt: '2026-08-02T15:00:00.000Z',
      scheduleKind: reminder.schedule.kind,
    })).toBe(true)
  })

  it('uses the fixed Outlook request and accepts explicit UTC datetimes', async () => {
    const vaultRoot = await createVaultRoot()
    await createReminder({
      instructions: BASE_INSTRUCTIONS.replace(
        'googlecalendar / calendar-account',
        'outlook / outlook-account',
      ),
      vaultRoot,
    })
    const connectedRequest = vi.fn(async () => ({
      result: {
        data: {
          value: [{
            bodyPreview: 'Untrusted private notes',
            end: {
              dateTime: '2026-07-30T16:00:00.000',
              timeZone: 'UTC',
            },
            showAs: 'busy',
            start: {
              dateTime: '2026-07-30T15:00:00.000',
              timeZone: 'UTC',
            },
            subject: 'Private appointment',
          }],
        },
      },
    }))

    await expect(refreshReminderAvailability({
      connectedApps: { request: connectedRequest },
      now: new Date('2026-07-30T00:00:00.000Z'),
      vaultRoot,
    })).resolves.toMatchObject({
      failed: 0,
      refreshed: 1,
    })
    expect(connectedRequest).toHaveBeenCalledWith({
      input: {
        account: 'outlook-account',
        arguments: {
          endDateTime: '2026-08-06T00:00:00.000Z',
          startDateTime: '2026-07-30T00:00:00.000Z',
        },
        toolSlug: 'OUTLOOK_GET_CALENDAR_VIEW',
      },
      operation: 'execute',
    }, {
      signal: null,
    })
    const stored = await requireReminder(vaultRoot)
    expect(stored.instructions).not.toContain('Private appointment')
    expect(stored.instructions).toContain(
      '- 2026-07-30T15:00:00.000Z / 2026-07-30T16:00:00.000Z',
    )
  })

  it('keeps prior state when provider data is partial or the reminder changes', async () => {
    const partialVaultRoot = await createVaultRoot()
    await createReminder({ vaultRoot: partialVaultRoot })
    await expect(refreshReminderAvailability({
      connectedApps: {
        request: vi.fn(async () => ({
          result: {
            data: {
              items: [],
              nextPageToken: 'another-page',
            },
          },
        })),
      },
      now: new Date('2026-07-30T00:00:00.000Z'),
      vaultRoot: partialVaultRoot,
    })).resolves.toEqual({
      attempted: 1,
      failed: 1,
      nextRefreshAt: '2026-07-30T23:00:00.000Z',
      refreshed: 0,
    })
    const partialReminder = await requireReminder(partialVaultRoot)
    expect(partialReminder.instructions).toBe(BASE_INSTRUCTIONS)
    expect(shouldSkipAutomationOccurrenceForAvailability({
      instructions: partialReminder.instructions,
      occurrenceAt: '2026-07-30T16:00:00.000Z',
      scheduleKind: partialReminder.schedule.kind,
    })).toBe(false)

    const changedVaultRoot = await createVaultRoot()
    await createReminder({ vaultRoot: changedVaultRoot })
    await expect(refreshReminderAvailability({
      connectedApps: {
        request: vi.fn(async () => {
          await patchAutomation({
            instructions: `${BASE_INSTRUCTIONS}\nKeep this concurrent edit.`,
            lookup: REMINDER_AUTOMATION_ID,
            now: new Date('2026-07-30T00:00:01.000Z'),
            vaultRoot: changedVaultRoot,
          })
          return { result: { data: { items: [] } } }
        }),
      },
      now: new Date('2026-07-30T00:00:00.000Z'),
      vaultRoot: changedVaultRoot,
    })).resolves.toEqual({
      attempted: 1,
      failed: 1,
      nextRefreshAt: '2026-07-30T23:00:00.000Z',
      refreshed: 0,
    })
    expect((await requireReminder(changedVaultRoot)).instructions).toContain(
      'Keep this concurrent edit.',
    )
  })

  it('ignores fixed, group, expired, and runtime-maintenance automations', async () => {
    const vaultRoot = await createVaultRoot()
    await createReminder({
      automationId: 'automation_01K5A7B9C2D4E6F8G0H1J3K5MP',
      instructions: BASE_INSTRUCTIONS.replace(
        'Availability conflict policy: skip-when-busy',
        'Availability conflict policy: fixed',
      ),
      vaultRoot,
    })
    await createReminder({
      automationId: 'automation_01K5A7B9C2D4E6F8G0H1J3K5MQ',
      route: { ...DIRECT_ROUTE, threadIsDirect: false },
      vaultRoot,
    })
    await createReminder({
      activeUntil: '2026-07-29T00:00:00.000Z',
      automationId: 'automation_01K5A7B9C2D4E6F8G0H1J3K5MR',
      vaultRoot,
    })
    await createReminder({
      automationId: 'automation_01K5A7B9C2D4E6F8G0H1J3K5MS',
      tags: ['runtime-maintenance'],
      vaultRoot,
    })
    await createReminder({
      automationId: 'automation_01K5A7B9C2D4E6F8G0H1J3K5MT',
      schedule: { at: '2026-07-30T16:00:00.000Z', kind: 'at' },
      vaultRoot,
    })
    const connectedRequest = vi.fn()

    await expect(refreshReminderAvailability({
      connectedApps: { request: connectedRequest },
      now: new Date('2026-07-30T00:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      attempted: 0,
      failed: 0,
      nextRefreshAt: null,
      refreshed: 0,
    })
    expect(connectedRequest).not.toHaveBeenCalled()
  })

  it('keeps ordinary reminder repair guidance user-facing and fail-open', async () => {
    const layers = buildAssistantSystemPromptLayers(createPromptInput())
    expect(layers.stableRouteCapabilityPrompt).not.toContain(
      'Availability calendar account: <toolkit> / <account-id>',
    )
    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'behavior-followthrough',
        'SKILL.md',
      ),
      'utf8',
    )
    expect(skill).toContain('### Repair a mistimed interruption')
    expect(skill).toContain('treat it as feedback about the')
    expect(skill).toContain('Availability conflict policy: skip-when-busy')
    expect(skill).toContain(
      'Availability calendar account: <toolkit> / <account-id>',
    )
    expect(skill).toContain('policy in the background, usually within a day')
    expect(skill).toMatch(/the reminder sends\s+normally until one succeeds/u)
  })
})

async function createVaultRoot(): Promise<string> {
  const context = await createTempVaultContext(
    'reminder-availability-maintenance-',
  )
  tempRoots.push(context.parentRoot)
  await initializeVault({ vaultRoot: context.vaultRoot })
  return context.vaultRoot
}

async function createReminder(input: {
  activeUntil?: string | null
  automationId?: string
  instructions?: string
  route?: typeof DIRECT_ROUTE
  schedule?:
    | { at: string; kind: 'at' }
    | { expression: string; kind: 'cron' }
    | { everyMs: number; kind: 'every' }
  tags?: string[]
  vaultRoot: string
}): Promise<void> {
  const automationId = input.automationId ?? REMINDER_AUTOMATION_ID
  await upsertAutomation({
    ...(input.activeUntil === undefined
      ? {}
      : { activeUntil: input.activeUntil }),
    automationId,
    continuityPolicy: 'fresh',
    instructions: input.instructions ?? BASE_INSTRUCTIONS,
    now: new Date('2026-07-29T12:00:00.000Z'),
    route: input.route ?? DIRECT_ROUTE,
    schedule: input.schedule ?? { kind: 'dailyLocal', localTime: '16:00' },
    slug: `reminder-${automationId.slice(-2).toLowerCase()}`,
    status: 'active',
    tags: input.tags ?? [],
    title: automationId,
    vaultRoot: input.vaultRoot,
  })
}

async function requireReminder(vaultRoot: string) {
  const reminder = await showAutomation({
    automationId: REMINDER_AUTOMATION_ID,
    vaultRoot,
  })
  if (!reminder) {
    throw new Error('Expected reminder fixture.')
  }
  return reminder
}

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    assistantHostedAutomationAvailable: true,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantHostedLabsAvailable: false,
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-07-30',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    ...overrides,
  }
}
