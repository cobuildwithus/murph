import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'

import type { AssistantCronSchedule } from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAssistantCronPresetDefinition,
  renderAssistantCronPreset,
} from '../src/assistant/cron/presets.ts'

type WebFetchModule = typeof import('../src/assistant/web-fetch.ts')
type LookupImplementation = typeof import('node:dns/promises').lookup
type MockLookupAddress = {
  address: string
  family: number
}
type LinkedomMimeType = 'text/html' | 'image/svg+xml' | 'text/xml'

type MockAutomationRecord = {
  automationId: string
  continuityPolicy: 'preserve' | 'reset'
  createdAt: string
  prompt: string
  route: {
    channel: string
    deliverResponse: boolean
    deliveryTarget: string | null
    identityId: string | null
    participantId: string | null
    sourceThreadId: string | null
  }
  schedule: AssistantCronSchedule
  slug?: string
  status: 'active' | 'paused' | 'archived'
  summary?: string
  tags: string[]
  title: string
  updatedAt: string
}

type MockResponseDefinition = {
  body?: string | Uint8Array | Array<string | Uint8Array> | null
  headers?: Record<string, string | string[] | undefined>
  status: number
  statusText?: string
}

type MockRequestStep =
  | {
      error: Error
      type: 'error'
    }
  | {
      response: MockResponseDefinition
      type: 'response'
    }

type ReadabilityParseResult = {
  content?: string | null
  textContent?: string | null
  title?: string | null
}

const cronMocks = vi.hoisted(() => ({
  applyAssistantSelfDeliveryTargetDefaults: vi.fn(),
  automationsByVault: new Map<string, MockAutomationRecord[]>(),
  getAssistantChannelAdapter: vi.fn(),
  listCanonicalAutomations: vi.fn(),
  loadImporterRuntime: vi.fn(),
  loadRuntimeModule: vi.fn(),
  loadVault: vi.fn(),
  nextAutomationId: 1,
  renderAutoLoggedFoodMealNote: vi.fn(),
  resolveAssistantBindingDelivery: vi.fn(),
  sendAssistantMessageLocal: vi.fn(),
  showCanonicalAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
  withAssistantCronWriteLock: vi.fn(),
}))

vi.mock('@murphai/core', () => ({
  loadVault: cronMocks.loadVault,
  upsertAutomation: cronMocks.upsertAutomation,
}))

vi.mock('@murphai/query', () => ({
  listAutomations: cronMocks.listCanonicalAutomations,
  showAutomation: cronMocks.showCanonicalAutomation,
}))

vi.mock('@murphai/vault-usecases/runtime', () => ({
  loadImporterRuntime: cronMocks.loadImporterRuntime,
  loadRuntimeModule: cronMocks.loadRuntimeModule,
}))

vi.mock('@murphai/vault-usecases/records', () => ({
  renderAutoLoggedFoodMealNote: cronMocks.renderAutoLoggedFoodMealNote,
}))

vi.mock('../src/assistant-service.ts', () => ({
  sendAssistantMessageLocal: cronMocks.sendAssistantMessageLocal,
}))

vi.mock('../src/assistant/channel-adapters.ts', () => ({
  getAssistantChannelAdapter: cronMocks.getAssistantChannelAdapter,
}))

vi.mock('../src/assistant/bindings.ts', () => ({
  resolveAssistantBindingDelivery: cronMocks.resolveAssistantBindingDelivery,
}))

vi.mock('../src/assistant/cron/locking.ts', () => ({
  withAssistantCronWriteLock: cronMocks.withAssistantCronWriteLock,
}))

vi.mock('@murphai/operator-config/operator-config', () => ({
  applyAssistantSelfDeliveryTargetDefaults:
    cronMocks.applyAssistantSelfDeliveryTargetDefaults,
}))

