import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  createVaultReadModel,
  type AutomationQueryRecord,
  type CanonicalEntity,
  type VaultReadModel,
} from '@murphai/query'

const deviceActivityMocks = vi.hoisted(() => ({
  automations: [] as AutomationQueryRecord[],
  readModel: null as VaultReadModel | null,
  upsertAutomation: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  loadVault: vi.fn(async () => ({
    metadata: {
      timezone: 'UTC',
    },
  })),
  upsertAutomation: deviceActivityMocks.upsertAutomation,
}))

vi.mock('@murphai/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/query')>()
  return {
    ...actual,
    listAutomations: vi.fn(async () => deviceActivityMocks.automations),
    listScheduledLogs: vi.fn(async () => []),
    readVaultRawTolerant: vi.fn(async () => {
      if (!deviceActivityMocks.readModel) {
        throw new Error('Missing mocked read model.')
      }
      return deviceActivityMocks.readModel
    }),
  }
})

import { scheduleDeviceActivityTriggeredAutomations } from '../src/assistant/device-activity-automations.ts'
import { listCanonicalAssistantCronRecords } from '../src/assistant/cron/canonical-jobs.ts'

describe('device activity triggered automations', () => {
  beforeEach(() => {
    deviceActivityMocks.automations = []
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [],
      vaultRoot: '/vault',
    })
    deviceActivityMocks.upsertAutomation.mockReset()
    deviceActivityMocks.upsertAutomation.mockResolvedValue({
      created: false,
    })
  })

  it('schedules the first matching walk activity for assistant delivery', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'walk',
      after: '2026-06-07T11:00:00.000Z',
      source: 'whoop',
    })
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_strength',
          occurredAt: '2026-06-07T11:30:00.000Z',
          title: 'Strength',
          workoutType: 'strength',
        }),
        createActivityEntity({
          entityId: 'evt_walk',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Lunch walk',
          workoutType: 'walking',
        }),
      ],
      vaultRoot: '/vault',
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:01:00.000Z',
        vault: '/vault',
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:01:00.000Z',
      scheduled: 1,
    })

    expect(deviceActivityMocks.upsertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'auto_walk',
        instructions: expect.stringContaining('Lunch walk'),
        schedule: {
          kind: 'at',
          at: '2026-06-07T12:01:00.000Z',
        },
        status: 'active',
        tags: ['system:assistant-require-send'],
        vaultRoot: '/vault',
      }),
    )
  })

  it('schedules arbitrary sport activity kinds from device sessions', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'basketball',
        after: '2026-06-07T11:00:00.000Z',
        automationId: 'auto_basketball',
        instructions: 'Ask about the basketball session.',
      }),
      createDeviceActivityAutomation({
        activityKind: 'dancing',
        after: '2026-06-07T11:00:00.000Z',
        automationId: 'auto_dancing',
        instructions: 'Ask about dancing.',
      }),
      createDeviceActivityAutomation({
        activityKind: 'surf',
        after: '2026-06-07T11:00:00.000Z',
        automationId: 'auto_surf',
        instructions: 'Ask about the surf.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_basketball',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Pickup basketball',
          workoutType: 'Basketball',
        }),
        createActivityEntity({
          entityId: 'evt_dance',
          occurredAt: '2026-06-07T12:30:00.000Z',
          title: 'Dance class',
          workoutType: 'Dance',
        }),
        createActivityEntity({
          entityId: 'evt_surfing',
          occurredAt: '2026-06-07T13:00:00.000Z',
          title: 'Morning surf',
          workoutSport: {
            name: 'Surfing',
            slug: 'surfing',
          },
        }),
      ],
      vaultRoot: '/vault',
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T13:01:00.000Z',
        vault: '/vault',
      }),
    ).resolves.toEqual({
      matched: 3,
      nextWakeAt: '2026-06-07T13:01:00.000Z',
      scheduled: 3,
    })

    const scheduled = deviceActivityMocks.upsertAutomation.mock.calls.map(([input]) => input)
    expect(scheduled.map((input) => input.automationId)).toEqual([
      'auto_basketball',
      'auto_dancing',
      'auto_surf',
    ])
    expect(scheduled[0]?.instructions).toContain('Kind: basketball')
    expect(scheduled[0]?.instructions).toContain('Pickup basketball')
    expect(scheduled[1]?.instructions).toContain('Kind: dancing')
    expect(scheduled[1]?.instructions).toContain('Dance class')
    expect(scheduled[2]?.instructions).toContain('Kind: surf')
    expect(scheduled[2]?.instructions).toContain('Morning surf')
  })

  it('schedules WHOOP sleep sessions when the activity kind is sleep or a sleep alias', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'sleep',
        after: '2026-06-07T06:00:00.000Z',
        automationId: 'auto_sleep',
        instructions: 'Ask about sleep consistency.',
        source: 'whoop_v2',
      }),
      createDeviceActivityAutomation({
        activityKind: 'sleep-cycle',
        after: '2026-06-07T06:00:00.000Z',
        automationId: 'auto_sleep_cycle',
        instructions: 'Ask about the sleep cycle.',
        source: 'whoop_v2',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createSleepEntity({
          entityId: 'evt_sleep',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Junction sleep',
        }),
      ],
      vaultRoot: '/vault',
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:01:00.000Z',
        vault: '/vault',
      }),
    ).resolves.toEqual({
      matched: 2,
      nextWakeAt: '2026-06-07T12:01:00.000Z',
      scheduled: 2,
    })

    expect(deviceActivityMocks.upsertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'auto_sleep',
        instructions: expect.stringContaining('Kind: sleep'),
        schedule: {
          kind: 'at',
          at: '2026-06-07T12:01:00.000Z',
        },
        status: 'active',
      }),
    )
    const scheduled = deviceActivityMocks.upsertAutomation.mock.calls.map(([input]) => input)
    expect(scheduled.map((input) => input.automationId)).toEqual(['auto_sleep', 'auto_sleep_cycle'])
    expect(scheduled[0]?.instructions).toContain('Junction sleep')
    expect(scheduled[1]?.instructions).toContain('Kind: sleep-cycle')
    expect(scheduled[1]?.instructions).toContain('Junction sleep')
  })

  it('uses the recorded import time for trigger windows and accepts workout selectors', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'workout',
        after: '2026-06-07T12:00:00.000Z',
        automationId: 'auto_workout',
        instructions: 'Ask about the imported workout.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_late_import',
          occurredAt: '2026-06-07T11:30:00.000Z',
          recordedAt: '2026-06-07T12:05:00.000Z',
          title: 'Late imported ride',
          workoutType: 'Cycling',
        }),
      ],
      vaultRoot: '/vault',
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:06:00.000Z',
        vault: '/vault',
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:06:00.000Z',
      scheduled: 1,
    })

    expect(deviceActivityMocks.upsertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'auto_workout',
        instructions: expect.stringContaining('Recorded at: 2026-06-07T12:05:00.000Z'),
        schedule: {
          kind: 'at',
          at: '2026-06-07T12:06:00.000Z',
        },
      }),
    )
    const instructions = deviceActivityMocks.upsertAutomation.mock.calls[0]?.[0].instructions
    expect(instructions).toContain('Occurred at: 2026-06-07T11:30:00.000Z')
    expect(instructions).toContain('Late imported ride')
  })

  it('returns an assistant wake for an already due activity reminder handoff', async () => {
    deviceActivityMocks.automations = [
      createDueRequireSendAutomation({
        at: '2026-06-07T12:01:00.000Z',
      }),
    ]

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:02:00.000Z',
        vault: '/vault',
      }),
    ).resolves.toEqual({
      matched: 0,
      nextWakeAt: '2026-06-07T12:02:00.000Z',
      scheduled: 0,
    })

    expect(deviceActivityMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('does not fire when a walk filter only sees non-walk activity', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'walk',
        after: '2026-06-07T11:00:00.000Z',
        source: 'whoop',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_strength',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Strength',
          workoutType: 'strength',
        }),
      ],
      vaultRoot: '/vault',
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        vault: '/vault',
      }),
    ).resolves.toEqual({
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })

    expect(deviceActivityMocks.upsertAutomation).not.toHaveBeenCalled()
  })

  it('does not project device activity automations into assistant cron jobs', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        after: '2026-06-07T11:00:00.000Z',
        source: 'whoop',
      }),
    ]

    await expect(listCanonicalAssistantCronRecords('/vault')).resolves.toEqual([])
  })
})

