import { createHash } from 'node:crypto'
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
import { assistantCronJobSchema } from '@murphai/operator-config/assistant-cli-contracts'
import {
  appendAssistantDeviceActivityCronJobMetadata,
  readAssistantDeviceActivityCronJobMetadata,
} from '../src/assistant/device-activity-cron-tags.ts'

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
    listAutomations: vi.fn(async (
      _vault: string,
      options?: { status?: readonly string[] },
    ) => {
      const allowed = options?.status
      return allowed
        ? deviceActivityMocks.automations.filter((record) =>
            allowed.includes(record.status)
          )
        : deviceActivityMocks.automations
    }),
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
        'system:assistant-device-activity-authority:stale_authority',
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
        keepAfterRun: false,
        prompt: expect.stringContaining('Lunch walk'),
        schedule: {
          kind: 'at',
          at: '2026-06-07T12:01:00.000Z',
        },
      }),
    )
    const metadata = readAssistantDeviceActivityCronJobMetadata(jobs[0]?.name ?? '')
    expect(metadata).toEqual({
      authorityKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      occurrenceKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      parentAutomationId: 'auto_walk',
      parentAutomationRelativePath: 'bank/automations/auto_walk.md',
    })
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

  it('does not schedule later activity for an archived parent automation', async () => {
    deviceActivityMocks.automations = [{
      ...createDeviceActivityAutomation({
        activityKind: 'walk',
        after: '2026-06-07T11:00:00.000Z',
        source: 'whoop',
      }),
      status: 'archived',
    }]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_walk_after_archive',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Walk after archive',
          workoutType: 'walking',
        }),
      ],
      vaultRoot,
    })

    await expect(scheduleDeviceActivityTriggeredAutomations({
      now: () => '2026-06-07T12:01:00.000Z',
      vault: vaultRoot,
    })).resolves.toEqual({
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })
    expect(await readQueuedCronJobs(vaultRoot)).toEqual([])
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).not.toHaveBeenCalled()
  })

  it('preserves the saved conversation route on generated activity notifications', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'running',
      after: '2026-06-07T11:00:00.000Z',
      automationId: 'auto_hosted_group_run',
    })
    automation.route = {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'linq-hosted-group',
      identityId: 'hosted-identity',
      participantId: 'hosted-participant',
      threadId: 'hosted-thread',
      threadIsDirect: false,
    }
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_hosted_group_run',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Group run',
          workoutType: 'running',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:01:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      matched: 1,
      scheduled: 1,
    })

    const jobs = await readQueuedCronJobs(vaultRoot)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.target).toMatchObject({
      channel: 'linq',
      deliveryTarget: 'linq-hosted-group',
      identityId: 'hosted-identity',
      participantId: 'hosted-participant',
      threadId: 'hosted-thread',
      threadIsDirect: false,
    })
  })

  it('matches device activity from any provider when source is omitted', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'run',
      after: '2026-06-07T11:00:00.000Z',
      automationId: 'auto_run_any_provider',
      instructions: 'Ask how the run felt.',
    })
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_garmin_run',
          externalRefResourceType: 'garmin/activity_session',
          externalRefSystem: 'garmin',
          occurredAt: '2026-06-07T12:00:00.000Z',
          sourceProviderSlug: 'garmin',
          title: 'Morning run',
          workoutType: 'running',
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

    expect(await readQueuedCronJobs(vaultRoot)).toHaveLength(1)
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:00:00.000Z',
        afterEntityId: 'evt_garmin_run',
        afterOccurredAt: '2026-06-07T12:00:00.000Z',
        expectedActivityKind: 'run',
        expectedSource: undefined,
        lookup: 'auto_run_any_provider',
        vaultRoot,
      }),
    )
  })

  it('matches activity kind from sportName-only device sessions', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'running',
      after: '2026-06-07T11:00:00.000Z',
      automationId: 'auto_run_sport_name',
      instructions: 'Ask how the run felt.',
    })
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_sport_name_run',
          occurredAt: '2026-06-07T12:00:00.000Z',
          sportName: 'Run',
          title: 'Imported workout',
          workoutType: null,
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
    expect(jobs[0]?.prompt).toContain('Kind: running')
    expect(jobs[0]?.prompt).toContain('Imported workout')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:00:00.000Z',
        afterEntityId: 'evt_sport_name_run',
        afterOccurredAt: '2026-06-07T12:00:00.000Z',
        expectedActivityKind: 'running',
        expectedSource: undefined,
        lookup: 'auto_run_sport_name',
        vaultRoot,
      }),
    )
  })

  it('matches cardio automations to cycling activity but not strength sessions', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'cardio',
      after: '2026-06-07T11:00:00.000Z',
      automationId: 'auto_cardio',
      instructions: 'Ask how the cardio session felt.',
    })
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_cardio_strength',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Bike strength warmup',
          workoutType: 'strength',
        }),
        createActivityEntity({
          entityId: 'evt_cardio_cycling',
          occurredAt: '2026-06-07T12:30:00.000Z',
          title: 'Lunch ride',
          workoutType: 'cycling',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:31:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:31:00.000Z',
      scheduled: 1,
    })

    const jobs = await readQueuedCronJobs(vaultRoot)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.prompt).toContain('Kind: cardio')
    expect(jobs[0]?.prompt).toContain('Lunch ride')
    expect(jobs[0]?.prompt).not.toContain('Bike strength warmup')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:30:00.000Z',
        afterEntityId: 'evt_cardio_cycling',
        afterOccurredAt: '2026-06-07T12:30:00.000Z',
        expectedActivityKind: 'cardio',
        expectedSource: undefined,
        lookup: 'auto_cardio',
        vaultRoot,
      }),
    )
  })

  it('uses activity titles as a fallback only when structured kind is absent', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'running',
        after: '2026-06-07T11:00:00.000Z',
        automationId: 'auto_run_title_fallback',
        instructions: 'Ask how the run felt.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_title_only_run',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Morning run',
          workoutType: null,
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
    expect(jobs[0]?.prompt).toContain('Morning run')
    expect(jobs[0]?.prompt).toContain('Kind: running')
  })

  it('keeps explicit whoop device activity automations scoped to whoop providers', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T11:00:00.000Z',
        source: 'whoop',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_garmin_run',
          externalRefResourceType: 'garmin/activity_session',
          externalRefSystem: 'garmin',
          occurredAt: '2026-06-07T12:00:00.000Z',
          sourceProviderSlug: 'garmin',
          title: 'Morning run',
          workoutType: 'running',
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
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })

    expect(await readQueuedCronJobs(vaultRoot)).toEqual([])
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).not.toHaveBeenCalled()
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

  it('attaches parent authority for fresh listener occurrences without preserving a session', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T11:00:00.000Z',
        automationId: 'auto_fresh_run',
        continuityPolicy: 'fresh',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run',
          occurredAt: '2026-06-07T12:00:00.000Z',
          title: 'Fresh run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:01:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      matched: 1,
      scheduled: 1,
    })

    const [queued] = await readQueuedCronJobs(vaultRoot)
    expect(readAssistantDeviceActivityCronJobMetadata(queued?.name ?? '')).toEqual({
      authorityKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      occurrenceKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      parentAutomationId: 'auto_fresh_run',
      parentAutomationRelativePath: 'bank/automations/auto_fresh_run.md',
    })
    expect(queued?.target.sessionId).toBeNull()
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

  it('suppresses a backfilled sleep session that ended more than a day before the sync', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'sleep',
        after: '2026-06-05T00:00:00.000Z',
        automationId: 'auto_sleep',
        instructions: 'Ask about sleep consistency.',
        source: 'whoop_v2',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createSleepEntity({
          endAt: '2026-06-05T14:00:00.000Z',
          entityId: 'evt_sleep_stale',
          occurredAt: '2026-06-05T06:00:00.000Z',
          startAt: '2026-06-05T06:00:00.000Z',
          title: 'Backfilled sleep',
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
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })

    expect(await readQueuedCronJobs(vaultRoot)).toHaveLength(0)
  })

  it('suppresses a backfilled workout that occurred more than a day before the sync', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'workout',
        after: '2026-06-05T00:00:00.000Z',
        automationId: 'auto_workout',
        instructions: 'Ask about the imported workout.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_workout_stale',
          occurredAt: '2026-06-05T06:00:00.000Z',
          recordedAt: '2026-06-07T12:05:00.000Z',
          title: 'Backfilled ride',
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
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })

    expect(await readQueuedCronJobs(vaultRoot)).toHaveLength(0)
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

  it('queues every matching activity for a listener up to the pass cap', async () => {
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
      matched: 2,
      nextWakeAt: '2026-06-07T13:01:00.000Z',
      scheduled: 2,
    })

    const scheduled = await readQueuedCronJobs(vaultRoot)
    expect(scheduled).toHaveLength(2)
    expect(scheduled[0]?.prompt).toContain('Morning run')
    expect(scheduled[1]?.prompt).toContain('Afternoon run')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledTimes(2)
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
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T13:00:00.000Z',
        afterOccurredAt: '2026-06-07T13:00:00.000Z',
        afterEntityId: 'evt_run_2',
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
        afterOccurredAt: '2026-06-07T12:01:00.000Z',
        afterEntityId: 'evt_run_a',
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
    expect(scheduled[0]?.jobId).not.toBe(firstJobId)
    expect(scheduled[0]?.prompt).not.toContain('First imported run')
    expect(scheduled[0]?.prompt).toContain('Second imported run')
    expect(scheduled[0]?.target.sessionId).toBeNull()
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
          afterOccurredAt: '2026-06-07T12:01:00.000Z',
          afterEntityId: 'evt_run_a',
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

  it('rolls back a newly queued occurrence after a listener cursor patch failure', async () => {
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

    await expect(readQueuedCronJobs(vaultRoot)).resolves.toEqual([])
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

    const queuedJobs = await readQueuedCronJobs(vaultRoot)
    expect(queuedJobs).toHaveLength(1)
    expect(queuedJobs[0]?.enabled).toBe(true)
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

  it('repairs legacy already-queued device activity jobs before rewriting authority keys', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'run',
      after: '2026-06-07T12:00:00.000Z',
      automationId: 'auto_run_legacy_queued',
      instructions: 'Report run progress.',
    })
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_legacy_queued',
          occurredAt: '2026-06-07T12:05:00.000Z',
          title: 'Legacy queued run',
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

    const [queued] = await readQueuedCronJobs(vaultRoot)
    if (!queued) {
      throw new Error('Expected queued device activity occurrence.')
    }
    const metadata = readAssistantDeviceActivityCronJobMetadata(queued.name)
    if (!metadata) {
      throw new Error('Expected queued device activity metadata.')
    }
    const legacyQueued = assistantCronJobSchema.parse({
      ...queued,
      name: appendAssistantDeviceActivityCronJobMetadata(
        'Legacy queued run',
        {
          ...metadata,
          authorityKey: buildLegacyDeviceActivityAuthorityKey(automation),
        },
      ),
      updatedAt: '2026-06-07T12:06:30.000Z',
    })
    await writeAssistantCronStore(resolveAssistantStatePaths(vaultRoot), {
      version: 1,
      jobs: [legacyQueued],
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
      scheduled: 0,
    })

    expect(await readQueuedCronJobs(vaultRoot)).toEqual([legacyQueued])
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledOnce()
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:05:00.000Z',
        afterOccurredAt: '2026-06-07T12:05:00.000Z',
        afterEntityId: 'evt_run_legacy_queued',
        expectedActivityKind: 'run',
        lookup: 'auto_run_legacy_queued',
        vaultRoot,
      }),
    )

    await markQueuedCronJobsConsumed(vaultRoot, '2026-06-07T12:07:30.000Z')
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:05:00.000Z',
        afterOccurredAt: '2026-06-07T12:05:00.000Z',
        afterEntityId: 'evt_run_legacy_queued',
        automationId: 'auto_run_legacy_queued',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockClear()
    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:08:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })
    await expect(readQueuedCronJobs(vaultRoot)).resolves.toEqual([])
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).not.toHaveBeenCalled()
  })

  it('keeps already-queued device activity jobs covered after target-only edits', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'run',
      after: '2026-06-07T12:00:00.000Z',
      assistantTargetOverride: {
        reasoningEffort: 'low',
      },
      automationId: 'auto_run_target_edit_queued',
      instructions: 'Report run progress.',
    })
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_target_edit_queued',
          occurredAt: '2026-06-07T12:05:00.000Z',
          title: 'Target edit queued run',
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

    const queuedBeforeEdit = await readQueuedCronJobs(vaultRoot)
    automation.assistantTargetOverride = {
      reasoningEffort: 'high',
    }
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

    expect(await readQueuedCronJobs(vaultRoot)).toEqual(queuedBeforeEdit)
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledOnce()
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:05:00.000Z',
        afterOccurredAt: '2026-06-07T12:05:00.000Z',
        afterEntityId: 'evt_run_target_edit_queued',
        expectedActivityKind: 'run',
        lookup: 'auto_run_target_edit_queued',
        vaultRoot,
      }),
    )
  })

  it('restores a replaced occurrence slot after a listener cursor patch failure', async () => {
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:00:00.000Z',
        automationId: 'auto_run_replace_rollback',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_replace_rollback',
          occurredAt: '2026-06-07T12:05:00.000Z',
          title: 'Rollback slot run',
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

    const paths = resolveAssistantStatePaths(vaultRoot)
    const [queued] = await readQueuedCronJobs(vaultRoot)
    if (!queued) {
      throw new Error('Expected queued device activity occurrence.')
    }
    const staleJob = assistantCronJobSchema.parse({
      ...queued,
      enabled: false,
      prompt: 'Stale preserved job.',
      state: {
        ...queued.state,
        nextRunAt: null,
        pendingDeliveryIntentId: null,
        runningAt: null,
        runningPid: null,
      },
      updatedAt: '2026-06-07T12:06:30.000Z',
    })
    await writeAssistantCronStore(paths, {
      version: 1,
      jobs: [staleJob],
    })

    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockClear()
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockRejectedValueOnce(
      new Error('cursor write failed after replace'),
    )

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:07:00.000Z',
        vault: vaultRoot,
      }),
    ).rejects.toThrow('cursor write failed after replace')

    await expect(readQueuedCronJobs(vaultRoot)).resolves.toEqual([staleJob])
  })

  it('rolls back a newly queued occurrence when the listener cursor refuses to advance', async () => {
    const automation = createDeviceActivityAutomation({
      activityKind: 'run',
      after: '2026-06-07T12:00:00.000Z',
      automationId: 'auto_run_stale_slot',
      instructions: 'Report run progress.',
    })
    deviceActivityMocks.automations = [automation]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_stale_slot',
          occurredAt: '2026-06-07T12:05:00.000Z',
          title: 'Stale slot run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockResolvedValueOnce({
      advanced: false,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:06:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 0,
      nextWakeAt: null,
      scheduled: 0,
    })

    await expect(readQueuedCronJobs(vaultRoot)).resolves.toEqual([])

    deviceActivityMocks.automations = [{
      ...automation,
      instructions: 'Report run progress with the edited route.',
    }]
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
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledTimes(1)
  })

  it('does not recreate a consumed occurrence when the same activity is rescored later', async () => {
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
          entityId: 'evt_run_rescored',
          occurredAt: '2026-06-07T12:05:00.000Z',
          recordedAt: '2026-06-07T12:10:00.000Z',
          title: 'Rescored run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:11:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      matched: 1,
      scheduled: 1,
    })

    await markQueuedCronJobsConsumed(vaultRoot, '2026-06-07T12:11:30.000Z')
    deviceActivityMocks.advanceAutomationDeviceActivityCursor.mockClear()
    deviceActivityMocks.automations = [
      createDeviceActivityAutomation({
        activityKind: 'run',
        after: '2026-06-07T12:10:00.000Z',
        afterOccurredAt: '2026-06-07T12:05:00.000Z',
        afterEntityId: 'evt_run_rescored',
        automationId: 'auto_run',
        instructions: 'Report run progress.',
      }),
    ]
    deviceActivityMocks.readModel = createVaultReadModel({
      entities: [
        createActivityEntity({
          entityId: 'evt_run_rescored',
          occurredAt: '2026-06-07T12:05:00.000Z',
          recordedAt: '2026-06-07T12:30:00.000Z',
          title: 'Rescored run',
          workoutType: 'Running',
        }),
      ],
      vaultRoot,
    })

    await expect(
      scheduleDeviceActivityTriggeredAutomations({
        now: () => '2026-06-07T12:31:00.000Z',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      matched: 1,
      nextWakeAt: '2026-06-07T12:31:00.000Z',
      scheduled: 1,
    })

    const queuedJobs = await readQueuedCronJobs(vaultRoot)
    expect(queuedJobs).toHaveLength(1)
    expect(queuedJobs[0]?.enabled).toBe(true)
    expect(queuedJobs[0]?.prompt).toContain('Recorded at: 2026-06-07T12:30:00.000Z')
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:30:00.000Z',
        afterOccurredAt: '2026-06-07T12:05:00.000Z',
        afterEntityId: 'evt_run_rescored',
        lookup: 'auto_run',
        vaultRoot,
      }),
    )
  })

  it('bounds activity handoff to the queued occurrence cap per listener pass', async () => {
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
      matched: 25,
      nextWakeAt: '2026-06-07T12:30:00.000Z',
      scheduled: 25,
    })

    const scheduled = await readQueuedCronJobs(vaultRoot)
    expect(scheduled).toHaveLength(25)
    expect(scheduled[0]?.prompt).toContain('Run 0')
    expect(scheduled[1]?.prompt).toContain('Run 1')
    expect(scheduled[24]?.prompt).toContain('Run 24')
    expect(scheduled.some((job) => job.prompt.includes('Run 25'))).toBe(false)
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
    expect(deviceActivityMocks.advanceAutomationDeviceActivityCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        after: '2026-06-07T12:25:00.000Z',
        afterOccurredAt: '2026-06-07T12:25:00.000Z',
        afterEntityId: 'evt_run_24',
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
    jobs: store.jobs.flatMap((job) => {
      const updated = update?.(job) ?? job
      const consumed = {
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
      return updated.keepAfterRun ? [consumed] : []
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
  afterEntityId?: string
  afterOccurredAt?: string
  assistantTargetOverride?: AutomationQueryRecord['assistantTargetOverride']
  automationId?: string
  continuityPolicy?: 'fresh' | 'preserve'
  instructions?: string
  source?: 'whoop' | 'whoop_v2'
  tags?: string[]
}): AutomationQueryRecord {
  const automationId = input.automationId ?? 'auto_walk'
  return {
    activeUntil: null,
    automationId,
    assistantTargetOverride: input.assistantTargetOverride ?? null,
    continuityPolicy: input.continuityPolicy ?? 'preserve',
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
      ...(input.afterOccurredAt ? { afterOccurredAt: input.afterOccurredAt } : {}),
      ...(input.afterEntityId ? { afterEntityId: input.afterEntityId } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.activityKind ? { activityKind: input.activityKind } : {}),
    },
    schemaVersion: 'murph.frontmatter.automation.v1',
    scheduledReply: null,
    slug: automationId,
    status: 'active',
    summary: null,
    supportKind: null,
    plannedOccurrenceOffsetMs: null,
    tags: input.tags ?? [],
    title: 'After walk',
    updatedAt: '2026-06-07T10:00:00.000Z',
  }
}

function buildLegacyDeviceActivityAuthorityKey(
  automation: AutomationQueryRecord,
): string {
  if (automation.schedule.kind !== 'deviceActivity') {
    throw new Error('Expected device activity automation.')
  }

  return createHash('sha256')
    .update(JSON.stringify({
      activityKind: automation.schedule.activityKind ?? null,
      automationId: automation.automationId,
      continuityPolicy: automation.continuityPolicy,
      instructions: automation.instructions,
      route: automation.route,
      source: automation.schedule.source ?? null,
    }))
    .digest('hex')
    .slice(0, 40)
}

function createActivityEntity(input: {
  entityId: string
  externalRefResourceType?: string
  externalRefSystem?: string
  occurredAt: string
  recordedAt?: string
  sourceProviderSlug?: string
  sportName?: string
  title: string
  workoutSport?: Record<string, string>
  workoutType?: string | null
}): CanonicalEntity {
  return {
    attributes: {
      dataOrigin: {
        sourceProviderSlug: input.sourceProviderSlug ?? 'junction',
      },
      durationMinutes: 32,
      externalRef: {
        resourceType: input.externalRefResourceType ?? 'whoop_v2/activity_session',
        system: input.externalRefSystem ?? 'junction',
      },
      ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
      ...(input.sportName ? { sportName: input.sportName } : {}),
      ...(input.workoutSport
        ? { workout: { sport: input.workoutSport } }
        : input.workoutType === null
          ? {}
          : { workout: { type: input.workoutType ?? 'activity' } }),
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
  endAt?: string
  entityId: string
  occurredAt: string
  startAt?: string
  title: string
}): CanonicalEntity {
  return {
    attributes: {
      dataOrigin: {
        sourceProviderSlug: 'junction',
      },
      durationMinutes: 420,
      endAt: input.endAt ?? input.occurredAt,
      externalRef: {
        resourceType: 'junction-whoop-v2-sleep',
        system: 'junction',
      },
      recordedAt: input.occurredAt,
      startAt: input.startAt ?? '2026-06-07T04:00:00.000Z',
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