import {
  addAssistantCronJob,
  getAssistantCronJob,
  runAssistantCronJobNow,
  setAssistantCronJobEnabled,
} from '../src/assistant-cron.ts'
import {
  readAssistantCronStore,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

beforeEach(() => {
  vi.useRealTimers()
  cronMocks.automationsByVault.clear()
  cronMocks.nextAutomationId = 1

  cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockReset().mockImplementation(
    async (input: Record<string, string | null | undefined>) => ({
      channel: input.channel ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
      identityId: input.identityId ?? null,
      participantId: input.participantId ?? null,
      sourceThreadId: input.sourceThreadId ?? null,
    }),
  )
  cronMocks.getAssistantChannelAdapter
    .mockReset()
    .mockImplementation((channel) => (channel ? { channel } : null))
  cronMocks.resolveAssistantBindingDelivery
    .mockReset()
    .mockImplementation(
      ({
        actorId,
        channel,
        deliveryTarget,
        threadId,
      }: {
        actorId?: string | null
        channel?: string | null
        deliveryTarget?: string | null
        threadId?: string | null
      }) => {
        if (!channel) {
          return null
        }

        if (deliveryTarget) {
          return {
            channel,
            deliveryTarget,
            kind: 'direct',
          }
        }

        if (actorId || threadId) {
          return {
            actorId: actorId ?? null,
            channel,
            kind: 'binding',
            threadId: threadId ?? null,
          }
        }

        return null
      },
    )
  cronMocks.withAssistantCronWriteLock
    .mockReset()
    .mockImplementation(async (_paths, action: () => Promise<unknown>) => action())
  cronMocks.loadVault.mockReset().mockResolvedValue({
    metadata: {
      timezone: 'UTC',
    },
  })
  cronMocks.sendAssistantMessageLocal.mockReset().mockResolvedValue({
    response: 'Completed scheduled check-in.',
    session: {
      sessionId: 'session-default',
    },
  })
  cronMocks.loadRuntimeModule.mockReset().mockResolvedValue({
    readFood: vi.fn(),
  })
  cronMocks.loadImporterRuntime.mockReset().mockResolvedValue({
    addMeal: vi.fn(),
  })
  cronMocks.renderAutoLoggedFoodMealNote.mockReset().mockReturnValue('Meal note')
  cronMocks.listCanonicalAutomations.mockReset().mockImplementation(
    async (
      vault: string,
      options?: {
        status?: ReadonlyArray<'active' | 'paused' | 'archived'>
      },
    ) => {
      const records = getVaultAutomationStore(vault)
      const allowed = options?.status
      return records.filter((record) =>
        allowed ? allowed.includes(record.status) : true,
      )
    },
  )
  cronMocks.showCanonicalAutomation
    .mockReset()
    .mockImplementation(async (vault: string, lookup: string) => {
      const normalized = lookup.trim()
      return (
        getVaultAutomationStore(vault).find(
          (record) =>
            record.automationId === normalized || record.title === normalized,
        ) ?? null
      )
    })
  cronMocks.upsertAutomation.mockReset().mockImplementation(
    async (input: {
      automationId?: string
      continuityPolicy?: 'preserve' | 'reset'
      prompt: string
      route: MockAutomationRecord['route']
      schedule: AssistantCronSchedule
      slug?: string
      status: MockAutomationRecord['status']
      summary?: string
      tags?: string[]
      title: string
      vaultRoot: string
    }) => {
      const records = getVaultAutomationStore(input.vaultRoot)
      const now = new Date().toISOString()
      const existingIndex = input.automationId
        ? records.findIndex((record) => record.automationId === input.automationId)
        : -1

      if (existingIndex >= 0) {
        const existing = records[existingIndex] as MockAutomationRecord
        const updated: MockAutomationRecord = {
          ...existing,
          continuityPolicy: input.continuityPolicy ?? existing.continuityPolicy,
          prompt: input.prompt,
          route: { ...input.route },
          schedule: input.schedule,
          slug: input.slug,
          status: input.status,
          summary: input.summary,
          tags: input.tags ?? existing.tags,
          title: input.title,
          updatedAt: now,
        }
        records.splice(existingIndex, 1, updated)
        return {
          record: updated,
        }
      }

      const created: MockAutomationRecord = {
        automationId: `automation-${cronMocks.nextAutomationId++}`,
        continuityPolicy: input.continuityPolicy ?? 'preserve',
        createdAt: now,
        prompt: input.prompt,
        route: { ...input.route },
        schedule: input.schedule,
        slug: input.slug,
        status: input.status,
        summary: input.summary,
        tags: input.tags ?? ['assistant', 'scheduled'],
        title: input.title,
        updatedAt: now,
      }
      records.push(created)
      return {
        record: created,
      }
    },
  )
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.doUnmock('node:http')
  vi.doUnmock('node:https')
  vi.doUnmock('node:dns/promises')
  vi.doUnmock('@mozilla/readability')
  vi.doUnmock('@murphai/operator-config/http-retry')
  vi.resetModules()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant cron preset threshold coverage', () => {
  it('renders optional empty variables and reports missing required defaults through the live preset definitions', () => {
    const definition = getAssistantCronPresetDefinition('weekly-health-snapshot')
    const originalVariables = [...definition.variables]

    try {
      definition.variables = [
        {
          ...definition.variables[0],
          defaultValue: null,
          required: false,
        },
        {
          ...definition.variables[1],
        },
      ]

      const optionalRender = renderAssistantCronPreset({
        presetId: definition.id,
        variables: {
          snapshot_focus: 'keep it calm',
        },
      })

      expect(optionalRender.resolvedVariables.goals_and_experiments).toBe('')
      expect(optionalRender.resolvedVariables.snapshot_focus).toBe('keep it calm')

      definition.variables = [
        {
          ...definition.variables[0],
          defaultValue: null,
          required: true,
        },
        {
          ...definition.variables[1],
        },
      ]

      expect(() =>
        renderAssistantCronPreset({
          presetId: definition.id,
          variables: {
            snapshot_focus: 'keep it calm',
          },
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'ASSISTANT_CRON_PRESET_MISSING_VARIABLE',
        }),
      )
    } finally {
      definition.variables = originalVariables
    }
  })

  it('raises an invalid-template error when a live preset definition references an unknown variable', () => {
    const definition = getAssistantCronPresetDefinition('morning-mindfulness')
    const originalTemplate = definition.promptTemplate

    try {
      definition.promptTemplate = 'Prompt with {{unknown_key}}.'

      expect(() =>
        renderAssistantCronPreset({
          presetId: definition.id,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'ASSISTANT_CRON_PRESET_INVALID_TEMPLATE',
        }),
      )
    } finally {
      definition.promptTemplate = originalTemplate
    }
  })
})

describe('assistant cron runtime threshold coverage', () => {
  it('applies resolved self-delivery defaults when creating canonical cron jobs', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-default-target-')

    cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
      channel: 'telegram',
      deliveryTarget: null,
      identityId: null,
      participantId: 'person-1',
      sourceThreadId: 'thread-1',
    })

    const job = await addAssistantCronJob({
      name: 'default-target-job',
      prompt: 'Send the daily check-in.',
      schedule: {
        expression: '0 9 * * *',
        kind: 'cron',
      },
      vault: vaultRoot,
    })

    expect(job.target).toMatchObject({
      channel: 'telegram',
      participantId: 'person-1',
      sourceThreadId: 'thread-1',
    })
    expect(job.target.deliveryTarget).toBeNull()
  })

  it('preserves the existing next run when a disabled recurring job succeeds manually', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext('assistant-cron-disabled-success-')

    const job = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-disabled',
      name: 'disabled-success-job',
      prompt: 'Manual check-in.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'UTC',
      },
      vault: vaultRoot,
    })

    const disabledJob = await setAssistantCronJobEnabled(vaultRoot, job.jobId, false)
    const preservedNextRunAt = disabledJob.state.nextRunAt

    const result = await runAssistantCronJobNow({
      job: job.jobId,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(result.job.enabled).toBe(false)
    expect(result.job.state.nextRunAt).toBe(preservedNextRunAt)
    expect(result.job.state.lastSucceededAt).toBe('2026-04-08T08:00:00.000Z')
  })

  it('escalates failure backoff across repeated manual failures', async () => {
    vi.useFakeTimers()
    const { vaultRoot } = await createRuntimeContext('assistant-cron-failure-backoff-')

    const job = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-failure',
      name: 'failure-backoff-job',
      prompt: 'Retry until it works.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'UTC',
      },
      vault: vaultRoot,
    })

    cronMocks.sendAssistantMessageLocal.mockRejectedValue(
      new VaultCliError('ASSISTANT_SEND_FAILED', 'scheduled send failed'),
    )

    const attempts = [
      {
        expectedFailures: 1,
        expectedNextRunAt: '2026-04-08T08:00:30.000Z',
        now: '2026-04-08T08:00:00.000Z',
      },
      {
        expectedFailures: 2,
        expectedNextRunAt: '2026-04-08T08:02:00.000Z',
        now: '2026-04-08T08:01:00.000Z',
      },
      {
        expectedFailures: 3,
        expectedNextRunAt: '2026-04-08T08:07:00.000Z',
        now: '2026-04-08T08:02:00.000Z',
      },
      {
        expectedFailures: 4,
        expectedNextRunAt: '2026-04-08T08:18:00.000Z',
        now: '2026-04-08T08:03:00.000Z',
      },
      {
        expectedFailures: 5,
        expectedNextRunAt: '2026-04-08T09:04:00.000Z',
        now: '2026-04-08T08:04:00.000Z',
      },
    ] as const

    for (const attempt of attempts) {
      vi.setSystemTime(new Date(attempt.now))

      const result = await runAssistantCronJobNow({
        job: job.jobId,
        vault: vaultRoot,
      })

      expect(result.run.status).toBe('failed')
      const updated = await getAssistantCronJob(vaultRoot, job.jobId)
      expect(updated.state.consecutiveFailures).toBe(attempt.expectedFailures)
      expect(updated.state.nextRunAt).toBe(attempt.expectedNextRunAt)
    }
  })

  it('removes successful local one-shot food auto-log jobs after the run completes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext('assistant-cron-local-one-shot-')

    cronMocks.loadRuntimeModule.mockResolvedValueOnce({
      readFood: vi.fn(async () => ({
        foodId: 'food-1',
        title: 'Daily Oats',
      })),
    })
    cronMocks.loadImporterRuntime.mockResolvedValueOnce({
      addMeal: vi.fn(async () => ({
        mealId: 'meal-1',
      })),
    })
    cronMocks.renderAutoLoggedFoodMealNote.mockReturnValueOnce('Meal note for Daily Oats')

    const job = await addAssistantCronJob({
      foodAutoLog: {
        foodId: 'food-1',
      },
      name: 'local-one-shot',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Auto-log breakfast.',
      schedule: {
        at: '2026-04-08T09:00:00.000Z',
        kind: 'at',
      },
      vault: vaultRoot,
    })

    const result = await runAssistantCronJobNow({
      job: job.jobId,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(result.removedAfterRun).toBe(true)
    await expect(getAssistantCronJob(vaultRoot, job.jobId)).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_JOB_NOT_FOUND',
    })
  })

  it('records aborted manual runs before any cron work starts', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-aborted-run-')
    const job = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'room-abort',
      name: 'aborted-job',
      prompt: 'This should not run.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'UTC',
      },
      vault: vaultRoot,
    })
    const controller = new AbortController()
    controller.abort()

    const result = await runAssistantCronJobNow({
      job: job.jobId,
      signal: controller.signal,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('failed')
    expect(result.run.error).toContain('was aborted before it started')
    expect(cronMocks.sendAssistantMessageLocal).not.toHaveBeenCalled()
  })

  it('treats local jobs removed mid-finalization as already gone', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T08:00:00.000Z'))
    const { vaultRoot } = await createRuntimeContext('assistant-cron-local-race-')

    cronMocks.loadRuntimeModule.mockResolvedValueOnce({
      readFood: vi.fn(async () => ({
        foodId: 'food-race',
        title: 'Race Oats',
      })),
    })
    cronMocks.loadImporterRuntime.mockResolvedValueOnce({
      addMeal: vi.fn(async () => ({
        mealId: 'meal-race',
      })),
    })
    cronMocks.renderAutoLoggedFoodMealNote.mockReturnValueOnce('Meal note for Race Oats')

    const job = await addAssistantCronJob({
      foodAutoLog: {
        foodId: 'food-race',
      },
      name: 'local-race-job',
      now: new Date('2026-04-08T08:00:00.000Z'),
      prompt: 'Auto-log during a race.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'UTC',
      },
      vault: vaultRoot,
    })

    let lockInvocationCount = 0
    cronMocks.withAssistantCronWriteLock.mockImplementation(
      async (paths, action: () => Promise<unknown>) => {
        lockInvocationCount += 1
        if (lockInvocationCount === 2) {
          const store = await readAssistantCronStore(paths)
          store.jobs = store.jobs.filter((entry) => entry.jobId !== job.jobId)
          await writeAssistantCronStore(paths, store)
        }

        return action()
      },
    )

    const result = await runAssistantCronJobNow({
      job: job.jobId,
      vault: vaultRoot,
    })

    expect(result.run.status).toBe('succeeded')
    expect(result.removedAfterRun).toBe(true)
  })

  it('rejects cron jobs when delivery defaults still leave no outbound route', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-missing-route-')

    cronMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
      channel: 'telegram',
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      sourceThreadId: null,
    })

    await expect(
      addAssistantCronJob({
        name: 'missing-route-job',
        prompt: 'This should fail.',
        schedule: {
          kind: 'dailyLocal',
          localTime: '09:00',
          timeZone: 'UTC',
        },
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
    })
  })
})

