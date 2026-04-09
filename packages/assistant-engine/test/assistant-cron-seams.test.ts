import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  getAssistantCronPresetDefinition,
  listAssistantCronPresets,
  renderAssistantCronPreset,
} from '../src/assistant/cron/presets.ts'
import {
  createAssistantCronAutomationRuntimeRecord,
  findAssistantCronAutomationRuntimeRecord,
  readAssistantCronAutomationRuntimeStore,
  removeAssistantCronAutomationRuntimeRecord,
  upsertAssistantCronAutomationRuntimeRecord,
  writeAssistantCronAutomationRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
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

describe('assistant cron automation runtime store seams', () => {
  it('returns an empty store when the automation runtime file is missing', async () => {
    const paths = await createAssistantPaths('murph-assistant-cron-store-missing-')

    await expect(readAssistantCronAutomationRuntimeStore(paths)).resolves.toEqual({
      automations: [],
      version: 1,
    })
    expect(
      findAssistantCronAutomationRuntimeRecord(
        { automations: [], version: 1 },
        'a-1',
      ),
    ).toBeNull()
  })

  it('creates records, upserts them in sorted order, and removes entries by automation id', () => {
    const store: Awaited<ReturnType<typeof readAssistantCronAutomationRuntimeStore>> = {
      automations: [],
      version: 1 as const,
    }
    const betaRecord = createAssistantCronAutomationRuntimeRecord({
      alias: 'beta-alias',
      automationId: 'beta',
      nextRunAt: '2026-04-09T09:00:00.000Z',
      now: '2026-04-08T12:00:00.000Z',
      sessionId: 'session-beta',
    })
    const alphaRecord = createAssistantCronAutomationRuntimeRecord({
      automationId: 'alpha',
      nextRunAt: null,
      now: '2026-04-08T11:00:00.000Z',
    })
    const updatedBetaRecord = {
      ...betaRecord,
      state: {
        ...betaRecord.state,
        consecutiveFailures: 2,
        lastError: 'rate limited',
        lastFailedAt: '2026-04-08T12:30:00.000Z',
        nextRunAt: '2026-04-09T10:00:00.000Z',
      },
      updatedAt: '2026-04-08T12:30:00.000Z',
    }

    expect(betaRecord).toMatchObject({
      alias: 'beta-alias',
      automationId: 'beta',
      createdAt: '2026-04-08T12:00:00.000Z',
      sessionId: 'session-beta',
      state: {
        consecutiveFailures: 0,
        lastError: null,
        lastFailedAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        nextRunAt: '2026-04-09T09:00:00.000Z',
        runningAt: null,
        runningPid: null,
      },
      updatedAt: '2026-04-08T12:00:00.000Z',
    })
    expect(alphaRecord).toMatchObject({
      alias: null,
      automationId: 'alpha',
      sessionId: null,
      state: {
        nextRunAt: null,
      },
    })

    expect(upsertAssistantCronAutomationRuntimeRecord(store, betaRecord)).toBe(store)
    upsertAssistantCronAutomationRuntimeRecord(store, alphaRecord)
    upsertAssistantCronAutomationRuntimeRecord(store, updatedBetaRecord)

    expect(store.automations.map((record) => record.automationId)).toEqual([
      'alpha',
      'beta',
    ])
    expect(findAssistantCronAutomationRuntimeRecord(store, 'beta')).toEqual(
      updatedBetaRecord,
    )
    expect(findAssistantCronAutomationRuntimeRecord(store, 'missing')).toBeNull()

    expect(removeAssistantCronAutomationRuntimeRecord(store, 'alpha')).toBe(true)
    expect(removeAssistantCronAutomationRuntimeRecord(store, 'alpha')).toBe(false)
    expect(store.automations).toEqual([updatedBetaRecord])
  })

  it('writes stores to disk and reads them back in normalized automation-id order', async () => {
    const paths = await createAssistantPaths('murph-assistant-cron-store-roundtrip-')
    const betaRecord = createAssistantCronAutomationRuntimeRecord({
      automationId: 'beta',
      nextRunAt: '2026-04-09T09:00:00.000Z',
      now: '2026-04-08T12:00:00.000Z',
    })
    const alphaRecord = createAssistantCronAutomationRuntimeRecord({
      automationId: 'alpha',
      nextRunAt: '2026-04-09T08:00:00.000Z',
      now: '2026-04-08T11:00:00.000Z',
    })

    await writeAssistantCronAutomationRuntimeStore(paths, {
      automations: [betaRecord, alphaRecord],
      version: 1,
    })

    expect(JSON.parse(await readFile(paths.cronAutomationStatePath, 'utf8'))).toEqual({
      automations: [betaRecord, alphaRecord],
      version: 1,
    })
    await expect(readAssistantCronAutomationRuntimeStore(paths)).resolves.toEqual({
      automations: [alphaRecord, betaRecord],
      version: 1,
    })
  })

  it('quarantines corrupted runtime stores and falls back to an empty store', async () => {
    const paths = await createAssistantPaths('murph-assistant-cron-store-corrupt-')

    await mkdir(path.dirname(paths.cronAutomationStatePath), {
      recursive: true,
    })
    await writeFile(paths.cronAutomationStatePath, '{not-valid-json', 'utf8')

    await expect(readAssistantCronAutomationRuntimeStore(paths)).resolves.toEqual({
      automations: [],
      version: 1,
    })
    await expect(readFile(paths.cronAutomationStatePath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'cron-store',
    })
    expect(quarantines).toHaveLength(1)
    expect(quarantines[0]).toMatchObject({
      artifactKind: 'cron-store',
      metadataPath: `${quarantines[0]?.quarantinedPath}.meta.json`,
      originalPath: paths.cronAutomationStatePath,
    })
    await expect(readFile(quarantines[0]!.quarantinedPath, 'utf8')).resolves.toBe(
      '{not-valid-json',
    )

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents).toHaveLength(1)
    expect(runtimeEvents[0]).toMatchObject({
      component: 'state',
      entityId: 'automation-runtime.json',
      entityType: 'cron-store',
      kind: 'cron.store.quarantined',
      level: 'warn',
    })
  })
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
