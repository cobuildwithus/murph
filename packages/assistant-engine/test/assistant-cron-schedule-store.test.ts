import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
  AssistantCronJob,
  AssistantCronRunRecord,
  AssistantCronSchedule,
  AssistantCronTarget,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  buildAssistantCronSchedule,
  computeAssistantCronNextRunAt,
  findNextAssistantCronOccurrence,
  parseAssistantCronEveryDuration,
  validateAssistantCronExpression,
} from '../src/assistant/cron/schedule.ts'
import {
  appendAssistantCronRun,
  assertAssistantCronJobNameIsAvailable,
  buildAssistantCronTarget,
  isAssistantCronJobDue,
  readAssistantCronRuns,
  readAssistantCronStore,
  resolveAssistantCronJobFromStore,
  resolveAssistantCronJobIndex,
  resolveAssistantCronRunLookupId,
  sortAssistantCronJobs,
  writeAssistantCronStore,
  type AssistantCronStore,
} from '../src/assistant/cron/store.ts'
import { listAssistantQuarantineEntriesAtPaths } from '../src/assistant/quarantine.ts'
import { listAssistantRuntimeEventsAtPath } from '../src/assistant/runtime-events.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant cron schedule helpers', () => {
  it('requires exactly one schedule flag and normalizes valid --at and --cron inputs', () => {
    expectVaultCliError(
      () => buildAssistantCronSchedule({}),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /exactly one of --at, --every, or --cron/u,
    )
    expectVaultCliError(
      () => buildAssistantCronSchedule({ at: '2026-04-09T10:00:00.000Z', every: '1h' }),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /exactly one of --at, --every, or --cron/u,
    )

    expect(
      buildAssistantCronSchedule({
        at: '2026-04-09T10:00:00.000Z',
        now: new Date('2026-04-08T10:00:00.000Z'),
      }),
    ).toEqual({
      at: '2026-04-09T10:00:00.000Z',
      kind: 'at',
    })
    expect(
      buildAssistantCronSchedule({
        cron: '0 6 * * 7',
        timeZone: '  UTC  ',
      }),
    ).toEqual({
      expression: '0 6 * * 7',
      kind: 'cron',
      timeZone: 'UTC',
    })
  })

  it('rejects invalid and past --at values', () => {
    expectVaultCliError(
      () => buildAssistantCronSchedule({ at: 'not-a-date' }),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /valid ISO 8601/u,
    )
    expectVaultCliError(
      () =>
        buildAssistantCronSchedule({
          at: '2026-04-08T10:00:00.000Z',
          now: new Date('2026-04-08T10:00:00.000Z'),
        }),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /scheduled in the future/u,
    )
  })

  it('parses compound --every durations and rejects malformed values', () => {
    expect(
      buildAssistantCronSchedule({
        every: ' 1d2h3m4s5ms ',
      }),
    ).toEqual({
      everyMs: 93_784_005,
      kind: 'every',
    })
    expect(parseAssistantCronEveryDuration('2h30m')).toBe(9_000_000)
    expectVaultCliError(
      () => parseAssistantCronEveryDuration(''),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /must be a non-empty duration/u,
    )
    expectVaultCliError(
      () => parseAssistantCronEveryDuration('15m nope'),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /number\+unit pairs/u,
    )
  })

  it('validates cron expressions and rejects invalid field counts and ranges', () => {
    expect(() => validateAssistantCronExpression('*/15 9-17 * * 1-5')).not.toThrow()
    expect(() => validateAssistantCronExpression('0 0 * * 7')).not.toThrow()

    expectVaultCliError(
      () => validateAssistantCronExpression('0 0 * *'),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /five fields/u,
    )
    expectVaultCliError(
      () => validateAssistantCronExpression('0 0 * 13 *'),
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      /Invalid cron month field/u,
    )
  })

  it('computes deterministic next-run timestamps across schedule kinds', () => {
    const after = new Date('2026-04-08T08:29:30.500Z')

    expect(
      computeAssistantCronNextRunAt(
        {
          at: '2026-04-08T08:30:00.000Z',
          kind: 'at',
        },
        after,
      ),
    ).toBe('2026-04-08T08:30:00.000Z')
    expect(
      computeAssistantCronNextRunAt(
        {
          at: '2026-04-08T08:29:00.000Z',
          kind: 'at',
        },
        after,
      ),
    ).toBeNull()
    expect(
      computeAssistantCronNextRunAt(
        {
          everyMs: 90_000,
          kind: 'every',
        },
        after,
      ),
    ).toBe('2026-04-08T08:31:00.500Z')
    expect(
      computeAssistantCronNextRunAt(
        {
          expression: '30 8 * * *',
          kind: 'cron',
          timeZone: 'UTC',
        },
        after,
      ),
    ).toBe('2026-04-08T08:30:00.000Z')
    expect(
      computeAssistantCronNextRunAt(
        {
          kind: 'dailyLocal',
          localTime: '09:15',
          timeZone: 'UTC',
        },
        new Date('2026-04-08T09:15:00.000Z'),
      ),
    ).toBe('2026-04-09T09:15:00.000Z')
  })

  it('finds the next Sunday occurrence when cron day-of-week uses 7', () => {
    expect(
      findNextAssistantCronOccurrence(
        '0 0 * * 7',
        new Date('2026-04-11T23:58:00.000Z'),
        'UTC',
      ),
    ).toBe('2026-04-12T00:00:00.000Z')
  })
})

