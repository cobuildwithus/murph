import assert from 'node:assert/strict'
import { test } from 'vitest'
import { startAssistantHttpServer } from '../src/http.js'
import {
  AssistantHttpRequestError,
  buildAssistantHttpErrorPayload,
  parseAssistantAutomationRunRequestBody,
  parseAssistantCronTargetSetRequestBody,
  parseAssistantMessageRequestBody,
  parseAssistantOutboxDrainRequestBody,
  parseAssistantSessionRoute,
  resolveAssistantHttpErrorStatus,
} from '../src/http-protocol.js'
import type { AssistantLocalService } from '../src/service.js'

const TEST_CRON_JOB = {
  schema: 'murph.assistant-cron-job.v1',
  jobId: 'cron_http_test',
  name: 'daily-checkin',
  enabled: true,
  keepAfterRun: true,
  prompt: 'Send a quick check-in.',
  schedule: {
    kind: 'every',
    everyMs: 86_400_000,
  },
  target: {
    sessionId: 'session_http_test',
    alias: null,
    channel: 'telegram',
    identityId: null,
    participantId: 'chat-123',
    sourceThreadId: 'chat-123',
    deliveryTarget: null,
    deliverResponse: true,
  },
  createdAt: '2026-04-09T00:00:00.000Z',
  updatedAt: '2026-04-09T00:00:00.000Z',
  state: {
    nextRunAt: '2026-04-10T00:00:00.000Z',
    lastRunAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    consecutiveFailures: 0,
    lastError: null,
    runningAt: null,
    runningPid: null,
  },
} as const

function createGatewayServiceMock(): AssistantLocalService['gateway'] {
  return {
    fetchAttachments: async () => [],
    getConversation: async () => null,
    listConversations: async () => ({
      conversations: [],
      nextCursor: null,
    }),
    listOpenPermissions: async () => [],
    pollEvents: async (input) => ({
      events: [],
      nextCursor: input?.cursor ?? 0,
      live: true,
    }),
    readMessages: async () => ({
      messages: [],
      nextCursor: null,
    }),
    respondToPermission: async () => null,
    sendMessage: async (input) => ({
      sessionKey: input.sessionKey,
      messageId: 'gwcm_http_test',
      queued: false,
      delivery: null,
    }),
    waitForEvents: async (input) => ({
      events: [],
      nextCursor: input?.cursor ?? 0,
      live: true,
    }),
  } as AssistantLocalService['gateway']
}

