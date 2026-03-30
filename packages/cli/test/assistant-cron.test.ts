import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  initializeVault,
  readJsonlRecords,
  toMonthlyShardRelativePath,
  upsertFood,
} from '@murph/core'
import { afterEach, beforeEach, test, vi } from 'vitest'

const cronServiceMocks = vi.hoisted(() => ({
  sendAssistantMessage: vi.fn(),
}))

vi.mock('../src/assistant/service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/service.ts')>(
    '../src/assistant/service.js',
  )

  return {
    ...actual,
    sendAssistantMessage: cronServiceMocks.sendAssistantMessage,
    sendAssistantMessageLocal: cronServiceMocks.sendAssistantMessage,
  }
})

import {
  addAssistantCronJob,
  buildAssistantCronSchedule,
  getAssistantCronPreset,
  getAssistantCronJob,
  getAssistantCronStatus,
  installAssistantCronPreset,
  listAssistantCronPresets,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobs,
  removeAssistantCronJob,
  runAssistantCronJobNow,
  setAssistantCronJobEnabled,
} from '../src/assistant/cron.ts'
import { computeAssistantCronNextRunAt } from '../src/assistant/cron/schedule.ts'
import { saveAssistantSelfDeliveryTarget } from '../src/operator-config.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
  vi.restoreAllMocks()
})

beforeEach(() => {
  cronServiceMocks.sendAssistantMessage.mockReset()
})

const testCronDeliveryTarget = {
  channel: 'telegram' as const,
  sourceThreadId: '123456789',
}

test('assistant cron presets stay separate from scheduler state until installed', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-preset-list-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const presets = listAssistantCronPresets()
  const mindfulnessPreset = getAssistantCronPreset('morning-mindfulness')
  const conditionPreset = getAssistantCronPreset('condition-research-roundup')
  const weeklyPreset = getAssistantCronPreset('weekly-health-snapshot')
  const listedJobs = await listAssistantCronJobs(vaultRoot)

  assert.ok(presets.some((preset) => preset.id === 'environment-health-watch'))
  assert.ok(presets.some((preset) => preset.id === 'morning-mindfulness'))
  assert.ok(presets.every((preset) => !('promptTemplate' in preset)))
  assert.equal(mindfulnessPreset.id, 'morning-mindfulness')
  assert.match(mindfulnessPreset.promptTemplate, /morning mindfulness prompt/u)
  assert.match(mindfulnessPreset.promptTemplate, /text-message friendly/u)
  assert.match(conditionPreset.promptTemplate, /Anchor the roundup to my own context first/u)
  assert.match(conditionPreset.promptTemplate, /plain language for a smart non-specialist/u)
  assert.match(conditionPreset.promptTemplate, /Do not end with a long source dump/u)
  assert.match(conditionPreset.promptTemplate, /worth watching next for me/u)
  assert.equal(weeklyPreset.title, 'Weekly health compass')
  assert.match(weeklyPreset.promptTemplate, /weekly health compass/u)
  assert.match(weeklyPreset.promptTemplate, /what changed, what stayed steady/u)
  assert.match(weeklyPreset.promptTemplate, /Do not sound like a nagging coach/u)
  assert.equal(mindfulnessPreset.suggestedSchedule.kind, 'cron')
  assert.equal(mindfulnessPreset.suggestedSchedule.expression, '0 7 * * *')
  assert.deepEqual(listedJobs, [])
})

test('assistant cron preset install rejects unknown preset variables', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-preset-invalid-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  await assert.rejects(
    () =>
      installAssistantCronPreset({
        vault: vaultRoot,
        presetId: 'condition-research-roundup',
        ...testCronDeliveryTarget,
        variables: {
          unsupported_key: 'value',
        },
      }),
    /does not define variable "unsupported_key"/u,
  )
})

