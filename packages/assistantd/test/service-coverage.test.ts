import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'

const gatewayAdapters = vi.hoisted(() => ({
  messageSender: { kind: 'message-sender' },
  sourceReader: { kind: 'source-reader' },
}))

const mocks = vi.hoisted(() => ({
  createAssistantFoodAutoLogHooks: vi.fn(() => ({ kind: 'food-hooks' })),
  createIntegratedInboxServices: vi.fn(() => ({ kind: 'inbox-services' })),
  createIntegratedVaultServices: vi.fn(() => ({ kind: 'vault-services' })),
  createLocalGatewayService: vi.fn(() => ({ kind: 'gateway-service' })),
  drainAssistantOutbox: vi.fn(async (input) => ({ input, ok: 'drain' })),
  getAssistantCronJob: vi.fn(async (vault, job) => ({ job, vault })),
  getAssistantCronJobTarget: vi.fn(async (vault, job) => ({ job, vault })),
  getAssistantCronStatus: vi.fn(async (vault) => ({ vault })),
  getAssistantSession: vi.fn(async (vault, sessionId) => ({ sessionId, vault })),
  getAssistantStatus: vi.fn(async (input) => ({ input })),
  listAssistantCronJobs: vi.fn(async (vault) => ([vault])),
  listAssistantCronRuns: vi.fn(async (input) => ({ input })),
  listAssistantOutboxIntents: vi.fn(async (vault) => ([vault])),
  listAssistantSessions: vi.fn(async (vault) => ([vault])),
  openAssistantConversation: vi.fn(async (input) => ({
    created: true,
    session: {
      sessionId: 'session_service_test',
      vault: input.vault,
    },
  })),
  processDueAssistantCronJobs: vi.fn(async (input) => ({ input })),
  readAssistantOutboxIntent: vi.fn(async (vault, intentId) => ({ intentId, vault })),
  runAssistantAutomation: vi.fn(async (input) => ({ input })),
  sendAssistantMessage: vi.fn(async (input) => ({ input })),
  setAssistantCronJobTarget: vi.fn(async (input) => ({ input })),
  updateAssistantSessionOptions: vi.fn(async (input) => ({ input })),
}))

vi.mock('@murphai/assistant-engine', () => ({
  createAssistantFoodAutoLogHooks: mocks.createAssistantFoodAutoLogHooks,
  drainAssistantOutbox: mocks.drainAssistantOutbox,
  getAssistantCronJob: mocks.getAssistantCronJob,
  getAssistantCronJobTarget: mocks.getAssistantCronJobTarget,
  getAssistantCronStatus: mocks.getAssistantCronStatus,
  getAssistantSession: mocks.getAssistantSession,
  getAssistantStatus: mocks.getAssistantStatus,
  listAssistantCronJobs: mocks.listAssistantCronJobs,
  listAssistantCronRuns: mocks.listAssistantCronRuns,
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
  listAssistantSessions: mocks.listAssistantSessions,
  openAssistantConversation: mocks.openAssistantConversation,
  processDueAssistantCronJobs: mocks.processDueAssistantCronJobs,
  readAssistantOutboxIntent: mocks.readAssistantOutboxIntent,
  runAssistantAutomation: mocks.runAssistantAutomation,
  sendAssistantMessage: mocks.sendAssistantMessage,
  setAssistantCronJobTarget: mocks.setAssistantCronJobTarget,
  updateAssistantSessionOptions: mocks.updateAssistantSessionOptions,
}))

vi.mock('@murphai/inbox-services', () => ({
  createIntegratedInboxServices: mocks.createIntegratedInboxServices,
}))

vi.mock('@murphai/vault-usecases', () => ({
  createIntegratedVaultServices: mocks.createIntegratedVaultServices,
}))

vi.mock('@murphai/gateway-local', () => ({
  createLocalGatewayService: mocks.createLocalGatewayService,
}))

vi.mock('@murphai/assistant-engine/gateway-local-adapter', () => ({
  assistantGatewayLocalMessageSender: gatewayAdapters.messageSender,
  assistantGatewayLocalProjectionSourceReader: gatewayAdapters.sourceReader,
}))

import {
  createAssistantLocalService,
  type AssistantLocalService,
} from '../src/service.js'

const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'
const ORIGINAL_DISABLE_CLIENT = process.env[ASSISTANTD_DISABLE_CLIENT_ENV]
const TEST_VAULT_ROOT = '/tmp/assistantd-service-vault'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env[ASSISTANTD_DISABLE_CLIENT_ENV]
})

afterEach(() => {
  if (ORIGINAL_DISABLE_CLIENT === undefined) {
    delete process.env[ASSISTANTD_DISABLE_CLIENT_ENV]
    return
  }
  process.env[ASSISTANTD_DISABLE_CLIENT_ENV] = ORIGINAL_DISABLE_CLIENT
})

