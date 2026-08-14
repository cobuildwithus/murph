import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  initializeVault,
  readJsonlRecords,
  toMonthlyShardRelativePath,
  upsertFood,
} from '@murphai/core'
import { showAutomation } from '@murphai/query'
import { afterEach, beforeEach, test, vi } from 'vitest'

const cronServiceMocks = vi.hoisted(() => ({
  sendAssistantMessage: vi.fn(),
}))

vi.mock('@murphai/assistant-engine/assistant-service', async () => {
  const actual = await vi.importActual<typeof import('@murphai/assistant-engine/assistant-service')>(
    '@murphai/assistant-engine/assistant-service',
  )

  return {
    ...actual,
    sendAssistantNotificationLocal: cronServiceMocks.sendAssistantMessage,
    sendAssistantMessage: cronServiceMocks.sendAssistantMessage,
    sendAssistantMessageLocal: cronServiceMocks.sendAssistantMessage,
  }
})

import {
  addAssistantCronJob,
  buildAssistantCronSchedule,
  getAssistantCronPreset,
  getAssistantCronJob,
  getAssistantCronJobTarget,
  getAssistantCronStatus,
  installAssistantCronPreset,
  listAssistantCronPresets,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobs,
  removeAssistantCronJob,
  runAssistantCronJobNow,
  setAssistantCronJobTarget,
  setAssistantCronJobEnabled,
} from '@murphai/assistant-engine/assistant-cron'
import { saveAssistantSelfDeliveryTarget } from '@murphai/operator-config/operator-config'

const cleanupPaths: string[] = []
let previousHome: string | undefined

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = previousHome
  }
  previousHome = undefined

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

beforeEach(async () => {
  cronServiceMocks.sendAssistantMessage.mockReset()
  previousHome = process.env.HOME
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-home-'))
  cleanupPaths.push(homeRoot)
  process.env.HOME = homeRoot
})

const testCronDeliveryTarget = {
  channel: 'telegram' as const,
  threadId: '123456789',
}

test('assistant cron presets stay separate from scheduler state until installed', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-preset-list-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const presets = listAssistantCronPresets()
  const mindfulnessPreset = getAssistantCronPreset('morning-mindfulness')
  const environmentPreset = getAssistantCronPreset('environment-health-watch')
  const conditionPreset = getAssistantCronPreset('condition-research-roundup')
  const ingestiblePreset = getAssistantCronPreset('ingestible-watchlist')
  const frontierPreset = getAssistantCronPreset('longevity-frontier-roundup')
  const weeklyPreset = getAssistantCronPreset('weekly-health-snapshot')
  const listedJobs = await listAssistantCronJobs(vaultRoot)

  assert.ok(presets.some((preset) => preset.id === 'environment-health-watch'))
  assert.ok(presets.some((preset) => preset.id === 'morning-mindfulness'))
  assert.ok(presets.every((preset) => !('promptTemplate' in preset)))
  assert.equal(mindfulnessPreset.id, 'morning-mindfulness')
  assert.match(mindfulnessPreset.promptTemplate, /morning mindfulness prompt/u)
  assert.match(mindfulnessPreset.promptTemplate, /text-message friendly/u)
  assert.match(environmentPreset.promptTemplate, /do not call a separate research automation command/u)
  assert.match(environmentPreset.promptTemplate, /Anchor the audit to my own context first/u)
  assert.match(environmentPreset.promptTemplate, /Do not end with a long source dump/u)
  assert.match(conditionPreset.promptTemplate, /Anchor the roundup to my own context first/u)
  assert.match(conditionPreset.promptTemplate, /do not call a separate research automation command/u)
  assert.match(conditionPreset.promptTemplate, /plain language for a smart non-specialist/u)
  assert.match(conditionPreset.promptTemplate, /Do not end with a long source dump/u)
  assert.match(conditionPreset.promptTemplate, /worth watching next for me/u)
  assert.match(ingestiblePreset.promptTemplate, /do not call a separate research automation command/u)
  assert.match(ingestiblePreset.promptTemplate, /Anchor the review to my own context first/u)
  assert.match(ingestiblePreset.promptTemplate, /Do not end with a long source dump/u)
  assert.match(frontierPreset.promptTemplate, /do not call a separate research automation command/u)
  assert.match(frontierPreset.promptTemplate, /Anchor the roundup to my own context first/u)
  assert.match(frontierPreset.promptTemplate, /Do not end with a long source dump/u)
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
  assert.equal(installed.job.target.threadId, '123456789')
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

  const automation = await showAutomation(vaultRoot, installed.job.jobId)
  assert.equal(automation?.title, 'morning-mindfulness-text')
  assert.equal(automation?.status, 'active')
  assert.equal(automation?.route.channel, 'telegram')
  assert.equal(automation?.route.threadId, '123456789')
  assert.match(automation?.instructions ?? '', /10 minute seated meditation before work/u)
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
        deliverySource: null,
        participantId: 'saved-chat',
        threadId: 'saved-chat',
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
    assert.equal(installed.job.target.threadId, 'saved-chat')
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
    await saveAssistantSelfDeliveryTarget(
      {
        channel: 'email',
        deliverySource: null,
        deliveryTarget: 'retired@example.test',
        identityId: null,
        participantId: null,
        threadId: null,
      },
      homeRoot,
    )
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
      (error: unknown) => {
        assert.match(
          error instanceof Error ? error.message : String(error),
          /must declare an outbound channel and delivery route/u,
        )
        assert.doesNotMatch(
          error instanceof Error ? error.message : String(error),
          /email/u,
        )
        return true
      },
    )

    await assert.rejects(
      () =>
        addAssistantCronJob({
          vault: vaultRoot,
          name: 'email-hosted-target',
          prompt: 'Send my weekly update.',
          schedule: buildAssistantCronSchedule({
            every: '1d',
          }),
          channel: 'email',
          deliveryTarget: 'me@example.com',
        }),
      /Local email automation delivery is not supported/u,
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

  await assert.rejects(
    () => getAssistantCronJob(vaultRoot, job.jobId),
    /ASSISTANT_CRON_JOB_NOT_FOUND|not found/u,
  )

  const removedAutomation = await showAutomation(vaultRoot, job.jobId)
  assert.equal(removedAutomation?.status, 'archived')
})

