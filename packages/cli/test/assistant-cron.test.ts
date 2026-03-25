import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test, vi } from 'vitest'

const cronServiceMocks = vi.hoisted(() => ({
  sendAssistantMessage: vi.fn(),
}))

vi.mock('../src/assistant/service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/service.js')>(
    '../src/assistant/service.js',
  )

  return {
    ...actual,
    sendAssistantMessage: cronServiceMocks.sendAssistantMessage,
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
} from '../src/assistant/cron.js'

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

test('assistant cron presets stay separate from scheduler state until installed', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-preset-list-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const presets = listAssistantCronPresets()
  const conditionPreset = getAssistantCronPreset('condition-research-roundup')
  const listedJobs = await listAssistantCronJobs(vaultRoot)

  assert.ok(presets.some((preset) => preset.id === 'environment-health-watch'))
  assert.equal(conditionPreset.id, 'condition-research-roundup')
  assert.match(conditionPreset.promptTemplate, /condition or goal/u)
  assert.match(conditionPreset.promptTemplate, /research tool/u)
  assert.equal(conditionPreset.suggestedSchedule.kind, 'cron')
  assert.deepEqual(listedJobs, [])
})

test('assistant cron preset install rejects unknown preset variables', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-preset-invalid-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  await assert.rejects(
    () =>
      installAssistantCronPreset({
        vault: vaultRoot,
        presetId: 'condition-research-roundup',
        variables: {
          unsupported_key: 'value',
        },
      }),
    /does not define variable "unsupported_key"/u,
  )
})

test('assistant cron preset installs materialize regular cron jobs with resolved variables', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-preset-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const installed = await installAssistantCronPreset({
    vault: vaultRoot,
    presetId: 'condition-research-roundup',
    name: 'cholesterol-research-roundup',
    variables: {
      condition_or_goal: 'lowering LDL cholesterol',
    },
    additionalInstructions: 'Call out anything that seems immediately actionable.',
    alias: 'research:cholesterol',
  })

  assert.equal(installed.preset.id, 'condition-research-roundup')
  assert.equal(installed.job.name, 'cholesterol-research-roundup')
  assert.equal(installed.job.schedule.kind, 'cron')
  assert.equal(installed.job.enabled, true)
  assert.equal(installed.job.target.alias, 'research:cholesterol')
  assert.equal(
    installed.resolvedVariables.condition_or_goal,
    'lowering LDL cholesterol',
  )
  assert.match(installed.resolvedPrompt, /lowering LDL cholesterol/u)
  assert.match(installed.resolvedPrompt, /research tool/u)
  assert.match(installed.resolvedPrompt, /Additional user instructions/u)

  const listed = await listAssistantCronJobs(vaultRoot)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.jobId, installed.job.jobId)
})

test('assistant cron jobs persist cleanly and can be enabled, disabled, and removed', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-store-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'stretch-reminder',
    prompt: 'Check whether I have been sitting too long and remind me to stretch.',
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
})

test('assistant cron manual runs record history and remove completed one-shot jobs by default', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-run-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  cronServiceMocks.sendAssistantMessage.mockResolvedValue({
    vault: vaultRoot,
    prompt: 'Remind me to drink water.',
    response: 'Drink water now.',
    session: {
      schema: 'healthybob.assistant-session.v2',
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
    deliveryError: null,
  })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'drink-water',
    prompt: 'Remind me to drink water.',
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

test('assistant cron scheduler processes due jobs and backs off failed runs', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-due-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  cronServiceMocks.sendAssistantMessage.mockRejectedValue(new Error('provider down'))

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'due-failure',
    prompt: 'Run a quick daily check-in.',
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
