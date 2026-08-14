import { readFile, rm } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AssistantCronJob,
  AssistantCronSchedule,
  AssistantCronTarget,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  CanonicalAutomationAssistantCronJobRecord,
  CanonicalAssistantCronJobRecord,
} from '../src/assistant/cron/canonical-jobs.ts'
import type {
  AssistantCronCanonicalRuntimeRecord,
  AssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import type { CanonicalScheduledLogAssistantCronJobRecord } from '../src/assistant/cron/scheduled-log.ts'
import type { AssistantCronStore } from '../src/assistant/cron/store.ts'
import type { AssistantStatePaths } from '../src/assistant/store/paths.ts'

const cronMutationMocks = vi.hoisted(() => ({
  executeScheduledLogOccurrence: vi.fn(),
  loadVault: vi.fn(),
  setScheduledLogStatus: vi.fn(),
  upsertAutomation: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  executeScheduledLogOccurrence: cronMutationMocks.executeScheduledLogOccurrence,
  loadVault: cronMutationMocks.loadVault,
  setScheduledLogStatus: cronMutationMocks.setScheduledLogStatus,
  upsertAutomation: cronMutationMocks.upsertAutomation,
}))

import {
  assertResolvedAssistantCronJobNotRunning,
  removeResolvedCanonicalAssistantCronSource,
  removeResolvedLocalAssistantCronJob,
  setResolvedCanonicalAssistantCronSourceEnabled,
  setResolvedLocalAssistantCronJobEnabled,
  tryResolveLocalAssistantCronJob,
  updateResolvedCanonicalAssistantCronAutomationTarget,
  writeResolvedCanonicalAssistantCronRuntimeState,
  type ResolvedCanonicalAssistantCronJobMutation,
} from '../src/assistant/cron/mutations.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import {
  readAssistantCronStore,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const tempRoots: string[] = []

afterEach(async () => {
  cronMutationMocks.executeScheduledLogOccurrence.mockReset()
  cronMutationMocks.loadVault.mockReset()
  cronMutationMocks.setScheduledLogStatus.mockReset()
  cronMutationMocks.upsertAutomation.mockReset()

  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant cron mutation helpers', () => {
  it('mutates local cron jobs through filtered lookup, removal, re-enable, and running guards', async () => {
    const { paths, vaultRoot } = await createAssistantPaths('assistant-cron-mutations-local-')
    const localJob = createCronJob({
      jobId: 'cron_food',
      name: 'Daily local job',
    })
    const nextJob = createCronJob({
      jobId: 'cron_next',
      name: 'Next job',
    })
    const store: AssistantCronStore = {
      version: 1,
      jobs: [localJob, nextJob],
    }

    expect(tryResolveLocalAssistantCronJob(store, 'Daily local job')).toBe(localJob)

    await writeAssistantCronStore(paths, store)
    const removed = await removeResolvedLocalAssistantCronJob({
      kind: 'local',
      job: localJob,
      localJobIndex: 0,
      paths,
      store,
      vault: vaultRoot,
    })

    expect(removed.jobId).toBe('cron_food')
    expect((await readAssistantCronStore(paths)).jobs.map((job) => job.jobId)).toEqual([
      'cron_next',
    ])

    await expect(
      removeResolvedLocalAssistantCronJob({
        kind: 'local',
        job: localJob,
        localJobIndex: 4,
        paths,
        store: {
          version: 1,
          jobs: [],
        },
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_JOB_NOT_FOUND',
      message: 'Assistant cron job "Daily local job" was not found.',
    })

    const disabledEveryJob = createCronJob({
      enabled: false,
      jobId: 'cron_every',
      name: 'Hourly check',
      schedule: {
        everyMs: 3_600_000,
        kind: 'every',
      },
      target: createCronTarget({
        channel: 'telegram',
        deliveryTarget: 'room-1',
      }),
    })
    const reenabled = await setResolvedLocalAssistantCronJobEnabled({
      enabled: true,
      now: new Date('2026-04-08T10:00:00.000Z'),
      resolved: {
        kind: 'local',
        job: disabledEveryJob,
        localJobIndex: 0,
        paths,
        store: {
          version: 1,
          jobs: [disabledEveryJob],
        },
        vault: vaultRoot,
      },
    })

    expect(reenabled.enabled).toBe(true)
    expect(reenabled.state.nextRunAt).toBe('2026-04-08T11:00:00.000Z')

    const invalidEmailJob = createCronJob({
      enabled: false,
      jobId: 'cron_invalid_email',
      name: 'Invalid email reminder',
      target: createCronTarget({
        channel: 'email',
        threadId: 'email-thread-only',
      }),
    })
    await expect(
      setResolvedLocalAssistantCronJobEnabled({
        enabled: true,
        now: new Date('2026-04-08T10:00:00.000Z'),
        resolved: {
          kind: 'local',
          job: invalidEmailJob,
          localJobIndex: 0,
          paths,
          store: {
            version: 1,
            jobs: [invalidEmailJob],
          },
          vault: vaultRoot,
        },
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
      message: expect.stringContaining('Local email automation delivery is not supported'),
    })
    await expect(
      setResolvedLocalAssistantCronJobEnabled({
        enabled: false,
        now: new Date('2026-04-08T10:00:00.000Z'),
        resolved: {
          kind: 'local',
          job: invalidEmailJob,
          localJobIndex: 0,
          paths,
          store: {
            version: 1,
            jobs: [invalidEmailJob],
          },
          vault: vaultRoot,
        },
      }),
    ).resolves.toMatchObject({
      enabled: false,
    })

    expect(() =>
      assertResolvedAssistantCronJobNotRunning({
        kind: 'local',
        job: createCronJob({
          jobId: 'cron_running',
          name: 'Running job',
          runningAt: '2026-04-08T10:00:00.000Z',
          runningPid: 123,
        }),
        localJobIndex: 0,
        paths,
        store: {
          version: 1,
          jobs: [],
        },
        vault: vaultRoot,
      }),
    ).toThrowError(/already running/u)
  })

  it('covers canonical scheduled-log and unsupported target mutations', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-cron-mutations-canonical-',
    )
    const scheduledLog = createScheduledLogSource()
    const scheduledResolved = createCanonicalResolved({
      paths,
      source: scheduledLog,
      vault: vaultRoot,
    })

    await writeResolvedCanonicalAssistantCronRuntimeState({
      resolved: {
        ...scheduledResolved,
        runtimeStore: {
          version: 1,
          jobs: [],
        },
      },
      runtimeState: null,
    })
    await expect(readFile(paths.cronAutomationStatePath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    cronMutationMocks.setScheduledLogStatus.mockResolvedValue(undefined)
    await removeResolvedCanonicalAssistantCronSource(scheduledResolved)

    expect(cronMutationMocks.setScheduledLogStatus).toHaveBeenCalledWith({
      scheduledLogId: 'slog_1',
      status: 'archived',
      vaultRoot: vaultRoot,
    })
    expect((await readAssistantCronCanonicalRuntimeStore(paths)).jobs).toEqual([])

    const disabled = await setResolvedCanonicalAssistantCronSourceEnabled({
      enabled: false,
      now: new Date('2026-04-08T12:00:00.000Z'),
      resolved: createCanonicalResolved({
        paths,
        source: scheduledLog,
        vault: vaultRoot,
      }),
    })

    expect(cronMutationMocks.setScheduledLogStatus).toHaveBeenLastCalledWith({
      scheduledLogId: 'slog_1',
      status: 'paused',
      vaultRoot: vaultRoot,
    })
    expect(disabled.source).toMatchObject({
      kind: 'scheduledLog',
      status: 'paused',
      updatedAt: '2026-04-08T12:00:00.000Z',
    })
    expect(disabled.runtimeState.state).toMatchObject({
      activatedAt: '2026-04-08T07:00:00.000Z',
      pendingOccurrenceAt: null,
      retryAfterAt: null,
    })

    const invalidEmailAutomation = createAutomationSource({
      route: {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'email-thread-only',
      },
      status: 'paused',
    })
    await expect(
      setResolvedCanonicalAssistantCronSourceEnabled({
        enabled: true,
        now: new Date('2026-04-08T12:00:00.000Z'),
        resolved: createCanonicalResolved({
          paths,
          source: invalidEmailAutomation,
          vault: vaultRoot,
        }),
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
      message: expect.stringContaining('Local email automation delivery is not supported'),
    })
    expect(cronMutationMocks.upsertAutomation).not.toHaveBeenCalled()

    const activeInvalidEmailAutomation = {
      ...invalidEmailAutomation,
      status: 'active' as const,
    }
    cronMutationMocks.upsertAutomation.mockResolvedValueOnce({
      created: false,
      record: {
        ...activeInvalidEmailAutomation,
        status: 'paused',
        markdown: '',
        relativePath: 'Automations/invalid-email-reminder.md',
        schemaVersion: 'murph.automation.v1',
        docType: 'automation',
      },
    })
    await expect(
      setResolvedCanonicalAssistantCronSourceEnabled({
        enabled: false,
        now: new Date('2026-04-08T12:00:00.000Z'),
        resolved: createCanonicalResolved({
          paths,
          source: activeInvalidEmailAutomation,
          vault: vaultRoot,
        }),
      }),
    ).resolves.toMatchObject({
      source: {
        kind: 'automation',
        status: 'paused',
      },
    })

    await expect(
      updateResolvedCanonicalAssistantCronAutomationTarget({
        now: '2026-04-08T12:00:00.000Z',
        resolved: scheduledResolved,
        target: createCronTarget({
          channel: 'telegram',
          threadId: 'thread-1',
        }),
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
      message:
        'Canonical auto-log job "Daily scheduled log" does not support assistant delivery targeting.',
    })

  })
})

async function createAssistantPaths(prefix: string): Promise<{
  paths: AssistantStatePaths
  vaultRoot: string
}> {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  const paths = resolveAssistantStatePaths(context.vaultRoot)
  await readAssistantCronStore(paths)
  return {
    paths,
    vaultRoot: context.vaultRoot,
  }
}

function createCronTarget(
  overrides: Partial<AssistantCronTarget> = {},
): AssistantCronTarget {
  return {
    alias: null,
    channel: null,
    deliverySource: null,
    deliveryTarget: null,
    identityId: null,
    participantId: null,
    sessionId: null,
    threadId: null,
    ...overrides,
  }
}

function createCronJob(input: {
  enabled?: boolean
  jobId: string
  name: string
  nextRunAt?: string | null
  runningAt?: string | null
  runningPid?: number | null
  schedule?: AssistantCronSchedule
  scheduledLog?: AssistantCronJob['scheduledLog']
  target?: AssistantCronTarget
}): AssistantCronJob {
  return {
    createdAt: '2026-04-08T07:00:00.000Z',
    enabled: input.enabled ?? true,
    jobId: input.jobId,
    keepAfterRun: true,
    name: input.name,
    prompt: 'Check in on today.',
    schedule: input.schedule ?? {
      everyMs: 3_600_000,
      kind: 'every',
    },
    schema: 'murph.assistant-cron-job.v1',
    scheduledLog: input.scheduledLog,
    state: {
      consecutiveFailures: 0,
      lastError: null,
      lastFailedAt: null,
      lastRunAt: null,
      lastSucceededAt: null,
      nextRunAt: input.nextRunAt ?? null,
      runningAt: input.runningAt ?? null,
      runningPid: input.runningPid ?? null,
    },
    target: input.target ?? createCronTarget(),
    updatedAt: '2026-04-08T07:00:00.000Z',
  }
}

function createRuntimeRecord(jobId: string): AssistantCronCanonicalRuntimeRecord {
  return createAssistantCronCanonicalRuntimeRecord({
    activatedAt: '2026-04-08T07:00:00.000Z',
    jobId,
    now: '2026-04-08T07:00:00.000Z',
  })
}

function createCanonicalResolved(input: {
  paths: AssistantStatePaths
  source: CanonicalAssistantCronJobRecord
  vault: string
}): ResolvedCanonicalAssistantCronJobMutation {
  const job =
    input.source.kind === 'scheduledLog'
      ? createCronJob({
          jobId: input.source.scheduledLogId,
          name: input.source.title,
          scheduledLog: {
            actionKind: input.source.actionKind,
            scheduledLogId: input.source.scheduledLogId,
          },
        })
      : createCronJob({
          jobId: input.source.automationId,
          name: input.source.title,
          target: createCronTarget({
            channel: input.source.route.channel,
            deliveryTarget: input.source.route.deliveryTarget,
            identityId: input.source.route.identityId,
            participantId: input.source.route.participantId,
            threadId: input.source.route.threadId,
          }),
        })
  const runtimeState = createRuntimeRecord(job.jobId)
  const runtimeStore: AssistantCronCanonicalRuntimeStore = {
    version: 1,
    jobs: [runtimeState],
  }

  return {
    kind: 'canonical',
    job,
    paths: input.paths,
    runtimeState,
    runtimeStore,
    source: input.source,
    store: {
      version: 1,
      jobs: [],
    },
    vault: input.vault,
  }
}

function createScheduledLogSource(): CanonicalScheduledLogAssistantCronJobRecord {
  return {
    actionKind: 'meal.add',
    createdAt: '2026-04-08T07:00:00.000Z',
    kind: 'scheduledLog',
    schedule: {
      everyMs: 86_400_000,
      kind: 'every',
    },
    scheduledLogId: 'slog_1',
    slug: 'daily-scheduled-log',
    status: 'active',
    timeZone: null,
    title: 'Daily scheduled log',
    updatedAt: '2026-04-08T07:00:00.000Z',
  }
}

function createAutomationSource(
  overrides: Partial<CanonicalAutomationAssistantCronJobRecord> = {},
): CanonicalAutomationAssistantCronJobRecord {
  return {
    activeUntil: null,
    automationId: 'automation_invalid_email',
    continuityPolicy: 'fresh',
    createdAt: '2026-04-08T07:00:00.000Z',
    instructions: 'Send the reminder.',
    kind: 'automation',
    assistantTargetOverride: null,
    route: {
      channel: 'telegram',
      deliverySource: null,
      deliveryTarget: 'room-1',
      identityId: null,
      participantId: null,
      threadId: null,
    },
    schedule: {
      everyMs: 3_600_000,
      kind: 'every',
    },
    slug: 'invalid-email-reminder',
    status: 'paused',
    summary: null,
    tags: ['assistant', 'scheduled'],
    timeZone: null,
    title: 'Invalid email reminder',
    updatedAt: '2026-04-08T07:00:00.000Z',
    ...overrides,
    supportKind: overrides.supportKind ?? null,
  }
}
