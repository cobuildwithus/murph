import assert from 'node:assert/strict'

import { beforeEach, test as baseTest, vi } from 'vitest'

const test = baseTest.sequential

const daemonMocks = vi.hoisted(() => ({
  maybeDrainAssistantOutboxViaDaemon: vi.fn(),
  maybeGetAssistantCronJobViaDaemon: vi.fn(),
  maybeGetAssistantCronStatusViaDaemon: vi.fn(),
  maybeGetAssistantCronTargetViaDaemon: vi.fn(),
  maybeGetAssistantOutboxIntentViaDaemon: vi.fn(),
  maybeGetAssistantSessionViaDaemon: vi.fn(),
  maybeGetAssistantStatusViaDaemon: vi.fn(),
  maybeListAssistantCronJobsViaDaemon: vi.fn(),
  maybeListAssistantCronRunsViaDaemon: vi.fn(),
  maybeListAssistantOutboxIntentsViaDaemon: vi.fn(),
  maybeListAssistantSessionsViaDaemon: vi.fn(),
  maybeOpenAssistantConversationViaDaemon: vi.fn(),
  maybeProcessDueAssistantCronViaDaemon: vi.fn(),
  maybeRunAssistantAutomationViaDaemon: vi.fn(),
  maybeSendAssistantMessageViaDaemon: vi.fn(),
  maybeSetAssistantCronTargetViaDaemon: vi.fn(),
  maybeUpdateAssistantSessionOptionsViaDaemon: vi.fn(),
}))

const serviceLocalMocks = vi.hoisted(() => ({
  openAssistantConversationLocal: vi.fn(),
  sendAssistantMessageLocal: vi.fn(),
  updateAssistantSessionOptionsLocal: vi.fn(),
}))

const storeLocalMocks = vi.hoisted(() => ({
  getAssistantSessionLocal: vi.fn(),
  listAssistantSessionsLocal: vi.fn(),
}))

const outboxLocalMocks = vi.hoisted(() => ({
  drainAssistantOutboxLocal: vi.fn(),
  listAssistantOutboxIntentsLocal: vi.fn(),
  readAssistantOutboxIntentLocal: vi.fn(),
}))

const statusLocalMocks = vi.hoisted(() => ({
  getAssistantStatusLocal: vi.fn(),
}))

const cronLocalMocks = vi.hoisted(() => ({
  getAssistantCronJobLocal: vi.fn(),
  getAssistantCronJobTargetLocal: vi.fn(),
  getAssistantCronStatusLocal: vi.fn(),
  listAssistantCronJobsLocal: vi.fn(),
  listAssistantCronRunsLocal: vi.fn(),
  processDueAssistantCronJobsLocal: vi.fn(),
  setAssistantCronJobTargetLocal: vi.fn(),
}))

const automationEngineMocks = vi.hoisted(() => ({
  runAssistantAutomationLocal: vi.fn(),
  scanAssistantAutomationOnce: vi.fn(),
  scanAssistantAutoReplyOnce: vi.fn(),
  scanAssistantInboxOnce: vi.fn(),
}))

const runtimeModuleMocks = vi.hoisted(() => ({
  runAssistantChat: vi.fn(),
}))

vi.mock('../src/assistant-daemon-client.js', () => daemonMocks)

vi.mock('@murphai/assistant-engine/assistant-service', () => ({
  openAssistantConversationLocal: serviceLocalMocks.openAssistantConversationLocal,
  sendAssistantMessageLocal: serviceLocalMocks.sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal: serviceLocalMocks.updateAssistantSessionOptionsLocal,
}))

vi.mock('@murphai/assistant-engine/assistant-store', () => ({
  getAssistantSessionLocal: storeLocalMocks.getAssistantSessionLocal,
  listAssistantSessionsLocal: storeLocalMocks.listAssistantSessionsLocal,
}))

vi.mock('@murphai/assistant-engine/assistant-outbox', () => ({
  drainAssistantOutboxLocal: outboxLocalMocks.drainAssistantOutboxLocal,
  listAssistantOutboxIntentsLocal: outboxLocalMocks.listAssistantOutboxIntentsLocal,
  readAssistantOutboxIntent: outboxLocalMocks.readAssistantOutboxIntentLocal,
}))

vi.mock('@murphai/assistant-engine/assistant-status', () => ({
  getAssistantStatusLocal: statusLocalMocks.getAssistantStatusLocal,
}))

