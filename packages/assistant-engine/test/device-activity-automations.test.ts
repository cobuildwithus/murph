import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  afterEach,
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
  advanceAutomationDeviceActivityCursor: vi.fn(),
  automations: [] as AutomationQueryRecord[],
  readModel: null as VaultReadModel | null,
}))

vi.mock('@murphai/core', () => ({
  advanceAutomationDeviceActivityCursor: deviceActivityMocks.advanceAutomationDeviceActivityCursor,
  loadVault: vi.fn(async () => ({
    metadata: {
      timezone: 'UTC',
    },
  })),
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
import {
  readAssistantCronStore,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'

describe('device activity triggered automations', () => {
  let vaultRoot: string

  beforeEach(async () => {
    vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-activity-'))
    deviceActivityMocks.automations = []
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [],
      vaultRoot,
    })
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockReset()
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockResolvedValue({
      advanced: true,
    })
  })

  afterEach(async () => {
    await rm(vaultRoot, { recursive: true, force: true })
  })

  it('schedules the first matching walk activity for assistant delivery', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'walk',
      after: '2026-06-07T11:00:00.000Z',
      source: 'whoop',
      tags: [
        'system:assistant-device-activity-parent:auto_other',
        'system:assistant-device-activity-occurrence:stale_occurrence',
        'user-visible',
      ],
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
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:01:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:01:00.000Z',
      scheduled: 1,
    })

    const jobs = await readQueuedCronJobs(vaultRoot)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        keepAfterRun: true,
        prompt: expect.stringContaining('Lunch walk'),
        schedule: {
          kind: 'at',
          at: '2026-06-07T12:01:00.000Z',
        },
        tags: expect.arrayContaining(['system:assistant-require-send']),
      }),
    )
    expect(jobs[0]?.tags).toContain('user-visible')
    expect(jobs[0]?.tags).toContain('system:assistant-device-activity-parent:auto_walk')
    expect(jobs[0]?.tags).not.toContain('system:assistant-device-activity-parent:auto_other')
    expect(jobs[0]?.tags).not.toContain('system:assistant-device-activity-occurrence:stale_occurrence')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:00:00.000Z',
        afterOccurredAt: '2026-06-07T12:00:00.000Z',
        afterEntityId: 'evt_walk',
        expectedActivityKind: 'walk',
        expectedSource: 'whoop',
        lookup: 'auto_walk',
        vaultRoot,
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
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T13:01:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 3,
      nextWakeAt: '2026-06-07T13:01:00.000Z',
      scheduled: 3,
    })

    const scheduled = await readQueuedCronJobs(vaultRoot)
    expect(scheduled).toHaveLength(3)
    expect(scheduled[0]?.prompt).toContain('Kind: basketball')
    expect(scheduled[0]?.prompt).toContain('Pickup basketball')
    expect(scheduled[1]?.prompt).toContain('Kind: dancing')
    expect(scheduled[1]?.prompt).toContain('Dance class')
    expect(scheduled[2]?.prompt).toContain('Kind: surf')
    expect(scheduled[2]?.prompt).toContain('Morning surf')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledTimes(3)
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
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:01:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 2,
      nextWakeAt: '2026-06-07T12:01:00.000Z',
      scheduled: 2,
    })

    const scheduled = await readQueuedCronJobs(vaultRoot)
    expect(scheduled).toHaveLength(2)
    expect(scheduled[0]?.prompt).toContain('Kind: sleep')
    expect(scheduled[0]?.prompt).toContain('Junction sleep')
    expect(scheduled[1]?.prompt).toContain('Kind: sleep-cycle')
    expect(scheduled[1]?.prompt).toContain('Junction sleep')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: 'auto_sleep',
      }),
    )
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
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:06:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:06:00.000Z',
      scheduled: 1,
    })

    const [job] = await readQueuedCronJobs(vaultRoot)
    expect(job).toEqual(
      expect.objectContaining({
        prompt: expect.stringContaining('Recorded at: 2026-06-07T12:05:00.000Z'),
        schedule: {
          kind: 'at',
          at: '2026-06-07T12:06:00.000Z',
        },
      }),
    )
    const instructions = job?.prompt ?? ''
    expect(instructions).toContain('Occurred at: 2026-06-07T11:30:00.000Z')
    expect(instructions).toContain('Late imported ride')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:05:00.000Z',
        afterOccurredAt: '2026-06-07T11:30:00.000Z',
        afterEntityId: 'evt_late_import',
        expectedActivityKind: 'workout',
        expectedSource: undefined,
        lookup: 'auto_workout',
        vaultRoot,
      }),
    )
  })

  it('queues the next matching activity for a listener and leaves an immediate wake for later matches', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T11:00:00.000Z',
        automationId: 'auto_run',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_1',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Morning run',
          workoutType: 'Running',
        }),
        createActivityEntity({
          entityId: 'evt_run_2',
          occurredAt: '2026-06-07T13:00:00.000Z',
          title: 'Afternoon run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T13:01:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T13:01:00.000Z',
      scheduled: 1,
    })

    const scheduled = await readQueuedCronJobs(vaultRoot)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.prompt).toContain('Morning run')
    expect(scheduled[0]?.prompt).not.toContain('Afternoon run')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledTimes(1)
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:00:00.000Z',
        afterOccurredAt: '2026-06-07T12:00:00.000Z',
        afterEntityId: 'evt_run_1',
        expectedActivityKind: 'run',
        expectedSource: undefined,
        lookup: 'auto_run',
        vaultRoot,
      }),
    )
  })

  it('queues later same-trigger activity ids without duplicating already advanced cursor ids', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:00:00.000Z',
        automationId: 'auto_run',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_a',
          occurredAt: '2026-06-07T12:01:00.000Z',
          recordedAt: '2026-06-07T12:05:00.000Z',
          title: 'First imported run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:06:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:06:00.000Z',
      scheduled: 1,
    })
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:05:00.000Z',
        afterOccurredAt: '2026-06-07T12:01:00.000Z',
        afterEntityId: 'evt_run_a',
        expectedActivityKind: 'run',
        expectedSource: undefined,
        lookup: 'auto_run',
        vaultRoot,
      }),
    )

    const firstJobId = (await readQueuedCronJobs(vaultRoot))[0]?.jobId
    await markQueuedCronJobsConsumed(vaultRoot, '2026-06-07T12:06:30.000Z', (job) => ({
      ...job,
      target: {
        ...job.target,
        sessionId: 'asst_existing',
      },
    }))

    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:05:00.000Z',
        afterEntityIds: ['evt_run_a'],
        automationId: 'auto_run',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_a',
          occurredAt: '2026-06-07T12:01:00.000Z',
          recordedAt: '2026-06-07T12:05:00.000Z',
          title: 'First imported run',
          workoutType: 'Running',
        }),
        createActivityEntity({
          entityId: 'evt_run_b',
          occurredAt: '2026-06-07T12:03:00.000Z',
          recordedAt: '2026-06-07T12:05:00.000Z',
          title: 'Second imported run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockClear()

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:07:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:07:00.000Z',
      scheduled: 1,
    })

    const scheduled = await readQueuedCronJobs(vaultRoot)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.jobId).toBe(firstJobId)
    expect(scheduled[0]?.prompt).not.toContain('First imported run')
    expect(scheduled[0]?.prompt).toContain('Second imported run')
    expect(scheduled[0]?.target.sessionId).toBe('asst_existing')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:05:00.000Z',
        afterOccurredAt: '2026-06-07T12:03:00.000Z',
        afterEntityId: 'evt_run_b',
        expectedActivityKind: 'run',
        expectedSource: undefined,
        lookup: 'auto_run',
        vaultRoot,
      }),
    )
  })

  it('clears retained continuity when the listener route changes before the next occurrence', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:00:00.000Z',
        automationId: 'auto_run',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_a',
          occurredAt: '2026-06-07T12:01:00.000Z',
          recordedAt: '2026-06-07T12:05:00.000Z',
          title: 'First imported run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })

    await scheduleDeviceActivityTriggeredAutomations({
      now: () => '2026-06-07T12:06:00.000Z',
      vault: vaultRoot,
    })
    await markQueuedCronJobsConsumed(vaultRoot, '2026-06-07T12:06:30.000Z', (job) => ({
      ...job,
      target: {
        ...job.target,
        sessionId: 'asst_existing',
      },
    }))

    deviceActivityMocks.automations = [
      {
        ...createDeviceActivityAutomation({
          activityKind: 'run',
          after: '2026-06-07T12:05:00.000Z',
          afterEntityIds: ['evt_run_a'],
          automationId: 'auto_run',
          instructions: 'Report run progress.',
        }),
        route: {
          channel: 'linq',
          deliverySource: null,
          deliveryTarget: 'linq-target-new',
          identityId: null,
          participantId: null,
          threadId: null,
        },
      },
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_b',
          occurredAt: '2026-06-07T12:03:00.000Z',
          recordedAt: '2026-06-07T12:05:00.000Z',
          title: 'Second imported run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:07:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:07:00.000Z',
      scheduled: 1,
    })

    const [scheduled] = await readQueuedCronJobs(vaultRoot)
    expect(scheduled?.target.deliveryTarget).toBe('linq-target-new')
    expect(scheduled?.target.sessionId).toBeNull()
  })

  it('does not recreate a consumed deterministic occurrence after a listener cursor patch failure', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:00:00.000Z',
        automationId: 'auto_run',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_consumed',
          occurredAt: '2026-06-07T12:05:00.000Z',
          title: 'Consumed run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockRejectedValueOnce(new Error('cursor write failed'))

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:06:00.000Z',
        vault: vaultRoot,
      }),
    ).rejects.toThrow('cursor write failed')

    const [queued] = await readQueuedCronJobs(vaultRoot)
    expect(queued?.prompt).toContain('Consumed run')
    await markQueuedCronJobsConsumed(vaultRoot, '2026-06-07T12:06:30.000Z')
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockClear()

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:07:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:07:00.000Z',
      scheduled: 0,
    })

    const retainedJobs = await readQueuedCronJobs(vaultRoot)
    expect(retainedJobs).toHaveLength(1)
    expect(retainedJobs[0]?.enabled).toBe(false)
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:05:00.000Z',
        afterOccurredAt: '2026-06-07T12:05:00.000Z',
        afterEntityId: 'evt_run_consumed',
        expectedActivityKind: 'run',
        expectedSource: undefined,
        lookup: 'auto_run',
        vaultRoot,
      }),
    )
  })

  it('bounds activity handoff to one queued occurrence per listener pass', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:00:00.000Z',
        automationId: 'auto_run',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: Array.from({ length: 26 }, (_, index) =>
        createActivityEntity({
          entityId: `evt_run_${String(index).padStart(2, '0')}`,
          occurredAt: `2026-06-07T12:${String(index + 1).padStart(2, '0')}:00.000Z`,
          title: `Run ${index}`,
          workoutType: 'Running',
        })
      ),
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:30:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:30:00.000Z',
      scheduled: 1,
    })

    const scheduled = await readQueuedCronJobs(vaultRoot)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.prompt).toContain('Run 0')
    expect(scheduled[0]?.prompt).not.toContain('Run 1')
    expect(scheduled[0]?.prompt).not.toContain('Run 25')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:01:00.000Z',
        afterOccurredAt: '2026-06-07T12:01:00.000Z',
        afterEntityId: 'evt_run_00',
        expectedActivityKind: 'run',
        expectedSource: undefined,
        lookup: 'auto_run',
        vaultRoot,
      }),
    )
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
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 0,
      nextWakeAt: '2026-06-07T12:02:00.000Z',
      scheduled: 0,
    })

    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).not.toHaveBeenCalled()
  })

  it('returns an assistant wake for a due local device activity occurrence', async () => {
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
          entityId: 'evt_walk',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Lunch walk',
          workoutType: 'walking',
        }),
      ],
      vaultRoot,
    })

    await scheduleDeviceActivityTriggeredAutomations({
      now: () => '2026-06-07T12:01:00.000Z',
      vault: vaultRoot,
    })
    deviceActivityMocks.automations = []
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [],
      vaultRoot,
    })
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockReset()

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:02:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 0,
      nextWakeAt: '2026-06-07T12:02:00.000Z',
      scheduled: 0,
    })

    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).not.toHaveBeenCalled()
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
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })

    expect(await readQueuedCronJobs(vaultRoot)).toEqual([])
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).not.toHaveBeenCalled()
  })

  it('does not project device activity automations into assistant cron jobs', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        after: '2026-06-07T11:00:00.000Z',
        source: 'whoop',
      }),
    ]

    await expect(listCanonicalAssistantCronRecords(vaultRoot)).resolves.toEqual([])
  })
})