test('assistant cron preset installs materialize regular cron jobs with resolved variables', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-preset-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const installed = await installAssistantCronPreset({
    vault: vaultRoot,
    presetId: 'morning-mindfulness',
    name: 'morning-mindfulness-text',
    ...testCronDeliveryTarget,
    variables: {
      practice_window: 'a 10 minute seated meditation before work',
      focus_for_today: 'breath awareness, relaxing my shoulders, and gratitude',
    },
    additionalInstructions: 'If you include a quote-like line, keep it short.',
    alias: 'routine:mindfulness',
  })

  assert.equal(installed.preset.id, 'morning-mindfulness')
  assert.equal(installed.job.name, 'morning-mindfulness-text')
  assert.equal(installed.job.schedule.kind, 'cron')
  assert.equal(installed.job.enabled, true)
  assert.equal(installed.job.target.channel, 'telegram')
  assert.equal(installed.job.target.alias, 'routine:mindfulness')
  assert.equal(installed.job.target.sourceThreadId, '123456789')
  assert.equal(installed.job.target.deliverResponse, true)
  assert.equal(
    installed.resolvedVariables.practice_window,
    'a 10 minute seated meditation before work',
  )
  assert.equal(
    installed.resolvedVariables.focus_for_today,
    'breath awareness, relaxing my shoulders, and gratitude',
  )
  assert.match(installed.resolvedPrompt, /10 minute seated meditation before work/u)
  assert.match(installed.resolvedPrompt, /relaxing my shoulders, and gratitude/u)
  assert.match(installed.resolvedPrompt, /text-message friendly/u)
  assert.match(installed.resolvedPrompt, /Additional user instructions/u)

  const listed = await listAssistantCronJobs(vaultRoot)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.jobId, installed.job.jobId)
})

test('assistant cron jobs reuse the sole saved self-delivery target when no route flags are provided', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-saved-target-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  try {
    await saveAssistantSelfDeliveryTarget(
      {
        channel: 'telegram',
        participantId: 'saved-chat',
        sourceThreadId: 'saved-chat',
        deliveryTarget: null,
        identityId: null,
      },
      homeRoot,
    )

    const installed = await installAssistantCronPreset({
      vault: vaultRoot,
      presetId: 'morning-mindfulness',
      name: 'saved-target-mindfulness',
    })

    assert.equal(installed.job.target.channel, 'telegram')
    assert.equal(installed.job.target.participantId, 'saved-chat')
    assert.equal(installed.job.target.sourceThreadId, 'saved-chat')
    assert.equal(installed.job.target.deliverResponse, true)
  } finally {
    process.env.HOME = originalHome
  }
})

test('assistant cron job creation preserves required-text validation errors', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-invalid-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  await assert.rejects(
    () =>
      addAssistantCronJob({
        vault: vaultRoot,
        name: '   ',
        prompt: 'Run a quick daily check-in.',
        ...testCronDeliveryTarget,
        schedule: buildAssistantCronSchedule({
          every: '2h',
        }),
      }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CRON_INVALID_INPUT')
      assert.equal(error.message, 'name must be a non-empty string.')
      return true
    },
  )

  await assert.rejects(
    () =>
      addAssistantCronJob({
        vault: vaultRoot,
        name: 'daily-check-in',
        prompt: '   ',
        ...testCronDeliveryTarget,
        schedule: buildAssistantCronSchedule({
          every: '2h',
        }),
      }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CRON_INVALID_INPUT')
      assert.equal(error.message, 'prompt must be a non-empty string.')
      return true
    },
  )
})

test('assistant cron jobs require explicit outbound delivery routing', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-delivery-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  try {
    await assert.rejects(
      () =>
        addAssistantCronJob({
          vault: vaultRoot,
          name: 'missing-route',
          prompt: 'Run a quick daily check-in.',
          schedule: buildAssistantCronSchedule({
            every: '2h',
          }),
        }),
      /must declare an outbound channel and delivery route/u,
    )

    await assert.rejects(
      () =>
        addAssistantCronJob({
          vault: vaultRoot,
          name: 'email-missing-identity',
          prompt: 'Send my weekly update.',
          schedule: buildAssistantCronSchedule({
            every: '1d',
          }),
          channel: 'email',
          deliveryTarget: 'me@example.com',
        }),
      /Email cron jobs require a configured email sender identity/u,
    )

    await assert.rejects(
      () =>
        addAssistantCronJob({
          vault: vaultRoot,
          name: 'explicitly-disabled-delivery',
          prompt: 'Send my weekly update.',
          schedule: buildAssistantCronSchedule({
            every: '1d',
          }),
          ...testCronDeliveryTarget,
          deliverResponse: false,
        }),
      /always deliver their response/u,
    )
  } finally {
    process.env.HOME = originalHome
  }
})