function createAssistantServiceMock(): AssistantLocalService {
  return {
    drainOutbox: async () => ({ attempted: 0, failed: 0, queued: 0, sent: 0 }),
    gateway: createGatewayServiceMock(),
    getCronJob: async () => TEST_CRON_JOB,
    getCronStatus: async () => ({
      dueJobs: 0,
      enabledJobs: 0,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 0,
    }),
    getCronTarget: async () => ({
      bindingDelivery: null,
      jobId: TEST_CRON_JOB.jobId,
      jobName: TEST_CRON_JOB.name,
      target: TEST_CRON_JOB.target,
    }),
    getOutboxIntent: async () => null,
    getSession: async () => ({
      alias: null,
      binding: {
        actorId: null,
        channel: null,
        conversationKey: null,
        delivery: null,
        identityId: null,
        threadId: null,
        threadIsDirect: null,
      },
      createdAt: '2026-04-09T00:00:00.000Z',
      lastTurnAt: null,
      provider: 'codex-cli',
      providerBinding: null,
      providerOptions: {
        approvalPolicy: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: null,
        sandbox: null,
      },
      resumeState: null,
      schema: 'murph.assistant-session.v4',
      sessionId: 'session_http_test',
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
      turnCount: 0,
      updatedAt: '2026-04-09T00:00:00.000Z',
    }),
    getStatus: async () => ({
      automation: {
        autoReply: [],
        inboxScanCursor: null,
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
      diagnostics: {
        counters: {
          automationScans: 0,
          deliveriesFailed: 0,
          deliveriesQueued: 0,
          deliveriesRetryable: 0,
          deliveriesSent: 0,
          outboxDrains: 0,
          outboxRetries: 0,
          providerAttempts: 0,
          providerFailovers: 0,
          providerFailures: 0,
          turnsCompleted: 0,
          turnsDeferred: 0,
          turnsFailed: 0,
          turnsStarted: 0,
        },
        lastErrorAt: null,
        lastEventAt: null,
        recentWarnings: [],
        schema: 'murph.assistant-diagnostics.v1',
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
      diagnosticsPath: '/tmp/vault/.runtime/operations/assistant/diagnostics.snapshot.json',
      failover: {
        routes: [],
        schema: 'murph.assistant-failover-state.v1',
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
      failoverStatePath: '/tmp/vault/.runtime/operations/assistant/failover.json',
      generatedAt: '2026-04-09T00:00:00.000Z',
      outbox: {
        abandoned: 0,
        failed: 0,
        nextAttemptAt: null,
        oldestPendingAt: null,
        pending: 0,
        retryable: 0,
        sending: 0,
        sent: 0,
        total: 0,
      },
      outboxRoot: '/tmp/vault/.runtime/operations/assistant/outbox',
      quarantine: {
        byKind: {},
        recent: [],
        total: 0,
      },
      recentTurns: [],
      runLock: {
        command: null,
        mode: null,
        pid: null,
        reason: null,
        startedAt: null,
        state: 'unlocked',
      },
      runtimeBudget: {
        caches: [],
        maintenance: {
          lastRunAt: null,
          notes: [],
          staleLocksCleared: 0,
          staleProviderRecoveryPruned: 0,
          staleQuarantinePruned: 0,
        },
        schema: 'murph.assistant-runtime-budget.v1',
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
      stateRoot: '/tmp/vault/.runtime/operations/assistant',
      statusPath: '/tmp/vault/.runtime/operations/assistant/status.json',
      turnsRoot: '/tmp/vault/.runtime/operations/assistant/turns',
      vault: '/tmp/vault',
      warnings: [],
    }),
    health: async () => ({
      generatedAt: '2026-04-09T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    listCronJobs: async () => [],
    listCronRuns: async () => ({
      jobId: 'cron_http_test',
      runs: [],
    }),
    listOutbox: async () => [],
    listSessions: async () => [],
    openConversation: async () => ({
      created: false,
      session: {
        alias: null,
        binding: {
          actorId: null,
          channel: null,
          conversationKey: null,
          delivery: null,
          identityId: null,
          threadId: null,
          threadIsDirect: null,
        },
        createdAt: '2026-04-09T00:00:00.000Z',
        lastTurnAt: null,
        provider: 'codex-cli',
        providerBinding: null,
        providerOptions: {
          approvalPolicy: null,
          model: null,
          oss: false,
          profile: null,
          reasoningEffort: null,
          sandbox: null,
        },
        resumeState: null,
        schema: 'murph.assistant-session.v4',
        sessionId: 'session_http_test',
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
        turnCount: 0,
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
    }),
    processDueCron: async () => ({ failed: 0, processed: 0, succeeded: 0 }),
    runAutomationOnce: async () => ({
      considered: 0,
      daemonStarted: false,
      failed: 0,
      lastError: null,
      noAction: 0,
      reason: 'completed',
      replied: 0,
      replyConsidered: 0,
      replyFailed: 0,
      replySkipped: 0,
      routed: 0,
      scans: 0,
      skipped: 0,
      startedAt: '2026-04-09T00:00:00.000Z',
      stoppedAt: '2026-04-09T00:00:00.000Z',
      vault: '/tmp/vault',
    }),
    sendMessage: async () => ({
      blocked: null,
      delivery: null,
      deliveryDeferred: false,
      deliveryError: null,
      deliveryIntentId: null,
      prompt: 'noop',
      response: 'noop',
      session: {
        alias: null,
        binding: {
          actorId: null,
          channel: null,
          conversationKey: null,
          delivery: null,
          identityId: null,
          threadId: null,
          threadIsDirect: null,
        },
        createdAt: '2026-04-09T00:00:00.000Z',
        lastTurnAt: null,
        provider: 'codex-cli',
        providerBinding: null,
        providerOptions: {
          approvalPolicy: null,
          model: null,
          oss: false,
          profile: null,
          reasoningEffort: null,
          sandbox: null,
        },
        resumeState: null,
        schema: 'murph.assistant-session.v4',
        sessionId: 'session_http_test',
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
        turnCount: 0,
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
      status: 'completed',
      vault: '/tmp/vault',
    }),
    setCronTarget: async () => ({
      afterTarget: {
        bindingDelivery: null,
        jobId: 'cron_http_test',
        jobName: 'daily-checkin',
        target: TEST_CRON_JOB.target,
      },
      beforeTarget: {
        bindingDelivery: null,
        jobId: 'cron_http_test',
        jobName: 'daily-checkin',
        target: TEST_CRON_JOB.target,
      },
      changed: false,
      continuityReset: false,
      dryRun: false,
      job: TEST_CRON_JOB,
    }),
    updateSessionOptions: async () => ({
      alias: null,
      binding: {
        actorId: null,
        channel: null,
        conversationKey: null,
        delivery: null,
        identityId: null,
        threadId: null,
        threadIsDirect: null,
      },
      createdAt: '2026-04-09T00:00:00.000Z',
      lastTurnAt: null,
      provider: 'codex-cli',
      providerBinding: null,
      providerOptions: {
        approvalPolicy: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: null,
        sandbox: null,
      },
      resumeState: null,
      schema: 'murph.assistant-session.v4',
      sessionId: 'session_http_test',
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
      turnCount: 0,
      updatedAt: '2026-04-09T00:00:00.000Z',
    }),
    vault: '/tmp/vault',
  } as AssistantLocalService
}

test('startAssistantHttpServer binds a loopback listener and serves health checks', async () => {
  const handle = await startAssistantHttpServer({
    controlToken: 'secret-token',
    host: '127.0.0.1',
    port: 0,
    service: createAssistantServiceMock(),
  })

  try {
    assert.match(handle.address.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/u)
    assert.equal(handle.address.host, '127.0.0.1')
    assert.ok(handle.address.port > 0)

    const response = await fetch(`${handle.address.baseUrl}/healthz`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      generatedAt: '2026-04-09T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    })
  } finally {
    await handle.close()
  }
})

test('assistantd http protocol helpers map malformed routes and explicit error branches', () => {
  assert.throws(
    () => parseAssistantSessionRoute(new URL('http://localhost/sessions/%E0%A4%A')),
    /invalid encoding/u,
  )

  assert.equal(resolveAssistantHttpErrorStatus(new SyntaxError('bad json')), 400)
  assert.equal(
    resolveAssistantHttpErrorStatus(
      Object.assign(new Error('bad runtime id'), {
        code: 'ASSISTANT_STATE_INVALID_DOC_ID',
      }),
    ),
    400,
  )
  assert.equal(
    resolveAssistantHttpErrorStatus(
      new AssistantHttpRequestError('teapot', 418, 'ASSISTANT_HTTP_TEST'),
    ),
    418,
  )

  assert.deepEqual(
    buildAssistantHttpErrorPayload(
      new AssistantHttpRequestError('bad request', 400, 'ASSISTANT_INVALID_RUNTIME_ID'),
      400,
    ),
    {
      code: 'ASSISTANT_INVALID_RUNTIME_ID',
      error: 'bad request',
    },
  )
  assert.deepEqual(buildAssistantHttpErrorPayload('plain failure', 400), {
    error: 'Assistant daemon request failed.',
  })
})

test('assistantd http protocol validates optional object and finite-number fields', () => {
  assert.throws(
    () =>
      parseAssistantMessageRequestBody({
        modelSpec: 'gpt-5.4',
        prompt: 'hello',
      }),
    /request field modelSpec must be a JSON object/u,
  )

  assert.throws(
    () =>
      parseAssistantAutomationRunRequestBody({
        maxPerScan: '7',
      }),
    /request field maxPerScan must be a finite number/u,
  )

  assert.deepEqual(parseAssistantOutboxDrainRequestBody({ vault: '/tmp/vault' }), {
    limit: undefined,
    now: undefined,
    vault: '/tmp/vault',
  })

  assert.throws(
    () =>
      parseAssistantOutboxDrainRequestBody({
        limit: '7',
      }),
    /request field limit must be a finite number/u,
  )
})

test('assistantd http protocol validates optional nullable-string and boolean fields', () => {
  assert.deepEqual(parseAssistantOutboxDrainRequestBody({ now: null, vault: null }), {
    limit: undefined,
    now: null,
    vault: null,
  })

  assert.throws(
    () =>
      parseAssistantOutboxDrainRequestBody({
        now: 7,
      }),
    /request field now must be a string when present/u,
  )

  assert.throws(
    () =>
      parseAssistantMessageRequestBody({
        deliverResponse: 'yes',
        prompt: 'hello',
      }),
    /request field deliverResponse must be a boolean when present/u,
  )

  assert.throws(
    () =>
      parseAssistantCronTargetSetRequestBody(
        new URL('http://localhost/cron/jobs/cron_http_test/target'),
        {
          dryRun: 'yes',
        },
      ),
    /request field dryRun must be a boolean when present/u,
  )
})