describe('assistant cron store helpers', () => {
  it('resolves jobs by id or name, canonicalizes run lookup ids, and enforces unique names', () => {
    const alpha = createCronJob({
      jobId: 'cron_alpha',
      name: 'alpha',
      nextRunAt: '2026-04-09T09:00:00.000Z',
    })
    const beta = createCronJob({
      jobId: 'cron_beta',
      name: 'beta',
      nextRunAt: '2026-04-09T10:00:00.000Z',
    })
    const store: AssistantCronStore = {
      jobs: [alpha, beta],
      version: 1,
    }

    expect(resolveAssistantCronJobIndex(store, 'cron_beta')).toBe(1)
    expect(resolveAssistantCronJobIndex(store, ' alpha ')).toBe(0)
    expect(resolveAssistantCronJobFromStore(store, 'beta')).toEqual(beta)
    expect(resolveAssistantCronRunLookupId(store, ' beta ')).toBe('cron_beta')
    expect(resolveAssistantCronRunLookupId(store, 'cron_missing')).toBe('cron_missing')
    expect(() => assertAssistantCronJobNameIsAvailable(store, 'gamma')).not.toThrow()
    expectVaultCliError(
      () => assertAssistantCronJobNameIsAvailable(store, 'alpha'),
      'ASSISTANT_CRON_JOB_EXISTS',
      /already exists/u,
    )
    expectVaultCliError(
      () => resolveAssistantCronJobIndex(store, 'missing'),
      'ASSISTANT_CRON_JOB_NOT_FOUND',
      /was not found/u,
    )
  })

  it('sorts jobs by next run, detects due jobs, and builds trimmed targets', () => {
    const alpha = createCronJob({
      jobId: 'cron_alpha',
      name: 'alpha',
      nextRunAt: '2026-04-09T09:00:00.000Z',
    })
    const beta = createCronJob({
      jobId: 'cron_beta',
      name: 'beta',
      nextRunAt: '2026-04-09T09:00:00.000Z',
    })
    const gamma = createCronJob({
      enabled: false,
      jobId: 'cron_gamma',
      name: 'gamma',
      nextRunAt: null,
    })

    expect(sortAssistantCronJobs([gamma, beta, alpha]).map((job) => job.name)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ])
    expect(
      isAssistantCronJobDue(
        createCronJob({
          jobId: 'cron_due',
          name: 'due',
          nextRunAt: '2026-04-08T08:00:00.000Z',
        }),
        '2026-04-08T08:00:00.000Z',
      ),
    ).toBe(true)
    expect(
      isAssistantCronJobDue(
        createCronJob({
          jobId: 'cron_running',
          name: 'running',
          nextRunAt: '2026-04-08T08:00:00.000Z',
          runningAt: '2026-04-08T08:00:00.000Z',
          runningPid: process.pid,
        }),
        '2026-04-08T08:01:00.000Z',
      ),
    ).toBe(false)
    expect(
      buildAssistantCronTarget({
        alias: '  morning  ',
        channel: '  telegram  ',
        deliverResponse: undefined,
        deliveryTarget: '  thread-123  ',
        identityId: '  ident-1  ',
        participantId: '  person-1  ',
        sessionId: '  asst_123  ',
        sourceThreadId: '  source-1  ',
      }),
    ).toEqual({
      alias: 'morning',
      channel: 'telegram',
      deliverResponse: false,
      deliveryTarget: 'thread-123',
      identityId: 'ident-1',
      participantId: 'person-1',
      sessionId: 'asst_123',
      sourceThreadId: 'source-1',
    })
  })
})