test('assistant cron jobs persist cleanly and can be enabled, disabled, and removed', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-store-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'stretch-reminder',
    prompt: 'Check whether I have been sitting too long and remind me to stretch.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      every: '2h',
    }),
    alias: 'routine:stretch',
  })

  assert.equal(job.name, 'stretch-reminder')
  assert.equal(job.schedule.kind, 'every')
  assert.equal(job.keepAfterRun, true)
  assert.equal(job.enabled, true)
  assert.equal(job.target.deliverResponse, true)
  assert.equal(job.state.nextRunAt !== null, true)

  const listed = await listAssistantCronJobs(vaultRoot)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.jobId, job.jobId)

  const status = await getAssistantCronStatus(vaultRoot)
  assert.equal(status.totalJobs, 1)
  assert.equal(status.enabledJobs, 1)
  assert.equal(status.runningJobs, 0)

  const disabled = await setAssistantCronJobEnabled(vaultRoot, 'stretch-reminder', false)
  assert.equal(disabled.enabled, false)

  const reenabled = await setAssistantCronJobEnabled(vaultRoot, job.jobId, true)
  assert.equal(reenabled.enabled, true)
  assert.equal(reenabled.state.nextRunAt !== null, true)

  const fetched = await getAssistantCronJob(vaultRoot, 'stretch-reminder')
  assert.equal(fetched.jobId, job.jobId)

  const removed = await removeAssistantCronJob(vaultRoot, job.jobId)
  assert.equal(removed.jobId, job.jobId)

  const afterStatus = await getAssistantCronStatus(vaultRoot)
  assert.equal(afterStatus.totalJobs, 0)
})

test('assistant cron jobs only bind assistant state when configured', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-state-doc-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const statelessJob = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'stateless-check-in',
    prompt: 'Check in quietly.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      every: '2h',
    }),
  })
  assert.equal(statelessJob.stateDocId, null)

  const defaultStatefulJob = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'stateful-check-in',
    prompt: 'Check in with carry-over state.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      every: '2h',
    }),
    bindState: true,
  })
  assert.equal(defaultStatefulJob.stateDocId, `cron/${defaultStatefulJob.jobId}`)

  const explicitStatefulJob = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'explicit-stateful-check-in',
    prompt: 'Check in with explicit state.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      every: '2h',
    }),
    stateDocId: 'cron/weekly-health-snapshot',
  })
  assert.equal(explicitStatefulJob.stateDocId, 'cron/weekly-health-snapshot')
})

test('assistant cron rejects invalid stateDocId bindings', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-invalid-state-doc-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  await assert.rejects(
    () =>
      addAssistantCronJob({
        vault: vaultRoot,
        name: 'invalid-state-binding',
        prompt: 'This should not be created.',
        ...testCronDeliveryTarget,
        schedule: buildAssistantCronSchedule({
          every: '2h',
        }),
        stateDocId: '../escape',
      }),
    /stateDocId must use slash-delimited segments/u,
  )
})

test('assistant cron assigns vault timezones to cron schedules and computes next runs in local time', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-timezone-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({
    vaultRoot,
    timezone: 'Australia/Melbourne',
  })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'morning-check-in',
    prompt: 'Send my morning check-in.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      cron: '0 8 * * *',
    }),
    now: new Date('2026-03-26T21:30:00.000Z'),
  })

  assert.equal(job.schedule.kind, 'cron')
  assert.equal(job.schedule.timeZone, 'Australia/Melbourne')
  assert.equal(job.state.nextRunAt, '2026-03-27T21:00:00.000Z')
})