function createDueRequireSendAutomation(input: {
  at: string
}): AutomationQueryRecord {
  return {
    ...createDeviceActivityAutomation({
      after: '2026-06-07T11:00:00.000Z',
    }),
    schedule: {
      kind: 'at',
      at: input.at,
    },
    tags: ['system:assistant-require-send'],
  }
}

function createDeviceActivityAutomation(input: {
  activityKind?: string
  after: string
  automationId?: string
  instructions?: string
  source?: 'whoop' | 'whoop_v2'
}): AutomationQueryRecord {
  const automationId = input.automationId ?? 'auto_walk'
  return {
    automationId,
    continuityPolicy: 'preserve',
    createdAt: '2026-06-07T10:00:00.000Z',
    docType: 'automation',
    instructions: input.instructions ?? 'Ask how the walk felt.',
    markdown: '',
    relativePath: `bank/automations/${automationId}.md`,
    route: {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'linq-target-walk',
      identityId: null,
      participantId: null,
      threadId: null,
    },
    schedule: {
      kind: 'deviceActivity',
      after: input.after,
      ...(input.source ? { source: input.source } : {}),
      ...(input.activityKind ? { activityKind: input.activityKind } : {}),
    },
    schemaVersion: 'murph.frontmatter.automation.v1',
    slug: automationId,
    status: 'active',
    summary: null,
    tags: [],
    title: 'After walk',
    updatedAt: '2026-06-07T10:00:00.000Z',
  }
}