describe('assistant cron store filesystem edges', () => {
  it('returns an empty store for missing files and creates cron directories', async () => {
    const paths = await createAssistantPaths('assistant-cron-schedule-store-missing-')

    await expect(readAssistantCronStore(paths)).resolves.toEqual({
      jobs: [],
      version: 1,
    })

    expect((await stat(paths.cronDirectory)).isDirectory()).toBe(true)
    expect((await stat(paths.cronRunsDirectory)).isDirectory()).toBe(true)
  })

  it('writes stores to disk and clears stale running metadata on read', async () => {
    const paths = await createAssistantPaths('assistant-cron-schedule-store-roundtrip-')
    const activeJob = createCronJob({
      jobId: 'cron_active',
      name: 'active',
      runningAt: '2026-04-08T08:00:00.000Z',
      runningPid: process.pid,
    })
    const staleJob = createCronJob({
      jobId: 'cron_stale',
      name: 'stale',
      runningAt: '2026-04-08T08:30:00.000Z',
      runningPid: 999_999,
    })
    const store: AssistantCronStore = {
      jobs: [staleJob, activeJob],
      version: 1,
    }

    await writeAssistantCronStore(paths, store)

    expect(JSON.parse(await readFile(paths.cronJobsPath, 'utf8'))).toEqual(store)
    await expect(readAssistantCronStore(paths)).resolves.toEqual({
      jobs: [
        {
          ...staleJob,
          state: {
            ...staleJob.state,
            runningAt: null,
            runningPid: null,
          },
        },
        activeJob,
      ],
      version: 1,
    })
  })

  it('quarantines corrupted cron stores and records a runtime event', async () => {
    const paths = await createAssistantPaths('assistant-cron-schedule-store-corrupt-')

    await mkdir(path.dirname(paths.cronJobsPath), {
      recursive: true,
    })
    await writeFile(paths.cronJobsPath, '{not-valid-json', 'utf8')

    await expect(readAssistantCronStore(paths)).resolves.toEqual({
      jobs: [],
      version: 1,
    })
    await expect(readFile(paths.cronJobsPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'cron-store',
    })
    expect(quarantines).toHaveLength(1)
    expect(quarantines[0]).toMatchObject({
      artifactKind: 'cron-store',
      originalPath: paths.cronJobsPath,
    })

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents[0]).toMatchObject({
      entityId: 'jobs.json',
      entityType: 'cron-store',
      kind: 'cron.store.quarantined',
      level: 'warn',
    })
  })

  it('appends and reads cron runs in reverse started-at order', async () => {
    const paths = await createAssistantPaths('assistant-cron-schedule-store-runs-append-')
    const older = createCronRun({
      finishedAt: '2026-04-08T08:01:00.000Z',
      runId: 'cronrun_alpha_old',
      startedAt: '2026-04-08T08:00:00.000Z',
    })
    const newer = createCronRun({
      finishedAt: '2026-04-08T09:01:00.000Z',
      runId: 'cronrun_alpha_new',
      startedAt: '2026-04-08T09:00:00.000Z',
      trigger: 'manual',
    })

    await appendAssistantCronRun(paths, older)
    await appendAssistantCronRun(paths, newer)

    await expect(readAssistantCronRuns(paths, older.jobId)).resolves.toEqual([
      newer,
      older,
    ])
  })

  it('salvages truncated run tails but quarantines malformed committed run lines', async () => {
    const salvagePaths = await createAssistantPaths('assistant-cron-schedule-store-runs-salvage-')
    const run = createCronRun({
      runId: 'cronrun_alpha_salvage',
      startedAt: '2026-04-08T10:00:00.000Z',
    })

    await mkdir(salvagePaths.cronRunsDirectory, {
      recursive: true,
    })
    await writeFile(
      path.join(salvagePaths.cronRunsDirectory, `${run.jobId}.jsonl`),
      `${JSON.stringify(run)}\n{"schema":"murph.assistant-cron-run.v1"`,
      'utf8',
    )

    await expect(readAssistantCronRuns(salvagePaths, run.jobId)).resolves.toEqual([run])
    await expect(
      listAssistantQuarantineEntriesAtPaths(salvagePaths, {
        artifactKind: 'cron-run',
      }),
    ).resolves.toEqual([])

    const corruptPaths = await createAssistantPaths('assistant-cron-schedule-store-runs-corrupt-')
    const corruptPath = path.join(corruptPaths.cronRunsDirectory, `${run.jobId}.jsonl`)
    await mkdir(corruptPaths.cronRunsDirectory, {
      recursive: true,
    })
    await writeFile(corruptPath, `${JSON.stringify(run)}\nnot-json\n`, 'utf8')

    await expect(readAssistantCronRuns(corruptPaths, run.jobId)).resolves.toEqual([])
    await expect(readFile(corruptPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const quarantines = await listAssistantQuarantineEntriesAtPaths(corruptPaths, {
      artifactKind: 'cron-run',
    })
    expect(quarantines).toHaveLength(1)
    expect(quarantines[0]).toMatchObject({
      artifactKind: 'cron-run',
      originalPath: corruptPath,
    })

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(
      corruptPaths.runtimeEventsPath,
    )
    expect(runtimeEvents[0]).toMatchObject({
      entityId: `${run.jobId}.jsonl`,
      entityType: 'cron-run',
      kind: 'cron.run.quarantined',
      level: 'warn',
    })
  })
})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}

