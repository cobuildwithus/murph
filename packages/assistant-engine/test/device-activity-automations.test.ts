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
  sendAssistantNotificationLocal: vi.fn(),
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
    readVault: vi.fn(async () => {
      if (!deviceActivityMocks.readModel) {
        throw new Error('Missing mocked read model.')
      }
      return deviceActivityMocks.readModel
    }),
  }
})

vi.mock('../src/assistant-service.ts', () => ({
  sendAssistantNotificationLocal: deviceActivityMocks.sendAssistantNotificationLocal,
}))

import { runDeviceActivityTriggeredAutomations } from '../src/assistant/device-activity-automations.ts'
import { listCanonicalAssistantCronRecords } from '../src/assistant/cron/canonical-jobs.ts'

describe('device activity triggered automations', () => {
  beforeEach(() => {
    deviceActivityMocks.automations = []
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [],
      vaultRoot: '/vault',
    })
    deviceActivityMocks.sendAssistantNotificationLocal.mockReset()
    deviceActivityMocks.sendAssistantNotificationLocal.mockResolvedValue({
      delivered: true,
    })
    deviceActivityMocks.upsertAutomation.mockReset()
    deviceActivityMocks.upsertAutomation.mockResolvedValue({
      created: false,
    })
  })

  it('fires the first matching walk activity and archives the automation', async () => {
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
      runDeviceActivityTriggeredAutomations({
        deliveryDispatchMode: 'queue-only',
        vault: '/vault',
      }),
    ).resolves.toEqual({
      fired: 1,
      matched: 1,
    })

    expect(deviceActivityMocks.sendAssistantNotificationLocal).toHaveBeenCalledTimes(1)
    expect(deviceActivityMocks.sendAssistantNotificationLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'linq',
        deliveryDedupeToken: 'automation-device-activity|auto_walk|evt_walk|2026-06-07T12:00:00.000Z|walk',
        deliveryTarget: 'linq-target-walk',
        instructions: expect.stringContaining('Lunch walk'),
      }),
    )
    expect(deviceActivityMocks.upsertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'auto_walk',
        schedule: automation.schedule,
        status: 'archived',
        vaultRoot: '/vault',
      }),
    )
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
      runDeviceActivityTriggeredAutomations({
        vault: '/vault',
      }),
    ).resolves.toEqual({
      fired: 0,
      matched: 0,
    })

    expect(deviceActivityMocks.sendAssistantNotificationLocal).not.toHaveBeenCalled()
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

function createDeviceActivityAutomation(input: {
  activityKind?: 'walk'
  after: string
  source?: 'whoop' | 'whoop_v2'
}): AutomationQueryRecord {
  return {
    automationId: 'auto_walk',
    continuityPolicy: 'preserve',
    createdAt: '2026-06-07T10:00:00.000Z',
    docType: 'automation',
    instructions: 'Ask how the walk felt.',
    markdown: '',
    relativePath: 'bank/automations/after-walk.md',
    route: {
      channel: 'linq',
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
    slug: 'after-walk',
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
  title: string
  workoutType: string
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
      workout: {
        type: input.workoutType,
      },
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