async function readQueuedCronJobs(vaultRoot: string) {
  const store = await readAssistantCronStore(resolveAssistantStatePaths(vaultRoot))
  return store.jobs
}

async function markQueuedCronJobsConsumed(
  vaultRoot: string,
  timestamp: string,
  update?: (job: Awaited<ReturnType<typeof readQueuedCronJobs>>[number]) =>
    Awaited<ReturnType<typeof readQueuedCronJobs>>[number],
) {
  const paths = resolveAssistantStatePaths(vaultRoot)
  const store = await readAssistantCronStore(paths)
  await writeAssistantCronStore(paths, {
    ...store,
    jobs: store.jobs.map((job) => {
      const updated = update?.(job) ?? job
      return {
        ...updated,
        enabled: false,
        updatedAt: timestamp,
        state: {
          ...updated.state,
          nextRunAt: null,
          lastRunAt: timestamp,
          lastSucceededAt: timestamp,
          runningAt: null,
          runningPid: null,
        },
      }
    }),
  })
}

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
  afterEntityIds?: string[]
  automationId?: string
  instructions?: string
  source?: 'whoop' | 'whoop_v2'
  tags?: string[]
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
      ...(input.afterEntityIds ? { afterEntityIds: input.afterEntityIds } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.activityKind ? { activityKind: input.activityKind } : {}),
    },
    schemaVersion: 'murph.frontmatter.automation.v1',
    slug: automationId,
    status: 'active',
    summary: null,
    tags: input.tags ?? [],
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