function createCronTarget(): AssistantCronTarget {
  return {
    alias: null,
    channel: null,
    deliverResponse: false,
    deliveryTarget: null,
    identityId: null,
    participantId: null,
    sessionId: null,
    sourceThreadId: null,
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
}): AssistantCronJob {
  return {
    createdAt: '2026-04-08T07:00:00.000Z',
    enabled: input.enabled ?? true,
    jobId: input.jobId,
    keepAfterRun: false,
    name: input.name,
    prompt: 'Check in on today.',
    schedule: input.schedule ?? {
      everyMs: 3_600_000,
      kind: 'every',
    },
    schema: 'murph.assistant-cron-job.v1',
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
    target: createCronTarget(),
    updatedAt: '2026-04-08T07:00:00.000Z',
  }
}

function createCronRun(input: {
  finishedAt?: string
  jobId?: string
  runId: string
  startedAt: string
  trigger?: AssistantCronRunRecord['trigger']
}): AssistantCronRunRecord {
  return {
    error: null,
    finishedAt: input.finishedAt ?? '2026-04-08T10:01:00.000Z',
    jobId: input.jobId ?? 'cron_alpha',
    response: null,
    responseLength: 0,
    runId: input.runId,
    schema: 'murph.assistant-cron-run.v1',
    sessionId: null,
    startedAt: input.startedAt,
    status: 'succeeded',
    trigger: input.trigger ?? 'scheduled',
  }
}

function expectVaultCliError(
  action: () => unknown,
  code: string,
  message: RegExp,
): void {
  try {
    action()
    throw new Error('expected VaultCliError')
  } catch (error) {
    expect(error).toBeInstanceOf(VaultCliError)
    if (!(error instanceof VaultCliError)) {
      throw error
    }
    expect(error.code).toBe(code)
    expect(error.message).toMatch(message)
  }
}