function createActivityEntity(input: {
  entityId: string
  occurredAt: string
  recordedAt?: string
  title: string
  workoutSport?: Record<string, string>
  workoutType?: string
}): CanonicalEntity {
  return {
    attributes: {
      dataOrigin: {
        sourceProviderSlug: 'junction',
      },
      durationMinutes: 32,
      externalRef: {
        resourceType: 'whoop_v2/activity_session',
        system: 'junction',
      },
      ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
      workout: input.workoutSport
        ? { sport: input.workoutSport }
        : { type: input.workoutType ?? 'activity' },
    },
    body: null,
    date: '2026-06-07',
    entityId: input.entityId,
    experimentSlug: null,
    family: 'event',
    frontmatter: null,
    kind: 'activity_session',
    links: [],
    lookupIds: [input.entityId],
    occurredAt: input.occurredAt,
    path: `ledger/events/2026/2026-06.jsonl#${input.entityId}`,
    primaryLookupId: input.entityId,
    recordClass: 'ledger',
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: input.title,
  }
}

function createSleepEntity(input: {
  entityId: string
  occurredAt: string
  title: string
}): CanonicalEntity {
  return {
    attributes: {
      dataOrigin: {
        sourceProviderSlug: 'junction',
      },
      durationMinutes: 420,
      externalRef: {
        resourceType: 'junction-whoop-v2-sleep',
        system: 'junction',
      },
      recordedAt: input.occurredAt,
      startAt: '2026-06-07T04:00:00.000Z',
    },
    body: null,
    date: '2026-06-07',
    entityId: input.entityId,
    experimentSlug: null,
    family: 'event',
    frontmatter: null,
    kind: 'sleep_session',
    links: [],
    lookupIds: [input.entityId],
    occurredAt: input.occurredAt,
    path: `ledger/events/2026/2026-06.jsonl#${input.entityId}`,
    primaryLookupId: input.entityId,
    recordClass: 'ledger',
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: input.title,
  }
}