test('assistant cron quarantines legacy stored cron jobs that are missing persisted timezones', async () => {
  vi.useFakeTimers()

  try {
    vi.setSystemTime(new Date('2026-03-26T21:30:00.000Z'))

    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-legacy-timezone-'))
    const vaultRoot = path.join(parent, 'vault')
    cleanupPaths.push(parent)

    await initializeVault({
      vaultRoot,
      timezone: 'Australia/Melbourne',
    })

    const job = await addAssistantCronJob({
      vault: vaultRoot,
      name: 'legacy-morning-check-in',
      prompt: 'Send my migrated morning check-in.',
      ...testCronDeliveryTarget,
      schedule: buildAssistantCronSchedule({
        cron: '0 8 * * *',
      }),
    })

    await setAssistantCronJobEnabled(vaultRoot, job.jobId, false)

    const paths = resolveAssistantStatePaths(vaultRoot)
    const store = JSON.parse(await readFile(paths.cronJobsPath, 'utf8')) as {
      version: number
      jobs: Array<Record<string, unknown>>
    }
    const legacyJob = store.jobs[0] as {
      schedule?: Record<string, unknown>
      state?: Record<string, unknown>
    }

    assert.equal(legacyJob.schedule?.kind, 'cron')
    delete legacyJob.schedule?.timeZone
    legacyJob.state = {
      ...(legacyJob.state ?? {}),
      nextRunAt: null,
    }

    await writeFile(paths.cronJobsPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')

    const listed = await listAssistantCronJobs(vaultRoot)
    assert.deepEqual(listed, [])

    const quarantineEntries = await readdir(
      path.join(paths.quarantineDirectory, 'cron-store'),
    )
    assert.equal(quarantineEntries.some((entry) => entry.endsWith('.meta.json')), true)
    assert.equal(
      quarantineEntries.some((entry) => entry.includes(path.basename(paths.cronJobsPath))),
      true,
    )
  } finally {
    vi.useRealTimers()
  }
})

test('assistant cron daily-local schedules stay pinned to local time across DST changes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-daily-local-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({
    vaultRoot,
    timezone: 'America/New_York',
  })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'food-daily:daily-oats',
    prompt: 'Auto-log recurring food "Daily Oats" as a note-only meal.',
    foodAutoLog: {
      foodId: 'food_daily_oats_01',
    },
    schedule: {
      kind: 'dailyLocal',
      localTime: '08:00',
      timeZone: 'America/New_York',
    },
    now: new Date('2026-03-07T13:30:00.000Z'),
  })

  assert.equal(job.schedule.kind, 'dailyLocal')
  assert.equal(job.state.nextRunAt, '2026-03-08T12:00:00.000Z')
})

test('assistant cron manual runs record history and remove completed one-shot jobs by default', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-run-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  cronServiceMocks.sendAssistantMessage.mockResolvedValue({
    vault: vaultRoot,
    status: 'completed',
    prompt: 'Remind me to drink water.',
    response: 'Drink water now.',
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: 'asst_cron_manual',
      provider: 'codex-cli',
      providerSessionId: null,
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: null,
        channel: null,
        identityId: null,
        actorId: null,
        threadId: null,
        threadIsDirect: null,
        delivery: null,
      },
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      lastTurnAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
    },
    delivery: null,
    deliveryDeferred: false,
    deliveryIntentId: null,
    deliveryError: null,
    blocked: null,
  })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'drink-water',
    prompt: 'Remind me to drink water.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      at: new Date(Date.now() + 60_000).toISOString(),
    }),
    bindState: true,
  })

  const result = await runAssistantCronJobNow({
    vault: vaultRoot,
    job: 'drink-water',
  })

  assert.equal(result.run.status, 'succeeded')
  assert.equal(result.removedAfterRun, true)
  assert.equal(result.run.sessionId, 'asst_cron_manual')
  assert.equal(result.run.response, 'Drink water now.')
  assert.equal(
    cronServiceMocks.sendAssistantMessage.mock.calls[0]?.[0]?.deliverResponse,
    true,
  )
  assert.equal(
    cronServiceMocks.sendAssistantMessage.mock.calls[0]?.[0]?.channel,
    'telegram',
  )
  assert.match(
    String(cronServiceMocks.sendAssistantMessage.mock.calls[0]?.[0]?.prompt ?? ''),
    /This cron job is bound to assistant state document/u,
  )
  assert.match(
    String(cronServiceMocks.sendAssistantMessage.mock.calls[0]?.[0]?.prompt ?? ''),
    new RegExp(job.stateDocId ?? '', 'u'),
  )

  await assert.rejects(
    () => getAssistantCronJob(vaultRoot, job.jobId),
    /ASSISTANT_CRON_JOB_NOT_FOUND|not found/u,
  )

  const history = await listAssistantCronRuns({
    vault: vaultRoot,
    job: job.jobId,
  })
  assert.equal(history.jobId, job.jobId)
  assert.equal(history.runs.length, 1)
  assert.equal(history.runs[0]?.status, 'succeeded')
})