test('assistant cron targets can be inspected and updated in place', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-target-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'weekly-health-snapshot',
    prompt: 'Send my weekly health snapshot.',
    schedule: buildAssistantCronSchedule({
      every: '1d',
    }),
    channel: 'telegram',
    threadId: 'chat-123',
    sessionId: 'session-target-test',
    alias: 'routine:weekly-health-snapshot',
  })

  const shown = await getAssistantCronJobTarget(vaultRoot, job.jobId)
  assert.equal(shown.jobId, job.jobId)
  assert.equal(shown.jobName, 'weekly-health-snapshot')
  assert.equal(shown.target.channel, 'telegram')
  assert.equal(shown.target.threadId, 'chat-123')
  assert.equal(shown.bindingDelivery?.kind, 'thread')
  assert.equal(shown.bindingDelivery?.target, 'chat-123')

  const updated = await setAssistantCronJobTarget({
    vault: vaultRoot,
    job: 'weekly-health-snapshot',
    channel: 'telegram',
    threadId: 'chat-456',
  })

  assert.equal(updated.changed, true)
  assert.equal(updated.continuityReset, false)
  assert.equal(updated.dryRun, false)
  assert.equal(updated.beforeTarget.target.channel, 'telegram')
  assert.equal(updated.afterTarget.target.channel, 'telegram')
  assert.equal(updated.afterTarget.target.threadId, 'chat-456')
  assert.equal(updated.job.target.sessionId, null)
  assert.equal(updated.job.target.alias, 'routine:weekly-health-snapshot')

  const reloaded = await getAssistantCronJob(vaultRoot, 'weekly-health-snapshot')
  assert.equal(reloaded.jobId, job.jobId)
  assert.equal(reloaded.target.channel, 'telegram')
  assert.equal(reloaded.target.threadId, 'chat-456')
  assert.equal(reloaded.target.sessionId, null)
  assert.equal(reloaded.target.alias, 'routine:weekly-health-snapshot')

  const reset = await setAssistantCronJobTarget({
    vault: vaultRoot,
    job: 'weekly-health-snapshot',
    channel: 'telegram',
    threadId: 'chat-456',
    resetContinuity: true,
  })

  assert.equal(reset.changed, false)
  assert.equal(reset.continuityReset, true)
  assert.equal(reset.job.target.sessionId, null)
  assert.equal(reset.job.target.alias, null)
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
  assert.equal(job.state.nextRunAt, '2026-03-27T21:00:00.000Z')
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
    name: 'daily-oats-reminder',
    prompt: 'Send a recurring breakfast reminder.',
    ...testCronDeliveryTarget,
    schedule: {
      kind: 'dailyLocal',
      localTime: '08:00',
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
      schema: 'murph.assistant-session.v1',
      sessionId: 'asst_cron_manual',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: null,
        codexCommand: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: null,
        sandbox: null,
      },
      resumeState: null,
      provider: 'codex-cli',
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
  })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'drink-water',
    prompt: 'Remind me to drink water.',
    ...testCronDeliveryTarget,
    schedule: buildAssistantCronSchedule({
      at: new Date(Date.now() + 60_000).toISOString(),
    }),
  })

  const result = await runAssistantCronJobNow({
    vault: vaultRoot,
    job: 'drink-water',
  })

  assert.equal(result.run.status, 'succeeded')
  assert.equal(result.removedAfterRun, true)
  assert.equal(result.run.sessionId, 'asst_cron_manual')
  assert.equal(result.run.response, 'Drink water now.')
  const instructions =
    cronServiceMocks.sendAssistantMessage.mock.calls[0]?.[0]?.instructions ?? ''
  assert.equal(
    instructions.startsWith('Remind me to drink water.\n\n'),
    true,
  )
  assert.match(
    instructions,
    /Independent automation authority \(engine-supplied\):/u,
  )
  assert.equal(
    cronServiceMocks.sendAssistantMessage.mock.calls[0]?.[0]?.channel,
    'telegram',
  )

  await assert.rejects(
    () => getAssistantCronJob(vaultRoot, job.jobId),
    /ASSISTANT_CRON_JOB_NOT_FOUND|not found/u,
  )

  const archived = await showAutomation(vaultRoot, job.jobId)
  assert.equal(archived?.status, 'archived')

  const history = await listAssistantCronRuns({
    vault: vaultRoot,
    job: job.jobId,
  })
  assert.equal(history.jobId, job.jobId)
  assert.equal(history.runs.length, 1)
  assert.equal(history.runs[0]?.status, 'succeeded')
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