describe('assistant web-fetch threshold coverage', () => {
  it('uses the HTTP transport for IP hosts, preserves multi-value headers, and formats valid JSON', async () => {
    const { httpRequestMock, module } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
      httpSteps: [
        {
          response: {
            body: '{"status":"ok","count":2}',
            headers: {
              'content-type': 'application/json',
              'set-cookie': ['a=1', 'b=2'],
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    const result = await module.fetchAssistantWeb(
      {
        url: 'http://example.com/data',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    )

    expect(result).toMatchObject({
      contentType: 'application/json',
      extractor: 'json',
      finalUrl: 'http://example.com/data',
      text: '{\n  "status": "ok",\n  "count": 2\n}\n',
      title: null,
      truncated: false,
      url: 'http://example.com/data',
      warnings: [],
    })
    expect(httpRequestMock).toHaveBeenCalledTimes(1)
    expect(httpRequestMock.mock.calls[0]?.[0]).toMatchObject({
      servername: undefined,
    })
  })

  it('rejects blank or malformed URLs and unsupported binary responses', async () => {
    const { module: urlModule } = await loadWebFetchModule()

    await expect(
      urlModule.fetchAssistantWeb(
        {
          url: '   ',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_URL_INVALID',
    })

    await expect(
      urlModule.fetchAssistantWeb(
        {
          url: 'not a url',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_URL_INVALID',
    })

    const { module: binaryModule } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
      httpsSteps: [
        {
          response: {
            body: 'binary payload',
            headers: {
              'content-type': 'image/png',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      binaryModule.fetchAssistantWeb(
        {
          url: 'https://example.com/image.png',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_CONTENT_TYPE_UNSUPPORTED',
    })
  })

  it('wraps aggregated request failures and surfaces timeout-specific errors', async () => {
    const lookupImplementation = createLookupImplementation([
      {
        address: 'edge-a.test',
        family: 0,
      },
      {
        address: 'edge-b.test',
        family: 0,
      },
    ])

    const { module: requestFailureModule } = await loadWebFetchModule({
      httpsSteps: [
        {
          error: new Error('connect ECONNREFUSED'),
          type: 'error',
        },
        {
          error: new Error('connect ETIMEDOUT'),
          type: 'error',
        },
      ],
      lookupImplementation,
    })

    await expect(
      requestFailureModule.fetchAssistantWeb(
        {
          url: 'https://example.com/request-failure',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REQUEST_FAILED',
      message: expect.stringContaining('All vetted public addresses failed'),
    })

    const cleanup = vi.fn()
    const { module: timeoutModule } = await loadWebFetchModule({
      httpsSteps: [
        {
          error: new Error('slow network'),
          type: 'error',
        },
      ],
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge-timeout.test',
          family: 0,
        },
      ]),
      timeoutControllerFactory: () => ({
        cleanup,
        signal: new AbortController().signal,
        timedOut: () => true,
      }),
    })

    await expect(
      timeoutModule.fetchAssistantWeb(
        {
          url: 'https://example.com/timeout',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_TIMEOUT',
    })
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('falls back to a null title when readable html has no document title', async () => {
    const { module } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
      httpsSteps: [
        {
          response: {
            body: '<!doctype html><html><body><article>Readable body</article></body></html>',
            headers: {
              'content-type': 'text/html; charset=utf-8',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
      readabilityParse: () => ({
        content: '<p>Readable body</p>',
        textContent: 'Readable body',
        title: null,
      }),
    })

    await expect(
      module.fetchAssistantWeb(
        {
          extractMode: 'text',
          url: 'https://example.com/no-title',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      extractor: 'readability',
      text: 'Readable body',
      title: null,
    })
  })

  it('runs pinned DNS lookups for matched and mismatched address families', async () => {
    const matchingHttpsRequest = vi.fn(
      (options: { lookup?: Function }, callback?: (response: import('node:http').IncomingMessage) => void) => {
        const listeners = new Map<string, Array<(error: Error) => void>>()
        return {
          end() {
            const lookup = options.lookup
            expect(lookup).toBeTypeOf('function')
            lookup?.(
              'example.com',
              { family: 'IPv6' },
              (error: Error | null) => {
                if (error) {
                  for (const listener of listeners.get('error') ?? []) {
                    listener(error)
                  }
                  return
                }

                callback?.(
                  createIncomingMessage({
                    body: 'lookup matched',
                    headers: {
                      'content-type': 'text/plain',
                    },
                    status: 200,
                  }),
                )
              },
            )
          },
          once(eventName: string, listener: (error: Error) => void) {
            const existing = listeners.get(eventName) ?? []
            existing.push(listener)
            listeners.set(eventName, existing)
            return this
          },
        }
      },
    )

    const { module: matchingModule } = await loadWebFetchModule({
      httpsRequestImplementation: matchingHttpsRequest,
      lookupImplementation: createLookupImplementation([
        {
          address: '2606:4700:4700::1111',
          family: 6,
        },
      ]),
    })

    await expect(
      matchingModule.fetchAssistantWeb(
        {
          url: 'https://example.com/lookup-match',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      text: 'lookup matched',
      url: 'https://example.com/lookup-match',
    })

    const mismatchedHttpsRequest = vi.fn(
      (options: { lookup?: Function }, _callback?: (response: import('node:http').IncomingMessage) => void) => {
        const listeners = new Map<string, Array<(error: Error) => void>>()
        return {
          end() {
            const lookup = options.lookup
            lookup?.(
              'example.com',
              { family: 'IPv4' },
              (error: Error | null) => {
                if (error) {
                  for (const listener of listeners.get('error') ?? []) {
                    listener(error)
                  }
                }
              },
            )
          },
          once(eventName: string, listener: (error: Error) => void) {
            const existing = listeners.get(eventName) ?? []
            existing.push(listener)
            listeners.set(eventName, existing)
            return this
          },
        }
      },
    )

    const { module: mismatchedModule } = await loadWebFetchModule({
      httpsRequestImplementation: mismatchedHttpsRequest,
      lookupImplementation: createLookupImplementation([
        {
          address: '2606:4700:4700::1111',
          family: 6,
        },
      ]),
    })

    await expect(
      mismatchedModule.fetchAssistantWeb(
        {
          url: 'https://example.com/lookup-mismatch',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REQUEST_FAILED',
      message: expect.stringContaining('Pinned address family 6 did not match requested family 4.'),
    })

    const defaultFamilyHttpsRequest = vi.fn(
      (options: { lookup?: Function }, callback?: (response: import('node:http').IncomingMessage) => void) => {
        const listeners = new Map<string, Array<(error: Error) => void>>()
        return {
          end() {
            const lookup = options.lookup
            lookup?.(
              'example.com',
              {},
              (error: Error | null) => {
                if (error) {
                  for (const listener of listeners.get('error') ?? []) {
                    listener(error)
                  }
                  return
                }

                callback?.(
                  createIncomingMessage({
                    body: 'lookup default family',
                    headers: {
                      'content-type': 'text/plain',
                    },
                    status: 200,
                  }),
                )
              },
            )
          },
          once(eventName: string, listener: (error: Error) => void) {
            const existing = listeners.get(eventName) ?? []
            existing.push(listener)
            listeners.set(eventName, existing)
            return this
          },
        }
      },
    )

    const { module: defaultFamilyModule } = await loadWebFetchModule({
      httpsRequestImplementation: defaultFamilyHttpsRequest,
      lookupImplementation: createLookupImplementation([
        {
          address: '2606:4700:4700::1111',
          family: 6,
        },
      ]),
    })

    await expect(
      defaultFamilyModule.fetchAssistantWeb(
        {
          url: 'https://example.com/lookup-default',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      text: 'lookup default family',
      url: 'https://example.com/lookup-default',
    })
  })

  it('rejects empty DNS answers and falls back to markdown defaults when extract mode is invalid', async () => {
    const { module: dnsModule } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([]),
    })

    await expect(
      dnsModule.fetchAssistantWeb(
        {
          url: 'https://example.com/no-addresses',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_DNS_LOOKUP_FAILED',
    })

    const { module: invalidExtractModeModule } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
      httpsSteps: [
        {
          response: {
            body: 'abcdef',
            headers: {
              'content-type': 'text/plain',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      invalidExtractModeModule.fetchAssistantWeb(
        {
          extractMode: 'html' as never,
          maxChars: 0,
          url: 'https://example.com/invalid-extract-mode',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      extractMode: 'markdown',
      text: 'a',
      truncated: true,
      warnings: ['Trimmed extracted content to 1 characters for model safety.'],
    })
  })

  it('returns a null title when the parsed html title is neither a string nor a text-bearing object', async () => {
    const { module } = await loadWebFetchModule({
      linkedomDocumentTransform(document) {
        Object.defineProperty(document, 'title', {
          configurable: true,
          value: 123,
        })
        return document
      },
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
      httpsSteps: [
        {
          response: {
            body: '<!doctype html><html><body><main><p>Fallback text only</p></main></body></html>',
            headers: {
              'content-type': 'text/html; charset=utf-8',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
      readabilityParse: () => null,
    })

    await expect(
      module.fetchAssistantWeb(
        {
          extractMode: 'text',
          url: 'https://example.com/fallback-no-title',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      extractor: 'raw-html',
      text: 'Fallback text only',
      title: null,
    })
  })

  it('treats responses without a content-type header as plain text instead of binary content', async () => {
    const { module } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
      httpsSteps: [
        {
          response: {
            body: 'headerless text body',
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      module.fetchAssistantWeb(
        {
          url: 'https://example.com/headerless',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      contentType: null,
      extractor: 'raw-text',
      text: 'headerless text body',
      title: null,
    })
  })

  it('takes the aborted-signal request branch before surfacing the wrapped request failure', async () => {
    const abortingHttpsRequest = vi.fn(
      (_options: unknown, _callback?: (response: import('node:http').IncomingMessage) => void) => {
        const listeners = new Map<string, Array<(error: Error) => void>>()
        return {
          end() {
            const error = new Error('request aborted')
            for (const listener of listeners.get('error') ?? []) {
              listener(error)
            }
          },
          once(eventName: string, listener: (error: Error) => void) {
            const existing = listeners.get(eventName) ?? []
            existing.push(listener)
            listeners.set(eventName, existing)
            return this
          },
        }
      },
    )

    const { module } = await loadWebFetchModule({
      httpsRequestImplementation: abortingHttpsRequest,
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
    })
    const controller = new AbortController()
    controller.abort()

    await expect(
      module.fetchAssistantWebResponse({
        runtime: {
          lookupImplementation: createLookupImplementation([
            {
              address: 'edge.example.test',
              family: 0,
            },
          ]),
          maxRedirects: 1,
          maxResponseBytes: 1_000,
          timeoutMs: 5_000,
        },
        signal: controller.signal,
        toolName: 'web.fetch',
        url: new URL('https://example.com/aborted'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REQUEST_FAILED',
    })
  })

  it('rejects response-conversion failures from the node callback path', async () => {
    const invalidHttpsRequest = vi.fn(
      (_options: unknown, callback?: (response: import('node:http').IncomingMessage) => void) => ({
        end() {
          callback?.({ headers: {}, statusCode: 200, statusMessage: 'OK' } as import('node:http').IncomingMessage)
        },
        once() {
          return this
        },
      }),
    )

    const { module } = await loadWebFetchModule({
      httpsRequestImplementation: invalidHttpsRequest,
      lookupImplementation: createLookupImplementation([
        {
          address: 'edge.example.test',
          family: 0,
        },
      ]),
    })

    await expect(
      module.fetchAssistantWeb(
        {
          url: 'https://example.com/invalid-node-response',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REQUEST_FAILED',
    })
  })

  it('normalizes IPv4-mapped IPv6 lookups before the private-host safety decision', async () => {
    const matchingHttpsRequest = vi.fn(
      (options: { lookup?: Function }, callback?: (response: import('node:http').IncomingMessage) => void) => {
        const listeners = new Map<string, Array<(error: Error) => void>>()
        return {
          end() {
            options.lookup?.(
              'example.com',
              { family: 'IPv6' },
              (error: Error | null) => {
                if (error) {
                  for (const listener of listeners.get('error') ?? []) {
                    listener(error)
                  }
                  return
                }

                callback?.(
                  createIncomingMessage({
                    body: 'mapped ipv6 lookup',
                    headers: {
                      'content-type': 'text/plain',
                    },
                    status: 200,
                  }),
                )
              },
            )
          },
          once(eventName: string, listener: (error: Error) => void) {
            const existing = listeners.get(eventName) ?? []
            existing.push(listener)
            listeners.set(eventName, existing)
            return this
          },
        }
      },
    )

    const { module } = await loadWebFetchModule({
      httpsRequestImplementation: matchingHttpsRequest,
      lookupImplementation: createLookupImplementation([
        {
          address: '::ffff:c000:0201',
          family: 6,
        },
      ]),
    })

    await expect(
      module.fetchAssistantWeb(
        {
          url: 'https://example.com/mapped-ipv6',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PRIVATE_HOST_BLOCKED',
    })
  })

  it('handles both dotted and malformed IPv4-mapped IPv6 lookup forms', async () => {
    const { module: dottedModule } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: '::ffff:8.8.8.8',
          family: 6,
        },
      ]),
    })

    await expect(
      dottedModule.fetchAssistantWeb(
        {
          url: 'https://example.com/mapped-dotted-ipv6',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PRIVATE_HOST_BLOCKED',
    })

    const { module: malformedModule } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: '::ffff:not-an-ip',
          family: 6,
        },
      ]),
    })

    await expect(
      malformedModule.fetchAssistantWeb(
        {
          url: 'https://example.com/mapped-malformed-ipv6',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REQUEST_FAILED',
    })
  })

  it('treats oversized mapped IPv6 hex segments as invalid mapped IPv4 addresses', async () => {
    const hugeHex = 'f'.repeat(400)
    const { module } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        {
          address: `::ffff:${hugeHex}:${hugeHex}`,
          family: 6,
        },
      ]),
    })

    await expect(
      module.fetchAssistantWeb(
        {
          url: 'https://example.com/mapped-overflow-ipv6',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REQUEST_FAILED',
    })
  })
})

function getVaultAutomationStore(vault: string): MockAutomationRecord[] {
  const existing = cronMocks.automationsByVault.get(vault)
  if (existing) {
    return existing
  }

  const created: MockAutomationRecord[] = []
  cronMocks.automationsByVault.set(vault, created)
  return created
}

async function createRuntimeContext(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return context
}

async function loadWebFetchModule(input?: {
  httpSteps?: MockRequestStep[]
  httpRequestImplementation?: ReturnType<typeof vi.fn>
  httpsSteps?: MockRequestStep[]
  httpsRequestImplementation?: ReturnType<typeof vi.fn>
  linkedomDocumentTransform?: (document: unknown) => unknown
  lookupImplementation?: typeof import('node:dns/promises').lookup
  readabilityParse?: () => ReadabilityParseResult | null
  timeoutControllerFactory?: typeof import('@murphai/operator-config/http-retry').createTimeoutAbortController
}): Promise<{
  httpRequestMock: ReturnType<typeof vi.fn>
  httpsRequestMock: ReturnType<typeof vi.fn>
  module: WebFetchModule
}> {
  vi.resetModules()

  const httpRequestMock =
    input?.httpRequestImplementation ?? createRequestMock(input?.httpSteps ?? [])
  const httpsRequestMock =
    input?.httpsRequestImplementation ?? createRequestMock(input?.httpsSteps ?? [])

  vi.doMock('node:http', () => ({
    request: httpRequestMock,
  }))
  vi.doMock('node:https', () => ({
    request: httpsRequestMock,
  }))

  if (input?.lookupImplementation) {
    vi.doMock('node:dns/promises', () => ({
      lookup: input.lookupImplementation,
    }))
  }

  if (input?.readabilityParse) {
    const readabilityParse = input.readabilityParse
    vi.doMock('@mozilla/readability', () => ({
      Readability: class {
        parse() {
          return readabilityParse()
        }
      },
    }))
  }

  if (input?.linkedomDocumentTransform) {
    vi.doMock('linkedom', async () => {
      const actual = await vi.importActual<typeof import('linkedom')>('linkedom')
      const transform = input.linkedomDocumentTransform
      return {
        ...actual,
        DOMParser: class {
          private readonly delegate = new actual.DOMParser()

          parseFromString(
            markupLanguage: string,
            mimeType: LinkedomMimeType,
            globals?: unknown,
          ) {
            const document = this.delegate.parseFromString(
              markupLanguage,
              mimeType,
              globals,
            )
            return transform?.(document) ?? document
          }
        },
      }
    })
  }

  if (input?.timeoutControllerFactory) {
    vi.doMock('@murphai/operator-config/http-retry', async () => {
      const actual = await vi.importActual<typeof import('@murphai/operator-config/http-retry')>(
        '@murphai/operator-config/http-retry',
      )
      return {
        ...actual,
        createTimeoutAbortController: input.timeoutControllerFactory,
      }
    })
  }

  return {
    httpRequestMock,
    httpsRequestMock,
    module: await import('../src/assistant/web-fetch.ts'),
  }
}

function createRequestMock(steps: MockRequestStep[]) {
  const queuedSteps = [...steps]

  return vi.fn((options: unknown, callback?: (response: import('node:http').IncomingMessage) => void) => {
    const step = queuedSteps.shift()
    if (!step) {
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`)
    }

    const listeners = new Map<string, Array<(error: Error) => void>>()

    return {
      end() {
        queueMicrotask(() => {
          if (step.type === 'error') {
            for (const listener of listeners.get('error') ?? []) {
              listener(step.error)
            }
            return
          }

          callback?.(createIncomingMessage(step.response))
        })
      },
      once(eventName: string, listener: (error: Error) => void) {
        const existing = listeners.get(eventName) ?? []
        existing.push(listener)
        listeners.set(eventName, existing)
        return this
      },
    }
  })
}

function createIncomingMessage(
  response: MockResponseDefinition,
): import('node:http').IncomingMessage {
  return Object.assign(
    Readable.from(normalizeResponseChunks(response.body)),
    {
      headers: response.headers ?? {},
      statusCode: response.status,
      statusMessage: response.statusText ?? 'OK',
    },
  ) as import('node:http').IncomingMessage
}

function normalizeResponseChunks(
  body: MockResponseDefinition['body'],
): Uint8Array[] {
  if (body === null || body === undefined) {
    return []
  }

  const encoder = new TextEncoder()
  const chunks = Array.isArray(body) ? body : [body]
  return chunks.map((chunk) =>
    typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
  )
}

function createLookupImplementation(
  addresses: MockLookupAddress[],
): LookupImplementation {
  const fallback = addresses[0] ?? { address: '127.0.0.1', family: 4 }
  const lookupImplementation = (async (
    _hostname: string,
    options?: number | { all?: boolean },
  ) => {
    if (typeof options === 'number') {
      return fallback
    }
    if (options?.all) {
      return addresses
    }
    return fallback
  }) as LookupImplementation

  return lookupImplementation
}
