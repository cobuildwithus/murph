import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  getAssistantCronPresetDefinition,
  listAssistantCronPresets,
  renderAssistantCronPreset,
} from '../src/assistant/cron/presets.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  ASSISTANT_CRON_CANONICAL_RUNNING_STALE_AFTER_MS,
  findAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import { appendAssistantCronRun, readAssistantCronStore } from '../src/assistant/cron/store.ts'
import { listAssistantCronRuns } from '../src/assistant/cron.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant cron preset seams', () => {
  it('lists preset metadata and returns trimmed preset definitions', () => {
    const presets = listAssistantCronPresets()
    const mindfulness = presets.find((preset) => preset.id === 'morning-mindfulness')

    expect(presets.length).toBeGreaterThan(0)
    expect(mindfulness).toMatchObject({
      category: 'mindfulness',
      id: 'morning-mindfulness',
      suggestedName: 'morning-mindfulness',
      suggestedSchedule: {
        expression: '0 7 * * *',
        kind: 'cron',
      },
      suggestedScheduleLabel: 'Daily at 7:00',
      title: 'Morning mindfulness',
    })
    expect(mindfulness).not.toBeNull()
    expect(mindfulness && 'promptTemplate' in mindfulness).toBe(false)

    const definition = getAssistantCronPresetDefinition(' morning-mindfulness ')
    expect(definition.promptTemplate).toContain('{{practice_window}}')
    expect(definition.promptTemplate).toContain('{{focus_for_today}}')
  })

  it('renders preset defaults, trims explicit values, and appends additional instructions', () => {
    const defaultRender = renderAssistantCronPreset({
      additionalInstructions: '   ',
      presetId: 'weekly-health-snapshot',
    })

    expect(defaultRender.resolvedVariables).toEqual({
      goals_and_experiments:
        'my current health goals and current investigations based on goals, experiments, protocols, recent logs, and memory; if any of that is missing, say what is not yet tracked',
      snapshot_focus:
        'what changed, what stayed steady, what was probably noise, the likely context behind the week, one thing worth keeping, one lightweight thing worth trying, and one thing not worth overreacting to',
    })
    expect(defaultRender.resolvedPrompt).toContain(
      'Use this as the goal and experiment context: my current health goals and current investigations based on goals, experiments, protocols, recent logs, and memory; if any of that is missing, say what is not yet tracked.',
    )
    expect(defaultRender.resolvedPrompt).not.toContain('Additional user instructions:')

    const explicitRender = renderAssistantCronPreset({
      additionalInstructions: '  Keep the final note to two short bullets.  ',
      presetId: 'weekly-health-snapshot',
      variables: {
        goals_and_experiments: '  lower LDL and protect sleep consistency  ',
        snapshot_focus: '  what changed and one thing to leave alone  ',
      },
    })

    expect(explicitRender.resolvedVariables).toEqual({
      goals_and_experiments: 'lower LDL and protect sleep consistency',
      snapshot_focus: 'what changed and one thing to leave alone',
    })
    expect(explicitRender.resolvedPrompt).toContain(
      'Use this as the goal and experiment context: lower LDL and protect sleep consistency.',
    )
    expect(explicitRender.resolvedPrompt).toContain(
      'Focus the analysis on: what changed and one thing to leave alone.',
    )
    expect(explicitRender.resolvedPrompt).toContain(
      'Additional user instructions:\nKeep the final note to two short bullets.',
    )
  })

  it('raises typed errors for blank preset ids, unknown presets, and unsupported variables', () => {
    expectVaultCliError(
      () => getAssistantCronPresetDefinition('   '),
      'ASSISTANT_CRON_PRESET_NOT_FOUND',
      /must be a non-empty string/u,
    )
    expectVaultCliError(
      () => getAssistantCronPresetDefinition('missing-preset'),
      'ASSISTANT_CRON_PRESET_NOT_FOUND',
      /"missing-preset" was not found/u,
    )
    expectVaultCliError(
      () =>
        renderAssistantCronPreset({
          presetId: 'morning-mindfulness',
          variables: {
            practice_window: '10 minute sit',
            unsupported: 'value',
          },
        }),
      'ASSISTANT_CRON_PRESET_INVALID_INPUT',
      /does not define variable "unsupported"/u,
    )
  })
})