test('createAssistantLocalService wires the local integrations and forwards assistant-engine calls with normalized inputs', async () => {
  const service = createAssistantLocalService(TEST_VAULT_ROOT)

  assert.equal(process.env[ASSISTANTD_DISABLE_CLIENT_ENV], '1')
  assert.deepEqual(mocks.createIntegratedInboxServices.mock.calls, [[]])
  assert.deepEqual(mocks.createAssistantFoodAutoLogHooks.mock.calls, [[]])
  assert.deepEqual(mocks.createIntegratedVaultServices.mock.calls, [
    [{ foodAutoLogHooks: { kind: 'food-hooks' } }],
  ])
  assert.deepEqual(mocks.createLocalGatewayService.mock.calls, [
    [
      TEST_VAULT_ROOT,
      {
        messageSender: gatewayAdapters.messageSender,
        sourceReader: gatewayAdapters.sourceReader,
      },
    ],
  ])
  assert.deepEqual(service.gateway, { kind: 'gateway-service' })
  assert.equal(service.vault, TEST_VAULT_ROOT)
  const health = await service.health()
  assert.equal(health.ok, true)
  assert.equal(health.vaultBound, true)

  await service.drainOutbox({
    limit: 3.9,
    now: '2026-03-28T00:00:00.000Z',
    vault: TEST_VAULT_ROOT,
  })
  await service.getCronJob({ job: 'cron_job_test', vault: TEST_VAULT_ROOT })
  await service.getCronTarget({ job: 'cron_job_test', vault: TEST_VAULT_ROOT })
  await service.getCronStatus({ vault: TEST_VAULT_ROOT })
  await service.getOutboxIntent({ intentId: 'outbox_service_test', vault: TEST_VAULT_ROOT })
  await service.getSession({ sessionId: 'session_service_test', vault: TEST_VAULT_ROOT })
  await service.getStatus({
    limit: 7.8,
    sessionId: 'session_service_test',
    vault: TEST_VAULT_ROOT,
  })
  await service.listSessions({ vault: TEST_VAULT_ROOT })
  await service.listCronJobs({ vault: TEST_VAULT_ROOT })
  await service.listCronRuns({
    job: 'cron_job_test',
    limit: 5.2,
    vault: TEST_VAULT_ROOT,
  })
  await service.listOutbox({ vault: TEST_VAULT_ROOT })
  const openConversation = await service.openConversation({
    prompt: 'start a conversation',
    vault: TEST_VAULT_ROOT,
  } as Parameters<AssistantLocalService['openConversation']>[0])
  await service.processDueCron({
    deliveryDispatchMode: 'queue-only',
    limit: 4.7,
    vault: TEST_VAULT_ROOT,
  })
  await service.setCronTarget({
    channel: 'email',
    deliveryTarget: 'person@example.com',
    dryRun: true,
    identityId: 'sender@example.com',
    job: 'cron_job_test',
    participantId: null,
    resetContinuity: true,
    sourceThreadId: null,
    vault: TEST_VAULT_ROOT,
  })
  await service.runAutomationOnce({
    allowSelfAuthored: true,
    deliveryDispatchMode: 'queue-only',
    drainOutbox: true,
    maxPerScan: 11,
    once: false,
    scanIntervalMs: 1234,
    vault: TEST_VAULT_ROOT,
  })
  await service.runAutomationOnce()
  await service.sendMessage({
    prompt: 'hello',
    vault: TEST_VAULT_ROOT,
  } as Parameters<AssistantLocalService['sendMessage']>[0])
  await service.updateSessionOptions({
    providerOptions: { model: 'gpt-5.4' },
    sessionId: 'session_service_test',
    vault: TEST_VAULT_ROOT,
  } as Parameters<AssistantLocalService['updateSessionOptions']>[0])

  assert.equal(openConversation.created, true)
  assert.equal(openConversation.session.sessionId, 'session_service_test')
  assert.deepEqual(mocks.drainAssistantOutbox.mock.calls[0], [
    {
      limit: 3,
      now: new Date('2026-03-28T00:00:00.000Z'),
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.getAssistantCronJob.mock.calls[0], [
    TEST_VAULT_ROOT,
    'cron_job_test',
  ])
  assert.deepEqual(mocks.getAssistantCronJobTarget.mock.calls[0], [
    TEST_VAULT_ROOT,
    'cron_job_test',
  ])
  assert.deepEqual(mocks.getAssistantCronStatus.mock.calls[0], [TEST_VAULT_ROOT])
  assert.deepEqual(mocks.readAssistantOutboxIntent.mock.calls[0], [
    TEST_VAULT_ROOT,
    'outbox_service_test',
  ])
  assert.deepEqual(mocks.getAssistantSession.mock.calls[0], [
    TEST_VAULT_ROOT,
    'session_service_test',
  ])
  assert.deepEqual(mocks.getAssistantStatus.mock.calls[0], [
    {
      limit: 7,
      sessionId: 'session_service_test',
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.listAssistantSessions.mock.calls[0], [TEST_VAULT_ROOT])
  assert.deepEqual(mocks.listAssistantCronJobs.mock.calls[0], [TEST_VAULT_ROOT])
  assert.deepEqual(mocks.listAssistantCronRuns.mock.calls[0], [
    {
      job: 'cron_job_test',
      limit: 5,
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.listAssistantOutboxIntents.mock.calls[0], [TEST_VAULT_ROOT])
  assert.deepEqual(mocks.openAssistantConversation.mock.calls[0], [
    {
      prompt: 'start a conversation',
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.processDueAssistantCronJobs.mock.calls[0], [
    {
      deliveryDispatchMode: 'queue-only',
      limit: 4,
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.setAssistantCronJobTarget.mock.calls[0], [
    {
      channel: 'email',
      deliveryTarget: 'person@example.com',
      dryRun: true,
      identityId: 'sender@example.com',
      job: 'cron_job_test',
      participantId: undefined,
      resetContinuity: true,
      sourceThreadId: undefined,
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.runAssistantAutomation.mock.calls[0], [
    {
      allowSelfAuthored: true,
      deliveryDispatchMode: 'queue-only',
      drainOutbox: true,
      inboxServices: { kind: 'inbox-services' },
      maxPerScan: 11,
      modelSpec: undefined,
      once: false,
      requestId: null,
      scanIntervalMs: 1234,
      sessionMaxAgeMs: null,
      startDaemon: false,
      vault: TEST_VAULT_ROOT,
      vaultServices: { kind: 'vault-services' },
    },
  ])
  assert.deepEqual(mocks.runAssistantAutomation.mock.calls[1], [
    {
      allowSelfAuthored: undefined,
      deliveryDispatchMode: undefined,
      drainOutbox: undefined,
      inboxServices: { kind: 'inbox-services' },
      maxPerScan: undefined,
      modelSpec: undefined,
      once: true,
      requestId: null,
      scanIntervalMs: undefined,
      sessionMaxAgeMs: null,
      startDaemon: false,
      vault: TEST_VAULT_ROOT,
      vaultServices: { kind: 'vault-services' },
    },
  ])
  assert.deepEqual(mocks.sendAssistantMessage.mock.calls[0], [
    {
      prompt: 'hello',
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.updateAssistantSessionOptions.mock.calls[0], [
    {
      providerOptions: { model: 'gpt-5.4' },
      sessionId: 'session_service_test',
      vault: TEST_VAULT_ROOT,
    },
  ])
})

test('createAssistantLocalService rejects requests that target a different vault', async () => {
  const service = createAssistantLocalService(TEST_VAULT_ROOT)

  assert.throws(
    () => service.listSessions({ vault: '/tmp/other-vault' }),
    /bound to \/tmp\/assistantd-service-vault/u,
  )
  assert.throws(
    () => service.getSession({
      sessionId: 'session_service_test',
      vault: '/tmp/other-vault',
    }),
    /bound to \/tmp\/assistantd-service-vault/u,
  )
})

test('createAssistantLocalService drops non-finite optional values to the engine defaults', async () => {
  const service = createAssistantLocalService(TEST_VAULT_ROOT)

  await service.drainOutbox({
    limit: Number.NaN,
    now: null,
    vault: TEST_VAULT_ROOT,
  })
  await service.getStatus({
    limit: Number.POSITIVE_INFINITY,
    vault: TEST_VAULT_ROOT,
  })
  await service.listCronRuns({
    job: 'cron_job_test',
    limit: Number.NaN,
    vault: TEST_VAULT_ROOT,
  })
  await service.processDueCron({
    limit: Number.NaN,
    vault: TEST_VAULT_ROOT,
  })
  await service.setCronTarget({
    channel: null,
    deliveryTarget: null,
    identityId: null,
    job: 'cron_job_test',
    participantId: null,
    sourceThreadId: null,
    vault: TEST_VAULT_ROOT,
  })

  assert.deepEqual(mocks.drainAssistantOutbox.mock.calls.at(-1), [
    {
      limit: undefined,
      now: undefined,
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.getAssistantStatus.mock.calls.at(-1), [
    {
      limit: undefined,
      sessionId: null,
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.listAssistantCronRuns.mock.calls.at(-1), [
    {
      job: 'cron_job_test',
      limit: undefined,
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.processDueAssistantCronJobs.mock.calls.at(-1), [
    {
      deliveryDispatchMode: undefined,
      limit: undefined,
      vault: TEST_VAULT_ROOT,
    },
  ])
  assert.deepEqual(mocks.setAssistantCronJobTarget.mock.calls.at(-1), [
    {
      channel: undefined,
      deliveryTarget: undefined,
      dryRun: undefined,
      identityId: undefined,
      job: 'cron_job_test',
      participantId: undefined,
      resetContinuity: undefined,
      sourceThreadId: undefined,
      vault: TEST_VAULT_ROOT,
    },
  ])
})