vi.mock('@murphai/assistant-engine/assistant-cron', () => ({
  getAssistantCronJob: cronLocalMocks.getAssistantCronJobLocal,
  getAssistantCronJobTarget: cronLocalMocks.getAssistantCronJobTargetLocal,
  getAssistantCronStatus: cronLocalMocks.getAssistantCronStatusLocal,
  listAssistantCronJobs: cronLocalMocks.listAssistantCronJobsLocal,
  listAssistantCronRuns: cronLocalMocks.listAssistantCronRunsLocal,
  processDueAssistantCronJobsLocal: cronLocalMocks.processDueAssistantCronJobsLocal,
  setAssistantCronJobTarget: cronLocalMocks.setAssistantCronJobTargetLocal,
}))

vi.mock('@murphai/assistant-engine/assistant-automation', () => ({
  runAssistantAutomation: automationEngineMocks.runAssistantAutomationLocal,
  scanAssistantAutomationOnce: automationEngineMocks.scanAssistantAutomationOnce,
  scanAssistantAutoReplyOnce: automationEngineMocks.scanAssistantAutoReplyOnce,
  scanAssistantInboxOnce: automationEngineMocks.scanAssistantInboxOnce,
}))

vi.mock('../src/assistant-runtime.js', () => runtimeModuleMocks)