test('assistant cron recurring food jobs auto-log derived note-only meals without invoking the assistant', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-food-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const food = await upsertFood({
    vaultRoot,
    title: 'Morning Smoothie',
    slug: 'morning-smoothie',
    note: 'Bone broth protein, inulin, GOS, creatine, and coconut water.',
    ingredients: [
      'bone broth protein',
      'inulin',
      'prebiotic GOS',
      'creatine',
      'coconut water',
    ],
    autoLogDaily: {
      time: '08:00',
    },
  })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'food-daily:morning-smoothie',
    prompt: 'Auto-log recurring food "Morning Smoothie" as a note-only meal.',
    schedule: buildAssistantCronSchedule({
      at: new Date(Date.now() + 60_000).toISOString(),
    }),
    foodAutoLog: {
      foodId: food.record.foodId,
    },
  })

  const result = await runAssistantCronJobNow({
    vault: vaultRoot,
    job: job.jobId,
  })
  const history = await listAssistantCronRuns({
    vault: vaultRoot,
    job: job.jobId,
  })
  const events = await readJsonlRecords({
    vaultRoot,
    relativePath: toMonthlyShardRelativePath('ledger/events', result.run.finishedAt),
  })
  const mealEvent = events.at(-1) as {
    kind?: string
    source?: string
    note?: string
  }

  assert.equal(result.run.status, 'succeeded')
  assert.equal(result.run.sessionId, null)
  assert.equal(result.removedAfterRun, true)
  assert.match(result.run.response ?? '', /Auto-logged recurring food "Morning Smoothie" as meal meal_/u)
  assert.equal(cronServiceMocks.sendAssistantMessage.mock.calls.length, 0)
  assert.equal(history.runs.length, 1)
  assert.equal(history.runs[0]?.status, 'succeeded')
  assert.equal(mealEvent.kind, 'meal')
  assert.equal(mealEvent.source, 'derived')
  assert.match(mealEvent.note ?? '', /Morning Smoothie/u)
  assert.match(mealEvent.note ?? '', /Ingredients:/u)
  assert.match(mealEvent.note ?? '', /bone broth protein/u)
})

test('assistant cron scheduler processes due jobs and backs off failed runs', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-due-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  cronServiceMocks.sendAssistantMessage.mockRejectedValue(new Error('provider down'))

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'due-failure',
    prompt: 'Run a quick daily check-in.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      every: '5m',
    }),
    now: new Date(Date.now() - 10 * 60_000),
  })

  const before = await getAssistantCronStatus(vaultRoot)
  assert.equal(before.dueJobs, 1)

  const processed = await processDueAssistantCronJobs({
    vault: vaultRoot,
    limit: 1,
  })
  assert.equal(processed.processed, 1)
  assert.equal(processed.succeeded, 0)
  assert.equal(processed.failed, 1)

  const updated = await getAssistantCronJob(vaultRoot, job.jobId)
  assert.equal(updated.state.consecutiveFailures, 1)
  assert.equal(updated.state.lastError, 'provider down')
  assert.equal(updated.state.runningAt, null)
  assert.equal(updated.state.nextRunAt !== null, true)
  assert.equal(Date.parse(updated.state.nextRunAt ?? '') > Date.now(), true)

  const history = await listAssistantCronRuns({
    vault: vaultRoot,
    job: job.jobId,
  })
  assert.equal(history.runs.length, 1)
  assert.equal(history.runs[0]?.status, 'failed')
  assert.equal(history.runs[0]?.error, 'provider down')
})