describe('assistant cron canonical runtime store seams', () => {
  it('returns an empty store when the runtime file is missing', async () => {
    const paths = await createAssistantPaths('murph-assistant-cron-store-missing-')

    await expect(readAssistantCronCanonicalRuntimeStore(paths)).resolves.toEqual({
      jobs: [],
      version: 1,
    })
    expect(
      findAssistantCronCanonicalRuntimeRecord({ jobs: [], version: 1 }, 'job-a'),
    ).toBeNull()
  })

  it('creates records, upserts them in sorted order, and removes entries by job id', () => {
    const store: Awaited<ReturnType<typeof readAssistantCronCanonicalRuntimeStore>> = {
      jobs: [],
      version: 1 as const,
    }
    const betaRecord = createAssistantCronCanonicalRuntimeRecord({
      alias: 'beta-alias',
      jobId: 'beta',
      now: '2026-04-08T12:00:00.000Z',
      sessionId: 'session-beta',
    })
    const alphaRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: 'alpha',
      now: '2026-04-08T11:00:00.000Z',
    })
    const updatedBetaRecord = {
      ...betaRecord,
      state: {
        ...betaRecord.state,
        consecutiveFailures: 2,
        lastError: 'rate limited',
        lastFailedAt: '2026-04-08T12:30:00.000Z',
        pendingOccurrenceAt: '2026-04-09T10:00:00.000Z',
        retryAfterAt: '2026-04-09T10:00:00.000Z',
      },
      updatedAt: '2026-04-08T12:30:00.000Z',
    }

    expect(betaRecord).toMatchObject({
      alias: 'beta-alias',
      createdAt: '2026-04-08T12:00:00.000Z',
      jobId: 'beta',
      schema: 'murph.assistant-canonical-cron-runtime-state.v1',
      sessionId: 'session-beta',
      state: {
        activatedAt: '2026-04-08T12:00:00.000Z',
        consecutiveFailures: 0,
        lastError: null,
        lastFailedAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        pendingOccurrenceAt: null,
        retryAfterAt: null,
        runningAt: null,
        runningPid: null,
      },
      updatedAt: '2026-04-08T12:00:00.000Z',
    })
    expect(alphaRecord).toMatchObject({
      alias: null,
      jobId: 'alpha',
      schema: 'murph.assistant-canonical-cron-runtime-state.v1',
      sessionId: null,
      state: {
        activatedAt: '2026-04-08T11:00:00.000Z',
        pendingOccurrenceAt: null,
      },
    })

    expect(upsertAssistantCronCanonicalRuntimeRecord(store, betaRecord)).toBe(store)
    upsertAssistantCronCanonicalRuntimeRecord(store, alphaRecord)
    upsertAssistantCronCanonicalRuntimeRecord(store, updatedBetaRecord)

    expect(store.jobs.map((record) => record.jobId)).toEqual([
      'alpha',
      'beta',
    ])
    expect(findAssistantCronCanonicalRuntimeRecord(store, 'beta')).toEqual(updatedBetaRecord)
    expect(findAssistantCronCanonicalRuntimeRecord(store, 'missing')).toBeNull()

    expect(removeAssistantCronCanonicalRuntimeRecord(store, 'alpha')).toBe(true)
    expect(removeAssistantCronCanonicalRuntimeRecord(store, 'alpha')).toBe(false)
    expect(store.jobs).toEqual([updatedBetaRecord])
  })

  it('writes stores to disk and reads them back in normalized job-id order', async () => {
    const paths = await createAssistantPaths('murph-assistant-cron-store-roundtrip-')
    const betaRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: 'beta',
      now: '2026-04-08T12:00:00.000Z',
    })
    const alphaRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: 'alpha',
      now: '2026-04-08T11:00:00.000Z',
    })

    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [betaRecord, alphaRecord],
      version: 1,
    })

    expect(JSON.parse(await readFile(paths.cronAutomationStatePath, 'utf8'))).toEqual({
      jobs: [
        alphaRecord,
        betaRecord,
      ],
      version: 1,
    })
    await expect(readAssistantCronCanonicalRuntimeStore(paths)).resolves.toEqual({
      jobs: [alphaRecord, betaRecord],
      version: 1,
    })
  })

  it('clears stale canonical running claims during store normalization', async () => {
    const paths = await createAssistantPaths('murph-assistant-cron-store-stale-')
    const staleRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: 'stale',
      now: '2026-04-08T11:00:00.000Z',
    })
    const freshRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: 'fresh',
      now: '2026-04-08T12:30:00.000Z',
    })

    await mkdir(path.dirname(paths.cronAutomationStatePath), {
      recursive: true,
    })
    await writeFile(
      paths.cronAutomationStatePath,
      JSON.stringify(
        {
          jobs: [
            {
              ...staleRecord,
              state: {
                ...staleRecord.state,
                runningAt: '2026-04-08T11:30:00.000Z',
                runningPid: 123,
              },
            },
            {
              ...freshRecord,
              state: {
                ...freshRecord.state,
                runningAt: '2026-04-08T12:30:00.000Z',
                runningPid: 456,
              },
            },
          ],
          version: 1,
        },
        null,
        2,
      ),
      'utf8',
    )

    expect(JSON.parse(await readFile(paths.cronAutomationStatePath, 'utf8'))).toEqual({
      jobs: [
        expect.objectContaining({
          jobId: 'stale',
          state: expect.objectContaining({
            runningAt: '2026-04-08T11:30:00.000Z',
            runningPid: 123,
          }),
        }),
        expect.objectContaining({
          jobId: 'fresh',
          state: expect.objectContaining({
            runningAt: '2026-04-08T12:30:00.000Z',
            runningPid: 456,
          }),
        }),
      ],
      version: 1,
    })

    await expect(readAssistantCronCanonicalRuntimeStore(paths, {
      now: () => '2026-04-08T13:00:00.000Z',
    })).resolves.toEqual({
      jobs: [
        expect.objectContaining({
          jobId: 'fresh',
          state: expect.objectContaining({
            runningAt: '2026-04-08T12:30:00.000Z',
            runningPid: 456,
          }),
        }),
        expect.objectContaining({
          jobId: 'stale',
          state: expect.objectContaining({
            runningAt: null,
            runningPid: null,
          }),
        }),
      ],
      version: 1,
    })
  })

  it('uses injected stale-threshold policy for canonical running claim normalization', async () => {
    const paths = await createAssistantPaths('murph-assistant-cron-store-stale-policy-')
    const record = createAssistantCronCanonicalRuntimeRecord({
      jobId: 'threshold',
      now: '2026-04-08T11:00:00.000Z',
    })

    await mkdir(path.dirname(paths.cronAutomationStatePath), {
      recursive: true,
    })
    await writeFile(
      paths.cronAutomationStatePath,
      JSON.stringify(
        {
          jobs: [
            {
              ...record,
              state: {
                ...record.state,
                runningAt: '2026-04-08T11:30:00.000Z',
                runningPid: 123,
              },
            },
          ],
          version: 1,
        },
        null,
        2,
      ),
      'utf8',
    )

    await expect(readAssistantCronCanonicalRuntimeStore(paths, {
      now: () => '2026-04-08T11:45:00.000Z',
      runningStaleAfterMs: 10 * 60 * 1000,
    })).resolves.toEqual({
      jobs: [
        expect.objectContaining({
          jobId: 'threshold',
          state: expect.objectContaining({
            runningAt: null,
            runningPid: null,
          }),
        }),
      ],
      version: 1,
    })

    await expect(readAssistantCronCanonicalRuntimeStore(paths, {
      now: () => '2026-04-08T11:45:00.000Z',
      runningStaleAfterMs: ASSISTANT_CRON_CANONICAL_RUNNING_STALE_AFTER_MS,
    })).resolves.toEqual({
      jobs: [
        expect.objectContaining({
          jobId: 'threshold',
          state: expect.objectContaining({
            runningAt: '2026-04-08T11:30:00.000Z',
            runningPid: 123,
          }),
        }),
      ],
      version: 1,
    })
  })

  it('reads historical runs by raw id when the job no longer exists', async () => {
    const paths = await createAssistantPaths('assistant-cron-archived-history-')
    await appendAssistantCronRun(paths, {
      error: null,
      finishedAt: '2026-04-08T10:01:00.000Z',
      jobId: 'cron_archived',
      outcome: 'delivered',
      reason: 'sent',
      response: null,
      responseLength: 0,
      runId: 'cronrun_archived',
      schema: 'murph.assistant-cron-run.v1',
      sessionId: null,
      startedAt: '2026-04-08T10:00:00.000Z',
      trigger: 'scheduled',
    })
    await expect(listAssistantCronRuns({
      job: ' cron_archived ', vault: paths.absoluteVaultRoot,
    })).resolves.toMatchObject({
      jobId: 'cron_archived',
      runs: [{ runId: 'cronrun_archived', outcome: 'delivered' }],
    })
  })

  for (const [name, readStore, fileName] of [
    ['canonical runtime', readAssistantCronCanonicalRuntimeStore, 'cronAutomationStatePath'],
    ['queued occurrence', readAssistantCronStore, 'cronJobsPath'],
  ] as const) {
    it.each(['{not-valid-json', JSON.stringify({ version: 2, jobs: [] })])(
      `preserves unreadable ${name} evidence across repeated reads: %s`,
      async (raw) => {
        const paths = await createAssistantPaths('assistant-cron-preserved-')
        const filePath = paths[fileName]
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, raw, 'utf8')
        // Failure must remain failure on the next pass, never a fresh empty store.
        await expect(readStore(paths)).rejects.toThrow()
        await expect(readStore(paths)).rejects.toThrow()
        await expect(listAssistantCronRuns({
          job: 'morning-check-in', vault: paths.absoluteVaultRoot,
        })).rejects.toThrow()
        expect(await readFile(filePath, 'utf8')).toBe(raw)
      },
    )

    it(`propagates ${name} I/O failures without moving the evidence`, async () => {
      const paths = await createAssistantPaths('assistant-cron-unreadable-')
      const filePath = paths[fileName]
      await mkdir(filePath, { recursive: true })
      await expect(readStore(paths)).rejects.toMatchObject({ code: 'EISDIR' })
      await expect(readStore(paths)).rejects.toMatchObject({ code: 'EISDIR' })
      await expect(listAssistantCronRuns({
        job: 'morning-check-in', vault: paths.absoluteVaultRoot,
      })).rejects.toMatchObject({ code: 'EISDIR' })
    })
  }

})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
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