import * as assistantAutomationFacade from '../src/assistant/automation.ts'
import { runAssistantAutomation } from '../src/assistant/automation/run-loop.ts'
import * as assistantDaemonFacade from '../src/assistant/daemon-client.ts'
import {
  getAssistantCronJob,
  getAssistantCronJobTarget,
  getAssistantCronStatus,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobs,
  setAssistantCronJobTarget,
} from '../src/assistant/cron.ts'
import {
  drainAssistantOutbox,
  listAssistantOutboxIntents,
  readAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import * as assistantRuntimeFacade from '../src/assistant/runtime.ts'
import {
  openAssistantConversation,
  sendAssistantMessage,
  updateAssistantSessionOptions,
} from '../src/assistant/service.ts'
import { getAssistantStatus } from '../src/assistant/status.ts'
import {
  getAssistantSession,
  listAssistantSessions,
} from '../src/assistant/store.ts'

const TEST_VAULT = '/tmp/assistant-runtime-service-seams'

beforeEach(() => {
  for (const mock of [
    ...Object.values(daemonMocks),
    ...Object.values(serviceLocalMocks),
    ...Object.values(storeLocalMocks),
    ...Object.values(outboxLocalMocks),
    ...Object.values(statusLocalMocks),
    ...Object.values(cronLocalMocks),
    ...Object.values(automationEngineMocks),
    ...Object.values(runtimeModuleMocks),
  ]) {
    mock.mockReset()
  }
})

test('service wrappers prefer daemon responses and fall back to local implementations', async () => {
  daemonMocks.maybeOpenAssistantConversationViaDaemon.mockResolvedValueOnce({
    source: 'remote-open',
  })
  daemonMocks.maybeSendAssistantMessageViaDaemon.mockResolvedValueOnce(null)
  serviceLocalMocks.sendAssistantMessageLocal.mockResolvedValueOnce({
    source: 'local-send',
  })
  daemonMocks.maybeUpdateAssistantSessionOptionsViaDaemon.mockResolvedValueOnce(undefined)
  serviceLocalMocks.updateAssistantSessionOptionsLocal.mockResolvedValueOnce({
    source: 'local-update',
  })

  assert.deepEqual(
    await openAssistantConversation({
      alias: 'chat:demo',
      vault: TEST_VAULT,
    }),
    { source: 'remote-open' },
  )
  assert.deepEqual(
    await sendAssistantMessage({
      prompt: 'hello',
      vault: TEST_VAULT,
    }),
    { source: 'local-send' },
  )
  assert.deepEqual(
    await updateAssistantSessionOptions({
      providerOptions: {
        model: 'gpt-5.4',
      },
      sessionId: 'session_demo',
      vault: TEST_VAULT,
    }),
    { source: 'local-update' },
  )

  assert.deepEqual(
    daemonMocks.maybeOpenAssistantConversationViaDaemon.mock.calls[0]?.[0],
    {
      alias: 'chat:demo',
      vault: TEST_VAULT,
    },
  )
  assert.equal(serviceLocalMocks.openAssistantConversationLocal.mock.calls.length, 0)
  assert.equal(serviceLocalMocks.sendAssistantMessageLocal.mock.calls.length, 1)
  assert.equal(serviceLocalMocks.updateAssistantSessionOptionsLocal.mock.calls.length, 1)

  daemonMocks.maybeOpenAssistantConversationViaDaemon.mockResolvedValueOnce(null)
  serviceLocalMocks.openAssistantConversationLocal.mockResolvedValueOnce({
    source: 'local-open',
  })
  daemonMocks.maybeSendAssistantMessageViaDaemon.mockResolvedValueOnce({
    source: 'remote-send',
  })
  daemonMocks.maybeUpdateAssistantSessionOptionsViaDaemon.mockResolvedValueOnce({
    source: 'remote-update',
  })

  assert.deepEqual(
    await openAssistantConversation({
      alias: 'chat:local',
      vault: TEST_VAULT,
    }),
    { source: 'local-open' },
  )
  assert.deepEqual(
    await sendAssistantMessage({
      prompt: 'daemon send',
      vault: TEST_VAULT,
    }),
    { source: 'remote-send' },
  )
  assert.deepEqual(
    await updateAssistantSessionOptions({
      providerOptions: {
        model: 'remote',
      },
      sessionId: 'session_remote',
      vault: TEST_VAULT,
    }),
    { source: 'remote-update' },
  )
})

test('status wrapper normalizes string input for the daemon and preserves fallback input for local status', async () => {
  daemonMocks.maybeGetAssistantStatusViaDaemon.mockResolvedValueOnce(null)
  statusLocalMocks.getAssistantStatusLocal.mockResolvedValueOnce({
    source: 'local-status',
  })

  assert.deepEqual(await getAssistantStatus(TEST_VAULT), {
    source: 'local-status',
  })
  assert.deepEqual(
    daemonMocks.maybeGetAssistantStatusViaDaemon.mock.calls[0]?.[0],
    {
      limit: undefined,
      sessionId: null,
      vault: TEST_VAULT,
    },
  )
  assert.equal(statusLocalMocks.getAssistantStatusLocal.mock.calls[0]?.[0], TEST_VAULT)

  daemonMocks.maybeGetAssistantStatusViaDaemon.mockResolvedValueOnce({
    source: 'remote-status',
  })
  assert.deepEqual(
    await getAssistantStatus({
      limit: 3,
      sessionId: 'session_demo',
      vault: TEST_VAULT,
    }),
    { source: 'remote-status' },
  )
})

test('store and outbox wrappers distinguish null from undefined daemon responses', async () => {
  daemonMocks.maybeListAssistantSessionsViaDaemon.mockResolvedValueOnce([])
  daemonMocks.maybeGetAssistantSessionViaDaemon.mockResolvedValueOnce(null)
  storeLocalMocks.getAssistantSessionLocal.mockResolvedValueOnce({
    source: 'local-session',
  })
  daemonMocks.maybeGetAssistantOutboxIntentViaDaemon.mockResolvedValueOnce(null)
  daemonMocks.maybeListAssistantOutboxIntentsViaDaemon.mockResolvedValueOnce(null)
  outboxLocalMocks.listAssistantOutboxIntentsLocal.mockResolvedValueOnce([
    { source: 'local-list' },
  ])
  daemonMocks.maybeDrainAssistantOutboxViaDaemon.mockResolvedValueOnce({
    attempted: 1,
    failed: 0,
    queued: 0,
    sent: 1,
  })

  assert.deepEqual(await listAssistantSessions(TEST_VAULT), [])
  assert.equal(storeLocalMocks.listAssistantSessionsLocal.mock.calls.length, 0)
  assert.deepEqual(await getAssistantSession(TEST_VAULT, 'session_demo'), {
    source: 'local-session',
  })
  assert.equal(await readAssistantOutboxIntent(TEST_VAULT, 'intent_demo'), null)
  assert.equal(outboxLocalMocks.readAssistantOutboxIntentLocal.mock.calls.length, 0)
  assert.deepEqual(await listAssistantOutboxIntents(TEST_VAULT), [
    { source: 'local-list' },
  ])
  assert.deepEqual(
    await drainAssistantOutbox({
      limit: 1,
      vault: TEST_VAULT,
    }),
    {
      attempted: 1,
      failed: 0,
      queued: 0,
      sent: 1,
    },
  )

  daemonMocks.maybeListAssistantSessionsViaDaemon.mockResolvedValueOnce(null)
  storeLocalMocks.listAssistantSessionsLocal.mockResolvedValueOnce([
    { source: 'local-sessions' },
  ])
  daemonMocks.maybeGetAssistantSessionViaDaemon.mockResolvedValueOnce({
    source: 'remote-session',
  })
  daemonMocks.maybeGetAssistantOutboxIntentViaDaemon.mockResolvedValueOnce(undefined)
  outboxLocalMocks.readAssistantOutboxIntentLocal.mockResolvedValueOnce({
    source: 'local-intent',
  })
  daemonMocks.maybeListAssistantOutboxIntentsViaDaemon.mockResolvedValueOnce([
    { source: 'remote-intents' },
  ])
  daemonMocks.maybeDrainAssistantOutboxViaDaemon.mockResolvedValueOnce(null)
  outboxLocalMocks.drainAssistantOutboxLocal.mockResolvedValueOnce({
    attempted: 0,
    failed: 0,
    queued: 1,
    sent: 0,
  })

  assert.deepEqual(await listAssistantSessions(TEST_VAULT), [
    { source: 'local-sessions' },
  ])
  assert.deepEqual(await getAssistantSession(TEST_VAULT, 'session_remote'), {
    source: 'remote-session',
  })
  assert.deepEqual(await readAssistantOutboxIntent(TEST_VAULT, 'intent_local'), {
    source: 'local-intent',
  })
  assert.deepEqual(await listAssistantOutboxIntents(TEST_VAULT), [
    { source: 'remote-intents' },
  ])
  assert.deepEqual(
    await drainAssistantOutbox({
      limit: 2,
      vault: TEST_VAULT,
    }),
    {
      attempted: 0,
      failed: 0,
      queued: 1,
      sent: 0,
    },
  )
})

test('cron wrappers preserve daemon semantics and local fallbacks', async () => {
  daemonMocks.maybeListAssistantCronJobsViaDaemon.mockResolvedValueOnce([])
  daemonMocks.maybeGetAssistantCronJobViaDaemon.mockResolvedValueOnce(null)
  cronLocalMocks.getAssistantCronJobLocal.mockResolvedValueOnce({ source: 'local-job' })
  daemonMocks.maybeGetAssistantCronTargetViaDaemon.mockResolvedValueOnce({
    source: 'remote-target',
  })
  daemonMocks.maybeSetAssistantCronTargetViaDaemon.mockResolvedValueOnce(null)
  cronLocalMocks.setAssistantCronJobTargetLocal.mockResolvedValueOnce({
    source: 'local-target-update',
  })
  daemonMocks.maybeGetAssistantCronStatusViaDaemon.mockResolvedValueOnce(null)
  cronLocalMocks.getAssistantCronStatusLocal.mockResolvedValueOnce({
    source: 'local-status',
  })
  daemonMocks.maybeListAssistantCronRunsViaDaemon.mockResolvedValueOnce(null)
  cronLocalMocks.listAssistantCronRunsLocal.mockResolvedValueOnce({
    jobId: 'job_demo',
    runs: [],
  })
  daemonMocks.maybeProcessDueAssistantCronViaDaemon.mockResolvedValueOnce({
    source: 'remote-process',
  })

  assert.deepEqual(await listAssistantCronJobs(TEST_VAULT), [])
  assert.equal(cronLocalMocks.listAssistantCronJobsLocal.mock.calls.length, 0)
  assert.deepEqual(await getAssistantCronJob(TEST_VAULT, 'job_demo'), {
    source: 'local-job',
  })
  assert.deepEqual(await getAssistantCronJobTarget(TEST_VAULT, 'job_demo'), {
    source: 'remote-target',
  })
  assert.deepEqual(
    await setAssistantCronJobTarget({
      deliveryTarget: '@murph',
      job: 'job_demo',
      vault: TEST_VAULT,
    }),
    { source: 'local-target-update' },
  )
  assert.deepEqual(await getAssistantCronStatus(TEST_VAULT), {
    source: 'local-status',
  })
  assert.deepEqual(
    await listAssistantCronRuns({
      job: 'job_demo',
      limit: 2,
      vault: TEST_VAULT,
    }),
    {
      jobId: 'job_demo',
      runs: [],
    },
  )
  assert.deepEqual(
    await processDueAssistantCronJobs({
      limit: 1,
      vault: TEST_VAULT,
    }),
    { source: 'remote-process' },
  )

  daemonMocks.maybeListAssistantCronJobsViaDaemon.mockResolvedValueOnce(null)
  cronLocalMocks.listAssistantCronJobsLocal.mockResolvedValueOnce([
    { source: 'local-jobs' },
  ])
  daemonMocks.maybeGetAssistantCronJobViaDaemon.mockResolvedValueOnce({
    source: 'remote-job',
  })
  daemonMocks.maybeGetAssistantCronTargetViaDaemon.mockResolvedValueOnce(null)
  cronLocalMocks.getAssistantCronJobTargetLocal.mockResolvedValueOnce({
    source: 'local-target',
  })
  daemonMocks.maybeSetAssistantCronTargetViaDaemon.mockResolvedValueOnce({
    source: 'remote-target-update',
  })
  daemonMocks.maybeGetAssistantCronStatusViaDaemon.mockResolvedValueOnce({
    source: 'remote-status',
  })
  daemonMocks.maybeListAssistantCronRunsViaDaemon.mockResolvedValueOnce({
    jobId: 'job_remote',
    runs: [{ source: 'remote-run' }],
  })
  daemonMocks.maybeProcessDueAssistantCronViaDaemon.mockResolvedValueOnce(null)
  cronLocalMocks.processDueAssistantCronJobsLocal.mockResolvedValueOnce({
    source: 'local-process',
  })

  assert.deepEqual(await listAssistantCronJobs(TEST_VAULT), [
    { source: 'local-jobs' },
  ])
  assert.deepEqual(await getAssistantCronJob(TEST_VAULT, 'job_remote'), {
    source: 'remote-job',
  })
  assert.deepEqual(await getAssistantCronJobTarget(TEST_VAULT, 'job_local'), {
    source: 'local-target',
  })
  assert.deepEqual(
    await setAssistantCronJobTarget({
      deliveryTarget: '@remote',
      job: 'job_remote',
      vault: TEST_VAULT,
    }),
    { source: 'remote-target-update' },
  )
  assert.deepEqual(await getAssistantCronStatus(TEST_VAULT), {
    source: 'remote-status',
  })
  assert.deepEqual(
    await listAssistantCronRuns({
      job: 'job_remote',
      vault: TEST_VAULT,
    }),
    {
      jobId: 'job_remote',
      runs: [{ source: 'remote-run' }],
    },
  )
  assert.deepEqual(
    await processDueAssistantCronJobs({
      limit: 2,
      vault: TEST_VAULT,
    }),
    { source: 'local-process' },
  )
})

test('assistant automation run loop only uses the daemon for remote-safe inputs', async () => {
  daemonMocks.maybeRunAssistantAutomationViaDaemon.mockResolvedValueOnce({
    source: 'remote-run',
  })
  automationEngineMocks.runAssistantAutomationLocal.mockResolvedValueOnce({
    source: 'local-run',
  })

  assert.deepEqual(
    await runAssistantAutomation({
      once: true,
      requestId: undefined,
      vault: TEST_VAULT,
    }),
    { source: 'remote-run' },
  )
  assert.deepEqual(
    daemonMocks.maybeRunAssistantAutomationViaDaemon.mock.calls[0]?.[0],
    {
      allowSelfAuthored: undefined,
      deliveryDispatchMode: undefined,
      drainOutbox: undefined,
      maxPerScan: undefined,
      modelSpec: undefined,
      once: true,
      requestId: null,
      sessionMaxAgeMs: null,
      startDaemon: undefined,
      vault: TEST_VAULT,
    },
  )

  assert.deepEqual(
    await runAssistantAutomation({
      once: true,
      onEvent: () => undefined,
      vault: TEST_VAULT,
    }),
    { source: 'local-run' },
  )
  assert.equal(daemonMocks.maybeRunAssistantAutomationViaDaemon.mock.calls.length, 1)
  assert.equal(automationEngineMocks.runAssistantAutomationLocal.mock.calls.length, 1)
})

test('assistant facade modules re-export the package runtime and daemon-aware seams', () => {
  assert.equal(assistantRuntimeFacade.runAssistantChat, runtimeModuleMocks.runAssistantChat)
  assert.equal(
    assistantAutomationFacade.runAssistantAutomation,
    runAssistantAutomation,
  )
  assert.equal(
    assistantAutomationFacade.scanAssistantAutomationOnce,
    automationEngineMocks.scanAssistantAutomationOnce,
  )
  assert.equal(
    assistantAutomationFacade.scanAssistantAutoReplyOnce,
    automationEngineMocks.scanAssistantAutoReplyOnce,
  )
  assert.equal(
    assistantAutomationFacade.scanAssistantInboxOnce,
    automationEngineMocks.scanAssistantInboxOnce,
  )
  assert.equal(
    assistantDaemonFacade.maybeGetAssistantStatusViaDaemon,
    daemonMocks.maybeGetAssistantStatusViaDaemon,
  )
})
